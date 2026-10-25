import type { ReactNode } from 'react';

export function cx(...c: (string | false | null | undefined)[]): string {
  return c.filter(Boolean).join(' ');
}

export function Panel({
  title,
  icon,
  right,
  children,
  className,
  bodyClassName,
}: {
  title: ReactNode;
  icon?: ReactNode;
  right?: ReactNode;
  children: ReactNode;
  className?: string;
  bodyClassName?: string;
}) {
  return (
    <section className={cx('panel flex min-h-0 flex-col', className)}>
      <header className="panel-header">
        {icon && <span className="text-accent">{icon}</span>}
        <span className="truncate">{title}</span>
        {right && <span className="ml-auto flex items-center gap-2 normal-case tracking-normal">{right}</span>}
      </header>
      <div className={cx('min-h-0', bodyClassName)}>{children}</div>
    </section>
  );
}

export type Tone = 'neutral' | 'clear' | 'caution' | 'threat' | 'info' | 'muted';

const TONES: Record<Tone, string> = {
  neutral: 'border-ink-600 bg-ink-800 text-ink-200',
  clear: 'border-clear/40 bg-clear-dim/70 text-clear-bright',
  caution: 'border-caution/40 bg-caution-dim/70 text-caution-bright',
  threat: 'border-threat/50 bg-threat-dim/70 text-threat-bright',
  info: 'border-info/40 bg-info-dim/70 text-info-bright',
  muted: 'border-ink-700 bg-ink-850 text-ink-300',
};

export function Chip({
  tone = 'neutral',
  children,
  className,
  title,
  dot,
}: {
  tone?: Tone;
  children: ReactNode;
  className?: string;
  title?: string;
  dot?: boolean;
}) {
  return (
    <span
      title={title}
      className={cx(
        'inline-flex items-center gap-1 whitespace-nowrap rounded border px-1.5 py-[1px] text-[10.5px] font-medium leading-4',
        TONES[tone],
        className,
      )}
    >
      {dot && <span className="h-1.5 w-1.5 rounded-full bg-current opacity-90" />}
      {children}
    </span>
  );
}

export function Stat({
  label,
  value,
  sub,
  tone,
  className,
}: {
  label: ReactNode;
  value: ReactNode;
  sub?: ReactNode;
  tone?: 'threat' | 'clear' | 'caution';
  className?: string;
}) {
  const color = tone === 'threat' ? 'text-threat-bright' : tone === 'clear' ? 'text-clear-bright' : tone === 'caution' ? 'text-caution-bright' : 'text-ink-100';
  return (
    <div className={cx('min-w-0', className)}>
      <div className="label truncate">{label}</div>
      <div className={cx('tnum truncate text-[13px] font-semibold', color)}>{value}</div>
      {sub && <div className="tnum truncate text-[10.5px] text-ink-400">{sub}</div>}
    </div>
  );
}

export function Bar({ value, color, className }: { value: number; color: string; className?: string }) {
  const w = Math.max(0, Math.min(1, value)) * 100;
  return (
    <div className={cx('h-1.5 w-full overflow-hidden rounded-full bg-ink-700/70', className)}>
      <div className="h-full rounded-full transition-[width] duration-500 ease-out" style={{ width: `${w}%`, background: color, boxShadow: `0 0 8px ${color}` }} />
    </div>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="px-3 py-4 text-[12px] leading-relaxed text-ink-400">{children}</div>;
}
