import crypto from 'node:crypto';
import { warehouse, sqlString } from '../warehouse/db.js';
import { loadRules, membershipScopeSql, membershipScopeLabel } from '../warehouse/rules.js';
import { runMetricsQuery, QueryError, type Column, type Check, type QueryResult } from '../semantic/engine.js';
import { DIMENSIONS, metricById, modelById, METRICS, FORMAT } from '../semantic/metrics.js';
import { forecastSeries, probAtLeast, stats } from './forecast.js';

export interface AnalysisResult {
  id: string;
  kind: string;
  title: string;
  columns: Column[];
  rows: Record<string, unknown>[];
  totals?: Record<string, unknown>;
  sql: string[];
  sources: string[];
  definitions: { metric: string; label: string; description: string; caveat?: string }[];
  notes: string[];
  checks: Check[];
  verified: boolean;
  extra?: Record<string, unknown>;
  rowCount: number;
}
export type AnyResult = AnalysisResult | QueryResult;

const rid = () => 'r_' + crypto.randomBytes(5).toString('hex');
const todayIST = () => new Date(Date.now() + 5.5 * 3600e3).toISOString().slice(0, 10);
const monthStart = (d: string) => d.slice(0, 8) + '01';
const addMonths = (d: string, n: number) => { const x = new Date(d.slice(0, 7) + '-01T00:00:00Z'); x.setUTCMonth(x.getUTCMonth() + n); return x.toISOString().slice(0, 10); };
const lastDay = (d: string) => { const x = new Date(d.slice(0, 7) + '-01T00:00:00Z'); x.setUTCMonth(x.getUTCMonth() + 1); x.setUTCDate(0); return x.toISOString().slice(0, 10); };

function locFilter(col: string, locations?: string[]) {
  return locations?.length ? ` and lower(${col}) in (${locations.map((l) => sqlString(l.toLowerCase())).join(',')})` : '';
}

/* ───────────────────────────── Forecast ───────────────────────────── */
export async function forecast(input: {
  metric: string; horizon?: number; filters?: unknown[]; split_by?: string; target?: number; history_months?: number;
}): Promise<AnalysisResult> {
  const mt = metricById.get(input.metric);
  if (!mt) throw new QueryError(`Unknown metric ${input.metric}`);
  const horizon = Math.min(Math.max(input.horizon ?? 3, 1), 12);
  const t = todayIST();
  const lastComplete = lastDay(addMonths(t, -1));
  const start = addMonths(t, -(input.history_months ?? 36));
  const q = await runMetricsQuery({ metrics: [mt.id], grain: 'month', start, end: lastComplete, filters: input.filters ?? [], dimensions: input.split_by ? [input.split_by] : [] });
  const groups = new Map<string, { period: string; v: number }[]>();
  for (const r of q.rows) {
    const g = input.split_by ? String(r[input.split_by]) : 'All';
    groups.set(g, [...(groups.get(g) ?? []), { period: String(r.period), v: Number(r[mt.id]) || 0 }]);
  }
  const bounds = mt.format === 'percent' ? { min: 0, max: 1 } : { min: 0 };
  const rows: Record<string, unknown>[] = [];
  const methods: Record<string, unknown> = {};
  const notes: string[] = [...q.notes.filter((n) => !n.startsWith('Period ends after'))];
  const drivers: string[] = [];
  let firstPoint: { value: number; sigma: number } | null = null;

  // month-to-date context for the current month
  const mtdQ = await runMetricsQuery({ metrics: [mt.id], grain: 'all', start: monthStart(t), end: t, filters: input.filters ?? [] });
  const mtdVal = Number(mtdQ.rows[0]?.[mt.id]) || 0;
  const dayOfMonth = Number(t.slice(8, 10));
  const dim = Number(lastDay(t).slice(8, 10));

  for (const [g, pts] of [...groups.entries()].slice(0, 8)) {
    pts.sort((a, b) => a.period.localeCompare(b.period));
    // fill missing months with 0 so seasonality aligns
    const filled: { period: string; v: number }[] = [];
    if (pts.length) {
      let p = pts[0].period; const map = new Map(pts.map((x) => [x.period, x.v]));
      while (p <= pts[pts.length - 1].period) { filled.push({ period: p, v: map.get(p) ?? 0 }); p = addMonths(p, 1); }
    }
    // drop leading zeros (before the series really started)
    while (filled.length && filled[0].v === 0) filled.shift();
    if (filled.length < 4) { notes.push(`${g}: only ${filled.length} months of history — not enough to forecast.`); continue; }
    const fo = forecastSeries(filled.map((x) => x.v), horizon + 1, bounds); // +1: current (in-progress) month first
    methods[g] = { method: fo.method, compared: fo.compared, backtestFolds: fo.backtestFolds };
    for (const x of filled.slice(-18)) rows.push({ series: g, period: x.period, actual: x.v, forecast: null, lo80: null, hi80: null, lo95: null, hi95: null, type: 'actual' });
    fo.points.forEach((p, i) => rows.push({ series: g, period: addMonths(t, i), actual: null, forecast: p.value, lo80: p.lo80, hi80: p.hi80, lo95: p.lo95, hi95: p.hi95, type: i === 0 ? 'forecast (current month)' : 'forecast' }));
    if (!firstPoint && g === 'All') firstPoint = { value: fo.points[0].value, sigma: fo.sigma };
    const y = filled.map((x) => x.v);
    if (y.length >= 13 && mt.additive) {
      const yoy = stats.mean(y.slice(-3)) / Math.max(1e-9, stats.mean(y.slice(-15, -12))) - 1;
      drivers.push(`${g}: trailing-3-month YoY change ${(yoy * 100).toFixed(1)}%.`);
    }
    if (y.length >= 24) {
      const nextMonth = Number(addMonths(t, 1).slice(5, 7));
      const byMonth = filled.filter((x) => Number(x.period.slice(5, 7)) === nextMonth).map((x) => x.v);
      const idx = stats.mean(byMonth) / Math.max(1e-9, stats.mean(y));
      drivers.push(`${g}: seasonal index for ${new Date(addMonths(t, 1)).toLocaleString('en-GB', { month: 'long' })} ≈ ${idx.toFixed(2)} (1.00 = average month).`);
    }
  }
  if (!rows.length) throw new QueryError('Not enough history to produce a forecast for this selection.');

  const extra: Record<string, unknown> = { metric: mt.id, format: mt.format, horizon, methods, drivers, splitBy: input.split_by ?? null };
  if (!input.split_by && mt.additive) {
    const runRate = dayOfMonth > 0 ? (mtdVal / dayOfMonth) * dim : null;
    extra.monthToDate = { value: mtdVal, daysElapsed: dayOfMonth, daysInMonth: dim, linearRunRate: runRate };
    notes.push(`Current month to date (${dayOfMonth}/${dim} days): ${mtdVal.toLocaleString('en-IN', { maximumFractionDigits: 0 })}; simple run-rate ${runRate?.toLocaleString('en-IN', { maximumFractionDigits: 0 })}. Run-rate ignores intra-month patterns.`);
  }
  if (input.target !== undefined && firstPoint) {
    extra.targetProbability = { target: input.target, probability: probAtLeast(firstPoint.value, firstPoint.sigma, input.target), basis: 'Normal approximation around the current-month forecast using backtest error.' };
  }
  const first = Object.values(methods)[0] as { method: string; compared: { method: string; mae: number; mape: number | null }[] } | undefined;
  return {
    id: rid(), kind: 'forecast', title: `${mt.label} forecast`,
    columns: [
      ...(input.split_by ? [{ key: 'series', label: DIMENSIONS[input.split_by]?.label ?? 'Series', kind: 'dimension' as const, format: 'text' as const }] : []),
      { key: 'period', label: 'Month', kind: 'period', format: 'date' },
      { key: 'actual', label: 'Actual', kind: 'metric', format: mt.format },
      { key: 'forecast', label: 'Forecast', kind: 'metric', format: mt.format },
      { key: 'lo80', label: 'Low (80%)', kind: 'metric', format: mt.format },
      { key: 'hi80', label: 'High (80%)', kind: 'metric', format: mt.format },
      { key: 'type', label: 'Type', kind: 'dimension', format: 'text' },
    ],
    rows, sql: q.sql, sources: q.sources,
    definitions: q.definitions,
    notes: [
      `Method chosen by rolling-origin backtest (lowest mean absolute error): ${first?.method ?? 'n/a'}.`,
      first?.compared?.[0]?.mape != null ? `Backtest MAPE of chosen method: ${(first.compared[0].mape! * 100).toFixed(1)}% (1-month-ahead).` : '',
      'Forecast bands are 80% / 95% prediction intervals from historical backtest error, widening with horizon.',
      'Forecasts assume no major change in pricing, schedule or capacity beyond what history shows.',
      ...notes,
    ].filter(Boolean),
    checks: [{ name: 'history_length', passed: true, detail: 'Sufficient history for the selected models.' }],
    verified: true, extra, rowCount: rows.length,
  };
}

