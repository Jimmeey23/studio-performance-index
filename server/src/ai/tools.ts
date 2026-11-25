import crypto from 'node:crypto';
import type Anthropic from '@anthropic-ai/sdk';
import { runMetricsQuery } from '../semantic/engine.js';
import { trainerScorecards, rankingTable, breakdownTable, contributionTable, conversionTable, methodNotes, METHOD } from '../analytics/trainerScore.js';
import {
  forecast, detectAnomalies, cohortRetention, funnel, renewalAnalysis, winbackAnalysis, formatOverlap, targetVsActual,
  findValues, clientLookup, describeDataset, runSql, type AnyResult,
} from '../analytics/analyses.js';
import { DIMENSIONS } from '../semantic/metrics.js';
import { driverAnalysis } from '../analytics/drivers.js';
import { exploreClasses, GROUPINGS, CRITERIA } from '../analytics/classExplorer.js';
import { leadChannelReport } from '../analytics/leadChannels.js';
import { addNote, searchKnowledge } from './brandBrain.js';

const dimEnum = Object.keys(DIMENSIONS);
const filters = {
  type: 'array',
  description: 'Filters. Use find_values first if unsure of exact spellings. Matching is case-insensitive.',
  items: {
    type: 'object',
    properties: {
      dimension: { type: 'string', enum: dimEnum },
      op: { type: 'string', enum: ['in', 'not_in', 'contains', 'not_contains', 'gte', 'lte', 'is_null', 'not_null'] },
      values: { type: 'array', items: { type: ['string', 'number'] } },
    },
    required: ['dimension', 'values'],
  },
};
const date = { type: 'string', description: 'YYYY-MM-DD (inclusive)' };

