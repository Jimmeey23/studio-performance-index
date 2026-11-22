/** The only owner roles a review may assign actions to (Physique 57 org). Keep in sync with server/src/report/roles.ts. */
export const ROLES = ["Head of S&CS", "Team Leader CS", "CST's", 'Trainer', 'Head Trainer', 'Master Trainer', 'ASST OPS MANAGER', 'REGIONAL OPS MANAGER', 'MARKETING LEAD', 'MARKETING EXECUTIVE', 'OPS HEAD', 'COO', 'MD'] as const;
export type Role = typeof ROLES[number];
const RULES: [RegExp, Role][] = [
  [/managing director|\bmd\b|founder|\bceo\b|director/i, 'MD'],
  [/\bcoo\b|chief operating|finance|\bcfo\b|account/i, 'COO'],
  [/regional/i, 'REGIONAL OPS MANAGER'],
  [/asst|assistant|studio (manager|lead)|ops manager|operations manager|centre manager|center manager/i, 'ASST OPS MANAGER'],
  [/ops head|head of op|operations head|operations|\bops\b|scheduling|roster/i, 'OPS HEAD'],
  [/marketing exec|social|content|digital exec|designer/i, 'MARKETING EXECUTIVE'],
  [/marketing|brand|growth|ads?\b|campaign|performance market/i, 'MARKETING LEAD'],
  [/master trainer/i, 'Master Trainer'],
  [/head trainer|head coach|training lead|programming|head of training/i, 'Head Trainer'],
  [/trainer|instructor|coach|teacher|faculty/i, 'Trainer'],
  [/team lead|\btl\b|cs lead|client service(s)? lead|supervisor/i, 'Team Leader CS'],
  [/head of s|s&cs|sales (head|lead|director|manager)|head of sales|client success/i, 'Head of S&CS'],
  [/cst|client service|customer service|front desk|associate|sales|crm|retention|membership|\bcs\b/i, "CST's"],
];
/** Maps any owner text onto the allowed roles (exact match first, then keywords; defaults to OPS HEAD). */
export function normaliseOwner(owner: string | undefined | null): Role {
  const o = String(owner ?? '').trim();
  const exact = ROLES.find((r) => r.toLowerCase() === o.toLowerCase()); if (exact) return exact;
  return RULES.find(([re]) => re.test(o))?.[1] ?? 'OPS HEAD';
}
