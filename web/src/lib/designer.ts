/** Report designer: page layouts, animations, element types and starter wireframes. */
import type { Result } from './types';

export type SlotKind = 'widget' | 'special' | 'metric' | 'metrics' | 'title' | 'text' | 'quote' | 'image' | 'divider' | 'spacer' | 'ai';
export interface Slot {
  id: string; kind: SlotKind;
  domain?: string; index?: number; special?: string; metric?: string; metrics?: string[];
  text?: string; title?: string; body?: string; by?: string; photo?: string; prompt?: string; style?: string;
  label?: string; // display name in the editor
}
export interface DPage { id: string; layout: string; title: string; subtitle: string; kicker?: string; animation?: string; tint?: string; slots: (Slot | null)[] }
export interface Design {
  title: string; subtitle?: string; preset?: string; month?: string; start?: string; end?: string; locations: string[];
  compare: 'previous_period' | 'previous_year' | 'none'; cover: boolean; orientation: 'portrait' | 'landscape'; pages: DPage[];
}
export interface RenderedSlot extends Slot { data?: { result?: Result; series?: Result; error?: string; widget?: { type: string; title?: string; chart?: string; dimension?: string; view?: string; block?: string; domain?: string; metrics?: string[]; dimensions?: string[] } } }
export interface Rendered { design: Design; period: { start: string; end: string; trendStart: string; months: number }; scope: string; pages: (DPage & { slots: (RenderedSlot | null)[] })[]; renderedAt: string; ai: Record<string, string> }

export interface Layout { id: string; label: string; areas: string[]; cols: string; rows: string; slots: number; small?: number[]; group: string }
/** Placeholder layouts — `areas` rows of single-letter slot names (a, b, c…), slot order = alphabetical. */
export const LAYOUTS: Layout[] = [
  { id: 'full', label: 'Full page', group: 'Basic', areas: ['a'], cols: '1fr', rows: '1fr', slots: 1 },
  { id: 'two', label: 'Two columns', group: 'Basic', areas: ['a b'], cols: '1fr 1fr', rows: '1fr', slots: 2 },
  { id: 'three', label: 'Three columns', group: 'Basic', areas: ['a b c'], cols: '1fr 1fr 1fr', rows: '1fr', slots: 3 },
  { id: 'rows-2', label: 'Two rows', group: 'Basic', areas: ['a', 'b'], cols: '1fr', rows: '1fr 1fr', slots: 2 },
  { id: 'rows-3', label: 'Three rows', group: 'Basic', areas: ['a', 'b', 'c'], cols: '1fr', rows: '1fr 1fr 1fr', slots: 3 },
  { id: 'grid-4', label: '2 × 2 grid', group: 'Grids', areas: ['a b', 'c d'], cols: '1fr 1fr', rows: '1fr 1fr', slots: 4 },
  { id: 'grid-6', label: '3 × 2 grid', group: 'Grids', areas: ['a b c', 'd e f'], cols: '1fr 1fr 1fr', rows: '1fr 1fr', slots: 6 },
  { id: 'grid-6v', label: '2 × 3 grid', group: 'Grids', areas: ['a b', 'c d', 'e f'], cols: '1fr 1fr', rows: '1fr 1fr 1fr', slots: 6 },
  { id: 'hero-two', label: 'Wide top, two below', group: 'Feature', areas: ['a a', 'b c'], cols: '1fr 1fr', rows: '1fr 1fr', slots: 3 },
  { id: 'two-hero', label: 'Two on top, wide below', group: 'Feature', areas: ['a b', 'c c'], cols: '1fr 1fr', rows: '1fr 1fr', slots: 3 },
  { id: 'hero-three', label: 'Wide top, three below', group: 'Feature', areas: ['a a a', 'b c d'], cols: '1fr 1fr 1fr', rows: '1.3fr 1fr', slots: 4 },
  { id: 'feature-left', label: 'Big left, two stacked right', group: 'Feature', areas: ['a b', 'a c'], cols: '1.4fr 1fr', rows: '1fr 1fr', slots: 3 },
  { id: 'feature-right', label: 'Two stacked left, big right', group: 'Feature', areas: ['a c', 'b c'], cols: '1fr 1.4fr', rows: '1fr 1fr', slots: 3 },
  { id: 'sidebar-left', label: 'Narrow left column', group: 'Feature', areas: ['a b'], cols: '1fr 2fr', rows: '1fr', slots: 2 },
  { id: 'sidebar-right', label: 'Narrow right column', group: 'Feature', areas: ['a b'], cols: '2fr 1fr', rows: '1fr', slots: 2 },
  { id: 'kpi-chart-table', label: 'Metric strip · chart · table', group: 'Dashboards', areas: ['a b c d', 'e e e e', 'f f f f'], cols: '1fr 1fr 1fr 1fr', rows: 'auto 1fr 1fr', slots: 6, small: [0, 1, 2, 3] },
  { id: 'kpi-two', label: 'Metric strip · two below', group: 'Dashboards', areas: ['a b c d', 'e e f f'], cols: '1fr 1fr 1fr 1fr', rows: 'auto 1fr', slots: 6, small: [0, 1, 2, 3] },
  { id: 'kpi-hero', label: 'Metric strip · one wide', group: 'Dashboards', areas: ['a b c', 'd d d'], cols: '1fr 1fr 1fr', rows: 'auto 1fr', slots: 4, small: [0, 1, 2] },
  { id: 'insight-chart', label: 'Insight · chart · table', group: 'Dashboards', areas: ['a b', 'c c'], cols: '1fr 1.6fr', rows: '1fr 1fr', slots: 3 },
  { id: 'title-page', label: 'Title · image · text', group: 'Story', areas: ['a', 'b', 'c'], cols: '1fr', rows: 'auto 1.4fr auto', slots: 3 },
  { id: 'image-split', label: 'Image beside text', group: 'Story', areas: ['a b'], cols: '1fr 1fr', rows: '1fr', slots: 2 },
  { id: 'quote-split', label: 'Quote · two below', group: 'Story', areas: ['a a', 'b c'], cols: '1fr 1fr', rows: 'auto 1fr', slots: 3, small: [0] },
  { id: 'section-break', label: 'Section divider', group: 'Story', areas: ['a'], cols: '1fr', rows: '1fr', slots: 1 },
];
export const layoutById = (id: string) => LAYOUTS.find((l) => l.id === id) ?? LAYOUTS[0];
export const slotLetters = (l: Layout) => [...new Set(l.areas.join(' ').split(/\s+/))].sort();

