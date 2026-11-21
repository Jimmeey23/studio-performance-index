import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import Review from './Review';
import clsx from 'clsx';
import { RefreshCw, MessageSquareText, LayoutDashboard, History, Sparkles, ArrowRight, SlidersHorizontal, ChevronDown, MapPin, CalendarRange, GitCompare, Clock, AlertTriangle, MousePointerClick, Gauge } from 'lucide-react';
import { api } from '../lib/api';
import type { Block, Conversation, DomainMeta, Result } from '../lib/types';
import { BlockView, KpiCards } from '../components/blocks/Blocks';
import { domainIcon } from '../lib/domainIcons';
import Analyst from './Analyst';
import { fmtPeriod } from '../lib/format';
import { savePref } from '../lib/prefs';
import { api as apiGet } from '../lib/api';
import { ClassExplorer } from '../components/ClassExplorer';

interface Widget {
  id: string; type: 'kpis' | 'chart' | 'table' | 'mom' | 'ranking' | 'analysis'; title: string; span?: 1 | 2;
  metrics?: string[]; metric?: string; dimension?: string; dimensions?: string[]; chart?: string; view?: string; tool?: string; block?: string;
  result?: Result; series?: Result; error?: string; section?: string;
}
interface Filters { start?: string; end?: string; locations: string[]; compare: 'previous_year' | 'previous_period' | 'none'; grain: 'week' | 'month' | 'quarter' }
interface Dashboard { domain: DomainMeta; filters: Filters; period: { start: string; end: string; trendStart: string; months: number }; widgets: Widget[]; generatedAt: string }

const iso = (d: Date) => d.toISOString().slice(0, 10);
function presetRange(id: string): { start?: string; end?: string } {
  const now = new Date();
  const y = now.getFullYear(), m = now.getMonth();
  const lastEnd = iso(new Date(Date.UTC(y, m, 0)));
  const back = (n: number) => iso(new Date(Date.UTC(y, m - n, 1)));
  switch (id) {
    case 'lm': return { start: back(1), end: lastEnd };
    case 'l3': return { start: back(3), end: lastEnd };
    case 'l6': return { start: back(6), end: lastEnd };
    case 'l12': return { start: back(12), end: lastEnd };
    case 'ytd': return { start: `${y}-01-01`, end: iso(new Date(Date.UTC(y, m, now.getDate()))) };
    case 'fy': { const fy = m >= 3 ? y : y - 1; return { start: `${fy}-04-01`, end: lastEnd }; }
    case 'mtd': return { start: iso(new Date(Date.UTC(y, m, 1))), end: iso(new Date(Date.UTC(y, m, now.getDate()))) };
    default: return {};
  }
}
const PRESETS = [['lm', 'Last month'], ['l3', 'Last 3 months'], ['l6', 'Last 6 months'], ['l12', 'Last 12 months'], ['ytd', 'Year to date'], ['fy', 'FY to date'], ['mtd', 'Month to date'], ['custom', 'Custom']] as const;

const DEFAULT_SECTION: Record<string, string> = { chart: 'Trends & mix', table: 'Breakdowns & leaderboards', ranking: 'Breakdowns & leaderboards', analysis: 'Deep-dive analyses', mom: 'Month-on-month' };
function sections(ws: Widget[]): [string, Widget[]][] {
  const m = new Map<string, Widget[]>();
  for (const w of ws) { if (w.type === 'kpis') continue; const k = w.section ?? DEFAULT_SECTION[w.type] ?? 'More'; m.set(k, [...(m.get(k) ?? []), w]); }
  return [...m.entries()];
}
const ok = (r: unknown): r is Result => !!r && !(r as { error?: string }).error && Array.isArray((r as Result).rows);

