// Regression: people seen in footage that was not recorded at a camera's site must not be placed
// inside the school (alert, twin, timeline and incident must agree that the location is unknown).
import { describe, expect, it } from 'vitest';
import building from '../../../docs/sample_building.json';
import fixture from './fixtures_run_s2_unverified.json';
import { evidenceTimeline, keyObservations, composeSummary } from '../lib/derive';
import { attributedZone, lifecycleLabel, locationApplied, locationText, observationsForReview, pendingObservations, weaponStatusText } from '../lib/observations';
import { initialPage } from '../lib/startup';
import { workflowStep } from '../components/StartPage';
import type { Building, RunState } from '../types';

const B = building as unknown as Building;
const base = fixture as unknown as RunState;
const clone = (): RunState => JSON.parse(JSON.stringify(base));

function confirm(run: RunState, cid: string): RunState {
  const o = run.observations![cid];
  const loc = { ...o.location, zone: o.camera_zone, status: 'human_confirmed' as const, confidence: 1 };
  o.location = loc;
  o.applied = true;
  o.review = { status: 'confirmed', reviewer: 'test', at: 1, note: '' };
  run.cameras[cid].evidence!.location = loc;
  return run;
}

describe('fixture is a real backend run before review', () => {
  it('has every observation with unknown location and no alerted zone', () => {
    const run = clone();
    expect(run.status).toBe('awaiting_review');
    expect(run.belief!.localized).toBe(false);
    expect(Object.values(run.zones).some((z) => z.status === 'alert')).toBe(false);
    for (const o of Object.values(run.observations!)) {
      expect(o.location.zone).toBeNull();
      expect(o.location.reasons.join(' ')).toMatch(/outdoor/);
    }
  });
});

describe('location helpers', () => {
  it('only verified / human-confirmed locations are applied', () => {
    const run = clone();
    const ev = run.cameras['CAM-03'].evidence!;
    expect(locationApplied(ev)).toBe(false);
    expect(attributedZone(ev)).toBeNull();
    expect(locationText(ev.location)).toBe('Unknown (camera mounted in C3)');
    confirm(run, 'CAM-03');
    expect(locationApplied(run.cameras['CAM-03'].evidence)).toBe(true);
    expect(attributedZone(run.cameras['CAM-03'].evidence)).toBe('C3');
    expect(locationText(run.cameras['CAM-03'].evidence!.location)).toBe('C3 · human-confirmed');
  });

  it('evidence from an older backend without location data keeps its camera zone', () => {
    expect(attributedZone({ zone: 'C1' } as never)).toBe('C1');
  });
});

describe('alert / timeline / incident consistency', () => {
  it('unverified flight is a candidate event, not "people fleeing in C3"', () => {
    const run = clone();
    const texts = keyObservations(run).map((o) => o.text);
    expect(texts.some((t) => /People fleeing in/.test(t))).toBe(false);
    expect(texts.some((t) => t.startsWith('Candidate event on CAM-03') && t.includes('location unknown'))).toBe(true);
    expect(composeSummary(run)).toMatch(/unknown location await review/);
  });

  it('timeline entries for unverified cameras carry no zone tag', () => {
    const items = evidenceTimeline(clone(), B).filter((i) => i.cameraId === 'CAM-03');
    expect(items.length).toBeGreaterThan(0);
    for (const i of items) {
      expect(i.locationUnknown).toBe(true);
      expect(i.zones).not.toContain('C3');
    }
  });

  it('after human confirmation the same zone appears everywhere', () => {
    const run = confirm(clone(), 'CAM-03');
    expect(keyObservations(run).some((o) => o.text.startsWith('People fleeing in C3 (CAM-03)'))).toBe(true);
    const items = evidenceTimeline(run, B).filter((i) => i.cameraId === 'CAM-03');
    expect(items.every((i) => !i.locationUnknown && i.zones.includes('C3'))).toBe(true);
  });

  it('dismissed observations are dropped from key observations but kept for review', () => {
    const run = clone();
    const o = run.observations!['CAM-03'];
    o.review = { status: 'dismissed', reviewer: 't', at: 1, note: 'not ours' };
    o.location = { ...o.location, status: 'dismissed' };
    run.cameras['CAM-03'].evidence!.location = o.location;
    expect(keyObservations(run).some((k) => k.cameraId === 'CAM-03')).toBe(false);
    expect(observationsForReview(run).some((x) => x.camera_id === 'CAM-03')).toBe(true);
    expect(lifecycleLabel(o).label).toBe('Dismissed by reviewer');
  });
});

describe('review ordering and lifecycle', () => {
  it('lists pending candidate events first', () => {
    const list = observationsForReview(clone());
    const firstRoutine = list.findIndex((o) => o.kind !== 'candidate_event');
    expect(list.slice(0, firstRoutine).every((o) => o.kind === 'candidate_event' && o.review.status === 'pending')).toBe(true);
    expect(pendingObservations(clone()).length).toBe(7);
    expect(lifecycleLabel(list[0]).label).toBe('Candidate event · needs review');
    const run = confirm(clone(), list[0].camera_id);
    expect(lifecycleLabel(run.observations![list[0].camera_id]).label).toBe('Alert · human-confirmed');
  });

  it('never claims a firearm detection', () => {
    expect(weaponStatusText(null, 0)).toMatch(/No firearm detector/);
    expect(weaponStatusText(null, 2)).toMatch(/not a firearm detection/);
  });
});

describe('startup', () => {
  it('always resets the URL to the start screen', () => {
    window.history.replaceState(null, '', '#/evidence');
    expect(initialPage('start')).toBe('start');
    expect(window.location.hash).toBe('#/start');
  });

  it('workflow step follows real run state', () => {
    expect(workflowStep(null)).toBe(0);
    const run = clone();
    expect(workflowStep(run)).toBe(3);
    expect(workflowStep({ ...run, status: 'running', assessment: null })).toBe(1);
    expect(workflowStep({ ...run, status: 'complete' })).toBe(4);
  });
});
