/**
 * Extra, review-only analyses: richer tables and charts for each chapter of the
 * Executive Performance Review (attendance patterns, newcomer journeys, full
 * recurring-class tables, a wide trainer scorecard, a format comparison).
 * Every query is guarded — a missing model or metric drops that block, never the review.
 */
import crypto from 'node:crypto';
import { runMetricsQuery, type QueryResult } from '../semantic/engine.js';
import { backendFilters } from './backendAccounts.js';
import { log } from '../util/log.js';
import type { ReportChart, ReportTable } from './build.js';

type Req = { start: string; end: string; locations: string[] };
type Filter = { dimension: string; op: 'in' | 'not_in' | 'contains' | 'gte' | 'lte' | 'is_null' | 'not_null'; values: (string | number)[] };
type Opt = { filters?: Filter[]; sort?: string; dir?: 'asc' | 'desc'; limit?: number; grain?: 'month' | 'all'; start?: string; keep?: (r: Record<string, unknown>) => boolean };

const rid = (p: string) => `${p}${crypto.randomUUID().slice(0, 6)}`;
const loc = (req: Req): Filter[] => (req.locations.length ? [{ dimension: 'location', op: 'in', values: req.locations }] : []);
const noBlank = (d: string): Filter => ({ dimension: d, op: 'not_in', values: ['(blank)'] });
const monthsBack = (end: string, n: number) => { const d = new Date(end + 'T00:00:00Z'); return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - n + 1, 1)).toISOString().slice(0, 10); };

async function q(req: Req, metrics: string[], dims: string[], o: Opt = {}): Promise<QueryResult | null> {
  try {
    const r = await runMetricsQuery({ metrics, dimensions: dims, start: o.start ?? req.start, end: req.end, grain: o.grain ?? 'all', filters: [...loc(req), ...dims.filter((d) => d !== 'location').map(noBlank), ...backendFilters(dims), ...(o.filters ?? [])] as never,
      ...(o.sort ? { sort: { by: o.sort, dir: o.dir ?? 'desc' } } : {}), ...(o.limit && !o.keep ? { limit: o.limit } : {}) });
    if (o.keep) { r.rows = r.rows.filter(o.keep); if (o.limit) r.rows = r.rows.slice(0, o.limit); }
    return r.rows.length ? r : null;
  } catch (e) { log.warn({ err: (e as Error).message, metrics, dims }, 'review extra query failed'); return null; }
}
const table = (title: string, r: QueryResult | null, note?: string): ReportTable | null => (r ? { id: rid('xt'), title, result: { ...r, title } as unknown as ReportTable['result'], ...(note ? { note } : {}) } : null);
const chart = (title: string, r: QueryResult | null, kind: ReportChart['chart'], y?: string[], seriesBy?: string): ReportChart | null => (r ? { id: rid('xc'), title, chart: kind, result: { ...r, title } as unknown as ReportChart['result'], ...(y ? { y } : {}), ...(seriesBy ? { seriesBy } : {}) } : null);

/** Joins results that share one dimension (e.g. teacher) into one wide table, keeping each metric's own column. */
function join(base: QueryResult | null, others: (QueryResult | null)[], key: string): QueryResult | null {
  if (!base) return null;
  const out = { ...base, columns: [...base.columns], rows: base.rows.map((r) => ({ ...r })) } as QueryResult;
  const spec = { ...(base.spec as Record<string, unknown>) } as { metrics?: string[] };
  for (const o of others) {
    if (!o) continue;
    const add = o.columns.filter((c) => c.kind === 'metric' && !out.columns.some((x) => x.key === c.key));
    out.columns.push(...add);
    spec.metrics = [...(spec.metrics ?? []), ...add.map((c) => c.key)];
    const by = new Map(o.rows.map((r) => [String(r[key]), r]));
    for (const r of out.rows) { const m = by.get(String(r[key])); for (const c of add) r[c.key] = m ? m[c.key] : null; }
  }
  (out as unknown as { spec: unknown }).spec = spec;
  out.totals = undefined as unknown as QueryResult['totals'];
  return out;
}
const compact = <T>(xs: (T | null)[]) => xs.filter(Boolean) as T[];

const CLASS_METRICS = ['classes', 'class_checkins', 'class_average', 'class_average_all', 'fill_rate', 'capacity', 'empty_classes', 'empty_class_rate', 'sold_out_rate', 'high_fill_rate', 'low_fill_rate',
  'booking_fill_rate', 'class_show_up_rate', 'class_late_cancels', 'class_late_cancel_rate', 'class_revenue', 'revenue_per_class', 'revenue_per_attendee', 'revenue_per_seat', 'non_paid_rate', 'membership_att_share', 'session_teachers', 'unsold_seats', 'lost_revenue'];
