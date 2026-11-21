import { useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import clsx from 'clsx';
import {
  Layers, Sparkles, CalendarRange, MapPin, Loader2, CheckCircle2, AlertTriangle, Palette, Save, Zap, Plus, Trash2, FolderOpen, Check,
  IndianRupee, UserPlus, Megaphone, GraduationCap, Shapes, UserMinus, CalendarX, Compass, Building2, Users, HeartPulse, Wand2, ArrowRight, X, Brain, PenLine, Lightbulb, Trophy, LayoutTemplate, type LucideIcon,
} from 'lucide-react';
import { api } from '../lib/api';
import { useMe } from '../App';
import { ReportDocument } from '../components/report/ReportDocument';
import { LayoutPanel } from '../components/report/LayoutPanel';
import { ExportMenu } from '../components/report/ExportMenu';
import { PRESETS, lastMonthValue, periodLabelOf, range } from '../lib/periods';
import { BRAND } from '../lib/brand';
import { arrange, DEFAULT_LAYOUT, normLayout, type ReportData, type ReportInsights, type ReportLayout } from '../lib/report';

type Topic = { id: string; title: string; blurb: string };
type Saved = { insights: ReportInsights | null; layout: unknown; created_at: string; reused: boolean };
type SavedReport = ReportData & { saved?: Saved };
type LibItem = { id: string; label: string; scope: string; created_at: string; has_ai: boolean; title: string | null; topics: string | null };
type Depth = 'summary' | 'standard' | 'detailed';
type Audience = 'leadership' | 'managers' | 'sales' | 'investors';

const ICON: Record<string, LucideIcon> = { sales: IndianRupee, new_clients: UserPlus, leads: Megaphone, trainers: GraduationCap, classes: CalendarRange, formats: Shapes, churn: UserMinus, late: CalendarX, studios: Building2, associates: Users, clients: HeartPulse, road: Compass, brief: Lightbulb, trainer_ranking: Trophy, lead_channels: Megaphone };
const BUNDLES: { name: string; topics: string[]; title: string }[] = [
  { name: 'Monthly sales review', topics: ['sales', 'associates', 'studios'], title: 'Monthly sales review' },
  { name: 'Growth funnel', topics: ['leads', 'new_clients', 'clients'], title: 'Growth & conversion funnel' },
  { name: 'Retention & churn', topics: ['churn', 'clients', 'late'], title: 'Retention & churn review' },
  { name: 'Studio operations', topics: ['classes', 'trainers', 'formats'], title: 'Studio operations review' },
  { name: 'Sales team', topics: ['associates', 'leads', 'churn'], title: 'Sales team performance' },
];
/** One-click report templates: a fixed recipe of topics, period and audience. */
export const REPORT_TEMPLATES = [
  { id: 'trainers', name: 'Trainer Scorecard — YTD', icon: Trophy, topics: ['trainer_ranking'], preset: 'ytd', title: 'Trainer Performance Scorecard — YTD', audience: 'leadership' as const, depth: 'standard' as const,
    blurb: 'Five questions answered: who our top trainers are, revenue contribution, conversion and retention vs their client mix (net + %), top earners\u2019 conversion, and each studio — tiers A–D from a fair composite score.' },
  { id: 'lead_channels', name: 'Lead Channel & Source Analysis — YTD', icon: Megaphone, topics: ['lead_channels'], preset: 'ytd', title: 'Lead Channel & Source Analysis — YTD', audience: 'leadership' as const, depth: 'standard' as const,
    blurb: 'Leads → trials → purchasing members by channel and source, LTV, a studio × channel heatmap, then each studio with sources, monthly trends and AI recommendations.' },
];
const DEPTH: Record<Depth, Partial<ReportLayout>> = {
  summary: { detail: false, tableRows: 6, pages: { cover: true, exec: true, score: false, mom: false, defs: false } },
  standard: { detail: true, tableRows: 10, pages: { cover: true, exec: true, score: true, mom: false, defs: true } },
  detailed: { detail: true, tableRows: 12, pages: { cover: true, exec: true, score: true, mom: true, defs: true } },
};
const fmtWhen = (s: string) => new Date(s.replace(' ', 'T')).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

export default function CustomReports() {
  const me = useMe();
  const [topics, setTopics] = useState<Topic[]>([]);
  const [chosen, setChosen] = useState<string[]>([]);
  const [preset, setPreset] = useState<string>('lm');
  const [month, setMonth] = useState(lastMonthValue());
  const [custom, setCustom] = useState(range('l3'));
  const [locations, setLocations] = useState<string[]>([]);
  const [allLocs, setAllLocs] = useState<string[]>([]);
  const [title, setTitle] = useState('');
  const [audience, setAudience] = useState<Audience>('leadership');
  const [depth, setDepth] = useState<Depth>('standard');
  const [useAi, setUseAi] = useState(true);
  const [tier, setTier] = useState<'balanced' | 'deep'>('balanced');
  const [fresh, setFresh] = useState(false);
  const [briefs, setBriefs] = useState<string[]>([]);
  const [draft, setDraft] = useState('');

  const [data, setData] = useState<ReportData | null>(null);
  const [ins, setIns] = useState<ReportInsights | null>(null);
  const [layout, setLayoutState] = useState<ReportLayout>(DEFAULT_LAYOUT);
  const [savedInfo, setSavedInfo] = useState<Saved | null>(null);
  const [library, setLibrary] = useState<LibItem[]>([]);
  const [mode, setMode] = useState<'build' | 'view'>('build');
  const [building, setBuilding] = useState(false);
  const [aiLoading, setAiLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [customOpen, setCustomOpen] = useState(false);
  const [layoutState, setLayoutSave] = useState<'idle' | 'saving' | 'saved'>('idle');
  const docRef = useRef<HTMLDivElement>(null);
  const saveTimer = useRef<number | undefined>(undefined);

  const nav = useLocation();
  const navigate = useNavigate();
  const scroller = useRef<HTMLDivElement>(null);
  const scrollTop = () => setTimeout(() => scroller.current?.scrollTo({ top: 0, behavior: 'smooth' }), 30);
  const applyTemplate = (id: string, run = false) => {
    const t = REPORT_TEMPLATES.find((x) => x.id === id); if (!t) return;
    setChosen(t.topics); setBriefs([]); setPreset(t.preset); setTitle(t.title); setAudience(t.audience); setDepth(t.depth); setLocations([]); setMode('build');
    if (run) setTimeout(() => document.getElementById('cr-generate')?.click(), 50);
  };
  useEffect(() => { const st = nav.state as { template?: string; run?: boolean } | null; if (st?.template) applyTemplate(st.template, st.run); }, [nav.state]); // eslint-disable-line react-hooks/exhaustive-deps
  const loadLibrary = () => api<LibItem[]>('/api/report/saved?kind=custom').then(setLibrary).catch(() => {});
  useEffect(() => {
    api<Topic[]>('/api/report/topics').then(setTopics).catch(() => {});
    api<string[]>('/api/locations').then(setAllLocs).catch(() => {});
    loadLibrary();
    api<SavedReport | null>('/api/report/latest?kind=custom').then((r) => { if (r) { show(r); setMode('view'); } }).catch(() => {});
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  /** Open a saved report as it was left — numbers, commentary and layout; no AI call. */
  const show = (r: SavedReport) => {
    const { saved, ...d } = r;
    const base = saved?.layout ? normLayout(saved.layout) : normLayout({ ...DEPTH[d.request.depth ?? 'standard'] });
    // topic order is the report order
    const lead = [...(d.request.topics ?? []), ...(d.request.briefs ?? []).map((b, i) => b.id ?? `x${i + 1}`)];
    const order = [...lead, ...base.order.filter((x) => !lead.includes(x))];
    setData(d); setIns(saved?.insights ?? null); setSavedInfo(saved ?? null); setLayoutState({ ...base, order: saved?.layout ? base.order : order });
  };
  const setLayout = (l: ReportLayout) => {
    setLayoutState(l);
    if (!data) return;
    window.clearTimeout(saveTimer.current); setLayoutSave('saving');
    saveTimer.current = window.setTimeout(() => { api(`/api/report/${data.id}/layout`, { method: 'PUT', json: { layout: l } }).then(() => setLayoutSave('saved')).catch(() => setLayoutSave('idle')); }, 600);
  };
  const period = preset === 'custom' ? custom : preset === 'month' ? range('month', month) : range(preset);
  const toggle = (id: string) => setChosen((c) => (c.includes(id) ? c.filter((x) => x !== id) : [...c, id]));
  const addBrief = (t = draft) => { const v = t.trim(); if (v.length < 3 || briefs.length >= 6 || briefs.includes(v)) return; setBriefs((b) => [...b, v]); setDraft(''); };
  const autoTitle = !chosen.length && briefs.length ? (briefs[0].length > 60 ? `${briefs[0].slice(0, 57)}…` : briefs[0].charAt(0).toUpperCase() + briefs[0].slice(1)) : chosen.length ? (chosen.length <= 2 ? chosen.map((id) => topics.find((t) => t.id === id)?.title).join(' & ') : `${topics.find((t) => t.id === chosen[0])?.title} and ${chosen.length - 1} more`) : '';

  const generate = async () => {
    if (!chosen.length && !briefs.length) { setErr('Pick a topic or describe your own.'); return; }
    setBuilding(true); setErr(null);
    try {
      const layoutSeed = normLayout({ ...layout, ...DEPTH[depth], order: [...chosen, ...briefs.map((_, i) => `x${i + 1}`)], hidden: [] });
      const r = await api<SavedReport>('/api/report', { method: 'POST', json: { ...period, locations, kind: 'custom', topics: chosen, briefs: briefs.map((prompt) => ({ prompt })), tier: useAi ? tier : undefined, title: title.trim() || autoTitle, audience, depth, fresh, layout: layoutSeed } });
      show(r.saved?.layout ? r : { ...r, saved: { ...(r.saved as Saved), layout: layoutSeed } });
      setMode('view'); loadLibrary();
      if (!r.saved?.insights) writeCommentary(r.id, !useAi);
    } catch (e) { setErr((e as Error).message); } finally { setBuilding(false); }
  };
  const writeCommentary = async (id: string, rules = false, again = false) => {
    setAiLoading(true);
    try { setIns(await api<ReportInsights>(`/api/report/${id}/insights`, { method: 'POST', json: { tier, rules, fresh: again } })); loadLibrary(); }
    catch (e) { setErr(`Commentary: ${(e as Error).message}`); } finally { setAiLoading(false); }
  };
  const open = async (id: string) => { try { show(await api<SavedReport>(`/api/report/${id}`)); setMode('view'); } catch (e) { setErr((e as Error).message); } };
  const remove = async (id: string) => {
    await api(`/api/report/${id}`, { method: 'DELETE' }).catch(() => {});
    if (data?.id === id) { setData(null); setMode('build'); }
    loadLibrary();
  };
  const reuse = () => {
    if (!data) return;
    setChosen(data.request.topics ?? []); setBriefs((data.request.briefs ?? []).map((b) => b.prompt)); setTitle(data.request.title ?? ''); setAudience((data.request.audience as Audience) ?? 'leadership'); setDepth(data.request.depth ?? 'standard');
    setPreset('custom'); setCustom({ start: data.request.start, end: data.request.end }); setLocations(data.request.locations); setMode('build');
  };
  const view = useMemo(() => (data ? arrange(data, layout) : null), [data, layout]);
  const chip = (on: boolean) => clsx('rounded-full border px-3 py-1.5 text-xs transition', on ? 'border-accent bg-accent text-white shadow-sm' : 'border-line bg-surface hover:border-accent/50');
  const H = ({ n, icon: I, children }: { n: number; icon: LucideIcon; children: React.ReactNode }) => <div className="mb-3 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wider text-ink-3"><span className="flex h-5 w-5 items-center justify-center rounded-full bg-accent text-[10px] text-white">{n}</span><I size={13} className="text-accent" />{children}</div>;
  const rulesOnly = ins?.source === 'rules';

  return (
    <div className="flex h-full flex-col">
      <div className="page-hero px-8 pb-5 pt-7 no-print">
        <div className="relative z-[1] mx-auto flex max-w-[1240px] flex-wrap items-center gap-5">
          <div className="hero-icon flex h-14 w-14 items-center justify-center rounded-2xl"><Layers size={26} /></div>
          <div className="min-w-0">
            <div className="mb-1 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-accent"><Sparkles size={12} />Reporting</div>
            <h1 className="text-[28px] font-bold leading-tight text-ink">Custom reports</h1>
            <p className="mt-0.5 text-[13.5px] text-ink-3">Choose the topics, period, studios and audience — get a branded, A4-ready report with AI commentary, saved to your library and exportable in six formats.</p>
          </div>
          <div className="ml-auto flex items-center gap-2">
            {mode === 'view' && data ? (
              <>
                <button onClick={() => { setMode('build'); scrollTop(); }} className="tool !h-10 !px-3.5"><Plus size={15} />New report</button>
                <button onClick={() => navigate('/designer')} className="tool !h-10 !px-3.5"><LayoutTemplate size={15} />Designer</button>
                <button onClick={() => setCustomOpen((o) => !o)} className={clsx('tool !h-10 !px-3.5', customOpen && '!border-accent !text-accent')}><Palette size={15} />Customise</button>
                {(!ins || rulesOnly) && !aiLoading && me?.aiConfigured && <button onClick={() => writeCommentary(data.id, false, rulesOnly)} className="tool !h-10 !px-3.5"><Sparkles size={15} />{rulesOnly ? 'Add AI commentary' : 'Write commentary'}</button>}
                {view && <ExportMenu data={view} insights={ins} layout={layout} docRef={docRef} onError={setErr} />}
              </>
            ) : data ? <button onClick={() => setMode('view')} className="tool !h-10 !px-3.5"><FolderOpen size={15} />Back to report</button> : null}
          </div>
        </div>
      </div>

      <div ref={scroller} className="flex-1 overflow-y-auto">
        <div className="mx-auto max-w-[1240px] space-y-5 px-8 py-6">
          {err && <div className="no-print flex items-center gap-2 rounded-xl border border-bad/30 bg-bad/5 p-3 text-sm text-bad"><AlertTriangle size={15} />{err}<button className="ml-auto" onClick={() => setErr(null)}><X size={14} /></button></div>}

          {mode === 'build' && (
            <div className="grid gap-5 lg:grid-cols-[1fr_320px]">
              <div className="panel fade-up overflow-hidden no-print">
                <div className="relative h-28 overflow-hidden">
                  <img src={BRAND.banner} alt="" className="absolute inset-0 h-full w-full object-cover" style={{ objectPosition: 'center 60%' }} />
                  <div className="absolute inset-0" style={{ background: 'linear-gradient(90deg, rgb(13 15 40 / .92), rgb(13 15 40 / .55) 55%, rgb(13 15 40 / .15))' }} />
                  <div className="relative flex h-full items-center gap-4 px-6">
                    <img src={BRAND.logoOnDark} alt="Physique 57" className="h-12" />
                    <div className="text-white"><div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-white/70">Report builder</div><div className="text-lg font-semibold">What should this report cover?</div></div>
                  </div>
                </div>
                <div className="space-y-7 p-6">
                  <button onClick={() => navigate('/designer')} className="lift flex w-full items-center gap-4 rounded-2xl border border-accent/40 bg-accent-soft/60 p-4 text-left">
                    <span className="panel-tile !h-11 !w-11"><LayoutTemplate size={20} /></span>
                    <span className="min-w-0 flex-1"><span className="block font-semibold text-ink">Start with a wireframe</span><span className="text-[12.5px] text-ink-3">Design every page from placeholder layouts and fill them with any table, chart, list or metric card from any tab — plus titles, text, photos, animations and space for AI-written commentary.</span></span>
                    <ArrowRight size={16} className="text-accent" />
                  </button>
                  <div>
                    <div className="mb-2 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wider text-ink-3"><Sparkles size={13} className="text-accent" />Ready-made templates</div>
                    <div className="grid gap-2.5 md:grid-cols-2">{REPORT_TEMPLATES.map((t) => (
                      <div key={t.id} className="flex gap-3 rounded-2xl border border-accent/30 bg-gradient-to-br from-accent-soft to-surface p-3.5">
                        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-accent text-white"><t.icon size={18} /></span>
                        <div className="min-w-0 flex-1"><div className="text-[13.5px] font-semibold text-ink">{t.name}</div><div className="mt-0.5 text-[11.5px] leading-snug text-ink-3">{t.blurb}</div>
                          <div className="mt-2 flex gap-1.5"><button onClick={() => applyTemplate(t.id, true)} className="btn-brand inline-flex h-8 items-center gap-1.5 rounded-lg px-3 text-xs font-semibold text-white"><Sparkles size={12} />Generate now</button><button onClick={() => applyTemplate(t.id)} className="tool !h-8">Load &amp; adjust</button></div></div>
                      </div>
                    ))}</div>
                  </div>
                  <div>
                    <H n={1} icon={Layers}>Topics — pick chapters in the order you want them, or describe your own</H>
                    <div className="mb-3 flex flex-wrap items-center gap-1.5"><span className="mr-1 flex items-center gap-1 text-xs text-ink-3"><Wand2 size={12} />Quick start:</span>
                      {BUNDLES.map((b) => <button key={b.name} className={chip(b.topics.join() === chosen.join())} onClick={() => { setChosen(b.topics); setTitle(b.title); }}>{b.name}</button>)}
                      <button className={chip(false)} onClick={() => setChosen(topics.map((t) => t.id))}>Everything</button>
                      {chosen.length > 0 && <button className="text-xs text-ink-3 hover:text-ink" onClick={() => setChosen([])}>Clear</button>}
                    </div>
                    <div className="grid gap-2.5 sm:grid-cols-2 xl:grid-cols-3">
                      {topics.map((t) => {
                        const I = ICON[t.id] ?? Layers; const i = chosen.indexOf(t.id); const on = i >= 0;
                        return (
                          <button key={t.id} onClick={() => toggle(t.id)} className={clsx('group relative flex gap-3 rounded-2xl border p-3.5 text-left transition', on ? 'border-accent bg-accent-soft shadow-sm' : 'border-line bg-surface hover:border-accent/50')}>
                            <span className={clsx('flex h-9 w-9 shrink-0 items-center justify-center rounded-xl', on ? 'bg-accent text-white' : 'bg-surface-2 text-accent')}><I size={17} /></span>
                            <span className="min-w-0 pr-5"><span className="block text-[13.5px] font-semibold text-ink">{t.title}</span><span className="mt-0.5 block text-[11.5px] leading-snug text-ink-3">{t.blurb}</span></span>
                            {on && <span className="absolute right-2.5 top-2.5 flex h-5 min-w-5 items-center justify-center rounded-full bg-accent px-1 text-[10px] font-bold text-white">{i + 1}</span>}
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  <div className="rounded-2xl border border-dashed border-accent/40 bg-accent-soft/40 p-4">
                    <div className="mb-1 flex items-center gap-2 text-[13px] font-semibold text-ink"><PenLine size={15} className="text-accent" />Your own topics</div>
                    <p className="mb-3 text-[11.5px] text-ink-3">Describe anything you want covered, in plain English. Each one becomes its own section: {useAi && me?.aiConfigured ? 'the AI picks the right metrics, filters, charts and tables' : 'metrics are matched from your wording (turn on AI for smarter planning)'} — every number is still computed from your data.</p>
                    <div className="flex gap-2">
                      <textarea value={draft} onChange={(e) => setDraft(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); addBrief(); } }} rows={2} maxLength={400}
                        placeholder="e.g. How are evening powerCycle classes at Bandra filling, and who late-cancels most?" className="field min-h-[52px] flex-1 resize-none !py-2.5 text-sm" />
                      <button onClick={() => addBrief()} disabled={draft.trim().length < 3 || briefs.length >= 6} className="btn-brand inline-flex h-[52px] items-center gap-1.5 rounded-xl px-4 text-sm font-semibold text-white disabled:opacity-50"><Plus size={15} />Add</button>
                    </div>
                    <div className="mt-2 flex flex-wrap items-center gap-1.5"><span className="text-[11px] text-ink-3">Try:</span>
                      {['Which discount codes drive revenue, and do they lower average transaction value?', 'Weekend vs weekday class fill and class average by format', 'Which lead sources convert best to members?', 'Revenue and renewals from unlimited memberships by studio'].map((x) => <button key={x} onClick={() => addBrief(x)} className="rounded-full border border-line bg-surface px-2.5 py-1 text-[11px] text-ink-2 hover:border-accent/50">{x}</button>)}
                    </div>
                    {briefs.length > 0 && <div className="mt-3 space-y-1.5">{briefs.map((b, i) => (
                      <div key={b} className="flex items-start gap-2 rounded-xl border border-accent/30 bg-surface px-3 py-2 text-[13px]">
                        <span className="mt-0.5 flex h-5 min-w-5 items-center justify-center rounded-full bg-accent px-1 text-[10px] font-bold text-white">{chosen.length + i + 1}</span>
                        <span className="flex-1 text-ink">{b}</span>
                        <button onClick={() => setBriefs(briefs.filter((x) => x !== b))} className="text-ink-3 hover:text-bad"><X size={14} /></button>
                      </div>
                    ))}</div>}
                  </div>

                  <div className="grid gap-7 lg:grid-cols-2">
                    <div>
                      <H n={2} icon={CalendarRange}>Period</H>
                      <div className="flex flex-wrap gap-1.5">{PRESETS.map(([id, l]) => <button key={id} className={chip(preset === id)} onClick={() => setPreset(id)}>{l}</button>)}</div>
                      {preset === 'month' && <input type="month" value={month} max={lastMonthValue()} onChange={(e) => setMonth(e.target.value)} className="field mt-3 !h-10 w-48" />}
                      {preset === 'custom' && (
                        <div className="mt-3 flex items-center gap-2 text-sm">
                          <input type="date" value={custom.start} onChange={(e) => setCustom({ ...custom, start: e.target.value })} className="field !h-10" /><span className="text-ink-3">to</span>
                          <input type="date" value={custom.end} onChange={(e) => setCustom({ ...custom, end: e.target.value })} className="field !h-10" />
                        </div>
                      )}
                      <div className="mt-2 text-xs text-ink-3">Selected: <b className="text-ink">{periodLabelOf(period)}</b> · compared with the previous period, this year’s average and last year</div>
                    </div>
                    <div>
                      <H n={3} icon={MapPin}>Studios</H>
                      <div className="flex flex-wrap gap-1.5">
                        <button className={chip(locations.length === 0)} onClick={() => setLocations([])}>All studios</button>
                        {allLocs.map((l) => { const on = locations.includes(l); return <button key={l} className={chip(on)} onClick={() => setLocations(on ? locations.filter((x) => x !== l) : [...locations, l])}>{l}</button>; })}
                      </div>
                    </div>
                  </div>

                  <div>
                    <H n={4} icon={Brain}>Report details</H>
                    <div className="grid gap-4 lg:grid-cols-2">
                      <label className="block"><span className="text-[11px] font-medium text-ink-3">Title</span><input value={title} onChange={(e) => setTitle(e.target.value)} placeholder={autoTitle || 'e.g. Bandra growth review'} className="field mt-1 !h-10 w-full" /></label>
                      <div><span className="block text-[11px] font-medium text-ink-3">Written for</span>
                        <div className="seg mt-1 flex-wrap">{([['leadership', 'Leadership'], ['managers', 'Studio managers'], ['sales', 'Sales team'], ['investors', 'Investors']] as const).map(([v, l]) => <button key={v} className={clsx(audience === v && 'on')} onClick={() => setAudience(v)}>{l}</button>)}</div></div>
                      <div><span className="block text-[11px] font-medium text-ink-3">Depth</span>
                        <div className="seg mt-1">{([['summary', 'Summary'], ['standard', 'Standard'], ['detailed', 'Detailed']] as const).map(([v, l]) => <button key={v} className={clsx(depth === v && 'on')} onClick={() => setDepth(v)}>{l}</button>)}</div>
                        <div className="mt-1 text-[11px] text-ink-3">{depth === 'summary' ? 'KPIs, charts and commentary — no detail tables.' : depth === 'standard' ? 'Adds findings, detail tables and the scorecard.' : 'Everything, longer tables and the 14-month appendix.'}</div></div>
                      <div><span className="block text-[11px] font-medium text-ink-3">Commentary</span>
                        <div className="seg mt-1">{([[true, 'AI analyst'], [false, 'Rule-based (no AI tokens)']] as const).map(([v, l]) => <button key={String(v)} className={clsx(useAi === v && 'on')} onClick={() => setUseAi(v)}>{l}</button>)}</div>
                        {useAi && <div className="seg mt-1.5">{([['balanced', 'Standard (Sonnet)'], ['deep', 'Deepest (Opus)']] as const).map(([v, l]) => <button key={v} className={clsx(tier === v && 'on')} onClick={() => setTier(v)}>{l}</button>)}</div>}
                        {useAi && !me?.aiConfigured && <div className="mt-1 text-[11px] text-warn">AI key not configured — rule-based commentary will be used.</div>}</div>
                    </div>
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-3 border-t border-line bg-surface-2/40 px-6 py-4">
                  <button id="cr-generate" onClick={generate} disabled={building || (!chosen.length && !briefs.length)} className="btn-brand inline-flex h-11 items-center gap-2 rounded-xl px-6 text-sm font-semibold text-white disabled:opacity-60">{building ? <Loader2 size={16} className="animate-spin" /> : <Sparkles size={16} />}{building ? (briefs.length ? 'Planning your topics & curating…' : 'Curating report…') : 'Generate report'}</button>
                  <button onClick={() => setFresh((f) => !f)} className={clsx('flex h-11 items-center gap-2.5 rounded-xl border px-3.5 text-left text-xs transition', fresh ? 'border-accent bg-accent-soft' : 'border-line bg-surface')}>
                    <span className={clsx('relative h-5 w-9 rounded-full transition', fresh ? 'bg-accent' : 'bg-line')}><span className={clsx('absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-all', fresh ? 'left-[18px]' : 'left-0.5')} /></span>
                    <span><span className="flex items-center gap-1 font-semibold text-ink"><Zap size={12} className="text-accent" />Fresh report</span><span className="block text-[11px] text-ink-3">{fresh ? 'Recompute & rewrite commentary' : 'Reuse an identical saved report'}</span></span>
                  </button>
                  <span className="text-xs text-ink-3">{chosen.length || briefs.length ? [...chosen.map((id) => topics.find((t) => t.id === id)?.title), ...briefs.map((b) => `“${b.length > 40 ? `${b.slice(0, 38)}…` : b}”`)].join(' → ') : 'No topics selected yet'}</span>
                </div>
              </div>

              <aside className="panel fade-up h-fit p-4 no-print">
                <div className="mb-3 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wider text-ink-3"><FolderOpen size={13} className="text-accent" />Report library</div>
                {!library.length ? <div className="rounded-xl border border-dashed border-line p-4 text-center text-xs text-ink-3">Reports you generate are saved here — open them any time without spending AI tokens.</div> : (
                  <div className="space-y-2">{library.map((r) => {
                    const ts: string[] = (() => { try { return JSON.parse(r.topics ?? '[]'); } catch { return []; } })();
                    return (
                      <div key={r.id} className={clsx('group rounded-xl border p-3 transition hover:border-accent/50', data?.id === r.id ? 'border-accent bg-accent-soft' : 'border-line')}>
                        <button onClick={() => open(r.id)} className="block w-full text-left">
                          <div className="truncate text-[13px] font-semibold text-ink">{r.title || 'Custom report'}</div>
                          <div className="mt-0.5 truncate text-[11px] text-ink-3">{r.label} · {r.scope}</div>
                          <div className="mt-1.5 flex flex-wrap gap-1">{ts.slice(0, 5).map((t) => { const I = ICON[t] ?? Layers; return <span key={t} title={topics.find((x) => x.id === t)?.title} className="flex h-5 w-5 items-center justify-center rounded-md bg-surface-2 text-accent"><I size={11} /></span>; })}</div>
                        </button>
                        <div className="mt-2 flex items-center justify-between text-[10.5px] text-ink-3"><span>{fmtWhen(r.created_at)}{r.has_ai ? ' · AI' : ''}</span>
                          <span className="flex gap-1 opacity-0 transition group-hover:opacity-100"><button onClick={() => open(r.id)} className="tool !h-6 !min-w-6 !px-1.5"><ArrowRight size={12} /></button><button onClick={() => remove(r.id)} className="tool !h-6 !min-w-6 !px-1.5 hover:!text-bad"><Trash2 size={12} /></button></span></div>
                      </div>
                    );
                  })}</div>
                )}
              </aside>
            </div>
          )}

          {mode === 'view' && data && view && (
            <>
              <div className="no-print flex flex-wrap items-center gap-2 text-xs text-ink-3">
                <span className="chip"><Layers size={12} />{data.request.title || 'Custom report'}</span>
                <span className="chip"><CalendarRange size={12} />{data.period.label}</span>
                <span className="chip"><MapPin size={12} />{data.scope}</span>
                {aiLoading ? <span className="chip text-accent"><Loader2 size={12} className="animate-spin" />Writing commentary…</span>
                  : ins ? <span className="chip"><CheckCircle2 size={12} className="text-good" />{ins.source === 'ai' ? `Commentary by ${ins.model}` : 'Rule-based commentary'}</span> : null}
                {savedInfo && <span className="chip"><Save size={12} />Saved · {fmtWhen(savedInfo.created_at)}</span>}
                {layoutState === 'saving' ? <span className="chip"><Loader2 size={12} className="animate-spin" />Saving layout…</span> : layoutState === 'saved' ? <span className="chip"><Check size={12} className="text-good" />Layout saved</span> : null}
                <button onClick={reuse} className="chip hover:!border-accent"><Wand2 size={12} />Edit topics &amp; rebuild</button>
                <span className="ml-auto">Click any number for the records behind it</span>
              </div>
              <div ref={docRef} className="overflow-x-auto rounded-3xl bg-[#e8e8e3] py-10 dark:bg-[#1a1b20]">
                <ReportDocument data={view} insights={ins} aiLoading={aiLoading} layout={layout} />
              </div>
            </>
          )}
        </div>
      </div>
      {customOpen && data && <LayoutPanel layout={layout} data={data} onChange={setLayout} onClose={() => setCustomOpen(false)} />}
    </div>
  );
}
