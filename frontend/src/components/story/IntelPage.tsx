import { useMemo, useState } from 'react';
import {
  Activity,
  AlertTriangle,
  Brain,
  Check,
  ChevronDown,
  Eye,
  Gauge as GaugeIcon,
  ListTree,
  Play,
  Search,
  ShieldCheck,
  Sparkles,
  UserCheck,
  X,
  Zap,
} from 'lucide-react';
import { useApp } from '../../context';
import type { ResponseOption, RunState, TraceEntry } from '../../types';
import { priorityOf, uncertaintyLevel } from '../../lib/derive';
import { compactArgs, ms, parseChange, pct } from '../../lib/format';
import { phaseStyle } from '../../lib/colors';
import { filterTrace, PHASES, phaseCounts, PROCEDURE_ORDER, PROCEDURE_SHORT, type MainPhase } from '../../lib/story';
import { ReviewFloat } from '../scene/panels';
import { cx } from '../ui';
import { Ring, TONE_HEX, TONE_TEXT } from '../viz';
import { Gauge, GlassCard, ProcIcon, SectionHead } from './common';

const PHASE_ICON: Record<string, React.ReactNode> = {
  PERCEIVE: <Eye size={15} />,
  VALIDATE: <ShieldCheck size={15} />,
  DECIDE: <Brain size={15} />,
  ACT: <Zap size={15} />,
  REVIEW: <UserCheck size={15} />,
  ARCHIVE: <ListTree size={15} />,
  ERROR: <AlertTriangle size={15} />,
};
const PHASE_LABEL: Record<MainPhase, string> = { PERCEIVE: 'Perceive', VALIDATE: 'Validate', DECIDE: 'Decide', ACT: 'Act', REVIEW: 'Review' };

function BeliefChart({ run }: { run: RunState }) {
  const h = run.belief_history;
  const W = 520, H = 150, P = 34;
  if (h.length === 0) return <div className="flex h-[150px] items-center justify-center text-[12px] text-ink-400">No belief updates yet</div>;
  const steps = h.map((x) => x.step);
  const s0 = Math.min(...steps), s1 = Math.max(...steps, s0 + 1);
  const X = (s: number) => P + ((s - s0) / (s1 - s0)) * (W - P - 8);
  const Y = (v: number) => H - 18 - v * (H - 30);
  const line = (k: 'p_threat' | 'region_mass' | 'entropy') => h.map((p, i) => `${i ? 'L' : 'M'}${X(p.step).toFixed(1)},${Y(p[k]).toFixed(1)}`).join(' ');
  const series: [keyof (typeof h)[number] & ('p_threat' | 'region_mass' | 'entropy'), string, string][] = [
    ['p_threat', '#ef4444', 'P(threat)'],
    ['region_mass', '#22d3ee', 'Region mass'],
    ['entropy', '#a78bfa', 'Entropy'],
  ];
  return (
    <div>
      <svg viewBox={`0 0 ${W} ${H}`} className="h-[150px] w-full" role="img" aria-label="Belief over agent steps">
        {[0, 0.5, 1].map((v) => (
          <g key={v}>
            <line x1={P} x2={W - 8} y1={Y(v)} y2={Y(v)} stroke="rgba(148,170,196,0.12)" strokeDasharray="3 4" />
            <text x={P - 6} y={Y(v) + 3} fontSize="9" fill="#6782a3" textAnchor="end">
              {v * 100}%
            </text>
          </g>
        ))}
        <path d={`${line('p_threat')} L${X(h[h.length - 1].step)},${H - 18} L${X(h[0].step)},${H - 18} Z`} fill="rgba(239,68,68,0.10)" />
        {series.map(([k, c]) => (
          <path key={k} d={line(k)} fill="none" stroke={c} strokeWidth={k === 'p_threat' ? 2.4 : 1.6} strokeDasharray={k === 'entropy' ? '4 3' : undefined} style={{ filter: `drop-shadow(0 0 3px ${c})` }} />
        ))}
        {h.map((p) => (
          <circle key={p.step} cx={X(p.step)} cy={Y(p.p_threat)} r={2.6} fill="#ef4444">
            <title>{`step ${p.step}: P ${pct(p.p_threat)}, mass ${pct(p.region_mass)}, entropy ${p.entropy.toFixed(2)}`}</title>
          </circle>
        ))}
        <text x={P} y={H - 4} fontSize="9" fill="#6782a3">
          step {s0}
        </text>
        <text x={W - 8} y={H - 4} fontSize="9" fill="#6782a3" textAnchor="end">
          step {s1}
        </text>
      </svg>
      <div className="flex gap-3 text-[10.5px] text-ink-300">
        {series.map(([k, c, l]) => (
          <span key={k} className="flex items-center gap-1.5">
            <span className="h-[3px] w-4 rounded" style={{ background: c }} />
            {l}
          </span>
        ))}
      </div>
    </div>
  );
}

