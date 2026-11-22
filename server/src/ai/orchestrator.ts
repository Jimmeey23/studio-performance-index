import Anthropic from '@anthropic-ai/sdk';
import { config } from '../config.js';
import { TOOLS, executeTool, summarise } from './tools.js';
import { systemPrompt } from './prompt.js';
import { verifyNarrative, type Verification } from './verify.js';
import { chooseTier, escalate, fallbackOrder, MODELS, type Tier, type TierChoice } from './router.js';
import { thinkParams, noteThinkingError, markMissing, isNotFound } from './models.js';
import { domainById } from './domains.js';
import { appDb, newId, saveResult, getResult, parseJson, audit } from '../store/app.js';
import type { AnyResult } from '../analytics/analyses.js';
import { runMetricsQuery, type QueryResult } from '../semantic/engine.js';
import { modelById, metricById } from '../semantic/metrics.js';
import { log } from '../util/log.js';

export type StreamEvent =
  | { type: 'meta'; conversationId: string; model: string; modelLabel: string; tier: Tier; reason: string; domain?: string }
  | { type: 'step'; id: string; label: string; status: 'running' | 'done' | 'error'; detail?: string }
  | { type: 'text'; delta: string }
  | { type: 'thinking'; delta: string }
  | { type: 'plan'; plan: Plan }
  | { type: 'text_reset' }
  | { type: 'block'; block: Block }
  | { type: 'verification'; verification: Verification }
  | { type: 'done'; messageId: string; conversationId: string; title: string }
  | { type: 'error'; message: string };

export interface Block {
  id: string; type: string; title?: string; chart?: string; x?: string; y?: string[]; series_by?: string;
  metrics?: string[]; columns?: string[]; pivot?: { rows: string; columns: string; value: string };
  view?: string; group_by?: string;
  items?: { kind: string; title: string; detail: string; priority?: string }[];
  question?: string; options?: string[]; why?: string; questions?: string[];
  drilldowns?: AnyResult[]; definitions?: { metric: string; label: string; description: string; caveat?: string }[];
  sources?: string[]; notes?: string[];
  result?: AnyResult;
}

export interface Controls {
  period?: { label?: string; start?: string; end?: string };
  locations?: string[];
  compare?: 'previous_period' | 'previous_year' | null;
  tier?: TierChoice;
}

export interface Llm {
  create(params: Anthropic.MessageCreateParamsNonStreaming, onText: (t: string) => void, onThinking?: (t: string) => void): Promise<Anthropic.Message>;
}

export function anthropicLlm(): Llm {
  const client = new Anthropic({ apiKey: config.anthropicKey });
  return {
    async create(params, onText, onThinking) {
      const stream = client.messages.stream(params);
      stream.on('text', onText);
      if (onThinking) stream.on('thinking', (d) => onThinking(d));
      return stream.finalMessage();
    },
  };
}

export interface Plan { goal: string; steps: { id: string; text: string; status: 'pending' | 'running' | 'done' | 'skipped'; note?: string }[] }
const STEP_LABELS: Record<string, string> = {
  plan: 'Planning', driver_analysis: 'Finding the drivers', class_explorer: 'Ranking classes', lead_channel_analysis: 'Analysing lead channels', brand_knowledge: 'Checking brand knowledge', remember: 'Saving to memory',
  query_metrics: 'Computing metrics', forecast: 'Building forecast', detect_anomalies: 'Scanning for anomalies',
  cohort_retention: 'Building cohort table', funnel: 'Building funnel', renewal_analysis: 'Analysing renewals',
  winback_analysis: 'Analysing win-backs', target_vs_actual: 'Comparing with targets', find_values: 'Looking up values',
  client_lookup: 'Looking up client', describe_dataset: 'Reading data dictionary', run_sql: 'Running custom query',
  calculate: 'Calculating', format_overlap: 'Analysing format cross-over', render: 'Preparing visuals', ask_user: 'Asking a clarifying question', suggest_followups: 'Suggesting next questions',
};
const TERMINAL = new Set(['ask_user', 'suggest_followups']);
/** Tool rounds allowed per tier — complex work gets room for multi-step analysis. */
const MAX_ITER: Record<Tier, number> = { fast: 10, balanced: 20, deep: 30 };

