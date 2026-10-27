import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  AlertTriangle,
  Ban,
  Building2,
  Camera as CameraIcon,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  CircleDashed,
  Crosshair,
  DoorClosed,
  Hourglass,
  Info,
  Layers as LayersIcon,
  Layers3,
  ListChecks,
  Loader2,
  Map as MapIcon,
  Maximize2,
  Minus,
  Mountain,
  Play,
  Plus,
  ScanSearch,
  ShieldCheck,
  UserCheck,
  Users,
  X,
  Zap,
} from 'lucide-react';
import { api } from '../../api';
import { useApp } from '../../context';
import type { Analysis, Building, ReviewAction, RunState, Vec2 } from '../../types';
import { agentActivity, composeSummary, elapsedSeconds, evidenceTimeline, priorityOf, statusText, supportingAnalyses, type StageState } from '../../lib/derive';
import { effectiveCameraStatus, elapsed, enhanceLabel, ms, num, pct } from '../../lib/format';
import { observedColor, routeColor, threatColor, cameraStatusColor } from '../../lib/colors';
import { routePolyline } from '../../lib/geometry';
import type { Floor, ViewLevel } from '../../lib/scene';
import { CameraPlayer } from '../CameraPlayer';
import { ACTIVITY_TEXT } from '../CameraWall';
import { ProcedureLabel } from '../ops';
import { cx } from '../ui';
import { pendingObservations } from '../../lib/observations';
import { Dot, Ring, Sparkline, StageTag, TONE_TEXT } from '../viz';
import { DEFAULT_LAYERS, type Layers } from './LiveLayers';
import { incidentZones, zoneHeat } from '../Twin';

// ------------------------------------------------------------------ glass panel
export function Float({
  title,
  icon,
  right,
  children,
  className,
  collapsible = true,
  defaultOpen = true,
  tone,
  onClose,
  label,
}: {
  title: ReactNode;
  icon?: ReactNode;
  right?: ReactNode;
  children: ReactNode;
  className?: string;
  collapsible?: boolean;
  defaultOpen?: boolean;
  tone?: 'caution' | 'threat';
  onClose?: () => void;
  label?: string;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <section
      aria-label={label ?? (typeof title === 'string' ? title : undefined)}
      className={cx(
        'fade-in pointer-events-auto overflow-hidden rounded-2xl border bg-[rgba(5,14,27,0.66)] shadow-[0_18px_48px_-18px_rgba(0,0,0,0.9),inset_0_1px_0_rgba(148,197,255,0.06)] backdrop-blur-xl',
        tone === 'caution' ? 'border-caution/45 shadow-[0_0_28px_-8px_rgba(245,158,11,0.45)]' : tone === 'threat' ? 'border-threat/45' : 'border-accent/15',
        className,
      )}
    >
      <header className="flex items-center gap-2 px-3 py-2">
        {icon && <span className="text-accent">{icon}</span>}
        <h2 className="min-w-0 truncate text-[12.5px] font-semibold tracking-wide text-ink-100">{title}</h2>
        <div className="ml-auto flex items-center gap-1.5">
          {right}
          {collapsible && (
            <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} aria-label={open ? 'Collapse panel' : 'Expand panel'} className="rounded-md p-0.5 text-ink-400 hover:bg-white/5 hover:text-ink-100">
              <ChevronDown size={14} className={cx('transition-transform', !open && '-rotate-90')} />
            </button>
          )}
          {onClose && (
            <button type="button" onClick={onClose} aria-label="Close panel" className="rounded-md p-0.5 text-ink-400 hover:bg-white/5 hover:text-ink-100">
              <X size={14} />
            </button>
          )}
        </div>
      </header>
      {open && <div className="border-t border-white/5">{children}</div>}
    </section>
  );
}

