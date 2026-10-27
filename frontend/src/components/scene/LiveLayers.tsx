// Live run data rendered in the scene. Everything here comes from backend run state.
import { useLayoutEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { Html, Line } from '@react-three/drei';
import * as THREE from 'three';
import type { Building, RunState, Vec2, Zone } from '../../types';
import { distributeGlyphs, hashString, toWorld, type SceneFrame, type V3, type ViewLevel } from '../../lib/scene';
import { routePolyline, headingVec } from '../../lib/geometry';
import { routeColor, cameraStatusColor, observedColor } from '../../lib/colors';
import { effectiveCameraStatus, pct } from '../../lib/format';
import { FLOOR_H, WALL_BY_LEVEL } from './BuildingModel';
import { labelPoint } from '../Twin';
import { REDUCED } from './motion';
import { cx } from '../ui';
import { locationApplied } from '../../lib/observations';

export interface Layers {
  cameras: boolean;
  movement: boolean;
  people: boolean;
  heat: boolean;
  routes: boolean;
  region: boolean;
  labels: boolean;
}
export const DEFAULT_LAYERS: Layers = { cameras: true, movement: true, people: true, heat: true, routes: true, region: true, labels: true };

const UP = new THREE.Vector3(0, 1, 0);
const tmpM = new THREE.Matrix4();
const tmpQ = new THREE.Quaternion();
const tmpS = new THREE.Vector3();
const tmpP = new THREE.Vector3();

// ------------------------------------------------------------------ threat column
const columnMaterial = () =>
  new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
    uniforms: { uH: { value: 16 }, uI: { value: 0.5 }, uC: { value: new THREE.Color('#ff3030') } },
    vertexShader: 'varying float vH; uniform float uH; void main(){ vH = position.y / uH; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
    fragmentShader: 'varying float vH; uniform float uI; uniform vec3 uC; void main(){ float a = pow(1.0 - clamp(vH,0.0,1.0), 1.8) * uI; gl_FragColor = vec4(uC * a, a); }',
  });

function ThreatColumn({ zones, f, intensity, color = '#ff3030' }: { zones: Zone[]; f: SceneFrame; intensity: number; color?: string }) {
  const H = 16;
  const geoms = useMemo(
    () =>
      zones.map((z) => {
        const shape = new THREE.Shape(z.polygon.map(([x, y]) => new THREE.Vector2(x - f.cx, y - f.cy)));
        const g = new THREE.ExtrudeGeometry(shape, { depth: H, bevelEnabled: false });
        g.rotateX(-Math.PI / 2);
        // drop the caps so only the glowing walls remain
        return g;
      }),
    [zones, f],
  );
  const mat = useMemo(columnMaterial, []);
  useLayoutEffect(() => {
    mat.uniforms.uC.value.set(color);
  }, [mat, color]);
  useFrame(({ clock }) => {
    const pulse = REDUCED ? 0.8 : 0.62 + 0.38 * Math.sin(clock.elapsedTime * 2.2);
    mat.uniforms.uI.value = (0.25 + 0.45 * intensity) * pulse;
  });
  const rings = useMemo(() => zones.map((z) => [...z.polygon, z.polygon[0]].map((p) => toWorld(f, p, FLOOR_H + 0.08))), [zones, f]);
  return (
    <group>
      {geoms.map((g, i) => (
        <mesh key={i} geometry={g} material={mat} position={[0, FLOOR_H, 0]} renderOrder={20} raycast={() => null} />
      ))}
      {rings.map((pts, i) => (
        <Line key={i} points={pts} color={color} lineWidth={3} toneMapped={false} transparent depthTest={false} renderOrder={21} />
      ))}
    </group>
  );
}