function OptionTile({ o, recommended, open, onToggle }: { o: ResponseOption; recommended: boolean; open: boolean; onToggle: () => void }) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-expanded={open}
      className={cx(
        'relative flex flex-col gap-2 rounded-xl border p-3 text-left transition-all',
        recommended ? 'border-accent/60 bg-accent/10 shadow-[0_0_26px_-8px_rgba(34,211,238,0.6)]' : o.feasible ? 'border-white/10 bg-white/[0.03] hover:border-accent/40' : 'border-white/5 bg-black/20 opacity-75 hover:opacity-100',
        open && 'ring-1 ring-accent/60',
      )}
    >
      <div className="flex items-center gap-2">
        <span className={cx('flex h-9 w-9 items-center justify-center rounded-lg', recommended ? 'bg-accent/25 text-accent-bright' : o.feasible ? 'bg-white/5 text-ink-100' : 'bg-white/5 text-ink-400')}>
          <ProcIcon id={o.id} size={18} />
        </span>
        <span className="ml-auto flex items-center gap-1">
          {o.rejected_by_reviewer && <span className="rounded-full bg-threat-dim px-1.5 text-[9.5px] font-semibold text-threat-bright">rejected</span>}
          <span className={cx('flex h-5 w-5 items-center justify-center rounded-full', o.feasible ? 'bg-clear/20 text-clear-bright' : 'bg-threat/15 text-threat-bright')} title={o.feasible ? 'Feasible' : 'Blocked'}>
            {o.feasible ? <Check size={12} strokeWidth={3} /> : <X size={12} strokeWidth={3} />}
          </span>
        </span>
      </div>
      <div className="text-[13px] font-semibold leading-tight text-ink-100">{PROCEDURE_SHORT[o.id] ?? o.id}</div>
      <div className="flex items-center gap-2">
        <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-white/10">
          <div className="h-full rounded-full transition-[width] duration-700" style={{ width: `${Math.max(2, o.score * 100)}%`, background: recommended ? '#22d3ee' : o.feasible ? '#2dd4bf' : '#475569' }} />
        </div>
        <span className="tnum text-[11px] font-semibold text-ink-200">{o.score.toFixed(2)}</span>
      </div>
      <div className="flex gap-0.5" aria-label="Preconditions">
        {o.preconditions.map((p) => (
          <span key={p.check} title={p.check} className={cx('h-1 flex-1 rounded-full', p.pass ? 'bg-clear' : 'bg-threat/70')} />
        ))}
      </div>
      {recommended && <span className="absolute -top-2 left-3 rounded-full bg-accent px-2 text-[9px] font-bold uppercase tracking-wider text-ink-950">Recommended</span>}
    </button>
  );
}

function OptionDetail({ o }: { o: ResponseOption }) {
  return (
    <div className="fade-in grid gap-4 rounded-xl border border-white/10 bg-black/25 p-4 md:grid-cols-3">
      <div>
        <div className="mb-1.5 flex items-center gap-2 text-[12.5px] font-semibold text-ink-100">
          <ProcIcon id={o.id} size={14} /> {PROCEDURE_SHORT[o.id]}
        </div>
        <p className="text-[11.5px] leading-snug text-ink-300">{o.description}</p>
      </div>
      <ul className="space-y-1.5" aria-label="Preconditions">
        {o.preconditions.map((p) => (
          <li key={p.check} className="flex gap-2 text-[11.5px]">
            {p.pass ? <Check size={14} className="mt-[1px] shrink-0 text-clear" /> : <X size={14} className="mt-[1px] shrink-0 text-threat-bright" />}
            <span>
              <span className="text-ink-100">{p.check}</span>
              <span className="block font-mono text-[10px] text-ink-400">{p.detail}</span>
            </span>
          </li>
        ))}
      </ul>
      <div className="space-y-2 text-[11.5px]">
        <details>
          <summary className="cursor-pointer text-ink-200">Actions · {o.actions.length} (simulated)</summary>
          <ul className="mt-1 space-y-0.5 text-ink-300">
            {o.actions.map((a, i) => (
              <li key={i}>› {a}</li>
            ))}
          </ul>
        </details>
        <details>
          <summary className="cursor-pointer text-caution-bright">Risks · {o.risks.length}</summary>
          <ul className="mt-1 space-y-0.5 text-ink-300">
            {o.risks.map((a, i) => (
              <li key={i}>⚠ {a}</li>
            ))}
          </ul>
        </details>
      </div>
    </div>
  );
}

