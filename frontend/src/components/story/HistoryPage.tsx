import { useEffect, useMemo, useState } from 'react';
import { ArrowLeft, Camera, Check, CircleCheck, CircleX, Clock, Hourglass, Loader2, Printer, Repeat, Route, ScanEye, ShieldAlert, Ban, VideoOff, X, Play } from 'lucide-react';
import { api } from '../../api';
import { useApp } from '../../context';
import type { RunState } from '../../types';
import { composeSummary, priorityOf } from '../../lib/derive';
import { pct } from '../../lib/format';
import { routeColor } from '../../lib/colors';
import { fmtDuration, PROCEDURE_SHORT, runOutcome, runStats, triggerKind, type OutcomeState } from '../../lib/story';
import { ReportView } from '../../pages';
import { cx } from '../ui';
import { Ring } from '../viz';
import { GlassCard, PlanThumb, ProcBadge, ProcIcon, SectionHead, Stat, TriggerIcon } from './common';

const OUTCOME_STYLE: Record<OutcomeState, { icon: React.ReactNode; cls: string }> = {
  approved: { icon: <CircleCheck size={13} />, cls: 'border-clear/50 bg-clear-dim text-clear-bright' },
  pending: { icon: <Hourglass size={13} />, cls: 'border-caution/50 bg-caution-dim text-caution-bright' },
  running: { icon: <Loader2 size={13} className="animate-spin" />, cls: 'border-info/50 bg-info-dim text-info-bright' },
  rejected: { icon: <CircleX size={13} />, cls: 'border-threat/50 bg-threat-dim text-threat-bright' },
  cancelled: { icon: <Ban size={13} />, cls: 'border-white/25 bg-black/60 text-ink-100' },
  error: { icon: <X size={13} />, cls: 'border-threat/50 bg-threat-dim text-threat-bright' },
  complete: { icon: <Check size={13} />, cls: 'border-white/25 bg-black/60 text-ink-100' },
};

function OutcomeBadge({ r }: { r: RunState }) {
  const o = runOutcome(r);
  const st = OUTCOME_STYLE[o.state];
  return (
    <span className={cx('inline-flex items-center gap-1.5 rounded-full border px-2 py-[3px] text-[11px] font-semibold', st.cls)}>
      {st.icon}
      {o.label}
    </span>
  );
}

function EmptyIllustration() {
  return (
    <svg width="220" height="140" viewBox="0 0 220 140" aria-hidden className="mx-auto">
      <defs>
        <linearGradient id="hg" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0" stopColor="#22d3ee" stopOpacity="0.5" />
          <stop offset="1" stopColor="#22d3ee" stopOpacity="0" />
        </linearGradient>
      </defs>
      <ellipse cx="110" cy="122" rx="90" ry="10" fill="#22d3ee" opacity="0.08" />
      {[0, 1, 2].map((i) => (
        <rect key={i} x={40 + i * 18} y={30 + i * 14} width="120" height="70" rx="10" fill="#0b1c30" stroke="#22d3ee" strokeOpacity={0.25 + i * 0.25} />
      ))}
      <path d="M90 92 L110 72 L124 84 L146 64" fill="none" stroke="url(#hg)" strokeWidth="3" />
      <circle cx="146" cy="64" r="4" fill="#22d3ee" />
      <path d="M180 30 l6 -6 m-6 0 l6 6" stroke="#5eead4" strokeWidth="2" strokeLinecap="round" />
      <circle cx="34" cy="40" r="2" fill="#5eead4" />
    </svg>
  );
}

