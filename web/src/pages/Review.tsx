/**
 * Executive Performance Review — a live, studio-level senior-management review.
 * Pick a period and studio(s); the numbers are computed instantly and the AI
 * writes each part (at a glance + every section) once. Saved reviews reopen
 * as they were, and the most recently opened review is shown by default.
 */
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import clsx from 'clsx';
import {
  Activity, AlertTriangle, ArrowDownRight, ArrowUpRight, BookOpen, CalendarRange, Check, ChevronDown, Filter, Flag, GraduationCap, History, IndianRupee, Lightbulb,
  Link2, Loader2, MapPin, Minus, RefreshCw, Shapes, Sparkles, Target, Trash2, TrendingDown, TrendingUp, Trophy, UserMinus, Wand2, X, type LucideIcon,
} from 'lucide-react';
import { api } from '../lib/api';
import { useMe } from '../App';
import { fmt } from '../lib/format';
import type { Format, Result } from '../lib/types';
import { PRESETS, lastMonthValue, range } from '../lib/periods';
import { fmtDelta, fmtK, tone, type Kpi, type ReportPeriod } from '../lib/report';
import { BRAND } from '../lib/brand';
import { InteractiveChart } from '../components/blocks/Charts';
import { AdvancedTable } from '../components/blocks/AdvancedTable';
import { CountUp, Sparkline } from '../components/Animated';
import '../review.css';

/* ── types (mirror server/src/report/review.ts) ── */
type Chart = { id: string; title: string; chart: string; seriesBy?: string; y?: string[]; result: Result };
type Table = { id: string; title: string; result: Result; note?: string };
type List = { id: string; title: string; metric: string; format: Format; dimension: string; top: { name: string; value: number | null; sub?: string }[]; bottom: { name: string; value: number | null; sub?: string }[] };
type Section = {
  id: string; title: string; icon: string; lead: string; kicker: string; kpis: Kpi[]; charts: Chart[]; tables: Table[];
  funnels?: { title: string; steps: { label: string; value: number | null }[] }[];
  heatmap?: { rows: string[]; cols: string[]; cells: Record<string, { fill: number | null; classes: number }> };
  formats?: { format: string; kpis: Kpi[] }[];
  spotlight?: { name: string; classes: number; checkins: number; avg: number | null; fill: number | null }[];
  index?: { value: number | null; parts: { label: string; value: number | null; weight: number }[]; note: string };
  notes: Record<string, string>; ruleFindings: string[];
};
type Review = { id: string; generatedAt: string; request: { start: string; end: string; locations: string[] }; period: ReportPeriod; scope: string; cover: { photo: number; headlineKpis: Kpi[] };
  glance: { cards: Kpi[]; tables: Table[]; charts: Chart[]; lists: List[]; notes: Record<string, string> }; sections: Section[]; scorecard: Kpi[]; studios?: Table };
type Rec = { title: string; detail: string; owner: string; priority: 'high' | 'medium' | 'low' };
type SectionAI = { headline: string; summary: string; insights: string[]; findings: string[]; recommendations: Rec[]; notes: Record<string, string>; model?: string; source: 'ai' | 'rules'; at: string };
type GlanceAI = { headline: string; tagline: string; summary: string; insights: string[]; highlights: { section: string; text: string }[]; watch: string[]; notes: Record<string, string>; model?: string; source: 'ai' | 'rules'; at: string };
type AI = { glance?: GlanceAI; sections: Record<string, SectionAI> };
type Saved = { review: Review; ai: AI; created_at: string; updated_at: string; reused?: boolean };
type HistoryItem = { id: string; label: string; scope: string; created_at: string; updated_at: string; ai_parts: number };

const ICONS: Record<string, LucideIcon> = { IndianRupee, Activity, Filter, CalendarRange, GraduationCap, Shapes, UserMinus };
type Base = 'prev' | 'ytd' | 'ly';

