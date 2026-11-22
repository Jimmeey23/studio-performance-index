import { Fragment, createContext, useContext, useId, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import clsx from 'clsx';
import {
  ArrowDownRight, ArrowUpRight, Minus, IndianRupee, UserPlus, Megaphone, GraduationCap, CalendarRange, Shapes, UserMinus, CalendarX, Compass, Sparkles, TrendingUp,
  BookOpen, LayoutGrid, Target, Building2, Users, HeartPulse, ShieldAlert, Lightbulb, Gauge, Trophy, CheckCircle2, AlertTriangle, Flag, MapPin, type LucideIcon,
} from 'lucide-react';
import type { Column, Format, Result } from '../../lib/types';
import { fmt, fmtPeriod } from '../../lib/format';
import { usePolarity } from '../../lib/catalog';
import { drillFor, useDrill } from '../../lib/drill';
import { LIGHT_THEME } from '../../lib/echarts';
import { ChartBlock, colorFor } from '../blocks/Charts';
import { DEFAULT_LAYOUT, fmtDelta, fmtK, shortLabels, tone, type Kpi, type ReportData, type ReportInsights, type ReportLayout, type ReportPeriod, type ReportSection, type ReportTable, type Spotlight } from '../../lib/report';
import { ACCENTS, currentAccent, mix, type AccentPair } from '../../lib/theme';
import { BRAND, coverPhotoFor, photoByKey, photoForSection } from '../../lib/brand';
import type { ThemeColors } from '../../lib/echarts';

const ICONS: Record<string, LucideIcon> = { IndianRupee, UserPlus, Megaphone, GraduationCap, CalendarRange, Shapes, UserMinus, CalendarX, Compass, Building2, Users, HeartPulse, Lightbulb, Trophy, MapPin, BookOpen, Target };
const AUDIENCE: Record<string, string> = { leadership: 'leadership team', managers: 'studio managers', sales: 'sales & client services', investors: 'investors & partners' };
const LayoutCtx = createContext<ReportLayout>(DEFAULT_LAYOUT);
const FORMAT_COLORS: Record<string, string> = { Barre: '#123a72', powerCycle: '#3fa9dc', 'Strength Lab': '#c8a46a' };

/* ═════════ brand & graphics ═════════ */
export function Wordmark({ light = true, size = 1 }: { light?: boolean; size?: number }) {
  return (
    <div className="rp-wordmark" style={{ fontSize: `${size * 10}pt` }}>
      <img src={light ? BRAND.logoOnDark : BRAND.logoOnLight} alt="Physique 57" style={{ height: `${size * 9.5}mm` }} />
      <span className="rp-wm-india" style={{ color: light ? '#ffffff' : BRAND.ink }}>INDIA</span>
    </div>
  );
}
/** Flowing ribbons — abstract barre / movement motif used on the cover and section bands. */
function Ribbons({ dense }: { dense?: boolean }) {
  return (
    <svg className="rp-ribbons" viewBox="0 0 800 400" preserveAspectRatio="xMidYMid slice" aria-hidden>
      <defs>
        <linearGradient id="rb1" x1="0" y1="0" x2="1" y2="0"><stop offset="0" style={{ stopColor: 'var(--rb-a)' }} stopOpacity="0" /><stop offset=".5" style={{ stopColor: 'var(--rb-a)' }} stopOpacity=".55" /><stop offset="1" stopColor="#e3c38f" stopOpacity=".1" /></linearGradient>
        <linearGradient id="rb2" x1="0" y1="0" x2="1" y2="0"><stop offset="0" style={{ stopColor: 'var(--rb-b)' }} stopOpacity=".05" /><stop offset=".6" style={{ stopColor: 'var(--rb-b)' }} stopOpacity=".45" /><stop offset="1" stopColor="#ffffff" stopOpacity="0" /></linearGradient>
        <radialGradient id="rbo" cx=".5" cy=".5" r=".5"><stop offset="0" style={{ stopColor: 'var(--rb-a)' }} stopOpacity=".45" /><stop offset="1" style={{ stopColor: 'var(--rb-a)' }} stopOpacity="0" /></radialGradient>
      </defs>
      <circle cx="660" cy="70" r="220" fill="url(#rbo)" />
      {Array.from({ length: dense ? 9 : 14 }, (_, i) => (
        <path key={i} d={`M -40 ${250 + i * 9} C 180 ${120 + i * 14}, 420 ${360 - i * 6}, 860 ${150 + i * 11}`} fill="none" stroke={i % 2 ? 'url(#rb2)' : 'url(#rb1)'} strokeWidth={i % 3 === 0 ? 1.6 : 0.8} />
      ))}
    </svg>
  );
}
function FormatGlyph({ format, size = 26 }: { format: string; size?: number }) {
  const c = FORMAT_COLORS[format] ?? '#4f56d9';
  if (format === 'powerCycle') return (<svg width={size} height={size} viewBox="0 0 32 32" aria-hidden><circle cx="9" cy="21" r="6" fill="none" stroke={c} strokeWidth="2" /><circle cx="24" cy="21" r="6" fill="none" stroke={c} strokeWidth="2" /><path d="M9 21 L14 11 L20 11 L24 21 M14 11 L17 21 L9 21 M18 8 h4" fill="none" stroke={c} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>);
  if (format === 'Strength Lab') return (<svg width={size} height={size} viewBox="0 0 32 32" aria-hidden><rect x="3" y="11" width="4" height="10" rx="1.2" fill={c} /><rect x="7.5" y="8" width="4" height="16" rx="1.2" fill={c} /><rect x="20.5" y="8" width="4" height="16" rx="1.2" fill={c} /><rect x="25" y="11" width="4" height="10" rx="1.2" fill={c} /><rect x="11.5" y="14.5" width="9" height="3" rx="1" fill={c} /></svg>);
  return (<svg width={size} height={size} viewBox="0 0 32 32" aria-hidden><path d="M4 12 H28" stroke={c} strokeWidth="2.6" strokeLinecap="round" /><path d="M8 12 V27 M24 12 V27 M5 27 H11 M21 27 H27" stroke={c} strokeWidth="2" strokeLinecap="round" /><circle cx="16" cy="6.5" r="2.4" fill={c} /><path d="M16 9 C 15 14, 13 17, 11 20 M16 9 C 18 13, 21 13, 24 12" stroke={c} strokeWidth="1.8" fill="none" strokeLinecap="round" /></svg>);
}
function Spark({ values, w = 120, h = 26, good }: { values: (number | null)[]; w?: number; h?: number; good?: boolean | null }) {
  const vs = values.map((v) => (v === null ? NaN : v));
  const fin = vs.filter((v) => isFinite(v));
  if (fin.length < 2) return <svg width={w} height={h} />;
  const min = Math.min(...fin), max = Math.max(...fin), pad = 2.5;
  const x = (i: number) => pad + (i / (vs.length - 1)) * (w - 2 * pad);
  const y = (v: number) => (max === min ? h / 2 : h - pad - ((v - min) / (max - min)) * (h - 2 * pad));
  const pts = vs.map((v, i) => (isFinite(v) ? [x(i), y(v)] : null)).filter(Boolean) as number[][];
  const d = pts.map((p, i) => `${i ? 'L' : 'M'}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(' ');
  const col = good === null || good === undefined ? 'var(--accent)' : good ? '#0f7b5b' : '#c2413f';
  const last = pts[pts.length - 1];
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} className="rp-spark" aria-hidden>
      <path d={`${d} L${last[0]},${h} L${pts[0][0]},${h} Z`} fill={col} opacity=".09" />
      <path d={d} fill="none" stroke={col} strokeWidth="1.4" strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={last[0]} cy={last[1]} r="2" fill={col} />
    </svg>
  );
}

/* ═════════ atoms ═════════ */
function Chg({ k, c, label }: { k: Kpi; c: number | null; label: string }) {
  const t = tone(k, c);
  const I = c === null || c === 0 ? Minus : c > 0 ? ArrowUpRight : ArrowDownRight;
  return <div className={clsx('rp-cmp', t > 0 ? 'good' : t < 0 ? 'bad' : 'flat')}><span className="rp-cmp-l">{label}</span><span className="rp-cmp-v"><I size={9} />{fmtDelta(c, k.format)}</span></div>;
}
function KpiTile({ k, L, onDrill, hero }: { k: Kpi; L: ReturnType<typeof shortLabels>; onDrill?: () => void; hero?: boolean }) {
  const lay = useContext(LayoutCtx);
  const t = tone(k, k.chg);
  const cmps = [lay.cmp.prev && <Chg key="p" k={k} c={k.chg} label={L.prev} />, lay.cmp.ytd && <Chg key="y" k={k} c={k.chgYtd} label={L.ytd} />, lay.cmp.ly && <Chg key="l" k={k} c={k.chgLy} label={L.ly} />].filter(Boolean);
  return (
    <div className={clsx('rp-kpi', hero && 'hero', t > 0 ? 'is-good' : t < 0 ? 'is-bad' : '')} onClick={onDrill} role={onDrill ? 'button' : undefined}>
      <div className="rp-kpi-label">{k.label}</div>
      <div className="rp-kpi-row">
        <div className="rp-kpi-value">{fmtK(k.value, k.format)}</div>
        {lay.sparklines && <Spark values={k.series} w={hero ? 70 : 58} h={hero ? 24 : 20} good={t === 0 ? null : t > 0} />}
      </div>
      {cmps.length > 0 && [k.chg, k.chgYtd, k.chgLy].some((x) => x !== null) && <div className="rp-cmps" style={{ gridTemplateColumns: `repeat(${cmps.length}, 1fr)` }}>{cmps}</div>}
    </div>
  );
}
function Panel({ title, children, className, icon: I }: { title?: string; children: ReactNode; className?: string; icon?: LucideIcon }) {
  return <div className={clsx('rp-panel', className)}>{title && <div className="rp-panel-t">{I && <I size={10} />}{title}</div>}{children}</div>;
}
function Pending({ lines = 3 }: { lines?: number }) {
  return <div className="space-y-1.5 py-1">{Array.from({ length: lines }, (_, i) => <div key={i} className="shimmer h-2.5 rounded" style={{ width: `${94 - i * 9}%` }} />)}</div>;
}
function Numbered({ items, tone: tn = 'gold' }: { items: unknown; tone?: 'gold' | 'good' | 'bad' | 'ink' }) {
  return <ol className={clsx('rp-num', tn)}>{(Array.isArray(items) ? items : []).map((x, i) => <li key={i}><span>{i + 1}</span><p><Figs text={x} /></p></li>)}</ol>;
}

/** Compact printable table; numbers drill on screen. */
export function ReportDataTable({ t, maxRows = 12, title = true }: { t: ReportTable; maxRows?: number; title?: boolean }) {
  const polarity = usePolarity();
  const drill = useDrill();
  const r = t.result;
  const grain = (r.spec?.grain as string) ?? 'month';
  const dims = r.columns.filter((c) => c.kind === 'dimension' || c.kind === 'period');
  const metrics = r.columns.filter((c) => c.kind === 'metric');
  const full = dims.length + metrics.reduce((a, m) => a + (r.columns.some((c) => c.key === `${m.key}__chg`) ? 2 : 1), 0);
  const dropChg = full > 10;
  const hasChg = (m: Column) => !dropChg && r.columns.some((c) => c.key === `${m.key}__chg`);
  const rows = r.rows.slice(0, maxRows);
  const heat = t.style === 'heat';
  const hv = heat ? rows.flatMap((row) => metrics.map((m) => Number(row[m.key]))).filter((v) => isFinite(v)) : [];
  const hmax = Math.max(...hv, 1e-9);
  const width = dims.length + metrics.reduce((a, m) => a + (hasChg(m) ? 2 : 1), 0);
  const cell = (m: Column, row: Record<string, unknown> | null) => {
    const req = drill ? drillFor(r, row, m.key) : null;
    const v = row ? row[m.key] : r.totals?.[m.key];
    const a = heat && v !== null && v !== undefined && isFinite(Number(v)) ? Number(v) / hmax : null;
    const st = a === null ? undefined : { background: `rgb(18 58 114 / ${(0.06 + a * 0.82).toFixed(2)})`, color: a > 0.5 ? '#fff' : undefined };
    return <td key={m.key} style={st} className={clsx('num', req && 'drill', heat && 'heat')} onClick={req ? () => drill!(req) : undefined}>{fmt(v, m.format as Format, { compact: m.format === 'currency' && Math.abs(Number(v)) >= 1e7 })}</td>;
  };
  const chgCell = (m: Column, row: Record<string, unknown> | null) => {
    const c = (row ? row[`${m.key}__chg`] : r.totals?.[`${m.key}__chg`]) as number | null | undefined;
    const pol = polarity(m.key);
    return <td key={`${m.key}c`} className={clsx('num chg', c && pol ? (c * pol > 0 ? 'good' : 'bad') : '')}>{fmtDelta(c, m.format as Format)}</td>;
  };
  return (
    <div className="rp-table-wrap">
      {title && <div className="rp-panel-t">{t.title}{r.rowCount > rows.length && <em> · top {rows.length} of {r.rowCount}</em>}{dropChg && <em> · changes in the Excel export</em>}</div>}
      <table className={clsx('rp-table', width > 9 && 'wide', width > 11 && 'xwide')}>
        <thead><tr>
          {dims.map((d) => <th key={d.key}>{d.label}</th>)}
          {metrics.map((m) => <Fragment key={m.key}><th className="num">{m.label}</th>{hasChg(m) && <th className="num chg">Δ</th>}</Fragment>)}
        </tr></thead>
        <tbody>{rows.map((row, i) => (
          <tr key={i} className={clsx(row._kind === 'group' && 'rp-grp', row._kind === 'sub' && 'rp-sub', heat && i === rows.length - 1 && String(row[dims[0]?.key ?? ''] ?? '').startsWith('All ') && 'rp-grp')}>
            {dims.map((d) => <td key={d.key} className="dim" title={String(row[d.key] ?? '')}>{d.kind === 'period' ? fmtPeriod(String(row[d.key]), grain) : String(row[d.key] ?? '(blank)')}</td>)}
            {metrics.map((m) => <Fragment key={m.key}>{cell(m, row)}{hasChg(m) && chgCell(m, row)}</Fragment>)}
          </tr>
        ))}</tbody>
        {r.totals && rows.length > 1 && r.rowCount <= maxRows && (
          <tfoot><tr>{dims.map((d, i) => <td key={d.key} className="dim">{i === 0 ? 'Total' : ''}</td>)}{metrics.map((m) => <Fragment key={m.key}>{cell(m, null)}{hasChg(m) && chgCell(m, null)}</Fragment>)}</tr></tfoot>
        )}
      </table>
    </div>
  );
}

function Funnel({ steps }: { steps: { label: string; value: number | null }[] }) {
  const top = steps[0]?.value || 1;
  return (
    <div className="rp-funnel">
      {steps.map((s, i) => {
        const w = Math.max(14, ((s.value ?? 0) / top) * 100);
        const prev = i ? steps[i - 1].value : null;
        return (
          <div key={s.label} className="rp-funnel-row">
            <div className="rp-funnel-line">
              <div className="rp-funnel-bar" style={{ width: `${w}%`, background: `linear-gradient(90deg, var(--navy-2), color-mix(in srgb, var(--accent) ${100 - i * 18}%, var(--violet)))` }}><b>{s.value === null ? '—' : fmt(s.value, 'number')}</b></div>
              <span className="rp-funnel-lab">{s.label}</span>
            </div>
            {i > 0 ? <div className="rp-funnel-rate">{(((s.value ?? 0) / top) * 100).toFixed(0)}%<em> of {steps[0].label.toLowerCase()}</em>{prev ? <em> · {(((s.value ?? 0) / prev) * 100).toFixed(0)}% step rate</em> : null}</div> : <div className="rp-funnel-rate">100%</div>}
          </div>
        );
      })}
    </div>
  );
}
function Heatmap({ hm }: { hm: NonNullable<NonNullable<ReportSection['visuals']>['heatmap']> }) {
  const vals = Object.values(hm.cells).map((c) => c.fill).filter((v): v is number => v !== null);
  const max = Math.max(...vals, 0.01);
  return (
    <table className="rp-heat">
      <thead><tr><th />{hm.cols.map((c) => <th key={c}>{c.slice(0, 2)}</th>)}</tr></thead>
      <tbody>{hm.rows.map((r) => (
        <tr key={r}><th>{r.slice(0, 3)}</th>{hm.cols.map((c) => {
          const cell = hm.cells[`${r}|${c}`];
          if (!cell || cell.fill === null) return <td key={c} className="empty" />;
          const a = cell.fill / max;
          return <td key={c} style={{ background: `rgb(var(--acc-rgb) / ${0.08 + a * 0.85})`, color: a > 0.55 ? '#fff' : '#22244a' }} title={`${cell.classes} classes`}>{Math.round(cell.fill * 100)}</td>;
        })}</tr>
      ))}</tbody>
    </table>
  );
}
function MomTable({ result, only }: { result: Result; only?: string[] }) {
  const polarity = usePolarity();
  const months = [...new Set(result.rows.map((r) => String(r.period)))].sort((a, b) => b.localeCompare(a));
  const byP = new Map(result.rows.map((r) => [String(r.period), r]));
  const metrics = result.columns.filter((c) => c.kind === 'metric' && (!only || only.includes(c.key)));
  return (
    <table className="rp-table rp-mom">
      <thead><tr><th>Metric</th>{months.map((p) => <th key={p} className="num">{fmtPeriod(p, 'month')}{byP.get(p)?.__partial ? '*' : ''}</th>)}</tr></thead>
      <tbody>{metrics.map((m) => (
        <Fragment key={m.key}>
          <tr className="rp-mom-main"><td className="dim">{m.label}</td>{months.map((p) => <td key={p} className="num">{fmt(byP.get(p)?.[m.key], m.format as Format, { compact: m.format === 'currency' })}</td>)}</tr>
          <tr className="rp-mom-ly"><td className="dim">Last year</td>{months.map((p) => <td key={p} className="num">{fmt(byP.get(p)?.[`${m.key}__prev`], m.format as Format, { compact: m.format === 'currency' })}</td>)}</tr>
          <tr className="rp-mom-chg"><td className="dim">YoY {m.format === 'percent' ? 'Δ pp' : 'Δ %'}</td>{months.map((p) => {
            const c = byP.get(p)?.[`${m.key}__chg`] as number | null | undefined; const pol = polarity(m.key);
            return <td key={p} className={clsx('num', c && pol ? (c * pol > 0 ? 'good' : 'bad') : '')}>{fmtDelta(c, m.format as Format)}</td>;
          })}</tr>
        </Fragment>
      ))}</tbody>
    </table>
  );
}

/* ═════════ analysis formatting ═════════ */
/** Sentences, without splitting decimals or "vs." style abbreviations. */
const sentences = (t: unknown) => toText(t).replace(/\s+/g, ' ').trim().split(/(?<=[.!?])\s+(?=[A-Z₹"“(])/).map((x) => x.trim()).filter(Boolean);
const FIG = /(₹\s?[\d,.]+\s?(?:Cr|L|k|K|lakh|crore)?|(?<![\w-])[+−-]?\d[\d,]*(?:\.\d+)?\s?(?:%|pp\b|days?\b)|(?<![\w])[+−]\d[\d,]*(?:\.\d+)?)/g;
/** Figures in prose are set apart (bold, tabular, coloured by sign) so stats don't hide in sentences. */
/** Commentary can arrive in odd shapes (missing, or an object instead of a sentence) — always render text. */
export const toText = (v: unknown): string => (typeof v === 'string' ? v : v === null || v === undefined ? '' : typeof v === 'object'
  ? ['title', 'headline', 'detail', 'text'].map((k) => (v as Record<string, unknown>)[k]).filter((x) => typeof x === 'string').join(' — ') || '' : String(v));
function Figs({ text }: { text: unknown }) {
  const parts = toText(text).split(FIG);
  return <>{parts.map((p, i) => (i % 2 ? <b key={i} className={clsx('rp-fig', /^[+]/.test(p) ? 'up' : /^[−-]/.test(p) ? 'down' : '')}>{p}</b> : <Fragment key={i}>{p}</Fragment>))}</>;
}
/** One card per trainer: score, key numbers, strengths and focus areas. */
function TrainerCards({ ts }: { ts: NonNullable<NonNullable<ReportSection['visuals']>['trainers']> }) {
  return (
    <div>
      <div className="rp-subhead"><Trophy size={11} />Trainer profiles</div>
      <div className="rp-tcards">{ts.map((t) => (
        <div key={t.teacher} className="rp-tcard">
          <div className="rp-tcard-h"><span className="rk">#{t.rank}</span><b>{t.teacher}</b>{t.tier && <span className={clsx('tier', `t${t.tier}`)}>Tier {t.tier}</span>}<span className="sc">{t.score.toFixed(1)}</span></div>
          <div className="rp-tcard-bar"><i style={{ width: `${Math.min(100, t.score)}%` }} /></div>
          <div className="rp-tcard-st">
            <div><b>{t.classes}</b><span>sessions</span></div><div><b>{fmt(t.class_average, 'decimal')}</b><span>class avg</span></div><div><b>{fmt(t.fill_rate, 'percent')}</b><span>fill</span></div>
            <div><b>{t.new_clients >= 15 ? fmt(t.conversion_rate, 'percent') : '—'}</b><span>{t.new_clients >= 15 ? `conv · ${t.excess_converted != null ? `${t.excess_converted >= 0 ? '+' : ''}${t.excess_converted.toFixed(1)} vs exp.` : `${t.new_clients} new`}` : `${t.new_clients} new · small sample`}</span></div>
            <div><b>{fmt(t.revenue_share, 'percent')}</b><span>revenue share</span></div><div><b>{fmtK(t.class_revenue, 'currency')}</b><span>class revenue</span></div>
          </div>
          {t.strengths.length > 0 && <div className="rp-tcard-tags good">{t.strengths.map((x) => <span key={x}>{x}</span>)}</div>}
          {t.focus.length > 0 && <div className="rp-tcard-tags bad">{t.focus.map((x) => <span key={x}>{x}</span>)}</div>}
        </div>
      ))}</div>
    </div>
  );
}
/** The question a section answers, with a direct data-backed answer and supporting points. */
function AnswerBox({ a, headline, loading }: { a: NonNullable<ReportSection['answer']>; headline?: string; loading?: boolean }) {
  return (
    <div className="rp-answer">
      <div className="rp-answer-q"><span>Q</span>{a.question}</div>
      <p className="rp-answer-a">{loading && !headline ? <Pending lines={1} /> : <Figs text={headline || a.headline} />}</p>
      {a.points.length > 0 && <ul className="rp-answer-pts">{a.points.slice(0, 6).map((x, i) => <li key={i}><Figs text={x} /></li>)}</ul>}
    </div>
  );
}
/** A compact strip of headline numbers (no comparisons). */
function StatStrip({ stats }: { stats: NonNullable<ReportSection['stats']> }) {
  return <div className="rp-stats" style={{ gridTemplateColumns: `repeat(${Math.min(stats.length, 6)}, minmax(0, 1fr))` }}>{stats.map((x) => <div key={x.label}><b>{fmtK(x.value, x.format)}</b><span>{x.label}</span>{x.note && <em>{x.note}</em>}</div>)}</div>;
}
/** Definition text: "A = B; C = D" lists become rows, plain sentences stay prose. */
function DefText({ text }: { text: string }) {
  const parts = toText(text).split(/;\s+/).map((x) => x.trim()).filter(Boolean);
  const pairs = parts.map((x) => { const m = x.match(/^([^=]{1,60}?)\s+=\s+(.+)$/); return m ? [m[1], m[2].replace(/\.$/, '')] : null; });
  if (parts.length > 1 && pairs.every(Boolean)) return <dl className="rp-dl">{(pairs as string[][]).map(([a, b]) => <Fragment key={a}><dt>{a}</dt><dd>{b}</dd></Fragment>)}</dl>;
  if (parts.length > 2) return <ul className="rp-an-pts">{parts.map((x, i) => <li key={i}>{x}</li>)}</ul>;
  return <span>{text}</span>;
}
/** "In ten seconds": short statements with the comparison set apart. */
function Glance({ items, cols }: { items: unknown; cols?: boolean }) {
  return (
    <ol className={clsx('rp-glance', cols && 'cols')}>{(Array.isArray(items) ? items : []).map((x, i) => {
      const [head, ...rest] = toText(x).split(' · ');
      return <li key={i}><span className="n">{i + 1}</span><span className="t"><Figs text={head} />{rest.length > 0 && <em><Figs text={rest.join(' · ')} /></em>}</span></li>;
    })}</ol>
  );
}
/** Headline sentence, then each further point on its own line. */
function Prose({ text }: { text: string }) {
  const ss = sentences(text);
  if (!ss.length) return null;
  return (
    <div className="rp-an">
      <p className="rp-an-lead"><Figs text={ss[0]} /></p>
      {ss.length > 1 && <ul className="rp-an-pts">{ss.slice(1).map((x, i) => <li key={i}><Figs text={x} /></li>)}</ul>}
    </div>
  );
}
/** The section's biggest movers as a compact table: value and change vs each baseline. */
function Movers({ ks, L, n = 4 }: { ks: Kpi[]; L: ReturnType<typeof shortLabels>; n?: number }) {
  const lay = useContext(LayoutCtx);
  const top = [...ks].filter((k) => k.value !== null && [k.chg, k.chgYtd, k.chgLy].some((x) => x !== null)).sort((a, b) => Math.abs(b.chg ?? 0) - Math.abs(a.chg ?? 0)).slice(0, n);
  if (!top.length) return null;
  const cell = (k: Kpi, c: number | null) => { const t = tone(k, c); return <td className={clsx('num', t > 0 ? 'good' : t < 0 ? 'bad' : 'muted')}>{fmtDelta(c, k.format)}</td>; };
  return (
    <table className="rp-movers">
      <thead><tr><th>Key movements</th><th className="num">Value</th>{lay.cmp.prev && <th className="num">vs {L.prev}</th>}{lay.cmp.ytd && <th className="num">vs {L.ytd}</th>}{lay.cmp.ly && <th className="num">vs {L.ly}</th>}</tr></thead>
      <tbody>{top.map((k) => <tr key={k.id}><td>{k.label}</td><td className="num v">{fmtK(k.value, k.format)}</td>{lay.cmp.prev && cell(k, k.chg)}{lay.cmp.ytd && cell(k, k.chgYtd)}{lay.cmp.ly && cell(k, k.chgLy)}</tr>)}</tbody>
    </table>
  );
}

/* ═════════ page shell ═════════ */
function Page({ children, n, total, meta, landscape, bleed }: { children: ReactNode; n: number; total: number; meta: string; landscape?: boolean; bleed?: boolean }) {
  return (
    <section className={clsx('a4', landscape && 'a4-landscape', bleed && 'a4-bleed')} data-page={n}>
      <div className="a4-inner">{children}</div>
      {!bleed && <footer className="a4-foot"><Wordmark light={false} size={0.7} /><span>{meta}</span><span className="rp-pg">{String(n).padStart(2, '0')}<em>/{String(total).padStart(2, '0')}</em></span></footer>}
    </section>
  );
}
function Band({ s, num, headline, aiLoading, photo }: { s: { title: string; kicker: string; icon: string; summary: string; ask?: string }; num: string; headline?: string; aiLoading?: boolean; photo?: string }) {
  const I = ICONS[s.icon] ?? LayoutGrid;
  return (
    <div className={clsx('rp-band', photo && 'has-photo')}>
      {photo && <div className="rp-band-photo" style={{ backgroundImage: `url(${photo})` }} />}
      <Ribbons dense />
      <div className="rp-band-num">{num}</div>
      <div className="rp-band-in">
        <div className="rp-band-k"><span className="rp-band-ic"><I size={13} /></span>{s.kicker}</div>
        <h2 className="rp-band-t">{s.title}</h2>
        <p className="rp-band-s">{s.summary}</p>
        {headline ? <p className="rp-band-h">{headline}</p> : aiLoading ? <div className="mt-2 w-2/3 opacity-40"><Pending lines={1} /></div> : null}
      </div>
    </div>
  );
}
function MiniHead({ title, sub, icon: I = LayoutGrid }: { title: string; sub?: string; icon?: LucideIcon }) {
  return <div className="rp-mini"><span className="rp-mini-ic"><I size={12} /></span><div><h3>{title}</h3>{sub && <p>{sub}</p>}</div></div>;
}

/** Trend line that stretches to whatever space the filler has. */
function Trend({ values, labels, good }: { values: (number | null)[]; labels: string[]; good?: boolean | null }) {
  const gid = `tr${useId().replace(/:/g, '')}`;
  const vs = values.map((v) => (v === null ? NaN : v));
  const fin = vs.filter((v) => isFinite(v));
  if (fin.length < 2) return <div className="rp-trend empty">Not enough history</div>;
  const min = Math.min(...fin), max = Math.max(...fin);
  const x = (i: number) => (i / (vs.length - 1)) * 100;
  const y = (v: number) => (max === min ? 50 : 92 - ((v - min) / (max - min)) * 84);
  const pts = vs.map((v, i) => (isFinite(v) ? [x(i), y(v)] : null)).filter(Boolean) as number[][];
  const d = pts.map((p, i) => `${i ? 'L' : 'M'}${p[0].toFixed(2)},${p[1].toFixed(2)}`).join(' ');
  const last = pts[pts.length - 1];
  const col = good === null || good === undefined ? 'var(--accent)' : good ? 'var(--good)' : 'var(--bad)';
  const lab = (i: number) => labels[i] ?? '';
  return (
    <div className="rp-trend">
      <div className="rp-trend-plot">
        <svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden>
          <defs><linearGradient id={gid} x1="0" y1="0" x2="0" y2="1"><stop offset="0" style={{ stopColor: 'var(--accent)' }} stopOpacity=".26" /><stop offset="1" style={{ stopColor: 'var(--accent)' }} stopOpacity="0" /></linearGradient></defs>
          {[25, 50, 75].map((g) => <line key={g} x1="0" x2="100" y1={g} y2={g} stroke="#e9e7f1" strokeWidth="1" vectorEffect="non-scaling-stroke" strokeDasharray="2 3" />)}
          <path d={`${d} L${last[0]},100 L${pts[0][0]},100 Z`} fill={`url(#${gid})`} />
          <path d={d} fill="none" stroke={col} strokeWidth="1.8" vectorEffect="non-scaling-stroke" strokeLinejoin="round" strokeLinecap="round" />
        </svg>
        <i className="rp-trend-dot" style={{ left: `${last[0]}%`, top: `${last[1]}%`, background: col }} />
        <span className="rp-trend-max">{max.toLocaleString('en-IN', { maximumFractionDigits: max < 10 ? 2 : 0 })}</span>
        <span className="rp-trend-min">{min.toLocaleString('en-IN', { maximumFractionDigits: min < 10 ? 2 : 0 })}</span>
      </div>
      <div className="rp-trend-x"><span>{lab(0)}</span><span>{lab(Math.floor((vs.length - 1) / 2))}</span><span>{lab(vs.length - 1)}</span></div>
    </div>
  );
}
/**
 * Fills the spare space at the foot of a page with a contextual diagram — the page's
 * focus metric against its three baselines, its 14-month trend and a pull-quote —
 * instead of stretching tables. Container queries collapse it when space is short.
 */
function Filler({ k, quote, P, L, label = 'In focus' }: { k?: Kpi; quote?: string; P: ReportPeriod; L: ReturnType<typeof shortLabels>; label?: string }) {
  const lay = useContext(LayoutCtx);
  if (!lay.fillers || !k || k.series.filter((v) => v !== null).length < 2) return <div className="rp-fill-spacer" />; // nothing to chart
  const t = tone(k, k.chg);
  const bars: [string, number | null, string][] = [[P.label.replace(/-(\d{2})(\d{2})\b/, '-$2'), k.value, 'cur'], [L.prev, k.prev, 'b1'], [L.ytd, k.ytd, 'b2'], [L.ly, k.ly, 'b3']];
  const mx = Math.max(...bars.map((b) => Math.abs(b[1] ?? 0)), 1e-9);
  return (
    <div className="rp-fill">
      <div className="rp-fill-in">
        <svg className="rp-fill-art" viewBox="0 0 400 200" preserveAspectRatio="none" aria-hidden>{Array.from({ length: 7 }, (_, i) => <path key={i} d={`M 0 ${150 + i * 6} C 120 ${90 + i * 9}, 260 ${210 - i * 4}, 400 ${70 + i * 8}`} fill="none" stroke="var(--accent)" strokeOpacity={0.07 + (i % 3) * 0.03} strokeWidth="1" vectorEffect="non-scaling-stroke" />)}</svg>
        <div className="rp-fill-kpi">
          <div className="rp-fill-k"><Target size={9} />{label}</div>
          <div className="rp-fill-n">{k.label}</div>
          <div className={clsx('rp-fill-v', t > 0 ? 'good' : t < 0 ? 'bad' : '')}>{fmtK(k.value, k.format)}<em>{fmtDelta(k.chg, k.format)} vs {L.prev}</em></div>
          <div className="rp-fill-bars">{bars.map(([l, v, c]) => (
            <div key={c} className="row"><span>{l}</span><div className="track"><i className={c} style={{ width: `${Math.max(3, (Math.abs(v ?? 0) / mx) * 100)}%` }} /></div><b>{fmtK(v, k.format)}</b></div>
          ))}</div>
        </div>
        <div className="rp-fill-trend"><div className="rp-fill-k"><TrendingUp size={9} />14-month trend</div><Trend values={k.series} labels={P.seriesLabels} good={t === 0 ? null : t > 0} /></div>
        {quote && <blockquote className="rp-fill-q"><span className="mk">“</span><p>{quote}</p></blockquote>}
      </div>
    </div>
  );
}

/** Reads a chart for the reader: latest, peak, low and average of its main series. */
function ChartFacts({ c }: { c: ReportSection['charts'][number] }) {
  const r = c.result;
  const dim = r.columns.find((x) => x.kind === 'period') ?? r.columns.find((x) => x.kind === 'dimension' && x.key !== c.seriesBy);
  const m = r.columns.find((x) => x.kind === 'metric' && (!c.y?.length || c.y.includes(x.key))) ?? r.columns.find((x) => x.kind === 'metric');
  if (!dim || !m) return <div />;
  const f = (m.format ?? 'number') as Format;
  // series charts: total the metric per x value
  const by = new Map<string, number>();
  for (const row of r.rows) { const v = Number(row[m.key]); if (!isFinite(v)) continue; const k = String(row[dim.key] ?? '—'); by.set(k, (c.seriesBy && f !== 'percent' ? (by.get(k) ?? 0) : 0) + v); }
  const pts = [...by.entries()];
  if (pts.length < 2) return <div />;
  const lab = (k: string) => (/^\d{4}-\d{2}/.test(k) ? fmtPeriod(k, 'month') : k);
  const hi = pts.reduce((a, b) => (b[1] > a[1] ? b : a)), lo = pts.reduce((a, b) => (b[1] < a[1] ? b : a));
  const time = /^\d{4}-\d{2}/.test(pts[0][0]);
  const avg = pts.reduce((a, b) => a + b[1], 0) / pts.length;
  const total = pts.reduce((a, b) => a + b[1], 0);
  const rows: [string, string, string][] = time
    ? [['Latest', lab(pts[pts.length - 1][0]), fmt(pts[pts.length - 1][1], f)], ['Peak', lab(hi[0]), fmt(hi[1], f)], ['Low', lab(lo[0]), fmt(lo[1], f)], ['Average', `${pts.length} months`, fmt(avg, f)]]
    : [['Leader', hi[0], fmt(hi[1], f)], ...(f !== 'percent' && total ? [['Leader share', `of ${pts.length}`, `${((hi[1] / total) * 100).toFixed(0)}%`] as [string, string, string]] : []), ['Lowest', lo[0], fmt(lo[1], f)], ['Average', `${pts.length} items`, fmt(avg, f)]];
  return (
    <Panel title="Reading the chart" icon={TrendingUp} className="rp-tint rp-facts">
      <div className="rp-facts-l">{m.label}</div>
      {rows.map(([a, b, v]) => <div key={a} className="rp-facts-r"><span>{a}<em>{b}</em></span><b>{v}</b></div>)}
    </Panel>
  );
}

/* ═════════ pagination ═════════ */
const PX = 96 / 25.4;
const GAP_MM = { compact: 3.8, balanced: 5.2, airy: 6.8 };
/** Usable content height of a page (A4 minus top padding and the footer zone). */
const AVAIL = { p: (297 - 12 - 17) * PX, l: (210 - 12 - 17) * PX };
type Blk = { key: string; node: ReactNode; keep?: boolean };
type LP = { key: string; blocks: Blk[]; landscape?: boolean; bleed?: boolean; cont?: ReactNode; fill?: (i: number) => ReactNode; toc?: string };
type Sheet = { lp: string; idx: number; items: { key: string; zoom: number }[]; filler: boolean };
type Heights = Record<string, { h: number; z: number }>;

/** Flows each logical page's blocks onto as many A4 sheets as they need — content is never squeezed to fit. */
function paginate(lps: LP[], hs: Heights, gap: number): Sheet[] {
  const out: Sheet[] = [];
  for (const lp of lps) {
    if (lp.bleed) { out.push({ lp: lp.key, idx: 0, items: lp.blocks.map((b) => ({ key: b.key, zoom: 1 })), filler: false }); continue; }
    const avail = lp.landscape ? AVAIL.l : AVAIL.p;
    const contH = lp.cont ? hs[`${lp.key}/__cont`]?.h ?? 0 : 0;
    let pg = { idx: 0, items: [] as { key: string; zoom: number }[], used: 0, real: 0 };
    const flush = () => {
      out.push({ lp: lp.key, idx: pg.idx, items: pg.items, filler: !!lp.fill && avail - pg.used > 44 * PX });
      pg = { idx: pg.idx + 1, items: lp.cont ? [{ key: '__cont', zoom: 1 }] : [], used: lp.cont ? contH : 0, real: 0 };
    };
    lp.blocks.forEach((b, i) => {
      const m = hs[`${lp.key}/${b.key}`] ?? { h: 0, z: 1 };
      let h = m.h, z = m.z;
      const at = () => (pg.items.length ? pg.used + gap : 0);
      const nxt = b.keep && lp.blocks[i + 1] ? (hs[`${lp.key}/${lp.blocks[i + 1].key}`]?.h ?? 0) + gap : 0;
      if (pg.real && at() + h + Math.min(nxt, avail * 0.5) > avail) flush();
      const room = avail - at();
      if (h > room) { z = z * (room / h); h = room; }   // a single block taller than a page: scale just that block
      pg.used = at() + h; pg.items.push({ key: b.key, zoom: z }); pg.real++;
    });
    if (pg.real || !out.length) flush();
  }
  return out;
}

const rgbOf = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16)).join(' ');
export function reportAccent(l: ReportLayout): AccentPair { return l.accent === 'app' ? currentAccent() : ACCENTS.find((a) => a.name === l.accent) ?? currentAccent(); }
/** Report charts use at most three hues drawn from the report's accent — a deep shade, the accent and warm gold — with lighter tints for extra series. */
export const REPORT_PALETTE = ['#123a72', '#3fa9dc', '#c8a46a', '#6f8fbf', '#9fd6f0', '#e2cc9f', '#0a2148', '#2a7fb0'];
export function reportChartTheme(l: ReportLayout): ThemeColors {
  const a = reportAccent(l);
  if (a.name === 'Physique 57') return { ...LIGHT_THEME, accent: '#123a72', series: REPORT_PALETTE };
  const deep = mix(a.a, '#07081a', 0.45);
  return { ...LIGHT_THEME, accent: deep, series: [deep, a.a, '#c8a46a', mix(a.b, '#ffffff', 0.15), mix(a.a, '#ffffff', 0.55), '#e2cc9f', mix(a.a, '#07081a', 0.7), mix(a.b, '#07081a', 0.25)] };
}
/** The layout with the AI's art direction applied — only where the reader hasn't set the option themselves. */
export function designedLayout(l: ReportLayout, ins: ReportInsights | null): ReportLayout {
  const d = l.autoDesign !== false ? ins?.design : undefined;
  if (!d) return l;
  const D = DEFAULT_LAYOUT;
  const style = l.cover === D.cover && l.photos === D.photos ? (d.cover_style === 'photo' ? { photos: true } : { photos: false, cover: d.cover_style }) : {};
  return { ...l, ...(l.accent === D.accent && ACCENTS.some((x) => x.name === d.accent) ? { accent: d.accent } : {}), ...style };
}
function paperVars(l: ReportLayout): CSSProperties {
  const a = reportAccent(l);
  const d = { compact: [`${GAP_MM.compact}mm`, '1.25mm', '3.4mm'], balanced: [`${GAP_MM.balanced}mm`, '1.6mm', '4.2mm'], airy: [`${GAP_MM.airy}mm`, '2mm', '5mm'] }[l.density];
  return {
    '--accent': a.a, '--violet': a.b, '--acc-rgb': rgbOf(a.a), '--rb-a': mix(a.a, '#ffffff', 0.35), '--rb-b': mix(a.b, '#ffffff', 0.3),
    '--navy': mix(a.a, '#07081a', 0.8), '--navy-2': mix(a.a, '#0b0c1e', 0.42), '--paper-tint': mix(a.a, '#ffffff', 0.955), '--acc-soft': mix(a.a, '#ffffff', 0.9),
    '--grad': a.name === 'Physique 57' ? 'linear-gradient(130deg, #030a1a 0%, #071731 42%, #0b2550 78%, #123a72 100%)' : `linear-gradient(130deg, ${mix(a.a, '#02030a', 0.92)} 0%, ${mix(a.a, '#05060f', 0.8)} 42%, ${mix(a.a, '#07081a', 0.62)} 78%, ${mix(a.a, '#07081a', 0.4)} 100%)`,
    '--gap': d[0], '--rowpad': d[1], '--pad': d[2],
    ...(l.headingFont === 'sans' ? { '--serif': 'var(--font-display)' } : {}),
  } as CSSProperties;
}


