/**
 * Executive Performance Review — a live, studio-level performance review built on
 * the same semantic engine as the executive report, recomposed into review
 * sections. Every number is computed; the AI writes commentary section by section
 * and each section's commentary is stored once, so re-opening a review never
 * re-spends tokens unless the reader explicitly asks for a section to be rewritten.
 */
import crypto from 'node:crypto';
import Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';
import { config } from '../config.js';
import { MODELS, fallbackOrder, type Tier } from '../ai/router.js';
import { isNotFound, markMissing } from '../ai/models.js';
import { verifyNarrative } from '../ai/verify.js';
import { runMetricsQuery } from '../semantic/engine.js';
import { log } from '../util/log.js';
import { attendanceExtras, classExtras, formatComparison, funnelExtras, productList, trainerScorecard } from './reviewExtras.js';
import { buildReport, fmtVal, fmtChg, type Kpi, type Report, type ReportChart, type ReportSection, type ReportTable } from './build.js';

export const ReviewRequestSchema = z.object({
  start: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  end: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  locations: z.array(z.string()).default([]),
  tier: z.enum(['fast', 'balanced', 'deep']).optional(),
});
export type ReviewRequest = z.infer<typeof ReviewRequestSchema>;

export const REVIEW_SECTIONS = [
  { id: 'sales', title: 'Sales', icon: 'IndianRupee', lead: 'Cash collected, pricing, product mix, associates and payment behaviour.' },
  { id: 'attendance', title: 'Attendance, Bookings & Cancellations Index', icon: 'Activity', lead: 'How clients book, show up, visit and cancel — rolled into one attendance health index.' },
  { id: 'funnel', title: 'Funnel Health', icon: 'Filter', lead: 'Leads to trials to paying members — volume, quality, speed and where the funnel leaks.' },
  { id: 'classes', title: 'Class Performance', icon: 'CalendarRange', lead: 'Schedule productivity — fill, class size, empty classes, the best and weakest slots.' },
  { id: 'trainers', title: 'Trainer Performance', icon: 'GraduationCap', lead: 'Draw, fill, consistency, yield and newcomer conversion by trainer.' },
  { id: 'formats', title: 'Format Comparison', icon: 'Shapes', lead: 'Barre vs powerCycle vs Strength Lab — demand, fill, yield and cross-over.' },
  { id: 'churn', title: 'Churn & Lapsed Members', icon: 'UserMinus', lead: 'Recurring memberships ending — renewals, lapses and the value at stake.' },
] as const;
export type ReviewSectionId = typeof REVIEW_SECTIONS[number]['id'];

export interface ReviewList { id: string; title: string; metric: string; format: string; dimension: string; dimKey?: string; metricKey?: string; top: { name: string; value: number | null; sub?: string }[]; bottom: { name: string; value: number | null; sub?: string }[] }
export interface ReviewSection {
  id: ReviewSectionId; title: string; icon: string; lead: string; kicker: string;
  kpis: Kpi[]; charts: ReportChart[]; tables: ReportTable[];
  funnels?: { title: string; steps: { label: string; value: number | null }[] }[];
  heatmap?: NonNullable<ReportSection['visuals']>['heatmap'];
  formats?: NonNullable<ReportSection['visuals']>['formats'];
  spotlight?: NonNullable<ReportSection['visuals']>['spotlight'];
  index?: { value: number | null; parts: { label: string; value: number | null; weight: number }[]; note: string };
  /** rule-based notes per chart / table id — always present; AI notes replace them */
  notes: Record<string, string>;
  ruleFindings: string[];
}
export interface ReviewGlance { cards: Kpi[]; tables: ReportTable[]; charts: ReportChart[]; lists: ReviewList[]; notes: Record<string, string> }
export interface Review {
  id: string; generatedAt: string; request: ReviewRequest; period: Report['period']; scope: string;
  cover: { photo: number; headlineKpis: Kpi[] };
  glance: ReviewGlance; sections: ReviewSection[]; scorecard: Kpi[]; studios?: ReportTable;
}