// ------------------------------------------------------------------ routes with flowing particles
function Routes({ run, b, f }: { run: RunState; b: Building; f: SceneFrame }) {
  const routes = useMemo(
    () =>
      (run.routing?.routes ?? [])
        .filter((r) => r.path.length > 1)
        .map((r) => {
          const pts = routePolyline(r, b).map((p) => new THREE.Vector3(...toWorld(f, p, FLOOR_H + 0.5)));
          const cum = [0];
          for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + pts[i].distanceTo(pts[i - 1]));
          return { r, pts, cum, len: cum[cum.length - 1], color: routeColor(r.operational_status) };
        })
        .filter((x) => x.len > 0.5),
    [run.routing, b, f],
  );
  const perRoute = 6;
  const inst = useRef<THREE.InstancedMesh>(null);
  const lines = useRef<({ material: { dashOffset: number } } | null)[]>([]);
  useLayoutEffect(() => {
    if (!inst.current) return;
    const c = new THREE.Color();
    routes.forEach((rt, i) => {
      for (let k = 0; k < perRoute; k++) inst.current!.setColorAt(i * perRoute + k, c.set(rt.color));
    });
    if (inst.current.instanceColor) inst.current.instanceColor.needsUpdate = true;
  }, [routes]);
  useFrame(({ clock }, dt) => {
    const t = clock.elapsedTime;
    for (const l of lines.current) if (l && !REDUCED) l.material.dashOffset -= dt * 3;
    const im = inst.current;
    if (!im) return;
    routes.forEach((rt, i) => {
      for (let k = 0; k < perRoute; k++) {
        const s = REDUCED ? (k / perRoute) * rt.len : ((t * 6 + (k / perRoute) * rt.len) % rt.len);
        let j = 1;
        while (j < rt.cum.length - 1 && rt.cum[j] < s) j++;
        const seg = rt.cum[j] - rt.cum[j - 1] || 1;
        tmpP.copy(rt.pts[j - 1]).lerp(rt.pts[j], (s - rt.cum[j - 1]) / seg);
        const fade = Math.min(1, s / 3, (rt.len - s) / 3);
        tmpS.setScalar(0.16 + 0.24 * Math.max(0, fade));
        tmpM.compose(tmpP, tmpQ.identity(), tmpS);
        im.setMatrixAt(i * perRoute + k, tmpM);
      }
    });
    im.instanceMatrix.needsUpdate = true;
  });
  return (
    <group>
      {routes.map((rt, i) => (
        <group key={rt.r.id}>
          <Line points={rt.pts} color={rt.color} lineWidth={9} transparent opacity={0.13} depthTest={false} renderOrder={22} toneMapped={false} />
          <Line
            ref={(l) => (lines.current[i] = l as unknown as { material: { dashOffset: number } })}
            points={rt.pts}
            color={rt.color}
            lineWidth={2.6}
            dashed
            dashSize={rt.r.safe ? 2.4 : 1}
            gapSize={rt.r.safe ? 1 : 0.9}
            depthTest={false}
            renderOrder={23}
            toneMapped={false}
          />
        </group>
      ))}
      {routes.length > 0 && (
        <instancedMesh ref={inst} args={[undefined, undefined, routes.length * perRoute]} renderOrder={24} raycast={() => null}>
          <sphereGeometry args={[1, 10, 8]} />
          <meshBasicMaterial toneMapped={false} depthTest={false} transparent />
        </instancedMesh>
      )}
    </group>
  );
}