/* ═════════ document ═════════ */
export function ReportDocument({ data: raw, insights, aiLoading, layout = DEFAULT_LAYOUT }: { data: ReportData; insights: ReportInsights | null; aiLoading: boolean; layout?: ReportLayout }) {
  const drill = useDrill();
  const lay = designedLayout(layout, insights);
  const design = layout.autoDesign !== false ? insights?.design : undefined;
  // the AI tells the story in its own order (road ahead stays last); the reader's own reordering switches this off
  const data = design?.section_order?.length ? { ...raw, sections: [...raw.sections].sort((a, b) => { const p = (id: string) => id === 'road' ? 999 : (design.section_order.indexOf(id) + 1 || 500); return p(a.id) - p(b.id); }) } : raw;
  const condensed = new Set(design?.condense ?? []);
  const chartAs = new Map((design?.chart_types ?? []).map((c) => [c.chart_id, c.chart as ReportSection['charts'][number]['chart']]));
  const allCharts = new Map(data.sections.flatMap((s) => s.charts.map((c) => [c.id, c] as const)));
  const allKpis = new Map([...data.scorecard, ...data.headline, ...data.sections.flatMap((s) => s.kpis)].map((k) => [k.id, k] as const));
  const theme = reportChartTheme(lay);
  const P = data.period;
  const L = shortLabels(P);
  const ins = insights;
  const meta = `${data.scope.length > 46 ? `${data.request.locations.length} studios` : data.scope} · ${P.label}`;
  const kd = (k: Kpi, extra: { dimension: string; op?: 'in'; values: string[] }[] = []) => drill ? () => drill({ metric: k.id, filters: [...(data.request.locations.length ? [{ dimension: 'location', op: 'in' as const, values: data.request.locations }] : []), ...extra], start: P.start, end: P.end, context: [data.scope, P.label], expected: k.value }) : undefined;
  const sx = (id: string) => ins?.sections?.[id];
  const legend = [lay.cmp.prev && <span key="p"><i className="b1" />{P.prevLabel}</span>, lay.cmp.ytd && <span key="y"><i className="b2" />{P.ytdLabel}</span>, lay.cmp.ly && <span key="l"><i className="b3" />{P.lyLabel}</span>];
  const baselines = <div className="rp-legend">{legend}</div>;
  /** KPIs ranked by how far they moved — the natural "in focus" picks for spare space. */
  const movers = (ks: Kpi[]) => [...ks].filter((k) => k.chg !== null && k.series.filter((v) => v !== null).length > 2).sort((a, b) => Math.abs(b.chg ?? 0) - Math.abs(a.chg ?? 0));
  const fillFrom = (ks: Kpi[], quotes: (string | undefined)[], label = 'In focus') => (i: number) => { const m = movers(ks); return <Filler k={m[i % Math.max(1, m.length)] ?? ks[0]} quote={quotes.filter(Boolean)[i] ?? undefined} P={P} L={L} label={i ? 'Also worth watching' : label} />; };
  const B = (key: string, node: ReactNode, keep?: boolean): Blk => ({ key, node, keep });
  const kpiGrid = (ks: Kpi[], extra?: { dimension: string; values: string[] }[]) => <div className={clsx('rp-kpi-grid', lay.kpiCols === 3 ? 'g3' : lay.kpiCols === 4 ? 'g4' : ks.length > 6 || ks.length === 4 ? 'g4' : 'g3')}>{ks.map((k) => <KpiTile key={k.id} k={k} L={L} onDrill={kd(k, extra)} />)}</div>;
  const chart = (c0: ReportSection['charts'][number], h = 200) => {
    const c = chartAs.has(c0.id) ? { ...c0, chart: chartAs.get(c0.id)! } : c0;
    const hh = c.chart === 'horizontal_bar' ? Math.min(300, Math.max(150, 40 + c.result.rows.length * 15)) : c.chart === 'pie' ? Math.min(h, 210) : h; // bars sized to their rows; pies kept round
    return <Panel key={c.id} title={c.title} className="rp-chart"><div data-chart-id={c.id}><ChartBlock result={c.result} chart={c.chart} seriesBy={c.seriesBy} y={c.y} height={hh} theme={theme} bare /></div></Panel>;
  };
  /** A lone chart is never stretched across the page: it sits beside a panel that reads it (peak, low, latest, average). */
  const soloChart = (c: ReportSection['charts'][number], h = 200) => <div className="rp-grid-62">{chart(c, h)}<ChartFacts c={c} /></div>;
  const spotBlock = (sp: Spotlight, i: number) => {
    const c = sp.chart_id ? allCharts.get(sp.chart_id) : undefined;
    const ks = sp.kpis.map((id) => allKpis.get(id)).filter((k): k is Kpi => !!k);
    return B(`spot${i}`, <div className={clsx('rp-spotlight', sp.tone)}>
      <div className="rp-spotlight-t"><div className="rp-kicker"><Sparkles size={10} />{sp.kicker}</div><h3>{sp.title}</h3><p><Figs text={sp.body} /></p>
        {ks.length > 0 && <div className="rp-spotlight-k">{ks.map((k) => { const t = tone(k, k.chg); return <div key={k.id}><span>{k.label}</span><b>{fmtK(k.value, k.format)}</b><em className={t > 0 ? 'good' : t < 0 ? 'bad' : ''}>{fmtDelta(k.chg, k.format)} vs {L.prev}</em></div>; })}</div>}
      </div>
      {c && <div className="rp-spotlight-c">{chart(c, 190)}</div>}
    </div>);
  };
  const isNarrow = (t: ReportTable) => t.result.columns.filter((c) => c.kind !== 'comparison').length <= 5 && t.result.columns.filter((c) => c.kind === 'dimension').length <= 1;
  /** Detail tables as blocks: wide tables alone, narrow ones paired side by side. */
  const tableBlocks = (prefix: string, ts: ReportTable[], rows = lay.tableRows): Blk[] => {
    const out: Blk[] = []; let pend: ReportTable | null = null;
    const rowsFor = (t: ReportTable) => (['trainer_scorecard', 'lead_channels'].includes((t.result as { kind?: string }).kind ?? '') ? Math.max(rows, t.result.rows.length) : t.result.columns.filter((c) => c.kind === 'dimension').length > 1 ? Math.max(rows, 40) : rows); // two-way breakdowns need their rows
    const pushPair = (a: ReportTable, b?: ReportTable) => out.push(B(`${prefix}-${a.id}`, b ? <div className="rp-grid-2"><ReportDataTable t={a} maxRows={rowsFor(a)} /><ReportDataTable t={b} maxRows={rowsFor(b)} /></div> : <ReportDataTable t={a} maxRows={rowsFor(a)} />));
    for (const t of ts) {
      if (!isNarrow(t)) { if (pend) { pushPair(pend); pend = null; } pushPair(t); continue; }
      if (pend) { pushPair(pend, t); pend = null; } else pend = t;
    }
    if (pend) pushPair(pend);
    return out;
  };
  const lps: LP[] = [];

  /* executive summary */
  if (lay.pages.exec) lps.push({ key: 'exec', toc: 'Executive summary', cont: <MiniHead title="Executive summary — continued" icon={Gauge} />, fill: fillFrom(data.headline, [ins?.at_a_glance?.[0], ins?.themes?.[0]?.detail], 'Biggest mover'), blocks: [
    B('head', <div className="rp-exec-head"><div><div className="rp-kicker">Executive summary</div><h2 className="rp-h2">{P.label} at a glance</h2></div>{!data.glance?.length && baselines}</div>, true),
    B('quote', <blockquote className="rp-quote">{ins ? <Figs text={ins.headline} /> : <Pending lines={2} />}</blockquote>),
    B('summary', data.glance?.length && ins?.source !== 'ai' ? (ins?.executive_summary ? <div className="rp-prose">{toText(ins.executive_summary).split(/\n\s*\n/).filter(Boolean).map((p, i) => <p key={i} className={i === 0 ? 'lead' : ''}><Figs text={p} /></p>)}</div> : <Panel title="In ten seconds" icon={Gauge} className="rp-tint"><Glance items={data.autoInsights.highlights.slice(0, 4)} /></Panel>) : ins?.source === 'ai'
      ? <div className="rp-grid-62">
          <div className="rp-prose">{toText(ins.executive_summary).split(/\n\s*\n/).map((p, i) => <p key={i} className={i === 0 ? 'lead' : ''}><Figs text={p} /></p>)}</div>
          <Panel title="In ten seconds" icon={Gauge} className="rp-tint"><Glance items={ins.at_a_glance} /></Panel>
        </div>
      : <Panel title="In ten seconds" icon={Gauge} className="rp-tint">{ins ? <Glance items={ins.at_a_glance} cols /> : aiLoading ? <Pending lines={4} /> : <Glance items={data.autoInsights.highlights.slice(0, 6)} cols />}</Panel>),
    ...(data.glance?.length ? (() => {
      const g = data.glance!; const word = ['', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten'][g.length] ?? '';
      const item = (x: typeof g[number], i: number) => <li key={i}><span className="n">Q{i + 1}</span><div><strong>{x.q}</strong><p><Figs text={(ins?.source === 'ai' && sx(x.section)?.headline) || x.a} /></p></div></li>;
      const out: Blk[] = [B('qa-h', <div className="rp-subhead"><Target size={11} />The {word} questions — answers at a glance</div>, true)];
      for (let i = 0; i < g.length; i += 3) out.push(B(`qa${i}`, <ol className="rp-qa rp-qa-box" start={i + 1}>{g.slice(i, i + 3).map((x, j) => item(x, i + j))}</ol>));
      return out;
    })() : []),
    B('kpis', kpiGrid(data.headline)),
    ...(data.summaryTables ?? []).map((t) => B(`st-${t.id}`, <ReportDataTable t={t} maxRows={20} />)),
    B('ww', <div className="rp-grid-2 rp-ww">
      <Panel title="What went well" icon={CheckCircle2} className="rp-good"><Numbered items={ins?.wins ?? data.autoInsights.highlights} tone="good" /></Panel>
      <Panel title="Watch-outs" icon={AlertTriangle} className="rp-bad"><Numbered items={ins?.watch_outs ?? data.autoInsights.concerns} tone="bad" /></Panel>
    </div>),
    ...(ins?.themes?.length ? [B('themes', <div className="rp-themes">{ins.themes.map((t, i) => <div key={i} className="rp-theme"><div className="rp-theme-n">Theme {i + 1}</div><h4>{t.title}</h4><p><Figs text={t.detail} /></p></div>)}</div>)] : []),
  ] });

  /* scorecard */
  if (lay.pages.score && data.scorecard.length) {
    const sc = data.scorecard;
    const scoreTable = (rows: Kpi[]) => (
      <table className="rp-table rp-score">
        <thead><tr><th>Metric</th><th className="num">{P.label}</th>{lay.cmp.prev && <><th className="num">{P.prevLabel}</th><th className="num">Δ</th></>}{lay.cmp.ytd && <><th className="num">{P.ytdLabel}</th><th className="num">Δ</th></>}{lay.cmp.ly && <><th className="num">{P.lyLabel}</th><th className="num">Δ</th></>}{lay.sparklines && <th>14-month trend</th>}</tr></thead>
        <tbody>{rows.map((k) => {
          const c = (x: number | null) => { const t = tone(k, x); return <td className={clsx('num chg', t > 0 ? 'good' : t < 0 ? 'bad' : '')}>{fmtDelta(x, k.format)}</td>; };
          return (
            <tr key={k.id}>
              <td className="dim">{k.label}</td><td className={clsx('num strong', drill && 'drill')} onClick={kd(k)}>{fmtK(k.value, k.format)}</td>
              {lay.cmp.prev && <><td className="num muted">{fmtK(k.prev, k.format)}</td>{c(k.chg)}</>}{lay.cmp.ytd && <><td className="num muted">{fmtK(k.ytd, k.format)}</td>{c(k.chgYtd)}</>}{lay.cmp.ly && <><td className="num muted">{fmtK(k.ly, k.format)}</td>{c(k.chgLy)}</>}
              {lay.sparklines && <td className="spark"><Spark values={k.series} w={60} h={15} good={tone(k, k.chg) === 0 ? null : tone(k, k.chg) > 0} /></td>}
            </tr>
          );
        })}</tbody>
      </table>
    );
    lps.push({ key: 'score', toc: 'Scorecard', cont: <MiniHead title="Scorecard — continued" icon={Gauge} />, fill: fillFrom(sc, [ins?.at_a_glance?.[1]], 'Scorecard focus'), blocks: [
      B('head', <div className="rp-exec-head"><div><div className="rp-kicker">Scorecard</div><h2 className="rp-h2">Performance against three baselines</h2></div>{baselines}</div>, true),
      B('table', scoreTable(sc)),
      ...(data.studios ? [B('studios', <ReportDataTable t={data.studios} maxRows={lay.tableRows} />)] : []),
    ] });
  }

  /* sections */
  let n = 1;
  const num = () => String(n++).padStart(2, '0');
  const section = (s: ReportSection, body: Blk[]) => {
    const c = sx(s.id);
    const findings = c?.findings?.length ? c.findings : s.insights;
    const bandNo = num();
    const aiOn = ins?.source === 'ai';
    const photo = lay.photos ? (s.id.startsWith('trainer_ranking') ? photoForSection('trainers') : s.id.startsWith('lead_channels') ? photoForSection(s.id === 'lead_channels' ? 'clients' : 'leads') : s.ask ? photoForSection(['leads', 'classes', 'formats', 'churn', 'clients'][Number(s.id.slice(1)) % 5]) : photoForSection(s.id)) : undefined;
    const hasActions = !!c?.actions?.length || (aiLoading && !!s.answer);
    const analysis = (
      <Panel title="Analysis" icon={Sparkles} className="rp-analysis">
        {aiLoading && !c?.narrative ? <Pending lines={5} /> : <Prose text={c?.narrative && aiOn ? c.narrative : s.summary} />}
        <Movers ks={s.kpis} L={L} />
      </Panel>
    );
    const blocks: Blk[] = [B('band', <Band s={s} num={bandNo} headline={s.answer ? undefined : c?.headline} aiLoading={aiLoading && !s.answer} photo={photo} />, true),
      ...(s.answer ? [B('answer', <AnswerBox a={s.answer} headline={aiOn ? c?.headline : undefined} loading={aiLoading} />)] : []),
      ...(s.stats?.length ? [B('stats', <StatStrip stats={s.stats} />)] : []),
      ...body,
      B('ai', hasActions || !s.answer ? <div className="rp-grid-62">
        {analysis}
        <Panel title={aiOn ? 'Recommended actions' : 'Actions'} icon={Flag} className="rp-tint">{c?.actions?.length ? <Numbered items={c.actions} tone="gold" /> : aiLoading ? <Pending lines={3} /> : <p className="rp-narr muted">See the recommendations at the end of the report.</p>}</Panel>
      </div> : analysis)];
    if (lay.detail && !condensed.has(s.id)) {
      const showFind = findings.length && (aiOn || !s.answer || findings.join() !== s.answer.points.join());
      if (showFind) blocks.push(B('find', <Panel title={aiOn ? 'Findings' : 'Key findings'} icon={Lightbulb} className="rp-findings"><Numbered items={findings} /></Panel>));
      blocks.push(...tableBlocks('t', s.tables));
    }
    (ins?.spotlights ?? []).forEach((sp, i) => { if (sp.section === s.id) blocks.push(spotBlock(sp, i)); });
    lps.push({ key: s.id, toc: s.title, blocks, cont: <MiniHead title={`${s.title} — continued`} sub={s.answer || s.id.startsWith('lead_channels') || s.id.startsWith('trainer_ranking') ? P.label : `${P.label}; Δ = change vs ${P.prevLabel}.`} icon={ICONS[s.icon]} />, fill: fillFrom(s.kpis, [findings[0], findings[1], c?.actions?.[0]]) });
  };
  const R = lay.tableRows;
  const builders: Record<string, (s: ReportSection) => void> = {
    sales: (s) => section(s, [B('kpis', kpiGrid(s.kpis)), B('charts', <div className="rp-grid-62">{chart(s.charts[0], 210)}{s.charts[1] && chart(s.charts[1], 210)}</div>)]),
    new_clients: (s) => section(s, [B('kpis', kpiGrid(s.kpis)), B('viz', <div className="rp-grid-2">{s.visuals?.funnel && <Panel title="Newcomer journey" icon={UserPlus}><Funnel steps={s.visuals.funnel} /></Panel>}{s.charts[0] && chart(s.charts[0], 200)}</div>), ...(s.charts.length > 1 ? [B('charts2', s.charts.length === 2 ? soloChart(s.charts[1], 200) : <div className="rp-grid-2">{s.charts.slice(1, 3).map((c) => chart(c, 190))}</div>)] : [])]),
    leads: (s) => section(s, [B('kpis', kpiGrid(s.kpis)), B('viz', <div className="rp-grid-2">{s.visuals?.funnel && <Panel title="Lead funnel" icon={Megaphone}><Funnel steps={s.visuals.funnel} /></Panel>}{s.charts[0] && chart(s.charts[0], 200)}</div>), ...(s.charts[1] ? [B('charts2', soloChart(s.charts[1], 200))] : [])]),
    trainers: (s) => section(s, [B('kpis', kpiGrid(s.kpis)),
      ...(s.visuals?.spotlight?.length ? [B('spot', <div className="rp-spot">{s.visuals.spotlight.map((t, i) => (
        <div key={t.name} className={clsx('rp-spot-c', `r${i + 1}`)}><div className="rp-medal"><Trophy size={13} /><span>#{i + 1}</span></div><div className="nm">{t.name}</div>
          <div className="st"><div><b>{fmt(t.avg, 'decimal')}</b><span>class avg</span></div><div><b>{fmt(t.fill, 'percent')}</b><span>fill</span></div><div><b>{t.classes}</b><span>classes</span></div><div><b>{fmt(t.checkins, 'number')}</b><span>check-ins</span></div></div></div>
      ))}</div>)] : []),
      ...(s.tables[0] ? [B('lead', <ReportDataTable t={s.tables[0]} maxRows={Math.min(R, 10)} />)] : []),
    ]),
    classes: (s) => section(s, [B('kpis', kpiGrid(s.kpis)), B('viz', <div className="rp-grid-62">{s.visuals?.heatmap && <Panel title="Fill rate by weekday & hour (%)" icon={CalendarRange}><Heatmap hm={s.visuals.heatmap} /></Panel>}<div className="rp-stack">{s.charts.slice(0, 2).map((c) => chart(c, 120))}</div></div>)]),
    formats: (s) => {
      const fm = s.visuals?.formats ?? [];
      const tot = fm.reduce((a, f) => a + (f.kpis.find((k) => k.id === 'class_checkins')?.value ?? 0), 0);
      section(s, [B('cards', <div className="rp-formats">{fm.map((f, fi) => {
        const share = tot ? ((f.kpis.find((k) => k.id === 'class_checkins')?.value ?? 0) / tot) : 0;
        return (
          <div key={f.format} className="rp-fmt" style={{ ['--fc' as string]: colorFor(f.format, fi, theme.series) }}>
            <div className="rp-fmt-h"><FormatGlyph format={f.format} /><div><h4>{f.format}</h4><span>{(share * 100).toFixed(0)}% of check-ins</span></div></div>
            <div className="rp-fmt-bar"><i style={{ width: `${share * 100}%` }} /></div>
            <table className="rp-fmt-t"><tbody>{f.kpis.map((k) => {
              const best = fm.every((o) => { const ok = o.kpis.find((x) => x.id === k.id); return !ok || ok.value === null || k.value === null || k.higherIsBetter === undefined || k.additive || (k.higherIsBetter ? k.value >= ok.value : k.value <= ok.value); });
              const t = tone(k, k.chg);
              return <tr key={k.id} className={clsx(best && !k.additive && k.higherIsBetter !== undefined && 'best')} onClick={kd(k, [{ dimension: 'format', values: [f.format] }])}><td>{k.label}</td><td className="v">{fmtK(k.value, k.format)}</td><td className={clsx('c', t > 0 ? 'good' : t < 0 ? 'bad' : '')}>{fmtDelta(k.chg, k.format)}</td></tr>;
            })}</tbody></table>
          </div>
        );
      })}</div>), B('charts', s.charts.length === 1 ? soloChart(s.charts[0], 200) : <div className="rp-grid-2">{s.charts.map((c) => chart(c, 180))}</div>)]);
    },
    churn: (s) => section(s, [B('kpis', kpiGrid(s.kpis)),
      ...(s.visuals?.strict ? [B('strict', <div className="rp-note"><b>Strict renewal rate</b> (membership / package repurchased within 30 days of expiry): <b>{fmt(s.visuals.strict.renewal_rate, 'percent')}</b> — {s.visuals.strict.renewed} renewed of {Number(s.visuals.strict.expiring) - Number(s.visuals.strict.pending)} closed windows, {s.visuals.strict.pending} still open. Zero-value and non-recurring memberships are excluded.</div>)] : []),
      B('charts', s.charts.length === 1 ? soloChart(s.charts[0], 200) : <div className="rp-grid-2">{s.charts.map((c) => chart(c, 190))}</div>)]),
    late: (s) => section(s, [B('kpis', kpiGrid(s.kpis)), B('charts', <div className="rp-grid-62">{s.charts[0] && chart(s.charts[0], 200)}{s.charts[1] && chart(s.charts[1], 200)}</div>)]),
    road: (s) => {
      const ra = ins?.road_ahead;
      const prios = ra?.priorities ?? data.autoInsights.recommendations.map((r) => ({ ...r, owner: 'Studio leadership', timing: 'Next month', target: '—', priority: r.priority as 'high' | 'medium' | 'low' }));
      const prioCard = (p: (typeof prios)[number], i: number) => (
        <div key={i} className={clsx('rp-prio-c', p.priority)}>
          <div className="n">{i + 1}</div>
          <div className="b"><div className="t">{p.title}<span className={clsx('pri', p.priority)}>{p.priority}</span></div><p>{p.detail}</p>
            <div className="m"><span><b>Owner</b>{p.owner}</span><span><b>When</b>{p.timing}</span><span><b>KPI</b>{p.kpi}</span>{p.target && p.target !== '—' && <span><b>Target</b>{p.target}</span>}</div></div>
        </div>
      );
      const pairs: Blk[] = [];
      for (let i = 0; i < prios.length; i += 2) pairs.push(B(`prio${i}`, <div className="rp-prio">{prios.slice(i, i + 2).map((p, j) => prioCard(p, i + j))}</div>));
      lps.push({ key: 'road', toc: s.title, cont: <MiniHead title="Road Ahead — continued" icon={Compass} />, fill: fillFrom(data.headline, [ins?.themes?.[0]?.detail, ra?.opportunities?.[0]], 'Where the business is heading'), blocks: [
        B('band', <Band s={s} num={num()} aiLoading={false} photo={lay.photos ? photoForSection('road') : undefined} />, true),
        B('fc', <div className="rp-fc">{(s.visuals?.forecasts ?? []).map((f) => (
          <div key={f.metric} className="rp-fc-c">
            <div className="l">{f.label} forecast · {f.month}</div><div className="v">{fmtK(f.value, f.format)}</div>
            {f.lo !== null && f.hi !== null && f.value !== null && <div className="rng"><div className="bar"><i style={{ left: '10%', right: '10%' }} /><b style={{ left: `${10 + ((f.value - f.lo) / Math.max(1e-9, f.hi - f.lo)) * 80}%` }} /></div><div className="ends"><span>{fmtK(f.lo, f.format)}</span><span>80% range</span><span>{fmtK(f.hi, f.format)}</span></div></div>}
            <div className="m">{f.method}</div>
          </div>
        ))}{(s.visuals?.pipeline ?? []).map((p) => <div key={p.label} className="rp-fc-c alt"><div className="l">{p.label}</div><div className="v">{fmtK(p.value, p.format)}</div><div className="m">{p.note}</div></div>)}</div>),
        B('outlook', <Panel title="Outlook" icon={Compass} className="rp-analysis">{ra?.summary ? <Prose text={ra.summary} /> : aiLoading ? <Pending lines={4} /> : <Prose text={s.summary} />}</Panel>),
        B('ph', <div className="rp-subhead"><Flag size={11} />Priorities for the next period</div>, true),
        ...pairs,
        B('ror', <div className="rp-grid-3">
          <Panel title="Risks" icon={ShieldAlert} className="rp-bad"><Numbered items={ra?.risks ?? data.autoInsights.concerns.slice(0, 3)} tone="bad" /></Panel>
          <Panel title="Opportunities" icon={TrendingUp} className="rp-good"><Numbered items={ra?.opportunities ?? data.autoInsights.highlights.slice(0, 3)} tone="good" /></Panel>
          <Panel title="Suggested targets" icon={Target} className="rp-tint">{(ra?.targets ?? []).map((t, i) => <div key={i} className="rp-target"><div><b>{t.metric}</b><span>{t.target}</span></div><p>{t.rationale}</p></div>)}</Panel>
        </div>),
      ] });
    },
  };
  /** Topics without a bespoke layout: KPIs, charts side by side, then detail tables. */
  const generic = (s: ReportSection) => section(s, [
    ...(s.notes?.length ? [B('notes', <div className="rp-note rp-brief-note">{s.notes.map((x, i) => <div key={i}>{x}</div>)}</div>)] : []),
    ...(s.kpis.length ? [B('kpis', kpiGrid(s.kpis))] : []),
    ...(s.visuals?.funnel ? [B('funnel', <div className="rp-grid-2"><Panel title="Lead funnel" icon={Megaphone}><Funnel steps={s.visuals.funnel} /></Panel>{s.charts[0] && chart(s.charts[0], 205)}</div>)] : []),
    ...(s.visuals?.funnel ? (s.charts.length > 1 ? [B('charts', soloChart(s.charts[1], 210))] : [])
      : s.charts.length ? [B('charts', s.charts.length > 1 ? <div className="rp-grid-62">{s.charts.slice(0, 2).map((c) => chart(c, 205))}</div> : soloChart(s.charts[0], 210))] : []),
    ...(s.visuals?.trainers?.length ? [B('profiles', <TrainerCards ts={s.visuals.trainers} />)] : []),
    ...(!s.visuals?.funnel && s.charts.length > 2 ? [B('charts2', s.charts.length === 3 ? soloChart(s.charts[2], 200) : <div className="rp-grid-2">{s.charts.slice(2, 4).map((c) => chart(c, 190))}</div>)] : []),
    ...(s.definitions?.length ? [B('defs', <Panel title="Definitions" icon={BookOpen} className="rp-tint"><div className="rp-defs-list">{s.definitions.map((d) => <div key={d.term}><b>{d.term}</b><DefText text={d.text} /></div>)}</div></Panel>)] : []),
  ]);
  for (const s of data.sections) (builders[s.id] ?? generic)(s);

  /* recommendations & suggestions */
  const recs = Array.isArray(ins?.recommendations) && ins.recommendations.length ? ins.recommendations : data.autoInsights.recommendations.map((r) => ({ title: r.title, detail: r.detail, owner: 'Studio leadership', priority: r.priority as 'high' | 'medium' | 'low', impact: undefined as string | undefined }));
  if (recs.length) {
    const pairs: Blk[] = [];
    for (let i = 0; i < recs.length; i += 2) pairs.push(B(`r${i}`, <div className="rp-prio">{recs.slice(i, i + 2).map((p, j) => (
      <div key={j} className={clsx('rp-prio-c', p.priority)}>
        <div className="n">{i + j + 1}</div>
        <div className="b"><div className="t">{p.title}<span className={clsx('pri', p.priority)}>{p.priority}</span></div><p><Figs text={p.detail} /></p>
          <div className="m"><span><b>Owner</b>{p.owner}</span>{p.impact && <span><b>Impact</b>{p.impact}</span>}</div></div>
      </div>
    ))}</div>));
    lps.push({ key: 'recs', toc: 'Recommendations', cont: <MiniHead title="Recommendations — continued" icon={Lightbulb} />, fill: fillFrom(data.headline, [ins?.themes?.[0]?.detail]), blocks: [
      B('head', <div className="rp-exec-head"><div><div className="rp-kicker">{ins?.source === 'ai' ? 'Recommendations' : 'Recommendations'}</div><h2 className="rp-h2">Recommendations &amp; suggestions</h2></div></div>, true),
      ...pairs,
    ] });
  }

  /* appendices */
  if (lay.pages.mom) {
    const mk = data.appendix.mom.result.columns.filter((c) => c.kind === 'metric').map((c) => c.key);
    const chunks: string[][] = []; for (let i = 0; i < mk.length; i += 4) chunks.push(mk.slice(i, i + 4));
    lps.push({ key: 'mom', landscape: true, toc: 'Appendix A — month-on-month', cont: <MiniHead title="Appendix A — month-on-month (continued)" icon={CalendarRange} />, blocks: [
      B('head', <MiniHead title="Appendix A — month-on-month, last 14 months" sub="Newest month on the left; last year and YoY change beneath each metric; paying and total visiting clients side by side. * = month in progress." icon={CalendarRange} />, true),
      ...chunks.map((c, i) => B(`m${i}`, <MomTable result={data.appendix.mom.result} only={c} />)),
    ] });
  }
  if (lay.pages.defs) {
    const defs = data.appendix.definitions.slice(0, 70);
    const dch: typeof defs[] = []; for (let i = 0; i < defs.length; i += 12) dch.push(defs.slice(i, i + 12));
    lps.push({ key: 'defs', toc: 'Appendix B — definitions', cont: <MiniHead title="Appendix B — definitions (continued)" icon={BookOpen} />, blocks: [
      B('head', <MiniHead title="Appendix B — definitions & method" sub="How every figure in this report is calculated." icon={BookOpen} />, true),
      B('note', <div className="rp-note"><b>Baselines.</b> {P.prevLabel} = the previous period of equal length. {P.ytdLabel} = the mean of the monthly values from January to the month before the report period{P.months > 1 ? ', with volumes scaled to the period length' : ''}. {P.lyLabel} = the same period last year. Scope: {data.scope}. Renewal and churn cover recurring memberships only (zero-value, complimentary, single-class, sign-up-link and other non-recurring memberships excluded). Visits exclude future bookings and imported legacy records. Formats (Barre / powerCycle / Strength Lab) are derived from class names. {ins?.verification ? `Commentary checked against computed results: ${ins.verification.checked} figures checked${ins.verification.unmatched.length ? `, ${ins.verification.unmatched.length} could not be traced (${ins.verification.unmatched.slice(0, 6).join(', ')})` : ', all traced'}.` : ''}</div>),
      ...dch.map((d, i) => B(`d${i}`, <div className="rp-defs">{d.map((x) => <div key={x.metric}><b>{x.label}</b> — {x.description}</div>)}</div>)),
    ] });
  }

  /* measure → paginate */
  const sig = JSON.stringify([data.id, data.sections.map((s) => s.id), !!ins, ins?.headline, aiLoading, lay]);
  const [measured, setMeasured] = useState<{ sig: string; hs: Heights } | null>(null);
  const measRef = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    if (measured?.sig === sig) return;
    let gone = false;
    (async () => {
      try { await document.fonts?.ready; } catch { /* */ }
      await new Promise((r) => setTimeout(r, 300));
      const el = measRef.current; if (gone || !el) return;
      const hs: Heights = {};
      el.querySelectorAll<HTMLElement>('[data-k]').forEach((w) => {
        const z = !w.dataset.k!.endsWith('/band') && w.scrollWidth > w.clientWidth + 2 ? w.clientWidth / w.scrollWidth : 1;
        hs[w.dataset.k!] = { h: w.getBoundingClientRect().height * z, z };
      });
      setMeasured({ sig, hs });
    })();
    return () => { gone = true; };
  }, [sig]); // eslint-disable-line react-hooks/exhaustive-deps

  const sheets = measured ? paginate(lps, measured.hs, GAP_MM[lay.density] * PX) : [];
  const firstPage: Record<string, number> = {};
  const offset = lay.pages.cover ? 1 : 0;
  sheets.forEach((sh, i) => { if (!(sh.lp in firstPage)) firstPage[sh.lp] = i + 1 + offset; });
  const total = sheets.length + offset;

  /* cover */
  const light = lay.cover !== 'gradient';
  const custom = data.request.kind === 'custom';
  const cover = lay.pages.cover && (
    <section className="a4 a4-bleed" data-page={1}><div className="a4-inner">
      <div className={clsx('rp-cover', lay.photos ? 'has-photo' : lay.cover)}>
        {lay.photos && <img className="rp-cover-bg" src={design?.cover_photo ? photoByKey(design.cover_photo) : coverPhotoFor(custom ? data.sections[0]?.id ?? 'cover' : 'cover')} alt="" />}
        {lay.photos && <div className="rp-cover-shade" />}
        {!lay.photos && lay.cover !== 'minimal' && <Ribbons />}
        {!lay.photos && lay.cover !== 'minimal' && <div className="rp-cover-57">57</div>}
        <div className="rp-cover-top"><Wordmark size={2} light={lay.photos || !light} /><div className="rp-cover-tag">{custom ? 'Custom report' : 'Executive performance report'}<br /><span>Confidential · {AUDIENCE[data.request.audience ?? ''] ?? 'senior management'}</span></div></div>
        <div className="rp-cover-mid">
          <div className="rp-cover-k">{lay.subtitle || (custom ? `${data.sections.filter((x) => x.id !== 'road').length} ${data.glance?.length ? 'sections' : `topic${data.sections.length > 2 ? 's' : ''}`} · ${data.request.depth ?? 'standard'} depth` : 'Studio performance review')}</div>
          <h1 className="rp-cover-title">{lay.title || (custom ? data.request.title || 'Custom report' : data.scope)}</h1>
          {(custom || lay.title) && <div className="rp-cover-scope">{data.scope}</div>}
          {custom && <div className="rp-cover-topics">{data.sections.map((x) => { const I = ICONS[x.icon] ?? LayoutGrid; return <span key={x.id}><I size={10} />{x.title}</span>; })}</div>}
          <div className="rp-cover-period">{P.label}</div>
          <div className="rp-cover-cmp">{fmtPeriod(P.start, 'day')} – {fmtPeriod(P.end, 'day')}{data.glance?.length ? '' : ` · benchmarked against ${P.prevLabel}, the ${P.ytdLabel} and ${P.lyLabel}`}</div>
        </div>
        <div className="rp-cover-quote"><Sparkles size={13} />{ins ? <p>{ins.headline}</p> : <div className="flex-1 opacity-60"><Pending lines={2} /></div>}</div>
        <div className="rp-cover-kpis">
          {(design?.cover_kpis?.length ? [...design.cover_kpis.map((id) => allKpis.get(id)).filter((k): k is Kpi => !!k), ...data.headline.filter((k) => !design.cover_kpis.includes(k.id))] : data.headline).slice(0, 4).map((k) => {
            const t = tone(k, k.chg);
            return (
              <div key={k.id} className="rp-cover-kpi">
                <div className="l">{k.label}</div><div className="v">{fmtK(k.value, k.format)}</div>
                {(k.chg !== null || k.chgLy !== null) && <div className={clsx('c', t > 0 ? 'good' : t < 0 ? 'bad' : '')}>{fmtDelta(k.chg, k.format)} <em>vs {L.prev}</em> · {fmtDelta(k.chgLy, k.format)} <em>vs {L.ly}</em></div>}
              </div>
            );
          })}
        </div>
        <div className="rp-cover-toc">{lps.map((lp) => <span key={lp.key}><em>{firstPage[lp.key] ? String(firstPage[lp.key]).padStart(2, '0') : '··'}</em>{lp.toc}</span>)}</div>
        <div className="rp-cover-foot"><span>{lay.photos ? `${BRAND.site} · ` : ''}{lay.preparedFor ? `Prepared for ${lay.preparedFor} · ` : 'Prepared '}{new Date(data.generatedAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' })}</span><span>Figures computed from the synced studio sheets · Prepared by Jimmeey G.</span></div>
      </div>
    </div></section>
  );

  const byKey = new Map(lps.map((lp) => [lp.key, lp]));
  return (
    <LayoutCtx.Provider value={lay}>
      <div className={clsx('report-paper', `cover-${lay.cover}`, lay.headingFont === 'sans' && 'h-sans')} style={paperVars(lay)}>
        {cover}
        {sheets.map((sh, i) => {
          const lp = byKey.get(sh.lp); if (!lp) return null;
          const blk = new Map(lp.blocks.map((b) => [b.key, b]));
          return (
            <Page key={`${sh.lp}-${sh.idx}`} n={i + 1 + offset} total={total} meta={meta} landscape={lp.landscape}>
              {sh.items.map((it) => {
                const node = it.key === '__cont' ? lp.cont : blk.get(it.key)?.node;
                return node ? <div key={it.key} className="rp-blk" style={it.zoom < 0.999 ? { zoom: it.zoom } : undefined}>{node}</div> : null;
              })}
              {sh.filler && lp.fill && lp.fill(sh.idx)}
              <div className="rp-fill-spacer" />
            </Page>
          );
        })}
        {!measured && <div className="rp-wait">Laying out pages…</div>}
        {measured?.sig !== sig && (
          <div ref={measRef} className="rp-measure" aria-hidden>
            {lps.filter((lp) => !lp.bleed).map((lp) => (
              <div key={lp.key} className={clsx('rp-measure-page', lp.landscape && 'l')}>
                {lp.blocks.map((b) => <div key={b.key} data-k={`${lp.key}/${b.key}`} className="rp-blk">{b.node}</div>)}
                {lp.cont && <div data-k={`${lp.key}/__cont`} className="rp-blk">{lp.cont}</div>}
              </div>
            ))}
          </div>
        )}
      </div>
    </LayoutCtx.Provider>
  );
}