/* ── small building blocks ── */
function useReveal() {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const root = ref.current; if (!root) return;
    const io = new IntersectionObserver((es) => es.forEach((e) => { if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); } }), { threshold: 0.08 });
    const scan = () => root.querySelectorAll('.epr-rv:not(.in)').forEach((el) => io.observe(el));
    scan(); const mo = new MutationObserver(scan); mo.observe(root, { childList: true, subtree: true });
    return () => { io.disconnect(); mo.disconnect(); };
  }, []);
  return ref;
}
const Shimmer = ({ lines = 3 }: { lines?: number }) => <div className="epr-shimmer">{Array.from({ length: lines }, (_, i) => <i key={i} style={{ width: `${92 - i * 11}%` }} />)}</div>;
function AiTag({ ai, loading }: { ai?: { source: string; model?: string }; loading?: boolean }) {
  if (loading) return <span className="epr-aitag busy"><Loader2 size={11} className="animate-spin" />Writing…</span>;
  if (!ai) return null;
  return <span className={clsx('epr-aitag', ai.source === 'ai' ? 'ai' : 'rules')}><Sparkles size={11} />{ai.source === 'ai' ? `AI · ${ai.model ?? 'Claude'}` : 'Computed'}</span>;
}
function Delta({ k, base, P }: { k: Kpi; base: Base; P: ReportPeriod }) {
  const c = base === 'prev' ? k.chg : base === 'ytd' ? k.chgYtd : k.chgLy;
  const t = tone(k, c); const I = c === null || c === 0 ? Minus : c > 0 ? ArrowUpRight : ArrowDownRight;
  const lab = base === 'prev' ? P.prevLabel : base === 'ytd' ? P.ytdLabel : P.lyLabel;
  return <span className={clsx('epr-delta', t > 0 ? 'good' : t < 0 ? 'bad' : 'flat')}><I size={12} />{fmtDelta(c, k.format)}<em>vs {lab}</em></span>;
}
function KpiCard({ k, base, P, i = 0, big }: { k: Kpi; base: Base; P: ReportPeriod; i?: number; big?: boolean }) {
  const vals = k.series.filter((v): v is number => v !== null);
  const t = tone(k, k.chg);
  const ref = base === 'prev' ? k.prev : base === 'ytd' ? k.ytd : k.ly;
  return (
    <div className={clsx('epr-kpi epr-rv', big && 'big')} style={{ transitionDelay: `${i * 45}ms` }} title={k.description}>
      <div className="epr-kpi-l">{k.label}</div>
      <div className="epr-kpi-v">{k.value === null ? '—' : <CountUp value={k.value} format={(n) => fmtK(n, k.format)} />}</div>
      <Delta k={k} base={base} P={P} />
      <div className="epr-kpi-ref">{base === 'prev' ? P.prevLabel : base === 'ytd' ? P.ytdLabel : P.lyLabel}: <b>{fmtK(ref, k.format)}</b></div>
      {vals.length > 2 && <div className="epr-kpi-spark"><Sparkline values={vals} height={30} color={t > 0 ? 'var(--epr-good)' : t < 0 ? 'var(--epr-bad)' : 'var(--accent)'} format={(n) => fmtK(n, k.format)} /></div>}
    </div>
  );
}
function Note({ text, loading }: { text?: string; loading?: boolean }) {
  if (loading && !text) return <div className="epr-note"><Shimmer lines={2} /></div>;
  if (!text) return null;
  return <div className="epr-note"><Lightbulb size={13} /><p>{text}</p></div>;
}
function ChartCard({ c, note, loading, h = 280, i = 0 }: { c: Chart; note?: string; loading?: boolean; h?: number; i?: number }) {
  return (
    <figure className="epr-card epr-rv" style={{ transitionDelay: `${i * 60}ms` }}>
      <figcaption className="epr-card-h"><TrendingUp size={14} />{c.title}</figcaption>
      <InteractiveChart result={c.result} chart={c.chart} seriesBy={c.seriesBy} y={c.y} height={h} minimal />
      <Note text={note} loading={loading} />
    </figure>
  );
}
function TableCard({ t, note, loading, rows = 8 }: { t: Table; note?: string; loading?: boolean; rows?: number }) {
  return (
    <div className="epr-card epr-rv">
      <div className="epr-card-h"><BookOpen size={14} />{t.title}</div>
      <div className="epr-table"><AdvancedTable result={t.result} compact pageSize={rows} /></div>
      <Note text={note ?? t.note} loading={loading} />
    </div>
  );
}
function Funnel({ f }: { f: { title: string; steps: { label: string; value: number | null }[] } }) {
  const max = Math.max(...f.steps.map((s) => s.value ?? 0), 1);
  return (
    <div className="epr-card epr-rv">
      <div className="epr-card-h"><Filter size={14} />{f.title}</div>
      <div className="epr-funnel">{f.steps.map((s, i) => {
        const prev = i ? f.steps[i - 1].value : null; const rate = prev && s.value !== null ? s.value / prev : null;
        return (
          <div key={s.label} className="epr-funnel-row" style={{ ['--w' as string]: `${Math.max(8, ((s.value ?? 0) / max) * 100)}%`, ['--d' as string]: `${i * 120}ms` }}>
            <div className="epr-funnel-bar"><b>{s.value === null ? '—' : fmt(s.value, 'number')}</b></div>
            <div className="epr-funnel-lab">{s.label}{rate !== null && <em>{(rate * 100).toFixed(1)}% of previous step</em>}</div>
          </div>
        );
      })}</div>
    </div>
  );
}
function Heat({ hm }: { hm: NonNullable<Section['heatmap']> }) {
  const vals = Object.values(hm.cells).map((c) => c.fill).filter((v): v is number => v !== null);
  const max = Math.max(...vals, 0.01);
  return (
    <div className="epr-card epr-rv">
      <div className="epr-card-h"><CalendarRange size={14} />Fill rate by weekday & hour</div>
      <div className="epr-heat-wrap"><table className="epr-heat"><thead><tr><th />{hm.cols.map((c) => <th key={c}>{c}</th>)}</tr></thead>
        <tbody>{hm.rows.map((r) => <tr key={r}><th>{r.slice(0, 3)}</th>{hm.cols.map((c) => { const cell = hm.cells[`${r}|${c}`]; if (!cell || cell.fill === null) return <td key={c} className="empty" />; const a = cell.fill / max;
          return <td key={c} title={`${r} ${c}: ${(cell.fill * 100).toFixed(0)}% fill · ${cell.classes} classes`} style={{ background: `color-mix(in srgb, var(--accent) ${Math.round(8 + a * 82)}%, transparent)`, color: a > 0.55 ? '#fff' : undefined }}>{Math.round(cell.fill * 100)}</td>; })}</tr>)}</tbody></table></div>
    </div>
  );
}
function Gauge({ v }: { v: number | null }) {
  const p = Math.max(0, Math.min(100, v ?? 0)); const C = 2 * Math.PI * 52;
  return (
    <svg viewBox="0 0 120 120" className="epr-gauge" aria-label={`Index ${v?.toFixed(1) ?? 'n/a'}`}>
      <circle cx="60" cy="60" r="52" className="trk" />
      <circle cx="60" cy="60" r="52" className="val" strokeDasharray={`${(p / 100) * C} ${C}`} />
      <text x="60" y="58" textAnchor="middle" className="n">{v === null ? '—' : v.toFixed(1)}</text>
      <text x="60" y="76" textAnchor="middle" className="l">of 100</text>
    </svg>
  );
}
function TopBottom({ lists }: { lists: List[] }) {
  const [i, setI] = useState(0); const [side, setSide] = useState<'top' | 'bottom'>('top');
  const l = lists[i]; if (!l) return null;
  const items = side === 'top' ? l.top : l.bottom;
  const max = Math.max(...items.map((x) => Math.abs(x.value ?? 0)), 1e-9);
  return (
    <div className="epr-card epr-rv epr-tb">
      <div className="epr-card-h"><Trophy size={14} />Top & bottom performers</div>
      <div className="epr-tb-ctrl">
        <div className="epr-seg">{lists.map((x, j) => <button key={x.id} className={clsx(j === i && 'on')} onClick={() => setI(j)}>{x.title}</button>)}</div>
        <div className="epr-seg sm"><button className={clsx(side === 'top' && 'on')} onClick={() => setSide('top')}><TrendingUp size={12} />Top 5</button><button className={clsx(side === 'bottom' && 'on')} onClick={() => setSide('bottom')}><TrendingDown size={12} />Bottom 5</button></div>
      </div>
      <div className="epr-tb-sub">Ranked by {l.metric.toLowerCase()}</div>
      <ol className="epr-tb-list" key={`${i}-${side}`}>{items.map((x, j) => (
        <li key={x.name} style={{ ['--d' as string]: `${j * 70}ms` }}>
          <span className={clsx('rk', side)}>{j + 1}</span>
          <div className="nm"><b>{x.name}</b>{x.sub && <em>{x.sub}</em>}<div className="bar"><i className={side} style={{ width: `${(Math.abs(x.value ?? 0) / max) * 100}%` }} /></div></div>
          <span className="v">{fmtK(x.value, l.format)}</span>
        </li>
      ))}</ol>
    </div>
  );
}
function Recs({ recs }: { recs: Rec[] }) {
  if (!recs.length) return null;
  return <div className="epr-recs">{recs.map((r, i) => (
    <div key={i} className={clsx('epr-rec epr-rv', r.priority)} style={{ transitionDelay: `${i * 60}ms` }}>
      <div className="epr-rec-n">{String(i + 1).padStart(2, '0')}</div>
      <div><div className="epr-rec-t">{r.title}<span className={clsx('pri', r.priority)}>{r.priority}</span></div><p>{r.detail}</p><div className="epr-rec-o"><Target size={11} />{r.owner}</div></div>
    </div>
  ))}</div>;
}