function TraceRow({ e, run, open, onToggle }: { e: TraceEntry; run: RunState; open: boolean; onToggle: () => void }) {
  const { openAnalysis, navigate } = useApp();
  const ph = phaseStyle(e.phase);
  const aid = typeof e.data?.analysis_id === 'string' ? e.data.analysis_id : null;
  const a = aid ? run.analyses[aid] : undefined;
  const thumb = a?.frame_urls[Math.floor(a.frame_urls.length / 2)];
  return (
    <li className="relative pl-9">
      <span className="absolute left-[13px] top-0 h-full w-px bg-white/10" aria-hidden />
      <span className="absolute left-0 top-2 flex h-7 w-7 items-center justify-center rounded-full border" style={{ color: ph.fg, background: ph.bg, borderColor: ph.border }} title={e.phase}>
        {PHASE_ICON[e.phase] ?? <Sparkles size={14} />}
      </span>
      <div className={cx('rounded-xl border transition-colors', open ? 'border-accent/30 bg-white/[0.04]' : 'border-transparent hover:bg-white/[0.03]')}>
        <button type="button" onClick={onToggle} aria-expanded={open} className="flex w-full items-center gap-3 px-2.5 py-2 text-left">
          <span className="tnum w-12 shrink-0 font-mono text-[10.5px] text-ink-400">+{e.t.toFixed(1)}s</span>
          {thumb && <img src={thumb} alt="" loading="lazy" className="h-8 w-11 shrink-0 rounded-md object-cover" />}
          <span className="min-w-0 flex-1 truncate text-[12.5px] text-ink-100">{e.title}</span>
          {e.tool && <span className="hidden shrink-0 font-mono text-[10px] text-ink-400 md:inline">{ms(e.tool.duration_ms)}</span>}
          <ChevronDown size={14} className={cx('shrink-0 text-ink-400 transition-transform', open && 'rotate-180')} />
        </button>
        {open && (
          <div className="fade-in space-y-2 px-2.5 pb-3 text-[11.5px]">
            {e.reason && (
              <p className="text-ink-200">
                <span className="mr-1.5 text-[9.5px] font-semibold uppercase tracking-wider text-accent">Why</span>
                {e.reason}
              </p>
            )}
            {e.detail && <p className="text-ink-400">{e.detail}</p>}
            {e.tool && (
              <div className="rounded-lg border border-white/10 bg-black/40 px-2.5 py-1.5 font-mono text-[10.5px]">
                <div className="flex gap-2">
                  <span className="text-info-bright">{e.tool.name}</span>
                  <span className="ml-auto text-ink-400">{ms(e.tool.duration_ms)}</span>
                </div>
                <div className="truncate text-ink-400">{compactArgs(e.tool.args)}</div>
                {e.tool.result && <div className="text-ink-200">→ {e.tool.result}</div>}
              </div>
            )}
            {e.changes.length > 0 && (
              <ul className="flex flex-wrap gap-1 font-mono text-[10px]">
                {e.changes.map((c, i) => {
                  const p = parseChange(c);
                  return (
                    <li key={i} className={cx('rounded-md px-1.5 py-[1px]', p.kind === 'increase' ? 'bg-threat/15 text-threat-bright' : p.kind === 'decrease' ? 'bg-clear/15 text-clear-bright' : 'bg-white/5 text-ink-200')}>
                      {c}
                    </li>
                  );
                })}
              </ul>
            )}
            {a && (
              <button
                type="button"
                className="flex items-center gap-1.5 text-[11px] text-accent hover:text-accent-bright"
                onClick={() => {
                  openAnalysis(a.camera_id, a.analysis_id);
                  navigate('evidence');
                }}
              >
                <Play size={12} /> Open {a.analysis_id} in Evidence
              </button>
            )}
          </div>
        )}
      </div>
    </li>
  );
}