/* ───────────────────────────── Anomalies ───────────────────────────── */
export async function detectAnomalies(input: { metrics?: string[]; split_by?: string; months?: number; filters?: unknown[] }): Promise<AnalysisResult> {
  const metrics = input.metrics?.length ? input.metrics : ['revenue', 'visits', 'new_clients', 'conversion_rate', 'fill_rate', 'leads'];
  const t = todayIST();
  const end = lastDay(addMonths(t, -1));
  const start = addMonths(t, -(input.months ?? 18));
  const rows: Record<string, unknown>[] = [];
  const sql: string[] = []; const sources = new Set<string>(); const notes: string[] = [];
  for (const id of metrics) {
    const mt = metricById.get(id);
    if (!mt) continue;
    const supports = input.split_by ? !!modelById.get(mt.model)?.dims[input.split_by] : true;
    let q: QueryResult;
    try {
      q = await runMetricsQuery({ metrics: [id], grain: 'month', start, end, dimensions: input.split_by && supports ? [input.split_by] : [], filters: input.filters ?? [] });
    } catch (e) { notes.push(`${mt.label}: ${(e as Error).message}`); continue; }
    sql.push(...q.sql); q.sources.forEach((s) => sources.add(s));
    const groups = new Map<string, { p: string; v: number }[]>();
    for (const r of q.rows) { const g = input.split_by && supports ? String(r[input.split_by]) : 'All'; groups.set(g, [...(groups.get(g) ?? []), { p: String(r.period), v: Number(r[id]) || 0 }]); }
    for (const [g, s] of groups) {
      s.sort((a, b) => a.p.localeCompare(b.p));
      if (s.length < 7) continue;
      const last = s[s.length - 1]; const hist = s.slice(-13, -1).map((x) => x.v);
      const m = stats.mean(hist), sd = stats.std(hist);
      const z = sd > 0 ? (last.v - m) / sd : 0;
      const prev = s[s.length - 2].v;
      const mom = mt.format === 'percent' ? last.v - prev : prev ? (last.v - prev) / Math.abs(prev) : null;
      const lyRow = s.find((x) => x.p === addMonths(last.p, -12));
      const yoy = lyRow ? (mt.format === 'percent' ? last.v - lyRow.v : lyRow.v ? (last.v - lyRow.v) / Math.abs(lyRow.v) : null) : null;
      const flag = Math.abs(z) >= 2 ? 'Unusual' : Math.abs(z) >= 1.5 ? 'Notable' : 'Normal';
      const good = mt.higherIsBetter === undefined ? null : (z > 0) === mt.higherIsBetter;
      rows.push({ metric: mt.label, metric_id: id, format: mt.format, segment: g, month: last.p, value: last.v, trailing_avg: m, z_score: z, mom, yoy, flag, direction: good === null ? 'neutral' : good ? 'favourable' : 'unfavourable' });
    }
  }
  rows.sort((a, b) => Math.abs(Number(b.z_score)) - Math.abs(Number(a.z_score)));
  return {
    id: rid(), kind: 'anomalies', title: 'Unusual movements (last complete month)',
    columns: [
      { key: 'metric', label: 'Metric', kind: 'dimension', format: 'text' },
      { key: 'segment', label: input.split_by ? DIMENSIONS[input.split_by]?.label ?? 'Segment' : 'Segment', kind: 'dimension', format: 'text' },
      { key: 'month', label: 'Month', kind: 'period', format: 'date' },
      { key: 'value', label: 'Value', kind: 'metric', format: 'number' },
      { key: 'trailing_avg', label: '12-mo avg', kind: 'metric', format: 'number' },
      { key: 'z_score', label: 'z-score', kind: 'metric', format: 'decimal' },
      { key: 'mom', label: 'MoM', kind: 'change', format: 'percent' },
      { key: 'yoy', label: 'YoY', kind: 'change', format: 'percent' },
      { key: 'flag', label: 'Flag', kind: 'dimension', format: 'text' },
      { key: 'direction', label: 'Direction', kind: 'dimension', format: 'text' },
    ],
    rows, sql, sources: [...sources], definitions: [],
    notes: ['z-score compares the last complete month with the trailing 12 months (|z| ≥ 2 = unusual). Percent metrics show MoM/YoY in percentage points.', ...notes],
    checks: [], verified: true, rowCount: rows.length,
  };
}

