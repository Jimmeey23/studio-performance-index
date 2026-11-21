/**
 * Executive Performance Review — a live, studio-level senior-management review.
 * Pick a period and studio(s); the numbers are computed instantly and the AI
 * writes each part (at a glance + every section) once. Saved reviews reopen
 * as they were, and the most recently opened review is shown by default.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import clsx from 'clsx';
import {
  Activity, AlertTriangle, ArrowDownRight, ArrowUpRight, BookOpen, CalendarRange, Check, ChevronDown, Filter, Flag, GraduationCap, History, IndianRupee, Lightbulb,
  Brain, Circle, Link2, Loader2, MapPin, Minus, RefreshCw, Shapes, Sparkles, Target, Trash2, TrendingDown, TrendingUp, Trophy, UserMinus, Wand2, X, type LucideIcon,
} from 'lucide-react';
import { api, streamPost } from '../lib/api';
import { useMe } from '../App';
import { fmt } from '../lib/format';
import type { Format, Result } from '../lib/types';
import { PRESETS, lastMonthValue, range } from '../lib/periods';
import { fmtDelta, fmtK, tone, type Kpi, type ReportPeriod } from '../lib/report';
import { BRAND } from '../lib/brand';
import { InteractiveChart } from '../components/blocks/Charts';
import { AdvancedTable } from '../components/blocks/AdvancedTable';
import { CountUp, Sparkline } from '../components/Animated';
import { BlockView } from '../components/blocks/Blocks';
import { ClassExplorer } from '../components/ClassExplorer';
import { useDrill, type DrillRequest } from '../lib/drill';
import type { Block } from '../lib/types';
import '../review.css';

/* ── types (mirror server/src/report/review.ts) ── */
type Chart = { id: string; title: string; chart: string; seriesBy?: string; y?: string[]; result: Result };
type Table = { id: string; title: string; result: Result; note?: string };
type List = { id: string; title: string; metric: string; format: Format; dimension: string; metricKey?: string; dimKey?: string; top: { name: string; value: number | null; sub?: string }[]; bottom: { name: string; value: number | null; sub?: string }[] };
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
type Plan = { storyline: string; headline: string; themes: string[]; sections: { id: string; angle: string; focus: string[] }[]; thinking?: string; model?: string; source: 'ai' | 'rules'; at: string };
type AI = { plan?: Plan; glance?: GlanceAI; sections: Record<string, SectionAI> };
type Saved = { review: Review; ai: AI; created_at: string; updated_at: string; reused?: boolean };
type HistoryItem = { id: string; label: string; scope: string; created_at: string; updated_at: string; ai_parts: number };