/* ── AI commentary (stored per part) ── */
export interface ReviewSectionAI { headline: string; summary: string; insights: string[]; findings: string[]; recommendations: { title: string; detail: string; owner: string; priority: 'high' | 'medium' | 'low' }[]; notes: Record<string, string>; model?: string; source: 'ai' | 'rules'; at: string }
export interface ReviewGlanceAI { headline: string; tagline: string; summary: string; insights: string[]; highlights: { section: string; text: string }[]; watch: string[]; notes: Record<string, string>; model?: string; source: 'ai' | 'rules'; at: string }
export interface ReviewAI { glance?: ReviewGlanceAI; sections: Record<string, ReviewSectionAI>; verification?: { checked: number; unmatched: string[] } }

const cache = new Map<string, { review: Review; report: Report }>();
export const getReview = (id: string) => cache.get(id);

const pickK = (ks: Kpi[], ids: string[]) => ids.map((id) => ks.find((k) => k.id === id)).filter((k): k is Kpi => !!k);
const sec = (r: Report, id: string) => r.sections.find((s) => s.id === id);
const tbl = (s: ReportSection | undefined, re: RegExp) => s?.tables.find((t) => re.test(t.title));

/* ── rule-based notes: every chart and table carries a sentence of reading ── */
function chartNote(c: ReportChart): string {
  const r = c.result;
  const m = r.columns.find((x) => x.kind === 'metric' && (!c.y?.length || c.y.includes(x.key)));
  const dim = r.columns.find((x) => x.kind === 'period') ?? r.columns.find((x) => x.kind === 'dimension' && x.key !== c.seriesBy);
  if (!m || !dim || !r.rows.length) return '';
  const by = new Map<string, number>();
  for (const row of r.rows) { const v = Number(row[m.key]); if (!isFinite(v)) continue; const k = String(row[dim.key] ?? '—'); by.set(k, (c.seriesBy && m.format !== 'percent' ? by.get(k) ?? 0 : 0) + v); }
  const pts = [...by.entries()]; if (pts.length < 2) return '';
  const f = m.format ?? 'number';
  const hi = pts.reduce((a, b) => (b[1] > a[1] ? b : a)), lo = pts.reduce((a, b) => (b[1] < a[1] ? b : a));
  if (dim.kind === 'period') {
    const last = pts[pts.length - 1], first = pts[0];
    const ch = first[1] ? (last[1] - first[1]) / Math.abs(first[1]) : null;
    return `${m.label} ended the window at ${fmtVal(last[1], f)}${ch !== null && f !== 'percent' ? ` (${ch >= 0 ? '+' : ''}${(ch * 100).toFixed(0)}% over ${pts.length} months)` : ''}; peak ${fmtVal(hi[1], f)} in ${hi[0].slice(0, 7)}, low ${fmtVal(lo[1], f)} in ${lo[0].slice(0, 7)}.`;
  }
  const tot = pts.reduce((a, b) => a + b[1], 0);
  return `${hi[0]} leads ${m.label.toLowerCase()} at ${fmtVal(hi[1], f)}${f !== 'percent' && tot ? ` (${((hi[1] / tot) * 100).toFixed(0)}% of the total)` : ''}; ${lo[0]} is lowest at ${fmtVal(lo[1], f)}.`;
}
function tableNote(t: ReportTable): string {
  const r = t.result as ReportTable['result'] & { columns: { key: string; label: string; kind: string; format?: string }[]; rows: Record<string, unknown>[] };
  const dim = r.columns?.find((x) => x.kind === 'dimension');
  const m = r.columns?.find((x) => x.kind === 'metric');
  if (!dim || !m || !r.rows?.length) return '';
  const rows = r.rows.filter((x) => isFinite(Number(x[m.key])));
  if (!rows.length) return '';
  const top = rows[0], bot = rows[rows.length - 1];
  const chg = r.columns.find((x) => x.kind === 'change' && x.key.startsWith(m.key));
  const mover = chg ? [...rows].filter((x) => x[chg.key] !== null && x[chg.key] !== undefined).sort((a, b) => Math.abs(Number(b[chg.key])) - Math.abs(Number(a[chg.key])))[0] : undefined;
  return `${String(top[dim.key])} tops ${m.label.toLowerCase()} at ${fmtVal(Number(top[m.key]), m.format ?? 'number')}${rows.length > 2 ? `, ${String(bot[dim.key])} trails at ${fmtVal(Number(bot[m.key]), m.format ?? 'number')}` : ''}.${mover ? ` Biggest mover: ${String(mover[dim.key])} (${(Number(mover[chg!.key]) * 100).toFixed(1)}${/pp/.test(chg!.label) ? 'pp' : '%'} vs previous period).` : ''}`;
}
const notesFor = (charts: ReportChart[], tables: ReportTable[]) => Object.fromEntries([...charts.map((c) => [c.id, chartNote(c)]), ...tables.map((t) => [t.id, tableNote(t)])].filter(([, v]) => v));
function kpiFindings(ks: Kpi[], P: Report['period']) {
  return [...ks].filter((k) => k.chg !== null && k.higherIsBetter !== undefined).sort((a, b) => Math.abs(b.chg!) - Math.abs(a.chg!)).slice(0, 4)
    .map((k) => `${k.label} ${fmtVal(k.value, k.format)} — ${fmtChg(k)} vs ${P.prevLabel}, ${fmtChg(k, 'chgLy')} vs ${P.lyLabel}${(k.chg! > 0) === k.higherIsBetter ? '' : ' (needs attention)'}.`);
}
function listFrom(t: ReportTable | undefined, title: string, sub?: string): ReviewList | null {
  if (!t) return null;
  const r = t.result as unknown as { columns: { key: string; label: string; kind: string; format?: string }[]; rows: Record<string, unknown>[] };
  const dim = r.columns.find((x) => x.kind === 'dimension'); const m = r.columns.find((x) => x.kind === 'metric');
  if (!dim || !m) return null;
  const s = r.columns.find((x) => x.key === sub);
  const rows = r.rows.filter((x) => isFinite(Number(x[m.key]))).map((x) => ({ name: String(x[dim.key]), value: Number(x[m.key]), sub: s ? `${s.label} ${fmtVal(Number(x[s.key]), s.format ?? 'number')}` : undefined }));
  if (rows.length < 2) return null;
  const sorted = [...rows].sort((a, b) => b.value - a.value);
  return { id: t.id, title, metric: m.label, format: m.format ?? 'number', dimension: dim.label, dimKey: dim.key, metricKey: m.key, top: sorted.slice(0, 5), bottom: sorted.slice(-5).reverse() };
}

