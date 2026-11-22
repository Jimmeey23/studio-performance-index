import crypto from 'node:crypto';
import { z } from 'zod';
import { warehouse, sqlString } from '../warehouse/db.js';
import { DIMENSIONS, METRICS, metricById, modelById, type Format } from './metrics.js';

export const FilterSchema = z.object({
  dimension: z.string(),
  op: z.enum(['in', 'not_in', 'contains', 'not_contains', 'gte', 'lte', 'is_null', 'not_null']).default('in'),
  values: z.array(z.union([z.string(), z.number()])).default([]),
});
export const QuerySpecSchema = z.object({
  metrics: z.array(z.string()).min(1),
  dimensions: z.array(z.string()).default([]),
  grain: z.enum(['day', 'week', 'month', 'quarter', 'year', 'all']).default('all'),
  start: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  end: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  filters: z.array(FilterSchema).default([]),
  compare: z.enum(['previous_period', 'previous_year']).nullable().optional(),
  sort: z.object({ by: z.string(), dir: z.enum(['asc', 'desc']).default('desc') }).optional(),
  limit: z.number().int().positive().max(5000).optional(),
  include_future: z.boolean().optional(),
  include_imported: z.boolean().optional(),
});
export type QuerySpec = z.infer<typeof QuerySpecSchema>;

export interface Column { key: string; label: string; kind: 'period' | 'dimension' | 'metric' | 'comparison' | 'change'; format?: Format | 'date' | 'text' }
export interface Check { name: string; passed: boolean; detail: string }
export interface QueryResult {
  id: string;
  kind: 'metrics';
  title?: string;
  spec: QuerySpec;
  columns: Column[];
  rows: Record<string, unknown>[];
  totals?: Record<string, unknown>;
  sql: string[];
  sources: string[];
  definitions: { metric: string; label: string; description: string; caveat?: string }[];
  notes: string[];
  checks: Check[];
  verified: boolean;
  period: { start?: string; end?: string; comparisonStart?: string; comparisonEnd?: string };
  rowCount: number;
  truncated?: boolean;
}

export class QueryError extends Error {}

const today = () => new Date(Date.now() + 5.5 * 3600e3).toISOString().slice(0, 10); // IST date

function shift(start: string, end: string, mode: 'previous_period' | 'previous_year') {
  const s = new Date(start + 'T00:00:00Z'), e = new Date(end + 'T00:00:00Z');
  if (mode === 'previous_year') {
    const ps = new Date(s); ps.setUTCFullYear(s.getUTCFullYear() - 1);
    const pe = new Date(e); pe.setUTCFullYear(e.getUTCFullYear() - 1);
    return { start: ps.toISOString().slice(0, 10), end: pe.toISOString().slice(0, 10) };
  }
  // previous period: same length immediately before; whole months map to whole months
  const isMonthStart = s.getUTCDate() === 1;
  const nextDay = new Date(e); nextDay.setUTCDate(e.getUTCDate() + 1);
  const isMonthEnd = nextDay.getUTCDate() === 1;
  if (isMonthStart && isMonthEnd) {
    const months = (e.getUTCFullYear() - s.getUTCFullYear()) * 12 + e.getUTCMonth() - s.getUTCMonth() + 1;
    const ps = new Date(Date.UTC(s.getUTCFullYear(), s.getUTCMonth() - months, 1));
    const pe = new Date(Date.UTC(s.getUTCFullYear(), s.getUTCMonth(), 0));
    return { start: ps.toISOString().slice(0, 10), end: pe.toISOString().slice(0, 10) };
  }
  const days = Math.round((e.getTime() - s.getTime()) / 864e5) + 1;
  const pe = new Date(s); pe.setUTCDate(s.getUTCDate() - 1);
  const ps = new Date(pe); ps.setUTCDate(pe.getUTCDate() - days + 1);
  return { start: ps.toISOString().slice(0, 10), end: pe.toISOString().slice(0, 10) };
}

