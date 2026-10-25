// Decorative site context (terrain, roads, parking, sports field, trees, lamps, fence, sky).
// Illustrative only: procedurally generated, unlabeled and not interactive. It is NOT data — the
// school building itself is built from /api/building in BuildingModel.
import { useLayoutEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import type { SceneFrame } from '../../lib/scene';
import { rng, toWorld } from '../../lib/scene';

const noRaycast = () => null;
type Rect = [number, number, number, number]; // building coords x0, y0, x1, y1

export interface SiteLayout {
  pad: Rect;
  roads: Rect[];
  driveway: Rect;
  parking: Rect;
  field: Rect;
  fence: Rect;
  trees: { x: number; y: number; s: number; tint: number }[];
  lamps: { x: number; y: number }[];
}

/** Deterministic site layout around the building footprint (building coordinates, metres). */
export function siteLayout(bounds: [number, number, number, number], exitS?: [number, number]): SiteLayout {
  const [x0, y0, x1, y1] = bounds;
  const pad: Rect = [x0 - 7, y0 - 7, x1 + 7, y1 + 7];
  const southRoad: Rect = [x0 - 160, y0 - 27, x1 + 180, y0 - 18];
  const westRoad: Rect = [x0 - 42, y0 - 27, x0 - 33, y1 + 160];
  const ex = exitS ? exitS[0] : (x0 + x1) / 2;
  const driveway: Rect = [ex - 6, y0 - 18, ex + 6, y0 - 7];
  const parking: Rect = [x1 + 12, y0 - 18, x1 + 58, y1 - 4];
  const field: Rect = [x0 + 6, y1 + 16, x0 + 82, y1 + 58];
  const fence: Rect = [x0 - 29, y0 - 16, x1 + 64, y1 + 66];
  const r = rng(1337);
  const blocked = [pad, southRoad, westRoad, driveway, parking, field].map(([a, b, c, d]) => [a - 4, b - 4, c + 4, d + 4] as Rect);
  const free = (x: number, y: number) => !blocked.some(([a, b, c, d]) => x > a && x < c && y > b && y < d);
  const trees: SiteLayout['trees'] = [];
  // dense belt just inside the fence, then scattered woodland outside
  for (let i = 0; i < 1400 && trees.length < 90; i++) {
    const x = fence[0] + r() * (fence[2] - fence[0]);
    const y = fence[1] + r() * (fence[3] - fence[1]);
    const edge = Math.min(x - fence[0], fence[2] - x, y - fence[1], fence[3] - y);
    if (edge > 9 || !free(x, y) || trees.some((t) => Math.hypot(t.x - x, t.y - y) < 4.2)) continue;
    trees.push({ x, y, s: 0.8 + r() * 0.6, tint: r() });
  }
  for (let i = 0; i < 4000 && trees.length < 300; i++) {
    const x = x0 - 170 + r() * (x1 - x0 + 360);
    const y = y0 - 150 + r() * (y1 - y0 + 330);
    const insideFence = x > fence[0] - 3 && x < fence[2] + 3 && y > fence[1] - 3 && y < fence[3] + 3;
    if (insideFence || !free(x, y) || trees.some((t) => Math.hypot(t.x - x, t.y - y) < 5)) continue;
    trees.push({ x, y, s: 0.9 + r() * 0.9, tint: r() });
  }
  const lamps: SiteLayout['lamps'] = [];
  for (let x = southRoad[0] + 20; x < southRoad[2] - 10; x += 22) lamps.push({ x, y: southRoad[3] + 1.5 });
  for (let y = parking[1] + 6; y < parking[3]; y += 16) {
    lamps.push({ x: parking[0] + 1, y });
    lamps.push({ x: parking[2] - 1, y });
  }
  lamps.push({ x: driveway[0] - 1, y: driveway[1] + 5 }, { x: driveway[2] + 1, y: driveway[1] + 5 });
  for (let x = field[0]; x <= field[2]; x += 25) lamps.push({ x, y: field[1] - 2 });
  return { pad, roads: [southRoad, westRoad], driveway, parking, field, fence, trees, lamps };
}

function canvasTexture(w: number, h: number, draw: (g: CanvasRenderingContext2D) => void, repeat?: [number, number]): THREE.Texture {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = c.getContext('2d')!;
  draw(g);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  if (repeat) {
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(repeat[0], repeat[1]);
  }
  return t;
}

function noise(g: CanvasRenderingContext2D, w: number, h: number, base: string, spread: number, n: number, seed: number) {
  g.fillStyle = base;
  g.fillRect(0, 0, w, h);
  const r = rng(seed);
  for (let i = 0; i < n; i++) {
    const v = Math.floor(r() * spread);
    g.fillStyle = `rgba(${v},${v + 4},${v + 10},${0.08 + r() * 0.12})`;
    g.fillRect(r() * w, r() * h, 1 + r() * 2, 1 + r() * 2);
  }
}

function RectPlane({ f, rect, y, children, receiveShadow = true }: { f: SceneFrame; rect: Rect; y: number; children: React.ReactNode; receiveShadow?: boolean }) {
  const [a, b, c, d] = rect;
  const p = toWorld(f, [(a + c) / 2, (b + d) / 2], y);
  return (
    <mesh position={p} rotation={[-Math.PI / 2, 0, 0]} receiveShadow={receiveShadow} raycast={noRaycast}>
      <planeGeometry args={[c - a, d - b]} />
      {children}
    </mesh>
  );
}

/** Gradient night sky dome with a faint teal horizon glow and moon halo. */
function Sky() {
  const mat = useMemo(
    () =>
      new THREE.ShaderMaterial({
        side: THREE.BackSide,
        depthWrite: false,
        fog: false,
        uniforms: {
          top: { value: new THREE.Color('#01040b') },
          mid: { value: new THREE.Color('#06142a') },
          horizon: { value: new THREE.Color('#0f3448') },
          moonDir: { value: new THREE.Vector3(-0.55, 0.42, -0.72).normalize() },
        },
        vertexShader: 'varying vec3 vDir; void main(){ vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
        fragmentShader: `uniform vec3 top; uniform vec3 mid; uniform vec3 horizon; uniform vec3 moonDir; varying vec3 vDir;
          void main(){ float h = clamp(vDir.y, -0.2, 1.0);
            vec3 c = mix(horizon, mid, smoothstep(-0.02, 0.22, h)); c = mix(c, top, smoothstep(0.22, 0.85, h));
            float m = max(dot(normalize(vDir), moonDir), 0.0);
            c += vec3(0.35,0.45,0.6) * pow(m, 220.0) * 1.2 + vec3(0.05,0.08,0.12) * pow(m, 8.0);
            gl_FragColor = vec4(c, 1.0); }`,
      }),
    [],
  );
  const stars = useMemo(() => {
    const r = rng(7);
    const pos = new Float32Array(900 * 3);
    for (let i = 0; i < 900; i++) {
      const th = r() * Math.PI * 2;
      const ph = Math.acos(0.15 + r() * 0.85);
      pos.set([Math.sin(ph) * Math.cos(th) * 700, Math.cos(ph) * 700, Math.sin(ph) * Math.sin(th) * 700], i * 3);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    return g;
  }, []);
  return (
    <group>
      <mesh material={mat} raycast={noRaycast} renderOrder={-10}>
        <sphereGeometry args={[800, 24, 12]} />
      </mesh>
      <points geometry={stars} raycast={noRaycast}>
        <pointsMaterial color="#a9c4e6" size={1.3} sizeAttenuation={false} transparent opacity={0.65} fog={false} depthWrite={false} />
      </points>
    </group>
  );
}

function Terrain({ f, fence }: { f: SceneFrame; fence: Rect }) {
  const geom = useMemo(() => {
    const g = new THREE.PlaneGeometry(900, 900, 96, 96);
    g.rotateX(-Math.PI / 2);
    const pos = g.attributes.position as THREE.BufferAttribute;
    const colors = new Float32Array(pos.count * 3);
    const c1 = new THREE.Color('#0a1c18');
    const c2 = new THREE.Color('#123129');
    const c3 = new THREE.Color('#0b1622');
    const [fa, fb, fc, fd] = fence;
    for (let i = 0; i < pos.count; i++) {
      const wx = pos.getX(i);
      const wz = pos.getZ(i);
      const bx = wx + f.cx;
      const by = -wz + f.cy;
      const dx = Math.max(fa - bx, 0, bx - fc);
      const dy = Math.max(fb - by, 0, by - fd);
      const dist = Math.hypot(dx, dy);
      const k = THREE.MathUtils.smoothstep(dist, 4, 90);
      const n = Math.sin(bx * 0.031) * Math.cos(by * 0.027) * 2.2 + Math.sin(bx * 0.071 + by * 0.05) * 1.1 + Math.sin(bx * 0.013 - by * 0.017) * 3.5;
      pos.setY(i, -0.06 + k * (n + 2.2));
      const t = 0.5 + 0.5 * Math.sin(bx * 0.09) * Math.cos(by * 0.08);
      const col = c1.clone().lerp(c2, t * (1 - k * 0.5)).lerp(c3, k * 0.6);
      colors.set([col.r, col.g, col.b], i * 3);
    }
    g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    g.computeVertexNormals();
    return g;
  }, [f, fence]);
  return (
    <mesh geometry={geom} receiveShadow raycast={noRaycast}>
      <meshStandardMaterial vertexColors roughness={1} metalness={0} />
    </mesh>
  );
}

function Trees({ f, trees }: { f: SceneFrame; trees: SiteLayout['trees'] }) {
  const crown = useRef<THREE.InstancedMesh>(null);
  const crown2 = useRef<THREE.InstancedMesh>(null);
  const trunk = useRef<THREE.InstancedMesh>(null);
  useLayoutEffect(() => {
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const col = new THREE.Color();
    trees.forEach((t, i) => {
      const [x, , z] = toWorld(f, [t.x, t.y]);
      const s = t.s;
      m.compose(new THREE.Vector3(x, 1.2 * s, z), q, new THREE.Vector3(s, s, s));
      trunk.current!.setMatrixAt(i, m);
      m.compose(new THREE.Vector3(x, 3.6 * s, z), q, new THREE.Vector3(s, s, s));
      crown.current!.setMatrixAt(i, m);
      m.compose(new THREE.Vector3(x, 5.4 * s, z), q, new THREE.Vector3(s * 0.72, s * 0.8, s * 0.72));
      crown2.current!.setMatrixAt(i, m);
      col.setHSL(0.42 + t.tint * 0.08, 0.38, 0.11 + t.tint * 0.06);
      crown.current!.setColorAt(i, col);
      crown2.current!.setColorAt(i, col.offsetHSL(0, 0, 0.02));
    });
    for (const r of [crown, crown2, trunk]) {
      r.current!.instanceMatrix.needsUpdate = true;
      if (r.current!.instanceColor) r.current!.instanceColor.needsUpdate = true;
    }
  }, [f, trees]);
  return (
    <group>
      <instancedMesh ref={trunk} args={[undefined, undefined, trees.length]} raycast={noRaycast}>
        <cylinderGeometry args={[0.18, 0.26, 2.4, 6]} />
        <meshStandardMaterial color="#2a2019" roughness={1} />
      </instancedMesh>
      <instancedMesh ref={crown} args={[undefined, undefined, trees.length]} raycast={noRaycast}>
        <coneGeometry args={[2.3, 4.2, 7]} />
        <meshStandardMaterial roughness={0.95} flatShading />
      </instancedMesh>
      <instancedMesh ref={crown2} args={[undefined, undefined, trees.length]} raycast={noRaycast}>
        <coneGeometry args={[1.8, 3.4, 7]} />
        <meshStandardMaterial roughness={0.95} flatShading />
      </instancedMesh>
    </group>
  );
}

function Lamps({ f, lamps }: { f: SceneFrame; lamps: SiteLayout['lamps'] }) {
  const pole = useRef<THREE.InstancedMesh>(null);
  const head = useRef<THREE.InstancedMesh>(null);
  const pool = useRef<THREE.InstancedMesh>(null);
  const glowTex = useMemo(
    () =>
      canvasTexture(128, 128, (g) => {
        const grd = g.createRadialGradient(64, 64, 0, 64, 64, 64);
        grd.addColorStop(0, 'rgba(255,214,150,0.32)');
        grd.addColorStop(0.35, 'rgba(255,190,120,0.10)');
        grd.addColorStop(1, 'rgba(255,190,120,0)');
        g.fillStyle = grd;
        g.fillRect(0, 0, 128, 128);
      }),
    [],
  );
  useLayoutEffect(() => {
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const qf = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), -Math.PI / 2);
    lamps.forEach((l, i) => {
      const [x, , z] = toWorld(f, [l.x, l.y]);
      m.compose(new THREE.Vector3(x, 3, z), q, new THREE.Vector3(1, 1, 1));
      pole.current!.setMatrixAt(i, m);
      m.compose(new THREE.Vector3(x, 6.1, z), q, new THREE.Vector3(1, 1, 1));
      head.current!.setMatrixAt(i, m);
      m.compose(new THREE.Vector3(x, 0.08, z), qf, new THREE.Vector3(1, 1, 1));
      pool.current!.setMatrixAt(i, m);
    });
    pole.current!.instanceMatrix.needsUpdate = true;
    head.current!.instanceMatrix.needsUpdate = true;
    pool.current!.instanceMatrix.needsUpdate = true;
  }, [f, lamps]);
  return (
    <group>
      <instancedMesh ref={pole} args={[undefined, undefined, lamps.length]} raycast={noRaycast}>
        <cylinderGeometry args={[0.07, 0.1, 6, 6]} />
        <meshStandardMaterial color="#334155" metalness={0.6} roughness={0.5} />
      </instancedMesh>
      <instancedMesh ref={head} args={[undefined, undefined, lamps.length]} raycast={noRaycast}>
        <sphereGeometry args={[0.32, 10, 8]} />
        <meshBasicMaterial color="#ffd9a0" toneMapped={false} />
      </instancedMesh>
      <instancedMesh ref={pool} args={[undefined, undefined, lamps.length]} raycast={noRaycast}>
        <planeGeometry args={[8, 8]} />
        <meshBasicMaterial map={glowTex} transparent depthWrite={false} blending={THREE.AdditiveBlending} toneMapped={false} />
      </instancedMesh>
    </group>
  );
}

