/**
 * Custom report topics written by the user in plain English ("evening powerCycle at Bandra",
 * "do discount codes hurt renewals?"). The AI only *plans* the section — which governed metrics,
 * filters, charts and tables answer the brief — and every number is still computed by the
 * semantic engine. Plans are validated against the catalogue and filter values are matched to
 * real data values; without an AI key a keyword planner is used.
 */
import Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';
import { config } from '../config.js';
import { MODELS as AI, fallbackOrder, type Tier } from '../ai/router.js';
import { thinkParams, noteThinkingError, markMissing, isNotFound } from '../ai/models.js';
import { DIMENSIONS, METRICS, MODELS, metricById, modelById } from '../semantic/metrics.js';
import { runMetricsQuery } from '../semantic/engine.js';
type Filter = { dimension: string; op: 'in' | 'not_in'; values: string[] };
import { log } from '../util/log.js';

const clampStr = (n: number) => z.string().transform((x) => x.slice(0, n));
const clampArr = <T extends z.ZodTypeAny>(t: T, n: number) => z.array(t).transform((x) => x.slice(0, n));
const clampNum = (lo: number, hi: number) => z.coerce.number().transform((x) => Math.round(Math.min(hi, Math.max(lo, x))));
/** Lenient: model output is trimmed / clamped to what the report can show rather than rejected. */
export const PlanSchema = z.object({
  title: clampStr(70),
  summary: clampStr(320).default(''),
  kpis: clampArr(z.string(), 10).default([]),
  filters: clampArr(z.object({ dimension: z.string(), op: z.enum(['in', 'not_in']).catch('in').default('in'), values: clampArr(z.string(), 20) }), 4).default([]),
  charts: clampArr(z.object({ title: clampStr(90), kind: z.enum(['trend', 'trend_by', 'mix']).catch('trend'), metrics: clampArr(z.string(), 2), dimension: z.string().optional(), compare: z.boolean().optional() }), 4).default([]),
  tables: clampArr(z.object({ title: clampStr(90), metrics: clampArr(z.string(), 6), dims: clampArr(z.string(), 2), sort: z.string().optional(), dir: z.enum(['asc', 'desc']).catch('desc').optional(), limit: clampNum(3, 40).optional() }), 6).default([]),
  /** metric / dimension ids whose definitions the reader asked for */
  definitions: clampArr(z.string(), 16).default([]),
  /** dimensions to show as a composition table, e.g. which sources make up each channel */
  compositions: clampArr(z.object({ parent: z.string(), child: z.string() }), 3).default([]),
  source: z.enum(['ai', 'rules']).catch('ai').default('ai'),
  notes: z.array(z.string()).default([]),
});
export type TopicPlan = z.infer<typeof PlanSchema>;

const catalogue = () => MODELS.map((m) => `## ${m.id} (${m.label}) — dimensions: ${Object.keys(m.dims).join(', ')}\n` +
  METRICS.filter((x) => x.model === m.id).map((x) => `${x.id} — ${x.label}${x.format === 'percent' ? ' (%)' : ''}${m.id === 'leads' ? `: ${x.description}` : ''}`).join('; ')).join('\n');

