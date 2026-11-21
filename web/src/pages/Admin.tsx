import { useEffect, useMemo, useState, type ReactNode } from 'react';
import clsx from 'clsx';
import {
  ShieldCheck, Save, Loader2, CheckCircle2, Eye, EyeOff, ArrowUp, ArrowDown, Trash2, Plus, Pencil, RotateCcw, X, LayoutGrid, Navigation, Sigma, Layers,
  FileText, Users, FolderOpen, Search, ChevronDown, ChevronRight, AlertTriangle, MessageSquare, Brain,
} from 'lucide-react';
import { api } from '../lib/api';
import { useMe } from '../App';
import { loadAppConfig, DEFAULT_ANALYST_TEMPLATES } from '../lib/appConfig';
import { DEFAULT_REPORT_TEMPLATES, TEMPLATE_ICONS, type StoredReportTemplate } from '../lib/reportTemplates';
import { TEMPLATE_CATEGORIES, type Template } from '../lib/templates';
import { DOMAIN_ICON_NAMES, domainIcon } from '../lib/domainIcons';
import { PRESETS } from '../lib/periods';

/* ── types mirrored from the server ── */
type Widget = { type: string; title: string; metrics?: string[]; metric?: string; extra?: string[]; dimension?: string; dimensions?: string[]; chart?: string; view?: string; limit?: number; span?: 1 | 2; section?: string; hidden?: boolean; tool?: string; input?: Record<string, unknown>; block?: string; grain?: string; sort?: string };
type Domain = { id: string; label: string; icon: string; blurb: string; kpis: string[]; widgets: Widget[]; presets: string[]; expert?: string; hidden?: boolean };
type DomainOverride = Partial<Omit<Domain, 'id'>>;
interface Config {
  domains?: Record<string, DomainOverride>; domainOrder?: string[]; customDomains?: Domain[];
  nav?: { hidden?: string[]; labels?: Record<string, string>; order?: string[] };
  metrics?: Record<string, { label?: string; description?: string; hidden?: boolean }>;
  topics?: Record<string, { hidden?: boolean; title?: string; blurb?: string }>;
  reportTemplates?: StoredReportTemplate[] | null; analystTemplates?: (Template & { hidden?: boolean })[] | null;
}
interface AdminData { config: Config; defaults: { domains: Domain[]; metrics: { id: string; label: string; description: string; dataset: string; format: string }[] }; topics: { id: string; title: string; blurb: string }[]; dimensions: Record<string, { label: string }>; datasets: { id: string; label: string; dimensions: string[] }[] }

const NAV_ITEMS = [
  ['/report', 'Executive report'], ['/custom-reports', 'Custom reports'], ['/designer', 'Report designer'], ['/insights', 'Forecasts & insights'], ['/templates', 'Templates'], ['/reports', 'Saved reports'],
  ['/data', 'Data sources'], ['/metrics', 'Metrics & definitions'], ['/settings', 'Settings'],
] as const;
const WIDGET_TYPES = [['kpis', 'Metric cards'], ['chart', 'Chart'], ['table', 'Table'], ['ranking', 'Ranked list'], ['mom', 'Month-on-month']] as const;
const CHARTS = ['bar', 'line', 'area', 'stacked_bar', 'horizontal_bar', 'pie'];
const VIEWS = ['table', 'grouped', 'ranked', 'heatmap', 'pivot', 'transposed', 'cards'];
const move = <T,>(a: T[], i: number, d: -1 | 1) => { const b = [...a]; const j = i + d; if (j < 0 || j >= b.length) return a; [b[i], b[j]] = [b[j], b[i]]; return b; };
const Tog = ({ on, onClick, title }: { on: boolean; onClick: () => void; title?: string }) => <button onClick={onClick} title={title ?? (on ? 'Visible — click to hide' : 'Hidden — click to show')} className={clsx('tool !h-7 !min-w-7 !px-1.5', !on && '!text-ink-3 opacity-60')}>{on ? <Eye size={13} /> : <EyeOff size={13} />}</button>;
const Mini = ({ onClick, children, title, danger }: { onClick: () => void; children: ReactNode; title?: string; danger?: boolean }) => <button onClick={onClick} title={title} className={clsx('tool !h-7 !min-w-7 !px-1.5', danger && 'hover:!text-bad')}>{children}</button>;

