/**
 * Report designer — wireframe reports built page by page from placeholder layouts. Every slot holds one element:
 * any widget from any workspace tab, a special analysis (trainer scorecard, lead channel funnel, class rankings),
 * metric cards, titles, text, quotes, brand photos, dividers — or an AI slot the assistant writes from the page's data.
 */
import Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';
import { config } from '../config.js';
import { DOMAINS, domainById, type Widget } from '../ai/domains.js';
import { buildWidget, resolvePeriod, DashboardFilterSchema } from '../ai/dashboard.js';
import { runMetricsQuery } from '../semantic/engine.js';
import { METRICS, metricById, modelById } from '../semantic/metrics.js';
import { summarise } from '../ai/tools.js';
import { MODELS, type Tier } from '../ai/router.js';
import { thinkParams, noteThinkingError, markMissing, isNotFound } from '../ai/models.js';
import { brandContext } from '../ai/brandBrain.js';
import { trainerScorecards, rankingTable, contributionTable, conversionTable, scoreChart, revenueChart } from '../analytics/trainerScore.js';
import { leadChannelReport } from '../analytics/leadChannels.js';
import { exploreClasses } from '../analytics/classExplorer.js';
import type { AnyResult } from '../analytics/analyses.js';
import { log } from '../util/log.js';

/* ── design schema (lenient — the editor owns the shape) ── */
const Slot = z.object({
  id: z.string(),
  kind: z.enum(['widget', 'special', 'metric', 'metrics', 'title', 'text', 'quote', 'image', 'divider', 'spacer', 'ai']),
  domain: z.string().optional(), index: z.number().optional(), special: z.string().optional(),
  metric: z.string().optional(), metrics: z.array(z.string()).optional(),
  text: z.string().optional(), title: z.string().optional(), body: z.string().optional(), by: z.string().optional(),
  photo: z.string().optional(), prompt: z.string().optional(), style: z.string().optional(), chart: z.string().optional(),
}).passthrough();
const Page = z.object({ id: z.string(), layout: z.string(), title: z.string().default(''), subtitle: z.string().default(''), kicker: z.string().optional(), animation: z.string().optional(), slots: z.array(Slot.nullable()).default([]) }).passthrough();
export const DesignSchema = z.object({
  title: z.string().default('Untitled report'), subtitle: z.string().optional(),
  start: z.string().optional(), end: z.string().optional(), preset: z.string().optional(), locations: z.array(z.string()).default([]),
  compare: z.enum(['previous_period', 'previous_year', 'none']).default('previous_year'),
  cover: z.boolean().default(true), orientation: z.enum(['portrait', 'landscape']).default('portrait'), accent: z.string().optional(),
  pages: z.array(Page).default([]),
}).passthrough();
export type Design = z.infer<typeof DesignSchema>;
type SlotT = z.infer<typeof Slot>;

/* ── special analyses (beyond the workspace widgets) ── */
const SPECIALS: { id: string; label: string; group: string; kind: 'table' | 'chart'; chart?: string }[] = [
  { id: 'trainer_ranking', label: 'Trainer composite ranking', group: 'Trainers', kind: 'table' },
  { id: 'trainer_score_chart', label: 'Trainer composite score — chart', group: 'Trainers', kind: 'chart', chart: 'horizontal_bar' },
  { id: 'trainer_revenue', label: 'Trainer revenue contribution', group: 'Trainers', kind: 'table' },
  { id: 'trainer_revenue_chart', label: 'Class revenue by trainer — chart', group: 'Trainers', kind: 'chart', chart: 'horizontal_bar' },
  { id: 'trainer_conversion', label: 'Trainer conversion & retention vs expected', group: 'Trainers', kind: 'table' },
  { id: 'lead_channel_funnel', label: 'Lead funnel by channel (leads → trials → members)', group: 'Leads', kind: 'table' },
  { id: 'lead_studio_channel', label: 'Lead→member % — studio × channel heatmap', group: 'Leads', kind: 'table' },
  { id: 'lead_studio_scorecard', label: 'Lead studio scorecard', group: 'Leads', kind: 'table' },
  { id: 'class_top', label: 'Top recurring classes (class · day · time · studio)', group: 'Classes', kind: 'table' },
  { id: 'class_bottom', label: 'Weakest recurring classes (lowest fill)', group: 'Classes', kind: 'table' },
  { id: 'class_slots', label: 'Best day · time slots', group: 'Classes', kind: 'table' },
  { id: 'class_trainers', label: 'Class score by trainer', group: 'Classes', kind: 'table' },
];