function describeCall(name: string, input: Record<string, unknown>): string {
  if (name === 'query_metrics') {
    const parts = [`${(input.metrics as string[]).join(', ')}`];
    if ((input.dimensions as string[] | undefined)?.length) parts.push(`by ${(input.dimensions as string[]).join(', ')}`);
    if (input.grain && input.grain !== 'all') parts.push(`per ${input.grain}`);
    if (input.start || input.end) parts.push(`${input.start ?? '…'} → ${input.end ?? '…'}`);
    if (input.compare) parts.push(`vs ${String(input.compare).replace('_', ' ')}`);
    return parts.join(' · ');
  }
  if (name === 'run_sql') return String(input.purpose ?? '');
  if (name === 'calculate') return String(input.label ?? '');
  if (name === 'forecast') return `${input.metric}, ${input.horizon ?? 3} months`;
  if (name === 'ask_user') return String(input.question ?? '');
  if (name === 'suggest_followups' || name === 'render') return '';
  return Object.entries(input).map(([k, v]) => `${k}=${typeof v === 'object' ? JSON.stringify(v) : v}`).join(' · ').slice(0, 160);
}

function friendlyError(m: string, model: string) {
  if (/authentication_error|invalid x-api-key|\b401\b/.test(m)) return 'Anthropic rejected the API key. Create a key at console.anthropic.com › API Keys (it starts with "sk-ant-api03-"), put it in server/.env as ANTHROPIC_API_KEY, and restart the server.';
  if (/not_found_error/.test(m) || (/\b404\b/.test(m) && /model/i.test(m))) return `The model "${model}" isn't available to this API key. Set ANTHROPIC_MODEL_FAST / _BALANCED / _DEEP in server/.env to models your account can use, then restart.`;
  if (/rate_limit|\b429\b|overloaded|\b529\b/.test(m)) return 'The AI service is busy or rate-limited. Wait a moment and ask again.';
  if (/credit balance|billing/i.test(m)) return 'The Anthropic account has no API credits. Add credits in console.anthropic.com › Billing.';
  return `The analysis failed: ${m}`;
}

function controlsNote(c?: Controls): string {
  if (!c) return '';
  const parts: string[] = [];
  if (c.period?.start || c.period?.end) parts.push(`Period: ${c.period.label ?? ''} (${c.period.start ?? '…'} to ${c.period.end ?? '…'})`);
  if (c.locations?.length) parts.push(`Locations: ${c.locations.join(', ')}`);
  if (c.compare) parts.push(`Compare with: ${c.compare === 'previous_year' ? 'same period last year' : 'previous period'}`);
  return parts.length ? `\n\n[Controls selected in the app — apply unless the question says otherwise: ${parts.join(' · ')}]` : '';
}

async function loadHistory(conversationId: string): Promise<Anthropic.MessageParam[]> {
  const db = await appDb();
  const rows = await db.all<{ llm: string }>(`select llm from messages where conversation_id = ? order by created_at`, [conversationId]);
  const msgs: Anthropic.MessageParam[] = [];
  for (const r of rows) msgs.push(...parseJson<Anthropic.MessageParam[]>(r.llm));
  let userTurns = 0, cut = 0;
  for (let i = msgs.length - 1; i >= 0; i--) {
    const m = msgs[i];
    if (m.role === 'user' && typeof m.content === 'string') { userTurns++; if (userTurns > 12) { cut = i + 1; break; } }
  }
  // the history must start with a plain user message
  let h = msgs.slice(cut);
  while (h.length && !(h[0].role === 'user' && typeof h[0].content === 'string')) h = h.slice(1);
  return h;
}

