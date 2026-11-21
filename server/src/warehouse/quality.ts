/**
 * Data dictionary + data-quality checks, computed after every model build and
 * shown on the Data Sources / Data Health pages and to the AI.
 */
import { Db, sqlString } from './db.js';
import { MODELS } from './models.js';
import { loadRules } from './rules.js';

export async function buildDictionary(db: Db) {
  await db.exec(`create table if not exists _dictionary(model varchar primary key, profile json, built_at timestamp)`);
  for (const m of MODELS) {
    if (!(await db.tableExists(m.name))) continue;
    const cols = await db.columns(m.name);
    const n = Number((await db.one(`select count(*) n from ${m.name}`))?.n ?? 0);
    const profile: Record<string, unknown>[] = [];
    for (const c of cols) {
      const q = `"${c.name}"`;
      const base = await db.one(`select count(*) filter (where ${q} is null) as nulls, approx_count_distinct(${q}) as distinct_n,
        min(${q})::varchar as min_v, max(${q})::varchar as max_v from ${m.name}`);
      const entry: Record<string, unknown> = {
        column: c.name, type: c.type, null_pct: n ? Number(base?.nulls) / n : 0, distinct: Number(base?.distinct_n),
        min: base?.min_v, max: base?.max_v,
      };
      if (c.type === 'VARCHAR' && Number(base?.distinct_n) <= 60 && !/email|phone|name|_id$|key$|remarks/.test(c.name)) {
        entry.top_values = await db.all(`select ${q} as value, count(*) as rows from ${m.name} group by 1 order by 2 desc limit 25`);
      }
      profile.push(entry);
    }
    await db.exec(`insert or replace into _dictionary values (${sqlString(m.name)}, ${sqlString(JSON.stringify({
      model: m.name, grain: m.grain, description: m.description, sourceOfTruth: m.sourceOfTruth ?? null, rows: n, columns: profile,
    }))}, now())`);
  }
}

interface QualityRow { check_id: string; severity: 'info' | 'warning' | 'error'; area: string; value: number | null; detail: string }

