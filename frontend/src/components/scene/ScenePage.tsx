import { useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { useApp } from '../../context';
import { cameraGoal, deriveFloors, frameOf, initialView, viewReducer, type ViewLevel } from '../../lib/scene';
import { cx } from '../ui';
import { CampusScene, type SceneApi } from './CampusScene';
import { DEFAULT_LAYERS, type Layers } from './LiveLayers';
import { ActivityFloat, CameraFeedPanel, IncidentFloat, MapControls, PlanSVG, ReviewFloat, SceneHud, SceneLegend, TimelineStrip, ZoneListSR, ZonePanel } from './panels';

function canWebGL(): boolean {
  try {
    const c = document.createElement('canvas');
    return !!(c.getContext('webgl2') || c.getContext('webgl'));
  } catch {
    return false;
  }
}

function useMedia(q: string): boolean {
  const [m, setM] = useState(() => (typeof window !== 'undefined' && window.matchMedia ? window.matchMedia(q).matches : true));
  useEffect(() => {
    const mq = window.matchMedia(q);
    const on = () => setM(mq.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, [q]);
  return m;
}

type Tab = 'incident' | 'review' | 'context' | 'activity' | 'timeline';

export function ScenePage() {
  const { building, run, selectCamera, selectedZone: appZone, setSelectedZone } = useApp();
  const floors = useMemo(() => (building ? deriveFloors(building) : [{ id: 'L0', name: 'Ground (L0)', level: 0, zoneIds: [] }]), [building]);
  const [view, dispatch] = useReducer(viewReducer, initialView(floors[0]?.id));
  const [layers, setLayers] = useState<Layers>(DEFAULT_LAYERS);
  const [hovered, setHovered] = useState<string | null>(null);
  const [fitTick, setFitTick] = useState(0);
  const [flyFollow, setFlyFollow] = useState(false);
  const [timelineOpen, setTimelineOpen] = useState(true);
  const [tab, setTab] = useState<Tab>('incident');
  const [size, setSize] = useState<[number, number]>([1600, 900]);
  const aspect = size[0] / Math.max(1, size[1]);
  const [webgl] = useState(canWebGL);
  const wide = useMedia('(min-width: 1024px)');
  const wrap = useRef<HTMLDivElement>(null);
  const apiRef = useRef<SceneApi | null>(null);
  const needle = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setSize([el.clientWidth, el.clientHeight]));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // A zone chosen elsewhere (e.g. AI zone chips) focuses it here once.
  useEffect(() => {
    if (appZone && appZone !== view.zone) dispatch({ type: 'select-zone', id: appZone });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Optional: fly to each camera the agent analyses.
  const analyzing = run ? Object.values(run.cameras).find((c) => c.status === 'analyzing')?.id ?? null : null;
  useEffect(() => {
    if (flyFollow && analyzing && analyzing !== view.camera) dispatch({ type: 'select-camera', id: analyzing });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [flyFollow, analyzing]);

  if (!building) return <div className="flex h-full items-center justify-center text-ink-400">Loading building model…</div>;
  const f = frameOf(building);
  const zone = view.zone ? building.zones.find((z) => z.id === view.zone) ?? null : null;
  const cam = view.camera ? building.cameras.find((c) => c.id === view.camera) ?? null : null;
  // Frame the building inside the region not covered by the floating panels.
  const panelW = size[0] >= 1500 ? 342 : 312;
  const safeW = wide ? (size[0] - 2 * panelW) / size[0] : 1;
  const safeH = wide ? (size[1] - 110 - (timelineOpen ? 150 : 60)) / size[1] : 0.9;
  const goal = cameraGoal(view.level, f, { zone, camera: cam, aspect, safeW, safeH });
  const goalKey = `${view.level}|${view.zone}|${view.camera}|${fitTick}|${aspect.toFixed(2)}|${safeW.toFixed(2)}|${safeH.toFixed(2)}`;
  const buildingName = building.name.replace(/\s*\(fictional\)\s*/i, '').replace('Middle School', 'MS');

  const onZone = (id: string) => {
    dispatch({ type: 'select-zone', id });
    setSelectedZone(view.zone === id ? null : id);
    if (!wide) setTab('context');
  };
  const onCamera = (id: string) => {
    dispatch({ type: 'select-camera', id });
    selectCamera(id);
    if (!wide) setTab('context');
  };
  const onLevel = (l: ViewLevel) => dispatch({ type: 'level', level: l });

  const contextPanel = zone ? (
    <ZonePanel zoneId={zone.id} onClose={() => dispatch({ type: 'clear' })} onSelectCamera={onCamera} />
  ) : run || cam ? (
    <CameraFeedPanel focused={!!cam} onClose={() => dispatch({ type: 'clear' })} />
  ) : null;

  const scene = webgl ? (
    <CampusScene
      b={building}
      run={run}
      level={view.level}
      layers={layers}
      goal={goal}
      goalKey={goalKey}
      selectedZone={view.zone}
      selectedCamera={view.camera}
      hoveredZone={hovered}
      onHover={setHovered}
      onSelectZone={onZone}
      onSelectCamera={onCamera}
      onBuildingClick={() => dispatch({ type: 'building-click' })}
      onEnterFloor={() => dispatch({ type: 'enter-floor' })}
      onMiss={() => dispatch({ type: 'clear' })}
      apiRef={apiRef}
      needle={needle}
    />
  ) : (
    <div className="absolute inset-0 p-16">
      <PlanSVG b={building} run={run} selectedZone={view.zone} onZone={onZone} />
      <div className="absolute left-4 top-4 rounded-lg border border-caution/40 bg-caution-dim/80 px-2 py-1 text-[11px] text-caution-bright">WebGL unavailable — showing the 2D plan</div>
    </div>
  );

  const hud = (
    <SceneHud
      level={view.level}
      floors={floors}
      floorId={view.floor}
      buildingName={buildingName}
      focusLabel={zone ? zone.id : cam ? cam.id : null}
      onLevel={onLevel}
      onFloor={(id) => dispatch({ type: 'select-floor', id })}
      layers={layers}
      onLayers={setLayers}
      flyFollow={flyFollow}
      onFlyFollow={() => setFlyFollow((v) => !v)}
    />
  );

  if (!wide) {
    const tabs: [Tab, string][] = [
      ['incident', 'Incident'],
      ['review', 'Review'],
      ['context', zone ? 'Zone' : 'Camera'],
      ['activity', 'Agent'],
      ['timeline', 'Timeline'],
    ];
    return (
      <div className="flex flex-col">
        <div ref={wrap} className="relative h-[58vh] min-h-[360px] overflow-hidden" style={{ cursor: hovered ? 'pointer' : undefined }}>
          {scene}
          <ZoneListSR b={building} run={run} onZone={onZone} />
          <div className="pointer-events-none absolute left-0 right-0 top-2 flex justify-center px-2">{hud}</div>
          <div className="pointer-events-none absolute bottom-3 right-3">
            <MapControls onZoom={(k) => apiRef.current?.zoom(k)} onFit={() => setFitTick((t) => t + 1)} needle={needle} />
          </div>
          <div className="pointer-events-none absolute bottom-3 left-3 right-20">
            <SceneLegend />
          </div>
        </div>
        <div className="sticky bottom-0 z-10 border-t border-accent/15 bg-ink-950/90 backdrop-blur-xl">
          <div role="tablist" aria-label="Panels" className="flex overflow-x-auto px-2 pt-2 scroll-thin">
            {tabs.map(([id, label]) => (
              <button key={id} role="tab" aria-selected={tab === id} type="button" onClick={() => setTab(id)} className={cx('whitespace-nowrap rounded-t-lg px-3 py-1.5 text-[12px]', tab === id ? 'bg-accent/15 text-accent-bright' : 'text-ink-300')}>
                {label}
                {id === 'review' && run?.status === 'awaiting_review' && <span className="ml-1 inline-block h-1.5 w-1.5 rounded-full bg-caution" />}
              </button>
            ))}
          </div>
          <div className="space-y-2 p-2">
            {tab === 'incident' && <IncidentFloat />}
            {tab === 'review' && (run ? <ReviewFloat /> : <p className="p-3 text-[12px] text-ink-400">No run yet.</p>)}
            {tab === 'context' && contextPanel}
            {tab === 'activity' && <ActivityFloat />}
            {tab === 'timeline' && <TimelineStrip open onToggle={() => undefined} />}
          </div>
        </div>
      </div>
    );
  }

  const bottomPad = timelineOpen ? 'bottom-[150px]' : 'bottom-[60px]';
  return (
    <div ref={wrap} className="relative h-full w-full overflow-hidden" style={{ cursor: hovered ? 'pointer' : undefined }}>
      {scene}
      <ZoneListSR b={building} run={run} onZone={onZone} />
      {/* top-centre HUD */}
      <div className="pointer-events-none absolute left-1/2 top-3 z-20 -translate-x-1/2">{hud}</div>
      {/* left stack */}
      <div className={cx('pointer-events-none absolute left-3 top-3 z-20 flex w-[300px] flex-col gap-2.5 overflow-y-auto pb-1 scroll-thin xwide:w-[330px]', bottomPad)}>
        <IncidentFloat />
        {contextPanel}
      </div>
      {/* right stack */}
      <div className={cx('pointer-events-none absolute right-3 top-3 z-20 flex w-[300px] flex-col gap-2.5 overflow-y-auto pb-1 scroll-thin xwide:w-[330px]', bottomPad)}>
        <ReviewFloat />
        {run && <ActivityFloat key={run.status === 'awaiting_review' ? 'await' : 'work'} defaultOpen={run.status !== 'awaiting_review' || aspect > 1.9} />}
      </div>
      {/* map controls & legend */}
      <div className={cx('pointer-events-none absolute right-[318px] z-20 xwide:right-[348px]', bottomPad)}>
        <MapControls onZoom={(k) => apiRef.current?.zoom(k)} onFit={() => setFitTick((t) => t + 1)} needle={needle} />
      </div>
      <div className={cx('pointer-events-none absolute left-[318px] z-20 xwide:left-[348px]', bottomPad)}>
        <SceneLegend />
      </div>
      {/* bottom timeline */}
      <div className="pointer-events-none absolute bottom-3 left-3 right-3 z-20">
        <TimelineStrip open={timelineOpen} onToggle={() => setTimelineOpen((o) => !o)} />
      </div>
    </div>
  );
}
