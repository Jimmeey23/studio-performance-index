import type { Result, Format } from './types';
import { fmt } from './format';

export interface Kpi { id: string; label: string; format: Format; description: string; higherIsBetter?: boolean; additive: boolean;
  value: number | null; prev: number | null; chg: number | null; ytd: number | null; chgYtd: number | null; ly: number | null; chgLy: number | null; series: (number | null)[] }
export interface ReportChart { id: string; title: string; chart: string; seriesBy?: string; y?: string[]; result: Result; wide?: boolean }
export interface ReportTable { id: string; title: string; result: Result; note?: string; style?: 'heat' | 'grouped' }
export interface Visuals {
  funnel?: { label: string; value: number | null }[];
  heatmap?: { rows: string[]; cols: string[]; cells: Record<string, { fill: number | null; classes: number }> };
  formats?: { format: string; kpis: Kpi[] }[];
  spotlight?: { name: string; classes: number; checkins: number; avg: number | null; fill: number | null }[];
  forecasts?: { label: string; metric: string; format: Format; month: string; value: number | null; lo: number | null; hi: number | null; method?: string }[];
  pipeline?: { label: string; value: number | null; format: Format; note: string }[];
  strict?: Record<string, number>;
  trainers?: { teacher: string; rank: number; score: number; tier?: string; converted?: number; excess_converted?: number | null; classes: number; class_average: number | null; fill_rate: number | null; conversion_rate: number | null; new_clients: number; retention_rate: number | null; revenue_share: number | null; class_revenue: number; late_cancel_rate: number | null; strengths: string[]; focus: string[] }[];
}
export interface ReportSection { answer?: { question: string; headline: string; points: string[] }; stats?: { label: string; value: number | null; format: Format; note?: string }[]; observations?: string[]; actions?: string[]; ask?: string; notes?: string[]; definitions?: { term: string; text: string }[]; planSource?: 'ai' | 'rules'; id: string; title: string; kicker: string; icon: string; summary: string; kpis: Kpi[]; charts: ReportChart[]; tables: ReportTable[]; insights: string[]; visuals?: Visuals }
export interface ReportPeriod { start: string; end: string; label: string; days: number; months: number; prevStart?: string; prevEnd?: string; prevLabel: string; lyStart?: string; lyEnd?: string; lyLabel: string; ytdStart?: string; ytdEnd?: string; ytdLabel: string; ytdMonths: number; compareLabel: string; seriesLabels: string[] }
export interface ReportData {
  id: string; generatedAt: string;
  request: { start: string; end: string; locations: string[]; compare: 'previous_period' | 'previous_year'; kind?: 'executive' | 'custom'; topics?: string[]; briefs?: { id?: string; prompt: string }[]; title?: string; audience?: string; depth?: 'summary' | 'standard' | 'detailed' };
  period: ReportPeriod; scope: string; headline: Kpi[]; scorecard: Kpi[]; studios?: ReportTable; sections: ReportSection[];
  glance?: { q: string; a: string; section: string }[]; summaryTables?: ReportTable[];
  appendix: { mom: ReportTable; definitions: { metric: string; label: string; description: string }[] };
  autoInsights: { highlights: string[]; concerns: string[]; recommendations: { title: string; detail: string; priority: string; kpi: string }[] };
}
export interface SectionCommentary { headline: string; narrative: string; findings: string[]; actions: string[] }
export interface Priority { title: string; detail: string; owner: string; timing: string; kpi: string; target: string; priority: 'high' | 'medium' | 'low' }
export interface ReportInsights {
  headline: string; executive_summary: string; at_a_glance: string[]; wins: string[]; watch_outs: string[];
  themes: { title: string; detail: string }[]; sections: Record<string, SectionCommentary>;
  road_ahead: { summary: string; priorities: Priority[]; risks: string[]; opportunities: string[]; targets: { metric: string; target: string; rationale: string }[] };
  recommendations?: { title: string; detail: string; owner: string; priority: 'high' | 'medium' | 'low'; impact?: string }[];
  design?: ReportDesign; spotlights?: Spotlight[];
  model?: string; source: 'ai' | 'rules'; verification?: { checked: number; unmatched: string[] };
}
export interface ReportDesign {
  mood: 'momentum' | 'steady' | 'caution' | 'recovery' | 'turnaround'; accent: string; cover_photo: string; cover_style: 'photo' | 'gradient' | 'light';
  section_order: string[]; condense: string[]; cover_kpis: string[]; chart_types: { chart_id: string; chart: string }[]; rationale?: string;
}
export interface Spotlight { section: string; kicker: string; title: string; body: string; chart_id?: string; kpis: string[]; tone: 'good' | 'bad' | 'neutral' }
/** Short baseline labels for tight spaces: "Sep-26", "'26 avg", "Oct-25". */
export function shortLabels(p: ReportPeriod) {
  const sh = (l: string) => l.replace(/-(\d{2})(\d{2})\b/g, '-$2');
  return { prev: sh(p.prevLabel), ytd: p.ytdLabel.replace(/^(\d{4}) avg.*/, (_, y) => `${y} avg`), ly: sh(p.lyLabel) };
}