/** Admin console — add, edit, hide, reorder or delete every configurable item in the app. */
export default function Admin() {
  const me = useMe();
  const [tab, setTab] = useState<'workspaces' | 'nav' | 'metrics' | 'topics' | 'templates' | 'users' | 'content'>('workspaces');
  const [data, setData] = useState<AdminData | null>(null);
  const [cfg, setCfg] = useState<Config>({});
  const [dirty, setDirty] = useState(false);
  const [state, setState] = useState<'' | 'saving' | 'saved'>('');
  const [err, setErr] = useState('');
  useEffect(() => { api<AdminData>('/api/admin/config').then((d) => { setData(d); setCfg(d.config ?? {}); }).catch((e) => setErr((e as Error).message)); }, []);
  const update = (fn: (c: Config) => Config) => { setCfg((c) => fn(JSON.parse(JSON.stringify(c)))); setDirty(true); setState(''); };
  const save = async () => { setState('saving'); setErr(''); try { await api('/api/admin/config', { method: 'PUT', json: { config: cfg } }); await loadAppConfig(); setDirty(false); setState('saved'); } catch (e) { setErr((e as Error).message); setState(''); } };
  if (me?.role !== 'admin') return <div className="p-10 text-sm text-ink-3">The admin console is available to administrators only.</div>;
  const tabs: [typeof tab, string, typeof LayoutGrid][] = [['workspaces', 'Workspaces & widgets', LayoutGrid], ['nav', 'Navigation', Navigation], ['metrics', 'Metrics', Sigma], ['topics', 'Report topics', Layers], ['templates', 'Templates', FileText], ['users', 'Users', Users], ['content', 'Saved content', FolderOpen]];
  const configTab = !['users', 'content'].includes(tab);
  return (
    <div className="flex h-full flex-col">
      <div className="page-hero px-8 pb-4 pt-6"><div className="relative z-[1] mx-auto flex max-w-[1240px] flex-wrap items-center gap-4">
        <div className="hero-icon flex h-12 w-12 items-center justify-center rounded-2xl"><ShieldCheck size={22} /></div>
        <div><div className="text-[11px] font-semibold uppercase tracking-[0.12em] text-accent">Administration</div><h1 className="text-[24px] font-bold leading-tight text-ink">Admin console</h1>
          <p className="text-[13px] text-ink-3">Add, edit, hide, reorder or remove every workspace, widget, page, metric, topic, template, user and saved item. Brand knowledge and business rules live in Settings.</p></div>
        {configTab && <div className="ml-auto flex items-center gap-2">
          {state === 'saved' && <span className="flex items-center gap-1 text-xs text-good"><CheckCircle2 size={13} />Saved — live for everyone</span>}
          {dirty && <span className="text-xs text-warn">Unsaved changes</span>}
          <button onClick={save} disabled={!dirty || state === 'saving'} className="btn-brand inline-flex h-10 items-center gap-2 rounded-xl px-5 text-sm font-semibold text-white disabled:opacity-50">{state === 'saving' ? <Loader2 size={15} className="animate-spin" /> : <Save size={15} />}Save changes</button>
        </div>}
      </div></div>
      <div className="border-b border-line px-8"><div className="mx-auto flex max-w-[1240px] gap-1 overflow-x-auto py-2">{tabs.map(([t, l, I]) => <button key={t} onClick={() => setTab(t)} className={clsx('flex shrink-0 items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm', tab === t ? 'bg-accent-soft font-semibold text-accent' : 'text-ink-2 hover:bg-surface-2')}><I size={14} />{l}</button>)}</div></div>
      <div className="min-h-0 flex-1 overflow-y-auto"><div className="mx-auto max-w-[1240px] px-8 py-6">
        {err && <div className="mb-4 flex items-center gap-2 rounded-xl border border-bad/30 bg-bad/5 p-3 text-sm text-bad"><AlertTriangle size={14} />{err}</div>}
        {!data ? <div className="flex items-center gap-2 text-sm text-ink-3"><Loader2 size={14} className="animate-spin" />Loading…</div> : <>
          {tab === 'workspaces' && <Workspaces data={data} cfg={cfg} update={update} />}
          {tab === 'nav' && <NavTab cfg={cfg} update={update} />}
          {tab === 'metrics' && <MetricsTab data={data} cfg={cfg} update={update} />}
          {tab === 'topics' && <TopicsTab data={data} cfg={cfg} update={update} />}
          {tab === 'templates' && <TemplatesTab data={data} cfg={cfg} update={update} />}
          {tab === 'users' && <UsersTab />}
          {tab === 'content' && <ContentTab />}
        </>}
      </div></div>
    </div>
  );
}

