import { randomUUID } from 'node:crypto';
import type { Message } from 'spectrum-ts';
import { isActiveJob, jobStageLabels, type GenerationJob, type JobAttempt } from '../shared/generation-job.js';
import type { SavedDesign } from './store.js';
import { PhotonApiError, type PhotonJobsApi } from './photon-api.js';
import { PhotonInputError, contentMessageIds, extractMessageInput, importSavedDesign, inventoryContext, parseConversation, rememberMessageIds, routeText, shouldHandleMessage, type Conversation, type PendingPhotonRequest, type PhotonQuality } from './photon-routing.js';

export interface PhotonReply {
  text(value: string): Promise<void>;
  preview(svg: Buffer): Promise<void>;
  model(bytes: Buffer): Promise<void>;
  manual(bytes: Buffer): Promise<void>;
  designPreview(design: SavedDesign): Promise<void>;
}

// Checker/provider diagnostics belong in the saved job, not in a text message.
function buildProblem(messages: string[]): string {
  const detail = messages.join(' ');
  if (/prepaid|prepayment|payment.required|depleted.*credits/i.test(detail)) return 'The AI service is out of credits. Please check the project’s billing before trying again.';
  if (/quota|rate.limit|resource.exhausted/i.test(detail)) return 'The AI service has reached a usage limit. Please try again later.';
  if (/api.key|unauthenticated|permission.denied/i.test(detail)) return 'The AI connection needs attention before I can build again.';
  if (/timed? ?out|time.limit|deadline/i.test(detail)) return 'I ran out of time to finish this version.';
  if (/unavailable|overloaded|network|fetch failed/i.test(detail)) return 'The AI service is temporarily unavailable. Please try again shortly.';
  const reasons: string[] = [];
  if (/disconnected|no stud support|mating connection/i.test(detail)) reasons.push('Some sections don’t connect yet.');
  if (/overlap|collision/i.test(detail)) reasons.push('Some pieces overlap and need to move.');
  if (/cannot pack|supported part|unsupported part|specialty part|part.shape|dimensions/i.test(detail)) reasons.push('Some details need a different piece or size.');
  if (/visual|likeness|silhouette|feature \d|reference/i.test(detail)) reasons.push('The shape still needs to look closer to your request.');
  return reasons.slice(0, 2).join(' ') || 'I haven’t found an arrangement that passes the brick checks yet.';
}