async function trainerCharts(req: ReviewRequest): Promise<ReportChart[]> {
  const f = req.locations.length ? [{ dimension: 'location', op: 'in' as const, values: req.locations }] : [];
  const out: ReportChart[] = [];
  try {
    const a = await runMetricsQuery({ metrics: ['class_checkins'], dimensions: ['teacher'], start: req.start, end: req.end, filters: [...f, { dimension: 'teacher', op: 'not_in', values: ['(blank)'] }], sort: { by: 'class_checkins', dir: 'desc' }, limit: 12 });
    a.title = 'Check-ins by trainer'; out.push({ id: `rc${crypto.randomUUID().slice(0, 6)}`, title: a.title, chart: 'horizontal_bar', result: a });
    const b = await runMetricsQuery({ metrics: ['class_average', 'fill_rate'], dimensions: ['teacher'], start: req.start, end: req.end, filters: [...f, { dimension: 'teacher', op: 'not_in', values: ['(blank)'] }], sort: { by: 'class_average', dir: 'desc' }, limit: 12 });
    b.title = 'Class average by trainer'; out.push({ id: `rc${crypto.randomUUID().slice(0, 6)}`, title: b.title, chart: 'bar', y: ['class_average'], result: b });
  } catch (e) { log.warn({ err: (e as Error).message }, 'review trainer charts failed'); }
  return out;
}

