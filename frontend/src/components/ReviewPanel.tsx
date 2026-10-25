import { useEffect, useRef, useState } from 'react';
import { Ban, CheckCircle2, ClipboardCheck, DoorClosed, Loader2, ScanSearch, UserCheck } from 'lucide-react';
import type { Building, ReviewAction, RunState } from '../types';
import { api } from '../api';
import { Chip, Panel, cx } from './ui';
import { optionLabel } from './OptionsPanel';

const ACTION_LABEL: Record<string, string> = {
  approve: 'approved',
  reject: 'rejected',
  more_evidence: 'requested more evidence',
  block_exit: 'reported exit blocked',
};

export function ReviewPanel({ run, building, onSubmitted }: { run: RunState; building: Building | null; onSubmitted: () => void }) {
  const review = run.review;
  const [reviewer, setReviewer] = useState('Safety lead');
  const [note, setNote] = useState('');
  const [exitId, setExitId] = useState('');
  const [busy, setBusy] = useState<ReviewAction | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const awaiting = run.status === 'awaiting_review' && !!review;

  const rootRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    setErr(null);
    setBusy(null);
    if (review) rootRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [run.run_id, review?.requested_at]); // eslint-disable-line react-hooks/exhaustive-deps

  const exits = building?.exits ?? [];
  const blocked = new Set(run.routing?.blocked_exits ?? []);

  const submit = async (action: ReviewAction) => {
    if (!review) return;
    if (action === 'block_exit' && !exitId) {
      setErr('Choose the exit that is blocked.');
      return;
    }
    setBusy(action);
    setErr(null);
    try {
      await api.review(run.run_id, {
        action,
        option_id: action === 'approve' || action === 'reject' ? review.recommended : undefined,
        exit_id: action === 'block_exit' ? exitId : undefined,
        note,
        reviewer: reviewer.trim() || 'Safety lead',
      });
      setNote('');
      onSubmitted();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
      setBusy(null);
    }
  };

  if (!awaiting && run.review_history.length === 0 && run.action_log.length === 0) return null;

  return (
    <div ref={rootRef}>
    <Panel
      title="Human review"
      icon={<UserCheck size={13} />}
      className={cx(awaiting && 'border-caution-soft/60 shadow-[0_0_0_1px_rgba(214,162,67,0.15)]')}
      right={awaiting ? <Chip tone="caution" dot>awaiting decision</Chip> : run.approved_option ? <Chip tone="clear">approved (simulated)</Chip> : null}
    >
      <div className="space-y-3 p-3 text-[11.5px]">
        {awaiting && review && (
          <>
            <div className="flex items-center gap-2 rounded-md border border-ink-700 bg-ink-850 px-2.5 py-2">
              <div className="min-w-0">
                <div className="label">Recommended procedure</div>
                <div className="font-mono text-[13.5px] font-semibold text-[#9fe0cf]">{optionLabel(review.recommended)}</div>
              </div>
              <div className="ml-auto max-w-[52%] text-right text-[10.5px] leading-snug text-ink-400">Nothing executes automatically; every action is simulated and logged.</div>
            </div>
            <div className="grid grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)] gap-1.5">
              <input aria-label="Reviewer" className="input" value={reviewer} onChange={(e) => setReviewer(e.target.value)} placeholder="Reviewer" />
              <input aria-label="Note" className="input" placeholder="Note for the trace (optional)" value={note} onChange={(e) => setNote(e.target.value)} />
            </div>
            <div className="grid grid-cols-2 gap-1.5">
              <button type="button" className="btn-primary" disabled={!!busy} onClick={() => submit('approve')}>
                {busy === 'approve' ? <Loader2 size={13} className="animate-spin" /> : <CheckCircle2 size={13} />}
                Approve (simulated)
              </button>
              <button type="button" className="btn-danger" disabled={!!busy} onClick={() => submit('reject')}>
                {busy === 'reject' ? <Loader2 size={13} className="animate-spin" /> : <Ban size={13} />}
                Reject recommendation
              </button>
              <button type="button" className="btn-ghost col-span-2" disabled={!!busy} onClick={() => submit('more_evidence')}>
                {busy === 'more_evidence' ? <Loader2 size={13} className="animate-spin" /> : <ScanSearch size={13} />}
                Request more evidence
              </button>
            </div>
            <div className="flex gap-1.5">
              <select className="input min-w-0 flex-1" value={exitId} onChange={(e) => setExitId(e.target.value)} aria-label="Exit">
                <option value="">Select exit…</option>
                {exits.map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.id} — {e.name}
                    {blocked.has(e.id) ? ' (already unavailable)' : ''}
                  </option>
                ))}
              </select>
              <button type="button" className="btn-warn" disabled={!!busy} onClick={() => submit('block_exit')}>
                {busy === 'block_exit' ? <Loader2 size={13} className="animate-spin" /> : <DoorClosed size={13} />}
                Report exit blocked
              </button>
            </div>
            {err && <div className="text-[#e6bd6e]">{err}</div>}
            {review.gaps.length > 0 && (
              <div>
                <div className="label mb-1">Coverage gaps</div>
                <ul className="space-y-1">
                  {review.gaps.map((g, i) => (
                    <li key={i} className="rounded border border-ink-700 bg-ink-850 px-2 py-1">
                      <span className="font-mono text-ink-100">{g.camera_id}</span> <span className="text-ink-400">zone {g.zone}</span>
                      <div className="text-ink-300">{g.issues.map((x) => x.replace(/_/g, ' ')).join(', ')}</div>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {review.verification_tasks.length > 0 && (
              <div>
                <div className="label mb-1">Verification tasks</div>
                <ul className="space-y-1">
                  {review.verification_tasks.map((t, i) => (
                    <li key={i} className="flex items-start gap-2">
                      <Chip tone={t.priority === 'high' ? 'threat' : 'caution'}>{t.priority}</Chip>
                      <span className="text-ink-200">{t.task}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {review.gaps.length === 0 && review.verification_tasks.length === 0 && (
              <div className="text-[11px] text-ink-400">No coverage gaps or pending verification tasks.</div>
            )}
          </>
        )}

        {run.review_history.length > 0 && (
          <div>
            <div className="label mb-1">Review history</div>
            <ul className="space-y-1">
              {run.review_history.map((h, i) => (
                <li key={i} className="rounded border border-ink-700 bg-ink-850 px-2 py-1">
                  <span className="text-ink-100">{h.reviewer ?? 'reviewer'}</span>{' '}
                  <span className="text-ink-300">{ACTION_LABEL[h.action ?? ''] ?? h.action}</span>{' '}
                  {(h.action === 'approve' || h.action === 'reject') && <span className="font-mono text-ink-200">{h.option_id ?? h.recommended}</span>}
                  {h.action === 'block_exit' && <span className="font-mono text-ink-200">{h.exit_id}</span>}
                  <span className="tnum ml-1 text-ink-500">{new Date(h.at * 1000).toLocaleTimeString()}</span>
                  {h.note && <div className="text-ink-400">“{h.note}”</div>}
                </li>
              ))}
            </ul>
          </div>
        )}

        {run.action_log.length > 0 && (
          <div>
            <div className="label mb-1 flex items-center gap-1">
              <ClipboardCheck size={11} /> Action log — all entries simulated
            </div>
            <ul className="space-y-0.5 rounded border border-ink-700 bg-ink-950 p-2 font-mono text-[10.5px] leading-relaxed text-ink-300">
              {run.action_log.map((l, i) => (
                <li key={i}>{l}</li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </Panel>
    </div>
  );
}