export const TOOLS: Anthropic.Tool[] = [
  {
    name: 'query_metrics',
    description: 'Deterministic metric engine. Computes one or more catalog metrics, optionally broken down by dimensions and/or a time grain, over a date range, with optional comparison to the previous period or same period last year. Metrics from different datasets are aggregated separately and joined (no double counting). Returns a result_id usable in render.',
    input_schema: {
      type: 'object',
      properties: {
        metrics: { type: 'array', items: { type: 'string' }, description: 'Metric ids from the catalog' },
        dimensions: { type: 'array', items: { type: 'string', enum: dimEnum } },
        grain: { type: 'string', enum: ['day', 'week', 'month', 'quarter', 'year', 'all'] },
        start: date, end: date, filters,
        compare: { type: 'string', enum: ['previous_period', 'previous_year'] },
        sort: { type: 'object', properties: { by: { type: 'string' }, dir: { type: 'string', enum: ['asc', 'desc'] } } },
        limit: { type: 'integer' },
        include_future: { type: 'boolean', description: 'Include future scheduled classes/bookings' },
        title: { type: 'string', description: 'Short human title for this result' },
      },
      required: ['metrics'],
    },
  },
  {
    name: 'forecast',
    description: 'Monthly forecast of a metric with model selection by backtest, 80/95% intervals, month-to-date run-rate, drivers (YoY trend, seasonality) and optional probability of reaching a target. The first forecast month is the current (in-progress) month.',
    input_schema: { type: 'object', properties: { metric: { type: 'string' }, horizon: { type: 'integer', description: 'months ahead incl. current, 1-12' }, filters, split_by: { type: 'string', enum: dimEnum }, target: { type: 'number' }, history_months: { type: 'integer' } }, required: ['metric'] },
  },
  {
    name: 'detect_anomalies',
    description: 'Scan metrics for unusual movements in the last complete month vs the trailing 12 months (z-score, MoM, YoY), optionally per segment.',
    input_schema: { type: 'object', properties: { metrics: { type: 'array', items: { type: 'string' } }, split_by: { type: 'string', enum: dimEnum }, months: { type: 'integer' }, filters } },
  },
  {
    name: 'cohort_retention',
    description: 'Cohort retention matrix (M0..Mn) by first-visit or first-purchase month; activity = attended visit or purchase.',
    input_schema: { type: 'object', properties: { basis: { type: 'string', enum: ['first_visit', 'first_purchase'] }, activity: { type: 'string', enum: ['visit', 'purchase'] }, start: date, end: date, months: { type: 'integer' }, locations: { type: 'array', items: { type: 'string' } } } },
  },
  {
    name: 'funnel',
    description: 'Lead funnel (leads → trial completed → converted) or new-client funnel (first visit → converted → retained), optionally split by a dimension.',
    input_schema: { type: 'object', properties: { type: { type: 'string', enum: ['leads', 'new_clients'] }, start: date, end: date, split_by: { type: 'string', enum: dimEnum }, filters } },
  },
  {
    name: 'renewal_analysis',
    description: 'Membership renewal rates for memberships ending in a window, recomputed from the sales ledger (with the sheet status as cross-check). Group by month, location or membership; include_list returns members whose renewal window is still open (at-risk list).',
    input_schema: { type: 'object', properties: { start: date, end: date, group_by: { type: 'string', enum: ['month', 'location', 'membership', 'none'] }, locations: { type: 'array', items: { type: 'string' } }, include_list: { type: 'boolean' } } },
  },
  {
    name: 'trainer_scorecard',
    description: 'Composite trainer ranking (0–100): class average 25, fill 20, new-client conversion 20 and retention 10 (both shrunk to the studio rate and weighted by sample size so trainers with few newcomers are not penalised), revenue per class 10, non-empty classes 10, volume 5; penalties for <18 months experience and above-median late-cancel rate. view=ranking (score, sessions, non-empty/empty, check-ins, class avg, fill, late cancels, experience), breakdown (points per component), contribution (class revenue, share, rev/class, totals), conversion (new clients, converted & retained net + %, by revenue). location = score within one studio; omit for all studios combined.',
    input_schema: { type: 'object', properties: { start: date, end: date, view: { type: 'string', enum: ['ranking', 'breakdown', 'contribution', 'conversion'] }, location: { type: 'string' }, limit: { type: 'integer' } }, required: ['view'] },
  },
  {
    name: 'winback_analysis',
    description: 'Win-backs/reactivations: purchases by clients inactive for N+ days before buying, by month or location, plus the current inactive-client pool (paying clients with no visit for N+ days — a visit-inactivity measure, distinct from membership status Lapsed, which means 30+ days past membership end without renewal).',
    input_schema: { type: 'object', properties: { start: date, end: date, inactive_days: { type: 'integer' }, group_by: { type: 'string', enum: ['month', 'location'] } } },
  },
  {
    name: 'format_overlap',
    description: 'Barre vs powerCycle vs Strength Lab client cross-over from attended visits. mode=segments: clients by format combination (Barre only, Barre + powerCycle, All three…) with visits; mode=matrix: share of each format\'s clients who also attend the other formats.',
    input_schema: { type: 'object', properties: { start: date, end: date, locations: { type: 'array', items: { type: 'string' } }, mode: { type: 'string', enum: ['segments', 'matrix'] } } },
  },
  {
    name: 'target_vs_actual',
    description: 'Compare a metric with targets loaded in Settings › Targets. Says clearly when no targets exist.',
    input_schema: { type: 'object', properties: { metric: { type: 'string' }, start: date, end: date, by_location: { type: 'boolean' } }, required: ['metric'] },
  },
  {
    name: 'find_values',
    description: 'Look up exact values of a dimension (e.g. product names containing "annual", teacher names, lead sources) with row counts.',
    input_schema: { type: 'object', properties: { dimension: { type: 'string', enum: dimEnum }, search: { type: 'string' }, dataset: { type: 'string' } }, required: ['dimension'] },
  },
  {
    name: 'client_lookup',
    description: 'Look up one client by member id, email or name: profile, purchases, monthly visits, memberships.',
    input_schema: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] },
  },
  {
    name: 'describe_dataset',
    description: 'Data dictionary for a dataset/model: grain, columns, types, null %, top values, coverage.',
    input_schema: { type: 'object', properties: { dataset: { type: 'string', description: 'semantic dataset id (sales, visits, …) or table name (fct_sales …)' } }, required: ['dataset'] },
  },
  {
    name: 'run_sql',
    description: 'Read-only DuckDB SQL over curated models (fct_*, dim_*, stg_*) for analyses the catalog cannot express. Aggregate each fact table before joining to avoid double counting. Max 1000 rows.',
    input_schema: { type: 'object', properties: { sql: { type: 'string' }, purpose: { type: 'string' } }, required: ['sql', 'purpose'] },
  },
  {
    name: 'calculate',
    description: 'Exact arithmetic for derived figures (differences, shares, what-if scenarios). Give named inputs taken from tool results and an expression using + - * / ( ) and the names.',
    input_schema: { type: 'object', properties: { inputs: { type: 'object', additionalProperties: { type: 'number' } }, expression: { type: 'string' }, label: { type: 'string' } }, required: ['inputs', 'expression', 'label'] },
  },
  {
    name: 'plan',
    description: 'For multi-step or complex questions: lay out your analysis plan BEFORE the first data call (3–7 concrete steps), then call again to update step statuses as you go (running → done / skipped, with a short note of what you found). The plan is shown to the user as a live checklist. Skip it for simple lookups.',
    input_schema: { type: 'object', properties: {
      goal: { type: 'string', description: 'the decision or question in one line (first call)' },
      steps: { type: 'array', description: 'first call: the steps', items: { type: 'object', properties: { id: { type: 'string' }, text: { type: 'string' } }, required: ['id', 'text'] } },
      updates: { type: 'array', description: 'later calls: status changes', items: { type: 'object', properties: { id: { type: 'string' }, status: { type: 'string', enum: ['running', 'done', 'skipped'] }, note: { type: 'string' } }, required: ['id', 'status'] } },
    } },
  },
  {
    name: 'driver_analysis',
    description: 'Explain WHY a metric moved: decomposes the change vs the previous period or last year across several dimensions at once (location, product family, channel, source, class, trainer, weekday…). Volume metrics get each segment\'s contribution and share of the change; rate metrics are split into rate and mix effects. Use this first for any "why did X change" question, then drill into the biggest movers.',
    input_schema: { type: 'object', properties: { metric: { type: 'string' }, start: date, end: date, compare: { type: 'string', enum: ['previous_period', 'previous_year'] }, dimensions: { type: 'array', items: { type: 'string', enum: dimEnum }, description: 'optional; sensible defaults per dataset' }, filters, top: { type: 'number', description: 'segments per dimension (default 8)' } }, required: ['metric', 'start', 'end'] },
  },
  {
    name: 'class_explorer',
    description: `Rank classes by any grouping on one of ${CRITERIA.length} criteria with ~30 metrics each (attendance, fill, booking fill, show-up, empty %, revenue per class/attendee, late cancels, sold-out %, consistency, composite class score). Groupings: ${GROUPINGS.map((g) => g.id).join(', ')}. Filters: minimum classes / average attendance / check-ins, hosted classes exclude|include|only, formats, days, AM/PM, search.`,
    input_schema: { type: 'object', properties: { start: date, end: date, locations: { type: 'array', items: { type: 'string' } }, grouping: { type: 'string', enum: GROUPINGS.map((g) => g.id) }, rankBy: { type: 'string', enum: CRITERIA.map((c) => c.id) }, dir: { type: 'string', enum: ['desc', 'asc'] },
      minClasses: { type: 'number' }, minAvg: { type: 'number' }, minCheckins: { type: 'number' }, hosted: { type: 'string', enum: ['exclude', 'include', 'only'] }, formats: { type: 'array', items: { type: 'string', enum: ['Barre', 'powerCycle', 'Strength Lab', 'Other'] } },
      days: { type: 'array', items: { type: 'string' } }, ampm: { type: 'string', enum: ['all', 'AM', 'PM'] }, search: { type: 'string' }, limit: { type: 'number' } }, required: ['start', 'end'] },
  },
  {
    name: 'lead_channel_analysis',
    description: 'Full lead funnel by channel and source: leads → trials completed → purchasing members (sale on/after lead creation), with CRM conversion, retention and LTV, per studio, plus a studio × channel conversion matrix. Returns several tables.',
    input_schema: { type: 'object', properties: { start: date, end: date, locations: { type: 'array', items: { type: 'string' } } }, required: ['start', 'end'] },
  },
  {
    name: 'brand_knowledge',
    description: 'Look up what you know about the brand: method and formats, studios and addresses, published rates, policies (cancellation, late entry), trainers by studio, product ladder and prices paid, lead channels, benchmarks per studio, seasonality and notes the team taught you. Use it when a question needs brand context rather than a metric.',
    input_schema: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] },
  },
  {
    name: 'remember',
    description: 'Save a durable business fact or standing preference the user has told you (e.g. a nickname for a studio, a target, a definition they use, how they want something reported) so future answers use it. Only for things the user stated or confirmed — never your own conclusions or one-off numbers. Tell the user briefly that you saved it.',
    input_schema: { type: 'object', properties: { fact: { type: 'string' }, category: { type: 'string', enum: ['terminology', 'definition', 'target', 'preference', 'studio', 'trainer', 'product', 'policy', 'general'] } }, required: ['fact'] },
  },
  {
    name: 'ask_user',
    description: 'Ask the user ONE clarifying question with 2–5 clickable answer options when the request is genuinely ambiguous and a wrong guess would mislead (e.g. which revenue basis, which period, which locations). Ends your turn; the user\'s click arrives as the next message. Do not use for things you can resolve with sensible defaults.',
    input_schema: { type: 'object', properties: { question: { type: 'string' }, options: { type: 'array', items: { type: 'string' }, minItems: 2, maxItems: 5 }, why: { type: 'string', description: 'one short line on why it matters' } }, required: ['question', 'options'] },
  },
  {
    name: 'suggest_followups',
    description: 'REQUIRED as your last tool call on every answer: exactly 3 natural next questions the user is likely to ask, specific to this analysis (drill deeper, compare, act). Phrase them as the user would type them.',
    input_schema: { type: 'object', properties: { questions: { type: 'array', items: { type: 'string' }, minItems: 3, maxItems: 3 } }, required: ['questions'] },
  },
  {
    name: 'render',
    description: 'Add visual blocks to the answer. Blocks reference result_ids from earlier tool calls — the data is attached by the server, never re-typed. Call once with all blocks, in display order.',
    input_schema: {
      type: 'object',
      properties: {
        blocks: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              type: { type: 'string', enum: ['kpis', 'table', 'chart', 'forecast_chart', 'heatmap', 'funnel', 'insights'] },
              result_id: { type: 'string' },
              title: { type: 'string' },
              metrics: { type: 'array', items: { type: 'string' }, description: 'kpis: metric ids to show as cards' },
              columns: { type: 'array', items: { type: 'string' }, description: 'table: column keys to show (default all)' },
              pivot: { type: 'object', properties: { rows: { type: 'string' }, columns: { type: 'string' }, value: { type: 'string' } }, description: 'table: pivot rows×columns of one value' },
              view: { type: 'string', enum: ['table', 'mom', 'pivot', 'grouped'], description: 'table default view. Use "mom" for month-on-month results (grain=month): months become columns, newest on the left.' },
              group_by: { type: 'string', description: 'table: dimension to group rows by (grouped view with subtotals)' },
              chart: { type: 'string', enum: ['bar', 'line', 'area', 'pie', 'combo', 'stacked_bar', 'horizontal_bar'] },
              x: { type: 'string' }, y: { type: 'array', items: { type: 'string' } }, series_by: { type: 'string', description: 'dimension that splits lines/bars into series' },
              items: {
                type: 'array', description: 'insights block',
                items: { type: 'object', properties: { kind: { type: 'string', enum: ['observation', 'risk', 'opportunity', 'recommendation'] }, title: { type: 'string' }, detail: { type: 'string' }, priority: { type: 'string', enum: ['high', 'medium', 'low'] } }, required: ['kind', 'title', 'detail'] },
              },
            },
            required: ['type'],
          },
        },
      },
      required: ['blocks'],
    },
  },
];

