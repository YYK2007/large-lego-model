import { useState } from 'react';
import { isActiveJob, jobStageLabels, type GenerationJob, type JobAttempt } from '../shared/generation-job';
import './generation-jobs.css';

function AttemptOutput({ jobId, attempt, latest, onUse }: { jobId: string; attempt: JobAttempt; latest: boolean; onUse: (attempt: JobAttempt) => void }) {
  const [expanded, setExpanded] = useState(false);
  const base = `/api/generation-jobs/${encodeURIComponent(jobId)}/attempts/${attempt.attempt}`;
  const visible = latest || expanded;
  return <article className={`job-attempt ${attempt.status}`}>
    <button className="attempt-heading" aria-expanded={visible} onClick={() => setExpanded(value => !value)} disabled={latest}>
      <strong>Attempt {attempt.attempt}{latest ? ' · latest' : ''}</strong><span>{attempt.status === 'valid' ? 'Brick checks passed' : attempt.partial ? 'Unfinished · partial model' : 'Unfinished · checks failed'}</span>
    </button>
    {visible && <div className="attempt-output">
      {attempt.previewAvailable ? <img src={`${base}/preview.svg`} alt={`Attempt ${attempt.attempt}: ${attempt.status === 'valid' ? 'checked brick model' : 'unfinished brick preview, not approved for building'}`} />
        : <p>This attempt could not be packed into a brick preview. View its plan and check details.</p>}
      {attempt.status === 'invalid' && <p>Preview only. This attempt is not approved for building or export.</p>}
      {attempt.checks.length > 0 && <details><summary>Check feedback ({attempt.checks.length})</summary><ul>{attempt.checks.map((check, index) => <li key={index}>{check}</li>)}</ul></details>}
      <div className="job-actions">{attempt.status === 'valid' && !attempt.partial && attempt.designId && <button className="dark-button" onClick={() => onUse(attempt)}>Use this build</button>}<a href={base} target="_blank" rel="noopener">View attempt output ↗</a>
        {attempt.designId && <a href={`/?design=${encodeURIComponent(attempt.designId)}`} target="_blank" rel="noopener">Open checked build ↗</a>}</div>
    </div>}
  </article>;
}

export function GenerationJobPanel({ job, elapsed, connection, onCancel, onResume, onDismiss, onUse }: {
  job: GenerationJob; elapsed: number; connection: string;
  onCancel: () => void; onResume: () => void; onDismiss: () => void; onUse: (attempt: JobAttempt) => void;
}) {
  const active = isActiveJob(job);
  const attempts = [...(job.attempts || [])].reverse();
  const label = job.status === 'queued' ? 'Waiting for a build worker' : job.status === 'running'
    ? job.progress ? jobStageLabels[job.progress.stage] : 'Starting your build'
    : { succeeded: 'Build ready', failed: 'Build stopped before completion', interrupted: 'Build interrupted by server restart', cancelled: 'Generation stopped' }[job.status];
  return <section className="generation-job" aria-label="Build job">
    <div className="job-heading"><strong>{label}</strong><span>{Math.floor(elapsed / 60)}:{String(elapsed % 60).padStart(2, '0')}</span></div>
    <p>{active ? job.visualReview === false ? 'Preparing the first draft that passes brick checks, then waiting for your feedback. You can stop at any time.' : 'Preparing your build and checking it against the request. Stops when the review passes or further attempts stop improving. You can stop sooner.' : 'Finished. Your attempt results are retained.'}</p>
    {active && <button className="job-stop" onClick={onCancel}>Stop generation</button>}
    {active && <p role="status">{connection || job.progress?.detail || 'You can reload this page. This build will keep running.'}</p>}
    {!active && connection && <p role="status">{connection}</p>}
    {job.resumedFrom && <p>This is a new attempt {job.resumeMode === 'draft' ? 'using the previous saved draft' : 'using the original request'}.</p>}
    {job.error && <p>{job.error.message}</p>}
    {attempts.length > 0 && <section className="job-attempts" aria-label="Attempt history"><h3>Attempt results</h3><p>{active ? 'Every result is retained. Failed checks stay visible while the next attempt runs.' : 'Every result is retained for review.'}</p>{attempts.map((attempt, index) => <AttemptOutput key={attempt.attempt} jobId={job.id} attempt={attempt} latest={index === 0} onUse={onUse} />)}</section>}
    {job.usage && <details><summary>API usage · {job.usage.requests} requests</summary><p>Input {job.usage.inputTokens.toLocaleString()} · Output {job.usage.outputTokens.toLocaleString()} · Thinking {job.usage.thinkingTokens.toLocaleString()} · Cached {job.usage.cachedTokens.toLocaleString()} tokens.</p><small>Provider-reported usage. These categories may have different billing rates; no price estimate is shown.</small></details>}
    {job.milestones.length > 0 && <details><summary>Build milestones ({job.milestones.length})</summary><ol>{job.milestones.map((event, index) => <li key={`${event.at}-${index}`}><span>{jobStageLabels[event.stage]}{event.attempt > 1 ? ` · attempt ${event.attempt}` : ''}</span><time>{new Date(event.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</time></li>)}</ol></details>}
    <div className="job-actions">
      {job.conceptId && <a href={`/api/generation-jobs/${encodeURIComponent(job.id)}/concept.svg`} target="_blank" rel="noopener">View shape study (not a LEGO assembly) ↗</a>}
      {job.bestDraftId && <a href={`/?design=${encodeURIComponent(job.bestDraftId)}`} target="_blank" rel="noopener">Inspect {job.status === 'succeeded' ? 'saved build' : 'saved valid draft'} ↗</a>}
      {!active && <>
        {job.status !== 'succeeded' && <button className="text-button" onClick={onResume}>{job.bestDraftId ? 'Resume from saved draft' : 'Start a new attempt'}</button>}
        <button className="text-button" onClick={onDismiss}>Dismiss</button>
      </>}
    </div>
    {!active && job.status !== 'succeeded' && <small>Resume starts a new generation attempt and may use API credits. Your current design stays unchanged.</small>}
    {active && <small>Stop ends this worker and future calls. A provider request already received may still be billed.</small>}
  </section>;
}