export async function buildReview(raw: unknown): Promise<Review> {
  const req = ReviewRequestSchema.parse(raw);
  const multi = req.locations.length !== 1;
  const report = await buildReport({ start: req.start, end: req.end, locations: req.locations, kind: 'custom', depth: 'detailed', audience: 'leadership', title: 'Executive Performance Review',
    topics: ['sales', 'new_clients', 'leads', 'trainers', 'classes', 'formats', 'churn', 'late', ...(multi ? ['studios'] : [])] });
  const P = report.period;
  const [attX, funX, clsX, trSc, fmX, prods] = await Promise.all([attendanceExtras(req), funnelExtras(req), classExtras(req), trainerScorecard(req), formatComparison(req), productList(req)]);
  const S = { sales: sec(report, 'sales'), nc: sec(report, 'new_clients'), leads: sec(report, 'leads'), tr: sec(report, 'trainers'), cl: sec(report, 'classes'), fm: sec(report, 'formats'), ch: sec(report, 'churn'), late: sec(report, 'late'), st: sec(report, 'studios') };
  const sections: ReviewSection[] = [];
  let n = 0;
  const push = (id: ReviewSectionId, x: Omit<ReviewSection, 'id' | 'title' | 'icon' | 'lead' | 'kicker' | 'notes' | 'ruleFindings'>, extraFind: string[] = []) => {
    const meta = REVIEW_SECTIONS.find((m) => m.id === id)!;
    sections.push({ ...meta, kicker: `Section ${String(++n).padStart(2, '0')}`, ...x, notes: notesFor(x.charts, x.tables), ruleFindings: [...kpiFindings(x.kpis, P), ...extraFind].slice(0, 6) });
  };

  if (S.sales) push('sales', { kpis: S.sales.kpis, charts: S.sales.charts, tables: S.sales.tables }, S.sales.insights);

  // attendance index: show-up, booking fill and (1 − late-cancel rate), weighted
  const allK = [...(S.cl?.kpis ?? []), ...(S.late?.kpis ?? [])];
  const kv = (id: string) => allK.find((k) => k.id === id)?.value ?? null;
  const parts = [{ label: 'Show-up rate', value: kv('class_show_up_rate'), weight: 0.4 }, { label: 'Booking fill', value: kv('booking_fill_rate'), weight: 0.3 }, { label: 'Kept bookings (1 − late cancels)', value: kv('late_cancel_rate') === null ? null : 1 - kv('late_cancel_rate')!, weight: 0.3 }];
  const okParts = parts.filter((p) => p.value !== null);
  const idx = okParts.length ? (okParts.reduce((a, p) => a + p.value! * p.weight, 0) / okParts.reduce((a, p) => a + p.weight, 0)) * 100 : null;
  push('attendance', {
    kpis: pickK([...allK, ...(S.sales?.kpis ?? []), ...report.scorecard], ['visits', 'visiting_clients', 'visits_per_client', 'paying_visiting_clients', 'bookings', 'late_cancellations', 'late_cancel_rate', 'class_show_up_rate', 'classes', 'class_average', 'fill_rate', 'empty_classes']),
    charts: [...attX.charts, ...(S.late?.charts.slice(0, 1) ?? [])].slice(0, 3),
    tables: [...attX.tables, ...(S.late?.tables.slice(0, 1) ?? [])],
    index: { value: idx, parts, note: 'Attendance index = 40% show-up rate + 30% booking fill + 30% bookings kept (not late-cancelled), on a 0–100 scale.' },
  });

  push('funnel', {
    kpis: [...pickK(S.leads?.kpis ?? [], ['leads', 'lead_to_trial_rate', 'lead_conversion_rate', 'cost_per_lead']), ...pickK(S.nc?.kpis ?? [], ['new_clients', 'second_visit_rate', 'conversion_rate', 'retention_rate', 'avg_days_to_convert', 'new_client_avg_ltv'])],
    charts: [S.leads?.charts[0], S.nc?.charts[0]].filter(Boolean).slice(0, 2) as ReportChart[],
    tables: funX.tables.length ? funX.tables : [...(S.leads?.tables.slice(0, 2) ?? []), ...(S.nc?.tables.slice(0, 2) ?? [])],
    funnels: [S.leads?.visuals?.funnel && { title: 'Lead funnel', steps: S.leads.visuals.funnel }, S.nc?.visuals?.funnel && { title: 'Newcomer journey', steps: S.nc.visuals.funnel }].filter(Boolean) as ReviewSection['funnels'],
  }, [...(S.leads?.insights ?? []), ...(S.nc?.insights ?? [])]);

  if (S.cl) push('classes', { kpis: pickK([...S.cl.kpis, ...report.scorecard], ['classes', 'class_average', 'fill_rate', 'empty_classes', 'empty_class_rate', 'sold_out_rate', 'booking_fill_rate', 'revenue_per_class']), charts: S.cl.charts.slice(0, 1), tables: clsX.tables.length ? clsX.tables : S.cl.tables.filter((t) => !/Weekday vs weekend/.test(t.title)), heatmap: S.cl.visuals?.heatmap }, S.cl.insights);
  if (S.tr) { const tc = await trainerCharts(req); push('trainers', { kpis: S.tr.kpis, charts: tc, tables: [...(trSc ? [trSc] : []), ...S.tr.tables.filter((t) => !trSc || !/leaderboard|scorecard/i.test(t.title))], spotlight: S.tr.visuals?.spotlight }, S.tr.insights); }
  if (S.fm) push('formats', { kpis: S.fm.kpis, charts: [...S.fm.charts.slice(0, 1), ...fmX.charts].slice(0, 2), tables: [...fmX.tables, ...S.fm.tables.slice(0, 2)], formats: S.fm.visuals?.formats }, S.fm.insights);
  if (S.ch) push('churn', { kpis: S.ch.kpis, charts: S.ch.charts, tables: S.ch.tables }, S.ch.insights);

  // at a glance: 8 cards, 4 tables, top / bottom lists, 3 charts
  const glTables = [S.st?.tables[0] ?? tbl(S.sales, /Product families/), tbl(S.leads, /Lead sources/), tbl(S.cl, /Strongest recurring/), tbl(S.tr, /leaderboard/)].filter(Boolean) as ReportTable[];
  const glCharts = [S.sales?.charts[0], S.nc?.charts[0], S.fm?.charts[0]].filter(Boolean) as ReportChart[];
  const lists = [
    listFrom(tbl(S.tr, /leaderboard/), 'Trainers', 'class_average'), listFrom(S.cl ? { ...tbl(S.cl, /Strongest recurring/)!, result: { ...tbl(S.cl, /Strongest recurring/)!.result, rows: [...(tbl(S.cl, /Strongest recurring/)?.result.rows ?? []), ...(tbl(S.cl, /Weakest recurring/)?.result.rows ?? [])] } } as ReportTable : undefined, 'Classes', 'class_average'),
    listFrom(prods ? { id: 'products', title: 'Products', result: prods as unknown as ReportTable['result'] } : tbl(S.sales, /Top products/), 'Products', 'units_sold'), listFrom(tbl(S.leads, /Lead sources/), 'Lead sources', 'lead_conversion_rate'),
    listFrom(tbl(S.ch, /By membership/), 'Memberships at risk', 'churn_rate'),
  ].filter(Boolean) as ReviewList[];
  // de-duplicate class rows merged from strongest + weakest
  for (const l of lists) { const seen = new Set<string>(); l.top = l.top.filter((x) => !seen.has(x.name) && seen.add(x.name)); const s2 = new Set<string>(); l.bottom = l.bottom.filter((x) => !s2.has(x.name) && s2.add(x.name)); }
  const glance: ReviewGlance = { cards: report.headline.slice(0, 8), tables: glTables, charts: glCharts, lists, notes: notesFor(glCharts, glTables) };

  const id = `rv_${crypto.randomUUID().slice(0, 10)}`;
  const review: Review = { id, generatedAt: new Date().toISOString(), request: req, period: P, scope: report.scope, cover: { photo: Math.floor(Math.random() * 9), headlineKpis: report.headline.slice(0, 4) }, glance, sections, scorecard: report.scorecard, studios: report.studios ?? S.st?.tables[0] };
  cache.set(id, { review, report });
  if (cache.size > 30) cache.delete(cache.keys().next().value!);
  return review;
}