// ------------------------------------------------------------------ incident
export function IncidentFloat() {
  const { run, now, startRun, starting, scenarios, scenarioId, navigate, openReview } = useApp();
  const [more, setMore] = useState(false);
  if (!run) {
    const sc = scenarios.find((s) => s.id === scenarioId);
    return (
      <Float title="Ready" icon={<ShieldCheck size={15} />} collapsible={false} label="Incident">
        <div className="space-y-3 p-3">
          <p className="text-[12px] leading-relaxed text-ink-300">Run a simulated scenario. The agent analyses cameras with OpenCV, localises the threat on this twin and pauses for your decision.</p>
          <button type="button" className="btn-primary w-full py-2 text-[12.5px]" disabled={!scenarioId || starting} onClick={() => void startRun()}>
            {starting ? <Loader2 size={14} className="animate-spin" /> : <Play size={14} />}
            Run {sc ? sc.title : 'scenario'}
          </button>
          <button type="button" className="w-full text-center text-[11px] text-accent hover:text-accent-bright" onClick={() => navigate('lab')}>
            Scenario Lab →
          </button>
        </div>
      </Float>
    );
  }
  const b = run.belief;
  const prio = priorityOf(b?.p_threat);
  const sec = elapsedSeconds(run, now);
  return (
    <Float
      title={<span className="font-mono text-[10.5px] font-medium uppercase tracking-wider text-threat-bright">Incident #{run.run_id.split('-').slice(-1)[0]}</span>}
      icon={<AlertTriangle size={15} className={prio.tone === 'threat' ? 'text-threat' : 'text-caution'} />}
      tone={prio.tone === 'threat' ? 'threat' : undefined}
      label="Incident"
      right={
        <button type="button" onClick={() => setMore((m) => !m)} aria-expanded={more} aria-label="AI summary" title="AI summary" className={cx('rounded-md p-0.5 hover:bg-white/5', more ? 'text-accent' : 'text-ink-400')}>
          <Info size={14} />
        </button>
      }
    >
      <div className="p-3">
        <div className="flex items-start gap-3">
          <div className="min-w-0 flex-1">
            <div className="line-clamp-2 text-[15px] font-semibold leading-snug text-ink-100" title={run.scenario.trigger.claim}>
              {run.scenario.trigger.claim}
            </div>
            <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
              <span className={cx('rounded-full px-2 py-[1px] text-[10.5px] font-semibold', prio.tone === 'threat' ? 'bg-threat text-white shadow-glow-red' : prio.tone === 'caution' ? 'bg-caution text-ink-950' : 'bg-clear text-ink-950')}>{prio.label}</span>
              <span className="flex items-center gap-1 text-[11px] text-ink-200">
                <Dot tone={run.status === 'running' ? 'info' : run.status === 'awaiting_review' ? 'caution' : 'clear'} pulse={run.status === 'running'} />
                {statusText(run)}
              </span>
            </div>
          </div>
          <Ring value={b?.p_threat ?? null} tone={prio.tone} size={66} stroke={6} />
        </div>
        <div className="mt-2.5 grid grid-cols-3 gap-2 border-t border-white/5 pt-2.5">
          <div>
            <div className="text-[9.5px] uppercase tracking-wider text-ink-400">Elapsed</div>
            <div className="tnum text-[13px] font-semibold text-ink-100">{elapsed(sec)}</div>
          </div>
          <div className="min-w-0">
            <div className="text-[9.5px] uppercase tracking-wider text-ink-400">{b?.localized ? 'Threat region' : 'Location'}</div>
            {b?.localized ? (
              <div className="truncate font-mono text-[12px] font-semibold text-threat-bright" title={`${b.region.join(', ')} — from camera observations with a verified or human-confirmed location`}>
                {b.region.length > 3 ? `${b.region.slice(0, 3).join(' ')} +${b.region.length - 3}` : b.region.join(' ')}
              </div>
            ) : (
              <div className="truncate text-[11.5px] font-semibold text-caution-bright" title={`Not localised by cameras. The report names ${run.scenario.trigger.zone}; that claim is unverified.`}>
                Unknown <span className="font-mono font-normal text-ink-300">(report: {run.scenario.trigger.zone})</span>
              </div>
            )}
          </div>
          <div className="flex flex-col items-end">
            <div className="text-[9.5px] uppercase tracking-wider text-ink-400">Trend</div>
            <Sparkline values={run.belief_history.map((h) => h.p_threat)} width={70} height={20} color={prio.tone === 'threat' ? '#ef4444' : '#f59e0b'} ariaLabel="P(threat) trend" />
          </div>
        </div>
        {(() => {
          const pend = pendingObservations(run);
          const events = pend.filter((o) => o.kind === 'candidate_event').length;
          if (run.status !== 'awaiting_review' || !pend.length) return null;
          return (
            <button type="button" onClick={() => openReview(null)} className="mt-2.5 flex w-full items-center justify-between gap-2 rounded-lg border border-caution/50 bg-caution-dim/50 px-2.5 py-1.5 text-left text-[11.5px] text-caution-bright hover:bg-caution-dim/80">
              <span>
                <b>Next:</b> review {events ? `${events} candidate event${events === 1 ? '' : 's'}` : `${pend.length} observation${pend.length === 1 ? '' : 's'}`} — location unknown until you confirm
              </span>
              <ChevronRight size={14} />
            </button>
          );
        })()}
        {more && <p className="fade-in mt-2.5 border-t border-white/5 pt-2.5 text-[11.5px] leading-relaxed text-ink-300">{composeSummary(run)}</p>}
      </div>
    </Float>
  );
}

// ------------------------------------------------------------------ review
export function ReviewFloat() {
  const { run, building, refresh, openAnalysis, navigate, openReview } = useApp();
  const [reviewer, setReviewer] = useState('Safety lead');
  const [note, setNote] = useState('');
  const [exitId, setExitId] = useState('');
  const [busy, setBusy] = useState<ReviewAction | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [menu, setMenu] = useState(false);
  const review = run?.review;
  const awaiting = run?.status === 'awaiting_review' && !!review;
  useEffect(() => {
    setBusy(null);
    setErr(null);
  }, [run?.run_id, review?.requested_at]);
  if (!run) return null;
  const recId = review?.recommended ?? run.assessment?.recommended ?? null;
  const rec = run.assessment?.options.find((o) => o.id === recId);

  const submit = async (action: ReviewAction) => {
    if (!review) return;
    if (action === 'block_exit' && !exitId) return setErr('Choose an exit.');
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
      setMenu(false);
      refresh();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
      setBusy(null);
    }
  };

  if (!recId) {
    return (
      <Float key="review-wait" title="Human review" icon={<UserCheck size={15} />} label="Human review" defaultOpen={false} right={<span className="text-[10.5px] text-info-bright">agent working</span>}>
        <p className="p-3 text-[11.5px] text-ink-400">A recommendation appears when the agent stops gathering evidence.</p>
      </Float>
    );
  }
  const support = supportingAnalyses(run, 4);
  return (
    <Float
      key="review-ready"
      title="Human review"
      icon={<UserCheck size={15} />}
      tone={awaiting ? 'caution' : undefined}
      label="Human review"
      right={
        awaiting ? (
          <span className="flex items-center gap-1.5 rounded-full border border-caution/60 bg-caution-dim px-2 py-[1px] text-[10px] font-semibold text-caution-bright">
            <Dot tone="caution" pulse /> Awaiting
          </span>
        ) : run.approved_option ? (
          <span className="rounded-full border border-clear/50 bg-clear-dim px-2 py-[1px] text-[10px] font-semibold text-clear-bright">Approved · sim</span>
        ) : null
      }
    >
      <div className="space-y-2.5 p-3">
        {(() => {
          const pend = pendingObservations(run);
          return (
            <button type="button" onClick={() => openReview(pend[0]?.camera_id ?? null)} className={cx('flex w-full items-center gap-2 rounded-lg border px-2.5 py-2 text-left text-[12px] font-semibold', pend.length && awaiting ? 'border-caution bg-caution/20 text-caution-bright shadow-[0_0_18px_-6px_rgba(245,158,11,0.7)]' : 'border-accent/40 bg-accent/10 text-accent-bright')}>
              <ScanSearch size={15} />
              <span className="flex-1">{pend.length && awaiting ? `Review evidence · ${pend.length} pending` : 'Open evidence review'}</span>
              <ChevronRight size={14} />
            </button>
          );
        })()}
        <div>
          <div className="text-[10px] uppercase tracking-wider text-ink-400">{run.approved_option ? 'Approved (simulated)' : 'Recommended'}</div>
          <ProcedureLabel id={run.approved_option ?? recId} className="text-[18px] text-accent-bright [text-shadow:0_0_18px_rgba(34,211,238,0.45)]" />
          {rec && <p className="mt-0.5 line-clamp-2 text-[11px] leading-snug text-ink-300" title={rec.description}>{rec.description}</p>}
          {run.assessment?.no_feasible_alternative && <p className="mt-1 rounded-md bg-caution-dim/50 px-2 py-1 text-[10.5px] leading-snug text-caution-bright">{run.assessment.uncertainty[0]}</p>}
        </div>
        {support.length > 0 && (
          <div className="grid grid-cols-4 gap-1">
            {support.map((aid) => {
              const a = run.analyses[aid];
              const act = run.cameras[a.camera_id]?.activity;
              return (
                <button
                  key={aid}
                  type="button"
                  onClick={() => {
                    openAnalysis(a.camera_id, aid);
                    openReview(a.camera_id);
                  }}
                  aria-label={`Open evidence ${aid}`}
                  title={`${a.camera_id} · ${act ?? ''}`}
                  className={cx('relative aspect-[4/3] overflow-hidden rounded-md border transition-all hover:shadow-glow-cyan', act === 'flight' ? 'border-threat/60' : 'border-white/10 hover:border-accent')}
                >
                  <img src={a.frame_urls[Math.floor(a.frame_urls.length / 2)]} alt="" loading="lazy" className="h-full w-full object-cover" />
                  <span className="absolute bottom-0 left-0 bg-black/70 px-1 font-mono text-[8px] text-white">{a.camera_id.replace('CAM-', 'C')}</span>
                </button>
              );
            })}
          </div>
        )}
        {awaiting && (
          <div className="relative grid grid-cols-2 gap-1.5">
            <button type="button" className="btn-primary py-2 text-[12px]" disabled={!!busy} onClick={() => submit('approve')}>
              {busy === 'approve' ? <Loader2 size={13} className="animate-spin" /> : <CheckCircle2 size={14} />}
              Approve
            </button>
            <button type="button" className="btn-danger py-2 text-[12px]" disabled={!!busy} onClick={() => submit('reject')} title="Reject: the agent re-assesses without this option">
              {busy === 'reject' ? <Loader2 size={13} className="animate-spin" /> : <Ban size={14} />}
              Reject
            </button>
            <button type="button" className="btn-ghost py-1.5 text-[11px]" disabled={!!busy} onClick={() => submit('more_evidence')} title="The agent analyses remaining cameras and re-assesses">
              {busy === 'more_evidence' ? <Loader2 size={12} className="animate-spin" /> : <ScanSearch size={12} />}
              More evidence
            </button>
            <button type="button" className={cx('btn-ghost py-1.5 text-[11px]', menu && 'border-caution/60 text-caution-bright')} onClick={() => setMenu((m) => !m)} aria-expanded={menu} aria-label="Report exit blocked, add note">
              <DoorClosed size={12} />
              Exit blocked…
            </button>
            {menu && (
              <div role="dialog" aria-label="Report exit blocked" className="fade-in col-span-2 space-y-1.5 rounded-xl border border-caution/30 bg-ink-950/70 p-2">
                <div className="flex gap-1.5">
                  <select aria-label="Exit" className="input min-w-0 flex-1" value={exitId} onChange={(e) => setExitId(e.target.value)}>
                    <option value="">Exit…</option>
                    {(building?.exits ?? []).map((e) => (
                      <option key={e.id} value={e.id}>
                        {e.id} — {e.name}
                      </option>
                    ))}
                  </select>
                  <button type="button" className="btn-warn" disabled={!!busy} onClick={() => submit('block_exit')}>
                    {busy === 'block_exit' ? <Loader2 size={12} className="animate-spin" /> : <DoorClosed size={12} />}
                    Report
                  </button>
                </div>
                <div className="grid grid-cols-2 gap-1.5">
                  <input aria-label="Reviewer" className="input" value={reviewer} onChange={(e) => setReviewer(e.target.value)} placeholder="Reviewer" />
                  <input aria-label="Note" className="input" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Note (optional)" />
                </div>
              </div>
            )}
            <p className="col-span-2 text-[10.5px] leading-snug text-ink-400">
              Approve records your decision and ends the run (actions logged as SIMULATED). Reject excludes this option; the agent proposes the next one.
              {pendingObservations(run).length > 0 && <span className="text-caution-bright"> {pendingObservations(run).length} observation(s) unreviewed — not used by this recommendation.</span>}
            </p>
            {err && <div className="col-span-2 text-[11px] text-caution-bright">{err}</div>}
          </div>
        )}
        {!awaiting && run.action_log.length > 0 && (
          <details className="rounded-lg border border-white/5 bg-ink-950/50 px-2 py-1 text-[10.5px] text-ink-300">
            <summary className="cursor-pointer text-ink-200">Simulated action log ({run.action_log.length})</summary>
            <ul className="mt-1 space-y-0.5 font-mono">
              {run.action_log.map((l, i) => (
                <li key={i}>{l}</li>
              ))}
            </ul>
          </details>
        )}
        <div className="flex justify-between text-[10px] text-ink-500">
          <span>Simulated · nothing is sent</span>
          <button type="button" className="text-accent hover:text-accent-bright" onClick={() => navigate('intel')}>
            Options & preconditions →
          </button>
        </div>
      </div>
    </Float>
  );
}

