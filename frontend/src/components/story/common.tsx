import type { ReactNode } from 'react';
import { DoorOpen, Hand, Lock, Megaphone, Phone, Radio, ShieldCheck, Siren, Umbrella } from 'lucide-react';
import type { Building, FootageClip } from '../../types';
import { CATEGORY_META, clipCategory, PROCEDURE_SHORT, TRIGGER_LABEL, type ClipCategory, type TriggerKind } from '../../lib/story';
import { cx } from '../ui';

export function ProcIcon({ id, size = 16, className }: { id: string; size?: number; className?: string }) {
  const p = { size, className };
  switch (id) {
    case 'HOLD':
      return <Hand {...p} />;
    case 'SECURE':
      return <ShieldCheck {...p} />;
    case 'LOCKDOWN':
      return <Lock {...p} />;
    case 'LOCKDOWN_PLUS_EVACUATE':
      return (
        <span className={cx('relative inline-flex', className)} style={{ width: size * 1.35, height: size }}>
          <Lock size={size * 0.85} className="absolute left-0 top-0" />
          <DoorOpen size={size * 0.85} className="absolute bottom-0 right-0" />
        </span>
      );
    case 'EVACUATE':
      return <DoorOpen {...p} />;
    case 'SHELTER':
      return <Umbrella {...p} />;
    default:
      return <ShieldCheck {...p} />;
  }
}

export function ProcBadge({ id, tone = 'accent', className }: { id: string; tone?: 'accent' | 'clear' | 'muted' | 'threat'; className?: string }) {
  const tones = {
    accent: 'border-accent/50 bg-accent/15 text-accent-bright',
    clear: 'border-clear/50 bg-clear-dim/80 text-clear-bright',
    muted: 'border-white/10 bg-white/5 text-ink-300',
    threat: 'border-threat/50 bg-threat-dim/80 text-threat-bright',
  };
  return (
    <span className={cx('inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border px-2.5 py-1 text-[11.5px] font-semibold backdrop-blur', tones[tone], className)}>
      <ProcIcon id={id} size={13} />
      {PROCEDURE_SHORT[id] ?? id}
    </span>
  );
}

export function TriggerIcon({ kind, size = 14 }: { kind: TriggerKind; size?: number }) {
  if (kind === '911') return <Siren size={size} />;
  if (kind === 'tip') return <Phone size={size} />;
  if (kind === 'radio') return <Radio size={size} />;
  return <Megaphone size={size} />;
}

export function TriggerChip({ kind, className }: { kind: TriggerKind; className?: string }) {
  return (
    <span className={cx('inline-flex items-center gap-1.5 rounded-full border border-white/15 bg-black/55 px-2.5 py-1 text-[11px] font-medium text-ink-100 backdrop-blur', className)}>
      <TriggerIcon kind={kind} size={12} />
      {TRIGGER_LABEL[kind]}
    </span>
  );
}

/** Mini SVG floor plan from /api/building, highlighting zones. */
export function PlanThumb({
  b,
  hot = [],
  ring = [],
  className,
  label,
}: {
  b: Building;
  hot?: string[];
  ring?: string[];
  className?: string;
  label?: string;
}) {
  const [x0, y0, x1, y1] = b.bounds;
  const hotS = new Set(hot);
  const ringS = new Set(ring);
  return (
    <svg viewBox={`${x0 - 2} ${-y1 - 2} ${x1 - x0 + 4} ${y1 - y0 + 4}`} className={className} role="img" aria-label={label ?? 'Floor plan'}>
      {b.zones.map((z) => (
        <polygon
          key={z.id}
          points={z.polygon.map(([x, y]) => `${x},${-y}`).join(' ')}
          fill={hotS.has(z.id) ? '#ef4444' : ringS.has(z.id) ? 'rgba(239,68,68,0.18)' : z.kind === 'corridor' ? '#16304d' : '#0f2238'}
          stroke={hotS.has(z.id) ? '#fecaca' : ringS.has(z.id) ? '#f87171' : '#2d6f8f'}
          strokeWidth={hotS.has(z.id) ? 0.8 : 0.45}
          strokeDasharray={ringS.has(z.id) && !hotS.has(z.id) ? '1.5 1' : undefined}
        >
          <title>{z.id}</title>
        </polygon>
      ))}
      {b.exits.map((e) => (
        <circle key={e.id} cx={e.position[0]} cy={-e.position[1]} r={1.1} fill="#2dd4bf" />
      ))}
    </svg>
  );
}

