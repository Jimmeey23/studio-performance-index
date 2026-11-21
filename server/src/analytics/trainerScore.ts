/**
 * Trainer scorecard — a composite, context-aware ranking of trainers.
 *
 * Inputs are governed data: sessions (classes, check-ins, capacity, class revenue, late cancels)
 * and the New sheet (new clients by first-visit trainer, with their first-visit type and outcome).
 * Each trainer is scored against peers in the same scope (all studios, or one studio):
 *
 *   points  = Σ weight × percentile(component)                 (0–100)
 *   penalty = late cancels (vs the studio norm) + empty classes + short tenure
 *   score   = clamp(points − penalty, 0, 100); tiers A ≥ 70, B 55–70, C 40–55, D < 40
 *
 * Fairness
 *  • Conversion and retention are judged against what the trainer's own mix of new clients should
 *    produce (a hosted-class guest converts far less often than a trial-class client), i.e.
 *    actual − expected, where expected = Σ new clients of each first-visit type × that type's rate.
 *  • Their weight scales with sample size (full from 30 new clients); unused weight moves to
 *    attendance and fill, so trainers who mostly teach regulars or hosted guests aren't penalised.
 *  • Late cancellations are compared with the studio's own rate, since studios differ a lot.
 *  • Only trainers with enough sessions are ranked; the rest are listed separately.
 */
import crypto from 'node:crypto';
import { runMetricsQuery, type Column } from '../semantic/engine.js';
import { warehouse, sqlString } from '../warehouse/db.js';
import { loadRules } from '../warehouse/rules.js';
import type { AnalysisResult } from './analyses.js';

export interface TrainerRow {
  teacher: string; rank: number | null; score: number | null; tier: string | null; eligible: boolean;
  classes: number; non_empty: number; empty_classes: number; empty_rate: number | null; class_checkins: number; class_average: number | null; fill_rate: number | null;
  class_revenue: number; revenue_share: number | null; cum_share: number | null; revenue_per_class: number | null; late_cancels: number; late_cancel_rate: number | null; lc_ratio: number | null;
  trials: number; new_clients: number; converted: number; conversion_rate: number | null; retained: number; retention_rate: number | null;
  exp_converted: number | null; excess_converted: number | null; exp_retained: number | null; excess_retained: number | null; conv_weight: number;
  experience_months: number | null; career_classes: number;
  pts_attendance: number; pts_fill: number; pts_conversion: number; pts_retention: number; pts_revenue: number; pts_rpc: number; pts_volume: number;
  pen_late: number; pen_empty: number; pen_experience: number;
}
export interface ScopeScore {
  scope: string; location: string | null; rows: TrainerRow[]; minClasses: number;
  rates: { conversion: number | null; retention: number | null; lateCancel: number | null; emptyRate: number | null };
  mix: { type: string; clients: number; conversion: number | null; retention: number | null }[];
  totals: Record<string, number | null>;
}

export const WEIGHTS = { attendance: 20, fill: 20, conversion: 20, retention: 12, revenue: 12, rpc: 8, volume: 8 } as const;
export const PENALTIES = { late: 8, empty: 6, tenure: 6 } as const;
export const FULL_CONFIDENCE_N = 30;
export const tierOf = (s: number) => (s >= 70 ? 'A' : s >= 55 ? 'B' : s >= 40 ? 'C' : 'D');

