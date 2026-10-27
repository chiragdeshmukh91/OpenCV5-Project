// The school building, derived only from /api/building geometry: zone floor slabs, walls with
// thickness and door gaps, window bands on exterior walls, roof slabs with parapet edges, and
// entrance canopies / portals at exits. Wall height and roof opacity follow the view level.
import { useLayoutEffect, useMemo, useRef } from 'react';
import { useFrame, type ThreeEvent } from '@react-three/fiber';
import * as THREE from 'three';
import type { Building, Vec2, Zone } from '../../types';
import { isExteriorEdge, splitWallForDoors, toWorld, type SceneFrame, type ViewLevel } from '../../lib/scene';
import { mixOklab } from '../../lib/colors';
import { REDUCED } from './motion';

export const FLOOR_H = 0.22;
export const WALL_FULL = 4.6;
export const WALL_BY_LEVEL: Record<ViewLevel, number> = { campus: WALL_FULL, building: 2.6, floor: 1.0 };
const WALL_T = 0.3;

interface Seg {
  a: Vec2;
  b: Vec2;
  exterior: boolean;
}

function buildSegments(b: Building): Seg[] {
  const segs: Seg[] = [];
  const seen = new Set<string>();
  for (const z of b.zones) {
    const poly = z.polygon;
    for (let i = 0; i < poly.length; i++) {
      const a = poly[i];
      const c = poly[(i + 1) % poly.length];
      const exterior = isExteriorEdge(a, c, b.zones);
      const doors = [...b.doors, ...b.exits.map((e) => ({ position: e.position, width_m: e.width_m }))];
      for (const [p, q] of splitWallForDoors(a, c, doors)) {
        const key = [p, q].map((v) => v.map((n) => n.toFixed(1)).join(',')).sort().join('|');
        if (seen.has(key)) continue;
        seen.add(key);
        segs.push({ a: p, b: q, exterior });
      }
    }
  }
  return segs;
}

function slab(zone: Zone, f: SceneFrame, depth: number, inset = 0): THREE.ExtrudeGeometry {
  const [cx, cy] = zone.centroid;
  const shape = new THREE.Shape(
    zone.polygon.map(([x, y]) => {
      const dx = x - cx, dy = y - cy;
      const l = Math.hypot(dx, dy) || 1;
      const k = inset ? Math.max(0, 1 - inset / l) : 1;
      return new THREE.Vector2(cx + dx * k - f.cx, cy + dy * k - f.cy);
    }),
  );
  const g = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: false });
  g.rotateX(-Math.PI / 2);
  return g;
}

export type HeatTone = 'threat' | 'caution';
/** Red only for a threat localised by camera evidence; amber for report-only / unverified heat. */
export const TONE: Record<HeatTone, { heat: string; emissive: string; roofBase: string; roofHot: string; roofHeat: string }> = {
  threat: { heat: '#c0262d', emissive: '#ff2a2a', roofBase: '#3a1418', roofHot: '#b91c1c', roofHeat: '#e06060' },
  caution: { heat: '#b7791f', emissive: '#f59e0b', roofBase: '#3a2a10', roofHot: '#d97706', roofHeat: '#e0a450' },
};

