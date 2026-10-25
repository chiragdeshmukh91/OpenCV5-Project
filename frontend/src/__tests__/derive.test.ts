import { describe, expect, it } from 'vitest';
import building from '../../../docs/sample_building.json';
import sample from '../../../docs/sample_run_state.json';
import {
  agentActivity,
  cameraCoverage,
  composeSummary,
  elapsedSeconds,
  evidenceTimeline,
  keyObservations,
  priorityOf,
  procedureParts,
  procedureText,
  statusText,
  supportingAnalyses,
  uncertaintyLevel,
} from '../lib/derive';
import type { Building, RunState } from '../types';

const B = building as unknown as Building;
const run = sample as unknown as RunState;
const clone = (): RunState => JSON.parse(JSON.stringify(run));

describe('priority', () => {
  it('maps P(threat) to Low / Elevated / High with the documented thresholds', () => {
    expect(priorityOf(0).label).toBe('Low');
    expect(priorityOf(0.149).label).toBe('Low');
    expect(priorityOf(0.15).label).toBe('Elevated');
    expect(priorityOf(0.499).label).toBe('Elevated');
    expect(priorityOf(0.5).label).toBe('High');
    expect(priorityOf(0.934)).toEqual({ label: 'High', tone: 'threat' });
    expect(priorityOf(null).label).toBe('Unknown');
  });
});

describe('procedure labels', () => {
  it('splits the hybrid procedure for the arrow rendering', () => {
    expect(procedureParts('LOCKDOWN_PLUS_EVACUATE')).toEqual(['LOCKDOWN', 'EVACUATE']);
    expect(procedureText('LOCKDOWN_PLUS_EVACUATE')).toBe('LOCKDOWN → EVACUATE');
    expect(procedureText('HOLD')).toBe('HOLD');
    expect(procedureParts(null)).toEqual([]);
  });
});

describe('summary and status', () => {
  it('composes the AI summary only from real state', () => {
    const s = composeSummary(run);
    expect(s).toContain(run.scenario.trigger.claim);
    expect(s).toContain('Full evacuation not recommended'); // latest decision title
    expect(s).toContain('Threat localised to C3, R107, R103');
    expect(s).not.toMatch(/coverage gap/);
    const r = clone();
    r.gaps = [{ camera_id: 'CAM-04', zone: 'C4', issues: ['frozen_feed'], reason: 'x' }];
    r.belief!.localized = false;
    expect(composeSummary(r)).toMatch(/Not localised: P\(threat\) 93%/);
    expect(composeSummary(r)).toMatch(/1 coverage gap \(CAM-04\)/);
    expect(composeSummary(null)).toBe('');
  });
  it('freezes elapsed time at the review request', () => {
    const e = elapsedSeconds(run, Date.now());
    expect(e).toBeCloseTo(run.review!.requested_at - run.started_at, 3);
    expect(statusText(run)).toBe('Awaiting decision');
    expect(statusText(null)).toBe('No active run');
  });
  it('rates uncertainty from entropy and region mass', () => {
    expect(uncertaintyLevel(run).label).toBe('Low'); // localised, entropy 0.33, mass 0.93
    const r = clone();
    r.belief!.localized = false;
    r.belief!.entropy = 0.59;
    r.belief!.region_mass = 0.78;
    expect(uncertaintyLevel(r).label).toBe('Medium');
    r.belief!.entropy = 0.8;
    expect(uncertaintyLevel(r).label).toBe('High');
    expect(uncertaintyLevel(null).label).toBe('—');
  });
});

describe('agent activity timeline', () => {
  it('maps trace entries to the six stages', () => {
    const st = agentActivity(run);
    expect(st.map((s) => s.label)).toEqual(['Observed', 'Analyzed', 'Corroborated', 'Assessed Uncertainty', 'Recommended', 'Human Review']);
    expect(st.slice(0, 5).every((s) => s.state === 'done')).toBe(true);
    expect(st[5].state).toBe('active'); // awaiting review
    expect(st[1].detail).toMatch(/6 OpenCV analyses on 6 cameras/);
    expect(st[2].detail).toMatch(/Region C3, R107, R103/);
    expect(st[4].detail).toBe('LOCKDOWN → EVACUATE');
    expect(st[0].time).toMatch(/^\d\d:\d\d:\d\d$/);
  });
  it('marks the first pending stage active while running and all pending without a run', () => {
    const r = clone();
    r.status = 'running';
    r.review = null;
    r.trace = r.trace.slice(0, 6);
    const st = agentActivity(r);
    expect(st[0].state).toBe('done');
    expect(st[1].state).toBe('done');
    expect(st[2].state).toBe('active');
    expect(st[5].state).toBe('pending');
    expect(agentActivity(null).every((s) => s.state === 'pending')).toBe(true);
  });
});

describe('evidence timeline and observations', () => {
  it('builds timeline rows with frames and zone tags, skipping planning steps', () => {
    const items = evidenceTimeline(run, B);
    expect(items.length).toBeGreaterThan(5);
    expect(items.some((i) => i.title.startsWith('Next: analyse'))).toBe(false);
    const vision = items.find((i) => i.tag === 'Vision')!;
    expect(vision.analysisId).toBeTruthy();
    expect(vision.thumb).toMatch(/^\/media\/runs\//);
    expect(vision.zones.length).toBeGreaterThan(0);
    expect(items.find((i) => i.title.startsWith('Threat provisionally localised'))?.tag).toBe('Corroboration');
    expect(evidenceTimeline(null, B)).toEqual([]);
  });
  it('derives key observations from evidence', () => {
    const obs = keyObservations(run);
    expect(obs.filter((o) => o.tone === 'threat').length).toBe(2); // CAM-02, CAM-03 fleeing
    expect(obs.some((o) => /Ordinary activity or empty/.test(o.text))).toBe(true);
  });
  it('counts camera coverage and orders supporting analyses', () => {
    expect(cameraCoverage(run, 7)).toEqual({ analysed: 6, total: 7, analysing: null });
    const sup = supportingAnalyses(run);
    expect(sup.length).toBe(5);
    expect(['CAM-02', 'CAM-03']).toContain(run.analyses[sup[0]]?.camera_id ?? 'CAM-02');
  });
});