// ------------------------------------------------------------------ flight streams (measured movement)
function FlightStreams({ run, b, f }: { run: RunState; b: Building; f: SceneFrame }) {
  const streams = useMemo(
    () =>
      b.cameras
        .map((c) => ({ c, ev: run.cameras[c.id]?.evidence }))
        // only observations whose location is verified or human-confirmed are drawn inside the building
        .filter((x) => x.ev && x.ev.flight_heading_deg != null && locationApplied(x.ev))
        .map(({ c, ev }) => {
          const [dx, dy] = headingVec(ev!.flight_heading_deg!);
          const start = new THREE.Vector3(...toWorld(f, c.position, FLOOR_H + 0.9));
          const dir = new THREE.Vector3(dx, 0, -dy);
          const len = 8 + 10 * Math.min(1, ev!.coherence);
          const n = Math.round(6 + 12 * Math.min(1, ev!.running_fraction));
          return { id: c.id, start, dir, len, n, end: start.clone().addScaledVector(dir, len) };
        }),
    [run.cameras, b, f],
  );
  const total = streams.reduce((s, x) => s + x.n, 0);
  const inst = useRef<THREE.InstancedMesh>(null);
  useFrame(({ clock }) => {
    if (!inst.current) return;
    const t = clock.elapsedTime;
    let k = 0;
    for (const s of streams) {
      tmpQ.setFromUnitVectors(new THREE.Vector3(1, 0, 0), s.dir);
      for (let i = 0; i < s.n; i++) {
        const u = REDUCED ? i / s.n : (t * 0.45 + i / s.n) % 1;
        tmpP.copy(s.start).addScaledVector(s.dir, u * s.len);
        tmpP.x += Math.sin(i * 12.9) * 0.9 * Math.abs(s.dir.z);
        tmpP.z += Math.sin(i * 7.3) * 0.9 * Math.abs(s.dir.x);
        const a = Math.sin(u * Math.PI);
        tmpS.set(0.6 * a + 0.05, 0.11 * a + 0.02, 0.11 * a + 0.02);
        tmpM.compose(tmpP, tmpQ, tmpS);
        inst.current.setMatrixAt(k++, tmpM);
      }
    }
    inst.current.instanceMatrix.needsUpdate = true;
  });
  if (!streams.length) return null;
  return (
    <group>
      <instancedMesh ref={inst} args={[undefined, undefined, total]} renderOrder={25} raycast={() => null}>
        <sphereGeometry args={[1, 8, 6]} />
        <meshBasicMaterial color="#ff8a9a" toneMapped={false} depthTest={false} transparent opacity={0.95} />
      </instancedMesh>
      {streams.map((s) => {
        const q = new THREE.Quaternion().setFromUnitVectors(UP, s.dir);
        return (
          <mesh key={s.id} position={s.end} quaternion={q} renderOrder={26} raycast={() => null}>
            <coneGeometry args={[0.7, 1.8, 12]} />
            <meshBasicMaterial color="#ffb3bd" toneMapped={false} depthTest={false} />
          </mesh>
        );
      })}
    </group>
  );
}

// ------------------------------------------------------------------ person glyphs (count visualisation)
function PersonGlyphs({ run, b, f }: { run: RunState; b: Building; f: SceneFrame }) {
  const glyphs = useMemo(() => {
    const out: { p: Vec2; flee: boolean }[] = [];
    for (const z of b.zones) {
      const st = run.zones[z.id];
      if (st?.persons == null || st.persons <= 0) continue;
      const flee = st.observed.includes('fleeing') || st.observed.includes('rapid');
      for (const p of distributeGlyphs(z.polygon, st.persons, hashString(z.id))) out.push({ p, flee });
    }
    return out;
  }, [run.zones, b]);
  const ref = useRef<THREE.InstancedMesh>(null);
  useLayoutEffect(() => {
    if (!ref.current) return;
    const c = new THREE.Color();
    glyphs.forEach((g, i) => {
      const [x, , z] = toWorld(f, g.p);
      tmpM.compose(new THREE.Vector3(x, FLOOR_H + 0.75, z), tmpQ.identity(), new THREE.Vector3(1, 1, 1));
      ref.current!.setMatrixAt(i, tmpM);
      ref.current!.setColorAt(i, c.set(g.flee ? '#fda4af' : '#c7f4ff'));
    });
    ref.current.instanceMatrix.needsUpdate = true;
    if (ref.current.instanceColor) ref.current.instanceColor.needsUpdate = true;
  }, [glyphs, f]);
  if (!glyphs.length) return null;
  return (
    <instancedMesh ref={ref} args={[undefined, undefined, glyphs.length]} castShadow raycast={() => null}>
      <capsuleGeometry args={[0.24, 0.85, 4, 8]} />
      <meshStandardMaterial emissive="#7dd3fc" emissiveIntensity={0.35} roughness={0.5} />
    </instancedMesh>
  );
}

