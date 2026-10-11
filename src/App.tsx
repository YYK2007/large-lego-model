import { ReferenceReview } from './ReferenceReview';
import { memo, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowRight, ArrowUpRight, BookOpen, Box, Check, Cuboid, Download, ExternalLink, ImagePlus, Layers3, Leaf, LoaderCircle, MessageCircle, Plus, Settings2, ShieldCheck, Sparkles, Sprout, Trash2, Undo2, WandSparkles, X } from 'lucide-react';
import { SAMPLE_DESIGNS } from '../shared/examples';
import { PARTS, COLORS, catalogForDesign, resolveCatalog, mergeCatalogManifests, allocateInventory, billOfMaterials, buildSteps, validateDesign, normalizeDesign, type CatalogManifest, type Design, type InventoryItem } from '../shared/model';
import { subsetCatalog } from '../shared/catalog';
import { renderDesignSvg } from '../shared/illustration';
import { prepareUsdzDownload } from './usdz-download';
import { BrickScene } from './BrickScene';
import { AssemblyView } from './AssemblyView';
import { BuildRequestError, summarizeBuildChecks } from './generation-stream';
import { isActiveJob, type GenerationJob, type JobProgress, type JobAttempt } from '../shared/generation-job';
import { cancelJob, readJob, resumeJob, submitJob, stopAndReadAttempt, validJobId, JOB_STORAGE_KEY, JobRequestError } from './generation-jobs';
import { GenerationJobPanel } from './GenerationJobPanel';
import { readCollection, saveCollection } from './inventory-state';

type Status = { gemini: boolean; model: string; rebrickable: boolean; photon: boolean };
type Photo = { data: string; mimeType: string; name: string };
type Tab = 'preview' | 'steps' | 'parts';
type Modal = 'connections' | 'inventory' | 'about' | 'exports' | null;