export function designerCatalog() {
  return {
    workspaces: DOMAINS.map((d) => ({ id: d.id, label: d.label, icon: d.icon, widgets: d.widgets.map((w, i) => ({ index: i, type: w.type, title: w.title, chart: (w as { chart?: string }).chart, block: (w as { block?: string }).block })) })),
    specials: SPECIALS,
    metrics: METRICS.map((m) => ({ id: m.id, label: m.label, dataset: m.model, format: m.format })),
  };
}

/* ── rendering ── */
const filtersOf = (d: Design) => DashboardFilterSchema.parse({ start: d.start, end: d.end, locations: d.locations, compare: d.compare });
async function special(id: string, d: Design, p: { start: string; end: string }): Promise<{ result: AnyResult; chart?: string; view?: string }> {
  const locs = d.locations;
  if (id.startsWith('trainer_')) {
    const sc = await trainerScorecards({ start: p.start, end: p.end, locations: locs.length ? locs : undefined });
    const s = sc.all;
    if (id === 'trainer_ranking') return { result: rankingTable(s, 20) };
    if (id === 'trainer_score_chart') return { result: scoreChart(s, 15), chart: 'horizontal_bar' };
    if (id === 'trainer_revenue') return { result: contributionTable(s, 20) };
    if (id === 'trainer_revenue_chart') return { result: revenueChart(s, 15), chart: 'horizontal_bar' };
    return { result: conversionTable(s, 20) };
  }
  if (id.startsWith('lead_')) {
    const r = await leadChannelReport({ start: p.start, end: p.end, locations: locs });
    const all = r.sections.find((x) => x.id === 'lead_channels_all');
    const t = id === 'lead_channel_funnel' ? all?.tables[0] : id === 'lead_studio_channel' ? all?.tables[1] : all?.tables[2];
    if (!t) throw new Error('No lead data for this selection');
    return { result: t.result, view: t.style === 'heat' ? 'heatmap' : undefined };
  }
  const base = { start: p.start, end: p.end, locations: locs };
  const q = id === 'class_top' ? { grouping: 'class-day-time-location', rankBy: 'score', minClasses: 4, limit: 15 }
    : id === 'class_bottom' ? { grouping: 'class-day-time-location', rankBy: 'fill', dir: 'asc', minClasses: 4, limit: 15 }
    : id === 'class_slots' ? { grouping: 'day-time', rankBy: 'class_avg', minClasses: 6, limit: 15 }
    : { grouping: 'trainer', rankBy: 'score', minClasses: 10, limit: 20 };
  const r = await exploreClasses({ ...base, ...q });
  const keep = new Set(['group', 'rank', 'score', 'classes', 'checkins', 'class_avg', 'fill', 'show_up', 'empty_rate', 'rev_class']);
  return { result: { ...r.result, columns: r.result.columns.filter((c) => keep.has(c.key)) } as unknown as AnyResult };
}