const TOOL: Anthropic.Tool = {
  name: 'plan_section',
  description: 'Plan one report section that answers the reader’s brief using only catalogue metrics and dimensions.',
  input_schema: {
    type: 'object',
    properties: {
      title: { type: 'string', description: 'A concise, professional section title (3–6 words) naming the subject, e.g. "Lead Performance by Channel & Source". Never repeat or quote the brief, never phrase it as a question or instruction.' },
      summary: { type: 'string', description: 'One neutral sentence describing what the section covers (e.g. "Lead volume, qualification, trials, conversion and value by channel, source and studio."). Do not mention the reader, the brief or a request.' },
      kpis: { type: 'array', items: { type: 'string' }, description: '6–10 metric ids that best answer the brief, most important first. Include every metric the reader names when the catalogue has it.' },
      filters: { type: 'array', description: 'Filters that scope the whole section (e.g. location, format, time_slot, product_family, channel). Use real-looking values; they are matched to the data afterwards.', items: { type: 'object', properties: { dimension: { type: 'string' }, op: { type: 'string', enum: ['in', 'not_in'] }, values: { type: 'array', items: { type: 'string' } } }, required: ['dimension', 'values'] } },
      charts: { type: 'array', description: '1–3 charts. trend = metric(s) by month for 14 months (compare true adds last year, only with 1 metric); trend_by = one metric by month split by a dimension; mix = share of one metric by a dimension for the period.', items: { type: 'object', properties: { title: { type: 'string' }, kind: { type: 'string', enum: ['trend', 'trend_by', 'mix'] }, metrics: { type: 'array', items: { type: 'string' } }, dimension: { type: 'string' }, compare: { type: 'boolean' } }, required: ['title', 'kind', 'metrics'] } },
      definitions: { type: 'array', items: { type: 'string' }, description: 'Metric and dimension ids to define in the section — include these whenever the reader asks how something is defined or calculated.' },
      compositions: { type: 'array', description: 'Composition tables showing which child values make up each parent value, e.g. {parent:"channel", child:"source"} to list the lead sources in each channel. Use when the reader asks what is included in a grouping.', items: { type: 'object', properties: { parent: { type: 'string' }, child: { type: 'string' } }, required: ['parent', 'child'] } },
      tables: { type: 'array', description: '2–6 breakdown tables: up to 6 metrics from the SAME model by 1–2 dimensions of that model. For "per studio / each studio" requests use location as a dimension (often location + the other dimension), not a filter.', items: { type: 'object', properties: { title: { type: 'string' }, metrics: { type: 'array', items: { type: 'string' } }, dims: { type: 'array', items: { type: 'string' } }, sort: { type: 'string' }, dir: { type: 'string', enum: ['asc', 'desc'] }, limit: { type: 'number' } }, required: ['title', 'metrics', 'dims'] } },
    },
    required: ['title', 'summary', 'kpis', 'charts', 'tables'],
  },
};
const SYSTEM = `You design sections of a Physique 57 India studio performance report (barre, powerCycle and Strength Lab studios in Mumbai and Bengaluru).
Turn the reader's brief into a section plan using ONLY metric and dimension ids from the catalogue below. Cover everything the reader asks for: every named metric, every breakdown ("by channel", "by source", "for each studio" → location), definitions when asked, and composition tables when they ask what a grouping contains. Metrics in one table or chart must come from the same model, and a dimension must belong to that model. Prefer metrics that directly answer the brief; include volume and rate metrics. Use filters to scope to studios, formats, time slots, products, channels etc. mentioned in the brief. Call plan_section once.

CATALOGUE
${catalogue()}

Known values — format: Barre, powerCycle, Strength Lab · time_slot: Morning, Afternoon, Evening · weekpart: Weekday, Weekend · prime_time: Prime, Off-peak · day_of_week: Monday…Sunday · product_family: Unlimited / time-based, Class packs, Single class, Privates, Newcomer offers, Credits & gift cards, Retail · seller_type: Staff, Online / self-serve`;