function filterSql(expr: string, f: z.infer<typeof FilterSchema>): string {
  const vals = f.values.map((v) => (typeof v === 'number' ? String(v) : sqlString(String(v))));
  const lowerVals = f.values.map((v) => sqlString(String(v).toLowerCase()));
  switch (f.op) {
    case 'in': return vals.length ? `lower(cast(${expr} as varchar)) in (${lowerVals.join(', ')})` : 'true';
    case 'not_in': return vals.length ? `coalesce(lower(cast(${expr} as varchar)) not in (${lowerVals.join(', ')}), true)` : 'true';
    case 'contains': return '(' + f.values.map((v) => `cast(${expr} as varchar) ilike ${sqlString('%' + v + '%')}`).join(' or ') + ')';
    case 'not_contains': return '(' + f.values.map((v) => `coalesce(cast(${expr} as varchar) not ilike ${sqlString('%' + v + '%')}, true)`).join(' and ') + ')';
    case 'gte': return `${expr} >= ${vals[0]}`;
    case 'lte': return `${expr} <= ${vals[0]}`;
    case 'is_null': return `${expr} is null`;
    case 'not_null': return `${expr} is not null`;
  }
}

interface Compiled { sql: string; modelIds: string[]; notes: string[] }

export function compile(spec: QuerySpec, range: { start?: string; end?: string }): Compiled {
  const notes: string[] = [];
  const metrics = spec.metrics.map((id) => {
    const mt = metricById.get(id);
    if (!mt) throw new QueryError(`Unknown metric "${id}". Use list_metrics to see valid ids.`);
    return mt;
  });
  for (const d of spec.dimensions) if (!DIMENSIONS[d]) throw new QueryError(`Unknown dimension "${d}". Valid: ${Object.keys(DIMENSIONS).join(', ')}`);
  const byModel = new Map<string, typeof metrics>();
  for (const mt of metrics) byModel.set(mt.model, [...(byModel.get(mt.model) ?? []), mt]);

  const keys = [...(spec.grain !== 'all' ? ['period'] : []), ...spec.dimensions];
  const ctes: string[] = [];
  const modelIds = [...byModel.keys()];
  for (const [mid, mts] of byModel) {
    const sm = modelById.get(mid)!;
    const select: string[] = [];
    if (spec.grain !== 'all') select.push(`date_trunc('${spec.grain}', ${sm.timeColumn})::date as period`);
    for (const d of spec.dimensions) {
      const expr = sm.dims[d];
      if (!expr) {
        const supported = Object.keys(sm.dims).join(', ');
        throw new QueryError(`Metric(s) ${mts.map((x) => x.id).join(', ')} come from ${sm.label}, which has no "${d}" dimension. Supported: ${supported}.`);
      }
      select.push(`coalesce(cast(${expr} as varchar), '(blank)') as "${d}"`);
    }
    for (const mt of mts) select.push(`${mt.sql} as "${mt.id}"`);
    const where: string[] = [];
    if (sm.defaultWhere && !(mid === 'sessions' && spec.include_future) && !(mid === 'visits' && spec.include_imported)) where.push(sm.defaultWhere);
    if (range.start) where.push(`${sm.timeColumn} >= ${sqlString(range.start)}::timestamp`);
    if (range.end) where.push(`${sm.timeColumn} < (${sqlString(range.end)}::date + interval 1 day)`);
    for (const f of spec.filters) {
      if (!DIMENSIONS[f.dimension]) throw new QueryError(`Unknown filter dimension "${f.dimension}".`);
      const expr = sm.dims[f.dimension];
      if (!expr) {
        notes.push(`Filter on ${f.dimension} could not be applied to ${sm.label} (no such field) — ${mts.map((x) => x.label).join(', ')} are NOT filtered by ${f.dimension}.`);
        continue;
      }
      where.push(filterSql(expr, f));
    }
    const group = select.length - mts.length;
    ctes.push(`m_${mid} as (select ${select.join(', ')} from ${sm.table}${where.length ? ' where ' + where.join(' and ') : ''}${group ? ' group by ' + Array.from({ length: group }, (_, i) => i + 1).join(', ') : ''})`);
  }
  const ids = modelIds.map((x) => `m_${x}`);
  let from = ids[0];
  for (let i = 1; i < ids.length; i++) from += keys.length ? ` full outer join ${ids[i]} using (${keys.map((k) => `"${k}"`).join(', ')})` : ` cross join ${ids[i]}`;
  const sel = [...keys.map((k) => `"${k}"`), ...metrics.map((x) => `"${x.id}"`)];
  const sql = `with ${ctes.join(',\n')}\nselect ${sel.join(', ')} from ${from}`;
  if (modelIds.length > 1) notes.push(`Metrics come from ${modelIds.length} datasets; each was aggregated separately and joined on ${keys.length ? keys.join(' + ') : 'the period'} to avoid double counting.`);
  return { sql, modelIds, notes };
}