export const fmtK = (v: number | null | undefined, f: Format, compact = true) => fmt(v, f, { compact: compact && f === 'currency' });
export function fmtDelta(c: number | null | undefined, f: Format): string {
  if (c === null || c === undefined || !isFinite(c)) return '—';
  const s = f === 'percent' ? `${(c * 100).toFixed(1)} pp` : `${(c * 100).toFixed(1)}%`;
  return c > 0 ? `+${s}` : s;
}
/** +1 good, -1 bad, 0 neutral */
export function tone(k: { higherIsBetter?: boolean }, c: number | null | undefined): 1 | -1 | 0 {
  if (c === null || c === undefined || !isFinite(c) || c === 0 || k.higherIsBetter === undefined) return 0;
  return (c > 0) === k.higherIsBetter ? 1 : -1;
}
export const fileBase = (r: ReportData) => `Physique 57 — ${r.scope.length > 40 ? `${r.request.locations.length} studios` : r.scope} — ${r.period.label}`.replace(/[\\/:*?"<>|]+/g, '-');

/* ═════════ report layout — styling & structure the user controls (no AI) ═════════ */
export interface ReportLayout {
  accent: string;                    // 'app' = follow the app's accent, otherwise an ACCENTS name
  cover: 'gradient' | 'light' | 'minimal';
  headingFont: 'serif' | 'sans';
  density: 'compact' | 'balanced' | 'airy';
  kpiCols: 'auto' | 3 | 4;
  sparklines: boolean;
  cmp: { prev: boolean; ytd: boolean; ly: boolean };
  order: string[];                   // section ids in display order
  hidden: string[];                  // section ids not shown
  detail: boolean;                   // findings & detail pages after each section
  pages: { cover: boolean; exec: boolean; score: boolean; mom: boolean; defs: boolean };
  fillers: boolean;                  // diagrams that fill spare space at the foot of pages
  photos: boolean;                   // Physique 57 studio photography on the cover and section bands
  tableRows: number;
  title: string; subtitle: string; preparedFor: string;
  /** let the AI art-direct the report: palette, cover, section order, condensed sections, chart forms */
  autoDesign: boolean;
  v?: number;
}
export const SECTION_IDS = ['sales', 'new_clients', 'leads', 'trainers', 'classes', 'formats', 'churn', 'late', 'studios', 'associates', 'clients', 'road'];
export const DEFAULT_LAYOUT: ReportLayout = {
  accent: 'Physique 57', cover: 'gradient', headingFont: 'sans', density: 'balanced', kpiCols: 'auto', sparklines: true,
  cmp: { prev: true, ytd: true, ly: true }, order: SECTION_IDS, hidden: [], detail: true,
  pages: { cover: true, exec: true, score: true, mom: true, defs: true }, fillers: true, photos: true, v: 3, tableRows: 10, title: '', subtitle: '', preparedFor: '', autoDesign: true,
};
export function normLayout(x: unknown): ReportLayout {
  const l = { ...(x && typeof x === 'object' ? x : {}) } as Partial<ReportLayout> & { v?: number };
  if ((l.v ?? 1) < 2) { delete l.headingFont; l.v = 2; } // v2: cleaner sans headings by default
  if ((l.v ?? 1) < 3) { if (l.accent === 'app') delete l.accent; l.v = 3; } // v3: brand palette (max three accent hues) by default
  const order = [...(l.order ?? []).filter((id) => typeof id === 'string'), ...SECTION_IDS.filter((id) => !(l.order ?? []).includes(id))];
  return { ...DEFAULT_LAYOUT, ...l, cmp: { ...DEFAULT_LAYOUT.cmp, ...(l.cmp ?? {}) }, pages: { ...DEFAULT_LAYOUT.pages, ...(l.pages ?? {}) }, order, hidden: l.hidden ?? [] };
}
/** The report as the user arranged it: sections reordered and filtered — used by the page view and every export. */
export function arrange(d: ReportData, l: ReportLayout): ReportData {
  const pos = (id: string) => { if (id === 'road') return 999; const i = l.order.indexOf(id); if (i >= 0) return i; const j = l.order.findIndex((o) => id.startsWith(o + '_')); return j < 0 ? 99 : j + 0.5; };
  return { ...d, sections: d.sections.filter((s) => !l.hidden.includes(s.id)).sort((a, b) => pos(a.id) - pos(b.id)) };
}