/* ── AI ── */
function kLine(k: Kpi, P: Report['period']) {
  return `${k.label} [${k.id}]: ${fmtVal(k.value, k.format)} | ${P.prevLabel} ${fmtVal(k.prev, k.format)} (${fmtChg(k)}) | ${P.ytdLabel} ${fmtVal(k.ytd, k.format)} (${fmtChg(k, 'chgYtd')}) | ${P.lyLabel} ${fmtVal(k.ly, k.format)} (${fmtChg(k, 'chgLy')})${k.higherIsBetter === false ? ' [lower is better]' : ''}`;
}
function tLines(t: ReportTable) {
  const r = t.result as unknown as { columns: { key: string; label: string; kind: string; format?: string }[]; rows: Record<string, unknown>[] };
  const cols = r.columns.filter((c) => ['dimension', 'metric', 'change'].includes(c.kind));
  return r.rows.slice(0, 12).map((row) => cols.map((c) => c.kind === 'dimension' ? String(row[c.key] ?? '(blank)') : c.kind === 'change' ? `${c.label} ${row[c.key] == null ? 'n/a' : (Number(row[c.key]) * 100).toFixed(1) + (/pp/.test(c.label) ? 'pp' : '%')}` : `${c.label} ${fmtVal(Number(row[c.key]), c.format ?? 'number')}`).join(', ')).join(' || ');
}
function cLines(c: ReportChart) {
  const r = c.result; const m = r.columns.filter((x) => x.kind === 'metric'); const dims = r.columns.filter((x) => x.kind === 'period' || x.kind === 'dimension');
  return r.rows.slice(0, 40).map((row) => `${dims.map((d) => String(row[d.key]).slice(0, 24)).join('/')}: ${m.map((x) => `${x.label} ${fmtVal(Number(row[x.key]), x.format ?? 'number')}`).join(', ')}`).join('; ');
}
function sectionDigest(rv: Review, s: ReviewSection) {
  const P = rv.period; const L: string[] = [`STUDIO REVIEW: ${rv.scope} — ${P.label} (${P.start} to ${P.end}). Baselines: ${P.prevLabel}; ${P.ytdLabel}; ${P.lyLabel}.`, `SECTION ${s.id} — ${s.title}`];
  s.kpis.forEach((k) => L.push('- ' + kLine(k, P)));
  if (s.index) L.push(`ATTENDANCE INDEX ${s.index.value === null ? 'n/a' : s.index.value.toFixed(1)} / 100 (${s.index.note}) — parts: ${s.index.parts.map((p) => `${p.label} ${fmtVal(p.value, 'percent')}`).join(', ')}`);
  s.funnels?.forEach((f) => L.push(`FUNNEL ${f.title}: ${f.steps.map((x) => `${x.label} ${x.value ?? 'n/a'}`).join(' → ')}`));
  s.spotlight?.forEach((t) => L.push(`TOP DRAW: ${t.name} avg ${fmtVal(t.avg, 'decimal')} over ${t.classes} classes, fill ${fmtVal(t.fill, 'percent')}`));
  s.formats?.forEach((f) => L.push(`FORMAT ${f.format}: ${f.kpis.map((k) => `${k.label} ${fmtVal(k.value, k.format)} (${fmtChg(k)})`).join('; ')}`));
  if (s.heatmap) { const cells = Object.entries(s.heatmap.cells).filter(([, c]) => c.classes >= 3 && c.fill !== null).sort((a, b) => (b[1].fill ?? 0) - (a[1].fill ?? 0)); L.push('BEST SLOTS: ' + cells.slice(0, 5).map(([k, c]) => `${k.replace('|', ' ')} ${fmtVal(c.fill, 'percent')}`).join('; ')); L.push('WEAKEST SLOTS: ' + cells.slice(-5).map(([k, c]) => `${k.replace('|', ' ')} ${fmtVal(c.fill, 'percent')}`).join('; ')); }
  s.charts.forEach((c) => L.push(`CHART ${c.id} "${c.title}": ${cLines(c)}`));
  s.tables.forEach((t) => L.push(`TABLE ${t.id} "${t.title}": ${tLines(t)}`));
  return L.join('\n');
}
function glanceDigest(rv: Review) {
  const P = rv.period; const L: string[] = [`STUDIO REVIEW: ${rv.scope} — ${P.label}. Baselines: ${P.prevLabel}; ${P.ytdLabel}; ${P.lyLabel}.`, 'SCORECARD'];
  rv.scorecard.forEach((k) => L.push('- ' + kLine(k, P)));
  for (const s of rv.sections) { L.push(`\nSECTION ${s.id} — ${s.title}`); s.kpis.slice(0, 6).forEach((k) => L.push('- ' + kLine(k, P))); s.ruleFindings.slice(0, 3).forEach((f) => L.push('  NOTE ' + f)); }
  rv.glance.tables.forEach((t) => L.push(`TABLE ${t.id} "${t.title}": ${tLines(t)}`));
  rv.glance.charts.forEach((c) => L.push(`CHART ${c.id} "${c.title}": ${cLines(c)}`));
  if (rv.studios) L.push(`STUDIOS: ${tLines(rv.studios)}`);
  return L.join('\n');
}
const notesSchema = (ids: string[]) => ({ type: 'object', description: "One detailed note (70–110 words) per chart/table id, in exactly three parts separated by ' | ' — 'Shows: <what the visual shows, naming the specific leaders, laggards and figures>' | 'Why it matters: <the business implication, with comparisons>' | 'Action: <one concrete next step with an owner>'.", properties: Object.fromEntries(ids.map((id) => [id, { type: 'string' }])), required: ids });
const recSchema = { type: 'array', description: '3–5 recommendations, each naming who should act.', items: { type: 'object', properties: { title: { type: 'string' }, detail: { type: 'string' }, owner: { type: 'string' }, priority: { type: 'string', enum: ['high', 'medium', 'low'] } }, required: ['title', 'detail', 'owner', 'priority'] } };
const SYSTEM = `You are the Chief Analytics Officer of Physique 57 India (premium barre, powerCycle and Strength Lab studios), writing a senior-management Executive Performance Review for a studio.
Rules: use ONLY figures in the digest, copied exactly as formatted; never invent numbers; estimates must be labelled "~"/"estimate". Every KPI has three baselines (previous period, current-year monthly average, same period last year) — use them. Be specific: name products, trainers, classes, slots, sources, memberships. Explain drivers (volume vs rate, mix, seasonality, small samples). Mind polarity ([lower is better]). Elegant, decisive British/Indian English for a CEO; no markdown, no emojis. Call the tool exactly once.`;

