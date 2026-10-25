// Pure scene logic for the 3D command view: view levels, camera targets, floor derivation,
// person-glyph distribution and wall/door geometry. No three.js imports so it is unit-testable.
import type { Building, Camera, Door, Vec2, Zone } from '../types';

export type ViewLevel = 'campus' | 'building' | 'floor';
export const LEVELS: ViewLevel[] = ['campus', 'building', 'floor'];

export interface ViewState {
  level: ViewLevel;
  zone: string | null;
  camera: string | null;
  floor: string;
}

export type ViewEvent =
  | { type: 'level'; level: ViewLevel }
  | { type: 'building-click' }
  | { type: 'enter-floor' }
  | { type: 'select-zone'; id: string }
  | { type: 'select-camera'; id: string }
  | { type: 'select-floor'; id: string }
  | { type: 'clear' }
  | { type: 'back' };

export const initialView = (floor = 'L0'): ViewState => ({ level: 'campus', zone: null, camera: null, floor });

/** View-level state machine: campus -> building -> floor, with zone / camera focus. */
export function viewReducer(s: ViewState, e: ViewEvent): ViewState {
  switch (e.type) {
    case 'level':
      return { ...s, level: e.level, zone: e.level === 'campus' ? null : s.zone, camera: e.level === 'campus' ? null : s.camera };
    case 'building-click':
      return s.level === 'campus' ? { ...s, level: 'building' } : s;
    case 'enter-floor':
      return { ...s, level: 'floor' };
    case 'select-zone':
      if (s.zone === e.id) return { ...s, zone: null };
      return { ...s, level: s.level === 'campus' ? 'building' : s.level, zone: e.id, camera: null };
    case 'select-camera':
      if (s.camera === e.id) return { ...s, camera: null };
      return { ...s, level: s.level === 'campus' ? 'building' : s.level, camera: e.id, zone: null };
    case 'select-floor':
      return { ...s, floor: e.id, level: 'floor' };
    case 'clear':
      return { ...s, zone: null, camera: null };
    case 'back':
      if (s.zone || s.camera) return { ...s, zone: null, camera: null };
      if (s.level === 'floor') return { ...s, level: 'building' };
      if (s.level === 'building') return { ...s, level: 'campus' };
      return s;
    default:
      return s;
  }
}

// ------------------------------------------------------------------ floors
export interface Floor {
  id: string;
  name: string;
  level: number;
  zoneIds: string[];
}

/**
 * Floors derived from the building model. Zones may carry a numeric `level` (or `floor`); a model
 * without that field is a single-storey building with one ground floor.
 */
export function deriveFloors(b: Pick<Building, 'zones'>): Floor[] {
  const groups = new Map<number, string[]>();
  for (const z of b.zones) {
    const raw = (z as unknown as { level?: unknown; floor?: unknown }).level ?? (z as unknown as { floor?: unknown }).floor;
    const lv = typeof raw === 'number' && Number.isFinite(raw) ? Math.round(raw) : 0;
    groups.set(lv, [...(groups.get(lv) ?? []), z.id]);
  }
  return [...groups.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([lv, ids]) => ({ id: `L${lv}`, level: lv, name: lv === 0 ? 'Ground (L0)' : lv < 0 ? `Basement (L${lv})` : `Level ${lv} (L${lv})`, zoneIds: ids }));
}

// ------------------------------------------------------------------ frames & camera targets
export interface SceneFrame {
  cx: number;
  cy: number;
  spanX: number;
  spanY: number;
}

export function frameOf(b: Pick<Building, 'bounds'>): SceneFrame {
  const [x0, y0, x1, y1] = b.bounds;
  return { cx: (x0 + x1) / 2, cy: (y0 + y1) / 2, spanX: x1 - x0, spanY: y1 - y0 };
}

export type V3 = [number, number, number];

/** Building (x east, y north) -> three.js (x, h, z) with north = -z, centred on the building. */
export function toWorld(f: SceneFrame, [x, y]: Vec2, h = 0): V3 {
  return [x - f.cx, h, -(y - f.cy)];
}

export interface CameraGoal {
  position: V3;
  target: V3;
}

const norm = (v: V3): V3 => {
  const l = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / l, v[1] / l, v[2] / l];
};
const add = (a: V3, b: V3, k = 1): V3 => [a[0] + b[0] * k, a[1] + b[1] * k, a[2] + b[2] * k];

/** Distance at which a box of half-extents (halfW wide, halfH tall on screen) fits the view. */
export function fitDistance(halfW: number, halfH: number, fovDeg: number, aspect: number): number {
  const v = (fovDeg * Math.PI) / 180;
  const h = 2 * Math.atan(Math.tan(v / 2) * Math.max(0.2, aspect));
  return Math.max(halfH / Math.tan(v / 2), halfW / Math.tan(h / 2));
}

export interface GoalOpts {
  fov?: number;
  aspect?: number;
  zone?: Zone | null;
  camera?: Camera | null;
  /** Fraction of the viewport width / height not covered by floating panels (0..1]. */
  safeW?: number;
  safeH?: number;
}