/* ── validation ── */
const modelOf = (m: string) => metricById.get(m)?.model;
const dimOk = (model: string | undefined, d: string) => !!model && !!modelById.get(model)?.dims[d];
async function distinct(dim: string, prefer: string[], end: string): Promise<string[]> {
  const metric = [...prefer, ...METRICS.map((x) => x.id)].find((m) => dimOk(modelOf(m), dim));
  if (!metric) return [];
  const e = new Date(end + 'T00:00:00Z'); const start = new Date(Date.UTC(e.getUTCFullYear() - 1, e.getUTCMonth(), 1)).toISOString().slice(0, 10);
  try { const r = await runMetricsQuery({ metrics: [metric], dimensions: [dim], start, end, limit: 400 }); return r.rows.map((x) => String(x[dim] ?? '')).filter(Boolean); } catch { return []; }
}
const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
function match(v: string, pool: string[]): string[] {
  const n = norm(v); if (!n) return [];
  const exact = pool.filter((p) => norm(p) === n); if (exact.length) return exact;
  const contains = pool.filter((p) => norm(p).includes(n) || (norm(p).length > 3 && n.includes(norm(p))));
  return contains.slice(0, 12);
}
/** Keep only what the semantic layer can compute; resolve filter values to real data values. */
export async function validatePlan(raw: unknown, end: string): Promise<TopicPlan> {
  const p = PlanSchema.parse(raw);
  const notes: string[] = [...p.notes];
  const kpis = [...new Set(p.kpis.filter((m) => metricById.has(m)))].slice(0, 10);
  const filters: Filter[] = [];
  for (const f of p.filters) {
    if (!DIMENSIONS[f.dimension]) continue;
    const pool = await distinct(f.dimension, kpis, end);
    const values = pool.length ? [...new Set(f.values.flatMap((v) => match(v, pool)))] : f.values;
    if (values.length) filters.push({ dimension: f.dimension, op: f.op, values });
    else notes.push(`No ${DIMENSIONS[f.dimension].label.toLowerCase()} matching "${f.values.join(', ')}" — filter skipped.`);
  }
  const charts = p.charts.map((c) => {
    const ms = c.metrics.filter((m) => metricById.has(m)); const model = modelOf(ms[0] ?? '');
    const same = ms.filter((m) => modelOf(m) === model).slice(0, c.kind === 'trend' ? 2 : 1);
    if (!same.length) return null;
    if (c.kind !== 'trend' && (!c.dimension || !dimOk(model, c.dimension))) return null;
    return { ...c, metrics: same, compare: c.kind === 'trend' && same.length === 1 ? c.compare ?? true : false };
  }).filter(Boolean) as TopicPlan['charts'];
  const tables = p.tables.map((t) => {
    const ms = t.metrics.filter((m) => metricById.has(m)); const model = modelOf(ms[0] ?? '');
    const same = ms.filter((m) => modelOf(m) === model).slice(0, 6);
    const dims = t.dims.filter((d) => dimOk(model, d)).slice(0, 2);
    if (!same.length || !dims.length) return null;
    return { ...t, metrics: same.slice(0, 6), dims, sort: t.sort && same.includes(t.sort) ? t.sort : same[0] };
  }).filter(Boolean) as TopicPlan['tables'];
  if (!kpis.length && !charts.length && !tables.length) throw new Error('The brief could not be matched to any metric in the catalogue.');
  const definitions = [...new Set(p.definitions.filter((x) => metricById.has(x) || DIMENSIONS[x]))];
  const compositions = p.compositions.filter((c) => DIMENSIONS[c.parent] && DIMENSIONS[c.child] && METRICS.some((m) => dimOk(m.model, c.parent) && dimOk(m.model, c.child)));
  return { ...p, kpis, filters, charts, tables, notes, definitions, compositions };
}