function ZoneFloor({
  zone,
  f,
  heat,
  hot,
  selected,
  hovered,
  interactive,
  onHover,
  onSelect,
  onDouble,
  tone = 'threat',
}: {
  tone?: HeatTone;
  zone: Zone;
  f: SceneFrame;
  heat: number;
  hot: boolean;
  selected: boolean;
  hovered: boolean;
  interactive: boolean;
  onHover: (id: string | null) => void;
  onSelect: (id: string) => void;
  onDouble: () => void;
}) {
  const geom = useMemo(() => slab(zone, f, FLOOR_H), [zone, f]);
  const mat = useRef<THREE.MeshStandardMaterial>(null);
  const base = zone.kind === 'corridor' ? '#1a2a40' : '#15233a';
  const color = useMemo(() => {
    const c = mixOklab(base, TONE[tone].heat, Math.min(1, heat));
    return selected ? mixOklab(c, '#5eead4', 0.35) : hovered ? mixOklab(c, '#7dd3fc', 0.18) : c;
  }, [base, heat, selected, hovered, tone]);
  useFrame(({ clock }) => {
    if (!mat.current) return;
    const pulse = REDUCED ? 0.8 : 0.6 + 0.4 * Math.sin(clock.elapsedTime * 2.4);
    mat.current.emissiveIntensity = hot ? 1.1 * pulse : heat * 0.35;
  });
  return (
    <mesh
      geometry={geom}
      receiveShadow
      onPointerOver={interactive ? (e: ThreeEvent<PointerEvent>) => (e.stopPropagation(), onHover(zone.id)) : undefined}
      onPointerOut={interactive ? () => onHover(null) : undefined}
      onClick={interactive ? (e: ThreeEvent<MouseEvent>) => (e.stopPropagation(), onSelect(zone.id)) : undefined}
      onDoubleClick={interactive ? (e: ThreeEvent<MouseEvent>) => (e.stopPropagation(), onDouble()) : undefined}
    >
      <meshStandardMaterial ref={mat} color={color} emissive={TONE[tone].emissive} emissiveIntensity={0} roughness={0.82} metalness={0.08} toneMapped={!hot} />
    </mesh>
  );
}

function Walls({ segs, f, level }: { segs: Seg[]; f: SceneFrame; level: ViewLevel }) {
  const group = useRef<THREE.Group>(null);
  const wallRef = useRef<THREE.InstancedMesh>(null);
  const capRef = useRef<THREE.InstancedMesh>(null);
  const winRef = useRef<THREE.InstancedMesh>(null);
  const windows = useMemo(() => {
    const out: { pos: THREE.Vector3; rot: number; len: number; warm: boolean }[] = [];
    let k = 0;
    for (const s of segs) {
      if (!s.exterior) continue;
      const len = Math.hypot(s.b[0] - s.a[0], s.b[1] - s.a[1]);
      const n = Math.floor(len / 2.8);
      if (n < 1) continue;
      const rot = Math.atan2(s.b[1] - s.a[1], s.b[0] - s.a[0]);
      const dir = new THREE.Vector3(Math.cos(rot), 0, -Math.sin(rot));
      // outward normal: probe which side is outside the footprint is encoded by `exterior`; place on both faces
      const nrm = new THREE.Vector3(Math.sin(rot), 0, Math.cos(rot));
      const mid = toWorld(f, [(s.a[0] + s.b[0]) / 2, (s.a[1] + s.b[1]) / 2], 0);
      const step = len / n;
      for (let i = 0; i < n; i++) {
        const off = -len / 2 + step * (i + 0.5);
        for (const side of [1, -1]) {
          const p = new THREE.Vector3(mid[0], 2.55, mid[2]).addScaledVector(dir, off).addScaledVector(nrm, side * (WALL_T * 0.65 + 0.015));
          out.push({ pos: p, rot, len: step * 0.7, warm: (k++ * 7919) % 5 === 0 });
        }
      }
    }
    return out;
  }, [segs, f]);
  useLayoutEffect(() => {
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const up = new THREE.Vector3(0, 1, 0);
    segs.forEach((s, i) => {
      const len = Math.hypot(s.b[0] - s.a[0], s.b[1] - s.a[1]);
      const rot = Math.atan2(s.b[1] - s.a[1], s.b[0] - s.a[0]);
      q.setFromAxisAngle(up, rot);
      const p = toWorld(f, [(s.a[0] + s.b[0]) / 2, (s.a[1] + s.b[1]) / 2], WALL_FULL / 2);
      m.compose(new THREE.Vector3(...p), q, new THREE.Vector3(len + WALL_T * 0.9, WALL_FULL, s.exterior ? WALL_T * 1.3 : WALL_T));
      wallRef.current!.setMatrixAt(i, m);
      m.compose(new THREE.Vector3(p[0], WALL_FULL, p[2]), q, new THREE.Vector3(len + WALL_T, 0.06, (s.exterior ? WALL_T * 1.3 : WALL_T) + 0.04));
      capRef.current!.setMatrixAt(i, m);
    });
    wallRef.current!.instanceMatrix.needsUpdate = true;
    capRef.current!.instanceMatrix.needsUpdate = true;
    const col = new THREE.Color();
    windows.forEach((w, i) => {
      q.setFromAxisAngle(up, w.rot);
      m.compose(w.pos, q, new THREE.Vector3(w.len, 1.25, 0.03));
      winRef.current!.setMatrixAt(i, m);
      winRef.current!.setColorAt(i, col.set(w.warm ? '#ffcf8a' : '#7cc8ff'));
    });
    winRef.current!.instanceMatrix.needsUpdate = true;
    if (winRef.current!.instanceColor) winRef.current!.instanceColor.needsUpdate = true;
  }, [segs, windows, f]);
  const target = WALL_BY_LEVEL[level] / WALL_FULL;
  useFrame((_, dt) => {
    const g = group.current;
    if (!g) return;
    const cur = g.scale.y;
    const next = REDUCED ? target : cur + (target - cur) * Math.min(1, dt * 4);
    g.scale.y = Math.abs(next - target) < 0.002 ? target : next;

    if (winRef.current) winRef.current.visible = g.scale.y > 0.45;
  });
  return (
    <group ref={group} position={[0, 0, 0]}>
      <instancedMesh ref={wallRef} args={[undefined, undefined, segs.length]} castShadow receiveShadow>
        <boxGeometry args={[1, 1, 1]} />
        <meshStandardMaterial color="#3a5578" roughness={0.7} metalness={0.12} />
      </instancedMesh>
      <instancedMesh ref={capRef} args={[undefined, undefined, segs.length]}>
        <boxGeometry args={[1, 1, 1]} />
        <meshBasicMaterial color="#5ccfe6" transparent opacity={0.55} toneMapped={false} />
      </instancedMesh>
      <instancedMesh ref={winRef} args={[undefined, undefined, Math.max(1, windows.length)]}>
        <boxGeometry args={[1, 1, 1]} />
        <meshBasicMaterial toneMapped={false} />
      </instancedMesh>
    </group>
  );
}

