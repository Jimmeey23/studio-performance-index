/**
 * Automatic model selection — cheapest model that can do the job.
 *
 *  fast  (Haiku)  — lookups, single-metric questions, table refinements. The default.
 *  balanced (Sonnet) — normal analysis: comparisons, breakdowns, a few metrics, light "why".
 *  deep  (Opus)   — only highly reasoning-heavy, complex work: diagnosis / root cause, forecasting
 *                   and scenarios, strategy and planning, multi-part deep dives across many metrics.
 *
 * A complexity score decides the tier; a cheaper model escalates mid-answer only when it struggles
 * (see `escalate`). Every tier thinks before answering, with a larger budget the higher the tier.
 */
export type Tier = 'fast' | 'balanced' | 'deep';
export type TierChoice = Tier | 'auto';

import { modelFor } from './models.js';
export { THINK_BUDGET, ANSWER_BUDGET } from './models.js';
export const MODELS: Record<Tier, { id: string; label: string }> = {
  get fast() { return modelFor('fast'); },
  get balanced() { return modelFor('balanced'); },
  get deep() { return modelFor('deep'); },
};

/** Strong signals of reasoning-heavy work (3 points each). */
const HEAVY = /\b(root[- ]cause|diagnos\w*|forecast\w*|predict\w*|projection\w*|scenario\w*|what[- ]if|simulat\w*|strateg\w*|plan (for|out)|business plan|budget allocation|reallocat\w*|optimi[sz]\w*|prioriti[sz]\w*|deep[- ]dive|end[- ]to[- ]end|full (analysis|review|audit)|board[- ](pack|report|review)|investment case|turnaround|sensitivity)\b/gi;
/** Diagnostic signals (2 points each, max 4) — need real reasoning, so never Haiku-only. */
const DIAG = /\b(why|drivers?|driving|explain\w*|recommend\w*|cause[sd]?|reasons?|what happened|went wrong)\b/gi;
/** Moderate signals (1 point each, max 3). */
const MEDIUM = /\b(insights?|opportunit\w*|risks?|impact|correlat\w*|compare|comparison|versus|vs\.?|trend\w*|breakdown|segment\w*|cohort\w*|attribution|elasticity|anomal\w*|unusual)\b/gi;
const SIMPLE_START = /^(what (is|was|were|are)|how (many|much)|show|list|total|count|give me|who|which|when)\b/i;
const REFINE = /^(only|just|now|also|and|sort|top|bottom|exclude|include|same|instead|make it|switch|add|remove|by|filter|change|chart|table|as a)\b/i;
const METRIC_WORDS = /\b(revenue|sales|visits?|bookings?|clients?|members?|conversion|retention|renewals?|leads?|fill rate|capacity|churn|lapse\w*|late cancel\w*|atv|transactions?|teachers?|trainers?|classes|cohort|funnel|spend|cpl|discount\w*|ltv|trials?|attendance|units)\b/gi;

export function complexity(question: string, turns = 0) {
  const q = question.trim();
  const heavy = new Set((q.match(HEAVY) ?? []).map((x) => x.toLowerCase())).size;
  const diag = Math.min(2, new Set((q.match(DIAG) ?? []).map((x) => x.toLowerCase())).size);
  const medium = Math.min(3, new Set((q.match(MEDIUM) ?? []).map((x) => x.toLowerCase())).size);
  const metrics = new Set((q.match(METRIC_WORDS) ?? []).map((m) => m.toLowerCase())).size;
  const clauses = (q.match(/,|;| and | then | vs\.? | versus /gi) ?? []).length;
  const questions = (q.match(/\?/g) ?? []).length;
  let score = heavy * 3 + diag * 2 + medium;
  score += metrics >= 6 ? 2 : metrics >= 3 ? 1 : 0;
  score += clauses >= 6 ? 2 : clauses >= 3 ? 1 : 0;
  score += q.length > 450 ? 2 : q.length > 220 ? 1 : 0;
  score += questions >= 3 ? 1 : 0;
  const refine = turns > 0 && q.length < 80 && REFINE.test(q);
  const simple = q.length < 110 && SIMPLE_START.test(q) && heavy === 0 && diag === 0 && metrics <= 2 && clauses <= 1;
  return { score, heavy, diag, medium, metrics, clauses, refine, simple };
}

export function chooseTier(question: string, opts: { choice?: TierChoice; turns?: number } = {}): { tier: Tier; reason: string; score: number } {
  const c = complexity(question, opts.turns ?? 0);
  if (opts.choice && opts.choice !== 'auto') return { tier: opts.choice, reason: 'selected manually', score: c.score };
  if (c.refine) return { tier: 'fast', reason: 'refinement of the previous answer', score: c.score };
  // Opus only for genuinely heavy reasoning: a strong signal plus real breadth, or a very complex multi-part brief
  if ((c.heavy >= 1 && c.score >= 6) || c.score >= 8) return { tier: 'deep', reason: `complex reasoning (score ${c.score}): ${c.heavy ? 'diagnosis / forecast / strategy across several metrics' : 'multi-part brief'}`, score: c.score };
  if (c.simple || c.score <= 1) return { tier: 'fast', reason: c.simple ? 'simple lookup' : `light question (score ${c.score})`, score: c.score };
  return { tier: 'balanced', reason: `standard analysis (score ${c.score})`, score: c.score };
}

/**
 * Mid-answer escalation: a cheaper model that is struggling (many tool rounds or repeated tool errors)
 * hands over to the next tier. Sonnet only escalates to Opus when the question itself was complex.
 */
export function escalate(cur: Tier, s: { iter: number; toolErrors: number; score: number }): Tier | null {
  if (cur === 'fast' && (s.iter >= 5 || s.toolErrors >= 2)) return 'balanced';
  if (cur === 'balanced' && s.score >= 4 && (s.iter >= 9 || s.toolErrors >= 4)) return 'deep';
  return null;
}

/** Cheapest-first fallback when a model is unavailable on the key. */
export const fallbackOrder = (t: Tier): Tier[] => (t === 'deep' ? ['deep', 'balanced', 'fast'] : t === 'balanced' ? ['balanced', 'fast'] : ['fast', 'balanced']);
