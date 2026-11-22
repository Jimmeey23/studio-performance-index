/**
 * AI commentary for the executive report. The model receives the computed
 * report as a digest of formatted figures (period vs previous month, current-
 * year monthly average and same month last year) and writes the management
 * narrative through one structured tool call. Every figure is then verified.
 */
import Anthropic from '@anthropic-ai/sdk';
import { config } from '../config.js';
import { MODELS, fallbackOrder, type Tier } from '../ai/router.js';
import { thinkParams, noteThinkingError, markMissing, isNotFound } from '../ai/models.js';
import { verifyNarrative } from '../ai/verify.js';
import { log } from '../util/log.js';
import { fmtVal, fmtChg, type Report, type Kpi } from './build.js';

export interface SectionCommentary { headline: string; narrative: string; findings: string[]; actions: string[] }
export interface ReportInsights {
  headline: string;
  executive_summary: string;
  at_a_glance: string[];
  wins: string[];
  watch_outs: string[];
  themes: { title: string; detail: string }[];
  sections: Record<string, SectionCommentary>;
  road_ahead: {
    summary: string;
    priorities: { title: string; detail: string; owner: string; timing: string; kpi: string; target: string; priority: 'high' | 'medium' | 'low' }[];
    risks: string[]; opportunities: string[];
    targets: { metric: string; target: string; rationale: string }[];
  };
  /** recommendations & suggestions shown on their own page */
  recommendations: { title: string; detail: string; owner: string; priority: 'high' | 'medium' | 'low'; impact?: string }[];
  /** art direction: the model shapes the look and structure of this report from its story */
  design?: ReportDesign;
  /** model-composed deep-dive panels, each anchored to a section */
  spotlights?: Spotlight[];
  model?: string; verification?: { checked: number; unmatched: string[] }; source: 'ai' | 'rules';
}
export const MOODS = ['momentum', 'steady', 'caution', 'recovery', 'turnaround'] as const;
export const DESIGN_ACCENTS = ['Physique 57', 'Indigo', 'Emerald', 'Rose', 'Ocean', 'Violet', 'Amber', 'Teal', 'Fuchsia', 'Cobalt', 'Coral'] as const;
export const COVER_PHOTOS = ['barre-group', 'cycle-group', 'studio-barre', 'strength-kettlebell', 'cycle-ride', 'trainers-pair', 'strength-lunge', 'cycle-mono', 'trainers-duo'] as const;
export const CHART_TYPES = ['bar', 'line', 'area', 'stacked_bar', 'pie', 'horizontal_bar'] as const;
export interface ReportDesign {
  mood: typeof MOODS[number]; accent: string; cover_photo: string; cover_style: 'photo' | 'gradient' | 'light';
  section_order: string[]; condense: string[]; cover_kpis: string[];
  chart_types: { chart_id: string; chart: typeof CHART_TYPES[number] }[];
  rationale?: string;
}
export interface Spotlight { section: string; kicker: string; title: string; body: string; chart_id?: string; kpis: string[]; tone: 'good' | 'bad' | 'neutral' }

const SECTION_IDS = ['sales', 'new_clients', 'leads', 'trainers', 'classes', 'formats', 'churn', 'late', 'studios', 'associates', 'clients'];
/** Section ids that need commentary in this report (custom reports cover only some). */
const idsOf = (r: Report) => r.sections.map((s) => s.id).filter((id) => id !== 'road');
const sectionSchema = { type: 'object', properties: {
  headline: { type: 'string', description: 'One crisp sentence — the takeaway for this area, with its key number.' },
  narrative: { type: 'string', description: '80–120 words: what happened vs the previous month, the current-year average and last year; why (drivers from the tables); what it means.' },
  findings: { type: 'array', items: { type: 'string' }, description: '4–5 specific findings, each with numbers and the entity (product, source, trainer, class, format, membership, weekday…).' },
  actions: { type: 'array', items: { type: 'string' }, description: '2–3 concrete actions for this area.' },
}, required: ['headline', 'narrative', 'findings', 'actions'] };

