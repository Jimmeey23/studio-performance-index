import { useEffect, useRef, useState } from 'react';
import clsx from 'clsx';
import { ArrowUp, Square, CalendarRange, MapPin, GitCompare, Cpu, LayoutTemplate, X, Clock3, ChevronDown, Check } from 'lucide-react';
import type { Controls } from '../lib/types';
import { useCatalog } from '../lib/catalog';
import { TEMPLATES, TEMPLATE_CATEGORIES } from '../lib/templates';

const iso = (d: Date) => new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
export function periodPresets() {
  const t = new Date();
  const y = t.getFullYear(), m = t.getMonth();
  const mStart = (yy: number, mm: number) => iso(new Date(yy, mm, 1));
  const mEnd = (yy: number, mm: number) => iso(new Date(yy, mm + 1, 0));
  const fyStartYear = m >= 3 ? y : y - 1;
  return [
    { id: 'default', label: 'Default period', start: undefined, end: undefined },
    { id: 'mtd', label: 'Month to date', start: mStart(y, m), end: iso(t) },
    { id: 'lm', label: 'Last month', start: mStart(y, m - 1), end: mEnd(y, m - 1) },
    { id: 'l3', label: 'Last 3 months', start: mStart(y, m - 3), end: mEnd(y, m - 1) },
    { id: 'l6', label: 'Last 6 months', start: mStart(y, m - 6), end: mEnd(y, m - 1) },
    { id: 'l12', label: 'Last 12 months', start: mStart(y, m - 12), end: mEnd(y, m - 1) },
    { id: 'l14', label: 'Last 14 months', start: mStart(y, m - 14), end: mEnd(y, m - 1) },
    { id: 'ytd', label: 'Year to date', start: mStart(y, 0), end: iso(t) },
    { id: 'fy', label: `FY ${fyStartYear}-${String(fyStartYear + 1).slice(2)} to date`, start: mStart(fyStartYear, 3), end: iso(t) },
    { id: 'lfy', label: `FY ${fyStartYear - 1}-${String(fyStartYear).slice(2)}`, start: mStart(fyStartYear - 1, 3), end: mEnd(fyStartYear, 2) },
    { id: 'custom', label: 'Custom…', start: undefined, end: undefined },
  ];
}

function Pop({ icon: Icon, label, active, children, width = 240 }: { icon: typeof MapPin; label: string; active?: boolean; children: (close: () => void) => React.ReactNode; width?: number }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => { const h = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && setOpen(false); document.addEventListener('mousedown', h); return () => document.removeEventListener('mousedown', h); }, []);
  return (
    <div ref={ref} className="relative">
      <button type="button" onClick={() => setOpen((o) => !o)} className={clsx('inline-flex h-7 items-center gap-1.5 rounded-full border px-2.5 text-xs transition', active ? 'border-accent/40 bg-accent-soft text-accent' : 'border-line text-ink-2 hover:bg-surface-2')}>
        <Icon size={13} /><span className="max-w-[160px] truncate">{label}</span><ChevronDown size={11} className="opacity-60" />
      </button>
      {open && <div className="absolute bottom-9 left-0 z-40 rounded-xl border border-line bg-surface p-1.5 shadow-2xl fade-up" style={{ width }}>{children(() => setOpen(false))}</div>}
    </div>
  );
}
const Item = ({ on, children, onClick }: { on?: boolean; children: React.ReactNode; onClick: () => void }) => (
  <button type="button" onClick={onClick} className={clsx('flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-[13px] hover:bg-surface-2', on && 'font-medium text-ink')}>
    <span className="w-3.5">{on && <Check size={13} className="text-accent" />}</span>{children}
  </button>
);

