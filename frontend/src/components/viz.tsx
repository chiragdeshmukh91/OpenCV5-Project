import { useId, type ReactNode } from 'react';
import type { Tone } from '../lib/derive';
import { cx } from './ui';

export const TONE_HEX: Record<Tone, string> = {
  threat: '#ef4444',
  caution: '#f59e0b',
  clear: '#2dd4bf',
  info: '#38bdf8',
  muted: '#6782a3',
};

export const TONE_TEXT: Record<Tone, string> = {
  threat: 'text-threat-bright',
  caution: 'text-caution-bright',
  clear: 'text-clear-bright',
  info: 'text-info-bright',
  muted: 'text-ink-300',
};

/** Circular progress ring with a soft glow; animates when the value changes. */
export function Ring({
  value,
  tone,
  size = 64,
  stroke = 6,
  label,
  className,
}: {
  value: number | null;
  tone: Tone;
  size?: number;
  stroke?: number;
  label?: ReactNode;
  className?: string;
}) {
  const id = useId().replace(/:/g, '');
  const r = (size - stroke) / 2 - 2;
  const c = 2 * Math.PI * r;
  const v = value == null ? 0 : Math.max(0, Math.min(1, value));
  const color = TONE_HEX[tone];
  return (
    <div className={cx('relative shrink-0', className)} style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img" aria-label={value == null ? 'no value' : `${Math.round(v * 100)} percent`}>
        <defs>
          <filter id={`g${id}`} x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur stdDeviation="2.2" result="b" />
            <feMerge>
              <feMergeNode in="b" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="rgba(148,170,196,0.14)" strokeWidth={stroke} />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={color}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={c * (1 - v)}
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
          filter={`url(#g${id})`}
          style={{ transition: 'stroke-dashoffset 700ms cubic-bezier(.2,.8,.2,1), stroke 400ms' }}
        />
      </svg>
      <div className="absolute inset-0 flex items-center justify-center">
        {label ?? <span className="tnum text-[15px] font-bold text-ink-100">{value == null ? '—' : `${Math.round(v * 100)}%`}</span>}
      </div>
    </div>
  );
}

/** Area sparkline (0..1 domain) with a glowing end marker. */
export function Sparkline({
  values,
  width = 140,
  height = 40,
  color = '#ef4444',
  showLast = false,
  ariaLabel = 'trend',
}: {
  values: number[];
  width?: number;
  height?: number;
  color?: string;
  showLast?: boolean;
  ariaLabel?: string;
}) {
  const id = useId().replace(/:/g, '');
  if (values.length === 0) {
    return (
      <svg width={width} height={height} aria-label={`${ariaLabel}: no data`}>
        <line x1={0} x2={width} y1={height - 4} y2={height - 4} stroke="rgba(148,170,196,0.18)" strokeDasharray="3 4" />
      </svg>
    );
  }
  const pts = values.length === 1 ? [values[0], values[0]] : values;
  const step = width / (pts.length - 1);
  const y = (v: number) => height - 4 - Math.max(0, Math.min(1, v)) * (height - 10);
  const d = pts.map((v, i) => `${i === 0 ? 'M' : 'L'}${(i * step).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
  const last = pts[pts.length - 1];
  return (
    <svg width={width} height={height} className="overflow-visible" role="img" aria-label={ariaLabel}>
      <defs>
        <linearGradient id={`f${id}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.32" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <line x1={0} x2={width} y1={y(0.5)} y2={y(0.5)} stroke="rgba(148,170,196,0.12)" strokeDasharray="2 4" />
      <path d={`${d} L${width},${height} L0,${height} Z`} fill={`url(#f${id})`} />
      <path d={d} fill="none" stroke={color} strokeWidth={1.8} strokeLinejoin="round" style={{ filter: `drop-shadow(0 0 3px ${color})` }} />
      <circle cx={width} cy={y(last)} r={2.8} fill={color} style={{ filter: `drop-shadow(0 0 4px ${color})` }} />
      {showLast && (
        <text x={width + 4} y={y(last) + 3} fill={color} fontSize="9.5" fontWeight={600}>
          {Math.round(last * 100)}%
        </text>
      )}
    </svg>
  );
}

const TAG_TONES: Record<string, string> = {
  Vision: 'border-info/40 bg-info-dim/70 text-info-bright',
  Analysis: 'border-clear/40 bg-clear-dim/70 text-clear-bright',
  Corroboration: 'border-accent/40 bg-accent-dim/70 text-accent-bright',
  Assessment: 'border-[#8b5cf6]/40 bg-[#1e1640]/70 text-[#c4b5fd]',
  Decision: 'border-[#8b5cf6]/40 bg-[#1e1640]/70 text-[#c4b5fd]',
  Recommendation: 'border-info/40 bg-info-dim/70 text-info-bright',
  Validation: 'border-clear/40 bg-clear-dim/70 text-clear-bright',
  Review: 'border-caution/40 bg-caution-dim/70 text-caution-bright',
  Report: 'border-ink-500 bg-ink-800 text-ink-200',
};

export function StageTag({ children }: { children: string }) {
  return <span className={cx('tag', TAG_TONES[children] ?? 'border-ink-500 bg-ink-800 text-ink-200')}>{children}</span>;
}

export function ZoneTag({ children, tone = 'muted' }: { children: ReactNode; tone?: Tone }) {
  return (
    <span
      className={cx(
        'tag font-mono',
        tone === 'threat' ? 'border-threat/50 bg-threat-dim/70 text-threat-bright' : 'border-ink-500/80 bg-ink-800/80 text-ink-200',
      )}
    >
      {children}
    </span>
  );
}

export function Dot({ tone, pulse }: { tone: Tone; pulse?: boolean }) {
  return (
    <span className="relative inline-flex h-2 w-2 shrink-0">
      {pulse && <span className="ping-ring absolute inset-0 rounded-full" style={{ background: TONE_HEX[tone] }} />}
      <span className="relative inline-flex h-2 w-2 rounded-full" style={{ background: TONE_HEX[tone], boxShadow: `0 0 6px ${TONE_HEX[tone]}` }} />
    </span>
  );
}
