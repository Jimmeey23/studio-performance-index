/**
 * Driver analysis — "why did this metric move?" Decomposes the change in a metric between a period and its
 * comparison (previous period or same period last year) across several dimensions at once.
 *
 *  • Volume metrics (revenue, visits, leads…): each segment's contribution = current − previous, ranked by size,
 *    with its share of the total change.
 *  • Rate metrics (conversion, fill, ATV…): change split into a RATE effect (the segment's own rate moved) and a
 *    MIX effect (the segment's weight in the base moved), using the model's natural base volume.
 */
import crypto from 'node:crypto';
import { runMetricsQuery, type Column } from '../semantic/engine.js';
import { metricById, modelById, METRICS } from '../semantic/metrics.js';
import type { AnyResult } from './analyses.js';

const PRIORITY = ['location', 'product_family', 'category', 'channel', 'source', 'class_name', 'format', 'teacher', 'sold_by', 'first_visit_type', 'trial_product', 'membership', 'day_of_week', 'prime_time', 'payment_method', 'associate'];
/** Natural base volume for a rate metric in each model (its denominator in plain terms). */
const BASE: Record<string, string> = { sales: 'transactions', new_clients: 'new_clients', leads: 'leads', sessions: 'capacity', visits: 'visits', memberships: 'memberships_expiring' };

type Filter = { dimension: string; op?: string; values: (string | number)[] };
export async function driverAnalysis(input: { metric: string; start: string; end: string; compare?: 'previous_period' | 'previous_year'; dimensions?: string[]; filters?: Filter[]; top?: number }): Promise<AnyResult> {
  const mt = metricById.get(input.metric);
  if (!mt) throw new Error(`Unknown metric ${input.metric}`);
  const model = modelById.get(mt.model)!;
  const compare = input.compare ?? 'previous_year';
  const dims = (input.dimensions?.length ? input.dimensions : PRIORITY).filter((d) => model.dims[d]).slice(0, input.dimensions?.length ? 6 : 5);
  if (!dims.length) throw new Error(`No dimensions available for ${mt.label}`);
  const top = Math.min(15, input.top ?? 8);
  const additive = !!mt.additive;
  const baseId = !additive ? BASE[mt.model] : undefined;
  const base = baseId && metricById.get(baseId) && METRICS.some((m) => m.id === baseId) ? baseId : undefined;
  const metrics = base && base !== input.metric ? [input.metric, base] : [input.metric];
  const filters = input.filters as never;

  const tot = await runMetricsQuery({ metrics, start: input.start, end: input.end, compare, filters });
  const T = tot.rows[0] ?? {};
  const cur = Number(T[input.metric] ?? 0), prev = Number(T[`${input.metric}__prev`] ?? 0);
  const totalChange = cur - prev;
  const rows: Record<string, unknown>[] = [];
  const notes: string[] = [];
  for (const d of dims) {
    const r = await runMetricsQuery({ metrics, dimensions: [d], start: input.start, end: input.end, compare, filters, limit: 500 });
    const segs = r.rows.map((x) => {
      const c = Number(x[input.metric] ?? 0), p = Number(x[`${input.metric}__prev`] ?? 0);
      const o: Record<string, unknown> = { dimension: d, segment: String(x[d] ?? '(blank)'), current: x[input.metric] ?? null, previous: x[`${input.metric}__prev`] ?? null, change: c - p };
      if (additive) { o.contribution = c - p; o.share_of_change = totalChange ? (c - p) / totalChange : null; }
      else if (base) {
        const bc = Number(x[base] ?? 0), bp = Number(x[`${base}__prev`] ?? 0);
        const Bc = Number(T[base] ?? 0), Bp = Number(T[`${base}__prev`] ?? 0);
        const wc = Bc ? bc / Bc : 0, wp = Bp ? bp / Bp : 0;
        o.rate_effect = wc * (c - p); o.mix_effect = (wc - wp) * (p - prev); o.contribution = (o.rate_effect as number) + (o.mix_effect as number);
        o.weight = wc; o.weight_prev = wp; o.share_of_change = totalChange ? (o.contribution as number) / totalChange : null;
      }
      return o;
    });
    const key = additive || base ? 'contribution' : 'change';
    segs.sort((a, b) => Math.abs(Number(b[key])) - Math.abs(Number(a[key])));
    rows.push(...segs.slice(0, top));
    const lead = segs[0];
    if (lead) notes.push(`${d}: biggest mover "${lead.segment}" (${key} ${Number(lead[key]).toFixed(mt.format === 'percent' ? 4 : 2)}).`);
  }
  const col = (key: string, label: string, format: string, kind: Column['kind'] = 'metric') => ({ key, label, kind, format } as Column);
  const f = mt.format;
  const columns: Column[] = [col('dimension', 'Dimension', 'text', 'dimension'), col('segment', 'Segment', 'text', 'dimension'), col('current', 'Current', f), col('previous', compare === 'previous_year' ? 'Last year' : 'Previous', f), col('change', 'Change', f),
    ...(additive || base ? [col('contribution', 'Contribution to change', f), col('share_of_change', 'Share of change', 'percent')] : []),
    ...(base ? [col('rate_effect', 'Rate effect', f), col('mix_effect', 'Mix effect', f), col('weight', 'Weight now', 'percent'), col('weight_prev', 'Weight before', 'percent')] : [])];
  return {
    id: 'r_' + crypto.randomBytes(5).toString('hex'), kind: 'driver_analysis', title: `What drove ${mt.label.toLowerCase()} — ${input.start} to ${input.end} vs ${compare === 'previous_year' ? 'last year' : 'previous period'}`,
    columns, rows, totals: { current: cur, previous: prev, change: totalChange }, sql: [], sources: [model.source ?? model.table], definitions: [{ metric: mt.id, label: mt.label, description: mt.description }],
    notes: [`Total: ${cur} vs ${prev} (change ${totalChange}).`, additive ? 'Contribution = segment current − previous; shares sum to 100% within each dimension.' : base ? `Rate metric decomposed on ${metricById.get(base)!.label.toLowerCase()} weights: rate effect = weight now × change in segment rate; mix effect = change in weight × (segment's previous rate − overall previous rate).` : 'Rate metric without a base volume — segment changes shown, not additive.', ...notes],
    checks: [], verified: true, rowCount: rows.length,
  } as unknown as AnyResult;
}
