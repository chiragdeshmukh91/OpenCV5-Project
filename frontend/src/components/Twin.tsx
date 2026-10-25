import { Suspense, useEffect, useMemo, useState } from 'react';
import { Canvas, useThree } from '@react-three/fiber';
import { Html, Line, OrbitControls, OrthographicCamera, PerspectiveCamera } from '@react-three/drei';
import * as THREE from 'three';
import { AlertTriangle, Box, CheckCircle2, Info, Map as MapIcon, X } from 'lucide-react';
import type { Building, Route, RunState, Vec2, Zone } from '../types';
import { cameraStatusColor, observedColor, PALETTE, routeColor, threatColor } from '../lib/colors';
import { headingVec, routePolyline } from '../lib/geometry';
import { effectiveCameraStatus, pct } from '../lib/format';
import { Chip, cx } from './ui';

type Mode = '2d' | '3d';

const FLOOR_H = 0.3;
const WALL_H = 1.1;
const ROUTE_Y = FLOOR_H + 0.55;

interface Frame {
  cx: number;
  cy: number;
  spanX: number;
  spanY: number;
}

function useFrame(b: Building): Frame {
  return useMemo(() => {
    const [x0, y0, x1, y1] = b.bounds;
    return { cx: (x0 + x1) / 2, cy: (y0 + y1) / 2, spanX: x1 - x0, spanY: y1 - y0 };
  }, [b]);
}

const P = (f: Frame, [x, y]: Vec2, h = 0): [number, number, number] => [x - f.cx, h, -(y - f.cy)];

const UP = new THREE.Vector3(0, 1, 0);
/** Quaternion turning a +Y cone so its tip points along (dx, dy, dz). */
function coneQuat(dx: number, dy: number, dz: number): THREE.Quaternion {
  const v = new THREE.Vector3(dx, dy, dz);
  if (v.lengthSq() < 1e-9) return new THREE.Quaternion();
  return new THREE.Quaternion().setFromUnitVectors(UP, v.normalize());
}

function ZoneMesh({
  zone,
  f,
  color,
  hovered,
  selected,
  onHover,
  onClick,
}: {
  zone: Zone;
  f: Frame;
  color: string;
  hovered: boolean;
  selected: boolean;
  onHover: (id: string | null) => void;
  onClick: (id: string) => void;
}) {
  const geom = useMemo(() => {
    const shape = new THREE.Shape(zone.polygon.map(([x, y]) => new THREE.Vector2(x - f.cx, y - f.cy)));
    const g = new THREE.ExtrudeGeometry(shape, { depth: FLOOR_H, bevelEnabled: false });
    g.rotateX(-Math.PI / 2);
    return g;
  }, [zone, f]);
  const walls = useMemo(() => {
    const out: { pos: [number, number, number]; len: number; rot: number }[] = [];
    const poly = zone.polygon;
    for (let i = 0; i < poly.length; i++) {
      const a = poly[i];
      const b = poly[(i + 1) % poly.length];
      const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
      const mid: Vec2 = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
      out.push({ pos: P(f, mid, FLOOR_H + WALL_H / 2), len, rot: Math.atan2(b[1] - a[1], b[0] - a[0]) });
    }
    return out;
  }, [zone, f]);
  const c = useMemo(() => {
    const col = new THREE.Color(color);
    if (hovered || selected) col.lerp(new THREE.Color('#ffffff'), 0.12);
    return col;
  }, [color, hovered, selected]);
  return (
    <group>
      <mesh
        geometry={geom}
        onPointerOver={(e) => {
          e.stopPropagation();
          onHover(zone.id);
        }}
        onPointerOut={() => onHover(null)}
        onClick={(e) => {
          e.stopPropagation();
          onClick(zone.id);
        }}
      >
        <meshStandardMaterial color={c} roughness={0.85} metalness={0.05} />
      </mesh>
      {walls.map((w, i) => (
        <mesh key={i} position={w.pos} rotation={[0, w.rot, 0]}>
          <boxGeometry args={[w.len, WALL_H, 0.18]} />
          <meshStandardMaterial color="#3a4757" transparent opacity={0.55} roughness={0.9} />
        </mesh>
      ))}
    </group>
  );
}