/* ── keyword planner (no AI key / AI failure) ── */
const STOP = new Set('the a an of and or for in on at to by with vs versus how what which who is are do does did our my we per across from this that their them it its be been show me report about best most top worst more less filling curate include detailed performance metrics such so also define defined ensure correct period each all every'.split(' '));
/** Words too common to identify a single studio / product / source value. */
const GENERIC = new Set('studio studios class classes lead leads source sources online website direct other social media call calls message messages member members membership memberships client clients the and new trial trials marketing'.split(' '));
const MONTHS = /\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\b|\b20\d\d\b/g;
export async function rulesPlan(prompt: string, end: string): Promise<TopicPlan> {
  const text = norm(prompt.replace(MONTHS, ' '));
  const raw = text.split(' ');
  // crude stems so "converts" ~ conversion, "members" ~ member, "sources" ~ source
  const words = raw.filter((w) => w.length > 2 && !STOP.has(w)).map((w) => (w.length > 6 ? w.slice(0, 5) : w.replace(/(es|s)$/, '')));
  const score = (t: string) => words.reduce((a, w) => a + (norm(t).includes(w) ? (w.length > 4 ? 2 : 1) : 0), 0);
  // dimensions named in the brief ("lead sources", "by channel", "each studio") become breakdowns
  const perStudio = /\b(each|every|per|by|across|all)\s+(studio|location|centre|center)s?\b|studio[- ]wise/.test(text);
  const dimWords = (id: string) => `${id.replace(/_/g, ' ')} ${DIMENSIONS[id].label}`.replace(/\blead\b/gi, ' '); // "lead stage" must not match on "lead"
  const named = Object.keys(DIMENSIONS).map((id) => ({ id, s: score(dimWords(id)) })).filter((x) => x.s > (['status', 'status_group', 'stage', 'first_visit_type', 'visit_type'].includes(x.id) ? 3 : 1) && x.id !== 'location' && x.id !== 'crm_channel').sort((a, b) => b.s - a.s).map((x) => x.id);
  const ranked = METRICS.map((m) => ({ m, s: score(`${m.id.replace(/_/g, ' ')} ${m.label}`) * 2 + score(m.description) * 0.3 + (named.some((d) => dimOk(m.model, d)) ? 2 : 0) }))
    .filter((x) => x.s > 2).sort((a, b) => b.s - a.s);
  const top = ranked.length ? ranked.map((x) => x.m) : METRICS.filter((m) => ['revenue', 'visits', 'new_clients', 'fill_rate'].includes(m.id));
  const lead0 = top[0];
  // the model's volume metric (leads, classes …) anchors the section; charts use it
  const base = metricById.get(lead0.model) ?? METRICS.find((m) => m.model === lead0.model && m.additive) ?? lead0;
  const lead = base;
  const FUNNEL = ['leads', 'qualified_leads', 'qualification_rate', 'lead_trials', 'lead_to_trial_rate', 'lead_conversions', 'lead_conversion_rate', 'trial_to_member_rate', 'disqualified_leads', 'disqualification_rate', 'lost_only_leads', 'unresponsive_leads', 'lead_ltv', 'lead_ltv_per_conversion'];
  const pick = [...new Set([base.id, ...top.filter((m) => m.model === lead.model).map((m) => m.id)])].slice(0, 10);
  const kpis = lead.model === 'leads' ? pick.sort((a, b) => (FUNNEL.indexOf(a) + 1 || 99) - (FUNNEL.indexOf(b) + 1 || 99)) : pick;
  const strong = new Set(ranked.filter((x) => x.s >= 4).map((x) => x.m.id));
  const nm = named.filter((d) => dimOk(lead.model, d));
  const dims = perStudio && dimOk(lead.model, 'location') ? [...nm.slice(0, 2), 'location', ...nm.slice(2)] : nm;
  // scope filters: only distinctive value names (a studio, format, slot …) mentioned in the brief
  const filters: TopicPlan['filters'] = [];
  for (const dim of ['location', 'format', 'time_slot', 'weekpart', 'product_family', 'city']) {
    if (!dimOk(lead.model, dim) || (dim === 'location' && perStudio)) continue;
    const pool = await distinct(dim, [lead.id], end);
    const tok = (v: string) => norm(v).split(' ').filter((t) => t.length > 3 && !GENERIC.has(t) && pool.filter((p) => norm(p).split(' ').includes(t)).length === 1);
    const hit = pool.filter((v) => text.includes(norm(v)) || tok(v).some((t) => raw.includes(t) || raw.includes(`${t}s`)));
    if (hit.length && hit.length < pool.length) filters.push({ dimension: dim, op: 'in', values: hit.slice(0, 6) });
  }
  const single = new Set(filters.filter((f) => f.values.length === 1).map((f) => f.dimension));
  const bd = (dims.filter((d) => !single.has(d)).length ? dims.filter((d) => !single.has(d)) : ['location', 'format', 'day_of_week', 'product_family', 'teacher', 'source'].filter((d) => dimOk(lead.model, d) && !single.has(d))).slice(0, 3);
  const sameModel = kpis.filter((m) => modelOf(m) === lead.model);
  const tables: TopicPlan['tables'] = bd.map((d) => ({ title: `By ${DIMENSIONS[d].label.toLowerCase()}`, metrics: sameModel.slice(0, 6), dims: [d], limit: 12 }));
  if (bd.includes('location')) for (const d of bd.filter((x) => x !== 'location').slice(0, 2)) tables.push({ title: `${DIMENSIONS[d].label} by studio`, metrics: sameModel.slice(0, 4), dims: ['location', d], limit: 30 });
  const wantsDefs = /defin|how .* (calculat|count|measur)|what (is|are|counts)|meaning/.test(text);
  const compositions = bd.includes('channel') && bd.includes('source') ? [{ parent: 'channel', child: 'source' }] : [];
  const nice = (d: string) => { const l = DIMENSIONS[d].label.replace(/^Lead /, ''); return l.charAt(0).toUpperCase() + l.slice(1); };
  const subject = lead.model === 'leads' ? 'Lead Performance' : lead.label;
  const by = bd.filter((d) => d !== 'location').map(nice);
  return validatePlan({
    title: `${subject}${by.length ? ` by ${by.slice(0, 2).join(' & ')}` : ''}${bd.includes('location') ? ' and Studio' : ''}`.slice(0, 70),
    summary: `${sameModel.slice(0, 5).map((m) => metricById.get(m)!.label).join(', ')}${bd.length ? ` — broken down by ${bd.map((d) => DIMENSIONS[d].label.toLowerCase()).join(', ')}` : ''}.`,
    kpis, filters,
    charts: [{ title: `${lead.label} — 14 months vs last year`, kind: 'trend', metrics: [lead.id], compare: true },
      ...(bd[0] ? [{ title: `${lead.label} by ${DIMENSIONS[bd[0]].label.toLowerCase()}`, kind: 'mix' as const, metrics: [lead.id], dimension: bd[0] }] : []),
      ...(bd[0] ? [{ title: `${lead.label} by ${DIMENSIONS[bd[0]].label.toLowerCase()} — 14 months`, kind: 'trend_by' as const, metrics: [lead.id], dimension: bd[0] }] : [])],
    tables, definitions: wantsDefs ? [...sameModel.filter((m) => strong.has(m)).slice(0, 10), ...bd.filter((d) => d !== 'location')] : [], compositions,
    source: 'rules', notes: ranked.length ? [] : ['No metric matched the wording of this topic — showing headline metrics. Name metrics explicitly (e.g. revenue, fill rate, renewals) or turn on AI for smarter planning.'],
  }, end);
}

