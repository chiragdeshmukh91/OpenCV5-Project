// Observation / location helpers. Single source of truth for "where did this happen" across the
// incident card, twin, 3D scene, timeline and review panel, so they can never disagree.
import type { Evidence, Observation, ObservationLocation, RunState } from '../types';

/** Location statuses whose zone may be drawn on the twin / used as the event's place. */
export const APPLIED_STATUSES = new Set(['verified', 'human_confirmed']);

/**
 * True when the observation's location is verified or human-confirmed. Evidence from an older backend
 * (no `location` field) predates location checks and is treated as applied for backward compatibility.
 */
export function locationApplied(ev: Pick<Evidence, 'location'> | undefined | null): boolean {
  if (!ev) return false;
  if (!ev.location) return true;
  return APPLIED_STATUSES.has(ev.location.status);
}

/** Zone the observation is attributed to, or null when unknown / dismissed. */
export function attributedZone(ev: Pick<Evidence, 'location' | 'zone'> | undefined | null): string | null {
  if (!ev) return null;
  if (!ev.location) return ev.zone;
  return APPLIED_STATUSES.has(ev.location.status) ? ev.location.zone : null;
}

export const LOCATION_LABEL: Record<ObservationLocation['status'], string> = {
  verified: 'Verified',
  human_confirmed: 'Human-confirmed',
  unverified: 'Unknown — unverified',
  dismissed: 'Dismissed',
};

/** One-line location text, e.g. "C3 · human-confirmed" or "Unknown (camera mounted in C3)". */
export function locationText(loc: ObservationLocation | undefined, fallbackZone?: string): string {
  if (!loc) return fallbackZone ? `${fallbackZone} · camera zone` : 'Unknown';
  if (loc.status === 'verified') return `${loc.zone} · verified`;
  if (loc.status === 'human_confirmed') return `${loc.zone} · human-confirmed`;
  if (loc.status === 'dismissed') return `Dismissed (camera mounted in ${loc.camera_zone})`;
  return `Unknown (camera mounted in ${loc.camera_zone})`;
}

export type ObservationTier = 'pending_event' | 'pending_observation' | 'decided' | 'auto' | 'fault';

export function tierOf(o: Observation): ObservationTier {
  if (o.kind === 'fault') return 'fault';
  if (o.review.status === 'pending') return o.kind === 'candidate_event' ? 'pending_event' : 'pending_observation';
  if (o.review.status === 'not_required') return 'auto';
  return 'decided';
}

const TIER_ORDER: Record<ObservationTier, number> = { pending_event: 0, pending_observation: 1, decided: 2, auto: 3, fault: 4 };

/** Observations for review: pending candidate events first, then pending routine observations. */
export function observationsForReview(run: RunState | null): Observation[] {
  if (!run?.observations) return [];
  return Object.values(run.observations).sort(
    (a, b) => TIER_ORDER[tierOf(a)] - TIER_ORDER[tierOf(b)] || (a.kind === b.kind ? 0 : a.kind === 'candidate_event' ? -1 : 1) || a.camera_id.localeCompare(b.camera_id),
  );
}

export function pendingObservations(run: RunState | null): Observation[] {
  return observationsForReview(run).filter((o) => o.review.status === 'pending');
}

/** Lifecycle label: observation -> candidate event -> alert (applied) -> human-reviewed. */
export function lifecycleLabel(o: Observation): { label: string; tone: 'threat' | 'caution' | 'clear' | 'muted' | 'info' } {
  if (o.kind === 'fault') return { label: 'Camera fault', tone: 'muted' };
  if (o.review.status === 'dismissed') return { label: 'Dismissed by reviewer', tone: 'muted' };
  if (o.kind === 'candidate_event') {
    if (o.applied) return { label: o.review.status === 'confirmed' ? 'Alert · human-confirmed' : 'Alert · verified location', tone: 'threat' };
    return { label: 'Candidate event · needs review', tone: 'caution' };
  }
  if (o.applied) return { label: o.review.status === 'confirmed' ? 'Observation · human-confirmed' : 'Observation · verified', tone: 'clear' };
  return { label: 'Observation · location unknown', tone: 'info' };
}

/** Honest firearm status line for an analysis/observation. */
export function weaponStatusText(firearmDetector: string | null | undefined, weaponLikeCount: number): string {
  const det = firearmDetector ? `Weapon model ${firearmDetector}` : 'No firearm detector is configured (YOLOX-S COCO has no firearm class)';
  const wl = weaponLikeCount > 0 ? `${weaponLikeCount} weapon-like COCO object${weaponLikeCount === 1 ? '' : 's'} detected — not a firearm detection` : 'no weapon-like object detected in this clip';
  return `${det}; ${wl}.`;
}
