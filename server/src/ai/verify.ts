/**
 * Narrative number verification: every figure the assistant writes must be
 * traceable to a computed result from this conversation. Unmatched figures
 * are reported to the UI so nothing unverified is presented as fact.
 */
import type { AnyResult } from '../analytics/analyses.js';

function collectNumbers(results: AnyResult[]): number[] {
  const out: number[] = [];
  const visit = (v: unknown) => {
    if (typeof v === 'number' && isFinite(v)) out.push(v);
    else if (typeof v === 'string' && /^-?\d+(\.\d+)?$/.test(v)) out.push(Number(v));
    else if (Array.isArray(v)) v.forEach(visit);
    else if (v && typeof v === 'object') Object.values(v).forEach(visit);
  };
  for (const r of results) { visit(r.rows); visit((r as { totals?: unknown }).totals); visit((r as { extra?: unknown }).extra); }
  return out;
}

export interface Verification { checked: number; unmatched: string[] }

export function verifyNarrative(text: string, results: AnyResult[]): Verification {
  const nums = collectNumbers(results);
  const candidates = new Set<number>();
  for (const n of nums) { candidates.add(n); candidates.add(Math.abs(n)); candidates.add(n * 100); candidates.add(Math.abs(n * 100)); }
  const pool = [...candidates];
  const clean = text.replace(/\[[^\]]*\]\([^)]*\)/g, '').replace(/`[^`]*`/g, '');
  const re = /(₹\s?)?(-?\d{1,3}(?:,\d{2,3})+(?:\.\d+)?|-?\d+(?:\.\d+)?)\s?(%|pp|L\b|lakh|lakhs|Cr\b|cr\b|crore|crores|k\b|K\b|M\b)?/g;
  let m: RegExpExecArray | null;
  const unmatched: string[] = [];
  let checked = 0;
  while ((m = re.exec(clean))) {
    const raw = m[0].trim();
    let v = Number(m[2].replace(/,/g, ''));
    const unit = (m[3] ?? '').toLowerCase();
    const prev = clean.slice(Math.max(0, m.index - 12), m.index);
    // skip years, dates, small ordinals, list markers, M0/M1 labels, times
    if (!m[1] && !unit && Number.isInteger(v) && v >= 1990 && v <= 2100) continue;
    if (!m[1] && !unit && Math.abs(v) <= 31 && Number.isInteger(v)) continue;
    if (/[A-Za-z]$/.test(prev) || /:\s?$/.test(prev) && v < 60) continue;
    if (/^\d{4}-\d{2}/.test(clean.slice(m.index, m.index + 7))) continue;
    if (unit === 'l' || unit.startsWith('lakh')) v *= 1e5;
    if (unit === 'cr' || unit.startsWith('crore')) v *= 1e7;
    if (unit === 'k') v *= 1e3;
    if (unit === 'm') v *= 1e6;
    checked++;
    const isPct = unit === '%' || unit === 'pp';
    const ok = pool.some((p) => {
      if (isPct) return Math.abs(p - v) <= 0.15 || Math.abs(p - v) <= Math.abs(v) * 0.01;
      const tol = unit === 'l' || unit.startsWith('lakh') ? 0.05e5 + Math.abs(p) * 0.006 : unit === 'cr' || unit.startsWith('crore') ? 0.05e7 + Math.abs(p) * 0.006 : unit === 'k' ? 50 + Math.abs(p) * 0.006 : Math.max(0.51, Math.abs(p) * 0.006);
      return Math.abs(p - v) <= tol;
    });
    if (!ok) unmatched.push(raw);
  }
  return { checked, unmatched: [...new Set(unmatched)] };
}