/** Plan a custom topic: AI first (with a forced→auto tool-choice fallback), keyword planner as backstop. */
export async function planTopic(prompt: string, ctx: { end: string; locations: string[]; tier?: Tier }): Promise<TopicPlan> {
  if (!config.anthropicKey) return rulesPlan(prompt, ctx.end);
  const client = new Anthropic({ apiKey: config.anthropicKey });
  const content = `Reader's brief: "${prompt}"\nReport scope: ${ctx.locations.length ? ctx.locations.join(', ') : 'all studios'}; report period ends ${ctx.end}.`;
  const order = fallbackOrder(ctx.tier ?? 'fast');
  while (order.length) {
    const tier = order[0]; const model = AI[tier];
    try {
      const ask = (mode: 'think' | 'forced' | 'auto') => client.messages.stream({
        model: model.id, system: SYSTEM, tools: [TOOL], messages: [{ role: 'user', content }],
        ...(mode === 'think' ? { ...thinkParams(model.id, tier, 4000), tool_choice: { type: 'auto' as const } } : { max_tokens: 4000, tool_choice: mode === 'forced' ? { type: 'tool' as const, name: 'plan_section' } : { type: 'auto' as const } }),
      } as Anthropic.MessageStreamParams).finalMessage();
      let msg: Anthropic.Message | null = null;
      if (config.thinking !== 'off') { // reason about the brief first
        for (let tries = 0; tries < 4 && !msg; tries++) {
          try { const m = await ask('think'); if (m.content.some((c) => c.type === 'tool_use')) msg = m; else break; }
          catch (e) { const m = (e as Error).message; if (isNotFound(m)) throw e; if (!noteThinkingError(model.id, m)) break; }
        }
      }
      if (!msg) { try { msg = await ask('forced'); } catch (e) { if (!/tool_choice/i.test((e as Error).message)) throw e; msg = await ask('auto'); } }
      const tu = msg.content.find((c): c is Anthropic.ToolUseBlock => c.type === 'tool_use');
      if (!tu) throw new Error('no plan returned');
      return await validatePlan({ ...(tu.input as object), source: 'ai' }, ctx.end);
    } catch (e) {
      const m = (e as Error).message;
      log.warn({ model: model.id, err: m.slice(0, 200) }, 'topic planning failed');
      if (isNotFound(m)) { if (!markMissing(model.id, tier)) order.shift(); continue; }
      break;
    }
  }
  return rulesPlan(prompt, ctx.end);
}