export function Composer({ busy, queue, onSend, onStop, onRemoveQueued, placeholder, controls, setControls, autoFocus }: {
  busy: boolean; queue: string[]; onSend: (q: string) => void; onStop: () => void; onRemoveQueued: (i: number) => void;
  placeholder: string; controls: Controls; setControls: (c: Controls) => void; autoFocus?: boolean;
}) {
  const [input, setInput] = useState('');
  const [periodId, setPeriodId] = useState('default');
  const [tplCat, setTplCat] = useState<string>(TEMPLATE_CATEGORIES[0]);
  const ta = useRef<HTMLTextAreaElement>(null);
  const catalog = useCatalog();
  const locations = ((catalog?.rules?.locations as { location: string; type: string }[] | undefined) ?? []).filter((l) => l.type === 'studio' || l.type === 'partner').map((l) => l.location);
  const presets = periodPresets();

  const send = () => { const q = input.trim(); if (!q) return; onSend(q); setInput(''); if (ta.current) ta.current.style.height = 'auto'; };
  const resize = (el: HTMLTextAreaElement) => { el.style.height = 'auto'; el.style.height = Math.min(240, el.scrollHeight) + 'px'; };
  const tierLabel = { auto: 'Auto model', fast: 'Fast · Haiku', balanced: 'Balanced · Sonnet', deep: 'Deep · Opus' }[controls.tier ?? 'auto'];

  return (
    <div>
      {queue.length > 0 && (
        <div className="mb-2 flex flex-wrap gap-1.5">
          {queue.map((q, i) => (
            <span key={i} className="inline-flex max-w-full items-center gap-1.5 rounded-full border border-line bg-surface px-2.5 py-1 text-xs text-ink-2 fade-up">
              <Clock3 size={12} className="text-accent" /><span className="truncate">Queued: {q}</span>
              <button onClick={() => onRemoveQueued(i)} className="text-ink-3 hover:text-ink"><X size={12} /></button>
            </span>
          ))}
        </div>
      )}
      <div className="glass relative rounded-2xl border border-line shadow-[0_8px_30px_-12px_rgb(0_0_0/0.18)] transition focus-within:border-accent/50">
        <textarea
          ref={ta} value={input} rows={1} autoFocus={autoFocus}
          onChange={(e) => { setInput(e.target.value); resize(e.target); }}
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } }}
          placeholder={busy ? 'Type to queue your next question…' : placeholder}
          className="block max-h-[240px] min-h-[58px] w-full resize-none bg-transparent px-4 pb-2 pt-4 pr-24 text-[15px] outline-none placeholder:text-ink-3"
        />
        <div className="flex flex-wrap items-center gap-1.5 px-3 pb-3">
          <Pop icon={CalendarRange} label={presets.find((p) => p.id === periodId)?.id === 'custom' && controls.period?.start ? `${controls.period.start} → ${controls.period.end ?? ''}` : presets.find((p) => p.id === periodId)!.label} active={periodId !== 'default'} width={250}>
            {(close) => (
              <div>
                {presets.map((p) => <Item key={p.id} on={periodId === p.id} onClick={() => { setPeriodId(p.id); if (p.id !== 'custom') { setControls({ ...controls, period: p.start ? { label: p.label, start: p.start, end: p.end } : undefined }); close(); } }}>{p.label}</Item>)}
                {periodId === 'custom' && (
                  <div className="mt-1 flex gap-1.5 border-t border-line p-2">
                    <input type="date" className="h-8 w-full rounded-md border border-line bg-bg px-1.5 text-xs" value={controls.period?.start ?? ''} onChange={(e) => setControls({ ...controls, period: { label: 'Custom', start: e.target.value, end: controls.period?.end } })} />
                    <input type="date" className="h-8 w-full rounded-md border border-line bg-bg px-1.5 text-xs" value={controls.period?.end ?? ''} onChange={(e) => setControls({ ...controls, period: { label: 'Custom', start: controls.period?.start, end: e.target.value } })} />
                  </div>
                )}
              </div>
            )}
          </Pop>
          <Pop icon={MapPin} label={controls.locations?.length ? (controls.locations.length === 1 ? controls.locations[0] : `${controls.locations.length} locations`) : 'All locations'} active={!!controls.locations?.length} width={270}>
            {() => (
              <div>
                <Item on={!controls.locations?.length} onClick={() => setControls({ ...controls, locations: [] })}>All locations</Item>
                {locations.map((l) => {
                  const on = controls.locations?.includes(l);
                  return <Item key={l} on={on} onClick={() => setControls({ ...controls, locations: on ? controls.locations!.filter((x) => x !== l) : [...(controls.locations ?? []), l] })}>{l}</Item>;
                })}
              </div>
            )}
          </Pop>
          <Pop icon={GitCompare} label={controls.compare === 'previous_year' ? 'vs last year' : controls.compare === 'previous_period' ? 'vs previous period' : 'No comparison'} active={!!controls.compare}>
            {(close) => (
              <div>
                {[[null, 'No comparison'], ['previous_year', 'vs same period last year'], ['previous_period', 'vs previous period']].map(([v, l]) => (
                  <Item key={String(v)} on={(controls.compare ?? null) === v} onClick={() => { setControls({ ...controls, compare: v as Controls['compare'] }); close(); }}>{l}</Item>
                ))}
              </div>
            )}
          </Pop>
          <Pop icon={Cpu} label={tierLabel} active={(controls.tier ?? 'auto') !== 'auto'} width={280}>
            {(close) => (
              <div>
                {([['auto', 'Auto (recommended)', 'Cheapest model that can do it; Opus only for complex reasoning'], ['fast', 'Fast · Haiku', 'Lookups & quick refinements'], ['balanced', 'Balanced · Sonnet', 'Most analysis'], ['deep', 'Deep · Opus', 'Complex diagnosis, forecasts, strategy']] as const).map(([v, l, d]) => (
                  <Item key={v} on={(controls.tier ?? 'auto') === v} onClick={() => { setControls({ ...controls, tier: v }); close(); }}><span>{l}<span className="block text-[11px] font-normal text-ink-3">{d}</span></span></Item>
                ))}
              </div>
            )}
          </Pop>
          <Pop icon={LayoutTemplate} label="Templates" width={440}>
            {(close) => (
              <div className="flex max-h-[360px] gap-2">
                <div className="w-36 shrink-0 space-y-0.5 border-r border-line pr-1.5">
                  {TEMPLATE_CATEGORIES.map((c) => <button key={c} onClick={() => setTplCat(c)} className={clsx('block w-full rounded-md px-2 py-1.5 text-left text-xs', tplCat === c ? 'bg-surface-2 font-medium' : 'text-ink-2 hover:bg-surface-2')}>{c}</button>)}
                </div>
                <div className="min-w-0 flex-1 space-y-1 overflow-auto">
                  {TEMPLATES.filter((t) => t.category === tplCat).map((t) => (
                    <button key={t.title} onClick={() => { setInput(t.prompt); close(); setTimeout(() => { ta.current?.focus(); if (ta.current) resize(ta.current); }, 0); }} className="block w-full rounded-lg px-2.5 py-2 text-left hover:bg-surface-2">
                      <div className="text-[13px] font-medium">{t.title}</div>
                      <div className="line-clamp-2 text-[11px] text-ink-3">{t.prompt}</div>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </Pop>
        </div>
        <div className="absolute right-3 top-3 flex gap-1.5">
          {busy && <button onClick={onStop} className="flex h-9 w-9 items-center justify-center rounded-xl bg-surface-2 text-ink" title="Stop current answer"><Square size={13} /></button>}
          <button onClick={send} disabled={!input.trim()} className="flex h-9 w-9 items-center justify-center rounded-xl bg-ink text-bg transition disabled:opacity-25" title={busy ? 'Queue' : 'Send'}>{busy ? <Clock3 size={16} /> : <ArrowUp size={17} />}</button>
        </div>
      </div>
    </div>
  );
}