export async function answer(opts: {
  conversationId?: string; userId: string; question: string; emit: (e: StreamEvent) => void; llm?: Llm;
  controls?: Controls; domain?: string; context?: string;
}): Promise<void> {
  const { userId, question, emit, controls } = opts;
  const db = await appDb();
  if (!opts.llm && !config.anthropicKey) {
    emit({ type: 'error', message: 'The AI engine is not configured: add ANTHROPIC_API_KEY to server/.env and restart.' });
    return;
  }
  const llm = opts.llm ?? anthropicLlm();
  let conversationId = opts.conversationId;
  let title = question.slice(0, 80);
  let domainId = opts.domain;
  if (!conversationId) {
    conversationId = newId('c');
    await db.all(`insert into conversations(id, user_id, title, domain) values (?, ?, ?, ?)`, [conversationId, userId, title, domainId ?? null]);
  } else {
    const c = await db.one<{ title: string; domain: string | null }>(`select title, domain from conversations where id = ?`, [conversationId]);
    if (!c) throw new Error('Conversation not found');
    title = c.title; domainId = domainId ?? c.domain ?? undefined;
  }
  const domain = domainId ? domainById.get(domainId) : undefined;
  await audit(userId, 'question', { conversationId, question, domain: domainId, controls });

  const history = await loadHistory(conversationId);
  const turns = history.filter((m) => m.role === 'user' && typeof m.content === 'string').length;
  const { tier, reason, score } = chooseTier(question, { choice: controls?.tier, turns });
  const manual = !!controls?.tier && controls.tier !== 'auto';
  const llmQuestion = question + controlsNote(controls);

  const userMsgId = newId('m');
  await db.all(`insert into messages(id, conversation_id, role, display, llm) values (?, ?, 'user', ?, ?)`,
    [userMsgId, conversationId, JSON.stringify({ text: question, controls }), JSON.stringify([{ role: 'user', content: llmQuestion }])]);

  const { stable, dynamic } = await systemPrompt();
  const domainBrief = domain ? `\n\n# You are the ${domain.label} expert sub-agent\n${domain.expert}\nDefault focus metrics: ${domain.kpis.join(', ')}. Stay within this domain unless the user asks otherwise; pull in other datasets when they explain a result.` : '';
  const ctxBrief = opts.context ? `\n\n# The user is reading this Executive Performance Review right now\nAnswer questions about anything in it (numbers, commentary, recommendations) from the digest below, and query the data with your tools for anything beyond it — other periods, studios, breakdowns or metrics. When asked to build something for the report (a table, chart, comparison or summary), build it with your tools as a complete, well-titled result; the user can add any result to a chapter with one click.\n\n${opts.context}` : '';
  const turn: Anthropic.MessageParam[] = [{ role: 'user', content: llmQuestion }];
  const results = new Map<string, AnyResult>();
  const blocks: Block[] = [];
  const steps: { id: string; label: string; detail?: string; status: string; ms?: number }[] = [];
  let finalText = '';
  let narrativeCandidate = '';
  let gotFollowups = false;
  let askedUser = false;
  const t0 = Date.now();

  let modelTiers = fallbackOrder(tier);
  let model = MODELS[modelTiers[0]];
  emit({ type: 'meta', conversationId, model: model.id, modelLabel: model.label, tier: modelTiers[0], reason, domain: domainId });

  const pushBlock = (b: Block) => { blocks.push(b); emit({ type: 'block', block: b }); };
  let thinkingText = '';
  // Extended thinking: every tier reasons at length before answering; the budget scales with the tier.
  // Modes are tried in order; a model that rejects one falls back to the next.
  let toolErrors = 0, sinceSwitch = 0;
  const thinkOff = config.thinking === 'off';
  let plan = null as Plan | null;
  try {
    for (let iter = 0; iter < MAX_ITER[modelTiers[0]] + (plan ? 4 : 0); iter++) {
      let iterText = '';
      let msg: Anthropic.Message | null = null;
      while (!msg) {
        try {
          msg = await llm.create({
            model: model.id,
            ...thinkParams(model.id, modelTiers[0], undefined, thinkOff),
            system: [
              { type: 'text', text: stable, cache_control: { type: 'ephemeral' } },
              { type: 'text', text: dynamic + domainBrief + ctxBrief },
            ],
            tools: TOOLS,
            messages: [...history, ...turn],
          }, (t) => { iterText += t; emit({ type: 'text', delta: t }); }, (t) => { thinkingText += t; emit({ type: 'thinking', delta: t }); });
        } catch (e) {
          const m = (e as Error).message;
          // thinking style not supported by this model → switch style (adaptive / budget / off) and retry
          if (noteThinkingError(model.id, m)) {
            log.warn({ model: model.id, err: m.slice(0, 200) }, 'thinking settings rejected — adjusting');
            if (iterText) emit({ type: 'text_reset' });
            iterText = '';
            continue;
          }
          // model not available on this key → next candidate for the tier, else the next tier
          if (isNotFound(m)) {
            const again = markMissing(model.id, modelTiers[0]);
            if (!again && modelTiers.length <= 1) throw e;
            log.warn({ model: model.id }, 'model unavailable, falling back');
            if (!again) modelTiers = modelTiers.slice(1);
            model = MODELS[modelTiers[0]];
            emit({ type: 'meta', conversationId, model: model.id, modelLabel: model.label, tier: modelTiers[0], reason: `${reason}; fell back — previous model unavailable`, domain: domainId });
            if (iterText) emit({ type: 'text_reset' });
            iterText = '';
            continue;
          }
          throw e;
        }
      }
      turn.push({ role: 'assistant', content: msg.content });
      const toolUses = msg.content.filter((c): c is Anthropic.ToolUseBlock => c.type === 'tool_use');
      const msgText = msg.content.filter((c): c is Anthropic.TextBlock => c.type === 'text').map((c) => c.text).join('\n').trim();
      if (!toolUses.length || msg.stop_reason !== 'tool_use') { finalText = msgText || iterText || narrativeCandidate; break; }
      const terminal = toolUses.some((t) => TERMINAL.has(t.name));
      const onlyPresentational = toolUses.every((t) => TERMINAL.has(t.name) || t.name === 'render');
      if (msgText && onlyPresentational) narrativeCandidate = msgText;
      else if (iterText.trim()) emit({ type: 'text_reset' });

      const toolResults: Anthropic.ToolResultBlockParam[] = [];
      for (const tu of toolUses) {
        const input = (tu.input ?? {}) as Record<string, unknown>;
        const stepId = tu.id;
        const label = STEP_LABELS[tu.name] ?? tu.name;
        const detail = describeCall(tu.name, input);
        const quiet = tu.name === 'suggest_followups' || tu.name === 'plan';
        if (!quiet) emit({ type: 'step', id: stepId, label, status: 'running', detail });
        const s0 = Date.now();
        try {
          if (tu.name === 'plan') {
            const st = (x: unknown) => (['running', 'done', 'skipped'].includes(String(x)) ? String(x) : 'pending') as Plan['steps'][number]['status'];
            if (Array.isArray(input.steps) && input.steps.length) plan = { goal: String(input.goal ?? plan?.goal ?? ''), steps: (input.steps as { id: string; text: string }[]).slice(0, 10).map((x, i) => ({ id: String(x.id ?? i + 1), text: String(x.text ?? ''), status: 'pending' })) };
            for (const u of (input.updates as { id: string; status: string; note?: string }[] | undefined) ?? []) {
              const step = plan?.steps.find((x) => x.id === String(u.id)); if (step) { step.status = st(u.status); if (u.note) step.note = String(u.note).slice(0, 240); }
            }
            if (plan) emit({ type: 'plan', plan: JSON.parse(JSON.stringify(plan)) });
            toolResults.push({ type: 'tool_result', tool_use_id: tu.id, content: plan ? `Plan recorded (${plan.steps.length} steps). Work through it, updating statuses as you finish steps. Before the final answer, check every step is done or deliberately skipped.` : 'No plan steps given.' });
          } else if (tu.name === 'render') {
            const out = await buildBlocks(input, results);
            out.blocks.forEach(pushBlock);
            toolResults.push({ type: 'tool_result', tool_use_id: tu.id, content: out.errors.length ? `Rendered ${out.blocks.length} block(s). Problems: ${out.errors.join('; ')}` : `Rendered ${out.blocks.length} block(s). Now write the narrative and call suggest_followups.`, is_error: out.errors.length > 0 && !out.blocks.length });
          } else if (tu.name === 'ask_user') {
            askedUser = true;
            pushBlock({ id: newId('b'), type: 'clarify', question: String(input.question ?? ''), options: (input.options as string[] ?? []).slice(0, 5), why: input.why as string | undefined });
            toolResults.push({ type: 'tool_result', tool_use_id: tu.id, content: 'Question shown to the user with clickable options. Their answer will arrive as the next message.' });
          } else if (tu.name === 'suggest_followups') {
            gotFollowups = true;
            pushBlock({ id: newId('b'), type: 'followups', questions: (input.questions as string[] ?? []).slice(0, 3) });
            toolResults.push({ type: 'tool_result', tool_use_id: tu.id, content: 'Follow-ups shown.' });
          } else {
            const { result, data } = await executeTool(tu.name, input);
            if (result) {
              results.set(result.id, result);
              await saveResult(conversationId, result);
              toolResults.push({ type: 'tool_result', tool_use_id: tu.id, content: summarise(result) });
            } else {
              const txt = JSON.stringify(data);
              toolResults.push({ type: 'tool_result', tool_use_id: tu.id, content: txt.length > 30000 ? txt.slice(0, 30000) + '…(truncated)' : txt });
            }
          }
          steps.push({ id: stepId, label, detail, status: 'done', ms: Date.now() - s0 });
          if (!quiet) emit({ type: 'step', id: stepId, label, status: 'done', detail });
        } catch (e) {
          const m = (e as Error).message;
          steps.push({ id: stepId, label, detail: `${detail} — ${m}`, status: 'error', ms: Date.now() - s0 });
          emit({ type: 'step', id: stepId, label, status: 'error', detail: m });
          toolResults.push({ type: 'tool_result', tool_use_id: tu.id, content: `Error: ${m}`, is_error: true });
          toolErrors++;
          log.warn({ tool: tu.name, err: m }, 'tool error');
        }
      }
      turn.push({ role: 'user', content: toolResults });
      if (terminal) { finalText = msgText || narrativeCandidate; break; }
      // cheaper model struggling → hand the work so far to the next tier (restarted cleanly, with its own thinking)
      sinceSwitch++;
      const up = manual ? null : escalate(modelTiers[0], { iter: sinceSwitch, toolErrors, score });
      if (up) {
        const gathered = turn.slice(1).flatMap((m) => (m.role === 'user' && Array.isArray(m.content) ? (m.content as Anthropic.ToolResultBlockParam[]).filter((c) => c.type === 'tool_result' && typeof c.content === 'string').map((c) => (c.content as string).slice(0, 3000)) : [])).join('\n---\n');
        turn.splice(0, turn.length, { role: 'user', content: `${llmQuestion}\n\n[Context: a faster model started this analysis and gathered the results below — result ids can be rendered directly. ${blocks.length} visual(s) are already on screen; don't repeat them unless you improve them. Fix anything that failed, then finish the answer.]\n${gathered}` });
        log.info({ from: modelTiers[0], to: up, iter, toolErrors }, 'escalating model');
        modelTiers = fallbackOrder(up); model = MODELS[up]; toolErrors = 0; sinceSwitch = 0;
        emit({ type: 'meta', conversationId, model: model.id, modelLabel: model.label, tier: up, reason: `${reason}; escalated to ${model.label} for a harder analysis`, domain: domainId });
      }
    }
  } catch (e) {
    const m = (e as Error).message;
    log.error({ err: m }, 'llm loop failed');
    emit({ type: 'error', message: friendlyError(m, model.id) });
    return;
  }

  // Drill-down data + definitions (collapsed section) and guaranteed follow-ups
  if (!askedUser && results.size) {
    try { const d = await buildDetails([...results.values()]); if (d) pushBlock(d); } catch (e) { log.warn({ err: (e as Error).message }, 'details failed'); }
  }
  if (!askedUser && !gotFollowups) pushBlock({ id: newId('b'), type: 'followups', questions: fallbackFollowups([...results.values()], domainId) });

  const prior = await db.all<{ payload: string }>(`select payload from results where conversation_id = ?`, [conversationId]);
  const all = [...results.values(), ...prior.map((p) => parseJson<AnyResult>(p.payload)), ...blocks.flatMap((b) => b.drilldowns ?? [])];
  const verification = verifyNarrative(finalText, all);
  emit({ type: 'verification', verification });

  const compactTurn = turn.slice(1).map((m) => {
    if (m.role === 'assistant' && Array.isArray(m.content)) {
      const kept = (m.content as Anthropic.ContentBlockParam[]).filter((c) => c.type !== 'thinking' && c.type !== 'redacted_thinking');
      return { ...m, content: kept.length ? kept : [{ type: 'text' as const, text: '…' }] };
    }
    if (m.role !== 'user' || typeof m.content === 'string') return m;
    return { ...m, content: (m.content as Anthropic.ToolResultBlockParam[]).map((c) => ({ ...c, content: typeof c.content === 'string' && c.content.length > 3500 ? c.content.slice(0, 3500) + '…(truncated)' : c.content })) };
  });
  // the stored assistant turn must end on an assistant message for valid replay
  if (compactTurn.length && compactTurn[compactTurn.length - 1].role === 'user') compactTurn.push({ role: 'assistant', content: finalText || (askedUser ? 'I asked a clarifying question.' : 'Done.') });
  const messageId = newId('m');
  const storeBlock = (b: Block) => ({ ...b, result: undefined, resultId: b.result?.id, drilldowns: undefined, drilldownIds: b.drilldowns?.map((d) => d.id) });
  await db.all(`insert into messages(id, conversation_id, role, display, llm) values (?, ?, 'assistant', ?, ?)`, [
    messageId, conversationId,
    JSON.stringify({ plan: plan ?? undefined, text: finalText, thinking: thinkingText.slice(0, 20000) || undefined, blocks: blocks.map(storeBlock), steps, verification, ms: Date.now() - t0, model: model.label, tier: modelTiers[0], tierReason: reason }),
    JSON.stringify(compactTurn),
  ]);
  for (const b of blocks) for (const d of b.drilldowns ?? []) await saveResult(conversationId, d);
  await db.all(`update conversations set updated_at = now() where id = ?`, [conversationId]);
  await audit(userId, 'answer', { conversationId, messageId, model: model.id, steps: steps.length, ms: Date.now() - t0, unverified: verification.unmatched.length });
  emit({ type: 'done', messageId, conversationId, title });
}

