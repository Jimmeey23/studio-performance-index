import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import clsx from 'clsx';
import {
  Plus, Trash2, Copy, ArrowUp, ArrowDown, Eye, PenLine, Brain, Loader2, Printer, LayoutTemplate, X, CheckCircle2, MapPin, CalendarRange, Sparkles,
  LayoutGrid, Gauge, Heading, AlignLeft, Quote, Image as ImageIcon, Minus, Square, AlertTriangle, ArrowLeft, Pencil,
} from 'lucide-react';
import { api } from '../lib/api';
import { PRESETS, range, lastMonthValue, periodLabelOf } from '../lib/periods';
import { LAYOUTS, ANIMATIONS, TINTS, STARTERS, layoutById, slotLetters, blankPage, relayout, uid, type Design, type DPage, type Slot, type Rendered, type Layout } from '../lib/designer';
import { ElementPicker, type Catalog } from '../components/designer/ElementPicker';
import { DesignedReport } from '../components/designer/DesignedReport';
import { useMe } from '../App';

const KIND_ICON: Record<string, typeof Gauge> = { widget: LayoutGrid, special: Sparkles, metric: Gauge, metrics: Gauge, title: Heading, text: AlignLeft, quote: Quote, image: ImageIcon, divider: Minus, spacer: Square, ai: Brain };
const KIND_LABEL: Record<string, string> = { widget: 'App element', special: 'Analysis', metric: 'Metric card', metrics: 'Metric strip', title: 'Title', text: 'Text', quote: 'Quote', image: 'Photo', divider: 'Divider', spacer: 'Empty space', ai: 'AI content' };

/** Mini wireframe of a layout (used in the gallery and page list). */
function Wire({ l, slots, size = 'md' }: { l: Layout; slots?: (Slot | null)[]; size?: 'sm' | 'md' }) {
  const letters = slotLetters(l);
  return (
    <div className={clsx('wire', size)} style={{ gridTemplateAreas: l.areas.map((a) => `"${a}"`).join(' '), gridTemplateColumns: l.cols, gridTemplateRows: l.rows.replace(/auto/g, '.45fr') }}>
      {letters.map((a, i) => { const s = slots?.[i]; const I = s ? KIND_ICON[s.kind] : null; return <i key={a} style={{ gridArea: a }} className={clsx(s && 'on', s?.kind === 'ai' && 'ai')}>{I && size === 'md' && <I size={9} />}</i>; })}
    </div>
  );
}

function LayoutGallery({ onPick, onClose, current }: { onPick: (id: string) => void; onClose: () => void; current?: string }) {
  const groups = [...new Set(LAYOUTS.map((l) => l.group))];
  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/40 p-6 backdrop-blur-sm" onMouseDown={onClose}>
      <div className="pop-in max-h-[80vh] w-[880px] max-w-full overflow-y-auto rounded-3xl border border-line bg-surface p-6 shadow-2xl" onMouseDown={(e) => e.stopPropagation()}>
        <div className="mb-4 flex items-center"><div className="font-display text-[15px] font-semibold">Choose a page layout</div><button onClick={onClose} className="tool ml-auto !h-8 !min-w-8 !px-2"><X size={15} /></button></div>
        {groups.map((g) => (
          <div key={g} className="mb-5"><div className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-ink-3">{g}</div>
            <div className="grid grid-cols-4 gap-3">{LAYOUTS.filter((l) => l.group === g).map((l) => (
              <button key={l.id} onClick={() => onPick(l.id)} className={clsx('lift rounded-xl border p-2.5 text-left', current === l.id ? 'border-accent bg-accent-soft' : 'border-line hover:border-accent/50')}>
                <Wire l={l} /><div className="mt-2 text-[12px] font-semibold text-ink">{l.label}</div><div className="text-[10.5px] text-ink-3">{l.slots} slot{l.slots > 1 ? 's' : ''}</div>
              </button>
            ))}</div></div>
        ))}
      </div>
    </div>
  );
}