const designSchema = (ids: string[], charts: string[], kpis: string[]) => ({ type: 'object', description: 'Art direction for THIS report, chosen from its story. Vary it: no two periods should look alike.', properties: {
  mood: { type: 'string', enum: [...MOODS], description: 'The overall tone of the period.' },
  accent: { type: 'string', enum: [...DESIGN_ACCENTS], description: 'Accent palette that suits the mood (e.g. Emerald/Teal for momentum, Amber/Coral for caution, Cobalt/Ocean for steady, Violet/Indigo for turnaround).' },
  cover_photo: { type: 'string', enum: [...COVER_PHOTOS], description: 'Studio photograph that best fits the lead story (cycle = powerCycle, barre, strength = Strength Lab, trainers = people stories).' },
  cover_style: { type: 'string', enum: ['photo', 'gradient', 'light'] },
  section_order: { type: 'array', items: { type: 'string', enum: ids }, description: 'Sections in the order the story should be told — the most important first. Include every section.' },
  condense: { type: 'array', items: { type: 'string', enum: ids }, description: 'Sections with little news this period — shown briefly, without detail tables. 0–4 ids.' },
  cover_kpis: { type: 'array', items: { type: 'string', enum: kpis }, description: 'Exactly 4 metric ids for the cover — the ones that tell this period\'s story.' },
  chart_types: { type: 'array', description: 'Optional: change how a chart is drawn when another form reads better (e.g. a 14-month series as line/area, a share as pie, a long category list as horizontal_bar).', items: { type: 'object', properties: { chart_id: { type: 'string', enum: charts.length ? charts : ['none'] }, chart: { type: 'string', enum: [...CHART_TYPES] } }, required: ['chart_id', 'chart'] } },
  rationale: { type: 'string', description: 'One sentence on why this direction.' },
}, required: ['mood', 'accent', 'cover_photo', 'cover_style', 'section_order', 'condense', 'cover_kpis'] });
const spotlightSchema = (ids: string[], charts: string[], kpis: string[]) => ({ type: 'array', description: '1–3 deep-dive spotlights on the most important stories of the period — the ones a fixed template would miss (a connection across areas, an outlier, an inflection). Each is placed at the end of its section.', items: { type: 'object', properties: {
  section: { type: 'string', enum: ids }, kicker: { type: 'string', description: '2–4 words, e.g. "Hidden driver".' }, title: { type: 'string', description: 'Punchy headline with the key number.' },
  body: { type: 'string', description: '60–90 words of analysis with figures from the digest.' },
  chart_id: { type: 'string', enum: charts.length ? charts : ['none'], description: 'Optional chart that best evidences the story.' },
  kpis: { type: 'array', items: { type: 'string', enum: kpis }, description: '0–3 metric ids to show beside it.' },
  tone: { type: 'string', enum: ['good', 'bad', 'neutral'] },
}, required: ['section', 'kicker', 'title', 'body', 'kpis', 'tone'] } });

const toolFor = (ids: string[], charts: string[] = [], kpis: string[] = []): Anthropic.Tool => ({
  name: 'write_report',
  description: 'Write the senior-management commentary for the executive report.',
  input_schema: {
    type: 'object',
    properties: {
      headline: { type: 'string', description: 'One sentence: the single most important takeaway for the period, with the key number.' },
      executive_summary: { type: 'string', description: '200–260 words in 2–3 short paragraphs separated by a blank line. Overall performance against all three baselines, the drivers, the implications. No bullets.' },
      at_a_glance: { type: 'array', items: { type: 'string' }, description: 'Exactly 6 very short statements (≤ 14 words each) a CEO can read in 10 seconds.' },
      wins: { type: 'array', items: { type: 'string' }, description: '4–6 wins with numbers and comparisons.' },
      watch_outs: { type: 'array', items: { type: 'string' }, description: '4–6 risks / weak spots with numbers and comparisons.' },
      themes: { type: 'array', description: 'Exactly 3 strategic themes that connect several areas (e.g. "Acquisition is outpacing conversion").', items: { type: 'object', properties: { title: { type: 'string' }, detail: { type: 'string', description: '40–60 words with evidence.' } }, required: ['title', 'detail'] } },
      sections: { type: 'object', description: `Commentary per section id: ${ids.join(', ')}.`, properties: Object.fromEntries(ids.map((id) => [id, sectionSchema])), required: ids },
      recommendations: { type: 'array', description: '5–8 specific, evidence-based recommendations and suggestions for the reader, each naming who should act. In a trainer report, most should name individual trainers.', items: { type: 'object', properties: {
        title: { type: 'string' }, detail: { type: 'string', description: 'What to do, why (cite the figure) and how.' }, owner: { type: 'string' }, priority: { type: 'string', enum: ['high', 'medium', 'low'] }, impact: { type: 'string', description: 'Expected effect, clearly an estimate.' } }, required: ['title', 'detail', 'owner', 'priority'] } },
      design: designSchema(ids, charts, kpis),
      spotlights: spotlightSchema(ids, charts, kpis),
      road_ahead: { type: 'object', properties: {
        summary: { type: 'string', description: '70–100 words: outlook for next month using the forecasts, renewals due and pipeline.' },
        priorities: { type: 'array', description: '5–7 prioritised actions for next month.', items: { type: 'object', properties: {
          title: { type: 'string' }, detail: { type: 'string', description: 'What exactly to do and the evidence behind it.' }, owner: { type: 'string', description: 'Role: Studio manager, Sales associates, Head of programming, Marketing, Client services…' },
          timing: { type: 'string' }, kpi: { type: 'string' }, target: { type: 'string', description: 'Target for next month, clearly an estimate (e.g. "Conversion back to ~17%").' }, priority: { type: 'string', enum: ['high', 'medium', 'low'] },
        }, required: ['title', 'detail', 'owner', 'timing', 'kpi', 'target', 'priority'] } },
        risks: { type: 'array', items: { type: 'string' }, description: '3 risks for next month.' },
        opportunities: { type: 'array', items: { type: 'string' }, description: '3 opportunities for next month.' },
        targets: { type: 'array', description: '4–6 suggested targets for next month.', items: { type: 'object', properties: { metric: { type: 'string' }, target: { type: 'string' }, rationale: { type: 'string' } }, required: ['metric', 'target', 'rationale'] } },
      }, required: ['summary', 'priorities', 'risks', 'opportunities', 'targets'] },
    },
    required: ['headline', 'executive_summary', 'at_a_glance', 'wins', 'watch_outs', 'themes', 'sections', 'recommendations', 'road_ahead', 'design', 'spotlights'],
  },
});
/** Pull a JSON object out of a text reply (used when a model answers in text instead of calling the tool). */
function jsonFromText(msg: Anthropic.Message): Partial<ReportInsights> | null {
  const t = msg.content.filter((c): c is Anthropic.TextBlock => c.type === 'text').map((c) => c.text).join('\n');
  const a = t.indexOf('{'), b = t.lastIndexOf('}');
  if (a < 0 || b <= a) return null;
  try { return JSON.parse(t.slice(a, b + 1)); } catch { return null; }
}