let roofTex: THREE.Texture | null = null;
function roofTexture(): THREE.Texture {
  if (roofTex) return roofTex;
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d')!;
  g.fillStyle = '#2a3a52';
  g.fillRect(0, 0, 256, 256);
  let seed = 11;
  const r = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < 5000; i++) {
    const v = 30 + Math.floor(r() * 50);
    g.fillStyle = `rgba(${v},${v + 12},${v + 26},${0.25 + r() * 0.3})`;
    g.fillRect(r() * 256, r() * 256, 1 + r() * 2, 1 + r() * 2);
  }
  g.strokeStyle = 'rgba(10,18,30,0.45)';
  for (let i = 0; i <= 256; i += 64) {
    g.beginPath();
    g.moveTo(i, 0);
    g.lineTo(i, 256);
    g.stroke();
  }
  roofTex = new THREE.CanvasTexture(c);
  roofTex.wrapS = roofTex.wrapT = THREE.RepeatWrapping;
  roofTex.repeat.set(0.08, 0.08);
  roofTex.colorSpace = THREE.SRGBColorSpace;
  return roofTex;
}

/** Roof slabs (one per zone) plus a glowing footprint outline; opaque in campus view, faded inside. */
function Roofs({ b, f, level, heatOf, hot, onClick, tone = 'threat' }: { b: Building; f: SceneFrame; level: ViewLevel; heatOf: (z: string) => number; hot: Set<string>; onClick: () => void; tone?: HeatTone }) {
  const roofs = useMemo(() => b.zones.map((z) => ({ z, g: slab(z, f, 0.35, 0.05) })), [b, f]);
  const outline = useMemo(() => {
    const pts: number[] = [];
    for (const z of b.zones) {
      const poly = z.polygon;
      for (let i = 0; i < poly.length; i++) {
        const a = poly[i];
        const c = poly[(i + 1) % poly.length];
        if (!isExteriorEdge(a, c, b.zones)) continue;
        pts.push(...toWorld(f, a, 0.42), ...toWorld(f, c, 0.42));
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
    return g;
  }, [b, f]);
  const tex = useMemo(roofTexture, []);
  const group = useRef<THREE.Group>(null);
  const mats = useRef<(THREE.MeshStandardMaterial | null)[]>([]);
  const lineMat = useRef<THREE.LineBasicMaterial>(null);
  const target = level === 'campus' ? 1 : 0;
  const cur = useRef(target);
  useFrame((_, dt) => {
    const next = REDUCED ? target : cur.current + (target - cur.current) * Math.min(1, dt * 3.5);
    cur.current = Math.abs(next - target) < 0.004 ? target : next;
    if (group.current) group.current.visible = cur.current > 0.01;
    for (const m of mats.current) if (m) m.opacity = cur.current;
    if (lineMat.current) lineMat.current.opacity = cur.current * 0.9;
  });
  return (
    <group ref={group} position={[0, FLOOR_H + WALL_FULL, 0]}>
      {roofs.map(({ z, g }, i) => {
        const h = heatOf(z.id);
        const isHot = hot.has(z.id);
        return (
          <mesh
            key={z.id}
            geometry={g}
            castShadow
            receiveShadow
            onClick={(e) => {
              if (level !== 'campus') return;
              e.stopPropagation();
              onClick();
            }}
          >
            <meshStandardMaterial
              ref={(m) => (mats.current[i] = m)}
              map={isHot ? null : tex}
              color={isHot ? mixOklab(TONE[tone].roofBase, TONE[tone].roofHot, 0.7) : mixOklab('#c9d7ea', TONE[tone].roofHeat, h * 0.6)}
              emissive={TONE[tone].emissive}
              emissiveIntensity={isHot ? 0.45 : 0}
              roughness={0.85}
              metalness={0.15}
              transparent
            />
          </mesh>
        );
      })}
      <lineSegments geometry={outline}>
        <lineBasicMaterial ref={lineMat} color="#5ee0f5" transparent toneMapped={false} />
      </lineSegments>
    </group>
  );
}

/** Entrance canopy and glowing portal at each exit (barred in red when the exit is unavailable). */
function Exits({ b, f, blocked }: { b: Building; f: SceneFrame; blocked: Set<string> }) {
  const zones = useMemo(() => new Map(b.zones.map((z) => [z.id, z])), [b]);
  return (
    <group>
      {b.exits.map((e) => {
        const z = zones.get(e.zone);
        if (!z) return null;
        const xs = z.polygon.map((p) => p[0]);
        const ys = z.polygon.map((p) => p[1]);
        const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
        const dists: [number, Vec2][] = [
          [Math.abs(e.position[0] - x0), [-1, 0]],
          [Math.abs(e.position[0] - x1), [1, 0]],
          [Math.abs(e.position[1] - y0), [0, -1]],
          [Math.abs(e.position[1] - y1), [0, 1]],
        ];
        const out = dists.sort((p, q) => p[0] - q[0])[0][1];
        const p = toWorld(f, e.position, 0);
        const rot = Math.atan2(out[1], out[0]); // map heading of the outward normal
        const isBlocked = blocked.has(e.id);
        const col = isBlocked ? '#ef4444' : '#2dd4bf';
        const w = Math.max(2.2, e.width_m + 0.6);
        return (
          <group key={e.id} position={p} rotation={[0, rot, 0]}>
            {/* canopy */}
            <mesh position={[1.6, 3.3, 0]} castShadow>
              <boxGeometry args={[3.2, 0.18, w + 1.6]} />
              <meshStandardMaterial color="#2a3d57" roughness={0.6} metalness={0.4} />
            </mesh>
            {[-1, 1].map((s) => (
              <mesh key={s} position={[3, 1.65, s * (w / 2 + 0.6)]}>
                <cylinderGeometry args={[0.07, 0.07, 3.3, 8]} />
                <meshStandardMaterial color="#64748b" metalness={0.7} roughness={0.4} />
              </mesh>
            ))}
            {/* glowing portal frame */}
            <mesh position={[0.25, 1.4, -w / 2]}>
              <boxGeometry args={[0.14, 2.8, 0.14]} />
              <meshBasicMaterial color={col} toneMapped={false} />
            </mesh>
            <mesh position={[0.25, 1.4, w / 2]}>
              <boxGeometry args={[0.14, 2.8, 0.14]} />
              <meshBasicMaterial color={col} toneMapped={false} />
            </mesh>
            <mesh position={[0.25, 2.8, 0]}>
              <boxGeometry args={[0.14, 0.14, w]} />
              <meshBasicMaterial color={col} toneMapped={false} />
            </mesh>
            <mesh position={[0.3, 1.4, 0]}>
              <planeGeometry args={[w, 2.8]} />
              <meshBasicMaterial color={col} transparent opacity={0.16} side={THREE.DoubleSide} depthWrite={false} toneMapped={false} />
            </mesh>
            {isBlocked &&
              [0.7, 1.4, 2.1].map((h) => (
                <mesh key={h} position={[0.35, h, 0]} rotation={[0.5, 0, 0]}>
                  <boxGeometry args={[0.12, 0.14, w * 1.05]} />
                  <meshBasicMaterial color="#ef4444" toneMapped={false} />
                </mesh>
              ))}
            {/* light pool */}
            <mesh position={[2.4, 0.06, 0]} rotation={[-Math.PI / 2, 0, 0]}>
              <circleGeometry args={[2.6, 24]} />
              <meshBasicMaterial color={col} transparent opacity={0.14} depthWrite={false} toneMapped={false} />
            </mesh>
          </group>
        );
      })}
    </group>
  );
}

export function BuildingModel({
  b,
  f,
  level,
  heatOf,
  hot,
  blocked,
  selectedZone,
  hoveredZone,
  onHover,
  onSelectZone,
  onBuildingClick,
  onEnterFloor,
  tone = 'threat',
}: {
  /** 'caution' (amber) while the threat is not localised by camera evidence; 'threat' (red) once it is. */
  tone?: HeatTone;
  b: Building;
  f: SceneFrame;
  level: ViewLevel;
  heatOf: (z: string) => number;
  hot: Set<string>;
  blocked: Set<string>;
  selectedZone: string | null;
  hoveredZone: string | null;
  onHover: (z: string | null) => void;
  onSelectZone: (z: string) => void;
  onBuildingClick: () => void;
  onEnterFloor: () => void;
}) {
  const segs = useMemo(() => buildSegments(b), [b]);
  const interactive = level !== 'campus';
  return (
    <group>
      {/* foundation plinth */}
      <mesh position={[0, -0.05, 0]} receiveShadow onClick={(e) => level === 'campus' && (e.stopPropagation(), onBuildingClick())}>
        <boxGeometry args={[f.spanX + 1.2, 0.3, f.spanY + 1.2]} />
        <meshStandardMaterial color="#1b2636" roughness={0.9} />
      </mesh>
      {b.zones.map((z) => (
        <ZoneFloor
          key={z.id}
          zone={z}
          f={f}
          heat={heatOf(z.id)}
          hot={hot.has(z.id)}
          selected={selectedZone === z.id}
          hovered={hoveredZone === z.id}
          interactive={interactive}
          onHover={onHover}
          onSelect={onSelectZone}
          onDouble={onEnterFloor}
          tone={tone}
        />
      ))}
      <Walls segs={segs} f={f} level={level} />
      <Roofs b={b} f={f} level={level} heatOf={heatOf} hot={hot} onClick={onBuildingClick} tone={tone} />
      <Exits b={b} f={f} blocked={blocked} />
    </group>
  );
}
