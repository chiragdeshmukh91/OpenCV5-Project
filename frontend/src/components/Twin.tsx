import { Suspense, useEffect, useLayoutEffect, useMemo, useRef, useState, type MutableRefObject } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { Html, Line, OrbitControls, OrthographicCamera, PerspectiveCamera } from '@react-three/drei';
import { Bloom, EffectComposer, Vignette } from '@react-three/postprocessing';
import * as THREE from 'three';
import { AlertTriangle, Box, CheckCircle2, ChevronDown, Layers, Map as MapIcon, Maximize2, Minus, Plus, UsersRound, X } from 'lucide-react';
import type { Building, Route, RunState, Vec2, Zone } from '../types';
import { cameraStatusColor, mixOklab, observedColor, PALETTE, routeColor, threatColor, threatIntensity } from '../lib/colors';
import { headingVec, routePolyline } from '../lib/geometry';
import { effectiveCameraStatus, pct } from '../lib/format';
import { Chip, cx } from './ui';

type Mode = '2d' | '3d';

export interface LayerState {
  cameras: boolean;
  movement: boolean;
  occupancy: boolean;
  exits: boolean;
  routes: boolean;
  region: boolean;
}

export const DEFAULT_LAYERS: LayerState = { cameras: true, movement: true, occupancy: true, exits: true, routes: true, region: true };

const LAYER_LABELS: [keyof LayerState, string][] = [
  ['cameras', 'Cameras'],
  ['movement', 'People / Movement'],
  ['occupancy', 'Occupancy / Threat heat'],
  ['exits', 'Exits'],
  ['routes', 'Routes'],
  ['region', 'Incident Region'],
];

const FLOOR_H = 0.25;
const WALL_H = 4.4;
const WALL_T = 0.32;
const ROOF_T = 0.28;
const ROUTE_Y = FLOOR_H + 0.6;
const PIN_H = 6;

const REDUCED = typeof window !== 'undefined' && !!window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

interface Frame {
  cx: number;
  cy: number;
  spanX: number;
  spanY: number;
}

const P = (f: Frame, [x, y]: Vec2, h = 0): [number, number, number] => [x - f.cx, h, -(y - f.cy)];

const UP = new THREE.Vector3(0, 1, 0);
function coneQuat(dx: number, dy: number, dz: number): THREE.Quaternion {
  const v = new THREE.Vector3(dx, dy, dz);
  if (v.lengthSq() < 1e-9) return new THREE.Quaternion();
  return new THREE.Quaternion().setFromUnitVectors(UP, v.normalize());
}

function shapeOf(zone: Zone, f: Frame, inset = 0): THREE.Shape {
  const [cx, cy] = zone.centroid;
  return new THREE.Shape(
    zone.polygon.map(([x, y]) => {
      const dx = x - cx, dy = y - cy;
      const len = Math.hypot(dx, dy) || 1;
      const k = inset ? Math.max(0, 1 - inset / len) : 1;
      return new THREE.Vector2(cx + dx * k - f.cx, cy + dy * k - f.cy);
    }),
  );
}

function slabGeometry(zone: Zone, f: Frame, depth: number, inset = 0): THREE.ExtrudeGeometry {
  const g = new THREE.ExtrudeGeometry(shapeOf(zone, f, inset), { depth, bevelEnabled: false });
  g.rotateX(-Math.PI / 2);
  return g;
}

interface WallSeg {
  pos: [number, number, number];
  len: number;
  rot: number;
}

function wallSegments(zone: Zone, f: Frame): WallSeg[] {
  const out: WallSeg[] = [];
  const poly = zone.polygon;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const mid: Vec2 = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
    out.push({ pos: P(f, mid, FLOOR_H + WALL_H / 2), len, rot: Math.atan2(b[1] - a[1], b[0] - a[0]) });
  }
  return out;
}

/** Walls of every room as one instanced mesh (thick, slightly lighter at the top edge via a second pass). */
function Walls({ zones, f }: { zones: Zone[]; f: Frame }) {
  const segs = useMemo(() => zones.filter((z) => z.kind !== 'corridor').flatMap((z) => wallSegments(z, f)), [zones, f]);
  const ref = useRef<THREE.InstancedMesh>(null);
  const win = useRef<THREE.InstancedMesh>(null);
  const windows = useMemo(() => {
    const out: { pos: THREE.Vector3; rot: number; len: number }[] = [];
    for (const s of segs) {
      const n = Math.max(1, Math.floor(s.len / 3.2));
      const step = s.len / n;
      const dir = new THREE.Vector3(Math.cos(s.rot), 0, -Math.sin(s.rot));
      const normal = new THREE.Vector3(Math.sin(s.rot), 0, Math.cos(s.rot));
      for (let i = 0; i < n; i++) {
        const off = -s.len / 2 + step * (i + 0.5);
        for (const side of [1, -1]) {
          const p = new THREE.Vector3(s.pos[0], FLOOR_H + 2.6, s.pos[2]).addScaledVector(dir, off).addScaledVector(normal, side * (WALL_T / 2 + 0.02));
          out.push({ pos: p, rot: s.rot, len: step * 0.62 });
        }
      }
    }
    return out;
  }, [segs]);
  useLayoutEffect(() => {
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    if (ref.current) {
      segs.forEach((s, i) => {
        q.setFromAxisAngle(UP, s.rot);
        m.compose(new THREE.Vector3(...s.pos), q, new THREE.Vector3(s.len + WALL_T, WALL_H, WALL_T));
        ref.current!.setMatrixAt(i, m);
      });
      ref.current.instanceMatrix.needsUpdate = true;
    }
    if (win.current) {
      windows.forEach((w, i) => {
        q.setFromAxisAngle(UP, w.rot);
        m.compose(w.pos, q, new THREE.Vector3(w.len, 0.9, 0.04));
        win.current!.setMatrixAt(i, m);
      });
      win.current.instanceMatrix.needsUpdate = true;
    }
  }, [segs, windows]);
  return (
    <>
      <instancedMesh ref={ref} args={[undefined, undefined, segs.length]}>
        <boxGeometry args={[1, 1, 1]} />
        <meshStandardMaterial color="#3d5c8a" roughness={0.65} metalness={0.15} />
      </instancedMesh>
      <instancedMesh ref={win} args={[undefined, undefined, windows.length]}>
        <boxGeometry args={[1, 1, 1]} />
        <meshStandardMaterial color="#0b1e33" emissive="#8fd6ff" emissiveIntensity={1.05} toneMapped={false} />
      </instancedMesh>
    </>
  );
}

