import { randomUUID } from 'node:crypto';
import type { Message } from 'spectrum-ts';
import { isActiveJob, jobStageLabels, type GenerationJob, type JobAttempt } from '../shared/generation-job.js';
import type { SavedDesign } from './store.js';
import { PhotonApiError, type PhotonJobsApi } from './photon-api.js';
import { PhotonInputError, contentMessageIds, extractMessageInput, importSavedDesign, inventoryContext, isRevisionPrompt, parseConversation, rememberMessageIds, routeText, shouldHandleMessage, type Conversation, type PendingPhotonRequest, type PhotonQuality } from './photon-routing.js';

export interface PhotonReply {
  text(value: string): Promise<void>;
  preview(svg: Buffer): Promise<void>;
  model(bytes: Buffer): Promise<void>;
  manual(bytes: Buffer): Promise<void>;
  parts(bytes: Buffer): Promise<void>;
  designPreview(design: SavedDesign): Promise<void>;
  instructions?(url: string, title: string): Promise<void>;
}

type ExportKind = 'model' | 'manual' | 'parts' | 'instructions';
const exportLabels: Record<ExportKind, string> = { model: 'rotatable 3D file', manual: 'PDF instructions', parts: 'parts list', instructions: 'interactive building guide' };
interface ExportProgress {
  kind: ExportKind;
  phase: 'preparing' | 'sending';
  lastDeliveryAt: number;
  lastAttemptAt: number;
  lastKey: string;
  pending?: Promise<void>;
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
  private interpreting = false;
  private chatVersion = 0;
  private activeExport?: ExportProgress;
  private get exporting() { return Boolean(this.activeExport); }
  constructor(value: Conversation, private api: PhotonJobsApi, private reply: PhotonReply,
    private save: (value: Conversation) => Promise<void>, private publicBaseUrl?: string, private now: () => number = Date.now,
    private qualitySelectionEnabled = false) { this.state = parseConversation(value); }
  snapshot() { return parseConversation(this.state); }
  private persist() {
    const value = this.snapshot();
    const pending = this.writes.then(() => this.save(value));
    this.writes = pending.catch(() => {});
    return pending;
  }
  private link(key: 'job' | 'design', id: string) {
    // The public guide gateway accepts signed links, not the local job/editor URLs.
    if (!this.publicBaseUrl || this.api.instructionsLink) return '';
    const url = new URL('/', this.publicBaseUrl); url.searchParams.set(key, id); return `\n${url}`;
  }
  private async tell(value: string, jobId?: string) {
    await this.reply.text(value);
    if (jobId && this.state.jobId === jobId) { this.state.lastDeliveryAt = this.now(); await this.persist(); }
  }
  private async instructionUrl(id: string) {
    try { return await this.api.instructionsLink?.(id) || undefined; }
    catch { return undefined; }
  }
  private async sendInstructions(design: SavedDesign, url: string) {
    if (this.reply.instructions) await this.reply.instructions(url, design.title);
    else await this.reply.text(`Build ${design.title}, one step at a time. Open your guide:\n${url}`);
  }
  private exportStage(progress: ExportProgress) {
    return `${progress.phase === 'preparing' ? 'Preparing' : 'Sending'} your ${exportLabels[progress.kind]}`;
  }
  private beginExport(kind: ExportKind) {
    this.activeExport = { kind, phase: 'preparing', lastDeliveryAt: this.now() - 30_000, lastAttemptAt: this.now(), lastKey: '' };
  }
  private async exportMessage(text: string): Promise<void> {
    const progress = this.activeExport;
    if (!progress) return;
    if (progress.pending) {
      await progress.pending;
      if (this.activeExport !== progress) return;
      return this.exportMessage(text);
    }
    const key = `${progress.kind}:${progress.phase}`;
    progress.lastAttemptAt = this.now();
    const pending = this.reply.text(text).then(() => {
      progress.lastDeliveryAt = this.now(); progress.lastKey = key;
    }).catch(() => { /* Progress delivery must not interrupt file preparation or acknowledgements. */ });
    progress.pending = pending;
    await pending;
    if (progress.pending === pending) delete progress.pending;
  }
  private async exportProgress() {
    const progress = this.activeExport;
    if (!progress || progress.pending || this.now() - progress.lastAttemptAt < 15_000) return;
    const changed = progress.lastKey !== `${progress.kind}:${progress.phase}`;
    if (this.now() - progress.lastDeliveryAt < (changed ? 15_000 : 30_000)) return;
    const stage = this.exportStage(progress);
    await this.exportMessage(`${changed ? stage : `Still working: ${stage[0].toLowerCase()}${stage.slice(1)}`}. Your checked build is saved.`);
  }
  private async finishExport() {
    const progress = this.activeExport;
    delete this.activeExport;
    // Finish an already-started check-in before the final acknowledgement.
    await progress?.pending;
  }
  private async askQuality() {
    await this.tell('Quick: aim for a usable draft in about 2.5 minutes. Detailed: more references and refinement, usually several minutes. Which would you like?', this.state.jobId);
  }
  private feedbackPrompt(design: SavedDesign) {
    const review = design.research?.comparison.status === 'matched' ? 'It also passed the AI visual review.'
      : design.research?.comparison.status === 'needs-work' ? 'The shape still needs refinement, so please check whether it looks right to you.'
        : 'AI visual review was skipped. Please check whether the preview looks like your request.';
    return `${review} Reply with a change, or /approve when you’re ready to build. /instructions opens the building guide; /manual gets a PDF.`;
  }
  private completionMessage(job: GenerationJob, design?: SavedDesign) {
    const saved = design ? `Your checked draft is kept. ${this.feedbackPrompt(design)}${this.link('design', design.id)}`
      : this.state.designId ? 'Your previous checked build is kept. Send /model or /manual to see it.' : 'No checked draft was produced.';
    if (job.status === 'cancelled' || job.status === 'interrupted') return `The build ${job.status === 'cancelled' ? 'was stopped' : 'was interrupted'}. ${saved} ${this.qualitySelectionEnabled ? 'Reply Quick or Detailed when you want to try again.' : 'Send your idea or a change when you want to try again.'}`;
    const matched = design?.research?.comparison.status === 'matched';
    const problem = job.error ? ` ${buildProblem([job.error.message, ...job.error.checks])}` : '';
    if (job.quality === 'quick') return `${this.qualitySelectionEnabled ? 'Quick' : 'The build'} finished${design ? ' with a draft that passes brick checks.' : ' without a draft that passes brick checks.'}${problem} ${saved} ${this.qualitySelectionEnabled ? 'Reply Detailed to try again with more time, or describe a change.' : 'Describe a change if you want another version.'}`;
    if (job.status === 'succeeded' && matched) return `The build passed the brick checks and AI visual review. Please inspect it before building; physical stability is not tested. Reply with a change, or /approve for the building guide, 3D file and parts list. /manual gets an optional PDF.${this.link('design', design!.id)}`;
    if (design && design.research?.comparison.status !== 'needs-work') return `This draft passes brick checks.${problem} ${saved}`;
    return `${job.status === 'failed' ? 'I couldn’t finish this build.' : 'This draft still needs visual refinement.'}${problem} ${saved} ${this.qualitySelectionEnabled ? 'Reply Quick or Detailed to try again, or describe a simpler version.' : 'Describe what to change, or send a simpler version of your idea.'}${this.link('job', job.id)}`;
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
    await this.tell(job.status === 'queued' ? `Your build is waiting its turn · ${seconds}s in the queue.${this.qualitySelectionEnabled ? ' Quick timing begins when it starts.' : ''} Send /stop any time.`
      : `${changed ? stage : `Still working: ${stage.toLowerCase()}`} · ${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')} elapsed${job.progress ? ` · attempt ${job.progress.attempt}` : ''}. Send /stop any time.`, job.id);
    if (this.state.jobId === job.id) { this.state.lastProgressAt = this.now(); this.state.lastProgressKey = key; await this.persist(); }
  }
  handle(message: Pick<Message, 'direction' | 'id' | 'content'>) {
    // Long exports stay serialized, but must not delay status or Stop.
    if ((this.exporting || this.interpreting) && message.direction === 'inbound' && message.content.type === 'text') {
      try {
        const { kind } = routeText(message.content.text);
        if (kind === 'stop' || kind === 'status') return this.receive(message);
      } catch { /* Invalid commands still use the ordinary error handler. */ }
    }
    const task = this.commands.then(() => this.receive(message));
    this.commands = task.catch(() => {});
    return task;
  }
  private async checkedDraft(job: GenerationJob, announce: boolean) {
    const id = job.resultId || job.bestDraftId;
    if (!id) return;
    const design = await this.api.design(id);
    if (this.state.jobId !== job.id || announce && this.changing) return;
    if (!announce || this.state.lastDraftId === id) {
      this.state.designId = this.state.feedbackDesignId || design.id;
      await this.persist(); return design;
    }
    await this.tell(`${design.title} · ${design.bricks.length} pieces. This saved draft passes brick checks.\n${this.feedbackPrompt(design)}${this.link('design', id)}`, job.id);
    if (this.state.jobId !== job.id || this.changing || this.state.finishedJobId === job.id) return;
    await this.reply.designPreview(design);
    if (this.state.jobId === job.id && !this.changing && this.state.finishedJobId !== job.id) {
      this.state.designId = id; this.state.feedbackDesignId = id; this.state.lastDraftId = id; this.state.lastDeliveryAt = this.now(); await this.persist();
      const url = await this.instructionUrl(id);
      if (url && this.state.feedbackDesignId === id && this.state.jobId === job.id && !this.changing) {
        try { await this.sendInstructions(design, url); } catch { /* The checked preview remains selected; /instructions can retry the link. */ }
      }
    }
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
    if (!this.state.feedbackDesignId) await this.checkedDraft(job, false);
    else this.state.designId = this.state.feedbackDesignId;
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
    if (!this.qualitySelectionEnabled) quality = 'detailed';
    const previousId = request.kind === 'new' ? undefined : this.state.feedbackDesignId || this.state.designId;
    await this.reply.text((!this.qualitySelectionEnabled ? 'Starting your build. I’ll send a checked preview for your feedback. Send /stop any time.'
      : quality === 'quick' ? 'Starting Quick. I’ll aim for a usable checked draft in about 2.5 minutes and keep you updated. Send /stop any time.'
        : 'Starting Detailed. I’ll send checked drafts while I review and refine the build. Send /stop any time.')
      + '\n\n/status: progress · /stop: stop generation'
      + '\n/model: rotatable file · /manual: PDF instructions, once a checked build is available'
      + '\n/instructions or /build: interactive building guide'
      + '\n/parts: parts list · /approve: accept this exact preview and get ready to build'
      + '\n/retry: resend only missing files from your approved build'
      + '\n/use N: stop and choose checked attempt N'
      + '\n/open ID: open a saved build'
      + (this.qualitySelectionEnabled ? '\n/new idea: new subject, then choose a mode\n/quick idea · /detailed idea: start with that mode\nReply with a change to keep this mode, or name Quick or Detailed to switch.'
        : '\n/new idea: start a new subject\nReply with a change to revise this build.'));
    const acknowledgedAt = this.now();
    await this.stopCurrent();
    const selectedId = previousId || (request.kind !== 'new' ? this.state.designId : undefined);
    const previous = selectedId ? await this.api.design(selectedId) : undefined;
    const image = request.image ?? (request.kind === 'new' ? undefined : this.state.pendingImage);
    const prompt = request.kind !== 'new' && this.state.requestPrompt && request.prompt !== this.state.requestPrompt
      ? `${this.state.requestPrompt}\nRequested change: ${request.prompt}` : request.prompt;
    if (prompt.length > 4000) throw new PhotonInputError('This conversation request is too long. Send /new followed by the full updated description.');
    const requestId = randomUUID();
    this.state.jobId = requestId; this.state.lastAttempt = 0; this.state.requestPrompt = prompt; this.state.quality = quality;
    this.state.lastDeliveryAt = acknowledgedAt;
    delete this.state.finishedJobId; delete this.state.lastDraftId; delete this.state.lastProgressAt; delete this.state.lastProgressKey;
    delete this.state.pendingRequest; delete this.state.pendingQuality;
    delete this.state.feedbackDesignId;
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
  private async approve(retry = false) {
    const id = retry ? this.state.approvedDesignId : this.state.feedbackDesignId;
    if (retry && !id) throw new PhotonInputError('There is no approved build to resend yet. Choose a checked preview and send /approve first. No new build was started.');
    if (!id || !retry && this.state.pendingRequest) throw new PhotonInputError('Choose a checked preview before approving. Send /use N to select a checked attempt, or finish your pending request first.');
    // Status and Stop must also work while validating the revision or finding its guide.
    this.beginExport(this.api.instructionsLink ? 'instructions' : 'model');
    try {
      const design = await this.api.design(id);
      const guideUrl = await this.instructionUrl(id);
      if (!retry) {
        await this.stopCurrent();
        // Stopping may expose a newer worker draft. Approval stays on the preview
        // the user saw, never the latest result returned by the worker.
        this.state.designId = id; this.state.lastDraftId = id; this.state.approvedDesignId = id;
      }
      this.state.approvedDeliveries ??= {};
      if (!Object.hasOwn(this.state.approvedDeliveries, id)) this.state.approvedDeliveries = { ...this.state.approvedDeliveries, [id]: guideUrl ? { mode: 'guide' } : {} };
      await this.persist();
      const delivery = this.state.approvedDeliveries[id];
      const files = delivery.mode === 'guide'
        ? [['instructions', null, 'building guide'], ['model', 'mobile.usdz', '3D file'], ['parts', 'parts.csv', 'parts list']] as const
        : [['model', 'mobile.usdz', '3D file'], ['manual', 'manual.pdf', 'PDF instructions'], ['parts', 'parts.csv', 'parts list']] as const;
      if (files.every(([kind]) => delivery[kind])) { await this.finishExport(); await this.tell(delivery.mode === 'guide'
        ? 'Ready to build. Your guide, 3D file and parts list were sent. /instructions reopens the guide; /manual gets an optional PDF.'
        : 'This build is approved and all three files were sent. Send /model, /manual, or /parts if you want a copy.'); return; }
      const failed: string[] = [];
      this.activeExport!.kind = files.find(([kind]) => !delivery[kind])![0];
      await this.exportMessage(`${retry ? 'Resending missing files for your approved build:' : 'Approved'} ${design.title}. I’ll send the remaining files for this exact build. ${this.exportStage(this.activeExport!)}. Brick connections are checked; physical stability is not tested.`);
      for (const [kind, format, label] of files) {
        if (delivery[kind]) continue;
        try {
          this.activeExport!.kind = kind; this.activeExport!.phase = 'preparing';
          if (kind === 'instructions') {
            if (!guideUrl) throw new PhotonInputError('The building guide link is temporarily unavailable.');
            this.activeExport!.phase = 'sending';
            await this.sendInstructions(design, guideUrl);
          } else {
            const bytes = await this.api.file(id, format);
            this.activeExport!.phase = 'sending';
            await this.reply[kind](bytes);
          }
          delivery[kind] = true;
          await this.persist();
        } catch { failed.push(label); }
      }
      await this.finishExport();
      await this.tell(failed.length ? `Your approved build is saved. I couldn’t send: ${failed.join(', ')}. Send /retry to resend just those files.${this.link('design', id)}`
        : delivery.mode === 'guide' ? 'Ready, set, build. Your guide, 3D file and parts list have been sent. The guide walks through each step; /manual gets an optional PDF. You can still reply with a change.'
          : 'Your 3D file, PDF instructions, and parts list have been sent. You can still reply with a change.').catch(() => {});
    } finally { await this.finishExport(); }
  }
  private async receive(message: Pick<Message, 'direction' | 'id' | 'content'>) {
    if (!shouldHandleMessage(message.direction, message.id, this.state.handledIds)) return;
    this.state.handledIds = rememberMessageIds(this.state.handledIds, contentMessageIds(message.id, message.content));
    await this.persist();
    try {
      const input = await extractMessageInput(message.content);
      if (!input.prompt && !input.image) return;
      let command = !this.qualitySelectionEnabled && /^(?:start|continue|go ahead)[.!]?$/i.test(input.prompt.trim())
        ? { kind: 'quality' as const, quality: 'detailed' as const, prompt: '' } : routeText(input.prompt);
      const confirmsSuggestion = /^(?:yes|yep|yeah|sure|ok(?:ay)?|sounds good|go for it|let[’']s do (?:it|that))(?:[, ]+please)?[.!]*$/i.test(input.prompt.trim());
      if (command.kind === 'chat' && confirmsSuggestion && this.state.chatHistory?.length && !this.state.pendingRequest) command = { kind: 'conversation', prompt: input.prompt };
      let conversationalRevision = false, conversationalNew = false;
      if (command.kind === 'conversation') {
        if (!this.api.chat) {
          await this.reply.text('Chat is unavailable just now. Your build is unchanged. You can still use /status, /model or /manual, or /new followed by an idea.'); return;
        }
        const version = this.chatVersion;
        const selectedId = this.state.feedbackDesignId || this.state.designId;
        this.interpreting = true;
        let answer;
        try {
          answer = await this.api.chat(command.prompt, {
            originalRequest: this.state.requestPrompt, designId: selectedId, recentMessages: this.state.chatHistory,
            hasPendingPhoto: Boolean(input.image || this.state.pendingImage || this.state.pendingRequest?.image),
            hasPendingRequest: Boolean(this.state.pendingRequest),
            hasActiveJob: Boolean(this.state.jobId && this.state.finishedJobId !== this.state.jobId),
          });
        } catch {
          await this.reply.text('I couldn’t understand that just now. Your build is unchanged. Try rephrasing, or use /status, /model, /manual or /new followed by an idea.'); return;
        } finally { this.interpreting = false; }
        // A Stop received during interpretation wins over a late AI action.
        if (version !== this.chatVersion) return;
        if (answer.intent === 'reply') {
          await this.tell(answer.text, this.state.jobId);
          this.state.chatHistory = [...this.state.chatHistory ?? [], { role: 'user' as const, text: input.prompt }, { role: 'assistant' as const, text: answer.text }].slice(-8);
          await this.persist(); return;
        }
        conversationalRevision = answer.intent === 'revision';
        conversationalNew = answer.intent === 'new';
        if (conversationalRevision && (!selectedId || selectedId !== (this.state.feedbackDesignId || this.state.designId))) {
          await this.reply.text('Let’s make sure we’re changing the right draft. Check the latest preview, then tell me what to change.'); return;
        }
        command = { kind: answer.intent === 'revision' ? 'design' : answer.intent,
          prompt: confirmsSuggestion && (answer.intent === 'new' || answer.intent === 'revision') ? `${answer.text}\nUser confirmation: ${input.prompt}` : input.prompt };
      }
      if (command.kind === 'clarify') {
        await this.tell('What should I change: the shape, color, size, or a particular detail? I’ll keep your current build until you give me a specific change.', this.state.jobId); return;
      }
      if (command.kind === 'chat') {
        await this.tell(this.state.pendingRequest ? this.qualitySelectionEnabled ? 'Your request is saved. Reply Quick or Detailed when you’re ready.' : 'Your request is saved. Say “go ahead” when you’re ready.' : 'Send an idea or a change when you’re ready. You can ask for status any time.', this.state.jobId); return;
      }
      if (command.kind === 'status') {
        if (this.exporting) {
          await this.exportMessage(`${this.exportStage(this.activeExport!)}. Your checked build is saved. /stop stops generation; requested files will keep preparing and sending.`); return;
        }
        if (this.state.approvedDesignId && this.state.feedbackDesignId === this.state.approvedDesignId && this.state.designId === this.state.approvedDesignId && !this.state.pendingRequest) {
          const sent = this.state.approvedDeliveries?.[this.state.approvedDesignId];
          const remaining = (sent?.mode === 'guide' ? ['instructions', 'model', 'parts'] as const : ['model', 'manual', 'parts'] as const).filter(kind => !sent?.[kind]);
          await this.tell(remaining.length ? `Your selected build is approved. Still to send: ${remaining.map(kind => exportLabels[kind]).join(', ')}. Send /retry to resend only the missing files.`
            : sent?.mode === 'guide' ? 'Your selected build is approved. The guide, 3D file and parts list were sent. /instructions opens your guide; /manual gets an optional PDF.'
              : `Your selected build is approved, and its 3D file, PDF instructions, and parts list were sent. Reply with a change or send /model, /manual, or /parts for another copy.`, this.state.jobId); return;
        }
        if (!this.state.jobId) await this.reply.text(this.state.pendingRequest?.prompt ? this.qualitySelectionEnabled ? 'Your request is saved and waiting for your choice: Quick or Detailed.' : 'Your request is saved. Say “go ahead” to start it.' : 'No active build yet. Send a description, or a photo with a description.');
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
          const stage = job.status === 'queued' ? `Your build is waiting its turn.${this.qualitySelectionEnabled ? ' Quick timing begins when it starts.' : ''}` : `${this.stageLabel(job)}.`;
          await this.tell(`${stage}${this.state.pendingRequest?.prompt ? this.qualitySelectionEnabled ? ' Your next request is waiting for Quick or Detailed.' : ' Your next request is saved. Say “go ahead” when you want to start it.' : ''}\nSend /stop to end generation, or /use followed by a checked attempt number.${this.link('job', job.id)}`, job.id);
          await this.poll();
        }
        return;
      }
      if (command.kind === 'instructions') {
        const id = this.state.feedbackDesignId || this.state.designId || this.state.approvedDesignId;
        if (!id) throw new PhotonInputError('Let’s get a checked build first. Send an idea, or /use followed by a checked attempt number.');
        this.beginExport('instructions');
        try {
          const design = await this.api.design(id), url = await this.instructionUrl(id);
          if (!url) throw new PhotonInputError('The phone building guide isn’t available yet. Your checked build is saved. /model gets the rotatable 3D file, /manual gets a PDF, and /parts gets the parts list.');
          this.activeExport!.phase = 'sending';
          await this.sendInstructions(design, url);
        } finally { await this.finishExport(); }
        return;
      }
      if (command.kind === 'manual' || command.kind === 'model' || command.kind === 'parts') {
        if (!this.state.designId) throw new PhotonInputError('There is no checked build selected yet. Send an idea first, or /use followed by a checked attempt number.');
        const designId = this.state.designId;
        let design: SavedDesign | undefined;
        this.beginExport(command.kind);
        try {
          await this.exportMessage(`${this.exportStage(this.activeExport!)}. Your checked build is saved.`);
          design = await this.api.design(designId);
          const bytes = await this.api.file(designId, command.kind === 'manual' ? 'manual.pdf' : command.kind === 'model' ? 'mobile.usdz' : 'parts.csv');
          this.activeExport!.phase = 'sending';
          await this.reply[command.kind](bytes);
          await this.finishExport();
          await this.tell(`Sent your ${exportLabels[command.kind]}.`).catch(() => {});
        } catch (error) {
          if (error instanceof PhotonInputError && !(error instanceof PhotonApiError)) {
            const url = design ? await this.instructionUrl(designId) : undefined;
            if (url && design) {
              await this.tell(`${error.message}\nYou can download this exact build from its guide.`);
              this.activeExport!.kind = 'instructions'; this.activeExport!.phase = 'sending';
              try { await this.sendInstructions(design, url); }
              catch { await this.tell(`Open this build’s guide to download the file:\n${url}`); }
            } else {
              const fallback = this.link('design', designId) || `\nThe viewer is local to the computer running this app. On that computer, open the website with ?design=${encodeURIComponent(designId)} at the end of its address, then choose ${command.kind === 'model' ? 'Download 3D (.usdz)' : command.kind === 'manual' ? 'the PDF download' : 'the parts CSV download'}.`;
              await this.tell(`${error.message}${fallback}`);
            }
          } else throw error;
        } finally { await this.finishExport(); }
        return;
      }
      this.changing = true;
      if (command.kind === 'approve') { await this.approve(); return; }
      if (command.kind === 'retry') { await this.approve(true); return; }
      if (command.kind === 'stop') {
        this.chatVersion++;
        const hadPending = Boolean(this.state.pendingRequest || this.state.pendingQuality);
        delete this.state.pendingRequest; delete this.state.pendingQuality; await this.persist();
        const job = await this.stopCurrent();
        await this.reply.text((job ? `Generation stopped.${hadPending ? ' Your pending request was cancelled too.' : ''} ${this.state.designId ? 'Your checked draft is kept. Send /model or /manual, or describe a change.' : 'No checked draft is available yet; saved attempt output remains in the viewer.'}${this.link('job', job.id)}` : hadPending ? 'Your pending request is cancelled. No generation was started.' : 'There is no active generation to stop.')
          + (this.exporting ? '\nYour requested files are still being prepared or sent.' : ''));
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
        this.state.designId = design.id; this.state.lastDraftId = design.id; this.state.feedbackDesignId = design.id; await this.persist();
        await this.reply.text(`Using attempt ${attempt.attempt}: ${design.title}. Generation is stopped. ${this.feedbackPrompt(design)}${this.link('design', design.id)}`);
        await this.reply.designPreview(design); return;
      }
      if (command.kind === 'open') {
        const design = await this.api.design(command.designId);
        await this.stopCurrent();
        this.state = importSavedDesign(this.state, design); this.state.feedbackDesignId = design.id; await this.persist();
        await this.reply.text(`Opened ${design.title}.${this.state.inventory?.length ? ' Its saved collection will limit future builds to your owned pieces.' : ''}\n${this.feedbackPrompt(design)}${this.link('design', design.id)}`);
        await this.reply.designPreview(design);
        return;
      }
      if (command.kind === 'quality') {
        let request: PendingPhotonRequest | undefined = command.prompt
          ? { kind: isRevisionPrompt(command.prompt) && (this.state.requestPrompt || this.state.designId) ? 'design' : 'new', prompt: command.prompt, ...(input.image ? { image: input.image } : {}) }
          : this.state.pendingRequest;
        // Older listeners saved every pending subject as a revision. Reclassify
        // clear fresh requests, retaining their own photo and true edit context.
        if (!command.prompt && request?.kind === 'design' && request.prompt !== this.state.requestPrompt && !isRevisionPrompt(request.prompt)
          && /^(?:build|make|create|generate)\s+(?!(?:it|this|that|them|these|those|(?:the\s+)?(?:same|current|previous|old|build|model|design))\b)\S/i.test(request.prompt)) {
          request = { ...request, kind: 'new' };
        }
        if (!request?.prompt) {
          if (this.state.jobId) {
            const job = await this.api.get(this.state.jobId);
            if (isActiveJob(job)) {
              await this.tell(`Your ${this.qualitySelectionEnabled ? `${job.quality === 'quick' ? 'Quick' : 'Detailed'} build` : 'build'} is already running. No second build was started. Describe a change first, or send /stop.`, job.id); return;
            }
          }
          if (!request && this.state.requestPrompt) request = { kind: 'design', prompt: this.state.requestPrompt, ...(this.state.pendingImage ? { image: this.state.pendingImage } : {}) };
          else {
            this.state.pendingQuality = this.qualitySelectionEnabled ? command.quality : 'detailed'; await this.persist();
            await this.reply.text(`${this.qualitySelectionEnabled ? `${command.quality === 'quick' ? 'Quick' : 'Detailed'} selected. ` : ''}What would you like to build${request?.image ? ' from the photo' : ''}?`); return;
          }
        }
        await this.beginRequest(request, command.quality); return;
      }
      const revision = command.kind !== 'new' && (conversationalRevision || isRevisionPrompt(command.prompt)) && Boolean(this.state.requestPrompt || this.state.designId);
      const kind = revision ? 'design' : 'new';
      const staged = this.state.pendingRequest;
      const request: PendingPhotonRequest = {
        kind, prompt: command.prompt || (input.image && staged ? staged.prompt : ''),
        ...(input.image ? { image: input.image } : (command.kind !== 'new' || conversationalNew) && staged?.image ? { image: staged.image } : {}),
      };
      this.state.pendingRequest = request;
      await this.persist();
      if (!request.prompt) {
        await this.reply.text(request.image ? 'What would you like to build from this photo? It will be inspiration, not a verified inventory.' : 'What would you like to build? Send an idea, or one photo and a description.'); return;
      }
      if (!this.qualitySelectionEnabled) await this.beginRequest(request, 'detailed');
      else if (this.state.pendingQuality) await this.beginRequest(request, this.state.pendingQuality);
      else if (revision && this.state.quality) await this.beginRequest(request, this.state.quality);
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
      ? `Attempt ${attempt.attempt} passes brick checks. Please inspect its appearance. Reply with a change or /approve for its files, or send /use ${attempt.attempt} to stop and choose it.${attempt.designId ? this.link('design', attempt.designId) : ''}`
      : `Attempt ${attempt.attempt} is unfinished. ${buildProblem(attempt.checks)}${attempt.partial ? ' This preview only shows part of the build; missing sections are not shown.' : ''} Please don’t build from it yet.${isActiveJob(job) ? ' I’m still working on it. Send /stop any time.' : ' This run has ended.'}${this.link('job', job.id)}`, job.id);
    if (!this.changing && this.state.jobId === job.id && attempt.previewAvailable) {
      const preview = await this.api.preview(job.id, attempt.attempt);
      const checked = attempt.status === 'valid' && !attempt.partial && attempt.designId ? await this.api.design(attempt.designId) : undefined;
      if (!this.changing && this.state.jobId === job.id && this.state.finishedJobId !== job.id) {
        await this.reply.preview(preview);
        if (!this.changing && this.state.jobId === job.id && this.state.finishedJobId !== job.id) {
          if (checked) { this.state.feedbackDesignId = checked.id; this.state.designId = checked.id; }
          else delete this.state.feedbackDesignId;
        }
      }
    }
    if (this.state.jobId === job.id) { this.state.lastAttempt = Math.max(this.state.lastAttempt ?? 0, attempt.attempt); this.state.lastDeliveryAt = this.now(); await this.persist(); }
  }
  async poll() {
    if (this.polling) return;
    this.polling = true;
    try {
      if (this.exporting) { await this.exportProgress(); return; }
      if (this.changing || !this.state.jobId || this.state.finishedJobId === this.state.jobId) return;
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
