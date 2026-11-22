/**
 * Who may use the app: an official email whose first name and domain are on the lists below.
 * Accounts are provisioned on first sign-in with the team password from TEAM_PASSWORD (never committed).
 */
export const ALLOWED_NAMES = ['jimmeey', 'mallika', 'mitali', 'saachi', 'anisha', 'mrigakshi', 'vivaran', 'pushyank', 'shifa'] as const;
export const ALLOWED_DOMAINS = ['physique57india.com', 'physique57mumbai.com', 'physique57bengaluru.com'] as const;
export const ADMIN_NAMES = new Set(['jimmeey']);

export function allowedEmail(raw: unknown): { email: string; first: string } | null {
  const email = String(raw ?? '').trim().toLowerCase();
  const m = /^([a-z]+)@([a-z0-9.-]+)$/.exec(email);
  if (!m) return null;
  if (!(ALLOWED_NAMES as readonly string[]).includes(m[1]) || !(ALLOWED_DOMAINS as readonly string[]).includes(m[2])) return null;
  return { email, first: m[1] };
}

/** Sliding-window limiter for sign-in attempts (per IP and per email). */
const hits = new Map<string, number[]>();
export function tooManyAttempts(key: string, max = 8, windowMs = 15 * 60_000): boolean {
  const now = Date.now();
  const list = (hits.get(key) ?? []).filter((t) => now - t < windowMs);
  list.push(now); hits.set(key, list);
  if (hits.size > 5000) for (const [k, v] of hits) if (!v.some((t) => now - t < windowMs)) hits.delete(k);
  return list.length > max;
}
export const clearAttempts = (key: string) => hits.delete(key);
