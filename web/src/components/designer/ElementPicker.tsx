import { useMemo, useState } from 'react';
import clsx from 'clsx';
import { X, Search, LayoutGrid, Sparkles, Gauge, Heading, AlignLeft, Quote, Image as ImageIcon, Minus, Square, Brain, BarChart3, Table2, Trophy, CalendarRange, LineChart, Check } from 'lucide-react';
import { BRAND } from '../../lib/brand';
import { AI_STYLES, uid, type Slot } from '../../lib/designer';

export interface Catalog {
  workspaces: { id: string; label: string; icon: string; widgets: { index: number; type: string; title: string; chart?: string; block?: string }[] }[];
  specials: { id: string; label: string; group: string; kind: string; chart?: string }[];
  metrics: { id: string; label: string; dataset: string; format: string }[];
}
const TYPE_ICON: Record<string, typeof Table2> = { kpis: Gauge, chart: BarChart3, table: Table2, ranking: Trophy, mom: CalendarRange, analysis: LineChart };
const TYPE_LABEL: Record<string, string> = { kpis: 'Metric cards', chart: 'Chart', table: 'Table', ranking: 'Ranked list', mom: 'Month-on-month', analysis: 'Analysis' };
type Tab = 'workspaces' | 'analyses' | 'metrics' | 'text' | 'ai' | 'image';

