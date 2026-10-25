import { Check, Route as RouteIcon, X } from 'lucide-react';
import type { Routing } from '../types';
import { Chip, Empty, Panel, type Tone } from './ui';
import { pct } from '../lib/format';

const STATUS_TONE: Record<string, Tone> = {
  verified_clear: 'clear',
  unverified: 'caution',
  congested: 'caution',
  exposed: 'threat',
  invalid: 'muted',
  no_route: 'muted',
};

export function RoutesTable({ routing }: { routing: Routing | null | undefined }) {
  if (!routing) {
    return (
      <Panel title="Evacuation routes" icon={<RouteIcon size={13} />}>
        <Empty>Routes are computed on the building graph once evidence gathering stops.</Empty>
      </Panel>
    );
  }
  const nValid = routing.routes.filter((r) => r.math_valid).length;
  const nSafe = routing.routes.filter((r) => r.safe).length;
  return (
    <Panel
      title="Evacuation routes"
      icon={<RouteIcon size={13} />}
      right={
        <span className="tnum font-mono text-[10.5px] text-ink-400">
          {nValid}/{routing.routes.length} valid · {nSafe} safe
        </span>
      }
    >
      <div className="overflow-x-auto scroll-thin">
        <table className="w-full min-w-[360px] border-collapse text-[11px]">
          <thead>
            <tr className="border-b border-ink-700 text-left text-[9.5px] uppercase tracking-[0.08em] text-ink-400">
              <th className="px-3 py-1.5 font-medium">From → exit</th>
              <th className="px-1 py-1.5 font-medium">Len</th>
              <th className="px-1 py-1.5 font-medium" title="Graph constraints: connected, avoids exclusion, door widths, travel distance">
                Math valid
              </th>
              <th className="px-1 py-1.5 font-medium" title="Camera-verified operational safety">
                Operationally safe
              </th>
              <th className="px-1 py-1.5 text-right font-medium">Exp.</th>
              <th className="py-1.5 pl-1 pr-3 text-right font-medium">Verif.</th>
            </tr>
          </thead>
          <tbody>
            {routing.routes.map((r) => {
              const failed = Object.entries(r.math_checks)
                .filter(([, v]) => !v)
                .map(([k]) => k.replace(/_/g, ' '));
              return (
                <tr key={r.id} className="border-b border-ink-750/70 align-top last:border-0 hover:bg-ink-850">
                  <td className="px-3 py-1.5">
                    <div className="font-mono text-ink-100">
                      {r.from} <span className="text-ink-500">→</span> {r.exit ?? '—'}
                    </div>
                    <div className="truncate font-mono text-[9.5px] text-ink-500" title={r.path.join(' > ') || r.reason}>
                      {r.path.length ? r.path.join(' › ') : r.reason}
                    </div>
                  </td>
                  <td className="tnum px-1 py-1.5 text-ink-300">{r.length_m != null ? `${r.length_m}` : '—'}</td>
                  <td className="px-1 py-1.5">
                    <span className="inline-flex items-center gap-1" title={failed.length ? `failed: ${failed.join(', ')}` : 'all graph checks pass'}>
                      {r.math_valid ? <Check size={12} className="text-clear" /> : <X size={12} className="text-[#e3888c]" />}
                      <span className={r.math_valid ? 'text-ink-200' : 'text-[#e3888c]'}>{r.math_valid ? 'valid' : 'invalid'}</span>
                    </span>
                  </td>
                  <td className="px-1 py-1.5">
                    <Chip tone={STATUS_TONE[r.operational_status] ?? 'muted'}>{r.operational_status.replace('_', ' ')}</Chip>
                  </td>
                  <td className="tnum px-1 py-1.5 text-right text-ink-300">{r.operational ? r.operational.hazard_exposure.toFixed(2) : '—'}</td>
                  <td className="tnum py-1.5 pl-1 pr-3 text-right text-ink-300">{r.operational ? pct(r.operational.verified_fraction) : '—'}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {(routing.lockdown_spaces.length > 0 || routing.blocked_exits.length > 0) && (
        <div className="flex flex-wrap gap-x-4 gap-y-1 border-t border-ink-700 px-3 py-2 text-[10.5px] text-ink-400">
          <span>
            Lockdown: <span className="font-mono text-ink-200">{routing.lockdown_spaces.join(', ') || 'none'}</span>
          </span>
          <span>
            Exits unavailable: <span className="font-mono text-[#eba9ac]">{routing.blocked_exits.join(', ') || 'none'}</span>
          </span>
        </div>
      )}
    </Panel>
  );
}
