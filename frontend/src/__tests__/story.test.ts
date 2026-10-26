import { describe, expect, it } from 'vitest';
import building from '../../../docs/sample_building.json';
import sample from '../../../docs/sample_run_state.json';
import { clipCategory, filterTrace, fmtDuration, heroClip, phaseCounts, runOutcome, runStats, shortSource, triggerKind } from '../lib/story';
import type { Building, RunState } from '../types';

const B = building as unknown as Building;
const run = sample as unknown as RunState;
const clone = (): RunState => JSON.parse(JSON.stringify(run));

// Clip specs as served by /api/footage (manifest spec field).
const CLIPS = {
  normal_a: { spec: { behavior: 'normal', people: 6 } },
  normal_b: { spec: { behavior: 'normal', people: 5, flip: true } },
  empty_a: { spec: { behavior: 'empty' } },
  flight_left_a: { spec: { behavior: 'flight', direction: 'left', people: 9 } },
  flight_left_b: { spec: { behavior: 'flight', direction: 'left', people: 7 } },
  congested_exit: { spec: { behavior: 'congested', people: 14 } },
  tampered: { spec: { behavior: 'normal', people: 5, tamper_after: 0.2 } },
  frozen_normal: { spec: { behavior: 'normal', people: 6, frozen: true } },
  smoke_normal: { spec: { behavior: 'normal', people: 7, smoke: 0.95 } },
};

describe('clip behaviour category', () => {
  it('maps manifest specs to categories, degraded flags first', () => {
    expect(clipCategory(CLIPS.normal_a)).toBe('calm');
    expect(clipCategory(CLIPS.empty_a)).toBe('empty');
    expect(clipCategory(CLIPS.flight_left_a)).toBe('flight');
    expect(clipCategory(CLIPS.congested_exit)).toBe('congested');
    expect(clipCategory(CLIPS.tampered)).toBe('degraded');
    expect(clipCategory(CLIPS.frozen_normal)).toBe('degraded');
    expect(clipCategory(CLIPS.smoke_normal)).toBe('degraded');
    expect(clipCategory({ spec: { behavior: 'normal', smoke: 0.2 } })).toBe('calm');
    expect(clipCategory(undefined)).toBe('unknown'); // e.g. user upload
    expect(clipCategory({ behavior: 'flight' })).toBe('flight'); // a bare spec (scenarios.clips)
  });
});

describe('scenario hero clip', () => {
  const trig = { source: 'x', claim: 'x', confidence: 0.5 };
  it('prefers the most alarming category, then the trigger-zone camera', () => {
    const s2 = { trigger: { ...trig, zone: 'C3' }, cameras: { 'CAM-01': 'normal_a', 'CAM-02': 'flight_left_a', 'CAM-03': 'flight_left_b', 'CAM-05': 'empty_a', 'CAM-07': 'flight_left_a' } };
    expect(heroClip(s2, B, CLIPS)).toEqual({ cameraId: 'CAM-03', clipId: 'flight_left_b', category: 'flight' });
    const s3 = { trigger: { ...trig, zone: 'C4' }, cameras: { 'CAM-01': 'normal_a', 'CAM-02': 'frozen_normal', 'CAM-04': 'tampered', 'CAM-07': 'smoke_normal' } };
    expect(heroClip(s3, B, CLIPS)?.cameraId).toBe('CAM-04');
    const s1 = { trigger: { ...trig, zone: 'C2' }, cameras: { 'CAM-01': 'normal_a', 'CAM-02': 'normal_b', 'CAM-05': 'empty_a' } };
    expect(heroClip(s1, B, CLIPS)).toMatchObject({ cameraId: 'CAM-02', category: 'calm' });
  });
  it('respects overrides and empty scenarios', () => {
    const s = { trigger: { ...trig, zone: 'C2' }, cameras: { 'CAM-01': 'normal_a', 'CAM-02': 'normal_b' } };
    expect(heroClip(s, B, CLIPS, { 'CAM-01': 'congested_exit' })).toMatchObject({ cameraId: 'CAM-01', category: 'congested' });
    expect(heroClip({ trigger: { ...trig, zone: 'C2' }, cameras: {} }, B, CLIPS)).toBeNull();
  });
});

describe('trigger and trace helpers', () => {
  it('classifies report sources', () => {
    expect(triggerKind('SIMULATED tip-line report')).toBe('tip');
    expect(triggerKind('SIMULATED 911 relay')).toBe('911');
    expect(triggerKind('SIMULATED staff radio call')).toBe('radio');
    expect(triggerKind('SIMULATED other')).toBe('other');
    expect(shortSource('SIMULATED 911 relay')).toBe('911 relay');
  });
  it('counts phases and filters the trace', () => {
    const c = phaseCounts(run.trace);
    expect(c.PERCEIVE + c.VALIDATE + c.DECIDE + c.ACT + c.REVIEW).toBe(run.trace.length);
    expect(c.REVIEW).toBe(1);
    expect(filterTrace(run.trace, new Set(['PERCEIVE'])).every((e) => e.phase === 'PERCEIVE')).toBe(true);
    expect(filterTrace(run.trace, new Set(), 'cam-03').length).toBeGreaterThan(0);
    expect(filterTrace(run.trace, new Set()).length).toBe(run.trace.length);
  });
});

describe('run outcome and stats', () => {
  it('derives the outcome from status and review history', () => {
    expect(runOutcome(run)).toMatchObject({ state: 'pending', recommended: 'LOCKDOWN_PLUS_EVACUATE', approved: null });
    const a = clone();
    a.status = 'complete';
    a.approved_option = 'LOCKDOWN_PLUS_EVACUATE';
    expect(runOutcome(a).state).toBe('approved');
    const r = clone();
    r.status = 'cancelled';
    r.review_history = [{ action: 'reject', option_id: 'LOCKDOWN_PLUS_EVACUATE', at: 1, recommended: 'LOCKDOWN_PLUS_EVACUATE' }];
    expect(runOutcome(r)).toMatchObject({ state: 'cancelled', rejected: ['LOCKDOWN_PLUS_EVACUATE'] });
    r.status = 'complete';
    expect(runOutcome(r).state).toBe('rejected');
  });
  it('summarises duration, cameras, faults and picks a usable thumbnail', () => {
    const s = runStats(run);
    expect(s.analysed).toBe(new Set(Object.values(run.analyses).map((a) => a.camera_id)).size);
    expect(s.faults).toBe(0);
    expect(s.steps).toBe(run.trace.length);
    expect(s.durationS).toBeCloseTo(run.review!.requested_at - run.started_at, 3);
    expect(s.thumb).toMatch(/^\/media\/runs\//);
    expect(fmtDuration(65)).toBe('1m 05s');
    expect(fmtDuration(9.4)).toBe('9s');
    expect(fmtDuration(null)).toBe('—');
  });
});