async function resolveSlot(s: SlotT, d: Design, f: ReturnType<typeof filtersOf>, p: ReturnType<typeof resolvePeriod>) {
  const compare = f.compare === 'none' ? null : f.compare;
  try {
    if (s.kind === 'widget') {
      const dom = domainById.get(String(s.domain)); const w = dom?.widgets[Number(s.index)];
      if (!dom || !w) return { error: 'Element no longer exists' };
      const data = await buildWidget(w as Widget, f, p);
      return { widget: { ...w, domain: dom.label }, ...data };
    }
    if (s.kind === 'special') { const r = await special(String(s.special), d, p); return { widget: { type: SPECIALS.find((x) => x.id === s.special)?.kind ?? 'table', title: SPECIALS.find((x) => x.id === s.special)?.label, chart: r.chart, view: r.view }, result: r.result }; }
    if (s.kind === 'metric' || s.kind === 'metrics') {
      const ms = (s.kind === 'metric' ? [s.metric] : s.metrics ?? []).filter((m): m is string => !!m && metricById.has(m));
      if (!ms.length) return { error: 'Pick a metric' };
      const loc = f.locations.length && ms.every((m) => modelById.get(metricById.get(m)!.model)?.dims.location) ? [{ dimension: 'location', op: 'in' as const, values: f.locations }] : [];
      const [totals, series] = await Promise.all([runMetricsQuery({ metrics: ms, start: p.start, end: p.end, compare, filters: loc }), runMetricsQuery({ metrics: ms, grain: 'month', start: p.trendStart, end: p.end, filters: loc })]);
      return { result: totals, series };
    }
  } catch (e) { return { error: (e as Error).message }; }
  return {};
}

export async function renderDesign(raw: unknown) {
  const d = DesignSchema.parse(raw);
  const f = filtersOf(d); const p = resolvePeriod(f);
  const pages = [];
  for (const pg of d.pages) {
    const slots = await Promise.all(pg.slots.map(async (s) => (s ? { ...s, data: await resolveSlot(s, d, f, p) } : null)));
    pages.push({ ...pg, slots });
  }
  return { design: d, period: p, scope: d.locations.length ? d.locations.join(', ') : 'All studios', pages, renderedAt: new Date().toISOString() };
}
export type Rendered = Awaited<ReturnType<typeof renderDesign>>;

