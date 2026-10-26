import { Suspense, useEffect, useMemo, useRef, useState, type MutableRefObject } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { OrbitControls, PerformanceMonitor } from '@react-three/drei';
import { Bloom, EffectComposer, Vignette } from '@react-three/postprocessing';
import * as THREE from 'three';
import type { Building, RunState } from '../../types';
import { easeInOutCubic, frameOf, lerpV3, type CameraGoal, type V3, type ViewLevel } from '../../lib/scene';
import { threatIntensity } from '../../lib/colors';
import { BuildingModel } from './BuildingModel';
import { LiveLayers, type Layers } from './LiveLayers';
import { Scenery } from './Scenery';
import { REDUCED } from './motion';
import { incidentZones, zoneHeat } from '../Twin';

// Quality switches (also usable for profiling): ?fx=0 (no post-processing), ?sh=0 (no shadows), ?sc=0 (no scenery).
const Q = typeof window !== 'undefined' ? new URLSearchParams(window.location.search) : new URLSearchParams();
const FX = Q.get('fx') !== '0';
const SH = Q.get('sh') !== '0';
const SC = Q.get('sc') !== '0';
// ?q=high|low pins render quality; otherwise it adapts to the measured frame rate.
const PINNED = Q.get('q') === 'high' || Q.get('q') === 'low' ? (Q.get('q') as 'high' | 'low') : null;



export interface SceneApi {
  zoom: (k: number) => void;
}

