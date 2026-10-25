import { describe, expect, it } from 'vitest';
import building from '../../../docs/sample_building.json';
import sample from '../../../docs/sample_run_state.json';
import {
  cameraGoal,
  deriveFloors,
  distributeGlyphs,
  easeInOutCubic,
  fitDistance,
  frameOf,
  initialView,
  isExteriorEdge,
  lerpV3,
  pointInPolygon,
  splitWallForDoors,
  toWorld,
  viewReducer,
  type V3,
} from '../lib/scene';
import { routePolyline } from '../lib/geometry';
import type { Building, RunState, Vec2 } from '../types';

const B = building as unknown as Building;
const run = sample as unknown as RunState;
const f = frameOf(B);
const dist = (a: V3, b: V3) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

describe('view-level state machine', () => {
  it('walks campus -> building -> floor and back', () => {
    let s = initialView('L0');
    expect(s).toEqual({ level: 'campus', zone: null, camera: null, floor: 'L0' });
    s = viewReducer(s, { type: 'building-click' });
    expect(s.level).toBe('building');
    expect(viewReducer(s, { type: 'building-click' })).toBe(s); // no-op outside campus
    s = viewReducer(s, { type: 'enter-floor' });
    expect(s.level).toBe('floor');
    s = viewReducer(s, { type: 'back' });
    expect(s.level).toBe('building');
    s = viewReducer(s, { type: 'back' });
    expect(s.level).toBe('campus');
    expect(viewReducer(s, { type: 'back' })).toBe(s);
  });
  it('selecting a zone or camera from campus enters the building and focuses it', () => {
    let s = viewReducer(initialView(), { type: 'select-zone', id: 'C3' });
    expect(s).toMatchObject({ level: 'building', zone: 'C3', camera: null });
    s = viewReducer(s, { type: 'select-camera', id: 'CAM-02' });
    expect(s).toMatchObject({ zone: null, camera: 'CAM-02' });
    s = viewReducer(s, { type: 'select-camera', id: 'CAM-02' }); // toggle off
    expect(s.camera).toBeNull();
    s = viewReducer(viewReducer(s, { type: 'select-zone', id: 'R101' }), { type: 'back' });
    expect(s).toMatchObject({ zone: null, level: 'building' }); // back clears focus first
  });
  it('going to campus clears focus; floor selection opens the floor view', () => {
    let s = viewReducer(viewReducer(initialView(), { type: 'select-zone', id: 'C3' }), { type: 'level', level: 'campus' });
    expect(s).toMatchObject({ level: 'campus', zone: null });
    s = viewReducer(s, { type: 'select-floor', id: 'L0' });
    expect(s).toMatchObject({ level: 'floor', floor: 'L0' });
    expect(viewReducer(s, { type: 'clear' })).toMatchObject({ zone: null, camera: null, level: 'floor' });
  });
});

describe('camera transition targets', () => {
  it('moves closer from campus to building to floor', () => {
    const c = cameraGoal('campus', f);
    const b = cameraGoal('building', f);
    const fl = cameraGoal('floor', f);
    expect(dist(c.position, c.target)).toBeGreaterThan(dist(b.position, b.target));
    expect(dist(b.position, b.target)).toBeGreaterThan(dist(fl.position, fl.target) * 0.9);
    // floor view is near top-down
    const v = [fl.position[0] - fl.target[0], fl.position[1] - fl.target[1], fl.position[2] - fl.target[2]];
    expect(v[1] / Math.hypot(...v)).toBeGreaterThan(0.95);
  });
  it('backs off when panels cover part of the viewport', () => {
    const full = cameraGoal('building', f, { aspect: 1.7 });
    const safe = cameraGoal('building', f, { aspect: 1.7, safeW: 0.55, safeH: 0.7 });
    expect(dist(safe.position, safe.target)).toBeGreaterThan(dist(full.position, full.target) * 1.2);
  });
  it('focuses a zone on its centroid and a camera along its view direction', () => {
    const z = B.zones.find((x) => x.id === 'GYM')!;
    const zg = cameraGoal('building', f, { zone: z });
    expect(zg.target).toEqual(toWorld(f, z.centroid, 0));
    expect(dist(zg.position, zg.target)).toBeGreaterThanOrEqual(30);
    const cam = B.cameras.find((c) => c.id === 'CAM-04')!; // yaw 0 = looking east (+x)
    const cg = cameraGoal('floor', f, { camera: cam });
    const p = toWorld(f, cam.position, 0);
    expect(cg.target[0]).toBeGreaterThan(p[0]);
    expect(cg.target[2]).toBeCloseTo(p[2], 5);
    expect(cg.position[1]).toBeGreaterThan(20);
  });
  it('fit distance grows with extent and narrower aspect', () => {
    expect(fitDistance(50, 20, 38, 1.8)).toBeGreaterThan(fitDistance(25, 20, 38, 1.8));
    expect(fitDistance(50, 20, 38, 1.0)).toBeGreaterThan(fitDistance(50, 20, 38, 2.0));
  });
  it('easing and interpolation are bounded and monotonic', () => {
    expect(easeInOutCubic(0)).toBe(0);
    expect(easeInOutCubic(1)).toBe(1);
    expect(easeInOutCubic(0.5)).toBeCloseTo(0.5);
    let prev = -1;
    for (let t = 0; t <= 1.0001; t += 0.05) {
      const e = easeInOutCubic(Math.min(1, t));
      expect(e).toBeGreaterThanOrEqual(prev);
      prev = e;
    }
    expect(lerpV3([0, 0, 0], [10, 20, 30], 0.5)).toEqual([5, 10, 15]);
  });
});