/** Camera position / target for a view level, optionally focused on a zone or a camera. */
export function cameraGoal(level: ViewLevel, f: SceneFrame, o: GoalOpts = {}): CameraGoal {
  const fov = o.fov ?? 38;
  const aspect = o.aspect ?? 16 / 9;
  const sw = Math.min(1, Math.max(0.3, o.safeW ?? 1));
  const sh = Math.min(1, Math.max(0.3, o.safeH ?? 1));
  if (o.camera) {
    const c = o.camera;
    const yaw = (c.yaw_deg * Math.PI) / 180;
    const look: V3 = [Math.cos(yaw), 0, -Math.sin(yaw)];
    const p = toWorld(f, c.position, 0);
    const target = add(p, look, 5);
    return { target, position: [target[0] - look[0] * 34 - 12, 46, target[2] - look[2] * 34 + 24] };
  }
  if (o.zone) {
    const z = o.zone;
    const xs = z.polygon.map((q) => q[0]);
    const ys = z.polygon.map((q) => q[1]);
    const size = Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys));
    const target = toWorld(f, z.centroid, 0);
    const dir = norm(level === 'floor' ? [0, 1, 0.35] : [-0.35, 1, 0.8]);
    const d = Math.max(30, fitDistance((size * 0.9) / sw, (size * 0.7) / sh, fov, aspect) * 1.2);
    return { target, position: add(target, dir, d) };
  }
  if (level === 'campus') {
    const dir = norm([-0.62, 0.58, 0.95]);
    const d = fitDistance(f.spanX * 1.3, f.spanY * 1.45, fov, aspect);
    const target: V3 = [12, 0, -16];
    return { target, position: add(target, dir, d) };
  }
  if (level === 'building') {
    const dir = norm([-0.42, 0.95, 0.85]);
    const d = fitDistance((f.spanX * 0.6) / sw, (f.spanY * 0.72) / sh, fov, aspect);
    return { target: [0, 0, 0], position: add([0, 0, 0], dir, d) };
  }
  const dir = norm([0, 1, 0.22]);
  const d = fitDistance((f.spanX * 0.54) / sw, (f.spanY * 0.58) / sh, fov, aspect);
  return { target: [0, 0, 1.5], position: add([0, 0, 1.5], dir, d) };
}

export const easeInOutCubic = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

export function lerpV3(a: V3, b: V3, t: number): V3 {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

// ------------------------------------------------------------------ geometry helpers
export function pointInPolygon([x, y]: Vec2, poly: Vec2[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i];
    const [xj, yj] = poly[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** Seeded PRNG (mulberry32) so scenery and glyph layouts are stable between renders. */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function hashString(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

/**
 * Positions for N person glyphs inside a zone polygon (a count visualisation, not locations).
 * Deterministic per zone, kept `margin` from the walls and roughly `spacing` apart; capped at `max`.
 */
export function distributeGlyphs(poly: Vec2[], count: number, seed: number, max = 24, spacing = 1.2, margin = 0.9): Vec2[] {
  const n = Math.max(0, Math.min(max, Math.round(count)));
  if (n === 0 || poly.length < 3) return [];
  const xs = poly.map((p) => p[0]);
  const ys = poly.map((p) => p[1]);
  const [x0, x1, y0, y1] = [Math.min(...xs) + margin, Math.max(...xs) - margin, Math.min(...ys) + margin, Math.max(...ys) - margin];
  if (x1 <= x0 || y1 <= y0) return [];
  const r = rng(seed);
  const out: Vec2[] = [];
  let minD = spacing;
  for (let attempt = 0; out.length < n && attempt < 4000; attempt++) {
    if (attempt > 0 && attempt % 800 === 0) minD *= 0.7; // relax spacing in crowded zones
    const p: Vec2 = [x0 + r() * (x1 - x0), y0 + r() * (y1 - y0)];
    if (!pointInPolygon(p, poly)) continue;
    if (out.some((q) => Math.hypot(q[0] - p[0], q[1] - p[1]) < minD)) continue;
    out.push(p);
  }
  return out;
}

/** Split a wall segment a->b around door positions lying on it (door gap = door width). */
export function splitWallForDoors(a: Vec2, b: Vec2, doors: Pick<Door, 'position' | 'width_m'>[], tol = 0.6): [Vec2, Vec2][] {
  const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
  if (len < 1e-6) return [];
  const ux = (b[0] - a[0]) / len;
  const uy = (b[1] - a[1]) / len;
  const gaps: [number, number][] = [];
  for (const d of doors) {
    const px = d.position[0] - a[0];
    const py = d.position[1] - a[1];
    const t = px * ux + py * uy;
    const off = Math.abs(px * uy - py * ux);
    if (off > tol || t < -0.01 || t > len + 0.01) continue;
    const w = Math.min(d.width_m, len);
    gaps.push([Math.max(0, t - w / 2), Math.min(len, t + w / 2)]);
  }
  gaps.sort((p, q) => p[0] - q[0]);
  const out: [Vec2, Vec2][] = [];
  let cur = 0;
  const at = (t: number): Vec2 => [a[0] + ux * t, a[1] + uy * t];
  for (const [g0, g1] of gaps) {
    if (g0 - cur > 0.2) out.push([at(cur), at(g0)]);
    cur = Math.max(cur, g1);
  }
  if (len - cur > 0.2) out.push([at(cur), at(len)]);
  return out;
}

/** True when the edge a->b of a zone faces the outside of the building (no zone on the other side). */
export function isExteriorEdge(a: Vec2, b: Vec2, zones: Pick<Zone, 'polygon'>[], probe = 0.6): boolean {
  const len = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
  const m: Vec2 = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
  const n: Vec2 = [-(b[1] - a[1]) / len, (b[0] - a[0]) / len];
  const p1: Vec2 = [m[0] + n[0] * probe, m[1] + n[1] * probe];
  const p2: Vec2 = [m[0] - n[0] * probe, m[1] - n[1] * probe];
  const inside = (p: Vec2) => zones.some((z) => pointInPolygon(p, z.polygon));
  return !(inside(p1) && inside(p2));
}

export function zoneSize(z: Pick<Zone, 'polygon'>): { w: number; h: number } {
  const xs = z.polygon.map((p) => p[0]);
  const ys = z.polygon.map((p) => p[1]);
  return { w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) };
}
