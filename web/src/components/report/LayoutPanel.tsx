import clsx from 'clsx';
import { ArrowDown, ArrowUp, Eye, EyeOff, Palette, RotateCcw, X, LayoutTemplate, Type, Rows3, ListOrdered, PenLine } from 'lucide-react';
import type { ReactNode } from 'react';
import { ACCENTS, currentAccent } from '../../lib/theme';
import { DEFAULT_LAYOUT, type ReportData, type ReportLayout } from '../../lib/report';

const SECTION_NAMES: Record<string, string> = {
  sales: 'Sales', new_clients: 'New clients & conversion', leads: 'Lead & funnel health', trainers: 'Trainer performance', classes: 'Class performance & booking',
  formats: 'Format comparison', churn: 'Lapsed & membership churn', late: 'Late cancellation', studios: 'Studio comparison', associates: 'Sales team performance', clients: 'Client base & engagement', trainer_ranking: 'Trainer rankings — all studios', road: 'Road ahead',
};

function Group({ icon: I, title, children }: { icon: typeof Palette; title: string; children: ReactNode }) {
  return (
    <div className="border-b border-line px-5 py-4">
      <div className="mb-2.5 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wider text-ink-3"><I size={13} className="text-accent" />{title}</div>
      {children}
    </div>
  );
}
function Seg<T extends string | number>({ value, options, onChange }: { value: T; options: [T, string][]; onChange: (v: T) => void }) {
  return <div className="seg flex-wrap">{options.map(([v, l]) => <button key={String(v)} className={clsx(value === v && 'on')} onClick={() => onChange(v)}>{l}</button>)}</div>;
}
function Toggle({ on, label, onChange }: { on: boolean; label: string; onChange: (v: boolean) => void }) {
  return (
    <button onClick={() => onChange(!on)} className="flex w-full items-center justify-between rounded-lg px-1 py-1.5 text-left text-[13px] text-ink-2 hover:text-ink">
      {label}
      <span className={clsx('relative h-5 w-9 rounded-full transition', on ? 'bg-accent' : 'bg-line')}><span className={clsx('absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-all', on ? 'left-[18px]' : 'left-0.5')} /></span>
    </button>
  );
}