const NC_METRICS = ['new_clients', 'second_visit_rate', 'converted_clients', 'conversion_rate', 'retained_clients', 'retention_rate', 'avg_days_to_convert', 'new_client_avg_ltv', 'zero_return_rate', 'avg_first_purchase'];

/* ── attendance: volume, free vs paid, members, time patterns ── */
export async function attendanceExtras(req: Req) {
  const span = monthsBack(req.end, 12);
  const [trend, types, wk, slot, dow, best, worst, hours] = await Promise.all([
    q(req, ['visits', 'visiting_clients', 'visits_per_client'], [], { grain: 'month', start: span }),
    q(req, ['visits', 'visiting_clients', 'visits_per_client', 'late_cancellations', 'late_cancel_rate'], ['visit_type'], { sort: 'visits' }),
    q(req, ['classes', 'class_checkins', 'class_average', 'fill_rate', 'empty_class_rate', 'sold_out_rate', 'class_late_cancel_rate', 'revenue_per_class'], ['weekpart'], { sort: 'class_checkins' }),
    q(req, ['classes', 'class_checkins', 'class_average', 'fill_rate', 'empty_class_rate', 'sold_out_rate', 'revenue_per_class'], ['time_slot'], { sort: 'class_average' }),
    q(req, ['classes', 'class_checkins', 'class_average', 'fill_rate', 'empty_class_rate', 'revenue_per_class'], ['day_of_week'], { sort: 'class_average' }),
    q(req, ['classes', 'class_average', 'fill_rate', 'class_checkins', 'empty_class_rate'], ['slot'], { sort: 'class_average', keep: (r) => Number(r.classes) >= 3, limit: 10 }),
    q(req, ['classes', 'class_average', 'fill_rate', 'class_checkins', 'empty_class_rate'], ['slot'], { sort: 'class_average', dir: 'asc', keep: (r) => Number(r.classes) >= 3, limit: 10 }),
    q(req, ['classes', 'class_average', 'fill_rate'], ['hour']),
  ]);
  return {
    charts: compact([chart('Visits and unique visiting members — 12 months', trend, 'line', ['visits', 'visiting_clients']), chart('Class average by hour of day', hours, 'bar', ['class_average'])]),
    tables: compact([
      table('Free vs paid visits — by visit type', types), table('Weekday vs weekend', wk), table('Morning, afternoon and evening', slot), table('Best and worst days', dow),
      table('Best slots (≥ 3 sessions)', best), table('Weakest slots (≥ 3 sessions)', worst),
    ]),
  };
}

/* ── funnel: lead table, newcomer journeys, first classes, hosted classes, follow-up ── */
export async function funnelExtras(req: Req) {
  const leadM = ['leads', 'qualified_leads', 'qualification_rate', 'lead_trials', 'lead_to_trial_rate', 'lead_conversions', 'lead_conversion_rate', 'trial_to_member_rate', 'lead_ltv', 'lead_ltv_per_conversion', 'lost_leads', 'unresponsive_leads', 'open_leads'];
  const [bySource, journeys, firstClass, hosted, hostedK, follow, stages, byTrainer] = await Promise.all([
    q(req, leadM, ['source'], { sort: 'leads', limit: 20 }),
    q(req, NC_METRICS, ['new_client_type'], { sort: 'new_clients' }),
    q(req, NC_METRICS, ['class_name'], { sort: 'new_clients', limit: 15 }),
    q(req, NC_METRICS, ['class_name'], { sort: 'new_clients', filters: [{ dimension: 'new_client_type', op: 'contains', values: ['Hosted'] }], limit: 15 }),
    q(req, NC_METRICS, [], { filters: [{ dimension: 'new_client_type', op: 'contains', values: ['Hosted'] }] }),
    q(req, ['leads', 'lead_trials', 'lead_to_trial_rate', 'lead_conversions', 'lead_conversion_rate', 'unresponsive_leads', 'open_leads', 'lost_leads'], ['associate'], { sort: 'leads', limit: 15 }),
    q(req, ['leads', 'lead_conversions', 'lead_ltv'], ['stage'], { sort: 'leads', limit: 15 }),
    q(req, NC_METRICS, ['teacher'], { sort: 'new_clients', limit: 15 }),
  ]);
  const h = hostedK?.rows[0];
  const hostedNote = h ? `Hosted classes brought ${Number(h.new_clients ?? 0)} new clients; ${(Number(h.conversion_rate ?? 0) * 100).toFixed(1)}% converted and ${(Number(h.retention_rate ?? 0) * 100).toFixed(1)}% were retained.` : undefined;
  return {
    tables: compact([
      table('Lead funnel by source — full metric set', bySource), table('New client journeys — outcome by first-visit type', journeys), table('First classes visited by new clients', firstClass),
      table('Hosted classes — new clients and outcomes', hosted, hostedNote), table('Follow-up by associate', follow), table('Lead pipeline by stage', stages), table('Newcomer outcomes by first-class trainer', byTrainer),
    ]),
  };
}