// ------------------------------------------------------------------ cameras
function CameraPin({
  id,
  pos,
  yaw,
  status,
  selected,
  label,
  onSelect,
  showCone,
  portal,
}: {
  portal: React.MutableRefObject<HTMLDivElement>;
  showCone: boolean;
  id: string;
  pos: V3;
  yaw: number;
  status: string;
  selected: boolean;
  label: boolean;
  onSelect: () => void;
}) {
  const color = status === 'fault' ? '#f87171' : cameraStatusColor(status);
  const [dx, dy] = headingVec(yaw);
  const view = new THREE.Vector3(dx, -0.35, -dy).normalize();
  const coneLen = 8;
  const coneQ = new THREE.Quaternion().setFromUnitVectors(UP, view.clone().negate());
  const conePos = view.clone().multiplyScalar(coneLen / 2);
  const sweep = useRef<THREE.Mesh>(null);
  const head = useRef<THREE.Mesh>(null);
  const analyzing = status === 'analyzing';
  useFrame(({ clock }) => {
    const t = clock.elapsedTime;
    if (sweep.current) {
      const u = REDUCED ? 0.7 : (t * 0.9) % 1;
      sweep.current.scale.set(u, u, u);
      sweep.current.position.copy(view).multiplyScalar((coneLen * u) / 2);
      (sweep.current.material as THREE.MeshBasicMaterial).opacity = 0.45 * (1 - u);
    }
    if (head.current && analyzing && !REDUCED) head.current.scale.setScalar(1 + 0.3 * Math.sin(t * 7));
  });
  return (
    <group position={pos}>
      <mesh position={[0, -pos[1] / 2 + 0.1, 0]} raycast={() => null}>
        <cylinderGeometry args={[0.05, 0.05, Math.max(0.1, pos[1] - 0.2), 6]} />
        <meshBasicMaterial color={color} transparent opacity={0.45} toneMapped={false} />
      </mesh>
      <mesh position={conePos} quaternion={coneQ} raycast={() => null} renderOrder={15} visible={showCone}>
        <coneGeometry args={[3, coneLen, 28, 1, true]} />
        <meshBasicMaterial color={color} transparent opacity={selected ? 0.2 : status === 'idle' ? 0.05 : 0.1} side={THREE.DoubleSide} depthWrite={false} blending={THREE.AdditiveBlending} toneMapped={false} />
      </mesh>
      {analyzing && (
        <mesh ref={sweep} quaternion={coneQ} raycast={() => null} renderOrder={16}>
          <coneGeometry args={[3, coneLen, 28, 1, true]} />
          <meshBasicMaterial color="#a5f3fc" transparent opacity={0.4} side={THREE.DoubleSide} depthWrite={false} blending={THREE.AdditiveBlending} toneMapped={false} />
        </mesh>
      )}
      <mesh
        ref={head}
        onClick={(e) => {
          e.stopPropagation();
          onSelect();
        }}
        onPointerOver={() => (document.body.style.cursor = 'pointer')}
        onPointerOut={() => (document.body.style.cursor = '')}
      >
        <sphereGeometry args={[selected ? 0.85 : 0.62, 20, 16]} />
        <meshBasicMaterial color={selected ? '#ecfeff' : color} toneMapped={false} />
      </mesh>
      {/* larger invisible hit target */}
      <mesh onClick={(e) => (e.stopPropagation(), onSelect())} visible={false}>
        <sphereGeometry args={[1.8, 8, 6]} />
      </mesh>
      {status === 'fault' &&
        [Math.PI / 4, -Math.PI / 4].map((r) => (
          <mesh key={r} position={[0, 1.5, 0]} rotation={[0, 0, r]} raycast={() => null}>
            <boxGeometry args={[1.5, 0.18, 0.18]} />
            <meshBasicMaterial color="#ef4444" toneMapped={false} />
          </mesh>
        ))}
      {label && (
        <Html position={[0, 1.6, 0]} center zIndexRange={[30, 0]} portal={portal}>
          <button
            type="button"
            onClick={onSelect}
            aria-label={`Camera ${id}`}
            className={cx(
              'pointer-events-auto whitespace-nowrap rounded-full border px-1.5 font-mono text-[9px] font-semibold leading-[14px] backdrop-blur',
              selected ? 'border-white bg-accent/40 text-white' : 'border-accent/40 bg-ink-950/70 text-accent-bright',
            )}
          >
            {id.replace('CAM-', 'C')}
          </button>
        </Html>
      )}
    </group>
  );
}