function kpiLine(k: Kpi, r: Report) {
  const P = r.period;
  return `${k.label}: ${fmtVal(k.value, k.format)} | ${P.prevLabel} ${fmtVal(k.prev, k.format)} (${fmtChg(k)}) | ${P.ytdLabel} ${fmtVal(k.ytd, k.format)} (${fmtChg(k, 'chgYtd')}) | ${P.lyLabel} ${fmtVal(k.ly, k.format)} (${fmtChg(k, 'chgLy')})${k.higherIsBetter === false ? ' [lower is better]' : ''}`;
}
function tableLines(t: { title: string; result: { columns: { key: string; label: string; kind: string; format?: string }[]; rows: Record<string, unknown>[] } }) {
  const cols = t.result.columns.filter((c) => c.kind === 'dimension' || c.kind === 'metric' || c.kind === 'change');
  return `  TABLE ${t.title}: ` + t.result.rows.slice(0, 10).map((row) => cols.map((c) => c.kind === 'dimension' ? String(row[c.key] ?? '(blank)')
    : c.kind === 'change' ? `${c.label} ${row[c.key] === null || row[c.key] === undefined ? 'n/a' : (Number(row[c.key]) * 100).toFixed(1) + (/pp/.test(c.label) ? 'pp' : '%')}`
    : `${c.label} ${fmtVal(Number(row[c.key]), c.format ?? 'number')}`).join(', ')).join(' || ');
}

export function digest(r: Report): string {
  const P = r.period;
  const L: string[] = [];
  L.push(`REPORT: ${r.scope} — ${P.label} (${P.start} to ${P.end}, ${P.days} days).`);
  L.push(`Baselines: previous period = ${P.prevLabel}; current-year monthly average = ${P.ytdLabel} (scaled to the period length for volumes); same period last year = ${P.lyLabel}.`);
  L.push('\nSCORECARD'); r.scorecard.forEach((k) => L.push('- ' + kpiLine(k, r)));
  for (const s of r.sections) {
    L.push(`\nSECTION ${s.id} — ${s.title}`);
    s.kpis.forEach((k) => L.push('- ' + kpiLine(k, r)));
    const v = s.visuals;
    if (s.answer) L.push(`  QUESTION: ${s.answer.question}\n  DATA ANSWER: ${s.answer.headline}${s.answer.points.map((x) => `\n  - ${x}`).join('')}`);
    if (s.stats?.length) L.push('  STATS: ' + s.stats.map((x) => `${x.label} ${fmtVal(x.value, x.format)}${x.note ? ` (${x.note})` : ''}`).join('; '));
    if (s.definitions?.length && s.id.endsWith('method')) L.push('  METHOD: ' + s.definitions.slice(0, 5).map((d) => `${d.term}: ${d.text}`).join(' | '));
    if (v?.funnel) L.push('  FUNNEL: ' + v.funnel.map((f) => `${f.label} ${f.value ?? 'n/a'}`).join(' → '));
    if (v?.strict) L.push(`  Strict renewal rate (membership/package repurchase within 30 days): ${fmtVal(v.strict.renewal_rate, 'percent')}; renewed ${v.strict.renewed} of ${v.strict.expiring} (pending ${v.strict.pending})`);
    if (v?.formats) v.formats.forEach((f) => L.push(`  FORMAT ${f.format}: ` + f.kpis.map((k) => `${k.label} ${fmtVal(k.value, k.format)} (${fmtChg(k)} vs ${P.prevLabel}, ${fmtChg(k, 'chgLy')} vs ${P.lyLabel})`).join('; ')));
    if (v?.spotlight?.length) L.push('  TOP DRAW TRAINERS: ' + v.spotlight.map((t) => `${t.name} avg ${fmtVal(t.avg, 'decimal')} over ${t.classes} classes, fill ${fmtVal(t.fill, 'percent')}`).join('; '));
    if (v?.heatmap) {
      const cells = Object.entries(v.heatmap.cells).filter(([, c]) => c.classes >= 3 && c.fill !== null).sort((a, b) => (b[1].fill ?? 0) - (a[1].fill ?? 0));
      L.push('  BEST SLOTS (fill): ' + cells.slice(0, 5).map(([k, c]) => `${k.replace('|', ' ')} ${fmtVal(c.fill, 'percent')} (${c.classes} classes)`).join('; '));
      L.push('  WEAKEST SLOTS (fill): ' + cells.slice(-5).reverse().map(([k, c]) => `${k.replace('|', ' ')} ${fmtVal(c.fill, 'percent')} (${c.classes} classes)`).join('; '));
    }
    if (v?.forecasts) v.forecasts.forEach((f) => L.push(`  FORECAST ${f.label} ${f.month}: ${fmtVal(f.value, f.format)} (80% range ${fmtVal(f.lo, f.format)}–${fmtVal(f.hi, f.format)}, ${f.method ?? 'model'})`));
    if (v?.pipeline) v.pipeline.forEach((p) => L.push(`  PIPELINE ${p.label}: ${fmtVal(p.value, p.format)} (${p.note})`));
    for (const c of s.charts) L.push(`  CHART ${c.id} [${c.chart}] "${c.title}" (${c.result.rows.length} points)`);
    for (const t of s.tables) L.push(tableLines(t));
    s.insights.forEach((x) => L.push(`  NOTE ${x}`));
  }
  if (r.studios) L.push('\n' + tableLines(r.studios));
  for (const t of r.summaryTables ?? []) L.push('\n' + tableLines(t));
  return L.join('\n');
}