async function callTool<T>(tool: Anthropic.Tool, content: string, tier: Tier): Promise<{ out: T; model: string } | null> {
  if (!config.anthropicKey) return null;
  const client = new Anthropic({ apiKey: config.anthropicKey });
  let order = fallbackOrder(tier);
  while (order.length) {
    const model = MODELS[order[0]];
    try {
      const msg = await client.messages.stream({ model: model.id, max_tokens: 8000, system: SYSTEM, tools: [tool], tool_choice: { type: 'tool', name: tool.name }, messages: [{ role: 'user', content }] } as Anthropic.MessageStreamParams).finalMessage();
      const tu = msg.content.find((c): c is Anthropic.ToolUseBlock => c.type === 'tool_use');
      if (!tu) throw new Error('no tool output');
      return { out: tu.input as T, model: model.label };
    } catch (e) {
      const m = (e as Error).message; log.warn({ model: model.id, err: m.slice(0, 200) }, 'review AI failed');
      if (isNotFound(m)) { if (markMissing(model.id, order[0])) continue; }
      order = order.slice(1);
    }
  }
  return null;
}
const strs = (x: unknown) => (Array.isArray(x) ? x.filter((y): y is string => typeof y === 'string') : typeof x === 'string' ? x.split(/\n+/).filter(Boolean) : []);
const now = () => new Date().toISOString();

