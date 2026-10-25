// Colour logic for the dashboard. Pure functions so they can be unit-tested.

export const PALETTE = {
  neutral: '#1f2a36', // zone fill with no threat mass
  threat: '#c2555a', // muted red, used only for threat probability / alerts
  caution: '#d6a243',
  clear: '#3fb39a',
  info: '#6b9bd1',
  gray: '#6b7685',
  outline: '#3a4757',
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
export function threatIntensity(p: number, maxP: number, floor = 0.1): number {
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
  idle: '#5b6879',
  analyzing: PALETTE.info,
  analyzed: PALETTE.clear,
  pending_recheck: PALETTE.caution,
  fault: '#8a94a3',
};

export function cameraStatusColor(status: string | undefined): string {
  return CAMERA_STATUS_COLORS[status ?? 'idle'] ?? '#5b6879';
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
  PERCEIVE: { fg: '#8fb8e6', bg: 'rgba(107,155,209,0.12)', border: 'rgba(107,155,209,0.35)' },
  DECIDE: { fg: '#b6a6e0', bg: 'rgba(150,130,210,0.12)', border: 'rgba(150,130,210,0.35)' },
  VALIDATE: { fg: '#7fc8bb', bg: 'rgba(63,179,154,0.10)', border: 'rgba(63,179,154,0.32)' },
  ACT: { fg: '#d9b77a', bg: 'rgba(214,162,67,0.10)', border: 'rgba(214,162,67,0.32)' },
  REVIEW: { fg: '#e2c9a0', bg: 'rgba(226,201,160,0.10)', border: 'rgba(226,201,160,0.32)' },
  ARCHIVE: { fg: '#a3adba', bg: 'rgba(163,173,186,0.10)', border: 'rgba(163,173,186,0.30)' },
  ERROR: { fg: '#e08a8e', bg: 'rgba(194,85,90,0.14)', border: 'rgba(194,85,90,0.40)' },
  INITIALIZING: { fg: '#a3adba', bg: 'rgba(163,173,186,0.10)', border: 'rgba(163,173,186,0.30)' },
};

export function phaseStyle(phase: string) {
  return PHASE_STYLES[phase] ?? PHASE_STYLES.ARCHIVE;
}
