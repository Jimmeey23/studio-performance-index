import XLSX from 'xlsx';
import { SOURCES, type SourceSpec } from '../sources.js';
import type { TabData } from './sheets.js';

/**
 * Parse an exported workbook (.xlsx) and work out which registered source it
 * is by comparing its worksheet names with each source's tab list.
 */
export function parseWorkbook(buf: Buffer, fileName = ''): { source: SourceSpec; tabs: Map<string, TabData> } {
  const wb = XLSX.read(buf, { type: 'buffer', cellDates: false, dense: true });
  const names = new Set(wb.SheetNames);
  let best: SourceSpec | null = null;
  let bestScore = 0;
  for (const s of SOURCES) {
    const hits = s.tabs.filter((t) => names.has(t.tab)).length;
    const nameBonus = fileName && normalise(fileName).includes(normalise(s.name)) ? 0.5 : 0;
    const score = hits / s.tabs.length + nameBonus + (hits ? 0.01 * s.tabs.length : 0);
    if (hits && score > bestScore) { best = s; bestScore = score; }
  }
  if (!best) throw new Error(`Could not match "${fileName}" to a known source. Sheets found: ${wb.SheetNames.join(', ')}`);
  const tabs = new Map<string, TabData>();
  for (const t of best.tabs) {
    const ws = wb.Sheets[t.tab];
    if (!ws) continue;
    tabs.set(t.tab, sheetToTab(ws));
  }
  return { source: best, tabs };
}

function sheetToTab(ws: XLSX.WorkSheet): TabData {
  const aoa = XLSX.utils.sheet_to_json<string[]>(ws, { header: 1, raw: false, defval: '', blankrows: false });
  const [headerRow = [], ...body] = aoa;
  let width = headerRow.length;
  while (width > 0 && !String(headerRow[width - 1]).trim()) width--;
  const headers = headerRow.slice(0, width).map(String);
  const rows = body
    .map((r) => { const o = r.slice(0, width).map((c) => (c == null ? '' : String(c))); while (o.length < width) o.push(''); return o; })
    .filter((r) => r.some((c) => c.trim() !== ''));
  return { headers, rows };
}

const normalise = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '');