const fmtLabel = (id: string) => metricById.get(id)?.label ?? DIMENSIONS[id]?.label ?? (id === 'period' ? 'Period' : id);

export async function runMetricsQuery(input: unknown): Promise<QueryResult> {
  const spec = QuerySpecSchema.parse(input);
  const db = await warehouse();
  const notes: string[] = [];
  const checks: Check[] = [];

  // Default range: trailing 14 complete months when trending, else last complete month.
  let { start, end } = spec;
  const t = today();
  if (!start && !end && spec.grain !== 'all') {
    const d = new Date(t + 'T00:00:00Z');
    start = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - 14, 1)).toISOString().slice(0, 10);
    end = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 0)).toISOString().slice(0, 10);
    notes.push(`No period given — used the last 14 complete months (${start} to ${end}).`);
  }
  if (end && end > t && !spec.include_future) {
    notes.push(`Period ends after today (${t}); figures to ${t} only — the latest period is incomplete.`);
  }

  const compiled = compile(spec, { start, end });
  notes.push(...compiled.notes);
  const sqls = [compiled.sql];
  let rows = await db.all(compiled.sql);

  // Totals (for KPI cards and reconciliation of additive metrics)
  let totals: Record<string, unknown> | undefined;
  if (spec.dimensions.length || spec.grain !== 'all') {
    const tc = compile({ ...spec, dimensions: [], grain: 'all' }, { start, end });
    totals = (await db.all(tc.sql))[0];
    sqls.push(tc.sql);
    for (const id of spec.metrics) {
      const mt = metricById.get(id)!;
      if (!mt.additive || !totals) continue;
      const sum = rows.reduce((a, r) => a + (Number(r[id]) || 0), 0);
      const tot = Number(totals[id]) || 0;
      const ok = Math.abs(sum - tot) <= Math.max(1, Math.abs(tot) * 0.0001);
      checks.push({ name: `reconcile:${id}`, passed: ok, detail: ok ? `Breakdown sums to total (${tot.toLocaleString('en-IN')}).` : `Breakdown sums to ${sum.toLocaleString('en-IN')} but total is ${tot.toLocaleString('en-IN')} — some rows fall outside the breakdown.` });
    }
  }

  // Comparison period
  let comparison: { start: string; end: string } | undefined;
  if (spec.compare && start && end) {
    comparison = shift(start, end, spec.compare);
    const cc = compile({ ...spec, grain: spec.compare === 'previous_year' && spec.grain !== 'all' ? spec.grain : 'all' }, comparison);
    sqls.push(cc.sql);
    const prevRows = await db.all(cc.sql);
    const keyOf = (r: Record<string, unknown>, withPeriod: boolean, shiftYear = false) => {
      const parts = spec.dimensions.map((d) => String(r[d]));
      if (withPeriod && r.period) {
        const p = new Date(String(r.period).slice(0, 10) + 'T00:00:00Z');
        if (shiftYear) p.setUTCFullYear(p.getUTCFullYear() + 1);
        parts.unshift(p.toISOString().slice(0, 10));
      }
      return parts.join('\u0001');
    };
    const usePeriod = spec.compare === 'previous_year' && spec.grain !== 'all';
    const prevMap = new Map(prevRows.map((r) => [keyOf(r, usePeriod, true), r]));
    rows = rows.map((r) => {
      const p = prevMap.get(keyOf(r, usePeriod));
      const o: Record<string, unknown> = { ...r };
      for (const id of spec.metrics) {
        const cur = Number(r[id]); const prev = p ? Number(p[id]) : null;
        o[`${id}__prev`] = prev;
        const fmt = metricById.get(id)!.format;
        o[`${id}__chg`] = prev === null || !isFinite(cur) ? null : fmt === 'percent' ? cur - prev : prev === 0 ? null : (cur - prev) / Math.abs(prev);
      }
      return o;
    });
    if (totals) {
      const pt = (await db.all(compile({ ...spec, dimensions: [], grain: 'all' }, comparison).sql))[0];
      for (const id of spec.metrics) {
        totals[`${id}__prev`] = pt?.[id] ?? null;
        const cur = Number(totals[id]), prev = Number(pt?.[id]);
        totals[`${id}__chg`] = metricById.get(id)!.format === 'percent' ? cur - prev : prev ? (cur - prev) / Math.abs(prev) : null;
      }
    } else if (!spec.dimensions.length) {
      // single-row result: totals are the row itself
    }
    notes.push(`Compared with ${spec.compare === 'previous_year' ? 'the same period last year' : 'the previous period'}: ${comparison.start} to ${comparison.end}. Percent-format metrics show change in percentage points.`);
  }

  // Sorting & limiting
  const sortBy = spec.sort?.by ?? (spec.grain !== 'all' ? 'period' : spec.metrics[0]);
  const dir = spec.sort?.dir ?? (sortBy === 'period' ? 'asc' : 'desc');
  rows.sort((a, b) => {
    const x = a[sortBy], y = b[sortBy];
    if (x === y) return 0; if (x === null || x === undefined) return 1; if (y === null || y === undefined) return -1;
    const c = typeof x === 'number' && typeof y === 'number' ? x - y : String(x).localeCompare(String(y));
    return dir === 'asc' ? c : -c;
  });
  const fullCount = rows.length;
  let truncated = false;
  if (spec.limit && rows.length > spec.limit) { rows = rows.slice(0, spec.limit); truncated = true; notes.push(`Showing top ${spec.limit} of ${fullCount} rows by ${fmtLabel(sortBy)}.`); }
  if (rows.length > 2000) { rows = rows.slice(0, 2000); truncated = true; }

  // Partial-period flag
  if (spec.grain !== 'all') {
    for (const r of rows) {
      const p = String(r.period ?? '');
      if (!p) continue;
      const pe = periodEnd(p, spec.grain);
      if (pe > t) r.__partial = true;
    }
  }

  // Quality checks
  if (!rows.length) checks.push({ name: 'non_empty', passed: false, detail: 'No rows matched — check the period/filters.' });
  for (const mid of compiled.modelIds) {
    const sm = modelById.get(mid)!;
    const cov = await db.one<{ mn: string; mx: string }>(`select min(${sm.timeColumn})::date::varchar mn, max(${sm.timeColumn})::date::varchar mx from ${sm.table}`);
    if (cov && start && cov.mn > start) notes.push(`${sm.label} data starts on ${cov.mn}; earlier dates in the range have no data.`);
    if (cov && end && cov.mx < end && cov.mx < t) notes.push(`${sm.label} data ends on ${cov.mx} (last refresh); later dates have no data.`);
  }

  const columns: Column[] = [];
  if (spec.grain !== 'all') columns.push({ key: 'period', label: grainLabel(spec.grain), kind: 'period', format: 'date' });
  for (const d of spec.dimensions) columns.push({ key: d, label: DIMENSIONS[d].label, kind: 'dimension', format: 'text' });
  for (const id of spec.metrics) {
    const mt = metricById.get(id)!;
    columns.push({ key: id, label: mt.label, kind: 'metric', format: mt.format });
    if (spec.compare) {
      columns.push({ key: `${id}__prev`, label: `${mt.label} (${spec.compare === 'previous_year' ? 'LY' : 'prev'})`, kind: 'comparison', format: mt.format });
      columns.push({ key: `${id}__chg`, label: mt.format === 'percent' ? 'Δ pp' : 'Δ %', kind: 'change', format: mt.format === 'percent' ? 'percent' : 'percent' });
    }
  }
  const usedModels = compiled.modelIds.map((x) => modelById.get(x)!);
  for (const sm of usedModels) if (sm.defaultWhere) notes.push(`${sm.label}: applied default rule "${sm.defaultRuleLabel ?? sm.defaultWhere}".`);

  return {
    id: 'r_' + crypto.randomBytes(5).toString('hex'),
    kind: 'metrics',
    spec, columns, rows, totals,
    sql: sqls,
    sources: [...new Set(usedModels.map((x) => `${x.source} (${x.table})`))],
    definitions: spec.metrics.map((id) => { const mt = metricById.get(id)!; return { metric: id, label: mt.label, description: mt.description, caveat: mt.caveat }; }),
    notes: [...new Set(notes)],
    checks,
    verified: checks.every((c) => c.passed),
    period: { start, end, comparisonStart: comparison?.start, comparisonEnd: comparison?.end },
    rowCount: fullCount,
    truncated,
  };
}