async function buildBlocks(input: Record<string, unknown>, results: Map<string, AnyResult>) {
  const out: Block[] = []; const errors: string[] = [];
  for (const raw of (input.blocks as Record<string, unknown>[]) ?? []) {
    const b = raw as unknown as Block & { result_id?: string };
    const block: Block = { id: newId('b'), type: b.type, title: b.title, chart: b.chart, x: b.x, y: b.y, series_by: b.series_by, metrics: b.metrics, columns: b.columns, pivot: b.pivot, items: b.items, view: b.view, group_by: b.group_by };
    if (b.type !== 'insights') {
      const r = b.result_id ? results.get(b.result_id) ?? (await getResult(b.result_id)) : null;
      if (!r) { errors.push(`${b.type}: unknown result_id ${b.result_id}`); continue; }
      const keys = new Set(r.columns.map((c: { key: string }) => c.key));
      const missing = [b.x, ...(b.y ?? []), b.series_by, b.group_by, ...(b.columns ?? [])].filter((k) => k && !keys.has(k) && !String(k).endsWith('__prev') && !String(k).endsWith('__chg'));
      if (missing.length) { errors.push(`${b.type}: unknown column(s) ${missing.join(', ')} in ${r.id}`); continue; }
      block.result = r;
      block.title = block.title ?? r.title;
    } else if (!b.items?.length) { errors.push('insights block without items'); continue; }
    out.push(block);
  }
  return { blocks: out, errors };
}


