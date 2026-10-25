import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, FlaskConical, Info } from 'lucide-react';
import { api } from './api';
import { ACTIVE_STATUSES, useNow, useRun, useStaticData, useStatus } from './hooks';
import { TopBar } from './components/TopBar';
import { ScenarioInputs } from './components/ScenarioInputs';
import { CameraWall } from './components/CameraWall';
import { Twin } from './components/Twin';
import { ThreatPanel } from './components/ThreatPanel';
import { OptionsPanel } from './components/OptionsPanel';
import { RoutesTable } from './components/RoutesTable';
import { ReviewPanel } from './components/ReviewPanel';
import { TracePanel } from './components/TracePanel';
import { Panel } from './components/ui';
import { isPerceiveAnalysis } from './lib/format';

function SimulationBanner() {
  return (
    <div className="flex items-center justify-center gap-2 border-b border-caution-soft/30 bg-[#17130b] px-4 py-1 text-[11px] font-medium tracking-wide text-[#e6c88f]">
      <FlaskConical size={12} />
      <span className="font-semibold tracking-[0.14em]">SIMULATION</span>
      <span className="text-[#c9ae7b]">— synthetic footage, simulated reports, no real alerts are sent</span>
    </div>
  );
}

function Intro({ scenarioTitle }: { scenarioTitle?: string }) {
  return (
    <Panel title="How a run works" icon={<Info size={13} />}>
      <div className="space-y-2 p-3 text-[12px] leading-relaxed text-ink-300">
        <p>
          Press <span className="font-medium text-ink-100">Run agent</span> to start{' '}
          {scenarioTitle ? <span className="text-ink-100">“{scenarioTitle}”</span> : 'the selected scenario'}. A simulated report sets a prior over the
          school’s zones; the agent then picks the most informative camera, runs the OpenCV 5 pipeline on it (DNN person detection, tracking, optical
          flow, image-quality checks), re-analyses with different parameters when quality is poor, and updates the threat-location belief on the
          digital twin. When the evidence is sufficient it computes evacuation routes — checking mathematical validity and camera-verified operational
          safety separately — scores the Standard Response Protocol procedures and pauses for your review. Nothing is executed: every action is logged
          as simulated.
        </p>
      </div>
    </Panel>
  );
}

