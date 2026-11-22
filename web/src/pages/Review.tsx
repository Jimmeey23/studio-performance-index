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
  AlertTriangle, ArrowDownRight, ArrowUpRight, CalendarRange, Check, Filter, Flag, Lightbulb,
  Link2, Loader2, MessageSquare, Pin, ScrollText, SlidersHorizontal, BookOpenText, ArrowLeft, ArrowRight, Pencil, PenLine, Printer, Minus, RefreshCw, Sparkles, Target, Trash2, TrendingDown, TrendingUp, Trophy, Wand2, X,
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
import { useDrill, type DrillFilter } from '../lib/drill';
import { TrainerAvatar } from '../lib/trainers';
import { PinCtx } from '../lib/pin';
import type { Block } from '../lib/types';
import { BlockView } from '../components/blocks/Blocks';
import Analyst from './Analyst';
import { SpeakerPanel, type SpeakerChapter } from '../components/report/Speaker';
import { ChapterNotes, InkLayer, NotesCtx, NOTE_COLORS, PointerFx, PresenterBar, type ReviewNote, type Tool } from '../components/report/Presenter';
import '../review.css';

/* ── types (mirror server/src/report/review.ts) ── */
type Chart = { id: string; title: string; chart: string; seriesBy?: string; y?: string[]; result: Result };
type Table = { id: string; title: string; result: Result; note?: string };
type List = { id: string; title: string; metric: string; format: Format; dimension: string; dimKey?: string; metricKey?: string; top: { name: string; value: number | null; sub?: string }[]; bottom: { name: string; value: number | null; sub?: string }[] };
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
type Rec = { title: string; detail: string; owner: string; priority: 'high' | 'medium' | 'low'; timeline?: string; kpi?: string; impact?: string };
type SectionAI = { title?: string; lead?: string; edited?: boolean; headline: string; summary: string; insights: string[]; findings: string[]; recommendations: Rec[]; notes: Record<string, string>; model?: string; source: 'ai' | 'rules'; at: string };
type GlanceAI = { edited?: boolean; headline: string; tagline: string; summary: string; insights: string[]; highlights: { section: string; text: string }[]; watch: string[]; notes: Record<string, string>; model?: string; source: 'ai' | 'rules'; at: string };
type PinItem = { id: string; part: string; block: Block; at: string };
type Extras = { pins: PinItem[]; notes: ReviewNote[]; speaker?: Record<string, string> };
type AI = { glance?: GlanceAI; sections: Record<string, SectionAI>; extras?: Partial<Extras> };
/** Assistant results the user pinned into a chapter. */
const PinsCtx = createContext<{ pins: PinItem[]; remove: (id: string) => void } | null>(null);
function Pins({ part, n }: { part: string; n: string }) {
  const c = useContext(PinsCtx); const mine = c?.pins.filter((p) => p.part === part) ?? [];
  if (!c || !mine.length) return null;
  return <>
    <div className="epr-sub epr-rv in"><span>{n}</span><h3>Added from the assistant</h3><em>{mine.length} item{mine.length === 1 ? '' : 's'}</em></div>
    <div className="epr-pins">{mine.map((p) => (
      <div key={p.id} className="epr-pin">
        <div className="epr-pin-h"><Pin size={12} /><span>Added {new Date(p.at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}</span><button className="no-print" onClick={() => c.remove(p.id)} title="Remove from report"><Trash2 size={13} /></button></div>
        <BlockView block={p.block} />
      </div>
    ))}</div>
  </>;
}
type Saved = { review: Review; ai: AI; created_at: string; updated_at: string; reused?: boolean };
type HistoryItem = { id: string; label: string; scope: string; created_at: string; updated_at: string; ai_parts: number };

type Base = 'prev' | 'ytd' | 'ly';

/* ── baseline (vs prev / YTD / LY) shared by every number in the report ── */
const RBase = createContext<{ base: Base; P: ReportPeriod } | null>(null);
function useChg() {
  const c = useContext(RBase); const base = c?.base ?? 'prev';
  const chg = (k: Kpi) => (base === 'prev' ? k.chg : base === 'ytd' ? k.chgYtd : k.chgLy);
  const label = c ? (base === 'prev' ? c.P.prevLabel : base === 'ytd' ? c.P.ytdLabel : c.P.lyLabel) : '';
  return { chg, label };
}

/* ── drill-down: every number in the review opens the records behind it ── */
type DrillApi = { kpi: (k: Kpi, extra?: DrillFilter[], ctx?: string[]) => void; slice: (metric: string, filters: DrillFilter[], ctx: string[], expected?: number | null) => void };
const RDrill = createContext<DrillApi | null>(null);
const useRD = () => useContext(RDrill);
const clickable = (fn?: () => void) => fn ? { onClick: fn, role: 'button' as const, tabIndex: 0, onKeyDown: (e: React.KeyboardEvent) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fn(); } }, 'data-drill': '' } : {};

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
  const d = useRD();
  const ctx = vals.length > 2 && k.value !== null ? context(k.value, vals, k) : null;
  return (
    <div className={clsx('epr-kpi epr-rv', big && 'big')} style={{ transitionDelay: `${i * 45}ms` }} title={`${k.description}${d ? ' — click for the records behind this number' : ''}`} {...clickable(d ? () => d.kpi(k) : undefined)}>
      <div className="epr-kpi-l">{k.label}</div>
      <div className="epr-kpi-v">{k.value === null ? '—' : <CountUp value={k.value} format={(n) => fmtK(n, k.format)} />}</div>
      <Delta k={k} base={base} P={P} />
      <div className="epr-kpi-ref">{base === 'prev' ? P.prevLabel : base === 'ytd' ? P.ytdLabel : P.lyLabel}: <b>{fmtK(ref, k.format)}</b></div>
      {ctx && <div className={clsx('epr-kpi-ctx', ctx.t)}>{ctx.text}</div>}
      {vals.length > 2 && <div className="epr-kpi-spark"><Sparkline values={vals} height={28} color={t > 0 ? 'var(--epr-good)' : t < 0 ? 'var(--epr-bad)' : 'var(--accent)'} format={(n) => fmtK(n, k.format)} /></div>}
    </div>
  );
}
/** Where this period sits in the trailing series — a quick sense of "is this unusual?". */
function context(v: number, vals: number[], k: Kpi): { text: string; t: string } | null {
  const hist = vals.slice(0, -1); if (hist.length < 3) return null;
  const hi = Math.max(...hist), lo = Math.min(...hist), n = hist.length + 1;
  const good = k.higherIsBetter === false ? 'bad' : 'good', bad = good === 'good' ? 'bad' : 'good';
  if (v >= hi) return { text: `Highest in ${n} periods`, t: good };
  if (v <= lo) return { text: `Lowest in ${n} periods`, t: bad };
  const avg = hist.reduce((a, b) => a + b, 0) / hist.length;
  if (!avg) return null;
  const p = (v - avg) / Math.abs(avg);
  if (Math.abs(p) < 0.03) return { text: `In line with ${hist.length}-period average`, t: 'flat' };
  return { text: `${p > 0 ? 'Above' : 'Below'} ${hist.length}-period average by ${Math.abs(p * 100).toFixed(0)}%`, t: p > 0 ? good : bad };
}
/* ── inline editing (admins): any AI-written text can be edited in place and autosaves ── */
type Path = (string | number)[];
type EditApi = { on: boolean; set: (part: string, path: Path, value: string) => void };
const REdit = createContext<EditApi | null>(null);
const useEdit = () => useContext(REdit);
function Ed({ part, path, value, as: Tag = 'span', className, placeholder }: { part: string; path: Path; value?: string; as?: 'span' | 'p' | 'div' | 'h1' | 'h2' | 'b'; className?: string; placeholder?: string }) {
  const e = useEdit();
  if (!e?.on) return <Tag className={className}>{value}</Tag>;
  return <Tag className={clsx(className, 'epr-ed')} data-ph={placeholder ?? 'Write…'} contentEditable suppressContentEditableWarning spellCheck
    onKeyDown={(ev: React.KeyboardEvent) => { if (ev.key === 'Escape') (ev.currentTarget as HTMLElement).blur(); }}
    onBlur={(ev: React.FocusEvent<HTMLElement>) => { const v = ev.currentTarget.innerText.replace(/\u00a0/g, ' ').trim(); if (v !== (value ?? '')) e.set(part, path, v); }}>{value}</Tag>;
}
/** Words rise in one after another — used when AI text arrives live. */
function Words({ text, live }: { text: string; live?: boolean }) {
  if (!live) return <>{text}</>;
  return <span className="epr-words" aria-label={text}>{text.split(/(\s+)/).map((w, i) => (/\s+/.test(w) ? w : <span key={i} aria-hidden style={{ animationDelay: `${Math.min(i, 120) * 18}ms` }}>{w}</span>))}</span>;
}
const sentences = (t: string) => t.replace(/\s+/g, ' ').trim().split(/(?<=[.!?])\s+(?=[A-Z₹0-9"“(])/).filter(Boolean);
function Note({ text, loading, part, id, label = 'What this tells us' }: { text?: string; loading?: boolean; part: string; id: string; label?: string }) {
  const e = useEdit();
  if (loading && !text) return <div className="epr-note"><Shimmer lines={2} /></div>;
  if (!text && !e?.on) return null;
  const parts = (text ?? '').split(/\s*\|\s*/).map((x) => x.match(/^(Shows|Why it matters|Action)\s*:\s*(.*)$/i)).filter(Boolean) as RegExpMatchArray[];
  const [lead, ...rest] = sentences(text ?? '');
  const rows = parts.length >= 2 ? parts.map((m) => ({ k: m[1], v: m[2] })) : [{ k: 'Shows', v: lead ?? '' }, ...(rest.length ? [{ k: 'Why it matters', v: rest.join(' ') }] : [])];
  return (
    <div className="epr-note">
      <div className="epr-note-h"><Lightbulb size={12} />{label}</div>
      {e?.on ? <Ed as="p" className="epr-note-lead" part={part} path={['notes', id]} value={text} placeholder="Shows: … | Why it matters: … | Action: …" /> : (
        <dl className="epr-note-grid">{rows.map((x) => <div key={x.k} className={clsx('epr-note-row', /action/i.test(x.k) && 'act')}><dt>{x.k}</dt><dd>{x.v}</dd></div>)}</dl>
      )}
    </div>
  );
}
/** Shape AI prose for reading: a short standfirst (first 1–2 sentences), then paragraphs of ~2 sentences. */
function shape(text: string): string[] {
  const paras = text.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
  const all = paras.flatMap((p) => sentences(p));
  if (all.length < 3) return paras;
  const leadN = all[0].length < 90 && all.length > 3 ? 2 : 1;
  const out = [all.slice(0, leadN).join(' ')];
  const rest = all.slice(leadN);
  for (let i = 0; i < rest.length; i += 2) out.push(rest.slice(i, i + 2).join(' '));
  return out;
}
function Prose({ text, part, live }: { text?: string; part: string; live?: boolean }) {
  const e = useEdit();
  if (!text && !e?.on) return <Shimmer lines={6} />;
  if (e?.on) return <Ed as="div" className="epr-prose-ed" part={part} path={['summary']} value={text} />;
  const paras = shape(text ?? '');
  return <>{paras.map((p, i) => <p key={i} className={i === 0 ? 'lead' : ''}><Words text={p} live={live && i === 0} /></p>)}</>;
}
function ChartCard({ c, note, loading, part, h = 300, i = 0 }: { c: Chart; note?: string; loading?: boolean; part: string; h?: number; i?: number }) {
  return (
    <figure className="epr-card epr-rv" style={{ transitionDelay: `${i * 60}ms` }}>
      <figcaption className="epr-card-h"><span className="epr-card-t">{c.title}</span><span className="epr-card-tag">Click any point to drill in</span></figcaption>
      <InteractiveChart result={c.result} chart={c.chart} seriesBy={c.seriesBy} y={c.y} height={h} minimal />
      <Note text={note} loading={loading} part={part} id={c.id} />
    </figure>
  );
}
function TableCard({ t, note, loading, part, rows = 10 }: { t: Table; note?: string; loading?: boolean; part: string; rows?: number }) {
  const n = t.result.rows.length;
  return (
    <div className="epr-card epr-card-wide epr-rv">
      <div className="epr-card-h"><span className="epr-card-t">{t.title}</span><span className="epr-card-tag">{n} row{n === 1 ? '' : 's'} · click a value for its records</span></div>
      <div className="epr-table"><AdvancedTable result={t.result} compact pageSize={rows} /></div>
      <Note text={note ?? t.note} loading={loading} part={part} id={t.id} />
    </div>
  );
}
/** KPI grid that never leaves empty slots: picks a column count that divides evenly, otherwise stretches the last card. */
function KpiGrid({ kpis, base, P }: { kpis: Kpi[]; base: Base; P: ReportPeriod }) {
  const n = kpis.length; if (!n) return null;
  const cols = n <= 4 ? n : [4, 3, 5, 6].find((c) => n % c === 0 && n / c <= 3) ?? 4;
  const rem = n % cols; const span = rem ? cols - rem + 1 : 1;
  return (
    <div className={clsx('epr-grid-k', n % 2 && 'odd')} style={{ ['--cols' as string]: cols }}>
      {kpis.map((k, i) => <div key={k.id} className="epr-kslot" style={i === n - 1 && span > 1 ? { gridColumn: `span ${span}` } : undefined}><KpiCard k={k} base={base} P={P} i={i} /></div>)}
    </div>
  );
}
/** Full board scorecard — every headline metric against all three baselines. */
function Scorecard({ kpis, P }: { kpis: Kpi[]; P: ReportPeriod }) {
  const cell = (k: Kpi, ref: number | null, c: number | null) => { const t = tone(k, c); return (
    <td className="ref"><span>{fmtK(ref, k.format)}</span><em className={t > 0 ? 'good' : t < 0 ? 'bad' : ''}>{fmtDelta(c, k.format)}</em></td>
  ); };
  const status = (k: Kpi) => { const s = [k.chg, k.chgYtd, k.chgLy].map((c) => tone(k, c)).reduce<number>((a, b) => a + b, 0); return s >= 2 ? 'good' : s <= -2 ? 'bad' : 'mixed'; };
  const d = useRD();
  return (
    <div className="epr-card epr-card-wide epr-rv">
      <div className="epr-card-h"><span className="epr-card-ic"><Target size={13} /></span><span className="epr-card-t">Executive scorecard</span><span className="epr-card-tag">{kpis.length} metrics · 3 baselines</span></div>
      <div className="epr-score-wrap"><table className="epr-score">
        <thead><tr><th className="m">Metric</th><th>{P.label}</th><th>vs {P.prevLabel}</th><th>vs {P.ytdLabel}</th><th>vs {P.lyLabel}</th><th className="tr">Trend</th><th>Status</th></tr></thead>
        <tbody>{kpis.map((k) => { const vals = k.series.filter((v): v is number => v !== null); const st = status(k); return (
          <tr key={k.id} title={k.description} {...clickable(d ? () => d.kpi(k) : undefined)}>
            <td className="m">{k.label}</td>
            <td className="v">{fmtK(k.value, k.format)}</td>
            {cell(k, k.prev, k.chg)}{cell(k, k.ytd, k.chgYtd)}{cell(k, k.ly, k.chgLy)}
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
  const d = useRD();
  const vals = Object.values(hm.cells).map((c) => c.fill).filter((v): v is number => v !== null);
  const max = Math.max(...vals, 0.01);
  return (
    <div className="epr-card epr-rv">
      <div className="epr-card-h"><CalendarRange size={14} />Fill rate by weekday & hour</div>
      <div className="epr-heat-wrap"><table className="epr-heat"><thead><tr><th />{hm.cols.map((c) => <th key={c}>{c}</th>)}</tr></thead>
        <tbody>{hm.rows.map((r) => <tr key={r}><th>{r.slice(0, 3)}</th>{hm.cols.map((c) => { const cell = hm.cells[`${r}|${c}`]; if (!cell || cell.fill === null) return <td key={c} className="empty" />; const a = cell.fill / max;
          return <td key={c} {...clickable(d ? () => d.slice('fill_rate', [{ dimension: 'day_of_week', op: 'in', values: [r] }, { dimension: 'hour', op: 'in', values: [c] }], [r, c], cell.fill) : undefined)} title={`${r} ${c}: ${(cell.fill * 100).toFixed(0)}% fill · ${cell.classes} classes`} style={{ background: `color-mix(in srgb, var(--accent) ${Math.round(8 + a * 82)}%, transparent)`, color: a > 0.55 ? '#fff' : undefined }}>{Math.round(cell.fill * 100)}</td>; })}</tr>)}</tbody></table></div>
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
  const d = useRD();
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
        <li key={x.name} style={{ ['--d' as string]: `${j * 70}ms` }} {...clickable(d && l.dimKey && l.metricKey ? () => d.slice(l.metricKey!, [{ dimension: l.dimKey!, op: 'in', values: [x.name] }], [x.name], x.value) : undefined)}>
          <span className={clsx('rk', side)}>{j + 1}</span>
          <div className="nm"><b className="flex items-center gap-2">{l.dimKey === 'teacher' && <TrainerAvatar name={x.name} size={24} />}{x.name}</b>{x.sub && <em>{x.sub}</em>}<div className="bar"><i className={side} style={{ width: `${(Math.abs(x.value ?? 0) / max) * 100}%` }} /></div></div>
          <span className="v">{fmtK(x.value, l.format)}</span>
        </li>
      ))}</ol>
    </div>
  );
}
/** Biggest movers across the scorecard — what improved and what slipped, ranked by size of the move. */
function Signals({ kpis, base, P }: { kpis: Kpi[]; base: Base; P: ReportPeriod }) {
  const d = useRD();
  const chg = (k: Kpi) => (base === 'prev' ? k.chg : base === 'ytd' ? k.chgYtd : k.chgLy);
  const scored = kpis.filter((k) => chg(k) !== null && k.higherIsBetter !== undefined).map((k) => ({ k, t: tone(k, chg(k)), m: Math.abs(chg(k)!) }));
  const up = scored.filter((x) => x.t > 0).sort((a, b) => b.m - a.m).slice(0, 4);
  const down = scored.filter((x) => x.t < 0).sort((a, b) => b.m - a.m).slice(0, 4);
  const all = kpis.length; const onTrack = scored.filter((x) => x.t > 0).length; const atRisk = scored.filter((x) => x.t < 0).length;
  const lab = base === 'prev' ? P.prevLabel : base === 'ytd' ? P.ytdLabel : P.lyLabel;
  if (!up.length && !down.length) return null;
  const Row = ({ x }: { x: (typeof scored)[number] }) => (
    <li {...clickable(d ? () => d.kpi(x.k) : undefined)}><span className="n">{x.k.label}</span><span className="v">{fmtK(x.k.value, x.k.format)}</span><span className={clsx('c', x.t > 0 ? 'good' : 'bad')}>{fmtDelta(chg(x.k), x.k.format)}</span></li>
  );
  return (
    <div className="epr-signals epr-rv">
      <div className="epr-signals-sum">
        <div className="epr-eyebrow">Momentum vs {lab}</div>
        <div className="epr-signals-bar" aria-hidden><i className="good" style={{ flex: onTrack }} /><i className="flat" style={{ flex: Math.max(0, all - onTrack - atRisk) }} /><i className="bad" style={{ flex: atRisk }} /></div>
        <p><b>{onTrack}</b> of {all} metrics improving · <b>{atRisk}</b> slipping</p>
      </div>
      <div className="epr-signals-col"><h4><TrendingUp size={13} />Strongest gains</h4><ul>{up.map((x) => <Row key={x.k.id} x={x} />)}</ul></div>
      <div className="epr-signals-col"><h4><TrendingDown size={13} />Biggest slips</h4>{down.length ? <ul>{down.map((x) => <Row key={x.k.id} x={x} />)}</ul> : <p className="epr-small">Nothing slipped against this baseline.</p>}</div>
    </div>
  );
}
function Recs({ recs, part }: { recs: Rec[]; part: string }) {
  if (!recs.length) return null;
  return <div className="epr-recs">{recs.map((r, i) => (
    <div key={i} className={clsx('epr-rec epr-rv', r.priority)} style={{ transitionDelay: `${i * 70}ms` }}>
      <div className="epr-rec-top"><span className="epr-rec-n">{String(i + 1).padStart(2, '0')}</span><span className={clsx('pri', r.priority)}>{r.priority} priority</span></div>
      <Ed as="div" className="epr-rec-t" part={part} path={['recommendations', i, 'title']} value={r.title} />
      <Ed as="p" part={part} path={['recommendations', i, 'detail']} value={r.detail} />
      <dl className="epr-rec-meta">
        <div><dt>Owner</dt><dd><Ed part={part} path={['recommendations', i, 'owner']} value={r.owner} /></dd></div>
        {r.timeline && <div><dt>When</dt><dd><Ed part={part} path={['recommendations', i, 'timeline']} value={r.timeline} /></dd></div>}
        {r.kpi && <div className="w"><dt>Measure</dt><dd><Ed part={part} path={['recommendations', i, 'kpi']} value={r.kpi} /></dd></div>}
        {r.impact && <div className="w"><dt>Impact</dt><dd><Ed part={part} path={['recommendations', i, 'impact']} value={r.impact} /></dd></div>}
      </dl>
    </div>
  ))}</div>;
}
function List({ items, part, field, live }: { items: string[]; part: string; field: string; live?: boolean }) {
  return <ol>{items.map((x, i) => <li key={i} style={{ animationDelay: `${i * 90}ms` }} className={clsx(live && 'epr-pop')}><Ed part={part} path={[field, i]} value={x} /></li>)}</ol>;
}

/* ── deep set for edits ── */
function setIn<T>(obj: T, path: Path, v: unknown): T {
  const root = structuredClone(obj ?? {}) as Record<string | number, unknown>;
  let o = root;
  path.slice(0, -1).forEach((k, i) => { if (o[k] == null) o[k] = typeof path[i + 1] === 'number' ? [] : {}; o = o[k] as Record<string | number, unknown>; });
  o[path[path.length - 1]] = v;
  return root as T;
}

/* ── live build console: the AI plans first, then writes each section; the report assembles as parts land ── */
type Step = { id: string; label: string; state: 'done' | 'writing' | 'queued' };
function BuildConsole({ steps, hints, started }: { steps: Step[]; hints: string[]; started: number }) {
  const [now, setNow] = useState(Date.now());
  const [h, setH] = useState(0);
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 1000); const u = setInterval(() => setH((x) => x + 1), 2600); return () => { clearInterval(t); clearInterval(u); }; }, []);
  const done = steps.filter((s) => s.state === 'done').length;
  const cur = steps.find((s) => s.state === 'writing');
  return (
    <div className="epr-build">
      <div className="epr-build-h">
        <span className="epr-orb" aria-hidden><i /><i /><i /></span>
        <div className="min-w-0 flex-1">
          <div className="epr-eyebrow">Building your review · {Math.round((now - started) / 1000)}s</div>
          <div className="epr-build-t">{cur ? cur.label : 'Assembling…'}</div>
          {hints.length > 0 && <div className="epr-build-hint" key={h}>Looking at — {hints[h % hints.length]}</div>}
        </div>
        <div className="epr-build-pct">{Math.round((done / steps.length) * 100)}<small>%</small></div>
      </div>
      <div className="epr-build-bar"><i style={{ width: `${(done / steps.length) * 100}%` }} /></div>
      <ol className="epr-build-steps">{steps.map((s) => (
        <li key={s.id} className={s.state}><span className="dot">{s.state === 'done' ? <Check size={11} /> : s.state === 'writing' ? <Loader2 size={11} className="animate-spin" /> : null}</span>{s.label}</li>
      ))}</ol>
    </div>
  );
}

/* ═════════ landing (inside the app): set up a review, open past ones ═════════ */
function Landing() {
  const navigate = useNavigate();
  const [preset, setPreset] = useState('lm');
  const [month, setMonth] = useState(lastMonthValue());
  const [custom, setCustom] = useState(range('l3'));
  const [locs, setLocs] = useState<string[]>([]);
  const [allLocs, setAllLocs] = useState<string[]>([]);
  const [hist, setHist] = useState<HistoryItem[] | null>(null);
  const [building, setBuilding] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => { api<string[]>('/api/locations').then(setAllLocs).catch(() => {}); api<HistoryItem[]>('/api/review/saved').then(setHist).catch(() => setHist([])); }, []);
  const period = preset === 'custom' ? custom : preset === 'month' ? range('month', month) : range(preset);
  const chip = (on: boolean) => clsx('epr-chip', on && 'on');
  const generate = async () => {
    setBuilding(true); setErr(null);
    try { const s = await api<Saved>('/api/review', { method: 'POST', json: { ...period, locations: locs } }); navigate(`/review/${s.review.id}`); }
    catch (e) { setErr((e as Error).message); setBuilding(false); }
  };
  const del = async (id: string) => { if (!confirm('Delete this review? This cannot be undone.')) return; await api(`/api/review/${id}`, { method: 'DELETE' }); setHist((h) => h?.filter((x) => x.id !== id) ?? null); };
  const when = (d: string) => new Date(d.replace(' ', 'T')).toLocaleString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  return (
    <div className="epr h-full overflow-y-auto">
      <div className="epr-land">
        <header className="epr-land-h epr-in">
          <div className="epr-eyebrow">Executive Performance Review</div>
          <h1>Prepare a review</h1>
          <p>Pick a period and studios. The numbers are computed, then the AI plans the narrative and writes the review section by section — it opens as its own page.</p>
        </header>
        <div className="epr-setup epr-in" style={{ animationDelay: '80ms' }}>
          <div className="epr-setup-row"><span className="epr-setup-l">Period</span><div className="flex flex-wrap gap-1.5">{PRESETS.map(([k, l]) => <button key={k} className={chip(preset === k)} onClick={() => setPreset(k)}>{l}</button>)}</div></div>
          {preset === 'month' && <div className="epr-setup-row"><span className="epr-setup-l">Month</span><input type="month" value={month} onChange={(e) => setMonth(e.target.value)} className="epr-input" /></div>}
          {preset === 'custom' && <div className="epr-setup-row"><span className="epr-setup-l">Range</span><input type="date" value={custom.start} onChange={(e) => setCustom({ ...custom, start: e.target.value })} className="epr-input" /><span className="text-ink-3">→</span><input type="date" value={custom.end} onChange={(e) => setCustom({ ...custom, end: e.target.value })} className="epr-input" /></div>}
          <div className="epr-setup-row"><span className="epr-setup-l">Studios</span><div className="flex flex-wrap gap-1.5"><button className={chip(!locs.length)} onClick={() => setLocs([])}>All studios</button>{allLocs.map((l) => <button key={l} className={chip(locs.includes(l))} onClick={() => setLocs((x) => (x.includes(l) ? x.filter((y) => y !== l) : [...x, l]))}>{l}</button>)}</div></div>
          <div className="epr-setup-row epr-setup-go">
            <span className="mr-auto text-xs text-ink-3">{period.start} → {period.end} · {locs.length ? locs.join(', ') : 'all studios'}</span>
            <button className="epr-go" disabled={building} onClick={generate}>{building ? <><Loader2 size={15} className="animate-spin" />Computing numbers…</> : <><Wand2 size={15} />Prepare review</>}</button>
          </div>
          {err && <div className="epr-err"><AlertTriangle size={14} />{err}</div>}
        </div>
        <section className="epr-land-list">
          <div className="epr-eyebrow">Past reviews</div>
          {!hist ? <Shimmer lines={3} /> : !hist.length ? <p className="epr-small">No reviews yet — prepare your first one above.</p> : (
            <div className="epr-land-grid">{hist.map((h, i) => (
              <div key={h.id} className="epr-land-c epr-in" style={{ animationDelay: `${120 + i * 40}ms` }} {...clickable(() => navigate(`/review/${h.id}`))}>
                <div className="epr-land-c-p">{h.label}</div>
                <div className="epr-land-c-s">{h.scope}</div>
                <div className="epr-land-c-f"><span>{when(h.updated_at)}</span><span>{h.ai_parts} parts written</span></div>
                <div className="epr-land-c-a" onClick={(e) => e.stopPropagation()}>
                  <a href={`/review/${h.id}`} target="_blank" rel="noreferrer" title="Open in a new tab"><ArrowUpRight size={14} /></a>
                  <button className="epr-x" title="Delete" onClick={() => del(h.id)}><Trash2 size={13} /></button>
                </div>
              </div>
            ))}</div>
          )}
        </section>
      </div>
    </div>
  );
}

/* ═════════ page ═════════ */
export default function Review({ standalone, publicView }: { embedded?: boolean; standalone?: boolean; publicView?: boolean }) {
  return standalone ? <ReviewDoc publicView={!!publicView} /> : <Landing />;
}

function ReviewDoc({ publicView }: { publicView: boolean }) {
  const me = useMe();
  const isAdmin = me?.role === 'admin';
  const { reviewId } = useParams();
  const navigate = useNavigate();
  const [saved, setSaved] = useState<Saved | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<Set<string>>(new Set());
  const [failed, setFailed] = useState<Set<string>>(new Set());
  const [fresh, setFresh] = useState<Set<string>>(new Set());   // parts that arrived live this session (animate them)
  const [err, setErr] = useState<string | null>(null);
  const [base, setBase] = useState<Base>('prev');
  const [active, setActive] = useState('cover');
  const [copied, setCopied] = useState(false);
  const [editOn, setEditOn] = useState(false);
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [brief, setBrief] = useState(false);
  const [scale, setScale] = useState(() => { try { return Number(localStorage.getItem('epr-scale')) || 1; } catch { return 1; } });
  const [progress, setProgress] = useState(0);
  const [startedAt] = useState(Date.now());
  const [askOpen, setAskOpen] = useState(false);
  const [spkOpen, setSpkOpen] = useState(false); const [viewOpen, setViewOpen] = useState(false);
  const [spkNotes, setSpkNotes] = useState<Record<string, string>>({});
  const [tool, setTool] = useState<Tool>('none');
  const [ink, setInk] = useState('#e11d48');
  const [clearK, setClearK] = useState(0); const [undoK, setUndoK] = useState(0);
  const [present, setPresent] = useState(false); const [pbar, setPbar] = useState(false);
  const [pinBlock, setPinBlock] = useState<Block | null>(null);
  const [extras, setExtras] = useState<Extras>({ pins: [], notes: [] });
  const rootRef = useRef<HTMLDivElement>(null); const mainRef = useRef<HTMLDivElement>(null);
  const exTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const revealRef = useReveal();
  const started = useRef<Set<string>>(new Set());
  const timers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  const latestAi = useRef<AI | null>(null);
  latestAi.current = saved?.ai ?? null;

  useEffect(() => {
    setLoading(true); setSaved(null); started.current = new Set();
    api<Saved>(publicView ? `/api/public/review/${reviewId}` : `/api/review/${reviewId}`).then(setSaved).catch((e) => setErr((e as Error).message)).finally(() => setLoading(false));
  }, [reviewId]);
  useEffect(() => { try { localStorage.setItem('epr-scale', String(scale)); } catch { /* */ } }, [scale]);
  const loadedExtras = useRef<string | null>(null);
  useEffect(() => { if (saved && loadedExtras.current !== saved.review.id) { loadedExtras.current = saved.review.id; setExtras({ pins: (saved.ai.extras?.pins ?? []) as PinItem[], notes: (saved.ai.extras?.notes ?? []) as ReviewNote[], speaker: saved.ai.extras?.speaker }); let sp = saved.ai.extras?.speaker ?? {}; if (publicView) { try { sp = { ...sp, ...JSON.parse(localStorage.getItem(`epr-spk-${saved.review.id}`) ?? '{}') }; } catch { /* */ } } setSpkNotes(sp); } }, [saved]);
  const saveExtras = (next: Extras) => {
    setExtras(next);
    if (exTimer.current) clearTimeout(exTimer.current);
    if (publicView) return;
    exTimer.current = setTimeout(() => { if (saved) api(`/api/review/${saved.review.id}/extras`, { method: 'PUT', json: { extras: next } }).catch((e) => setErr(`Could not save: ${(e as Error).message}`)); }, 500);
  };
  const addPin = (part: string) => { if (!pinBlock) return; saveExtras({ ...extras, pins: [...extras.pins, { id: `p${Date.now().toString(36)}`, part, block: pinBlock, at: new Date().toISOString() }] }); setPinBlock(null); setTimeout(() => document.getElementById(`epr-${part}`)?.querySelector('.epr-pins')?.lastElementChild?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 200); };
  const notesApi = { notes: extras.notes, update: (id: string, patch: Partial<ReviewNote>) => saveExtras({ ...extras, notes: extras.notes.map((n) => (n.id === id ? { ...n, ...patch } : n)) }), remove: (id: string) => saveExtras({ ...extras, notes: extras.notes.filter((n) => n.id !== id) }) };
  const placeNote = (e: React.MouseEvent) => {
    if (tool !== 'note') return;
    const sec = (e.target as HTMLElement).closest('[data-spy]') as HTMLElement | null; if (!sec || (e.target as HTMLElement).closest('.epr-sticky')) return;
    const r = sec.getBoundingClientRect();
    saveExtras({ ...extras, notes: [...extras.notes, { id: `n${Date.now().toString(36)}`, sec: sec.id.replace('epr-', ''), x: Math.min(0.85, (e.clientX - r.left) / r.width), y: (e.clientY - r.top) / r.height, text: '', color: NOTE_COLORS[0], by: me?.name, at: new Date().toISOString() }] });
    setTool('none');
  };
  const togglePresent = () => { if (!document.fullscreenElement) { rootRef.current?.requestFullscreen?.().catch(() => {}); setPresent(true); setPbar(true); } else { document.exitFullscreen?.(); } };
  useEffect(() => { const h = () => { if (!document.fullscreenElement) setPresent(false); }; document.addEventListener('fullscreenchange', h); return () => document.removeEventListener('fullscreenchange', h); }, []);

  const writePart = useCallback(async (id: string, part: string, again = false) => {
    setBusy((b) => new Set(b).add(part));
    try {
      const r = await api<{ part: string; content: GlanceAI | SectionAI }>(`/api/review/${id}/ai`, { method: 'POST', json: { part, fresh: again } });
      setFresh((f) => new Set(f).add(part));
      setSaved((s) => (!s || s.review.id !== id ? s : { ...s, ai: part === 'glance' ? { ...s.ai, glance: r.content as GlanceAI } : { ...s.ai, sections: { ...s.ai.sections, [part]: r.content as SectionAI } } }));
    } catch (e) { setFailed((f) => new Set(f).add(part)); setErr(`AI (${part}): ${(e as Error).message}`); }
    finally { setBusy((b) => { const n = new Set(b); n.delete(part); return n; }); }
  }, []);
  // plan first (the overview reads every section), then write the sections three at a time
  useEffect(() => {
    if (!saved || publicView) return;   // public viewers never trigger AI
    const id = saved.review.id;
    const missing = (p: string) => !(p === 'glance' ? saved.ai.glance : saved.ai.sections?.[p]) && !started.current.has(`${id}:${p}`);
    const secs = saved.review.sections.map((s) => s.id).filter(missing);
    const doGlance = missing('glance');
    if (!doGlance && !secs.length) return;
    [...(doGlance ? ['glance'] : []), ...secs].forEach((p) => started.current.add(`${id}:${p}`));
    (async () => {
      if (doGlance) await writePart(id, 'glance');
      let i = 0; const next = async (): Promise<void> => { const p = secs[i++]; if (!p) return; await writePart(id, p); return next(); };
      await Promise.all([next(), next(), next()]);
    })();
  }, [saved, writePart]);

  // scroll-spy + reading progress
  useEffect(() => {
    const root = scroller.current; if (!root || !saved) return;
    const io = new IntersectionObserver((es) => { const v = es.filter((e) => e.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0]; if (v) setActive(v.target.id.replace('epr-', '')); }, { root, rootMargin: '-30% 0px -60% 0px' });
    const scan = () => root.querySelectorAll('[data-spy]').forEach((el) => io.observe(el)); scan();
    const mo = new MutationObserver(scan); mo.observe(root, { childList: true, subtree: true });
    const onScroll = () => setProgress(root.scrollTop / Math.max(1, root.scrollHeight - root.clientHeight));
    root.addEventListener('scroll', onScroll, { passive: true });
    return () => { io.disconnect(); mo.disconnect(); root.removeEventListener('scroll', onScroll); };
  }, [saved]);
  useEffect(() => { document.querySelector('.epr-nav button.on')?.scrollIntoView({ inline: 'center', block: 'nearest', behavior: 'smooth' }); }, [active]);

  const rv = saved?.review; const ai = saved?.ai; const P = rv?.period;
  const gl = ai?.glance;
  const order = useMemo(() => (rv ? ['glance', ...rv.sections.map((s) => s.id)] : []), [rv]);
  const has = (p: string) => publicView || !!(p === 'glance' ? ai?.glance : ai?.sections?.[p]) || failed.has(p);
  // the report assembles in order: a part shows only once it and everything before it is written
  const shown = (() => { let n = 0; for (const p of order) { if (has(p)) n++; else break; } return n; })();
  const building = shown < order.length;
  const visible = new Set(order.slice(0, shown));
  const nav = useMemo(() => rv ? [{ id: 'cover', title: 'Cover' }, { id: 'glance', title: 'At a glance' }, ...rv.sections.map((s) => ({ id: s.id, title: ai?.sections?.[s.id]?.title ?? s.title })), { id: 'closing', title: 'Action plan' }] : [], [rv, ai]);
  const speakerChapters: SpeakerChapter[] = useMemo(() => {
    if (!rv) return [];
    const num = (k: Kpi) => { const c = base === 'prev' ? k.chg : base === 'ytd' ? k.chgYtd : k.chgLy; return { label: k.label, value: fmtK(k.value, k.format), delta: fmtDelta(c, k.format), tone: tone(k, c) }; };
    const recs = (r?: Rec[]) => (r ?? []).map((x) => `${x.title} — ${x.owner}${x.timeline ? `, ${x.timeline}` : ''}`);
    return [
      { id: 'glance', n: '01', title: 'At a glance', headline: ai?.glance?.headline, summary: ai?.glance?.summary, points: ai?.glance?.insights ?? [], numbers: rv.cover.headlineKpis.map(num), actions: ai?.glance?.watch ?? [] },
      ...rv.sections.map((x, i) => { const a = ai?.sections[x.id]; return { id: x.id, n: String(i + 2).padStart(2, '0'), title: a?.title ?? x.title, headline: a?.headline, summary: a?.summary, points: a?.insights?.length ? a.insights : x.ruleFindings.slice(0, 4), numbers: x.kpis.slice(0, 5).map(num), actions: recs(a?.recommendations) }; }),
      { id: 'closing', n: String(rv.sections.length + 2).padStart(2, '0'), title: 'Summary & action plan', headline: ai?.glance?.tagline, points: rv.sections.map((x) => ai?.sections[x.id]?.headline ?? '').filter(Boolean), numbers: [], actions: rv.sections.flatMap((x) => recs(ai?.sections[x.id]?.recommendations?.filter((r) => r.priority === 'high'))) },
    ];
  }, [rv, ai, base]);
  const jump = (id: string) => document.getElementById(`epr-${id}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });

  // keyboard: j / k to move between sections
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement; if (t.isContentEditable || /INPUT|TEXTAREA|SELECT/.test(t.tagName) || e.metaKey || e.ctrlKey) return;
      const ids = nav.map((n) => n.id).filter((id) => document.getElementById(`epr-${id}`)); const i = ids.indexOf(active);
      const k = e.key;
      if (k === 'j' || (present && (k === 'ArrowRight' || k === 'PageDown'))) { e.preventDefault(); jump(ids[Math.min(ids.length - 1, i + 1)]); }
      else if (k === 'k' || (present && (k === 'ArrowLeft' || k === 'PageUp'))) { e.preventDefault(); jump(ids[Math.max(0, i - 1)]); }
      else if (k === 'Escape') setTool('none');
      else if (k === 'f') togglePresent();
      else if (k === '/') { e.preventDefault(); setAskOpen(true); }
      else if (k === '?') setPbar(true);
      else if (k === 'u') setUndoK((x) => x + 1);
      else if (k === 'c') setClearK((x) => x + 1);
      else { const t = ({ l: 'laser', s: 'spot', p: 'pen', h: 'hl', n: 'note' } as Record<string, Tool>)[k]; if (t) { setPbar(true); setTool((cur) => (cur === t ? 'none' : t)); } }
    };
    window.addEventListener('keydown', h); return () => window.removeEventListener('keydown', h);
  }, [nav, active, present]); // eslint-disable-line react-hooks/exhaustive-deps

  const openDrill = useDrill();
  const drillApi: DrillApi | null = rv && P && openDrill ? (() => {
    const loc: DrillFilter[] = rv.request.locations.length ? [{ dimension: 'location', op: 'in', values: rv.request.locations }] : [];
    const slice: DrillApi['slice'] = (metric, filters, ctx, expected = null) => openDrill({ metric, filters: [...loc, ...filters], start: rv.request.start, end: rv.request.end, context: [...ctx, rv.scope, P.label], expected });
    return { slice, kpi: (k, extra = [], ctx = []) => slice(k.id, extra, [k.label, ...ctx], k.value) };
  })() : null;

  const editApi: EditApi = {
    on: editOn && isAdmin,
    set: (part, path, value) => {
      if (!rv) return;
      setSaved((s) => { if (!s) return s; const cur = part === 'glance' ? s.ai.glance : s.ai.sections?.[part]; const nextPart = setIn(cur ?? {}, path, value);
        return { ...s, ai: part === 'glance' ? { ...s.ai, glance: nextPart as GlanceAI } : { ...s.ai, sections: { ...s.ai.sections, [part]: nextPart as SectionAI } } }; });
      setSaveState('saving');
      clearTimeout(timers.current[part]);
      timers.current[part] = setTimeout(async () => {
        const a = latestAi.current; const content = part === 'glance' ? a?.glance : a?.sections?.[part];
        try { await api(`/api/review/${rv.id}/ai/${part}`, { method: 'PUT', json: { content } }); setSaveState('saved'); }
        catch (e) { setSaveState('error'); setErr(`Save failed: ${(e as Error).message}`); }
      }, 700);
    },
  };

  const copyLink = async () => { if (!rv) return; try { await navigator.clipboard.writeText(`${location.origin}/review/${rv.id}`); setCopied(true); setTimeout(() => setCopied(false), 1600); } catch { /* */ } };
  const refresh = async () => {
    if (!rv || !confirm('Recompute every number from the latest data? The AI will write a fresh review.')) return;
    try { const s = await api<Saved>('/api/review', { method: 'POST', json: { ...rv.request, fresh: true } }); navigate(`/review/${s.review.id}`); } catch (e) { setErr((e as Error).message); }
  };

  const hints = useMemo(() => rv ? rv.sections.flatMap((s) => s.ruleFindings.slice(0, 2)).filter(Boolean) : [], [rv]);
  const steps: Step[] = rv ? [
    { id: 'data', label: `Computed ${rv.scorecard.length + rv.sections.reduce((a, s) => a + s.kpis.length, 0)} metrics across ${rv.sections.length} sections`, state: 'done' },
    { id: 'glance', label: 'Planning the narrative — reading every section before writing', state: has('glance') ? 'done' : busy.has('glance') ? 'writing' : 'queued' },
    ...rv.sections.map((s) => ({ id: s.id, label: `Analysing ${s.title.replace(/ Index$/, '')}`, state: (has(s.id) ? 'done' : busy.has(s.id) ? 'writing' : 'queued') as Step['state'] })),
  ] : [];

  return (
    <REdit.Provider value={editApi}>
    <PinCtx.Provider value={setPinBlock}><NotesCtx.Provider value={notesApi}><PinsCtx.Provider value={{ pins: extras.pins, remove: (id) => saveExtras({ ...extras, pins: extras.pins.filter((p) => p.id !== id) }) }}>
    <div ref={rootRef} className={clsx('epr epr-standalone flex h-full flex-col', brief && 'brief', editApi.on && 'editing', present && 'presenting', tool !== 'none' && `tool-${tool}`)} style={{ ['--epr-scale' as string]: scale }}>
      <div className="epr-bar no-print">
        <div className="epr-bar-in">
          <button className="epr-ibtn" onClick={() => (publicView ? location.assign('/') : navigate('/review'))} title={publicView ? 'Sign in to the app' : 'Back to the app'}><ArrowLeft size={16} /></button>
          <div className="epr-bar-t"><b>Performance Review</b>{rv && P && <span>{P.label} · {rv.scope}</span>}</div>
          {rv && <div className="epr-tools">
            <div className="epr-seg sm" title="Baseline used on every comparison"><button className={clsx(base === 'prev' && 'on')} onClick={() => setBase('prev')}>Prev</button><button className={clsx(base === 'ytd' && 'on')} onClick={() => setBase('ytd')}>YTD</button><button className={clsx(base === 'ly' && 'on')} onClick={() => setBase('ly')}>LY</button></div>
            <div className="relative">
              <button className={clsx('epr-ibtn', viewOpen && 'on')} onClick={() => setViewOpen((o) => !o)} title="View — full or brief, text size"><SlidersHorizontal size={15} /></button>
              {viewOpen && <div className="epr-pop" onMouseLeave={() => setViewOpen(false)}>
                <div className="epr-pop-l">Content</div>
                <div className="epr-seg sm"><button className={clsx(!brief && 'on')} onClick={() => setBrief(false)}>Full report</button><button className={clsx(brief && 'on')} onClick={() => setBrief(true)}>Brief</button></div>
                <div className="epr-pop-l">Text size · {Math.round(scale * 100)}%</div>
                <div className="epr-seg sm"><button onClick={() => setScale((x) => Math.max(0.9, +(x - 0.05).toFixed(2)))}>A−</button><button onClick={() => setScale(1)}>Reset</button><button onClick={() => setScale((x) => Math.min(1.25, +(x + 0.05).toFixed(2)))}>A+</button></div>
              </div>}
            </div>
            <i className="epr-vsep" />
            {isAdmin && !publicView && <button className={clsx('epr-ibtn', editOn && 'on')} onClick={() => setEditOn((o) => !o)} title={editOn ? 'Done editing' : 'Edit the report text in place — saves automatically'}><Pencil size={15} /></button>}
            {editOn && <span className={clsx('epr-save', saveState)}>{saveState === 'saving' ? 'Saving…' : saveState === 'saved' ? 'Saved' : saveState === 'error' ? 'Not saved' : 'Editing'}</span>}
            <button className="epr-ibtn" onClick={() => window.print()} title="Print or save as PDF"><Printer size={15} /></button>
            <button className="epr-ibtn" onClick={copyLink} title="Copy the public link">{copied ? <Check size={15} /> : <Link2 size={15} />}</button>
            {!publicView && <button className="epr-ibtn" onClick={refresh} title="Recompute from the latest data"><RefreshCw size={15} /></button>}
            <i className="epr-vsep" />
            <button className={clsx('epr-ibtn', pbar && 'on')} onClick={() => setPbar((x) => !x)} title="Presenter tools — laser, spotlight, pen, notes, timer"><PenLine size={15} /></button>
            <button className={clsx('epr-ibtn', spkOpen && 'on')} onClick={() => { setSpkOpen((x) => !x); setAskOpen(false); }} title="Speaker notes & teleprompter"><ScrollText size={15} /></button>
            {!publicView && <button className={clsx('epr-ask', askOpen && 'on')} onClick={() => { setAskOpen((x) => !x); setSpkOpen(false); }} title="Ask the assistant about this report ( / )"><MessageSquare size={14} /><span>Ask AI</span></button>}
          </div>}
        </div>
        <div className="epr-progress" style={{ transform: `scaleX(${progress})` }} />
        {err && <div className="epr-err"><AlertTriangle size={14} />{err}<button onClick={() => setErr(null)}><X size={13} /></button></div>}
      </div>

      <div className="flex min-h-0 flex-1">
      {rv && <nav className="epr-rail2 no-print" aria-label="Chapters">{nav.map((n, i) => {
        const part = n.id === 'cover' ? 'glance' : n.id; const ready = n.id === 'closing' ? !building : visible.has(part);
        return <button key={n.id} disabled={!ready} onClick={() => jump(n.id)} className={clsx(active === n.id && 'on', !ready && 'wait')} aria-current={active === n.id ? 'true' : undefined}>
          <span className="i">{busy.has(part) ? <Loader2 size={11} className="animate-spin" /> : i === 0 ? '◆' : String(i).padStart(2, '0')}</span><span className="t">{n.title.replace(/ Index$/, '')}</span></button>;
      })}<div className="epr-rail2-p"><i style={{ height: `${progress * 100}%` }} /></div></nav>}
      <div ref={scroller} className="epr-scroll min-h-0 flex-1 overflow-y-auto overflow-x-hidden">
        <div ref={(el) => { (revealRef as React.MutableRefObject<HTMLDivElement | null>).current = el; mainRef.current = el; }} className="epr-wrap relative" onClick={placeNote}>
          {loading && <div className="epr-loading"><Loader2 className="animate-spin" />Opening review…</div>}
          {rv && P && (
            <RBase.Provider value={{ base, P }}><RDrill.Provider value={drillApi}>
              <div className="epr-main">
                {visible.has('glance') && <Cover rv={rv} gl={gl} P={P} live={fresh.has('glance')} jump={jump} drill={drillApi} />}
                {visible.has('glance') && <Glance rv={rv} ai={ai} gl={gl} P={P} base={base} live={fresh.has('glance')} busy={busy.has('glance')} canAi={!!me?.aiConfigured} onRewrite={() => writePart(rv.id, 'glance', true)} jump={jump} />}
                {rv.sections.map((s, i) => visible.has(s.id) && <ReviewSectionView key={s.id} n={i + 2} total={rv.sections.length + 1} s={s} ai={ai?.sections[s.id]} live={fresh.has(s.id)} busy={busy.has(s.id)} base={base} P={P} canAi={!!me?.aiConfigured} onRewrite={() => writePart(rv.id, s.id, true)} />)}
                {building && <BuildConsole steps={steps} hints={hints} started={startedAt} />}
                {!building && <Closing rv={rv} ai={ai} P={P} jump={jump} />}
                {!building && <div className="epr-end">End of review · {rv.scope} · {P.label}</div>}
              </div>
            </RDrill.Provider></RBase.Provider>
          )}
        </div>
      </div>
      {spkOpen && rv && P && <SpeakerPanel chapters={speakerChapters} active={active === 'cover' ? 'glance' : active} onJump={jump} notes={spkNotes} canSave={!publicView}
        onNote={(id, t) => { const nx = { ...spkNotes, [id]: t }; setSpkNotes(nx); if (!publicView) saveExtras({ ...extras, speaker: nx }); else try { localStorage.setItem(`epr-spk-${rv.id}`, JSON.stringify(nx)); } catch { /* */ } }} onClose={() => setSpkOpen(false)} />}
      {askOpen && rv && !publicView && (
        <aside className="epr-askp no-print">
          <div className="epr-askp-h"><Sparkles size={14} /><b>Ask about this report</b><button onClick={() => setAskOpen(false)} title="Close"><X size={15} /></button></div>
          <div className="min-h-0 flex-1"><Analyst embedded onConversationsChange={() => {}} reviewId={rv.id}
            intro="Ask anything about this review or any other data. Ask it to build a table, chart, comparison or summary — then add it to any chapter."
            prompts={['What are the three biggest risks in this review, and what should we do first?', 'Build a table of every trainer with class average, fill rate, new clients and conversion, ranked.', 'Compare this period with the same month last year across all headline metrics, as a table.', 'Chart weekly visits for the last 6 months by format.']} /></div>
        </aside>
      )}
      </div>
      <InkLayer scroller={scroller} tool={tool} color={ink} clearKey={clearK} undoKey={undoK} />
      <PointerFx tool={tool} />
      <PresenterBar tool={tool} setTool={setTool} color={ink} setColor={setInk} onClear={() => setClearK((x) => x + 1)} onUndo={() => setUndoK((x) => x + 1)} present={present} togglePresent={togglePresent} open={pbar} setOpen={setPbar} />
      {pinBlock && rv && (
        <div className="epr-modal no-print" onClick={() => setPinBlock(null)}>
          <div className="epr-modal-c" onClick={(e) => e.stopPropagation()}>
            <div className="epr-modal-h"><Pin size={15} /><b>Add to which chapter?</b><button onClick={() => setPinBlock(null)}><X size={15} /></button></div>
            <p className="epr-small">“{pinBlock.title ?? pinBlock.result?.title ?? 'Assistant result'}” will appear in the chapter under “Added from the assistant” and is saved with this review.</p>
            <div className="epr-modal-list">
              <button onClick={() => addPin('glance')}><span>01</span>At a glance</button>
              {rv.sections.map((x, i) => <button key={x.id} onClick={() => addPin(x.id)}><span>{String(i + 2).padStart(2, '0')}</span>{ai?.sections[x.id]?.title ?? x.title}</button>)}
              <button onClick={() => addPin('closing')}><span>{String(rv.sections.length + 2).padStart(2, '0')}</span>Summary & action plan</button>
            </div>
          </div>
        </div>
      )}
    </div>
    </PinsCtx.Provider></NotesCtx.Provider></PinCtx.Provider>
    </REdit.Provider>
  );
}

function Cover({ rv, gl, P, live, jump, drill }: { rv: Review; gl?: GlanceAI; P: ReportPeriod; live: boolean; jump: (id: string) => void; drill: DrillApi | null }) {
  const B = useChg();
  return (
    <section id="epr-cover" data-spy className={clsx('epr-cover epr-build-in', live && 'live')}>
      <div className="epr-cover-l">
        <div className="epr-cover-top"><img src={BRAND.logoOnDark} alt="Physique 57" /><span className="epr-cover-conf">Confidential</span></div>
        <div className="epr-cover-mid">
          <div className="epr-cover-eyebrow">Executive Performance Review · {P.label}</div>
          <div className="epr-cover-rule" />
          {gl && <Ed as="h1" part="glance" path={['headline']} value={gl.headline} />}
          {gl && <Ed as="p" className="epr-cover-tag" part="glance" path={['tagline']} value={gl.tagline} />}
        </div>
        <dl className="epr-cover-meta">
          <div><dt>Scope</dt><dd>{rv.scope}</dd></div>
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
      <div className="epr-cover-kpis">{rv.cover.headlineKpis.map((k, i) => { const t = tone(k, B.chg(k)); return (
        <div key={k.id} style={{ animationDelay: `${300 + i * 80}ms` }} {...clickable(drill ? () => drill.kpi(k) : undefined)}><span>{k.label}</span><b>{k.value === null ? '—' : <CountUp value={k.value} format={(n) => fmtK(n, k.format)} />}</b><em className={t > 0 ? 'good' : t < 0 ? 'bad' : ''}>{t > 0 ? '▲' : t < 0 ? '▼' : '•'} {fmtDelta(B.chg(k), k.format)} <i>vs {B.label}</i></em></div>
      ); })}</div>
      <div className="epr-cover-foot">Figures computed from synced studio data{gl?.source === 'ai' ? ` · commentary by ${gl.model ?? 'Claude'}` : ''} · Ref {rv.id.slice(0, 8).toUpperCase()}</div>
    </section>
  );
}

function Glance({ rv, ai, gl, P, base, live, busy, canAi, onRewrite, jump }: { rv: Review; ai?: AI; gl?: GlanceAI; P: ReportPeriod; base: Base; live: boolean; busy: boolean; canAi: boolean; onRewrite: () => void; jump: (id: string) => void }) {
  const B = useChg();
  return (
    <section id="epr-glance" data-spy className="epr-sec epr-build-in">
      <SectionHead n={1} total={rv.sections.length + 1} kicker="Overview" title="At a glance" lead={`${rv.scope} · ${P.label} — every key metric and finding from the sections that follow.`} right={<PartActions ai={gl} busy={busy} canAi={canAi} onRewrite={onRewrite} />} stats={rv.cover.headlineKpis} />
      <Sub n="1.1" title="Executive summary" />
      <Analysis part="glance" ai={gl} live={live} label="Executive summary" fallback={[]} />
      <Sub n="1.2" full title="Headline numbers" note="Click any number for the records behind it" />
      <KpiGrid kpis={rv.glance.cards} base={base} P={P} />
      {rv.scorecard?.length > 0 && <Signals kpis={rv.scorecard} base={base} P={P} />}
      <Sub n="1.3" full title="Chapter by chapter" />
      <div className="epr-highlights epr-full">{rv.sections.map((s, i) => {
        const h = gl?.highlights.find((x) => x.section === s.id)?.text ?? ai?.sections[s.id]?.headline ?? s.ruleFindings[0];
        const hi = gl?.highlights.findIndex((x) => x.section === s.id) ?? -1;
        const k = s.kpis[0]; const t = k ? tone(k, B.chg(k)) : 0;
        return (
          <div key={s.id} className={clsx('epr-hl epr-rv', t > 0 ? 'good' : t < 0 ? 'bad' : 'flat')} style={{ transitionDelay: `${i * 60}ms` }} {...clickable(() => jump(s.id))}>
            <div className="epr-hl-head"><span className="n">{String(i + 2).padStart(2, '0')}</span><div className="t">{ai?.sections[s.id]?.title ?? s.title}</div><span className="st">{t > 0 ? 'Improving' : t < 0 ? 'Needs attention' : 'Steady'}</span></div>
            {k && <div className="epr-hl-k"><b>{fmtK(k.value, k.format)}</b><span>{k.label}</span><em className={t > 0 ? 'good' : t < 0 ? 'bad' : ''}>{fmtDelta(B.chg(k), k.format)} vs {B.label}</em></div>}
            {hi >= 0 ? <Ed as="p" part="glance" path={['highlights', hi, 'text']} value={h} /> : <p>{h ?? '…'}</p>}
            <span className="go">Read chapter <ArrowRight size={12} /></span>
          </div>
        );
      })}</div>
      {!!gl?.watch?.length && <div className="epr-watch epr-rv"><AlertTriangle size={15} /><div><b>Watch-outs</b><ul>{gl.watch.map((w, i) => <li key={i}><Ed part="glance" path={['watch', i]} value={w} /></li>)}</ul></div></div>}
      <ChapterNotes sec="glance" />
      <div className="epr-detail"><Sub n="1.4" title="In detail" /></div>
      <div className="epr-detail epr-grid-2">{rv.glance.charts.slice(0, 2).map((c, i) => <ChartCard key={c.id} c={c} i={i} part="glance" note={gl?.notes[c.id] ?? rv.glance.notes[c.id]} />)}</div>
      <div className="epr-detail epr-grid-2">
        {rv.glance.lists.length > 0 && <TopBottom lists={rv.glance.lists} />}
        {rv.glance.charts[2] && <ChartCard c={rv.glance.charts[2]} part="glance" note={gl?.notes[rv.glance.charts[2].id] ?? rv.glance.notes[rv.glance.charts[2].id]} />}
      </div>
      {rv.scorecard?.length > 0 && <div className="epr-detail"><Scorecard kpis={rv.scorecard} P={P} /></div>}
      <div className="epr-detail epr-grid-1">{rv.glance.tables.slice(0, 4).map((t) => <TableCard key={t.id} t={t} part="glance" note={gl?.notes[t.id] ?? rv.glance.notes[t.id]} />)}</div>
      {rv.studios && rv.studios.result.rows.length > 1 && <div className="epr-detail"><TableCard t={{ ...rv.studios, title: rv.studios.title || 'Studio comparison' }} part="glance" note={rv.studios.note} /></div>}
      <Pins part="glance" n="1.+" />
    </section>
  );
}

/** Summary + insights block — the AI's analysis, styled as an analyst's note. */
function Analysis({ part, ai, live, label, fallback }: { part: string; ai?: { summary: string; insights: string[]; model?: string; source: string }; live: boolean; label: string; fallback: string[] }) {
  const ins = ai ? (ai.insights.length ? ai.insights : fallback) : [];
  const words = ai?.summary ? ai.summary.split(/\s+/).length : 0;
  const exec = part === 'glance';
  return (
    <div className={clsx('epr-analysis epr-rv', exec && 'exec')}>
      <div className="epr-sum">
        <aside className="epr-sum-side">
          <div className="epr-sum-mark" aria-hidden>{exec ? <Sparkles size={16} /> : <BookOpenText size={16} />}</div>
          <div className="epr-sum-label">{label}</div>
          {ai && <dl>
            <div><dt>Author</dt><dd>{ai.source === 'ai' ? (ai.model ?? 'Claude') : 'Computed from data'}</dd></div>
            {words > 0 && <div><dt>Reading time</dt><dd>{Math.max(1, Math.round(words / 220))} min · {words} words</dd></div>}
            {ins.length > 0 && <div><dt>Insights</dt><dd>{ins.length} below</dd></div>}
          </dl>}
        </aside>
        <div className="epr-prose"><Prose text={ai?.summary} part={part} live={live} /></div>
      </div>
      <aside className="epr-insights">
        <div className="epr-analysis-h"><Lightbulb size={13} /><span>Key insights</span></div>
        {ai ? <List items={ins} part={part} field="insights" live={live} /> : <Shimmer lines={5} />}
      </aside>
    </div>
  );
}

/** Chapter opener: every chapter starts with a hero — number, title, intro, the headline and its three key numbers. */
function SectionHead({ n, total, kicker, title, lead, right, part, headline, stats = [] }: { n: number; total: number; kicker: string; title: string; lead: string; right?: ReactNode; part?: string; headline?: ReactNode; stats?: Kpi[] }) {
  const d = useRD(); const B = useChg();
  return (
    <header className="epr-hero">
      <div className="epr-hero-top">
        <span className="epr-hero-ch">Chapter {String(n).padStart(2, '0')}<i>/ {String(total).padStart(2, '0')}</i></span>
        <span className="epr-hero-kick">{kicker}</span>
        {right}
      </div>
      <div className="epr-hero-body">
        <div className="epr-hero-n" aria-hidden>{String(n).padStart(2, '0')}</div>
        <div className="min-w-0">
          {part ? <Ed as="h2" part={part} path={['title']} value={title} /> : <h2>{title}</h2>}
          {part ? <Ed as="p" className="epr-hero-lead" part={part} path={['lead']} value={lead} /> : <p className="epr-hero-lead">{lead}</p>}
        </div>
      </div>
      {headline && <div className="epr-hero-quote">{headline}</div>}
      {stats.length > 0 && <div className="epr-hero-stats">{stats.slice(0, 3).map((k) => { const t = tone(k, B.chg(k)); return (
        <div key={k.id} {...clickable(d ? () => d.kpi(k) : undefined)}><span>{k.label}</span><b>{fmtK(k.value, k.format)}</b><em className={t > 0 ? 'good' : t < 0 ? 'bad' : ''}>{fmtDelta(B.chg(k), k.format)} <i>vs {B.label}</i></em></div>
      ); })}</div>}
    </header>
  );
}
/** Numbered sub-heading inside a chapter (2.1, 2.2 …) — gives every chapter the same reading structure. */
const Sub = ({ n, title, note, full }: { n: string; title: string; note?: string; full?: boolean }) => <div className={clsx('epr-sub epr-rv', full && 'epr-full')}><span>{n}</span><h3>{title}</h3>{note && <em>{note}</em>}</div>;
function PartActions({ ai, busy, canAi, onRewrite }: { ai?: { source: string; model?: string; edited?: boolean }; busy: boolean; canAi: boolean; onRewrite: () => void }) {
  return (
    <div className="epr-sh-act no-print">
      {ai?.edited && <span className="epr-aitag">Edited</span>}
      <AiTag ai={ai} loading={busy} />
      {canAi && ai && !busy && <button className="epr-rewrite" onClick={() => { if (confirm('Rewrite the AI commentary for this part? The current text (including edits) will be replaced.')) onRewrite(); }} title="Rewrite this part's AI commentary"><RefreshCw size={12} />Rewrite</button>}
    </div>
  );
}

function ReviewSectionView({ n, total, s, ai, live, busy, base, P, canAi, onRewrite }: { n: number; total: number; s: Section; ai?: SectionAI; live: boolean; busy: boolean; base: Base; P: ReportPeriod; canAi: boolean; onRewrite: () => void }) {
  const note = (id: string) => ai?.notes?.[id] ?? s.notes[id];
  const d = useRD(); const ed = useEdit(); const B = useChg();
  const hasFeature = !!(s.index || s.funnels?.length || s.spotlight?.length || s.formats?.length || (s.heatmap && s.heatmap.rows.length));
  return (
    <section id={`epr-${s.id}`} data-spy className="epr-sec epr-build-in">
      <SectionHead n={n} total={total} kicker={s.kicker} title={ai?.title ?? s.title} lead={ai?.lead ?? s.lead} part={ai ? s.id : undefined} right={<PartActions ai={ai} busy={busy} canAi={canAi} onRewrite={onRewrite} />} stats={s.kpis}
        headline={ai ? (live && !ed?.on ? <p><Words text={ai.headline} live /></p> : <Ed as="p" part={s.id} path={['headline']} value={ai.headline} />) : undefined} />

      <Sub n={`${n}.1`} title="Analysis" />
      <Analysis part={s.id} ai={ai} live={live} label="Chapter summary" fallback={s.ruleFindings.slice(0, 3)} />
      <Sub n={`${n}.2`} full title="The numbers" note="Click any number for the records behind it" />
      <KpiGrid kpis={s.kpis} base={base} P={P} />
      {(hasFeature || s.charts.length > 0 || s.tables.length > 0) && <div className="epr-detail"><Sub n={`${n}.3`} title="In detail" /></div>}

      {hasFeature && <div className="epr-detail epr-feature">
        {s.index && (
          <div className="epr-index epr-rv">
            <Gauge v={s.index.value} />
            <div className="min-w-0 flex-1"><div className="epr-sh-k">Attendance health index</div>
              {s.index.parts.map((p) => <div key={p.label} className="epr-index-r"><span>{p.label}<em>weight {Math.round(p.weight * 100)}%</em></span><div className="bar"><i style={{ width: `${(p.value ?? 0) * 100}%` }} /></div><b>{fmt(p.value, 'percent')}</b></div>)}
              <p className="epr-small">{s.index.note}</p>
            </div>
          </div>
        )}
        {s.funnels?.length ? <div className="epr-grid-2">{s.funnels.map((f) => <Funnel key={f.title} f={f} />)}</div> : null}
        {s.spotlight?.length ? <div className="epr-spot">{s.spotlight.map((t, i) => (
          <div key={t.name} className={clsx('epr-spot-c epr-rv', `r${i + 1}`)} style={{ transitionDelay: `${i * 80}ms` }} {...clickable(d ? () => d.slice('class_average', [{ dimension: 'teacher', op: 'in', values: [t.name] }], [t.name], t.avg) : undefined)}><div className="md"><Trophy size={14} />#{i + 1}</div><div className="epr-spot-who"><TrainerAvatar name={t.name} size={44} /><b>{t.name}</b></div>
            <div className="st"><span><i>{fmt(t.avg, 'decimal')}</i>class avg</span><span><i>{fmt(t.fill, 'percent')}</i>fill</span><span><i>{t.classes}</i>classes</span><span><i>{fmt(t.checkins, 'number')}</i>check-ins</span></div></div>
        ))}</div> : null}
        {s.formats?.length ? <div className="epr-formats">{s.formats.map((f, fi) => (
          <div key={f.format} className="epr-fmt epr-rv" style={{ transitionDelay: `${fi * 80}ms` }}><h4>{f.format}</h4>
            <table><tbody>{f.kpis.map((k) => { const t = tone(k, B.chg(k)); return <tr key={k.id} {...clickable(d ? () => d.kpi(k, [{ dimension: 'format', op: 'in', values: [f.format] }], [f.format]) : undefined)}><td>{k.label}</td><td className="v">{fmtK(k.value, k.format)}</td><td className={clsx('c', t > 0 ? 'good' : t < 0 ? 'bad' : '')}>{fmtDelta(B.chg(k), k.format)}</td></tr>; })}</tbody></table></div>
        ))}</div> : null}
        {s.heatmap && s.heatmap.rows.length > 0 && <Heat hm={s.heatmap} />}
      </div>}

      {s.charts.length > 0 && <div className={clsx('epr-detail', s.charts.length === 1 ? 'epr-grid-1' : 'epr-grid-2')}>{s.charts.map((c, i) => <ChartCard key={c.id} c={c} i={i} part={s.id} note={note(c.id)} loading={busy} />)}</div>}
      {s.tables.length > 0 && <div className="epr-detail epr-grid-1">{s.tables.map((t) => <TableCard key={t.id} t={t} part={s.id} note={note(t.id)} loading={busy} />)}</div>}

      <Pins part={s.id} n={`${n}.+`} />
      <ChapterNotes sec={s.id} />
      <Sub n={`${n}.${hasFeature || s.charts.length || s.tables.length ? 4 : 3}`} title="Findings & actions" />
      <div className="epr-close">
        <div className="epr-close-col epr-rv"><div className="epr-analysis-h"><Flag size={13} /><span>Key findings</span></div>{ai ? <ol className="epr-find">{ai.findings.map((x, i) => <li key={i}><span>{String(i + 1).padStart(2, '0')}</span><Ed as="p" part={s.id} path={['findings', i]} value={x} /></li>)}</ol> : <Shimmer lines={5} />}</div>
        <div className="epr-close-col epr-rv"><div className="epr-analysis-h"><Target size={13} /><span>Recommended actions</span></div>{ai ? (ai.recommendations.length ? <Recs recs={ai.recommendations} part={s.id} /> : <p className="epr-small">Recommendations are written by the AI — turn it on in Settings to add them.</p>) : <Shimmer lines={5} />}</div>
      </div>
    </section>
  );
}

/* ── closing chapter: main findings in brief + the full action plan with owners and timelines ── */
const WHEN: Record<Rec['priority'], string> = { high: 'Next 2 weeks', medium: 'Within 30 days', low: 'This quarter' };
function Closing({ rv, ai, P, jump }: { rv: Review; ai?: AI; P: ReportPeriod; jump: (id: string) => void }) {
  const [owner, setOwner] = useState<string>('all');
  const recs = rv.sections.flatMap((s) => (ai?.sections[s.id]?.recommendations ?? []).map((r) => ({ ...r, sid: s.id, chapter: ai?.sections[s.id]?.title ?? s.title })));
  const order = { high: 0, medium: 1, low: 2 } as const;
  recs.sort((a, b) => order[a.priority] - order[b.priority]);
  const owners = [...new Set(recs.map((r) => r.owner).filter(Boolean))];
  const shown = owner === 'all' ? recs : recs.filter((r) => r.owner === owner);
  const n = rv.sections.length + 2;
  return (
    <section id="epr-closing" data-spy className="epr-sec epr-build-in">
      <SectionHead n={n} total={n} kicker="Conclusions" title="Summary & action plan" lead={`What ${P.label} tells us, and what we do next — every recommended action from the review, with an owner and a timeline.`} />
      <Sub n={`${n}.1`} title="Main findings" />
      <ol className="epr-concl">{rv.sections.map((s, i) => {
        const h = ai?.sections[s.id]?.headline ?? ai?.glance?.highlights.find((x) => x.section === s.id)?.text ?? s.ruleFindings[0];
        return <li key={s.id} className="epr-rv" {...clickable(() => jump(s.id))}><span>{String(i + 2).padStart(2, '0')}</span><b>{ai?.sections[s.id]?.title ?? s.title}</b><p>{h}</p></li>;
      })}</ol>
      {!!ai?.glance?.watch?.length && <div className="epr-watch epr-rv"><AlertTriangle size={15} /><div><b>Watch-outs</b><ul>{ai.glance.watch.map((w, i) => <li key={i}>{w}</li>)}</ul></div></div>}
      <ChapterNotes sec="closing" />
      <Pins part="closing" n={`${n}.+`} />
      <Sub n={`${n}.2`} title="Action plan" note={`${recs.length} actions · ${recs.filter((r) => r.priority === 'high').length} high priority`} />
      {owners.length > 1 && <div className="epr-seg sm epr-plan-f">{['all', ...owners].map((o) => <button key={o} className={clsx(owner === o && 'on')} onClick={() => setOwner(o)}>{o === 'all' ? 'All owners' : o}</button>)}</div>}
      <div className="epr-plan-wrap"><table className="epr-plan">
        <thead><tr><th>#</th><th>Action</th><th>Owner</th><th>Timeline & measure</th><th>Priority</th><th>Chapter</th></tr></thead>
        <tbody>{shown.map((r, i) => (
          <tr key={i} className="epr-rv">
            <td className="n">{String(i + 1).padStart(2, '0')}</td>
            <td><b>{r.title}</b><p>{r.detail}</p></td>
            <td className="o">{r.owner}</td>
            <td className="w">{r.timeline || WHEN[r.priority]}{r.kpi && <em className="epr-plan-kpi">{r.kpi}</em>}</td>
            <td><span className={clsx('epr-pri', r.priority)}>{r.priority}</span></td>
            <td><button className="epr-plan-ch" onClick={() => jump(r.sid)}>{r.chapter} <ArrowRight size={11} /></button></td>
          </tr>
        ))}</tbody>
      </table></div>
    </section>
  );
}