/* ───────────────────────────── Cohorts ───────────────────────────── */
export async function cohortRetention(input: { basis?: 'first_visit' | 'first_purchase'; activity?: 'visit' | 'purchase'; start?: string; end?: string; months?: number; locations?: string[] }): Promise<AnalysisResult> {
  const db = await warehouse();
  const basis = input.basis ?? 'first_visit';
  const activity = input.activity ?? 'visit';
  const t = todayIST();
  const start = input.start ?? addMonths(t, -12);
  const end = input.end ?? lastDay(addMonths(t, -1));
  const horizon = Math.min(input.months ?? 6, 12);
  const cohortSql = basis === 'first_visit'
    ? `select member_id, date_trunc('month', first_visit_ts)::date as cohort, first_visit_location as location from fct_new_clients where is_new_client and first_visit_ts between ${sqlString(start)}::timestamp and ${sqlString(end)}::date + interval 1 day${locFilter('first_visit_location', input.locations)}`
    : `select member_id, min(payment_month) as cohort, arg_min(location, payment_ts) as location from fct_sales group by 1 having min(payment_ts) between ${sqlString(start)}::timestamp and ${sqlString(end)}::date + interval 1 day${input.locations?.length ? ` and lower(arg_min(location, payment_ts)) in (${input.locations.map((l) => sqlString(l.toLowerCase())).join(',')})` : ''}`;
  const actSql = activity === 'visit'
    ? `select distinct member_id, session_month as m from fct_visits where attended and not is_imported`
    : `select distinct member_id, payment_month as m from fct_sales`;
  const sql = `
    with c as (${cohortSql}), a as (${actSql}),
    j as (select c.cohort, c.member_id, date_diff('month', c.cohort, a.m) as k from c join a using (member_id) where a.m >= c.cohort),
    sizes as (select cohort, count(distinct member_id) as n from c group by 1)
    select s.cohort, s.n as cohort_size, j.k, count(distinct j.member_id) as active
    from sizes s left join j using (cohort) where j.k between 0 and ${horizon} or j.k is null
    group by 1, 2, 3 order by 1, 3`;
  const raw = await db.all(sql);
  const byCohort = new Map<string, Record<string, unknown>>();
  for (const r of raw) {
    const c = String(r.cohort);
    const row = byCohort.get(c) ?? { cohort: c, cohort_size: r.cohort_size };
    if (r.k !== null && r.k !== undefined) {
      const k = Number(r.k);
      const maxK = Math.floor((new Date(t).getTime() - new Date(c).getTime()) / (30.44 * 864e5));
      row[`m${k}`] = k <= maxK ? Number(r.active) / Number(r.cohort_size) : null;
    }
    byCohort.set(c, row);
  }
  const rows = [...byCohort.values()].map((r) => {
    const maxK = Math.floor((new Date(t).getTime() - new Date(String(r.cohort)).getTime()) / (30.44 * 864e5));
    for (let k = 0; k <= horizon; k++) if (r[`m${k}`] === undefined) r[`m${k}`] = k < maxK ? 0 : null;
    return r;
  });
  const columns: Column[] = [
    { key: 'cohort', label: basis === 'first_visit' ? 'First-visit month' : 'First-purchase month', kind: 'period', format: 'date' },
    { key: 'cohort_size', label: 'Clients', kind: 'metric', format: 'number' },
    ...Array.from({ length: horizon + 1 }, (_, k) => ({ key: `m${k}`, label: `M${k}`, kind: 'metric' as const, format: 'percent' as const })),
  ];
  // weighted average row
  const avg: Record<string, unknown> = { cohort: 'Weighted avg', cohort_size: rows.reduce((a, r) => a + Number(r.cohort_size), 0) };
  for (let k = 0; k <= horizon; k++) {
    const valid = rows.filter((r) => r[`m${k}`] !== null);
    const w = valid.reduce((a, r) => a + Number(r.cohort_size), 0);
    avg[`m${k}`] = w ? valid.reduce((a, r) => a + Number(r[`m${k}`]) * Number(r.cohort_size), 0) / w : null;
  }
  return {
    id: rid(), kind: 'cohort', title: `Cohort retention by ${basis === 'first_visit' ? 'first visit' : 'first purchase'} month`,
    columns, rows, totals: avg, sql: [sql],
    sources: basis === 'first_visit' ? ['Day End Report - Part 1 › New (fct_new_clients)', activity === 'visit' ? 'Checkins/Bookings (fct_visits)' : 'Sales - Raw (fct_sales)'] : ['Sales - Raw (fct_sales)', activity === 'visit' ? 'Checkins/Bookings (fct_visits)' : 'Sales - Raw (fct_sales)'],
    definitions: [{ metric: 'cohort_retention', label: 'Cohort retention', description: `Share of each cohort with at least one ${activity === 'visit' ? 'attended visit' : 'purchase'} in month M after the cohort month (M0 = cohort month).` }],
    notes: ['Blank cells are months that have not happened yet for that cohort.', `Window: cohorts from ${start} to ${end}.`],
    checks: [], verified: true, rowCount: rows.length, extra: { basis, activity, horizon },
  };
}

