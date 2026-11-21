/**
 * Builds an expert workspace overview: every widget computed by the semantic
 * engine under one set of global filters (period, locations, comparison).
 */
import { z } from 'zod';
import { runMetricsQuery } from '../semantic/engine.js';
import { metricById, modelById } from '../semantic/metrics.js';
import { executeTool } from './tools.js';
import type { Domain, Widget } from './domains.js';

export const DashboardFilterSchema = z.object({
  start: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  end: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  locations: z.array(z.string()).default([]),
  compare: z.enum(['previous_period', 'previous_year', 'none']).default('previous_year'),
  grain: z.enum(['week', 'month', 'quarter']).default('month'),
});
export type DashboardFilters = z.infer<typeof DashboardFilterSchema>;

const iso = (d: Date) => d.toISOString().slice(0, 10);
function istNow() { return new Date(Date.now() + 5.5 * 3600e3); }

export function resolvePeriod(f: DashboardFilters) {
  const now = istNow();
  const lastMonthEnd = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 0));
  const end = f.end ?? iso(lastMonthEnd);
  const e = new Date(end + 'T00:00:00Z');
  const start = f.start ?? iso(new Date(Date.UTC(e.getUTCFullYear(), e.getUTCMonth() - 2, 1)));
  const s = new Date(start + 'T00:00:00Z');
  const months = (e.getUTCFullYear() - s.getUTCFullYear()) * 12 + e.getUTCMonth() - s.getUTCMonth() + 1;
  // Trends always show enough history to read seasonality.
  const trendStart = months >= 12 ? start : iso(new Date(Date.UTC(e.getUTCFullYear(), e.getUTCMonth() - 13, 1)));
  return { start, end, trendStart, months };
}

function locFilter(metrics: string[], f: DashboardFilters, extra: { dimension: string; op?: 'in' | 'not_in'; values: string[] }[] = []): { dimension: string; op: 'in' | 'not_in'; values: string[] }[] {
  const ex = extra.map((x) => ({ ...x, op: x.op ?? 'in' as const }));
  if (!f.locations.length) return ex;
  const ok = metrics.every((m) => { const mt = metricById.get(m); return mt && modelById.get(mt.model)?.dims.location; });
  return [...(ok ? [{ dimension: 'location', op: 'in' as const, values: f.locations }] : []), ...ex];
}

export async function buildWidget(w: Widget, f: DashboardFilters, p: ReturnType<typeof resolvePeriod>) {
  const compare = f.compare === 'none' ? null : f.compare;
  switch (w.type) {
    case 'kpis': {
      const filters = locFilter(w.metrics, f, w.filters);
      const totals = await runMetricsQuery({ metrics: w.metrics, start: p.start, end: p.end, compare, filters });
      const series = await runMetricsQuery({ metrics: w.metrics, grain: 'month', start: p.trendStart, end: p.end, filters });
      return { result: totals, series };
    }
    case 'chart':
      if (w.chart === 'pie') return { result: await runMetricsQuery({ metrics: w.metrics, dimensions: w.dimension ? [w.dimension] : [], start: p.start, end: p.end, filters: locFilter(w.metrics, f, w.filters) }) };
      return { result: await runMetricsQuery({ metrics: w.metrics, dimensions: w.dimension ? [w.dimension] : [], grain: w.grain ?? f.grain, start: p.trendStart, end: p.end, filters: locFilter(w.metrics, f, w.filters) }) };
    case 'table':
      return { result: await runMetricsQuery({ metrics: w.metrics, dimensions: w.dimensions, start: p.start, end: p.end, compare, filters: locFilter(w.metrics, f, w.filters), sort: { by: w.sort ?? w.metrics[0], dir: 'desc' }, limit: w.limit ?? 50 }) };
    case 'ranking': {
      const ms = [w.metric, ...(w.extra ?? [])];
      return { result: await runMetricsQuery({ metrics: ms, dimensions: [w.dimension], start: p.start, end: p.end, compare, filters: [...locFilter(ms, f, w.filters), { dimension: w.dimension, op: 'not_in', values: ['(blank)'] }], sort: { by: w.metric, dir: 'desc' }, limit: w.limit ?? 10 }) };
    }
    case 'mom':
      return { result: await runMetricsQuery({ metrics: w.metrics, dimensions: w.dimension ? [w.dimension] : [], grain: 'month', start: p.trendStart, end: p.end, compare: 'previous_year', filters: locFilter(w.metrics, f, w.filters) }) };
    case 'analysis': {
      const input: Record<string, unknown> = { ...w.input };
      if (['cohort_retention', 'renewal_analysis', 'format_overlap'].includes(w.tool) && f.locations.length) input.locations = f.locations;
      if (['funnel', 'renewal_analysis', 'winback_analysis', 'format_overlap'].includes(w.tool)) { input.start ??= p.start; input.end ??= p.end; }
      if (['forecast', 'funnel', 'detect_anomalies'].includes(w.tool) && f.locations.length) input.filters = [{ dimension: 'location', op: 'in', values: f.locations }];
      const r = await executeTool(w.tool, input);
      return { result: r.result };
    }
  }
}

export async function buildDashboard(d: Domain, raw: unknown) {
  const f = DashboardFilterSchema.parse(raw ?? {});
  const p = resolvePeriod(f);
  const widgets = [] as Record<string, unknown>[];
  for (const [i, w] of d.widgets.entries()) {
    try { widgets.push({ id: `w${i}`, ...w, ...(await buildWidget(w, f, p)) }); }
    catch (e) { widgets.push({ id: `w${i}`, ...w, error: (e as Error).message }); }
  }
  const { expert, ...meta } = d;
  return { domain: meta, filters: f, period: p, widgets, generatedAt: new Date().toISOString() };
}
