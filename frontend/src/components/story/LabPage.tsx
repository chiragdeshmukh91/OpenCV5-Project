import { useRef, useState } from 'react';
import { Camera, ChevronDown, Info, Loader2, Play, RotateCcw, SlidersHorizontal, Target, Upload, VideoOff } from 'lucide-react';
import { api } from '../../api';
import { useApp } from '../../context';
import type { Scenario } from '../../types';
import { CATEGORY_META, clipCategory, heroClip, shortSource, triggerKind, type ClipCategory } from '../../lib/story';
import { cx } from '../ui';
import { CamTiles, CategoryLegend, GlassCard, PlanThumb, ProcBadge, SectionHead, TriggerChip } from './common';

const ALL_CATS: ClipCategory[] = ['flight', 'degraded', 'congested', 'calm', 'empty', 'unknown'];

function ScenarioCard({ s, selected }: { s: Scenario; selected: boolean }) {
  const { building, footage, run, startRun, starting, setScenarioId, overrides } = useApp();
  const [open, setOpen] = useState(false);
  const clips = footage?.clips ?? {};
  const hero = heroClip(s, building, clips);
  const cams = building?.cameras ?? [];
  const current = run?.scenario.id === s.id;
  const kind = triggerKind(s.trigger.source);
  const expected = s.expected?.primary_option;
  const clipsOf = { ...s.cameras, ...(selected ? overrides : {}) };
  return (
    <GlassCard
      aria-label={s.title}
      className={cx('group flex flex-col overflow-hidden transition-all duration-200', selected ? '!border-accent/60 shadow-[0_0_32px_-8px_rgba(34,211,238,0.45)]' : 'hover:!border-accent/35')}
    >
      <button type="button" onClick={() => setScenarioId(s.id)} aria-pressed={selected} aria-label={`Select ${s.title}`} className="relative block aspect-[16/6.6] w-full overflow-hidden text-left">
        {hero && <img src={api.previewUrl(hero.clipId)} alt="" className="absolute inset-0 h-full w-full object-cover transition-transform duration-500 group-hover:scale-[1.03]" />}
        <div className="absolute inset-0 bg-gradient-to-t from-[#040b16] via-[#040b16]/45 to-transparent" />
        {hero?.category === 'degraded' && (
          <div className="absolute inset-0 flex items-center justify-center" aria-hidden>
            <span className="flex h-16 w-16 items-center justify-center rounded-full border border-[#a78bfa]/50 bg-[#a78bfa]/10 text-[#c4b5fd] shadow-[0_0_30px_-6px_rgba(167,139,250,0.7)]">
              <VideoOff size={28} />
            </span>
          </div>
        )}
        <div className="absolute left-3 top-3 flex flex-wrap gap-1.5">
          <TriggerChip kind={kind} />
          {hero && (
            <span className="inline-flex items-center gap-1.5 rounded-full border border-white/15 bg-black/55 px-2.5 py-1 text-[11px] text-ink-100 backdrop-blur">
              <span className="h-2 w-2 rounded-full" style={{ background: CATEGORY_META[hero.category].color, boxShadow: `0 0 6px ${CATEGORY_META[hero.category].color}` }} />
              {hero.cameraId.replace('CAM-', 'C')} · {CATEGORY_META[hero.category].label}
            </span>
          )}
        </div>
        <div className="absolute right-3 top-3 flex flex-col items-end gap-1.5">
          {current && <span className="rounded-full bg-accent px-2 py-[2px] text-[10px] font-bold text-ink-950">CURRENT · {run!.status.replace('_', ' ')}</span>}
          <span className="rounded-full border border-caution/50 bg-black/60 px-2 py-[1px] text-[9.5px] font-bold tracking-[0.14em] text-caution-bright">SYNTHETIC</span>
        </div>
        <div className="absolute bottom-3 left-4 right-4">
          <div className="font-mono text-[10.5px] text-accent-bright">{s.id.split('-')[0]}</div>
          <h3 className="text-[20px] font-semibold leading-tight text-white [text-shadow:0_2px_12px_rgba(0,0,0,0.8)]">{s.title}</h3>
        </div>
      </button>
      <div className="grid grid-cols-[132px_minmax(0,1fr)] gap-4 px-4 pb-3 pt-3">
        {building && (
          <div className="rounded-xl border border-white/5 bg-black/25 p-1.5">
            <PlanThumb b={building} hot={[s.trigger.zone]} ring={s.expected?.threat_region ?? []} className="h-[62px] w-full" label={`Trigger zone ${s.trigger.zone}`} />
            <div className="mt-0.5 flex items-center justify-center gap-1 text-[10px] text-ink-300">
              <Target size={10} className="text-threat" /> <span className="font-mono">{s.trigger.zone}</span>
            </div>
          </div>
        )}
        <div className="flex min-w-0 flex-col justify-between gap-2">
          <div className="flex items-center gap-3">
            <div title="Prior confidence assigned to the simulated report">
              <div className="text-[9.5px] uppercase tracking-wider text-ink-400">Prior</div>
              <div className="tnum text-[18px] font-bold text-ink-100">{Math.round(s.trigger.confidence * 100)}%</div>
            </div>
            <div className="ml-auto text-right" title="Expected outcome">
              <div className="mb-0.5 text-[9.5px] uppercase tracking-wider text-ink-400">Expected</div>
              {expected ? <ProcBadge id={expected} tone="accent" /> : <span className="text-ink-400">—</span>}
            </div>
          </div>
          <CamTiles cameras={cams} clipsOf={clipsOf} clips={clips} highlight={hero?.cameraId} />
        </div>
      </div>
      {open && (
        <div className="fade-in border-t border-white/5 px-4 py-2.5 text-[12px] leading-relaxed text-ink-300">
          <p>{s.summary}</p>
          <p className="mt-1.5 text-ink-400">
            <span className="text-ink-200">{shortSource(s.trigger.source)}:</span> “{s.trigger.claim}”
            {s.expected?.threat_region?.length ? (
              <>
                {' '}
                · expected region <span className="font-mono text-ink-200">{s.expected.threat_region.join(' ')}</span>
              </>
            ) : null}
          </p>
        </div>
      )}
      <div className="mt-auto flex items-center gap-2 border-t border-white/5 px-4 py-3">
        <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} className="flex items-center gap-1 text-[11.5px] text-ink-300 hover:text-ink-100">
          <Info size={13} /> Details <ChevronDown size={12} className={cx('transition-transform', open && 'rotate-180')} />
        </button>
        <button
          type="button"
          className="btn-primary ml-auto px-5 py-2 text-[13px]"
          disabled={starting}
          onClick={() => {
            setScenarioId(s.id);
            void startRun(s.id);
          }}
          aria-label={`Run ${s.title}`}
        >
          {starting && selected ? <Loader2 size={15} className="animate-spin" /> : <Play size={15} />}
          Run
        </button>
      </div>
    </GlassCard>
  );
}