function ZoneBlock({
  zone,
  f,
  heat,
  hot,
  dim,
  selected,
  onHover,
  onClick,
}: {
  zone: Zone;
  f: Frame;
  heat: number; // 0..1 threat intensity relative to the max
  hot: boolean; // in the incident region
  dim: boolean; // occupancy layer off
  selected: boolean;
  onHover: (id: string | null) => void;
  onClick: (id: string) => void;
}) {
  const corridor = zone.kind === 'corridor';
  const floor = useMemo(() => slabGeometry(zone, f, FLOOR_H), [zone, f]);
  const roof = useMemo(() => (corridor ? null : slabGeometry(zone, f, ROOF_T, 0.18)), [zone, f, corridor]);
  const edges = useMemo(() => (roof ? new THREE.EdgesGeometry(roof, 30) : null), [roof]);
  const roofMat = useRef<THREE.MeshStandardMaterial>(null);
  const floorMat = useRef<THREE.MeshStandardMaterial>(null);
  const h = dim ? 0 : heat;
  const roofColor = useMemo(() => mixOklab('#1c304f', '#b3222b', h), [h]);
  const floorColor = useMemo(() => (corridor ? mixOklab('#0f1f34', '#8f1d23', h) : '#0c1828'), [corridor, h]);
  const emissiveBase = hot && !dim ? 0.9 : h * 0.55;

  useFrame(({ clock }) => {
    const pulse = REDUCED ? 0.85 : 0.65 + 0.35 * Math.sin(clock.elapsedTime * 2.6);
    const target = hot && !dim ? emissiveBase * pulse : emissiveBase;
    if (roofMat.current) roofMat.current.emissiveIntensity = target;
    if (floorMat.current && corridor) floorMat.current.emissiveIntensity = target;
  });

  const handlers = {
    onPointerOver: (e: { stopPropagation: () => void }) => {
      e.stopPropagation();
      onHover(zone.id);
    },
    onPointerOut: () => onHover(null),
    onClick: (e: { stopPropagation: () => void }) => {
      e.stopPropagation();
      onClick(zone.id);
    },
  };
  return (
    <group>
      <mesh geometry={floor} {...handlers}>
        <meshStandardMaterial ref={floorMat} color={floorColor} emissive="#ff2a2a" emissiveIntensity={0} roughness={0.9} metalness={0.05} toneMapped={!(corridor && hot)} />
      </mesh>
      {roof && (
        <group position={[0, FLOOR_H + WALL_H, 0]}>
          <mesh geometry={roof} {...handlers}>
            <meshStandardMaterial
              ref={roofMat}
              color={selected ? mixOklab(roofColor, '#4a6b94', 0.35) : roofColor}
              emissive="#ff2626"
              emissiveIntensity={0}
              roughness={0.7}
              metalness={0.2}
              toneMapped={!hot}
            />
          </mesh>
          <lineSegments geometry={edges!}>
            <lineBasicMaterial color={hot && !dim ? '#ff6b6b' : selected ? '#a5f3fc' : '#5cc8e6'} transparent opacity={hot && !dim ? 0.95 : selected ? 0.95 : 0.55} toneMapped={false} />
          </lineSegments>
        </group>
      )}
    </group>
  );
}

function Outline({ zone, f, color, dashed, y, width = 2, pulse }: { zone: Zone; f: Frame; color: string; dashed?: boolean; y: number; width?: number; pulse?: boolean }) {
  const pts = useMemo(() => [...zone.polygon, zone.polygon[0]].map((p) => P(f, p, y)), [zone, f, y]);
  const ref = useRef<THREE.Mesh>(null);
  useFrame(({ clock }) => {
    if (!pulse || REDUCED || !ref.current) return;
    const m = ref.current.material as THREE.Material & { opacity: number };
    m.opacity = 0.55 + 0.45 * Math.sin(clock.elapsedTime * 2.6);
  });
  return (
    <Line
      ref={ref as never}
      points={pts}
      color={color}
      lineWidth={width}
      dashed={dashed}
      dashSize={1.2}
      gapSize={0.8}
      transparent
      depthTest={false}
      renderOrder={5}
      toneMapped={false}
    />
  );
}

function RouteLine({ route, b, f, highlight }: { route: Route; b: Building; f: Frame; highlight: boolean }) {
  const pts = useMemo(() => routePolyline(route, b).map((p) => P(f, p, ROUTE_Y)), [route, b, f]);
  const ref = useRef<{ material: { dashOffset: number } } | null>(null);
  useFrame((_, dt) => {
    if (REDUCED || !ref.current) return;
    ref.current.material.dashOffset -= dt * 2.2;
  });
  if (pts.length < 2) return null;
  const color = routeColor(route.operational_status);
  const end = pts[pts.length - 1];
  const prev = pts[pts.length - 2];
  const q = coneQuat(end[0] - prev[0], 0, end[2] - prev[2]);
  return (
    <group>
      {/* soft wide underglow */}
      <Line points={pts} color={color} lineWidth={highlight ? 10 : 7} transparent opacity={0.16} depthTest={false} renderOrder={9} toneMapped={false} />
      <Line
        ref={ref as never}
        points={pts}
        color={color}
        lineWidth={highlight ? 4 : 2.8}
        dashed
        dashSize={route.safe ? 2.6 : 1.1}
        gapSize={route.safe ? 0.9 : 0.8}
        depthTest={false}
        renderOrder={10}
        toneMapped={false}
      />
      <mesh position={end} quaternion={q} renderOrder={11}>
        <coneGeometry args={[0.75, 1.7, 14]} />
        <meshBasicMaterial color={color} depthTest={false} toneMapped={false} />
      </mesh>
    </group>
  );
}