function Outline({ zone, f, color, dashed, y, width = 2 }: { zone: Zone; f: Frame; color: string; dashed?: boolean; y: number; width?: number }) {
  const pts = useMemo(() => [...zone.polygon, zone.polygon[0]].map((p) => P(f, p, y)), [zone, f, y]);
  return (
    <Line
      points={pts}
      color={color}
      lineWidth={width}
      dashed={dashed}
      dashSize={1.2}
      gapSize={0.8}
      depthTest={false}
      renderOrder={5}
    />
  );
}

function RouteLine({ route, b, f, highlight }: { route: Route; b: Building; f: Frame; highlight: boolean }) {
  const pts = useMemo(() => routePolyline(route, b).map((p) => P(f, p, ROUTE_Y)), [route, b, f]);
  if (pts.length < 2) return null;
  const color = routeColor(route.operational_status);
  const end = pts[pts.length - 1];
  const prev = pts[pts.length - 2];
  const q = coneQuat(end[0] - prev[0], 0, end[2] - prev[2]);
  return (
    <group>
      <Line
        points={pts}
        color={color}
        lineWidth={highlight ? 4 : 2.5}
        dashed={!route.safe}
        dashSize={1.1}
        gapSize={0.7}
        transparent
        opacity={highlight ? 1 : 0.9}
        depthTest={false}
        renderOrder={10}
      />
      <mesh position={end} quaternion={q} renderOrder={11}>
        <coneGeometry args={[0.7, 1.6, 12]} />
        <meshBasicMaterial color={color} depthTest={false} />
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
      <Line points={[from, to]} color={color} lineWidth={3} depthTest={false} renderOrder={12} />
      <mesh position={to} quaternion={q} renderOrder={13}>
        <coneGeometry args={[0.75, 1.8, 12]} />
        <meshBasicMaterial color={color} depthTest={false} />
      </mesh>
    </group>
  );
}

function CameraMarker({
  pos,
  yaw,
  color,
  selected,
  id,
  onClick,
}: {
  pos: [number, number, number];
  yaw: number;
  color: string;
  selected: boolean;
  id: string;
  onClick: () => void;
}) {
  const [dx, dy] = headingVec(yaw);
  const fov = useMemo(() => {
    const r = 4.5;
    const half = (28 * Math.PI) / 180;
    const base = Math.atan2(dy, dx);
    const p1: Vec2 = [Math.cos(base - half) * r, Math.sin(base - half) * r];
    const p2: Vec2 = [Math.cos(base + half) * r, Math.sin(base + half) * r];
    const shape = new THREE.Shape([new THREE.Vector2(0, 0), new THREE.Vector2(...p1), new THREE.Vector2(...p2)]);
    const g = new THREE.ShapeGeometry(shape);
    g.rotateX(-Math.PI / 2);
    return g;
  }, [dx, dy]);
  return (
    <group position={pos}>
      <mesh geometry={fov} position={[0, 0.02, 0]} renderOrder={6}>
        <meshBasicMaterial color={color} transparent opacity={0.28} depthTest={false} side={THREE.DoubleSide} />
      </mesh>
      <mesh
        onClick={(e) => {
          e.stopPropagation();
          onClick();
        }}
        renderOrder={7}
      >
        <cylinderGeometry args={[selected ? 1.05 : 0.8, selected ? 1.05 : 0.8, 0.5, 20]} />
        <meshBasicMaterial color={selected ? '#e6ebf0' : color} depthTest={false} />
      </mesh>
      {selected && (
        <mesh renderOrder={6} position={[0, -0.05, 0]}>
          <cylinderGeometry args={[1.45, 1.45, 0.4, 24]} />
          <meshBasicMaterial color={color} depthTest={false} />
        </mesh>
      )}
      <Html position={[2.4, 0.6, 1.6]} center zIndexRange={[20, 0]} style={{ pointerEvents: 'none' }}>
        <div className="whitespace-nowrap rounded bg-black/60 px-1 font-mono text-[9px] leading-[13px]" style={{ color }}>
          {id.replace('CAM-', 'C')}
        </div>
      </Html>
    </group>
  );
}