// ------------------------------------------------------------------ agent activity
const STAGE_ICON: Record<StageState, ReactNode> = {
  done: <Check size={11} strokeWidth={3} />,
  active: <Hourglass size={10} />,
  pending: <CircleDashed size={11} />,
  skipped: <Minus size={11} />,
};

export function ActivityFloat({ defaultOpen = true }: { defaultOpen?: boolean }) {
  const { run, navigate } = useApp();
  const stages = agentActivity(run);
  return (
    <Float
      title="Agent activity"
      icon={<Zap size={15} />}
      defaultOpen={defaultOpen}
      right={
        <button type="button" className="text-[10.5px] text-accent hover:text-accent-bright" onClick={() => navigate('intel')}>
          Trace
        </button>
      }
    >
      <ol className="space-y-0.5 px-3 py-2">
        {stages.map((s) => (
          <li key={s.key} className="flex items-center gap-2.5 py-0.5" title={s.detail}>
            <span
              className={cx(
                'flex h-5 w-5 shrink-0 items-center justify-center rounded-full border',
                s.state === 'done' ? 'border-clear bg-clear/20 text-clear-bright' : s.state === 'active' ? 'border-caution bg-caution/20 text-caution-bright shadow-[0_0_10px_rgba(245,158,11,0.6)]' : 'border-ink-600 text-ink-500',
              )}
            >
              {STAGE_ICON[s.state]}
            </span>
            <span className={cx('flex-1 truncate text-[11.5px]', s.state === 'pending' ? 'text-ink-500' : 'text-ink-100')}>{s.label}</span>
            <span className="tnum font-mono text-[10px] text-ink-400">{s.time ?? ''}</span>
          </li>
        ))}
      </ol>
    </Float>
  );
}