async function api<T>(path: string, body?: unknown): Promise<T> {
  const response = await fetch(`/api${path}`, body === undefined ? undefined : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const data = await response.json();
  if (!response.ok) throw new BuildRequestError(data.error || 'Request failed. Please try again.', data.checks);
  return data;
}

function quantityInput(value: string, minimum: number, current: number): number {
  const quantity = Math.max(minimum, Math.trunc(Number(value)));
  return Number.isSafeInteger(quantity) ? quantity : current;
}

function stored<T>(key: string, fallback: T): T { try { return JSON.parse(localStorage.getItem(key) || 'null') ?? fallback; } catch { return fallback; } }
function initialJobId(): string | null {
  const params = new URLSearchParams(location.search);
  const id = params.get('job') || (!params.has('design') ? localStorage.getItem(JOB_STORAGE_KEY) : null);
  return validJobId(id) ? id : null;
}


const MiniBuild = memo(function MiniBuild({ design }: { design: Design }) {
  return <div className="mini-build" aria-hidden="true" dangerouslySetInnerHTML={{ __html: renderDesignSvg(design, { width: 180, height: 180 }) }} />;
});

function ErrorFeedback({ error }: { error: BuildRequestError }) {
  return <div className="error-feedback"><span>{error.message}</span>{error.checks.length > 0 && <>
    <p>{summarizeBuildChecks(error.checks)}</p>
    <details><summary>View check details</summary><ol>{error.checks.map((check, index) => <li key={index}>{check}</li>)}</ol></details>
  </>}</div>;
}

export function App() {
  const [design, setDesign] = useState<Design>(() => { const fallback = SAMPLE_DESIGNS.find(item => item.id === 'sample-castle')!; const saved = stored<Design>('sprout-design', fallback); return saved?.source === 'sample' ? SAMPLE_DESIGNS.find(item => item.id === saved.id) || fallback : validateDesign(saved).valid ? normalizeDesign(saved) : fallback; });
  const [initialCollection] = useState(() => readCollection(localStorage));
  const [inventory, setInventory] = useState<InventoryItem[]>(initialCollection.items);
  const [inventoryCatalog, setInventoryCatalog] = useState<CatalogManifest | undefined>(initialCollection.catalog);
  const [status, setStatus] = useState<Status | null>(null);
  const [prompt, setPrompt] = useState('');
  const [photo, setPhoto] = useState<Photo | null>(null);
  const [photoMode, setPhotoMode] = useState<'inspiration' | 'inventory'>('inspiration');
  const [inventoryMode, setInventoryMode] = useState<'unlimited' | 'owned'>('unlimited');
  const [tab, setTab] = useState<Tab>('preview');
  const [modal, setModal] = useState<Modal>(null);
  const [busy, setBusy] = useState(false);
  const [referencePhoto, setReferencePhoto] = useState<{ designId: string; image: { data: string; mimeType: string } } | null>(null);
  const [generationProgress, setGenerationProgress] = useState<JobProgress | null>(null);
  const [quality, setQuality] = useState<'detailed' | 'quick'>('detailed');
  const [jobId, setJobId] = useState<string | null>(initialJobId);
  const [job, setJob] = useState<GenerationJob | null>(null);
  const [jobConnection, setJobConnection] = useState('');
  const requestedJob = useRef(jobId);
  const suppressedResults = useRef(new Set<string>());
  const usingAttempt = useRef(false);
  const submittedPhoto = useRef<{ data: string; mimeType: string } | undefined>(undefined);
  const [elapsed, setElapsed] = useState(0);
  const [error, setErrorState] = useState<BuildRequestError | null>(null);
  const setError = (value: string | Error) => setErrorState(value ? value instanceof BuildRequestError ? value : new BuildRequestError(typeof value === 'string' ? value : value.message) : null);
  const [notice, setNotice] = useState('');
  const [refining, setRefining] = useState(false);
  const [history, setHistory] = useState<Design[]>([]);
  const [setNumber, setSetNumber] = useState('');
  const [inventoryBusy, setInventoryBusy] = useState(false);
  const [manualBusy, setManualBusy] = useState(false);
  const [modelBusy, setModelBusy] = useState(false);
  const modelExportInFlight = useRef(false);
  const [modelDownload, setModelDownload] = useState<{ url: string; title: string; size: number } | null>(null);
  const [estimates, setEstimates] = useState<InventoryItem[] | null>(null);
  const [estimateNote, setEstimateNote] = useState('');
  const [newPart, setNewPart] = useState('3001');
  const [newColor, setNewColor] = useState(4);
  const [newQuantity, setNewQuantity] = useState(10);
  const [newSource, setNewSource] = useState('Loose bricks');
  const promptRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const steps = useMemo(() => buildSteps(design), [design]);
  const { parts, colors } = useMemo(() => catalogForDesign(design), [design]);
  const collectionCatalog = useMemo(() => resolveCatalog(inventoryCatalog), [inventoryCatalog]);
  const ownedCatalog = useMemo(() => inventoryCatalog ? subsetCatalog(inventoryCatalog, inventory.map(item => item.partId), inventory.map(item => item.colorId)) : undefined, [inventoryCatalog, inventory]);
  const bom = billOfMaterials(design);
  const allocation = allocateInventory(design, inventory);
  const ownedCount = inventory.reduce((sum, item) => sum + item.quantity, 0);

  const refreshStatus = () => api<Status>('/status').then(setStatus).catch(() => setStatus(null));
  useEffect(() => { refreshStatus(); const id = new URLSearchParams(location.search).get('design'); if (id) api<Design & { inventory?: InventoryItem[]; inventoryCatalog?: CatalogManifest }>(`/designs/${encodeURIComponent(id)}`).then(value => { if (!validateDesign(value).valid) throw new Error('This saved design is invalid.'); setDesign(normalizeDesign(value)); if (value.inventory) { setInventory(value.inventory); setInventoryCatalog(mergeCatalogManifests(value.inventoryCatalog, value.catalog)); } }).catch(e => setError(e)); }, []);
  useEffect(() => { localStorage.setItem('sprout-design', JSON.stringify(design)); }, [design]);
  useEffect(() => { try { saveCollection(localStorage, { items: inventory, catalog: ownedCatalog }); } catch { setError('Your collection could not be saved in this browser. Keep this page open until you export it.'); } }, [inventory, ownedCatalog]);
  useEffect(() => {
    if (modal !== 'inventory') return;
    let active = true;
    api<{ catalog: CatalogManifest }>('/catalog').then(({ catalog }) => {
      if (active) setInventoryCatalog(previous => {
        try { return mergeCatalogManifests(catalog, previous); }
        catch (error) { setError(error as Error); return previous; }
      });
    }).catch(error => { if (active) setError(error as Error); });
    return () => { active = false; };
  }, [modal]);
  useEffect(() => {
    if (design.catalog) { try { setInventoryCatalog(mergeCatalogManifests(inventoryCatalog, design.catalog)); } catch (error) { setError(error as Error); } }
  }, [design.catalog]);
  useEffect(() => {
    if (!busy && !job) return;
    const started = job ? Date.parse(job.startedAt || job.createdAt) : Date.now();
    const update = () => setElapsed(Math.max(0, Math.floor(((job?.finishedAt ? Date.parse(job.finishedAt) : Date.now()) - started) / 1000)));
    update();
    const timer = window.setInterval(update, 1000);
    return () => window.clearInterval(timer);
  }, [busy, job?.startedAt, job?.createdAt, job?.finishedAt]);
  useEffect(() => {
    if (!jobId) return;
    let disposed = false, timer: ReturnType<typeof setTimeout>, failures = 0;
    setBusy(true);
    const poll = async () => {
      try {
        const next = await readJob(jobId);
        if (disposed || requestedJob.current !== jobId) return;
        failures = 0; setJob(next); setGenerationProgress(next.progress || null); setJobConnection('');
        if (next.status === 'succeeded' && next.resultId && !suppressedResults.current.has(jobId) && localStorage.getItem('sprout-job-applied') !== jobId) {
          const result = await api<Design>(`/designs/${encodeURIComponent(next.resultId)}`);
          if (disposed || requestedJob.current !== jobId || suppressedResults.current.has(jobId)) return;
          if (!validateDesign(result).valid) throw new Error('The saved build result is invalid. Your current design is unchanged.');
          chooseDesign(normalizeDesign(result));
          setReferencePhoto(submittedPhoto.current ? { designId: result.id, image: submittedPhoto.current } : null);
          setPrompt(''); setPhoto(null); localStorage.setItem('sprout-job-applied', jobId);
          setNotice(result.research?.comparison.status === 'needs-work' ? 'A valid brick draft is ready, with visual differences still to fix. Review the photo comparison.' : 'Your saved build is ready. Review the model and its checks before building.');
        }
        setBusy(isActiveJob(next));
        if (!isActiveJob(next)) {
          if (next.status === 'failed' && next.error) setError(new BuildRequestError(next.error.message, next.error.checks));
          refreshStatus(); return;
        }
      } catch (error) {
        if (disposed || requestedJob.current !== jobId) return;
        failures++;
        if (error instanceof JobRequestError && error.status === 404 && failures >= 3) {
          setBusy(false); setError('This request was not found on the server. Your current design is unchanged. Submit again to start a build.'); return;
        }
        setJobConnection('Connection interrupted. Reconnecting to the same build; no new generation will start.');
      }
      if (!disposed) timer = setTimeout(poll, Math.min(8000, 1500 * Math.max(1, failures)));
    };
    void poll();
    return () => { disposed = true; clearTimeout(timer); };
  }, [jobId]);
  useEffect(() => { const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') setModal(null); }; window.addEventListener('keydown', onKey); return () => window.removeEventListener('keydown', onKey); }, []);
  useEffect(() => {
    if (!modal) return;
    const previous = document.activeElement as HTMLElement | null;
    const dialog = document.querySelector<HTMLElement>('.modal')!;
    const focusable = () => [...dialog.querySelectorAll<HTMLElement>('button:not(:disabled), a[href], input:not(:disabled), select:not(:disabled), summary')];
    focusable()[0]?.focus();
    const trap = (event: KeyboardEvent) => {
      if (event.key !== 'Tab') return;
      const items = focusable();
      if (event.shiftKey && document.activeElement === items[0]) { event.preventDefault(); items.at(-1)?.focus(); }
      else if (!event.shiftKey && document.activeElement === items.at(-1)) { event.preventDefault(); items[0]?.focus(); }
    };
    dialog.addEventListener('keydown', trap);
    return () => { dialog.removeEventListener('keydown', trap); previous?.focus(); };
  }, [modal]);

  function chooseDesign(next: Design) { const url = new URL(window.location.href); url.searchParams.set('design', next.id); window.history.replaceState(null, '', url); setHistory(previous => [...previous.slice(-7), design]); setDesign(next); setTab('preview'); setRefining(false); setError(''); setNotice(''); }
  function trackJob(id: string | null) {
    requestedJob.current = id; setJobId(id);
    const url = new URL(window.location.href);
    if (id) { localStorage.setItem(JOB_STORAGE_KEY, id); url.searchParams.set('job', id); }
    else { localStorage.removeItem(JOB_STORAGE_KEY); url.searchParams.delete('job'); }
    window.history.replaceState(null, '', url);
  }
  async function stopJob() {
    if (!jobId) return;
    const id = jobId; suppressedResults.current.add(id); setJobConnection('Stopping this build…');
    try { const stopped = await cancelJob(id); if (requestedJob.current === id) { setJob(stopped); setBusy(false); setJobConnection(''); } }
    catch (error) { if (requestedJob.current === id) { setJobConnection('Stopping could not be confirmed. This build may still be running; press Stop again.'); setError(error as Error); } }
  }
  async function restartJob() {
    if (!job) return;
    const previous = job.id, id = crypto.randomUUID();
    setJob(null); setError(''); setNotice(''); setBusy(true); trackJob(id);
    try { const restarted = await resumeJob(previous, id); if (requestedJob.current === id) setJob(restarted); }
    catch (error) {
      if (error instanceof JobRequestError) { trackJob(null); setBusy(false); setError(error); }
      else setJobConnection('Reconnecting to the resumed request. No additional attempt will start automatically.');
    }
  }
  async function useAttempt(attempt: JobAttempt) {
    if (!job || requestedJob.current !== job.id || usingAttempt.current) return;
    const id = job.id;
    usingAttempt.current = true; suppressedResults.current.add(id); setError(''); setJobConnection('Stopping generation and opening this checked build…');
    try {
      const selected = await stopAndReadAttempt(id, attempt);
      if (requestedJob.current !== id) return;
      setJob(selected.job); setBusy(false); setJobConnection('');
      chooseDesign(selected.design);
      setReferencePhoto(submittedPhoto.current ? { designId: selected.design.id, image: submittedPhoto.current } : null);
      localStorage.setItem('sprout-job-applied', id);
      setNotice(`Using attempt ${attempt.attempt}. Generation is stopped; this checked build is ready to review and export.`);
    } catch (error) {
      if (requestedJob.current === id) { setJobConnection('The build could not be opened. Your current design is unchanged.'); setError(error as Error); }
    } finally { usingAttempt.current = false; }
  }
  async function upload(file?: File) {
    if (!file) return;
    setError('');
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type) || file.size > 5 * 1024 * 1024) { setError('Choose a PNG, JPEG, or WebP image under 5 MB.'); return; }
    const reader = new FileReader();
    reader.onload = () => setPhoto({ data: (reader.result as string).split(',')[1], mimeType: file.type, name: file.name });
    reader.readAsDataURL(file);
  }
  async function generate() {
    if (busy) return;
    setError(''); setNotice(''); setGenerationProgress(null);
    if (photo && photoMode === 'inventory') {
      setBusy(true);
      try { const result = await api<{ items: InventoryItem[]; note: string }>('/inventory/photo', { image: photo }); setEstimates(result.items); setEstimateNote(result.note); setModal('inventory'); }
      catch (e) { setError(e as Error); } finally { setBusy(false); }
      return;
    }
    if (!prompt.trim()) { setError('Describe what you’d like to build first.'); promptRef.current?.focus(); return; }
    setBusy(true);
    const inspiration = photo || (refining && referencePhoto?.designId === design.id ? referencePhoto.image : undefined);
    const id = crypto.randomUUID();
    submittedPhoto.current = inspiration; setJob(null); trackJob(id);
    try {
      const accepted = await submitJob(id, { prompt, image: inspiration, previous: refining ? design : undefined, inventory, inventoryCatalog: inventory.length ? ownedCatalog : undefined, inventoryMode, quality });
      if (requestedJob.current === id) setJob(accepted);
    } catch (error) {
      if (error instanceof JobRequestError) { trackJob(null); setBusy(false); setError(error); }
      else setJobConnection('The submission response was interrupted. Reconnecting to this request without submitting again.');
    }
  }
  async function exportDesign(format: string) {
    const manual = format === 'manual.pdf';
    const nativeModel = format === 'model.usdz';
    if (manual && manualBusy || nativeModel && modelExportInFlight.current) return;
    const requestedDesign = design;
    setError(''); setNotice('');
    if (manual) { setManualBusy(true); setNotice('Preparing your instruction PDF. You can keep using the studio.'); }
    if (nativeModel) { modelExportInFlight.current = true; setModelBusy(true); setNotice(`Preparing the 3D model for “${requestedDesign.title}”.`); }
    try {
      const nativeDownload = nativeModel ? await prepareUsdzDownload(requestedDesign, inventory, { inventoryCatalog: ownedCatalog }) : null;
      const snapshot = nativeDownload ? null : await api<{ id: string }>('/designs', { design: requestedDesign, inventory, inventoryCatalog: ownedCatalog });
      const url = nativeDownload?.url ?? `/api/designs/${encodeURIComponent(snapshot!.id)}/${format}`;
      const anchor = document.createElement('a');
      if (manual || nativeModel) {
        let file = nativeDownload?.file;
        if (!file) {
          const response = await fetch(url);
          if (!response.ok) {
            const detail = await response.json().catch(() => null);
            throw new Error(detail?.error || 'The manual could not be exported. Please try again.');
          }
          file = await response.blob();
        }
        const downloadUrl = URL.createObjectURL(file);
        anchor.href = downloadUrl;
        const filename = requestedDesign.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 70) || 'build';
        anchor.download = nativeDownload?.filename ?? `${filename}-instructions.pdf`;
        if (nativeModel) { setModelDownload({ url, title: requestedDesign.title, size: file.size }); setModal(current => current === 'exports' ? null : current); }
        document.body.appendChild(anchor);
        anchor.click();
        anchor.remove();
        window.setTimeout(() => URL.revokeObjectURL(downloadUrl), 60_000);
        setNotice(nativeModel ? 'Your 3D file is ready. If the download has not started, use Save USDZ file below.' : 'Instruction PDF ready. Check your browser’s downloads.');
      } else { anchor.href = url; anchor.download = ''; anchor.click(); }
    } catch (e) { setNotice(''); setError(nativeModel && e instanceof Error && e.name === 'TimeoutError' ? new Error(`The 3D download for “${requestedDesign.title}” timed out. Please try again.`) : nativeModel && e instanceof TypeError ? new Error(`The 3D download for “${requestedDesign.title}” was interrupted. Check your connection and try again.`) : e as Error); setModal(null); }
    finally { if (manual) setManualBusy(false); if (nativeModel) { modelExportInFlight.current = false; setModelBusy(false); } }
  }
  async function saveForPhone() {
    try { const snapshot = await api<{ id: string }>('/designs', { design, inventory, inventoryCatalog: inventory.length ? ownedCatalog : undefined }); await navigator.clipboard.writeText(`/open ${snapshot.id}`); setNotice('Copied the /open command. Send it to your connected Photon agent to continue this build.'); setModal(null); }
    catch (e) { setError(e as Error); }
  }
  async function lookupSet() {
    setInventoryBusy(true); setError('');
    try { const result = await api<{ items: InventoryItem[]; catalog: CatalogManifest; excluded: number; note: string }>('/inventory/set', { setNumber: setNumber.trim() }); const merged = mergeCatalogManifests(inventoryCatalog, result.catalog); setInventoryCatalog(merged); setInventory(previous => [...previous, ...result.items]); setNotice(`Added ${result.items.reduce((sum, row) => sum + row.quantity, 0)} supported bricks. ${result.excluded} spare or unsupported pieces excluded. ${result.note}`); setSetNumber(''); }
    catch (e) { setError(e as Error); } finally { setInventoryBusy(false); }
  }

  return <>
    <header className="site-header" inert={Boolean(modal)}>
      <a href="/" className="brand" aria-label="Sprout home"><span className="brand-mark"><Sprout size={23} strokeWidth={1.7} /></span><span>sprout<span className="brand-period">.</span></span></a>
      <nav aria-label="Main navigation"><button className="nav-active" onClick={() => setModal(null)}>Build studio</button><button onClick={() => setModal('about')}>How it works <ArrowUpRight size={13} /></button></nav>
      <button className="connection-button" aria-label="Connection settings" onClick={() => { refreshStatus(); setModal('connections'); }}><span className={`status-dot ${status?.gemini ? 'connected' : ''}`} /><span>{status?.gemini ? 'Gemini configured' : 'Connect your tools'}</span><Settings2 size={15} /></button>
    </header>
    <main inert={Boolean(modal)}>
      <section className="intro">
        <div><div className="eyebrow"><Leaf size={13} /> LARGE LEGO MODEL · BUILD STUDIO</div><h1>Build something new. <span>Use the bricks you own.</span></h1><p>Describe a build, review it in 3D, and get the parts and instructions.</p></div>
        <div className="intro-note"><span className="note-orb"><Box size={21} /></span><span>One brick model.<br /><strong>Matching parts and instructions.</strong></span></div>
      </section>
      {(error || notice) && <div className={`message-banner ${error ? 'error' : 'success'}`} role={error ? 'alert' : 'status'}>{error ? <ErrorFeedback error={error} /> : <span>{notice}</span>}<button aria-label="Dismiss message" onClick={() => { setError(''); setNotice(''); }}><X size={16} /></button></div>}
      {modelDownload && <div className="model-file"><span><strong>{modelDownload.title}</strong> · USDZ · {(modelDownload.size / 1024 / 1024).toFixed(1)} MB<small>If nothing saves, open this page in Safari or Chrome.</small></span><a href={modelDownload.url} target="_blank" rel="noopener"><Download size={15} /> Save USDZ file</a><button aria-label="Dismiss 3D download link" onClick={() => setModelDownload(null)}><X size={16} /></button></div>}
      <section className="workspace">
        <aside className="sidebar">
          <section className="prompt-card panel">
            <div className="card-heading"><span className="section-icon"><Sparkles size={17} /></span><h2>{refining ? 'Revise this design' : 'Describe your build'}</h2><span className="small-label">01</span></div>
            {refining && <div className="revision-label">Refining {design.title}<button onClick={() => setRefining(false)} aria-label="Cancel refinement"><X size={12} /></button></div>}
            <textarea ref={promptRef} aria-label="Describe your build" placeholder={refining ? 'Make the petals yellow and the stem a little shorter…' : 'A coastal observatory with a hollow workshop, windows, a tower, a balcony, and layered roofs…'} value={prompt} onChange={e => setPrompt(e.target.value)} maxLength={4000} disabled={busy} />
            {photo && <div className="photo-chip"><img src={`data:${photo.mimeType};base64,${photo.data}`} alt="Uploaded inspiration" /><div><strong>{photo.name}</strong><select aria-label="How to use this photo" value={photoMode} onChange={e => setPhotoMode(e.target.value as typeof photoMode)}><option value="inspiration">Use as inspiration</option><option value="inventory">Identify my loose bricks</option></select></div><button aria-label="Remove photo" onClick={() => setPhoto(null)}><X size={15} /></button></div>}
            <div className="prompt-tools"><button className="text-button" onClick={() => fileRef.current?.click()} disabled={busy}><ImagePlus size={16} /> Add a photo</button><span>PNG, JPG, or WebP</span><input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp" hidden onChange={e => { upload(e.target.files?.[0]); e.target.value = ''; }} /></div>
            <div className="prompt-divider" />
            <span className="field-label">YOUR BUILDING BLOCKS</span>
            <div className="segmented"><button aria-pressed={inventoryMode === 'unlimited'} className={inventoryMode === 'unlimited' ? 'selected' : ''} onClick={() => setInventoryMode('unlimited')}><Cuboid size={14} /> Any bricks</button><button aria-pressed={inventoryMode === 'owned'} className={inventoryMode === 'owned' ? 'selected' : ''} onClick={() => { setInventoryMode('owned'); if (!inventory.length) setModal('inventory'); }}><Box size={14} /> Only my bricks</button></div>
            <label className="generation-quality">Build detail<select aria-label="Build detail" value={quality} disabled={busy} onChange={event => setQuality(event.target.value as typeof quality)}><option value="detailed">Detailed · 5 min per attempt</option><option value="quick">Quick · about 2.5 min per attempt</option></select></label>
            <p className="prompt-footnote">Both modes can use curved and specialty pieces.</p>
            <button className="primary-button generate-button" onClick={generate} disabled={busy}>{busy ? <LoaderCircle className="spin" size={17} /> : <WandSparkles size={17} />}{busy ? generationProgress?.stage === 'researching' ? 'Finding reference photos…' : generationProgress?.stage === 'comparing' ? 'Comparing with the photos…' : generationProgress?.stage === 'checking' ? 'Checking brick connections…' : (generationProgress?.attempt || 0) > 1 || generationProgress?.stage === 'repairing' ? 'Repairing the design…' : 'Planning your build…' : photo && photoMode === 'inventory' ? 'Review the bricks in my photo' : refining ? 'Refine my build' : 'Generate design'}{!busy && <ArrowRight size={17} />}</button>
            <p className="prompt-footnote" role={busy ? 'status' : undefined}>{busy ? `${photo && photoMode === 'inventory' ? 'Reading the photo' : job?.continuous ? 'Attempt ' + (generationProgress?.attempt || 1) + ' · continuing until stopped' : (generationProgress?.attempt || 0) > 1 ? 'Repair ' + generationProgress?.attempt + ' of ' + generationProgress?.maxAttempts : generationProgress?.stage === 'researching' ? 'Identifying the subject and references' : generationProgress?.stage === 'comparing' ? 'Checking likeness' : 'Planning and checking'} · ${elapsed}s elapsed` : status?.gemini ? 'Powered by Gemini · checked by Large Lego Model' : 'Explore samples now. Connect Gemini for your own ideas.'}</p>
            {job && <GenerationJobPanel job={job} elapsed={elapsed} connection={jobConnection} onCancel={stopJob} onResume={restartJob} onUse={useAttempt} onDismiss={() => { trackJob(null); setJob(null); setJobConnection(''); }} />}
            {!job && jobConnection && <p className="prompt-footnote" role="status">{jobConnection}</p>}
          </section>
          <section className="collection-card panel"><div className="collection-icon"><Box size={21} /></div><div><h3>Your brick collection</h3><p>{ownedCount ? `${ownedCount} bricks, ready for something new` : 'Add loose bricks or import an existing set.'}</p></div><button aria-label="Manage your brick collection" onClick={() => setModal('inventory')}><Plus size={18} /></button></section>
          <section className="inspiration-card"><div className="inspiration-heading"><h3>Sample builds</h3><span>CURATED SAMPLES</span></div><div className="sample-grid">{SAMPLE_DESIGNS.map((example, i) => <button key={example.id} className={`sample-button ${design.id === example.id ? 'chosen' : ''}`} onClick={() => chooseDesign(example)} disabled={busy}><MiniBuild design={example} /><span>{['Bloom', 'Orbit', 'Grove', 'Puddle', 'Meadow', 'Castle'][i]}</span></button>)}</div></section>
        </aside>
        <section className="build-panel panel">
          <div className="build-toolbar"><div className="view-tabs" role="tablist" aria-label="Design views">{([['preview', Cuboid, '3D preview'], ['steps', Layers3, 'Build steps'], ['parts', Box, 'Pieces']] as const).map(([value, Icon, label]) => <button key={value} role="tab" aria-selected={tab === value} className={tab === value ? 'selected' : ''} onClick={() => setTab(value)}><Icon size={16} />{label}</button>)}</div><button className="icon-button" title="Undo design change" aria-label="Undo design change" disabled={!history.length || busy} onClick={() => { const previous = history[history.length - 1]; setHistory(history.slice(0, -1)); setDesign(previous); }}><Undo2 size={16} /></button></div>
          {tab === 'parts' ? <div className="parts-view"><div className="parts-heading"><div className="eyebrow">PARTS AND INVENTORY</div><h2>Parts for this design.</h2><p>{design.bricks.length} bricks. {bom.length} part and color combinations.</p></div><div className="parts-table-wrap"><table><thead><tr><th>Brick</th><th>Color</th><th>Need</th><th>Have</th><th>Missing</th></tr></thead><tbody>{allocation.items.map(item => <tr key={`${item.partId}:${item.colorId}`}><td><strong>{parts[item.partId].name}</strong><small><a href={"https://rebrickable.com/parts/" + encodeURIComponent(item.partId) + "/?color=" + item.colorId} target="_blank" rel="noreferrer">#{item.partId} · Part reference</a></small>{item.sources.length > 0 && <small className="source-detail">{item.sources.map(source => `${source.quantity} from ${source.source}`).join(' · ')}</small>}</td><td><span className="color-swatch" style={{ background: colors[item.colorId].hex }} />{colors[item.colorId].name}</td><td>{item.quantity}</td><td>{item.owned}</td><td><span className={item.missing ? 'missing-count' : 'complete-count'}>{item.missing || <Check size={15} />}</span></td></tr>)}</tbody></table></div><div className="parts-summary"><span>{inventory.length ? allocation.totalMissing ? `${allocation.totalMissing} more bricks needed for this design.` : 'All pieces are in your confirmed collection.' : 'Add your collection to see what you already have.'}</span><button className="text-button" onClick={() => setModal('inventory')}>Edit collection <ArrowUpRight size={14} /></button></div></div> : <>
            <div className="model-heading"><div><span className="design-kind">{design.source === 'sample' ? 'CURATED SAMPLE' : 'YOUR GEMINI DESIGN'}</span><h2>{design.title}<span className="title-dot">.</span></h2></div><span className="geometry-badge" title="Checked for overlaps, unsupported upper bricks, and disconnected pieces. Physical stability is unverified."><ShieldCheck size={14} /> Geometry checked</span></div>
            {tab === 'steps' ? <AssemblyView key={design.id} design={design} steps={steps} downloadManual={() => exportDesign('manual.pdf')} /> : <BrickScene design={design} />}{tab === 'preview' && design.research && <ReferenceReview research={design.research} sessionPhoto={referencePhoto?.designId === design.id ? referencePhoto.image : undefined} />}
          </>}
          <div className="build-footer"><div className="build-stats"><span><Box size={15} /><strong>{design.bricks.length}</strong> pieces</span><span><Layers3 size={15} /><strong>{steps.length}</strong> steps</span><span><span className="palette-dots">{[...new Set(design.bricks.map(b => b.colorId))].slice(0, 5).map(color => <i key={color} style={{ background: colors[color].hex }} />)}</span>{new Set(design.bricks.map(b => b.colorId)).size} colors</span></div><div className="build-actions"><button className="refine-button" onClick={() => { setRefining(true); promptRef.current?.focus(); }} disabled={busy}><Sparkles size={15} /> Refine</button><button className="refine-button model-download" onClick={() => exportDesign('model.usdz')} disabled={modelBusy || busy} aria-busy={modelBusy}>{modelBusy ? <LoaderCircle className="spin" size={15} /> : <Download size={15} />}{modelBusy ? 'Preparing 3D model…' : 'Download 3D (.usdz)'}</button><button className="dark-button" onClick={() => setModal('exports')}><BookOpen size={16} /> Let’s build <ArrowRight size={15} /></button></div></div>
          <div className="validation-note"><ShieldCheck size={12} /> Real part IDs. Checked connections. Physical strength and tipping still need a hands-on test.</div>
        </section>
      </section>
      <footer className="page-footer"><span><Sprout size={13} /> DESIGN · REVIEW · BUILD</span><span>Large Lego Model <i>·</i> HackNC 2026 <i>·</i> Independent project, not affiliated with LEGO.</span><a href="https://github.com/YYK2007/sprout-hacknc2026" target="_blank" rel="noreferrer">Follow the build <ArrowUpRight size={13} /></a></footer>
    </main>
    {modal && <div className="modal-backdrop" onClick={e => { if (e.target === e.currentTarget) setModal(null); }}><section className={`modal ${modal === 'inventory' ? 'inventory-modal' : ''}`} role="dialog" aria-modal="true" aria-labelledby="modal-title"><button className="modal-close" aria-label="Close dialog" onClick={() => setModal(null)}><X size={20} /></button>
      {modal === 'connections' && <><div className="modal-icon"><Settings2 /></div><h2 id="modal-title">Connect your tools.</h2><p className="modal-intro">Keys stay on your server. Add them to the project’s <code>.env</code> file, then refresh the connection status.</p><div className="connection-list">{[{ name: 'Gemini', detail: 'Ideas, images, and design revisions', key: 'GEMINI_API_KEY', ready: status?.gemini, link: 'https://aistudio.google.com/apikey' }, { name: 'Rebrickable', detail: 'Import the bricks in your existing sets', key: 'REBRICKABLE_API_KEY', ready: status?.rebrickable, link: 'https://rebrickable.com/api/' }, { name: 'Photon · Spectrum', detail: 'Continue the conversation in iMessage', key: 'SPECTRUM_PROJECT_ID + SPECTRUM_PROJECT_SECRET', ready: status?.photon, link: 'https://app.photon.codes/dashboard' }].map(tool => <div className="connection-row" key={tool.name}><div><strong>{tool.name} <span className={tool.ready ? 'ready-label' : 'pending-label'}>{tool.ready ? 'Configured' : 'Not configured'}</span></strong><p>{tool.detail}</p><code>{tool.key}</code></div><a href={tool.link} target="_blank" rel="noreferrer" aria-label={`Open ${tool.name} setup`}><ExternalLink size={17} /></a></div>)}</div><p className="subtle-note">Photon HackNC promo: <strong>HACKWITHPHOTON</strong>. Run the separate Photon worker after setup. Configured does not mean a live iMessage connection has been tested.</p><button className="primary-button" onClick={refreshStatus}><RotateIcon /> Refresh connections</button></>}
      {modal === 'about' && <><div className="modal-icon"><Sprout /></div><h2 id="modal-title">How Large Lego Model works.</h2><p className="modal-intro">Large Lego Model keeps every view of your creation connected to the same real pieces.</p><ol className="how-steps"><li><span>01</span><div><h3>Imagine something</h3><p>Describe an idea or share an inspiration photo. Gemini turns it into a structured plan for real pieces.</p></div></li><li><span>02</span><div><h3>Make it buildable in the model</h3><p>A deterministic compiler chooses catalog bricks. Overlaps, support, connections, and your confirmed inventory are checked before a design appears.</p></div></li><li><span>03</span><div><h3>Make it yours</h3><p>Rotate the actual bricks, ask for changes, and download matching instructions and a precise parts list.</p></div></li></ol><div className="info-box">This version uses {Object.keys(PARTS).length} real part types in {Object.keys(COLORS).length} colors: standard bricks, plates, tiles, upright slopes, round columns, round plates, and small cones. Hinges, wheels, minifigures, and physical load simulation remain outside its current scope. Photo inventory always needs your review.</div></>}
      {modal === 'exports' && <><div className="modal-icon"><BookOpen /></div><h2 id="modal-title">Download this build.</h2><p className="modal-intro">Everything for <strong>{design.title}</strong>, made from the same {design.bricks.length} bricks you see in the preview.</p>{inventory.length > 0 && <div className="info-box">{allocation.totalMissing ? `${allocation.totalMissing} bricks are missing from your collection. Review Pieces before starting.` : 'Your confirmed collection covers every brick in this design.'}</div>}<div className="export-grid"><button onClick={() => exportDesign('manual.pdf')} disabled={manualBusy} aria-busy={manualBusy}>{manualBusy ? <LoaderCircle className="spin" /> : <BookOpen />}<div><strong>{manualBusy ? 'Preparing the manual…' : 'Build manual'}</strong><span>{manualBusy ? 'You can close this and keep using the studio.' : 'Illustrated PDF · exact placement maps'}</span></div>{!manualBusy && <Download size={17} />}</button><button onClick={() => exportDesign('parts.csv')}><Box /><div><strong>Parts & collection list</strong><span>CSV · quantities, colors, source sets</span></div><Download size={17} /></button><button onClick={() => exportDesign('model.usdz')} disabled={modelBusy || busy} aria-busy={modelBusy}>{modelBusy ? <LoaderCircle className="spin" /> : <Cuboid />}<div><strong>{modelBusy ? 'Preparing 3D model…' : 'Native 3D model'}</strong><span>USDZ · for Apple Quick Look</span></div>{!modelBusy && <Download size={17} />}</button><button onClick={() => exportDesign('model.ldr')}><Cuboid /><div><strong>LDraw model</strong><span>Editable brick placements · .ldr</span></div><Download size={17} /></button><button onClick={() => exportDesign('preview.png')}><ImagePlus /><div><strong>Design preview</strong><span>Shareable image · PNG</span></div><Download size={17} /></button></div><button className="primary-button" onClick={() => { setTab('steps'); setModal(null); }}>Follow the steps here <ArrowRight size={17} /></button><button className="phone-link text-button" onClick={saveForPhone}><MessageCircle size={15} /> Copy command to continue in iMessage</button><p className="subtle-note">Check the physical build as you go. Geometry checks don’t verify clutch strength or tipping.</p></>}
      {modal === 'inventory' && <><div className="modal-icon"><Box /></div><h2 id="modal-title">Manage your brick collection.</h2><p className="modal-intro">Add loose bricks or look up a set you own. Exact part, color, and count keep your build honest.</p>
        {estimates && <div className="estimate-panel"><strong>Review the photo estimate</strong><p>{estimateNote}</p>{estimates.map((item, index) => <div className="estimate-row" key={index}><span>{collectionCatalog.parts[item.partId].name} · {collectionCatalog.colors[item.colorId].name}</span><input aria-label={`Estimated quantity ${index + 1}`} type="number" min={0} value={item.quantity} onChange={e => setEstimates(previous => previous!.map((row, i) => i === index ? { ...row, quantity: quantityInput(e.target.value, 0, row.quantity) } : row))} /><button aria-label={`Remove estimated brick ${index + 1}`} onClick={() => setEstimates(previous => previous!.filter((_, i) => i !== index))}><X size={14} /></button></div>)}<button className="primary-button" onClick={() => { setInventory(previous => [...previous, ...estimates.filter(row => row.quantity > 0)]); setEstimates(null); setPhoto(null); setNotice('Photo estimates added after your confirmation.'); }}>Confirm these quantities <Check size={16} /></button><button className="text-button" onClick={() => setEstimates(null)}>Discard estimate</button></div>}
        <div className="inventory-import"><label className="field-label" htmlFor="set-number">IMPORT AN EXISTING SET</label><div><input id="set-number" placeholder="Set number, e.g. 10696-1" value={setNumber} onChange={e => setSetNumber(e.target.value)} /><button className="dark-button" disabled={!setNumber || inventoryBusy} onClick={lookupSet}>{inventoryBusy ? <LoaderCircle className="spin" size={16} /> : <Plus size={16} />} Add set</button></div><small>Imports the supported catalog parts and colors. Spare and unsupported parts are excluded.</small></div>
        <label className="field-label">ADD LOOSE BRICKS</label><div className="inventory-form"><label>Part<select aria-label="Brick part" value={newPart} onChange={e => { setNewPart(e.target.value); if (!collectionCatalog.parts[e.target.value].allowedColors.includes(newColor)) setNewColor(collectionCatalog.parts[e.target.value].allowedColors[0]); }}>{Object.values(collectionCatalog.parts).map(part => <option key={part.id} value={part.id}>{part.name} · {part.id}</option>)}</select></label><label>Color<select aria-label="Brick color" value={newColor} onChange={e => setNewColor(Number(e.target.value))}>{Object.values(collectionCatalog.colors).filter(color => collectionCatalog.parts[newPart].allowedColors.includes(color.id)).map(color => <option key={color.id} value={color.id}>{color.name}</option>)}</select></label><label>Count<input aria-label="Brick quantity" type="number" min={1} value={newQuantity} onChange={e => setNewQuantity(quantityInput(e.target.value, 1, newQuantity))} /></label></div><div className="inventory-source"><input aria-label="Brick source" placeholder="Source, e.g. my red tub" value={newSource} maxLength={120} onChange={e => setNewSource(e.target.value)} /><button className="dark-button" onClick={() => setInventory(previous => [...previous, { partId: newPart, colorId: newColor, quantity: newQuantity, source: newSource.trim() || 'Loose bricks' }])}><Plus size={15} /> Add bricks</button></div>
        <div className="inventory-list-heading"><strong>{ownedCount} bricks in your collection</strong><span>{inventory.length} entries</span></div><div className="inventory-list">{inventory.length ? inventory.map((item, index) => <div className="inventory-row" key={index}><span className="color-swatch" style={{ background: collectionCatalog.colors[item.colorId]?.hex }} /><div><strong>{collectionCatalog.parts[item.partId]?.name || `Part ${item.partId} (metadata missing)`} · {collectionCatalog.colors[item.colorId]?.name}</strong><small>{item.source}</small></div><input aria-label={`Quantity for collection entry ${index + 1}`} type="number" min={0} value={item.quantity} onChange={e => setInventory(previous => previous.map((row, i) => i === index ? { ...row, quantity: quantityInput(e.target.value, 0, row.quantity) } : row))} /><button aria-label={`Remove collection entry ${index + 1}`} onClick={() => setInventory(previous => previous.filter((_, i) => i !== index))}><Trash2 size={15} /></button></div>) : <div className="empty-inventory"><Box size={25} /><p>No bricks added yet.</p></div>}</div><button className="primary-button" onClick={() => setModal(null)}>Save collection <Check size={16} /></button>
      </>}
      {(error || notice) && <div className={`modal-message ${error ? 'error' : ''}`} role={error ? 'alert' : 'status'}>{error ? <ErrorFeedback error={error} /> : notice}</div>}
    </section></div>}
  </>;
}

function RotateIcon() { return <Settings2 size={16} />; }