export function rulesSection(s: ReviewSection): ReviewSectionAI {
  const top = s.ruleFindings[0];
  return { headline: top ?? s.lead, summary: `${s.lead} ${s.ruleFindings.slice(0, 2).join(' ')}`, insights: s.ruleFindings.slice(0, 3), findings: s.ruleFindings, recommendations: [], notes: s.notes, source: 'rules', at: now() };
}
export function rulesGlance(rv: Review): ReviewGlanceAI {
  const P = rv.period; const rev = rv.scorecard.find((k) => k.id === 'revenue');
  return { headline: rev ? `${rv.scope}: ${fmtVal(rev.value, 'currency')} revenue in ${P.label}, ${fmtChg(rev)} vs ${P.prevLabel}.` : `${rv.scope} — ${P.label}`, tagline: 'Executive Performance Review',
    summary: rv.sections.map((s) => s.ruleFindings[0]).filter(Boolean).join(' '), insights: rv.sections.flatMap((s) => s.ruleFindings.slice(0, 1)),
    highlights: rv.sections.map((s) => ({ section: s.id, text: s.ruleFindings[0] ?? s.lead })), watch: rv.sections.flatMap((s) => s.ruleFindings.filter((f) => /attention/.test(f))).slice(0, 4), notes: rv.glance.notes, source: 'rules', at: now() };
}