/** A single inbound conversation; generation runs independently in API workers. */
export class PhotonConversation {
  private state: Conversation;
  private commands: Promise<unknown> = Promise.resolve();
  private writes: Promise<unknown> = Promise.resolve();
  private polling = false;
  private changing = false;
  private exporting = false;
  constructor(value: Conversation, private api: PhotonJobsApi, private reply: PhotonReply,
    private save: (value: Conversation) => Promise<void>, private publicBaseUrl?: string, private now: () => number = Date.now) { this.state = parseConversation(value); }
  snapshot() { return parseConversation(this.state); }
  private persist() {
    const value = this.snapshot();
    const pending = this.writes.then(() => this.save(value));
    this.writes = pending.catch(() => {});
    return pending;
  }
  private link(key: 'job' | 'design', id: string) {
    if (!this.publicBaseUrl) return '';
    const url = new URL('/', this.publicBaseUrl); url.searchParams.set(key, id); return `\n${url}`;
  }
  private async tell(value: string, jobId?: string) {
    await this.reply.text(value);
    if (jobId && this.state.jobId === jobId) { this.state.lastDeliveryAt = this.now(); await this.persist(); }
  }
  private async askQuality() {
    await this.tell('Quick: aim for a usable draft in about 2.5 minutes. Detailed: more references and refinement, usually several minutes. Which would you like?', this.state.jobId);
  }
  private completionMessage(job: GenerationJob, design?: SavedDesign) {
    const saved = design ? `Your checked draft is kept. Send /model to rotate it or /manual for instructions.${this.link('design', design.id)}`
      : this.state.designId ? 'Your previous checked build is kept. Send /model or /manual to see it.' : 'No checked draft was produced.';
    if (job.status === 'cancelled' || job.status === 'interrupted') return `The build ${job.status === 'cancelled' ? 'was stopped' : 'was interrupted'}. ${saved} Reply Quick or Detailed when you want to try again.`;
    const matched = design?.research?.comparison.status === 'matched';
    const problem = job.error ? ` ${buildProblem([job.error.message, ...job.error.checks])}` : '';
    if (job.quality === 'quick') return `Quick finished${design ? ' with a draft that passes brick checks.' : ' without a draft that passes brick checks.'}${design ? matched ? ' It also passed the AI visual review.' : ' It has not passed a complete visual review.' : ''}${problem} ${saved} Reply Detailed to try again with more time, or describe a change.`;
    if (job.status === 'succeeded' && matched) return `The build passed the brick checks and AI visual review. Please inspect it before building; physical stability is not tested. Send a change, /model, or /manual.${this.link('design', design!.id)}`;
    return `${job.status === 'failed' ? 'I couldn’t finish this build.' : 'This draft still needs visual refinement.'}${problem} ${saved} Reply Quick or Detailed to try again, or describe a simpler version.${this.link('job', job.id)}`;
  }
  private stageLabel(job: GenerationJob) {
    if (!job.progress) return 'Starting the build';
    if (job.progress.stage === 'repairing' && job.progress.detail?.includes('simpler build')) return 'Trying a simpler build with standard bricks and plates';
    if (job.progress.stage === 'repairing' && job.progress.detail?.includes('time or response limit')) return 'Retrying the unfinished attempt';
    return jobStageLabels[job.progress.stage];
  }
  private async progress(job: GenerationJob) {
    if (!isActiveJob(job) || this.changing || this.state.jobId !== job.id) return;
    const now = this.now(), lastDelivery = this.state.lastDeliveryAt ?? 0;
    const key = `${job.status}:${job.progress?.stage ?? 'starting'}:${job.progress?.attempt ?? 1}`;
    const changed = key !== this.state.lastProgressKey && now - (this.state.lastProgressAt ?? 0) >= 15_000 && now - lastDelivery >= 15_000;
    if (!changed && now - lastDelivery < 30_000) return;
    const seconds = Math.max(0, Math.floor((now - Date.parse(job.startedAt || job.createdAt)) / 1000));
    const stage = job.status === 'queued' ? 'Waiting for your turn' : this.stageLabel(job);
    await this.tell(job.status === 'queued' ? `Your build is waiting its turn · ${seconds}s in the queue. Quick timing begins when it starts. Send /stop any time.`
      : `${changed ? stage : `Still working: ${stage.toLowerCase()}`} · ${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')} elapsed${job.progress ? ` · attempt ${job.progress.attempt}` : ''}. Send /stop any time.`, job.id);
    if (this.state.jobId === job.id) { this.state.lastProgressAt = this.now(); this.state.lastProgressKey = key; await this.persist(); }
  }
  handle(message: Pick<Message, 'direction' | 'id' | 'content'>) {
    // Downloading or sending an already requested file must not delay Stop.
    if (this.exporting && message.direction === 'inbound' && message.content.type === 'text' && /^\s*\/?(?:stop|cancel)\s*$/i.test(message.content.text)) return this.receive(message);
    const task = this.commands.then(() => this.receive(message));
    this.commands = task.catch(() => {});
    return task;
  }
  private async checkedDraft(job: GenerationJob, announce: boolean) {
    const id = job.resultId || job.bestDraftId;
    if (!id) return;
    const design = await this.api.design(id);
    if (this.state.jobId !== job.id || announce && this.changing) return;
    this.state.designId = design.id;
    if (!announce || this.state.lastDraftId === id) { await this.persist(); return design; }
    await this.persist();
    await this.tell(`${design.title} · ${design.bricks.length} pieces. This saved draft passes brick checks.${design.research?.comparison.status !== 'matched' ? ' It has not passed a complete visual review.' : ''}\nReply with a change, /model for the rotatable file, or /manual for instructions.${this.link('design', id)}`, job.id);
    if (this.state.jobId === job.id) await this.reply.designPreview(design);
    if (this.state.jobId === job.id) { this.state.lastDraftId = id; this.state.lastDeliveryAt = this.now(); await this.persist(); }
    return design;
  }
  private async stopCurrent() {
    if (!this.state.jobId) return;
    const id = this.state.jobId;
    let job: GenerationJob;
    try { job = await (this.state.finishedJobId === id ? this.api.get(id) : this.api.stop(id)); }
    catch (error) {
      if (!(error instanceof PhotonApiError) || error.status !== 404) throw error;
      await this.forgetMissingJob(id); return;
    }
    if (this.state.finishedJobId === id) return job;
    if (isActiveJob(job)) throw new PhotonInputError('Stopping could not be confirmed. Send /stop again.');
    await this.checkedDraft(job, false);
    this.state.finishedJobId = job.id;
    await this.persist();
    return job;
  }
  private async forgetMissingJob(id: string) {
    if (this.state.jobId !== id) return;
    delete this.state.jobId; delete this.state.finishedJobId; delete this.state.lastAttempt;
    await this.persist();
  }
  private async beginRequest(request: PendingPhotonRequest, quality: PhotonQuality) {
    await this.reply.text((quality === 'quick' ? 'Starting Quick. I’ll aim for a usable checked draft in about 2.5 minutes and keep you updated. Send /stop any time.'
      : 'Starting Detailed. I’ll send checked drafts while I review and refine the build. Send /stop any time.')
      + '\n\n/status: progress · /stop: stop generation'
      + '\n/model: rotatable file · /manual: PDF instructions, once a checked build is available'
      + '\n/use N: stop and choose checked attempt N'
      + '\n/open ID: open a saved build'
      + '\n/new idea: new subject, then choose a mode'
      + '\n/quick idea · /detailed idea: start with that mode'
      + '\nReply with a change, then choose a mode.');
    const acknowledgedAt = this.now();
    await this.stopCurrent();
    const previous = request.kind === 'new' || !this.state.designId ? undefined : await this.api.design(this.state.designId);
    const image = request.image ?? (request.kind === 'new' ? undefined : this.state.pendingImage);
    const prompt = !previous && request.kind !== 'new' && this.state.requestPrompt && request.prompt !== this.state.requestPrompt
      ? `${this.state.requestPrompt}\nRequested change: ${request.prompt}` : request.prompt;
    if (prompt.length > 4000) throw new PhotonInputError('This conversation request is too long. Send /new followed by the full updated description.');
    const requestId = randomUUID();
    this.state.jobId = requestId; this.state.lastAttempt = 0; this.state.requestPrompt = prompt; this.state.quality = quality;
    this.state.lastDeliveryAt = acknowledgedAt;
    delete this.state.finishedJobId; delete this.state.lastDraftId; delete this.state.lastProgressAt; delete this.state.lastProgressKey;
    delete this.state.pendingRequest; delete this.state.pendingQuality;
    if (image) this.state.pendingImage = image; else delete this.state.pendingImage;
    if (request.kind === 'new') delete this.state.designId;
    await this.persist();
    // The persisted ID binds an interrupted HTTP response to this one request.
    try { await this.api.submit(requestId, { prompt, image, previous, ...inventoryContext(this.state), quality }); }
    catch (error) {
      if (error instanceof PhotonApiError && error.status >= 400 && error.status < 500) {
        await this.forgetMissingJob(requestId); this.state.pendingRequest = request; await this.persist();
      }
      throw error;
    }
  }
  private async receive(message: Pick<Message, 'direction' | 'id' | 'content'>) {
    if (!shouldHandleMessage(message.direction, message.id, this.state.handledIds)) return;
    this.state.handledIds = rememberMessageIds(this.state.handledIds, contentMessageIds(message.id, message.content));
    await this.persist();
    try {
      const input = await extractMessageInput(message.content);
      if (!input.prompt && !input.image) return;
      const command = routeText(input.prompt);
      if (command.kind === 'chat') {
        await this.tell(this.state.pendingRequest ? 'Your request is saved. Reply Quick or Detailed when you’re ready.' : 'Send an idea or a change when you’re ready. You can ask for status any time.', this.state.jobId); return;
      }
      if (command.kind === 'status') {
        if (!this.state.jobId) await this.reply.text(this.state.pendingRequest?.prompt ? 'Your request is saved and waiting for your choice: Quick or Detailed.' : 'No active build yet. Send a description, or a photo with a description.');
        else {
          const id = this.state.jobId;
          let job: GenerationJob;
          try { job = await this.api.get(id); }
          catch (error) {
            if (!(error instanceof PhotonApiError) || error.status !== 404) throw error;
            await this.forgetMissingJob(id);
            await this.reply.text('That request is not on the build server. Your checked draft is kept. Send your idea again, or /new followed by a new idea.'); return;
          }
          if (!isActiveJob(job)) {
            // /use may have selected a different checked attempt after stopping.
            const selectedId = this.state.finishedJobId === job.id && this.state.lastDraftId === this.state.designId ? this.state.designId : undefined;
            const design = selectedId ? await this.api.design(selectedId) : await this.checkedDraft(job, false);
            await this.tell(this.completionMessage(job, design), job.id);
            return;
          }
          const stage = job.status === 'queued' ? 'Your build is waiting its turn. Quick timing begins when it starts.' : `${this.stageLabel(job)}.`;
          await this.tell(`${stage}${this.state.pendingRequest?.prompt ? ' Your next request is waiting for Quick or Detailed.' : ''}\nSend /stop to end generation, or /use followed by a checked attempt number.${this.link('job', job.id)}`, job.id);
          await this.poll();
        }
        return;
      }
      if (command.kind === 'manual' || command.kind === 'model') {
        if (!this.state.designId) throw new PhotonInputError('There is no checked build selected yet. Send an idea first, or /use followed by a checked attempt number.');
        const designId = this.state.designId;
        this.exporting = true;
        try {
          await this.tell(command.kind === 'model' ? 'Preparing your rotatable 3D file. Large builds can take a moment.' : 'Preparing your instruction manual.');
          await this.api.design(designId);
          const bytes = await this.api.file(designId, command.kind === 'manual' ? 'manual.pdf' : 'model.usdz');
          if (command.kind === 'manual') await this.reply.manual(bytes); else await this.reply.model(bytes);
        } catch (error) {
          if (error instanceof PhotonInputError && !(error instanceof PhotonApiError)) {
            const fallback = this.link('design', designId) || `\nThe viewer is local to the computer running this app. On that computer, open the website with ?design=${encodeURIComponent(designId)} at the end of its address, then choose ${command.kind === 'model' ? 'Download 3D (.usdz)' : 'the PDF download'}.`;
            await this.tell(`${error.message}${fallback}`);
          } else throw error;
        } finally { this.exporting = false; }
        return;
      }
      this.changing = true;
      if (command.kind === 'stop') {
        const hadPending = Boolean(this.state.pendingRequest || this.state.pendingQuality);
        delete this.state.pendingRequest; delete this.state.pendingQuality; await this.persist();
        const job = await this.stopCurrent();
        await this.reply.text(job ? `Generation stopped.${hadPending ? ' Your pending request was cancelled too.' : ''} ${this.state.designId ? 'Your checked draft is kept. Send /model or /manual, or describe a change.' : 'No checked draft is available yet; saved attempt output remains in the viewer.'}${this.link('job', job.id)}` : hadPending ? 'Your pending request is cancelled. No generation was started.' : 'There is no active generation to stop.');
        return;
      }
      if (command.kind === 'use') {
        if (!this.state.jobId) throw new PhotonInputError('Start a build before selecting an attempt.');
        const job = await this.api.get(this.state.jobId);
        const attempt = job.attempts?.find(item => item.attempt === command.attempt);
        if (!attempt?.designId || attempt.status !== 'valid' || attempt.partial) throw new PhotonInputError('That attempt is unfinished. Choose one marked as passing brick checks.');
        await this.stopCurrent();
        const design = await this.api.design(attempt.designId);
        delete this.state.pendingRequest; delete this.state.pendingQuality;
        this.state.designId = design.id; this.state.lastDraftId = design.id; await this.persist();
        await this.reply.text(`Using attempt ${attempt.attempt}: ${design.title}. Generation is stopped. Send /model for the rotatable model, /manual for the PDF, or a change.${this.link('design', design.id)}`);
        await this.reply.designPreview(design); return;
      }
      if (command.kind === 'open') {
        const design = await this.api.design(command.designId);
        await this.stopCurrent();
        this.state = importSavedDesign(this.state, design); await this.persist();
        await this.reply.text(`Opened ${design.title}.${this.state.inventory?.length ? ' Its saved collection will limit future builds to your owned pieces.' : ''}\nReply with a change, /model, or /manual.${this.link('design', design.id)}`);
        return;
      }
      if (command.kind === 'quality') {
        let request: PendingPhotonRequest | undefined = command.prompt
          ? { kind: 'design', prompt: command.prompt, ...(input.image ? { image: input.image } : {}) }
          : this.state.pendingRequest;
        if (!request?.prompt) {
          if (this.state.jobId) {
            const job = await this.api.get(this.state.jobId);
            if (isActiveJob(job)) {
              await this.tell(`Your ${job.quality === 'quick' ? 'Quick' : 'Detailed'} build is already running. No second build was started. Describe a change first, or send /stop.`, job.id); return;
            }
          }
          if (!request && this.state.requestPrompt) request = { kind: 'design', prompt: this.state.requestPrompt, ...(this.state.pendingImage ? { image: this.state.pendingImage } : {}) };
          else {
            this.state.pendingQuality = command.quality; await this.persist();
            await this.reply.text(`${command.quality === 'quick' ? 'Quick' : 'Detailed'} selected. What would you like to build${request?.image ? ' from the photo' : ''}?`); return;
          }
        }
        await this.beginRequest(request, command.quality); return;
      }
      const kind = command.kind === 'new' ? 'new' : 'design';
      const staged = this.state.pendingRequest;
      const request: PendingPhotonRequest = {
        kind, prompt: command.prompt || (input.image && staged ? staged.prompt : ''),
        ...(input.image ? { image: input.image } : kind !== 'new' && staged?.image ? { image: staged.image } : {}),
      };
      this.state.pendingRequest = request;
      await this.persist();
      if (!request.prompt) {
        await this.reply.text(request.image ? 'What would you like to build from this photo? It will be inspiration, not a verified inventory.' : 'What would you like to build? Send an idea, or one photo and a description.'); return;
      }
      if (this.state.pendingQuality) await this.beginRequest(request, this.state.pendingQuality);
      else await this.askQuality();
    } catch (error) {
      await this.reply.text(error instanceof PhotonApiError
        ? error.status === 404 ? 'I couldn’t find that saved build. Check the ID after /open, or send a new idea.'
          : error.status === 429 ? 'The build service is busy. Please try again shortly. Your saved builds are unchanged.'
          : 'The build service couldn’t complete that request. Send /status to reconnect, or /stop to stop it. Your saved builds are unchanged.'
        : error instanceof PhotonInputError ? error.message : 'I could not confirm that request. Send /status to reconnect to the same build, or /stop to stop it. Your saved builds are unchanged.');
    } finally { this.changing = false; }
  }
  private async deliverAttempt(job: GenerationJob, attempt: JobAttempt) {
    if (this.changing || this.state.jobId !== job.id || this.state.finishedJobId === job.id) return;
    await this.tell(attempt.status === 'valid'
      ? `Attempt ${attempt.attempt} passes brick checks. Send /use ${attempt.attempt} to stop and choose it.${attempt.designId ? this.link('design', attempt.designId) : ''}`
      : `Attempt ${attempt.attempt} is unfinished. ${buildProblem(attempt.checks)}${attempt.partial ? ' This preview only shows part of the build; missing sections are not shown.' : ''} Please don’t build from it yet.${isActiveJob(job) ? ' I’m still working on it. Send /stop any time.' : ' This run has ended.'}${this.link('job', job.id)}`, job.id);
    if (!this.changing && this.state.jobId === job.id && attempt.previewAvailable) {
      const preview = await this.api.preview(job.id, attempt.attempt);
      if (!this.changing && this.state.jobId === job.id && this.state.finishedJobId !== job.id) await this.reply.preview(preview);
    }
    if (this.state.jobId === job.id) { this.state.lastAttempt = Math.max(this.state.lastAttempt ?? 0, attempt.attempt); this.state.lastDeliveryAt = this.now(); await this.persist(); }
  }
  async poll() {
    if (this.polling || this.changing || !this.state.jobId || this.state.finishedJobId === this.state.jobId) return;
    this.polling = true;
    try {
      const job = await this.api.get(this.state.jobId);
      if (this.changing || this.state.jobId !== job.id) return;
      // A useful checked model is delivered promptly, including on provider failure.
      if (job.bestDraftId && this.state.lastDraftId !== job.bestDraftId) await this.checkedDraft(job, true);
      if (this.changing || this.state.jobId !== job.id || this.state.finishedJobId === job.id) return;
      let next: JobAttempt | undefined;
      const previousCursor = this.state.lastAttempt ?? 0;
      for (const attempt of job.attempts ?? []) {
        if (attempt.attempt <= previousCursor) continue;
        const suppressed = attempt.status !== 'valid' && (attempt.attempt < 4 || job.quality === 'quick')
          || job.quality === 'quick' && Boolean(this.state.lastDraftId);
        if (!suppressed) { next = attempt; break; }
        this.state.lastAttempt = attempt.attempt;
      }
      if ((this.state.lastAttempt ?? 0) !== previousCursor) await this.persist();
      if (next) { await this.deliverAttempt(job, next); return; }
      await this.progress(job);
      if (!isActiveJob(job) && !this.changing && this.state.jobId === job.id) {
        const design = await this.checkedDraft(job, true);
        await this.tell(this.completionMessage(job, design), job.id);
        if (this.state.jobId === job.id) { this.state.finishedJobId = job.id; await this.persist(); }
      }
    } catch (error) {
      if (!(error instanceof PhotonApiError) || error.status !== 404) throw error;
      // Keep an ambiguous submission id until the user explicitly asks for
      // status/Stop/a new request. Polling never recreates a paid request.
    } finally { this.polling = false; }
  }
}