/* ═════════ workspaces & widgets ═════════ */
function Workspaces({ data, cfg, update }: { data: AdminData; cfg: Config; update: (fn: (c: Config) => Config) => void }) {
  const [open, setOpen] = useState<string | null>(null);
  const [edit, setEdit] = useState<{ domain: string; index: number | null } | null>(null);
  const all: Domain[] = [...data.defaults.domains, ...(cfg.customDomains ?? [])];
  const order = cfg.domainOrder ?? [];
  const list = [...all].sort((a, b) => (order.indexOf(a.id) < 0 ? 999 : order.indexOf(a.id)) - (order.indexOf(b.id) < 0 ? 999 : order.indexOf(b.id)));
  const isCustom = (id: string) => !!cfg.customDomains?.some((d) => d.id === id);
  const eff = (d: Domain): Domain => ({ ...d, ...(cfg.domains?.[d.id] ?? {}), widgets: cfg.domains?.[d.id]?.widgets ?? d.widgets, presets: cfg.domains?.[d.id]?.presets ?? d.presets }) as Domain;
  const setO = (id: string, patch: DomainOverride) => update((c) => ({ ...c, domains: { ...(c.domains ?? {}), [id]: { ...(c.domains?.[id] ?? {}), ...patch } } }));
  const setWidgets = (d: Domain, ws: Widget[]) => setO(d.id, { widgets: ws });
  const reorder = (i: number, dir: -1 | 1) => update((c) => ({ ...c, domainOrder: move(list.map((x) => x.id), i, dir) }));
  const addWorkspace = () => {
    const label = prompt('Name of the new workspace'); if (!label) return;
    const id = 'custom_' + label.toLowerCase().replace(/[^a-z0-9]+/g, '_').slice(0, 30) + '_' + Math.random().toString(36).slice(2, 5);
    update((c) => ({ ...c, customDomains: [...(c.customDomains ?? []), { id, label, icon: 'LayoutGrid', blurb: '', kpis: ['revenue', 'visits'], presets: [], widgets: [{ type: 'kpis', title: 'Headline', metrics: ['revenue', 'visits', 'new_clients', 'fill_rate'] }] }] }));
    setOpen(id);
  };
  return (
    <div className="space-y-2">
      <div className="mb-3 flex items-center justify-between"><p className="text-sm text-ink-3">Every expert workspace tab. Hide or rename tabs, reorder them, and add, edit, hide, reorder or delete any widget on them.</p><button onClick={addWorkspace} className="tool !h-9 gap-1.5 !px-3 text-xs"><Plus size={14} />Add workspace</button></div>
      {list.map((d0, i) => {
        const d = eff(d0); const I = domainIcon(d.icon); const o = cfg.domains?.[d.id] ?? {};
        const hidden = isCustom(d.id) ? !!cfg.customDomains?.find((x) => x.id === d.id)?.hidden || !!o.hidden : !!o.hidden;
        return (
          <div key={d.id} className={clsx('panel p-0', hidden && 'opacity-70')}>
            <div className="flex items-center gap-2 p-3">
              <button onClick={() => setOpen(open === d.id ? null : d.id)} className="text-ink-3">{open === d.id ? <ChevronDown size={15} /> : <ChevronRight size={15} />}</button>
              <span className="panel-tile !h-8 !w-8"><I size={15} /></span>
              <input value={d.label} onChange={(e) => setO(d.id, { label: e.target.value })} className="field !h-8 w-56 font-semibold" />
              <span className="text-[11px] text-ink-3">{d.widgets.filter((w) => !w.hidden).length} widgets{isCustom(d.id) ? ' · custom' : ''}{hidden ? ' · hidden' : ''}</span>
              <div className="ml-auto flex gap-1">
                <Mini onClick={() => reorder(i, -1)} title="Move up"><ArrowUp size={13} /></Mini><Mini onClick={() => reorder(i, 1)} title="Move down"><ArrowDown size={13} /></Mini>
                <Tog on={!hidden} onClick={() => setO(d.id, { hidden: !hidden })} />
                {!isCustom(d.id) && <Mini onClick={() => update((c) => { const n = { ...(c.domains ?? {}) }; delete n[d.id]; return { ...c, domains: n }; })} title="Reset this workspace to default"><RotateCcw size={13} /></Mini>}
                {isCustom(d.id) && <Mini danger onClick={() => { if (confirm(`Delete the workspace "${d.label}"?`)) update((c) => ({ ...c, customDomains: (c.customDomains ?? []).filter((x) => x.id !== d.id) })); }} title="Delete workspace"><Trash2 size={13} /></Mini>}
              </div>
            </div>
            {open === d.id && (
              <div className="space-y-4 border-t border-line p-4">
                <div className="grid gap-3 md:grid-cols-[1fr_200px]">
                  <label className="text-xs text-ink-3">Description<input value={d.blurb} onChange={(e) => setO(d.id, { blurb: e.target.value })} className="field mt-1 w-full" /></label>
                  <label className="text-xs text-ink-3">Icon<select value={d.icon} onChange={(e) => setO(d.id, { icon: e.target.value })} className="field mt-1 w-full">{DOMAIN_ICON_NAMES.map((n) => <option key={n}>{n}</option>)}</select></label>
                </div>
                <div>
                  <div className="mb-2 flex items-center justify-between text-[11px] font-semibold uppercase tracking-wider text-ink-3">Widgets<button onClick={() => setEdit({ domain: d.id, index: null })} className="flex items-center gap-1 normal-case tracking-normal text-accent"><Plus size={12} />Add widget</button></div>
                  <div className="divide-y divide-line/70 rounded-xl border border-line">{d.widgets.map((w, wi) => (
                    <div key={wi} className={clsx('flex items-center gap-2 px-3 py-2 text-sm', w.hidden && 'opacity-50')}>
                      <span className="w-24 shrink-0 text-[11px] text-ink-3">{WIDGET_TYPES.find((t) => t[0] === w.type)?.[1] ?? w.type}{w.chart ? ` · ${w.chart}` : ''}</span>
                      <input value={w.title} onChange={(e) => setWidgets(d, d.widgets.map((x, j) => (j === wi ? { ...x, title: e.target.value } : x)))} className="field !h-7 flex-1" />
                      <span className="hidden max-w-[260px] truncate text-[11px] text-ink-3 lg:inline">{(w.metrics ?? [w.metric, ...(w.extra ?? [])]).filter(Boolean).join(', ')}</span>
                      <Mini onClick={() => setWidgets(d, move(d.widgets, wi, -1))}><ArrowUp size={12} /></Mini><Mini onClick={() => setWidgets(d, move(d.widgets, wi, 1))}><ArrowDown size={12} /></Mini>
                      <Tog on={!w.hidden} onClick={() => setWidgets(d, d.widgets.map((x, j) => (j === wi ? { ...x, hidden: !x.hidden } : x)))} />
                      {w.type !== 'analysis' && <Mini onClick={() => setEdit({ domain: d.id, index: wi })} title="Edit"><Pencil size={12} /></Mini>}
                      <Mini danger onClick={() => { if (confirm(`Delete the widget "${w.title}"?`)) setWidgets(d, d.widgets.filter((_, j) => j !== wi)); }} title="Delete"><Trash2 size={12} /></Mini>
                    </div>
                  ))}</div>
                </div>
                <label className="block text-xs text-ink-3">“Ask the expert” questions (one per line)<textarea value={d.presets.join('\n')} onChange={(e) => setO(d.id, { presets: e.target.value.split('\n').filter((x) => x.trim()) })} className="field mt-1 h-28 w-full py-2" /></label>
                <label className="block text-xs text-ink-3"><span className="flex items-center gap-1"><Brain size={12} />Expert brief for the AI in this workspace</span><textarea value={d.expert ?? ''} onChange={(e) => setO(d.id, { expert: e.target.value })} className="field mt-1 h-36 w-full py-2 font-mono text-[11.5px]" /></label>
              </div>
            )}
          </div>
        );
      })}
      {edit && (() => {
        const d = eff(all.find((x) => x.id === edit.domain)!);
        const w = edit.index === null ? { type: 'table', title: 'New widget', metrics: ['revenue'], dimensions: ['location'] } as Widget : d.widgets[edit.index];
        return <WidgetEditor data={data} initial={w} onClose={() => setEdit(null)} onSave={(nw) => { setWidgets(d, edit.index === null ? [...d.widgets, nw] : d.widgets.map((x, j) => (j === edit.index ? nw : x))); setEdit(null); }} />;
      })()}
    </div>
  );
}

