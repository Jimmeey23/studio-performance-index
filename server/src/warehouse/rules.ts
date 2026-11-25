import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from '../config.js';

export interface BusinessRules {
  hosts: Record<string, { brand: string; city: string }>;
  locations: { match: string[]; location: string; city: string | null; type: string; short: string }[];
  revenue: { default_basis: 'gross' | 'net'; valid_payment_statuses: string[]; exclude_voided: boolean };
  status_values: {
    new_client_excluded_conversion_status: string[];
    converted_values: string[];
    retained_values: string[];
    trial_completed_patterns: string[];
    trial_scheduled_patterns: string[];
    lead_converted_values: string[];
    new_client_is_new_contains?: string;
    trial_not_attended_values?: string[];
  };
  renewal: { window_after_days: number; grace_days?: number; renewal_categories: string[]; include_membership_patterns: string[]; exclude_membership_patterns: string[]; exclude_zero_value?: boolean; exclude_memberships_exact?: string[] };
  winback: { inactive_days: number };
  churn: { inactive_days: number };
  reporting: { default_trailing_months: number; exclude_incomplete_current_month_from_trends: boolean; week_start: string; location_groups?: Record<string, string[]> };
  leads?: LeadRules;
}
export interface LeadRules {
  qualified_statuses: string[]; qualified_definition: string;
  disqualified_statuses: string[]; disqualified_definition: string;
  lost_statuses: string[]; lost_definition: string;
  unresponsive_statuses: string[]; unresponsive_definition: string;
  channels: { channel: string; sources: string[]; patterns: string[] }[];
  channel_fallback: string;
}

const file = path.join(ROOT, 'config', 'business-rules.json');
export function loadRules(): BusinessRules {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}
export function saveRules(r: BusinessRules) {
  fs.writeFileSync(file, JSON.stringify(r, null, 2));
}

/** Days after a membership's end date during which an unrenewed member is in grace (not yet lapsed). */
export const graceDays = (): number => Math.max(0, Math.round(Number(loadRules().renewal.grace_days ?? 30)));

const norm = (sql: string) => `regexp_replace(lower(trim(${sql})), '\\s+', ' ', 'g')`;
/**
 * SQL predicate for memberships in scope of lapsed / renewal / churn analysis:
 * non-zero value and not in the exact-name exclusion list (non-recurring, complimentary, sign-up links…).
 * `col` = membership name column, `amount` = amount-paid column (both may be alias-qualified).
 */
export function membershipScopeSql(col = 'membership', amount = 'amount_paid'): string {
  const r = loadRules().renewal;
  const parts: string[] = [];
  if (r.exclude_zero_value !== false) parts.push(`coalesce(${amount}, 0) > 0`);
  const names = (r.exclude_memberships_exact ?? []).map((n) => n.trim().toLowerCase().replace(/\s+/g, ' ')).filter(Boolean);
  if (names.length) parts.push(`coalesce(${norm(col)}, '') not in (${names.map((n) => `'${n.replace(/'/g, "''")}'`).join(', ')})`);
  return parts.length ? parts.join(' and ') : 'true';
}
export function membershipScopeLabel(): string {
  const r = loadRules().renewal;
  const n = r.exclude_memberships_exact?.length ?? 0;
  return [r.exclude_zero_value !== false ? 'zero-value memberships excluded' : '', n ? `${n} non-recurring / complimentary memberships excluded by exact name` : ''].filter(Boolean).join('; ') || 'all memberships';
}

/* ── leads: governed status definitions and source → channel grouping ── */
const DEFAULT_LEADS: LeadRules = {
  qualified_statuses: ['Trial Scheduled', 'Trial Completed', 'Won'], qualified_definition: 'Trial scheduled or completed, or bought.',
  disqualified_statuses: ['Disqualified'], disqualified_definition: 'CRM status Disqualified.',
  lost_statuses: ['Lost'], lost_definition: 'CRM status Lost.', unresponsive_statuses: ['Unresponsive'], unresponsive_definition: 'CRM status Unresponsive.',
  channels: [], channel_fallback: 'Other',
};
export const leadRules = (): LeadRules => ({ ...DEFAULT_LEADS, ...(loadRules().leads ?? {}) });
const q = (v: string) => `'${v.replace(/'/g, "''")}'`;
const inList = (col: string, vals: string[]) => (vals.length ? `coalesce(${col}, '') in (${vals.map(q).join(', ')})` : 'false');
/** SQL predicates for lead outcomes (status column `status`, flags is_trial_completed / is_converted). */
export function leadStatusSql(kind: 'qualified' | 'disqualified' | 'lost' | 'unresponsive'): string {
  const r = leadRules();
  if (kind === 'qualified') return `(${inList('status', r.qualified_statuses)} or coalesce(is_trial_completed, false) or coalesce(is_converted, false))`;
  return inList('status', kind === 'disqualified' ? r.disqualified_statuses : kind === 'lost' ? r.lost_statuses : r.unresponsive_statuses);
}
/** Channel for a lead source, from the governed mapping (exact names, then patterns, then fallback). */
export function leadChannelSql(col = 'source'): string {
  const r = leadRules();
  if (!r.channels.length) return 'channel';
  const n = `lower(trim(coalesce(${col}, '')))`;
  const exact = r.channels.flatMap((c) => c.sources.map((s) => `when ${n} = ${q(s.toLowerCase())} then ${q(c.channel)}`));
  const pat = r.channels.flatMap((c) => c.patterns.map((p) => `when regexp_matches(${n}, ${q(p)}) then ${q(c.channel)}`));
  return `case when ${n} = '' then '(blank)' ${exact.join(' ')} ${pat.join(' ')} else ${q(r.channel_fallback)} end`;
}
