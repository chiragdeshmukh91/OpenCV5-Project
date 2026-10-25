import { useEffect, useRef, useState } from 'react';
import {
  AlertTriangle,
  ArrowRight,
  Ban,
  BrainCircuit,
  Camera as CameraIcon,
  Check,
  CheckCircle2,
  ChevronUp,
  Circle,
  CircleDashed,
  DoorClosed,
  FileText,
  FlaskConical,
  Hourglass,
  ListChecks,
  Loader2,
  MoreHorizontal,
  Play,
  ScanEye,
  ScanSearch,
  ShieldCheck,
  Boxes,
  UserCheck,
  Zap,
} from 'lucide-react';
import { api } from '../api';
import { useApp } from '../context';
import type { ReviewAction } from '../types';
import {
  agentActivity,
  composeSummary,
  elapsedSeconds,
  evidenceTimeline,
  keyObservations,
  priorityOf,
  procedureParts,
  statusText,
  supportingAnalyses,
  uncertaintyLevel,
  type StageState,
} from '../lib/derive';
import { effectiveCameraStatus, enhanceLabel, isPerceiveAnalysis, pct } from '../lib/format';
import { CameraPlayer } from './CameraPlayer';
import { cx } from './ui';
import { Dot, Ring, Sparkline, StageTag, TONE_TEXT, ZoneTag } from './viz';

function Card({ title, icon, right, children, className, bodyClassName }: { title: string; icon: React.ReactNode; right?: React.ReactNode; children: React.ReactNode; className?: string; bodyClassName?: string }) {
  return (
    <section className={cx('panel fade-in flex min-h-0 flex-col', className)} aria-label={title}>
      <header className="panel-header">
        {icon}
        <h2 className="truncate">{title}</h2>
        {right && <div className="ml-auto flex items-center gap-2 text-[11.5px] font-normal">{right}</div>}
      </header>
      <div className={cx('min-h-0 flex-1', bodyClassName)}>{children}</div>
    </section>
  );
}

function LinkBtn({ children, onClick }: { children: React.ReactNode; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className="flex items-center gap-1 rounded text-[11.5px] font-medium text-accent hover:text-accent-bright">
      {children}
      <ArrowRight size={12} className="!text-current" />
    </button>
  );
}