function Arrow({ from, heading, length, color }: { from: [number, number, number]; heading: number; length: number; color: string }) {
  const [dx, dy] = headingVec(heading);
  const to: [number, number, number] = [from[0] + dx * length, from[1], from[2] - dy * length];
  const q = coneQuat(dx, 0, -dy);
  return (
    <group>
      <Line points={[from, to]} color={color} lineWidth={3.5} depthTest={false} renderOrder={12} toneMapped={false} />
      <mesh position={to} quaternion={q} renderOrder={13}>
        <coneGeometry args={[0.85, 2, 14]} />
        <meshBasicMaterial color={color} depthTest={false} toneMapped={false} />
      </mesh>
    </group>
  );
}

function CameraPin({
  pos,
  yaw,
  color,
  selected,
  id,
  status,
  onClick,
}: {
  pos: [number, number, number];
  yaw: number;
  color: string;
  selected: boolean;
  id: string;
  status: string;
  onClick: () => void;
}) {
  const [dx, dy] = headingVec(yaw);
  const coneQ = useMemo(() => coneQuat(-dx, 0.32, dy), [dx, dy]); // tip at the camera, opening along the view
  const head = useRef<THREE.Mesh>(null);
  useFrame(({ clock }) => {
    if (!head.current || REDUCED) return;
    const s = status === 'analyzing' ? 1 + 0.25 * Math.sin(clock.elapsedTime * 6) : 1;
    head.current.scale.setScalar(s);
  });
  const headY = PIN_H;
  const viewDir = new THREE.Vector3(dx, -0.32, -dy).normalize();
  const coneLen = 7;
  const conePos = new THREE.Vector3(0, headY, 0).addScaledVector(viewDir, coneLen / 2);
  return (
    <group position={pos}>
      <mesh position={[0, headY / 2, 0]}>
        <cylinderGeometry args={[0.07, 0.07, headY, 6]} />
        <meshBasicMaterial color={color} transparent opacity={0.6} toneMapped={false} />
      </mesh>
      <mesh position={conePos.toArray()} quaternion={coneQ} renderOrder={6}>
        <coneGeometry args={[2.6, coneLen, 24, 1, true]} />
        <meshBasicMaterial color={color} transparent opacity={selected ? 0.24 : 0.12} side={THREE.DoubleSide} depthWrite={false} blending={THREE.AdditiveBlending} toneMapped={false} />
      </mesh>
      <mesh
        ref={head}
        position={[0, headY, 0]}
        onClick={(e) => {
          e.stopPropagation();
          onClick();
        }}
      >
        <sphereGeometry args={[selected ? 0.9 : 0.7, 20, 16]} />
        <meshBasicMaterial color={selected ? '#e0fbff' : color} toneMapped={false} />
      </mesh>
      <mesh position={[0, 0.05, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[0.9, 1.25, 28]} />
        <meshBasicMaterial color={color} transparent opacity={0.7} toneMapped={false} side={THREE.DoubleSide} />
      </mesh>
      <Html position={[0, headY + 1.6, 0]} center zIndexRange={[20, 0]}>
        <button
          type="button"
          onClick={onClick}
          aria-label={`Select camera ${id}`}
          className={cx(
            'whitespace-nowrap rounded-md border px-1.5 font-mono text-[9.5px] font-semibold leading-[15px] backdrop-blur',
            selected ? 'border-accent-bright bg-accent/30 text-white' : 'border-accent/40 bg-ink-950/75 text-accent-bright',
          )}
        >
          {id.replace('CAM-', 'C')}
        </button>
      </Html>
    </group>
  );
}

/** Fit the whole building into view on mode/size change or on request. */
function FitView({ f, mode, tick }: { f: Frame; mode: Mode; tick: number }) {
  const { camera, size, controls } = useThree();
  useEffect(() => {
    if (mode === '2d' && camera instanceof THREE.OrthographicCamera) {
      camera.zoom = Math.min(size.width / (f.spanX + 10), size.height / (f.spanY + 12));
      camera.position.set(0, 120, 0.001);
      camera.updateProjectionMatrix();
    } else if (mode === '3d' && camera instanceof THREE.PerspectiveCamera) {
      const dir = new THREE.Vector3(-0.42, 0.88, 1.0).normalize();
      const hx = f.spanX / 2 + 2;
      const hz = f.spanY / 2 + 2;
      const corners: THREE.Vector3[] = [];
      for (const x of [-hx, hx]) for (const z of [-hz, hz]) for (const y of [0, FLOOR_H + WALL_H + ROOF_T]) corners.push(new THREE.Vector3(x, y, z));
      camera.aspect = size.width / Math.max(1, size.height);
      const fits = (d: number) => {
        camera.position.copy(dir.clone().multiplyScalar(d));
        camera.lookAt(0, 0, 0);
        camera.updateMatrixWorld();
        camera.updateProjectionMatrix();
        return corners.every((c) => {
          const p = c.clone().project(camera);
          return Math.abs(p.x) <= 0.97 && p.y <= 0.8 && p.y >= -0.92;
        });
      };
      let lo = 10, hi = 700;
      for (let i = 0; i < 30; i++) {
        const mid = (lo + hi) / 2;
        if (fits(mid)) hi = mid;
        else lo = mid;
      }
      fits(hi);
    }
    const c = controls as unknown as { target?: THREE.Vector3; update?: () => void } | null;
    if (c?.target) {
      c.target.set(0, 0, 0);
      c.update?.();
    }
  }, [camera, size.width, size.height, f, mode, controls, tick]);
  return null;
}

export interface TwinApi {
  zoom: (k: number) => void;
}

/** Exposes zoom to the DOM controls and drives the compass needle. */
function Bridge({ apiRef, needle }: { apiRef: MutableRefObject<TwinApi | null>; needle: MutableRefObject<HTMLDivElement | null> }) {
  const { camera, controls, invalidate } = useThree();
  const last = useRef(999);
  useEffect(() => {
    apiRef.current = {
      zoom: (k: number) => {
        const c = controls as unknown as { target: THREE.Vector3; update: () => void } | null;
        if (camera instanceof THREE.OrthographicCamera) {
          camera.zoom = Math.max(1, Math.min(80, camera.zoom * k));
          camera.updateProjectionMatrix();
        } else if (c) {
          const off = camera.position.clone().sub(c.target).multiplyScalar(1 / k);
          if (off.length() > 20 && off.length() < 400) camera.position.copy(c.target.clone().add(off));
        }
        c?.update();
        invalidate();
      },
    };
  }, [camera, controls, apiRef, invalidate]);
  useFrame(() => {
    const c = controls as unknown as { target: THREE.Vector3 } | null;
    const t = c?.target ?? new THREE.Vector3();
    const az = Math.atan2(camera.position.x - t.x, camera.position.z - t.z);
    if (Math.abs(az - last.current) > 0.002 && needle.current) {
      last.current = az;
      needle.current.style.transform = `rotate(${az}rad)`;
    }
  });
  return null;
}

/** Label anchor: centroid for rooms; for corridors, a point along the long axis clear of camera markers. */
export function labelPoint(z: Zone, b: Building): Vec2 {
  if (z.kind !== 'corridor') return z.centroid;
  const xs = z.polygon.map((p) => p[0]);
  const ys = z.polygon.map((p) => p[1]);
  const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  const horizontal = x1 - x0 >= y1 - y0;
  const cams = b.cameras.filter((c) => c.zone === z.id).map((c) => c.position);
  const cands: Vec2[] = horizontal
    ? [0.2, 0.8, 0.35, 0.65].map((t) => [x0 + t * (x1 - x0), z.centroid[1]] as Vec2)
    : [0.2, 0.8, 0.35, 0.65].map((t) => [z.centroid[0], y0 + t * (y1 - y0)] as Vec2);
  let best = cands[0];
  let bestD = -1;
  for (const c of cands) {
    const d = Math.min(...cams.map((p) => Math.hypot(p[0] - c[0], p[1] - c[1])), 1e9);
    if (d > bestD + 0.5) {
      best = c;
      bestD = d;
    }
  }
  return best;
}

export function zoneHeat(b: Building, run: RunState | null) {
  const pz: Record<string, number> = {};
  for (const z of b.zones) pz[z.id] = run?.belief?.zones?.[z.id] ?? run?.zones?.[z.id]?.p_threat ?? 0;
  const maxP = Math.max(0, ...Object.values(pz));
  return { pz, maxP };
}

/** Zones painted as the incident region: hazard zones once routed, else the belief region when the threat is credible. */
export function incidentZones(run: RunState | null): string[] {
  if (!run?.belief) return [];
  if (run.routing?.hazard_zones.length) return run.routing.hazard_zones;
  return run.belief.p_threat >= 0.5 ? run.belief.region : [];
}

function Scene({
  b,
  run,
  mode,
  layers,
  hovered,
  selectedZone,
  onHover,
  onZone,
  selectedCamera,
  onCamera,
  highlightFrom,
  fitTick,
  apiRef,
  needle,
  bloom,
}: {
  b: Building;
  run: RunState | null;
  mode: Mode;
  layers: LayerState;
  hovered: string | null;
  selectedZone: string | null;
  onHover: (z: string | null) => void;
  onZone: (z: string) => void;
  selectedCamera: string | null;
  onCamera: (c: string) => void;
  highlightFrom: string | null;
  fitTick: number;
  apiRef: MutableRefObject<TwinApi | null>;
  needle: MutableRefObject<HTMLDivElement | null>;
  bloom: boolean;
}) {
  const f = useMemo<Frame>(() => {
    const [x0, y0, x1, y1] = b.bounds;
    return { cx: (x0 + x1) / 2, cy: (y0 + y1) / 2, spanX: x1 - x0, spanY: y1 - y0 };
  }, [b]);
  const { pz, maxP } = useMemo(() => zoneHeat(b, run), [b, run]);
  const hot = new Set(layers.region ? incidentZones(run) : []);
  const exclusion = new Set(layers.region ? run?.routing?.exclusion_zones ?? [] : []);
  const blocked = new Set(run?.routing?.blocked_exits ?? []);
  const zoneById = useMemo(() => new Map(b.zones.map((z) => [z.id, z])), [b]);
  const regionZones = [...hot].map((z) => zoneById.get(z)).filter((z): z is Zone => !!z);
  const mapZone = run?.belief ? run.belief.region[0] : null;
  const regionAnchor = useMemo<Vec2 | null>(() => {
    if (!regionZones.length || !run?.belief) return null;
    let sx = 0, sy = 0, sw = 0;
    for (const z of regionZones) {
      const w = (run.belief.conditional[z.id] ?? 0) + 1e-3;
      sx += z.centroid[0] * w;
      sy += z.centroid[1] * w;
      sw += w;
    }
    return [sx / sw, sy / sw];
  }, [regionZones, run?.belief]);
  const [x0, y0, x1, y1] = b.bounds;

  return (
    <>
      <color attach="background" args={['#040b16']} />
      <fog attach="fog" args={['#040b16', 140, 420]} />
      <hemisphereLight args={['#a9d2ff', '#06101e', 0.9]} />
      <ambientLight intensity={0.3} />
      <directionalLight position={[-50, 90, 60]} intensity={1.7} color="#e2f0ff" />
      <directionalLight position={[70, 35, -50]} intensity={0.6} color="#22d3ee" />

      {/* ground, campus pad, grid */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.05, 0]}>
        <planeGeometry args={[900, 900]} />
        <meshStandardMaterial color="#050e1b" roughness={1} />
      </mesh>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.02, 0]}>
        <planeGeometry args={[x1 - x0 + 26, y1 - y0 + 26]} />
        <meshStandardMaterial color="#0c2036" roughness={0.95} />
      </mesh>
      <gridHelper args={[400, 100, '#0f3a4f', '#0a2234']} position={[0, -0.01, 0]} />

      {b.zones.map((z) => (
        <ZoneBlock
          key={z.id}
          zone={z}
          f={f}
          heat={threatIntensity(pz[z.id], maxP)}
          hot={hot.has(z.id)}
          dim={!layers.occupancy}
          selected={selectedZone === z.id || hovered === z.id}
          onHover={onHover}
          onClick={onZone}
        />
      ))}
      <Walls zones={b.zones} f={f} />

      {regionZones.map((z) => (
        <Outline key={`hz-${z.id}`} zone={z} f={f} color="#ff4d4d" y={FLOOR_H + WALL_H + ROOF_T + 0.08} width={3} pulse />
      ))}
      {b.zones
        .filter((z) => exclusion.has(z.id) && !hot.has(z.id))
        .map((z) => (
          <Outline key={`ex-${z.id}`} zone={z} f={f} color={PALETTE.caution} dashed y={FLOOR_H + 0.1} width={1.6} />
        ))}
      {[selectedZone, hovered]
        .filter((x): x is string => !!x)
        .map((zid) => {
          const z = zoneById.get(zid);
          return z ? <Outline key={`sel-${zid}`} zone={z} f={f} color="#a5f3fc" y={FLOOR_H + (z.kind === 'corridor' ? 0.12 : WALL_H + ROOF_T + 0.12)} width={2} /> : null;
        })}

      {/* doors */}
      {b.doors.map((d) => (
        <mesh key={d.id} position={P(f, d.position, FLOOR_H + 0.06)}>
          <cylinderGeometry args={[0.32, 0.32, 0.08, 10]} />
          <meshBasicMaterial color={d.kind === 'lockable' ? '#3fa9c9' : '#24506a'} toneMapped={false} />
        </mesh>
      ))}

      {layers.routes &&
        (run?.routing?.routes ?? [])
          .filter((r) => r.path.length > 1)
          .map((r) => <RouteLine key={r.id} route={r} b={b} f={f} highlight={highlightFrom === r.from} />)}

      {layers.exits &&
        b.exits.map((e) => {
          const isBlocked = blocked.has(e.id);
          const col = isBlocked ? '#ef4444' : '#2dd4bf';
          return (
            <group key={e.id} position={P(f, e.position, FLOOR_H)}>
              <mesh position={[0, 0.9, 0]}>
                <boxGeometry args={[1.8, 1.8, 1.8]} />
                <meshStandardMaterial color={isBlocked ? '#3a0d14' : '#0a2e2c'} emissive={col} emissiveIntensity={0.9} toneMapped={false} transparent opacity={0.9} />
              </mesh>
              <Html position={[0, 3.3, 0]} center zIndexRange={[30, 0]} style={{ pointerEvents: 'none' }}>
                <div
                  className={cx(
                    'whitespace-nowrap rounded-md border px-1.5 font-mono text-[9.5px] font-semibold leading-[15px] backdrop-blur',
                    isBlocked ? 'border-threat/70 bg-threat-dim/90 text-threat-bright line-through' : 'border-clear/60 bg-clear-dim/90 text-clear-bright',
                  )}
                >
                  {e.id}
                </div>
              </Html>
            </group>
          );
        })}

      {layers.cameras &&
        b.cameras.map((c) => {
          const st = effectiveCameraStatus(run, c.id);
          const inRoom = zoneById.get(c.zone)?.kind !== 'corridor';
          return (
            <CameraPin
              key={c.id}
              id={c.id}
              status={st}
              pos={P(f, c.position, FLOOR_H + (inRoom ? WALL_H + ROOF_T : 0))}
              yaw={c.yaw_deg}
              color={cameraStatusColor(st)}
              selected={selectedCamera === c.id}
              onClick={() => onCamera(c.id)}
            />
          );
        })}

      {layers.movement &&
        b.cameras.map((c) => {
          const ev = run?.cameras[c.id]?.evidence;
          if (!ev || ev.flight_heading_deg == null) return null;
          return <Arrow key={`fl-${c.id}`} from={P(f, c.position, ROUTE_Y + 0.3)} heading={ev.flight_heading_deg} length={6 + 7 * Math.min(1, ev.coherence)} color="#fda4af" />;
        })}

      {/* zone tags */}
      {b.zones.map((z) => {
        const p = pz[z.id];
        const st = run?.zones[z.id];
        const obs = st?.observed ?? 'unobserved';
        const corridor = z.kind === 'corridor';
        const isHot = hot.has(z.id);
        return (
          <Html key={`lbl-${z.id}`} position={P(f, labelPoint(z, b), FLOOR_H + (corridor ? 0.6 : WALL_H + ROOF_T + 0.6))} center zIndexRange={[10, 0]} style={{ pointerEvents: 'none' }}>
            <div className="flex flex-col items-center whitespace-nowrap leading-none">
              <div
                className={cx(
                  'flex items-center gap-1 rounded border px-1 py-[2px] font-mono text-[9.5px] font-semibold backdrop-blur-sm',
                  isHot ? 'border-threat/70 bg-[#2a0a10]/85 text-[#fecaca]' : 'border-accent/30 bg-ink-950/70 text-ink-100',
                )}
              >
                <span className="h-1.5 w-1.5 rounded-full" style={{ background: observedColor(obs) }} />
                {z.id}
              </div>
              {layers.occupancy && p >= 0.02 && <div className="tnum mt-0.5 text-[9px] font-semibold text-[#fca5a5] [text-shadow:0_1px_3px_#000]">{pct(p)}</div>}
              {layers.movement && st?.persons != null && (
                <div className="tnum mt-0.5 flex items-center gap-0.5 rounded bg-ink-950/70 px-1 text-[9px] text-accent-bright">
                  <UsersRound size={9} />
                  {Math.round(st.persons)}
                </div>
              )}
            </div>
          </Html>
        );
      })}

      {layers.region && regionAnchor && run?.belief && (
        <Html position={P(f, regionAnchor, FLOOR_H + WALL_H + 7)} center zIndexRange={[40, 0]} style={{ pointerEvents: 'none' }}>
          <div className="fade-in flex flex-col items-center">
            <div className="flex items-center gap-1.5 whitespace-nowrap rounded-md border border-threat/80 bg-[#2a0a10]/90 px-2 py-1 text-[11.5px] font-semibold text-[#fecaca] shadow-glow-red backdrop-blur">
              <span className="relative flex h-2.5 w-2.5">
                <span className="ping-ring absolute inset-0 rounded-full bg-threat" />
                <span className="relative h-2.5 w-2.5 rounded-full bg-threat" />
              </span>
              <AlertTriangle size={12} />
              Threat Zone
              {mapZone && <span className="ml-1 rounded border border-threat/60 bg-black/40 px-1 font-mono text-[10px]">{mapZone}</span>}
            </div>
            <div className="h-6 w-px bg-gradient-to-b from-threat to-transparent" />
          </div>
        </Html>
      )}

      {mode === '2d' ? (
        <>
          <OrthographicCamera makeDefault position={[0, 120, 0.001]} near={0.1} far={600} />
          <OrbitControls key="2d" makeDefault enableRotate={false} enableDamping={false} screenSpacePanning minZoom={2} maxZoom={80} />
        </>
      ) : (
        <>
          <PerspectiveCamera makeDefault position={[-30, 90, 85]} fov={34} near={0.5} far={900} />
          <OrbitControls key="3d" makeDefault target={[0, 0, 0]} maxPolarAngle={Math.PI / 2.2} minDistance={20} maxDistance={400} enableDamping />
        </>
      )}
      <FitView f={f} mode={mode} tick={fitTick} />
      <Bridge apiRef={apiRef} needle={needle} />
      {bloom && (
        <EffectComposer multisampling={0}>
          <Bloom mipmapBlur luminanceThreshold={0.62} luminanceSmoothing={0.2} intensity={0.85} radius={0.7} />
          <Vignette eskil={false} offset={0.25} darkness={0.6} />
        </EffectComposer>
      )}
    </>
  );
}

