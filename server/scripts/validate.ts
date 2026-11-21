/**
 * Validation suite.
 *  A. Engine vs independent pandas recomputation (data/expected.json from scripts/independent_check.py)
 *  B. Engine invariants: no join fan-out, date boundaries, comparison shifts, additivity,
 *     multi-dataset joins equal single-dataset queries, guarded SQL.
 *  C. Benchmark questions executed through the analysis tools (each must return verified data).
 * usage: npx tsx scripts/validate.ts [expected.json]
 */
import fs from 'node:fs';
import { runMetricsQuery } from '../src/semantic/engine.js';
import * as A from '../src/analytics/analyses.js';
import { warehouse } from '../src/warehouse/db.js';

const results: { group: string; name: string; pass: boolean; detail: string }[] = [];
const check = (group: string, name: string, pass: boolean, detail = '') => { results.push({ group, name, pass, detail }); console.log(`${pass ? '✔' : '✘'} [${group}] ${name}${detail ? ' — ' + detail : ''}`); };
const close = (a: number, b: number, tol = 0.001) => Math.abs(a - b) <= Math.max(0.51, Math.abs(b) * tol);
const safe = async (group: string, name: string, f: () => Promise<void>) => { try { await f(); } catch (e) { check(group, name, false, (e as Error).message); } };

const expFile = process.argv[2] ?? 'data/expected.json';
if (fs.existsSync(expFile)) {
  const X = JSON.parse(fs.readFileSync(expFile, 'utf8'));
  const [start, end] = X.period;
  const G = 'A: vs pandas';
  await safe(G, 'revenue', async () => {
    const r = await runMetricsQuery({ metrics: ['revenue', 'paying_clients', 'transactions'], start, end });
    const row = r.rows[0];
    check(G, 'total revenue', close(Number(row.revenue), X.revenue_total), `${row.revenue} vs ${X.revenue_total}`);
    check(G, 'paying clients', Number(row.paying_clients) === X.paying_clients, `${row.paying_clients} vs ${X.paying_clients}`);
    check(G, 'transactions', Number(row.transactions) === X.transactions, `${row.transactions} vs ${X.transactions}`);
    const m = await runMetricsQuery({ metrics: ['revenue'], grain: 'month', start, end });
    for (const r2 of m.rows) { const k = String(r2.period).slice(0, 7); check(G, `revenue ${k}`, close(Number(r2.revenue), X.revenue_by_month[k]), `${r2.revenue} vs ${X.revenue_by_month[k]}`); }
    const l = await runMetricsQuery({ metrics: ['revenue'], dimensions: ['location'], start, end });
    for (const [loc, v] of Object.entries(X.revenue_by_location)) { const r3 = l.rows.find((x) => x.location === loc); check(G, `revenue ${loc}`, close(Number(r3?.revenue), Number(v)), `${r3?.revenue} vs ${v}`); }
  });
  await safe(G, 'visits', async () => {
    const m = await runMetricsQuery({ metrics: ['visits'], grain: 'month', start, end });
    for (const r of m.rows) { const k = String(r.period).slice(0, 7); check(G, `visits ${k}`, Number(r.visits) === X.visits_by_month[k], `${r.visits} vs ${X.visits_by_month[k]}`); }
    const t = (await runMetricsQuery({ metrics: ['visiting_clients', 'late_cancellations'], start, end })).rows[0];
    check(G, 'visiting clients', Number(t.visiting_clients) === X.visiting_clients, `${t.visiting_clients} vs ${X.visiting_clients}`);
    check(G, 'late cancellations', Number(t.late_cancellations) === X.late_cancellations, `${t.late_cancellations} vs ${X.late_cancellations}`);
  });
  await safe(G, 'classes', async () => {
    const t = (await runMetricsQuery({ metrics: ['classes', 'fill_rate'], start, end })).rows[0];
    check(G, 'classes held', Number(t.classes) === X.classes, `${t.classes} vs ${X.classes}`);
    check(G, 'fill rate', Math.abs(Number(t.fill_rate) - X.fill_rate) < 0.0005, `${Number(t.fill_rate).toFixed(4)} vs ${X.fill_rate}`);
  });
  await safe(G, 'new clients', async () => {
    const m = await runMetricsQuery({ metrics: ['new_clients'], grain: 'month', start, end });
    for (const r of m.rows) { const k = String(r.period).slice(0, 7); check(G, `new clients ${k}`, Number(r.new_clients) === X.new_clients_by_month[k], `${r.new_clients} vs ${X.new_clients_by_month[k]}`); }
    const t = (await runMetricsQuery({ metrics: ['conversion_rate', 'retention_rate'], start, end })).rows[0];
    check(G, 'conversion rate', Math.abs(Number(t.conversion_rate) - X.conversion_rate) < 0.002, `${Number(t.conversion_rate).toFixed(4)} vs ${X.conversion_rate}`);
    check(G, 'retention rate', Math.abs(Number(t.retention_rate) - X.retention_rate) < 0.002, `${Number(t.retention_rate).toFixed(4)} vs ${X.retention_rate}`);
  });
  await safe(G, 'leads', async () => {
    const m = await runMetricsQuery({ metrics: ['leads'], grain: 'month', start, end });
    for (const r of m.rows) { const k = String(r.period).slice(0, 7); check(G, `leads ${k}`, Number(r.leads) === X.leads_by_month[k], `${r.leads} vs ${X.leads_by_month[k]}`); }
    const t = (await runMetricsQuery({ metrics: ['lead_conversions'], start, end })).rows[0];
    check(G, 'lead conversions', Number(t.lead_conversions) === X.lead_conversions, `${t.lead_conversions} vs ${X.lead_conversions}`);
  });
  await safe(G, 'memberships', async () => {
    const t = (await runMetricsQuery({ metrics: ['memberships_expiring', 'sheet_renewal_rate'], start, end })).rows[0];
    check(G, 'memberships ending', Number(t.memberships_expiring) === X.memberships_ending, `${t.memberships_expiring} vs ${X.memberships_ending}`);
    check(G, 'sheet renewal rate', Math.abs(Number(t.sheet_renewal_rate) - X.sheet_renewal_rate) < 0.002, `${Number(t.sheet_renewal_rate).toFixed(4)} vs ${X.sheet_renewal_rate}`);
  });
} else console.log(`(skipping group A — ${expFile} not found)`);