/** Seven tiny camera tiles coloured by the behaviour category of their clip. */
export function CamTiles({
  cameras,
  clipsOf,
  clips,
  highlight,
}: {
  cameras: { id: string; name: string }[];
  clipsOf: Record<string, string>;
  clips: Record<string, FootageClip>;
  highlight?: string | null;
}) {
  return (
    <div className="flex gap-1" role="list" aria-label="Camera inputs by behaviour">
      {cameras.map((c) => {
        const cat: ClipCategory = clipCategory(clips[clipsOf[c.id]]);
        const m = CATEGORY_META[cat];
        return (
          <span
            key={c.id}
            role="listitem"
            title={`${c.id} · ${c.name}: ${clipsOf[c.id] ?? 'no clip'} (${m.label})`}
            className={cx('flex h-7 flex-1 flex-col items-center justify-center rounded-md border text-[8.5px] font-semibold', highlight === c.id ? 'border-white/60' : 'border-transparent')}
            style={{ background: `${m.color}26`, boxShadow: `inset 0 -2px 0 ${m.color}` }}
          >
            <span className="font-mono text-ink-100">{c.id.replace('CAM-', 'C')}</span>
          </span>
        );
      })}
    </div>
  );
}

export function CategoryLegend({ cats }: { cats: ClipCategory[] }) {
  return (
    <div className="flex flex-wrap gap-x-3 gap-y-1 text-[10.5px] text-ink-300">
      {cats.map((c) => (
        <span key={c} className="flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-sm" style={{ background: CATEGORY_META[c].color }} />
          {CATEGORY_META[c].label}
        </span>
      ))}
    </div>
  );
}

/** Semicircle gauge 0..1. */
export function Gauge({ value, label, sub, color }: { value: number; label: ReactNode; sub?: ReactNode; color: string }) {
  const v = Math.max(0, Math.min(1, value));
  const r = 34;
  const c = Math.PI * r;
  return (
    <div className="flex flex-col items-center">
      <svg width="88" height="52" viewBox="0 0 88 52" role="img" aria-label={`${Math.round(v * 100)} percent`}>
        <path d="M10 46 A34 34 0 0 1 78 46" fill="none" stroke="rgba(148,170,196,0.15)" strokeWidth="7" strokeLinecap="round" />
        <path
          d="M10 46 A34 34 0 0 1 78 46"
          fill="none"
          stroke={color}
          strokeWidth="7"
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={c * (1 - v)}
          style={{ transition: 'stroke-dashoffset 700ms ease', filter: `drop-shadow(0 0 4px ${color})` }}
        />
      </svg>
      <div className="-mt-4 text-[15px] font-bold text-ink-100">{label}</div>
      {sub && <div className="text-[10px] text-ink-400">{sub}</div>}
    </div>
  );
}

export function Stat({ icon, value, label, tone }: { icon: ReactNode; value: ReactNode; label: string; tone?: string }) {
  return (
    <div className="flex items-center gap-2" title={label}>
      <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-white/5 text-accent">{icon}</span>
      <div className="leading-tight">
        <div className={cx('tnum text-[14px] font-semibold', tone ?? 'text-ink-100')}>{value}</div>
        <div className="text-[9.5px] uppercase tracking-wider text-ink-400">{label}</div>
      </div>
    </div>
  );
}

export function GlassCard({ children, className, ...rest }: { children: ReactNode; className?: string } & React.HTMLAttributes<HTMLElement>) {
  return (
    <section
      {...rest}
      className={cx('fade-in rounded-2xl border border-accent/15 bg-[rgba(6,16,30,0.7)] shadow-[0_18px_48px_-20px_rgba(0,0,0,0.9),inset_0_1px_0_rgba(148,197,255,0.05)] backdrop-blur-xl', className)}
    >
      {children}
    </section>
  );
}

export function SectionHead({ icon, title, right }: { icon: ReactNode; title: string; right?: ReactNode }) {
  return (
    <header className="flex items-center gap-2 px-4 pt-3.5 pb-2">
      <span className="text-accent">{icon}</span>
      <h2 className="text-[13.5px] font-semibold text-ink-100">{title}</h2>
      {right && <div className="ml-auto flex items-center gap-2">{right}</div>}
    </header>
  );
}
