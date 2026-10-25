import { useState } from 'react';
import { Check, ChevronRight, ListChecks, ShieldAlert, X } from 'lucide-react';
import type { Assessment, ResponseOption } from '../types';
import { Bar, Chip, Empty, Panel, cx } from './ui';
import { PALETTE } from '../lib/colors';
import { humanize } from '../lib/format';

export function optionLabel(id: string): string {
  return id === 'LOCKDOWN_PLUS_EVACUATE' ? 'LOCKDOWN + EVACUATE' : humanize(id);
}

function OptionCard({ o, recommended, defaultOpen }: { o: ResponseOption; recommended: boolean; defaultOpen: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  const passed = o.preconditions.filter((p) => p.pass).length;
  return (
    <div
      data-testid={`option-${o.id}`}
      className={cx(
        'rounded-md border transition-colors',
        recommended ? 'border-clear-soft/70 bg-[#0f1f1c]' : o.feasible ? 'border-ink-700 bg-ink-850' : 'border-ink-750 bg-ink-900',
      )}
    >
      <button type="button" onClick={() => setOpen((x) => !x)} className="flex w-full items-center gap-2 px-2.5 py-2 text-left">
        <ChevronRight size={13} className={cx('shrink-0 text-ink-400 transition-transform', open && 'rotate-90')} />
        <span className={cx('font-mono text-[11.5px] font-semibold', o.feasible ? 'text-ink-100' : 'text-ink-400')}>{optionLabel(o.id)}</span>
        {recommended && <Chip tone="clear">recommended</Chip>}
        {o.rejected_by_reviewer && <Chip tone="threat">rejected by reviewer</Chip>}
        <span className="ml-auto flex items-center gap-2">
          <Chip tone={o.feasible ? 'clear' : 'muted'}>{o.feasible ? 'feasible' : 'not feasible'}</Chip>
          <span className="tnum w-9 text-right text-[11.5px] font-semibold text-ink-100">{o.score.toFixed(2)}</span>
        </span>
      </button>
      <div className="px-2.5 pb-2">
        <Bar value={o.score} color={recommended ? PALETTE.clear : o.feasible ? '#6b9bd1' : '#3a4757'} />
        {!open && (
          <div className="tnum mt-1 text-[10.5px] text-ink-400">
            {passed}/{o.preconditions.length} preconditions pass · raw score {o.raw_score.toFixed(2)}
          </div>
        )}
      </div>
      {open && (
        <div className="space-y-2 border-t border-ink-700/70 px-2.5 py-2 text-[11.5px]">
          <div className="leading-snug text-ink-300">{o.description}</div>
          <div>
            <div className="label mb-1">Preconditions</div>
            <ul className="space-y-1">
              {o.preconditions.map((p) => (
                <li key={p.check} className="flex gap-1.5">
                  {p.pass ? <Check size={13} className="mt-[1px] shrink-0 text-clear" /> : <X size={13} className="mt-[1px] shrink-0 text-[#e3888c]" />}
                  <span>
                    <span className="text-ink-100">{p.check}</span>
                    <span className="block font-mono text-[10.5px] text-ink-400">{p.detail}</span>
                  </span>
                </li>
              ))}
            </ul>
          </div>
          <div>
            <div className="label mb-1">Actions (simulated)</div>
            <ul className="space-y-0.5">
              {o.actions.map((a, i) => (
                <li key={i} className="flex gap-1.5 text-ink-200">
                  <span className="text-ink-500">›</span>
                  <span>{a}</span>
                </li>
              ))}
            </ul>
          </div>
          <div>
            <div className="label mb-1">Risks</div>
            <ul className="space-y-0.5">
              {o.risks.map((r, i) => (
                <li key={i} className="flex gap-1.5 text-[#e6c88f]">
                  <ShieldAlert size={12} className="mt-[2px] shrink-0" />
                  <span>{r}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}
    </div>
  );
}

export function OptionsPanel({ assessment }: { assessment: Assessment | null | undefined }) {
  if (!assessment) {
    return (
      <Panel title="Response options" icon={<ListChecks size={13} />}>
        <Empty>
          Standard Response Protocol procedures (Hold, Secure, Lockdown, Lockdown + Evacuate, Evacuate, Shelter) are evaluated after the
          agent stops gathering evidence.
        </Empty>
      </Panel>
    );
  }
  const sorted = [...assessment.options].sort(
    (a, b) => Number(b.id === assessment.recommended) - Number(a.id === assessment.recommended) || Number(b.feasible) - Number(a.feasible) || b.score - a.score,
  );
  return (
    <Panel
      title="Response options"
      icon={<ListChecks size={13} />}
      right={<span className="font-mono text-[10.5px] text-ink-400">SRP · human approval required</span>}
    >
      <div className="space-y-1.5 p-3">
        {sorted.map((o) => (
          <OptionCard key={o.id} o={o} recommended={o.id === assessment.recommended} defaultOpen={o.id === assessment.recommended} />
        ))}
        {assessment.why_not_full_evacuation.length > 0 && (
          <div className="rounded-md border border-caution-soft/40 bg-caution-dim/40 px-2.5 py-2 text-[11.5px]">
            <div className="label mb-0.5 !text-[#d9b77a]">Why not full evacuation</div>
            <ul className="space-y-0.5 text-ink-200">
              {assessment.why_not_full_evacuation.map((w, i) => (
                <li key={i}>{w}</li>
              ))}
            </ul>
          </div>
        )}
        <div className="rounded-md border border-ink-700 bg-ink-850 px-2.5 py-2 text-[11.5px]">
          <div className="label mb-0.5">Uncertainty</div>
          <ul className="list-disc space-y-0.5 pl-4 leading-snug text-ink-300 marker:text-ink-500">
            {assessment.uncertainty.map((u, i) => (
              <li key={i}>{u}</li>
            ))}
          </ul>
        </div>
      </div>
    </Panel>
  );
}