/* ── B. invariants ─────────────────────────────────────────────────────── */
const B = 'B: invariants';
const db = await warehouse();
await safe(B, 'no duplicate keys', async () => {
  const bad = await db.all(`select model, duplicates from _model_build where duplicates > 0 or status = 'error'`);
  check(B, 'all models built with unique grain', bad.length === 0, JSON.stringify(bad));
});
await safe(B, 'multi-dataset join does not inflate', async () => {
  const joint = await runMetricsQuery({ metrics: ['revenue', 'visits', 'leads'], dimensions: ['location'], start: '2026-07-01', end: '2026-09-30' });
  const solo = await runMetricsQuery({ metrics: ['revenue'], dimensions: ['location'], start: '2026-07-01', end: '2026-09-30' });
  const ok = solo.rows.every((r) => close(Number(joint.rows.find((j) => j.location === r.location)?.revenue), Number(r.revenue), 1e-9));
  check(B, 'revenue identical when joined with visits+leads', ok);
});
await safe(B, 'breakdowns reconcile', async () => {
  for (const d of ['location', 'category', 'sold_by', 'payment_method']) {
    const r = await runMetricsQuery({ metrics: ['revenue'], dimensions: [d], start: '2026-01-01', end: '2026-10-31' });
    check(B, `revenue by ${d} sums to total`, r.checks.every((c) => c.passed));
  }
});
await safe(B, 'date boundaries', async () => {
  const oct = Number((await runMetricsQuery({ metrics: ['revenue'], start: '2026-10-01', end: '2026-10-31' })).rows[0].revenue);
  const direct = Number((await db.one(`select sum(gross_amount) v from fct_sales where payment_ts >= '2026-10-01' and payment_ts < '2026-11-01'`))?.v);
  const lastDay = Number((await db.one(`select count(*) n from fct_sales where payment_date = '2026-10-31'`))?.n);
  check(B, 'end date is inclusive through 23:59:59', close(oct, direct, 1e-9), `${oct} vs ${direct}; ${lastDay} items on 31 Oct`);
  const sep = Number((await runMetricsQuery({ metrics: ['revenue'], start: '2026-09-01', end: '2026-09-30' })).rows[0].revenue);
  const both = Number((await runMetricsQuery({ metrics: ['revenue'], start: '2026-09-01', end: '2026-10-31' })).rows[0].revenue);
  check(B, 'adjacent months add up (no overlap/gap)', close(sep + oct, both, 1e-9));
});
await safe(B, 'comparison shift', async () => {
  const r = await runMetricsQuery({ metrics: ['revenue'], start: '2026-10-01', end: '2026-10-31', compare: 'previous_year' });
  const ly = Number((await runMetricsQuery({ metrics: ['revenue'], start: '2025-10-01', end: '2025-10-31' })).rows[0].revenue);
  check(B, 'previous_year = same month last year', close(Number(r.rows[0].revenue__prev), ly, 1e-9), `${r.period.comparisonStart}→${r.period.comparisonEnd}`);
  const p = await runMetricsQuery({ metrics: ['revenue'], start: '2026-09-01', end: '2026-10-31', compare: 'previous_period' });
  check(B, 'previous_period of Sep–Oct is Jul–Aug', p.period.comparisonStart === '2026-07-01' && p.period.comparisonEnd === '2026-08-31', `${p.period.comparisonStart}→${p.period.comparisonEnd}`);
  const m = await runMetricsQuery({ metrics: ['revenue'], grain: 'month', start: '2026-05-01', end: '2026-10-31', compare: 'previous_year' });
  const may = m.rows.find((x) => String(x.period).startsWith('2026-05'));
  const may25 = Number((await runMetricsQuery({ metrics: ['revenue'], start: '2025-05-01', end: '2025-05-31' })).rows[0].revenue);
  check(B, 'monthly YoY aligns same calendar month', close(Number(may?.revenue__prev), may25, 1e-9));
});
await safe(B, 'future and imported excluded', async () => {
  const fut = Number((await db.one(`select count(*) n from fct_visits where session_ts > now() + interval 1 day`))?.n);
  const r = await runMetricsQuery({ metrics: ['bookings'], start: '2026-11-01', end: '2026-12-31' });
  const direct = Number((await db.one(`select count(*) filter (where not early_cancelled) n from fct_visits where not is_imported and session_ts >= '2026-11-01' and session_ts <= (now() at time zone 'Asia/Kolkata')`))?.n);
  check(B, 'future bookings excluded by default', Number(r.rows[0].bookings) === direct, `${fut} future rows in table; metric ${r.rows[0].bookings}`);
  const hist = Number((await runMetricsQuery({ metrics: ['visits'], start: '2019-01-01', end: '2020-12-31' })).rows[0].visits);
  check(B, 'imported legacy visits excluded', hist < 1000, `${hist} visits in 2019–2020`);
});
await safe(B, 'visits history has no overlap with checkins', async () => {
  const r = await db.one(`select (select min(session_date) from fct_checkins) c, (select max(session_date) from fct_visits where source = 'bookings_history') h`);
  check(B, 'bookings history ends before check-ins begin', String(r?.h) < String(r?.c), `${r?.h} < ${r?.c}`);
});
await safe(B, 'guarded SQL', async () => {
  let blocked = 0;
  for (const s of ['drop table fct_sales', 'select * from raw_sales', "select * from read_csv('x')", 'select 1; select 2']) { try { await A.runSql({ sql: s }); } catch { blocked++; } }
  check(B, 'unsafe SQL rejected', blocked === 4, `${blocked}/4 blocked`);
});
await safe(B, 'unknown inputs rejected', async () => {
  let n = 0;
  for (const spec of [{ metrics: ['nope'] }, { metrics: ['revenue'], dimensions: ['teacher'] }, { metrics: ['revenue'], start: '01/10/2026' }]) { try { await runMetricsQuery(spec); } catch { n++; } }
  check(B, 'invalid metric/dimension/date rejected', n === 3, `${n}/3`);
});