function RunCard({ id, r, status, onOpen, active }: { id: string; r: RunState | null; status: 'ok' | 'missing' | 'loading'; onOpen: () => void; active: boolean }) {
  const st = r ? runStats(r) : null;
  const prio = priorityOf(r?.belief?.p_threat);
  return (
    <button
      type="button"
      onClick={onOpen}
      disabled={!r}
      aria-label={`Open run ${id}`}
      className={cx(
        'group fade-in flex w-full flex-col overflow-hidden rounded-2xl border text-left transition-all',
        active ? 'border-accent/70 shadow-[0_0_30px_-8px_rgba(34,211,238,0.55)]' : 'border-accent/15 hover:border-accent/40',
        'bg-[rgba(6,16,30,0.7)] backdrop-blur-xl',
      )}
    >
      <div className="relative aspect-[16/7] w-full overflow-hidden bg-black/40">
        {st?.thumb ? <img src={st.thumb} alt="" loading="lazy" className="h-full w-full object-cover opacity-85 transition-transform duration-500 group-hover:scale-[1.04]" /> : <div className="flex h-full items-center justify-center text-ink-500">{status === 'loading' ? <Loader2 className="animate-spin" /> : <VideoOff />}</div>}
        <div className="absolute inset-0 bg-gradient-to-t from-[#06101e] via-[#06101e]/40 to-transparent" />
        {r && (
          <div className="absolute left-3 top-3 flex items-center gap-1.5">
            <span className="flex h-7 w-7 items-center justify-center rounded-full border border-white/15 bg-black/60 text-ink-100 backdrop-blur">
              <TriggerIcon kind={triggerKind(r.scenario.trigger.source)} size={13} />
            </span>
            <OutcomeBadge r={r} />
          </div>
        )}
        {r && (
          <div className="absolute right-3 top-2.5">
            <Ring value={r.belief?.p_threat ?? null} tone={prio.tone} size={46} stroke={4} label={<span className="tnum text-[11px] font-bold text-white">{pct(r.belief?.p_threat)}</span>} />
          </div>
        )}
        <div className="absolute bottom-2.5 left-3 right-3">
          <div className="truncate text-[15px] font-semibold text-white [text-shadow:0_2px_8px_rgba(0,0,0,0.8)]">{r?.scenario.title ?? (status === 'missing' ? 'No longer on server' : 'Loading…')}</div>
          <div className="font-mono text-[10px] text-ink-300">{id}</div>
        </div>
      </div>
      {r && st && (
        <div className="flex items-center gap-3 px-3 py-2.5">
          {runOutcome(r).recommended ? <ProcBadge id={runOutcome(r).approved ?? runOutcome(r).recommended!} tone={runOutcome(r).approved ? 'clear' : 'muted'} /> : <span className="text-[11px] text-ink-400">no recommendation</span>}
          <div className="ml-auto flex items-center gap-3 text-[11px] text-ink-300">
            <span className="flex items-center gap-1" title="Agent time">
              <Clock size={12} className="text-accent" />
              {fmtDuration(st.durationS)}
            </span>
            <span className="flex items-center gap-1" title="Cameras analysed">
              <Camera size={12} className="text-accent" />
              {st.analysed}
            </span>
            <span className={cx('flex items-center gap-1', st.faults ? 'text-caution-bright' : '')} title="Camera faults">
              <VideoOff size={12} />
              {st.faults}
            </span>
          </div>
        </div>
      )}
    </button>
  );
}

