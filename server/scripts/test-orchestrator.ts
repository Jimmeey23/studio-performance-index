/**
 * Integration test of the AI orchestration loop with a SCRIPTED model (no API
 * key needed). Verifies: tool execution, result storage, render validation,
 * block hydration, narrative verification (pass + deliberate fail), and
 * conversation persistence/history.
 */
import type Anthropic from '@anthropic-ai/sdk';
import { answer, type Llm, type StreamEvent } from '../src/ai/orchestrator.js';
import { appDb } from '../src/store/app.js';

type Script = (msgs: Anthropic.MessageParam[]) => Anthropic.ContentBlock[];
let thinkingSeen: unknown[] = [];
function scripted(steps: Script[], rejectThinkingOnce = false): Llm {
  let i = 0; let rejected = false;
  return {
    async create(params, onText) {
      thinkingSeen.push(params.thinking ?? null);
      if (rejectThinkingOnce && !rejected && params.thinking?.type === 'enabled') { rejected = true; throw new Error('400 {"type":"error","error":{"type":"invalid_request_error","message":"thinking.type.enabled is not supported for this model"}}'); }
      const content = steps[Math.min(i++, steps.length - 1)](params.messages);
      for (const c of content) if (c.type === 'text') onText(c.text);
      return { id: 'm', type: 'message', role: 'assistant', model: 'scripted', content, stop_reason: content.some((c) => c.type === 'tool_use') ? 'tool_use' : 'end_turn', stop_sequence: null, usage: { input_tokens: 0, output_tokens: 0 } } as unknown as Anthropic.Message;
    },
  };
}
const tu = (id: string, name: string, input: unknown) => ({ type: 'tool_use', id, name, input } as Anthropic.ToolUseBlock);
const txt = (text: string) => ({ type: 'text', text, citations: null } as Anthropic.TextBlock);
const lastResults = (msgs: Anthropic.MessageParam[]) => {
  const last = msgs[msgs.length - 1];
  return (last.content as Anthropic.ToolResultBlockParam[]).map((c) => { try { return JSON.parse(String(c.content)); } catch { return { error: c.content }; } });
};
const inr = (n: number) => '₹' + (n / 1e5).toFixed(1) + 'L';
const pct = (n: number) => (n * 100).toFixed(1) + '%';

const studios = { dimension: 'location', op: 'in', values: ['Kwality House, Kemps Corner', 'Supreme HQ, Bandra', 'Kenkere House'] };
let R: Record<string, any> = {};
const llm = scripted([
  () => [txt('Let me pull the numbers.'),
    tu('t1', 'query_metrics', { metrics: ['revenue', 'paying_clients', 'atv'], dimensions: ['location'], start: '2026-05-01', end: '2026-10-31', compare: 'previous_year', filters: [studios], title: 'Revenue by studio, May–Oct 2026 vs last year' }),
    tu('t2', 'query_metrics', { metrics: ['revenue'], dimensions: ['location'], grain: 'month', start: '2026-05-01', end: '2026-10-31', filters: [studios], title: 'Monthly revenue by studio' }),
    tu('t3', 'forecast', { metric: 'revenue', horizon: 2, split_by: 'location', filters: [studios] }),
    tu('t4', 'target_vs_actual', { metric: 'revenue', start: '2026-05-01', end: '2026-10-31' }),
    tu('t5', 'query_metrics', { metrics: ['revenue'], dimensions: ['teacher'] }), // deliberate error: revenue has no teacher dimension
  ],
  (msgs) => {
    const [a, b, c] = lastResults(msgs);
    R = { a, b, c };
    return [tu('t6', 'render', { blocks: [
      { type: 'kpis', result_id: a.result_id, metrics: ['revenue', 'paying_clients', 'atv'] },
      { type: 'table', result_id: a.result_id, title: 'Studio comparison' },
      { type: 'chart', result_id: b.result_id, chart: 'line', x: 'period', y: ['revenue'], series_by: 'location' },
      { type: 'forecast_chart', result_id: c.result_id },
      { type: 'chart', result_id: 'r_doesnotexist', chart: 'bar' },
      { type: 'insights', items: [{ kind: 'observation', title: 'All three studios grew', detail: 'See table.', priority: 'medium' }] },
    ] })];
  },
  () => {
    const t = R.a.totals; const rows = R.a.rows;
    const top = rows[0];
    return [txt(`**Revenue for May–Oct 2026 across the three studios was ${inr(t.revenue)}, ${pct(t.revenue__chg)} above the same period last year.** ${top.location} led with ${inr(top.revenue)}. No targets are loaded, so target achievement can't be shown. A made-up figure for testing: ₹9,99,99,999.`),
      tu('t7', 'suggest_followups', { questions: ['Break revenue down by category for each studio', 'Show month-on-month revenue for the last 14 months', 'Which studio has the biggest growth opportunity?'] })];
  },
], true);