function Fence({ f, rect, skip }: { f: SceneFrame; rect: Rect; skip: Rect[] }) {
  const posts = useMemo(() => {
    const out: [number, number][] = [];
    const [a, b, c, d] = rect;
    const push = (x: number, y: number) => {
      if (!skip.some(([s0, s1, s2, s3]) => x >= s0 - 1 && x <= s2 + 1 && y >= s1 - 1 && y <= s3 + 1)) out.push([x, y]);
    };
    for (let x = a; x <= c; x += 3) {
      push(x, b);
      push(x, d);
    }
    for (let y = b + 3; y < d; y += 3) {
      push(a, y);
      push(c, y);
    }
    return out;
  }, [rect, skip]);
  const ref = useRef<THREE.InstancedMesh>(null);
  useLayoutEffect(() => {
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    posts.forEach(([x, y], i) => {
      const [wx, , wz] = toWorld(f, [x, y]);
      m.compose(new THREE.Vector3(wx, 0.9, wz), q, new THREE.Vector3(1, 1, 1));
      ref.current!.setMatrixAt(i, m);
    });
    ref.current!.instanceMatrix.needsUpdate = true;
  }, [posts, f]);
  const [a, b, c, d] = rect;
  const rails: [number, number, number, number][] = [
    [(a + c) / 2, b, c - a, 0],
    [(a + c) / 2, d, c - a, 0],
    [a, (b + d) / 2, d - b, 1],
    [c, (b + d) / 2, d - b, 1],
  ];
  return (
    <group>
      <instancedMesh ref={ref} args={[undefined, undefined, posts.length]} raycast={noRaycast}>
        <boxGeometry args={[0.08, 1.8, 0.08]} />
        <meshStandardMaterial color="#3b4b5e" metalness={0.5} roughness={0.6} />
      </instancedMesh>
      {rails.map(([x, y, len, vert], i) => {
        const p = toWorld(f, [x, y], 1.6);
        return (
          <mesh key={i} position={p} rotation={[0, vert ? Math.PI / 2 : 0, 0]} raycast={noRaycast}>
            <boxGeometry args={[len, 0.05, 0.05]} />
            <meshStandardMaterial color="#4a5d74" metalness={0.5} roughness={0.5} />
          </mesh>
        );
      })}
    </group>
  );
}