function periodEnd(p: string, grain: string): string {
  const d = new Date(p + 'T00:00:00Z');
  if (grain === 'day') return p;
  if (grain === 'week') d.setUTCDate(d.getUTCDate() + 6);
  if (grain === 'month') { d.setUTCMonth(d.getUTCMonth() + 1); d.setUTCDate(0); }
  if (grain === 'quarter') { d.setUTCMonth(d.getUTCMonth() + 3); d.setUTCDate(0); }
  if (grain === 'year') { d.setUTCFullYear(d.getUTCFullYear() + 1); d.setUTCDate(0); }
  return d.toISOString().slice(0, 10);
}
const grainLabel = (g: string) => ({ day: 'Date', week: 'Week of', month: 'Month', quarter: 'Quarter', year: 'Year' } as Record<string, string>)[g] ?? 'Period';

export function catalog() {
  return {
    metrics: METRICS.map((x) => ({ id: x.id, label: x.label, dataset: x.model, format: x.format, description: x.description, caveat: x.caveat, higherIsBetter: x.higherIsBetter ?? null, additive: !!x.additive })),
    datasets: [...modelById.values()].map((x) => ({ id: x.id, label: x.label, table: x.table, time: x.timeLabel, dimensions: Object.keys(x.dims), defaultRule: x.defaultRuleLabel ?? x.defaultWhere, source: x.source })),
    dimensions: DIMENSIONS,
  };
}