const events: StreamEvent[] = [];
const db = await appDb();
const u = await db.one<{ id: string }>(`select id from users limit 1`);
await answer({ userId: u!.id, question: 'Compare revenue performance across all locations for the last six months, including growth, average revenue, target achievement, and forecast for next month.', emit: (e) => events.push(e), llm });

const steps = events.filter((e) => e.type === 'step' && e.status !== 'running');
const blocks = events.filter((e) => e.type === 'block');
const ver = events.find((e) => e.type === 'verification') as Extract<StreamEvent, { type: 'verification' }>;
const done = events.find((e) => e.type === 'done') as Extract<StreamEvent, { type: 'done' }>;
const assert = (cond: unknown, msg: string) => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${msg}`); if (!cond) process.exitCode = 1; };
assert(steps.filter((s: any) => s.status === 'done').length === 5, `5 tool steps succeeded (got ${steps.filter((s: any) => s.status === 'done').length})`);
assert(steps.some((s: any) => s.status === 'error' && /no "teacher" dimension/.test(s.detail)), 'invalid dimension rejected with explanation');
const types = blocks.map((b: any) => b.block.type);
assert(types.filter((t: string) => !['details', 'followups'].includes(t)).length === 5, `5 valid blocks rendered, bad result_id rejected (got ${types.join(',')})`);
assert(blocks.every((b: any) => ['insights', 'details', 'followups'].includes(b.block.type) || b.block.result?.rows?.length), 'blocks carry server-attached data');
const det: any = blocks.find((b: any) => b.block.type === 'details');
assert(JSON.stringify(thinkingSeen[0]).includes('adaptive'), `adaptive thinking requested for a current model (${JSON.stringify(thinkingSeen.slice(0, 1))})`);
{
  const M = await import('../src/ai/models.js');
  const p0 = M.thinkParams('claude-haiku-4-5', 'fast');
  const r1 = M.noteThinkingError('claude-haiku-4-5', '400 invalid_request_error "thinking.type.enabled" is not supported for this model. Use "thinking.type.adaptive"');
  const p1 = M.thinkParams('claude-haiku-4-5', 'fast');
  assert(p0.thinking?.type === 'enabled' && r1 && p1.thinking?.type === 'adaptive' && p1.output_config?.effort === 'medium', 'older-style model switches to adaptive thinking (with effort) when told to');
  const r2 = M.noteThinkingError('claude-sonnet-5-5', '400 invalid_request_error output_config.effort: unknown field');
  assert(r2 && !M.thinkParams('claude-sonnet-5-5', 'balanced').output_config, 'effort dropped when a model rejects it');
  M.markMissing('claude-sonnet-5-5', 'balanced');
  assert(M.modelFor('balanced').id === 'claude-sonnet-5', 'unavailable model skipped for the next candidate');
}
{ const db0 = await appDb(); const last = await db0.one<{ llm: string }>(`select llm from messages where role = 'assistant' order by created_at desc limit 1`, []); assert(!!last && !last.llm.includes('"thinking"'), 'stored history has no thinking blocks'); }
assert(det && !det.block.drilldowns && det.block.definitions.length >= 3, `details block has definitions (${det?.block.definitions.length}) and no inline drill-downs`);
const fu: any = blocks.find((b: any) => b.block.type === 'followups');
assert(fu && fu.block.questions.length === 3, '3 follow-up questions');
const meta: any = events.find((e) => e.type === 'meta');
assert(meta?.tier === 'balanced', `router keeps a standard forecast/comparison question off Opus (${meta?.tier}: ${meta?.reason})`);
const textEvents = events.filter((e) => e.type === 'text').map((e: any) => e.delta).join('');
assert(textEvents.includes('Revenue for May'), 'narrative streamed alongside the terminal tool call');
assert(ver && ver.verification.unmatched.length === 1 && ver.verification.unmatched[0].includes('9,99,99,999'), `narrative verification flags only the made-up figure (${JSON.stringify(ver?.verification)})`);
assert(!!done?.conversationId, 'conversation persisted');

// follow-up turn: history must include the previous tool calls
let sawHistory = false;
const ev2: StreamEvent[] = [];
const llm2 = scripted([(msgs) => { sawHistory = JSON.stringify(msgs).includes('Revenue by studio, May–Oct 2026'); return [tu('q1', 'ask_user', { question: 'Which revenue basis should I use?', options: ['Gross (incl. GST)', 'Net of GST'] })]; }]);
await answer({ conversationId: done.conversationId, userId: u!.id, question: 'Only show the top two.', emit: (e) => ev2.push(e), llm: llm2 });
assert(sawHistory, 'follow-up turn receives prior analysis context');
const cl: any = ev2.find((e: any) => e.type === 'block' && e.block.type === 'clarify');
assert(cl?.block.options.length === 2, 'clarifying question emitted with clickable options');
assert((ev2.find((e: any) => e.type === 'meta') as any)?.tier === 'fast', 'refinement routed to fast tier');
let replayOk = true;
const llm3 = scripted([(msgs) => { for (let i = 1; i < msgs.length; i++) if (msgs[i].role === msgs[i - 1].role && typeof msgs[i].content === 'string') replayOk = false; return [txt('Using gross.'), tu('f', 'suggest_followups', { questions: ['a', 'b', 'c'] })]; }]);
await answer({ conversationId: done.conversationId, userId: u!.id, question: 'Gross (incl. GST)', emit: () => {}, llm: llm3, controls: { locations: ['Supreme HQ, Bandra'], tier: 'balanced' } });
assert(replayOk, 'stored history replays as valid alternating turns');
const msgs = await db.all(`select role from messages where conversation_id = ?`, [done.conversationId]);
assert(msgs.length === 6, `6 messages stored (got ${msgs.length})`);
console.log('conversation', done.conversationId);
/* multi-step: plan → drivers + brand knowledge + remember → plan updates → answer */
{
  const ev: StreamEvent[] = [];
  const llm2 = scripted([
    () => [tu('p1', 'plan', { goal: 'Why did revenue change in Oct-2026?', steps: [{ id: '1', text: 'Decompose the change' }, { id: '2', text: 'Check brand context' }, { id: '3', text: 'Write up' }] })],
    () => [tu('p2', 'driver_analysis', { metric: 'revenue', start: '2026-10-01', end: '2026-10-31', compare: 'previous_year', dimensions: ['location', 'product_family'] }), tu('p3', 'brand_knowledge', { query: 'cancellation policy late cancel' }), tu('p4', 'remember', { fact: 'Test note: SHQ means Supreme HQ, Bandra', category: 'terminology' })],
    () => [tu('p5', 'plan', { updates: [{ id: '1', status: 'done', note: 'location drove most of it' }, { id: '2', status: 'done' }, { id: '3', status: 'running' }] })],
    () => [txt('Revenue rose mainly at the studios shown in the driver table.'), tu('p6', 'suggest_followups', { questions: ['a', 'b', 'c'] })],
  ]);
  await answer({ userId: u!.id, question: 'Why did revenue change in October vs last year? Diagnose the drivers and recommend a plan.', emit: (e) => ev.push(e), llm: llm2 });
  const plans = ev.filter((e) => e.type === 'plan') as Extract<StreamEvent, { type: 'plan' }>[];
  assert(plans.length === 2 && plans[1].plan.steps[0].status === 'done' && plans[1].plan.steps[0].note, 'plan emitted and updated as a live checklist');
  const st = ev.filter((e) => e.type === 'step' && (e as { status: string }).status === 'done').map((e) => (e as { label: string }).label);
  assert(['Finding the drivers', 'Checking brand knowledge', 'Saving to memory'].every((l) => st.includes(l)), `driver analysis, brand knowledge and remember ran (${st.join(', ')})`);
  const { listNotes, deleteNote, brandContext } = await import('../src/ai/brandBrain.js');
  const n = (await listNotes()).find((x) => x.text.startsWith('Test note'));
  assert(!!n && (await brandContext()).includes('Test note'), 'remembered note saved and fed back into the brand context');
  if (n) await deleteNote(n.id);
}

/* routing & escalation: cheapest model first, Opus only for complex reasoning */
{
  const { chooseTier, escalate } = await import('../src/ai/router.js');
  assert(chooseTier('What was revenue last month?').tier === 'fast', 'simple lookup → Haiku');
  assert(chooseTier('Why did revenue drop in October?').tier === 'balanced', 'why-question → Sonnet');
  assert(chooseTier('Diagnose the root cause of falling conversion at Supreme across leads, trials, trainers and discounting, and recommend a turnaround plan').tier === 'deep', 'complex diagnosis → Opus');
  assert(escalate('fast', { iter: 5, toolErrors: 0, score: 0 }) === 'balanced' && escalate('balanced', { iter: 9, toolErrors: 0, score: 1 }) === null, 'Haiku escalates when struggling; Sonnet stays unless the question is complex');
}
process.exit();