/* ── classes: full recurring-slot tables, trainer changes, class × teacher combos, best times ── */
export async function classExtras(req: Req) {
  const keep4 = (r: Record<string, unknown>) => Number(r.classes) >= 4;
  const [strong, weak, bestCombo, worstCombo, times] = await Promise.all([
    q(req, CLASS_METRICS, ['recurring_class'], { sort: 'class_average', keep: keep4, limit: 25 }),
    q(req, CLASS_METRICS, ['recurring_class'], { sort: 'class_average', dir: 'asc', keep: keep4, limit: 25 }),
    q(req, ['classes', 'class_average', 'fill_rate', 'class_checkins', 'empty_class_rate', 'revenue_per_class'], ['class_teacher'], { sort: 'class_average', keep: (r) => Number(r.classes) >= 3, limit: 12 }),
    q(req, ['classes', 'class_average', 'fill_rate', 'class_checkins', 'empty_class_rate', 'revenue_per_class'], ['class_teacher'], { sort: 'class_average', dir: 'asc', keep: (r) => Number(r.classes) >= 3, limit: 12 }),
    q(req, ['classes', 'class_average', 'fill_rate', 'empty_class_rate'], ['start_time'], { sort: 'class_average', keep: (r) => Number(r.classes) >= 4, limit: 12 }),
  ]);
  return {
    tables: compact([
      table('Strongest recurring classes (≥ 4 sessions) — full metric set', strong), table('Weakest recurring classes (≥ 4 sessions) — full metric set', weak),
      table('Best class × trainer combinations', bestCombo), table('Weakest class × trainer combinations', worstCombo), table('Best start times (≥ 4 sessions)', times),
    ]),
  };
}

/* ── trainers: one wide scorecard (schedule, draw, revenue, newcomers, conversion, retention) ── */
export async function trainerScorecard(req: Req): Promise<ReportTable | null> {
  const [a, b, c] = await Promise.all([
    q(req, CLASS_METRICS, ['teacher'], { sort: 'class_checkins' }),
    q(req, NC_METRICS, ['teacher']),
    q(req, ['visits', 'visiting_clients', 'visits_per_client', 'trial_visits', 'new_client_visits', 'complimentary_visits'], ['teacher']),
  ]);
  return table('Trainer scorecard — full metric set', join(a, [b, c], 'teacher'), 'Every trainer across schedule, draw, fill, revenue, newcomers, conversion and retention. Group, sort and filter with the table controls; click any value for its records.');
}

