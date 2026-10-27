import { useEffect, useMemo, useState } from 'react';
import { Boxes, ClipboardList, FileText, FlaskConical, History, Loader2, Play, Printer, ScanEye, ShieldAlert, Table2 } from 'lucide-react';
import { api, ApiError } from './api';
import { useApp } from './context';
import type { RunState } from './types';
import { AIIntelligence, AgentActivity, Card, EvidenceTimeline, IncidentStrip, LiveCameras, ProcedureLabel, QuickActions, ReviewCard } from './components/ops';
import { Twin } from './components/Twin';
import { CameraWall, ACTIVITY_TEXT } from './components/CameraWall';
import { ThreatPanel } from './components/ThreatPanel';
import { OptionsPanel } from './components/OptionsPanel';
import { RoutesTable } from './components/RoutesTable';
import { ReviewPanel } from './components/ReviewPanel';
import { TracePanel } from './components/TracePanel';
import { ScenarioInputs } from './components/ScenarioInputs';
import { Chip, cx } from './components/ui';
import { composeSummary, elapsedSeconds, priorityOf } from './lib/derive';
import { effectiveCameraStatus, elapsed, enhanceLabel, num, pct } from './lib/format';
import { observedColor } from './lib/colors';

// ------------------------------------------------------------------ Operations
export function OperationsPage() {
  const { building, run, selectedCamera, selectCamera, selectedZone, setSelectedZone } = useApp();
  return (
    <div className="flex flex-col gap-3 wide:h-full wide:min-h-0">
      <IncidentStrip />
      <div className="grid grid-cols-1 gap-3 wide:min-h-0 wide:flex-1 wide:grid-cols-[minmax(300px,24%)_minmax(0,1fr)_minmax(320px,26%)] xwide:grid-cols-[minmax(330px,23%)_minmax(0,1fr)_minmax(350px,24%)]">
        <div className="flex min-h-0 flex-col gap-3 wide:overflow-y-auto wide:pr-0.5 scroll-thin [&>*]:shrink-0">
          <LiveCameras />
          <AIIntelligence />
        </div>
        <div className="grid min-h-0 grid-rows-[480px_auto] gap-3 wide:grid-rows-[minmax(380px,1fr)_minmax(210px,33%)] wide:overflow-y-auto wide:pr-0.5 scroll-thin">
          <Twin building={building} run={run} selectedCamera={selectedCamera} onSelectCamera={selectCamera} selectedZone={selectedZone} onSelectZone={setSelectedZone} />
          <div className="grid min-h-0 grid-cols-1 gap-3 md:grid-cols-[minmax(0,1.7fr)_minmax(220px,1fr)]">
            <EvidenceTimeline className="max-h-[320px] wide:max-h-none" />
            <QuickActions />
          </div>
        </div>
        <div className="flex min-h-0 flex-col gap-3 wide:overflow-y-auto wide:pr-0.5 scroll-thin [&>*]:shrink-0">
          <ReviewCard />
          <AgentActivity />
        </div>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ Digital Twin
function ZoneTable() {
  const { building, run, selectedZone, setSelectedZone } = useApp();
  const zones = building?.zones ?? [];
  const pz = (z: string) => run?.belief?.zones?.[z] ?? run?.zones?.[z]?.p_threat ?? 0;
  const sorted = [...zones].sort((a, b) => pz(b.id) - pz(a.id));
  return (
    <Card title="Zone details" icon={<Table2 size={15} />} bodyClassName="overflow-auto scroll-thin">
      <table className="w-full text-[11.5px]">
        <thead className="sticky top-0 bg-ink-900/95 backdrop-blur">
          <tr className="text-left text-[9.5px] uppercase tracking-[0.08em] text-ink-400">
            <th className="px-3 py-1.5 font-medium">Zone</th>
            <th className="px-1 py-1.5 font-medium">Kind</th>
            <th className="px-1 py-1.5 text-right font-medium">Cap.</th>
            <th className="px-1 py-1.5 text-right font-medium">P(threat)</th>
            <th className="px-1 py-1.5 font-medium">Observed</th>
            <th className="px-3 py-1.5 text-right font-medium">Persons</th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((z) => {
            const st = run?.zones[z.id];
            const sel = selectedZone === z.id;
            return (
              <tr
                key={z.id}
                tabIndex={0}
                aria-selected={sel}
                onClick={() => setSelectedZone(sel ? null : z.id)}
                onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), setSelectedZone(sel ? null : z.id))}
                className={cx('cursor-pointer border-t border-ink-700/50 hover:bg-accent/5', sel && 'bg-accent/10')}
              >
                <td className="px-3 py-1.5">
                  <span className="font-mono font-semibold text-ink-100">{z.id}</span> <span className="text-ink-400">{z.name}</span>
                </td>
                <td className="px-1 py-1.5 text-ink-300">{z.kind}</td>
                <td className="tnum px-1 py-1.5 text-right text-ink-300">{z.capacity ?? '—'}</td>
                <td className={cx('tnum px-1 py-1.5 text-right', pz(z.id) >= 0.05 ? 'font-semibold text-threat-bright' : 'text-ink-300')}>{pct(pz(z.id), 1)}</td>
                <td className="px-1 py-1.5">
                  <span className="flex items-center gap-1.5 text-ink-200">
                    <span className="h-1.5 w-1.5 rounded-full" style={{ background: observedColor(st?.observed ?? 'unobserved') }} />
                    {st?.observed ?? 'unobserved'}
                  </span>
                </td>
                <td className="tnum px-3 py-1.5 text-right text-ink-300">{st?.persons ?? '—'}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </Card>
  );
}

export function TwinPage() {
  const { building, run, selectedCamera, selectCamera, selectedZone, setSelectedZone } = useApp();
  return (
    <div className="grid grid-cols-1 gap-3 wide:h-full wide:min-h-0 wide:grid-cols-[minmax(0,1fr)_minmax(380px,32%)]">
      <Twin building={building} run={run} selectedCamera={selectedCamera} onSelectCamera={selectCamera} selectedZone={selectedZone} onSelectZone={setSelectedZone} className="h-[620px] wide:h-full" />
      <div className="flex min-h-0 flex-col gap-3 wide:overflow-y-auto scroll-thin [&>*]:shrink-0">
        <RoutesTable routing={run?.routing} />
        <ZoneTable />
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ Evidence
export function EvidencePage() {
  const { building, run, selectedCamera, selectedAnalysis, selectCamera, openAnalysis, follow, setFollow, scenarios, scenarioId, overrides, openReview } = useApp();
  const scen = scenarios.find((s) => s.id === scenarioId);
  const scenarioClips = useMemo(() => ({ ...(scen?.cameras ?? {}), ...overrides }), [scen, overrides]);
  const analyses = run ? Object.values(run.analyses) : [];
  return (
    <div className="grid grid-cols-1 gap-3 wide:h-full wide:min-h-0 wide:grid-cols-[minmax(360px,36%)_minmax(0,1fr)]">
      <div className="min-h-0 wide:h-full">
        <CameraWall
          building={building}
          run={run}
          scenarioClips={scenarioClips}
          selectedCamera={selectedCamera}
          selectedAnalysis={selectedAnalysis}
          onSelectCamera={selectCamera}
          onSelectAnalysis={(aid) => openAnalysis(selectedCamera ?? '', aid)}
          follow={follow}
          onToggleFollow={() => setFollow((f) => !f)}
        />
      </div>
      <div className="flex min-h-0 flex-col gap-3 wide:overflow-y-auto scroll-thin [&>*]:shrink-0">
        <Card
          title="Per-camera evidence"
          icon={<ScanEye size={15} />}
          bodyClassName="overflow-x-auto scroll-thin"
          right={
            run && Object.keys(run.analyses).length > 0 ? (
              <button type="button" className="btn-primary py-1 text-[11.5px]" onClick={() => openReview(null)}>
                Open evidence review (full-size footage)
              </button>
            ) : undefined
          }
        >
          <table className="w-full min-w-[720px] text-[11.5px]">
            <thead>
              <tr className="text-left text-[9.5px] uppercase tracking-[0.08em] text-ink-400">
                <th className="px-3 py-1.5 font-medium">Camera</th>
                <th className="px-1 py-1.5 font-medium">Status</th>
                <th className="px-1 py-1.5 font-medium">Activity</th>
                <th className="px-1 py-1.5 font-medium">Location</th>
                <th className="px-1 py-1.5 text-right font-medium">Reliab.</th>
                <th className="px-1 py-1.5 text-right font-medium">People</th>
                <th className="px-1 py-1.5 text-right font-medium">Speed BH/s</th>
                <th className="px-1 py-1.5 text-right font-medium">Run %</th>
                <th className="px-1 py-1.5 text-right font-medium">Coher.</th>
                <th className="px-3 py-1.5 font-medium">Analyses</th>
              </tr>
            </thead>
            <tbody>
              {(building?.cameras ?? []).map((c) => {
                const cs = run?.cameras[c.id];
                const ev = cs?.evidence;
                const st = effectiveCameraStatus(run, c.id);
                const act = cs?.activity ? ACTIVITY_TEXT[cs.activity] : null;
                const own = analyses.filter((a) => a.camera_id === c.id);
                return (
                  <tr key={c.id} className={cx('border-t border-ink-700/50', selectedCamera === c.id && 'bg-accent/5')}>
                    <td className="px-3 py-1.5">
                      <button type="button" onClick={() => selectCamera(c.id)} className="text-left hover:text-accent-bright">
                        <span className="font-mono font-semibold text-ink-100">{c.id}</span> <span className="text-ink-400">{c.name}</span>
                      </button>
                    </td>
                    <td className="px-1 py-1.5">
                      <Chip tone={st === 'analyzed' ? 'clear' : st === 'analyzing' ? 'info' : st === 'pending_recheck' ? 'caution' : st === 'fault' ? 'neutral' : 'muted'}>{st.replace('_', ' ')}</Chip>
                    </td>
                    <td className="px-1 py-1.5">{act ? <Chip tone={act.tone}>{act.label}</Chip> : <span className="text-ink-500">—</span>}</td>
                    <td className="px-1 py-1.5">
                      {ev?.location ? (
                        <Chip tone={ev.location.zone ? 'clear' : ev.location.status === 'dismissed' ? 'muted' : 'caution'} title={ev.location.reasons.join(' ')}>
                          {ev.location.zone ? `${ev.location.zone} · ${ev.location.status === 'verified' ? 'verified' : 'confirmed'}` : ev.location.status === 'dismissed' ? 'dismissed' : 'unknown'}
                        </Chip>
                      ) : (
                        <span className="text-ink-500">—</span>
                      )}
                    </td>
                    <td className="tnum px-1 py-1.5 text-right">{num(cs?.reliability ?? null)}</td>
                    <td className="tnum px-1 py-1.5 text-right">{ev ? `${num(ev.persons, 0)} / ${ev.persons_max}` : '—'}</td>
                    <td className="tnum px-1 py-1.5 text-right">{ev ? `${num(ev.speed_bh_s)} / ${num(ev.flow_speed_bh_s)}` : '—'}</td>
                    <td className="tnum px-1 py-1.5 text-right">{ev ? pct(ev.running_fraction) : '—'}</td>
                    <td className="tnum px-1 py-1.5 text-right">{ev ? num(ev.coherence) : '—'}</td>
                    <td className="px-3 py-1.5">
                      <div className="flex flex-wrap gap-1">
                        {own.map((a) => (
                          <button
                            key={a.analysis_id}
                            type="button"
                            onClick={() => openAnalysis(c.id, a.analysis_id)}
                            className={cx('tag font-mono', selectedAnalysis === a.analysis_id ? 'border-accent bg-accent/20 text-accent-bright' : 'border-ink-600 bg-ink-850 text-ink-200 hover:border-accent/60')}
                            title={`${a.analysis_id}: enhance ${a.params?.enhance}, detect every ${a.params?.detect_every}`}
                          >
                            {enhanceLabel(a.params?.enhance)} {a.analysis_id.slice(-2)}
                          </button>
                        ))}
                        {own.length === 0 && <span className="text-ink-500">—</span>}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </Card>
        <Card title={`All analyses (${analyses.length})`} icon={<ScanEye size={15} />}>
          {analyses.length === 0 ? (
            <p className="p-3 text-[12px] text-ink-400">Every OpenCV analysis of this run — including re-analyses with different parameters such as dehazing — appears here.</p>
          ) : (
            <div className="grid grid-cols-2 gap-2 p-3 md:grid-cols-3 xwide:grid-cols-4">
              {analyses.map((a) => {
                const sel = selectedAnalysis === a.analysis_id || (!selectedAnalysis && selectedCamera === a.camera_id);
                return (
                  <button
                    key={a.analysis_id}
                    type="button"
                    onClick={() => openAnalysis(a.camera_id, a.analysis_id)}
                    className={cx('overflow-hidden rounded-lg border bg-ink-900/70 text-left transition-all', sel ? 'border-accent shadow-glow-cyan' : 'border-ink-700 hover:border-accent/50')}
                  >
                    <div className="relative aspect-[4/3] bg-black">
                      {a.frame_urls[0] && <img src={a.frame_urls[Math.floor(a.frame_urls.length / 2)]} alt="" loading="lazy" className="h-full w-full object-cover" />}
                      <span className="absolute left-1 top-1 rounded bg-black/75 px-1 font-mono text-[9px] text-ink-100">{enhanceLabel(a.params?.enhance)}</span>
                      {a.synthetic && <span className="absolute right-1 top-1 rounded bg-black/75 px-1 text-[8.5px] font-bold text-caution-bright">SYNTHETIC</span>}
                    </div>
                    <div className="px-2 py-1.5 text-[10.5px]">
                      <div className="flex items-center gap-1">
                        <span className="font-mono font-semibold text-ink-100">{a.analysis_id}</span>
                        <span className="ml-auto tnum text-ink-400">{a.quality ? `rel ${a.quality.reliability.toFixed(2)}` : ''}</span>
                      </div>
                      <div className="truncate text-ink-300">
                        {a.persons ? `${num(a.persons.count_median, 0)} people` : ''} · {a.motion?.speed_bh_s_median != null ? `${a.motion.speed_bh_s_median} BH/s` : 'no motion'} · {a.quality?.issues.length ? a.quality.issues.join(', ').replace(/_/g, ' ') : 'no issues'}
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </Card>
        <Card title="Verification tasks & coverage gaps" icon={<ClipboardList size={15} />}>
          <div className="space-y-2 p-3 text-[12px]">
            {!run && <div className="text-ink-400">No run yet.</div>}
            {run && run.verification_tasks.length === 0 && run.gaps.length === 0 && <div className="text-ink-400">No verification tasks or coverage gaps in this run.</div>}
            {run?.verification_tasks.map((t, i) => (
              <div key={i} className="flex items-start gap-2">
                <Chip tone={t.priority === 'high' ? 'threat' : 'caution'}>{t.priority}</Chip>
                <span className="text-ink-200">{t.task}</span>
                {t.analysis_id && (
                  <button type="button" className="ml-auto text-[11px] text-accent hover:text-accent-bright" onClick={() => openAnalysis(t.camera_id, t.analysis_id!)}>
                    open frames
                  </button>
                )}
              </div>
            ))}
            {run?.gaps.map((g, i) => (
              <div key={`g${i}`} className="rounded-lg border border-ink-700 bg-ink-900/60 px-2.5 py-1.5">
                <span className="font-mono text-ink-100">{g.camera_id}</span> <span className="text-ink-400">zone {g.zone}</span> — <span className="text-ink-200">{g.issues.map((x) => x.replace(/_/g, ' ')).join(', ')}</span>
                <div className="text-[11px] text-ink-400">{g.reason}</div>
              </div>
            ))}
          </div>
        </Card>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ Agent Intelligence
export function IntelPage() {
  const { run, building, now, selectedAnalysis, openAnalysis, navigate, refresh } = useApp();
  return (
    <div className="grid grid-cols-1 gap-3 wide:h-full wide:min-h-0 wide:grid-cols-[minmax(360px,32%)_minmax(0,1fr)]">
      <div className="flex min-h-0 flex-col gap-3 wide:overflow-y-auto wide:pr-0.5 scroll-thin [&>*]:shrink-0">
        <ThreatPanel run={run} building={building} />
        {run && <ReviewPanel run={run} building={building} onSubmitted={refresh} />}
        <OptionsPanel assessment={run?.assessment} />
      </div>
      <div className="h-[640px] min-h-0 wide:h-full">
        <TracePanel
          run={run}
          now={now}
          selectedAnalysis={selectedAnalysis}
          onOpenAnalysis={(cid, aid) => {
            openAnalysis(cid, aid);
            navigate('evidence');
          }}
        />
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ Scenario Lab
export function LabPage() {
  const { scenarios, scenarioId, setScenarioId, startRun, starting, run, building, footage, overrides, setOverrides, reloadFootage } = useApp();
  const scen = scenarios.find((s) => s.id === scenarioId);
  return (
    <div className="space-y-3 wide:h-full wide:overflow-y-auto scroll-thin">
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2 2xl:grid-cols-4">
        {scenarios.map((s) => {
          const sel = s.id === scenarioId;
          const isCurrent = run?.scenario.id === s.id;
          return (
            <article
              key={s.id}
              className={cx('panel fade-in flex flex-col p-4 transition-all', sel ? '!border-accent/60 shadow-glow-cyan' : 'hover:!border-accent/30')}
              aria-label={s.title}
            >
              <div className="flex items-center gap-2">
                <span className="font-mono text-[10.5px] text-accent">{s.id}</span>
                {isCurrent && <Chip tone="info">current run · {run!.status.replace('_', ' ')}</Chip>}
              </div>
              <h3 className="mt-1 text-[15px] font-semibold text-ink-100">{s.title}</h3>
              <p className="mt-1 text-[12px] leading-relaxed text-ink-300">{s.summary}</p>
              <dl className="mt-3 space-y-1 rounded-lg border border-ink-700 bg-ink-900/60 p-2.5 text-[11.5px]">
                <div className="flex gap-2">
                  <dt className="w-20 shrink-0 text-ink-400">Trigger</dt>
                  <dd className="text-ink-200">
                    {s.trigger.source} — “{s.trigger.claim}”
                  </dd>
                </div>
                <div className="flex gap-2">
                  <dt className="w-20 shrink-0 text-ink-400">Zone / prior</dt>
                  <dd className="font-mono text-ink-200">
                    {s.trigger.zone} · {s.trigger.confidence.toFixed(2)}
                  </dd>
                </div>
                <div className="flex gap-2">
                  <dt className="w-20 shrink-0 text-ink-400">Expected</dt>
                  <dd className="text-ink-200">
                    {s.expected?.primary_option ? <ProcedureLabel id={s.expected.primary_option} className="text-[11.5px] text-accent-bright" /> : '—'}
                    <span className="block font-mono text-[10.5px] text-ink-400">region {s.expected?.threat_region?.join(', ') ?? 'none'}</span>
                  </dd>
                </div>
                <div className="flex gap-2">
                  <dt className="w-20 shrink-0 text-ink-400">Cameras</dt>
                  <dd className="font-mono text-[10.5px] text-ink-300">{Object.values(s.cameras).join(' · ')}</dd>
                </div>
              </dl>
              <div className="mt-3 flex gap-2 pt-1">
                <button type="button" className={cx('btn-ghost flex-1', sel && 'border-accent/60 text-accent-bright')} onClick={() => setScenarioId(s.id)} aria-pressed={sel}>
                  {sel ? 'Selected' : 'Select'}
                </button>
                <button
                  type="button"
                  className="btn-primary flex-1"
                  disabled={starting}
                  onClick={() => {
                    setScenarioId(s.id);
                    void startRun(s.id);
                  }}
                >
                  {starting && sel ? <Loader2 size={13} className="animate-spin" /> : <Play size={13} />}
                  Run
                </button>
              </div>
            </article>
          );
        })}
      </div>
      <section className="panel overflow-hidden" aria-label="Per-camera inputs">
        <header className="panel-header">
          <FlaskConical size={15} />
          Visual inputs for the next run {scen && <span className="font-mono text-[11px] font-normal text-ink-400">({scen.id})</span>}
        </header>
        <ScenarioInputs building={building} scenario={scen} footage={footage} overrides={overrides} onChange={setOverrides} onUploaded={reloadFootage} />
      </section>
    </div>
  );
}

// ------------------------------------------------------------------ Incident history & report
export function ReportView({ r, live }: { r: RunState; live: boolean }) {
  const { building } = useApp();
  const prio = priorityOf(r.belief?.p_threat);
  const sec = elapsedSeconds(r, Date.now());
  const rec = r.assessment?.options.find((o) => o.id === r.assessment?.recommended);
  return (
    <article className="print-area space-y-3 text-[12px]">
      <header className="flex flex-wrap items-start gap-3">
        <div className="min-w-0">
          <div className="font-mono text-[11px] text-threat-bright">INCIDENT #{r.run_id} · SIMULATION</div>
          <h2 className="text-[18px] font-semibold text-ink-100">{r.scenario.trigger.claim}</h2>
          <div className="text-ink-300">
            {r.scenario.title} · {new Date(r.started_at * 1000).toLocaleString()} · agent time {elapsed(sec)} · status {r.status.replace('_', ' ')}
            {live ? ' · live' : ' · read-only'}
          </div>
        </div>
        <button type="button" className="btn-ghost no-print ml-auto" onClick={() => window.print()}>
          <Printer size={13} /> Print report
        </button>
      </header>
      <section className="grid grid-cols-2 gap-2 md:grid-cols-4">
        {[
          ['P(threat)', pct(r.belief?.p_threat, 0), prio.label],
          ['Region', r.belief ? (r.belief.localized ? r.belief.region.join(', ') : 'not localised') : '—', r.belief ? (r.belief.localized ? `${pct(r.belief.region_mass)} mass` : `report named ${r.scenario.trigger.zone} (unverified)`) : ''],
          ['Recommended', r.assessment ? r.assessment.recommended.replace('_PLUS_', ' + ') : '—', r.approved_option ? `approved: ${r.approved_option}` : 'not approved'],
          ['Vision', `${r.metrics.vision_calls} calls`, `${r.metrics.reanalyses} re-analyses · ${r.metrics.faults} faults`],
        ].map(([k, v, s]) => (
          <div key={k} className="rounded-lg border border-ink-700 bg-ink-900/60 p-2.5">
            <div className="label">{k}</div>
            <div className="tnum truncate text-[14px] font-semibold text-ink-100">{v}</div>
            <div className="truncate text-[10.5px] text-ink-400">{s}</div>
          </div>
        ))}
      </section>
      <section>
        <h3 className="label mb-1">Summary</h3>
        <p className="leading-relaxed text-ink-200">{composeSummary(r)}</p>
      </section>
      {rec && (
        <section>
          <h3 className="label mb-1">Recommendation</h3>
          <ProcedureLabel id={rec.id} className="text-[14px] text-accent-bright" />
          <p className="text-ink-300">{rec.description}</p>
          <ul className="mt-1 space-y-0.5">
            {rec.preconditions.map((p) => (
              <li key={p.check} className={p.pass ? 'text-clear-bright' : 'text-threat-bright'}>
                {p.pass ? '✓' : '✗'} {p.check} <span className="font-mono text-[10.5px] text-ink-400">({p.detail})</span>
              </li>
            ))}
          </ul>
        </section>
      )}
      {r.assessment && (
        <section>
          <h3 className="label mb-1">Uncertainty</h3>
          <ul className="list-disc space-y-0.5 pl-4 text-ink-300">
            {r.assessment.uncertainty.map((u, i) => (
              <li key={i}>{u}</li>
            ))}
          </ul>
        </section>
      )}
      <section>
        <h3 className="label mb-1">Review history</h3>
        {r.review_history.length === 0 ? (
          <div className="text-ink-400">No review decisions recorded.</div>
        ) : (
          <ul className="space-y-0.5">
            {r.review_history.map((h, i) => (
              <li key={i} className="text-ink-200">
                {new Date(h.at * 1000).toLocaleTimeString()} — {h.reviewer ?? 'reviewer'}: {h.action}
                {h.option_id ? ` ${h.option_id}` : ''}
                {h.exit_id ? ` ${h.exit_id}` : ''}
                {h.note ? ` — “${h.note}”` : ''}
              </li>
            ))}
          </ul>
        )}
      </section>
      <section>
        <h3 className="label mb-1">Action log (all simulated)</h3>
        {r.action_log.length === 0 ? (
          <div className="text-ink-400">No actions logged.</div>
        ) : (
          <ul className="space-y-0.5 rounded-lg border border-ink-700 bg-ink-950/70 p-2 font-mono text-[10.5px] text-ink-300">
            {r.action_log.map((l, i) => (
              <li key={i}>{l}</li>
            ))}
          </ul>
        )}
      </section>
      {r.routing && (
        <section>
          <h3 className="label mb-1">Routes</h3>
          <table className="w-full text-[11px]">
            <tbody>
              {r.routing.routes.map((rt) => (
                <tr key={rt.id} className="border-t border-ink-700/50">
                  <td className="py-0.5 font-mono">
                    {rt.from} → {rt.exit ?? '—'}
                  </td>
                  <td>{rt.math_valid ? 'math valid' : 'math invalid'}</td>
                  <td>{rt.operational_status.replace('_', ' ')}</td>
                  <td className="tnum text-right">{rt.length_m ?? '—'} m</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}
      <section>
        <h3 className="label mb-1">Trace ({r.trace.length} steps)</h3>
        <ol className="space-y-0.5 text-[11px]">
          {r.trace.map((e) => (
            <li key={e.step} className="text-ink-300">
              <span className="font-mono text-ink-400">#{e.step} T+{e.t.toFixed(1)}s {e.phase}</span> {e.title}
            </li>
          ))}
        </ol>
      </section>
      <footer className="text-[10.5px] text-ink-400">
        {building?.name} · SIMULATION — synthetic footage, simulated reports, no real alerts were sent.
      </footer>
    </article>
  );
}

export function HistoryPage() {
  const { sessionRuns, run: current, historyRunId, openHistory } = useApp();
  const [runs, setRuns] = useState<Record<string, RunState | 'missing' | 'loading'>>({});
  const ids = useMemo(() => {
    const s = sessionRuns.map((r) => r.id);
    return s;
  }, [sessionRuns]);

  useEffect(() => {
    let alive = true;
    for (const id of ids) {
      if (current && id === current.run_id) continue;
      if (runs[id] && runs[id] !== 'loading') continue;
      setRuns((m) => ({ ...m, [id]: 'loading' }));
      api
        .getRun(id)
        .then((r) => alive && setRuns((m) => ({ ...m, [id]: r })))
        .catch((e) => alive && setRuns((m) => ({ ...m, [id]: e instanceof ApiError && e.status === 404 ? 'missing' : 'missing' })));
    }
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ids.join(','), current?.run_id]);

  const get = (id: string): RunState | 'missing' | 'loading' | undefined => (current && id === current.run_id ? current : runs[id]);
  const selId = historyRunId ?? ids[0] ?? null;
  const sel = selId ? get(selId) : undefined;

  return (
    <div className="grid grid-cols-1 gap-3 wide:h-full wide:min-h-0 wide:grid-cols-[minmax(300px,30%)_minmax(0,1fr)]">
      <Card title="Incident History" icon={<History size={15} />} bodyClassName="overflow-y-auto scroll-thin" right={<span className="text-[10.5px] text-ink-400">this browser session</span>}>
        {ids.length === 0 ? (
          <p className="p-3 text-[12px] leading-relaxed text-ink-400">Runs you start from this browser session appear here. Run ids are kept client-side only (the backend has no run listing), and each run is fetched read-only.</p>
        ) : (
          <ul className="p-2">
            {sessionRuns.map((s) => {
              const r = get(s.id);
              const ok = r && r !== 'missing' && r !== 'loading' ? r : null;
              const prio = priorityOf(ok?.belief?.p_threat);
              return (
                <li key={s.id}>
                  <button
                    type="button"
                    onClick={() => openHistory(s.id)}
                    aria-current={selId === s.id}
                    className={cx('mb-1.5 w-full rounded-lg border p-2.5 text-left transition-all', selId === s.id ? 'border-accent/60 bg-accent/10' : 'border-ink-700 bg-ink-900/50 hover:border-accent/40')}
                  >
                    <div className="flex items-center gap-2">
                      <ShieldAlert size={13} className={ok ? (prio.tone === 'threat' ? 'text-threat' : 'text-caution') : 'text-ink-500'} />
                      <span className="truncate font-mono text-[10.5px] text-ink-300">{s.id}</span>
                      <span className="ml-auto text-[10.5px] text-ink-400">{new Date(s.startedAt).toLocaleTimeString()}</span>
                    </div>
                    <div className="mt-0.5 truncate text-[12.5px] font-medium text-ink-100">{ok?.scenario.title ?? s.scenario}</div>
                    <div className="mt-1 flex flex-wrap gap-1">
                      {r === 'loading' && <Chip tone="muted">loading…</Chip>}
                      {r === 'missing' && <Chip tone="muted">no longer on server</Chip>}
                      {ok && <Chip tone={ok.status === 'complete' ? 'clear' : ok.status === 'awaiting_review' ? 'caution' : ok.status === 'running' ? 'info' : 'muted'}>{ok.status.replace('_', ' ')}</Chip>}
                      {ok?.assessment && <Chip tone="info">{ok.assessment.recommended.replace('_PLUS_', ' + ')}</Chip>}
                      {ok?.approved_option && <Chip tone="clear">approved</Chip>}
                    </div>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </Card>
      <Card title="Incident report" icon={<FileText size={15} />} bodyClassName="overflow-y-auto scroll-thin p-4">
        {!sel && <p className="text-[12px] text-ink-400">Select a run to see its read-only report.</p>}
        {sel === 'loading' && (
          <div className="flex items-center gap-2 text-ink-300">
            <Loader2 size={14} className="animate-spin" /> Loading run…
          </div>
        )}
        {sel === 'missing' && <p className="text-[12px] text-ink-400">This run is no longer available on the server (it was probably restarted).</p>}
        {sel && sel !== 'loading' && sel !== 'missing' && <ReportView r={sel} live={!!current && sel.run_id === current.run_id} />}
      </Card>
    </div>
  );
}

export function PageTitle({ icon, title, sub }: { icon: React.ReactNode; title: string; sub: string }) {
  return (
    <div className="mb-3 flex items-center gap-3">
      <span className="flex h-9 w-9 items-center justify-center rounded-lg border border-accent/30 bg-accent-dim/60 text-accent">{icon}</span>
      <div>
        <h1 className="text-[17px] font-semibold text-ink-100">{title}</h1>
        <p className="text-[11.5px] text-ink-400">{sub}</p>
      </div>
    </div>
  );
}

export const PAGE_META = {
  twin: { icon: <Boxes size={18} />, title: 'Digital Twin', sub: 'Building model, threat heat, routes — mathematical validity vs operational safety' },
  evidence: { icon: <ScanEye size={18} />, title: 'Evidence', sub: 'Every OpenCV analysis (raw and enhanced), per-camera measurements, verification tasks' },
  intel: { icon: <ShieldAlert size={18} />, title: 'Agent Intelligence', sub: 'How the agent reached its recommendation' },
  lab: { icon: <FlaskConical size={18} />, title: 'Scenario Lab', sub: 'Simulated scenarios · synthetic footage' },
  history: { icon: <History size={18} />, title: 'Incident History', sub: 'This session · read-only' },
} as const;