/** Fit the whole building into view whenever the mode or the canvas size changes. */
function FitView({ f, mode }: { f: Frame; mode: Mode }) {
  const { camera, size, controls } = useThree();
  useEffect(() => {
    const margin = 10;
    if (mode === '2d' && camera instanceof THREE.OrthographicCamera) {
      camera.zoom = Math.min(size.width / (f.spanX + margin), size.height / (f.spanY + margin));
      camera.position.set(0, 100, 0.001);
      camera.updateProjectionMatrix();
    } else if (mode === '3d' && camera instanceof THREE.PerspectiveCamera) {
      // Binary-search the camera distance along a fixed viewing direction until every corner of the
      // building's bounding box (floor and wall tops) projects inside the viewport with a small margin.
      const dir = new THREE.Vector3(0, 1.0, 0.85).normalize();
      const hx = f.spanX / 2 + 3;
      const hz = f.spanY / 2 + 3;
      const corners: THREE.Vector3[] = [];
      for (const x of [-hx, hx]) for (const z of [-hz, hz]) for (const y of [0, FLOOR_H + WALL_H]) corners.push(new THREE.Vector3(x, y, z));
      camera.aspect = size.width / Math.max(1, size.height);
      const fits = (d: number) => {
        camera.position.copy(dir.clone().multiplyScalar(d));
        camera.lookAt(0, 0, 0);
        camera.updateMatrixWorld();
        camera.updateProjectionMatrix();
        return corners.every((c) => {
          const p = c.clone().project(camera);
          return Math.abs(p.x) <= 0.94 && Math.abs(p.y) <= 0.9;
        });
      };
      let lo = 10, hi = 600;
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
  }, [camera, size.width, size.height, f, mode, controls]);
  return null;
}

/** Label anchor: centroid for rooms; for corridors, a point along the long axis clear of camera markers. */
function labelPoint(z: Zone, b: Building): Vec2 {
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

function Scene({
  b,
  run,
  mode,
  hovered,
  selectedZone,
  onHover,
  onZone,
  selectedCamera,
  onCamera,
  highlightFrom,
}: {
  b: Building;
  run: RunState | null;
  mode: Mode;
  hovered: string | null;
  selectedZone: string | null;
  onHover: (z: string | null) => void;
  onZone: (z: string) => void;
  selectedCamera: string | null;
  onCamera: (c: string) => void;
  highlightFrom: string | null;
}) {
  const f = useFrame(b);
  const pz = useMemo(() => {
    const out: Record<string, number> = {};
    for (const z of b.zones) out[z.id] = run?.belief?.zones?.[z.id] ?? run?.zones?.[z.id]?.p_threat ?? 0;
    return out;
  }, [b, run]);
  const maxP = Math.max(0, ...Object.values(pz));
  const hazard = new Set(run?.routing?.hazard_zones ?? []);
  const exclusion = new Set(run?.routing?.exclusion_zones ?? []);
  const blocked = new Set(run?.routing?.blocked_exits ?? []);
  const zoneById = useMemo(() => new Map(b.zones.map((z) => [z.id, z])), [b]);
  const region = run?.belief && run.belief.p_threat >= 0.15 ? run.belief.region : [];
  const regionCenter = useMemo<Vec2 | null>(() => {
    if (!region.length || !run?.belief) return null;
    let sx = 0, sy = 0, sw = 0;
    for (const z of region) {
      const zone = zoneById.get(z);
      const w = run.belief.conditional[z] ?? 0;
      if (!zone) continue;
      sx += zone.centroid[0] * w;
      sy += zone.centroid[1] * w;
      sw += w;
    }
    return sw > 0 ? [sx / sw, sy / sw] : null;
  }, [region, run?.belief, zoneById]);

  return (
    <>
      <color attach="background" args={['#0a0e13']} />
      <ambientLight intensity={0.75} />
      <directionalLight position={[30, 60, 25]} intensity={0.9} />
      <directionalLight position={[-30, 40, -20]} intensity={0.25} />

      {/* ground grid */}
      <gridHelper args={[160, 32, '#16202b', '#111821']} position={[0, -0.01, 0]} />

      {b.zones.map((z) => (
        <ZoneMesh
          key={z.id}
          zone={z}
          f={f}
          color={threatColor(pz[z.id], maxP)}
          hovered={hovered === z.id}
          selected={selectedZone === z.id}
          onHover={onHover}
          onClick={onZone}
        />
      ))}

      {b.zones
        .filter((z) => exclusion.has(z.id) && !hazard.has(z.id))
        .map((z) => (
          <Outline key={`ex-${z.id}`} zone={z} f={f} color={PALETTE.caution} dashed y={FLOOR_H + 0.05} width={1.6} />
        ))}
      {b.zones
        .filter((z) => hazard.has(z.id))
        .map((z) => (
          <Outline key={`hz-${z.id}`} zone={z} f={f} color="#e07c80" y={FLOOR_H + 0.07} width={2.6} />
        ))}
      {(selectedZone || hovered) &&
        [selectedZone, hovered]
          .filter((x): x is string => !!x)
          .map((zid) => {
            const z = zoneById.get(zid);
            return z ? <Outline key={`sel-${zid}`} zone={z} f={f} color="#dde3ea" y={FLOOR_H + 0.09} width={1.5} /> : null;
          })}

      {/* doors */}
      {b.doors.map((d) => (
        <mesh key={d.id} position={P(f, d.position, FLOOR_H + 0.05)}>
          <cylinderGeometry args={[0.35, 0.35, 0.1, 10]} />
          <meshBasicMaterial color={d.kind === 'lockable' ? '#5b6879' : '#3a4757'} />
        </mesh>
      ))}

      {/* routes */}
      {(run?.routing?.routes ?? [])
        .filter((r) => r.path.length > 1)
        .map((r) => (
          <RouteLine key={r.id} route={r} b={b} f={f} highlight={highlightFrom === r.from} />
        ))}

      {/* exits */}
      {b.exits.map((e) => {
        const isBlocked = blocked.has(e.id);
        const pos = P(f, e.position, FLOOR_H + 0.4);
        return (
          <group key={e.id} position={pos}>
            <mesh renderOrder={8}>
              <boxGeometry args={[2.2, 0.8, 2.2]} />
              <meshBasicMaterial color={isBlocked ? '#4a2529' : '#173a33'} depthTest={false} />
            </mesh>
            <Html position={[0, 0.5, 0]} center zIndexRange={[30, 0]} style={{ pointerEvents: 'none' }}>
              <div
                className={cx(
                  'whitespace-nowrap rounded border px-1 font-mono text-[9.5px] font-semibold leading-[14px]',
                  isBlocked ? 'border-threat-soft/70 bg-[#2a1517]/90 text-[#eba9ac] line-through' : 'border-clear-soft/60 bg-[#0e2420]/90 text-[#9fe0cf]',
                )}
              >
                {e.id}
              </div>
            </Html>
          </group>
        );
      })}

      {/* cameras */}
      {b.cameras.map((c) => (
        <CameraMarker
          key={c.id}
          id={c.id}
          pos={P(f, c.position, FLOOR_H + 0.35)}
          yaw={c.yaw_deg}
          color={cameraStatusColor(effectiveCameraStatus(run, c.id))}
          selected={selectedCamera === c.id}
          onClick={() => onCamera(c.id)}
        />
      ))}

      {/* flight vectors from evidence */}
      {b.cameras.map((c) => {
        const ev = run?.cameras[c.id]?.evidence;
        if (!ev || ev.flight_heading_deg == null) return null;
        return (
          <Arrow
            key={`fl-${c.id}`}
            from={P(f, c.position, ROUTE_Y + 0.1)}
            heading={ev.flight_heading_deg}
            length={6 + 6 * Math.min(1, ev.coherence)}
            color="#f0c4c6"
          />
        );
      })}

      {/* zone labels */}
      {b.zones.map((z) => {
        const p = pz[z.id];
        const obs = run?.zones[z.id]?.observed ?? 'unobserved';
        return (
          <Html key={`lbl-${z.id}`} position={P(f, labelPoint(z, b), FLOOR_H + 0.2)} center zIndexRange={[10, 0]} style={{ pointerEvents: 'none' }}>
            <div className="flex flex-col items-center gap-0 whitespace-nowrap leading-none">
              <div className="flex items-center gap-1 font-mono text-[9.5px] font-semibold text-ink-100/90 [text-shadow:0_1px_2px_#000]">
                <span className="h-1.5 w-1.5 rounded-full" style={{ background: observedColor(obs) }} />
                {z.id}
              </div>
              {p >= 0.02 && <div className="tnum mt-0.5 text-[9px] font-medium text-[#f0c4c6] [text-shadow:0_1px_2px_#000]">{pct(p)}</div>}
            </div>
          </Html>
        );
      })}

      {regionCenter && run?.belief && (
        <Html position={P(f, regionCenter, WALL_H + 7)} center zIndexRange={[40, 0]} style={{ pointerEvents: 'none' }}>
          <div className="fade-in -translate-y-7 whitespace-nowrap rounded-md border border-threat-soft/70 bg-[#1d1013]/90 px-2 py-1 text-center shadow-lg">
            <div className="text-[9px] font-semibold uppercase tracking-[0.12em] text-[#eba9ac]">
              {run.belief.localized ? 'Probable threat region' : 'Threat mass (not localised)'}
            </div>
            <div className="tnum font-mono text-[10.5px] text-ink-100">
              {run.belief.region.join(' · ')} — {pct(run.belief.region_mass)}
            </div>
          </div>
        </Html>
      )}

      {mode === '2d' ? (
        <>
          <OrthographicCamera makeDefault position={[0, 100, 0.001]} near={0.1} far={500} />
          <OrbitControls key="2d" makeDefault enableRotate={false} enableDamping={false} screenSpacePanning minZoom={2} maxZoom={60} />
          <FitView f={f} mode={mode} />
        </>
      ) : (
        <>
          <PerspectiveCamera makeDefault position={[8, 80, 76]} fov={36} near={0.5} far={800} />
          <OrbitControls key="3d" makeDefault target={[0, 0, 0]} maxPolarAngle={Math.PI / 2.15} minDistance={25} maxDistance={320} enableDamping />
          <FitView f={f} mode={mode} />
        </>
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
    <div className="fade-in w-64 rounded-lg border border-ink-600 bg-ink-850/95 p-3 text-[11.5px] shadow-2xl shadow-black/60 backdrop-blur">
      <div className="mb-2 flex items-start gap-2">
        <div className="min-w-0">
          <div className="font-mono text-[10.5px] text-ink-400">{z.id}</div>
          <div className="truncate text-[13px] font-semibold text-ink-100">{z.name}</div>
        </div>
        <button type="button" onClick={onClose} className="ml-auto rounded p-0.5 text-ink-400 hover:text-ink-100" aria-label="Close">
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
        <div className="kv"><span className="text-ink-400">Area</span><span className="tnum">{z.area_m2 ? `${z.area_m2} m²` : '—'}</span></div>
        <div className="kv"><span className="text-ink-400">P(threat here)</span><span className="tnum font-semibold text-[#eba9ac]">{pct(p, 1)}</span></div>
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
              <span className="h-1.5 w-3 rounded-full" style={{ background: routeColor(r.operational_status) }} />
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

function Legend({ maxP }: { maxP: number }) {
  const [open, setOpen] = useState(() => typeof window === 'undefined' || window.innerWidth >= 1500);
  const item = (swatch: JSX.Element, label: string) => (
    <span className="flex items-center gap-1.5 whitespace-nowrap">
      {swatch}
      {label}
    </span>
  );
  return (
    <div className="pointer-events-auto w-[214px] rounded-lg border border-ink-700 bg-ink-900/90 text-[10px] text-ink-300 backdrop-blur">
      <button type="button" onClick={() => setOpen((o) => !o)} className="flex w-full items-center gap-2 px-2.5 py-1.5 text-left">
        <span className="label">Legend</span>
        <span className="h-1.5 flex-1 rounded-sm" style={{ background: `linear-gradient(90deg, ${threatColor(0, 1)}, ${threatColor(0.25, 1)}, ${threatColor(1, 1)})` }} />
        <span className="tnum text-[9.5px] text-ink-400">max {pct(maxP)}</span>
      </button>
      {open && (
        <div className="space-y-1.5 border-t border-ink-700 px-2.5 pb-2 pt-1.5">
          <div className="text-[9.5px] text-ink-400">Zone fill: P(threat), relative to the most probable zone</div>
          <div className="grid grid-cols-2 gap-x-2 gap-y-1">
            {item(<span className="h-[3px] w-4 rounded" style={{ background: PALETTE.clear }} />, 'verified clear')}
            {item(<span className="h-0 w-4 border-t-2 border-dashed" style={{ borderColor: PALETTE.caution }} />, 'unverified')}
            {item(<span className="h-0 w-4 border-t-2 border-dashed" style={{ borderColor: PALETTE.threat }} />, 'exposed')}
            {item(<span className="h-[3px] w-4 rounded" style={{ background: '#f0c4c6' }} />, 'flight vector')}
            {item(<span className="h-2.5 w-2.5 rounded-sm border-2" style={{ borderColor: '#e07c80' }} />, 'hazard zone')}
            {item(<span className="h-2.5 w-2.5 rounded-sm border-2 border-dashed" style={{ borderColor: PALETTE.caution }} />, 'exclusion')}
          </div>
          <div className="flex flex-wrap gap-x-2 gap-y-0.5 border-t border-ink-700 pt-1.5">
            {[
              ['clear', PALETTE.clear],
              ['fleeing', PALETTE.threat],
              ['congested', PALETTE.caution],
              ['unobserved', PALETTE.gray],
            ].map(([l, c]) => (
              <span key={l} className="flex items-center gap-1">
                <span className="h-1.5 w-1.5 rounded-full" style={{ background: c }} />
                {l}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function ValidationSummary({ b }: { b: Building }) {
  const counts = { error: 0, warning: 0, info: 0 } as Record<string, number>;
  for (const v of b.validation) counts[v.severity] = (counts[v.severity] ?? 0) + 1;
  const ok = counts.error === 0;
  return (
    <div className="group pointer-events-auto relative">
      <div className="flex items-center gap-2 rounded-lg border border-ink-700 bg-ink-900/90 px-2.5 py-1.5 text-[11px] backdrop-blur">
        {ok ? <CheckCircle2 size={13} className="text-clear" /> : <AlertTriangle size={13} className="text-threat" />}
        <span className="max-w-[260px] truncate font-medium text-ink-100">{b.name}</span>
        <span className="tnum text-ink-400">
          <span className={counts.error ? 'text-[#eba9ac]' : ''}>{counts.error} err</span> ·{' '}
          <span className={counts.warning ? 'text-[#e6bd6e]' : ''}>{counts.warning} warn</span> · {counts.info} info
        </span>
        <Info size={12} className="text-ink-500" />
      </div>
      <div className="invisible absolute left-0 top-[calc(100%+6px)] z-30 w-80 rounded-lg border border-ink-600 bg-ink-850 p-2.5 text-[11px] opacity-0 shadow-2xl transition-opacity group-hover:visible group-hover:opacity-100">
        <div className="label mb-1">Building model validation</div>
        {b.validation.length === 0 && <div className="text-ink-300">No issues.</div>}
        {b.validation.map((v, i) => (
          <div key={i} className="flex gap-2 py-0.5">
            <span className={cx('w-12 shrink-0 font-mono text-[10px] uppercase', v.severity === 'error' ? 'text-[#eba9ac]' : v.severity === 'warning' ? 'text-[#e6bd6e]' : 'text-ink-400')}>
              {v.severity}
            </span>
            <span className="text-ink-200">{v.message}</span>
          </div>
        ))}
        <div className="mt-1.5 border-t border-ink-700 pt-1.5 text-ink-400">
          Constraints: min door {String(b.constraints.min_door_width_m)} m · max travel {String(b.constraints.max_travel_distance_m)} m · buffer{' '}
          {String(b.constraints.hazard_buffer_hops)} hop
        </div>
      </div>
    </div>
  );
}

export function Twin({
  building,
  run,
  selectedCamera,
  onSelectCamera,
}: {
  building: Building | null;
  run: RunState | null;
  selectedCamera: string | null;
  onSelectCamera: (cid: string) => void;
}) {
  const [mode, setMode] = useState<Mode>('3d');
  const [hovered, setHovered] = useState<string | null>(null);
  const [pinned, setPinned] = useState<string | null>(null);
  const cardZone = pinned ?? hovered;

  const maxP = useMemo(() => {
    if (!run?.belief) return 0;
    return Math.max(0, ...Object.values(run.belief.zones));
  }, [run?.belief]);

  return (
    <section className="panel relative flex h-full min-h-[360px] flex-col overflow-hidden">
      <header className="panel-header">
        <MapIcon size={13} className="text-ink-400" />
        <span>School digital twin</span>
        <span className="font-mono text-[10px] normal-case tracking-normal text-ink-500">x east · y north · metres</span>
        <div className="ml-auto flex overflow-hidden rounded-md border border-ink-600 normal-case tracking-normal">
          {(['2d', '3d'] as Mode[]).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => setMode(m)}
              className={cx('flex items-center gap-1 px-2.5 py-0.5 text-[11px] font-medium transition-colors', mode === m ? 'bg-ink-700 text-ink-100' : 'bg-ink-850 text-ink-400 hover:text-ink-200')}
            >
              {m === '3d' ? <Box size={11} /> : <MapIcon size={11} />}
              {m.toUpperCase()}
            </button>
          ))}
        </div>
      </header>
      <div className="relative min-h-0 flex-1" onPointerLeave={() => setHovered(null)}>
        {building ? (
          <Canvas
            dpr={[1, 2]}
            gl={{ antialias: true, preserveDrawingBuffer: true }}
            onPointerMissed={() => setPinned(null)}
            style={{ cursor: hovered ? 'pointer' : 'default' }}
          >
            <Suspense fallback={null}>
              <Scene
                b={building}
                run={run}
                mode={mode}
                hovered={hovered}
                selectedZone={pinned}
                onHover={setHovered}
                onZone={(z) => setPinned((p) => (p === z ? null : z))}
                selectedCamera={selectedCamera}
                onCamera={onSelectCamera}
                highlightFrom={cardZone}
              />
            </Suspense>
          </Canvas>
        ) : (
          <div className="flex h-full items-center justify-center text-ink-400">Loading building model…</div>
        )}
        {building && (
          <>
            <div className="pointer-events-none absolute left-2 top-2 z-[60]">
              <ValidationSummary b={building} />
            </div>
            <div className="absolute bottom-2 left-2 z-[60]">
              <Legend maxP={maxP} />
            </div>
            {cardZone && (
              <div className="absolute right-2 top-2 z-[60]">
                <ZoneCard b={building} run={run} zoneId={cardZone} onClose={() => { setPinned(null); setHovered(null); }} />
              </div>
            )}
            <div className="pointer-events-none absolute bottom-2 right-2 z-[60] rounded bg-ink-900/80 px-2 py-1 text-[10px] text-ink-400">
              {mode === '3d' ? 'Drag to orbit · scroll to zoom · click a zone' : 'Drag to pan · scroll to zoom · click a zone'}
            </div>
          </>
        )}
      </div>
    </section>
  );
}