// ------------------------------------------------------------------ incident strip
export function IncidentStrip() {
  const { run, now, building, startRun, starting, scenarios, scenarioId } = useApp();
  const b = run?.belief;
  const prio = priorityOf(b?.p_threat);
  const names = new Map((building?.zones ?? []).map((z) => [z.id, z.name]));
  if (!run) {
    const sc = scenarios.find((s) => s.id === scenarioId);
    return (
      <section className="panel fade-in flex flex-wrap items-center gap-4 px-4 py-3" aria-label="Incident overview">
        <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl border border-accent/30 bg-accent-dim/60 text-accent shadow-glow-cyan">
          <ShieldCheck size={24} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-[11px] font-semibold uppercase tracking-[0.12em] text-accent">No active incident</div>
          <div className="mt-0.5 max-w-[980px] text-[12.5px] leading-relaxed text-ink-200">
            Run a simulated scenario to start the agent: a simulated report sets a threat-location prior over the school twin, the agent chooses the most informative camera, analyses it with OpenCV 5 (detection, tracking,
            optical flow, quality checks), re-analyses poor-quality feeds, computes evacuation routes and Standard Response Protocol options, then pauses for your review. Nothing is ever executed.
          </div>
        </div>
        <button type="button" className="btn-primary h-10 px-4 text-[13px]" disabled={!scenarioId || starting} onClick={() => void startRun()}>
          {starting ? <Loader2 size={15} className="animate-spin" /> : <Play size={15} />}
          Run {sc ? `“${sc.title}”` : 'scenario'}
        </button>
      </section>
    );
  }
  const region = b?.region ?? [];
  const sec = elapsedSeconds(run, now);
  const mm = sec == null ? '—' : `${String(Math.floor(sec / 60)).padStart(2, '0')}m ${String(Math.floor(sec % 60)).padStart(2, '0')}s`;
  const statusTone = run.status === 'running' ? 'info' : run.status === 'awaiting_review' ? 'caution' : run.status === 'complete' ? 'clear' : 'muted';
  return (
    <section className="panel fade-in grid grid-cols-1 items-center gap-x-5 gap-y-3 px-4 py-3 md:grid-cols-[minmax(0,1.25fr)_auto_auto_auto] xl:grid-cols-[minmax(250px,1.25fr)_auto_auto_auto_minmax(0,1.35fr)_auto]" aria-label="Incident overview">
      <div className="flex min-w-0 items-center gap-3.5">
        <div className={cx('flex h-14 w-14 shrink-0 items-center justify-center rounded-xl border', prio.tone === 'threat' ? 'border-threat/60 bg-threat-dim text-threat shadow-glow-red' : 'border-caution/50 bg-caution-dim text-caution')}>
          <AlertTriangle size={28} strokeWidth={2.2} />
        </div>
        <div className="min-w-0">
          <div className="truncate font-mono text-[10.5px] font-medium uppercase tracking-wider text-threat-bright" title={run.run_id}>INCIDENT #{run.run_id}</div>
          <div className="line-clamp-2 text-[16px] font-semibold leading-tight text-ink-100" title={run.scenario.trigger.claim}>
            {run.scenario.trigger.claim}
          </div>
          <span
            className={cx(
              'mt-1 inline-flex rounded-full px-2.5 py-[2px] text-[11px] font-semibold',
              prio.tone === 'threat' ? 'bg-threat/85 text-white shadow-glow-red' : prio.tone === 'caution' ? 'bg-caution/85 text-ink-950' : prio.tone === 'clear' ? 'bg-clear/80 text-ink-950' : 'bg-ink-600 text-ink-100',
            )}
          >
            {prio.label} Priority
          </span>
        </div>
      </div>
      <div className="md:border-l md:border-ink-700/80 md:pl-5">
        <div className="text-[11.5px] text-ink-400">Status</div>
        <div className="mt-1 flex items-center gap-2 whitespace-nowrap text-[13.5px] font-medium text-ink-100">
          <Dot tone={statusTone} pulse={run.status === 'running'} />
          {statusText(run)}
        </div>
        <div className="mt-0.5 font-mono text-[10px] text-ink-400">phase {run.phase}</div>
      </div>
      <div className="md:border-l md:border-ink-700/80 md:pl-5">
        <div className="text-[11.5px] text-ink-400">Elapsed Time</div>
        <div className="tnum mt-1 text-[15px] font-semibold text-ink-100">{mm}</div>
        <div className="text-[10px] text-ink-400">{run.status === 'running' ? 'live' : 'agent time (frozen)'}</div>
      </div>
      <div className="md:border-l md:border-ink-700/80 md:pl-5">
        <div className="text-[11.5px] text-ink-400">Affected Zones</div>
        <div className="mt-1 font-mono text-[13px] font-medium text-ink-100" title={region.map((z) => `${z} ${names.get(z) ?? ''}`).join(', ')}>
          {region.length ? region.slice(0, 3).join(', ') : '—'}
        </div>
        <div className="text-[10.5px] text-ink-400">{region.length > 3 ? `+${region.length - 3} more` : b ? (b.localized ? `localised · ${pct(b.region_mass)} mass` : 'not localised') : ''}</div>
      </div>
      <div className="min-w-0 xl:border-l xl:border-ink-700/80 xl:pl-5">
        <div className="text-[11.5px] font-medium text-accent">AI Summary</div>
        <p className="mt-1 line-clamp-3 text-[12px] leading-snug text-ink-200" title={composeSummary(run)}>
          {composeSummary(run)}
        </p>
      </div>
      <div className="flex items-center gap-3 xl:border-l xl:border-ink-700/80 xl:pl-5">
        <div>
          <div className="mb-1 text-[11.5px] text-ink-400">Threat Probability</div>
          <div className="flex items-center gap-3">
            <Ring value={b?.p_threat ?? null} tone={prio.tone} size={58} />
            <div>
              <div className={cx('text-[16px] font-semibold', TONE_TEXT[prio.tone])}>{prio.label}</div>
              <Sparkline values={run.belief_history.map((h) => h.p_threat)} width={110} height={30} color={prio.tone === 'threat' ? '#ef4444' : prio.tone === 'caution' ? '#f59e0b' : '#2dd4bf'} ariaLabel="P(threat) history" />
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

// ------------------------------------------------------------------ live cameras
export function LiveCameras({ className }: { className?: string }) {
  const { building, run, scenarios, scenarioId, overrides, selectedCamera, selectedAnalysis, selectCamera, openAnalysis, follow, setFollow, navigate } = useApp();
  const cams = building?.cameras ?? [];
  const cam = cams.find((c) => c.id === selectedCamera) ?? cams[0];
  const analyses = run && cam ? Object.values(run.analyses).filter((a) => a.camera_id === cam.id) : [];
  const analysis = analyses.find((a) => a.analysis_id === selectedAnalysis) ?? analyses[analyses.length - 1] ?? null;
  const st = cam && run ? run.cameras[cam.id] : undefined;
  const scen = scenarios.find((s) => s.id === scenarioId);
  const clipFor = (cid: string) => run?.camera_clips[cid] ?? overrides[cid] ?? scen?.cameras[cid] ?? null;
  const entry = analysis && run ? run.trace.find((e) => e.data?.analysis_id === analysis.analysis_id) : undefined;
  const thumbFor = (cid: string): string | null => {
    const as = run ? Object.values(run.analyses).filter((a) => a.camera_id === cid) : [];
    const last = as[as.length - 1];
    if (last?.frame_urls.length) return last.frame_urls[last.frame_urls.length - 1];
    const c = clipFor(cid);
    return c ? api.previewUrl(c) : null;
  };
  return (
    <Card
      title="Live Cameras"
      icon={<CameraIcon size={15} />}
      className={className}
      bodyClassName="overflow-y-auto scroll-thin"
      right={
        <>
          <button
            type="button"
            onClick={() => setFollow((f) => !f)}
            aria-pressed={follow}
            title="Automatically show the camera the agent is analysing"
            className={cx('rounded-md border px-1.5 py-[1px] text-[10.5px]', follow ? 'border-accent/60 text-accent-bright' : 'border-ink-600 text-ink-400')}
          >
            Follow agent
          </button>
          <LinkBtn onClick={() => navigate('evidence')}>View All</LinkBtn>
        </>
      }
    >
      <div className="space-y-2.5 p-3">
        <div className="flex items-center gap-2">
          <span className="truncate text-[13px] font-medium text-ink-100">
            {cam ? `${cam.id.replace('CAM-', 'C')} · ${cam.name}` : '—'}
          </span>
          <span className="font-mono text-[10.5px] text-ink-400">{cam?.zone}</span>
          {analysis && (
            <span className="ml-auto rounded border border-ink-600 bg-ink-900/70 px-1.5 font-mono text-[10px] text-ink-300">{enhanceLabel(analysis.params?.enhance)}</span>
          )}
        </div>
        <CameraPlayer
          camera={cam}
          state={st && { ...st, status: effectiveCameraStatus(run, st.id) as typeof st.status }}
          analyses={analyses}
          analysis={analysis}
          onSelectAnalysis={(aid) => cam && openAnalysis(cam.id, aid)}
          previewUrl={cam && clipFor(cam.id) ? api.previewUrl(clipFor(cam.id)!) : null}
          baseTime={entry && run ? run.started_at + entry.t : null}
          hideHeader
        />
        <div className="flex gap-1.5 overflow-x-auto pb-1 scroll-thin" role="listbox" aria-label="Cameras">
          {cams.map((c) => {
            const cs = run?.cameras[c.id];
            const status = effectiveCameraStatus(run, c.id);
            const thumb = thumbFor(c.id);
            const sel = c.id === cam?.id;
            return (
              <button
                key={c.id}
                type="button"
                role="option"
                aria-selected={sel}
                onClick={() => selectCamera(c.id)}
                title={`${c.id} · ${c.name} — ${status.replace('_', ' ')}`}
                className={cx('w-[92px] shrink-0 overflow-hidden rounded-lg border bg-ink-900 text-left transition-all', sel ? 'border-accent shadow-glow-cyan' : 'border-ink-700 hover:border-accent/50')}
              >
                <div className="relative aspect-[4/3] bg-black">
                  {thumb && <img src={thumb} alt="" loading="lazy" className={cx('h-full w-full object-cover', status === 'idle' ? 'opacity-50' : 'opacity-90', status === 'fault' && 'grayscale')} />}
                  <span
                    className={cx(
                      'absolute left-1 top-1 rounded px-1 text-[8.5px] font-bold tracking-wider',
                      status === 'analyzing' ? 'pulse-soft bg-accent text-ink-950' : status === 'fault' ? 'bg-ink-500 text-white' : status === 'pending_recheck' ? 'bg-caution text-ink-950' : 'bg-black/70 text-caution-bright',
                    )}
                  >
                    {status === 'analyzing' ? 'ANALYZING' : status === 'fault' ? 'FAULT' : status === 'pending_recheck' ? 'RECHECK' : 'SYNTH'}
                  </span>
                  {cs?.reliability != null && (
                    <span className="tnum absolute right-1 top-1 rounded bg-black/70 px-1 text-[8.5px] font-semibold text-ink-100" title="Measured reliability">
                      {Math.round(cs.reliability * 100)}%
                    </span>
                  )}
                </div>
                <div className="truncate px-1.5 py-1 text-[10px] text-ink-200">
                  <span className="font-mono font-semibold text-ink-100">{c.id.replace('CAM-', 'C')}</span> · {c.name}
                </div>
              </button>
            );
          })}
        </div>
      </div>
    </Card>
  );
}

// ------------------------------------------------------------------ AI intelligence
export function AIIntelligence({ className }: { className?: string }) {
  const { run, setSelectedZone, navigate, selectCamera } = useApp();
  const [open, setOpen] = useState(true);
  const b = run?.belief;
  const prio = priorityOf(b?.p_threat);
  const unc = uncertaintyLevel(run);
  const obs = keyObservations(run);
  const region = b?.region ?? [];
  return (
    <Card
      title="AI Intelligence"
      icon={<BrainCircuit size={15} />}
      className={className}
      bodyClassName="overflow-y-auto scroll-thin"
      right={
        <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} aria-label={open ? 'Collapse AI Intelligence' : 'Expand AI Intelligence'} className="rounded p-0.5 text-ink-300 hover:text-ink-100">
          <ChevronUp size={15} className={cx('!text-current transition-transform', !open && 'rotate-180')} />
        </button>
      }
    >
      {open && (
        <div className="space-y-3 p-3">
          {!b ? (
            <p className="text-[12px] leading-relaxed text-ink-400">Threat analytics appear once the agent receives the simulated report and starts updating its Bayesian belief.</p>
          ) : (
            <>
              <div className="flex items-center gap-3">
                <Ring value={b.p_threat} tone={prio.tone} size={74} stroke={7} />
                <div className="min-w-0 flex-1">
                  <div className="text-[12px] text-ink-300">Threat Probability</div>
                  <div className={cx('text-[19px] font-semibold leading-tight', TONE_TEXT[prio.tone])}>{prio.label}</div>
                  <div className="tnum text-[10.5px] text-ink-400">P(no threat) {pct(b.p_none, 1)}</div>
                </div>
                <Sparkline values={run!.belief_history.map((h) => h.p_threat)} width={92} height={34} color="#ef4444" ariaLabel="P(threat) history" />
              </div>
              <div className="border-t border-ink-700/70 pt-2.5">
                <div className="mb-1 flex items-center justify-between text-[12px] text-ink-200">
                  <span>Confidence Trend</span>
                  <span className="text-[10px] text-ink-400">localisation (region mass)</span>
                </div>
                <Sparkline values={run!.belief_history.map((h) => h.region_mass)} width={250} height={36} color="#22d3ee" showLast ariaLabel="Region mass history" />
              </div>
              <div className="border-t border-ink-700/70 pt-2.5">
                <div className="mb-1.5 text-[12px] font-medium text-ink-100">Key Observations</div>
                {obs.length === 0 ? (
                  <div className="text-[11.5px] text-ink-400">No camera evidence yet.</div>
                ) : (
                  <ul className="space-y-1">
                    {obs.slice(0, 5).map((o, i) => (
                      <li key={i}>
                        <button
                          type="button"
                          disabled={!o.cameraId}
                          onClick={() => o.cameraId && selectCamera(o.cameraId)}
                          className="flex w-full items-start gap-2 text-left text-[11.5px] leading-snug text-ink-200 enabled:hover:text-ink-100"
                        >
                          <Circle size={10} className={cx('mt-[3px] shrink-0', TONE_TEXT[o.tone])} />
                          <span>{o.text}</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
              <div className="border-t border-ink-700/70 pt-2.5">
                <div className="mb-1.5 text-[12px] font-medium text-ink-100">Most Relevant Zones</div>
                <div className="flex flex-wrap gap-1.5">
                  {region.slice(0, 4).map((z) => (
                    <button
                      key={z}
                      type="button"
                      onClick={() => {
                        setSelectedZone(z);
                        navigate('twin');
                      }}
                      className="rounded-lg border border-accent/30 bg-ink-900/80 px-3 py-1 font-mono text-[11.5px] text-ink-100 hover:border-accent hover:shadow-glow-cyan"
                      title={`P(here | threat) ${pct(b.conditional[z], 1)} — open in Digital Twin`}
                    >
                      {z}
                    </button>
                  ))}
                  {region.length > 4 && <span className="rounded-lg border border-ink-600 px-3 py-1 text-[11.5px] text-ink-300">+{region.length - 4}</span>}
                </div>
              </div>
              <div className="flex items-center justify-between border-t border-ink-700/70 pt-2.5" title={unc.detail}>
                <span className="text-[12.5px] text-ink-200">Uncertainty</span>
                <span className={cx('flex items-center gap-1.5 text-[12.5px] font-semibold', TONE_TEXT[unc.tone])}>
                  <Dot tone={unc.tone} />
                  {unc.label}
                </span>
              </div>
            </>
          )}
        </div>
      )}
    </Card>
  );
}

// ------------------------------------------------------------------ evidence timeline
export function EvidenceTimeline({ className }: { className?: string }) {
  const { run, building, openAnalysis, navigate } = useApp();
  const items = evidenceTimeline(run, building);
  const hot = new Set(run?.belief?.localized ? run.belief.region : []);
  const listRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [items.length]);
  return (
    <Card title="Evidence Timeline" icon={<ListChecks size={15} />} className={className} bodyClassName="flex flex-col" right={<LinkBtn onClick={() => navigate('intel')}>View All</LinkBtn>}>
      <div ref={listRef} className="min-h-0 flex-1 overflow-y-auto scroll-thin">
        {items.length === 0 ? (
          <p className="p-3 text-[12px] text-ink-400">Perception and belief-update steps appear here as the agent works, each with the analysed frame and the zones it concerns.</p>
        ) : (
          <ol>
            {items.map((it) => (
              <li key={it.step}>
                <button
                  type="button"
                  disabled={!it.analysisId}
                  onClick={() => it.analysisId && it.cameraId && openAnalysis(it.cameraId, it.analysisId)}
                  className="grid w-full grid-cols-[58px_52px_minmax(0,1fr)_auto] items-center gap-2.5 border-b border-ink-700/50 px-3 py-1.5 text-left transition-colors enabled:hover:bg-accent/5"
                >
                  <span className="tnum font-mono text-[11px] text-ink-300">{it.time}</span>
                  <span className="relative h-[34px] w-[48px] overflow-hidden rounded-md border border-ink-700 bg-ink-900">
                    {it.thumb ? <img src={it.thumb} alt="" loading="lazy" className="h-full w-full object-cover" /> : <span className="flex h-full items-center justify-center text-ink-500"><Zap size={13} /></span>}
                  </span>
                  <span className="truncate text-[12px] text-ink-100" title={it.title}>
                    {it.title}
                  </span>
                  <span className="flex items-center gap-1">
                    <StageTag>{it.tag}</StageTag>
                    {it.zones.slice(0, 2).map((z) => (
                      <span key={z} className="hidden xwide:inline-flex">
                        <ZoneTag tone={hot.has(z) ? 'threat' : 'muted'}>{z}</ZoneTag>
                      </span>
                    ))}
                  </span>
                </button>
              </li>
            ))}
          </ol>
        )}
      </div>
    </Card>
  );
}

// ------------------------------------------------------------------ quick actions
export function QuickActions({ className }: { className?: string }) {
  const { navigate, run, openHistory } = useApp();
  const items = [
    { icon: <ScanEye size={18} />, title: 'View Evidence', sub: 'Camera analyses & clips', go: () => navigate('evidence') },
    { icon: <Boxes size={18} />, title: 'Explore Digital Twin', sub: 'Zones & route validity', go: () => navigate('twin') },
    { icon: <FlaskConical size={18} />, title: 'Run Scenario', sub: 'Scenario Lab & inputs', go: () => navigate('lab') },
    {
      icon: <FileText size={18} />,
      title: 'View Full Report',
      sub: run ? 'Printable incident report' : 'No run yet',
      go: () => {
        if (run) openHistory(run.run_id);
        navigate('history');
      },
    },
  ];
  return (
    <Card title="Quick Actions" icon={<Zap size={15} />} className={className} bodyClassName="overflow-y-auto scroll-thin">
      <div className="grid gap-1.5 p-2.5">
        {items.map((it) => (
          <button
            key={it.title}
            type="button"
            onClick={it.go}
            className="group flex items-center gap-3 rounded-lg border border-ink-700 bg-ink-900/60 px-2.5 py-2 text-left transition-all hover:border-accent/50 hover:bg-accent/5"
          >
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-accent/30 bg-accent-dim/60 text-accent group-hover:shadow-glow-cyan">{it.icon}</span>
            <span className="min-w-0">
              <span className="block text-[12.5px] font-medium text-ink-100">{it.title}</span>
              <span className="block truncate text-[10.5px] text-ink-400">{it.sub}</span>
            </span>
          </button>
        ))}
      </div>
    </Card>
  );
}

// ------------------------------------------------------------------ human review
export function ProcedureLabel({ id, className }: { id: string; className?: string }) {
  const parts = procedureParts(id);
  return (
    <span className={cx('inline-flex flex-wrap items-center gap-x-2 font-bold tracking-wide', className)}>
      {parts.map((p, i) => (
        <span key={p} className="inline-flex items-center gap-2">
          {i > 0 && <ArrowRight size={15} className="text-accent" />}
          <span>{p}</span>
        </span>
      ))}
    </span>
  );
}

export function ReviewCard({ className }: { className?: string }) {
  const { run, building, refresh, openAnalysis, navigate } = useApp();
  const [reviewer, setReviewer] = useState('Safety lead');
  const [note, setNote] = useState('');
  const [exitId, setExitId] = useState('');
  const [busy, setBusy] = useState<ReviewAction | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [menu, setMenu] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const review = run?.review;
  const awaiting = run?.status === 'awaiting_review' && !!review;
  useEffect(() => {
    setBusy(null);
    setErr(null);
  }, [run?.run_id, review?.requested_at]);
  useEffect(() => {
    if (!menu) return;
    const h = (e: MouseEvent) => menuRef.current && !menuRef.current.contains(e.target as Node) && setMenu(false);
    const k = (e: KeyboardEvent) => e.key === 'Escape' && setMenu(false);
    document.addEventListener('mousedown', h);
    document.addEventListener('keydown', k);
    return () => {
      document.removeEventListener('mousedown', h);
      document.removeEventListener('keydown', k);
    };
  }, [menu]);

  const submit = async (action: ReviewAction) => {
    if (!run || !review) return;
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
      setMenu(false);
      refresh();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
      setBusy(null);
    }
  };

  const recId = review?.recommended ?? run?.assessment?.recommended ?? null;
  const rec = run?.assessment?.options.find((o) => o.id === recId);
  const support = supportingAnalyses(run);
  const pill = awaiting ? (
    <span className="flex items-center gap-1.5 rounded-full border border-caution/60 bg-caution-dim px-2 py-[2px] text-[10.5px] font-medium text-caution-bright">
      <Dot tone="caution" pulse /> Awaiting Decision
    </span>
  ) : run?.approved_option ? (
    <span className="rounded-full border border-clear/50 bg-clear-dim px-2 py-[2px] text-[10.5px] font-medium text-clear-bright">Approved (simulated)</span>
  ) : run?.status === 'running' ? (
    <span className="rounded-full border border-info/40 bg-info-dim px-2 py-[2px] text-[10.5px] text-info-bright">Agent working</span>
  ) : null;

  return (
    <Card title="Human Review" icon={<UserCheck size={15} />} className={cx(awaiting && '!border-caution/40', className)} bodyClassName="overflow-y-auto scroll-thin" right={pill}>
      <div className="space-y-3 p-3">
        {!run && <p className="text-[12px] leading-relaxed text-ink-400">Consequential decisions always pause here for an authorised safety lead. Nothing is executed automatically; approvals are logged as simulated.</p>}
        {run && !recId && <p className="text-[12px] text-ink-400">The agent is gathering evidence. A recommendation and review request appear when it stops.</p>}
        {run && recId && (
          <div className={cx('rounded-xl border p-3', awaiting ? 'border-accent/30 bg-gradient-to-br from-accent/10 to-transparent' : 'border-ink-700 bg-ink-900/50')}>
            <div className="flex items-start gap-3">
              <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-accent/40 bg-accent-dim text-accent">
                <ShieldCheck size={18} />
              </span>
              <div className="min-w-0">
                <div className="text-[11.5px] text-ink-300">{run.approved_option ? 'Approved procedure (simulated)' : 'Recommended Procedure'}</div>
                <ProcedureLabel id={run.approved_option ?? recId} className="text-[16px] text-accent-bright" />
                {rec && <p className="mt-1 text-[11.5px] leading-snug text-ink-200">{rec.description}</p>}
              </div>
            </div>
          </div>
        )}
        {run && support.length > 0 && (
          <div>
            <div className="mb-1.5 flex items-center justify-between">
              <span className="text-[12px] font-medium text-ink-100">Supporting Evidence</span>
              <LinkBtn onClick={() => navigate('evidence')}>View All</LinkBtn>
            </div>
            <div className="grid grid-cols-5 gap-1.5">
              {support.map((aid) => {
                const a = run.analyses[aid];
                const thumb = a.frame_urls[Math.floor(a.frame_urls.length / 2)] ?? a.frame_urls[0];
                const act = run.cameras[a.camera_id]?.activity;
                return (
                  <button
                    key={aid}
                    type="button"
                    onClick={() => openAnalysis(a.camera_id, aid)}
                    aria-label={`Open analysis ${aid}`}
                    title={`${a.camera_id} · ${act ?? ''} · ${enhanceLabel(a.params?.enhance)}`}
                    className={cx('relative aspect-[4/3] overflow-hidden rounded-md border transition-all hover:shadow-glow-cyan', act === 'flight' ? 'border-threat/60' : 'border-ink-600 hover:border-accent')}
                  >
                    {thumb && <img src={thumb} alt="" loading="lazy" className="h-full w-full object-cover" />}
                    <span className="absolute bottom-0 left-0 right-0 bg-black/70 px-1 font-mono text-[8.5px] text-ink-100">{a.camera_id.replace('CAM-', 'C')}</span>
                  </button>
                );
              })}
            </div>
          </div>
        )}
        {awaiting && review && (
          <>
            <div className="grid grid-cols-3 gap-1.5">
              <button type="button" className="btn-primary py-2" disabled={!!busy} onClick={() => submit('approve')}>
                {busy === 'approve' ? <Loader2 size={13} className="animate-spin" /> : <CheckCircle2 size={14} />}
                Approve
              </button>
              <button type="button" className="btn-danger py-2" disabled={!!busy} onClick={() => submit('reject')} title="Reject the recommendation; the agent re-assesses without it">
                {busy === 'reject' ? <Loader2 size={13} className="animate-spin" /> : <Ban size={14} />}
                Reject
              </button>
              <button type="button" className="btn-ghost whitespace-nowrap px-1.5 py-2 text-[11px]" disabled={!!busy} onClick={() => submit('more_evidence')} title="Request more evidence: the agent analyses remaining cameras and re-assesses">
                {busy === 'more_evidence' ? <Loader2 size={13} className="animate-spin" /> : <ScanSearch size={13} />}
                More evidence
              </button>
            </div>
            <div ref={menuRef} className="relative flex items-center gap-2">
              <span className="text-[10.5px] leading-snug text-ink-400">Simulated only — decisions are logged, nothing is sent.</span>
              <button
                type="button"
                className="btn-ghost ml-auto px-2 py-1"
                onClick={() => setMenu((m) => !m)}
                aria-expanded={menu}
                aria-haspopup="dialog"
                aria-label="More review options: note, reviewer, report exit blocked"
              >
                <MoreHorizontal size={14} />
                <span className="whitespace-nowrap text-[11px]">Exit blocked…</span>
              </button>
              {menu && (
                <div role="dialog" aria-label="More review options" className="fade-in absolute bottom-[calc(100%+6px)] right-0 z-30 w-[300px] space-y-2 rounded-xl border border-accent/25 bg-ink-900/95 p-3 shadow-2xl backdrop-blur-xl">
                  <input aria-label="Reviewer" className="input w-full" value={reviewer} onChange={(e) => setReviewer(e.target.value)} placeholder="Reviewer" />
                  <input aria-label="Note" className="input w-full" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Note recorded with the decision (optional)" />
                  <div className="label pt-1">Report exit blocked</div>
                  <div className="flex gap-1.5">
                    <select aria-label="Exit" className="input min-w-0 flex-1" value={exitId} onChange={(e) => setExitId(e.target.value)}>
                      <option value="">Select exit…</option>
                      {(building?.exits ?? []).map((e) => (
                        <option key={e.id} value={e.id}>
                          {e.id} — {e.name}
                          {run?.routing?.blocked_exits.includes(e.id) ? ' (unavailable)' : ''}
                        </option>
                      ))}
                    </select>
                    <button type="button" className="btn-warn" disabled={!!busy} onClick={() => submit('block_exit')}>
                      {busy === 'block_exit' ? <Loader2 size={13} className="animate-spin" /> : <DoorClosed size={13} />}
                      Report
                    </button>
                  </div>
                </div>
              )}
            </div>
            {err && <div className="text-[11.5px] text-caution-bright">{err}</div>}
          </>
        )}
        {run && !awaiting && run.action_log.length > 0 && (
          <ul className="space-y-0.5 rounded-lg border border-ink-700 bg-ink-950/70 p-2 font-mono text-[10.5px] leading-relaxed text-ink-300">
            {run.action_log.map((l, i) => (
              <li key={i}>{l}</li>
            ))}
          </ul>
        )}
      </div>
    </Card>
  );
}

// ------------------------------------------------------------------ agent activity
const STAGE_ICON: Record<StageState, React.ReactNode> = {
  done: <Check size={12} strokeWidth={3} />,
  active: <Hourglass size={11} />,
  pending: <CircleDashed size={12} />,
  skipped: <span className="text-[10px]">—</span>,
};

export function AgentActivity({ className }: { className?: string }) {
  const { run, navigate } = useApp();
  const stages = agentActivity(run);
  return (
    <Card title="Agent Activity" icon={<BrainCircuit size={15} />} className={className} bodyClassName="overflow-y-auto scroll-thin" right={<LinkBtn onClick={() => navigate('intel')}>Trace</LinkBtn>}>
      <ol className="relative px-3 py-2">
        {stages.map((s, i) => {
          const color =
            s.state === 'done' ? 'border-clear bg-clear/20 text-clear-bright' : s.state === 'active' ? 'border-caution bg-caution/20 text-caution-bright' : s.state === 'skipped' ? 'border-ink-500 bg-ink-800 text-ink-400' : 'border-ink-600 bg-ink-900 text-ink-500';
          return (
            <li key={s.key} className="relative grid grid-cols-[30px_minmax(0,1fr)_auto] gap-2.5 pb-3 last:pb-0">
              {i < stages.length - 1 && <span className={cx('absolute left-[14px] top-[30px] h-[calc(100%-28px)] w-px', s.state === 'done' ? 'bg-clear/50' : 'bg-ink-700')} aria-hidden />}
              <span className={cx('relative z-10 flex h-[30px] w-[30px] items-center justify-center rounded-full border-2', color, s.state === 'active' && 'shadow-[0_0_12px_rgba(245,158,11,0.6)]')}>
                {STAGE_ICON[s.state]}
              </span>
              <div className="min-w-0">
                <div className={cx('text-[12.5px] font-medium', s.state === 'pending' ? 'text-ink-400' : 'text-ink-100')}>{s.label}</div>
                <div className="tnum font-mono text-[10.5px] text-ink-400">{s.time ?? (s.state === 'active' ? 'in progress' : '—')}</div>
                {s.detail && <div className="mt-0.5 line-clamp-2 text-[11px] leading-snug text-ink-300">{s.detail}</div>}
              </div>
              <div className="pt-0.5">
                <StageTag>{s.tag}</StageTag>
              </div>
            </li>
          );
        })}
      </ol>
      {run && run.trace.some(isPerceiveAnalysis) && <div className="sr-only">{run.trace.length} trace steps</div>}
    </Card>
  );
}

export { Card, LinkBtn };
