import { describe, expect, it } from 'vitest';
import building from '../../../docs/sample_building.json';
import sample from '../../../docs/sample_run_state.json';
import { hexToRgb, mixOklab, PALETTE, routeColor, threatColor, threatIntensity } from '../lib/colors';
import { headingVec, imageDirToCanvas, polylineLength, routePolyline } from '../lib/geometry';
import { compactArgs, effectiveCameraStatus, formatTraceTime, heldDetections, isPerceiveAnalysis, ms, parseChange, traceSummary } from '../lib/format';
import type { Building, FrameRecord, RunState, TraceEntry } from '../types';

const B = building as unknown as Building;
const run = sample as unknown as RunState;

describe('colour ramp', () => {
  it('maps zero to neutral and the max to the threat colour', () => {
    expect(threatColor(0, 0.7)).toBe(PALETTE.neutral);
    expect(threatColor(0.7, 0.7)).toBe(PALETTE.threat);
  });
  it('is monotonic in red channel and relative to the max', () => {
    const reds = [0, 0.1, 0.2, 0.4, 0.7].map((p) => hexToRgb(threatColor(p, 0.7))[0]);
    for (let i = 1; i < reds.length; i++) expect(reds[i]).toBeGreaterThanOrEqual(reds[i - 1]);
    expect(threatIntensity(0.35, 0.7)).toBeCloseTo(0.5 ** 0.8, 5);
  });
  it('does not exaggerate a flat low-probability belief', () => {
    // max 0.02 -> floor of 0.1 keeps intensity low
    expect(threatIntensity(0.02, 0.02)).toBeLessThan(0.5);
  });
  it('OKLab mix returns endpoints and valid hex', () => {
    expect(mixOklab('#000000', '#ffffff', 0)).toBe('#000000');
    expect(mixOklab('#000000', '#ffffff', 1)).toBe('#ffffff');
    expect(mixOklab('#1f2a36', '#c2555a', 0.5)).toMatch(/^#[0-9a-f]{6}$/);
  });
  it('route colours follow status', () => {
    expect(routeColor('verified_clear')).toBe(PALETTE.clear);
    expect(routeColor('unverified')).toBe(PALETTE.caution);
    expect(routeColor('exposed')).toBe(PALETTE.threat);
    expect(routeColor('???')).toBe(PALETTE.gray);
  });
});

describe('route polyline builder', () => {
  it('builds room centroid -> door -> exit for a one-corridor route', () => {
    const pts = routePolyline({ path: ['R101', 'C1', 'EX-W'] }, B);
    expect(pts[0]).toEqual([7, 36]); // R101 centroid
    expect(pts[1]).toEqual([7, 28]); // door D-R101
    expect(pts[pts.length - 1]).toEqual([0, 25]); // exit EX-W
  });
  it('follows corridor centrelines across several corridors', () => {
    const pts = routePolyline({ path: ['R104', 'C1', 'C2', 'LOBBY', 'EX-S'] }, B);
    expect(pts[0]).toEqual([7, 14]);
    expect(pts).toContainEqual([30, 25]); // door C1-C2
    expect(pts).toContainEqual([34, 22]); // door C2-LOBBY
    expect(pts[pts.length - 1]).toEqual([34, 6]);
    // all corridor points of C1 lie on its centreline y = 25
    expect(pts.filter((p) => p[0] > 7 && p[0] < 30).every((p) => p[1] === 25)).toBe(true);
    expect(polylineLength(pts)).toBeGreaterThan(30);
  });
  it('handles every route in the sample run and never duplicates consecutive points', () => {
    for (const r of run.routing!.routes) {
      const pts = routePolyline(r, B);
      expect(pts.length).toBeGreaterThanOrEqual(2);
      for (let i = 1; i < pts.length; i++) expect(pts[i]).not.toEqual(pts[i - 1]);
    }
  });
  it('returns an empty polyline for a route without a path', () => {
    expect(routePolyline({ path: [] }, B)).toEqual([]);
  });
  it('heading and image-direction conventions', () => {
    const [x, y] = headingVec(90);
    expect(x).toBeCloseTo(0);
    expect(y).toBeCloseTo(1);
    const [dx, dy] = imageDirToCanvas(90); // up in the image = negative canvas y
    expect(dx).toBeCloseTo(0);
    expect(dy).toBeCloseTo(-1);
  });
});

describe('trace formatting', () => {
  it('parses transitions, deltas and appends', () => {
    expect(parseChange('P(threat) 0.50 -> 0.86')).toMatchObject({ kind: 'transition', key: 'P(threat)', from: '0.50', to: '0.86' });
    expect(parseChange('belief.p_threat: 0 -> 0.50')).toMatchObject({ kind: 'transition', key: 'belief.p_threat', from: '0', to: '0.50' });
    expect(parseChange('p[C3] +0.324')).toMatchObject({ kind: 'increase', key: 'p[C3]', delta: 0.324 });
    expect(parseChange('p[none] -0.356')).toMatchObject({ kind: 'decrease', key: 'p[none]', delta: -0.356 });
    expect(parseChange('camera.CAM-02.status -> fault')).toMatchObject({ kind: 'transition', key: 'camera.CAM-02.status', to: 'fault' });
    expect(parseChange('constraints.blocked_exits += EX-E')).toMatchObject({ kind: 'set', key: 'constraints.blocked_exits', to: '+ EX-E' });
    const region = parseChange('region C3,C2,GYM (0.74) -> C3,R107 (0.85)');
    expect(region.kind).toBe('transition');
    expect(region.key).toBe('region');
    expect(region.to).toBe('C3,R107 (0.85)');
  });
  it('formats tool args, durations and time', () => {
    expect(compactArgs({ camera_id: 'CAM-03', detect_every: 4 })).toBe('{ camera_id: CAM-03, detect_every: 4 }');
    expect(compactArgs({})).toBe('{}');
    expect(compactArgs({ rejected: ['HOLD', 'EVACUATE'] })).toBe('{ rejected: [HOLD, EVACUATE] }');
    expect(ms(4707.8)).toBe('4.71 s');
    expect(ms(12.4)).toBe('12 ms');
    expect(ms(30004.8)).toBe('30.0 s');
    expect(formatTraceTime(6.12)).toBe('T+06.1s');
  });
  it('identifies perceive analysis steps and summarises entries', () => {
    const steps = run.trace as TraceEntry[];
    const perceive = steps.filter(isPerceiveAnalysis);
    expect(perceive.length).toBeGreaterThan(0);
    expect(perceive.every((e) => typeof e.data.analysis_id === 'string')).toBe(true);
    expect(traceSummary(perceive[0])).toMatch(/^#\d+ PERCEIVE OpenCV analysis of CAM-\d\d \[vision\.analyze_camera/);
  });
  it('holds the last detections between DNN frames', () => {
    const pf: FrameRecord[] = [
      { index: 0, detected: true, detections: [{ cls: 'person', score: 0.9, box: [1, 2, 3, 4], track: 1 }] },
      { index: 1, detected: false, detections: [] },
      { index: 2, detected: false, detections: [] },
      { index: 3, detected: true, detections: [] },
    ];
    expect(heldDetections(pf, 2)).toHaveLength(1);
    expect(heldDetections(pf, 3)).toHaveLength(0);
    expect(heldDetections([], 0)).toHaveLength(0);
    const withWeapon = heldDetections(pf, 1, [{ cls: 'pistol', score: 0.6, frame: 0, kind: 'weapon_model', box: [5, 5, 5, 5] }]);
    expect(withWeapon.map((d) => d.cls)).toEqual(['person', 'pistol']);
  });
});

describe('camera status', () => {
  it('reports cameras listed as coverage gaps as faulted', () => {
    const r = JSON.parse(JSON.stringify(run)) as RunState;
    r.cameras['CAM-04'].status = 'pending_recheck';
    expect(effectiveCameraStatus(r, 'CAM-04')).toBe('pending_recheck');
    r.gaps = [{ camera_id: 'CAM-04', zone: 'C4', issues: ['frozen_feed'], reason: 'x' }];
    expect(effectiveCameraStatus(r, 'CAM-04')).toBe('fault');
    expect(effectiveCameraStatus(null, 'CAM-01')).toBe('idle');
  });
});