/* ───────────────────────────── Funnel ───────────────────────────── */
export async function funnel(input: { type?: 'leads' | 'new_clients'; start?: string; end?: string; split_by?: string; filters?: unknown[] }): Promise<AnalysisResult> {
  const t = todayIST();
  const start = input.start ?? monthStart(addMonths(t, -3));
  const end = input.end ?? lastDay(addMonths(t, -1));
  const type = input.type ?? 'leads';
  const metrics = type === 'leads' ? ['leads', 'lead_trials', 'lead_conversions'] : ['new_clients', 'converted_clients', 'retained_clients'];
  const q = await runMetricsQuery({ metrics, start, end, dimensions: input.split_by ? [input.split_by] : [], filters: input.filters ?? [] });
  const labels = type === 'leads' ? ['Leads', 'Trial completed', 'Converted'] : ['First visit (new)', 'Converted (paid)', 'Retained'];
  const groups = input.split_by ? q.rows : [q.rows[0] ?? {}];
  const rows: Record<string, unknown>[] = [];
  for (const g of groups) {
    metrics.forEach((m, i) => {
      const v = Number(g[m]) || 0; const top = Number(g[metrics[0]]) || 0; const prev = i ? Number(g[metrics[i - 1]]) || 0 : v;
      rows.push({ segment: input.split_by ? g[input.split_by] : 'All', stage: labels[i], step: i + 1, count: v, of_top: top ? v / top : null, step_rate: i === 0 ? null : prev ? v / prev : null });
    });
  }
  return {
    id: rid(), kind: 'funnel', title: type === 'leads' ? 'Lead funnel' : 'New-client funnel',
    columns: [
      ...(input.split_by ? [{ key: 'segment', label: DIMENSIONS[input.split_by]?.label ?? 'Segment', kind: 'dimension' as const, format: 'text' as const }] : []),
      { key: 'stage', label: 'Stage', kind: 'dimension', format: 'text' },
      { key: 'count', label: 'Count', kind: 'metric', format: 'number' },
      { key: 'step_rate', label: 'Step conversion', kind: 'metric', format: 'percent' },
      { key: 'of_top', label: '% of top', kind: 'metric', format: 'percent' },
    ],
    rows, sql: q.sql, sources: q.sources, definitions: q.definitions,
    notes: [`Cohort basis: ${type === 'leads' ? 'lead created date' : 'first visit date'} between ${start} and ${end}. Later stages for recent cohorts are still maturing.`, ...q.notes],
    checks: q.checks, verified: q.verified, rowCount: rows.length, extra: { type, start, end },
  };
}

