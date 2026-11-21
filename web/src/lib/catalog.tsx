import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { api } from './api';

export interface CatalogMetric { id: string; label: string; dataset: string; format: string; description: string; caveat?: string; higherIsBetter: boolean | null; additive: boolean }
export interface Catalog {
  metrics: CatalogMetric[];
  datasets: { id: string; label: string; table: string; time: string; dimensions: string[]; defaultRule?: string; source: string }[];
  dimensions: Record<string, { label: string; description: string }>;
  rules: Record<string, unknown>;
}
const Ctx = createContext<Catalog | null>(null);
export function CatalogProvider({ children }: { children: ReactNode }) {
  const [c, setC] = useState<Catalog | null>(null);
  useEffect(() => { api<Catalog>('/api/catalog').then(setC).catch(() => {}); }, []);
  return <Ctx.Provider value={c}>{children}</Ctx.Provider>;
}
export const useCatalog = () => useContext(Ctx);
/** +1 when higher is better, -1 when lower is better, 0 unknown. */
export function usePolarity() {
  const c = useCatalog();
  return (key: string) => {
    const id = key.replace(/__(prev|chg)$/, '');
    const m = c?.metrics.find((x) => x.id === id);
    return m?.higherIsBetter === true ? 1 : m?.higherIsBetter === false ? -1 : 0;
  };
}