function InputsEditor() {
  const { building, footage, scenarios, scenarioId, overrides, setOverrides, reloadFootage } = useApp();
  const scen = scenarios.find((s) => s.id === scenarioId);
  const clips = footage?.clips ?? {};
  const clipIds = [...Object.keys(clips).sort(), ...(footage?.uploads ?? [])];
  const [assign, setAssign] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const file = useRef<HTMLInputElement>(null);
  const setClip = (cid: string, clip: string) => {
    const next = { ...overrides };
    if (!clip || clip === scen?.cameras[cid]) delete next[cid];
    else next[cid] = clip;
    setOverrides(next);
  };
  const upload = async (f: File) => {
    setBusy(true);
    setMsg(null);
    try {
      const { clip_id } = await api.upload(f);
      reloadFootage();
      if (assign) setClip(assign, clip_id);
      setMsg(`Uploaded ${clip_id}${assign ? ` → ${assign}` : ''}`);
    } catch (e) {
      setMsg(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
      if (file.current) file.current.value = '';
    }
  };
  return (
    <div className="fade-in grid grid-cols-2 gap-3 px-4 pb-4 sm:grid-cols-4 xwide:grid-cols-8">
      {(building?.cameras ?? []).map((c) => {
        const def = scen?.cameras[c.id] ?? '';
        const val = overrides[c.id] ?? def;
        const cat = clipCategory(clips[val]);
        const changed = c.id in overrides;
        return (
          <div key={c.id} className={cx('overflow-hidden rounded-xl border bg-black/30 transition-all', changed ? 'border-accent/70 shadow-glow-cyan' : 'border-white/10')}>
            <div className="relative aspect-[4/3]">
              {val && <img src={api.previewUrl(val)} alt="" loading="lazy" className="h-full w-full object-cover" />}
              <div className="absolute inset-x-0 bottom-0 h-1" style={{ background: CATEGORY_META[cat].color }} />
              <span className="absolute left-1.5 top-1.5 rounded-md bg-black/70 px-1.5 font-mono text-[10px] font-semibold text-white">{c.id.replace('CAM-', 'C')}</span>
              {changed && (
                <button type="button" onClick={() => setClip(c.id, '')} aria-label={`Reset ${c.id} to scenario clip`} title="Reset to scenario clip" className="absolute right-1.5 top-1.5 rounded-md bg-black/70 p-1 text-accent-bright hover:text-white">
                  <RotateCcw size={11} />
                </button>
              )}
            </div>
            <div className="space-y-1 p-1.5">
              <div className="truncate text-[10.5px] text-ink-300">{c.name}</div>
              <select aria-label={`Clip for ${c.id}`} value={val} onChange={(e) => setClip(c.id, e.target.value)} className="input w-full px-1.5 py-1 font-mono text-[10.5px]">
                {clipIds.map((id) => (
                  <option key={id} value={id}>
                    {id}
                    {id === def ? ' ★' : ''}
                  </option>
                ))}
              </select>
            </div>
          </div>
        );
      })}
      <div className="flex flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-accent/30 bg-accent/[0.03] p-3 text-center">
        <Upload size={22} className="text-accent" />
        <div className="text-[11.5px] font-medium text-ink-100">Upload clip</div>
        <select aria-label="Assign upload to camera" value={assign} onChange={(e) => setAssign(e.target.value)} className="input w-full px-1.5 py-1 text-[10.5px]">
          <option value="">don’t assign</option>
          {(building?.cameras ?? []).map((c) => (
            <option key={c.id} value={c.id}>
              → {c.id}
            </option>
          ))}
        </select>
        <input ref={file} type="file" accept="video/*,.avi,.mp4,.mov,.mkv" className="hidden" onChange={(e) => e.target.files?.[0] && void upload(e.target.files[0])} />
        <button type="button" className="btn-ghost w-full py-1 text-[11px]" disabled={busy} onClick={() => file.current?.click()}>
          {busy ? <Loader2 size={12} className="animate-spin" /> : <Upload size={12} />}
          Choose file
        </button>
        {msg && <div className="text-[10px] leading-tight text-ink-300">{msg}</div>}
      </div>
    </div>
  );
}

export function LabPage() {
  const { scenarios, scenarioId, overrides, setOverrides, scenarios: list } = useApp();
  const [inputs, setInputs] = useState(false);
  const scen = list.find((s) => s.id === scenarioId);
  const n = Object.keys(overrides).length;
  return (
    <div className="space-y-4 wide:h-full wide:overflow-y-auto wide:pr-1 scroll-thin">
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2 min-[1800px]:grid-cols-4">
        {scenarios.map((s) => (
          <ScenarioCard key={s.id} s={s} selected={s.id === scenarioId} />
        ))}
      </div>
      <GlassCard aria-label="Camera inputs">
        <SectionHead
          icon={<Camera size={16} />}
          title="Camera inputs"
          right={
            <>
              <span className="hidden text-[11px] text-ink-400 md:inline">for {scen?.title ?? 'selected scenario'}</span>
              {n > 0 && (
                <button type="button" className="flex items-center gap-1 rounded-full bg-accent/15 px-2 py-[2px] text-[10.5px] text-accent-bright" onClick={() => setOverrides({})} title="Reset all overrides">
                  {n} override{n > 1 ? 's' : ''} <RotateCcw size={10} />
                </button>
              )}
              <button type="button" className={cx('btn-ghost py-1', inputs && 'border-accent/60 text-accent-bright')} onClick={() => setInputs((o) => !o)} aria-expanded={inputs}>
                <SlidersHorizontal size={13} /> {inputs ? 'Close' : 'Edit'}
              </button>
            </>
          }
        />
        <div className="px-4 pb-3">
          <CategoryLegend cats={ALL_CATS} />
        </div>
        {inputs && <InputsEditor />}
      </GlassCard>
    </div>
  );
}