/* ───────────────────────────── Renewals ───────────────────────────── */
export async function renewalAnalysis(input: { start?: string; end?: string; group_by?: 'month' | 'location' | 'membership' | 'none'; locations?: string[]; include_list?: boolean }): Promise<AnalysisResult> {
  const db = await warehouse();
  const r = loadRules().renewal;
  const t = todayIST();
  const start = input.start ?? monthStart(addMonths(t, -6));
  const end = input.end ?? lastDay(addMonths(t, -1));
  const groupBy = input.group_by ?? 'month';
  const excl = [
    '(' + (r.include_membership_patterns.map((p) => `lower(e.membership) like ${sqlString(p)}`).join(' or ') || 'true') + ')',
    ...r.exclude_membership_patterns.map((p) => `lower(e.membership) not like ${sqlString(p)}`),
  ].join(' and ');
  const cats = r.renewal_categories.map((c) => sqlString(c)).join(',');
  const base = `
    with e as (
      select membership_key, member_id, client_name, membership, location, city, end_date, start_ts, amount_paid, status
      from fct_memberships e
      where end_date between ${sqlString(start)}::date and ${sqlString(end)}::date and ${excl} and ${membershipScopeSql('e.membership', 'e.amount_paid')}${locFilter('location', input.locations)}),
    rn as (
      select e.membership_key, min(s.payment_ts) as renewal_ts, arg_min(s.product, s.payment_ts) as renewal_product,
        arg_min(s.gross_amount, s.payment_ts) as renewal_value
      from e join fct_sales s on s.member_id = e.member_id and s.category in (${cats})
        and s.payment_date <= e.end_date + interval ${r.window_after_days} day
        and s.payment_ts > coalesce(e.start_ts, e.end_date - interval 30 day) + interval 1 day
      group by 1),
    x as (select e.*, rn.renewal_ts, rn.renewal_product, rn.renewal_value, rn.renewal_ts is not null as renewed,
      e.end_date + interval ${r.window_after_days} day > current_date as window_open from e left join rn using (membership_key))`;
  const gcol = groupBy === 'month' ? `date_trunc('month', end_date)::date` : groupBy === 'location' ? `coalesce(location, '(blank)')` : groupBy === 'membership' ? `coalesce(membership, '(blank)')` : `'All'`;
  const sql = `${base}
    select ${gcol} as grp, count(*) as expiring, count(*) filter (where renewed) as renewed,
      count(*) filter (where not renewed and window_open) as pending,
      count(*) filter (where renewed) / nullif(count(*) filter (where renewed or not window_open), 0) as renewal_rate,
      sum(renewal_value) filter (where renewed) as renewal_revenue, sum(amount_paid) filter (where not renewed and not window_open) as lapsed_value
    from x group by 1 order by 1`;
  const rows = await db.all(sql);
  const totSql = `${base} select count(*) expiring, count(*) filter (where renewed) renewed, count(*) filter (where not renewed and window_open) pending,
      count(*) filter (where renewed) / nullif(count(*) filter (where renewed or not window_open), 0) renewal_rate,
      sum(renewal_value) filter (where renewed) renewal_revenue, sum(amount_paid) filter (where not renewed and not window_open) lapsed_value from x`;
  const totals = (await db.all(totSql))[0];
  const extra: Record<string, unknown> = { start, end, groupBy, rules: r };
  if (input.include_list) {
    extra.atRisk = await db.all(`${base} select member_id, client_name, membership, location, end_date::varchar end_date, amount_paid from x where not renewed and window_open order by end_date limit 200`);
  }
  const sum = rows.reduce((a, x) => a + Number(x.expiring), 0);
  const sheet = await db.one(`${base} select count(*) filter (where status = 'Renewed') / nullif(count(*) filter (where status in ('Renewed','Lapsed')), 0) as rate from x`);
  extra.sheetStatusRenewalRate = sheet?.rate ?? null;
  const notesExtra = sheet?.rate != null ? [`Cross-check: the Lapsed sheet's own status gives a renewal rate of ${(Number(sheet.rate) * 100).toFixed(1)}% for the same memberships (Renewed ÷ Renewed+Lapsed).`] : [];
  return {
    id: rid(), kind: 'renewals', title: 'Membership renewals',
    columns: [
      { key: 'grp', label: groupBy === 'month' ? 'Expiry month' : groupBy === 'location' ? 'Location' : groupBy === 'membership' ? 'Membership' : 'Group', kind: groupBy === 'month' ? 'period' : 'dimension', format: groupBy === 'month' ? 'date' : 'text' },
      { key: 'expiring', label: 'Expiring', kind: 'metric', format: 'number' },
      { key: 'renewed', label: 'Renewed', kind: 'metric', format: 'number' },
      { key: 'pending', label: 'Window still open', kind: 'metric', format: 'number' },
      { key: 'renewal_rate', label: 'Renewal rate', kind: 'metric', format: 'percent' },
      { key: 'renewal_revenue', label: 'Renewal revenue', kind: 'metric', format: 'currency' },
      { key: 'lapsed_value', label: 'Lapsed value', kind: 'metric', format: 'currency' },
    ],
    rows, totals, sql: [sql, totSql],
    sources: ['Lapsed New › Lapsed (fct_memberships)', 'Sales - Raw › Sales (fct_sales)'],
    definitions: [{ metric: 'renewal_rate', label: 'Renewal rate', description: `A paid membership/package ending in the period counts as renewed if the same member bought a ${r.renewal_categories.join(' / ')} product after it started and no later than ${r.window_after_days} days after it ended. Rate = renewed ÷ (renewed + closed windows without renewal); memberships whose window is still open are excluded from the denominator.` }],
    notes: [...notesExtra, `Scope: memberships matching ${r.include_membership_patterns.join(', ')}; excluded ${r.exclude_membership_patterns.join(', ')}; ${membershipScopeLabel()}.`, 'The sheet status counts any later purchase (incl. single classes) as a renewal, so it runs higher than the strict membership/package repurchase rate.', `Expiry window ${start} → ${end}.`, 'Edit the window and exclusions in config/business-rules.json.'],
    checks: [{ name: 'reconcile:expiring', passed: sum === Number(totals?.expiring), detail: `Groups sum to ${sum}; total ${totals?.expiring}.` }],
    verified: sum === Number(totals?.expiring), rowCount: rows.length, extra,
  };
}

