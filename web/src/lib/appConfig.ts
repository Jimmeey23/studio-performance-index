/** The admin's app configuration as applied in the browser: navigation, report and analyst templates. */
import { useSyncExternalStore } from 'react';
import { api } from './api';
import { TEMPLATES, type Template } from './templates';
import { setReportTemplates, type StoredReportTemplate } from './reportTemplates';

export interface PublicConfig { nav: { hidden?: string[]; labels?: Record<string, string>; order?: string[] }; reportTemplates: StoredReportTemplate[] | null; analystTemplates: (Template & { hidden?: boolean })[] | null; appName: string | null }
export const DEFAULT_ANALYST_TEMPLATES: Template[] = [...TEMPLATES];
let cfg: PublicConfig = { nav: {}, reportTemplates: null, analystTemplates: null, appName: null };
const subs = new Set<() => void>();
export async function loadAppConfig() {
  try { cfg = await api<PublicConfig>('/api/app-config'); } catch { /* keep defaults */ }
  TEMPLATES.splice(0, TEMPLATES.length, ...(cfg.analystTemplates ?? DEFAULT_ANALYST_TEMPLATES).filter((t) => !(t as { hidden?: boolean }).hidden));
  setReportTemplates(cfg.reportTemplates);
  subs.forEach((f) => f());
}
export const useAppConfig = () => useSyncExternalStore((f) => { subs.add(f); return () => subs.delete(f); }, () => cfg);
/** Apply hidden / renamed / reordered navigation items. */
export function applyNav<T extends { to: string; label: string }>(items: T[], c: PublicConfig): T[] {
  const order = c.nav.order ?? [];
  return items.filter((i) => !c.nav.hidden?.includes(i.to)).map((i) => ({ ...i, label: c.nav.labels?.[i.to] || i.label }))
    .sort((a, b) => (order.indexOf(a.to) < 0 ? 999 : order.indexOf(a.to)) - (order.indexOf(b.to) < 0 ? 999 : order.indexOf(b.to)));
}