function WidgetEditor({ data, initial, onSave, onClose }: { data: AdminData; initial: Widget; onSave: (w: Widget) => void; onClose: () => void }) {
  const [w, setW] = useState<Widget>(() => ({ ...initial, metrics: initial.metrics ?? (initial.metric ? [initial.metric, ...(initial.extra ?? [])] : []), dimensions: initial.dimensions ?? (initial.dimension ? [initial.dimension] : []) }));
  const [q, setQ] = useState('');
  const metrics = data.defaults.metrics;
  const ds = new Set(w.metrics?.map((m) => metrics.find((x) => x.id === m)?.dataset).filter(Boolean));
  const dims = [...new Set(data.datasets.filter((d) => !ds.size || ds.has(d.id)).flatMap((d) => d.dimensions))];
  const toggle = (k: 'metrics' | 'dimensions', v: string) => setW((x) => ({ ...x, [k]: (x[k] ?? []).includes(v) ? (x[k] ?? []).filter((y) => y !== v) : [...(x[k] ?? []), v] }));
  const finish = () => {
    const m = w.metrics ?? []; const dd = w.dimensions ?? [];
    const base = { title: w.title, section: w.section || undefined, span: w.span, hidden: w.hidden };
    if (w.type === 'kpis') return onSave({ ...base, type: 'kpis', metrics: m });
    if (w.type === 'chart') return onSave({ ...base, type: 'chart', metrics: m, dimension: dd[0], chart: w.chart ?? 'line' });
    if (w.type === 'ranking') return onSave({ ...base, type: 'ranking', metric: m[0], extra: m.slice(1), dimension: dd[0] ?? 'location', limit: w.limit ?? 10 });
    if (w.type === 'mom') return onSave({ ...base, type: 'mom', metrics: m, dimension: dd[0] });
    return onSave({ ...base, type: 'table', metrics: m, dimensions: dd.length ? dd : ['location'], view: w.view ?? 'table', limit: w.limit ?? 50 });
  };
  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/40 p-6" onMouseDown={onClose}>
      <div className="pop-in flex max-h-[86vh] w-[900px] max-w-full flex-col overflow-hidden rounded-3xl border border-line bg-surface shadow-2xl" onMouseDown={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-3 border-b border-line px-5 py-3"><div className="font-semibold">{initial.title ? 'Edit widget' : 'New widget'}</div><button onClick={onClose} className="tool ml-auto !h-8 !min-w-8 !px-2"><X size={15} /></button></div>
        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-5 text-sm">
          <div className="grid gap-3 md:grid-cols-4">
            <label className="text-xs text-ink-3 md:col-span-2">Title<input value={w.title} onChange={(e) => setW({ ...w, title: e.target.value })} className="field mt-1 w-full" /></label>
            <label className="text-xs text-ink-3">Type<select value={w.type} onChange={(e) => setW({ ...w, type: e.target.value })} className="field mt-1 w-full">{WIDGET_TYPES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></label>
            <label className="text-xs text-ink-3">Width<select value={w.span ?? 1} onChange={(e) => setW({ ...w, span: Number(e.target.value) as 1 | 2 })} className="field mt-1 w-full"><option value={1}>Half</option><option value={2}>Full</option></select></label>
            {w.type === 'chart' && <label className="text-xs text-ink-3">Chart<select value={w.chart ?? 'line'} onChange={(e) => setW({ ...w, chart: e.target.value })} className="field mt-1 w-full">{CHARTS.map((c) => <option key={c}>{c}</option>)}</select></label>}
            {w.type === 'table' && <label className="text-xs text-ink-3">View<select value={w.view ?? 'table'} onChange={(e) => setW({ ...w, view: e.target.value })} className="field mt-1 w-full">{VIEWS.map((c) => <option key={c}>{c}</option>)}</select></label>}
            {(w.type === 'table' || w.type === 'ranking') && <label className="text-xs text-ink-3">Rows<input type="number" min={1} max={500} value={w.limit ?? (w.type === 'ranking' ? 10 : 50)} onChange={(e) => setW({ ...w, limit: Number(e.target.value) })} className="field mt-1 w-full" /></label>}
            <label className="text-xs text-ink-3">Section (optional)<input value={w.section ?? ''} onChange={(e) => setW({ ...w, section: e.target.value })} placeholder="e.g. Breakdowns" className="field mt-1 w-full" /></label>
          </div>
          <div>
            <div className="mb-1.5 flex items-center gap-2 text-xs text-ink-3">Metrics <b className="text-ink">{w.metrics?.join(', ') || 'none'}</b>{w.type === 'ranking' && <em>(first one ranks)</em>}<div className="relative ml-auto"><Search size={12} className="absolute left-2 top-2 text-ink-3" /><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search metrics" className="field !h-7 w-52 pl-6" /></div></div>
            <div className="grid max-h-56 grid-cols-3 gap-1 overflow-y-auto rounded-xl border border-line p-2">{metrics.filter((m) => !q || `${m.label} ${m.id}`.toLowerCase().includes(q.toLowerCase())).map((m) => (
              <button key={m.id} onClick={() => toggle('metrics', m.id)} className={clsx('truncate rounded-md px-2 py-1 text-left text-xs', w.metrics?.includes(m.id) ? 'bg-accent-soft font-semibold text-accent' : 'hover:bg-surface-2')}>{m.label} <span className="text-ink-3">· {m.dataset}</span></button>
            ))}</div>
          </div>
          {w.type !== 'kpis' && (
            <div>
              <div className="mb-1.5 text-xs text-ink-3">{w.type === 'table' ? 'Break down by (one or two)' : 'Split by (optional)'} <b className="text-ink">{w.dimensions?.join(', ') || 'none'}</b></div>
              <div className="flex flex-wrap gap-1">{dims.map((k) => <button key={k} onClick={() => toggle('dimensions', k)} className={clsx('rounded-full border px-2.5 py-0.5 text-xs', w.dimensions?.includes(k) ? 'border-accent bg-accent-soft text-accent' : 'border-line')}>{data.dimensions[k]?.label ?? k}</button>)}</div>
            </div>
          )}
        </div>
        <div className="flex justify-end gap-2 border-t border-line px-5 py-3"><button onClick={onClose} className="tool !h-9 !px-4 text-xs">Cancel</button><button disabled={!w.metrics?.length || !w.title.trim()} onClick={finish} className="btn-brand h-9 rounded-lg px-5 text-xs font-semibold text-white disabled:opacity-40">Save widget</button></div>
      </div>
    </div>
  );
}

/* ═════════ navigation ═════════ */
function NavTab({ cfg, update }: { cfg: Config; update: (fn: (c: Config) => Config) => void }) {
  const order = cfg.nav?.order ?? [];
  const items = [...NAV_ITEMS].sort((a, b) => (order.indexOf(a[0]) < 0 ? 999 : order.indexOf(a[0])) - (order.indexOf(b[0]) < 0 ? 999 : order.indexOf(b[0])));
  const setNav = (patch: NonNullable<Config['nav']>) => update((c) => ({ ...c, nav: { ...(c.nav ?? {}), ...patch } }));
  return (
    <div className="max-w-[760px] space-y-2">
      <p className="mb-3 text-sm text-ink-3">Sidebar pages under Library and Data &amp; admin. Workspace tabs are managed under Workspaces. Hidden pages disappear for everyone (the Admin console always stays available to admins).</p>
      {items.map(([to, label], i) => {
        const hidden = !!cfg.nav?.hidden?.includes(to);
        return (
          <div key={to} className={clsx('panel flex items-center gap-2 p-3', hidden && 'opacity-60')}>
            <span className="w-36 text-xs text-ink-3">{to}</span>
            <input value={cfg.nav?.labels?.[to] ?? label} onChange={(e) => setNav({ labels: { ...(cfg.nav?.labels ?? {}), [to]: e.target.value } })} className="field !h-8 flex-1" />
            <Mini onClick={() => setNav({ order: move(items.map((x) => x[0]), i, -1) })}><ArrowUp size={13} /></Mini><Mini onClick={() => setNav({ order: move(items.map((x) => x[0]), i, 1) })}><ArrowDown size={13} /></Mini>
            <Tog on={!hidden} onClick={() => setNav({ hidden: hidden ? (cfg.nav?.hidden ?? []).filter((x) => x !== to) : [...(cfg.nav?.hidden ?? []), to] })} />
          </div>
        );
      })}
      <button onClick={() => update((c) => ({ ...c, nav: {} }))} className="tool mt-2 !h-8 gap-1.5 !px-3 text-xs"><RotateCcw size={13} />Reset navigation</button>
    </div>
  );
}

/* ═════════ metrics ═════════ */
function MetricsTab({ data, cfg, update }: { data: AdminData; cfg: Config; update: (fn: (c: Config) => Config) => void }) {
  const [q, setQ] = useState('');
  const set = (id: string, patch: { label?: string; description?: string; hidden?: boolean }) => update((c) => ({ ...c, metrics: { ...(c.metrics ?? {}), [id]: { ...(c.metrics?.[id] ?? {}), ...patch } } }));
  const list = data.defaults.metrics.filter((m) => !q || `${m.label} ${m.id} ${m.dataset}`.toLowerCase().includes(q.toLowerCase()));
  return (
    <div>
      <div className="mb-3 flex items-center gap-3"><p className="flex-1 text-sm text-ink-3">Rename metrics and rewrite their definitions everywhere they appear (tables, cards, reports, the AI analyst), or hide them from pickers. Calculations stay governed.</p>
        <div className="relative"><Search size={13} className="absolute left-2.5 top-2.5 text-ink-3" /><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search metrics" className="field !h-9 w-64 pl-8" /></div></div>
      <div className="panel divide-y divide-line/70 p-0">{list.map((m) => { const o = cfg.metrics?.[m.id] ?? {}; return (
        <div key={m.id} className={clsx('grid grid-cols-[180px_220px_1fr_auto] items-start gap-3 px-4 py-2.5', o.hidden && 'opacity-50')}>
          <div className="pt-1.5 text-[11px] text-ink-3"><div className="font-mono text-ink-2">{m.id}</div>{m.dataset} · {m.format}</div>
          <input value={o.label ?? m.label} onChange={(e) => set(m.id, { label: e.target.value })} className="field !h-8 w-full" />
          <textarea value={o.description ?? m.description} onChange={(e) => set(m.id, { description: e.target.value })} className="field h-16 w-full py-1.5 text-xs" />
          <div className="flex gap-1 pt-0.5"><Tog on={!o.hidden} onClick={() => set(m.id, { hidden: !o.hidden })} /><Mini onClick={() => update((c) => { const n = { ...(c.metrics ?? {}) }; delete n[m.id]; return { ...c, metrics: n }; })} title="Reset"><RotateCcw size={13} /></Mini></div>
        </div>); })}</div>
    </div>
  );
}

/* ═════════ report topics ═════════ */
function TopicsTab({ data, cfg, update }: { data: AdminData; cfg: Config; update: (fn: (c: Config) => Config) => void }) {
  const set = (id: string, patch: { title?: string; blurb?: string; hidden?: boolean }) => update((c) => ({ ...c, topics: { ...(c.topics ?? {}), [id]: { ...(c.topics?.[id] ?? {}), ...patch } } }));
  return (
    <div className="space-y-2">
      <p className="mb-3 text-sm text-ink-3">Topics offered in the custom report builder.</p>
      {data.topics.map((t) => { const o = cfg.topics?.[t.id] ?? {}; return (
        <div key={t.id} className={clsx('panel grid grid-cols-[150px_260px_1fr_auto] items-start gap-3 p-3', o.hidden && 'opacity-50')}>
          <span className="pt-2 font-mono text-[11px] text-ink-3">{t.id}</span>
          <input value={o.title ?? t.title} onChange={(e) => set(t.id, { title: e.target.value })} className="field !h-8" />
          <textarea value={o.blurb ?? t.blurb} onChange={(e) => set(t.id, { blurb: e.target.value })} className="field h-14 py-1.5 text-xs" />
          <Tog on={!o.hidden} onClick={() => set(t.id, { hidden: !o.hidden })} />
        </div>); })}
    </div>
  );
}

/* ═════════ templates ═════════ */
function TemplatesTab({ data, cfg, update }: { data: AdminData; cfg: Config; update: (fn: (c: Config) => Config) => void }) {
  const rts = cfg.reportTemplates ?? DEFAULT_REPORT_TEMPLATES;
  const ats = cfg.analystTemplates ?? DEFAULT_ANALYST_TEMPLATES;
  const setR = (l: StoredReportTemplate[]) => update((c) => ({ ...c, reportTemplates: l }));
  const setA = (l: (Template & { hidden?: boolean })[]) => update((c) => ({ ...c, analystTemplates: l }));
  return (
    <div className="space-y-8">
      <section>
        <div className="mb-2 flex items-center justify-between"><div className="font-semibold">Report templates</div>
          <div className="flex gap-2"><button onClick={() => setR([...rts, { id: 't' + Math.random().toString(36).slice(2, 8), name: 'New template', iconName: 'FileText', topics: ['sales'], preset: 'lm', title: 'New report', audience: 'leadership', depth: 'standard', blurb: '' }])} className="tool !h-8 gap-1 !px-3 text-xs"><Plus size={13} />Add</button>
            <button onClick={() => update((c) => ({ ...c, reportTemplates: null }))} className="tool !h-8 gap-1 !px-3 text-xs"><RotateCcw size={13} />Defaults</button></div></div>
        <div className="space-y-2">{rts.map((t, i) => (
          <div key={t.id} className={clsx('panel space-y-2 p-3', t.hidden && 'opacity-60')}>
            <div className="flex items-center gap-2">
              <select value={t.iconName} onChange={(e) => setR(rts.map((x, j) => (j === i ? { ...x, iconName: e.target.value } : x)))} className="field !h-8 w-32">{Object.keys(TEMPLATE_ICONS).map((n) => <option key={n}>{n}</option>)}</select>
              <input value={t.name} onChange={(e) => setR(rts.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))} className="field !h-8 flex-1 font-semibold" placeholder="Template name" />
              <Mini onClick={() => setR(move(rts, i, -1))}><ArrowUp size={13} /></Mini><Mini onClick={() => setR(move(rts, i, 1))}><ArrowDown size={13} /></Mini>
              <Tog on={!t.hidden} onClick={() => setR(rts.map((x, j) => (j === i ? { ...x, hidden: !x.hidden } : x)))} />
              <Mini danger onClick={() => setR(rts.filter((_, j) => j !== i))}><Trash2 size={13} /></Mini>
            </div>
            <div className="grid gap-2 md:grid-cols-4 text-xs">
              <input value={t.title} onChange={(e) => setR(rts.map((x, j) => (j === i ? { ...x, title: e.target.value } : x)))} className="field md:col-span-2" placeholder="Report title" />
              <select value={t.preset} onChange={(e) => setR(rts.map((x, j) => (j === i ? { ...x, preset: e.target.value } : x)))} className="field">{PRESETS.filter(([v]) => v !== 'custom' && v !== 'month').map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
              <select value={t.depth} onChange={(e) => setR(rts.map((x, j) => (j === i ? { ...x, depth: e.target.value as StoredReportTemplate['depth'] } : x)))} className="field"><option value="summary">Summary</option><option value="standard">Standard</option><option value="detailed">Detailed</option></select>
            </div>
            <textarea value={t.blurb} onChange={(e) => setR(rts.map((x, j) => (j === i ? { ...x, blurb: e.target.value } : x)))} className="field h-14 w-full py-1.5 text-xs" placeholder="Description" />
            <div className="flex flex-wrap gap-1">{data.topics.map((tp) => { const on = t.topics.includes(tp.id); return <button key={tp.id} onClick={() => setR(rts.map((x, j) => (j === i ? { ...x, topics: on ? x.topics.filter((y) => y !== tp.id) : [...x.topics, tp.id] } : x)))} className={clsx('rounded-full border px-2 py-0.5 text-[11px]', on ? 'border-accent bg-accent-soft text-accent' : 'border-line')}>{tp.title}</button>; })}</div>
          </div>
        ))}</div>
      </section>
      <section>
        <div className="mb-2 flex items-center justify-between"><div className="flex items-center gap-1.5 font-semibold"><MessageSquare size={14} />Analyst question templates</div>
          <div className="flex gap-2"><button onClick={() => setA([{ category: TEMPLATE_CATEGORIES[0], title: 'New template', prompt: '' }, ...ats])} className="tool !h-8 gap-1 !px-3 text-xs"><Plus size={13} />Add</button>
            <button onClick={() => update((c) => ({ ...c, analystTemplates: null }))} className="tool !h-8 gap-1 !px-3 text-xs"><RotateCcw size={13} />Defaults</button></div></div>
        <div className="space-y-2">{ats.map((t, i) => (
          <div key={i} className={clsx('panel grid grid-cols-[170px_1fr_auto] items-start gap-2 p-3', (t as { hidden?: boolean }).hidden && 'opacity-60')}>
            <select value={t.category} onChange={(e) => setA(ats.map((x, j) => (j === i ? { ...x, category: e.target.value } : x)))} className="field !h-8 text-xs">{TEMPLATE_CATEGORIES.map((c) => <option key={c}>{c}</option>)}</select>
            <div className="space-y-1.5"><input value={t.title} onChange={(e) => setA(ats.map((x, j) => (j === i ? { ...x, title: e.target.value } : x)))} className="field !h-8 w-full font-semibold" /><textarea value={t.prompt} onChange={(e) => setA(ats.map((x, j) => (j === i ? { ...x, prompt: e.target.value } : x)))} className="field h-16 w-full py-1.5 text-xs" placeholder="The question the analyst runs" /></div>
            <div className="flex gap-1"><Tog on={!(t as { hidden?: boolean }).hidden} onClick={() => setA(ats.map((x, j) => (j === i ? { ...x, hidden: !(x as { hidden?: boolean }).hidden } : x)))} /><Mini danger onClick={() => setA(ats.filter((_, j) => j !== i))}><Trash2 size={13} /></Mini></div>
          </div>
        ))}</div>
      </section>
    </div>
  );
}

/* ═════════ users ═════════ */
function UsersTab() {
  const me = useMe();
  const [users, setUsers] = useState<{ id: string; email: string; name: string; role: string; created_at: string }[]>([]);
  const [add, setAdd] = useState({ email: '', name: '', role: 'analyst', password: '' });
  const [msg, setMsg] = useState('');
  const load = () => api<typeof users>('/api/users').then(setUsers).catch((e) => setMsg((e as Error).message));
  useEffect(() => { load(); }, []);
  const act = async (fn: () => Promise<unknown>, ok: string) => { setMsg(''); try { await fn(); setMsg(ok); load(); } catch (e) { setMsg((e as Error).message); } };
  return (
    <div className="space-y-4">
      {msg && <div className="text-sm text-ink-2">{msg}</div>}
      <div className="panel flex flex-wrap items-end gap-2 p-4">
        <label className="text-xs text-ink-3">Email<input value={add.email} onChange={(e) => setAdd({ ...add, email: e.target.value })} className="field mt-1 w-56" /></label>
        <label className="text-xs text-ink-3">Name<input value={add.name} onChange={(e) => setAdd({ ...add, name: e.target.value })} className="field mt-1 w-44" /></label>
        <label className="text-xs text-ink-3">Role<select value={add.role} onChange={(e) => setAdd({ ...add, role: e.target.value })} className="field mt-1"><option value="admin">Admin</option><option value="analyst">Analyst</option><option value="viewer">Viewer</option></select></label>
        <label className="text-xs text-ink-3">Password (8+)<input type="password" value={add.password} onChange={(e) => setAdd({ ...add, password: e.target.value })} className="field mt-1 w-44" /></label>
        <button onClick={() => act(async () => { await api('/api/users', { method: 'POST', json: add }); setAdd({ email: '', name: '', role: 'analyst', password: '' }); }, 'User added.')} className="btn-brand h-8 rounded-lg px-4 text-xs font-semibold text-white"><Plus size={12} className="mr-1 inline" />Add user</button>
      </div>
      <div className="panel divide-y divide-line/70 p-0">{users.map((u) => <UserRow key={u.id} u={u} self={u.id === me?.id} onSave={(patch) => act(() => api(`/api/users/${u.id}`, { method: 'PUT', json: patch }), 'User updated.')} onDelete={() => { if (confirm(`Delete ${u.email}?`)) act(() => api(`/api/users/${u.id}`, { method: 'DELETE' }), 'User deleted.'); }} />)}</div>
    </div>
  );
}
function UserRow({ u, self, onSave, onDelete }: { u: { id: string; email: string; name: string; role: string; created_at: string }; self: boolean; onSave: (p: Record<string, string>) => void; onDelete: () => void }) {
  const [v, setV] = useState({ email: u.email, name: u.name, role: u.role, password: '' });
  const changed = v.email !== u.email || v.name !== u.name || v.role !== u.role || v.password;
  return (
    <div className="flex flex-wrap items-center gap-2 px-4 py-2.5 text-sm">
      <input value={v.email} onChange={(e) => setV({ ...v, email: e.target.value })} className="field !h-8 w-56" />
      <input value={v.name} onChange={(e) => setV({ ...v, name: e.target.value })} className="field !h-8 w-44" />
      <select value={v.role} disabled={self} onChange={(e) => setV({ ...v, role: e.target.value })} className="field !h-8"><option value="admin">Admin</option><option value="analyst">Analyst</option><option value="viewer">Viewer</option></select>
      <input type="password" value={v.password} onChange={(e) => setV({ ...v, password: e.target.value })} placeholder="New password" className="field !h-8 w-40" />
      <span className="text-[11px] text-ink-3">since {u.created_at.slice(0, 10)}{self ? ' · you' : ''}</span>
      <div className="ml-auto flex gap-1">
        <button disabled={!changed} onClick={() => onSave(Object.fromEntries(Object.entries(v).filter(([k, x]) => x && (k === 'password' || x !== (u as Record<string, string>)[k]))))} className="tool !h-8 gap-1 !px-3 text-xs disabled:opacity-40"><Save size={12} />Save</button>
        {!self && <Mini danger onClick={onDelete}><Trash2 size={13} /></Mini>}
      </div>
    </div>
  );
}

/* ═════════ saved content ═════════ */
type Item = { id: string; user_id: string; title: string | null; kind?: string; scope?: string; created_at: string };
function ContentTab() {
  const [data, setData] = useState<{ reports: Item[]; designs: Item[]; conversations: Item[]; saved: Item[]; users: { id: string; email: string }[] } | null>(null);
  const [kind, setKind] = useState<'reports' | 'designs' | 'conversations' | 'saved'>('reports');
  const [q, setQ] = useState('');
  const load = () => api<typeof data>('/api/admin/content').then(setData).catch(() => {});
  useEffect(() => { load(); }, []);
  const who = useMemo(() => new Map((data?.users ?? []).map((u) => [u.id, u.email])), [data]);
  const items = (data?.[kind] ?? []).filter((x) => !q || `${x.title} ${who.get(x.user_id)}`.toLowerCase().includes(q.toLowerCase()));
  const labels = { reports: 'Executive & custom reports', designs: 'Report designs', conversations: 'Analyst conversations', saved: 'Saved analyst reports' };
  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="seg">{(Object.keys(labels) as (keyof typeof labels)[]).map((k) => <button key={k} onClick={() => setKind(k)} className={clsx('h-7 px-3 text-xs', kind === k && 'on')}>{labels[k]} ({data?.[k]?.length ?? 0})</button>)}</div>
        <div className="relative ml-auto"><Search size={13} className="absolute left-2.5 top-2.5 text-ink-3" /><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search title or user" className="field !h-9 w-64 pl-8" /></div>
      </div>
      <div className="panel divide-y divide-line/70 p-0">
        {!items.length && <div className="p-4 text-sm text-ink-3">Nothing here.</div>}
        {items.map((x) => (
          <div key={x.id} className="flex items-center gap-3 px-4 py-2 text-sm">
            <span className="min-w-0 flex-1 truncate"><b className="text-ink">{x.title || '(untitled)'}</b>{x.kind && <span className="ml-2 text-[11px] text-ink-3">{x.kind}</span>}{x.scope && <span className="ml-2 text-[11px] text-ink-3">{x.scope}</span>}</span>
            <span className="text-[11px] text-ink-3">{who.get(x.user_id) ?? x.user_id} · {x.created_at.slice(0, 16)}</span>
            <Mini onClick={async () => { const t = prompt('New title', x.title ?? ''); if (t !== null) { await api(`/api/admin/content/${kind}/${x.id}`, { method: 'PUT', json: { title: t } }); load(); } }} title="Rename"><Pencil size={13} /></Mini>
            <Mini danger onClick={async () => { if (confirm(`Delete "${x.title || x.id}" permanently?`)) { await api(`/api/admin/content/${kind}/${x.id}`, { method: 'DELETE' }); load(); } }} title="Delete"><Trash2 size={13} /></Mini>
          </div>
        ))}
      </div>
    </div>
  );
}