describe('floor derivation', () => {
  it('a model without a level field is one ground floor with every zone', () => {
    const floors = deriveFloors(B);
    expect(floors).toHaveLength(1);
    expect(floors[0]).toMatchObject({ id: 'L0', name: 'Ground (L0)', level: 0 });
    expect(floors[0].zoneIds).toHaveLength(B.zones.length);
  });
  it('groups zones by a numeric level when present', () => {
    const zones = [
      { ...B.zones[0], level: 0 },
      { ...B.zones[1], level: 1 },
      { ...B.zones[2], level: 1 },
      { ...B.zones[3], level: -1 },
    ];
    const floors = deriveFloors({ zones } as unknown as Building);
    expect(floors.map((x) => x.id)).toEqual(['L-1', 'L0', 'L1']);
    expect(floors[2].zoneIds).toHaveLength(2);
    expect(floors[2].name).toBe('Level 1 (L1)');
  });
});

describe('person glyph distribution', () => {
  const room: Vec2[] = [
    [0, 0],
    [14, 0],
    [14, 16],
    [0, 16],
  ];
  it('places the requested count inside the polygon, away from walls, deterministically', () => {
    const g = distributeGlyphs(room, 7, 42);
    expect(g).toHaveLength(7);
    expect(g.every((p) => pointInPolygon(p, room) && p[0] >= 0.9 && p[0] <= 13.1 && p[1] >= 0.9 && p[1] <= 15.1)).toBe(true);
    expect(distributeGlyphs(room, 7, 42)).toEqual(g);
    expect(distributeGlyphs(room, 7, 43)).not.toEqual(g);
    for (let i = 0; i < g.length; i++) for (let j = i + 1; j < g.length; j++) expect(Math.hypot(g[i][0] - g[j][0], g[i][1] - g[j][1])).toBeGreaterThanOrEqual(1.2 - 1e-9);
  });
  it('rounds fractional medians, caps large counts and handles empty input', () => {
    expect(distributeGlyphs(room, 6.5, 1)).toHaveLength(7);
    expect(distributeGlyphs(room, 400, 1)).toHaveLength(24);
    expect(distributeGlyphs(room, 0, 1)).toEqual([]);
    expect(distributeGlyphs([[0, 0], [1, 0], [1, 1]], 3, 1)).toEqual([]); // too small after margin
  });
  it('fits a crowd into a narrow corridor by relaxing spacing', () => {
    const c1 = B.zones.find((z) => z.id === 'C1')!;
    const g = distributeGlyphs(c1.polygon, 20, 9);
    expect(g.length).toBeGreaterThanOrEqual(18);
    expect(g.every((p) => pointInPolygon(p, c1.polygon))).toBe(true);
  });
});

describe('route path building and wall geometry', () => {
  it('every sample route starts in its zone and ends at its exit', () => {
    const exits = new Map(B.exits.map((e) => [e.id, e]));
    for (const r of run.routing!.routes) {
      const pts = routePolyline(r, B);
      const from = B.zones.find((z) => z.id === r.from)!;
      expect(pointInPolygon(pts[0], from.polygon)).toBe(true);
      expect(pts[pts.length - 1]).toEqual(exits.get(r.exit!)!.position);
    }
  });
  it('cuts door gaps out of wall segments', () => {
    const parts = splitWallForDoors([0, 28], [14, 28], [{ position: [7, 28], width_m: 0.95 }]);
    expect(parts).toHaveLength(2);
    expect(parts[0][1][0]).toBeCloseTo(7 - 0.475, 3);
    expect(parts[1][0][0]).toBeCloseTo(7 + 0.475, 3);
    expect(splitWallForDoors([0, 0], [10, 0], [{ position: [5, 3], width_m: 1 }])).toHaveLength(1); // door off the wall
    expect(splitWallForDoors([0, 0], [6, 0], [{ position: [3, 0], width_m: 6 }])).toHaveLength(0); // full opening
  });
  it('detects exterior edges of the footprint', () => {
    expect(isExteriorEdge([0, 6], [14, 6], B.zones)).toBe(true); // south wall of R104
    expect(isExteriorEdge([0, 22], [14, 22], B.zones)).toBe(false); // R104 / C1 shared wall
  });
});
