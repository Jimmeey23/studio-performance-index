/**
 * Executive report v2 — a board-level, A4-ready performance report for a
 * period and a set of studios. Every number is computed by the semantic
 * engine; each KPI is compared with the previous period (month), the
 * current-year monthly average and the same period last year. The AI layer
 * (insights.ts) only writes commentary on top of these results.
 */
import crypto from 'node:crypto';
import { z } from 'zod';
import { runMetricsQuery, type QueryResult } from '../semantic/engine.js';
import { backendFilters } from './backendAccounts.js';
import { metricById, modelById, DIMENSIONS } from '../semantic/metrics.js';
import { executeTool } from '../ai/tools.js';
import { planTopic, PlanSchema } from './topicPlanner.js';
import { leadRules } from '../warehouse/rules.js';
import { trainerScorecards, rankingTable, breakdownTable, contributionTable, conversionTable, mixTable, scoreChart, shareChart, revenueChart, excessChart, methodNotes, METHOD, trainerProfiles, trainerInsights, trainerHeadline, trainerAnswers, studioAnswer, WEIGHTS, type ScopeScore, type TrainerProfile } from '../analytics/trainerScore.js';
import { leadChannelReport, LEAD_METHOD } from '../analytics/leadChannels.js';
import type { AnalysisResult } from '../analytics/analyses.js';
import type { AnyResult } from '../analytics/analyses.js';

export const ReportRequestSchema = z.object({
  start: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  end: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  locations: z.array(z.string()).default([]),
  compare: z.enum(['previous_period', 'previous_year']).default('previous_period'),
  /** executive = the full management report; custom = only the chosen topics */
  kind: z.enum(['executive', 'custom']).default('executive'),
  topics: z.array(z.string()).default([]),
  title: z.string().max(140).optional(),
  audience: z.enum(['leadership', 'managers', 'sales', 'investors']).optional(),
  depth: z.enum(['summary', 'standard', 'detailed']).default('standard'),
  /** the reader's own topics in plain English; the plan is stored once made so rebuilds reuse it */
  briefs: z.array(z.object({ id: z.string().optional(), prompt: z.string().min(3).max(400), plan: z.any().optional() })).max(6).default([]),
  tier: z.enum(['fast', 'balanced', 'deep']).optional(),
});
/** Topics a custom report can cover — the executive sections plus deeper dives. */
export const TOPICS = [
  { id: 'sales', title: 'Sales', blurb: 'Revenue, transactions, pricing, product mix and payment methods.' },
  { id: 'new_clients', title: 'New Clients & Conversion', blurb: 'First visits, second visits, trial→paid conversion and early retention.' },
  { id: 'leads', title: 'Lead & Funnel Health', blurb: 'Lead volume, sources, trials, conversion, pipeline and ad efficiency.' },
  { id: 'trainers', title: 'Trainer Performance', blurb: 'Class average, fill, empty classes, yield and newcomer conversion by trainer.' },
  { id: 'classes', title: 'Class Performance & Booking Behaviour', blurb: 'Schedule productivity, fill heatmap, strongest and weakest classes.' },
  { id: 'formats', title: 'Format Comparison', blurb: 'Barre vs powerCycle vs Strength Lab — demand, fill, yield and cross-over.' },
  { id: 'churn', title: 'Lapsed & Membership Churn', blurb: 'Recurring memberships ending, renewals, lapses and value at stake.' },
  { id: 'late', title: 'Late Cancellation', blurb: 'Late-cancel rate, notice given, repeat cancellers and penalties.' },
  { id: 'studios', title: 'Studio Comparison', blurb: 'Every studio side by side — revenue, visits, fill, conversion and renewals.' },
  { id: 'associates', title: 'Sales Team Performance', blurb: 'Revenue, discounting, lead conversion and renewals by associate.' },
  { id: 'clients', title: 'Client Base & Engagement', blurb: 'Visiting and paying clients, visit frequency, retention and value per client.' },
  { id: 'lead_channels', title: 'Lead Channel & Source Analysis', blurb: 'Lead funnel by channel and source — leads → trials → purchasing members, LTV, studio × channel heatmap, then each studio with monthly trends.' },
  { id: 'trainer_ranking', title: 'Trainer Scorecard & Rankings', blurb: 'Composite trainer ranking (attendance, fill, fair conversion & retention, revenue; penalties for low experience and late cancels) — all studios, then each studio.' },
  { id: 'road', title: 'Road Ahead', blurb: 'Forecasts, renewals due, open pipeline and priorities for next month.' },
] as const;
export type ReportRequest = z.infer<typeof ReportRequestSchema>;

type Filter = { dimension: string; op: 'in' | 'not_in'; values: string[] };
const NOT_OTHER: Filter[] = [{ dimension: 'format', op: 'not_in', values: ['Other', '(blank)'] }];
export const FORMATS = ['Barre', 'powerCycle', 'Strength Lab'];

export interface Kpi {
  id: string; label: string; format: string; description: string; higherIsBetter?: boolean; additive: boolean;
  value: number | null;
  prev: number | null; chg: number | null;       // previous period (previous month for a monthly report)
  ytd: number | null; chgYtd: number | null;     // current-year monthly average (Jan → month before the period), scaled to the period length
  ly: number | null; chgLy: number | null;       // same period last year
  series: (number | null)[];                     // last 14 months, oldest → newest
}
export interface ReportChart { id: string; title: string; chart: 'bar' | 'line' | 'area' | 'stacked_bar' | 'pie' | 'horizontal_bar'; seriesBy?: string; y?: string[]; result: QueryResult; wide?: boolean }
export interface ReportTable { id: string; title: string; result: AnyResult; note?: string; style?: 'heat' | 'grouped' }
export interface ReportSection {
  /** custom topics: the reader's brief and planning notes */
  ask?: string; notes?: string[]; planSource?: 'ai' | 'rules'; definitions?: { term: string; text: string }[];
  /** rule-based actions for sections that aren't KPI driven (e.g. trainer rankings) */
  actions?: string[];
  /** question-led sections: the question, a data-backed one-line answer and supporting points (AI commentary refines them) */
  answer?: { question: string; headline: string; points: string[] };
  /** compact stat strip shown under the band (no comparisons) */
  stats?: { label: string; value: number | null; format: string; note?: string }[];
  /** short observations shown beside the stat strip */
  observations?: string[];
  id: string; title: string; kicker: string; icon: string; summary: string;
  kpis: Kpi[]; charts: ReportChart[]; tables: ReportTable[]; insights: string[];
  visuals?: {
    funnel?: { label: string; value: number | null; note?: string }[];
    funnel2?: { label: string; value: number | null; note?: string }[];
    heatmap?: { rows: string[]; cols: string[]; cells: Record<string, { fill: number | null; classes: number }> };
    formats?: { format: string; kpis: Kpi[] }[];
    spotlight?: { name: string; classes: number; checkins: number; avg: number | null; fill: number | null }[];
    forecasts?: { label: string; metric: string; format: string; month: string; value: number | null; lo: number | null; hi: number | null; method?: string }[];
    pipeline?: { label: string; value: number | null; format: string; note: string }[];
    strict?: Record<string, number>;
    trainers?: TrainerProfile[];
  };
}
export interface Report {
  id: string; generatedAt: string; request: ReportRequest;
  period: { start: string; end: string; label: string; days: number; months: number; prevStart?: string; prevEnd?: string; prevLabel: string; lyStart?: string; lyEnd?: string; lyLabel: string; ytdStart?: string; ytdEnd?: string; ytdLabel: string; ytdMonths: number; compareLabel: string; seriesLabels: string[] };
  scope: string; headline: Kpi[]; scorecard: Kpi[]; studios?: ReportTable; sections: ReportSection[];
  /** question-led reports: each question with the section that answers it */
  glance?: { q: string; a: string; section: string }[];
  /** studio scorecard / summary tables shown on the executive summary page */
  summaryTables?: ReportTable[];
  appendix: { mom: ReportTable; definitions: { metric: string; label: string; description: string }[] };
  autoInsights: { highlights: string[]; concerns: string[]; recommendations: { title: string; detail: string; priority: 'high' | 'medium' | 'low'; kpi: string }[] };
  results: AnyResult[];
}