import { BACKEND_NOTE } from './backendAccounts.js';
const SYSTEM = `${BACKEND_NOTE}
You are the Chief Analytics Officer of Physique 57 India — premium barre, powerCycle and Strength Lab studios in Mumbai and Bengaluru — writing the commentary for the board-level monthly performance report.
Every KPI comes with three baselines: the previous month, the current-year monthly average and the same month last year. Use all three: a metric that is down on last month but above the year's average and last year is a very different story from one that is below all three.
Rules:
- Use ONLY figures that appear in the digest, copied exactly as formatted (₹ values, %, pp). Never invent numbers. Targets and impacts may be estimates but must be labelled as such ("~", "around", "estimate").
- Be specific and decisive: name products, studios, lead sources, associates, trainers, classes, slots, formats and memberships from the tables. Explain drivers (volume vs rate, mix, seasonality, one-off annual sales, maturing cohorts, small bases) and call out noise.
- Connect areas: e.g. leads up but conversion down; fill up but late cancels up; renewals vs churn value.
- Mind polarity: for metrics marked [lower is better], a decrease is good.
- Write for a CEO: elegant, crisp, confident, British/Indian English, no jargon, no emojis, no markdown.
- You are also the report's editor and art director: order the sections so the story leads with what matters most this period, condense quiet areas, pick the cover metrics, palette and photograph that fit the mood, re-draw charts where another form reads better, and add spotlights for the stories a fixed template would miss.
Call write_report exactly once.`;

const AUD: Record<string, string> = { leadership: 'the leadership team (CEO / founders)', managers: 'studio managers, who need operational, studio-floor actions', sales: 'the sales and client-services team, who need client-facing, conversion and renewal actions', investors: 'investors and partners — strategic, measured and concise' };
/** Custom reports: tell the model what the reader asked for, so the commentary stays on topic. */
function brief(r: Report) {
  const q = r.request;
  if (q.kind !== 'custom') return '';
  const trainerOnly = r.sections.every((s) => s.id.startsWith('trainer_ranking') || s.id === 'road');
  const leadOnly = r.sections.every((s) => s.id.startsWith('lead_channels') || s.id === 'road');
  const qs = r.sections.filter((s) => s.answer).map((s) => `${s.id}: "${s.answer!.question}"`).join('; ');
  const qled = qs ? ` Several sections answer a specific question (${qs}). For each, the section headline must be a direct one-sentence answer with the key numbers, the narrative 3–5 sentences explaining why (drivers, context, caveats on small samples), the findings 4–5 evidence points naming trainers/channels/sources, and the actions 2–4 concrete next steps naming who should act. The at_a_glance list must give one short answer per question, in order.` : '';
  const leadFocus = leadOnly ? ' This is a LEAD CHANNEL & SOURCE report. Write about channels, sources and studios through the funnel leads → trials completed → purchasing members, with new-client outcomes and LTV. Compare channels on lead→trial, trial→member and lead→member rates as well as volume; call out where volume and quality diverge, which sources inside a channel drive results, monthly trends and how studios differ (use the studio × channel heat table). Treat cells with small lead counts cautiously. Recommendations should say where to shift budget and effort, which follow-up to fix, and name channels, sources and studios.' : '';
  const focus = (leadOnly ? leadFocus : '') + qled + (trainerOnly ? ' This is a TRAINER PERFORMANCE report: write only about individual trainers — their ranking, strengths, weaknesses, revenue contribution, conversion and retention. Name trainers in every win, watch-out, theme, finding and recommendation. Do NOT discuss studio-wide totals (overall revenue, overall conversion, fill, class counts) except as the benchmark a trainer is compared with. Judge conversion against the trainer’s expected conversion from their client mix (excess = actual − expected); only for trainers with 30+ new clients — for others, say the sample is too small. Use tiers (A ≥ 70, B, C, D < 40). In each studio section compare trainers within that studio.' : '');
  return `This is a CUSTOM report${q.title ? ` titled "${q.title}"` : ''}.${focus} It covers only these topics: ${r.sections.map((s) => s.title).join(', ')}.${q.audience ? ` Audience: ${AUD[q.audience]}.` : ''} Keep the headline, executive summary, themes, wins, watch-outs and road ahead focused on these topics; write section commentary only for the sections present.${r.sections.filter((s) => s.ask).map((s) => ` Section ${s.id} ("${s.title}") answers the reader's own question: "${s.ask}" — answer it directly in that section's headline and narrative, but never quote or restate the question itself.`).join('')} ${r.sections.some((s) => s.id === 'road') ? '' : 'There is no Road Ahead section — still give 3–5 priorities for these topics.'}\n\n`;
}