/** Definitions, sources and methodology (collapsed section). Item-level drill-through lives on each cell. */
async function buildDetails(results: AnyResult[]): Promise<Block | null> {
  const defs = new Map<string, { metric: string; label: string; description: string; caveat?: string }>();
  const sources = new Set<string>(); const notes = new Set<string>();
  for (const r of results) {
    r.definitions.forEach((d) => defs.set(d.metric, d));
    r.sources.forEach((s) => sources.add(s));
    r.notes.slice(0, 4).forEach((n) => notes.add(n));
  }
  if (!defs.size && !sources.size) return null;
  return { id: newId('b'), type: 'details', title: 'Metric definitions, sources & methodology', definitions: [...defs.values()], sources: [...sources], notes: [...notes] };
}

function fallbackFollowups(results: AnyResult[], domain?: string): string[] {
  const q = results.find((r) => r.kind === 'metrics') as QueryResult | undefined;
  const label = q ? metricById.get(q.spec.metrics[0])?.label?.toLowerCase() ?? 'this' : 'this';
  const out = [
    q && !q.spec.dimensions.includes('location') ? `Break ${label} down by location` : `Which location has the biggest opportunity to improve ${label}?`,
    q && q.spec.grain !== 'month' ? `Show ${label} month-on-month for the last 14 months with last year alongside` : `What is driving the change in ${label}?`,
    `Forecast ${label} for the next 3 months`,
  ];
  if (domain === 'renewals') out[2] = 'Which members are up for renewal in the next 30 days?';
  return out;
}

export async function hydrateMessage(display: { blocks?: (Block & { resultId?: string; drilldownIds?: string[] })[] }) {
  if (!display.blocks) return display;
  for (const b of display.blocks) {
    if (b.resultId && !b.result) b.result = await getResult(b.resultId);
    if (b.drilldownIds && !b.drilldowns) b.drilldowns = (await Promise.all(b.drilldownIds.map((id) => getResult(id)))).filter(Boolean);
  }
  return display;
}