/* ───────────────────────────── Item-level drill-through ───────────────────────────── */
const DRILL_BREAKDOWNS: Record<string, string[]> = {
  sales: ['location', 'category', 'product', 'sold_by', 'payment_method'],
  visits: ['location', 'class_name', 'teacher', 'time_slot', 'product'],
  sessions: ['location', 'class_name', 'teacher', 'slot', 'day_of_week'],
  new_clients: ['location', 'trial_product', 'teacher', 'source'],
  leads: ['location', 'source', 'channel', 'associate', 'status'],
  ads: ['campaign', 'city', 'platform'],
  memberships: ['location', 'membership', 'status'],
  late_cancels: ['location', 'class_name', 'notice', 'membership'],
  teacher_month: ['teacher', 'location'],
  client_formats: ['main_format', 'first_format', 'format_mix', 'location'],
  membership_formats: ['credited_format', 'membership', 'status', 'location'],
};

/** The record population a metric is about: its single FILTER clause for counts/sums; the denominator population for ratios. */
function metricScope(sql: string): string | null {
  const filters = [...sql.matchAll(/filter\s*\(\s*where\s+((?:[^()]|\([^()]*\))+)\)/gi)].map((m) => m[1].trim());
  const isRatio = /\/\s*nullif/i.test(sql);
  if (!filters.length) return null;
  if (!isRatio && new Set(filters).size === 1) return filters[0];
  if (isRatio) {
    // denominator = text after the last "/ nullif(" — use its filter if it has one
    const denom = sql.slice(sql.toLowerCase().lastIndexOf('nullif('));
    const f = denom.match(/filter\s*\(\s*where\s+((?:[^()]|\([^()]*\))+)\)/i);
    return f ? f[1].trim() : null;
  }
  return null;
}

export const DrillSchema = z.object({
  metric: z.string(),
  filters: z.array(FilterSchema).default([]),
  start: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  end: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  search: z.string().optional(),
  limit: z.number().int().positive().max(5000).default(1000),
  include_future: z.boolean().optional(),
});