export function Scenery({ f, bounds, exitS }: { f: SceneFrame; bounds: [number, number, number, number]; exitS?: [number, number] }) {
  const L = useMemo(() => siteLayout(bounds, exitS), [bounds, exitS]);
  const tex = useMemo(() => {
    const asphalt = canvasTexture(256, 256, (g) => noise(g, 256, 256, '#10141b', 40, 3000, 3), [12, 12]);
    const pad = canvasTexture(256, 256, (g) => {
      noise(g, 256, 256, '#1a2433', 60, 2000, 5);
      g.strokeStyle = 'rgba(120,150,180,0.10)';
      for (let i = 0; i <= 256; i += 32) {
        g.beginPath();
        g.moveTo(i, 0);
        g.lineTo(i, 256);
        g.moveTo(0, i);
        g.lineTo(256, i);
        g.stroke();
      }
    }, [10, 6]);
    const [pa, pb, pc, pd] = L.parking;
    const pw = pc - pa, ph = pd - pb;
    const parking = canvasTexture(512, Math.round((512 * ph) / pw), (g) => {
      const W = 512, H = Math.round((512 * ph) / pw);
      noise(g, W, H, '#11161e', 40, 5000, 9);
      g.strokeStyle = 'rgba(220,230,240,0.55)';
      g.lineWidth = 2;
      const sx = W / pw;
      for (const rowY of [0.12, 0.42, 0.72]) {
        const y = rowY * H;
        for (let x = 4; x < pw - 2; x += 2.6) {
          g.beginPath();
          g.moveTo(x * sx, y);
          g.lineTo(x * sx, y + 5.2 * sx);
          g.stroke();
        }
        g.beginPath();
        g.moveTo(4 * sx, y + 5.2 * sx);
        g.lineTo((pw - 4) * sx, y + 5.2 * sx);
        g.stroke();
      }
    });
    const [fa, fb, fc, fd] = L.field;
    const fw = fc - fa, fh = fd - fb;
    const field = canvasTexture(1024, Math.round((1024 * fh) / fw), (g) => {
      const W = 1024, H = Math.round((1024 * fh) / fw);
      g.fillStyle = '#3a1f22';
      g.fillRect(0, 0, W, H);
      const r = H * 0.46;
      g.fillStyle = '#123a27';
      g.beginPath();
      g.roundRect(W * 0.06, H * 0.08, W * 0.88, H * 0.84, r);
      g.fill();
      for (let i = 0; i < 12; i++) {
        g.fillStyle = i % 2 ? 'rgba(255,255,255,0.025)' : 'rgba(0,0,0,0.04)';
        g.fillRect(W * 0.15 + (i * W * 0.7) / 12, H * 0.14, (W * 0.7) / 12, H * 0.72);
      }
      g.strokeStyle = 'rgba(230,240,235,0.55)';
      g.lineWidth = 2;
      g.strokeRect(W * 0.15, H * 0.14, W * 0.7, H * 0.72);
      g.beginPath();
      g.moveTo(W / 2, H * 0.14);
      g.lineTo(W / 2, H * 0.86);
      g.stroke();
      g.beginPath();
      g.arc(W / 2, H / 2, H * 0.13, 0, Math.PI * 2);
      g.stroke();
      g.strokeStyle = 'rgba(230,220,220,0.35)';
      for (let k = 0; k < 4; k++) {
        g.beginPath();
        g.roundRect(W * 0.02 + k * 7, H * 0.03 + k * 7, W * 0.96 - k * 14, H * 0.94 - k * 14, r);
        g.stroke();
      }
    });
    return { asphalt, pad, parking, field };
  }, [L]);
  const dashes = useMemo(() => {
    const out: [number, number, number][] = [];
    const [a, b, c, d] = L.roads[0];
    for (let x = a + 3; x < c; x += 6) out.push([x, (b + d) / 2, 0]);
    const [e, g, h, k] = L.roads[1];
    for (let y = g + 12; y < k; y += 6) out.push([(e + h) / 2, y, 1]);
    return out;
  }, [L]);
  const dashRef = useRef<THREE.InstancedMesh>(null);
  useLayoutEffect(() => {
    const m = new THREE.Matrix4();
    const qh = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), -Math.PI / 2);
    const qv = new THREE.Quaternion().setFromEuler(new THREE.Euler(-Math.PI / 2, 0, Math.PI / 2));
    dashes.forEach(([x, y, v], i) => {
      const [wx, , wz] = toWorld(f, [x, y]);
      m.compose(new THREE.Vector3(wx, 0.05, wz), v ? qv : qh, new THREE.Vector3(1, 1, 1));
      dashRef.current!.setMatrixAt(i, m);
    });
    dashRef.current!.instanceMatrix.needsUpdate = true;
  }, [dashes, f]);

  return (
    <group>
      <Sky />
      <Terrain f={f} fence={L.fence} />
      <RectPlane f={f} rect={L.pad} y={0.02}>
        <meshStandardMaterial map={tex.pad} roughness={0.9} />
      </RectPlane>
      {L.roads.map((r, i) => (
        <RectPlane key={i} f={f} rect={r} y={0.03}>
          <meshStandardMaterial map={tex.asphalt} roughness={0.85} metalness={0.05} />
        </RectPlane>
      ))}
      <RectPlane f={f} rect={L.driveway} y={0.035}>
        <meshStandardMaterial map={tex.asphalt} roughness={0.85} />
      </RectPlane>
      <RectPlane f={f} rect={L.parking} y={0.035}>
        <meshStandardMaterial map={tex.parking} roughness={0.85} />
      </RectPlane>
      <RectPlane f={f} rect={L.field} y={0.04}>
        <meshStandardMaterial map={tex.field} roughness={0.95} />
      </RectPlane>
      <instancedMesh ref={dashRef} args={[undefined, undefined, dashes.length]} raycast={noRaycast}>
        <planeGeometry args={[2.6, 0.18]} />
        <meshBasicMaterial color="#c9b98a" transparent opacity={0.55} />
      </instancedMesh>
      <Trees f={f} trees={L.trees} />
      <Lamps f={f} lamps={L.lamps} />
      <Fence f={f} rect={L.fence} skip={[L.driveway, [L.parking[0], L.fence[1] - 1, L.parking[2], L.fence[1] + 1]]} />
    </group>
  );
}