/** Animates camera position + orbit target to the goal (~1.1 s ease); any user drag cancels it. */
function CameraRig({ goal, goalKey }: { goal: CameraGoal; goalKey: string }) {
  const { camera, controls } = useThree();
  const anim = useRef<{ fp: V3; ft: V3; t0: number } | null>(null);
  const first = useRef(true);
  const ctl = controls as unknown as { target: THREE.Vector3; update: () => void; addEventListener: (t: string, f: () => void) => void; removeEventListener: (t: string, f: () => void) => void } | null;
  useEffect(() => {
    if (!ctl) return;
    if (first.current || REDUCED) {
      first.current = false;
      camera.position.set(...goal.position);
      ctl.target.set(...goal.target);
      ctl.update();
      anim.current = null;
      return;
    }
    anim.current = { fp: camera.position.toArray() as V3, ft: ctl.target.toArray() as V3, t0: performance.now() };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [goalKey, ctl]);
  useEffect(() => {
    if (!ctl) return;
    const cancel = () => (anim.current = null);
    ctl.addEventListener('start', cancel);
    return () => ctl.removeEventListener('start', cancel);
  }, [ctl]);
  useFrame(() => {
    const a = anim.current;
    if (!a || !ctl) return;
    const k = Math.min(1, (performance.now() - a.t0) / 1100);
    const e = easeInOutCubic(k);
    // lift the camera slightly mid-flight for a cinematic arc
    const p = lerpV3(a.fp, goal.position, e);
    p[1] += Math.sin(Math.PI * e) * Math.min(25, Math.hypot(goal.position[0] - a.fp[0], goal.position[2] - a.fp[2]) * 0.15);
    camera.position.set(...p);
    ctl.target.set(...lerpV3(a.ft, goal.target, e));
    ctl.update();
    if (k >= 1) anim.current = null;
  });
  return null;
}

function Bridge({ apiRef, needle }: { apiRef: MutableRefObject<SceneApi | null>; needle: MutableRefObject<HTMLDivElement | null> }) {
  const { camera, controls } = useThree();
  const last = useRef(999);
  useEffect(() => {
    apiRef.current = {
      zoom: (k: number) => {
        const c = controls as unknown as { target: THREE.Vector3; update: () => void } | null;
        if (!c) return;
        const off = camera.position.clone().sub(c.target).multiplyScalar(1 / k);
        if (off.length() > 8 && off.length() < 520) camera.position.copy(c.target.clone().add(off));
        c.update();
      },
    };
  }, [camera, controls, apiRef]);
  useFrame(() => {
    const t = (controls as unknown as { target?: THREE.Vector3 } | null)?.target ?? new THREE.Vector3();
    const az = Math.atan2(camera.position.x - t.x, camera.position.z - t.z);
    if (Math.abs(az - last.current) > 0.003 && needle.current) {
      last.current = az;
      needle.current.style.transform = `rotate(${az}rad)`;
    }
  });
  return null;
}

/**
 * postprocessing's EffectComposer sets renderer.autoClear = false and does not restore it on unmount.
 * When quality drops to 'low' the composer unmounts, so without this guard frames are drawn on top of
 * previous frames (smearing while orbiting). Runs before R3F's default render each frame.
 */
export function AutoClearGuard({ active }: { active: boolean }) {
  const gl = useThree((s) => s.gl);
  useFrame(() => {
    if (active && !gl.autoClear) gl.autoClear = true;
  });
  return null;
}

/** Pause rendering while the tab is hidden. */
function VisibilityPause() {
  const { setFrameloop } = useThree();
  useEffect(() => {
    const on = () => setFrameloop(document.hidden ? 'never' : 'always');
    document.addEventListener('visibilitychange', on);
    return () => document.removeEventListener('visibilitychange', on);
  }, [setFrameloop]);
  return null;
}

export function CampusScene({
  b,
  run,
  level,
  layers,
  goal,
  goalKey,
  selectedZone,
  selectedCamera,
  hoveredZone,
  onHover,
  onSelectZone,
  onSelectCamera,
  onBuildingClick,
  onEnterFloor,
  onMiss,
  apiRef,
  needle,
}: {
  b: Building;
  run: RunState | null;
  level: ViewLevel;
  layers: Layers;
  goal: CameraGoal;
  goalKey: string;
  selectedZone: string | null;
  selectedCamera: string | null;
  hoveredZone: string | null;
  onHover: (z: string | null) => void;
  onSelectZone: (z: string) => void;
  onSelectCamera: (c: string) => void;
  onBuildingClick: () => void;
  onEnterFloor: () => void;
  onMiss: () => void;
  apiRef: MutableRefObject<SceneApi | null>;
  needle: MutableRefObject<HTMLDivElement | null>;
}) {
  const f = useMemo(() => frameOf(b), [b]);
  const { pz, maxP } = useMemo(() => zoneHeat(b, run), [b, run]);
  const heatOf = (z: string) => (layers.heat ? threatIntensity(pz[z] ?? 0, maxP) : 0);
  const hotIds = layers.region ? incidentZones(run) : [];
  const hot = useMemo(() => b.zones.filter((z) => hotIds.includes(z.id)), [b, hotIds.join(',')]); // eslint-disable-line react-hooks/exhaustive-deps
  const exitS = b.exits.find((e) => e.id === 'EX-S')?.position ?? b.exits[0]?.position;
  const [q, setQ] = useState<'high' | 'low'>(PINNED ?? 'high');
  const high = q === 'high';
  // Labels live in a sibling overlay so DOM clicks on them never reach the canvas event source.
  const labelLayer = useRef<HTMLDivElement>(null!);
  return (
    <div className="absolute inset-0 isolate z-0">
    <Canvas
      shadows={SH ? 'soft' : false}
      dpr={high ? [1, 1.75] : 0.75}
      gl={{ antialias: true, powerPreference: 'high-performance' }}
      camera={{ fov: 38, near: 0.5, far: 2000, position: goal.position }}
      onPointerMissed={(e) => {
        if ((e.target as HTMLElement | null)?.tagName === 'CANVAS') onMiss();
      }}
      style={{ position: 'absolute', inset: 0 }}
    >
      <PerformanceMonitor flipflops={3} onDecline={() => !PINNED && setQ('low')} onIncline={() => !PINNED && setQ('high')} onFallback={() => !PINNED && setQ('low')} />
      <Suspense fallback={null}>
        <fogExp2 attach="fog" args={['#07131f', 0.0026]} />
        <hemisphereLight args={['#5c84bd', '#07120e', 0.6]} />
        <ambientLight intensity={0.12} />
        <directionalLight
          position={[-110, 120, -140]}
          intensity={1.15}
          color="#c4dcff"
          castShadow={SH && high}
          shadow-mapSize={[1536, 1536]}
          shadow-bias={-0.0004}
          shadow-camera-left={-80}
          shadow-camera-right={80}
          shadow-camera-top={80}
          shadow-camera-bottom={-80}
          shadow-camera-near={20}
          shadow-camera-far={450}
        />
        <directionalLight position={[120, 60, 110]} intensity={0.35} color="#38d5f0" />
        {SC && <Scenery f={f} bounds={b.bounds} exitS={exitS} />}
        <BuildingModel
          b={b}
          f={f}
          level={level}
          heatOf={heatOf}
          hot={new Set(hotIds)}
          blocked={new Set(run?.routing?.blocked_exits ?? [])}
          selectedZone={selectedZone}
          hoveredZone={hoveredZone}
          onHover={onHover}
          onSelectZone={onSelectZone}
          onBuildingClick={onBuildingClick}
          onEnterFloor={onEnterFloor}
        />
        <LiveLayers
          b={b}
          f={f}
          run={run}
          level={level}
          layers={layers}
          hot={hot}
          selectedZone={selectedZone}
          selectedCamera={selectedCamera}
          onSelectCamera={onSelectCamera}
          onSelectZone={onSelectZone}
          portal={labelLayer}
        />
        <OrbitControls makeDefault enableDamping dampingFactor={0.08} maxPolarAngle={Math.PI / 2.08} minDistance={10} maxDistance={520} screenSpacePanning={false} />
        <CameraRig goal={goal} goalKey={goalKey} />
        <Bridge apiRef={apiRef} needle={needle} />
        <VisibilityPause />
        <AutoClearGuard active={!(FX && high)} />
        {FX && high && (
          <EffectComposer multisampling={0}>
            <Bloom mipmapBlur luminanceThreshold={0.72} luminanceSmoothing={0.18} intensity={1.05} radius={0.75} />
            <Vignette eskil={false} offset={0.22} darkness={0.72} />
          </EffectComposer>
        )}
      </Suspense>
    </Canvas>
    <div ref={labelLayer} className="pointer-events-none absolute inset-0 overflow-hidden" />
    </div>
  );
}