export async function generateInsights(r: Report, tier: Tier = 'balanced'): Promise<ReportInsights> {
  if (!config.anthropicKey) return rulesInsights(r);
  const client = new Anthropic({ apiKey: config.anthropicKey });
  let order = fallbackOrder(tier);
  let lastErr = '';
  while (order.length) {
    const model = MODELS[order[0]];
    try {
      const tool = toolFor(idsOf(r), chartIds(r), kpiIds(r));
      const content = `${brief(r)}Write the commentary for this report by calling the write_report tool exactly once.\n\n${digest(r)}`;
      // think first (auto tool choice — thinking can't be combined with a forced tool), then forced, then auto.
      // Always streamed: long thinking + a long tool call can exceed the SDK's non-streaming limit.
      const ask = (mode: 'think' | 'forced' | 'auto') => client.messages.stream({
        model: model.id, system: SYSTEM, tools: [tool], messages: [{ role: 'user', content }],
        ...(mode === 'think' ? { ...thinkParams(model.id, order[0], 16000), tool_choice: { type: 'auto' as const } }
          : { max_tokens: 16000, tool_choice: mode === 'forced' ? { type: 'tool' as const, name: 'write_report' } : { type: 'auto' as const } }),
      } as Anthropic.MessageStreamParams).finalMessage();
      let msg: Anthropic.Message | null = null;
      if (config.thinking !== 'off') {
        for (let tries = 0; tries < 4 && !msg; tries++) {
          try { msg = await ask('think'); if (!msg.content.some((c) => c.type === 'tool_use') && !jsonFromText(msg)) { msg = null; break; } }
          catch (e) {
            const m = (e as Error).message;
            if (isNotFound(m)) throw e;
            if (noteThinkingError(model.id, m)) { log.info({ model: model.id, err: m.slice(0, 160) }, 'thinking settings rejected — adjusting'); continue; }
            log.info({ model: model.id, err: m.slice(0, 160) }, 'thinking run failed — retrying without thinking'); break;
          }
        }
      }
      if (!msg) {
        try { msg = await ask('forced'); }
        catch (e) {
          // some models (e.g. those that always think) reject a forced tool choice — let them choose the tool themselves
          if (!/tool_choice/i.test((e as Error).message)) throw e;
          log.info({ model: model.id }, 'forced tool_choice not supported — retrying with auto');
          msg = await ask('auto');
        }
      }
      const tu = msg.content.find((c): c is Anthropic.ToolUseBlock => c.type === 'tool_use');
      const input = (tu?.input as Partial<ReportInsights> | undefined) ?? jsonFromText(msg);
      if (!input) throw new Error('No structured output returned');
      const out = normalise(input, r);
      const text = [out.headline, out.executive_summary, ...out.at_a_glance, ...out.wins, ...out.watch_outs, ...out.themes.map((t) => t.detail),
        ...Object.values(out.sections).flatMap((x) => [x.headline, x.narrative, ...x.findings]), out.road_ahead.summary].join('\n');
      return { ...out, model: model.label, source: 'ai', verification: verifyNarrative(text, r.results) };
    } catch (e) {
      lastErr = (e as Error).message;
      log.warn({ model: model.id, err: lastErr.slice(0, 200) }, 'report insights failed');
      if (isNotFound(lastErr)) { const again = markMissing(model.id, order[0]); if (again) continue; if (order.length > 1) { order = order.slice(1); continue; } }
      break;
    }
  }
  const fb = rulesInsights(r);
  return { ...fb, executive_summary: `${fb.executive_summary}\n\n(AI commentary unavailable: ${lastErr.slice(0, 140)})` };
}

/**
 * Models occasionally return a nested field as a JSON-encoded string ("[{...}]") or a single item where a list
 * is expected. Repair those shapes so the report never receives a string where it needs a list or object.
 */