export async function runDrill(input: unknown) {
  const d = DrillSchema.parse(input);
  const mt = metricById.get(d.metric);
  if (!mt) throw new QueryError(`Unknown metric ${d.metric}`);
  const sm = modelById.get(mt.model)!;
  const db = await warehouse();
  const where: string[] = [];
  const notes: string[] = [];
  if (sm.defaultWhere && !(mt.model === 'sessions' && d.include_future)) where.push(sm.defaultWhere);
  if (d.start) where.push(`${sm.timeColumn} >= ${sqlString(d.start)}::timestamp`);
  if (d.end) where.push(`${sm.timeColumn} < (${sqlString(d.end)}::date + interval 1 day)`);
  for (const f of d.filters) {
    const expr = sm.dims[f.dimension];
    if (!expr) { notes.push(`Filter on ${f.dimension} not applicable to ${sm.label}.`); continue; }
    where.push(f.values.length === 1 && f.values[0] === '(blank)' && f.op === 'in' ? `${expr} is null` : filterSql(expr, f));
  }
  const scope = metricScope(mt.sql);
  const scoped = scope ? [...where, `(${scope})`] : where;
  if (scope) notes.push(`Records limited to the rows this metric counts: ${scope}.`);
  else if (/\/\s*nullif/i.test(mt.sql)) notes.push(`${mt.label} is a ratio — showing its full base population; outcome columns show which rows count in the numerator.`);
  if (d.search) {
    const s = sqlString('%' + d.search + '%');
    scoped.push('(' + sm.drill.columns.map(([e]) => `cast(${e} as varchar) ilike ${s}`).join(' or ') + ')');
  }
  const w = (xs: string[]) => (xs.length ? ' where ' + xs.join(' and ') : '');
  const cols = sm.drill.columns.map(([e, k]) => `${e} as "${k}"`).join(', ');
  const recSql = `select ${cols} from ${sm.table}${w(scoped)} order by ${sm.drill.order} limit ${d.limit}`;
  const rows = await db.all(recSql);
  const countRow = await db.one(`select count(*) n from ${sm.table}${w(scoped)}`);
  const valueSql = `select ${mt.sql} as v from ${sm.table}${w(where)}`;
  const value = (await db.one(valueSql))?.v ?? null;
  const breakdowns: { dimension: string; label: string; rows: { value: string; metric: number | null; records: number }[] }[] = [];
  for (const dim of (DRILL_BREAKDOWNS[mt.model] ?? []).filter((x) => sm.dims[x] && !d.filters.some((f) => f.dimension === x && f.values.length === 1)).slice(0, 4)) {
    const bs = await db.all<{ value: string; metric: number; records: number }>(`select coalesce(cast(${sm.dims[dim]} as varchar), '(blank)') as value, ${mt.sql} as metric, count(*) as records from ${sm.table}${w(where)} group by 1 order by 2 desc nulls last limit 12`);
    breakdowns.push({ dimension: dim, label: DIMENSIONS[dim].label, rows: bs });
  }
  const trend = await db.all(`select date_trunc('month', ${sm.timeColumn})::date::varchar as period, ${mt.sql} as metric from ${sm.table}${w(where)} group by 1 order by 1`);
  const numericKeys = new Set(['gross_amount', 'tax_amount', 'discount_amount', 'paid_amount', 'capacity', 'booked', 'checked_in', 'late_cancelled', 'revenue', 'complimentary', 'first_purchase_value', 'days_to_convert', 'visits_post_trial', 'ltv', 'visits', 'spend', 'impressions', 'clicks', 'ad_leads', 'cpl', 'amount_paid', 'total_sessions', 'remaining_sessions', 'penalty_amount', 'hours_before_class', 'sessions', 'empty_sessions', 'customers', 'new_clients', 'converted', 'retained']);
  const currency = new Set(['gross_amount', 'tax_amount', 'discount_amount', 'paid_amount', 'revenue', 'first_purchase_value', 'ltv', 'spend', 'cpl', 'amount_paid', 'penalty_amount']);
  const columns: Column[] = sm.drill.columns.map(([, k, label]) => ({
    key: k, label, kind: numericKeys.has(k) ? 'metric' : 'dimension',
    format: k === 'fill' ? 'percent' : currency.has(k) ? 'currency' : numericKeys.has(k) ? 'number' : 'text',
  }));
  const total = Number(countRow?.n ?? 0);
  return {
    id: 'd_' + crypto.randomBytes(5).toString('hex'), kind: 'records', title: `${mt.label} — records`,
    metric: { id: mt.id, label: mt.label, format: mt.format, description: mt.description, value },
    columns, rows, rowCount: total, truncated: total > rows.length,
    breakdowns, trend, sql: [recSql, valueSql], sources: [`${sm.source} (${sm.table})`],
    notes: [...notes, total > rows.length ? `Showing the latest ${rows.length.toLocaleString('en-IN')} of ${total.toLocaleString('en-IN')} records.` : `${total.toLocaleString('en-IN')} records.`],
    checks: [], verified: true, definitions: [{ metric: mt.id, label: mt.label, description: mt.description, caveat: mt.caveat }],
  };
}
