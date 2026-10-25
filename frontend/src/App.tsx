import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle } from 'lucide-react';
import { api } from './api';
import { ACTIVE_STATUSES, useNow, useRun, useSessionRuns, useStaticData, useStatus } from './hooks';
import { TopBar } from './components/TopBar';
import { ScenarioInputs } from './components/ScenarioInputs';
import { NAV, Sidebar, StatusBar, type PageId } from './components/Shell';
import { AppContext, type AppCtx } from './context';
import { EvidencePage, HistoryPage, IntelPage, LabPage, PAGE_META, PageTitle, TwinPage } from './pages';
import { ScenePage } from './components/scene/ScenePage';
import { isPerceiveAnalysis } from './lib/format';
import { cx } from './components/ui';

const PAGE_IDS = new Set<PageId>(NAV.map((n) => n.id));

function pageFromHash(): PageId {
  const h = window.location.hash.replace(/^#\/?/, '') as PageId;
  return PAGE_IDS.has(h) ? h : 'operations';
}

export default function App() {
  const { building, scenarios, footage, error: staticError, reloadFootage } = useStaticData();
  const { status, error: statusError } = useStatus(10000);
  const { run, error: runError, updatedAt, refresh } = useRun(700);
  const active = !!run && ACTIVE_STATUSES.has(run.status);
  const now = useNow(500, active);
  const session = useSessionRuns();

  const [page, setPage] = useState<PageId>(pageFromHash);
  const [scenarioId, setScenarioId] = useState('');
  const [overrides, setOverrides] = useState<Record<string, string>>({});
  const [inputsOpen, setInputsOpen] = useState(false);
  const [starting, setStarting] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [selectedCamera, setSelectedCamera] = useState<string | null>(null);
  const [selectedAnalysis, setSelectedAnalysis] = useState<string | null>(null);
  const [selectedZone, setSelectedZone] = useState<string | null>(null);
  const [follow, setFollow] = useState(true);
  const [collapsed, setCollapsed] = useState(true);
  const [mobileNav, setMobileNav] = useState(false);
  const [historyRunId, setHistoryRunId] = useState<string | null>(null);

  useEffect(() => {
    const on = () => setPage(pageFromHash());
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);
  const navigate = useCallback((p: PageId) => {
    if (window.location.hash !== `#/${p}`) window.location.hash = `/${p}`;
    setPage(p);
  }, []);

  useEffect(() => {
    if (scenarioId || !scenarios?.scenarios.length) return;
    setScenarioId(run?.scenario.id ?? scenarios.scenarios[0].id);
  }, [scenarios, run?.scenario.id, scenarioId]);

  const lastRunId = useRef<string | null>(null);
  useEffect(() => {
    if (!run || run.run_id === lastRunId.current) return;
    lastRunId.current = run.run_id;
    setFollow(true);
    setScenarioId(run.scenario.id);
  }, [run]);

  // Follow the agent: show the camera being analysed, else the latest analysis.
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

  const startRun = useCallback(
    async (sid?: string) => {
      const id = sid ?? scenarioId;
      if (!id) return;
      setStarting(true);
      setActionError(null);
      try {
        const { run_id } = await api.startRun(id, overrides);
        session.add(run_id, scenarios?.scenarios.find((s) => s.id === id)?.title ?? id);
        setFollow(true);
        setSelectedAnalysis(null);
        refresh();
      } catch (e) {
        setActionError(e instanceof Error ? e.message : String(e));
      } finally {
        setStarting(false);
      }
    },
    [scenarioId, overrides, refresh, session, scenarios],
  );

  const cancelRun = useCallback(async () => {
    if (!run) return;
    try {
      await api.cancel(run.run_id);
      refresh();
    } catch (e) {
      setActionError(e instanceof Error ? e.message : String(e));
    }
  }, [run, refresh]);

  const selectCamera = useCallback((cid: string) => {
    setFollow(false);
    setSelectedCamera(cid);
    setSelectedAnalysis(null);
  }, []);
  const openAnalysis = useCallback(
    (cid: string, aid: string) => {
      setFollow(false);
      setSelectedCamera(cid || run?.analyses[aid]?.camera_id || null);
      setSelectedAnalysis(aid);
    },
    [run],
  );

  const ctx: AppCtx = useMemo(
    () => ({
      building,
      run,
      scenarios: scenarios?.scenarios ?? [],
      footage,
      status,
      now,
      scenarioId,
      setScenarioId,
      overrides,
      setOverrides,
      reloadFootage,
      startRun,
      cancelRun,
      starting,
      refresh,
      navigate,
      selectedCamera,
      selectedAnalysis,
      selectCamera,
      openAnalysis,
      follow,
      setFollow,
      selectedZone,
      setSelectedZone,
      sessionRuns: session.runs,
      historyRunId,
      openHistory: setHistoryRunId,
    }),
    [building, run, scenarios, footage, status, now, scenarioId, overrides, reloadFootage, startRun, cancelRun, starting, refresh, navigate, selectedCamera, selectedAnalysis, selectCamera, openAnalysis, follow, selectedZone, session.runs, historyRunId],
  );

  const unreachable = staticError ?? (runError && !run ? runError : null);
  const scenario = scenarios?.scenarios.find((s) => s.id === scenarioId);

  let content: React.ReactNode;
  switch (page) {
    case 'twin':
      content = <TwinPage />;
      break;
    case 'evidence':
      content = <EvidencePage />;
      break;
    case 'intel':
      content = <IntelPage />;
      break;
    case 'lab':
      content = <LabPage />;
      break;
    case 'history':
      content = <HistoryPage />;
      break;
    default:
      content = <ScenePage />;
  }
  const meta = page !== 'operations' ? PAGE_META[page] : null;

  return (
    <AppContext.Provider value={ctx}>
      <div className="flex min-h-screen flex-col text-ink-100 wide:h-screen wide:min-h-0 wide:overflow-hidden">
        <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-[100] focus:rounded focus:bg-ink-800 focus:px-3 focus:py-1.5">
          Skip to content
        </a>
        <div className="no-print">
          <TopBar
            scenarios={scenarios?.scenarios ?? []}
            scenarioId={scenarioId}
            onScenario={setScenarioId}
            onRun={() => void startRun()}
            onCancel={() => void cancelRun()}
            run={run}
            starting={starting}
            status={status}
            statusError={statusError}
            inputsOpen={inputsOpen}
            onToggleInputs={() => setInputsOpen((o) => !o)}
            overrideCount={Object.keys(overrides).length}
            onMenu={() => setMobileNav((o) => !o)}
            onOpenEvidence={() => navigate('evidence')}
          />
          {inputsOpen && (
            <div className="relative z-30">
              <ScenarioInputs building={building} scenario={scenario} footage={footage} overrides={overrides} onChange={setOverrides} onUploaded={reloadFootage} />
            </div>
          )}
          {(unreachable || actionError) && (
            <div role="alert" className="flex items-center gap-2 border-b border-threat/40 bg-threat-dim/70 px-4 py-1.5 text-[12px] text-[#fecaca]">
              <AlertTriangle size={13} />
              {unreachable ? <span>Backend unreachable ({unreachable}). Retrying automatically — check that the API is running on port 8000.</span> : <span>{actionError}</span>}
              {actionError && (
                <button type="button" className="ml-auto text-[11px] text-ink-300 hover:text-ink-100" onClick={() => setActionError(null)}>
                  dismiss
                </button>
              )}
            </div>
          )}
        </div>
        <div className="flex min-h-0 flex-1">
          <Sidebar page={page} onNavigate={navigate} collapsed={collapsed} onToggleCollapsed={() => setCollapsed((c) => !c)} mobileOpen={mobileNav} onCloseMobile={() => setMobileNav(false)} />
          <main id="main" tabIndex={-1} className={cx('flex min-w-0 flex-1 flex-col outline-none wide:min-h-0 wide:overflow-hidden', page === 'operations' ? 'p-0' : 'p-3')} key={page}>
            {meta && <PageTitle icon={meta.icon} title={meta.title} sub={meta.sub} />}
            <div className="fade-in min-h-0 flex-1">{content}</div>
          </main>
        </div>
        <StatusBar run={run} totalCameras={building?.cameras.length ?? 0} updatedAt={updatedAt} error={runError} />
      </div>
    </AppContext.Provider>
  );
}