const LISTS = new Set(['at_a_glance', 'wins', 'watch_outs', 'themes', 'recommendations', 'priorities', 'risks', 'opportunities', 'targets', 'findings', 'actions', 'spotlights', 'section_order', 'condense', 'cover_kpis', 'chart_types', 'kpis']);
const OBJECTS = new Set(['sections', 'road_ahead', 'verification', 'design']);
export function repairInsights<T>(v: T, key = ''): T {
  let x: unknown = v;
  if (typeof x === 'string' && (LISTS.has(key) || OBJECTS.has(key))) {
    const t = x.trim();
    if (/^[[{]/.test(t)) { try { x = JSON.parse(t); } catch { /* keep as text */ } }
  }
  if (LISTS.has(key)) {
    if (x === null || x === undefined || x === '') x = [];
    else if (!Array.isArray(x)) x = typeof x === 'string' ? x.split(/\n+/).map((y) => y.replace(/^[-•\d.)\s]+/, '').trim()).filter(Boolean) : [x];
  }
  if (OBJECTS.has(key) && (typeof x !== 'object' || x === null || Array.isArray(x))) x = key === 'verification' ? undefined : {};
  if (Array.isArray(x)) return x.map((y) => repairInsights(y)) as T;
  if (x && typeof x === 'object') return Object.fromEntries(Object.entries(x as Record<string, unknown>).map(([k, y]) => [k, repairInsights(y, key === 'sections' ? '' : k)])) as T;
  return x as T;
}

/** Fill gaps in a partial model response with the rule-based commentary. */
function normalise(raw: Partial<ReportInsights>, r: Report): ReportInsights {
  const o = repairInsights(raw);
  const fb = rulesInsights(r);
  const sections: Record<string, SectionCommentary> = {};
  for (const id of [...new Set([...SECTION_IDS, ...idsOf(r)])]) { const s = o.sections?.[id]; sections[id] = s && s.narrative ? { headline: s.headline ?? fb.sections[id].headline, narrative: s.narrative, findings: s.findings ?? [], actions: s.actions ?? [] } : fb.sections[id]; }
  const ra = o.road_ahead;
  return {
    headline: o.headline ?? fb.headline, executive_summary: o.executive_summary ?? fb.executive_summary,
    at_a_glance: o.at_a_glance?.length ? o.at_a_glance : fb.at_a_glance, wins: o.wins?.length ? o.wins : fb.wins, watch_outs: o.watch_outs?.length ? o.watch_outs : fb.watch_outs,
    themes: o.themes?.length ? o.themes : fb.themes, sections, recommendations: o.recommendations?.length ? o.recommendations : fb.recommendations,
    road_ahead: { summary: ra?.summary ?? fb.road_ahead.summary, priorities: ra?.priorities?.length ? ra.priorities : fb.road_ahead.priorities,
      risks: ra?.risks ?? fb.road_ahead.risks, opportunities: ra?.opportunities ?? fb.road_ahead.opportunities, targets: ra?.targets ?? fb.road_ahead.targets },
    design: cleanDesign(o.design, r) ?? fb.design, spotlights: cleanSpotlights(o.spotlights, r),
    source: 'ai',
  };
}
const chartIds = (r: Report) => r.sections.flatMap((s) => s.charts.map((c) => c.id));
const kpiIds = (r: Report) => [...new Set([...r.scorecard, ...r.headline, ...r.sections.flatMap((s) => s.kpis)].map((k) => k.id))];
const pick = <T extends string>(v: unknown, ok: readonly T[], fb: T): T => (ok.includes(v as T) ? (v as T) : fb);
function cleanDesign(d: Partial<ReportDesign> | undefined, r: Report): ReportDesign | undefined {
  if (!d || typeof d !== 'object') return undefined;
  const ids = idsOf(r), charts = new Set(chartIds(r)), kpis = new Set(kpiIds(r));
  const base = seededDesign(r);
  const arr = (x: unknown) => (Array.isArray(x) ? x.filter((y): y is string => typeof y === 'string') : []);
  const order = [...new Set(arr(d.section_order).filter((x) => ids.includes(x)))];
  return {
    mood: pick(d.mood, MOODS, base.mood), accent: pick(d.accent, DESIGN_ACCENTS, base.accent), cover_photo: pick(d.cover_photo, COVER_PHOTOS, base.cover_photo),
    cover_style: pick(d.cover_style, ['photo', 'gradient', 'light'] as const, base.cover_style),
    section_order: [...order, ...ids.filter((x) => !order.includes(x))],
    condense: arr(d.condense).filter((x) => ids.includes(x)).slice(0, 4),
    cover_kpis: arr(d.cover_kpis).filter((x) => kpis.has(x)).slice(0, 4),
    chart_types: (Array.isArray(d.chart_types) ? d.chart_types : []).filter((c) => c && charts.has(c.chart_id) && (CHART_TYPES as readonly string[]).includes(c.chart)),
    rationale: typeof d.rationale === 'string' ? d.rationale : undefined,
  };
}
function cleanSpotlights(x: unknown, r: Report): Spotlight[] {
  if (!Array.isArray(x)) return [];
  const ids = idsOf(r), charts = new Set(chartIds(r)), kpis = new Set(kpiIds(r));
  return x.filter((s) => s && typeof s.title === 'string' && typeof s.body === 'string').slice(0, 3).map((s) => ({
    section: ids.includes(s.section) ? s.section : ids[0] ?? 'exec', kicker: String(s.kicker ?? 'Spotlight'), title: s.title, body: s.body,
    chart_id: charts.has(s.chart_id) ? s.chart_id : undefined, kpis: (Array.isArray(s.kpis) ? s.kpis : []).filter((k: string) => kpis.has(k)).slice(0, 3),
    tone: pick(s.tone, ['good', 'bad', 'neutral'] as const, 'neutral'),
  }));
}
/** Rule-based art direction so even reports without AI vary with their data: mood from the headline movers, the rest seeded by the report. */
function seededDesign(r: Report): ReportDesign {
  const h = [...`${r.id}|${r.period.start}|${r.scope}`].reduce((a, c) => (a * 31 + c.charCodeAt(0)) >>> 0, 7);
  const moves = r.headline.filter((k) => k.chg !== null && k.higherIsBetter !== undefined).map((k) => ((k.chg! > 0) === k.higherIsBetter ? 1 : -1));
  const net = moves.reduce((a, b) => a + b, 0);
  const mood: ReportDesign['mood'] = net >= 3 ? 'momentum' : net <= -3 ? 'caution' : net > 0 ? 'recovery' : net < 0 ? 'turnaround' : 'steady';
  const pal: Record<string, string[]> = { momentum: ['Emerald', 'Teal', 'Physique 57'], steady: ['Physique 57', 'Cobalt', 'Ocean'], caution: ['Amber', 'Coral', 'Rose'], recovery: ['Teal', 'Ocean', 'Cobalt'], turnaround: ['Indigo', 'Violet', 'Fuchsia'] };
  const lead = r.sections.find((s) => s.id !== 'road')?.id ?? '';
  const photos: string[] = /trainer|associate/.test(lead) ? ['trainers-pair', 'trainers-duo'] : /lead|clients|new_clients/.test(lead) ? ['cycle-group', 'barre-group', 'cycle-ride'] : [...COVER_PHOTOS];
  const ids = idsOf(r);
  return { mood, accent: pal[mood][h % 3], cover_photo: photos[(h >> 3) % photos.length], cover_style: (['photo', 'photo', 'gradient', 'light'] as const)[(h >> 6) % 4],
    section_order: ids, condense: [], cover_kpis: [], chart_types: [] };
}

/** Deterministic commentary when the AI engine isn't configured (or as a fallback). */
export function rulesInsights(r: Report): ReportInsights {
  const base = rulesBase(r);
  if (r.request.kind !== 'custom') return base;
  const qLed = r.sections.length > 0 && r.sections.every((s) => s.id.startsWith('trainer_ranking') || s.id.startsWith('lead_channels') || s.id === 'road');
  if (qLed) {
    const ai = r.autoInsights;
    return { ...base,
      headline: r.glance?.[0]?.a ?? ai.highlights[0] ?? base.headline,
      executive_summary: [ai.highlights.slice(0, 3).join(' '), ai.concerns.slice(0, 2).join(' ')].filter(Boolean).join('\n\n'),
      at_a_glance: r.glance?.length ? r.glance.slice(0, 6).map((g) => g.a) : r.headline.slice(0, 6).map((k) => `${k.label} · ${fmtVal(k.value, k.format)}`),
      themes: r.sections.filter((s) => s.answer).slice(0, 3).map((s) => ({ title: s.answer!.question, detail: s.answer!.headline })),
    };
  }
  // custom reports: summary built from the chosen topics instead of the whole-business story
  const P = r.period;
  const line = (x: Kpi) => `${x.label} ${fmtVal(x.value, x.format)} (${fmtChg(x)} vs ${P.prevLabel}, ${fmtChg(x, 'chgLy')} vs ${P.lyLabel})`;
  const secs = r.sections.filter((s) => s.id !== 'road' && s.kpis.length);
  const lead = r.headline[0];
  return { ...base,
    headline: lead ? `${r.request.title ? `${r.request.title} — ` : ''}${r.scope}, ${P.label}: ${line(lead)}.` : base.headline,
    executive_summary: secs.map((s) => `${s.title}: ${s.kpis.slice(0, 3).map(line).join('; ')}.`).join('\n\n') || base.executive_summary,
    at_a_glance: r.headline.slice(0, 6).map((x) => `${x.label} ${fmtVal(x.value, x.format)} · ${fmtChg(x)} vs ${P.prevLabel}`),
    themes: secs.slice(0, 3).map((s) => ({ title: s.title, detail: base.sections[s.id]?.headline || s.summary })),
  };
}
function rulesBase(r: Report): ReportInsights {
  const P = r.period;
  const k = new Map(r.scorecard.map((x) => [x.id, x]));
  const say = (id: string) => { const x = k.get(id); return x ? `${x.label.toLowerCase()} ${fmtVal(x.value, x.format)} (${fmtChg(x)} vs ${P.prevLabel}, ${fmtChg(x, 'chgYtd')} vs ${P.ytdLabel}, ${fmtChg(x, 'chgLy')} vs ${P.lyLabel})` : ''; };
  const rev = k.get('revenue');
  const sections: Record<string, SectionCommentary> = {};
  for (const s of r.sections) {
    if (s.id === 'road') continue;
    const top = [...s.kpis].filter((x) => x.chg !== null && x.higherIsBetter !== undefined).sort((a, b) => Math.abs(b.chg!) - Math.abs(a.chg!))[0];
    if (s.answer) { sections[s.id] = { headline: s.answer.headline, narrative: s.summary, findings: s.insights.length ? s.insights : s.answer.points, actions: s.actions ?? [] }; continue; }
    if (s.actions?.length && s.kpis.every((k) => k.chg === null)) { sections[s.id] = { headline: s.insights[0] ?? s.summary, narrative: s.summary, findings: s.insights.slice(1), actions: s.actions }; continue; }
    sections[s.id] = {
      headline: top ? `${top.label} at ${fmtVal(top.value, top.format)}, ${fmtChg(top)} vs ${P.prevLabel}.` : s.summary,
      narrative: `${s.summary} ${s.kpis.slice(0, 3).map((x) => `${x.label} was ${fmtVal(x.value, x.format)} (${fmtChg(x)} vs ${P.prevLabel}; ${fmtChg(x, 'chgYtd')} vs the ${P.ytdLabel}; ${fmtChg(x, 'chgLy')} vs ${P.lyLabel})`).join('. ')}.`,
      findings: s.insights, actions: s.actions?.length ? s.actions : s.kpis.filter((x) => x.chg !== null && x.higherIsBetter !== undefined && (x.chg > 0) !== x.higherIsBetter).map((x) => PLAY[x.id]).filter(Boolean).slice(0, 3) as string[],
    };
  }
  for (const id of SECTION_IDS) sections[id] ??= { headline: '', narrative: '', findings: [], actions: [] };
  const recs = r.autoInsights.recommendations.map((x) => ({ ...x, owner: 'Studio leadership', timing: 'Next month', target: 'Back to the current-year average', priority: x.priority }));
  return {
    headline: rev ? `${r.scope}: revenue ${fmtVal(rev.value, 'currency')} in ${P.label} — ${fmtChg(rev)} vs ${P.prevLabel}, ${fmtChg(rev, 'chgYtd')} vs the ${P.ytdLabel} and ${fmtChg(rev, 'chgLy')} vs ${P.lyLabel}.` : `${r.scope} — ${P.label}`,
    executive_summary: [`In ${P.label}, ${[say('revenue'), say('paying_visiting_clients')].filter(Boolean).join('; ')}.`, `Acquisition: ${[say('new_clients'), say('conversion_rate')].filter(Boolean).join('; ')}. Schedule: ${[say('fill_rate'), say('class_average')].filter(Boolean).join('; ')}.`, `Retention: ${[say('sheet_renewal_rate'), say('late_cancel_rate')].filter(Boolean).join('; ')}. The sections that follow show the drivers behind each number.`].join('\n\n'),
    at_a_glance: r.scorecard.filter((x) => ['revenue', 'paying_visiting_clients', 'new_clients', 'conversion_rate', 'fill_rate', 'sheet_renewal_rate'].includes(x.id)).map((x) => `${x.label} ${fmtVal(x.value, x.format)} · ${fmtChg(x)} vs ${P.prevLabel}`),
    wins: r.autoInsights.highlights, watch_outs: r.autoInsights.concerns,
    themes: [
      { title: 'Revenue quality', detail: `${say('atv')}; ${say('discount_rate')}.` },
      { title: 'Acquisition to conversion', detail: `${say('leads')}; ${say('new_clients')}; ${say('conversion_rate')}.` },
      { title: 'Schedule productivity', detail: `${say('fill_rate')}; ${say('empty_class_rate')}.` },
    ],
    sections,
    recommendations: r.autoInsights.recommendations.map((x) => ({ title: x.title, detail: x.detail, owner: /trainer|coach|benchmark|class/i.test(x.title + x.detail) ? 'Head of programming / studio manager' : 'Studio leadership', priority: x.priority, impact: x.kpi ? `Moves ${x.kpi.toLowerCase()}` : undefined })),
    road_ahead: {
      summary: (r.sections.find((s) => s.id === 'road')?.visuals?.forecasts ?? []).map((f) => `${f.label} for ${f.month} is forecast at ${fmtVal(f.value, f.format)} (80% range ${fmtVal(f.lo, f.format)}–${fmtVal(f.hi, f.format)}).`).join(' ') || 'Track the flagged metrics weekly next month.',
      priorities: recs, risks: r.autoInsights.concerns.slice(0, 3), opportunities: r.autoInsights.highlights.slice(0, 3),
      targets: r.scorecard.filter((x) => ['revenue', 'new_clients', 'conversion_rate', 'fill_rate'].includes(x.id)).map((x) => ({ metric: x.label, target: `≥ ${fmtVal(x.ytd !== null && x.value !== null ? Math.max(x.ytd, x.value) : x.value, x.format)}`, rationale: `Hold the better of ${P.label} and the ${P.ytdLabel}.` })),
    },
    design: seededDesign(r), spotlights: [],
    source: 'rules',
  };
}
const PLAY: Record<string, string> = {
  revenue: 'Push renewal-window upgrades (3-month → 6-month / annual).', atv: 'Steer the mix to unlimited / longer memberships; tighten discounts.', discount_rate: 'Audit discount codes by associate.',
  conversion_rate: 'Book the second class before newcomers leave; follow up within 48 hours.', second_visit_rate: 'Tighten the newcomer follow-up sequence.', new_clients: 'Lift trial supply via referrals and partner sign-ups.',
  lead_conversion_rate: 'Review speed-to-lead and follow-up cadence by associate.', lead_to_trial_rate: 'Call new leads within the hour with a trial-booking script.', leads: 'Rebalance spend to the channels with the best cost per member.',
  fill_rate: 'Re-time or merge chronic under-filling classes.', class_average: 'Put strong-draw trainers in weak slots.', empty_class_rate: 'Remove recurring classes that repeatedly run empty.',
  sheet_renewal_rate: 'Start renewal outreach 14 days before expiry.', churn_rate: 'Offer freezes / save offers before expiry.', late_cancel_rate: 'Enforce the late-cancel policy and send cut-off reminders.',
  visits_per_client: 'Nudge clients whose visit frequency drops.', paying_visiting_clients: 'Convert complimentary visitors with time-boxed offers.',
};