function ZoneCard({ b, run, zoneId, onClose }: { b: Building; run: RunState | null; zoneId: string; onClose: () => void }) {
  const z = b.zones.find((x) => x.id === zoneId);
  if (!z) return null;
  const st = run?.zones[zoneId];
  const p = run?.belief?.zones?.[zoneId] ?? st?.p_threat ?? 0;
  const cond = run?.belief?.conditional?.[zoneId];
  const routes = (run?.routing?.routes ?? []).filter((r) => r.from === zoneId);
  const cams = b.cameras.filter((c) => c.covers.includes(zoneId));
  const inHazard = run?.routing?.hazard_zones.includes(zoneId);
  const inExcl = run?.routing?.exclusion_zones.includes(zoneId);
  const lockdown = run?.routing?.lockdown_spaces.includes(zoneId);
  return (
    <div className="fade-in w-64 rounded-xl border border-accent/25 bg-ink-900/90 p-3 text-[11.5px] shadow-2xl shadow-black/70 backdrop-blur-xl">
      <div className="mb-2 flex items-start gap-2">
        <div className="min-w-0">
          <div className="font-mono text-[10.5px] text-accent">{z.id}</div>
          <div className="truncate text-[13px] font-semibold text-ink-100">{z.name}</div>
        </div>
        <button type="button" onClick={onClose} className="ml-auto rounded p-0.5 text-ink-400 hover:text-ink-100" aria-label="Close zone details">
          <X size={14} />
        </button>
      </div>
      <div className="mb-2 flex flex-wrap gap-1">
        <Chip>{z.kind}</Chip>
        {inHazard && <Chip tone="threat">hazard</Chip>}
        {!inHazard && inExcl && <Chip tone="caution">exclusion buffer</Chip>}
        {lockdown && <Chip tone="caution">lockdown space</Chip>}
      </div>
      <div className="space-y-1">
        <div className="kv"><span className="text-ink-400">Capacity</span><span className="tnum">{z.capacity ?? '—'}</span></div>
        <div className="kv"><span className="text-ink-400">P(threat here)</span><span className="tnum font-semibold text-threat-bright">{pct(p, 1)}</span></div>
        <div className="kv"><span className="text-ink-400">P(here | threat)</span><span className="tnum">{pct(cond, 1)}</span></div>
        <div className="kv">
          <span className="text-ink-400">Observed</span>
          <span className="flex items-center gap-1">
            <span className="h-1.5 w-1.5 rounded-full" style={{ background: observedColor(st?.observed ?? 'unobserved') }} />
            {st?.observed ?? 'unobserved'}
          </span>
        </div>
        <div className="kv"><span className="text-ink-400">Persons (median)</span><span className="tnum">{st?.persons ?? '—'}</span></div>
        <div className="kv"><span className="text-ink-400">Last camera</span><span className="font-mono">{st?.last_camera ?? '—'}</span></div>
        <div className="kv"><span className="text-ink-400">Covered by</span><span className="font-mono">{cams.map((c) => c.id).join(', ') || 'no camera'}</span></div>
      </div>
      {routes.length > 0 && (
        <div className="mt-2 border-t border-ink-700 pt-2">
          <div className="label mb-1">Routes from here</div>
          {routes.map((r) => (
            <div key={r.id} className="flex items-center gap-1.5 py-0.5">
              <span className="h-1.5 w-3 rounded-full" style={{ background: routeColor(r.operational_status), boxShadow: `0 0 6px ${routeColor(r.operational_status)}` }} />
              <span className="font-mono text-[10.5px]">{r.exit ?? 'none'}</span>
              <span className="tnum ml-auto text-ink-300">{r.length_m != null ? `${r.length_m} m` : ''}</span>
              <span className="text-[10.5px] text-ink-300">{r.operational_status.replace('_', ' ')}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function LayersMenu({ layers, onChange }: { layers: LayerState; onChange: (l: LayerState) => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const h = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && setOpen(false);
    const k = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', h);
    document.addEventListener('keydown', k);
    return () => {
      document.removeEventListener('mousedown', h);
      document.removeEventListener('keydown', k);
    };
  }, [open]);
  const on = Object.values(layers).filter(Boolean).length;
  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-haspopup="true"
        className="flex h-8 items-center gap-2 rounded-lg border border-ink-600 bg-ink-900/80 px-2.5 text-[12px] text-ink-100 backdrop-blur hover:border-accent/50"
      >
        <Layers size={13} className="text-accent" />
        Layers
        <span className="tnum text-[10.5px] text-ink-400">{on}/6</span>
        <ChevronDown size={13} className="text-ink-400" />
      </button>
      {open && (
        <div className="fade-in absolute right-0 top-[calc(100%+6px)] z-[70] w-56 rounded-xl border border-accent/25 bg-ink-900/95 p-2 shadow-2xl backdrop-blur-xl" role="group" aria-label="Map layers">
          {LAYER_LABELS.map(([k, label]) => (
            <label key={k} className="flex cursor-pointer items-center gap-2.5 rounded-md px-2 py-1.5 text-[12px] text-ink-100 hover:bg-ink-800">
              <input
                type="checkbox"
                checked={layers[k]}
                onChange={(e) => onChange({ ...layers, [k]: e.target.checked })}
                className={cx('h-3.5 w-3.5 rounded', k === 'region' ? 'accent-[#ef4444]' : 'accent-[#22d3ee]')}
              />
              {label}
            </label>
          ))}
        </div>
      )}
    </div>
  );
}

function Minimap({ b, run, selected, onZone }: { b: Building; run: RunState | null; selected: string | null; onZone: (z: string) => void }) {
  const [x0, y0, x1, y1] = b.bounds;
  const w = x1 - x0, h = y1 - y0;
  const { pz, maxP } = zoneHeat(b, run);
  const hot = new Set(incidentZones(run));
  return (
    <svg viewBox={`${x0 - 2} ${-y1 - 2} ${w + 4} ${h + 4}`} className="h-[64px] w-[120px]" role="img" aria-label="Building footprint minimap">
      {b.zones.map((z) => (
        <polygon
          key={z.id}
          points={z.polygon.map(([x, y]) => `${x},${-y}`).join(' ')}
          fill={hot.has(z.id) ? '#b91c1c' : threatColor(pz[z.id], maxP)}
          stroke={selected === z.id ? '#a5f3fc' : hot.has(z.id) ? '#fca5a5' : '#22d3ee'}
          strokeOpacity={selected === z.id || hot.has(z.id) ? 1 : 0.45}
          strokeWidth={0.6}
          className="cursor-pointer"
          onClick={() => onZone(z.id)}
        >
          <title>{`${z.id} · ${z.name}`}</title>
        </polygon>
      ))}
      {b.cameras.map((c) => (
        <circle key={c.id} cx={c.position[0]} cy={-c.position[1]} r={1.3} fill={cameraStatusColor(effectiveCameraStatus(run, c.id))} />
      ))}
    </svg>
  );
}

function canWebGL(): boolean {
  try {
    const c = document.createElement('canvas');
    return !!(c.getContext('webgl2') || c.getContext('webgl'));
  } catch {
    return false;
  }
}

export function Twin({
  building,
  run,
  selectedCamera,
  onSelectCamera,
  selectedZone: controlledZone,
  onSelectZone,
  title = 'Campus Digital Twin',
  className,
}: {
  building: Building | null;
  run: RunState | null;
  selectedCamera: string | null;
  onSelectCamera: (cid: string) => void;
  selectedZone?: string | null;
  onSelectZone?: (z: string | null) => void;
  title?: string;
  className?: string;
}) {
  const [mode, setMode] = useState<Mode>('3d');
  const [layers, setLayers] = useState<LayerState>(DEFAULT_LAYERS);
  const [hovered, setHovered] = useState<string | null>(null);
  const [localPinned, setLocalPinned] = useState<string | null>(null);
  const pinned = controlledZone !== undefined ? controlledZone : localPinned;
  const setPinned = (z: string | null) => (onSelectZone ? onSelectZone(z) : setLocalPinned(z));
  const [fitTick, setFitTick] = useState(0);
  const [legend, setLegend] = useState(false);
  const apiRef = useRef<TwinApi | null>(null);
  const needle = useRef<HTMLDivElement | null>(null);
  const [webgl] = useState(canWebGL);
  const cardZone = pinned ?? hovered;

  const counts = useMemo(() => {
    const c = { error: 0, warning: 0, info: 0 } as Record<string, number>;
    for (const v of building?.validation ?? []) c[v.severity] = (c[v.severity] ?? 0) + 1;
    return c;
  }, [building]);

  return (
    <section className={cx('panel relative flex h-full min-h-[380px] flex-col overflow-hidden', className)} aria-label={title}>
      <header className="panel-header">
        <MapIcon size={15} />
        <span>{title}</span>
        <div className="ml-3 flex overflow-hidden rounded-lg border border-ink-600 bg-ink-900/70 p-0.5" role="group" aria-label="View mode">
          {(['3d', '2d'] as Mode[]).map((m) => (
            <button
              key={m}
              type="button"
              aria-pressed={mode === m}
              onClick={() => setMode(m)}
              className={cx(
                'flex items-center gap-1 rounded-md px-3 py-0.5 text-[11.5px] font-semibold transition-all',
                mode === m ? 'bg-gradient-to-b from-accent/40 to-accent/15 text-white shadow-glow-cyan' : 'text-ink-300 hover:text-ink-100',
              )}
            >
              {m === '3d' ? <Box size={11} /> : <MapIcon size={11} />}
              {m.toUpperCase()}
            </button>
          ))}
        </div>
        <div className="ml-auto flex items-center gap-2">
          {building && (
            <span
              className="hidden items-center gap-1 whitespace-nowrap text-[11px] font-normal text-ink-300 min-[1700px]:flex"
              title={building.validation.map((v) => `${v.severity}: ${v.message}`).join('\n') || 'No validation issues'}
            >
              {counts.error ? <AlertTriangle size={12} className="!text-threat" /> : <CheckCircle2 size={12} className="!text-clear" />}
              {counts.error} err · {counts.warning} warn · {counts.info} info
            </span>
          )}
          <LayersMenu layers={layers} onChange={setLayers} />
        </div>
      </header>
      <div className="relative min-h-0 flex-1" onPointerLeave={() => setHovered(null)}>
        {!building ? (
          <div className="flex h-full items-center justify-center text-ink-400">Loading building model…</div>
        ) : !webgl ? (
          <div className="flex h-full items-center justify-center p-6 text-center text-ink-300">WebGL is not available in this browser; the 2D/3D twin cannot be rendered.</div>
        ) : (
          <Canvas
            dpr={[1, 2]}
            gl={{ antialias: true, preserveDrawingBuffer: true, powerPreference: 'high-performance' }}
            onPointerMissed={() => setPinned(null)}
            style={{ cursor: hovered ? 'pointer' : 'grab' }}
          >
            <Suspense fallback={null}>
              <Scene
                b={building}
                run={run}
                mode={mode}
                layers={layers}
                hovered={hovered}
                selectedZone={pinned}
                onHover={setHovered}
                onZone={(z) => setPinned(pinned === z ? null : z)}
                selectedCamera={selectedCamera}
                onCamera={onSelectCamera}
                highlightFrom={cardZone}
                fitTick={fitTick}
                apiRef={apiRef}
                needle={needle}
                bloom
              />
            </Suspense>
          </Canvas>
        )}
        {building && webgl && (
          <>
            {cardZone && (
              <div className="absolute left-3 top-3 z-[60]">
                <ZoneCard
                  b={building}
                  run={run}
                  zoneId={cardZone}
                  onClose={() => {
                    setPinned(null);
                    setHovered(null);
                  }}
                />
              </div>
            )}
            {/* compass */}
            <div className="pointer-events-none absolute bottom-3 left-3 z-[60] flex h-14 w-14 items-center justify-center rounded-full border border-accent/30 bg-ink-950/70 backdrop-blur" aria-label="Compass" role="img">
              <div ref={needle} className="relative h-full w-full transition-transform duration-75">
                <span className="absolute left-1/2 top-0.5 -translate-x-1/2 text-[9px] font-bold text-accent-bright">N</span>
                <span className="absolute bottom-0.5 left-1/2 -translate-x-1/2 text-[8px] text-ink-400">S</span>
                <span className="absolute left-1 top-1/2 -translate-y-1/2 text-[8px] text-ink-400">W</span>
                <span className="absolute right-1 top-1/2 -translate-y-1/2 text-[8px] text-ink-400">E</span>
                <span className="absolute left-1/2 top-1/2 h-5 w-[3px] -translate-x-1/2 -translate-y-full rounded-full bg-gradient-to-t from-transparent to-accent-bright" />
              </div>
            </div>
            {/* legend */}
            <div className="absolute bottom-3 left-[76px] z-[60]">
              <button
                type="button"
                onClick={() => setLegend((l) => !l)}
                aria-expanded={legend}
                className="rounded-lg border border-ink-600 bg-ink-900/80 px-2 py-1 text-[10.5px] text-ink-200 backdrop-blur hover:border-accent/50"
              >
                Legend
              </button>
              {legend && (
                <div className="fade-in absolute bottom-[calc(100%+6px)] left-0 w-[230px] rounded-xl border border-accent/25 bg-ink-900/95 p-2.5 text-[10.5px] text-ink-200 shadow-2xl backdrop-blur-xl">
                  <div className="label mb-1">Zone heat: P(threat), relative to max</div>
                  <div className="mb-2 h-1.5 rounded" style={{ background: `linear-gradient(90deg, ${threatColor(0, 1)}, ${threatColor(0.3, 1)}, ${threatColor(1, 1)})` }} />
                  <div className="grid grid-cols-2 gap-1">
                    {[
                      ['verified clear route', PALETTE.clear],
                      ['unverified route', PALETTE.caution],
                      ['exposed route', PALETTE.threat],
                      ['flight vector', '#fda4af'],
                      ['incident region', '#ff4d4d'],
                      ['exclusion buffer', PALETTE.caution],
                      ['camera analysed', '#22d3ee'],
                      ['exit / blocked', '#2dd4bf'],
                    ].map(([l, c]) => (
                      <span key={l} className="flex items-center gap-1.5">
                        <span className="h-[3px] w-3.5 rounded" style={{ background: c, boxShadow: `0 0 5px ${c}` }} />
                        {l}
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </div>
            {/* zoom / fit + minimap */}
            <div className="absolute bottom-3 right-3 z-[60] flex items-end gap-2">
              <div className="hidden rounded-xl border border-accent/25 bg-ink-950/70 p-1.5 backdrop-blur sm:block">
                <Minimap b={building} run={run} selected={pinned} onZone={(z) => setPinned(pinned === z ? null : z)} />
              </div>
              <div className="flex flex-col overflow-hidden rounded-xl border border-accent/25 bg-ink-950/75 backdrop-blur">
                <button type="button" aria-label="Zoom in" onClick={() => apiRef.current?.zoom(1.25)} className="p-2 text-ink-200 hover:bg-accent/15 hover:text-white">
                  <Plus size={15} />
                </button>
                <button type="button" aria-label="Zoom out" onClick={() => apiRef.current?.zoom(0.8)} className="border-t border-ink-700 p-2 text-ink-200 hover:bg-accent/15 hover:text-white">
                  <Minus size={15} />
                </button>
                <button type="button" aria-label="Fit building to view" onClick={() => setFitTick((t) => t + 1)} className="border-t border-ink-700 p-2 text-ink-200 hover:bg-accent/15 hover:text-white">
                  <Maximize2 size={14} />
                </button>
              </div>
            </div>
          </>
        )}
      </div>
    </section>
  );
}