export async function runQualityChecks(db: Db): Promise<QualityRow[]> {
  const out: QualityRow[] = [];
  const has = (t: string) => db.tableExists(t);
  const push = (r: QualityRow) => out.push(r);
  const rules = loadRules();

  // 1. duplicates on declared grain
  for (const b of await db.all<{ model: string; duplicates: number; status: string; error: string }>(`select * from _model_build`)) {
    if (b.status === 'error') push({ check_id: `build:${b.model}`, severity: 'error', area: b.model, value: null, detail: `Model failed to build: ${b.error}` });
    if (Number(b.duplicates) > 0) push({ check_id: `dupes:${b.model}`, severity: 'error', area: b.model, value: Number(b.duplicates), detail: `${b.duplicates} duplicate keys on the declared grain.` });
  }

  // 2. raw rows dropped while modelling (unparseable keys/dates)
  const drops: [string, string, string][] = [
    ['raw_sales', 'fct_sales', 'sale items excluded (see stg_sales_excluded for reasons)'],
    ['raw_checkins', 'fct_checkins', 'check-in rows without member/session/date or duplicated'],
    ['raw_sessions', 'fct_sessions', 'session rows without id/date or duplicated'],
    ['raw_leads', 'fct_leads', 'lead rows without id/date or duplicated'],
    ['raw_new_clients', 'fct_new_clients', 'client rows without member id or duplicated'],
  ];
  for (const [raw, model, label] of drops) {
    if (!(await has(raw)) || !(await has(model))) continue;
    const a = Number((await db.one(`select count(*) n from ${raw}`))?.n), b = Number((await db.one(`select count(*) n from ${model}`))?.n);
    const pct = a ? (a - b) / a : 0;
    push({ check_id: `dropped:${model}`, severity: pct > 0.05 ? 'warning' : 'info', area: model, value: a - b, detail: `${a - b} of ${a} raw rows (${(pct * 100).toFixed(1)}%) — ${label}.` });
  }
  if (await has('stg_sales_excluded')) {
    for (const r of await db.all(`select reason, count(*) n, sum(gross_amount) amt from stg_sales_excluded group by 1 order by 2 desc`)) {
      push({ check_id: `sales_excluded:${r.reason}`, severity: 'info', area: 'fct_sales', value: Number(r.n), detail: `${r.n} sale items excluded — ${r.reason} (₹${Math.round(Number(r.amt) || 0).toLocaleString('en-IN')}).` });
    }
  }

  // 3. unmapped locations
  const known = new Set(rules.locations.map((l) => l.location));
  for (const [model, col] of [['fct_sales', 'location'], ['fct_visits', 'location'], ['fct_sessions', 'location'], ['fct_leads', 'location']] as const) {
    if (!(await has(model))) continue;
    const vals = await db.all<{ v: string; n: number }>(`select ${col} v, count(*) n from ${model} where ${col} is not null group by 1`);
    const unk = vals.filter((x) => !known.has(x.v));
    if (unk.length) push({ check_id: `unmapped_location:${model}`, severity: 'warning', area: model, value: unk.reduce((a, x) => a + Number(x.n), 0), detail: `Unmapped location values: ${unk.slice(0, 8).map((x) => `"${x.v}" (${x.n})`).join(', ')}. Add them to config/business-rules.json › locations.` });
    const nulls = Number((await db.one(`select count(*) filter (where ${col} is null) n from ${model}`))?.n);
    if (nulls) push({ check_id: `null_location:${model}`, severity: 'info', area: model, value: nulls, detail: `${nulls} rows without a location.` });
  }

  // 4. status vocabularies (so business rules can be verified)
  if (await has('fct_new_clients')) {
    const v = await db.all(`select conversion_status v, count(*) n from fct_new_clients group by 1 order by 2 desc`);
    push({ check_id: 'vocab:conversion_status', severity: 'info', area: 'fct_new_clients', value: v.length, detail: `Conversion Status values: ${v.map((x) => `${x.v ?? '(blank)'}=${x.n}`).join(', ')}. Treated as converted: ${rules.status_values.converted_values.join(', ')}.` });
  }
  if (await has('fct_leads')) {
    const v = await db.all(`select trial_status v, count(*) n from fct_leads group by 1 order by 2 desc limit 12`);
    push({ check_id: 'vocab:trial_status', severity: 'info', area: 'fct_leads', value: v.length, detail: `Trial Status values: ${v.map((x) => `${x.v ?? '(blank)'}=${x.n}`).join(', ')}.` });
  }

  // 5. cross-source reconciliation: check-ins (bookings) vs class check-ins (sessions)
  if ((await has('fct_checkins')) && (await has('fct_sessions'))) {
    const rows = await db.all(`
      with a as (select session_month m, count(*) filter (where attended) v from fct_checkins group by 1),
           b as (select session_month m, sum(checked_in) v from fct_sessions where is_past group by 1)
      select a.m::varchar m, a.v av, b.v bv, abs(a.v - b.v) / nullif(b.v, 0) diff from a join b using (m)
      where a.m >= date_trunc('month', current_date) - interval 6 month and a.m < date_trunc('month', current_date) order by 1`);
    const worst = rows.reduce((mx, r) => Math.max(mx, Number(r.diff) || 0), 0);
    push({ check_id: 'reconcile:checkins_vs_sessions', severity: worst > 0.05 ? 'warning' : 'info', area: 'fct_visits', value: worst,
      detail: `Monthly attended check-ins (Checkins) vs class check-ins (Sessions), last 6 months: max difference ${(worst * 100).toFixed(1)}%. ${rows.map((r) => `${String(r.m).slice(0, 7)}: ${r.av} vs ${r.bv}`).join('; ')}` });
  }

  // 6. freshness
  const fresh: [string, string][] = [['fct_sales', 'payment_ts'], ['fct_checkins', 'session_ts'], ['fct_leads', 'created_ts'], ['fct_new_clients', 'first_visit_ts']];
  for (const [t, c] of fresh) {
    if (!(await has(t))) continue;
    const r = await db.one(`select max(${c})::varchar mx, date_diff('day', max(${c})::date, current_date) lag from ${t} where ${c} <= now()`);
    push({ check_id: `freshness:${t}`, severity: Number(r?.lag) > 3 ? 'warning' : 'info', area: t, value: Number(r?.lag), detail: `Latest record ${r?.mx} (${r?.lag} days ago).` });
  }

  // 7. imported legacy visits
  if (await has('fct_visits')) {
    const r = await db.one(`select count(*) filter (where is_imported) n, count(*) t from fct_visits`);
    push({ check_id: 'imported_visits', severity: 'info', area: 'fct_visits', value: Number(r?.n), detail: `${r?.n} imported legacy visits (placeholder date) are excluded from visit metrics by default.` });
  }

  await db.exec(`create or replace table _quality(check_id varchar, severity varchar, area varchar, value double, detail varchar, checked_at timestamp)`);
  if (out.length) await db.exec(`insert into _quality values ${out.map((r) => `(${sqlString(r.check_id)}, ${sqlString(r.severity)}, ${sqlString(r.area)}, ${r.value ?? 'null'}, ${sqlString(r.detail)}, now())`).join(',')}`);
  return out;
}
