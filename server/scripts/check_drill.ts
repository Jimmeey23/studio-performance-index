import { runDrill, runMetricsQuery } from '../src/semantic/engine.js';
import { METRICS } from '../src/semantic/metrics.js';
const start = '2026-08-01', end = '2026-10-31';
let pass = 0, fail = 0;
for (const m of METRICS) {
  try {
    const q = await runMetricsQuery({ metrics: [m.id], dimensions: [], start, end });
    const v = Number(q.rows[0]?.[m.id] ?? 0);
    const d: any = await runDrill({ metric: m.id, start, end, limit: 50 });
    const dv = Number(d.metric.value ?? 0);
    const ok = Math.abs(v - dv) <= Math.max(1e-6, Math.abs(v) * 1e-6);
    ok ? pass++ : fail++;
    if (!ok || !d.rowCount) console.log(ok ? 'ok ' : 'BAD', m.id, v, dv, 'records', d.rowCount);
  } catch (e) { fail++; console.log('ERR', m.id, (e as Error).message.slice(0, 160)); }
}
// cell-level: location × month
const q = await runMetricsQuery({ metrics: ['revenue', 'fill_rate'.replace('fill_rate', 'transactions')], dimensions: ['location'], grain: 'month', start, end });
for (const r of q.rows.slice(0, 6)) {
  const p = String(r.period).slice(0, 10); const e = new Date(new Date(p + 'T00:00:00Z').setUTCMonth(new Date(p).getUTCMonth() + 1) - 864e5).toISOString().slice(0, 10);
  const d: any = await runDrill({ metric: 'revenue', start: p, end: e, filters: [{ dimension: 'location', values: [String(r.location)] }], limit: 5000 });
  const sum = d.rows.reduce((a: number, x: any) => a + (Number(x.revenue ?? x.paid ?? x.amount ?? 0) || 0), 0);
  console.log('cell', r.location, p, Number(r.revenue).toFixed(0), Number(d.metric.value).toFixed(0), 'records', d.rowCount, 'sumcol', sum.toFixed(0));
}
console.log('pass', pass, 'fail', fail);
process.exit(0);