/* ───────────────────────────── Win-backs / lapsed pool ───────────────────────────── */
export async function winbackAnalysis(input: { start?: string; end?: string; inactive_days?: number; group_by?: 'month' | 'location' }): Promise<AnalysisResult> {
  const db = await warehouse();
  const n = input.inactive_days ?? loadRules().winback.inactive_days;
  const t = todayIST();
  const start = input.start ?? monthStart(addMonths(t, -6));
  const end = input.end ?? lastDay(addMonths(t, -1));
  const g = input.group_by === 'location' ? `coalesce(location, '(blank)')` : `payment_month`;
  const sql = `
    with p as (select sale_id, member_id, payment_ts, payment_month, location, gross_amount from fct_sales
               where payment_ts between ${sqlString(start)}::timestamp and ${sqlString(end)}::date + interval 1 day),
    lv as (select p.sale_id, max(v.session_ts) as last_visit_before
           from p join fct_visits v on v.member_id = p.member_id and v.attended and v.session_ts < p.payment_ts group by 1),
    x as (select p.*, lv.last_visit_before, date_diff('day', lv.last_visit_before, p.payment_ts) as gap_days from p join lv using (sale_id))
    select ${g} as grp, count(distinct member_id) filter (where gap_days >= ${n}) as winback_clients,
      sum(gross_amount) filter (where gap_days >= ${n}) as winback_revenue, count(distinct member_id) as returning_buyers,
      count(distinct member_id) filter (where gap_days >= ${n}) / nullif(count(distinct member_id), 0) as winback_share
    from x group by 1 order by 1`;
  const rows = await db.all(sql);
  const poolSql = `
    select coalesce(home_location, '(blank)') as location, count(*) as lapsed_clients, sum(lifetime_revenue) as lifetime_revenue,
      median(days_since_last_visit) as median_days_inactive
    from dim_client where days_since_last_visit between ${n} and 365 and lifetime_revenue > 0 group by 1 order by 2 desc`;
  const pool = await db.all(poolSql);
  return {
    id: rid(), kind: 'winback', title: 'Win-backs (reactivations)',
    columns: [
      { key: 'grp', label: input.group_by === 'location' ? 'Location' : 'Month', kind: input.group_by === 'location' ? 'dimension' : 'period', format: input.group_by === 'location' ? 'text' : 'date' },
      { key: 'winback_clients', label: 'Win-back clients', kind: 'metric', format: 'number' },
      { key: 'winback_revenue', label: 'Win-back revenue', kind: 'metric', format: 'currency' },
      { key: 'returning_buyers', label: 'Buyers with prior visits', kind: 'metric', format: 'number' },
      { key: 'winback_share', label: 'Win-back share', kind: 'metric', format: 'percent' },
    ],
    rows, sql: [sql, poolSql], sources: ['Sales - Raw (fct_sales)', 'Checkins/Bookings (fct_visits)', 'Client master (dim_client)'],
    definitions: [{ metric: 'winback', label: 'Win-back', description: `A purchase by a client whose last attended visit was ${n}+ days before the purchase date.` }],
    notes: [`Purchases ${start} → ${end}. Revenue counts every valid sale item in the win-back purchase.`],
    checks: [], verified: true, rowCount: rows.length,
    extra: { lapsedPool: pool, inactiveDays: n },
  };
}

/* ───────────────────────────── Target vs actual ───────────────────────────── */
export async function targetVsActual(input: { metric: string; start?: string; end?: string; by_location?: boolean }): Promise<AnalysisResult> {
  const db = await warehouse();
  const mt = metricById.get(input.metric);
  if (!mt) throw new QueryError(`Unknown metric ${input.metric}`);
  const has = await db.tableExists('app_targets');
  const t = todayIST();
  const start = input.start ?? monthStart(addMonths(t, -6));
  const end = input.end ?? lastDay(t);
  const targets = has ? await db.all(`select month::varchar as period, location, target from app_targets where metric = ? and month between ?::date and ?::date`, [mt.id, start, end]) : [];
  if (!targets.length) {
    return {
      id: rid(), kind: 'targets', title: `${mt.label}: target vs actual`, columns: [], rows: [], sql: [], sources: [], definitions: [],
      notes: [`No targets are loaded for ${mt.label} between ${start} and ${end}. Add them in Settings › Targets (CSV: month, location, metric, target).`],
      checks: [{ name: 'targets_available', passed: false, detail: 'No target data' }], verified: false, rowCount: 0,
    };
  }
  const q = await runMetricsQuery({ metrics: [mt.id], grain: 'month', start, end, dimensions: input.by_location ? ['location'] : [] });
  const key = (p: string, l?: unknown) => `${p}|${input.by_location ? String(l ?? '').toLowerCase() : ''}`;
  const actual = new Map(q.rows.map((r) => [key(String(r.period), r.location), Number(r[mt.id]) || 0]));
  const agg = new Map<string, { period: string; location: string; target: number }>();
  for (const tr of targets) {
    const k = key(String(tr.period), tr.location);
    const prev = agg.get(k);
    agg.set(k, { period: String(tr.period), location: input.by_location ? String(tr.location) : 'All', target: (prev?.target ?? 0) + Number(tr.target) });
  }
  const rows = [...agg.entries()].map(([k, v]) => {
    const a = actual.get(k) ?? 0;
    const partial = lastDay(v.period) > t;
    return { period: v.period, location: v.location, target: v.target, actual: a, achievement: v.target ? a / v.target : null, gap: a - v.target, partial };
  }).sort((a, b) => a.period.localeCompare(b.period) || a.location.localeCompare(b.location));
  return {
    id: rid(), kind: 'targets', title: `${mt.label}: target vs actual`,
    columns: [
      { key: 'period', label: 'Month', kind: 'period', format: 'date' },
      ...(input.by_location ? [{ key: 'location', label: 'Location', kind: 'dimension' as const, format: 'text' as const }] : []),
      { key: 'target', label: 'Target', kind: 'metric', format: mt.format },
      { key: 'actual', label: 'Actual', kind: 'metric', format: mt.format },
      { key: 'achievement', label: 'Achievement', kind: 'metric', format: 'percent' },
      { key: 'gap', label: 'Gap', kind: 'metric', format: mt.format },
    ],
    rows, sql: q.sql, sources: [...q.sources, 'App targets (Settings › Targets)'], definitions: q.definitions,
    notes: ['Months still in progress are flagged partial — compare with the forecast for an end-of-month view.', ...q.notes],
    checks: q.checks, verified: q.verified, rowCount: rows.length,
  };
}

