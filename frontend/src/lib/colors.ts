// Colour logic for the dashboard. Pure functions so they can be unit-tested.

export const PALETTE = {
  neutral: '#14263f', // zone fill with no threat mass (navy)
  threat: '#ef4444', // red, used only for threat probability / alerts
  caution: '#f59e0b',
  clear: '#2dd4bf',
  info: '#38bdf8',
  cyan: '#22d3ee',
  gray: '#6782a3',
  outline: '#2b4a70',
} as const;

type RGB = [number, number, number];

export function hexToRgb(hex: string): RGB {
  const h = hex.replace('#', '');
  const v = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
  return [parseInt(v.slice(0, 2), 16), parseInt(v.slice(2, 4), 16), parseInt(v.slice(4, 6), 16)];
}

export function rgbToHex([r, g, b]: RGB): string {
  const c = (x: number) => Math.max(0, Math.min(255, Math.round(x))).toString(16).padStart(2, '0');
  return `#${c(r)}${c(g)}${c(b)}`;
}

// sRGB <-> OKLab so the ramp is perceptually even (no muddy midpoint).
const toLinear = (c: number) => {
  const x = c / 255;
  return x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
};
const fromLinear = (x: number) => 255 * (x <= 0.0031308 ? 12.92 * x : 1.055 * x ** (1 / 2.4) - 0.055);

function rgbToOklab([r, g, b]: RGB): RGB {
  const lr = toLinear(r), lg = toLinear(g), lb = toLinear(b);
  const l = Math.cbrt(0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb);
  const m = Math.cbrt(0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb);
  const s = Math.cbrt(0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
}

function oklabToRgb([L, a, b]: RGB): RGB {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return [
    fromLinear(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s),
    fromLinear(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s),
    fromLinear(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s),
  ];
}

export function mixOklab(a: string, b: string, t: number): string {
  const A = rgbToOklab(hexToRgb(a));
  const B = rgbToOklab(hexToRgb(b));
  const k = Math.max(0, Math.min(1, t));
  return rgbToHex(oklabToRgb([A[0] + (B[0] - A[0]) * k, A[1] + (B[1] - A[1]) * k, A[2] + (B[2] - A[2]) * k]));
}

/**
 * Normalised intensity of a zone's threat probability relative to the current maximum.
 * A floor on the denominator keeps a flat, low-probability belief from being painted as alarming.
 */
export function threatIntensity(p: number, maxP: number, floor = 0.25): number {
  if (!Number.isFinite(p) || p <= 0) return 0;
  const denom = Math.max(maxP, floor);
  return Math.min(1, p / denom) ** 0.8;
}

/** Neutral slate -> muted red ramp (OKLab), scaled relative to the max zone probability. */
export function threatColor(p: number, maxP: number): string {
  return mixOklab(PALETTE.neutral, PALETTE.threat, threatIntensity(p, maxP));
}

export const ROUTE_COLORS: Record<string, string> = {
  verified_clear: PALETTE.clear,
  unverified: PALETTE.caution,
  congested: PALETTE.caution,
  exposed: PALETTE.threat,
  invalid: PALETTE.gray,
  no_route: PALETTE.gray,
};

export function routeColor(status: string): string {
  return ROUTE_COLORS[status] ?? PALETTE.gray;
}

export const CAMERA_STATUS_COLORS: Record<string, string> = {
  idle: '#5f7a99',
  analyzing: '#67e8f9',
  analyzed: PALETTE.cyan,
  pending_recheck: PALETTE.caution,
  fault: '#94a3b8',
};

export function cameraStatusColor(status: string | undefined): string {
  return CAMERA_STATUS_COLORS[status ?? 'idle'] ?? '#5f7a99';
}

/** Observation status -> accent colour for the twin outline / chips. */
export function observedColor(observed: string): string {
  const o = observed.toLowerCase();
  if (o.startsWith('unobserved')) return PALETTE.gray;
  if (o.includes('fleeing') || o.includes('rapid')) return PALETTE.threat;
  if (o.includes('congested')) return PALETTE.caution;
  if (o.includes('clear') || o.includes('calm')) return PALETTE.clear;
  return PALETTE.gray;
}

export const PHASE_STYLES: Record<string, { fg: string; bg: string; border: string }> = {
  PERCEIVE: { fg: '#7dd3fc', bg: 'rgba(56,189,248,0.12)', border: 'rgba(56,189,248,0.38)' },
  DECIDE: { fg: '#c4b5fd', bg: 'rgba(139,92,246,0.12)', border: 'rgba(139,92,246,0.38)' },
  VALIDATE: { fg: '#5eead4', bg: 'rgba(45,212,191,0.10)', border: 'rgba(45,212,191,0.36)' },
  ACT: { fg: '#fcd34d', bg: 'rgba(245,158,11,0.10)', border: 'rgba(245,158,11,0.36)' },
  REVIEW: { fg: '#fdba74', bg: 'rgba(251,146,60,0.10)', border: 'rgba(251,146,60,0.36)' },
  ARCHIVE: { fg: '#a5b4c8', bg: 'rgba(148,163,184,0.10)', border: 'rgba(148,163,184,0.30)' },
  ERROR: { fg: '#fca5a5', bg: 'rgba(239,68,68,0.14)', border: 'rgba(239,68,68,0.45)' },
  INITIALIZING: { fg: '#a5b4c8', bg: 'rgba(148,163,184,0.10)', border: 'rgba(148,163,184,0.30)' },
};

export function phaseStyle(phase: string) {
  return PHASE_STYLES[phase] ?? PHASE_STYLES.ARCHIVE;
}