/* ── AI slots ── */
const STYLE: Record<string, string> = {
  paragraph: 'one tight paragraph of 3–5 sentences', bullets: '3–5 short bullet points, one per line starting with "- "', callout: 'a single punchy sentence (headline takeaway)',
  actions: '3 numbered recommended actions, each naming who should act', summary: 'an executive summary: one headline sentence, then 3 bullet points',
};
function pageContext(page: Rendered['pages'][number]) {
  const parts: string[] = [`PAGE: ${page.title || '(untitled)'}${page.subtitle ? ` — ${page.subtitle}` : ''}`];
  for (const s of page.slots) {
    if (!s) continue;
    const r = (s as { data?: { result?: AnyResult } }).data?.result;
    if (r) parts.push(summarise(r, 25).slice(0, 5000));
    if (s.kind === 'text' && s.body) parts.push(`TEXT: ${s.body}`);
  }
  return parts.join('\n');
}
export async function fillAi(r: Rendered, tier: Tier = 'fast'): Promise<Record<string, string>> {
  const asks = r.pages.flatMap((pg) => pg.slots.filter((s): s is NonNullable<typeof s> => !!s && s.kind === 'ai').map((s) => ({ id: s.id, page: pg, prompt: s.prompt || 'Summarise what this page shows and what it means for the business.', style: s.style ?? 'paragraph' })));
  if (!asks.length) return {};
  const fallback = () => Object.fromEntries(asks.map((a) => [a.id, rulesText(a.page)]));
  if (!config.anthropicKey) return fallback();
  const client = new Anthropic({ apiKey: config.anthropicKey });
  const pagesUsed = [...new Set(asks.map((a) => a.page))];
  const content = `Report "${r.design.title}" for ${r.scope}, ${r.period.start} to ${r.period.end}.\n\n${pagesUsed.map(pageContext).join('\n\n')}\n\nWrite the content for these AI slots (use ONLY figures that appear in the data above; no markdown headings):\n${asks.map((a) => `- slot ${a.id} on page "${a.page.title}": ${a.prompt} — format: ${STYLE[a.style] ?? STYLE.paragraph}`).join('\n')}\n\nCall write_slots once.`;
  const tool: Anthropic.Tool = { name: 'write_slots', description: 'Content for each AI slot', input_schema: { type: 'object', properties: { slots: { type: 'object', properties: Object.fromEntries(asks.map((a) => [a.id, { type: 'string' }])), required: asks.map((a) => a.id) } }, required: ['slots'] } };
  const system = `You are the analyst writing commentary inside a Physique 57 India report. Be specific, crisp and decisive; British/Indian English; INR as ₹12.3L / ₹1.24Cr. Never invent numbers.\n\n${(await brandContext()).slice(0, 12000)}`;
  const order: Tier[] = tier === 'fast' ? ['fast', 'balanced'] : [tier, 'fast'];
  while (order.length) {
    const t = order[0]; const model = MODELS[t];
    try {
      let msg: Anthropic.Message | null = null;
      for (let tries = 0; tries < 3 && !msg; tries++) {
        try { msg = await client.messages.stream({ model: model.id, system, tools: [tool], tool_choice: { type: 'auto' }, messages: [{ role: 'user', content }], ...thinkParams(model.id, t, 4000) } as Anthropic.MessageStreamParams).finalMessage(); }
        catch (e) { const m = (e as Error).message; if (isNotFound(m)) throw e; if (!noteThinkingError(model.id, m)) throw e; }
      }
      const tu = msg?.content.find((c): c is Anthropic.ToolUseBlock => c.type === 'tool_use');
      const out = (tu?.input as { slots?: Record<string, unknown> } | undefined)?.slots;
      if (!out) throw new Error('no content returned');
      const fb = fallback();
      return Object.fromEntries(asks.map((a) => [a.id, typeof out[a.id] === 'string' && (out[a.id] as string).trim() ? String(out[a.id]) : fb[a.id]]));
    } catch (e) {
      const m = (e as Error).message; log.warn({ model: model.id, err: m.slice(0, 160) }, 'designer AI fill failed');
      if (isNotFound(m)) { if (!markMissing(model.id, t)) order.shift(); continue; }
      break;
    }
  }
  return fallback();
}
/** Without AI: a plain-language read-out of the page's headline numbers. */
function rulesText(page: Rendered['pages'][number]) {
  const lines: string[] = [];
  for (const s of page.slots) {
    const r = s && (s as { data?: { result?: AnyResult } }).data?.result;
    if (!r || !r.rows.length) continue;
    if (r.columns.some((c) => c.kind === 'period')) continue; // trends: the chart says it better
    const name = (s as { data?: { widget?: { title?: string } } }).data?.widget?.title ?? r.title;
    const m = r.columns.find((c) => c.kind === 'metric');
    const dim = r.columns.find((c) => c.kind === 'dimension');
    if (!m) continue;
    if (dim && r.rows.length > 1) {
      const top = [...r.rows].sort((a, b) => Number(b[m.key] ?? 0) - Number(a[m.key] ?? 0))[0];
      lines.push(`- ${name}: ${top[dim.key]} is highest on ${m.label.toLowerCase()} at ${fmt(top[m.key], m.format)}.`);
    } else {
      const tot = (r as { totals?: Record<string, unknown> }).totals ?? r.rows[0];
      const chg = tot[`${m.key}__chg`];
      lines.push(`- ${m.label}: ${fmt(tot[m.key], m.format)}${typeof chg === 'number' ? ` (${chg >= 0 ? '+' : ''}${(chg * 100).toFixed(1)}% vs comparison)` : ''}.`);
    }
    if (lines.length >= 4) break;
  }
  return lines.length ? lines.join('\n') : 'Add data elements to this page and the analyst will write about them here.';
}
const fmt = (v: unknown, f?: string) => {
  const n = Number(v); if (!isFinite(n)) return '—';
  if (f === 'percent') return `${(n * 100).toFixed(1)}%`;
  if (f === 'currency') return n >= 1e7 ? `₹${(n / 1e7).toFixed(2)}Cr` : n >= 1e5 ? `₹${(n / 1e5).toFixed(1)}L` : `₹${Math.round(n).toLocaleString('en-IN')}`;
  return Math.abs(n) < 100 && !Number.isInteger(n) ? n.toFixed(2) : Math.round(n).toLocaleString('en-IN');
};
