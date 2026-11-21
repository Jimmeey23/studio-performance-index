/**
 * Model ids, availability and thinking settings — shared by the analyst, report commentary and topic planner.
 *
 * • Each tier has a list of candidate ids (the .env value first, then current models). A model the key
 *   can't use (404) is skipped for the rest of the run, so a retired id never breaks the app.
 * • Newer models think adaptively (`thinking: adaptive` + an effort level); older ones take a token
 *   budget. A model that rejects one style is remembered and switched to the other automatically.
 */
import type Anthropic from '@anthropic-ai/sdk';
import type { Tier } from './router.js';

const env = (k: string, d: string) => process.env[k] || d;
const DEFAULTS: Record<Tier, string[]> = {
  fast: ['claude-haiku-5-5', 'claude-haiku-4-5'],
  balanced: ['claude-sonnet-5-5', 'claude-sonnet-5', 'claude-sonnet-4-6', 'claude-sonnet-4-5'],
  deep: ['claude-opus-5-5', 'claude-opus-5', 'claude-opus-4-8', 'claude-opus-4-6', 'claude-opus-4-5'],
};
const ENV_KEY: Record<Tier, string> = { fast: 'ANTHROPIC_MODEL_FAST', balanced: 'ANTHROPIC_MODEL_BALANCED', deep: 'ANTHROPIC_MODEL_DEEP' };
const LABEL: Record<Tier, string> = { fast: 'Haiku', balanced: 'Sonnet', deep: 'Opus' };

/** Ids being retired — used only if nothing newer is available, even when set in .env. */
const RETIRING = /^claude-(sonnet-4-5|opus-4-5|opus-4-1|sonnet-4|opus-4)(-\d{8})?$/;
const missing = new Set<string>();
const candidates = (t: Tier) => {
  const all = [...new Set([...env(ENV_KEY[t], '').split(',').map((x) => x.trim()).filter(Boolean), ...DEFAULTS[t]])];
  return [...all.filter((x) => !RETIRING.test(x)), ...all.filter((x) => RETIRING.test(x))];
};
/** The model id to use for a tier right now (first candidate the key hasn't rejected). */
export const modelFor = (t: Tier) => { const id = candidates(t).find((x) => !missing.has(x)) ?? candidates(t)[0]; return { id, label: LABEL[t] }; };
/** Record a 404; returns true when the same tier still has another candidate to try. */
export function markMissing(id: string, t: Tier) { missing.add(id); return candidates(t).some((x) => !missing.has(x)); }
export const isNotFound = (msg: string) => /not_found_error|\b404\b/.test(msg);

/** Thinking budgets (older models) and effort levels (adaptive models) per tier. */
export const THINK_BUDGET: Record<Tier, number> = {
  fast: Number(env('AI_THINK_FAST', '5000')), balanced: Number(env('AI_THINK_BALANCED', '14000')), deep: Number(env('AI_THINK_DEEP', '28000')),
};
type Effort = 'low' | 'medium' | 'high' | 'xhigh' | 'max';
export const EFFORT: Record<Tier, Effort> = {
  fast: env('AI_EFFORT_FAST', 'medium') as Effort, balanced: env('AI_EFFORT_BALANCED', 'high') as Effort, deep: env('AI_EFFORT_DEEP', 'xhigh') as Effort,
};
export const ANSWER_BUDGET: Record<Tier, number> = { fast: 4096, balanced: 8000, deep: 12000 };

const adaptive = new Set<string>(), budgeted = new Set<string>(), noEffort = new Set<string>(), noThinking = new Set<string>();
/** Generation 4.6+ and 5 models think adaptively (e.g. claude-sonnet-5-5, claude-opus-4-6); 4.5 and older take a budget. */
function looksAdaptive(id: string) {
  const m = id.replace(/-\d{8}$/, '').match(/^claude-[a-z]+-(\d+)(?:-(\d+))?$/);
  if (!m) return false;
  const major = Number(m[1]), minor = Number(m[2] ?? 0);
  return major >= 5 || (major === 4 && minor >= 6);
}

type ThinkParams = Pick<Anthropic.MessageCreateParamsNonStreaming, 'thinking' | 'max_tokens'> & { output_config?: { effort: Effort } };
/** Thinking settings for a call; `answer` is the room left for the reply itself. */
export function thinkParams(id: string, t: Tier, answer = ANSWER_BUDGET[t], off = false): ThinkParams {
  if (off || noThinking.has(id)) return { max_tokens: answer };
  if (adaptive.has(id) || (!budgeted.has(id) && looksAdaptive(id))) {
    return { thinking: { type: 'adaptive' }, max_tokens: answer + THINK_BUDGET[t], ...(noEffort.has(id) ? {} : { output_config: { effort: EFFORT[t] } }) };
  }
  return { thinking: { type: 'enabled', budget_tokens: THINK_BUDGET[t] }, max_tokens: answer + THINK_BUDGET[t] };
}
/** Learn from a rejected thinking setting; returns true when a retry with different settings makes sense. */
export function noteThinkingError(id: string, msg: string): boolean {
  if (!/\b400\b|invalid_request/.test(msg)) return false;
  const sentAdaptive = !noThinking.has(id) && (adaptive.has(id) || (!budgeted.has(id) && looksAdaptive(id)));
  if (sentAdaptive && /effort|output_config/i.test(msg) && !noEffort.has(id)) { noEffort.add(id); return true; }
  if (!/thinking|budget_tokens/i.test(msg)) return false;
  if (sentAdaptive && !budgeted.has(id) && !adaptive.has(id)) { budgeted.add(id); return true; }   // guessed adaptive wrongly → token budget
  if (!sentAdaptive && /adaptive/i.test(msg) && !adaptive.has(id)) { adaptive.add(id); budgeted.delete(id); return true; } // "use thinking.type.adaptive"
  if (!noThinking.has(id)) { noThinking.add(id); return true; }                                     // last resort: no thinking
  return false;
}