export function IntelPage() {
  const { run, startRun, scenarios, scenarioId } = useApp();
  const [opt, setOpt] = useState<string | null>(null);
  const [phases, setPhases] = useState<Set<string>>(new Set());
  const [q, setQ] = useState('');
  const [openStep, setOpenStep] = useState<number | null>(null);
  const trace = run?.trace ?? [];
  const counts = useMemo(() => phaseCounts(trace), [trace]);
  const shown = useMemo(() => filterTrace(trace, phases, q), [trace, phases, q]);

  if (!run) {
    const sc = scenarios.find((s) => s.id === scenarioId);
    return (
      <GlassCard className="mx-auto mt-10 flex max-w-xl flex-col items-center gap-3 p-10 text-center">
        <Brain size={44} className="text-accent" />
        <h2 className="text-[18px] font-semibold text-ink-100">No decision story yet</h2>
        <p className="text-[12.5px] text-ink-400">Run a scenario to see how the agent perceives, decides and asks for review.</p>
        <button type="button" className="btn-primary px-5 py-2" onClick={() => void startRun()}>
          <Play size={14} /> Run {sc?.title ?? 'scenario'}
        </button>
      </GlassCard>
    );
  }
  const b = run.belief;
  const prio = priorityOf(b?.p_threat);
  const unc = uncertaintyLevel(run);
  const options = [...(run.assessment?.options ?? [])].sort((x, y) => PROCEDURE_ORDER.indexOf(x.id) - PROCEDURE_ORDER.indexOf(y.id));
  const selected = options.find((o) => o.id === (opt ?? run.assessment?.recommended));
  const togglePhase = (p: string) =>
    setPhases((s) => {
      const n = new Set(s);
      if (n.has(p)) n.delete(p);
      else n.add(p);
      return n;
    });

  return (
    <div className="space-y-4 wide:h-full wide:overflow-y-auto wide:pr-1 scroll-thin">
      {/* hero */}
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)_340px]">
        <GlassCard className="flex flex-wrap items-center gap-5 p-5" aria-label="Threat">
          <Ring value={b?.p_threat ?? null} tone={prio.tone} size={112} stroke={9} label={<span className="tnum text-[26px] font-bold text-ink-100">{pct(b?.p_threat)}</span>} />
          <div className="min-w-0 flex-1 space-y-2">
            <div className="flex items-center gap-2">
              <span className={cx('text-[22px] font-bold', TONE_TEXT[prio.tone])}>{prio.label}</span>
              <span className={cx('rounded-full px-2 py-[1px] text-[10.5px] font-semibold', b?.localized ? 'bg-threat/20 text-threat-bright' : 'bg-white/5 text-ink-300')}>{b?.localized ? 'Localised' : 'Not localised'}</span>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {(b?.region ?? []).map((z, i) => (
                <span key={z} className={cx('rounded-lg border px-2.5 py-1 font-mono text-[12px] font-semibold', i === 0 ? 'border-threat/60 bg-threat/15 text-[#fecaca]' : 'border-white/10 bg-white/5 text-ink-100')} title={`P(here | threat) ${pct(b?.conditional[z], 1)}`}>
                  {z}
                </span>
              ))}
            </div>
            <div className="flex gap-4 text-[11px] text-ink-400">
              <span>
                no threat <span className="tnum text-ink-100">{pct(b?.p_none, 1)}</span>
              </span>
              <span>
                support <span className="tnum text-ink-100">{b?.supporting_observations ?? 0}</span>
              </span>
            </div>
          </div>
          <Gauge value={1 - (b?.entropy ?? 1)} label={unc.label} sub="certainty of location" color={TONE_HEX[unc.tone]} />
        </GlassCard>
        <GlassCard aria-label="Belief over time">
          <SectionHead icon={<Activity size={16} />} title="Belief over time" />
          <div className="px-4 pb-3">
            <BeliefChart run={run} />
          </div>
        </GlassCard>
        <div className="min-w-0 space-y-2">
          <ReviewFloat />
          {run.review_history.length > 0 && (
            <details className="rounded-xl border border-white/10 bg-black/25 px-3 py-2 text-[11.5px]">
              <summary className="cursor-pointer text-ink-200">Review history · {run.review_history.length}</summary>
              <ul className="mt-1 space-y-0.5 text-ink-300">
                {run.review_history.map((h, i) => (
                  <li key={i}>
                    {new Date(h.at * 1000).toLocaleTimeString()} — {h.reviewer ?? 'reviewer'} {h.action} {h.option_id ?? h.exit_id ?? ''}
                    {h.note ? ` “${h.note}”` : ''}
                  </li>
                ))}
              </ul>
            </details>
          )}
        </div>
      </div>

      {/* phase flow */}
      <GlassCard aria-label="Agent phases" className="p-4">
        <div className="flex flex-wrap items-center gap-2">
          {PHASES.map((p, i) => {
            const ph = phaseStyle(p);
            const on = phases.has(p);
            return (
              <div key={p} className="flex flex-1 items-center gap-2">
                <button
                  type="button"
                  onClick={() => togglePhase(p)}
                  aria-pressed={on}
                  title={`Filter trace: ${PHASE_LABEL[p]}`}
                  className={cx('flex min-w-[118px] flex-1 items-center gap-3 rounded-xl border px-3 py-2.5 transition-all', on ? 'ring-1' : 'hover:bg-white/[0.04]')}
                  style={{ borderColor: ph.border, background: on ? ph.bg : 'transparent', ...(on ? { boxShadow: `0 0 18px -6px ${ph.fg}` } : {}) }}
                >
                  <span className="flex h-9 w-9 items-center justify-center rounded-full" style={{ background: ph.bg, color: ph.fg }}>
                    {PHASE_ICON[p]}
                  </span>
                  <span className="text-left leading-tight">
                    <span className="tnum block text-[20px] font-bold text-ink-100">{counts[p]}</span>
                    <span className="text-[10.5px] uppercase tracking-wider" style={{ color: ph.fg }}>
                      {PHASE_LABEL[p]}
                    </span>
                  </span>
                </button>
                {i < PHASES.length - 1 && <span className="hidden h-px w-5 shrink-0 bg-gradient-to-r from-white/20 to-white/5 md:block" aria-hidden />}
              </div>
            );
          })}
        </div>
      </GlassCard>

      {/* options */}
      <GlassCard aria-label="Response options">
        <SectionHead
          icon={<ShieldCheck size={16} />}
          title="Response options"
          right={
            run.assessment && (
              <details className="relative text-[11px]">
                <summary className="flex cursor-pointer list-none items-center gap-1 text-ink-300 hover:text-ink-100">
                  <GaugeIcon size={13} /> Uncertainty
                </summary>
                <div className="absolute right-0 top-6 z-20 w-[380px] space-y-1 rounded-xl border border-white/10 bg-ink-900/95 p-3 text-ink-300 shadow-2xl backdrop-blur-xl">
                  {run.assessment.uncertainty.map((u, i) => (
                    <p key={i}>• {u}</p>
                  ))}
                  {run.assessment.why_not_full_evacuation.length > 0 && (
                    <p className="pt-1 text-caution-bright">Not full evacuation: {run.assessment.why_not_full_evacuation.join('; ')}</p>
                  )}
                </div>
              </details>
            )
          }
        />
        {!run.assessment ? (
          <p className="px-4 pb-4 text-[12px] text-ink-400">Options appear when the agent stops gathering evidence.</p>
        ) : (
          <div className="space-y-3 px-4 pb-4">
            <div className="grid grid-cols-2 gap-3 pt-2 md:grid-cols-3 xl:grid-cols-6">
              {options.map((o) => (
                <OptionTile key={o.id} o={o} recommended={o.id === run.assessment!.recommended} open={selected?.id === o.id} onToggle={() => setOpt(o.id)} />
              ))}
            </div>
            {selected && <OptionDetail o={selected} />}
          </div>
        )}
      </GlassCard>

      {/* trace */}
      <GlassCard aria-label="Agent trace">
        <SectionHead
          icon={<ListTree size={16} />}
          title="Agent trace"
          right={
            <>
              <span className="tnum text-[11px] text-ink-400">
                {shown.length}/{trace.length}
              </span>
              <label className="flex items-center gap-1.5 rounded-full border border-white/10 bg-black/30 px-2.5 py-1">
                <Search size={12} className="text-ink-400" />
                <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Filter" aria-label="Filter trace" className="w-28 bg-transparent text-[11.5px] text-ink-100 outline-none placeholder:text-ink-500" />
              </label>
              {phases.size > 0 && (
                <button type="button" className="text-[11px] text-accent" onClick={() => setPhases(new Set())}>
                  All phases
                </button>
              )}
            </>
          }
        />
        <div className="flex flex-wrap gap-1.5 px-4 pb-2">
          {PHASES.map((p) => {
            const ph = phaseStyle(p);
            const on = phases.has(p);
            return (
              <button key={p} type="button" onClick={() => togglePhase(p)} aria-pressed={on} className="flex items-center gap-1.5 rounded-full border px-2.5 py-[3px] text-[10.5px] font-medium transition-all" style={{ borderColor: ph.border, color: ph.fg, background: on ? ph.bg : 'transparent' }}>
                {PHASE_ICON[p]}
                {PHASE_LABEL[p]}
              </button>
            );
          })}
        </div>
        <ol className="px-4 pb-4">
          {shown.map((e) => (
            <TraceRow key={e.step} e={e} run={run} open={openStep === e.step} onToggle={() => setOpenStep(openStep === e.step ? null : e.step)} />
          ))}
          {shown.length === 0 && <li className="py-4 text-[12px] text-ink-400">No steps match.</li>}
        </ol>
      </GlassCard>
    </div>
  );
}