export async function writeSection(rv: Review, sid: string, tier: Tier = 'balanced'): Promise<ReviewSectionAI> {
  const s = rv.sections.find((x) => x.id === sid);
  if (!s) throw new Error('Unknown section');
  const ids = [...s.charts.map((c) => c.id), ...s.tables.map((t) => t.id)];
  const tool: Anthropic.Tool = { name: 'write_section', description: 'Write the commentary for one review section.', input_schema: { type: 'object', properties: {
    headline: { type: 'string', description: 'One decisive sentence with the key number.' }, summary: { type: 'string', description: '90–140 words: performance vs all three baselines, drivers, implications.' },
    insights: { type: 'array', items: { type: 'string' }, description: '3–4 sharp insights a template would miss (connections, outliers, inflections).' },
    findings: { type: 'array', items: { type: 'string' }, description: '4–6 evidence findings with numbers and named entities.' },
    recommendations: recSchema, notes: notesSchema(ids),
  }, required: ['headline', 'summary', 'insights', 'findings', 'recommendations', 'notes'] } as Anthropic.Tool['input_schema'] };
  const res = await callTool<Partial<ReviewSectionAI>>(tool, sectionDigest(rv, s), tier);
  if (!res) return rulesSection(s);
  const o = res.out; const fb = rulesSection(s);
  const notes = typeof o.notes === 'object' && o.notes ? Object.fromEntries(Object.entries(o.notes).filter(([k, v]) => ids.includes(k) && typeof v === 'string')) : {};
  return { headline: o.headline || fb.headline, summary: o.summary || fb.summary, insights: strs(o.insights), findings: strs(o.findings).length ? strs(o.findings) : fb.findings,
    recommendations: (Array.isArray(o.recommendations) ? o.recommendations : []).filter((r) => r && r.title), notes: { ...s.notes, ...notes }, model: res.model, source: 'ai', at: now() };
}
export async function writeGlance(rv: Review, tier: Tier = 'balanced'): Promise<ReviewGlanceAI> {
  const ids = [...rv.glance.charts.map((c) => c.id), ...rv.glance.tables.map((t) => t.id)];
  const secIds = rv.sections.map((s) => s.id);
  const tool: Anthropic.Tool = { name: 'write_glance', description: 'Write the cover headline and the At a glance page.', input_schema: { type: 'object', properties: {
    headline: { type: 'string', description: 'The review\'s main headline: one sentence, the single most important story with its number.' },
    tagline: { type: 'string', description: '4–8 words capturing the period\'s mood.' },
    summary: { type: 'string', description: '160–220 words in 2 short paragraphs (blank line between): the whole studio story across sales, attendance, funnel, classes, trainers, formats and churn.' },
    insights: { type: 'array', items: { type: 'string' }, description: '5–7 very useful, non-obvious insights connecting areas.' },
    highlights: { type: 'array', description: 'One key finding per section, in order.', items: { type: 'object', properties: { section: { type: 'string', enum: secIds }, text: { type: 'string' } }, required: ['section', 'text'] } },
    watch: { type: 'array', items: { type: 'string' }, description: '3–4 watch-outs.' }, notes: notesSchema(ids),
  }, required: ['headline', 'tagline', 'summary', 'insights', 'highlights', 'watch', 'notes'] } as Anthropic.Tool['input_schema'] };
  const res = await callTool<Partial<ReviewGlanceAI>>(tool, glanceDigest(rv), tier);
  const fb = rulesGlance(rv);
  if (!res) return fb;
  const o = res.out;
  return { headline: o.headline || fb.headline, tagline: o.tagline || fb.tagline, summary: o.summary || fb.summary, insights: strs(o.insights).length ? strs(o.insights) : fb.insights,
    highlights: (Array.isArray(o.highlights) ? o.highlights : []).filter((h) => h && secIds.includes(h.section as ReviewSectionId)), watch: strs(o.watch),
    notes: { ...rv.glance.notes, ...(typeof o.notes === 'object' && o.notes ? Object.fromEntries(Object.entries(o.notes).filter(([k, v]) => ids.includes(k) && typeof v === 'string')) : {}) }, model: res.model, source: 'ai', at: now() };
}
export function verify(rv: Review, ai: ReviewAI) {
  const entry = cache.get(rv.id); if (!entry) return undefined;
  const text = [ai.glance?.headline, ai.glance?.summary, ...(ai.glance?.insights ?? []), ...Object.values(ai.sections).flatMap((s) => [s.headline, s.summary, ...s.findings])].filter(Boolean).join('\n');
  return verifyNarrative(text, entry.report.results);
}
export function remember(rv: Review) { if (!cache.has(rv.id)) cache.set(rv.id, { review: rv, report: { results: [] } as unknown as Report }); }