// ------------------------------------------------------------------ composite
export function LiveLayers({
  b,
  f,
  run,
  level,
  layers,
  hot,
  selectedZone,
  selectedCamera,
  onSelectCamera,
  onSelectZone,
  portal,
}: {
  portal: React.MutableRefObject<HTMLDivElement>;
  b: Building;
  f: SceneFrame;
  run: RunState | null;
  level: ViewLevel;
  layers: Layers;
  hot: Zone[];
  selectedZone: string | null;
  selectedCamera: string | null;
  onSelectCamera: (id: string) => void;
  onSelectZone: (id: string) => void;
}) {
  const inside = level !== 'campus';
  const exclusion = new Set(run?.routing?.exclusion_zones ?? []);
  const hotIds = new Set(hot.map((z) => z.id));
  const camH = level === 'campus' ? FLOOR_H + 4.6 + 2.6 : FLOOR_H + Math.max(2.2, WALL_BY_LEVEL[level] + 1.4);
  const p = run?.belief;
  const anchor = useMemo<Vec2 | null>(() => {
    if (!hot.length || !p) return null;
    let sx = 0, sy = 0, sw = 0;
    for (const z of hot) {
      const w = (p.conditional[z.id] ?? 0) + 1e-3;
      sx += z.centroid[0] * w;
      sy += z.centroid[1] * w;
      sw += w;
    }
    return [sx / sw, sy / sw];
  }, [hot, p]);
  const mass = hot.reduce((s, z) => s + (p?.zones[z.id] ?? 0), 0);
  const blocked = new Set(run?.routing?.blocked_exits ?? []);
  return (
    <group>
      {layers.region && hot.length > 0 && <ThreatColumn zones={hot} f={f} color={p?.localized ? '#ff3030' : '#f59e0b'} intensity={Math.min(1, p?.p_threat ?? 0) * (level === 'floor' ? 0.35 : 1)} />}
      {layers.region && inside &&
        b.zones
          .filter((z) => exclusion.has(z.id) && !hotIds.has(z.id))
          .map((z) => (
            <Line
              key={`ex-${z.id}`}
              points={[...z.polygon, z.polygon[0]].map((q) => toWorld(f, q, FLOOR_H + 0.1))}
              color="#f59e0b"
              lineWidth={1.6}
              dashed
              dashSize={1.2}
              gapSize={0.8}
              depthTest={false}
              renderOrder={19}
              toneMapped={false}
            />
          ))}
      {run && layers.routes && inside && <Routes run={run} b={b} f={f} />}
      {run && layers.movement && <FlightStreams run={run} b={b} f={f} />}
      {run && layers.people && inside && <PersonGlyphs run={run} b={b} f={f} />}
      {layers.cameras &&
        b.cameras.map((c) => (
          <CameraPin
            key={c.id}
            id={c.id}
            pos={toWorld(f, c.position, camH)}
            yaw={c.yaw_deg}
            status={effectiveCameraStatus(run, c.id)}
            selected={selectedCamera === c.id}
            label={inside && layers.labels}
            showCone={inside || effectiveCameraStatus(run, c.id) === 'analyzing'}
            portal={portal}
            onSelect={() => onSelectCamera(c.id)}
          />
        ))}
      {layers.region && anchor && p && (
        <Html position={toWorld(f, anchor, 20)} center zIndexRange={[45, 0]} style={{ pointerEvents: 'none' }} portal={portal}>
          <div className="fade-in flex -translate-y-3 flex-col items-center">
            {p.localized ? (
              <div className="flex items-center gap-2 whitespace-nowrap rounded-full border border-threat/80 bg-[#2a0a10]/85 py-1 pl-2 pr-3 text-[12px] font-semibold text-[#fee2e2] shadow-glow-red backdrop-blur">
                <span className="relative flex h-2.5 w-2.5">
                  <span className="ping-ring absolute inset-0 rounded-full bg-threat" />
                  <span className="relative h-2.5 w-2.5 rounded-full bg-threat" />
                </span>
                Threat zone · camera evidence
                <span className="tnum font-mono text-[11px] text-[#fca5a5]">{pct(p.p_threat)}</span>
              </div>
            ) : (
              <div className="flex items-center gap-2 whitespace-nowrap rounded-full border border-caution/80 bg-[#2a1c05]/85 py-1 pl-2 pr-3 text-[12px] font-semibold text-caution-bright backdrop-blur">
                <span className="h-2.5 w-2.5 rounded-full bg-caution" />
                Reported area · unverified
                <span className="tnum font-mono text-[11px]">{pct(p.p_threat)}</span>
              </div>
            )}
            <div className="mt-0.5 whitespace-nowrap font-mono text-[10px] text-[#fecaca] [text-shadow:0_1px_3px_#000]">
              {hot.map((z) => z.id).join(' · ')} · {p.localized ? `${pct(mass / Math.max(1e-6, p.p_threat))} of mass` : 'precautionary exclusion from the report only'}
            </div>
          </div>
        </Html>
      )}
      {inside &&
        layers.labels &&
        b.zones.map((z) => {
          const show = level === 'floor' || hotIds.has(z.id) || selectedZone === z.id;
          if (!show) return null;
          const st = run?.zones[z.id];
          const pz = p?.zones[z.id] ?? 0;
          return (
            <Html key={`lbl-${z.id}`} position={toWorld(f, labelPoint(z, b), FLOOR_H + 0.4)} center zIndexRange={[20, 0]} portal={portal}>
              <button
                type="button"
                onClick={() => onSelectZone(z.id)}
                aria-label={`Zone ${z.id} ${z.name}`}
                className={cx(
                  'pointer-events-auto flex items-center gap-1 whitespace-nowrap rounded-md border px-1.5 py-[1px] font-mono text-[9.5px] font-semibold backdrop-blur-sm transition-colors',
                  hotIds.has(z.id) ? 'border-threat/70 bg-[#2a0a10]/80 text-[#fecaca]' : selectedZone === z.id ? 'border-accent bg-accent/25 text-white' : 'border-white/10 bg-ink-950/60 text-ink-100 hover:border-accent/60',
                )}
              >
                <span className="h-1.5 w-1.5 rounded-full" style={{ background: observedColor(st?.observed ?? 'unobserved') }} />
                {z.id}
                {pz >= 0.02 && <span className="tnum text-[#fca5a5]">{pct(pz)}</span>}
              </button>
            </Html>
          );
        })}
      {level === 'floor' &&
        layers.labels &&
        b.exits.map((e) => (
          <Html key={`ex-${e.id}`} position={toWorld(f, e.position, 3.4)} center zIndexRange={[20, 0]} style={{ pointerEvents: 'none' }} portal={portal}>
            <div className={cx('whitespace-nowrap rounded-md border px-1.5 font-mono text-[9px] font-semibold leading-[14px]', blocked.has(e.id) ? 'border-threat/70 bg-threat-dim/90 text-threat-bright line-through' : 'border-clear/50 bg-clear-dim/85 text-clear-bright')}>
              {e.id}
            </div>
          </Html>
        ))}
    </group>
  );
}
