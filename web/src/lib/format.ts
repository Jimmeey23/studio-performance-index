import type { Format } from './types';

const inGroup = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 });
const in1 = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 1 });
const in2 = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 2 });

export function compactINR(v: number): string {
  const a = Math.abs(v);
  if (a >= 1e7) return `₹${(v / 1e7).toFixed(a >= 1e9 ? 0 : 2)}Cr`;
  if (a >= 1e5) return `₹${(v / 1e5).toFixed(a >= 1e7 ? 0 : 1)}L`;
  if (a >= 1e3) return `₹${(v / 1e3).toFixed(1)}k`;
  return `₹${inGroup.format(v)}`;
}
export function compactNum(v: number): string {
  const a = Math.abs(v);
  if (a >= 1e7) return `${(v / 1e7).toFixed(1)}Cr`;
  if (a >= 1e5) return `${(v / 1e5).toFixed(1)}L`;
  if (a >= 1e4) return `${(v / 1e3).toFixed(1)}k`;
  return inGroup.format(v);
}

export function fmt(v: unknown, f?: Format, opts: { compact?: boolean } = {}): string {
  if (v === null || v === undefined || v === '') return '—';
  if (f === 'date') return fmtPeriod(String(v));
  if (f === 'text' || typeof v !== 'number' && isNaN(Number(v))) return String(v);
  const n = Number(v);
  if (!isFinite(n)) return '—';
  switch (f) {
    case 'currency': return opts.compact ? compactINR(n) : `₹${inGroup.format(n)}`;
    case 'percent': return `${(n * 100).toFixed(Math.abs(n) < 0.1 ? 1 : 1)}%`;
    case 'decimal': return in2.format(n);
    case 'days': return `${in1.format(n)} d`;
    default: return opts.compact ? compactNum(n) : Number.isInteger(n) ? inGroup.format(n) : in1.format(n);
  }
}

export function fmtChange(v: unknown, isPP = false): string {
  if (v === null || v === undefined) return '—';
  const n = Number(v);
  if (!isFinite(n)) return '—';
  const s = isPP ? `${(n * 100).toFixed(1)} pp` : `${(n * 100).toFixed(1)}%`;
  return n > 0 ? `+${s}` : s;
}

const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
/** 2026-10-01 -> Oct-2026 ; full dates -> 19 Nov 2026 */
export function fmtPeriod(s: string, grain?: string): string {
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return s;
  const [, y, mo, d] = m;
  if (grain === 'day' || grain === 'week' || (d !== '01' && !grain)) return `${Number(d)} ${MON[Number(mo) - 1]} ${y}`;
  if (grain === 'year') return y;
  if (grain === 'quarter') return `Q${Math.floor((Number(mo) - 1) / 3) + 1}-${y}`;
  return `${MON[Number(mo) - 1]}-${y}`;
}