/** Choose what goes into a slot: any element from any tab, metric cards, text and titles, a photo or an AI slot. */
export function ElementPicker({ catalog, current, onPick, onClose }: { catalog: Catalog; current?: Slot | null; onPick: (s: Slot) => void; onClose: () => void }) {
  const [tab, setTab] = useState<Tab>(current?.kind === 'ai' ? 'ai' : current && ['title', 'text', 'quote', 'divider', 'spacer'].includes(current.kind) ? 'text' : current?.kind === 'image' ? 'image' : current?.kind === 'special' ? 'analyses' : current?.kind?.startsWith('metric') ? 'metrics' : 'workspaces');
  const [ws, setWs] = useState(current?.domain ?? catalog.workspaces[0]?.id);
  const [q, setQ] = useState('');
  const [picked, setPicked] = useState<string[]>(current?.metrics ?? (current?.metric ? [current.metric] : []));
  const [txt, setTxt] = useState({ kind: (current && ['title', 'text', 'quote', 'divider', 'spacer'].includes(current.kind) ? current.kind : 'title') as Slot['kind'], text: current?.text ?? '', title: current?.title ?? '', body: current?.body ?? '', by: current?.by ?? '' });
  const [ai, setAi] = useState({ prompt: current?.prompt ?? '', style: current?.style ?? 'paragraph', label: current?.kind === 'ai' ? current.label ?? '' : '' });
  const id = current?.id ?? uid();
  const W = catalog.workspaces.find((w) => w.id === ws);
  const metrics = useMemo(() => catalog.metrics.filter((m) => !q || `${m.label} ${m.id} ${m.dataset}`.toLowerCase().includes(q.toLowerCase())), [catalog, q]);
  const groups = [...new Set(catalog.specials.map((s) => s.group))];
  const tabs: [Tab, string, typeof Table2][] = [['workspaces', 'From app tabs', LayoutGrid], ['analyses', 'Analyses', Sparkles], ['metrics', 'Metric cards', Gauge], ['text', 'Titles & text', Heading], ['ai', 'AI content', Brain], ['image', 'Photo', ImageIcon]];
  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/40 p-6 backdrop-blur-sm" onMouseDown={onClose}>
      <div className="pop-in flex h-[78vh] w-[960px] max-w-full flex-col overflow-hidden rounded-3xl border border-line bg-surface shadow-2xl" onMouseDown={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-3 border-b border-line px-5 py-3.5">
          <div className="font-display text-[15px] font-semibold">Add an element</div>
          <div className="seg ml-3">{tabs.map(([t, l, I]) => <button key={t} onClick={() => setTab(t)} className={clsx('h-7 gap-1.5 px-2.5 text-xs', tab === t && 'on')}><I size={12} />{l}</button>)}</div>
          <button onClick={onClose} className="tool ml-auto !h-8 !min-w-8 !px-2"><X size={15} /></button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-5">
          {tab === 'workspaces' && (
            <div className="grid grid-cols-[200px_1fr] gap-5">
              <div className="space-y-1">{catalog.workspaces.map((w) => <button key={w.id} onClick={() => setWs(w.id)} className={clsx('block w-full rounded-lg px-3 py-2 text-left text-sm', ws === w.id ? 'bg-accent-soft font-semibold text-accent' : 'text-ink-2 hover:bg-surface-2')}>{w.label}<span className="ml-1 text-[11px] text-ink-3">{w.widgets.length}</span></button>)}</div>
              <div className="grid grid-cols-2 gap-2">{W?.widgets.map((x) => {
                const I = TYPE_ICON[x.type] ?? LayoutGrid;
                const on = current?.kind === 'widget' && current.domain === W.id && current.index === x.index;
                return (
                  <button key={x.index} onClick={() => onPick({ id, kind: 'widget', domain: W.id, index: x.index, label: x.title })} className={clsx('lift flex items-start gap-3 rounded-xl border p-3 text-left', on ? 'border-accent bg-accent-soft' : 'border-line hover:border-accent/50')}>
                    <span className="panel-tile !h-8 !w-8 shrink-0"><I size={14} /></span>
                    <span><span className="block text-[13px] font-semibold text-ink">{x.title}</span><span className="text-[11px] text-ink-3">{TYPE_LABEL[x.type] ?? x.type}{x.chart ? ` · ${x.chart.replace('_', ' ')}` : ''} · {W.label}</span></span>
                  </button>
                );
              })}</div>
            </div>
          )}
          {tab === 'analyses' && (
            <div className="space-y-5">{groups.map((g) => (
              <div key={g}><div className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-ink-3">{g}</div>
                <div className="grid grid-cols-2 gap-2">{catalog.specials.filter((s) => s.group === g).map((s) => (
                  <button key={s.id} onClick={() => onPick({ id, kind: 'special', special: s.id, label: s.label })} className={clsx('lift flex items-center gap-3 rounded-xl border p-3 text-left', current?.special === s.id ? 'border-accent bg-accent-soft' : 'border-line hover:border-accent/50')}>
                    <span className="panel-tile !h-8 !w-8 shrink-0">{s.kind === 'chart' ? <BarChart3 size={14} /> : <Table2 size={14} />}</span><span className="text-[13px] font-semibold text-ink">{s.label}</span>
                  </button>
                ))}</div></div>
            ))}</div>
          )}
          {tab === 'metrics' && (
            <div>
              <div className="mb-3 flex items-center gap-2">
                <div className="relative flex-1"><Search size={13} className="absolute left-2.5 top-2.5 text-ink-3" /><input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search 120+ metrics…" className="field !h-9 w-full pl-8" /></div>
                <span className="text-xs text-ink-3">{picked.length} selected · one = a single card, several = a card strip</span>
                <button disabled={!picked.length} onClick={() => onPick(picked.length === 1 ? { id, kind: 'metric', metric: picked[0], label: catalog.metrics.find((m) => m.id === picked[0])?.label } : { id, kind: 'metrics', metrics: picked, label: `${picked.length} metrics` })} className="btn-brand h-9 rounded-lg px-4 text-xs font-semibold text-white disabled:opacity-40">Add {picked.length > 1 ? 'card strip' : 'card'}</button>
              </div>
              <div className="grid grid-cols-3 gap-1.5">{metrics.map((m) => { const on = picked.includes(m.id); return (
                <button key={m.id} onClick={() => setPicked((p) => (on ? p.filter((x) => x !== m.id) : [...p, m.id].slice(0, 8)))} className={clsx('flex items-center gap-2 rounded-lg border px-2.5 py-1.5 text-left text-xs', on ? 'border-accent bg-accent-soft' : 'border-line hover:border-accent/40')}>
                  <span className={clsx('grid h-4 w-4 shrink-0 place-items-center rounded border', on ? 'border-accent bg-accent text-white' : 'border-line')}>{on && <Check size={10} />}</span>
                  <span className="min-w-0"><span className="block truncate font-medium text-ink">{m.label}</span><span className="text-[10.5px] text-ink-3">{m.dataset}</span></span>
                </button>); })}</div>
            </div>
          )}
          {tab === 'text' && (
            <div className="max-w-[640px] space-y-3">
              <div className="seg">{([['title', 'Title', Heading], ['text', 'Text block', AlignLeft], ['quote', 'Quote', Quote], ['divider', 'Divider', Minus], ['spacer', 'Empty space', Square]] as const).map(([k, l, I]) => <button key={k} onClick={() => setTxt({ ...txt, kind: k })} className={clsx('h-7 gap-1.5 px-2.5 text-xs', txt.kind === k && 'on')}><I size={12} />{l}</button>)}</div>
              {txt.kind === 'title' && <><input value={txt.text} onChange={(e) => setTxt({ ...txt, text: e.target.value })} placeholder="Big title" className="field !h-10 w-full text-base" /><input value={txt.body} onChange={(e) => setTxt({ ...txt, body: e.target.value })} placeholder="Subtitle (optional)" className="field w-full" /></>}
              {txt.kind === 'text' && <><input value={txt.title} onChange={(e) => setTxt({ ...txt, title: e.target.value })} placeholder="Heading (optional)" className="field w-full" /><textarea value={txt.body} onChange={(e) => setTxt({ ...txt, body: e.target.value })} placeholder={'Write your text. Start lines with "- " for bullets or "1. " for numbered points.'} className="field h-44 w-full py-2" /></>}
              {txt.kind === 'quote' && <><textarea value={txt.text} onChange={(e) => setTxt({ ...txt, text: e.target.value })} placeholder="Quote" className="field h-24 w-full py-2" /><input value={txt.by} onChange={(e) => setTxt({ ...txt, by: e.target.value })} placeholder="Who said it (optional)" className="field w-full" /></>}
              {txt.kind === 'divider' && <input value={txt.text} onChange={(e) => setTxt({ ...txt, text: e.target.value })} placeholder="Divider label (optional)" className="field w-full" />}
              <button onClick={() => onPick({ id, kind: txt.kind, text: txt.text, title: txt.title, body: txt.body, by: txt.by, label: txt.kind === 'title' ? txt.text || 'Title' : txt.kind === 'text' ? txt.title || 'Text' : txt.kind })} className="btn-brand h-9 rounded-lg px-4 text-xs font-semibold text-white">Add</button>
            </div>
          )}
          {tab === 'ai' && (
            <div className="max-w-[680px] space-y-3">
              <p className="text-sm text-ink-3">Leave space for the AI analyst. When you generate the report it reads the data on this page (and your brand knowledge) and writes this slot for you.</p>
              <input value={ai.label} onChange={(e) => setAi({ ...ai, label: e.target.value })} placeholder="Heading for this box (optional), e.g. What it means" className="field w-full" />
              <textarea autoFocus value={ai.prompt} onChange={(e) => setAi({ ...ai, prompt: e.target.value })} placeholder="What should the AI write? e.g. Explain what drove revenue this month and what to do about the weakest studio." className="field h-28 w-full py-2" />
              <div className="flex flex-wrap gap-1.5">{['Summarise this page and what it means', 'What drove the change, and why?', 'Recommend three actions with owners', 'Risks and opportunities to watch', 'Compare studios and call out the outlier'].map((x) => <button key={x} onClick={() => setAi({ ...ai, prompt: x })} className="chip hover:!text-accent">{x}</button>)}</div>
              <div className="flex items-center gap-2 text-xs"><span className="text-ink-3">Format</span><div className="seg">{AI_STYLES.map(([k, l]) => <button key={k} onClick={() => setAi({ ...ai, style: k })} className={clsx('h-7 px-2.5 text-xs', ai.style === k && 'on')}>{l}</button>)}</div></div>
              <button disabled={ai.prompt.trim().length < 4} onClick={() => onPick({ id, kind: 'ai', prompt: ai.prompt.trim(), style: ai.style, label: ai.label.trim() || 'AI commentary' })} className="btn-brand h-9 rounded-lg px-4 text-xs font-semibold text-white disabled:opacity-40"><Brain size={12} className="mr-1 inline" />Add AI slot</button>
            </div>
          )}
          {tab === 'image' && (
            <div className="grid grid-cols-3 gap-3">{BRAND.photos.map((p) => <button key={p} onClick={() => onPick({ id, kind: 'image', photo: p, label: 'Photo' })} className={clsx('lift aspect-[4/3] rounded-xl border-2 bg-cover bg-center', current?.photo === p ? 'border-accent' : 'border-transparent')} style={{ backgroundImage: `url(${p})` }} />)}</div>
          )}
        </div>
      </div>
    </div>
  );
}