const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const d = (s: string) => new Date(s + 'T00:00:00Z');
const iso = (x: Date) => x.toISOString().slice(0, 10);
const fmtDay = (s: string) => { const x = d(s); return `${x.getUTCDate()} ${MON[x.getUTCMonth()]} ${x.getUTCFullYear()}`; };
const monLabel = (s: string) => { const x = d(s); return `${MON[x.getUTCMonth()]}-${x.getUTCFullYear()}`; };
const isWholeMonths = (start: string, end: string) => { const s = d(start), e = d(end); return s.getUTCDate() === 1 && new Date(Date.UTC(e.getUTCFullYear(), e.getUTCMonth() + 1, 0)).getUTCDate() === e.getUTCDate(); };
function periodLabel(start: string, end: string) {
  const s = d(start), e = d(end);
  if (isWholeMonths(start, end) && s.getUTCFullYear() === e.getUTCFullYear() && s.getUTCMonth() === e.getUTCMonth()) return monLabel(start);
  if (isWholeMonths(start, end)) return `${monLabel(start)} – ${monLabel(end)}`;
  return `${fmtDay(start)} – ${fmtDay(end)}`;
}
const lastCompleteMonthEnd = () => { const n = new Date(Date.now() + 5.5 * 3600e3); return iso(new Date(Date.UTC(n.getUTCFullYear(), n.getUTCMonth(), 0))); };

/** Location filter only for metrics whose model has a location dimension; extra filters only where the dimension exists. */
function filtersFor(metrics: string[], req: ReportRequest, extra: Filter[] = []): Filter[] {
  const has = (dim: string) => metrics.every((m) => { const mt = metricById.get(m); return mt && modelById.get(mt.model)?.dims[dim]; });
  return [...(req.locations.length && has('location') ? [{ dimension: 'location', op: 'in' as const, values: req.locations }] : []), ...extra.filter((x) => has(x.dimension))];
}

interface Ctx { req: ReportRequest; ytd: { start: string; end: string; months: number } | null; periodMonths: number; series: { start: string; end: string; months: string[] }; results: AnyResult[] }

async function kpis(ctx: Ctx, metrics: string[], extra: Filter[] = []): Promise<Kpi[]> {
  const { req } = ctx;
  const valid = metrics.filter((m) => metricById.has(m));
  const groups = new Map<string, string[]>();
  for (const m of valid) { const model = metricById.get(m)!.model; groups.set(model, [...(groups.get(model) ?? []), m]); }
  const out = new Map<string, Kpi>();
  const n = (v: unknown) => (v === null || v === undefined || !isFinite(Number(v)) ? null : Number(v));
  for (const ms of groups.values()) {
    const f = filtersFor(ms, req, extra);
    const [pp, ly, ytd, ser] = await Promise.all([
      runMetricsQuery({ metrics: ms, start: req.start, end: req.end, compare: 'previous_period', filters: f }),
      runMetricsQuery({ metrics: ms, start: req.start, end: req.end, compare: 'previous_year', filters: f }),
      ctx.ytd ? runMetricsQuery({ metrics: ms, grain: 'month', start: ctx.ytd.start, end: ctx.ytd.end, filters: f }) : Promise.resolve(null),
      runMetricsQuery({ metrics: ms, grain: 'month', start: ctx.series.start, end: ctx.series.end, filters: f }),
    ]);
    ctx.results.push(pp, ly, ser); if (ytd) ctx.results.push(ytd);
    const a = pp.rows[0] ?? {}, b = ly.rows[0] ?? {};
    const byMonth = new Map(ser.rows.map((r) => [String(r.period).slice(0, 7), r]));
    for (const m of ms) {
      const mt = metricById.get(m)!;
      const value = n(a[m]);
      // current-year baseline = mean of the monthly values Jan → month before the period (volumes scaled to the period length)
      const mv = (ytd?.rows ?? []).map((r) => n(r[m])).filter((x): x is number => x !== null);
      let yv = mv.length ? mv.reduce((p, q) => p + q, 0) / mv.length : null;
      if (yv !== null && mt.additive) yv *= ctx.periodMonths;
      const chgYtd = value === null || yv === null ? null : mt.format === 'percent' ? value - yv : yv ? (value - yv) / Math.abs(yv) : null;
      out.set(m, {
        id: m, label: mt.label, format: mt.format, description: mt.description, higherIsBetter: mt.higherIsBetter, additive: !!mt.additive,
        value, prev: n(a[`${m}__prev`]), chg: n(a[`${m}__chg`]), ly: n(b[`${m}__prev`]), chgLy: n(b[`${m}__chg`]), ytd: yv, chgYtd,
        series: ctx.series.months.map((mo) => n(byMonth.get(mo)?.[m])),
      });
    }
  }
  return valid.map((m) => out.get(m)!).filter(Boolean);
}

let seq = 0;
const uid = (p: string) => `${p}${++seq}`;

async function trend(ctx: Ctx, title: string, metrics: string[], o: { chart?: ReportChart['chart']; dimension?: string; compare?: boolean; extra?: Filter[]; y?: string[]; wide?: boolean } = {}): Promise<ReportChart> {
  const r = await runMetricsQuery({ metrics, grain: 'month', start: ctx.series.start, end: ctx.series.end, dimensions: o.dimension ? [o.dimension] : [], compare: o.compare ? 'previous_year' : null, filters: filtersFor(metrics, ctx.req, o.extra) });
  r.title = title; ctx.results.push(r);
  return { id: uid('c'), title, chart: o.chart ?? 'bar', seriesBy: o.dimension, y: o.y ?? (o.compare ? [metrics[0], `${metrics[0]}__prev`] : metrics), result: r, wide: o.wide };
}
async function mix(ctx: Ctx, title: string, metric: string, dim: string, extra: Filter[] = []): Promise<ReportChart> {
  const r = await runMetricsQuery({ metrics: [metric], dimensions: [dim], start: ctx.req.start, end: ctx.req.end, filters: [...filtersFor([metric], ctx.req, extra), { dimension: dim, op: 'not_in', values: ['(blank)'] }, ...backendFilters([dim])] as never, sort: { by: metric, dir: 'desc' }, limit: 8 });
  r.title = title; ctx.results.push(r);
  return { id: uid('c'), title, chart: 'pie', result: r };
}
async function table(ctx: Ctx, title: string, metrics: string[], dims: string[], o: { limit?: number; sort?: string; dir?: 'asc' | 'desc'; extra?: Filter[]; post?: (rows: Record<string, unknown>[]) => Record<string, unknown>[]; compare?: boolean; note?: string } = {}): Promise<ReportTable> {
  const r = await runMetricsQuery({ metrics, dimensions: dims, start: ctx.req.start, end: ctx.req.end, compare: o.compare === false ? null : 'previous_period',
    filters: [...filtersFor(metrics, ctx.req, o.extra), ...dims.filter((x) => !['location', 'format'].includes(x)).map((x) => ({ dimension: x, op: 'not_in' as const, values: ['(blank)'] })), ...backendFilters(dims)] as never,
    sort: { by: o.sort ?? metrics[0], dir: o.dir ?? 'desc' }, limit: o.post ? 400 : o.limit ?? 10 });
  if (o.post) { r.rows = o.post(r.rows).slice(0, o.limit ?? 10); r.rowCount = r.rows.length; r.totals = undefined; }
  r.title = title; ctx.results.push(r);
  return { id: uid('t'), title, result: r, note: o.note };
}

