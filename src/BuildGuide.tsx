import { useEffect, useMemo, useRef, useState } from 'react';
import { Box, Check, ChevronLeft, ChevronRight, Download, Layers3, LoaderCircle, RotateCcw, X } from 'lucide-react';
import { allocateInventory, billOfMaterials, catalogForDesign, normalizeDesign, type BuildStep, type Design, type InventoryItem } from '../shared/model';
import { renderDesignSvg } from '../shared/illustration';
import { placementInstruction } from '../shared/assembly';
import { BrickScene } from './BrickScene';
import { moveBuildProgress, readBuildProgress, type BuildProgress } from './build-progress';
import './build-guide.css';

type GuideDesign = Design & { inventory?: InventoryItem[]; allocation?: ReturnType<typeof allocateInventory> };
type Repeat = { kind: 'single' | 'stack' | 'placements'; first: number; last: number };
const arIcon = 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24"%3E%3Cpath fill="none" stroke="%23264862" stroke-width="2" d="M4 8V4h4m8 0h4v4m0 8v4h-4M8 20H4v-4M8 9l4-2 4 2v6l-4 2-4-2z"/%3E%3C/svg%3E';

export function BuildGuide({ designId }: { designId: string }) {
  const [design, setDesign] = useState<GuideDesign | null>(null);
  const [steps, setSteps] = useState<BuildStep[]>([]);
  const [groups, setGroups] = useState<Repeat[]>([]);
  const [progress, setProgress] = useState<BuildProgress>({ step: 0, piece: 0, completed: false });
  const [building, setBuilding] = useState(false);
  const [overview, setOverview] = useState(false);
  const drawerTrigger = useRef<HTMLButtonElement | null>(null);
  const drawerRef = useRef<HTMLDialogElement>(null);
  const pdfAbort = useRef<AbortController | null>(null);
  const [drawer, setDrawer] = useState<'parts' | 'files' | null>(null);
  const [error, setError] = useState('');
  const [storageNotice, setStorageNotice] = useState('');
  const [replay, setReplay] = useState(0);
  const [ar, setAr] = useState(false);
  const [pdf, setPdf] = useState<{ busy?: boolean; url?: string; error?: string }>({});
  const key = `large-lego-guide:v1:${designId}`;
  const share = new URLSearchParams(location.search).get('share');
  const endpoint = (format = '') => `/api/designs/${encodeURIComponent(designId)}${format ? `/${format}` : ''}${share ? `?share=${encodeURIComponent(share)}` : ''}`;

  useEffect(() => {
    document.body.classList.add('build-guide-body');
    const anchor = document.createElement('a');
    try { setAr(anchor.relList.supports('ar')); } catch { /* Other browsers keep the download action. */ }
    return () => { document.body.classList.remove('build-guide-body'); };
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    let worker: Worker | undefined;
    fetch(endpoint(), { signal: controller.signal }).then(async response => {
      if (!response.ok) throw new Error('This build link could not be opened. Ask for /instructions in your Messages chat for a fresh link.');
      const value = normalizeDesign(await response.json()) as GuideDesign;
      if (controller.signal.aborted) return;
      setDesign(value);
      document.title = `${value.title} · Build guide`;
      worker = new Worker(new URL('./assembly-worker.ts', import.meta.url), { type: 'module' });
      worker.onmessage = event => {
        if (event.data.error) { setError(event.data.error); return; }
        const next = event.data.steps as BuildStep[];
        setSteps(next); setGroups(event.data.groups);
        try { setProgress(readBuildProgress(localStorage.getItem(key), next)); }
        catch { setStorageNotice('Progress will stay here while this guide is open.'); }
        worker?.terminate();
      };
      worker.onerror = () => setError('The building steps could not be prepared. Reopen this guide or download the PDF.');
      worker.postMessage(value);
    }).catch(cause => { if (!controller.signal.aborted) setError(cause.message); });
    return () => { controller.abort(); worker?.terminate(); };
  }, [designId]);
  useEffect(() => {
    if (!steps.length) return;
    try { localStorage.setItem(key, JSON.stringify(progress)); }
    catch { setStorageNotice('Progress will stay here while this guide is open.'); }
  }, [progress, key, steps.length]);
  useEffect(() => {
    if (drawer) {
      const dialog = drawerRef.current;
      dialog?.showModal();
      dialog?.querySelector('button')?.focus();
      return () => { dialog?.close(); drawerTrigger.current?.focus(); };
    }
  }, [drawer]);
  useEffect(() => () => pdfAbort.current?.abort(), []);

  const current = steps[progress.step];
  const active = current?.bricks[progress.piece];
  const placement = current?.placements[progress.piece];
  const catalog = useMemo(() => design ? catalogForDesign(design) : null, [design]);
  const bom = useMemo(() => design ? billOfMaterials(design) : [], [design]);
  const allocation = useMemo(() => design?.allocation ?? (design?.inventory ? allocateInventory(design, design.inventory) : null), [design]);
  const shown = building && !overview && !progress.completed;
  const visibleIds = useMemo(() => shown && current ? [...steps.slice(0, progress.step).flatMap(step => step.bricks), ...current.bricks.slice(0, progress.piece + 1)].map(brick => brick.id) : undefined, [shown, steps, current, progress]);
  const focusIds = useMemo(() => shown && active ? active.z === 0 ? visibleIds : [active.id, ...(placement?.attachedTo ?? [])] : undefined, [shown, active, placement, visibleIds]);
  const tray = useMemo(() => design && current ? billOfMaterials({ ...design, bricks: current.bricks }).map(row => {
    const first = current.bricks.findIndex(brick => brick.partId === row.partId && brick.colorId === row.colorId);
    return { ...row, first, svg: renderDesignSvg({ ...design, bricks: [{ ...current.bricks[first], x: 0, y: 0, z: 0, rotation: 0 }] }, { width: 100, height: 66 }) };
  }) : [], [design, current]);
  const repeat = groups.find(group => progress.step >= group.first && progress.step <= group.last && group.kind !== 'single');
  const placed = steps.slice(0, progress.step).reduce((count, step) => count + step.bricks.length, 0) + progress.piece;
  const last = progress.step === steps.length - 1 && progress.piece === current?.bricks.length - 1;
  const advance = (direction: -1 | 1) => { setOverview(false); setProgress(value => moveBuildProgress(value, steps, direction)); };
  const downloadPdf = async () => {
    if (pdf.busy || pdf.url) return;
    const controller = new AbortController();
    pdfAbort.current = controller;
    const timeout = setTimeout(() => controller.abort(new Error('PDF preparation took too long. Please try /manual in Messages.')), 600_000);
    setPdf({ busy: true });
    try {
      const response = await fetch(endpoint('manual.pdf'), { method: 'HEAD', signal: controller.signal });
      if (!response.ok || !response.headers.get('content-type')?.includes('application/pdf')) throw new Error('The PDF couldn’t be prepared. Try again, or send /manual in Messages.');
      if (!controller.signal.aborted) setPdf({ url: endpoint('manual.pdf') });
    } catch (cause) { if (!controller.signal.aborted || controller.signal.reason instanceof Error && controller.signal.reason.name !== 'AbortError') setPdf({ error: cause instanceof Error ? cause.message : 'The PDF couldn’t be prepared.' }); }
    finally { clearTimeout(timeout); }
  };

  return <main className="build-guide">
    <header className="guide-header"><div className="guide-mark" aria-hidden="true"><span /><span /><Box size={22} /></div><div><span>LARGE LEGO MODEL</span><h1>{design?.title || 'Your build guide'}</h1></div><button aria-label="Downloads" onClick={event => { drawerTrigger.current = event.currentTarget; setDrawer('files'); }}><Download size={20} /></button></header>
    {error && <div className="guide-alert" role="alert">{error}<button aria-label="Dismiss message" onClick={() => setError('')}><X size={16} /></button></div>}
    <section className="guide-stage" aria-label="3D building workspace">
      {design ? <BrickScene opaqueContext omitCoveredStuds design={design} visibleIds={visibleIds} highlightIds={shown && active ? [active.id] : undefined} activeId={shown ? active?.id : undefined} placement={shown ? placement : undefined} replayKey={replay} focusIds={focusIds} /> : <div className="guide-loading"><LoaderCircle className="spin" size={30} /><p>Opening your saved build…</p></div>}
      {design && <div className="guide-stage-top"><span className="guide-pill">{shown ? `Piece ${progress.piece + 1} of ${current.bricks.length}` : `${design.bricks.length.toLocaleString()} pieces`}</span>{building && !progress.completed && <button className="guide-pill" onClick={() => setOverview(value => !value)}><Box size={15} />{overview ? 'Back to this piece' : 'See finished model'}</button>}</div>}
      {!building && design && <div className="guide-welcome"><span className="guide-eyebrow">A LITTLE AT A TIME.</span><h2>Let’s put it together.</h2><p>Turn it around. Then we’ll find your first pieces.</p></div>}
      {progress.completed && building && <div className="guide-complete"><Check size={28} /><h2>All steps complete.</h2><p>Nice building. Take it for a spin.</p><button onClick={() => { setProgress({ step: 0, piece: 0, completed: false }); setBuilding(false); }}>Start again</button></div>}
    </section>
    <section className="guide-tray" aria-label={building ? 'Pieces for this step' : 'Build information'}>
      {building && current && !progress.completed ? <><div className="guide-tray-heading"><strong>Gather for step {current.index}</strong><span>{current.bricks.length} pieces</span></div><div className="guide-pieces">{tray.map(row => <button className={active?.partId === row.partId && active.colorId === row.colorId ? 'selected' : ''} key={`${row.partId}:${row.colorId}`} aria-label={`${row.quantity} ${catalog!.colors[row.colorId].name} ${catalog!.parts[row.partId].name}`} onClick={() => { setOverview(false); setProgress({ ...progress, piece: row.first }); }}><span aria-hidden="true" dangerouslySetInnerHTML={{ __html: row.svg }} /><b>×{row.quantity}</b><small>{catalog!.colors[row.colorId].name}</small></button>)}</div></> : <div className="guide-about"><Layers3 size={25} /><div><strong>{steps.length ? `${steps.length} checked building steps` : 'Preparing the building steps…'}</strong><p>{progress.completed ? 'Your finished model and its complete parts list.' : 'Rotate freely. Zoom right in. Pick up where you left off.'}</p></div><button onClick={event => { drawerTrigger.current = event.currentTarget; setDrawer('parts'); }}>Parts list</button></div>}
    </section>
    <footer className="guide-footer">
      {building && current && !progress.completed ? <><div className="guide-step-heading"><strong>Step {current.index} <span>/ {steps.length}</span></strong><button onClick={() => setReplay(value => value + 1)}><RotateCcw size={15} />Replay</button><button onClick={event => { drawerTrigger.current = event.currentTarget; setDrawer('parts'); }}>All pieces</button></div><p className="guide-action">{active?.z === 0 ? 'Arrange the pieces on a flat surface as shown. Later layers connect them.' : placement && placement.approach !== 'above' ? placementInstruction(placement) : 'Add the outlined piece where it settles.'}{repeat && <span>{repeat.kind === 'stack' ? ' Repeat upward' : ' Same pattern'} ×{repeat.last - repeat.first + 1} · {progress.step - repeat.first + 1} of {repeat.last - repeat.first + 1}</span>}</p><div className="guide-navigation"><button aria-label="Previous placement" disabled={!progress.step && !progress.piece} onClick={() => advance(-1)}><ChevronLeft />Back</button><input aria-label="Jump to build step" aria-valuetext={`Step ${current.index} of ${steps.length}`} type="range" min={0} max={steps.length - 1} value={progress.step} onChange={event => { setOverview(false); setProgress({ step: Number(event.target.value), piece: 0, completed: false }); }} /><button className="guide-primary" onClick={() => advance(1)}>{last ? 'Finish' : 'Placed it'}<ChevronRight /></button></div><div className="guide-saving">{storageNotice || `Piece ${placed + 1} of ${design!.bricks.length} · your place is saved on this device`}</div></> : <><div className="guide-launch"><button className="guide-primary" disabled={!steps.length || progress.completed && building} onClick={() => setBuilding(true)}>{!steps.length ? <><LoaderCircle className="spin" size={18} />Preparing steps</> : progress.completed ? 'See completed build' : progress.step || progress.piece ? `Resume step ${progress.step + 1}` : 'Start building'}<ChevronRight size={20} /></button><a className="guide-ar" rel={ar ? 'ar' : 'noopener'} target={ar ? undefined : '_blank'} href={endpoint('mobile.usdz')}><img src={arIcon} alt="" />{ar ? 'View in your room' : 'Download 3D'}</a></div><p className="guide-saving">{storageNotice || 'Build at your pace. This guide saves your place.'}</p></>}
    </footer>
    {drawer && <dialog ref={drawerRef} className="guide-scrim" aria-label={drawer === 'parts' ? 'Complete parts list' : 'Build downloads'} onKeyDown={event => {
      if (event.key !== 'Tab') return;
      const items = event.currentTarget.querySelectorAll<HTMLElement>('button:not(:disabled), a[href]');
      const target = event.shiftKey ? items[items.length - 1] : items[0];
      if (document.activeElement === (event.shiftKey ? items[0] : items[items.length - 1])) { event.preventDefault(); target?.focus(); }
    }} onCancel={() => setDrawer(null)} onClick={event => { if (event.target === event.currentTarget) setDrawer(null); }}><section className="guide-drawer" onClick={event => event.stopPropagation()}><div className="guide-drawer-header"><h2>{drawer === 'parts' ? 'Every piece you’ll need' : 'Keep a copy'}</h2><button autoFocus aria-label="Close panel" onClick={() => setDrawer(null)}><X /></button></div>{drawer === 'parts' ? <><p>{design?.bricks.length.toLocaleString()} pieces · {bom.length} part/color combinations</p><a href={endpoint('parts.csv')} target="_blank" rel="noopener">Download exact parts list (CSV)</a><div className="guide-parts-list">{bom.map(row => { const stock = allocation?.items.find(item => item.partId === row.partId && item.colorId === row.colorId); return <article key={`${row.partId}:${row.colorId}`}><i style={{ background: catalog!.colors[row.colorId].hex }} /><div><strong>{catalog!.parts[row.partId].name}</strong><span>{catalog!.colors[row.colorId].name} · #{row.partId}</span>{stock && <small>{stock.owned} owned · {stock.missing} needed{stock.sources.map(source => ` · ${source.quantity} from ${source.source}`).join('')}</small>}<a href={`https://rebrickable.com/parts/${encodeURIComponent(row.partId)}/?color=${encodeURIComponent(row.colorId)}`} target="_blank" rel="noreferrer">Part catalog</a></div><b>×{row.quantity}</b></article>; })}</div><small>Catalog links don’t confirm current stock or price.</small></> : <><p>The interactive guide stays here. These files are optional.</p><a className="guide-download-row" rel={ar ? 'ar' : 'noopener'} target={ar ? undefined : '_blank'} href={endpoint('mobile.usdz')}><img src={arIcon} alt="" /><span>{ar ? 'View in AR or open the 3D model' : 'Download the 3D model'}<small>Phone viewing copy · covered stud detail trimmed</small></span></a><a className="guide-download-row" href={endpoint('model.usdz')} target="_blank" rel="noopener"><Download /><span>Download full-detail 3D<small>Exact geometry and placements</small></span></a><button className="guide-download-row" disabled={pdf.busy} onClick={downloadPdf}>{pdf.busy ? <LoaderCircle className="spin" /> : <Download />}<span>{pdf.busy ? 'Preparing the PDF…' : pdf.url ? 'PDF ready below' : 'Prepare PDF instructions'}<small>{pdf.busy ? 'You can keep building while the diagrams are prepared.' : 'A diagram-led guide you can print or save.'}</small></span></button>{pdf.url && <a className="guide-file-ready" href={pdf.url} target="_blank" rel="noopener">Download your PDF <Download size={16} /></a>}{pdf.error && <p role="alert">{pdf.error}</p>}<a className="guide-download-row" href={endpoint('parts.csv')} target="_blank" rel="noopener"><Layers3 /><span>Download parts list<small>Exact quantities, owned pieces and catalog links</small></span></a><small>AR needs a supported phone. Normal 3D building works without camera access.</small></>}</section></dialog>}
  </main>;
}