/** Drill context: every number in the review opens the records behind it. */
type DrillCtx = { open: (r: DrillRequest) => void; P: ReportPeriod; locs: string[] } | null;
const DrillC = createContext<DrillCtx>(null);
const useDrillCtx = () => useContext(DrillC);
function drillReq(c: NonNullable<DrillCtx>, metric: string, extra: { dimension: string; values: (string | number)[] }[] = [], base: Base | 'cur' = 'cur', context: string[] = [], expected?: number | null): DrillRequest {
  const P = c.P; const [start, end] = base === 'prev' ? [P.prevStart ?? P.start, P.prevEnd ?? P.end] : base === 'ly' ? [P.lyStart ?? P.start, P.lyEnd ?? P.end] : base === 'ytd' ? [P.ytdStart ?? P.start, P.ytdEnd ?? P.end] : [P.start, P.end];
  return { metric, start, end, filters: [...(c.locs.length ? [{ dimension: 'location', op: 'in' as const, values: c.locs }] : []), ...extra.map((x) => ({ dimension: x.dimension, op: 'in' as const, values: x.values }))], context, expected };
}
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
  const dc = useDrillCtx();
  const go = () => dc && dc.open(drillReq(dc, k.id, [], 'cur', [k.label], k.value));
  return (
    <div className={clsx('epr-kpi epr-rv epr-click', big && 'big')} style={{ transitionDelay: `${i * 45}ms` }} title={`${k.description}\nClick for the records, breakdowns and trend behind this number`} role="button" tabIndex={0} onClick={go} onKeyDown={(e) => e.key === 'Enter' && go()}>
      <div className="epr-kpi-l">{k.label}</div>
      <div className="epr-kpi-v">{k.value === null ? '—' : <CountUp value={k.value} format={(n) => fmtK(n, k.format)} />}</div>
      <Delta k={k} base={base} P={P} />
      <div className="epr-kpi-ref">{base === 'prev' ? P.prevLabel : base === 'ytd' ? P.ytdLabel : P.lyLabel}: <b>{fmtK(ref, k.format)}</b></div>
      {vals.length > 2 && <div className="epr-kpi-spark"><Sparkline values={vals} height={30} color={t > 0 ? 'var(--epr-good)' : t < 0 ? 'var(--epr-bad)' : 'var(--accent)'} format={(n) => fmtK(n, k.format)} /></div>}
    </div>
  );
}
/** Plain text in one uniform style — no selective bolding. Typed in word by word while the review is being built live. */
const LiveC = createContext(false);
function Rich({ text }: { text: string }) {
  const live = useContext(LiveC);
  const words = useMemo(() => text.split(/(\s+)/), [text]);
  const [n, setN] = useState(live ? 0 : words.length);
  useEffect(() => {
    if (!live) { setN(words.length); return; }
    setN(0); let i = 0;
    const step = Math.max(2, Math.ceil(words.length / 90));
    const t = setInterval(() => { i += step; setN(i); if (i >= words.length) clearInterval(t); }, 28);
    return () => clearInterval(t);
  }, [words, live]);
  return <>{n >= words.length ? text : <>{words.slice(0, n).join('')}<span className="epr-caret" /></>}</>;
}
const sentences = (t: string) => t.replace(/\s+/g, ' ').trim().split(/(?<=[.!?])\s+(?=[A-Z₹0-9"“(])/).filter(Boolean);
const NOTE_ROW = /^(What it shows|Why|So what|Next step):\s*(.+)$/;
function Note({ text, loading, label = 'What this tells us' }: { text?: string; loading?: boolean; label?: string }) {
  if (loading && !text) return <div className="epr-note"><Shimmer lines={3} /></div>;
  if (!text) return null;
  const rows = text.split('\n').map((l) => l.trim().match(NOTE_ROW)).filter((m): m is RegExpMatchArray => !!m);
  const parts: [string, string][] = rows.length >= 2 ? rows.map((m) => [m[1], m[2]]) : (() => { const ss = sentences(text); return ss.length > 1 ? [['What it shows', ss[0]], ['Why', ss.slice(1).join(' ')]] as [string, string][] : [['What it shows', text]] as [string, string][]; })();
  return (
    <div className="epr-note">
      <div className="epr-note-h"><Lightbulb size={12} />{label}</div>
      <dl className="epr-note-grid">{parts.map(([k, v]) => <div key={k}><dt>{k}</dt><dd><Rich text={v} /></dd></div>)}</dl>
    </div>
  );
}
const PARA_LABELS = ['Performance', 'Drivers', 'Outlook'];
function Prose({ text, lines = 6 }: { text?: string; lines?: number }) {
  if (!text) return <Shimmer lines={lines} />;
  let paras = text.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
  if (paras.length === 1) { const ss = sentences(paras[0]); if (ss.length >= 4) { const k = Math.ceil(ss.length / 3); paras = [ss.slice(0, k), ss.slice(k, 2 * k), ss.slice(2 * k)].map((x) => x.join(' ')).filter(Boolean); } }
  return <div className="epr-paras">{paras.map((p, i) => <div key={i} className="epr-para">{paras.length > 1 && <span className="epr-para-k">{PARA_LABELS[i] ?? ''}</span>}<p><Rich text={p} /></p></div>)}</div>;
}
function ChartCard({ c, note, loading, h = 300, i = 0 }: { c: Chart; note?: string; loading?: boolean; h?: number; i?: number }) {
  return (
    <figure className="epr-card epr-rv" style={{ transitionDelay: `${i * 60}ms` }}>
      <figcaption className="epr-card-h"><span className="epr-card-ic"><TrendingUp size={13} /></span><span className="epr-card-t">{c.title}</span><span className="epr-card-tag">Chart</span></figcaption>
      <InteractiveChart result={c.result} chart={c.chart} seriesBy={c.seriesBy} y={c.y} height={h} minimal />
      <Note text={note} loading={loading} />
    </figure>
  );
}
function TableCard({ t, note, loading, rows = 10 }: { t: Table; note?: string; loading?: boolean; rows?: number }) {
  const n = t.result.rows.length;
  return (
    <div className="epr-card epr-card-wide epr-rv">
      <div className="epr-card-h"><span className="epr-card-ic"><BookOpen size={13} /></span><span className="epr-card-t">{t.title}</span><span className="epr-card-tag">{n} row{n === 1 ? '' : 's'} · {t.result.columns.length} columns</span></div>
      <div className="epr-table"><AdvancedTable result={t.result} compact pageSize={rows} /></div>
      <Note text={note ?? t.note} loading={loading} />
    </div>
  );
}
/** Full board scorecard — every headline metric against all three baselines. */
function Scorecard({ kpis, P }: { kpis: Kpi[]; P: ReportPeriod }) {
  const dc = useDrillCtx();
  const open = (k: Kpi, b: Base | 'cur', v: number | null, lab: string) => dc && dc.open(drillReq(dc, k.id, [], b, [k.label, lab], v));
  const cell = (k: Kpi, ref: number | null, c: number | null, b: Base, lab: string) => { const t = tone(k, c); return (
    <td className="ref epr-click" onClick={() => open(k, b, ref, lab)} title={`Open the ${lab} records`}><span>{fmtK(ref, k.format)}</span><em className={t > 0 ? 'good' : t < 0 ? 'bad' : ''}>{fmtDelta(c, k.format)}</em></td>
  ); };
  const status = (k: Kpi) => { const s = [k.chg, k.chgYtd, k.chgLy].map((c) => tone(k, c)).reduce<number>((a, b) => a + b, 0); return s >= 2 ? 'good' : s <= -2 ? 'bad' : 'mixed'; };
  return (
    <div className="epr-card epr-card-wide epr-rv">
      <div className="epr-card-h"><span className="epr-card-ic"><Target size={13} /></span><span className="epr-card-t">Executive scorecard</span><span className="epr-card-tag">{kpis.length} metrics · 3 baselines</span></div>
      <div className="epr-score-wrap"><table className="epr-score">
        <thead><tr><th className="m">Metric</th><th>{P.label}</th><th>vs {P.prevLabel}</th><th>vs {P.ytdLabel}</th><th>vs {P.lyLabel}</th><th className="tr">Trend</th><th>Status</th></tr></thead>
        <tbody>{kpis.map((k) => { const vals = k.series.filter((v): v is number => v !== null); const st = status(k); return (
          <tr key={k.id} title={k.description}>
            <td className="m">{k.label}</td>
            <td className="v epr-click" onClick={() => open(k, 'cur', k.value, P.label)}>{fmtK(k.value, k.format)}</td>
            {cell(k, k.prev, k.chg, 'prev', P.prevLabel)}{cell(k, k.ytd, k.chgYtd, 'ytd', P.ytdLabel)}{cell(k, k.ly, k.chgLy, 'ly', P.lyLabel)}
            <td className="tr">{vals.length > 2 ? <Sparkline values={vals} height={24} color={st === 'good' ? 'var(--epr-good)' : st === 'bad' ? 'var(--epr-bad)' : 'var(--accent)'} format={(x) => fmtK(x, k.format)} /> : '—'}</td>
            <td><span className={clsx('epr-pill', st)}>{st === 'good' ? 'On track' : st === 'bad' ? 'At risk' : 'Mixed'}</span></td>
          </tr>
        ); })}</tbody>
      </table></div>
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
  const dc = useDrillCtx();
  const vals = Object.values(hm.cells).map((c) => c.fill).filter((v): v is number => v !== null);
  const max = Math.max(...vals, 0.01);
  return (
    <div className="epr-card epr-rv">
      <div className="epr-card-h"><CalendarRange size={14} />Fill rate by weekday & hour</div>
      <div className="epr-heat-wrap"><table className="epr-heat"><thead><tr><th />{hm.cols.map((c) => <th key={c}>{c}</th>)}</tr></thead>
        <tbody>{hm.rows.map((r) => <tr key={r}><th>{r.slice(0, 3)}</th>{hm.cols.map((c) => { const cell = hm.cells[`${r}|${c}`]; if (!cell || cell.fill === null) return <td key={c} className="empty" />; const a = cell.fill / max;
          return <td key={c} className="epr-click" onClick={() => dc && dc.open(drillReq(dc, 'fill_rate', [{ dimension: 'day_of_week', values: [r] }, { dimension: 'hour', values: [c] }], 'cur', [r, c], cell.fill))} title={`${r} ${c}: ${(cell.fill * 100).toFixed(0)}% fill · ${cell.classes} classes — click for the classes`} style={{ background: `color-mix(in srgb, var(--accent) ${Math.round(8 + a * 82)}%, transparent)`, color: a > 0.55 ? '#fff' : undefined }}>{Math.round(cell.fill * 100)}</td>; })}</tr>)}</tbody></table></div>
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
  const dc = useDrillCtx();
  const go = (name: string, v: number | null) => dc && l.metricKey && l.dimKey && dc.open(drillReq(dc, l.metricKey, [{ dimension: l.dimKey, values: [name] }], 'cur', [name], v));
  return (
    <div className="epr-card epr-rv epr-tb">
      <div className="epr-card-h"><Trophy size={14} />Top & bottom performers</div>
      <div className="epr-tb-ctrl">
        <div className="epr-seg">{lists.map((x, j) => <button key={x.id} className={clsx(j === i && 'on')} onClick={() => setI(j)}>{x.title}</button>)}</div>
        <div className="epr-seg sm"><button className={clsx(side === 'top' && 'on')} onClick={() => setSide('top')}><TrendingUp size={12} />Top 5</button><button className={clsx(side === 'bottom' && 'on')} onClick={() => setSide('bottom')}><TrendingDown size={12} />Bottom 5</button></div>
      </div>
      <div className="epr-tb-sub">Ranked by {l.metric.toLowerCase()}</div>
      <ol className="epr-tb-list" key={`${i}-${side}`}>{items.map((x, j) => (
        <li key={x.name} className={clsx(l.metricKey && 'epr-click')} onClick={() => go(x.name, x.value)} style={{ ['--d' as string]: `${j * 70}ms` }}>
          <span className={clsx('rk', side)}>{j + 1}</span>
          <div className="nm"><span className="nm-t">{x.name}</span>{x.sub && <em>{x.sub}</em>}<div className="bar"><i className={side} style={{ width: `${(Math.abs(x.value ?? 0) / max) * 100}%` }} /></div></div>
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
      <div><div className="epr-rec-t">{r.title}<span className={clsx('pri', r.priority)}>{r.priority}</span></div><p><Rich text={r.detail} /></p><div className="epr-rec-o"><Target size={11} />{r.owner}</div></div>
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
  const [preparing, setPreparing] = useState(false);
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
    setSaved(s); setSetup(false);
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
  /** Live build: the AI thinks and plans first, then each part is written and revealed in order, from scratch. */
  const [build, setBuild] = useState<{ id: string; stage: 'plan' | 'write' | 'done'; thinking: string; revealed: number; current?: string; error?: string } | null>(null);
  const follow = useRef(true);
  const savedRef = useRef<Saved | null>(null); savedRef.current = saved;
  useEffect(() => {
    if (!saved) { setBuild(null); return; }
    const id = saved.review.id;
    if (started.current.has(id)) return;
    started.current.add(id);
    const parts = ['glance', ...saved.review.sections.map((s) => s.id)];
    const has = (p: string) => { const a = savedRef.current?.ai; return !!(p === 'glance' ? a?.glance : a?.sections?.[p]); };
    if (parts.every(has)) { setBuild(null); return; }
    const alive = () => savedRef.current?.review.id === id;
    const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
    follow.current = true;
    setBuild({ id, stage: 'plan', thinking: '', revealed: 0 });
    void (async () => {
      // 1 · think and plan
      if (!saved.ai.plan) {
        try {
          await streamPost(`/api/review/${id}/plan`, {}, (e) => {
            if (!alive()) return;
            if (e.type === 'thinking') setBuild((b) => (b && b.id === id ? { ...b, thinking: b.thinking + String(e.delta ?? '') } : b));
            if (e.type === 'plan') setSaved((s) => (s && s.review.id === id ? { ...s, ai: { ...s.ai, plan: e.plan as Plan } } : s));
            if (e.type === 'error') setBuild((b) => (b && b.id === id ? { ...b, error: String(e.message) } : b));
          });
        } catch (e) { setBuild((b) => (b && b.id === id ? { ...b, error: (e as Error).message } : b)); }
        await sleep(900);
      } else await sleep(1200);
      if (!alive()) return;
      // 2 · write and reveal each part in order (the next part is written while this one is revealed)
      setBuild((b) => (b && b.id === id ? { ...b, stage: 'write' } : b));
      const jobs = new Map<string, Promise<void>>();
      const ensure = (p: string) => { if (!jobs.has(p)) jobs.set(p, has(p) ? Promise.resolve() : writePart(id, p)); return jobs.get(p)!; };
      for (let i = 0; i < parts.length; i++) {
        if (!alive()) return;
        setBuild((b) => (b && b.id === id ? { ...b, current: parts[i] } : b));
        const cur = ensure(parts[i]); if (parts[i + 1]) void ensure(parts[i + 1]);
        await cur; if (!alive()) return;
        setBuild((b) => (b && b.id === id ? { ...b, revealed: i + 1 } : b));
        if (follow.current) setTimeout(() => document.getElementById(`epr-${parts[i]}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 80);
        await sleep(4200);
      }
      setBuild((b) => (b && b.id === id ? { ...b, stage: 'done', current: undefined } : b));
    })();
  }, [saved, writePart]);
  useEffect(() => {
    const el = scroller.current; if (!el) return;
    const off = (e: WheelEvent) => { if (e.deltaY < 0) follow.current = false; };
    el.addEventListener('wheel', off, { passive: true }); return () => el.removeEventListener('wheel', off);
  }, []);
  const drill = useDrill();

  // scroll-spy for the section rail
  useEffect(() => {
    const root = scroller.current; if (!root || !saved) return;
    const io = new IntersectionObserver((es) => { const v = es.filter((e) => e.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0]; if (v) setActive(v.target.id.replace('epr-', '')); }, { root, rootMargin: '-30% 0px -60% 0px' });
    root.querySelectorAll('[data-spy]').forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, [saved]);

  const period = preset === 'custom' ? custom : preset === 'month' ? range('month', month) : range(preset);
  const generate = async (fresh = false) => {
    setPreparing(true); setErr(null);
    try { const s = await api<Saved>('/api/review', { method: 'POST', json: { ...period, locations: locs, fresh } }); show(s); }
    catch (e) { setErr((e as Error).message); } finally { setPreparing(false); }
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
  const parts = useMemo(() => (rv ? ['glance', ...rv.sections.map((s) => s.id)] : []), [rv]);
  const building = !!build && build.id === rv?.id && build.stage !== 'done';
  const shown = (p: string) => !building || parts.indexOf(p) < build!.revealed;
  const liveNow = (p: string) => building && parts.indexOf(p) === build!.revealed - 1;
  const nextUp = building && build!.stage === 'write' ? parts[build!.revealed] : undefined;
  const dctx: DrillCtx = drill && P && rv ? { open: drill, P, locs: rv.request.locations } : null;
  const plan = ai?.plan;

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
        <button className="epr-go" disabled={preparing} onClick={() => generate(false)}>{preparing ? <><Loader2 size={15} className="animate-spin" />Preparing review…</> : <><Wand2 size={15} />Prepare review</>}</button>
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
            <DrillC.Provider value={dctx}>
            <div className={clsx('epr-doc', building && 'is-building')}>
              {/* section rail */}
              <nav className="epr-rail no-print">{nav.map((n, i) => (
                <button key={n.id} onClick={() => jump(n.id)} disabled={n.id !== 'cover' && !shown(n.id)} className={clsx(active === n.id && 'on', n.id !== 'cover' && !shown(n.id) && 'pending')} title={n.title}>
                  <span className="dot">{busy.has(n.id) || (building && build!.current === n.id) ? <Loader2 size={10} className="animate-spin" /> : i === 0 ? '◆' : String(i).padStart(2, '0')}</span><span className="t">{n.title}</span>
                </button>
              ))}</nav>

              <div className="epr-main">
                {/* ── cover ── */}
                <section id="epr-cover" data-spy className="epr-cover">
                  <div className="epr-cover-l">
                    <div className="epr-cover-top"><img src={BRAND.logoOnDark} alt="Physique 57" /><span className="epr-cover-conf">Confidential</span></div>
                    <div className="epr-cover-mid">
                      <div className="epr-cover-eyebrow">Executive Performance Review</div>
                      <div className="epr-cover-period">{P.label}</div>
                      <div className="epr-cover-rule" />
                      <h1>{gl && shown('glance') ? gl.headline : plan ? <span className="epr-fade">{plan.headline}</span> : <span className="epr-cover-wait"><Brain size={18} />Studying the numbers…</span>}</h1>
                      {gl?.tagline && shown('glance') && <p className="epr-cover-tag">{gl.tagline}</p>}
                    </div>
                    <dl className="epr-cover-meta">
                      <div><dt>Scope</dt><dd>{rv.scope}</dd></div>
                      <div><dt>Prepared for</dt><dd>Senior management</dd></div>
                      <div><dt>Benchmarks</dt><dd>{P.prevLabel} · {P.ytdLabel} · {P.lyLabel}</dd></div>
                      <div><dt>Issued</dt><dd>{new Date(rv.generatedAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' })}</dd></div>
                    </dl>
                  </div>
                  <div className="epr-cover-r">
                    <img className="epr-cover-img" src={BRAND.photos[rv.cover.photo % BRAND.photos.length]} alt="" />
                    <div className="epr-cover-shade" />
                    <ol className="epr-cover-toc">
                      <li className="h">In this review</li>
                      <li><button onClick={() => jump('glance')}><span>01</span>At a glance</button></li>
                      {rv.sections.map((x, i) => <li key={x.id}><button onClick={() => jump(x.id)}><span>{String(i + 2).padStart(2, '0')}</span>{x.title}</button></li>)}
                    </ol>
                  </div>
                  <div className="epr-cover-kpis">{rv.cover.headlineKpis.map((k) => { const t = tone(k, k.chg); return (
                    <div key={k.id}><span>{k.label}</span><b>{fmtK(k.value, k.format)}</b><em className={t > 0 ? 'good' : t < 0 ? 'bad' : ''}>{t > 0 ? '▲' : t < 0 ? '▼' : '•'} {fmtDelta(k.chg, k.format)} <i>vs {P.prevLabel}</i></em></div>
                  ); })}</div>
                  <div className="epr-cover-foot">Figures computed from synced studio data{gl?.source === 'ai' ? ` · commentary by ${gl.model ?? 'Claude'}` : ''} · Ref {rv.id.slice(0, 8).toUpperCase()}</div>
                </section>

                {/* ── at a glance ── */}
                {shown('glance') && <LiveC.Provider value={liveNow('glance')}>
                <section id="epr-glance" data-spy className={clsx('epr-sec', liveNow('glance') && 'epr-live')}>
                  <SectionHead kicker="Section 01 · Overview" title="At a glance" icon={Sparkles} lead={`${rv.scope} · ${P.label} — every key metric and finding from the sections that follow.`} right={<PartActions part="glance" ai={gl} busy={busy.has('glance')} canAi={!!me?.aiConfigured} onRewrite={() => writePart(rv.id, 'glance', true)} />} />
                  <div className="epr-grid-k8">{rv.glance.cards.map((k, i) => <KpiCard key={k.id} k={k} base={base} P={P} i={i} />)}</div>
                  {rv.scorecard?.length > 0 && <Scorecard kpis={rv.scorecard} P={P} />}
                  <div className="epr-split">
                    <div className="epr-prose epr-rv"><div className="epr-prose-h">Executive summary</div><Prose text={gl?.summary} lines={7} /></div>
                    <div className="epr-insights epr-rv"><div className="epr-card-h"><Lightbulb size={14} />Key insights</div>{gl ? <ol>{gl.insights.map((x, i) => <li key={i}><Rich text={x} /></li>)}</ol> : <Shimmer lines={5} />}</div>
                  </div>
                  <div className="epr-highlights">{rv.sections.map((s, i) => { const I = ICONS[s.icon] ?? Sparkles; const h = gl?.highlights.find((x) => x.section === s.id)?.text ?? ai?.sections[s.id]?.headline ?? s.ruleFindings[0]; return (
                    <button key={s.id} className="epr-hl epr-rv" style={{ transitionDelay: `${i * 50}ms` }} onClick={() => jump(s.id)}><span className="ic"><I size={15} /></span><span className="n">{String(i + 2).padStart(2, '0')}</span><span className="t">{s.title}</span><p>{h ? <Rich text={h} /> : '…'}</p><span className="go">Read section →</span></button>
                  ); })}</div>
                  {!!gl?.watch?.length && <div className="epr-watch epr-rv"><AlertTriangle size={15} /><div><b>Watch-outs</b><ul>{gl.watch.map((w, i) => <li key={i}><Rich text={w} /></li>)}</ul></div></div>}
                  <div className="epr-grid-2">{rv.glance.charts.slice(0, 2).map((c, i) => <ChartCard key={c.id} c={c} i={i} note={gl?.notes[c.id] ?? rv.glance.notes[c.id]} loading={busy.has('glance')} />)}</div>
                  <div className="epr-grid-2">
                    {rv.glance.lists.length > 0 && <TopBottom lists={rv.glance.lists} />}
                    {rv.glance.charts[2] && <ChartCard c={rv.glance.charts[2]} note={gl?.notes[rv.glance.charts[2].id] ?? rv.glance.notes[rv.glance.charts[2].id]} loading={busy.has('glance')} h={300} />}
                  </div>
                  <div className="epr-grid-1">{rv.glance.tables.slice(0, 4).map((t) => <TableCard key={t.id} t={t} note={gl?.notes[t.id] ?? rv.glance.notes[t.id]} loading={busy.has('glance')} />)}</div>
                  {rv.studios && rv.studios.result.rows.length > 1 && <TableCard t={{ ...rv.studios, title: rv.studios.title || 'Studio comparison' }} note={rv.studios.note} />}
                </section>
                </LiveC.Provider>}

                {/* ── sections ── */}
                {rv.sections.map((s, i) => shown(s.id) && <LiveC.Provider key={s.id} value={liveNow(s.id)}><ReviewSectionView live={liveNow(s.id)} req={rv.request} n={i + 2} total={rv.sections.length + 1} s={s} ai={ai?.sections[s.id]} busy={busy.has(s.id)} base={base} P={P} canAi={!!me?.aiConfigured} onRewrite={() => writePart(rv.id, s.id, true)} /></LiveC.Provider>)}

                {nextUp && <BuildingNext title={nextUp === 'glance' ? 'At a glance' : rv.sections.find((x) => x.id === nextUp)?.title ?? ''} angle={plan?.sections.find((x) => x.id === nextUp)?.angle} />}
                {!building && <div className="epr-end">End of review · {rv.scope} · {P.label} · prepared {new Date(rv.generatedAt).toLocaleDateString("en-IN", { month: "short", year: "numeric" })}</div>}
              </div>
            </div>
            {build && build.id === rv.id && <BuildConsole build={build} plan={plan} steps={nav.slice(1)} onClose={() => setBuild(null)} />}
            </DrillC.Provider>
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

function ReviewSectionView({ n, total, s, ai, busy, base, P, canAi, onRewrite, live, req }: { n: number; total: number; s: Section; ai?: SectionAI; busy: boolean; base: Base; P: ReportPeriod; canAi: boolean; onRewrite: () => void; live?: boolean; req: Review['request'] }) {
  const I = ICONS[s.icon] ?? Sparkles;
  const dc = useDrillCtx();
  const note = (id: string) => ai?.notes?.[id] ?? s.notes[id];
  const charts = s.charts; const tables = s.tables;
  return (
    <section id={`epr-${s.id}`} data-spy className={clsx('epr-sec', live && 'epr-live')}>
      <SectionHead kicker={`Section ${String(n).padStart(2, '0')} of ${String(total).padStart(2, '0')} · ${s.kicker}`} title={s.title} icon={I} lead={s.lead} right={<PartActions part={s.id} ai={ai} busy={busy} canAi={canAi} onRewrite={onRewrite} />} />
      <div className="epr-headline epr-rv">{ai ? <><span className="epr-headline-k">The headline</span><p><Rich text={ai.headline} /></p></> : <Shimmer lines={1} />}</div>

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
        <div className="epr-prose epr-rv"><div className="epr-prose-h">Summary</div><Prose text={ai?.summary} /></div>
        <div className="epr-insights epr-rv"><div className="epr-card-h"><Lightbulb size={14} />Insights</div>{ai ? <ol>{(ai.insights.length ? ai.insights : s.ruleFindings.slice(0, 3)).map((x, i) => <li key={i}><Rich text={x} /></li>)}</ol> : <Shimmer lines={4} />}</div>
      </div>

      {s.funnels?.length ? <div className="epr-grid-2">{s.funnels.map((f) => <Funnel key={f.title} f={f} />)}</div> : null}
      {s.spotlight?.length ? <div className="epr-spot">{s.spotlight.map((t, i) => (
        <div key={t.name} className={clsx('epr-spot-c epr-rv epr-click', `r${i + 1}`)} onClick={() => dc && dc.open(drillReq(dc, 'class_checkins', [{ dimension: 'teacher', values: [t.name] }], 'cur', [t.name], t.checkins))} style={{ transitionDelay: `${i * 80}ms` }}><div className="md"><Trophy size={14} />#{i + 1}</div><span className="nm-t">{t.name}</span>
          <div className="st"><span><i>{fmt(t.avg, 'decimal')}</i>class avg</span><span><i>{fmt(t.fill, 'percent')}</i>fill</span><span><i>{t.classes}</i>classes</span><span><i>{fmt(t.checkins, 'number')}</i>check-ins</span></div></div>
      ))}</div> : null}
      {s.formats?.length ? <div className="epr-formats">{s.formats.map((f, fi) => (
        <div key={f.format} className="epr-fmt epr-rv" style={{ transitionDelay: `${fi * 80}ms` }}><h4>{f.format}</h4>
          <table><tbody>{f.kpis.map((k) => { const t = tone(k, k.chg); return <tr key={k.id} className="epr-click" onClick={() => dc && dc.open(drillReq(dc, k.id, [{ dimension: 'format', values: [f.format] }], 'cur', [f.format, k.label], k.value))}><td>{k.label}</td><td className="v">{fmtK(k.value, k.format)}</td><td className={clsx('c', t > 0 ? 'good' : t < 0 ? 'bad' : '')}>{fmtDelta(k.chg, k.format)}</td></tr>; })}</tbody></table></div>
      ))}</div> : null}
      {s.heatmap && s.heatmap.rows.length > 0 && <Heat hm={s.heatmap} />}

      {charts.length > 0 && <div className={clsx(charts.length === 1 ? 'epr-grid-1' : 'epr-grid-2')}>{charts.map((c, i) => <ChartCard key={c.id} c={c} i={i} note={note(c.id)} loading={busy} />)}</div>}
      {tables.length > 0 && <div className="epr-grid-1">{tables.map((t) => <TableCard key={t.id} t={t} note={note(t.id)} loading={busy} />)}</div>}
      {s.id === 'classes' && <MainTab domain="classes" start={req.start} end={req.end} locations={req.locations} />}

      <div className="epr-grid-1">
        <div className="epr-card epr-card-wide epr-rv"><div className="epr-card-h"><span className="epr-card-ic"><Flag size={13} /></span><span className="epr-card-t">Key findings</span></div>{ai ? <ol className="epr-find">{ai.findings.map((x, i) => <li key={i}><span>{String(i + 1).padStart(2, '0')}</span><p><Rich text={x} /></p></li>)}</ol> : <Shimmer lines={5} />}</div>
        <div className="epr-card epr-card-wide epr-rv"><div className="epr-card-h"><span className="epr-card-ic"><Target size={13} /></span><span className="epr-card-t">Recommended actions</span></div>{ai ? (ai.recommendations.length ? <Recs recs={ai.recommendations} /> : <p className="epr-small">Recommendations are written by the AI — turn it on in Settings to add them.</p>) : <Shimmer lines={5} />}</div>
      </div>
    </section>
  );
}

/* ── the Class Performance tab's own tables and charts, for the same period and studios ── */
type DomWidget = { id: string; type: string; title: string; span?: number; dimension?: string; dimensions?: string[]; chart?: string; view?: string; block?: string; result?: Result & { error?: string }; section?: string };
const okRes = (r: unknown): r is Result => !!r && !(r as { error?: string }).error && Array.isArray((r as Result).rows) && (r as Result).rows.length > 0;
function widgetBlock(w: DomWidget): Block | null {
  if (!okRes(w.result)) return null;
  switch (w.type) {
    case 'chart': return { id: w.id, type: 'chart', title: w.title, result: w.result, chart: w.chart, series_by: w.dimension } as Block;
    case 'table': return { id: w.id, type: 'table', title: w.title, result: w.result, view: (w.view as Block['view']) ?? 'table', group_by: w.view === 'grouped' ? w.dimensions?.[0] : undefined } as Block;
    case 'ranking': return { id: w.id, type: 'table', title: w.title, result: w.result, view: 'ranked' } as Block;
    case 'mom': return { id: w.id, type: 'table', title: w.title, result: w.result, view: 'mom' } as Block;
    case 'analysis': return { id: w.id, type: (w.block ?? 'table') as Block['type'], title: w.title, result: w.result } as Block;
    default: return null;
  }
}
function MainTab({ domain, start, end, locations }: { domain: string; start: string; end: string; locations: string[] }) {
  const [ws, setWs] = useState<DomWidget[] | null>(null); const [err, setErr] = useState('');
  useEffect(() => {
    let live = true;
    api<{ widgets: DomWidget[] }>(`/api/domains/${domain}`, { method: 'POST', json: { filters: { start, end, locations, compare: 'previous_year', grain: 'month' } } })
      .then((d) => live && setWs(d.widgets)).catch((e) => live && setErr((e as Error).message));
    return () => { live = false; };
  }, [domain, start, end, locations.join('|')]); // eslint-disable-line react-hooks/exhaustive-deps
  const blocks = (ws ?? []).map((w) => ({ w, b: widgetBlock(w) })).filter((x): x is { w: DomWidget; b: Block } => !!x.b);
  const charts = blocks.filter((x) => x.b.type === 'chart'); const rest = blocks.filter((x) => x.b.type !== 'chart');
  return (
    <div className="epr-maintab epr-rv">
      <div className="epr-sub-h"><span>Class performance workspace</span><em>The same tables and charts as the Class Performance tab, for this period and studio selection. Every number opens its records.</em></div>
      {err && <p className="epr-small">{err}</p>}
      {!ws && !err && <Shimmer lines={4} />}
      {charts.length > 0 && <div className="epr-grid-2">{charts.map(({ w, b }) => <div key={w.id} className="min-w-0"><BlockView block={b} height={300} /></div>)}</div>}
      {rest.length > 0 && <div className="epr-grid-1">{rest.map(({ w, b }) => <div key={w.id} className="min-w-0"><BlockView block={b} height={320} /></div>)}</div>}
      <ClassExplorer start={start} end={end} locations={locations} />
    </div>
  );
}

/* ── live build: the next part being written, and the console that narrates the build ── */
function BuildingNext({ title, angle }: { title: string; angle?: string }) {
  return (
    <div className="epr-next">
      <div className="epr-next-h"><Loader2 size={14} className="animate-spin" />Writing · {title}</div>
      {angle && <p>{angle}</p>}
      <div className="epr-next-sk"><i /><i /><i /><i /></div>
      <div className="epr-next-sk wide"><i /></div>
    </div>
  );
}
function BuildConsole({ build, plan, steps, onClose }: { build: { stage: 'plan' | 'write' | 'done'; thinking: string; revealed: number; current?: string; error?: string }; plan?: Plan; steps: { id: string; title: string }[]; onClose: () => void }) {
  const [min, setMin] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => { const el = box.current; if (el) el.scrollTop = el.scrollHeight; }, [build.thinking]);
  const total = steps.length + 1; const done = build.stage === 'done' ? total : (plan ? 1 : 0) + build.revealed;
  const pct = Math.round((done / total) * 100);
  const state = (i: number, id: string) => build.stage === 'done' || i < build.revealed ? 'done' : build.current === id ? 'run' : 'wait';
  return (
    <aside className={clsx('epr-console no-print', min && 'min')}>
      <div className="epr-console-h">
        {build.stage === 'done' ? <Check size={14} /> : <Loader2 size={14} className="animate-spin" />}
        <span>{build.stage === 'plan' ? 'Thinking through the review' : build.stage === 'write' ? 'Building the review' : 'Review complete'}</span>
        <em>{pct}%</em>
        <button onClick={() => setMin((m) => !m)} title={min ? 'Expand' : 'Minimise'}><ChevronDown size={14} className={clsx(min && 'rotate-180')} /></button>
        {build.stage === 'done' && <button onClick={onClose} title="Close"><X size={14} /></button>}
      </div>
      <div className="epr-console-bar"><i style={{ width: `${pct}%` }} /></div>
      {!min && <>
        {build.stage === 'plan' && <div ref={box} className="epr-think">{build.thinking ? build.thinking.slice(-2400) : 'Reading every section, baseline and table…'}<span className="epr-caret" /></div>}
        {plan && <div className="epr-plan"><span className="epr-para-k">Plan</span><p>{plan.storyline}</p>{plan.themes.length > 0 && <ul>{plan.themes.map((t) => <li key={t}>{t}</li>)}</ul>}</div>}
        {build.error && <p className="epr-small">{build.error}</p>}
        <ol className="epr-steps">
          <li className={plan ? 'done' : 'run'}>{plan ? <Check size={12} /> : <Loader2 size={12} className="animate-spin" />}Think and plan</li>
          {steps.map((s, i) => { const st = state(i, s.id); return <li key={s.id} className={st}>{st === 'done' ? <Check size={12} /> : st === 'run' ? <Loader2 size={12} className="animate-spin" /> : <Circle size={10} />}{s.title}</li>; })}
        </ol>
      </>}
    </aside>
  );
}