/* ═════════ page ═════════ */
export default function Review({ embedded }: { embedded?: boolean }) {
  const me = useMe();
  const { reviewId } = useParams();
  const navigate = useNavigate();
  const [saved, setSaved] = useState<Saved | null>(null);
  const [loading, setLoading] = useState(true);
  const [building, setBuilding] = useState(false);
  const [busy, setBusy] = useState<Set<string>>(new Set());
  const [err, setErr] = useState<string | null>(null);
  const [setup, setSetup] = useState(false);
  const [preset, setPreset] = useState('lm');
  const [month, setMonth] = useState(lastMonthValue());
  const [custom, setCustom] = useState(range('l3'));
  const [locs, setLocs] = useState<string[]>([]);
  const [allLocs, setAllLocs] = useState<string[]>([]);
  const [hist, setHist] = useState<HistoryItem[] | null>(null);
  const [histOpen, setHistOpen] = useState(false);
  const [base, setBase] = useState<Base>('prev');
  const [active, setActive] = useState('cover');
  const [copied, setCopied] = useState(false);
  const scroller = useRef<HTMLDivElement>(null);
  const revealRef = useReveal();
  const started = useRef<Set<string>>(new Set());

  const linkFor = (id: string) => `/review/${id}`;
  const show = useCallback((s: Saved, push = true) => {
    setSaved(s); setSetup(false); started.current = new Set();
    setPreset('custom'); setCustom({ start: s.review.request.start, end: s.review.request.end }); setLocs(s.review.request.locations);
    if (push && !embedded) navigate(linkFor(s.review.id), { replace: true });
    scroller.current?.scrollTo({ top: 0 });
  }, [embedded, navigate]);

  useEffect(() => { api<string[]>('/api/locations').then(setAllLocs).catch(() => {}); }, []);
  useEffect(() => {
    setLoading(true);
    (reviewId ? api<Saved>(`/api/review/${reviewId}`) : api<Saved | null>('/api/review/latest'))
      .then((s) => { if (s) show(s, false); else setSetup(true); }).catch((e) => { setErr((e as Error).message); setSetup(true); }).finally(() => setLoading(false));
  }, [reviewId]); // eslint-disable-line react-hooks/exhaustive-deps

  /** Write AI for every part that doesn't have it yet — three at a time; stored parts are never rewritten. */
  const writePart = useCallback(async (id: string, part: string, fresh = false) => {
    setBusy((b) => new Set(b).add(part));
    try {
      const r = await api<{ part: string; content: GlanceAI | SectionAI }>(`/api/review/${id}/ai`, { method: 'POST', json: { part, fresh } });
      setSaved((s) => (!s || s.review.id !== id ? s : { ...s, ai: part === 'glance' ? { ...s.ai, glance: r.content as GlanceAI } : { ...s.ai, sections: { ...s.ai.sections, [part]: r.content as SectionAI } } }));
    } catch (e) { setErr(`AI (${part}): ${(e as Error).message}`); } finally { setBusy((b) => { const n = new Set(b); n.delete(part); return n; }); }
  }, []);
  useEffect(() => {
    if (!saved) return;
    const id = saved.review.id;
    const todo = ['glance', ...saved.review.sections.map((s) => s.id)].filter((p) => !(p === 'glance' ? saved.ai.glance : saved.ai.sections?.[p]) && !started.current.has(`${id}:${p}`));
    if (!todo.length) return;
    todo.forEach((p) => started.current.add(`${id}:${p}`));
    let i = 0;
    const next = async (): Promise<void> => { const p = todo[i++]; if (!p) return; await writePart(id, p); return next(); };
    void Promise.all([next(), next(), next()]);
  }, [saved, writePart]);

  // scroll-spy for the section rail
  useEffect(() => {
    const root = scroller.current; if (!root || !saved) return;
    const io = new IntersectionObserver((es) => { const v = es.filter((e) => e.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0]; if (v) setActive(v.target.id.replace('epr-', '')); }, { root, rootMargin: '-30% 0px -60% 0px' });
    root.querySelectorAll('[data-spy]').forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, [saved]);

  const period = preset === 'custom' ? custom : preset === 'month' ? range('month', month) : range(preset);
  const generate = async (fresh = false) => {
    setBuilding(true); setErr(null);
    try { const s = await api<Saved>('/api/review', { method: 'POST', json: { ...period, locations: locs, fresh } }); show(s); }
    catch (e) { setErr((e as Error).message); } finally { setBuilding(false); }
  };
  const openHist = async () => { setHistOpen((o) => !o); try { setHist(await api<HistoryItem[]>('/api/review/saved')); } catch { /* */ } };
  const openSaved = async (id: string) => { setHistOpen(false); setLoading(true); try { show(await api<Saved>(`/api/review/${id}`)); } catch (e) { setErr((e as Error).message); } finally { setLoading(false); } };
  const delSaved = async (id: string) => { if (!confirm('Delete this review? This cannot be undone.')) return; await api(`/api/review/${id}`, { method: 'DELETE' }); setHist((h) => h?.filter((x) => x.id !== id) ?? null); if (saved?.review.id === id) { setSaved(null); setSetup(true); } };
  const copyLink = async () => { if (!saved) return; try { await navigator.clipboard.writeText(`${location.origin}${linkFor(saved.review.id)}`); setCopied(true); setTimeout(() => setCopied(false), 1600); } catch { /* */ } };
  const jump = (id: string) => document.getElementById(`epr-${id}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });

  const rv = saved?.review; const ai = saved?.ai; const P = rv?.period;
  const gl = ai?.glance;
  const nav = useMemo(() => rv ? [{ id: 'cover', title: 'Cover' }, { id: 'glance', title: 'At a glance' }, ...rv.sections.map((s) => ({ id: s.id, title: s.title }))] : [], [rv]);
  const chip = (on: boolean) => clsx('epr-chip', on && 'on');

  const controls = (
    <div className="epr-setup pop-in">
      <div className="epr-setup-row"><CalendarRange size={15} /><span className="epr-setup-l">Period</span>
        <div className="flex flex-wrap gap-1.5">{PRESETS.map(([k, l]) => <button key={k} className={chip(preset === k)} onClick={() => setPreset(k)}>{l}</button>)}</div>
      </div>
      {preset === 'month' && <div className="epr-setup-row"><span className="epr-setup-l pl-6">Month</span><input type="month" value={month} onChange={(e) => setMonth(e.target.value)} className="epr-input" /></div>}
      {preset === 'custom' && <div className="epr-setup-row"><span className="epr-setup-l pl-6">Range</span><input type="date" value={custom.start} onChange={(e) => setCustom({ ...custom, start: e.target.value })} className="epr-input" /><span className="text-ink-3">→</span><input type="date" value={custom.end} onChange={(e) => setCustom({ ...custom, end: e.target.value })} className="epr-input" /></div>}
      <div className="epr-setup-row"><MapPin size={15} /><span className="epr-setup-l">Studio</span>
        <div className="flex flex-wrap gap-1.5"><button className={chip(!locs.length)} onClick={() => setLocs([])}>All studios</button>{allLocs.map((l) => <button key={l} className={chip(locs.includes(l))} onClick={() => setLocs((x) => (x.includes(l) ? x.filter((y) => y !== l) : [...x, l]))}>{l}</button>)}</div>
      </div>
      <div className="epr-setup-row justify-end">
        <span className="mr-auto text-xs text-ink-3">{period.start} → {period.end} · {locs.length ? locs.join(', ') : 'all studios'} · full data, every section</span>
        {saved && <button className="tool !h-10" onClick={() => setSetup(false)}>Cancel</button>}
        <button className="epr-go" disabled={building} onClick={() => generate(false)}>{building ? <><Loader2 size={15} className="animate-spin" />Preparing review…</> : <><Wand2 size={15} />Prepare review</>}</button>
      </div>
    </div>
  );

  return (
    <div className={clsx('epr flex h-full flex-col', embedded && 'embedded')}>
      {/* toolbar */}
      <div className="epr-bar no-print">
        <div className="epr-bar-in">
          <div className="epr-bar-t"><Sparkles size={14} /><b>Executive Performance Review</b>{rv && P && <span>{P.label} · {rv.scope}</span>}</div>
          <div className="ml-auto flex flex-wrap items-center gap-2">
            {rv && <div className="epr-seg sm" title="Baseline used on every metric card"><button className={clsx(base === 'prev' && 'on')} onClick={() => setBase('prev')}>vs prev</button><button className={clsx(base === 'ytd' && 'on')} onClick={() => setBase('ytd')}>vs YTD avg</button><button className={clsx(base === 'ly' && 'on')} onClick={() => setBase('ly')}>vs last year</button></div>}
            <div className="relative">
              <button className="tool !h-9" onClick={openHist}><History size={14} />Past reviews<ChevronDown size={13} /></button>
              {histOpen && (
                <div className="epr-hist pop-in" onMouseLeave={() => setHistOpen(false)}>
                  {!hist ? <div className="p-3 text-xs text-ink-3">Loading…</div> : !hist.length ? <div className="p-3 text-xs text-ink-3">No reviews yet.</div> : hist.map((h) => (
                    <div key={h.id} className={clsx('epr-hist-i', h.id === rv?.id && 'on')}>
                      <button onClick={() => openSaved(h.id)} className="min-w-0 flex-1 text-left"><b>{h.label} · {h.scope}</b><span>{new Date(h.created_at.replace(' ', 'T')).toLocaleString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })} · {h.ai_parts} AI parts</span></button>
                      <button className="epr-x" title="Delete" onClick={() => delSaved(h.id)}><Trash2 size={13} /></button>
                    </div>
                  ))}
                </div>
              )}
            </div>
            {rv && <button className="tool !h-9" onClick={copyLink} title="Copy a direct link to this review">{copied ? <Check size={14} /> : <Link2 size={14} />}{copied ? 'Copied' : 'Link'}</button>}
            {rv && <button className="tool !h-9" onClick={() => generate(true)} title="Recompute the numbers from the latest data (AI is rewritten for the new review)"><RefreshCw size={14} />Refresh data</button>}
            <button className="epr-go sm" onClick={() => setSetup((o) => !o)}><Wand2 size={14} />New review</button>
          </div>
        </div>
        {err && <div className="epr-err"><AlertTriangle size={14} />{err}<button onClick={() => setErr(null)}><X size={13} /></button></div>}
      </div>

      <div ref={scroller} className="min-h-0 flex-1 overflow-y-auto">
        <div ref={revealRef} className="epr-wrap">
          {setup && controls}
          {loading && !rv && <div className="epr-loading"><Loader2 className="animate-spin" />Opening your latest review…</div>}
          {!loading && !rv && !setup && <div className="epr-empty"><Sparkles /><p>Pick a period and studio to prepare your first review.</p><button className="epr-go" onClick={() => setSetup(true)}>Get started</button></div>}

          {rv && P && (
            <div className="epr-doc">
              {/* section rail */}
              <nav className="epr-rail no-print">{nav.map((n, i) => (
                <button key={n.id} onClick={() => jump(n.id)} className={clsx(active === n.id && 'on')}>
                  <span className="dot">{busy.has(n.id) ? <Loader2 size={10} className="animate-spin" /> : i === 0 ? '◆' : String(i).padStart(2, '0')}</span><span className="t">{n.title}</span>
                </button>
              ))}</nav>

              <div className="epr-main">
                {/* ── cover ── */}
                <section id="epr-cover" data-spy className="epr-cover">
                  <img className="epr-cover-img" src={BRAND.photos[rv.cover.photo % BRAND.photos.length]} alt="" />
                  <div className="epr-cover-shade" />
                  <div className="epr-cover-in">
                    <div className="epr-cover-top"><img src={BRAND.logoOnDark} alt="Physique 57" /><span>Executive Performance Review<br /><em>Confidential · senior management</em></span></div>
                    <div className="epr-cover-mid">
                      <div className="epr-cover-k">{gl?.tagline ?? 'Studio performance review'}</div>
                      <h1>{gl ? gl.headline : <Shimmer lines={2} />}</h1>
                      <div className="epr-cover-meta"><span><MapPin size={13} />{rv.scope}</span><span><CalendarRange size={13} />{P.label}</span><span>Benchmarked vs {P.prevLabel}, {P.ytdLabel} and {P.lyLabel}</span></div>
                    </div>
                    <div className="epr-cover-kpis">{rv.cover.headlineKpis.map((k) => { const t = tone(k, k.chg); return (
                      <div key={k.id}><span>{k.label}</span><b>{fmtK(k.value, k.format)}</b><em className={t > 0 ? 'good' : t < 0 ? 'bad' : ''}>{fmtDelta(k.chg, k.format)} vs {P.prevLabel}</em></div>
                    ); })}</div>
                    <div className="epr-cover-foot">Prepared {new Date(rv.generatedAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' })} · figures computed from the synced studio data{gl?.source === 'ai' ? ` · commentary by ${gl.model ?? 'Claude'}` : ''}</div>
                  </div>
                </section>

                {/* ── at a glance ── */}
                <section id="epr-glance" data-spy className="epr-sec">
                  <SectionHead kicker="Overview" title="At a glance" icon={Sparkles} lead={`${rv.scope} · ${P.label} — every key metric and finding from the sections that follow.`} right={<PartActions part="glance" ai={gl} busy={busy.has('glance')} canAi={!!me?.aiConfigured} onRewrite={() => writePart(rv.id, 'glance', true)} />} />
                  <div className="epr-grid-k8">{rv.glance.cards.map((k, i) => <KpiCard key={k.id} k={k} base={base} P={P} i={i} />)}</div>
                  <div className="epr-split">
                    <div className="epr-prose epr-rv">{gl ? gl.summary.split(/\n\s*\n/).map((p, i) => <p key={i} className={i === 0 ? 'lead' : ''}>{p}</p>) : <Shimmer lines={7} />}</div>
                    <div className="epr-insights epr-rv"><div className="epr-card-h"><Lightbulb size={14} />Key insights</div>{gl ? <ol>{gl.insights.map((x, i) => <li key={i}>{x}</li>)}</ol> : <Shimmer lines={5} />}</div>
                  </div>
                  <div className="epr-highlights">{rv.sections.map((s, i) => { const I = ICONS[s.icon] ?? Sparkles; const h = gl?.highlights.find((x) => x.section === s.id)?.text ?? ai?.sections[s.id]?.headline ?? s.ruleFindings[0]; return (
                    <button key={s.id} className="epr-hl epr-rv" style={{ transitionDelay: `${i * 50}ms` }} onClick={() => jump(s.id)}><span className="ic"><I size={15} /></span><span className="t">{s.title}</span><p>{h ?? '…'}</p><span className="go">Read section →</span></button>
                  ); })}</div>
                  {!!gl?.watch?.length && <div className="epr-watch epr-rv"><AlertTriangle size={15} /><div><b>Watch-outs</b><ul>{gl.watch.map((w, i) => <li key={i}>{w}</li>)}</ul></div></div>}
                  <div className="epr-grid-2">{rv.glance.charts.slice(0, 2).map((c, i) => <ChartCard key={c.id} c={c} i={i} note={gl?.notes[c.id] ?? rv.glance.notes[c.id]} loading={busy.has('glance')} />)}</div>
                  <div className="epr-grid-2">
                    {rv.glance.lists.length > 0 && <TopBottom lists={rv.glance.lists} />}
                    {rv.glance.charts[2] && <ChartCard c={rv.glance.charts[2]} note={gl?.notes[rv.glance.charts[2].id] ?? rv.glance.notes[rv.glance.charts[2].id]} loading={busy.has('glance')} h={300} />}
                  </div>
                  <div className="epr-grid-2">{rv.glance.tables.slice(0, 4).map((t) => <TableCard key={t.id} t={t} rows={6} note={gl?.notes[t.id] ?? rv.glance.notes[t.id]} loading={busy.has('glance')} />)}</div>
                </section>

                {/* ── sections ── */}
                {rv.sections.map((s) => <ReviewSectionView key={s.id} s={s} ai={ai?.sections[s.id]} busy={busy.has(s.id)} base={base} P={P} canAi={!!me?.aiConfigured} onRewrite={() => writePart(rv.id, s.id, true)} />)}

                <div className="epr-end">End of review · {rv.scope} · {P.label} · prepared {new Date(rv.generatedAt).toLocaleDateString("en-IN", { month: "short", year: "numeric" })}</div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function SectionHead({ kicker, title, icon: I, lead, right }: { kicker: string; title: string; icon: LucideIcon; lead: string; right?: ReactNode }) {
  return (
    <header className="epr-sh epr-rv">
      <span className="epr-sh-ic"><I size={20} /></span>
      <div className="min-w-0 flex-1"><div className="epr-sh-k">{kicker}</div><h2>{title}</h2><p>{lead}</p></div>
      {right}
    </header>
  );
}
function PartActions({ ai, busy, canAi, onRewrite }: { part: string; ai?: { source: string; model?: string }; busy: boolean; canAi: boolean; onRewrite: () => void }) {
  return (
    <div className="flex items-center gap-2">
      <AiTag ai={ai} loading={busy} />
      {canAi && ai && !busy && <button className="epr-rewrite" onClick={() => { if (confirm('Rewrite the AI commentary for this part? The current text will be replaced.')) onRewrite(); }} title="Rewrite this part's AI commentary"><RefreshCw size={12} />Rewrite</button>}
    </div>
  );
}

function ReviewSectionView({ s, ai, busy, base, P, canAi, onRewrite }: { s: Section; ai?: SectionAI; busy: boolean; base: Base; P: ReportPeriod; canAi: boolean; onRewrite: () => void }) {
  const I = ICONS[s.icon] ?? Sparkles;
  const note = (id: string) => ai?.notes?.[id] ?? s.notes[id];
  const charts = s.charts; const tables = s.tables;
  return (
    <section id={`epr-${s.id}`} data-spy className="epr-sec">
      <SectionHead kicker={s.kicker} title={s.title} icon={I} lead={s.lead} right={<PartActions part={s.id} ai={ai} busy={busy} canAi={canAi} onRewrite={onRewrite} />} />
      <div className="epr-headline epr-rv">{ai ? <><Sparkles size={15} /><p>{ai.headline}</p></> : <Shimmer lines={1} />}</div>

      {s.index && (
        <div className="epr-index epr-rv">
          <Gauge v={s.index.value} />
          <div className="min-w-0 flex-1"><div className="epr-sh-k">Attendance health index</div>
            {s.index.parts.map((p) => <div key={p.label} className="epr-index-r"><span>{p.label}<em>weight {Math.round(p.weight * 100)}%</em></span><div className="bar"><i style={{ width: `${(p.value ?? 0) * 100}%` }} /></div><b>{fmt(p.value, 'percent')}</b></div>)}
            <p className="epr-small">{s.index.note}</p>
          </div>
        </div>
      )}

      <div className={clsx('epr-grid-k', s.kpis.length > 8 ? 'k6' : s.kpis.length > 4 ? 'k4' : 'k4')}>{s.kpis.map((k, i) => <KpiCard key={k.id} k={k} base={base} P={P} i={i} />)}</div>

      <div className="epr-split">
        <div className="epr-prose epr-rv">{ai ? <p className="lead">{ai.summary}</p> : <Shimmer lines={6} />}</div>
        <div className="epr-insights epr-rv"><div className="epr-card-h"><Lightbulb size={14} />Insights</div>{ai ? <ol>{(ai.insights.length ? ai.insights : s.ruleFindings.slice(0, 3)).map((x, i) => <li key={i}>{x}</li>)}</ol> : <Shimmer lines={4} />}</div>
      </div>

      {s.funnels?.length ? <div className="epr-grid-2">{s.funnels.map((f) => <Funnel key={f.title} f={f} />)}</div> : null}
      {s.spotlight?.length ? <div className="epr-spot">{s.spotlight.map((t, i) => (
        <div key={t.name} className={clsx('epr-spot-c epr-rv', `r${i + 1}`)} style={{ transitionDelay: `${i * 80}ms` }}><div className="md"><Trophy size={14} />#{i + 1}</div><b>{t.name}</b>
          <div className="st"><span><i>{fmt(t.avg, 'decimal')}</i>class avg</span><span><i>{fmt(t.fill, 'percent')}</i>fill</span><span><i>{t.classes}</i>classes</span><span><i>{fmt(t.checkins, 'number')}</i>check-ins</span></div></div>
      ))}</div> : null}
      {s.formats?.length ? <div className="epr-formats">{s.formats.map((f, fi) => (
        <div key={f.format} className="epr-fmt epr-rv" style={{ transitionDelay: `${fi * 80}ms` }}><h4>{f.format}</h4>
          <table><tbody>{f.kpis.map((k) => { const t = tone(k, k.chg); return <tr key={k.id}><td>{k.label}</td><td className="v">{fmtK(k.value, k.format)}</td><td className={clsx('c', t > 0 ? 'good' : t < 0 ? 'bad' : '')}>{fmtDelta(k.chg, k.format)}</td></tr>; })}</tbody></table></div>
      ))}</div> : null}
      {s.heatmap && s.heatmap.rows.length > 0 && <Heat hm={s.heatmap} />}

      {charts.length > 0 && <div className={clsx(charts.length === 1 ? 'epr-grid-1' : 'epr-grid-2')}>{charts.map((c, i) => <ChartCard key={c.id} c={c} i={i} note={note(c.id)} loading={busy} />)}</div>}
      {tables.length > 0 && <div className="epr-grid-2">{tables.map((t) => <TableCard key={t.id} t={t} note={note(t.id)} loading={busy} />)}</div>}

      <div className="epr-grid-2">
        <div className="epr-card epr-rv"><div className="epr-card-h"><Flag size={14} />Findings</div>{ai ? <ul className="epr-find">{ai.findings.map((x, i) => <li key={i}>{x}</li>)}</ul> : <Shimmer lines={5} />}</div>
        <div className="epr-card epr-rv"><div className="epr-card-h"><Target size={14} />Recommendations</div>{ai ? (ai.recommendations.length ? <Recs recs={ai.recommendations} /> : <p className="epr-small">Recommendations are written by the AI — turn it on in Settings to add them.</p>) : <Shimmer lines={5} />}</div>
      </div>
    </section>
  );
}
