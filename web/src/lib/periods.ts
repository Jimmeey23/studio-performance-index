/** Shared period presets for report builders. */
export const iso = (d: Date) => d.toISOString().slice(0, 10);
export const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export function range(id: string, month?: string): { start: string; end: string } {
  const n = new Date(); const y = n.getFullYear(), m = n.getMonth();
  const mEnd = (yy: number, mm: number) => iso(new Date(Date.UTC(yy, mm + 1, 0)));
  switch (id) {
    case 'month': { const [yy, mm] = (month ?? '').split('-').map(Number); return { start: `${yy}-${String(mm).padStart(2, '0')}-01`, end: mEnd(yy, mm - 1) }; }
    case 'l3': return { start: iso(new Date(Date.UTC(y, m - 3, 1))), end: mEnd(y, m - 1) };
    case 'lq': { const q = Math.floor(m / 3); return { start: iso(new Date(Date.UTC(y, (q - 1) * 3, 1))), end: mEnd(y, q * 3 - 1) }; }
    case 'l6': return { start: iso(new Date(Date.UTC(y, m - 6, 1))), end: mEnd(y, m - 1) };
    case 'ytd': return { start: `${y}-01-01`, end: mEnd(y, m - 1) };
    case 'fy': { const fy = m >= 3 ? y : y - 1; return { start: `${fy}-04-01`, end: mEnd(y, m - 1) }; }
    case 'mtd': return { start: iso(new Date(Date.UTC(y, m, 1))), end: iso(new Date(Date.UTC(y, m, n.getDate()))) };
    default: return { start: iso(new Date(Date.UTC(y, m - 1, 1))), end: mEnd(y, m - 1) };
  }
}
export const PRESETS = [['lm', 'Last month'], ['month', 'Pick a month'], ['lq', 'Last quarter'], ['l3', 'Last 3 months'], ['l6', 'Last 6 months'], ['ytd', 'Year to date'], ['fy', 'FY to date'], ['mtd', 'Month to date'], ['custom', 'Custom range']] as const;


/** "Oct-2026" for whole single months, otherwise "start → end". */
export function periodLabelOf(period: { start: string; end: string }) {
  const s = new Date(period.start + 'T00:00:00Z'), e = new Date(period.end + 'T00:00:00Z');
  return s.getUTCMonth() === e.getUTCMonth() && s.getUTCFullYear() === e.getUTCFullYear() && s.getUTCDate() === 1 ? `${MON[s.getUTCMonth()]}-${s.getUTCFullYear()}` : `${period.start} → ${period.end}`;
}
export const lastMonthValue = () => { const now = new Date(); return `${now.getMonth() === 0 ? now.getFullYear() - 1 : now.getFullYear()}-${String(now.getMonth() === 0 ? 12 : now.getMonth()).padStart(2, '0')}`; };
