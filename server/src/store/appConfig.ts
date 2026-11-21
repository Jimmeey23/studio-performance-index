/**
 * Admin customisation of the whole app, stored in the database (app_config) and applied in place at start-up
 * and on every save — so every screen, report, designer element and the AI analyst see the same configuration.
 *
 *  • workspaces: hide / rename / re-describe / reorder tabs; add, edit, hide, reorder or delete any widget; edit presets;
 *    create brand-new workspaces
 *  • navigation: hide / rename / reorder sidebar pages (applied in the web app)
 *  • metrics: rename, re-describe, hide from pickers
 *  • report topics: hide / rename / re-describe
 *  • report templates and analyst prompt templates: full list replacement (add, edit, delete, hide)
 */
import { appDb, parseJson, ddl } from './app.js';
import { DOMAINS, domainById, type Domain, type Widget } from '../ai/domains.js';
import { METRICS } from '../semantic/metrics.js';

export interface DomainOverride { hidden?: boolean; label?: string; blurb?: string; icon?: string; presets?: string[]; kpis?: string[]; widgets?: (Widget & { hidden?: boolean })[]; expert?: string }
export interface AppConfig {
  domains?: Record<string, DomainOverride>;
  domainOrder?: string[];
  customDomains?: (Omit<Domain, 'expert'> & { expert?: string; hidden?: boolean })[];
  nav?: { hidden?: string[]; labels?: Record<string, string>; order?: string[] };
  metrics?: Record<string, { label?: string; description?: string; hidden?: boolean }>;
  topics?: Record<string, { hidden?: boolean; title?: string; blurb?: string }>;
  reportTemplates?: unknown[] | null;
  analystTemplates?: unknown[] | null;
  appName?: string;
}

/* originals, captured once before any override is applied */
const ORIGINAL_DOMAINS: Domain[] = JSON.parse(JSON.stringify(DOMAINS));
const ORIGINAL_METRICS = new Map(METRICS.map((m) => [m.id, { label: m.label, description: m.description }]));
export const defaults = () => ({ domains: ORIGINAL_DOMAINS.map(({ expert, ...d }) => ({ ...d, expert })), metrics: METRICS.map((m) => ({ id: m.id, ...ORIGINAL_METRICS.get(m.id)!, dataset: m.model, format: m.format })) });

let current: AppConfig = {};
export const appConfig = () => current;

async function table() {
  const d = await appDb();
  await ddl(d, `create table if not exists app_config(key varchar primary key, value json, updated_at timestamp default now(), updated_by varchar)`);
  return d;
}
export async function loadAppConfig() {
  const d = await table();
  const r = (await d.all<{ value: string }>(`select value from app_config where key = 'main'`))[0];
  current = r ? parseJson<AppConfig>(r.value) : {};
  applyConfig(current);
  return current;
}
export async function saveAppConfig(cfg: AppConfig, by: string) {
  const d = await table();
  await d.all(`delete from app_config where key = 'main'`);
  await d.all(`insert into app_config(key, value, updated_by) values ('main', ?, ?)`, [JSON.stringify(cfg), by]);
  current = cfg;
  applyConfig(cfg);
}

/** Rebuild the live workspace list and metric labels from the originals plus the overrides. */
function applyConfig(cfg: AppConfig) {
  const base: (Domain & { hidden?: boolean })[] = JSON.parse(JSON.stringify(ORIGINAL_DOMAINS));
  for (const c of cfg.customDomains ?? []) base.push({ expert: `You are the ${c.label} expert for Physique 57 India.`, ...JSON.parse(JSON.stringify(c)) });
  const resolved = base.map((d) => {
    const o = cfg.domains?.[d.id];
    if (!o) return d;
    return { ...d, label: o.label || d.label, blurb: o.blurb ?? d.blurb, icon: o.icon || d.icon, expert: o.expert || d.expert, hidden: o.hidden ?? d.hidden,
      presets: o.presets ?? d.presets, kpis: o.kpis ?? d.kpis, widgets: (o.widgets ?? d.widgets).filter((w) => !(w as { hidden?: boolean }).hidden) as Widget[] };
  });
  const order = cfg.domainOrder ?? [];
  resolved.sort((a, b) => (order.indexOf(a.id) < 0 ? 999 : order.indexOf(a.id)) - (order.indexOf(b.id) < 0 ? 999 : order.indexOf(b.id)));
  DOMAINS.splice(0, DOMAINS.length, ...resolved);
  domainById.clear();
  for (const d of DOMAINS) domainById.set(d.id, d);
  for (const m of METRICS) {
    const o = cfg.metrics?.[m.id]; const orig = ORIGINAL_METRICS.get(m.id)!;
    m.label = o?.label || orig.label; m.description = o?.description || orig.description;
    (m as { hidden?: boolean }).hidden = !!o?.hidden;
  }
}
export const visibleDomains = () => DOMAINS.filter((d) => !(d as { hidden?: boolean }).hidden);
export const metricHidden = (id: string) => !!appConfig().metrics?.[id]?.hidden;