function RunDetail({ r, onBack }: { r: RunState; onBack: () => void }) {
  const { building, openAnalysis, navigate } = useApp();
  const o = runOutcome(r);
  const st = runStats(r);
  const prio = priorityOf(r.belief?.p_threat);
  const rec = r.assessment?.options.find((x) => x.id === o.recommended);
  const analyses = Object.values(r.analyses);
  return (
    <div className="space-y-4">
      <div className="screen-only space-y-4">
        <GlassCard className="overflow-hidden" aria-label="Run summary">
          <div className="flex flex-wrap items-center gap-4 p-4">
            <button type="button" onClick={onBack} aria-label="Back to all runs" className="rounded-full border border-white/10 p-2 text-ink-300 hover:text-ink-100">
              <ArrowLeft size={15} />
            </button>
            <Ring value={r.belief?.p_threat ?? null} tone={prio.tone} size={72} stroke={6} />
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <OutcomeBadge r={r} />
                <span className="font-mono text-[10.5px] text-ink-400">#{r.run_id} · read-only</span>
              </div>
              <h2 className="mt-1 truncate text-[19px] font-semibold text-ink-100">{r.scenario.trigger.claim}</h2>
              <div className="text-[11.5px] text-ink-400">
                {r.scenario.title} · {new Date(r.started_at * 1000).toLocaleString()}
              </div>
            </div>
            <button type="button" className="btn-ghost" onClick={() => window.print()}>
              <Printer size={14} /> Print report
            </button>
          </div>
          <div className="grid grid-cols-2 gap-4 border-t border-white/5 px-4 py-3 md:grid-cols-5">
            <Stat icon={<Clock size={14} />} value={fmtDuration(st.durationS)} label="agent time" />
            <Stat icon={<Camera size={14} />} value={st.analysed} label="cameras" />
            <Stat icon={<Repeat size={14} />} value={st.reanalyses} label="re-analyses" />
            <Stat icon={<VideoOff size={14} />} value={st.faults} label="faults" tone={st.faults ? 'text-caution-bright' : undefined} />
            <Stat icon={<ScanEye size={14} />} value={st.steps} label="steps" />
          </div>
        </GlassCard>
        <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
          <GlassCard aria-label="Decision">
            <SectionHead icon={<ShieldAlert size={16} />} title="Decision" />
            <div className="space-y-3 px-4 pb-4">
              <div className="flex flex-wrap items-center gap-2">
                {o.recommended && (
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] uppercase tracking-wider text-ink-400">Recommended</span>
                    <ProcBadge id={o.recommended} />
                  </div>
                )}
                {o.approved && (
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] uppercase tracking-wider text-ink-400">Approved</span>
                    <ProcBadge id={o.approved} tone="clear" />
                  </div>
                )}
                {o.rejected.map((x, i) => (
                  <ProcBadge key={i} id={x} tone="threat" />
                ))}
              </div>
              {rec && (
                <ul className="grid gap-1.5 sm:grid-cols-2">
                  {rec.preconditions.map((p) => (
                    <li key={p.check} className="flex items-start gap-1.5 text-[11.5px]" title={p.detail}>
                      {p.pass ? <Check size={14} className="mt-[1px] shrink-0 text-clear" /> : <X size={14} className="mt-[1px] shrink-0 text-threat-bright" />}
                      <span className="text-ink-200">{p.check}</span>
                    </li>
                  ))}
                </ul>
              )}
              <details className="text-[11.5px]">
                <summary className="cursor-pointer text-ink-300 hover:text-ink-100">Summary</summary>
                <p className="mt-1 leading-relaxed text-ink-300">{composeSummary(r)}</p>
              </details>
              <details className="text-[11.5px]" open={r.review_history.length > 0}>
                <summary className="cursor-pointer text-ink-300 hover:text-ink-100">Reviews · {r.review_history.length}</summary>
                <ul className="mt-1 space-y-1">
                  {r.review_history.map((h, i) => (
                    <li key={i} className="flex items-center gap-2 text-ink-200">
                      <span className="tnum font-mono text-[10px] text-ink-400">{new Date(h.at * 1000).toLocaleTimeString()}</span>
                      {h.reviewer ?? 'reviewer'} · {h.action}
                      {h.option_id ? ` ${PROCEDURE_SHORT[h.option_id] ?? h.option_id}` : ''}
                      {h.exit_id ? ` ${h.exit_id}` : ''}
                      {h.note && <span className="text-ink-400">“{h.note}”</span>}
                    </li>
                  ))}
                </ul>
              </details>
              {r.action_log.length > 0 && (
                <details className="text-[11.5px]">
                  <summary className="cursor-pointer text-ink-300 hover:text-ink-100">Simulated action log · {r.action_log.length}</summary>
                  <ul className="mt-1 space-y-0.5 font-mono text-[10.5px] text-ink-300">
                    {r.action_log.map((l, i) => (
                      <li key={i}>{l}</li>
                    ))}
                  </ul>
                </details>
              )}
            </div>
          </GlassCard>
          <GlassCard aria-label="Where">
            <SectionHead icon={<Route size={16} />} title="Region & routes" />
            <div className="grid gap-3 px-4 pb-4 sm:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]">
              {building && <PlanThumb b={building} hot={r.routing?.hazard_zones ?? (r.belief?.localized ? r.belief.region : [])} ring={r.routing?.exclusion_zones ?? []} className="h-[130px] w-full rounded-xl bg-black/25 p-1" />}
              <ul className="space-y-1 text-[11px]">
                {(r.routing?.routes ?? []).map((rt) => (
                  <li key={rt.id} className="flex items-center gap-2" title={rt.path.join(' › ')}>
                    <span className="h-[3px] w-4 rounded" style={{ background: routeColor(rt.operational_status) }} />
                    <span className="font-mono text-ink-100">
                      {rt.from}→{rt.exit ?? '—'}
                    </span>
                    <span className="ml-auto text-ink-400">{rt.math_valid ? '✓' : '✗'} {rt.operational_status.replace('_', ' ')}</span>
                  </li>
                ))}
                {!r.routing && <li className="text-ink-400">No routes computed.</li>}
              </ul>
            </div>
          </GlassCard>
        </div>
        {analyses.length > 0 && (
          <GlassCard aria-label="Evidence">
            <SectionHead icon={<ScanEye size={16} />} title={`Evidence · ${analyses.length}`} />
            <div className="flex gap-2 overflow-x-auto px-4 pb-4 scroll-thin">
              {analyses.map((a) => (
                <button
                  key={a.analysis_id}
                  type="button"
                  className="w-[150px] shrink-0 overflow-hidden rounded-xl border border-white/10 text-left hover:border-accent/50"
                  onClick={() => {
                    openAnalysis(a.camera_id, a.analysis_id);
                    navigate('evidence');
                  }}
                  title={`Open ${a.analysis_id}`}
                >
                  <img src={a.frame_urls[Math.floor(a.frame_urls.length / 2)]} alt="" loading="lazy" className="aspect-[4/3] w-full object-cover" />
                  <div className="flex items-center gap-1 px-2 py-1 text-[10.5px]">
                    <span className="font-mono text-ink-100">{a.camera_id.replace('CAM-', 'C')}</span>
                    <span className="text-ink-400">{a.params?.enhance === 'none' ? 'raw' : a.params?.enhance}</span>
                    <span className="ml-auto tnum text-ink-300">{a.persons ? Math.round(a.persons.count_median) : 0}</span>
                    <Play size={10} className="text-accent" />
                  </div>
                </button>
              ))}
            </div>
          </GlassCard>
        )}
      </div>
      {/* full printable report — only rendered when printing */}
      <div className="print-only">
        <ReportView r={r} live={false} />
      </div>
    </div>
  );
}