export default function App() {
  const { building, scenarios, footage, error: staticError, reloadFootage } = useStaticData();
  const { status, error: statusError } = useStatus(10000);
  const { run, error: runError, refresh } = useRun(700);
  const active = !!run && ACTIVE_STATUSES.has(run.status);
  const now = useNow(500, active);

  const [scenarioId, setScenarioId] = useState('');
  const [overrides, setOverrides] = useState<Record<string, string>>({});
  const [inputsOpen, setInputsOpen] = useState(false);
  const [starting, setStarting] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [selectedCamera, setSelectedCamera] = useState<string | null>(null);
  const [selectedAnalysis, setSelectedAnalysis] = useState<string | null>(null);
  const [follow, setFollow] = useState(true);
  const [traceH, setTraceH] = useState(() => Math.round(Math.max(200, Math.min(300, window.innerHeight * 0.27))));

  // Default scenario: the current run's scenario, else the first.
  useEffect(() => {
    if (scenarioId || !scenarios?.scenarios.length) return;
    setScenarioId(run?.scenario.id ?? scenarios.scenarios[0].id);
  }, [scenarios, run?.scenario.id, scenarioId]);

  const scenario = scenarios?.scenarios.find((s) => s.id === scenarioId);
  const scenarioClips = useMemo(() => ({ ...(scenario?.cameras ?? {}), ...overrides }), [scenario, overrides]);

  // Follow the agent: show the camera being analysed, else the latest analysis.
  const lastRunId = useRef<string | null>(null);
  useEffect(() => {
    if (!run) return;
    if (run.run_id !== lastRunId.current) {
      lastRunId.current = run.run_id;
      setFollow(true);
      setScenarioId(run.scenario.id);
    }
  }, [run]);
  useEffect(() => {
    if (!run || !follow) return;
    const analyzing = Object.values(run.cameras).find((c) => c.status === 'analyzing');
    if (analyzing) {
      setSelectedCamera(analyzing.id);
      setSelectedAnalysis(null);
      return;
    }
    const lastPerceive = [...run.trace].reverse().find(isPerceiveAnalysis);
    if (lastPerceive) {
      setSelectedCamera(String(lastPerceive.data.camera_id));
      setSelectedAnalysis(String(lastPerceive.data.analysis_id));
    }
  }, [run, follow]);

  useEffect(() => {
    if (!selectedCamera && building?.cameras.length) setSelectedCamera(building.cameras[0].id);
  }, [building, selectedCamera]);

  const startRun = useCallback(async () => {
    if (!scenarioId) return;
    setStarting(true);
    setActionError(null);
    try {
      await api.startRun(scenarioId, overrides);
      setFollow(true);
      setSelectedAnalysis(null);
      refresh();
    } catch (e) {
      setActionError(e instanceof Error ? e.message : String(e));
    } finally {
      setStarting(false);
    }
  }, [scenarioId, overrides, refresh]);

  const cancelRun = useCallback(async () => {
    if (!run) return;
    try {
      await api.cancel(run.run_id);
      refresh();
    } catch (e) {
      setActionError(e instanceof Error ? e.message : String(e));
    }
  }, [run, refresh]);

  const selectCamera = (cid: string) => {
    setFollow(false);
    setSelectedCamera(cid);
    setSelectedAnalysis(null);
  };
  const openAnalysis = (cid: string, aid: string) => {
    setFollow(false);
    setSelectedCamera(cid || run?.analyses[aid]?.camera_id || null);
    setSelectedAnalysis(aid);
  };

  const startDrag = (e: React.MouseEvent) => {
    e.preventDefault();
    const y0 = e.clientY;
    const h0 = traceH;
    const move = (ev: MouseEvent) => setTraceH(Math.max(140, Math.min(window.innerHeight - 320, h0 + (y0 - ev.clientY))));
    const up = () => {
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', up);
    };
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
  };

  const unreachable = staticError || (runError && !run) ? staticError ?? runError : runError;
  const awaiting = run?.status === 'awaiting_review';

  return (
    <div className="flex min-h-screen flex-col bg-ink-950 text-ink-100 wide:h-screen wide:min-h-0 wide:overflow-hidden">
      <SimulationBanner />
      <TopBar
        scenarios={scenarios?.scenarios ?? []}
        scenarioId={scenarioId}
        onScenario={setScenarioId}
        onRun={startRun}
        onCancel={cancelRun}
        run={run}
        starting={starting}
        status={status}
        statusError={statusError}
        inputsOpen={inputsOpen}
        onToggleInputs={() => setInputsOpen((o) => !o)}
        overrideCount={Object.keys(overrides).length}
      />
      {inputsOpen && (
        <ScenarioInputs
          building={building}
          scenario={scenario}
          footage={footage}
          overrides={overrides}
          onChange={setOverrides}
          onUploaded={reloadFootage}
        />
      )}
      {(unreachable || actionError) && (
        <div className="flex items-center gap-2 border-b border-threat-soft/40 bg-threat-dim/50 px-4 py-1.5 text-[12px] text-[#f0c4c6]">
          <AlertTriangle size={13} />
          {unreachable ? <span>Backend unreachable ({unreachable}). Retrying automatically — check that the API is running on port 8000.</span> : <span>{actionError}</span>}
          {actionError && (
            <button type="button" className="ml-auto text-[11px] text-ink-300 hover:text-ink-100" onClick={() => setActionError(null)}>
              dismiss
            </button>
          )}
        </div>
      )}

      <main className="grid grid-cols-1 gap-2 p-2 wide:min-h-0 wide:flex-1 wide:grid-cols-[minmax(318px,26%)_minmax(0,1fr)_minmax(318px,26%)] min-[1500px]:grid-cols-[430px_minmax(0,1fr)_410px]">
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
        <div className="h-[520px] min-h-0 wide:h-full">
          <Twin building={building} run={run} selectedCamera={selectedCamera} onSelectCamera={selectCamera} />
        </div>
        <div className="flex min-h-0 flex-col gap-2 wide:overflow-y-auto wide:pr-0.5 scroll-thin [&>*]:shrink-0">
          {!run && <Intro scenarioTitle={scenario?.title} />}
          {run && (
            <div className="rounded-lg border border-ink-700/80 bg-ink-900/90 px-3 py-2 text-[11.5px]" title={run.scenario.summary}>
              <div className="flex items-baseline gap-2">
                <span className="truncate font-medium text-ink-100">{run.scenario.title}</span>
                <span className="ml-auto shrink-0 font-mono text-[10px] text-ink-500">{run.scenario.id}</span>
              </div>
              <div className="mt-0.5 line-clamp-2 leading-snug text-ink-400">
                Trigger: {run.scenario.trigger.source} — “{run.scenario.trigger.claim}” (zone {run.scenario.trigger.zone}, prior{' '}
                {run.scenario.trigger.confidence.toFixed(2)})
              </div>
            </div>
          )}
          <ThreatPanel run={run} building={building} />
          {run && awaiting && <ReviewPanel run={run} building={building} onSubmitted={refresh} />}
          <OptionsPanel assessment={run?.assessment} />
          <RoutesTable routing={run?.routing} />
          {run && !awaiting && <ReviewPanel run={run} building={building} onSubmitted={refresh} />}
        </div>
      </main>

      <div className="px-2 pb-2 wide:shrink-0" style={{ height: traceH }}>
        <div
          onMouseDown={startDrag}
          className="group hidden h-2 cursor-row-resize items-center justify-center wide:flex"
          title="Drag to resize the trace"
          role="separator"
          aria-orientation="horizontal"
        >
          <div className="h-[3px] w-12 rounded-full bg-ink-700 transition-colors group-hover:bg-ink-500" />
        </div>
        <div className="h-[calc(100%-8px)]">
          <TracePanel run={run} now={now} selectedAnalysis={selectedAnalysis} onOpenAnalysis={openAnalysis} />
        </div>
      </div>
    </div>
  );
}
