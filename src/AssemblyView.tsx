import { useEffect, useState } from 'react';
import { ArrowDownToLine, ChevronLeft, ChevronRight, RotateCcw } from 'lucide-react';
import { billOfMaterials, buildSteps, COLORS, footprint, PARTS, type Design } from '../shared/model';
import { renderDesignSvg } from '../shared/illustration';
import { BrickScene } from './BrickScene';

export function AssemblyView({ design, downloadManual }: { design: Design; downloadManual(): void }) {
  const steps = buildSteps(design);
  const storageKey = `sprout-build-progress:${design.id}`;
  const [progress, setProgress] = useState(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(storageKey) || 'null');
      if (Number.isInteger(saved?.step) && steps[saved.step] && Number.isInteger(saved?.piece) && steps[saved.step].bricks[saved.piece]) return saved as { step: number; piece: number };
    } catch { /* Start at the first placement if browser storage is unavailable. */ }
    return { step: 0, piece: 0 };
  });
  const [replay, setReplay] = useState(0);
  useEffect(() => { localStorage.setItem(storageKey, JSON.stringify(progress)); }, [storageKey, progress]);
  const current = steps[progress.step];
  const active = current.bricks[progress.piece];
  const size = footprint(active);
  const visible = [...steps.slice(0, progress.step).flatMap(step => step.bricks), ...current.bricks.slice(0, progress.piece + 1)];
  const tray = billOfMaterials({ ...design, bricks: current.bricks });
  const minX = Math.min(...design.bricks.map(brick => brick.x));
  const minY = Math.min(...design.bricks.map(brick => brick.y));
  const width = Math.max(...design.bricks.map(brick => brick.x + footprint(brick).width)) - minX;
  const depth = Math.max(...design.bricks.map(brick => brick.y + footprint(brick).depth)) - minY;
  const cell = 20;
  const moveStep = (step: number) => setProgress({ step, piece: 0 });

  return <>
    <BrickScene design={design} visibleIds={visible.map(brick => brick.id)} activeId={active.id} replayKey={replay} />
    <div className="step-controls">
      <div className="step-navigation">
        <button aria-label="Previous build step" disabled={progress.step === 0} onClick={() => moveStep(progress.step - 1)}><ChevronLeft size={19} /></button>
        <div><span>STEP {progress.step + 1} OF {steps.length}</span><strong>{current.bricks.length} pieces · layer {current.z + 1}</strong></div>
        <button aria-label="Next build step" disabled={progress.step === steps.length - 1} onClick={() => moveStep(progress.step + 1)}><ChevronRight size={19} /></button>
      </div>
      <input aria-label="Build step" type="range" min={0} max={steps.length - 1} value={progress.step} onChange={event => moveStep(Number(event.target.value))} />
      <p>{current.instruction}</p>
    </div>
    <section className="assembly-guide" aria-label="Piece placement guide">
      <div className="assembly-heading"><h3>Gather these pieces</h3><span>{current.bricks.length} for this step</span></div>
      <div className="part-tray">{tray.map(part => {
        const firstIndex = current.bricks.findIndex(brick => brick.partId === part.partId && brick.colorId === part.colorId);
        const thumbnail = { ...design, title: `${COLORS[part.colorId].name} ${PARTS[part.partId].name}`, bricks: [{ ...current.bricks[firstIndex], x: 0, y: 0, z: 0, rotation: 0 as const }] };
        return <button key={`${part.partId}:${part.colorId}`} className={`part-chip ${active.partId === part.partId && active.colorId === part.colorId ? 'selected' : ''}`} aria-pressed={active.partId === part.partId && active.colorId === part.colorId} onClick={() => setProgress({ ...progress, piece: firstIndex })}>
          <span className="part-thumb" aria-hidden="true" dangerouslySetInnerHTML={{ __html: renderDesignSvg(thumbnail, { width: 76, height: 55 }) }} />
          <span className="part-count">×{part.quantity}</span><strong>{PARTS[part.partId].name}</strong><small>{COLORS[part.colorId].name} · #{part.partId}</small>
        </button>;
      })}</div>
      <div className="placement-heading" aria-live="polite"><h3>Place piece {progress.piece + 1} of {current.bricks.length}</h3><p>{COLORS[active.colorId].name} {PARTS[active.partId].name.toLowerCase()} · {size.width} across × {size.depth} deep</p></div>
      <div className="placement-list" aria-label="Placements in this step">{current.bricks.map((brick, index) => <button key={brick.id} aria-label={`Show placement ${index + 1}`} aria-pressed={index === progress.piece} className={`placement-button ${index === progress.piece ? 'selected' : ''}`} onClick={() => setProgress({ ...progress, piece: index })}>{index + 1}</button>)}</div>
      <div className="placement-map">
        <svg viewBox={`0 0 ${(width + 2) * cell} ${(depth + 2) * cell}`} role="img" aria-label={`Top view: piece ${progress.piece + 1} starts at X ${active.x}, Y ${active.y}. Blue border marks the current piece.`}>
          <rect x={cell} y={cell} width={width * cell} height={depth * cell} fill="#f4f9ff" stroke="#9ebbd5" />
          {Array.from({ length: width }, (_, x) => <text key={`x${x}`} x={(x + 1.5) * cell} y={13} textAnchor="middle" fontSize={9} fill="#335678">{x + minX}</text>)}
          {Array.from({ length: depth }, (_, y) => <text key={`y${y}`} x={10} y={(y + 1.6) * cell} textAnchor="middle" fontSize={9} fill="#335678">{y + minY}</text>)}
          {current.bricks.slice(0, progress.piece + 1).map((brick, index) => {
            const part = footprint(brick);
            return <g key={brick.id}><rect x={(brick.x - minX + 1) * cell + 1} y={(brick.y - minY + 1) * cell + 1} width={part.width * cell - 2} height={part.depth * cell - 2} fill={COLORS[brick.colorId].hex} stroke={brick.id === active.id ? '#006dff' : '#52667a'} strokeWidth={brick.id === active.id ? 3 : 1} />
              <circle cx={(brick.x - minX + 1 + part.width / 2) * cell} cy={(brick.y - minY + 1 + part.depth / 2) * cell} r={7} fill="white" stroke="#173f67" strokeWidth={0.6} />
              <text x={(brick.x - minX + 1 + part.width / 2) * cell} y={(brick.y - minY + 1 + part.depth / 2) * cell + 3} textAnchor="middle" fontSize={9} fill="#173f67">{index + 1}</text></g>;
          })}
          <text x={(width + 1) * cell} y={(depth + 1.8) * cell} textAnchor="end" fontSize={9} fill="#335678">TOP VIEW · +X → · +Y ↓</text>
        </svg>
        <p className="placement-note">Start at X {active.x}, Y {active.y}, using the same stud coordinates as the PDF. The blue border marks the current piece. Match this map with the viewer’s Top view.</p>
      </div>
      <div className="placement-actions">
        <button disabled={progress.piece === 0} onClick={() => setProgress({ ...progress, piece: progress.piece - 1 })}><ChevronLeft size={16} /> Previous piece</button>
        <button onClick={() => setReplay(value => value + 1)}><RotateCcw size={15} /> Replay placement</button>
        <button disabled={progress.piece === current.bricks.length - 1} onClick={() => setProgress({ ...progress, piece: progress.piece + 1 })}>Next piece <ChevronRight size={16} /></button>
      </div>
      <p className="placement-note">Your viewing position is saved for this revision. Advance after placing each piece; the app cannot confirm the physical build.</p>
      <button className="text-button" onClick={downloadManual}>Download all placement maps <ArrowDownToLine size={13} /></button>
    </section>
  </>;
}