// ------------------------------------------------------------------ timeline strip
export function TimelineStrip({ open, onToggle }: { open: boolean; onToggle: () => void }) {
  const { run, building, openAnalysis, navigate, now } = useApp();
  const items = evidenceTimeline(run, building);
  const ref = useRef<HTMLOListElement>(null);
  useEffect(() => {
    if (ref.current) ref.current.scrollLeft = ref.current.scrollWidth;
  }, [items.length]);
  const m = run?.metrics;
  const hot = new Set(run?.belief?.localized ? run.belief.region : []);
  return (
    <section aria-label="Evidence timeline" className="pointer-events-auto overflow-hidden rounded-2xl border border-accent/15 bg-[rgba(5,14,27,0.66)] shadow-[0_18px_48px_-18px_rgba(0,0,0,0.9)] backdrop-blur-xl">
      <header className="flex flex-wrap items-center gap-x-4 gap-y-1 px-3 py-2">
        <span className="flex items-center gap-2 text-[12.5px] font-semibold text-ink-100">
          <ListChecks size={15} className="text-accent" /> Evidence timeline
        </span>
        <div className="flex flex-wrap items-center gap-x-3 text-[10.5px] text-ink-400">
          {[
            ['steps', run?.step ?? 0],
            ['vision', m?.vision_calls ?? 0],
            ['cv time', m ? ms(m.vision_ms) : '—'],
            ['re-analyses', m?.reanalyses ?? 0],
            ['faults', m?.faults ?? 0],
            ['elapsed', elapsed(elapsedSeconds(run, now))],
          ].map(([k, v]) => (
            <span key={k as string}>
              {k} <span className="tnum font-mono text-ink-100">{v}</span>
            </span>
          ))}
        </div>
        <div className="ml-auto flex items-center gap-2">
          <button type="button" className="text-[10.5px] text-accent hover:text-accent-bright" onClick={() => navigate('intel')}>
            Full trace →
          </button>
          <button type="button" onClick={onToggle} aria-expanded={open} aria-label={open ? 'Collapse timeline' : 'Expand timeline'} className="rounded-md p-0.5 text-ink-400 hover:bg-white/5 hover:text-ink-100">
            <ChevronDown size={14} className={cx('transition-transform', !open && 'rotate-180')} />
          </button>
        </div>
      </header>
      {open && (
        <ol ref={ref} className="flex gap-2 overflow-x-auto border-t border-white/5 px-3 py-2.5 scroll-thin">
          {items.length === 0 && <li className="py-3 text-[11.5px] text-ink-400">Perception and belief updates stream here as the agent works.</li>}
          {items.map((it) => (
            <li key={it.step} className="shrink-0">
              <button
                type="button"
                disabled={!it.analysisId}
                onClick={() => it.analysisId && it.cameraId && openAnalysis(it.cameraId, it.analysisId)}
                className="flex w-[218px] items-center gap-2 rounded-xl border border-white/5 bg-white/[0.02] p-1.5 text-left transition-all enabled:hover:border-accent/40 enabled:hover:bg-accent/5"
              >
                <span className="relative h-[46px] w-[60px] shrink-0 overflow-hidden rounded-lg bg-ink-900">
                  {it.thumb ? <img src={it.thumb} alt="" loading="lazy" className="h-full w-full object-cover" /> : <span className="flex h-full items-center justify-center text-ink-500"><Zap size={13} /></span>}
                </span>
                <span className="min-w-0">
                  <span className="flex items-center gap-1.5">
                    <span className="tnum font-mono text-[9.5px] text-ink-400">{it.time}</span>
                    <StageTag>{it.tag}</StageTag>
                  </span>
                  <span className="mt-0.5 line-clamp-2 text-[11px] leading-tight text-ink-100" title={it.title}>
                    {it.title}
                  </span>
                  {it.locationUnknown && <span className="mt-0.5 block truncate text-[9px] font-semibold text-caution-bright">location unknown</span>}
                  {it.zones.length > 0 && (
                    <span className="mt-0.5 block truncate font-mono text-[9px]">
                      {it.zones.map((z) => (
                        <span key={z} className={cx('mr-1', hot.has(z) ? 'text-threat-bright' : 'text-ink-400')}>
                          {z}
                        </span>
                      ))}
                    </span>
                  )}
                </span>
              </button>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

// ------------------------------------------------------------------ frame thumbnail with detections
export function FrameThumb({ a, className }: { a: Analysis; className?: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const idx = useMemo(() => {
    const pf = a.per_frame ?? [];
    for (let i = pf.length - 1; i >= 0; i--) if (pf[i].detected && pf[i].detections.length) return i;
    return Math.max(0, Math.floor(a.frame_urls.length / 2));
  }, [a]);
  useEffect(() => {
    const c = ref.current;
    const url = a.frame_urls[Math.min(idx, a.frame_urls.length - 1)];
    if (!c || !url) return;
    const img = new Image();
    let alive = true;
    img.onload = () => {
      if (!alive) return;
      const g = c.getContext('2d');
      if (!g) return;
      c.width = 320;
      c.height = 240;
      g.drawImage(img, 0, 0, 320, 240);
      const [W] = a.frame_size ?? [img.width, img.height];
      const s = 320 / W;
      for (const d of a.per_frame?.[idx]?.detections ?? []) {
        g.strokeStyle = d.cls === 'person' ? '#67e8f9' : '#fbbf24';
        g.lineWidth = 1.5;
        g.strokeRect(d.box[0] * s, d.box[1] * (240 / (a.frame_size?.[1] ?? img.height)), d.box[2] * s, d.box[3] * (240 / (a.frame_size?.[1] ?? img.height)));
      }
    };
    img.src = url;
    return () => {
      alive = false;
    };
  }, [a, idx]);
  return <canvas ref={ref} className={cx('aspect-[4/3] w-full rounded-lg bg-black', className)} aria-label={`Analysed frame from ${a.camera_id} with detections`} role="img" />;
}

// ------------------------------------------------------------------ zone evidence panel
export function ZonePanel({ zoneId, onClose, onSelectCamera }: { zoneId: string; onClose: () => void; onSelectCamera: (c: string) => void }) {
  const { building, run, navigate, setSelectedZone } = useApp();
  const z = building?.zones.find((x) => x.id === zoneId);
  if (!building || !z) return null;
  const st = run?.zones[z.id];
  const p = run?.belief?.zones[z.id] ?? st?.p_threat ?? 0;
  const cond = run?.belief?.conditional[z.id];
  const cams = building.cameras.filter((c) => c.covers.includes(z.id));
  const routes = (run?.routing?.routes ?? []).filter((r) => r.from === z.id);
  const hot = incidentZones(run).includes(z.id);
  return (
    <Float title={`${z.id} · ${z.name}`} icon={<Building2 size={15} />} onClose={onClose} tone={hot ? 'threat' : undefined} label={`Zone ${z.id}`}>
      <div className="space-y-2.5 p-3">
        <div className="flex items-end gap-3">
          <div>
            <div className="text-[9.5px] uppercase tracking-wider text-ink-400">P(threat here)</div>
            <div className={cx('tnum text-[26px] font-bold leading-none', p >= 0.05 ? 'text-threat-bright' : 'text-ink-100')}>{pct(p, 1)}</div>
          </div>
          <div className="pb-0.5 text-[10.5px] text-ink-400">
            P(here | threat) <span className="tnum text-ink-200">{pct(cond, 0)}</span>
          </div>
          <div className="ml-auto flex flex-col items-end gap-1 pb-0.5 text-[10.5px]">
            <span className="rounded-md border border-white/10 px-1.5 text-ink-300">{z.kind}{z.capacity ? ` · cap ${z.capacity}` : ''}</span>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-2 text-[11.5px]">
          <div className="flex items-center gap-1.5 text-ink-200">
            <span className="h-2 w-2 rounded-full" style={{ background: observedColor(st?.observed ?? 'unobserved'), boxShadow: `0 0 6px ${observedColor(st?.observed ?? 'unobserved')}` }} />
            {st?.observed ?? 'unobserved'}
          </div>
          <div className="flex items-center justify-end gap-1.5 text-ink-200">
            <Users size={12} className="text-accent" />
            <span className="tnum">{st?.persons != null ? num(st.persons, 1) : '—'}</span>
            <span className="text-ink-400">persons</span>
          </div>
        </div>
        {cams.length === 0 && <div className="rounded-lg border border-white/5 px-2 py-1.5 text-[11px] text-ink-400">No camera covers this zone.</div>}
        {cams.map((c) => {
          const cs = run?.cameras[c.id];
          const a = cs?.analysis_id ? run?.analyses[cs.analysis_id] : undefined;
          const act = cs?.activity ? ACTIVITY_TEXT[cs.activity] : null;
          return (
            <div key={c.id} className="space-y-1">
              {a ? <FrameThumb a={a} /> : <div className="flex aspect-[4/3] items-center justify-center rounded-lg bg-ink-950/70 text-[11px] text-ink-500">Not analysed</div>}
              <div className="flex items-center gap-2 text-[11px]">
                <span className="font-mono font-semibold text-ink-100">{c.id}</span>
                {act && <span className={TONE_TEXT[act.tone === 'neutral' ? 'muted' : act.tone]}>{act.label}</span>}
                <button type="button" className="ml-auto text-accent hover:text-accent-bright" onClick={() => onSelectCamera(c.id)}>
                  Feed →
                </button>
              </div>
            </div>
          );
        })}
        {routes.length > 0 && (
          <div className="border-t border-white/5 pt-2">
            <div className="mb-1 text-[9.5px] uppercase tracking-wider text-ink-400">Routes from here</div>
            {routes.map((r) => (
              <div key={r.id} className="flex items-center gap-2 py-0.5 text-[11px]">
                <span className="h-[3px] w-4 rounded-full" style={{ background: routeColor(r.operational_status), boxShadow: `0 0 6px ${routeColor(r.operational_status)}` }} />
                <span className="font-mono text-ink-100">{r.exit ?? 'none'}</span>
                <span className="text-ink-400">{r.math_valid ? 'valid' : 'invalid'}</span>
                <span className="ml-auto text-ink-300">{r.operational_status.replace('_', ' ')}</span>
              </div>
            ))}
          </div>
        )}
        <div className="flex gap-3 border-t border-white/5 pt-2 text-[11px]">
          <button type="button" className="text-accent hover:text-accent-bright" onClick={() => navigate('evidence')}>
            Evidence →
          </button>
          <button
            type="button"
            className="text-accent hover:text-accent-bright"
            onClick={() => {
              setSelectedZone(z.id);
              navigate('twin');
            }}
          >
            Zone table →
          </button>
        </div>
      </div>
    </Float>
  );
}

// ------------------------------------------------------------------ camera feed panel
export function CameraFeedPanel({ onClose, focused }: { onClose?: () => void; focused: boolean }) {
  const { building, run, selectedCamera, selectedAnalysis, openAnalysis, follow, setFollow, scenarios, scenarioId, overrides, navigate, openReview } = useApp();
  const cam = building?.cameras.find((c) => c.id === selectedCamera) ?? building?.cameras[0];
  if (!cam) return null;
  const analyses = run ? Object.values(run.analyses).filter((a) => a.camera_id === cam.id) : [];
  const analysis = analyses.find((a) => a.analysis_id === selectedAnalysis) ?? analyses[analyses.length - 1] ?? null;
  const st = run?.cameras[cam.id];
  const status = effectiveCameraStatus(run, cam.id);
  const scen = scenarios.find((s) => s.id === scenarioId);
  const clip = run?.camera_clips[cam.id] ?? overrides[cam.id] ?? scen?.cameras[cam.id] ?? null;
  const entry = analysis && run ? run.trace.find((e) => e.data?.analysis_id === analysis.analysis_id) : undefined;
  const m = analysis?.motion;
  return (
    <Float
      title={`${cam.id} · ${cam.name}`}
      icon={<CameraIcon size={15} />}
      onClose={focused ? onClose : undefined}
      label="Camera feed"
      defaultOpen
      right={
        <>
          <span className="flex items-center gap-1 text-[10px] text-ink-300">
            <span className="h-1.5 w-1.5 rounded-full" style={{ background: cameraStatusColor(status) }} />
            {status.replace('_', ' ')}
          </span>
          <button
            type="button"
            onClick={() => setFollow((f) => !f)}
            aria-pressed={follow}
            title="Feed follows the camera the agent is analysing"
            aria-label="Feed follows agent"
            className={cx('rounded-md p-0.5', follow ? 'text-accent' : 'text-ink-500 hover:text-ink-200')}
          >
            <Crosshair size={13} />
          </button>
        </>
      }
    >
      <div className="space-y-2 p-2.5">
        <CameraPlayer
          camera={cam}
          state={st && { ...st, status: status as typeof st.status }}
          analyses={analyses}
          analysis={analysis}
          onSelectAnalysis={(aid) => openAnalysis(cam.id, aid)}
          previewUrl={clip ? api.previewUrl(clip) : null}
          baseTime={entry && run ? run.started_at + entry.t : null}
          hideHeader
        />
        {analysis && (
          <div className="grid grid-cols-4 gap-1.5 text-center">
            {[
              ['people', analysis.persons ? num(analysis.persons.count_median, 0) : '—'],
              ['BH/s', m?.speed_bh_s_median != null ? num(m.speed_bh_s_median) : '—'],
              ['rel.', num(analysis.quality?.reliability ?? null)],
              ['DNN', ms(analysis.timings?.detect_ms)],
            ].map(([k, v]) => (
              <div key={k} className="rounded-lg bg-white/[0.03] py-1">
                <div className="tnum text-[13px] font-semibold text-ink-100">{v}</div>
                <div className="text-[9px] uppercase tracking-wider text-ink-400">{k}</div>
              </div>
            ))}
          </div>
        )}
        {analysis && (
          <button type="button" className="btn-primary w-full py-1.5 text-[12px]" onClick={() => openReview(cam.id)}>
            <Maximize2 size={13} /> Inspect footage full-size
          </button>
        )}
        {st?.evidence?.location && (
          <div className={cx('rounded-md px-2 py-1 text-[10.5px]', st.evidence.location.zone ? 'bg-clear-dim/40 text-clear-bright' : 'bg-caution-dim/40 text-caution-bright')}>
            Location: {st.evidence.location.zone ? `${st.evidence.location.zone} (${st.evidence.location.status.replace('_', '-')})` : `unknown — camera mounted in ${st.evidence.location.camera_zone}`}
          </div>
        )}
        <div className="flex items-center gap-2 text-[10.5px] text-ink-400">
          {st?.evidence ? <span className="truncate text-ink-200">{st.evidence.activity_label}</span> : <span>{analysis ? enhanceLabel(analysis.params?.enhance) : 'awaiting analysis'}</span>}
          <button type="button" className="ml-auto shrink-0 text-accent hover:text-accent-bright" onClick={() => navigate('evidence')}>
            Evidence →
          </button>
        </div>
      </div>
    </Float>
  );
}

// ------------------------------------------------------------------ HUD
export function SceneHud({
  level,
  floors,
  floorId,
  buildingName,
  focusLabel,
  onLevel,
  onFloor,
  layers,
  onLayers,
  flyFollow,
  onFlyFollow,
}: {
  level: ViewLevel;
  floors: Floor[];
  floorId: string;
  buildingName: string;
  focusLabel: string | null;
  onLevel: (l: ViewLevel) => void;
  onFloor: (id: string) => void;
  layers: Layers;
  onLayers: (l: Layers) => void;
  flyFollow: boolean;
  onFlyFollow: () => void;
}) {
  const [layersOpen, setLayersOpen] = useState(false);
  const lref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!layersOpen) return;
    const h = (e: MouseEvent) => lref.current && !lref.current.contains(e.target as Node) && setLayersOpen(false);
    const k = (e: KeyboardEvent) => e.key === 'Escape' && setLayersOpen(false);
    document.addEventListener('mousedown', h);
    document.addEventListener('keydown', k);
    return () => {
      document.removeEventListener('mousedown', h);
      document.removeEventListener('keydown', k);
    };
  }, [layersOpen]);
  const floor = floors.find((f) => f.id === floorId) ?? floors[0];
  const crumb = (label: string, l: ViewLevel, active: boolean) => (
    <button type="button" onClick={() => onLevel(l)} aria-current={active ? 'location' : undefined} className={cx('rounded px-1 transition-colors', active ? 'text-ink-100' : 'text-ink-400 hover:text-accent-bright')}>
      {label}
    </button>
  );
  const LV: [ViewLevel, string, ReactNode][] = [
    ['campus', 'Campus', <Mountain key="c" size={13} />],
    ['building', 'Building', <Building2 key="b" size={13} />],
    ['floor', 'Floor', <Layers3 key="f" size={13} />],
  ];
  const LAYER_LABELS: [keyof Layers, string][] = [
    ['heat', 'Threat heat'],
    ['region', 'Incident region'],
    ['routes', 'Evacuation routes'],
    ['movement', 'Measured movement'],
    ['people', 'Person counts'],
    ['cameras', 'Cameras'],
    ['labels', 'Labels'],
  ];
  return (
    <div className="pointer-events-auto flex flex-col items-center gap-1.5">
      <nav aria-label="Scene breadcrumb" className="flex items-center gap-0.5 rounded-full border border-white/10 bg-[rgba(5,14,27,0.62)] px-3 py-1 text-[11.5px] backdrop-blur-xl">
        {crumb('Campus', 'campus', level === 'campus')}
        <ChevronRight size={12} className="text-ink-600" />
        {crumb(buildingName, 'building', level === 'building')}
        {level !== 'campus' && (
          <>
            <ChevronRight size={12} className="text-ink-600" />
            {crumb(floor?.name ?? 'Ground (L0)', 'floor', level === 'floor')}
          </>
        )}
        {focusLabel && (
          <>
            <ChevronRight size={12} className="text-ink-600" />
            <span className="px-1 font-mono text-accent-bright">{focusLabel}</span>
          </>
        )}
      </nav>
      <div className="flex items-center gap-1.5">
        <div role="group" aria-label="View level" className="flex rounded-full border border-white/10 bg-[rgba(5,14,27,0.62)] p-0.5 backdrop-blur-xl">
          {LV.map(([l, label, icon]) => (
            <button
              key={l}
              type="button"
              onClick={() => onLevel(l)}
              aria-pressed={level === l}
              className={cx('flex items-center gap-1.5 rounded-full px-3 py-1 text-[11.5px] font-medium transition-all', level === l ? 'bg-gradient-to-b from-accent/45 to-accent/15 text-white shadow-glow-cyan' : 'text-ink-300 hover:text-ink-100')}
            >
              {icon}
              {label}
            </button>
          ))}
        </div>
        <label className="flex items-center gap-1 rounded-full border border-white/10 bg-[rgba(5,14,27,0.62)] py-0.5 pl-2.5 pr-1 text-[11px] text-ink-300 backdrop-blur-xl" title="Floors derived from the building model">
          <Layers3 size={12} className="text-accent" />
          <span className="sr-only">Floor</span>
          <select value={floor?.id} onChange={(e) => onFloor(e.target.value)} className="cursor-pointer rounded-full bg-transparent py-0.5 pr-1 text-[11px] text-ink-100 outline-none" aria-label="Floor">
            {floors.map((f) => (
              <option key={f.id} value={f.id} className="bg-ink-900">
                {f.name}
              </option>
            ))}
          </select>
        </label>
        <div ref={lref} className="relative">
          <button type="button" onClick={() => setLayersOpen((o) => !o)} aria-expanded={layersOpen} aria-label="Scene layers" className="flex h-[30px] items-center gap-1 rounded-full border border-white/10 bg-[rgba(5,14,27,0.62)] px-2.5 text-[11px] text-ink-200 backdrop-blur-xl hover:border-accent/40">
            <LayersIcon size={13} className="text-accent" />
            {Object.values(layers).filter(Boolean).length}/{Object.keys(DEFAULT_LAYERS).length}
          </button>
          {layersOpen && (
            <div role="group" aria-label="Scene layers" className="fade-in absolute right-0 top-[calc(100%+6px)] z-50 w-52 rounded-xl border border-accent/20 bg-ink-900/95 p-1.5 shadow-2xl backdrop-blur-xl">
              {LAYER_LABELS.map(([k, label]) => (
                <label key={k} className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-[11.5px] text-ink-100 hover:bg-white/5">
                  <input type="checkbox" checked={layers[k]} onChange={(e) => onLayers({ ...layers, [k]: e.target.checked })} className={cx('h-3.5 w-3.5', k === 'region' || k === 'heat' ? 'accent-[#ef4444]' : 'accent-[#22d3ee]')} />
                  {label}
                </label>
              ))}
            </div>
          )}
        </div>
        <button
          type="button"
          onClick={onFlyFollow}
          aria-pressed={flyFollow}
          title="Fly the view to each camera the agent analyses"
          aria-label="Fly to agent's camera"
          className={cx('flex h-[30px] items-center gap-1 rounded-full border px-2.5 text-[11px] backdrop-blur-xl', flyFollow ? 'border-accent/60 bg-accent/15 text-accent-bright' : 'border-white/10 bg-[rgba(5,14,27,0.62)] text-ink-300 hover:text-ink-100')}
        >
          <Crosshair size={12} />
          Follow
        </button>
      </div>
    </div>
  );
}

export function MapControls({ onZoom, onFit, needle }: { onZoom: (k: number) => void; onFit: () => void; needle: React.MutableRefObject<HTMLDivElement | null> }) {
  return (
    <div className="pointer-events-auto flex flex-col items-center gap-2">
      <div className="flex h-12 w-12 items-center justify-center rounded-full border border-white/10 bg-[rgba(5,14,27,0.62)] backdrop-blur-xl" role="img" aria-label="Compass">
        <div ref={needle} className="relative h-full w-full">
          <span className="absolute left-1/2 top-0.5 -translate-x-1/2 text-[8.5px] font-bold text-accent-bright">N</span>
          <span className="absolute left-1/2 top-1/2 h-4 w-[2px] -translate-x-1/2 -translate-y-full rounded bg-gradient-to-t from-transparent to-accent-bright" />
        </div>
      </div>
      <div className="flex flex-col overflow-hidden rounded-full border border-white/10 bg-[rgba(5,14,27,0.62)] backdrop-blur-xl">
        <button type="button" aria-label="Zoom in" onClick={() => onZoom(1.3)} className="p-2 text-ink-200 hover:bg-accent/15 hover:text-white">
          <Plus size={14} />
        </button>
        <button type="button" aria-label="Zoom out" onClick={() => onZoom(0.77)} className="border-t border-white/5 p-2 text-ink-200 hover:bg-accent/15 hover:text-white">
          <Minus size={14} />
        </button>
        <button type="button" aria-label="Recentre view" onClick={onFit} className="border-t border-white/5 p-2 text-ink-200 hover:bg-accent/15 hover:text-white">
          <Maximize2 size={13} />
        </button>
      </div>
    </div>
  );
}

export function SceneLegend() {
  const items: [string, string][] = [
    ['verified', '#2dd4bf'],
    ['unverified', '#f59e0b'],
    ['exposed', '#ef4444'],
    ['movement', '#ff8a9a'],
  ];
  return (
    <div className="pointer-events-auto flex flex-wrap items-center gap-x-3 gap-y-1 rounded-full border border-white/10 bg-[rgba(5,14,27,0.55)] px-3 py-1 text-[10px] text-ink-300 backdrop-blur-xl">
      <span className="flex items-center gap-1.5">
        <span className="h-1.5 w-8 rounded-full" style={{ background: `linear-gradient(90deg, ${threatColor(0, 1)}, ${threatColor(1, 1)})` }} />
        P(threat)
      </span>
      {items.map(([l, c]) => (
        <span key={l} className="flex items-center gap-1">
          <span className="h-[3px] w-3 rounded-full" style={{ background: c, boxShadow: `0 0 5px ${c}` }} />
          {l}
        </span>
      ))}
      <span className="text-ink-500" title="Terrain, roads, parking, field, trees and lamps are decorative. Only the school building and live layers come from data.">
        site context illustrative
      </span>
    </div>
  );
}

// ------------------------------------------------------------------ 2D fallback + screen-reader list
export function PlanSVG({ b, run, selectedZone, onZone }: { b: Building; run: RunState | null; selectedZone: string | null; onZone: (z: string) => void }) {
  const [x0, y0, x1, y1] = b.bounds;
  const { pz, maxP } = zoneHeat(b, run);
  const hot = new Set(incidentZones(run));
  const pts = (p: Vec2[]) => p.map(([x, y]) => `${x},${-y}`).join(' ');
  return (
    <svg viewBox={`${x0 - 6} ${-y1 - 6} ${x1 - x0 + 12} ${y1 - y0 + 12}`} className="h-full w-full" role="img" aria-label="2D plan of the building">
      {b.zones.map((z) => (
        <polygon
          key={z.id}
          points={pts(z.polygon)}
          fill={hot.has(z.id) ? (run?.belief?.localized ? '#b91c1c' : '#b45309') : threatColor(pz[z.id], maxP)}
          stroke={selectedZone === z.id ? '#a5f3fc' : '#22d3ee'}
          strokeOpacity={selectedZone === z.id ? 1 : 0.4}
          strokeWidth={0.4}
          onClick={() => onZone(z.id)}
          className="cursor-pointer"
        >
          <title>{`${z.id} ${z.name}: P ${pct(pz[z.id], 1)}`}</title>
        </polygon>
      ))}
      {(run?.routing?.routes ?? []).map((r) => (
        <polyline key={r.id} points={pts(routePolyline(r, b))} fill="none" stroke={routeColor(r.operational_status)} strokeWidth={0.6} strokeDasharray={r.safe ? undefined : '1.5 1'} />
      ))}
      {b.zones.map((z) => (
        <text key={`t${z.id}`} x={z.centroid[0]} y={-z.centroid[1]} fontSize={2.2} fill="#e4ecf6" textAnchor="middle">
          {z.id}
        </text>
      ))}
      {b.cameras.map((c) => (
        <circle key={c.id} cx={c.position[0]} cy={-c.position[1]} r={1} fill={cameraStatusColor(effectiveCameraStatus(run, c.id))} />
      ))}
      {b.exits.map((e) => (
        <rect key={e.id} x={e.position[0] - 1} y={-e.position[1] - 1} width={2} height={2} fill={run?.routing?.blocked_exits.includes(e.id) ? '#ef4444' : '#2dd4bf'} />
      ))}
    </svg>
  );
}

export function ZoneListSR({ b, run, onZone }: { b: Building; run: RunState | null; onZone: (z: string) => void }) {
  return (
    <div className="sr-only">
      <h2>Zones (text alternative to the 3D twin)</h2>
      <ul>
        {b.zones.map((z) => (
          <li key={z.id}>
            <button type="button" onClick={() => onZone(z.id)}>
              {z.id} {z.name}: P(threat) {pct(run?.belief?.zones[z.id] ?? 0, 1)}, {run?.zones[z.id]?.observed ?? 'unobserved'}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

export { MapIcon };