/* ── formatting + rule-based commentary (always available) ── */
export function fmtVal(v: number | null | undefined, f: string): string {
  if (v === null || v === undefined || !isFinite(v)) return '—';
  const a = Math.abs(v);
  switch (f) {
    case 'currency': return a >= 1e7 ? `₹${(v / 1e7).toFixed(2)}Cr` : a >= 1e5 ? `₹${(v / 1e5).toFixed(1)}L` : `₹${Math.round(v).toLocaleString('en-IN')}`;
    case 'percent': return `${(v * 100).toFixed(1)}%`;
    case 'decimal': return v.toFixed(2);
    case 'days': return `${v.toFixed(1)} days`;
    default: return Number.isInteger(v) ? v.toLocaleString('en-IN') : v.toFixed(1);
  }
}
export function fmtChg(k: Kpi, which: 'chg' | 'chgLy' | 'chgYtd' = 'chg'): string {
  const c = k[which];
  if (c === null) return 'n/a';
  return k.format === 'percent' ? `${c > 0 ? '+' : ''}${(c * 100).toFixed(1)} pp` : `${c > 0 ? '+' : ''}${(c * 100).toFixed(1)}%`;
}
const dir = (k: Kpi, c: number | null) => (c === null || k.higherIsBetter === undefined || c === 0 ? 0 : (c > 0) === k.higherIsBetter ? 1 : -1);
const score = (k: Kpi) => (k.chg === null || k.higherIsBetter === undefined ? 0 : (k.higherIsBetter ? 1 : -1) * (k.format === 'percent' ? k.chg * 4 : k.chg));
function sectionInsights(s: { kpis: Kpi[]; tables: ReportTable[] }, P: Report['period']): string[] {
  const out: string[] = [];
  const movers = s.kpis.filter((k) => k.chg !== null && k.value !== null && k.higherIsBetter !== undefined).sort((a, b) => Math.abs(score(b)) - Math.abs(score(a))).slice(0, 3);
  for (const k of movers) {
    const parts = [`${fmtChg(k)} vs ${P.prevLabel}`]; if (k.chgYtd !== null) parts.push(`${fmtChg(k, 'chgYtd')} vs ${P.ytdLabel}`); if (k.chgLy !== null) parts.push(`${fmtChg(k, 'chgLy')} vs ${P.lyLabel}`);
    out.push(`${k.label} ${score(k) > 0 ? 'improved' : 'weakened'} to ${fmtVal(k.value, k.format)} (${parts.join('; ')}).`);
  }
  const consistent = s.kpis.filter((k) => [k.chg, k.chgYtd, k.chgLy].every((c) => c !== null && dir(k, c) === dir(k, k.chg) && dir(k, c) !== 0));
  if (consistent.length) out.push(`Consistent ${dir(consistent[0], consistent[0].chg) > 0 ? 'outperformance' : 'underperformance'} on all three comparisons: ${consistent.slice(0, 3).map((k) => k.label.toLowerCase()).join(', ')}.`);
  const t = s.tables[0];
  if (t && t.result.rows.length > 1) {
    const c = t.result.columns.find((x) => x.kind === 'metric'); const dm = t.result.columns.find((x) => x.kind === 'dimension');
    if (c && dm) { const tot = t.result.rows.reduce((a, r) => a + (Number(r[c.key]) || 0), 0); const top = t.result.rows[0]; const add = metricById.get(c.key)?.additive;
      out.push(`Largest ${(dm.label ?? '').toLowerCase()}: ${top[dm.key] ?? '(blank)'} at ${fmtVal(Number(top[c.key]), c.format ?? 'number')}${add && tot ? ` (${((Number(top[c.key]) / tot) * 100).toFixed(0)}% of the top ${t.result.rows.length})` : ''}.`); }
  }
  return out;
}
const PLAYBOOK: Record<string, string> = {
  revenue: 'Run a renewal-window upsell push (3-month → 6-month / annual) and review top products by studio.',
  atv: 'Shift mix towards unlimited / longer memberships and tighten discount approvals.',
  discount_rate: 'Audit discount codes by associate and cap ad-hoc discounts.',
  paying_clients: 'Target lapsed and expired clients with a win-back offer and associate call lists.',
  visiting_clients: 'Re-engage inactive members with habit nudges and class recommendations.',
  paying_visiting_clients: 'Convert complimentary / trial visitors to paid with time-boxed intro offers.',
  visits_per_client: 'Introduce visit-milestone recognition and booking reminders for clients whose frequency drops.',
  conversion_rate: 'Book the second class before newcomers leave and follow up within 48 hours of a first visit.',
  second_visit_rate: 'Tighten the newcomer follow-up sequence and allocate strong converters to newcomer-heavy slots.',
  lead_conversion_rate: 'Review speed-to-lead and follow-up cadence by associate; prioritise high-converting sources.',
  lead_to_trial_rate: 'Tighten trial-booking scripts and call new leads within the hour.',
  leads: 'Rebalance marketing spend towards channels with the best cost per member.',
  sheet_renewal_rate: 'Start renewal outreach 14 days before expiry with an associate owner per member.',
  churn_rate: 'Offer freezes / save offers before expiry and prioritise high-value lapses for win-back.',
  fill_rate: 'Merge or reschedule chronic under-filling classes and add capacity where classes sell out.',
  class_average: 'Move strong-draw trainers and formats into weak slots; review the schedule by hour and weekday.',
  empty_class_rate: 'Remove or re-time recurring classes that repeatedly run empty.',
  late_cancel_rate: 'Enforce the late-cancel policy consistently and send reminders before the cut-off.',
  new_clients: 'Increase trial supply: referral incentives, partner sign-up links and intro offers in weak studios.',
};