const num = (v: unknown) => (v === null || v === undefined || !isFinite(Number(v)) ? null : Number(v));
const n0 = (v: unknown) => num(v) ?? 0;
const r1 = (x: number) => Math.round(x * 10) / 10;
function pct(values: number[], v: number): number {
  if (values.length <= 1) return 50;
  const below = values.filter((x) => x < v).length, equal = values.filter((x) => x === v).length;
  return ((below + (equal - 1) / 2) / (values.length - 1)) * 100;
}
const median = (xs: number[]) => { if (!xs.length) return null; const s = [...xs].sort((a, b) => a - b); const m = Math.floor(s.length / 2); return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const monthsBetween = (a: string, b: string) => (Number(b.slice(0, 4)) - Number(a.slice(0, 4))) * 12 + Number(b.slice(5, 7)) - Number(a.slice(5, 7)) + 1;

/** Consolidated locations (e.g. all pop-ups and partner studios reported as "Pop-ups"). */
const groups = () => loadRules().reporting.location_groups ?? {};
export const groupMembers = (label: string) => groups()[label] ?? [label];
const groupOf = (loc: string) => Object.entries(groups()).find(([, ms]) => ms.some((m) => m.toLowerCase() === loc.toLowerCase()))?.[0] ?? loc;

/** Career start (first class on record, any studio) and career sessions per trainer. */
async function careers(end: string) {
  const db = await warehouse();
  const rows = await db.all<{ teacher: string; first: string; classes: number }>(`select teacher, strftime(min(session_ts), '%Y-%m') as first, count(*) as classes from fct_sessions where is_past and session_ts::date <= ${sqlString(end)} and coalesce(trim(teacher), '') <> '' group by 1`);
  return new Map(rows.map((r) => [String(r.teacher), { first: String(r.first), classes: Number(r.classes) }]));
}
/** New clients by trainer × first-visit type (the client mix) with outcomes. */
async function mixRows(start: string, end: string, locs: string[] | null) {
  const db = await warehouse();
  const lf = locs ? ` and lower(first_visit_location) in (${locs.map((l) => sqlString(l.toLowerCase())).join(', ')})` : '';
  return db.all<{ teacher: string; type: string; n: number; conv: number; ret: number }>(`select coalesce(nullif(trim(first_visit_teacher), ''), '(blank)') as teacher, coalesce(nullif(trim(is_new_label), ''), 'Unknown') as type,
    count(*) as n, count(*) filter (where is_converted) as conv, count(*) filter (where is_retained) as ret
    from fct_new_clients where is_new_client and first_visit_ts::date between ${sqlString(start)} and ${sqlString(end)}${lf} group by 1, 2`);
}

async function scoreScope(start: string, end: string, location: string | null, career: Map<string, { first: string; classes: number }>, minClasses: number): Promise<ScopeScore> {
  const members = location ? groupMembers(location) : null;
  const loc = members ? [{ dimension: 'location', op: 'in' as const, values: members }] : [];
  const notBlank = { dimension: 'teacher', op: 'not_in' as const, values: ['(blank)'] };
  const [s, tr, mx, tot] = await Promise.all([
    runMetricsQuery({ metrics: ['classes', 'non_empty_classes', 'empty_classes', 'class_checkins', 'class_average', 'fill_rate', 'class_revenue', 'revenue_per_class', 'class_late_cancels', 'class_late_cancel_rate'], dimensions: ['teacher'], start, end, filters: [...loc, notBlank], limit: 1000 }),
    runMetricsQuery({ metrics: ['trials'], dimensions: ['teacher'], start, end, filters: [...loc, notBlank], limit: 1000 }).catch(() => ({ rows: [] as Record<string, unknown>[] })), // trials need the rebuilt warehouse
    mixRows(start, end, members),
    runMetricsQuery({ metrics: ['fill_rate', 'class_average', 'class_late_cancel_rate'], start, end, filters: [...loc, notBlank] }),
  ]);
  const trBy = new Map(tr.rows.map((x) => [String(x.teacher), n0(x.trials)]));
  // scope-wide conversion / retention per first-visit type → each trainer's expected outcomes
  const byType = new Map<string, { n: number; conv: number; ret: number }>();
  for (const m of mx) { const t = byType.get(m.type) ?? { n: 0, conv: 0, ret: 0 }; t.n += Number(m.n); t.conv += Number(m.conv); t.ret += Number(m.ret); byType.set(m.type, t); }
  const typeRate = (t: string) => { const x = byType.get(t); return x && x.n ? { c: x.conv / x.n, r: x.ret / x.n } : { c: 0, r: 0 }; };
  const perT = new Map<string, { n: number; conv: number; ret: number; expC: number; expR: number }>();
  for (const m of mx) { const p = perT.get(m.teacher) ?? { n: 0, conv: 0, ret: 0, expC: 0, expR: 0 }; const tr8 = typeRate(m.type); p.n += Number(m.n); p.conv += Number(m.conv); p.ret += Number(m.ret); p.expC += Number(m.n) * tr8.c; p.expR += Number(m.n) * tr8.r; perT.set(m.teacher, p); }
  const totNew = [...byType.values()].reduce((a, x) => a + x.n, 0), totConv = [...byType.values()].reduce((a, x) => a + x.conv, 0), totRet = [...byType.values()].reduce((a, x) => a + x.ret, 0);
  const totalRev = s.rows.reduce((a, x) => a + n0(x.class_revenue), 0);
  const endM = end.slice(0, 7);

  let rows: TrainerRow[] = s.rows.map((x) => {
    const t = String(x.teacher); const p = perT.get(t); const cr = career.get(t); const classes = n0(x.classes);
    const nNew = p?.n ?? 0;
    return {
      teacher: t, rank: null, score: null, tier: null, eligible: classes >= minClasses,
      classes, non_empty: n0(x.non_empty_classes), empty_classes: n0(x.empty_classes), empty_rate: classes ? n0(x.empty_classes) / classes : null,
      class_checkins: n0(x.class_checkins), class_average: num(x.class_average), fill_rate: num(x.fill_rate),
      class_revenue: n0(x.class_revenue), revenue_share: totalRev ? n0(x.class_revenue) / totalRev : null, cum_share: null, revenue_per_class: num(x.revenue_per_class),
      late_cancels: n0(x.class_late_cancels), late_cancel_rate: num(x.class_late_cancel_rate), lc_ratio: null,
      trials: trBy.get(t) ?? 0, new_clients: nNew, converted: p?.conv ?? 0, conversion_rate: nNew ? (p!.conv / nNew) : null, retained: p?.ret ?? 0, retention_rate: nNew ? (p!.ret / nNew) : null,
      exp_converted: p ? r1(p.expC) : null, excess_converted: p ? r1(p.conv - p.expC) : null, exp_retained: p ? r1(p.expR) : null, excess_retained: p ? r1(p.ret - p.expR) : null,
      conv_weight: Math.min(1, nNew / FULL_CONFIDENCE_N),
      experience_months: cr ? monthsBetween(cr.first, endM) : null, career_classes: cr?.classes ?? classes,
      pts_attendance: 0, pts_fill: 0, pts_conversion: 0, pts_retention: 0, pts_revenue: 0, pts_rpc: 0, pts_volume: 0, pen_late: 0, pen_empty: 0, pen_experience: 0,
    };
  });

  const el = rows.filter((r) => r.eligible);
  const vals = (f: (r: TrainerRow) => number | null) => el.map(f).filter((v): v is number => v !== null);
  const excessRate = (r: TrainerRow, k: 'c' | 'r') => (r.new_clients ? ((k === 'c' ? r.excess_converted : r.excess_retained) ?? 0) / (r.new_clients + 10) : 0); // shrunk per-client excess
  const V = { att: vals((r) => r.class_average), fill: vals((r) => r.fill_rate), conv: el.map((r) => excessRate(r, 'c')), ret: el.map((r) => excessRate(r, 'r')), rev: vals((r) => r.class_revenue), rpc: vals((r) => r.revenue_per_class), vol: vals((r) => r.classes) };
  const lcScope = (() => { const b = el.reduce((a, r) => a + r.late_cancels, 0); const rate = median(vals((r) => r.late_cancel_rate)); return b ? rate : rate; })();
  const emptyMed = median(vals((r) => r.empty_rate));
  for (const r of el) {
    const conf = r.conv_weight;
    const wConv = WEIGHTS.conversion * conf, wRet = WEIGHTS.retention * conf;
    const spare = WEIGHTS.conversion + WEIGHTS.retention - wConv - wRet;
    const wAtt = WEIGHTS.attendance + spare / 2, wFill = WEIGHTS.fill + spare / 2;
    const p = (arr: number[], v: number | null) => (v === null ? 50 : pct(arr, v)) / 100;
    r.pts_attendance = r1(wAtt * p(V.att, r.class_average));
    r.pts_fill = r1(wFill * p(V.fill, r.fill_rate));
    r.pts_conversion = r1(wConv * p(V.conv, excessRate(r, 'c')));
    r.pts_retention = r1(wRet * p(V.ret, excessRate(r, 'r')));
    r.pts_revenue = r1(WEIGHTS.revenue * p(V.rev, r.class_revenue));
    r.pts_rpc = r1(WEIGHTS.rpc * p(V.rpc, r.revenue_per_class));
    r.pts_volume = r1(WEIGHTS.volume * p(V.vol, r.classes));
    r.lc_ratio = lcScope && r.late_cancel_rate !== null ? Math.round((r.late_cancel_rate / lcScope) * 100) / 100 : null;
    r.pen_late = r.lc_ratio && r.lc_ratio > 1 ? r1(Math.min(PENALTIES.late, (r.lc_ratio - 1) * 16)) : 0;
    r.pen_empty = emptyMed !== null && r.empty_rate !== null && r.empty_rate > emptyMed ? r1(Math.min(PENALTIES.empty, (r.empty_rate - emptyMed) * 60)) : 0;
    const m = r.experience_months ?? 99;
    r.pen_experience = m < 6 ? 6 : m < 12 ? 4 : m < 18 ? 2 : 0;
    const pts = r.pts_attendance + r.pts_fill + r.pts_conversion + r.pts_retention + r.pts_revenue + r.pts_rpc + r.pts_volume;
    r.score = r1(Math.max(0, Math.min(100, pts - r.pen_late - r.pen_empty - r.pen_experience)));
    r.tier = tierOf(r.score);
  }
  rows = [...el.sort((a, b) => (b.score ?? 0) - (a.score ?? 0) || b.class_checkins - a.class_checkins), ...rows.filter((r) => !r.eligible).sort((a, b) => b.classes - a.classes)];
  el.forEach((r, i) => { r.rank = i + 1; });
  let cum = 0; for (const r of [...rows].sort((a, b) => b.class_revenue - a.class_revenue)) { cum += r.revenue_share ?? 0; r.cum_share = cum; }
  const sum = (f: (r: TrainerRow) => number) => rows.reduce((a, r) => a + f(r), 0);
  const classes = sum((r) => r.classes), checkins = sum((r) => r.class_checkins), nonEmpty = sum((r) => r.non_empty);
  const lcAll = s.rows.length ? (() => { const late = sum((r) => r.late_cancels); return late; })() : 0;
  return {
    scope: location ?? 'All studios', location, rows, minClasses,
    rates: { conversion: totNew ? totConv / totNew : null, retention: totNew ? totRet / totNew : null, lateCancel: lcScope, emptyRate: emptyMed },
    mix: [...byType.entries()].map(([type, x]) => ({ type, clients: x.n, conversion: x.n ? x.conv / x.n : null, retention: x.n ? x.ret / x.n : null })).sort((a, b) => b.clients - a.clients),
    totals: { fill_rate: num(tot.rows[0]?.fill_rate), late_cancel_rate: num(tot.rows[0]?.class_late_cancel_rate), classes, non_empty: nonEmpty, empty_classes: sum((r) => r.empty_classes), class_checkins: checkins, class_average: nonEmpty ? checkins / nonEmpty : null,
      class_revenue: totalRev, revenue_share: totalRev ? 1 : null, revenue_per_class: classes ? totalRev / classes : null, late_cancels: lcAll,
      trials: [...trBy.values()].reduce((a, b) => a + b, 0), new_clients: totNew, converted: totConv, conversion_rate: totNew ? totConv / totNew : null, retained: totRet, retention_rate: totNew ? totRet / totNew : null,
      exp_converted: totConv, excess_converted: 0, exp_retained: totRet, excess_retained: 0 },
  };
}

/** Scorecards for all studios combined and each studio (or location group) separately. */
export async function trainerScorecards(input: { start: string; end: string; locations?: string[]; minClasses?: number }) {
  const months = Math.max(1, monthsBetween(input.start.slice(0, 7), input.end.slice(0, 7)));
  const career = await careers(input.end);
  const minAll = input.minClasses ?? Math.max(10, Math.round(3 * months));
  const all = await scoreScope(input.start, input.end, input.locations?.length === 1 ? groupOf(input.locations[0]) : null, career, minAll);
  let locs = input.locations ?? [];
  if (!locs.length) {
    const r = await runMetricsQuery({ metrics: ['classes'], dimensions: ['location'], start: input.start, end: input.end, filters: [{ dimension: 'location', op: 'not_in', values: ['(blank)'] }], limit: 50 });
    const byGroup = new Map<string, number>();
    for (const x of r.rows) { const g = groupOf(String(x.location)); byGroup.set(g, (byGroup.get(g) ?? 0) + n0(x.classes)); }
    locs = [...byGroup.entries()].filter(([, c]) => c >= Math.max(20, 3 * months)).sort((a, b) => b[1] - a[1]).map(([g]) => g);
  } else locs = [...new Set(locs.map(groupOf))];
  const perStudio = locs.length > 1 || (!input.locations?.length && locs.length) ? await Promise.all(locs.map((l) => scoreScope(input.start, input.end, l, career, Math.max(6, Math.round(1.5 * months))))) : [];
  return { all, perStudio, months };
}

/* ── shaping into report tables ── */
const rid = () => 'r_' + crypto.randomBytes(5).toString('hex');
const col = (key: string, label: string, format: string, kind: Column['kind'] = 'metric') => ({ key, label, kind, format } as Column);
function result(title: string, columns: Column[], rows: Record<string, unknown>[], totals?: Record<string, unknown>, notes: string[] = []): AnalysisResult {
  return { id: rid(), kind: 'trainer_scorecard', title, columns, rows, totals, sql: [], sources: ['Day End Report - Part 3 › Sessions (fct_sessions)', 'Day End Report - Part 1 › New (fct_new_clients)'], definitions: [], notes, checks: [], verified: true, rowCount: rows.length };
}
const asRows = (rs: TrainerRow[]) => rs as unknown as Record<string, unknown>[];
export function rankingTable(s: ScopeScore, limit = 30) {
  return result(`Composite ranking — ${s.scope}`, [col('teacher', 'Trainer', 'text', 'dimension'), col('rank', '#', 'number'), col('tier', 'Tier', 'text'), col('score', 'Score /100', 'decimal'), col('classes', 'Sessions', 'number'), col('non_empty', 'Non-empty', 'number'), col('empty_classes', 'Empty', 'number'),
    col('class_average', 'Avg att.', 'decimal'), col('fill_rate', 'Fill', 'percent'), col('class_revenue', 'Revenue', 'currency'), col('lc_ratio', 'LC vs norm ×', 'decimal'), col('experience_months', 'Tenure (mo)', 'number')],
  asRows(s.rows.filter((r) => r.eligible).slice(0, limit)));
}
export function breakdownTable(s: ScopeScore, limit = 30) {
  return result(`Points by component — ${s.scope}`, [col('teacher', 'Trainer', 'text', 'dimension'), col('pts_attendance', `Attend. ${WEIGHTS.attendance}`, 'decimal'), col('pts_fill', `Fill ${WEIGHTS.fill}`, 'decimal'), col('pts_conversion', `Conv. ${WEIGHTS.conversion}`, 'decimal'), col('pts_retention', `Retent. ${WEIGHTS.retention}`, 'decimal'),
    col('pts_revenue', `Revenue ${WEIGHTS.revenue}`, 'decimal'), col('pts_rpc', `₹/class ${WEIGHTS.rpc}`, 'decimal'), col('pts_volume', `Sessions ${WEIGHTS.volume}`, 'decimal'), col('pen_late', `Late −${PENALTIES.late}`, 'decimal'), col('pen_empty', `Empty −${PENALTIES.empty}`, 'decimal'), col('pen_experience', `Tenure −${PENALTIES.tenure}`, 'decimal'), col('conv_weight', 'Conv. weight', 'percent'), col('score', 'Score', 'decimal')],
  asRows(s.rows.filter((r) => r.eligible).slice(0, limit)));
}
export function contributionTable(s: ScopeScore, limit = 30) {
  const rows = [...s.rows].sort((a, b) => b.class_revenue - a.class_revenue).slice(0, limit);
  return result(`Revenue contribution — ${s.scope}`, [col('teacher', 'Trainer', 'text', 'dimension'), col('class_revenue', 'Class revenue', 'currency'), col('revenue_share', 'Share', 'percent'), col('cum_share', 'Cumulative', 'percent'), col('revenue_per_class', '₹ / class', 'currency'), col('classes', 'Sessions', 'number'), col('class_checkins', 'Check-ins', 'number'), col('rank', 'Score rank', 'number')],
    asRows(rows), s.totals);
}
export function conversionTable(s: ScopeScore, limit = 30, byRevenue = false) {
  const base = s.rows.filter((r) => r.new_clients > 0 || r.eligible);
  const rows = (byRevenue ? [...base].sort((a, b) => b.class_revenue - a.class_revenue) : [...base].sort((a, b) => (b.excess_converted ?? -99) - (a.excess_converted ?? -99))).slice(0, limit);
  return result(byRevenue ? `Top trainers by revenue — conversion & retention vs expected, ${s.scope}` : `Conversion & retention vs expected — ${s.scope}`,
    [col('teacher', 'Trainer', 'text', 'dimension'), ...(byRevenue ? [col('class_revenue', 'Revenue', 'currency')] : []), col('trials', 'Trials', 'number'), col('new_clients', 'New clients', 'number'), col('converted', 'Converted', 'number'), col('conversion_rate', 'Conv. %', 'percent'), col('exp_converted', 'Expected', 'decimal'), col('excess_converted', 'vs exp.', 'decimal'),
      col('retained', 'Retained', 'number'), col('retention_rate', 'Ret. %', 'percent'), col('excess_retained', 'Ret. vs exp.', 'decimal')],
    asRows(rows), byRevenue ? undefined : s.totals);
}
export function mixTable(s: ScopeScore) {
  return result(`Why the client mix matters — ${s.scope}`, [col('type', 'First-visit type', 'text', 'dimension'), col('clients', 'Clients', 'number'), col('conversion', 'Conv. %', 'percent'), col('retention', 'Ret. %', 'percent')],
    s.mix as unknown as Record<string, unknown>[]);
}
export function scoreChart(s: ScopeScore, top = 15) {
  return result(`Composite score — top ${top}, ${s.scope}`, [col('teacher', 'Trainer', 'text', 'dimension'), col('score', 'Composite score', 'decimal')], s.rows.filter((r) => r.eligible).slice(0, top).map((r) => ({ teacher: r.teacher, score: r.score })));
}
export function revenueChart(s: ScopeScore, top = 15) {
  return result(`Class revenue by trainer — ${s.scope}`, [col('teacher', 'Trainer', 'text', 'dimension'), col('class_revenue', 'Class revenue', 'currency')], [...s.rows].sort((a, b) => b.class_revenue - a.class_revenue).slice(0, top).map((r) => ({ teacher: r.teacher, class_revenue: r.class_revenue })));
}
export function excessChart(s: ScopeScore, top = 15) {
  const rows = s.rows.filter((r) => r.new_clients >= 10).sort((a, b) => (b.excess_converted ?? 0) - (a.excess_converted ?? 0));
  const pick = rows.length > top ? [...rows.slice(0, Math.ceil(top / 2)), ...rows.slice(-Math.floor(top / 2))] : rows;
  return result(`Converted vs expected (net clients) — ${s.scope}`, [col('teacher', 'Trainer', 'text', 'dimension'), col('excess_converted', 'Converted vs expected', 'decimal')], pick.map((r) => ({ teacher: r.teacher, excess_converted: r.excess_converted })));
}
export function shareChart(s: ScopeScore, top = 8) {
  const rows = [...s.rows].sort((a, b) => b.class_revenue - a.class_revenue);
  const head = rows.slice(0, top).map((r) => ({ teacher: r.teacher, class_revenue: r.class_revenue }));
  const rest = rows.slice(top).reduce((a, r) => a + r.class_revenue, 0);
  return result(`Class revenue share — ${s.scope}`, [col('teacher', 'Trainer', 'text', 'dimension'), col('class_revenue', 'Class revenue', 'currency')], rest > 0 ? [...head, { teacher: 'All other trainers', class_revenue: rest }] : head);
}
export const methodNotes = (s: ScopeScore) => [
  `Ranked: trainers with at least ${s.minClasses} sessions (${s.rows.filter((r) => r.eligible).length} of ${s.rows.length}).${s.rows.some((r) => !r.eligible) ? ` Not ranked: ${s.rows.filter((r) => !r.eligible).slice(0, 12).map((r) => `${r.teacher} (${r.classes})`).join(', ')}${s.rows.filter((r) => !r.eligible).length > 12 ? '…' : ''}.` : ''}`,
];
export const METHOD = [
  { term: 'Composite score (0–100)', text: `Points against peers in the same scope: attendance ${WEIGHTS.attendance}, fill rate ${WEIGHTS.fill}, new-client conversion ${WEIGHTS.conversion}, retention ${WEIGHTS.retention}, class revenue ${WEIGHTS.revenue}, revenue per class ${WEIGHTS.rpc}, sessions ${WEIGHTS.volume} — minus up to ${PENALTIES.late} for late cancellations, ${PENALTIES.empty} for empty classes and ${PENALTIES.tenure} for short tenure. Each component is the trainer's percentile among ranked peers × its weight.` },
  { term: 'Tiers', text: 'A ≥ 70; B 55–70; C 40–55; D < 40.' },
  { term: 'Conversion vs expected', text: `Each first-visit type converts and retains at its own rate (a hosted-class guest far less often than a trial-class client). Expected = Σ the trainer's new clients of each type × that type's rate in the scope; the score uses actual − expected. Weight scales with sample size — full from ${FULL_CONFIDENCE_N} new clients; the unused weight moves to attendance and fill, so no one is penalised for teaching mostly regulars or hosted guests.` },
  { term: 'Late cancellations', text: 'Compared with the norm for the scope (the median trainer late-cancel rate), shown as a ratio — 1.30× means 30% above the norm. Penalty grows with the excess, up to −8.' },
  { term: 'Empty classes & tenure', text: 'Empty-class rate above the scope median costs up to −6. Tenure = months since the first class on record (the synced data starts January 2024): −6 under 6 months, −4 under 12, −2 under 18.' },
  { term: 'Sessions', text: 'Classes held.' },
  { term: 'Non-empty / Empty', text: 'Classes with / without any check-ins.' },
  { term: 'Avg att.', text: 'Check-ins ÷ non-empty classes.' },
  { term: 'Fill', text: 'Check-ins ÷ capacity.' },
  { term: 'Class revenue', text: 'Momence per-visit value attributed to the class.' },
  { term: 'Trials', text: 'Every member who attended a first visit with the trainer (New sheet).' },
  { term: 'New clients', text: 'Trials whose “Is New” value contains “new”.' },
  { term: 'Converted / Retained', text: 'New clients who bought / kept coming (Day End Report status).' },
];

/* ── trainer-centred narrative helpers ── */
const pctS = (v: number | null, d = 1) => (v === null ? '—' : `${(v * 100).toFixed(d)}%`);
const inr = (v: number) => (v >= 1e7 ? `₹${(v / 1e7).toFixed(2)}Cr` : v >= 1e5 ? `₹${(v / 1e5).toFixed(2)}L` : `₹${Math.round(v).toLocaleString('en-IN')}`);
const sg = (v: number | null) => (v === null ? '—' : `${v >= 0 ? '+' : ''}${v.toFixed(1)}`);
const COMPONENTS: [keyof TrainerRow, string, number][] = [['pts_attendance', 'attendance', WEIGHTS.attendance], ['pts_fill', 'fill rate', WEIGHTS.fill], ['pts_conversion', 'conversion', WEIGHTS.conversion], ['pts_retention', 'retention', WEIGHTS.retention], ['pts_revenue', 'revenue', WEIGHTS.revenue], ['pts_rpc', 'revenue per class', WEIGHTS.rpc]];

export interface TrainerProfile { teacher: string; rank: number; score: number; tier: string; classes: number; class_average: number | null; fill_rate: number | null; conversion_rate: number | null; new_clients: number; converted: number; excess_converted: number | null; retention_rate: number | null; revenue_share: number | null; class_revenue: number; late_cancel_rate: number | null; strengths: string[]; focus: string[] }
export function trainerProfiles(s: ScopeScore, n = 5): TrainerProfile[] {
  return s.rows.filter((r) => r.eligible).slice(0, n).map((r) => {
    const share = (k: keyof TrainerRow, w: number) => { const eff = k === 'pts_conversion' || k === 'pts_retention' ? w * r.conv_weight : w; return eff > 0.5 ? Number(r[k]) / eff : null; };
    const strengths = COMPONENTS.filter(([k, , w]) => (share(k, w) ?? 0) >= 0.75).map(([, l]) => l).slice(0, 3);
    const focus = COMPONENTS.filter(([k, , w]) => { const x = share(k, w); return x !== null && x < 0.35; }).map(([, l]) => l).slice(0, 2);
    if (r.pen_late >= 2) focus.push('late cancels');
    if (r.pen_empty >= 2) focus.push('empty classes');
    return { teacher: r.teacher, rank: r.rank!, score: r.score!, tier: r.tier!, classes: r.classes, class_average: r.class_average, fill_rate: r.fill_rate, conversion_rate: r.conversion_rate, new_clients: r.new_clients, converted: r.converted, excess_converted: r.excess_converted, retention_rate: r.retention_rate, revenue_share: r.revenue_share, class_revenue: r.class_revenue, late_cancel_rate: r.late_cancel_rate, strengths, focus: focus.slice(0, 3) };
  });
}

/** Question-led answers about trainers (rule-based; AI commentary replaces them when available). */
export function trainerAnswers(s: ScopeScore) {
  const el = s.rows.filter((r) => r.eligible);
  const byRev = [...s.rows].sort((a, b) => b.class_revenue - a.class_revenue);
  const real = el.filter((r) => r.new_clients >= FULL_CONFIDENCE_N);
  const conv = [...real].sort((a, b) => (b.excess_converted ?? 0) - (a.excess_converted ?? 0));
  const ret = [...real].sort((a, b) => (b.excess_retained ?? 0) - (a.excess_retained ?? 0));
  const tierA = el.filter((r) => r.tier === 'A'), bottom = el.slice(-3).reverse();
  const top5Share = byRev.slice(0, 5).reduce((a, r) => a + (r.revenue_share ?? 0), 0);
  const q1 = {
    headline: el[0] ? `${el[0].teacher} (${el[0].score}) leads${el.length > 1 ? `, then ${el.slice(1, 4).map((r) => r.teacher).join(', ')}` : ''}; ${tierA.length} Tier A trainer${tierA.length === 1 ? '' : 's'}.` : 'No trainer met the minimum sessions.',
    points: [
      ...el.slice(0, 3).map((r) => `${r.teacher} — ${r.score}/100 (Tier ${r.tier}): average attendance ${r.class_average?.toFixed(1) ?? '—'}, fill ${pctS(r.fill_rate, 0)}, ${inr(r.class_revenue)} class revenue${r.new_clients >= FULL_CONFIDENCE_N ? `, ${sg(r.excess_converted)} conversions vs expected` : ''}.`),
      ...(bottom.length ? [`Needs attention: ${bottom.map((r) => `${r.teacher} (${r.score}${r.empty_classes ? `, ${r.empty_classes} empty classes` : ''})`).join('; ')}.`] : []),
    ],
  };
  const q2 = {
    headline: `${inr(s.totals.class_revenue ?? 0)} class revenue in total; ${byRev[0]?.teacher ?? '—'} leads with ${inr(byRev[0]?.class_revenue ?? 0)}; the top 5 bring in ${pctS(top5Share, 0)}.`,
    points: byRev.slice(0, 5).map((r) => `${r.teacher}: ${inr(r.class_revenue)} (${pctS(r.revenue_share)}), ${inr(r.revenue_per_class ?? 0)} per class across ${r.classes} sessions.`),
  };
  const q3 = {
    headline: `${s.totals.converted} of ${s.totals.new_clients} new clients converted (${pctS(s.rates.conversion)}), ${s.totals.retained} retained (${pctS(s.rates.retention)}).${conv[0] ? ` Best vs expected: ${conv.slice(0, 2).map((r) => `${r.teacher} (${sg(r.excess_converted)})`).join(', ')}.` : ''}`,
    points: [
      ...(conv.length ? [`Above expectation: ${conv.slice(0, 4).filter((r) => (r.excess_converted ?? 0) > 0).map((r) => `${r.teacher} ${sg(r.excess_converted)} converted (${pctS(r.conversion_rate)} of ${r.new_clients})`).join('; ')}.`] : []),
      ...(conv.length > 3 ? [`Below expectation: ${conv.slice(-3).reverse().filter((r) => (r.excess_converted ?? 0) < 0).map((r) => `${r.teacher} ${sg(r.excess_converted)} (${pctS(r.conversion_rate)} of ${r.new_clients})`).join('; ')}.`] : []),
      ...(ret[0] ? [`Best retention vs expected: ${ret.slice(0, 3).map((r) => `${r.teacher} ${sg(r.excess_retained)}`).join(', ')}.`] : []),
      'Trainers with fewer than 30 new clients are shown but not judged on conversion — the sample is too small.',
    ],
  };
  const top = byRev.slice(0, 8);
  const good = top.filter((r) => r.new_clients >= 15 && (r.excess_converted ?? 0) > 0), weak = top.filter((r) => r.new_clients >= 15 && (r.excess_converted ?? 0) < 0);
  const q4 = {
    headline: `${good.length ? `${good.slice(0, 3).map((r) => r.teacher).join(', ')} combine high revenue with above-expected conversion` : 'No top earner converts above expectation'}${weak.length ? `; ${weak.slice(0, 3).map((r) => r.teacher).join(', ')} earn well but convert below` : ''}.`,
    points: top.map((r) => `${r.teacher}: ${inr(r.class_revenue)} · ${r.new_clients >= 15 ? `${r.converted} converted (${pctS(r.conversion_rate)}, ${sg(r.excess_converted)} vs expected), ${r.retained} retained (${pctS(r.retention_rate)})` : `${r.new_clients} new clients — too few to judge`}.`),
  };
  return { q1, q2, q3, q4 };
}
export function studioAnswer(s: ScopeScore) {
  const el = s.rows.filter((r) => r.eligible);
  const conv = el.filter((r) => r.new_clients >= 15).sort((a, b) => (b.excess_converted ?? 0) - (a.excess_converted ?? 0));
  return {
    headline: el[0] ? `${el[0].teacher} leads ${s.scope} (${el[0].score}).${conv[0] ? ` Best converter vs expected: ${conv[0].teacher} (${sg(conv[0].excess_converted)}).` : ''}` : `No trainer met the minimum sessions at ${s.scope}.`,
    points: [
      ...el.slice(0, 3).map((r) => `${r.teacher} — ${r.score} (Tier ${r.tier}): attendance ${r.class_average?.toFixed(1) ?? '—'}, fill ${pctS(r.fill_rate, 0)}, ${inr(r.class_revenue)}.`),
      ...(conv.length > 1 && (conv[conv.length - 1].excess_converted ?? 0) < 0 ? [`Lowest conversion vs expected: ${conv[conv.length - 1].teacher} (${sg(conv[conv.length - 1].excess_converted)}, ${pctS(conv[conv.length - 1].conversion_rate)} of ${conv[conv.length - 1].new_clients}).`] : []),
      ...el.filter((r) => (r.lc_ratio ?? 0) >= 1.3).slice(0, 2).map((r) => `${r.teacher}'s late-cancel rate is ${r.lc_ratio?.toFixed(2)}× the studio norm.`),
    ],
  };
}

/** Trainer-only highlights, watch-outs and recommendations (never studio-level KPIs). */
export function trainerInsights(sc: { all: ScopeScore; perStudio: ScopeScore[] }) {
  const s = sc.all; const el = s.rows.filter((r) => r.eligible);
  const highlights: string[] = []; const concerns: string[] = [];
  const recs: { title: string; detail: string; priority: 'high' | 'medium' | 'low'; kpi: string }[] = [];
  for (const r of el.slice(0, 3)) highlights.push(`${r.teacher} ranks #${r.rank} (${r.score}, Tier ${r.tier}): attendance ${r.class_average?.toFixed(2) ?? '—'} and ${pctS(r.fill_rate)} fill across ${r.classes} sessions.`);
  const topRev = [...s.rows].sort((a, b) => b.class_revenue - a.class_revenue)[0];
  if (topRev) highlights.push(`${topRev.teacher} contributes the most class revenue: ${inr(topRev.class_revenue)} (${pctS(topRev.revenue_share)} of the total).`);
  const real = el.filter((r) => r.new_clients >= FULL_CONFIDENCE_N).sort((a, b) => (b.excess_converted ?? 0) - (a.excess_converted ?? 0));
  if (real[0] && (real[0].excess_converted ?? 0) > 0) highlights.push(`Best converter against their client mix: ${real[0].teacher}, ${sg(real[0].excess_converted)} conversions vs expected (${pctS(real[0].conversion_rate)} of ${real[0].new_clients}).`);
  for (const r of real.filter((x) => (x.excess_converted ?? 0) <= -4).slice(-3).reverse()) {
    concerns.push(`${r.teacher} converts ${pctS(r.conversion_rate)} of ${r.new_clients} new clients — ${sg(r.excess_converted)} vs what their client mix should produce.`);
    recs.push({ title: `${r.teacher}: newcomer conversion coaching`, detail: `Shadow ${real[0]?.teacher ?? 'a top converter'} in newcomer classes; agree a post-class follow-up routine with the sales team. Aim to close the gap of about ${Math.abs(Math.round(r.excess_converted ?? 0))} conversions.`, priority: 'high', kpi: 'Conversion vs expected' });
  }
  for (const r of el.filter((x) => (x.lc_ratio ?? 0) >= 1.25).sort((a, b) => (b.lc_ratio ?? 0) - (a.lc_ratio ?? 0)).slice(0, 3)) {
    concerns.push(`${r.teacher}'s classes run a ${pctS(r.late_cancel_rate)} late-cancel rate — ${r.lc_ratio?.toFixed(2)}× the norm.`);
    recs.push({ title: `${r.teacher}: reduce late cancellations`, detail: 'Review slot timing and waitlist release; remind bookers 12 hours before class and apply the late-cancel policy consistently.', priority: 'medium', kpi: 'Late cancels vs norm' });
  }
  for (const r of el.filter((x) => x.pen_empty >= 2).slice(0, 2)) {
    concerns.push(`${r.teacher} had ${r.empty_classes} empty classes of ${r.classes} (${pctS(r.empty_rate, 0)}).`);
    recs.push({ title: `${r.teacher}: rebuild class demand`, detail: 'Move the weakest slots to proven times, co-teach a signature class with a Tier A trainer and feature the trainer on social channels for four weeks.', priority: 'medium', kpi: 'Empty classes / fill' });
  }
  for (const r of el.filter((x) => x.tier === 'A').slice(0, 2)) recs.push({ title: `${r.teacher}: use as a benchmark`, detail: `Give ${r.teacher} prime newcomer slots and have them run a peer session on class energy and retention habits.`, priority: 'low', kpi: 'Composite score' });
  const junior = el.filter((r) => (r.experience_months ?? 99) < 12);
  if (junior.length) recs.push({ title: 'Support newer trainers', detail: `${junior.map((r) => r.teacher).join(', ')} ${junior.length > 1 ? 'have' : 'has'} under a year of classes on record — schedule monthly observations and a mentor.`, priority: 'medium', kpi: 'Composite score' });
  return { highlights: highlights.slice(0, 6), concerns: concerns.slice(0, 6), recommendations: recs.slice(0, 8) };
}

/** Headline tiles for the trainer report: the scope's class and newcomer totals plus the ranked field. */
export function trainerHeadline(s: ScopeScore) {
  const el = s.rows.filter((r) => r.eligible); const T = s.totals;
  const k = (id: string, label: string, value: number | null, format: string, description: string, higherIsBetter?: boolean) =>
    ({ id, label, format, description, higherIsBetter, additive: false, value, prev: null, chg: null, ytd: null, chgYtd: null, ly: null, chgLy: null, series: [] as (number | null)[] });
  return [
    k('classes', `Sessions · ${T.empty_classes ?? 0} empty`, T.classes, 'number', 'Classes held in the period; empty = no check-ins.'),
    k('class_revenue', 'Class revenue', T.class_revenue, 'currency', 'Per-visit value attributed to classes.'),
    k('class_average', 'Avg attendance', T.class_average, 'decimal', 'Check-ins ÷ non-empty classes.'),
    k('fill_rate', 'Fill rate', T.fill_rate, 'percent', 'Check-ins ÷ capacity.'),
    k('new_clients', 'New clients', T.new_clients, 'number', 'Trials whose “Is New” value contains “new”.'),
    k('converted_clients', `Converted · ${pctS(T.conversion_rate)}`, T.converted, 'number', 'New clients who bought after their first visit.'),
    k('retained_clients', `Retained · ${pctS(T.retention_rate)}`, T.retained, 'number', 'New clients who kept coming.'),
    k('t_ranked', `Trainers ranked · ${el.filter((r) => r.tier === 'A').length} Tier A`, el.length, 'number', `Trainers with at least ${s.minClasses} sessions.`),
  ];
}
