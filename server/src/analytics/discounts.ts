/**
 * Discount economics for the Sales chapter: discounted vs full-price sales, per-code performance,
 * the revenue the discounted sales brought and a profitability verdict.
 *
 * Profitability test (transparent, behavioural — the data cannot show what a client would have
 * paid without the code):
 *  - Revenue boost = revenue from discounted sales; cost = discount value given away.
 *  - Break-even: a discount pays for itself if discounted buyers come back and spend at least the
 *    discount again within 90 days, i.e. repeat revenue per discounted buyer ≥ discount per buyer,
 *    OR the discount mainly acquires new clients (first purchase) who convert to repeat buyers at a
 *    rate at least as good as full-price buyers.
 */
import crypto from 'node:crypto';
import { warehouse, sqlString } from '../warehouse/db.js';
import { BACKEND_ACCOUNTS } from '../report/backendAccounts.js';

export async function discountAnalysis(req: { start: string; end: string; locations: string[] }) {
  const db = await warehouse();
  const w = [`payment_ts::date between ${sqlString(req.start)} and ${sqlString(req.end)}`, ...BACKEND_ACCOUNTS.map((a) => `coalesce(sold_by, '') not like ${sqlString('%' + a + '%')}`)];
  if (req.locations.length) w.push(`location in (${req.locations.map(sqlString).join(', ')})`);
  const base = `with s as (select *, coalesce(discount_amount, 0) > 0 as disc, coalesce(sale_id, sale_item_id) as txn from fct_sales where ${w.join(' and ')}),
    firsts as (select member_id, min(payment_ts) as first_ts from fct_sales where member_id is not null group by 1),
    buyer as (select member_id, bool_or(disc) as any_disc, min(payment_ts) as p_ts, sum(gross_amount) as spend, sum(coalesce(discount_amount, 0)) as disc_amt from s where member_id is not null group by 1),
    repeat as (select b.member_id, b.any_disc, b.disc_amt, f.first_ts >= b.p_ts - interval 1 day as is_new, coalesce(sum(x.gross_amount), 0) as repeat_rev
      from buyer b left join firsts f using (member_id)
      left join fct_sales x on x.member_id = b.member_id and x.payment_ts > b.p_ts + interval 1 day and x.payment_ts <= b.p_ts + interval 90 day
      group by 1, 2, 3, 4)`;
  const n = (v: unknown) => (typeof v === 'bigint' ? Number(v) : v === null || v === undefined ? null : Number(v));
  const split = (await db.all<Record<string, unknown>>(`${base}
    select case when disc then 'Discounted' else 'Full price' end as grp, count(distinct txn) as txns, count(distinct member_id) as clients,
      sum(gross_amount) as revenue, sum(coalesce(discount_amount, 0)) as discount, sum(gross_amount) / nullif(count(distinct txn), 0) as atv,
      sum(coalesce(discount_amount, 0)) / nullif(sum(gross_amount) + sum(coalesce(discount_amount, 0)), 0) as depth
    from s group by 1 order by 1`)).map((r) => ({ grp: r.grp, txns: n(r.txns), clients: n(r.clients), revenue: n(r.revenue), discount: n(r.discount), atv: n(r.atv), depth: n(r.depth) }));
  const beh = (await db.all<Record<string, unknown>>(`${base}
    select case when any_disc then 'Discounted' else 'Full price' end as grp, count(*) as buyers, avg(is_new::int) as new_share,
      avg((repeat_rev > 0)::int) as repeat_rate, avg(repeat_rev) as repeat_rev, avg(disc_amt) as disc_per_buyer
    from repeat group by 1`)).reduce((m, r) => ({ ...m, [String(r.grp)]: { new_share: n(r.new_share), repeat_rate: n(r.repeat_rate), repeat_rev: n(r.repeat_rev), disc_per_buyer: n(r.disc_per_buyer) } }), {} as Record<string, Record<string, number | null>>);
  const codes = (await db.all<Record<string, unknown>>(`${base}
    select coalesce(nullif(trim(discount_code), ''), '(no code — manual discount)') as code, count(distinct txn) as txns, count(distinct member_id) as clients,
      sum(gross_amount) as revenue, sum(coalesce(discount_amount, 0)) as discount, sum(gross_amount) / nullif(count(distinct txn), 0) as atv,
      sum(coalesce(discount_amount, 0)) / nullif(sum(gross_amount) + sum(coalesce(discount_amount, 0)), 0) as depth,
      sum(gross_amount) / nullif(sum(coalesce(discount_amount, 0)), 0) as rev_per_disc
    from s where disc group by 1 order by revenue desc limit 40`)).map((r) => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, k === 'code' ? v : n(v)])));
  if (!split.length) return null;
  const D = split.find((r) => r.grp === 'Discounted'), F = split.find((r) => r.grp === 'Full price');
  const tot = split.reduce((a, r) => a + (r.revenue ?? 0), 0);
  type B = Record<string, number | null>; const bd = (beh.Discounted ?? {}) as B, bf = (beh['Full price'] ?? {}) as B;
  const pays = (bd.repeat_rev ?? 0) >= (bd.disc_per_buyer ?? 0);
  const acquires = (bd.new_share ?? 0) > (bf.new_share ?? 0) && (bd.repeat_rate ?? 0) >= (bf.repeat_rate ?? 0) * 0.9;
  const verdictLabel = !D ? 'No discounted sales' : pays && acquires ? 'Profitable — discounts bring new clients who come back' : pays ? 'Profitable — repeat spend covers the discount' : acquires ? 'Marginal — wins new clients but repeat spend does not yet cover the discount' : 'Not profitable — discounts are subsidising clients who would likely buy anyway';
  const kpis = [
    { label: 'Revenue from discounted sales', value: D?.revenue ?? 0, format: 'currency' }, { label: 'Share of revenue discounted', value: tot ? (D?.revenue ?? 0) / tot : 0, format: 'percent' },
    { label: 'Discount given away', value: D?.discount ?? 0, format: 'currency' }, { label: 'Revenue per ₹1 discount', value: D?.discount ? (D.revenue ?? 0) / D.discount : null, format: 'decimal' },
    { label: 'ATV discounted vs full price', value: D?.atv ?? null, compare: F?.atv ?? null, format: 'currency' },
    { label: '90-day repeat rate (discounted vs full)', value: bd.repeat_rate ?? null, compare: bf.repeat_rate ?? null, format: 'percent' },
    { label: 'New-client share (discounted vs full)', value: bd.new_share ?? null, compare: bf.new_share ?? null, format: 'percent' },
    { label: 'Repeat spend vs discount per buyer', value: bd.repeat_rev ?? null, compare: bd.disc_per_buyer ?? null, format: 'currency' },
  ];
  const c = (key: string, label: string, format: string, kind = 'metric') => ({ key, label, kind, format });
  const rows = split.map((r) => ({ ...r, ...(beh[String(r.grp)] ?? {}) }));
  const mk = (title: string, columns: ReturnType<typeof c>[], rws: Record<string, unknown>[], note: string) => ({ id: `xt${crypto.randomUUID().slice(0, 6)}`, title, note,
    result: { id: 'r_' + crypto.randomUUID().slice(0, 10), kind: 'discounts', sql: [], title, columns, rows: rws, sources: ['Sales - Raw › Sales (fct_sales)'], notes: [], definitions: [], checks: [], verified: true, rowCount: rws.length } });
  return {
    verdict: verdictLabel, kpis,
    tables: [
      mk('Discounted vs full-price sales', [c('grp', 'Sale type', 'text', 'dimension'), c('txns', 'Transactions', 'number'), c('clients', 'Clients', 'number'), c('revenue', 'Revenue', 'currency'), c('discount', 'Discount given', 'currency'), c('atv', 'ATV', 'currency'), c('depth', 'Discount depth', 'percent'), c('new_share', 'New-client share', 'percent'), c('repeat_rate', '90-day repeat rate', 'percent'), c('repeat_rev', 'Repeat spend / buyer (90d)', 'currency'), c('disc_per_buyer', 'Discount / buyer', 'currency')], rows,
        `Verdict: ${verdictLabel}. A discount pays for itself when buyers come back and spend at least the discount again within 90 days, or when it mainly brings in new clients who repeat as often as full-price buyers. Behavioural test — the data cannot show what a client would have paid without the code.`),
      ...(codes.length ? [mk('Discount codes — performance', [c('code', 'Code', 'text', 'dimension'), c('txns', 'Transactions', 'number'), c('clients', 'Clients', 'number'), c('revenue', 'Revenue', 'currency'), c('discount', 'Discount given', 'currency'), c('depth', 'Discount depth', 'percent'), c('atv', 'ATV', 'currency'), c('rev_per_disc', 'Revenue per ₹1 discount', 'decimal')], codes,
        'Every code used this period (top 40 by revenue). Revenue per ₹1 discount below ~4 means the code gives away more than 20% of list value.')] : []),
    ],
  };
}