/* ───────────────────────────── Lookups ───────────────────────────── */
export async function findValues(input: { dimension: string; search?: string; dataset?: string; limit?: number }) {
  const db = await warehouse();
  const models = [...modelById.values()].filter((m) => m.dims[input.dimension] && (!input.dataset || m.id === input.dataset));
  if (!models.length) throw new QueryError(`No dataset has dimension ${input.dimension}`);
  const out: Record<string, { value: string; rows: number }[]> = {};
  for (const m of models) {
    const expr = m.dims[input.dimension];
    const where = input.search ? `where cast(${expr} as varchar) ilike ${sqlString('%' + input.search + '%')}` : '';
    out[m.id] = (await db.all(`select cast(${expr} as varchar) as value, count(*) as rows from ${m.table} ${where} group by 1 order by 2 desc limit ${Math.min(input.limit ?? 40, 200)}`)) as never;
  }
  return out;
}

export async function clientLookup(input: { query: string }) {
  const db = await warehouse();
  const q = input.query.trim();
  const rows = await db.all(`select * from dim_client where member_id = ? or lower(email) = lower(?) or client_name ilike ? order by lifetime_revenue desc limit 10`, [q, q, `%${q}%`]);
  if (rows.length !== 1) return { matches: rows.map((r) => ({ member_id: r.member_id, client_name: r.client_name, home_location: r.home_location, lifetime_revenue: r.lifetime_revenue })) };
  const id = String(rows[0].member_id);
  const purchases = await db.all(`select payment_date::varchar date, product, category, gross_amount, location, sold_by from fct_sales where member_id = ? order by payment_ts desc limit 25`, [id]);
  const visits = await db.all(`select session_month::varchar as "month", count(*) filter (where attended) visits, count(*) filter (where late_cancelled) late_cancels from fct_visits where member_id = ? group by 1 order by 1 desc limit 18`, [id]);
  const memberships = await db.all(`select membership, status, start_date::varchar start_date, end_date::varchar end_date, amount_paid from fct_memberships where member_id = ? order by end_date desc limit 10`, [id]);
  return { client: rows[0], purchases, visits_by_month: visits, memberships };
}

export async function describeDataset(input: { dataset: string }) {
  const db = await warehouse();
  const m = modelById.get(input.dataset);
  const table = m?.table ?? input.dataset;
  const dict = await db.one<{ profile: string }>(`select profile from _dictionary where model = ?`, [table]).catch(() => undefined);
  return { dataset: m ?? { table }, profile: dict ? JSON.parse(dict.profile) : null };
}