/* ── formats: demand, fill, yield, newcomers, conversion, LTV side by side ── */
export async function formatComparison(req: Req) {
  const [a, b, c, trend] = await Promise.all([
    q(req, CLASS_METRICS, ['format'], { sort: 'class_checkins' }),
    q(req, NC_METRICS, ['format']),
    q(req, ['visits', 'visiting_clients', 'visits_per_client', 'trial_visits', 'complimentary_visits'], ['format']),
    q(req, ['fill_rate'], ['format'], { grain: 'month', start: monthsBack(req.end, 12) }),
  ]);
  // format economics: the business each format brings (client-level profile + credited renewals)
  const y12 = monthsBack(req.end, 12);
  const [acq, depth, journeys, mixT, ren, rev] = await Promise.all([
    q(req, ['format_new_clients', 'format_conversion_rate', 'format_retention_rate', 'client_avg_ltv', 'visits_per_active_month', 'multi_format_rate', 'avg_days_to_second_format'], ['first_format'], { sort: 'format_new_clients' }),
    q(req, ['format_clients', 'visits_per_active_month', 'client_lifetime_visits', 'client_active_months', 'client_avg_ltv'], ['main_format'], { start: y12, sort: 'format_clients' }),
    q(req, ['format_clients'], ['first_format', 'second_format'], { start: y12, sort: 'format_clients' }),
    q(req, ['format_clients', 'visits_per_active_month', 'client_active_months', 'client_avg_ltv', 'format_retention_rate'], ['format_mix'], { start: y12 }),
    q(req, ['credited_memberships_ending', 'credited_renewals', 'credited_renewal_rate', 'credited_renewal_value', 'term_visits_per_membership'], ['credited_format'], { sort: 'credited_memberships_ending' }),
    q(req, ['strength_revenue_share', 'barre_revenue_share', 'cycle_revenue_share', 'format_lifetime_revenue'], ['location'], { start: y12, sort: 'format_lifetime_revenue' }),
  ]);
  const ATTR = 'Attribution is behavioural: the data does not record why a client paid or renewed.';
  return {
    tables: compact([table('Format comparison — full metric set', join(a, [b, c], 'format')),
      table('Format economics — new clients by first format', acq, 'Clients whose first class was in this period, grouped by the format of that class: conversion, retention, lifetime value, how often they come and how many try a second format.'),
      table('Main format — frequency and value (clients who started in the last 12 months)', depth, 'Main format = the format with 60%+ of a client\'s classes; otherwise Mixed.'),
      table('Cross-format journeys — first format → second format tried (12 months)', journeys, '"None yet" = still single-format.'),
      table('Single vs multi-format clients (12 months)', mixT),
      table('Renewals credited to each format', ren, `Each recurring membership ending this period is credited to the format the client attended most in its last 60 days. ${ATTR}`),
      table('Revenue credited to each format by visit share (12 months)', rev, `Each client\'s total spend split by their share of Barre, powerCycle and Strength Lab classes. ${ATTR}`)]),
    charts: compact([chart('Fill rate by format — 12 months', trend, 'line', ['fill_rate'], 'format')]),
  };
}

/** Full product list (every product, not just the top table) so the top / bottom toggle shows true bottom performers. */
export async function productList(req: Req) {
  return q(req, ['revenue', 'units_sold', 'atv'], ['product'], { sort: 'revenue', limit: 500, keep: (r) => Number(r.revenue) > 0 });   // refunds / zero rows are not "bottom performers"
}

/* ── retention: who churns, the leading indicators and the value at stake ── */
const RET = ['memberships_expiring', 'sheet_renewal_rate', 'churn_rate', 'lapsed_memberships', 'lapsed_value', 'expiring_value'];
export async function retentionExtras(req0: Req) {
  // no memberships ending in the period → the breakdowns would all be empty; show the last 12 months instead, and say so
  const here = await q(req0, ['memberships_expiring'], []);
  const none = !here || !Number(here.rows[0]?.memberships_expiring);
  const req: Req = none ? { ...req0, start: monthsBack(req0.end, 12) } : req0;
  const sfx = none ? ' (last 12 months — no memberships ended this period)' : '';
  const big = (r: Record<string, unknown>) => Number(r.memberships_expiring) >= 3;
  const [usage, quiet, term, fam, mem, studio, seller, trend] = await Promise.all([
    q(req, RET, ['usage_band']), q(req, RET, ['last_visit_gap']), q(req, RET, ['term_length']), q(req, RET, ['product_family'], { sort: 'memberships_expiring' }),
    q(req, RET, ['membership'], { sort: 'lapsed_value', keep: big, limit: 15 }), q(req, RET, ['location'], { sort: 'memberships_expiring' }),
    q(req, RET, ['sold_by'], { sort: 'memberships_expiring', keep: big, limit: 12 }),
    q(req, ['sheet_renewal_rate', 'churn_rate'], [], { grain: 'month', start: monthsBack(req.end, 12) }),
  ]);
  return {
    tables: compact([
      table('Churn by usage — classes used during the membership' + sfx, usage, 'Low usage is the strongest early-warning signal: members who barely use a membership rarely renew.'),
      table('Churn by last visit before expiry' + sfx, quiet, 'How long before the end date each member last attended. "Gone quiet" members are the save-play target.'),
      table('Churn by membership length' + sfx, term), table('Churn by product family' + sfx, fam, 'Newcomer offers ending is structural churn; unlimited / class-pack lapses are true loss.'),
      table('Memberships losing the most value' + sfx, mem), table('Retention by studio' + sfx, studio), table('Retention by seller' + sfx, seller),
    ]),
    charts: compact([chart('Renewal and churn rate — 12 months', trend, 'line', ['sheet_renewal_rate', 'churn_rate'])]),
  };
}