export default function Domain({ onConversationsChange }: { onConversationsChange: () => void }) {
  const { domainId = '' } = useParams();
  const [d, setD] = useState<Dashboard | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [params, setParams] = useSearchParams();
  type Tab = 'overview' | 'ask' | 'history' | 'review';
  const tab = (['overview', 'ask', 'history', 'review'].includes(params.get('tab') ?? '') ? params.get('tab') : 'overview') as Tab;
  // the tab lives in the URL so every tab — including the performance review — has a direct link
  const setTab = useCallback((t: Tab) => setParams((p) => { const n = new URLSearchParams(p); if (t === 'overview') n.delete('tab'); else n.set('tab', t); return n; }, { replace: true }), [setParams]);
  const [seed, setSeed] = useState<{ q: string; n: number } | undefined>();
  const [conv, setConv] = useState<string | undefined>();
  const [chatKey, setChatKey] = useState(0);
  const [history, setHistory] = useState<Conversation[]>([]);
  const [locations, setLocations] = useState<string[]>([]);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [preset, setPreset] = useState<string>('l3');
  const [draft, setDraft] = useState<Filters>({ ...presetRange('l3'), locations: [], compare: 'previous_year', grain: 'month' });

  const presetRef = useRef(preset); presetRef.current = preset;
  const load = useCallback((f: Filters, refresh = false) => {
    setLoading(true); setErr(null);
    savePref('workspace.filters', { ...f, preset: presetRef.current }); // remembered across workspaces and sessions
    api<Dashboard>(`/api/domains/${domainId}`, { method: 'POST', json: { filters: f, refresh } }).then(setD).catch((e) => setErr((e as Error).message)).finally(() => setLoading(false));
  }, [domainId]);
  useEffect(() => {
    setD(null); setConv(undefined); setSeed(undefined); setChatKey((k) => k + 1);
    apiGet<Record<string, unknown>>('/api/prefs').catch(() => ({} as Record<string, unknown>)).then((prefs) => {
      const st = prefs['workspace.filters'] as (Filters & { preset?: string }) | undefined;
      const pr = st?.preset ?? 'l3';
      const f: Filters = st ? { ...(pr === 'custom' ? { start: st.start, end: st.end } : presetRange(pr)), locations: st.locations ?? [], compare: st.compare ?? 'previous_year', grain: st.grain ?? 'month' } : { ...presetRange('l3'), locations: [], compare: 'previous_year', grain: 'month' };
      setPreset(pr); presetRef.current = pr; setDraft(f); load(f);
    });
    api<Conversation[]>(`/api/conversations?domain=${domainId}`).then(setHistory).catch(() => {});
  }, [domainId, load]);
  useEffect(() => { api<string[]>('/api/locations').then(setLocations).catch(() => {}); }, []);

  const askPreset = (q: string) => { setConv(undefined); setChatKey((k) => k + 1); setSeed({ q, n: Date.now() }); setTab('ask'); };
  const Icon = domainIcon(d?.domain.icon);
  const applied = d?.filters;
  const periodLabel = d ? `${fmtPeriod(d.period.start, 'day')} – ${fmtPeriod(d.period.end, 'day')}` : '';
  const scope = useMemo(() => (applied?.locations.length ? applied.locations.join(', ') : 'all locations'), [applied]);
  const apply = () => { load(draft); setFiltersOpen(false); };
  const askAbout = (w: Widget) => askPreset(`Analyse "${w.title}" for ${periodLabel} (${scope}${applied?.compare !== 'none' ? `, vs ${applied?.compare === 'previous_year' ? 'last year' : 'previous period'}` : ''}): what stands out, what's driving it and what should we do?`);

  const widgetBlock = (w: Widget): Block | null => {
    if (!ok(w.result)) return null;
    switch (w.type) {
      case 'chart': return { id: w.id, type: 'chart', title: w.title, result: w.result, chart: w.chart, series_by: w.dimension };
      case 'table': return { id: w.id, type: 'table', title: w.title, result: w.result, view: (w.view as Block['view']) ?? 'table', group_by: w.view === 'grouped' ? w.dimensions?.[0] : undefined };
      case 'ranking': return { id: w.id, type: 'table', title: w.title, result: w.result, view: 'ranked' };
      case 'mom': return { id: w.id, type: 'table', title: w.title, result: w.result, view: 'mom' };
      case 'analysis': return { id: w.id, type: (w.block ?? 'table') as Block['type'], title: w.title, result: w.result };
      default: return null;
    }
  };

  return (
    <div className="flex h-full flex-col">
      <div className="page-hero px-8 pb-5 pt-7">
        <div className="relative z-[1] mx-auto flex max-w-[1320px] flex-wrap items-center gap-5">
          <div className="hero-icon flex h-14 w-14 items-center justify-center rounded-2xl"><Icon size={26} /></div>
          <div className="min-w-0">
            <div className="mb-1 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-accent"><Sparkles size={12} />Expert workspace</div>
            <h1 className="text-[28px] font-bold leading-tight text-ink">{d?.domain.label ?? '…'}</h1>
            <p className="mt-0.5 max-w-2xl text-[13.5px] text-ink-3">{d?.domain.blurb}</p>
          </div>
          <div className="ml-auto tabs-pill">
            {([['overview', 'Overview', LayoutDashboard], ['ask', 'Ask the expert', MessageSquareText], ['history', `History${history.length ? ` · ${history.length}` : ''}`, History], ['review', 'Executive Performance Review', Gauge]] as const).map(([k, label, I]) => (
              <button key={k} onClick={() => setTab(k)} className={clsx(tab === k && 'on')}><I size={14} />{label}</button>
            ))}
          </div>
        </div>
      </div>

      {tab === 'review' && <div className="min-h-0 flex-1"><Review embedded /></div>}

      {tab === 'overview' && (
        <div className="flex-1 overflow-y-auto">
          <div className="mx-auto max-w-[1320px] space-y-4 px-8 py-6">
            {/* global filters */}
            <div className="panel overflow-visible">
              <button onClick={() => setFiltersOpen((o) => !o)} className="flex w-full flex-wrap items-center gap-2 px-4 py-3 text-left">
                <SlidersHorizontal size={15} className="text-accent" />
                <span className="text-sm font-semibold">Filters</span>
                <span className="ml-2 inline-flex items-center gap-1 chip"><CalendarRange size={12} />{periodLabel || '…'}</span>
                <span className="inline-flex items-center gap-1 chip"><MapPin size={12} />{scope}</span>
                <span className="inline-flex items-center gap-1 chip"><GitCompare size={12} />{applied?.compare === 'none' ? 'no comparison' : applied?.compare === 'previous_period' ? 'vs previous period' : 'vs last year'}</span>
                <span className="inline-flex items-center gap-1 chip"><Clock size={12} />trends by {applied?.grain ?? 'month'}</span>
                <span className="ml-auto flex items-center gap-2">
                  {loading && <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-line border-t-accent" />}
                  <ChevronDown size={16} className={clsx('text-ink-3 transition-transform', filtersOpen && 'rotate-180')} />
                </span>
              </button>
              {filtersOpen && (
                <div className="fade-up grid gap-5 border-t border-line px-4 py-4 lg:grid-cols-[1.4fr_1.4fr_1fr]">
                  <div>
                    <div className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-ink-3">Period</div>
                    <div className="flex flex-wrap gap-1.5">
                      {PRESETS.map(([id, label]) => <button key={id} onClick={() => { setPreset(id); if (id !== 'custom') setDraft({ ...draft, ...presetRange(id) }); }} className={clsx('rounded-full border px-3 py-1 text-xs transition', preset === id ? 'border-accent bg-accent text-white' : 'border-line hover:border-accent/50')}>{label}</button>)}
                    </div>
                    <div className="mt-3 flex items-center gap-2 text-xs">
                      <input type="date" value={draft.start ?? ''} onChange={(e) => { setPreset('custom'); setDraft({ ...draft, start: e.target.value }); }} className="h-8 rounded-lg border border-line bg-bg px-2 outline-none focus:border-accent" />
                      <span className="text-ink-3">to</span>
                      <input type="date" value={draft.end ?? ''} onChange={(e) => { setPreset('custom'); setDraft({ ...draft, end: e.target.value }); }} className="h-8 rounded-lg border border-line bg-bg px-2 outline-none focus:border-accent" />
                    </div>
                  </div>
                  <div>
                    <div className="mb-2 flex items-center justify-between text-[11px] font-semibold uppercase tracking-wider text-ink-3">Locations {draft.locations.length > 0 && <button onClick={() => setDraft({ ...draft, locations: [] })} className="normal-case tracking-normal text-accent">clear</button>}</div>
                    <div className="flex flex-wrap gap-1.5">
                      {locations.map((l) => { const on = draft.locations.includes(l); return <button key={l} onClick={() => setDraft({ ...draft, locations: on ? draft.locations.filter((x) => x !== l) : [...draft.locations, l] })} className={clsx('rounded-full border px-3 py-1 text-xs transition', on ? 'border-accent bg-accent-soft text-accent' : 'border-line hover:border-accent/50')}>{l}</button>; })}
                    </div>
                    <div className="mt-1.5 text-[11px] text-ink-3">{draft.locations.length ? `${draft.locations.length} selected` : 'All locations'}</div>
                  </div>
                  <div className="space-y-3">
                    <div>
                      <div className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-ink-3">Compare with</div>
                      <div className="inline-flex rounded-lg border border-line bg-bg/60 p-0.5">{([['previous_year', 'Last year'], ['previous_period', 'Prev period'], ['none', 'None']] as const).map(([v, l]) => <button key={v} onClick={() => setDraft({ ...draft, compare: v })} className={clsx('h-7 rounded-md px-2.5 text-xs', draft.compare === v ? 'bg-surface font-medium shadow-sm ring-1 ring-line' : 'text-ink-3')}>{l}</button>)}</div>
                    </div>
                    <div>
                      <div className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-ink-3">Trend grain</div>
                      <div className="inline-flex rounded-lg border border-line bg-bg/60 p-0.5">{(['week', 'month', 'quarter'] as const).map((v) => <button key={v} onClick={() => setDraft({ ...draft, grain: v })} className={clsx('h-7 rounded-md px-2.5 text-xs capitalize', draft.grain === v ? 'bg-surface font-medium shadow-sm ring-1 ring-line' : 'text-ink-3')}>{v}</button>)}</div>
                    </div>
                    <div className="flex gap-2 pt-1">
                      <button onClick={apply} className="btn-glow h-9 rounded-xl bg-ink px-4 text-sm font-medium text-bg">Apply filters</button>
                      <button onClick={() => { const f: Filters = { ...presetRange('l3'), locations: [], compare: 'previous_year', grain: 'month' }; setPreset('l3'); setDraft(f); load(f); }} className="h-9 rounded-xl border border-line px-3 text-sm text-ink-2 hover:bg-surface-2">Reset</button>
                    </div>
                  </div>
                </div>
              )}
            </div>

            {err && <div className="rounded-xl border border-bad/30 bg-bad/5 p-4 text-sm text-bad">{err}</div>}
            {!d && !err && <div className="grid gap-4">{[1, 2, 3].map((i) => <div key={i} className="shimmer h-40 rounded-2xl" />)}</div>}
            {d && (
              <div className={clsx('space-y-4 transition-opacity', loading && 'opacity-60')}>
                <div className="flex flex-wrap items-center gap-2 text-xs text-ink-3">
                  <MousePointerClick size={13} />Every number, bar and point opens the records behind it. Trends cover {fmtPeriod(d.period.trendStart, 'day')} – {fmtPeriod(d.period.end, 'day')}.
                  <button onClick={() => load(d.filters, true)} className="ml-auto inline-flex items-center gap-1.5 rounded-lg border border-line bg-surface px-2.5 py-1.5 text-xs text-ink-2 hover:bg-surface-2"><RefreshCw size={13} className={loading ? 'animate-spin' : ''} />Refresh</button>
                </div>
                {d.widgets.filter((w) => w.type === 'kpis').map((w) => ok(w.result) && <KpiCards key={w.id} result={w.result} series={ok(w.series) ? w.series : undefined} />)}
                <div className="panel p-5">
                  <div className="mb-3 flex items-center gap-2"><span className="panel-tile !h-7 !w-7"><Sparkles size={14} /></span><span className="panel-title">Ask the expert</span><span className="text-xs text-ink-3">one click runs a full analysis</span></div>
                  <div className="flex flex-wrap gap-2">
                    {d.domain.presets.map((q) => <button key={q} onClick={() => askPreset(q)} className="group inline-flex items-center gap-1.5 rounded-full bg-surface-2 px-3.5 py-2 text-[12.5px] text-ink-2 ring-1 ring-line/70 transition hover:bg-accent-soft hover:text-ink hover:ring-accent/40">{q}<ArrowRight size={12} className="text-ink-3 transition group-hover:translate-x-0.5 group-hover:text-accent" /></button>)}
                  </div>
                </div>
                {domainId === 'classes' && <ClassExplorer start={d.period.start} end={d.period.end} locations={d.filters.locations} />}
                {sections(d.widgets).map(([name, ws]) => (
                  <section key={name} className="space-y-4 pt-2">
                    <div className="section-title"><span className="dot" />{name}<span className="text-[11px] font-medium text-ink-3">{ws.length}</span></div>
                    <div className="grid gap-4 xl:grid-cols-2">
                      {ws.map((w) => {
                        const b = widgetBlock(w);
                        return (
                          <div key={w.id} className={clsx('min-w-0', (w.span === 2 || w.type === 'mom') && 'xl:col-span-2')}>
                            {b ? <BlockView block={b} onAsk={() => askAbout(w)} height={w.span === 2 ? 340 : 280} /> : (
                              <div className="panel p-5"><div className="panel-title mb-1">{w.title}</div><div className="flex items-center gap-1.5 text-xs text-warn"><AlertTriangle size={12} />{w.error ?? 'No data for this selection.'}</div></div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </section>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
      {tab === 'ask' && d && (
        <div className="min-h-0 flex-1">
          <Analyst key={chatKey} embedded domain={d.domain} conversationId={conv} seed={seed} onConversationsChange={() => { onConversationsChange(); api<Conversation[]>(`/api/conversations?domain=${domainId}`).then(setHistory); }} />
        </div>
      )}
      {tab === 'history' && (
        <div className="flex-1 overflow-y-auto">
          <div className="mx-auto max-w-[900px] space-y-2 px-8 py-6">
            {!history.length && <div className="py-10 text-center text-sm text-ink-3">No conversations with this expert yet.</div>}
            {history.map((c) => (
              <button key={c.id} onClick={() => { setConv(c.id); setSeed(undefined); setChatKey((k) => k + 1); setTab('ask'); }} className="lift flex w-full items-center gap-3 rounded-xl border border-line bg-surface px-4 py-3 text-left text-sm">
                <MessageSquareText size={15} className="text-ink-3" /><span className="flex-1 truncate">{c.title}</span><span className="text-xs text-ink-3">{c.updated_at.slice(0, 16)}</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