/** Restyle and restructure a saved report — pure presentation, never calls the AI. */
export function LayoutPanel({ layout, data, onChange, onClose }: { layout: ReportLayout; data: ReportData; onChange: (l: ReportLayout) => void; onClose: () => void }) {
  const set = (p: Partial<ReportLayout>) => onChange({ ...layout, ...p });
  const present = new Set(data.sections.map((s) => s.id));
  const titleOf = (id: string) => SECTION_NAMES[id] ?? data.sections.find((s) => s.id === id)?.title ?? id;
  const full = [...layout.order, ...data.sections.map((s) => s.id).filter((id) => !layout.order.includes(id))];
  const order = full.filter((id) => present.has(id));
  const move = (id: string, d: -1 | 1) => {
    const o = [...full]; const i = o.indexOf(id);
    // jump over sections this report does not have
    let j = i + d; while (j >= 0 && j < o.length && !present.has(o[j])) j += d;
    if (j < 0 || j >= o.length) return;
    [o[i], o[j]] = [o[j], o[i]]; set({ order: o, autoDesign: false }); // the reader's own order replaces the AI's
  };
  const app = currentAccent();
  return (
    <aside className="pop-in fixed bottom-4 right-4 top-4 z-50 flex w-[360px] flex-col overflow-hidden rounded-3xl border border-line bg-surface shadow-2xl no-print">
      <div className="flex items-center gap-3 border-b border-line px-5 py-4">
        <span className="panel-tile !h-9 !w-9"><LayoutTemplate size={16} /></span>
        <div className="min-w-0 flex-1"><div className="text-sm font-semibold text-ink">Customise report</div><div className="text-[11.5px] text-ink-3">Styling and structure only — no AI tokens used. Saved with this report.</div></div>
        <button onClick={onClose} className="tool"><X size={15} /></button>
      </div>
      <div className="flex-1 overflow-y-auto">
        <Group icon={Palette} title="Colour">
          <Toggle on={layout.autoDesign !== false} label="AI art direction — palette, cover, section order" onChange={(v) => set({ autoDesign: v })} />
          <div className="flex flex-wrap gap-2">
            <button onClick={() => set({ accent: 'app' })} className={clsx('flex h-8 items-center gap-1.5 rounded-full border px-2.5 text-xs', layout.accent === 'app' ? 'border-accent ring-2 ring-accent/30' : 'border-line')}>
              <span className="h-4 w-4 rounded-full" style={{ background: `linear-gradient(135deg, ${app.a}, ${app.b})` }} />App accent
            </button>
            {ACCENTS.map((a) => (
              <button key={a.name} title={a.name} onClick={() => set({ accent: a.name })} className={clsx('h-8 w-8 rounded-full border-2 transition', layout.accent === a.name ? 'scale-110 border-ink' : 'border-transparent')} style={{ background: `linear-gradient(135deg, ${a.a}, ${a.b})` }} />
            ))}
          </div>
          <div className="mt-3 text-[11px] font-medium text-ink-3">Cover</div>
          <div className="mt-1"><Seg value={layout.cover} options={[['gradient', 'Bold gradient'], ['light', 'Light'], ['minimal', 'Minimal']]} onChange={(v) => set({ cover: v })} /></div>
        </Group>
        <Group icon={Type} title="Typography & spacing">
          <div className="text-[11px] font-medium text-ink-3">Headings</div>
          <div className="mt-1"><Seg value={layout.headingFont} options={[['serif', 'Editorial serif'], ['sans', 'Modern sans']]} onChange={(v) => set({ headingFont: v })} /></div>
          <div className="mt-3 text-[11px] font-medium text-ink-3">Spacing</div>
          <div className="mt-1"><Seg value={layout.density} options={[['compact', 'Compact'], ['balanced', 'Balanced'], ['airy', 'Airy']]} onChange={(v) => set({ density: v })} /></div>
        </Group>
        <Group icon={Rows3} title="Content">
          <div className="text-[11px] font-medium text-ink-3">KPI cards per row</div>
          <div className="mt-1"><Seg value={layout.kpiCols} options={[['auto', 'Auto'], [3, '3'], [4, '4']]} onChange={(v) => set({ kpiCols: v })} /></div>
          <div className="mt-3 text-[11px] font-medium text-ink-3">Rows per detail table</div>
          <div className="mt-1"><Seg value={layout.tableRows} options={[[6, '6'], [8, '8'], [10, '10'], [12, '12']]} onChange={(v) => set({ tableRows: v })} /></div>
          <div className="mt-3">
            <Toggle on={layout.cmp.prev} label="Compare with previous period" onChange={(v) => set({ cmp: { ...layout.cmp, prev: v } })} />
            <Toggle on={layout.cmp.ytd} label="Compare with current-year average" onChange={(v) => set({ cmp: { ...layout.cmp, ytd: v } })} />
            <Toggle on={layout.cmp.ly} label="Compare with same period last year" onChange={(v) => set({ cmp: { ...layout.cmp, ly: v } })} />
            <Toggle on={layout.sparklines} label="Sparklines" onChange={(v) => set({ sparklines: v })} />
            <Toggle on={layout.fillers} label="Focus diagrams in spare space" onChange={(v) => set({ fillers: v })} />
            <Toggle on={layout.photos} label="Studio photography (cover & sections)" onChange={(v) => set({ photos: v })} />
          </div>
        </Group>
        <Group icon={ListOrdered} title="Pages & section order">
          <Toggle on={layout.pages.cover} label="Cover page" onChange={(v) => set({ pages: { ...layout.pages, cover: v } })} />
          <Toggle on={layout.pages.exec} label="Executive summary" onChange={(v) => set({ pages: { ...layout.pages, exec: v } })} />
          <Toggle on={layout.pages.score} label="Scorecard" onChange={(v) => set({ pages: { ...layout.pages, score: v } })} />
          <Toggle on={layout.detail} label="Findings & detail page per section" onChange={(v) => set({ detail: v })} />
          <Toggle on={layout.pages.mom} label="Appendix A — month-on-month" onChange={(v) => set({ pages: { ...layout.pages, mom: v } })} />
          <Toggle on={layout.pages.defs} label="Appendix B — definitions" onChange={(v) => set({ pages: { ...layout.pages, defs: v } })} />
          <div className="mt-3 space-y-1.5">
            {order.map((id, i) => {
              const hidden = layout.hidden.includes(id);
              return (
                <div key={id} className={clsx('flex items-center gap-2 rounded-xl border border-line bg-surface-2/60 px-2.5 py-1.5 text-[13px]', hidden && 'opacity-50')}>
                  <span className="w-5 text-center text-[11px] font-bold text-accent">{String(i + 1).padStart(2, '0')}</span>
                  <span className={clsx('flex-1 truncate', hidden && 'line-through')}>{titleOf(id)}</span>
                  <button className="tool !h-7 !min-w-7 !px-1" disabled={i === 0} onClick={() => move(id, -1)}><ArrowUp size={13} /></button>
                  <button className="tool !h-7 !min-w-7 !px-1" disabled={i === order.length - 1} onClick={() => move(id, 1)}><ArrowDown size={13} /></button>
                  <button className="tool !h-7 !min-w-7 !px-1" title={hidden ? 'Show section' : 'Hide section'} onClick={() => set({ hidden: hidden ? layout.hidden.filter((x) => x !== id) : [...layout.hidden, id] })}>{hidden ? <EyeOff size={13} /> : <Eye size={13} />}</button>
                </div>
              );
            })}
          </div>
        </Group>
        <Group icon={PenLine} title="Cover text">
          {([['title', 'Title', data.scope], ['subtitle', 'Kicker', 'Studio performance review'], ['preparedFor', 'Prepared for', 'e.g. Board of directors']] as const).map(([k, l, ph]) => (
            <label key={k} className="mb-2 block"><span className="text-[11px] font-medium text-ink-3">{l}</span><input value={layout[k]} placeholder={ph} onChange={(e) => set({ [k]: e.target.value } as Partial<ReportLayout>)} className="field mt-1 !h-9 w-full" /></label>
          ))}
        </Group>
      </div>
      <div className="flex items-center justify-between border-t border-line px-5 py-3">
        <button onClick={() => onChange({ ...DEFAULT_LAYOUT })} className="tool"><RotateCcw size={14} />Reset to default</button>
        <button onClick={onClose} className="btn-brand inline-flex h-9 items-center rounded-xl px-4 text-sm font-semibold text-white">Done</button>
      </div>
    </aside>
  );
}
