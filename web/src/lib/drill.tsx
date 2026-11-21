import { createContext, useCallback, useContext, useState, type ReactNode } from 'react';
import type { Result } from './types';
import { fmtPeriod } from './format';
import { useAsk } from './ask';

export interface DrillFilter { dimension: string; op?: 'in' | 'not_in' | 'contains' | 'gte' | 'lte' | 'is_null' | 'not_null'; values: (string | number)[] }
export interface DrillRequest {
  metric: string;
  filters: DrillFilter[];
  start?: string; end?: string;
  include_future?: boolean;
  /** Human labels of the slice, e.g. ["Kenkere House", "Oct-2026"]. */
  context?: string[];
  /** Expected value (what the user clicked) — shown next to the recomputed value. */
  expected?: number | null;
}
interface DrillApi { open: (r: DrillRequest, ask?: ((q: string) => void) | null) => void }
const Ctx = createContext<DrillApi | null>(null);

export function DrillProvider({ children, render }: { children: ReactNode; render: (req: DrillRequest | null, close: () => void, ask: ((q: string) => void) | null) => ReactNode }) {
  const [req, setReq] = useState<DrillRequest | null>(null);
  const [ask, setAsk] = useState<((q: string) => void) | null>(null);
  const open = useCallback((r: DrillRequest, a?: ((q: string) => void) | null) => { setAsk(() => a ?? null); setReq(r); }, []);
  return <Ctx.Provider value={{ open }}>{children}{render(req, () => setReq(null), ask)}</Ctx.Provider>;
}

/** Returns a function that opens the drill panel (or null when unavailable). Captures the chat's ask() when inside a chat. */
export function useDrill() {
  const c = useContext(Ctx);
  const ask = useAsk();
  return c ? (r: DrillRequest) => c.open(r, ask) : null;
}

const iso = (d: Date) => d.toISOString().slice(0, 10);
function periodEnd(start: string, grain: string): string {
  const d = new Date(start.slice(0, 10) + 'T00:00:00Z');
  switch (grain) {
    case 'day': return iso(d);
    case 'week': return iso(new Date(d.getTime() + 6 * 864e5));
    case 'quarter': return iso(new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 3, 0)));
    case 'year': return iso(new Date(Date.UTC(d.getUTCFullYear(), 12, 0)));
    default: return iso(new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)));
  }
}
const shiftYear = (s: string, n: number) => { const d = new Date(s.slice(0, 10) + 'T00:00:00Z'); d.setUTCFullYear(d.getUTCFullYear() + n); return iso(d); };
const clip = (s: string, lo?: string, hi?: string) => (lo && s < lo ? lo : hi && s > hi ? hi : s);

/**
 * Builds the drill request behind one number of a metrics result.
 * row = the clicked row (null for the grand total); key = clicked column (metric, metric__prev).
 * Extra dims (e.g. from grouped rows or pivot cells) can be passed in `slice`.
 */
export function drillFor(result: Result, row: Record<string, unknown> | null, key: string, slice?: Record<string, unknown>): DrillRequest | null {
  if (result.kind !== 'metrics' || !result.spec) return null;
  const spec = result.spec as { metrics?: string[]; dimensions?: string[]; grain?: string; filters?: DrillFilter[]; compare?: string | null; include_future?: boolean };
  const metric = key.replace(/__(prev|chg)$/, '');
  if (key.endsWith('__chg') || !spec.metrics?.includes(metric)) return null;
  const prev = key.endsWith('__prev');
  if (prev && spec.compare !== 'previous_year' && row?.period) return null;
  const vals: Record<string, unknown> = { ...(row ?? {}), ...(slice ?? {}) };
  const dims = (spec.dimensions ?? []).filter((d) => d in vals && vals[d] !== undefined);
  const filters: DrillFilter[] = (spec.filters ?? []).filter((f) => !dims.includes(f.dimension));
  const context: string[] = [];
  for (const d of dims) { const v = vals[d] === null || vals[d] === '' ? '(blank)' : String(vals[d]); filters.push({ dimension: d, op: 'in', values: [v] }); context.push(v); }
  let start = prev ? result.period?.comparisonStart : result.period?.start;
  let end = prev ? result.period?.comparisonEnd : result.period?.end;
  const grain = spec.grain ?? 'all';
  let p = vals.period as string | undefined;
  // derived period groupings (year / quarter) from grouped tables
  let g = grain;
  if (!p && typeof vals.__quarter === 'string') { const m = vals.__quarter.match(/^(\d{4})-Q(\d)$/); if (m) { p = `${m[1]}-${String((Number(m[2]) - 1) * 3 + 1).padStart(2, '0')}-01`; g = 'quarter'; } }
  if (!p && vals.__year !== undefined && vals.__year !== null) { p = `${vals.__year}-01-01`; g = 'year'; }
  if (p) {
    let s = String(p).slice(0, 10), e = periodEnd(s, g);
    if (prev) { s = shiftYear(s, -1); e = shiftYear(e, -1); }
    s = clip(s, start, end); e = clip(e, start, end);
    start = s; end = e;
    context.push(fmtPeriod(String(p).slice(0, 10), g === 'all' ? 'month' : g));
  } else if (start && end) context.push(`${fmtPeriod(start, 'day')} – ${fmtPeriod(end, 'day')}`);
  if (prev) context.push('last year');
  const expected = row ? Number(row[key]) : slice ? null : result.totals ? Number(result.totals[key]) : null;
  return { metric, filters, start, end, include_future: spec.include_future, context, expected: isFinite(expected as number) ? expected : null };
}