export async function buildReport(raw: unknown): Promise<Report> {
  const req = ReportRequestSchema.parse(raw);
  const results: AnyResult[] = [];
  const days = Math.round((d(req.end).getTime() - d(req.start).getTime()) / 864e5) + 1;
  const periodMonths = Math.max(1, Math.round(days / 30.44));
  // current-year baseline: Jan 1 → day before the period (monthly average)
  const s0 = d(req.start);
  const ytdStart = `${s0.getUTCFullYear()}-01-01`;
  const ytdEnd = iso(new Date(s0.getTime() - 864e5));
  const ytdMonths = s0.getUTCMonth() + (s0.getUTCDate() > 1 ? 1 : 0);
  const ytd = ytdEnd >= ytdStart && ytdMonths > 0 ? { start: ytdStart, end: ytdEnd, months: ytdMonths } : null;
  // 14-month series window ending with the report's last month (capped at the last complete month)
  const capEnd = req.end < lastCompleteMonthEnd() ? req.end : lastCompleteMonthEnd();
  const ce = d(capEnd);
  const seriesEnd = iso(new Date(Date.UTC(ce.getUTCFullYear(), ce.getUTCMonth() + 1, 0))) > capEnd && !isWholeMonths(iso(new Date(Date.UTC(ce.getUTCFullYear(), ce.getUTCMonth(), 1))), capEnd) ? iso(new Date(Date.UTC(ce.getUTCFullYear(), ce.getUTCMonth(), 0))) : capEnd;
  const se = d(seriesEnd);
  const seriesStart = iso(new Date(Date.UTC(se.getUTCFullYear(), se.getUTCMonth() - 13, 1)));
  const months = Array.from({ length: 14 }, (_, i) => iso(new Date(Date.UTC(se.getUTCFullYear(), se.getUTCMonth() - 13 + i, 1))).slice(0, 7));
  const ctx: Ctx = { req, ytd, periodMonths, series: { start: seriesStart, end: seriesEnd, months }, results };

  let head = await kpis(ctx, ['revenue', 'paying_visiting_clients', 'visiting_clients', 'visits', 'new_clients', 'conversion_rate', 'fill_rate', 'sheet_renewal_rate']);
  let scorecard = await kpis(ctx, ['revenue', 'net_revenue', 'transactions', 'atv', 'paying_clients', 'discount_rate', 'visits', 'visiting_clients', 'paying_visiting_clients', 'visits_per_client',
    'leads', 'lead_to_trial_rate', 'lead_conversion_rate', 'new_clients', 'second_visit_rate', 'conversion_rate', 'retention_rate', 'classes', 'fill_rate', 'class_average', 'empty_class_rate', 'revenue_per_attendee',
    'memberships_expiring', 'sheet_renewal_rate', 'churn_rate', 'lapsed_value', 'late_cancel_rate']);

  const sections: ReportSection[] = [];
  const P0 = (results[0] as QueryResult).period, P1 = (results[1] as QueryResult).period;
  const wholeMonth = isWholeMonths(req.start, req.end) && periodMonths === 1;
  const period: Report['period'] = {
    start: req.start, end: req.end, label: periodLabel(req.start, req.end), days, months: periodMonths,
    prevStart: P0.comparisonStart, prevEnd: P0.comparisonEnd, prevLabel: P0.comparisonStart && P0.comparisonEnd ? (wholeMonth ? monLabel(P0.comparisonStart) : periodLabel(P0.comparisonStart, P0.comparisonEnd)) : 'previous period',
    lyStart: P1.comparisonStart, lyEnd: P1.comparisonEnd, lyLabel: P1.comparisonStart && P1.comparisonEnd ? (wholeMonth ? monLabel(P1.comparisonStart) : periodLabel(P1.comparisonStart, P1.comparisonEnd)) : 'last year',
    ytdStart: ytd?.start, ytdEnd: ytd?.end, ytdMonths, ytdLabel: ytd ? `${s0.getUTCFullYear()} avg (${MON[0]}${ytdMonths > 1 ? `–${MON[ytdMonths - 1]}` : ''})` : 'YTD avg',
    compareLabel: wholeMonth ? 'the previous month' : 'the previous period', seriesLabels: months.map((m) => monLabel(`${m}-01`)),
  };
  const add = async (s: Omit<ReportSection, 'insights' | 'kpis'> & { kpiIds: string[]; kpiExtra?: Filter[] }) => {
    let k = await kpis(ctx, s.kpiIds, s.kpiExtra);
    // KPIs computed on a filtered base (e.g. the three core formats) must not pose as the studio-wide figure
    // shown on other pages under the same name
    if (s.kpiExtra?.some((f) => f.dimension === 'format')) k = k.map((x) => ({ ...x, label: `${x.label} · core formats`, description: `${x.description} Barre, powerCycle and Strength Lab classes only.` }));
    const { kpiIds: _a, kpiExtra: _b, ...rest } = s;
    sections.push({ ...rest, kpis: k, insights: sectionInsights({ kpis: k, tables: s.tables }, period) });
  };
  const L = req.locations.length ? { locations: req.locations } : {};
  const custom = req.kind === 'custom';
  const want = (id: string) => !custom || req.topics.includes(id);
  const rowsN = (n: number) => (req.depth === 'detailed' ? Math.round(n * 1.5) : req.depth === 'summary' ? Math.min(n, 6) : n);
  /** Tables that may not suit every data model are best-effort in custom topics. */
  const safe = async (p: Promise<ReportTable>) => { try { return [await p]; } catch { return []; } };
  const safeChart = async (p: Promise<ReportChart>) => { try { return [await p]; } catch { return []; } };
  let secNo = 0;
  const kick = () => `Section ${String(++secNo).padStart(2, '0')}`;

  if (want('sales')) {
  /* 1 · Sales */
  await add({ id: 'sales', kicker: kick(), title: 'Sales', icon: 'IndianRupee', summary: 'Cash collected, transactions, pricing, product mix and associate performance.',
    kpiIds: ['revenue', 'net_revenue', 'transactions', 'paying_clients', 'atv', 'revenue_per_client', 'membership_rev_share', 'discount_rate'],
    charts: [await trend(ctx, 'Revenue — 14 months vs last year', ['revenue'], { compare: true, wide: true }), await mix(ctx, 'Revenue mix by product family', 'revenue', 'product_family')],
    tables: [await table(ctx, 'Product families', ['revenue', 'transactions', 'atv'], ['product_family'], { limit: 8 }),
      await table(ctx, 'Top products', ['revenue', 'units_sold', 'atv'], ['product'], { limit: 10 }),
      await table(ctx, 'Sales associates', ['revenue', 'transactions', 'atv', 'discount_rate'], ['sold_by'], { limit: 8 }),
      await table(ctx, 'Payment methods', ['revenue', 'transactions'], ['payment_method'], { limit: 6 })] });

  }

  if (want('new_clients')) {
  /* 2 · New clients & conversion */
  const nc = await kpis(ctx, ['new_clients', 'second_visit_rate', 'converted_clients', 'retained_clients']);
  const v = (id: string) => nc.find((k) => k.id === id)?.value ?? null;
  await add({ id: 'new_clients', kicker: kick(), title: 'New Clients & Conversion', icon: 'UserPlus', summary: 'First visits, the second visit, trial→paid conversion, speed to convert and early value.',
    kpiIds: ['new_clients', 'second_visit_rate', 'zero_return_rate', 'conversion_rate', 'retention_rate', 'avg_days_to_convert', 'avg_first_purchase', 'new_client_avg_ltv'],
    charts: [await trend(ctx, 'New clients — 14 months vs last year', ['new_clients'], { compare: true }), await trend(ctx, 'Second-visit and trial→paid conversion — 14 months', ['second_visit_rate', 'conversion_rate'], { chart: 'line' })],
    tables: [await table(ctx, 'Trial products', ['new_clients', 'second_visit_rate', 'conversion_rate', 'retention_rate'], ['trial_product'], { limit: 8 }),
      await table(ctx, 'First-visit format', ['new_clients', 'second_visit_rate', 'conversion_rate', 'retention_rate'], ['format'], { extra: NOT_OTHER, limit: 4 }),
      await table(ctx, 'First-visit time of day', ['new_clients', 'conversion_rate'], ['prime_time'], { limit: 2 })],
    visuals: { funnel: [
      { label: 'First visits', value: v('new_clients') },
      { label: 'Came back for a 2nd visit', value: v('new_clients') !== null && v('second_visit_rate') !== null ? Math.round(v('new_clients')! * v('second_visit_rate')!) : null },
      { label: 'Converted to paid', value: v('converted_clients') },
      { label: 'Retained', value: v('retained_clients') },
    ] } });

  }

  if (want('leads')) {
  /* 3 · Lead & funnel health */
  const lk = await kpis(ctx, ['leads', 'lead_trials', 'lead_conversions']);
  const lv = (id: string) => lk.find((k) => k.id === id)?.value ?? null;
  await add({ id: 'leads', kicker: kick(), title: 'Lead & Funnel Health', icon: 'Megaphone', summary: 'Lead volume and quality, trial booking, lead conversion, pipeline hygiene and paid-media efficiency.',
    kpiIds: ['leads', 'lead_trials', 'lead_to_trial_rate', 'lead_conversions', 'lead_conversion_rate', 'open_leads', 'ad_spend', 'meta_spend', 'google_ads_spend', 'cost_per_lead'],
    charts: [await trend(ctx, 'Leads by channel — 14 months', ['leads'], { chart: 'stacked_bar', dimension: 'channel' }), await mix(ctx, 'Lead mix by channel', 'leads', 'channel')],
    tables: [await table(ctx, 'Lead sources', ['leads', 'lead_trials', 'lead_conversions', 'lead_conversion_rate'], ['source'], { limit: 10 }),
      await table(ctx, 'Lead owners (associates)', ['leads', 'lead_trials', 'lead_conversions', 'lead_conversion_rate'], ['associate'], { limit: 8 }),
      await table(ctx, 'Pipeline by stage', ['leads'], ['stage'], { limit: 8 })],
    visuals: { funnel: [{ label: 'Leads', value: lv('leads') }, { label: 'Trials completed', value: lv('lead_trials') }, { label: 'Converted to members', value: lv('lead_conversions') }] } });

  }

  if (want('trainers')) {
  /* 4 · Trainer performance */
  const lb = await table(ctx, 'Trainer leaderboard', ['classes', 'class_checkins', 'class_average', 'fill_rate', 'empty_class_rate', 'revenue_per_class'], ['teacher'], { sort: 'class_checkins', limit: 14 });
  const spot = await runMetricsQuery({ metrics: ['classes', 'class_checkins', 'class_average', 'fill_rate'], dimensions: ['teacher'], start: req.start, end: req.end, filters: [...filtersFor(['classes'], req), { dimension: 'teacher', op: 'not_in', values: ['(blank)'] }], limit: 400 });
  results.push(spot);
  const spotlight = spot.rows.filter((r) => Number(r.classes) >= Math.max(4, 2 * periodMonths)).sort((a, b) => Number(b.class_average) - Number(a.class_average)).slice(0, 3)
    .map((r) => ({ name: String(r.teacher), classes: Number(r.classes), checkins: Number(r.class_checkins), avg: r.class_average === null ? null : Number(r.class_average), fill: r.fill_rate === null ? null : Number(r.fill_rate) }));
  await add({ id: 'trainers', kicker: kick(), title: 'Trainer Performance', icon: 'GraduationCap', summary: 'Classes taught, draw (class average), fill, empty classes, yield and newcomer conversion by trainer.',
    kpiIds: ['session_teachers', 'classes_per_teacher', 'class_average', 'fill_rate', 'empty_class_rate', 'revenue_per_class'],
    charts: [],
    tables: [lb,
      await table(ctx, 'Newcomer conversion by first-visit trainer (≥ 5 new clients)', ['new_clients', 'second_visit_rate', 'conversion_rate', 'retention_rate'], ['teacher'], { compare: false, limit: 10, post: (rows) => rows.filter((r) => Number(r.new_clients) >= 5).sort((x, y) => Number(y.conversion_rate) - Number(x.conversion_rate)) }),
      await table(ctx, 'Trainer × format', ['classes', 'class_average', 'fill_rate'], ['format', 'teacher'], { extra: NOT_OTHER, compare: false, sort: 'classes', limit: 12 })],
    visuals: { spotlight } });

  }

  const stripLoc = (rows: Record<string, unknown>[]) => req.locations.length === 1 ? rows.map((r) => ({ ...r, recurring_class: String(r.recurring_class ?? '').replace(`${req.locations[0]} · `, '').replace(/^Studio /, '') })) : rows;
  if (want('classes')) {
  /* 5 · Class performance & booking behaviour */
  const hm = await runMetricsQuery({ metrics: ['fill_rate', 'classes'], dimensions: ['day_of_week', 'hour'], start: req.start, end: req.end, filters: filtersFor(['fill_rate'], req) });
  results.push(hm);
  const dows = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
  const hours = [...new Set(hm.rows.map((r) => String(r.hour)))].filter((h) => h !== 'null').sort();
  const cells: Record<string, { fill: number | null; classes: number }> = {};
  for (const r of hm.rows) cells[`${r.day_of_week}|${r.hour}`] = { fill: r.fill_rate === null ? null : Number(r.fill_rate), classes: Number(r.classes) };
  await add({ id: 'classes', kicker: kick(), title: 'Class Performance & Booking Behaviour', icon: 'CalendarRange', summary: 'Schedule productivity and how clients book, show up and visit — fill, class size, empty classes, show-up and frequency.',
    kpiIds: ['classes', 'class_checkins', 'fill_rate', 'booking_fill_rate', 'class_show_up_rate', 'class_average', 'sold_out_rate', 'empty_class_rate', 'visits', 'visits_per_client', 'paying_visiting_clients', 'visiting_clients'],
    charts: [await trend(ctx, 'Fill rate and booking fill — 14 months', ['fill_rate', 'booking_fill_rate'], { chart: 'line' }), await trend(ctx, 'Visiting clients — paying vs total, 14 months', ['paying_visiting_clients', 'visiting_clients'], { chart: 'line' })],
    tables: [await table(ctx, 'Strongest recurring classes (≥ 4 sessions)', ['classes', 'fill_rate', 'class_average'], ['recurring_class'], { compare: false, limit: 8, post: (rows) => stripLoc(rows.filter((r) => Number(r.classes) >= 4).sort((a, b) => Number(b.fill_rate) - Number(a.fill_rate))) }),
      await table(ctx, 'Weakest recurring classes (≥ 4 sessions)', ['classes', 'fill_rate', 'class_average'], ['recurring_class'], { compare: false, limit: 8, post: (rows) => stripLoc(rows.filter((r) => Number(r.classes) >= 4).sort((a, b) => Number(a.fill_rate) - Number(b.fill_rate))) }),
      await table(ctx, 'Weekday vs weekend', ['classes', 'fill_rate', 'class_average', 'class_late_cancel_rate'], ['weekpart'], { limit: 2 }),
      await table(ctx, 'Room size', ['classes', 'avg_capacity', 'fill_rate', 'class_average'], ['room_size'], { limit: 3 })],
    visuals: { heatmap: { rows: dows.filter((x) => hours.some((h) => cells[`${x}|${h}`])), cols: hours, cells } } });

  }

  if (want('formats')) {
  /* 6 · Format comparison */
  const fmtIds = ['classes', 'class_checkins', 'fill_rate', 'class_average', 'sold_out_rate', 'revenue_per_attendee', 'empty_class_rate', 'visiting_clients', 'new_clients', 'conversion_rate'];
  const formats = [] as { format: string; kpis: Kpi[] }[];
  for (const f of FORMATS) formats.push({ format: f, kpis: await kpis(ctx, fmtIds, [{ dimension: 'format', op: 'in', values: [f] }]) });
  const ov = await executeTool('format_overlap', { start: req.start, end: req.end, mode: 'segments', ...L }).catch(() => ({ result: undefined }));
  const ovm = await executeTool('format_overlap', { start: req.start, end: req.end, mode: 'matrix', ...L }).catch(() => ({ result: undefined }));
  await add({ id: 'formats', kicker: kick(), title: 'Format Comparison', icon: 'Shapes', summary: 'Barre vs powerCycle vs Strength Lab — demand, fill, yield, newcomers and client cross-over.',
    kpiIds: ['class_checkins', 'fill_rate', 'class_average', 'revenue_per_attendee'], kpiExtra: NOT_OTHER,
    charts: [await trend(ctx, 'Check-ins by format — 14 months', ['class_checkins'], { chart: 'stacked_bar', dimension: 'format', extra: NOT_OTHER }), await trend(ctx, 'Fill rate by format — 14 months', ['fill_rate'], { chart: 'line', dimension: 'format', extra: NOT_OTHER })],
    tables: [...(ov.result ? [{ id: uid('t'), title: 'Client format mix', result: ov.result }] : []), ...(ovm.result ? [{ id: uid('t'), title: 'Format cross-over', result: ovm.result }] : []),
      await table(ctx, 'Sub-formats', ['classes', 'class_checkins', 'fill_rate', 'class_average'], ['class_name'], { extra: NOT_OTHER, limit: 10 })],
    visuals: { formats } });
  if (ov.result) results.push(ov.result); if (ovm.result) results.push(ovm.result);

  }

  if (want('churn')) {
  /* 7 · Lapsed & membership churn */
  const ren = await executeTool('renewal_analysis', { start: req.start, end: req.end, group_by: 'none', ...L }).catch(() => ({ result: undefined }));
  if (ren.result) results.push(ren.result);
  await add({ id: 'churn', kicker: kick(), title: 'Lapsed & Membership Churn', icon: 'UserMinus', summary: 'Recurring memberships ending in the period — renewals, lapses and value at stake (zero-value and non-recurring memberships excluded).',
    kpiIds: ['memberships_expiring', 'memberships_renewed_flag', 'lapsed_memberships', 'memberships_other_status', 'sheet_renewal_rate', 'churn_rate', 'lapsed_value', 'expiring_value', 'members_expiring'],
    charts: [await trend(ctx, 'Renewal vs churn rate — 14 months', ['sheet_renewal_rate', 'churn_rate'], { chart: 'line' }), await trend(ctx, 'Lapsed vs renewed memberships — 14 months', ['lapsed_memberships', 'memberships_renewed_flag'], { chart: 'stacked_bar' })],
    tables: [await table(ctx, 'By membership', ['memberships_expiring', 'sheet_renewal_rate', 'churn_rate', 'lapsed_value'], ['membership'], { limit: 10 }),
      await table(ctx, 'By product family', ['memberships_expiring', 'sheet_renewal_rate', 'lapsed_value'], ['product_family'], { limit: 6 }),
      await table(ctx, 'By seller', ['memberships_expiring', 'sheet_renewal_rate', 'lapsed_value'], ['sold_by'], { limit: 8 })],
    visuals: { strict: ren.result?.totals as Record<string, number> | undefined } });

  }

  if (want('late')) {
  /* 8 · Late cancellation */
  await add({ id: 'late', kicker: kick(), title: 'Late Cancellation', icon: 'CalendarX', summary: 'Late-cancel volume and rate, notice given, repeat cancellers and penalties.',
    kpiIds: ['bookings', 'late_cancellations', 'late_cancel_rate', 'late_cancel_clients', 'late_cancel_penalties', 'avg_notice_hours'],
    charts: [await trend(ctx, 'Late-cancel rate — 14 months', ['late_cancel_rate'], { chart: 'line' }), await mix(ctx, 'Notice given', 'late_cancel_events', 'notice')],
    tables: [await table(ctx, 'By weekday', ['bookings', 'late_cancellations', 'late_cancel_rate'], ['day_of_week'], { limit: 7, sort: 'late_cancel_rate' }),
      await table(ctx, 'By membership', ['late_cancel_events', 'late_cancel_clients', 'late_cancel_penalties'], ['membership'], { limit: 8 }),
      await table(ctx, 'By class', ['bookings', 'late_cancellations', 'late_cancel_rate'], ['class_name'], { limit: 8, sort: 'late_cancellations' })] });

  }

  /* deeper-dive topics (custom reports) */
  if (custom && want('studios')) {
    await add({ id: 'studios', kicker: kick(), title: 'Studio Comparison', icon: 'Building2', summary: 'Every studio side by side — revenue, visits, fill, conversion and renewals.',
      kpiIds: ['revenue', 'visits', 'visiting_clients', 'new_clients', 'fill_rate', 'conversion_rate', 'sheet_renewal_rate', 'class_average'],
      charts: [...await safeChart(trend(ctx, 'Revenue by studio — 14 months', ['revenue'], { chart: 'stacked_bar', dimension: 'location', wide: true })), ...await safeChart(mix(ctx, 'Revenue share by studio', 'revenue', 'location'))],
      tables: [...await safe(table(ctx, 'Studio sales', ['revenue', 'transactions', 'atv', 'discount_rate'], ['location'], { limit: rowsN(10) })),
        ...await safe(table(ctx, 'Studio attendance', ['visits', 'visiting_clients', 'visits_per_client', 'fill_rate'], ['location'], { limit: rowsN(10) })),
        ...await safe(table(ctx, 'Studio growth & retention', ['new_clients', 'conversion_rate', 'sheet_renewal_rate', 'late_cancel_rate'], ['location'], { limit: rowsN(10) })),
        ...await safe(table(ctx, 'Studio × format', ['classes', 'fill_rate', 'class_average'], ['location', 'format'], { extra: NOT_OTHER, compare: false, sort: 'classes', limit: rowsN(12) }))] });
  }
  if (custom && want('associates')) {
    await add({ id: 'associates', kicker: kick(), title: 'Sales Team Performance', icon: 'Users', summary: 'Revenue, discounting, lead conversion and renewals by associate.',
      kpiIds: ['revenue', 'transactions', 'atv', 'discount_rate', 'leads', 'lead_conversions', 'lead_conversion_rate', 'sheet_renewal_rate'],
      charts: [...await safeChart(mix(ctx, 'Revenue by associate', 'revenue', 'sold_by')), ...await safeChart(trend(ctx, 'Lead conversions — 14 months vs last year', ['lead_conversions'], { compare: true }))],
      tables: [...await safe(table(ctx, 'Sales by associate', ['revenue', 'transactions', 'atv', 'discount_rate'], ['sold_by'], { limit: rowsN(10) })),
        ...await safe(table(ctx, 'Lead conversion by associate', ['leads', 'lead_trials', 'lead_conversions', 'lead_conversion_rate'], ['associate'], { limit: rowsN(10) })),
        ...await safe(table(ctx, 'Renewals by seller', ['memberships_expiring', 'sheet_renewal_rate', 'lapsed_value'], ['sold_by'], { limit: rowsN(10) })),
        ...await safe(table(ctx, 'Staff vs online sales', ['revenue', 'transactions', 'atv'], ['seller_type'], { limit: 3 }))] });
  }
  if (custom && want('clients')) {
    await add({ id: 'clients', kicker: kick(), title: 'Client Base & Engagement', icon: 'HeartPulse', summary: 'Visiting and paying clients, visit frequency, retention and value per client.',
      kpiIds: ['visiting_clients', 'paying_visiting_clients', 'visits', 'visits_per_client', 'paying_clients', 'revenue_per_client', 'retention_rate', 'second_visit_rate'],
      charts: [...await safeChart(trend(ctx, 'Visiting clients — paying vs total, 14 months', ['paying_visiting_clients', 'visiting_clients'], { chart: 'line' })), ...await safeChart(trend(ctx, 'Visits — 14 months vs last year', ['visits'], { compare: true }))],
      tables: [...await safe(table(ctx, 'Visits by format', ['visits', 'visiting_clients', 'visits_per_client'], ['format'], { extra: NOT_OTHER, limit: 4 })),
        ...await safe(table(ctx, 'Visits by weekday', ['visits', 'visiting_clients'], ['day_of_week'], { limit: 7 })),
        ...await safe(table(ctx, 'Visits by time of day', ['visits', 'visiting_clients'], ['prime_time'], { limit: 2 })),
        ...await safe(table(ctx, 'Revenue by product family', ['revenue', 'paying_clients', 'revenue_per_client'], ['product_family'], { limit: rowsN(8) }))] });
  }

  /* trainer scorecard: question-led — Q1 ranking, Q2 revenue, Q3 conversion & retention, Q4 by revenue, Q5 each studio */
  let trainerSc: Awaited<ReturnType<typeof trainerScorecards>> | null = null;
  const glance: NonNullable<Report['glance']> = [];
  const asTable = (r: AnalysisResult, style?: ReportTable['style']): ReportTable => { results.push(r); return { id: uid('t'), title: r.title, result: r, style }; };
  const asChart = (r: AnalysisResult, chart: ReportChart['chart'], y: string[], seriesBy?: string): ReportChart => { results.push(r); return { id: uid('c'), title: r.title, chart, y, seriesBy, result: r as unknown as QueryResult }; };
  if (custom && want('trainer_ranking')) {
    const sc = await trainerScorecards({ start: req.start, end: req.end, locations: req.locations });
    trainerSc = sc;
    const s = sc.all; const A = trainerAnswers(s);
    const el = s.rows.filter((r) => r.eligible);
    const pct = (v: number | null | undefined) => (v === null || v === undefined ? '—' : `${(v * 100).toFixed(1)}%`);
    const T = s.totals;
    const push = (x: ReportSection) => { sections.push(x); if (x.answer) glance.push({ q: x.answer.question, a: x.answer.headline, section: x.id }); };
    const ti = trainerInsights({ all: s, perStudio: [] });
    push({ id: 'trainer_ranking', kicker: kick(), title: 'Q1 · Who are our top trainers?', icon: 'Trophy',
      summary: `Composite score (0–100) for ${el.length} trainers with at least ${s.minClasses} sessions — attendance, fill, conversion and retention against their client mix, revenue and volume, less penalties for late cancels, empty classes and short tenure.`,
      answer: { question: 'Who are our top trainers?', ...A.q1 },
      stats: [{ label: 'Trainers ranked', value: el.length, format: 'number' }, { label: 'Tier A (≥ 70)', value: el.filter((r) => r.tier === 'A').length, format: 'number' }, { label: 'Tier B (55–70)', value: el.filter((r) => r.tier === 'B').length, format: 'number' },
        { label: 'Tier C (40–55)', value: el.filter((r) => r.tier === 'C').length, format: 'number' }, { label: 'Tier D (< 40)', value: el.filter((r) => r.tier === 'D').length, format: 'number' }, { label: 'Median score', value: el.length ? el[Math.floor(el.length / 2)].score : null, format: 'decimal' }],
      kpis: [], charts: [asChart(scoreChart(s, rowsN(15)), 'horizontal_bar', ['score'])],
      tables: [asTable(rankingTable(s, rowsN(30))), asTable(breakdownTable(s, rowsN(30)))],
      insights: [...ti.highlights.slice(0, 3), ...ti.concerns.slice(0, 3)], notes: methodNotes(s), visuals: { trainers: trainerProfiles(s, 6) } });
    push({ id: 'trainer_ranking_rev', kicker: kick(), title: 'Q2 · Individual & total revenue contribution', icon: 'IndianRupee',
      summary: 'Class revenue each trainer generated, their share of the total and the cumulative share — how concentrated revenue is in a few trainers.',
      answer: { question: 'What is their individual & total revenue contribution?', ...A.q2 },
      stats: [{ label: 'Total class revenue', value: T.class_revenue, format: 'currency' }, { label: 'Revenue per class', value: T.revenue_per_class, format: 'currency' }, { label: 'Sessions', value: T.classes, format: 'number' }, { label: 'Check-ins', value: T.class_checkins, format: 'number' }],
      kpis: [], charts: [asChart(revenueChart(s, rowsN(15)), 'horizontal_bar', ['class_revenue']), asChart(shareChart(s, 7), 'pie', ['class_revenue'])],
      tables: [asTable(contributionTable(s, rowsN(30)))], insights: A.q2.points });
    push({ id: 'trainer_ranking_conv', kicker: kick(), title: 'Q3 · Retention & conversion — net and %', icon: 'UserPlus',
      summary: 'New clients each trainer taught on their first visit, how many converted and were retained, and how that compares with what their mix of first-visit types should produce.',
      answer: { question: 'What is their retention & conversion (net + %)?', ...A.q3 },
      stats: [{ label: 'New clients', value: T.new_clients, format: 'number' }, { label: 'Converted', value: T.converted, format: 'number', note: pct(T.conversion_rate) }, { label: 'Retained', value: T.retained, format: 'number', note: pct(T.retention_rate) }, { label: 'Trials', value: T.trials, format: 'number' }],
      kpis: [], charts: [asChart(excessChart(s, 14), 'horizontal_bar', ['excess_converted'])],
      tables: [asTable(conversionTable(s, rowsN(30))), asTable(mixTable(s))], insights: A.q3.points });
    push({ id: 'trainer_ranking_q4', kicker: kick(), title: 'Q4 · Top trainers by revenue — retention & conversion', icon: 'Target',
      summary: 'The highest-earning trainers side by side on newcomer conversion and retention — who combines revenue with growing the client base.',
      answer: { question: 'How do the top trainers by revenue convert and retain?', ...A.q4 },
      kpis: [], charts: [], tables: [asTable(conversionTable(s, rowsN(15), true))], insights: A.q4.points });
    for (const [i, st] of sc.perStudio.entries()) {
      const sa = studioAnswer(st); const se = st.rows.filter((r) => r.eligible);
      push({ id: `trainer_ranking_${i + 1}`, kicker: kick(), title: `Q5 · ${st.scope}`, icon: 'MapPin',
        summary: `Trainers ranked against peers at ${st.scope} (at least ${st.minClasses} sessions), with conversion and retention against the studio's own client mix and late cancels against the studio norm.`,
        answer: { question: `Top trainers at ${st.scope} — retention & conversion`, ...sa },
        stats: [{ label: 'Trainers ranked', value: se.length, format: 'number' }, { label: 'Sessions', value: st.totals.classes, format: 'number' }, { label: 'Avg attendance', value: st.totals.class_average, format: 'decimal' }, { label: 'Fill', value: st.totals.fill_rate, format: 'percent' },
          { label: 'New clients', value: st.totals.new_clients, format: 'number' }, { label: 'Converted', value: st.totals.converted, format: 'number', note: pct(st.totals.conversion_rate) }],
        kpis: [], charts: [asChart(scoreChart(st, rowsN(10)), 'horizontal_bar', ['score'])],
        tables: [asTable(rankingTable(st, rowsN(15))), asTable(conversionTable(st, rowsN(15)))], insights: sa.points, notes: methodNotes(st) });
    }
    sections.push({ id: 'trainer_ranking_method', kicker: kick(), title: 'How the scores work', icon: 'BookOpen',
      summary: `Weights: attendance ${WEIGHTS.attendance}, fill ${WEIGHTS.fill}, conversion ${WEIGHTS.conversion}, retention ${WEIGHTS.retention}, class revenue ${WEIGHTS.revenue}, revenue per class ${WEIGHTS.rpc}, sessions ${WEIGHTS.volume} — then penalties. Every trainer is compared only with peers in the same scope.`,
      kpis: [], charts: [], tables: [], insights: [], definitions: METHOD });
    for (const x of sections.filter((x) => x.id.startsWith('trainer_ranking'))) x.actions = undefined;
    sections.find((x) => x.id === 'trainer_ranking')!.actions = ti.recommendations.slice(0, 4).map((r) => `${r.title} — ${r.detail}`);
  }

  /* lead channel & source analysis: all studios, then each studio */
  let leadRep: Awaited<ReturnType<typeof leadChannelReport>> | null = null;
  if (custom && want('lead_channels')) {
    leadRep = await leadChannelReport({ start: req.start, end: req.end, locations: req.locations, months: ctx.series.months });
    for (const x of leadRep.sections) {
      sections.push({ ...x, kicker: kick(), kpis: [], insights: x.insights ?? [],
        charts: x.charts.map((c) => asChart(c.result, c.chart, c.y, c.seriesBy)), tables: x.tables.map((t) => asTable(t.result, t.style)) });
      if (x.answer) glance.push({ q: x.answer.question, a: x.answer.headline, section: x.id });
    }
  }

  /* the reader's own topics */
  if (custom) for (const [i, b] of req.briefs.entries()) {
    const id = b.id ?? `x${i + 1}`; b.id = id;
    try {
      const plan = b.plan ? PlanSchema.parse(b.plan) : await planTopic(b.prompt, { end: req.end, locations: req.locations, tier: req.tier === 'deep' ? 'balanced' : undefined });
      b.plan = plan;
      const ex = plan.filters as Filter[];
      const ok = (m: string) => { const mt = metricById.get(m); return !!mt && ex.every((f) => !!modelById.get(mt.model)?.dims[f.dimension]); };
      const dropped = [...plan.kpis.filter((m) => !ok(m)), ...plan.charts.flatMap((c) => c.metrics.filter((m) => !ok(m))), ...plan.tables.flatMap((t) => t.metrics.filter((m) => !ok(m)))];
      const notes = [...plan.notes.filter((x) => !/keyword matching/i.test(x)), ...(dropped.length && ex.length ? [`Left out ${[...new Set(dropped)].map((m) => metricById.get(m)?.label ?? m).join(', ')} — that data can't be split by ${ex.map((f) => DIMENSIONS[f.dimension]?.label.toLowerCase() ?? f.dimension).join(' / ')}.`] : []),
        ...(ex.length ? [`Scope: ${ex.map((f) => `${DIMENSIONS[f.dimension]?.label ?? f.dimension} ${f.op === 'in' ? '=' : '≠'} ${f.values.join(', ')}`).join(' · ')}.`] : [])];
      const charts: ReportChart[] = [];
      for (const c of plan.charts.filter((c) => c.metrics.every(ok))) {
        charts.push(...await safeChart(c.kind === 'trend' ? trend(ctx, c.title, c.metrics, { compare: !!c.compare, extra: ex, chart: c.metrics.length > 1 ? 'line' : 'bar', wide: true })
          : c.kind === 'trend_by' ? trend(ctx, c.title, c.metrics, { chart: 'stacked_bar', dimension: c.dimension, extra: ex })
          : mix(ctx, c.title, c.metrics[0], c.dimension!, ex)));
      }
      const tables: ReportTable[] = [];
      for (const c of plan.compositions) {
        const metric = ['leads', 'new_clients', 'revenue', 'visits'].find((m) => { const mt = metricById.get(m); return mt && modelById.get(mt.model)?.dims[c.parent] && modelById.get(mt.model)?.dims[c.child]; });
        if (metric) tables.push(...await safe(table(ctx, `What makes up each ${DIMENSIONS[c.parent].label.toLowerCase()} — ${DIMENSIONS[c.child].label.toLowerCase()}s included`, [metric], [c.parent, c.child], { extra: ex, compare: false, limit: 120,
          post: (rows) => [...rows].sort((x, y) => String(x[c.parent]).localeCompare(String(y[c.parent])) || Number(y[metric]) - Number(x[metric])) })));
      }
      for (const t of plan.tables.filter((t) => t.metrics.every(ok))) tables.push(...await safe(table(ctx, t.title, t.metrics, t.dims, { extra: ex, sort: t.sort, dir: t.dir, limit: rowsN(t.limit ?? (t.dims.length > 1 ? 30 : 12)) })));
      // definitions the reader asked for: metrics from the catalogue, dimensions with their governed rules
      const defs: { term: string; text: string }[] = [];
      for (const d of plan.definitions) {
        const mt = metricById.get(d);
        if (mt) { defs.push({ term: mt.label, text: mt.description }); continue; }
        if (d === 'channel') { const lr = leadRules(); defs.push({ term: 'Channel', text: `Lead sources are grouped into channels by a governed mapping (config/business-rules.json → leads.channels): ${lr.channels.map((c) => `${c.channel} — ${c.sources.join(', ')}`).join('; ')}. Any other source falls into “${lr.channel_fallback}”. The full list of sources found in this period is in the composition table below.` }); continue; }
        if (DIMENSIONS[d]) defs.push({ term: DIMENSIONS[d].label, text: DIMENSIONS[d].description });
      }
      if (plan.kpis.some((m) => /qualif|disqual|lost|unrespons/.test(m)) && plan.definitions.length) {
        const lr = leadRules();
        defs.push({ term: 'Lead statuses used', text: `Qualified = CRM status ${lr.qualified_statuses.join(' / ')} or a completed trial or conversion; Disqualified = ${lr.disqualified_statuses.join(' / ')}; Lost = ${lr.lost_statuses.join(' / ')}; Unresponsive = ${lr.unresponsive_statuses.join(' / ')}. Statuses are taken from the CRM leads sheet.` });
      }
      await add({ id, kicker: kick(), title: plan.title, icon: 'Lightbulb', summary: plan.summary, ask: b.prompt, notes, planSource: plan.source, definitions: [...new Map(defs.map((x) => [x.term, x])).values()],
        kpiIds: plan.kpis.filter(ok), kpiExtra: ex, charts, tables });
    } catch (e) {
      sections.push({ id, kicker: kick(), title: 'Additional topic', icon: 'Lightbulb', summary: 'This topic could not be built from the available data.', ask: b.prompt,
        notes: [(e as Error).message], kpis: [], charts: [], tables: [], insights: [] });
    }
  }

  /* 9 · Road ahead */
  const e = d(req.end);
  const nStart = iso(new Date(Date.UTC(e.getUTCFullYear(), e.getUTCMonth() + 1, 1))), nEnd = iso(new Date(Date.UTC(e.getUTCFullYear(), e.getUTCMonth() + 2, 0)));
  const fcs: NonNullable<ReportSection['visuals']>['forecasts'] = [];
  for (const [metric, label] of (want('road') ? [['revenue', 'Revenue'], ['new_clients', 'New clients'], ['visits', 'Visits']] as const : [])) {
    try {
      const r = await executeTool('forecast', { metric, horizon: 3, ...(req.locations.length ? { filters: [{ dimension: 'location', op: 'in', values: req.locations }] } : {}) });
      const res = r.result!; results.push(res);
      const row = res.rows.find((x) => String(x.period).slice(0, 7) === nStart.slice(0, 7) && x.forecast !== null);
      const m = ((res as { extra?: Record<string, unknown> }).extra?.methods as Record<string, { method: string }> | undefined); const method = m ? Object.values(m)[0]?.method : undefined;
      const rd = (x: number) => (metric === 'revenue' ? x : Math.round(x));
      fcs.push({ label, metric, format: metricById.get(metric)!.format, month: monLabel(nStart), value: row ? rd(Number(row.forecast)) : null, lo: row ? rd(Number(row.lo80)) : null, hi: row ? rd(Number(row.hi80)) : null, method });
    } catch { /* forecast best effort */ }
  }
  const next = await runMetricsQuery({ metrics: ['memberships_expiring', 'expiring_value'], start: nStart, end: nEnd, filters: filtersFor(['memberships_expiring'], req) }).catch(() => null);
  if (next) results.push(next);
  const pipeline = [
    { label: 'Memberships ending next month', value: next ? Number(next.rows[0]?.memberships_expiring ?? 0) : null, format: 'number', note: monLabel(nStart) },
    { label: 'Value up for renewal', value: next ? Number(next.rows[0]?.expiring_value ?? 0) : null, format: 'currency', note: 'amount paid on those memberships' },
    { label: 'Open lead pipeline', value: sections.find((s) => s.id === 'leads')?.kpis.find((k) => k.id === 'open_leads')?.value ?? null, format: 'number', note: 'leads not yet won or lost' },
    { label: 'Unsold-seat opportunity', value: scorecard.find((k) => k.id === 'revenue_per_attendee') ? (await kpis(ctx, ['lost_revenue']))[0]?.value ?? null : null, format: 'currency', note: 'empty seats × revenue per attendee (this period)' },
  ];
  if (want('road')) sections.push({ id: 'road', kicker: kick(), title: 'Road Ahead', icon: 'Compass', summary: `Outlook for ${monLabel(nStart)}: forecasts, renewals due, pipeline and the priorities that will move the numbers.`,
    kpis: [], charts: [], tables: [], insights: [], visuals: { forecasts: fcs, pipeline } });

  if (custom) {
    // custom reports: sections in the order the topics were chosen; headline and scorecard drawn from those topics
    const pos = (id: string) => { const i = req.topics.indexOf(id); if (i >= 0) return i; const j = req.topics.findIndex((t) => id.startsWith(t + '_')); return j < 0 ? 99 : j + 0.5; };
    sections.sort((a, b) => (a.id === 'road' ? 1 : b.id === 'road' ? -1 : pos(a.id) - pos(b.id)));
    sections.forEach((x, i) => { x.kicker = `Section ${String(i + 1).padStart(2, '0')}`; });
    const seen = new Set<string>(); const pool = sections.flatMap((x) => x.kpis).filter((k) => !seen.has(k.id) && seen.add(k.id));
    const lead: Kpi[] = []; for (const x of sections) for (const k of x.kpis.slice(0, sections.length > 3 ? 2 : 4)) if (!lead.some((y) => y.id === k.id)) lead.push(k);
    if (lead.length) head = lead.slice(0, 8);
    if (pool.length) scorecard = pool.slice(0, 30);
  }
  const studios = req.locations.length === 1 || custom ? undefined : await table(ctx, 'Studio scorecard', ['revenue', 'atv', 'paying_clients', 'visiting_clients', 'visits', 'fill_rate', 'new_clients', 'conversion_rate', 'sheet_renewal_rate'], ['location'], { limit: 10, compare: false });

  const mom = await runMetricsQuery({ metrics: ['revenue', 'transactions', 'paying_clients', 'paying_visiting_clients', 'visiting_clients', 'visits', 'new_clients', 'conversion_rate', 'leads', 'fill_rate', 'class_average', 'sheet_renewal_rate', 'late_cancel_rate'],
    grain: 'month', start: seriesStart, end: seriesEnd, compare: 'previous_year', filters: filtersFor(['revenue', 'visits', 'new_clients', 'fill_rate', 'sheet_renewal_rate', 'leads'], req) });
  mom.title = 'Month-on-month — last 14 months with last year'; results.push(mom);

  // derived baseline values (current-year averages, funnel steps, pipeline) so narrative verification can trace them
  const allK = [...head, ...scorecard, ...sections.flatMap((x) => [...x.kpis, ...(x.visuals?.formats ?? []).flatMap((f) => f.kpis)])];
  results.push({ id: 'r_baselines', kind: 'baselines', title: 'Derived baselines', columns: [], sql: [], sources: [], notes: [], checks: [], verified: true, definitions: [], rowCount: allK.length,
    rows: [...allK.map((k) => ({ ytd: k.ytd, chgYtd: k.chgYtd, chg: k.chg, chgLy: k.chgLy })), ...sections.flatMap((x) => [...(x.visuals?.funnel ?? []), ...(x.visuals?.pipeline ?? [])].map((f) => ({ v: f.value })))] } as unknown as AnyResult);
  const ranked = scorecard.filter((k) => k.chg !== null && k.higherIsBetter !== undefined).sort((a, b) => score(b) - score(a));
  const line = (k: Kpi) => `${k.label}: ${fmtVal(k.value, k.format)} (${fmtChg(k)} vs ${period.prevLabel}${k.chgYtd !== null ? `, ${fmtChg(k, 'chgYtd')} vs ${period.ytdLabel}` : ''}${k.chgLy !== null ? `, ${fmtChg(k, 'chgLy')} vs ${period.lyLabel}` : ''})`;
  const concernsK = ranked.filter((k) => score(k) < 0).reverse().slice(0, 5);
  const defs = new Map<string, { metric: string; label: string; description: string }>();
  for (const r of results) for (const x of r.definitions ?? []) defs.set(x.metric, { metric: x.metric, label: x.label, description: x.description });

  const report: Report = {
    id: 'rep_' + crypto.randomBytes(5).toString('hex'), generatedAt: new Date().toISOString(), request: req, period,
    scope: req.locations.length ? req.locations.join(', ') : 'All studios', headline: head, scorecard, studios, sections,
    appendix: { mom: { id: uid('t'), title: mom.title, result: mom }, definitions: [...defs.values()] },
    autoInsights: { highlights: ranked.filter((k) => score(k) > 0).slice(0, 5).map(line), concerns: concernsK.map(line),
      recommendations: concernsK.filter((k) => PLAYBOOK[k.id]).slice(0, 5).map((k, i) => ({ title: `Address ${k.label.toLowerCase()}`, detail: PLAYBOOK[k.id], priority: (i < 2 ? 'high' : 'medium') as 'high' | 'medium', kpi: k.label })) },
    results,
  };
  const only = (ids: string[]) => req.topics.every((t) => ids.includes(t) || t === 'road') && !req.briefs.length;
  if (glance.length) report.glance = glance;
  if (trainerSc) {
    const ti = trainerInsights(trainerSc);
    if (only(['trainer_ranking'])) { report.headline = trainerHeadline(trainerSc.all); report.scorecard = []; report.autoInsights = ti; }
    else report.autoInsights = { highlights: [...ti.highlights.slice(0, 2), ...report.autoInsights.highlights].slice(0, 6), concerns: [...ti.concerns.slice(0, 2), ...report.autoInsights.concerns].slice(0, 6), recommendations: [...ti.recommendations.slice(0, 3), ...report.autoInsights.recommendations].slice(0, 8) };
  }
  if (leadRep) {
    const li = leadRep.insights;
    report.summaryTables = leadRep.summaryTables.map((t) => asTable(t.result, t.style));
    if (only(['lead_channels'])) { report.headline = leadRep.headline; report.scorecard = []; report.autoInsights = li; }
    else report.autoInsights = { highlights: [...li.highlights.slice(0, 2), ...report.autoInsights.highlights].slice(0, 6), concerns: [...li.concerns.slice(0, 2), ...report.autoInsights.concerns].slice(0, 6), recommendations: [...li.recommendations.slice(0, 3), ...report.autoInsights.recommendations].slice(0, 8) };
    void LEAD_METHOD;
  }
  remember(report);
  return report;
}

const store = new Map<string, Report>();
function remember(r: Report) { store.set(r.id, r); while (store.size > 20) store.delete(store.keys().next().value!); }
export const getReport = (id: string) => store.get(id);
export const dimLabel = (k: string) => DIMENSIONS[k]?.label ?? k;