/* ───────────────────────────── Guarded SQL ───────────────────────────── */
const FORBIDDEN = /\b(insert|update|delete|drop|create|alter|attach|detach|copy|pragma|install|load|export|import|call|set|truncate|replace|vacuum|checkpoint|grant|read_csv|read_parquet|read_json|glob|httpfs)\b/i;
export async function runSql(input: { sql: string; purpose?: string }): Promise<AnalysisResult> {
  const db = await warehouse();
  const s = input.sql.trim().replace(/;\s*$/, '');
  if (!/^(with|select)\b/i.test(s)) throw new QueryError('Only SELECT / WITH queries are allowed.');
  if (s.includes(';')) throw new QueryError('Only one statement is allowed.');
  if (FORBIDDEN.test(s)) throw new QueryError('Query uses a forbidden keyword or function.');
  const tables = [...s.matchAll(/\b(?:from|join)\s+([a-z_][a-z0-9_]*)/gi)].map((x) => x[1].toLowerCase());
  const ctes = new Set([...s.matchAll(/\b([a-z_][a-z0-9_]*)\s+as\s*\(/gi)].map((x) => x[1].toLowerCase()));
  const bad = tables.filter((x) => !/^(fct_|dim_|stg_)/.test(x) && !ctes.has(x));
  if (bad.length) throw new QueryError(`Only curated models (fct_*, dim_*, stg_*) can be queried. Not allowed: ${bad.join(', ')}`);
  const facts = [...new Set(tables.filter((x) => x.startsWith('fct_')))];
  const checks: Check[] = [];
  if (facts.length > 1 && !/group\s+by/i.test(s)) checks.push({ name: 'fan_out', passed: false, detail: `Joins ${facts.join(' + ')} without aggregation — row-level joins between fact tables can double count. Aggregate each table first.` });
  const rows = await db.all(`select * from (${s}) _q limit 1000`);
  const cols = rows[0] ? Object.keys(rows[0]) : [];
  return {
    id: rid(), kind: 'sql', title: input.purpose ?? 'Custom query',
    columns: cols.map((c) => ({ key: c, label: c, kind: typeof rows[0][c] === 'number' ? 'metric' : 'dimension', format: typeof rows[0][c] === 'number' ? 'number' : 'text' })),
    rows, sql: [s], sources: facts.map((f) => f), definitions: [],
    notes: ['Custom SQL written by the assistant against the curated models — check the logic in "How this was calculated".', ...(rows.length === 1000 ? ['Result capped at 1,000 rows.'] : [])],
    checks, verified: checks.every((c) => c.passed), rowCount: rows.length,
  };
}

export const listMetrics = () => METRICS;

/**
 * Format cross-over: how clients split across Barre / powerCycle / Strength Lab (attended visits).
 * mode=segments → one row per combination (Barre only, Barre + powerCycle, All three…);
 * mode=matrix → for clients of each format, the share who also attended each other format.
 */
export async function formatOverlap(input: { start?: string; end?: string; locations?: string[]; mode?: 'segments' | 'matrix' }): Promise<AnalysisResult> {
  const db = await warehouse();
  const t = todayIST();
  const start = input.start ?? monthStart(addMonths(t, -3));
  const end = input.end ?? lastDay(addMonths(t, -1));
  const mode = input.mode ?? 'segments';
  const base = `
    with v as (
      select member_id, ${FORMAT('class_name')} as fmt, paid_amount
      from fct_visits
      where attended and not is_imported and member_id is not null
        and session_ts >= ${sqlString(start)}::timestamp and session_ts < ${sqlString(end)}::date + interval 1 day${locFilter('location', input.locations)}),
    m as (
      select member_id,
        count(*) filter (where fmt = 'Barre') b, count(*) filter (where fmt = 'powerCycle') c, count(*) filter (where fmt = 'Strength Lab') s,
        count(*) filter (where fmt in ('Barre','powerCycle','Strength Lab')) n, sum(paid_amount) filter (where fmt in ('Barre','powerCycle','Strength Lab')) val
      from v group by 1 having count(*) filter (where fmt in ('Barre','powerCycle','Strength Lab')) > 0)`;
  let sql: string; let columns: Column[]; let title: string;
  if (mode === 'segments') {
    title = 'Client format mix (attended visits)';
    sql = `${base}
      select case
          when b > 0 and c > 0 and s > 0 then 'All three'
          when b > 0 and c > 0 then 'Barre + powerCycle' when b > 0 and s > 0 then 'Barre + Strength Lab' when c > 0 and s > 0 then 'powerCycle + Strength Lab'
          when b > 0 then 'Barre only' when c > 0 then 'powerCycle only' else 'Strength Lab only' end as segment,
        count(*) as clients, count(*) / sum(count(*)) over () as share, sum(n) as visits, sum(n) / count(*) as visits_per_client,
        sum(b) as barre_visits, sum(c) as cycle_visits, sum(s) as strength_visits, sum(val) as visit_value
      from m group by 1 order by clients desc`;
    columns = [
      { key: 'segment', label: 'Client segment', kind: 'dimension', format: 'text' },
      { key: 'clients', label: 'Clients', kind: 'metric', format: 'number' },
      { key: 'share', label: 'Share of clients', kind: 'metric', format: 'percent' },
      { key: 'visits', label: 'Visits', kind: 'metric', format: 'number' },
      { key: 'visits_per_client', label: 'Visits per client', kind: 'metric', format: 'decimal' },
      { key: 'barre_visits', label: 'Barre visits', kind: 'metric', format: 'number' },
      { key: 'cycle_visits', label: 'powerCycle visits', kind: 'metric', format: 'number' },
      { key: 'strength_visits', label: 'Strength Lab visits', kind: 'metric', format: 'number' },
      { key: 'visit_value', label: 'Visit value', kind: 'metric', format: 'currency' },
    ];
  } else {
    title = 'Format cross-over — share of each format\'s clients who also attend the others';
    sql = `${base}
      select f.fmt as format, count(*) as clients,
        avg(case when m.b > 0 then 1 else 0 end) as also_barre, avg(case when m.c > 0 then 1 else 0 end) as also_cycle, avg(case when m.s > 0 then 1 else 0 end) as also_strength,
        avg(case when (m.b > 0)::int + (m.c > 0)::int + (m.s > 0)::int = 1 then 1 else 0 end) as single_format, avg(m.n) as visits_per_client
      from m join (select 'Barre' fmt union all select 'powerCycle' union all select 'Strength Lab') f
        on (f.fmt = 'Barre' and m.b > 0) or (f.fmt = 'powerCycle' and m.c > 0) or (f.fmt = 'Strength Lab' and m.s > 0)
      group by 1 order by clients desc`;
    columns = [
      { key: 'format', label: 'Clients of…', kind: 'dimension', format: 'text' },
      { key: 'clients', label: 'Clients', kind: 'metric', format: 'number' },
      { key: 'also_barre', label: 'Also Barre', kind: 'metric', format: 'percent' },
      { key: 'also_cycle', label: 'Also powerCycle', kind: 'metric', format: 'percent' },
      { key: 'also_strength', label: 'Also Strength Lab', kind: 'metric', format: 'percent' },
      { key: 'single_format', label: 'Single-format clients', kind: 'metric', format: 'percent' },
      { key: 'visits_per_client', label: 'Visits per client (all formats)', kind: 'metric', format: 'decimal' },
    ];
  }
  const rows = await db.all(sql);
  const totals = mode === 'segments' ? (await db.all(`${base} select count(*) clients, 1.0 share, sum(n) visits, sum(n)/count(*) visits_per_client, sum(b) barre_visits, sum(c) cycle_visits, sum(s) strength_visits, sum(val) visit_value from m`))[0] : undefined;
  return {
    id: rid(), kind: 'format_overlap', title, columns, rows, totals, sql: [sql],
    sources: ['Day End Report - Part 4 › Checkins / Bookings (fct_visits)'],
    definitions: [{ metric: 'format', label: 'Format', description: 'Barre (Barre 57, Mat 57, FIT, Cardio Barre, Back Body Blaze, Recovery…), powerCycle (all cycle classes) and Strength Lab (Full Body / Push / Pull), derived from the class name. Hosted / unknown classes are excluded.' }],
    notes: [`Attended visits ${start} → ${end}${input.locations?.length ? ` at ${input.locations.join(', ')}` : ''}. A client counts in a format if they attended at least one class of it.`],
    checks: [], verified: true, rowCount: rows.length, extra: { start, end, mode },
  };
}