export const ANIMATIONS = [['none', 'None'], ['fade', 'Fade in'], ['rise', 'Rise up'], ['zoom', 'Zoom in'], ['slide', 'Slide from left'], ['stagger', 'Stagger elements']] as const;
export const AI_STYLES = [['paragraph', 'Paragraph'], ['bullets', 'Bullet points'], ['callout', 'Headline callout'], ['summary', 'Executive summary'], ['actions', 'Recommended actions']] as const;
export const TINTS = [['none', 'White'], ['soft', 'Soft blue'], ['navy', 'Navy'], ['sand', 'Warm sand']] as const;

export const uid = (p = 's') => `${p}${Math.random().toString(36).slice(2, 9)}`;
export const blankPage = (layout = 'two', title = ''): DPage => ({ id: uid('p'), layout, title, subtitle: '', animation: 'rise', slots: Array.from({ length: layoutById(layout).slots }, () => null) });
/** Change a page's layout, keeping as many placed elements as fit. */
export function relayout(p: DPage, layout: string): DPage {
  const n = layoutById(layout).slots; const kept = p.slots.filter(Boolean);
  return { ...p, layout, slots: Array.from({ length: n }, (_, i) => kept[i] ?? null) };
}

const W = (domain: string, index: number, label: string): Slot => ({ id: uid(), kind: 'widget', domain, index, label });
const M = (metric: string, label: string): Slot => ({ id: uid(), kind: 'metric', metric, label });
const AI = (prompt: string, style = 'paragraph'): Slot => ({ id: uid(), kind: 'ai', prompt, style, label: 'AI commentary' });
/** Starter wireframes. */
export const STARTERS: { id: string; name: string; blurb: string; make: () => Design }[] = [
  { id: 'blank', name: 'Blank', blurb: 'Start from an empty page and build it your way.', make: () => ({ title: 'Untitled report', locations: [], compare: 'previous_year', cover: true, orientation: 'portrait', preset: 'lm', pages: [blankPage('hero-two', 'Page 1')] }) },
  { id: 'mbr', name: 'Monthly business review', blurb: 'Headline metrics, revenue, clients, classes and AI recommendations.', make: () => ({ title: 'Monthly business review', locations: [], compare: 'previous_year', cover: true, orientation: 'portrait', preset: 'lm', pages: [
    { id: uid('p'), layout: 'kpi-chart-table', title: 'Business at a glance', subtitle: 'Headline numbers vs last year', animation: 'stagger', slots: [M('revenue', 'Revenue'), M('paying_clients', 'Paying clients'), M('new_clients', 'New clients'), M('fill_rate', 'Fill rate'), W('sales', 1, 'Revenue by location'), W('sales', 4, 'Location scorecard')] },
    { id: uid('p'), layout: 'insight-chart', title: 'Acquisition', subtitle: 'Leads, trials and conversion', animation: 'rise', slots: [AI('What is happening in acquisition, and why?', 'bullets'), W('leads', 1, 'Leads by channel'), W('leads', 4, 'Source performance')] },
    { id: uid('p'), layout: 'two-hero', title: 'Classes', subtitle: 'Schedule productivity', animation: 'rise', slots: [{ id: uid(), kind: 'special', special: 'class_top', label: 'Top recurring classes' }, { id: uid(), kind: 'special', special: 'class_bottom', label: 'Weakest recurring classes' }, AI('Which schedule changes would lift fill the most?', 'actions')] },
    { id: uid('p'), layout: 'full', title: 'Recommendations', subtitle: 'What to do next month', animation: 'fade', slots: [AI('Write an executive summary of this report and the five most important actions for next month, each naming an owner.', 'summary')] },
  ] }) },
  { id: 'trainer', name: 'Trainer review', blurb: 'Composite ranking, revenue contribution and conversion vs expected.', make: () => ({ title: 'Trainer review', locations: [], compare: 'previous_year', cover: true, orientation: 'landscape', preset: 'ytd', pages: [
    { id: uid('p'), layout: 'feature-left', title: 'Who are our top trainers?', subtitle: 'Composite score, tiers A–D', animation: 'rise', slots: [{ id: uid(), kind: 'special', special: 'trainer_ranking', label: 'Trainer ranking' }, { id: uid(), kind: 'special', special: 'trainer_score_chart', label: 'Score chart' }, AI('Who leads and why? Name trainers.', 'bullets')] },
    { id: uid('p'), layout: 'two', title: 'Revenue & conversion', subtitle: '', animation: 'rise', slots: [{ id: uid(), kind: 'special', special: 'trainer_revenue', label: 'Revenue contribution' }, { id: uid(), kind: 'special', special: 'trainer_conversion', label: 'Conversion vs expected' }] },
    { id: uid('p'), layout: 'full', title: 'Coaching priorities', subtitle: '', animation: 'fade', slots: [AI('Recommend coaching and scheduling actions for individual trainers.', 'actions')] },
  ] }) },
  { id: 'leads', name: 'Lead channel review', blurb: 'Funnel by channel, studio × channel heatmap and actions.', make: () => ({ title: 'Lead channel review', locations: [], compare: 'previous_year', cover: true, orientation: 'portrait', preset: 'ytd', pages: [
    { id: uid('p'), layout: 'kpi-chart-table', title: 'Lead funnel', subtitle: 'Leads → trials → purchasing members', animation: 'stagger', slots: [M('leads', 'Leads'), M('lead_trials', 'Trials'), M('lead_to_trial_rate', 'Lead→trial'), M('lead_conversion_rate', 'Lead→member'), { id: uid(), kind: 'special', special: 'lead_channel_funnel', label: 'Funnel by channel' }, { id: uid(), kind: 'special', special: 'lead_studio_channel', label: 'Studio × channel' }] },
    { id: uid('p'), layout: 'full', title: 'Where to focus', subtitle: '', animation: 'fade', slots: [AI('Which channels and sources should get more budget and which follow-up needs fixing?', 'actions')] },
  ] }) },
];

export const ELEMENT_ICON: Record<SlotKind, string> = { widget: 'LayoutGrid', special: 'Sparkles', metric: 'Gauge', metrics: 'Gauge', title: 'Heading', text: 'AlignLeft', quote: 'Quote', image: 'Image', divider: 'Minus', spacer: 'Square', ai: 'Brain' };
