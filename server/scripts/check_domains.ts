import { DOMAINS } from '../src/ai/domains.js';
import { metricById, modelById } from '../src/semantic/metrics.js';
let bad = 0;
for (const d of DOMAINS) for (const w of [{ title: 'kpis', metrics: d.kpis }, ...d.widgets] as any[]) {
  const ms: string[] = w.metrics ?? (w.metric ? [w.metric, ...(w.extra ?? [])] : []);
  for (const m of ms) if (!metricById.has(m)) { bad++; console.log(d.id, '|', w.title, '| missing metric', m); }
  const dims: string[] = w.dimensions ?? (w.dimension ? [w.dimension] : []);
  for (const m of ms) { const mt = metricById.get(m); if (!mt) continue; const sm: any = modelById.get(mt.model); for (const x of dims) if (!sm?.dims?.[x]) { bad++; console.log(d.id, '|', w.title, '| dim', x, 'not in', mt.model, 'for', m); } }
}
console.log('problems', bad);