/** Wireframe report designer: pages from placeholder layouts, filled with any element from the app, text, photos or AI content. */
export default function Designer() {
  const { id: routeId } = useParams();
  const nav = useNavigate();
  const me = useMe();
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [design, setDesign] = useState<Design | null>(null);
  const [id, setId] = useState<string | null>(routeId ?? null);
  const [sel, setSel] = useState(0);
  const [picker, setPicker] = useState<{ page: number; slot: number } | null>(null);
  const [gallery, setGallery] = useState<'add' | 'change' | null>(null);
  const [mode, setMode] = useState<'edit' | 'preview'>('edit');
  const [rendered, setRendered] = useState<Rendered | null>(null);
  const [busy, setBusy] = useState<'' | 'render' | 'ai' | 'save'>('');
  const [saved, setSaved] = useState<'idle' | 'saving' | 'saved'>('idle');
  const [err, setErr] = useState('');
  const [locs, setLocs] = useState<string[]>([]);
  const [studiosOpen, setStudiosOpen] = useState(false);
  const dirty = useRef(false);

  useEffect(() => { api<Catalog>('/api/designer/catalog').then(setCatalog).catch((e) => setErr((e as Error).message)); api<string[]>('/api/locations').then(setLocs).catch(() => {}); }, []);
  useEffect(() => {
    if (!routeId) { setDesign(null); setId(null); setRendered(null); return; }
    api<{ id: string; design: Design; rendered: Rendered | null }>(`/api/designs/${routeId}`).then((d) => { setDesign(d.design); setId(d.id); setRendered(d.rendered); setSel(0); if (d.rendered) setMode('preview'); }).catch((e) => setErr((e as Error).message));
  }, [routeId]);

  // autosave to the database
  const update = (fn: (d: Design) => Design) => { setDesign((d) => (d ? fn(d) : d)); dirty.current = true; setSaved('idle'); };
  useEffect(() => {
    if (!design || !dirty.current) return;
    const t = setTimeout(async () => {
      setSaved('saving');
      try { const r = await api<{ id: string }>('/api/designs', { method: 'POST', json: { id, design } }); dirty.current = false; if (!id) { setId(r.id); nav(`/designer/${r.id}`, { replace: true }); } setSaved('saved'); }
      catch (e) { setErr((e as Error).message); setSaved('idle'); }
    }, 900);
    return () => clearTimeout(t);
  }, [design]); // eslint-disable-line react-hooks/exhaustive-deps

  const start = (s: typeof STARTERS[number]) => { setDesign(s.make()); dirty.current = true; setSel(0); setMode('edit'); setRendered(null); };
  const period = useMemo(() => (design ? (design.preset === 'custom' ? { start: design.start ?? '', end: design.end ?? '' } : range(design.preset ?? 'lm', design.month ?? lastMonthValue())) : null), [design]);
  const payload = () => ({ ...design!, start: period?.start, end: period?.end });
  const render = async (ai: boolean) => {
    if (!design) return;
    setBusy(ai ? 'ai' : 'render'); setErr('');
    try { const r = await api<Rendered>('/api/designs/render', { method: 'POST', json: { design: payload(), id, ai, keepAi: rendered?.ai ?? {} } }); setRendered(r); setMode('preview'); }
    catch (e) { setErr((e as Error).message); } finally { setBusy(''); }
  };
  const print = () => { const t = document.title; document.title = design?.title ?? 'Report'; document.body.classList.add('dz-printing'); setTimeout(() => { window.print(); document.body.classList.remove('dz-printing'); document.title = t; }, 300); };

  const page = design?.pages[sel];
  const setPage = (fn: (p: DPage) => DPage) => update((d) => ({ ...d, pages: d.pages.map((p, i) => (i === sel ? fn(p) : p)) }));
  const movePage = (i: number, dir: -1 | 1) => update((d) => { const ps = [...d.pages]; const j = i + dir; if (j < 0 || j >= ps.length) return d; [ps[i], ps[j]] = [ps[j], ps[i]]; setSel(j); return { ...d, pages: ps }; });
  const aiCount = design?.pages.reduce((a, p) => a + p.slots.filter((s) => s?.kind === 'ai').length, 0) ?? 0;

  /* ── start screen ── */
  if (!design) return (
    <div className="h-full overflow-y-auto">
      <div className="page-hero px-8 pb-6 pt-7"><div className="relative z-[1] mx-auto flex max-w-[1240px] items-center gap-5">
        <div className="hero-icon flex h-14 w-14 items-center justify-center rounded-2xl"><LayoutTemplate size={26} /></div>
        <div><div className="mb-1 text-[11px] font-semibold uppercase tracking-[0.12em] text-accent">Report designer</div><h1 className="text-[28px] font-bold leading-tight text-ink">Design a report from a wireframe</h1>
          <p className="mt-0.5 text-[13.5px] text-ink-3">Pick a layout for each page, then drop in any table, chart, list or metric card from any tab — plus titles, text, photos and space for the AI analyst to write.</p></div>
        <button onClick={() => nav('/custom-reports')} className="tool ml-auto !h-10 !px-3.5"><ArrowLeft size={15} />Custom reports</button>
      </div></div>
      <div className="mx-auto max-w-[1240px] space-y-6 px-8 py-6">
        {err && <div className="rounded-xl border border-bad/30 bg-bad/5 p-3 text-sm text-bad">{err}</div>}
        <div className="section-title"><span className="dot" />Start with</div>
        <div className="grid gap-3 md:grid-cols-4">{STARTERS.map((s) => (
          <button key={s.id} onClick={() => start(s)} className="lift panel p-4 text-left">
            <div className="mb-3 grid grid-cols-3 gap-1.5">{s.make().pages.slice(0, 3).map((p) => <Wire key={p.id} l={layoutById(p.layout)} slots={p.slots} size="sm" />)}</div>
            <div className="font-semibold text-ink">{s.name}</div><div className="mt-0.5 text-[12px] text-ink-3">{s.blurb}</div>
          </button>
        ))}</div>
        <DesignLibrary onOpen={(i) => nav(`/designer/${i}`)} />
      </div>
    </div>
  );

  /* ── editor ── */
  const L = page ? layoutById(page.layout) : LAYOUTS[0];
  const letters = slotLetters(L);
  return (
    <div className="flex h-full flex-col">
      <div className="no-print flex flex-wrap items-center gap-2 border-b border-line bg-surface/80 px-5 py-2.5 backdrop-blur">
        <button onClick={() => nav('/designer')} className="tool !h-9 !min-w-9 !px-2" title="All designs"><ArrowLeft size={15} /></button>
        <input value={design.title} onChange={(e) => update((d) => ({ ...d, title: e.target.value }))} className="min-w-[220px] flex-1 bg-transparent font-display text-[17px] font-semibold text-ink outline-none" />
        <div className="flex items-center gap-1.5 text-xs">
          <CalendarRange size={13} className="text-ink-3" />
          <select value={design.preset ?? 'lm'} onChange={(e) => update((d) => ({ ...d, preset: e.target.value }))} className="field !h-8">{PRESETS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
          {design.preset === 'month' && <input type="month" value={design.month ?? lastMonthValue()} onChange={(e) => update((d) => ({ ...d, month: e.target.value }))} className="field !h-8" />}
          {design.preset === 'custom' && <><input type="date" value={design.start ?? ''} onChange={(e) => update((d) => ({ ...d, start: e.target.value }))} className="field !h-8" /><input type="date" value={design.end ?? ''} onChange={(e) => update((d) => ({ ...d, end: e.target.value }))} className="field !h-8" /></>}
          <div className="relative">
            <button onClick={() => setStudiosOpen((o) => !o)} className="tool !h-8 gap-1.5 !px-2.5 text-xs"><MapPin size={13} />{design.locations.length ? `${design.locations.length} studio${design.locations.length > 1 ? 's' : ''}` : 'All studios'}</button>
            {studiosOpen && <div className="pop-in absolute right-0 z-50 mt-1 w-72 rounded-xl border border-line bg-surface p-2 shadow-2xl" onMouseLeave={() => setStudiosOpen(false)}>
              <button onClick={() => update((d) => ({ ...d, locations: [] }))} className={clsx('block w-full rounded-lg px-2.5 py-1.5 text-left text-xs', !design.locations.length && 'bg-accent-soft text-accent')}>All studios</button>
              {locs.map((l) => { const on = design.locations.includes(l); return <button key={l} onClick={() => update((d) => ({ ...d, locations: on ? d.locations.filter((x) => x !== l) : [...d.locations, l] }))} className={clsx('block w-full rounded-lg px-2.5 py-1.5 text-left text-xs', on && 'bg-accent-soft text-accent')}>{l}</button>; })}
            </div>}
          </div>
          <select value={design.orientation} onChange={(e) => update((d) => ({ ...d, orientation: e.target.value as Design['orientation'] }))} className="field !h-8"><option value="portrait">Portrait</option><option value="landscape">Landscape</option></select>
          <label className="flex items-center gap-1 text-ink-2"><input type="checkbox" checked={design.cover} onChange={(e) => update((d) => ({ ...d, cover: e.target.checked }))} />Cover</label>
        </div>
        <span className="text-[11px] text-ink-3">{saved === 'saving' ? <><Loader2 size={11} className="mr-1 inline animate-spin" />Saving…</> : saved === 'saved' ? <><CheckCircle2 size={11} className="mr-1 inline text-good" />Saved</> : ''}</span>
        <div className="seg"><button onClick={() => setMode('edit')} className={clsx('h-8 gap-1.5 px-3 text-xs', mode === 'edit' && 'on')}><PenLine size={13} />Wireframe</button><button onClick={() => (rendered ? setMode('preview') : render(false))} className={clsx('h-8 gap-1.5 px-3 text-xs', mode === 'preview' && 'on')}><Eye size={13} />Preview</button></div>
        <button onClick={() => render(false)} disabled={!!busy} className="tool !h-9 !px-3 text-xs">{busy === 'render' ? <Loader2 size={14} className="animate-spin" /> : <Eye size={14} />}Build with data</button>
        <button onClick={() => render(true)} disabled={!!busy || !aiCount} className="btn-brand inline-flex h-9 items-center gap-1.5 rounded-lg px-3 text-xs font-semibold text-white disabled:opacity-50" title={aiCount ? `${aiCount} AI slot(s)` : 'Add an AI content slot first'}>{busy === 'ai' ? <Loader2 size={14} className="animate-spin" /> : <Brain size={14} />}Build + write AI content</button>
        {mode === 'preview' && rendered && <button onClick={print} className="tool !h-9 !px-3 text-xs"><Printer size={14} />PDF</button>}
      </div>
      {err && <div className="no-print mx-5 mt-3 flex items-center gap-2 rounded-xl border border-bad/30 bg-bad/5 p-2.5 text-sm text-bad"><AlertTriangle size={14} />{err}<button onClick={() => setErr('')} className="ml-auto"><X size={13} /></button></div>}
      {!me?.aiConfigured && aiCount > 0 && mode === 'edit' && <div className="no-print mx-5 mt-3 text-[11.5px] text-warn">AI key not configured — AI slots will get a plain-language read-out of the page's numbers.</div>}

      {mode === 'preview' && rendered ? (
        <div className="min-h-0 flex-1 overflow-y-auto bg-[#e8e8e3] py-8 dark:bg-[#1a1b20]">
          <div className="no-print mx-auto mb-4 flex max-w-[900px] items-center gap-2 text-xs text-ink-3"><span className="chip"><CalendarRange size={12} />{periodLabelOf(rendered.period)}</span><span className="chip"><MapPin size={12} />{rendered.scope}</span><span className="chip">Built {new Date(rendered.renderedAt).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</span>{Object.keys(rendered.ai ?? {}).length > 0 && <span className="chip"><Brain size={12} />AI content written</span>}</div>
          <DesignedReport r={rendered} />
        </div>
      ) : (
        <div className="grid min-h-0 flex-1 grid-cols-[200px_1fr_250px]">
          {/* pages */}
          <div className="no-print overflow-y-auto border-r border-line p-3">
            <div className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-ink-3">Pages · {design.pages.length}</div>
            <div className="space-y-2">{design.pages.map((p, i) => (
              <div key={p.id} className={clsx('group rounded-xl border p-2', i === sel ? 'border-accent bg-accent-soft' : 'border-line hover:border-accent/40')}>
                <button onClick={() => setSel(i)} className="block w-full text-left"><Wire l={layoutById(p.layout)} slots={p.slots} size="sm" /><div className="mt-1.5 truncate text-[11.5px] font-medium text-ink">{i + 1}. {p.title || 'Untitled page'}</div></button>
                <div className="mt-1 flex gap-0.5 opacity-60 group-hover:opacity-100">
                  <button onClick={() => movePage(i, -1)} className="tool !h-6 !min-w-6 !px-1"><ArrowUp size={11} /></button><button onClick={() => movePage(i, 1)} className="tool !h-6 !min-w-6 !px-1"><ArrowDown size={11} /></button>
                  <button onClick={() => update((d) => ({ ...d, pages: [...d.pages.slice(0, i + 1), { ...JSON.parse(JSON.stringify(p)), id: uid('p'), slots: p.slots.map((s) => (s ? { ...s, id: uid() } : null)) }, ...d.pages.slice(i + 1)] }))} className="tool !h-6 !min-w-6 !px-1" title="Duplicate"><Copy size={11} /></button>
                  <button onClick={() => { update((d) => ({ ...d, pages: d.pages.filter((_, j) => j !== i) })); setSel(Math.max(0, i - 1)); }} className="tool ml-auto !h-6 !min-w-6 !px-1 hover:!text-bad" disabled={design.pages.length < 2}><Trash2 size={11} /></button>
                </div>
              </div>
            ))}</div>
            <button onClick={() => setGallery('add')} className="mt-3 flex w-full items-center justify-center gap-1.5 rounded-xl border border-dashed border-line py-3 text-xs text-ink-3 hover:border-accent hover:text-accent"><Plus size={13} />Add page</button>
          </div>

          {/* canvas */}
          <div className="no-print overflow-y-auto bg-[#e8e8e3] p-8 dark:bg-[#1a1b20]">
            {page && (
              <div className={clsx('wf-page mx-auto', design.orientation === 'landscape' && 'land')}>
                <div className="wf-head">
                  <input value={page.kicker ?? ''} onChange={(e) => setPage((p) => ({ ...p, kicker: e.target.value }))} placeholder={`Page ${String(sel + 1).padStart(2, '0')}`} className="wf-kicker" />
                  <input value={page.title} onChange={(e) => setPage((p) => ({ ...p, title: e.target.value }))} placeholder="Page title" className="wf-title" />
                  <input value={page.subtitle} onChange={(e) => setPage((p) => ({ ...p, subtitle: e.target.value }))} placeholder="Subtitle (optional)" className="wf-sub" />
                </div>
                <div className="wf-grid" style={{ gridTemplateAreas: L.areas.map((a) => `"${a}"`).join(' '), gridTemplateColumns: L.cols, gridTemplateRows: L.rows.replace(/auto/g, 'minmax(90px, .35fr)') }}>
                  {letters.map((a, i) => {
                    const s = page.slots[i]; const I = s ? KIND_ICON[s.kind] : Plus;
                    return (
                      <div key={a} style={{ gridArea: a }} className={clsx('wf-slot', s && 'filled', s?.kind === 'ai' && 'ai')} onClick={() => setPicker({ page: sel, slot: i })}>
                        <I size={s ? 18 : 16} />
                        {s ? <><div className="t">{s.label || KIND_LABEL[s.kind]}</div><div className="k">{KIND_LABEL[s.kind]}{s.kind === 'widget' ? ` · ${catalog?.workspaces.find((w) => w.id === s.domain)?.label ?? ''}` : ''}{s.kind === 'ai' ? ` · ${s.style}` : ''}</div>{s.kind === 'ai' && <div className="p">“{s.prompt}”</div>}
                          <div className="acts" onClick={(e) => e.stopPropagation()}><button onClick={() => setPicker({ page: sel, slot: i })} title="Change"><Pencil size={12} /></button><button onClick={() => setPage((p) => ({ ...p, slots: p.slots.map((x, j) => (j === i ? null : x)) }))} title="Remove"><Trash2 size={12} /></button></div></>
                          : <div className="t">Add element</div>}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>

          {/* page settings */}
          <div className="no-print overflow-y-auto border-l border-line p-4 text-xs">
            <div className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-ink-3">Page layout</div>
            {page && <button onClick={() => setGallery('change')} className="lift w-full rounded-xl border border-line p-2.5 text-left"><Wire l={L} slots={page.slots} /><div className="mt-2 font-semibold text-ink">{L.label}</div><div className="text-[10.5px] text-accent">Change layout</div></button>}
            <div className="mb-1.5 mt-5 text-[11px] font-semibold uppercase tracking-wider text-ink-3">Animation</div>
            <div className="grid grid-cols-2 gap-1">{ANIMATIONS.map(([v, l]) => <button key={v} onClick={() => setPage((p) => ({ ...p, animation: v }))} className={clsx('rounded-lg border px-2 py-1.5', (page?.animation ?? 'none') === v ? 'border-accent bg-accent-soft text-accent' : 'border-line')}>{l}</button>)}</div>
            <div className="mb-1.5 mt-5 text-[11px] font-semibold uppercase tracking-wider text-ink-3">Background</div>
            <div className="grid grid-cols-2 gap-1">{TINTS.map(([v, l]) => <button key={v} onClick={() => setPage((p) => ({ ...p, tint: v }))} className={clsx('rounded-lg border px-2 py-1.5', (page?.tint ?? 'none') === v ? 'border-accent bg-accent-soft text-accent' : 'border-line')}>{l}</button>)}</div>
            <div className="mb-1.5 mt-5 text-[11px] font-semibold uppercase tracking-wider text-ink-3">Report</div>
            <input value={design.subtitle ?? ''} onChange={(e) => update((d) => ({ ...d, subtitle: e.target.value }))} placeholder="Cover subtitle" className="field w-full" />
            <div className="mt-2 text-ink-3">Compare against</div>
            <select value={design.compare} onChange={(e) => update((d) => ({ ...d, compare: e.target.value as Design['compare'] }))} className="field mt-1 w-full"><option value="previous_year">Same period last year</option><option value="previous_period">Previous period</option><option value="none">No comparison</option></select>
            <div className="mt-5 rounded-xl bg-surface-2 p-3 text-[11.5px] leading-relaxed text-ink-3">Click any slot to place an element. <b className="text-ink-2">Build with data</b> fills every element for {period ? periodLabelOf(period) : 'the period'}; <b className="text-ink-2">Build + write AI content</b> also has the analyst write the {aiCount} AI slot{aiCount === 1 ? '' : 's'}. Designs save automatically.</div>
          </div>
        </div>
      )}
      {picker && catalog && <ElementPicker catalog={catalog} current={design.pages[picker.page]?.slots[picker.slot]} onClose={() => setPicker(null)}
        onPick={(s) => { update((d) => ({ ...d, pages: d.pages.map((p, i) => (i === picker.page ? { ...p, slots: p.slots.map((x, j) => (j === picker.slot ? s : x)) } : p)) })); setPicker(null); }} />}
      {gallery && <LayoutGallery current={gallery === 'change' ? page?.layout : undefined} onClose={() => setGallery(null)} onPick={(l) => {
        if (gallery === 'add') { update((d) => ({ ...d, pages: [...d.pages, blankPage(l, `Page ${d.pages.length + 1}`)] })); setSel(design.pages.length); }
        else setPage((p) => relayout(p, l));
        setGallery(null);
      }} />}
    </div>
  );
}

function DesignLibrary({ onOpen }: { onOpen: (id: string) => void }) {
  const [list, setList] = useState<{ id: string; title: string; pages: number; updated_at: string; rendered_at: string | null }[] | null>(null);
  const load = () => api<typeof list>('/api/designs').then(setList).catch(() => setList([]));
  useEffect(() => { load(); }, []);
  if (!list?.length) return null;
  return (
    <>
      <div className="section-title"><span className="dot" />Your designs<span className="text-[11px] font-medium text-ink-3">{list.length}</span></div>
      <div className="grid gap-2 md:grid-cols-3">{list.map((d) => (
        <div key={d.id} className="lift panel group flex items-center gap-3 p-3">
          <button onClick={() => onOpen(d.id)} className="flex min-w-0 flex-1 items-center gap-3 text-left"><span className="panel-tile !h-9 !w-9"><LayoutTemplate size={15} /></span>
            <span className="min-w-0"><span className="block truncate text-sm font-semibold text-ink">{d.title}</span><span className="text-[11px] text-ink-3">{d.pages} page{d.pages === 1 ? '' : 's'} · edited {d.updated_at.slice(0, 16)}{d.rendered_at ? ' · built' : ''}</span></span></button>
          <button onClick={async () => { await api(`/api/designs/${d.id}`, { method: 'DELETE' }); load(); }} className="tool !h-7 !min-w-7 !px-1.5 opacity-0 group-hover:opacity-100 hover:!text-bad"><Trash2 size={13} /></button>
        </div>
      ))}</div>
    </>
  );
}