function calculate(input: { inputs: Record<string, number>; expression: string; label: string }): AnyResult {
  const names = Object.keys(input.inputs ?? {}).sort((a, b) => b.length - a.length);
  let expr = input.expression;
  for (const n of names) expr = expr.split(n).join(`(${Number(input.inputs[n])})`);
  if (!/^[\d\s+\-*/().eE]+$/.test(expr)) throw new Error('Expression may only use numbers, + - * / ( ) and the input names.');
  // eslint-disable-next-line no-new-func
  const value = Number(Function(`"use strict"; return (${expr});`)());
  return {
    id: 'r_' + crypto.randomBytes(5).toString('hex'), kind: 'calculation', title: input.label,
    columns: [{ key: 'label', label: 'Calculation', kind: 'dimension', format: 'text' }, { key: 'value', label: 'Value', kind: 'metric', format: 'decimal' }],
    rows: [{ label: input.label, value, expression: input.expression, ...input.inputs }], sql: [], sources: ['Derived from earlier results'],
    definitions: [], notes: [`${input.expression} with ${JSON.stringify(input.inputs)}`], checks: [], verified: true, rowCount: 1,
  };
}

export async function executeTool(name: string, input: Record<string, unknown>): Promise<{ result?: AnyResult; data?: unknown }> {
  switch (name) {
    case 'query_metrics': { const r = await runMetricsQuery(input); if (input.title) r.title = String(input.title); return { result: r }; }
    case 'forecast': return { result: await forecast(input as never) };
    case 'detect_anomalies': return { result: await detectAnomalies(input as never) };
    case 'cohort_retention': return { result: await cohortRetention(input as never) };
    case 'funnel': return { result: await funnel(input as never) };
    case 'renewal_analysis': return { result: await renewalAnalysis(input as never) };
    case 'trainer_scorecard': {
      const today = new Date().toISOString().slice(0, 10);
      const start = String(input.start ?? `${today.slice(0, 4)}-01-01`), end = String(input.end ?? today);
      const loc = input.location ? [String(input.location)] : undefined;
      const sc = await trainerScorecards({ start, end, locations: loc });
      const scope = sc.all; const lim = Number(input.limit ?? 25);
      const view = String(input.view ?? 'ranking');
      const r = view === 'breakdown' ? breakdownTable(scope, lim) : view === 'contribution' ? contributionTable(scope, lim) : view === 'conversion' ? conversionTable(scope, lim) : rankingTable(scope, lim);
      r.notes = [...methodNotes(scope), ...METHOD.map((m) => `${m.term}: ${m.text}`)];
      return { result: r };
    }
    case 'winback_analysis': return { result: await winbackAnalysis(input as never) };
    case 'format_overlap': return { result: await formatOverlap(input as never) };
    case 'target_vs_actual': return { result: await targetVsActual(input as never) };
    case 'run_sql': return { result: await runSql(input as never) };
    case 'calculate': return { result: calculate(input as never) };
    case 'find_values': return { data: await findValues(input as never) };
    case 'client_lookup': return { data: await clientLookup(input as never) };
    case 'describe_dataset': return { data: await describeDataset(input as never) };
    case 'driver_analysis': return { result: await driverAnalysis(input as never) };
    case 'class_explorer': { const r = await exploreClasses(input); return { result: r.result as unknown as AnyResult }; }
    case 'lead_channel_analysis': {
      const r = await leadChannelReport({ start: String(input.start), end: String(input.end), locations: (input.locations as string[]) ?? [] });
      const tables = r.sections.flatMap((s) => s.tables.map((t) => t.result)).slice(0, 8);
      return { data: { headline: r.headline.map((k) => `${k.label}: ${k.value}`), answers: r.sections.filter((s) => s.answer).map((s) => ({ question: s.answer!.question, answer: s.answer!.headline, points: s.answer!.points })),
        insights: r.insights, tables: tables.map((t) => ({ title: t.title, columns: t.columns.map((c) => c.key), rows: t.rows.slice(0, 25), totals: t.totals })) } };
    }
    case 'brand_knowledge': return { data: await searchKnowledge(String(input.query ?? '')) };
    case 'remember': { const n = await addNote(String(input.fact ?? ''), String(input.category ?? 'general'), 'assistant'); return { data: { saved: n.text, id: n.id } }; }
    default: throw new Error(`Unknown tool ${name}`);
  }
}

/** Compact view of a result for the LLM: enough to reason, bounded tokens. */
export function summarise(r: AnyResult, maxRows = 60): string {
  const rows = r.rows.slice(0, maxRows).map((row) => {
    const o: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(row)) o[k] = typeof v === 'number' ? Math.round(v * 10000) / 10000 : v;
    return o;
  });
  return JSON.stringify({
    result_id: r.id, kind: r.kind, title: r.title, columns: r.columns.map((c) => `${c.key}:${c.format ?? ''}`),
    rows, row_count: r.rowCount, rows_shown: rows.length, totals: (r as { totals?: unknown }).totals,
    period: (r as { period?: unknown }).period, extra: (r as { extra?: unknown }).extra,
    notes: r.notes, checks: r.checks.filter((c) => !c.passed), verified: r.verified,
    definitions: r.definitions.map((d) => `${d.label}: ${d.description}${d.caveat ? ' CAVEAT: ' + d.caveat : ''}`),
  });
}