/* ── C. benchmark questions ────────────────────────────────────────────── */
const C = 'C: benchmarks';
const bench: [string, () => Promise<{ rows: unknown[]; verified?: boolean }>][] = [
  ['Simple lookup: revenue last month', () => runMetricsQuery({ metrics: ['revenue'], start: '2026-10-01', end: '2026-10-31' })],
  ['Location comparison with YoY', () => runMetricsQuery({ metrics: ['revenue', 'paying_clients', 'atv'], dimensions: ['location'], start: '2026-05-01', end: '2026-10-31', compare: 'previous_year' })],
  ['14-month MoM with prior-year', () => runMetricsQuery({ metrics: ['revenue', 'paying_clients', 'visiting_clients', 'paying_visiting_clients'], grain: 'month', compare: 'previous_year' })],
  ['Multi-sheet: revenue, visits, new clients, leads by location', () => runMetricsQuery({ metrics: ['revenue', 'visits', 'new_clients', 'leads'], dimensions: ['location'], start: '2026-08-01', end: '2026-10-31' })],
  ['Top 5 products by revenue', () => runMetricsQuery({ metrics: ['revenue', 'units_sold'], dimensions: ['product'], start: '2026-01-01', end: '2026-10-31', limit: 5 })],
  ['Associate sales ranking', () => runMetricsQuery({ metrics: ['revenue', 'transactions'], dimensions: ['sold_by'], start: '2026-10-01', end: '2026-10-31' })],
  ['Class fill rate by time slot & studio', () => runMetricsQuery({ metrics: ['fill_rate', 'class_average', 'classes'], dimensions: ['location', 'time_slot'], start: '2026-10-01', end: '2026-10-31' })],
  ['Teacher conversion', () => runMetricsQuery({ metrics: ['teacher_new_clients', 'teacher_conversion_rate'], dimensions: ['teacher'], start: '2026-07-01', end: '2026-10-31' })],
  ['Lead funnel by channel', () => A.funnel({ type: 'leads', split_by: 'channel', start: '2026-07-01', end: '2026-09-30' })],
  ['New-client cohort retention', () => A.cohortRetention({ months: 6 })],
  ['Renewals by location', () => A.renewalAnalysis({ group_by: 'location', start: '2026-05-01', end: '2026-10-31' })],
  ['Win-backs', () => A.winbackAnalysis({ group_by: 'location' })],
  ['Revenue forecast', () => A.forecast({ metric: 'revenue', horizon: 3, target: 6000000 })],
  ['Visits forecast by location', () => A.forecast({ metric: 'visits', horizon: 2, split_by: 'location' })],
  ['Anomaly scan', () => A.detectAnomalies({ split_by: 'location' })],
  ['Target vs actual (no targets → explicit)', async () => { const r = await A.targetVsActual({ metric: 'revenue' }); return { rows: [1], verified: r.notes[0]?.includes('No targets') || r.rows.length > 0 }; }],
  ['Meta CPL by city', () => runMetricsQuery({ metrics: ['ad_spend', 'ad_leads', 'cost_per_lead'], dimensions: ['city'], start: '2026-09-01', end: '2026-10-31' })],
  ['Discount analysis', () => runMetricsQuery({ metrics: ['discount_amount', 'discount_rate'], dimensions: ['discount_code'], start: '2026-01-01', end: '2026-10-31', limit: 10 })],
];
for (const [name, f] of bench) {
  const t0 = Date.now();
  await safe(C, name, async () => { const r = await f(); check(C, name, r.rows.length > 0 && r.verified !== false, `${r.rows.length} rows, ${Date.now() - t0} ms`); });
}

const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
fs.writeFileSync('data/validation-report.json', JSON.stringify({ at: new Date().toISOString(), results }, null, 1));
process.exit(failed.length ? 1 : 0);