export function HistoryPage() {
  const { sessionRuns, run: current, historyRunId, openHistory, startRun, scenarios, scenarioId } = useApp();
  const [runs, setRuns] = useState<Record<string, RunState | 'missing' | 'loading'>>({});
  const ids = useMemo(() => sessionRuns.map((r) => r.id), [sessionRuns]);
  useEffect(() => {
    let alive = true;
    for (const id of ids) {
      if (current && id === current.run_id) continue;
      const cur = runs[id];
      if (cur && cur !== 'loading' && (cur === 'missing' || !['running', 'awaiting_review'].includes(cur.status))) continue;
      if (cur === 'loading') continue;
      setRuns((m) => ({ ...m, [id]: 'loading' }));
      api
        .getRun(id)
        .then((r) => alive && setRuns((m) => ({ ...m, [id]: r })))
        .catch(() => alive && setRuns((m) => ({ ...m, [id]: 'missing' })));
    }
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ids.join(','), current?.run_id]);
  const get = (id: string): RunState | 'missing' | 'loading' | undefined => (current && id === current.run_id ? current : runs[id]);
  const open = historyRunId ? get(historyRunId) : undefined;

  if (ids.length === 0) {
    const sc = scenarios.find((s) => s.id === scenarioId);
    return (
      <GlassCard className="mx-auto mt-10 flex max-w-lg flex-col items-center gap-3 p-10 text-center">
        <EmptyIllustration />
        <h2 className="text-[18px] font-semibold text-ink-100">No incidents yet</h2>
        <p className="text-[12.5px] text-ink-400">Runs you start in this browser session appear here.</p>
        <button type="button" className="btn-primary px-5 py-2" onClick={() => void startRun()}>
          <Play size={14} /> Run {sc?.title ?? 'scenario'}
        </button>
      </GlassCard>
    );
  }
  if (open && open !== 'loading' && open !== 'missing') {
    return (
      <div className="wide:h-full wide:overflow-y-auto wide:pr-1 scroll-thin">
        <RunDetail r={open} onBack={() => openHistory(null)} />
      </div>
    );
  }
  return (
    <div className="wide:h-full wide:overflow-y-auto wide:pr-1 scroll-thin">
      <div className="mb-3 flex items-center gap-3 text-[11.5px] text-ink-400">
        <span className="tnum text-[22px] font-bold text-ink-100">{ids.length}</span> runs this session
      </div>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3 min-[1800px]:grid-cols-4">
        {sessionRuns.map((s) => {
          const r = get(s.id);
          const ok = r && r !== 'missing' && r !== 'loading' ? r : null;
          return <RunCard key={s.id} id={s.id} r={ok} status={r === 'missing' ? 'missing' : ok ? 'ok' : 'loading'} active={historyRunId === s.id} onOpen={() => openHistory(s.id)} />;
        })}
      </div>
    </div>
  );
}

export { ProcIcon };
