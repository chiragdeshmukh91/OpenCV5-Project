import { Activity } from 'lucide-react';
import type { Building, RunState } from '../types';
import { Bar, Chip, Empty, Panel } from './ui';
import { num, pct } from '../lib/format';
import { PALETTE, threatColor } from '../lib/colors';

export function Sparkline({ values, width = 132, height = 36 }: { values: number[]; width?: number; height?: number }) {
  if (values.length === 0) return <svg width={width} height={height} />;
  const pts = values.length === 1 ? [values[0], values[0]] : values;
  const step = width / (pts.length - 1);
  const y = (v: number) => height - 3 - v * (height - 6);
  const d = pts.map((v, i) => `${i === 0 ? 'M' : 'L'}${(i * step).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
  const area = `${d} L${width},${height} L0,${height} Z`;
  const last = pts[pts.length - 1];
  return (
    <svg width={width} height={height} className="overflow-visible" role="img" aria-label="P(threat) history">
      <line x1={0} x2={width} y1={y(0.5)} y2={y(0.5)} stroke="#2a3542" strokeDasharray="2 3" />
      <path d={area} fill="rgba(194,85,90,0.12)" />
      <path d={d} fill="none" stroke={PALETTE.threat} strokeWidth={1.6} strokeLinejoin="round" />
      <circle cx={width} cy={y(last)} r={2.5} fill={PALETTE.threat} />
    </svg>
  );
}

export function ThreatPanel({ run, building }: { run: RunState | null; building: Building | null }) {
  const b = run?.belief;
  const names = new Map((building?.zones ?? []).map((z) => [z.id, z.name]));
  const top = b
    ? Object.entries(b.zones)
        .sort((a, c) => c[1] - a[1])
        .slice(0, 5)
    : [];
  const maxP = top.length ? top[0][1] : 0;
  return (
    <Panel title="Threat assessment" icon={<Activity size={13} />} right={b ? <Chip tone={b.localized ? 'threat' : 'muted'}>{b.localized ? 'localised' : 'not localised'}</Chip> : null}>
      {!b ? (
        <Empty>The Bayesian threat-location belief appears once the agent receives the simulated report.</Empty>
      ) : (
        <div className="space-y-3 p-3">
          <div className="flex items-end gap-3">
            <div>
              <div className="label">P(active threat)</div>
              <div className="tnum text-[34px] font-semibold leading-none tracking-tight text-[#e3888c]">{pct(b.p_threat, 0)}</div>
              <div className="tnum mt-1 text-[11px] text-ink-400">P(no threat) {pct(b.p_none, 1)}</div>
            </div>
            <div className="ml-auto flex flex-col items-end">
              <Sparkline values={(run?.belief_history ?? []).map((h) => h.p_threat)} />
              <div className="tnum mt-0.5 text-[10px] text-ink-500">P(threat) over {run?.belief_history.length ?? 0} belief updates</div>
            </div>
          </div>
          <div className="grid grid-cols-3 gap-2 rounded-md border border-ink-700 bg-ink-850 p-2">
            <div className="min-w-0">
              <div className="label">Region</div>
              <div className="truncate font-mono text-[11.5px] text-ink-100" title={b.region.join(', ')}>
                {b.region.join(', ')}
              </div>
              <div className="tnum text-[10.5px] text-ink-400">mass {pct(b.region_mass)}</div>
            </div>
            <div>
              <div className="label">Entropy</div>
              <div className="tnum text-[13px] font-semibold text-ink-100">{num(b.entropy)}</div>
              <div className="text-[10.5px] text-ink-400">normalised</div>
            </div>
            <div>
              <div className="label">Supporting</div>
              <div className="tnum text-[13px] font-semibold text-ink-100">{b.supporting_observations}</div>
              <div className="text-[10.5px] text-ink-400">visual obs.</div>
            </div>
          </div>
          <div>
            <div className="label mb-1">Most probable zones</div>
            <div className="space-y-1">
              {top.map(([z, p]) => (
                <div key={z} className="grid grid-cols-[46px_1fr_48px] items-center gap-2 text-[11px]">
                  <span className="truncate font-mono text-ink-200" title={names.get(z)}>
                    {z}
                  </span>
                  <Bar value={maxP > 0 ? p / maxP : 0} color={threatColor(p, maxP)} />
                  <span className="tnum text-right text-ink-300">{pct(p, 1)}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </Panel>
  );
}
