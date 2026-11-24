/**
 * Transformation layer: raw (all-text) tables -> typed, cleaned, de-duplicated
 * analytical models. Every model documents its grain and source of truth.
 *
 * Column tokens: {{alias:column}} resolve against the raw table registered
 * under `alias`. Resolution order: exact name, then unique prefix match
 * (sheet headers are sometimes long/truncated), `#n` picks the n-th prefix
 * match, a trailing `?` yields NULL when the column is absent.
 */
import { Db, sqlString } from './db.js';
import { loadRules, type BusinessRules } from './rules.js';
import { log } from '../util/log.js';
import { FORMAT_MODELS } from './formatModels.js';

export interface ModelDef {
  name: string;
  grain: string;
  description: string;
  sourceOfTruth?: string;
  raw: Record<string, string>; // alias -> raw table
  deps?: string[];             // other models
  sql: (r: BusinessRules) => string;
  key?: string;                // unique key expression, verified after build
  optional?: boolean;          // skip silently if raw table missing
}

const inList = (xs: string[]) => xs.map((x) => sqlString(x.toLowerCase())).join(', ');
const likeAny = (col: string, pats: string[]) => pats.length ? '(' + pats.map((p) => `lower(${col}) like ${sqlString(p)}`).join(' or ') + ')' : 'false';

export function macros(r: BusinessRules): string {
  const locCases = r.locations
    .map((l) => `when ${l.match.map((m) => `lower(x) like ${sqlString('%' + m + '%')}`).join(' or ')} then ${sqlString(l.location)}`)
    .join('\n      ');
  const hostCity = Object.entries(r.hosts).map(([h, v]) => `when trim(h) = ${sqlString(h)} then ${sqlString(v.city)}`).join(' ');
  return `
    create or replace macro p57_txt(x) as nullif(nullif(nullif(trim(coalesce(x, '')), ''), '-'), '\\-');
    create or replace macro p57_num(x) as try_cast(nullif(nullif(regexp_replace(trim(coalesce(x, '')), '[₹,%\\s\\\\]', '', 'g'), ''), '-') as double);
    create or replace macro p57_pct(x) as p57_num(x) / 100.0;
    create or replace macro p57_bool(x) as upper(trim(coalesce(x, ''))) in ('TRUE', 'YES', 'Y', '1');
    create or replace macro p57_ts(x) as coalesce(
      try_strptime(trim(x), ['%Y-%m-%d %H:%M:%S', '%Y-%m-%d %H:%M', '%Y-%m-%d, %H:%M:%S', '%Y-%m-%d, %H:%M',
                             '%Y-%m-%dT%H:%M:%S.%gZ', '%Y-%m-%dT%H:%M:%SZ', '%Y-%m-%dT%H:%M:%S', '%Y-%m-%d']),
      try_strptime(trim(x), ['%d/%m/%Y %H:%M:%S', '%d/%m/%Y %H:%M', '%d-%m-%Y, %H:%M:%S', '%d-%m-%Y %H:%M:%S', '%d/%m/%Y', '%d-%m-%Y']));
    create or replace macro p57_month(x) as try_strptime('01 ' || regexp_replace(trim(x), '[\\s\\-/]+', ' ', 'g'), ['%d %b %Y', '%d %B %Y']);
    create or replace macro p57_loc(x) as case
      when p57_txt(x) is null then null
      ${locCases}
      else trim(x) end;
    create or replace macro p57_host_city(h) as case ${hostCity} else null end;
  `;
}

export const MODELS: ModelDef[] = [
  {
    name: 'dim_location',
    grain: 'One row per canonical location',
    description: 'Canonical studio / partner / pop-up locations with city and type (from config/business-rules.json).',
    raw: {},
    sql: (r) => `select * from (values ${r.locations
      .map((l) => `(${sqlString(l.location)}, ${l.city ? sqlString(l.city) : 'null'}, ${sqlString(l.type)}, ${sqlString(l.short)})`)
      .join(', ')}) t(location, city, location_type, short_name)`,
    key: 'location',
  },
  {
    name: 'fct_sales',
    grain: 'One row per sale item (sale_item_id)',
    description: 'Revenue ledger. Successful, non-voided payments only. gross_amount = amount charged incl. GST; net_amount = gross − GST.',
    sourceOfTruth: 'Sales - Raw › Sales',
    raw: { s: 'raw_sales' },
    key: 'sale_item_id',
    sql: (r) => `
      select *,
        -- first purchase of all time for this member (whole sale, earliest payment)
        member_id is not null and coalesce(sale_id, sale_item_id) = first_value(coalesce(sale_id, sale_item_id))
          over (partition by member_id order by payment_ts, coalesce(sale_id, sale_item_id)) as is_first_purchase
      from (
      with base as (
        select
          p57_txt({{s:sale_item_id}}) as sale_item_id,
          p57_txt({{s:sale_id}}) as sale_id,
          p57_txt({{s:member_id}}) as member_id,
          coalesce(p57_txt({{s:paying_member_id}}), p57_txt({{s:member_id}})) as paying_member_id,
          p57_txt({{s:customer_name}}) as customer_name,
          lower(p57_txt({{s:customer_email}})) as customer_email,
          p57_ts({{s:payment_date}}) as payment_ts,
          p57_num({{s:payment_value}}) as gross_amount,
          coalesce(p57_num({{s:payment_vat}}), 0) as tax_amount,
          coalesce(p57_num({{s:paid_in_money_credits}}), 0) as money_credits_amount,
          lower(p57_txt({{s:payment_status}})) as payment_status,
          p57_bool({{s:sec_is_voided?}}) as is_voided,
          p57_txt({{s:payment_method}}) as payment_method,
          p57_txt({{s:sold_by}}) as sold_by_raw,
          p57_loc({{s:calculated_location}}) as location,
          p57_txt({{s:host_id}}) as host_id,
          p57_txt({{s:cleaned_product}}) as product,
          coalesce(p57_txt({{s:cleaned_category}}), 'Uncategorised') as category,
          p57_txt({{s:purchase_type}}) as purchase_type,
          p57_txt({{s:payment_source}}) as payment_source,
          coalesce(p57_num({{s:discount_value_in_currency}}), 0) as discount_amount,
          p57_txt({{s:discount_code}}) as discount_code,
          coalesce(p57_num({{s:sale_item_quantity}}), 1) as quantity,
          p57_txt({{s:sec_membership_type?}}) as membership_type,
          p57_ts({{s:sec_membership_start_date?}}) as membership_start_ts,
          p57_ts({{s:sec_membership_end_date?}}) as membership_end_ts,
          p57_txt({{s:payment_item?}}) as payment_item,
          p57_ts({{s:modified_at?}}) as modified_ts,
          _row_num
        from raw_sales
      )
      select * exclude (sold_by_raw, modified_ts, _row_num),
        cast(payment_ts as date) as payment_date,
        date_trunc('month', payment_ts)::date as payment_month,
        gross_amount - tax_amount as net_amount,
        coalesce(sold_by_raw, 'Online / self-serve') as sold_by,
        sold_by_raw is null as is_self_serve,
        coalesce(l.city, p57_host_city(host_id)) as city
      from base
      left join dim_location l using (location)
      where sale_item_id is not null and payment_ts is not null and gross_amount is not null
        and payment_status in (${inList(r.revenue.valid_payment_statuses)})
        ${r.revenue.exclude_voided ? 'and not is_voided' : ''}
      qualify row_number() over (partition by sale_item_id order by modified_ts desc nulls last, _row_num desc) = 1
      ) dedup`,
    deps: ['dim_location'],
  },
  {
    name: 'stg_sales_excluded',
    grain: 'One row per excluded sale item',
    description: 'Sale items excluded from revenue (failed/refunded/voided/unparseable) — kept for audit.',
    raw: { s: 'raw_sales' },
    sql: (r) => `
      select p57_txt({{s:sale_item_id}}) as sale_item_id, p57_ts({{s:payment_date}}) as payment_ts,
        p57_num({{s:payment_value}}) as gross_amount, lower(p57_txt({{s:payment_status}})) as payment_status,
        p57_bool({{s:sec_is_voided?}}) as is_voided, p57_loc({{s:calculated_location}}) as location,
        case when p57_txt({{s:sale_item_id}}) is null then 'missing sale item id'
             when p57_ts({{s:payment_date}}) is null then 'unparseable payment date'
             when p57_num({{s:payment_value}}) is null then 'unparseable payment value'
             when lower(p57_txt({{s:payment_status}})) not in (${inList(r.revenue.valid_payment_statuses)}) then 'payment status: ' || coalesce(lower(p57_txt({{s:payment_status}})), 'blank')
             else 'voided' end as reason
      from raw_sales
      where not (p57_txt({{s:sale_item_id}}) is not null and p57_ts({{s:payment_date}}) is not null and p57_num({{s:payment_value}}) is not null
        and lower(p57_txt({{s:payment_status}})) in (${inList(r.revenue.valid_payment_statuses)})
        ${r.revenue.exclude_voided ? `and not p57_bool({{s:sec_is_voided?}})` : ''})`,
  },
  {
    name: 'dim_product',
    grain: 'One row per Momence membership/package product (product_id)',
    description: 'Product catalog: type, duration, credits, price, intro-offer and auto-renew flags, active sign-ups.',
    sourceOfTruth: 'Sales - Raw › Memberships',
    raw: { p: 'raw_products' },
    optional: true,
    key: 'product_id',
    sql: () => `
      select p57_txt({{p:id}}) as product_id, p57_txt({{p:hostid}}) as host_id, p57_txt({{p:name}}) as product_name,
        p57_txt({{p:type}}) as product_type, p57_txt({{p:subscriptiontype?}}) as subscription_type,
        p57_num({{p:price}}) as price, p57_num({{p:duration}}) as duration, p57_txt({{p:durationunit}}) as duration_unit,
        p57_num({{p:numberofevents?}}) as credits, p57_bool({{p:isintrooffer?}}) as is_intro_offer,
        p57_bool({{p:autorenew?}}) as auto_renew, p57_num({{p:activesignups?}}) as active_signups,
        p57_bool({{p:isdeleted?}}) as is_deleted, p57_bool({{p:disabled?}}) as is_disabled,
        p57_host_city({{p:hostid}}) as city
      from raw_products where p57_txt({{p:id}}) is not null
      qualify row_number() over (partition by p57_txt({{p:id}}) order by _row_num) = 1`,
  },
  {
    name: 'fct_checkins',
    grain: 'One row per booking (member_id × session_id), 2024 onwards',
    description: 'Bookings with attendance from Momence check-ins. paid_amount is the per-visit recognised value of the credit/membership used.',
    sourceOfTruth: 'Day End Report - Part 4 › Checkins',
    raw: { c: 'raw_checkins' },
    key: 'visit_key',
    deps: ['dim_location'],
    sql: () => `
      with b as (
        select p57_txt({{c:member_id}}) as member_id, p57_txt({{c:session_id}}) as session_id,
          p57_ts({{c:date_ist}}) as session_ts, p57_ts({{c:order_at}}) as booked_ts,
          p57_loc({{c:location}}) as location, p57_txt({{c:host_id}}) as host_id,
          p57_txt({{c:teacher_name}}) as teacher, p57_txt({{c:session_name}}) as session_name,
          p57_txt({{c:cleaned_class}}) as class_name, p57_txt({{c:cleaned_product}}) as product,
          p57_txt({{c:cleaned_category}}) as category, p57_txt({{c:payment_method_name}}) as payment_method_name,
          coalesce(p57_num({{c:paid}}), 0) as paid_amount, p57_num({{c:capacity}}) as capacity,
          p57_num({{c:duration_minutes?}}) as duration_minutes,
          p57_bool({{c:checked_in}}) as attended, p57_bool({{c:is_late_cancelled}}) as late_cancelled,
          p57_bool({{c:complementary}}) as complimentary_flag, p57_txt({{c:is_new}}) as new_label,
          p57_txt({{c:uniqueid1?}}) as unique_id1, _row_num
        from raw_checkins
      )
      select md5(member_id || '|' || session_id) as visit_key, 'checkins' as source, b.* exclude (_row_num),
        cast(session_ts as date) as session_date, date_trunc('month', session_ts)::date as session_month,
        coalesce(l.city, p57_host_city(host_id)) as city,
        (complimentary_flag or category ilike '%complimentary%') as complimentary,
        dayname(session_ts) as day_of_week,
        case when hour(session_ts) < 12 then 'Morning' when hour(session_ts) < 17 then 'Afternoon' else 'Evening' end as time_slot,
        false as early_cancelled, false as no_show, false as is_imported
      from b left join dim_location l using (location)
      where member_id is not null and session_id is not null and session_ts is not null
      qualify row_number() over (partition by member_id, session_id order by _row_num desc) = 1`,
  },
  {
    name: 'stg_bookings',
    grain: 'One row per booking row in the 2018-2026 bookings export',
    description: 'Full booking history incl. early cancellations, no-shows and imported legacy visits.',
    sourceOfTruth: 'Bookings Data - 2018-2026 › Bookings',
    raw: { b: 'raw_bookings' },
    deps: ['dim_location'],
    sql: () => `
      with b as (
        select p57_txt({{b:member_id}}) as member_id, p57_ts({{b:session_date}}) as session_ts, p57_ts({{b:sale_date}}) as sale_ts,
          p57_num({{b:sale_value}}) as sale_value, p57_txt({{b:sale_item}}) as sale_item, p57_txt({{b:sale_id}}) as sale_id,
          p57_txt({{b:payment_method}}) as payment_method, p57_txt({{b:membership_used}}) as membership_used,
          p57_loc({{b:location_name}}) as location, p57_txt({{b:host_id}}) as host_id, p57_txt({{b:teacher_name}}) as teacher,
          p57_txt({{b:cleaned_class}}) as class_name, p57_bool({{b:attended}}) as attended, p57_bool({{b:cancelled}}) as early_cancelled,
          p57_bool({{b:late_cancelled}}) as late_cancelled, p57_bool({{b:no_show}}) as no_show, p57_txt({{b:is_new}}) as new_label,
          p57_txt({{b:uniqueid1?}}) as unique_id1, p57_txt({{b:refunded?}}) as refunded, _row_num
        from raw_bookings
      )
      select md5(coalesce(member_id,'') || '|' || coalesce(cast(session_ts as varchar),'') || '|' || coalesce(location,'') || '|' || coalesce(sale_id,'') || '|' || _row_num) as booking_key,
        b.* exclude (_row_num), cast(session_ts as date) as session_date,
        coalesce(l.city, p57_host_city(host_id)) as city,
        (payment_method = 'imported' or sale_item = 'Import Visits') as is_imported
      from b left join dim_location l using (location)
      where member_id is not null and session_ts is not null`,
  },
  {
    name: 'fct_visits',
    grain: 'One row per booking (unified history)',
    description: 'Unified bookings: Checkins (source of truth from its first session date) + Bookings history before that date. Imported legacy visits are flagged is_imported and excluded from trends by default.',
    raw: {},
    deps: ['fct_checkins', 'stg_bookings'],
    key: 'visit_key',
    sql: () => `
      with cutoff as (select min(session_date) as d from fct_checkins)
      select visit_key, source, member_id, session_id, session_ts, session_date, session_month, location, city, host_id,
        teacher, class_name, product, category, paid_amount, attended, late_cancelled, early_cancelled, no_show,
        complimentary, new_label, is_imported, day_of_week, time_slot, unique_id1
      from fct_checkins
      union all
      select booking_key as visit_key, 'bookings_history' as source, member_id, null as session_id, session_ts, session_date,
        date_trunc('month', session_ts)::date as session_month, location, city, host_id, teacher, class_name,
        membership_used as product, null as category, null as paid_amount, attended, late_cancelled, early_cancelled, no_show,
        (membership_used ilike '%complimentary%') as complimentary, new_label, is_imported,
        dayname(session_ts) as day_of_week,
        case when hour(session_ts) < 12 then 'Morning' when hour(session_ts) < 17 then 'Afternoon' else 'Evening' end as time_slot,
        unique_id1
      from stg_bookings, cutoff
      where session_date < coalesce(cutoff.d, date '2100-01-01')`,
  },
  {
    name: 'fct_sessions',
    grain: 'One row per scheduled class (session_id)',
    description: 'Class-level capacity, bookings, check-ins and revenue. Class name = the sheet\'s Class column (Session Name kept as session_title). is_past separates delivered classes from future schedule.',
    sourceOfTruth: 'Day End Report - Part 3 › Sessions',
    raw: { x: 'raw_sessions' },
    deps: ['dim_location'],
    key: 'session_id',
    sql: () => `
      with s as (
        select p57_txt({{x:sessionid}}) as session_id, p57_txt({{x:trainerid}}) as teacher_id, p57_txt({{x:trainer}}) as teacher,
          coalesce(nullif(p57_txt({{x:class}}), ''), p57_txt({{x:sessionname}})) as session_name, p57_txt({{x:sessionname}}) as session_title,
          p57_txt({{x:type}}) as class_type, p57_txt({{x:class}}) as class_format,
          p57_loc({{x:location}}) as location,
          coalesce(p57_ts(trim({{x:date}}) || ' ' || trim({{x:time}})), p57_ts({{x:date}})) as session_ts,
          coalesce(p57_num({{x:capacity}}), 0) as capacity, coalesce(p57_num({{x:checkedin}}), 0) as checked_in,
          coalesce(p57_num({{x:booked}}), 0) as booked, coalesce(p57_num({{x:latecancelled}}), 0) as late_cancelled,
          coalesce(p57_num({{x:nonpaid}}), 0) as non_paid, coalesce(p57_num({{x:revenue}}), 0) as revenue,
          coalesce(p57_num({{x:complimentary}}), 0) as complimentary, coalesce(p57_num({{x:memberships}}), 0) as membership_checkins,
          coalesce(p57_num({{x:packages}}), 0) as package_checkins, coalesce(p57_num({{x:introoffers}}), 0) as intro_offer_checkins,
          coalesce(p57_num({{x:singleclasses}}), 0) as single_class_checkins, _row_num
        from raw_sessions
      )
      select s.* exclude (_row_num), cast(session_ts as date) as session_date, date_trunc('month', session_ts)::date as session_month,
        l.city, session_ts < (now() at time zone 'Asia/Kolkata') as is_past, checked_in = 0 as is_empty,
        dayname(session_ts) as day_of_week, strftime(session_ts, '%H:%M') as start_time,
        case when hour(session_ts) < 12 then 'Morning' when hour(session_ts) < 17 then 'Afternoon' else 'Evening' end as time_slot
      from s left join dim_location l using (location)
      where session_id is not null and session_ts is not null
      qualify row_number() over (partition by session_id order by _row_num desc) = 1`,
  },
  {
    name: 'fct_new_clients',
    grain: 'One row per client (member_id) — first-visit / trial cohort record',
    description: 'First visit, trial product, conversion and retention outcome per client. New clients = Is New contains "new"; trials = every member who attended a session in the New sheet.',
    sourceOfTruth: 'Day End Report - Part 1 › New',
    raw: { n: 'raw_new_clients' },
    deps: ['dim_location'],
    key: 'member_id',
    sql: (r) => `
      with n as (
        select p57_txt({{n:member_id}}) as member_id,
          trim(coalesce(p57_txt({{n:first_name}}), '') || ' ' || coalesce(p57_txt({{n:last_name}}), '')) as client_name,
          lower(p57_txt({{n:email}})) as email, p57_txt({{n:phone_number}}) as phone,
          p57_ts({{n:first_visit_date}}) as first_visit_ts, p57_txt({{n:first_visit_entity_name}}) as first_visit_class,
          p57_txt({{n:first_visit_type}}) as first_visit_type, p57_loc({{n:first_visit_location}}) as first_visit_location,
          p57_txt({{n:membership_used}}) as trial_product, p57_loc({{n:home_location}}) as home_location,
          p57_txt({{n:trainer_name}}) as first_visit_teacher, p57_txt({{n:is_new}}) as is_new_label,
          p57_txt({{n:conversion_status}}) as conversion_status, p57_txt({{n:retention_status}}) as retention_status,
          p57_ts({{n:first_purchase_date}}) as first_purchase_ts, p57_txt({{n:first_purchase_post_trial}}) as first_purchase_product,
          p57_num({{n:first_purchase_value}}) as first_purchase_value, p57_txt({{n:first_purchase_category?}}) as first_purchase_category,
          p57_num({{n:ltv}}) as ltv, p57_num({{n:visits_post_trial}}) as visits_post_trial, p57_num({{n:no_of_visits}}) as total_visits,
          p57_ts({{n:last_visit_date}}) as last_visit_ts, p57_num({{n:conversion_span_days?}}) as days_to_convert,
          p57_txt({{n:lifecycle_status?}}) as lifecycle_status, p57_txt({{n:source?}}) as source,
          p57_txt({{n:lead_channel?}}) as lead_channel, p57_txt({{n:lead_associate?}}) as lead_associate,
          p57_txt({{n:conversion_speed_bucket?}}) as conversion_speed_bucket, p57_num({{n:trial_paid_amount?}}) as trial_paid_amount,
          _row_num
        from raw_new_clients
      )
      select n.* exclude (_row_num),
        cast(first_visit_ts as date) as first_visit_date, date_trunc('month', first_visit_ts)::date as cohort_month,
        -- new client = "Is New" contains the configured word (e.g. "New - Trial Class"); trial = attended a session (every member in the New sheet)
        coalesce(lower(is_new_label) like ${sqlString('%' + (r.status_values.new_client_is_new_contains ?? 'new').toLowerCase() + '%')}, false) as is_new_client,
        first_visit_ts is not null and coalesce(lower(is_new_label), '') not in (${inList(r.status_values.trial_not_attended_values ?? ['not attended'])}) as is_trial,
        coalesce(lower(conversion_status) in (${inList(r.status_values.converted_values)}), false) as is_converted,
        coalesce(lower(retention_status) in (${inList(r.status_values.retained_values)}), false) as is_retained,
        coalesce(l.city, null) as city
      from n left join dim_location l on l.location = n.first_visit_location
      where member_id is not null
      qualify row_number() over (partition by member_id order by _row_num desc) = 1`,
  },
  {
    name: 'fct_late_cancellations',
    grain: 'One row per late-cancelled booking (member × session × class)',
    description: 'Late cancellation events with penalty charged.',
    sourceOfTruth: 'Day End Report - Part 1 › Late Cancellations',
    raw: { x: 'raw_late_cancellations' },
    deps: ['dim_location'],
    key: 'lc_key',
    sql: () => `
      with x as (
        select p57_txt({{x:member_id}}) as member_id, p57_txt({{x:host_id}}) as host_id, p57_txt({{x:cancelled_event}}) as class_name,
          p57_ts({{x:cancelled_date}}) as cancelled_ts, p57_ts({{x:session_date}}) as session_ts,
          p57_txt({{x:membership_name}}) as membership, p57_loc({{x:home_location}}) as home_location,
          coalesce(p57_num({{x:charged_penalty}}), 0) as penalty_amount, p57_num({{x:paid}}) as paid_amount, _row_num
        from raw_late_cancellations)
      select md5(coalesce(member_id,'') || '|' || coalesce(cast(session_ts as varchar),'') || '|' || coalesce(class_name,'')) as lc_key,
        x.* exclude (_row_num), cast(session_ts as date) as session_date, date_trunc('month', session_ts)::date as session_month,
        epoch(session_ts - cancelled_ts) / 3600.0 as hours_before_class, p57_host_city(host_id) as city
      from x where member_id is not null and session_ts is not null
      qualify row_number() over (partition by lc_key order by _row_num desc) = 1`,
  },
  {
    name: 'fct_teacher_month',
    grain: 'One row per teacher × location × month',
    description: 'Teacher payroll aggregates: sessions, customers, paid value, new clients taught, conversions and retention.',
    sourceOfTruth: 'Day End Report - Part 1 › Payroll',
    raw: { x: 'raw_teacher_month' },
    deps: ['dim_location'],
    key: 'teacher_month_key',
    sql: () => `
      select md5(coalesce(p57_txt({{x:teacher_id}}),'') || '|' || coalesce(p57_txt(t.{{x:location}}),'') || '|' || coalesce(p57_txt({{x:month_year}}),'')) as teacher_month_key,
        p57_txt({{x:teacher_id}}) as teacher_id, p57_txt({{x:teacher_name}}) as teacher, p57_loc(t.{{x:location}}) as location,
        p57_month({{x:month_year}})::date as month,
        coalesce(p57_num({{x:total_sessions}}),0) as sessions, coalesce(p57_num({{x:total_empty_sessions}}),0) as empty_sessions,
        coalesce(p57_num({{x:total_non_empty_sessions}}),0) as non_empty_sessions, coalesce(p57_num({{x:total_customers}}),0) as customers,
        coalesce(p57_num({{x:total_paid}}),0) as paid_amount, coalesce(p57_num({{x:new}}),0) as new_clients,
        coalesce(p57_num({{x:converted}}),0) as converted, coalesce(p57_num({{x:retained}}),0) as retained,
        coalesce(p57_num({{x:barre_sessions?}}),0) as barre_sessions, coalesce(p57_num({{x:cycle_sessions?}}),0) as cycle_sessions,
        coalesce(p57_num({{x:strength_sessions?}}),0) as strength_sessions, l.city
      from raw_teacher_month t left join dim_location l on l.location = p57_loc(t.{{x:location}})
      where p57_txt({{x:teacher_id}}) is not null and p57_month({{x:month_year}}) is not null
      qualify row_number() over (partition by teacher_month_key order by _row_num desc) = 1`,
  },
  {
    name: 'fct_leads',
    grain: 'One row per lead (lead_id)',
    description: 'CRM leads with source, channel, stage, associate, centre and funnel outcomes. NB: "Converted At" in the sheet is when the lead was linked to a member record, not a sale.',
    sourceOfTruth: '❖ PM - Leads ❖ › ◉ Leads',
    raw: { x: 'raw_leads' },
    deps: ['dim_location'],
    key: 'lead_id',
    sql: (r) => `
      with x as (
        select p57_txt({{x:id}}) as lead_id, p57_txt({{x:full_name}}) as lead_name, p57_txt({{x:phone_number}}) as phone,
          lower(p57_txt({{x:email}})) as email, p57_ts({{x:created_at}}) as created_ts, p57_txt({{x:source_name}}) as source,
          p57_txt({{x:member_id}}) as member_id, p57_ts({{x:converted?}}) as member_linked_ts, p57_txt({{x:stage_name}}) as stage,
          p57_txt({{x:associate}}) as associate, p57_txt({{x:center}}) as center_raw, p57_loc({{x:center}}) as location,
          p57_txt({{x:class_type}}) as class_type, p57_txt({{x:host_id}}) as host_id, p57_txt({{x:status}}) as status,
          p57_txt({{x:channel}}) as channel, p57_txt({{x:utm_source?}}) as utm_source, p57_txt({{x:utm_medium?}}) as utm_medium,
          p57_txt({{x:utm_campaign?}}) as utm_campaign, p57_num({{x:purchases?}}) as purchases, p57_num({{x:ltv}}) as ltv,
          p57_num({{x:visits}}) as visits, p57_txt({{x:trial_status}}) as trial_status,
          p57_txt({{x:conversion?}}) as conversion_status, p57_txt({{x:retention?}}) as retention_status, _row_num
        from raw_leads)
      select x.* exclude (_row_num), cast(created_ts as date) as created_date, date_trunc('month', created_ts)::date as created_month,
        coalesce(l.city, p57_host_city(host_id)) as city,
        ${likeAny('trial_status', r.status_values.trial_completed_patterns)} as is_trial_completed,
        (${likeAny('trial_status', r.status_values.trial_scheduled_patterns)} or ${likeAny('trial_status', r.status_values.trial_completed_patterns)}) as is_trial_booked,
        coalesce(lower(conversion_status) in (${inList(r.status_values.lead_converted_values)}), false) as is_converted,
        coalesce(lower(retention_status) in (${inList(r.status_values.retained_values)}), false) as is_retained
      from x left join dim_location l using (location)
      where lead_id is not null and created_ts is not null
      qualify row_number() over (partition by lead_id order by _row_num desc) = 1`,
  },
  {
    name: 'fct_ad_spend',
    grain: 'One row per date × campaign × ad set × ad × platform',
    description: 'Paid ads daily delivery and cost (Meta and Google Ads, see ad_network). City / studio inferred from campaign naming (MUM_/BLR-, Bandra, Kemps/Kwality …). Campaigns without a studio in the name (city-wide / brand) are split across that city\'s studios by their share of CRM leads that month (allocated = true); totals are unchanged.',
    sourceOfTruth: '❖ PM - Leads ❖ › Meta_Daily_Data',
    raw: { x: 'raw_meta_ads' },
    deps: ['dim_location', 'fct_leads'],
    optional: true,
    // Accepts both the original Meta export (objective, adset_name, publisher) and the multi-platform layout
    // (platform, campaign_type, adset_or_adgroup_name, row_key, purchase_value).
    sql: () => `
      with x as (
        select try_cast(p57_ts({{x:date}}) as date) as ad_date,
          p57_txt({{x:row_key?}}) as row_key,
          p57_txt({{x:campaign_id}}) as campaign_id, p57_txt({{x:campaign_name}}) as campaign,
          coalesce(p57_txt({{x:objective?}}), p57_txt({{x:campaign_type?}})) as objective,
          coalesce(p57_txt({{x:adset_or_adgroup_name?}}), p57_txt({{x:adset_name?}})) as adset, p57_txt({{x:ad_name?}}) as ad,
          coalesce(p57_txt({{x:platform?}}), p57_txt({{x:publisher?}})) as platform,
          coalesce(p57_num({{x:impressions}}),0) as impressions, coalesce(p57_num({{x:reach?}}),0) as reach,
          coalesce(p57_num({{x:clicks}}),0) as clicks, coalesce(p57_num({{x:spend}}),0) as spend,
          coalesce(p57_num({{x:leads}}),0) as ad_leads, coalesce(p57_num({{x:purchases?}}),0) as ad_purchases,
          coalesce(p57_num({{x:purchase_v?}}),0) as ad_purchase_value,
          _row_num
        from raw_meta_ads where p57_ts({{x:date}}) is not null
      )
      , base as materialized (
      select ad_date, date_trunc('month', ad_date)::date as ad_month, campaign_id, campaign, objective, adset, ad, platform,
        case when platform ilike '%google%' or platform ilike '%youtube%' then 'Google Ads' else 'Meta' end as ad_network,   -- Facebook / Instagram / Messenger / Audience Network = Meta
        impressions, reach, clicks, spend, ad_leads, ad_purchases, ad_purchase_value,
        case when upper(campaign) like 'MUM%' then 'Mumbai' when upper(campaign) like 'BLR%' then 'Bengaluru' end as city,
        p57_loc(case when campaign ilike '%bandra%' or campaign ilike '%supreme%' then 'Bandra' when campaign ilike '%kemps%' or campaign ilike '%kwality%' then 'Kwality'
             when campaign ilike '%kenkere%' then 'Kenkere' when campaign ilike '%plash%' then 'Plash' when campaign ilike '%copper%' then 'Copper' end) as location
        , _row_num as rid
      from x
      -- the sheet is appended by a sync job: keep one row per row_key (latest) when the key is present
      qualify row_number() over (partition by coalesce(row_key, _row_num::varchar) order by _row_num desc) = 1
      ),
      -- studios that can receive city-wide spend, and their CRM leads per month (the allocation key)
      pool as (select location, city from dim_location where location_type in ('studio', 'partner')),
      lm as (select location, created_month as m, count(*) as n from fct_leads where location in (select location from pool) group by 1, 2),
      w as (
        select b.*, p.location as to_loc, p.city as to_city, coalesce(lm.n, 0) as n
        from base b join pool p on b.city is null or p.city = b.city
        left join lm on lm.location = p.location and lm.m = b.ad_month
        where b.location is null
      ),
      t as (select *, sum(n) over (partition by rid) as tot, count(*) over (partition by rid) as cnt from w),
      sh as (select *, case when tot > 0 then n::double / tot else 1.0::double / cnt end as share from t)
      select ad_date, ad_month, campaign_id, campaign, objective, adset, ad, platform, ad_network,
        impressions, reach, clicks, spend, ad_leads, ad_purchases, ad_purchase_value, city, location, false as allocated, 1.0::double as alloc_share
      from base where location is not null
      union all
      select ad_date, ad_month, campaign_id, campaign, objective, adset, ad, platform, ad_network,
        impressions * share, reach * share, clicks * share, spend * share, ad_leads * share, ad_purchases * share, ad_purchase_value * share,
        to_city, to_loc, true, share::double
      from sh where share > 0`,
  },
  {
    name: 'fct_memberships',
    grain: 'One row per membership instance (member × membership × start × end)',
    description: 'Membership lifecycle: status, purchase/start/end, churn date, amount paid, usage. Basis for expiries, lapse and renewal analysis.',
    sourceOfTruth: 'Lapsed New › Lapsed',
    raw: { x: 'raw_memberships' },
    deps: ['dim_location'],
    key: 'membership_key',
    sql: () => `
      with x as (
        select p57_txt({{x:member_name}}) as client_name, p57_txt({{x:member_id}}) as member_id, p57_txt({{x:host_id}}) as host_id,
          p57_txt({{x:status}}) as status, p57_txt({{x:membersh#1}}) as membership, p57_ts({{x:purchase?}}) as purchase_ts,
          p57_ts({{x:start_date}}) as start_ts, p57_ts({{x:end_date}}) as end_ts, p57_ts({{x:churned?}}) as churned_ts,
          p57_num({{x:amount_paid}}) as amount_paid, p57_txt({{x:sold_by}}) as sold_by, p57_ts({{x:most_rec?}}) as last_visit_ts,
          p57_num({{x:total_se?}}) as total_sessions, p57_num({{x:remainin?}}) as remaining_sessions,
          p57_num({{x:late_can?}}) as late_cancels, p57_num({{x:no_shows?}}) as no_shows,
          p57_loc({{x:primary?}}) as primary_location, p57_num({{x:days_frozen?}}) as days_frozen, p57_num({{x:days_active?}}) as days_active,
          _row_num
        from raw_memberships)
      select md5(coalesce(member_id,'') || '|' || coalesce(membership,'') || '|' || coalesce(cast(start_ts as varchar),'') || '|' || coalesce(cast(end_ts as varchar),'')) as membership_key,
        x.* exclude (_row_num), cast(end_ts as date) as end_date, date_trunc('month', end_ts)::date as end_month,
        cast(start_ts as date) as start_date, coalesce(l.city, p57_host_city(host_id)) as city, primary_location as location
      from x left join dim_location l on l.location = x.primary_location
      where member_id is not null
      qualify row_number() over (partition by membership_key order by _row_num desc) = 1`,
  },
  {
    name: 'fct_member_month',
    grain: 'One row per member × month (only months with activity)',
    description: 'Unpivoted member-month activity matrix (booked, visits, cancellations, paid, complimentary). Secondary to fct_visits — use for quick member-month lookups only.',
    sourceOfTruth: 'Day End Report - Part 3 › VC',
    raw: { v: 'raw_member_month_wide' },
    optional: true,
    sql: () => `/*UNPIVOT_VC*/`,
  },
  {
    name: 'dim_client',
    grain: 'One row per client (member_id)',
    description: 'Client master built from all sources: identity, home location, first visit, first purchase, lifetime revenue and visits.',
    raw: {},
    deps: ['fct_new_clients', 'fct_sales', 'fct_visits', 'fct_leads'],
    key: 'member_id',
    sql: () => `
      with ids as (
        select member_id from fct_new_clients union select member_id from fct_sales union select paying_member_id from fct_sales
        union select member_id from fct_visits union select member_id from fct_leads where member_id is not null),
      s as (select member_id, min(payment_ts) as first_purchase_ts, max(payment_ts) as last_purchase_ts,
              sum(gross_amount) as lifetime_revenue, count(distinct sale_id) as lifetime_transactions,
              arg_max(customer_name, payment_ts) as s_name, arg_max(customer_email, payment_ts) as s_email,
              mode(location) as main_purchase_location
            from fct_sales group by 1),
      v as (select member_id, min(session_ts) filter (where attended and not is_imported) as first_attended_ts,
              max(session_ts) filter (where attended) as last_visit_ts, count(*) filter (where attended) as lifetime_visits,
              mode(location) filter (where attended) as main_visit_location
            from fct_visits group by 1)
      select ids.member_id, coalesce(n.client_name, s.s_name) as client_name, coalesce(n.email, s.s_email) as email, n.phone,
        coalesce(n.home_location, v.main_visit_location, s.main_purchase_location) as home_location,
        coalesce(n.first_visit_ts, v.first_attended_ts) as first_visit_ts, s.first_purchase_ts, s.last_purchase_ts,
        v.last_visit_ts, coalesce(s.lifetime_revenue, 0) as lifetime_revenue, coalesce(s.lifetime_transactions, 0) as lifetime_transactions,
        coalesce(v.lifetime_visits, 0) as lifetime_visits, n.is_new_client, n.is_converted, n.is_retained, n.lifecycle_status,
        date_diff('day', cast(v.last_visit_ts as date), current_date) as days_since_last_visit
      from ids left join fct_new_clients n using (member_id) left join s using (member_id) left join v using (member_id)
      where ids.member_id is not null`,
  },
];
MODELS.push(...FORMAT_MODELS);

/* -------------------------------------------------------------------------- */

async function resolveTokens(db: Db, model: ModelDef, sql: string): Promise<string> {
  const colCache = new Map<string, string[]>();
  for (const [alias, table] of Object.entries(model.raw)) colCache.set(alias, (await db.columns(table)).map((c) => c.name));
  return sql.replace(/\{\{(\w+):([\w]+)(#\d+)?(\?)?\}\}/g, (_m, alias: string, name: string, nth?: string, opt?: string) => {
    const cols = colCache.get(alias);
    if (!cols) throw new Error(`[${model.name}] unknown alias ${alias}`);
    if (!nth && cols.includes(name)) return `"${name}"`;
    const matches = cols.filter((c) => c.startsWith(name));
    const idx = nth ? Number(nth.slice(1)) - 1 : 0;
    if (matches.length === 1 && !nth) return `"${matches[0]}"`;
    if (nth && matches[idx]) return `"${matches[idx]}"`;
    if (opt) return 'null';
    throw new Error(`[${model.name}] column "${name}" not found in ${model.raw[alias]} (${matches.length} prefix matches). Available: ${cols.slice(0, 60).join(', ')}`);
  });
}

async function unpivotVcSql(db: Db): Promise<string> {
  const cols = (await db.columns('raw_member_month_wide')).map((c) => c.name);
  const re = /^([a-z]{3})_(\d{4})_(booked|visits|cancel\w*|paid\w*|complim\w*)$/;
  const months = new Map<string, Record<string, string>>();
  for (const c of cols) {
    const m = c.match(re);
    if (!m) continue;
    const key = `${m[1]}_${m[2]}`;
    const kind = m[3].startsWith('cancel') ? 'cancellations' : m[3].startsWith('paid') ? 'paid' : m[3].startsWith('complim') ? 'complimentary' : m[3];
    months.set(key, { ...(months.get(key) ?? {}), [kind]: c });
  }
  if (!months.size) return `select null::varchar member_id, null::date month, 0 booked, 0 visits, 0 cancellations, 0 paid, 0 complimentary where false`;
  const parts = [...months.entries()].map(([k, m]) => {
    const [mon, yr] = k.split('_');
    const f = (x?: string) => (x ? `coalesce(p57_num("${x}"),0)` : '0');
    return `select p57_txt(member_id) as member_id, p57_loc(locations) as location, strptime('01-${mon}-${yr}', '%d-%b-%Y')::date as month,
      ${f(m.booked)} as booked, ${f(m.visits)} as visits, ${f(m.cancellations)} as cancellations, ${f(m.paid)} as paid, ${f(m.complimentary)} as complimentary
      from raw_member_month_wide`;
  });
  return `select * from (${parts.join('\nunion all\n')}) where booked + visits + cancellations + paid + complimentary > 0`;
}

export interface BuildReport { model: string; status: 'built' | 'skipped' | 'error'; rows?: number; duplicates?: number; error?: string; ms?: number }

/** Build all models (or those downstream of `changedRaw`) in dependency order. */
export async function buildModels(db: Db, changedRaw?: Set<string>): Promise<BuildReport[]> {
  const rules = loadRules();
  await db.exec(macros(rules));
  const reports: BuildReport[] = [];
  const rebuilt = new Set<string>();
  for (const m of MODELS) {
    const t0 = Date.now();
    const rawTables = Object.values(m.raw);
    const missing = [];
    for (const t of rawTables) if (!(await db.tableExists(t))) missing.push(t);
    if (missing.length) {
      reports.push({ model: m.name, status: 'skipped', error: `missing raw table(s): ${missing.join(', ')}` });
      if (!m.optional) log.warn({ model: m.name, missing }, 'model skipped');
      // keep downstream models working with an empty-but-typed table if it existed before
      continue;
    }
    const upstreamChanged = !changedRaw || rawTables.some((t) => changedRaw.has(t)) || (m.deps ?? []).some((d) => rebuilt.has(d))
      || !(await db.tableExists(m.name)) || m.name === 'dim_location';
    if (!upstreamChanged) { reports.push({ model: m.name, status: 'skipped', error: 'unchanged' }); continue; }
    try {
      let sql = m.sql(rules);
      if (sql.includes('/*UNPIVOT_VC*/')) sql = await unpivotVcSql(db);
      sql = await resolveTokens(db, m, sql);
      await db.exec(`create or replace table ${m.name} as ${sql}`);
      const rows = Number((await db.one(`select count(*) n from ${m.name}`))?.n ?? 0);
      let duplicates = 0;
      if (m.key) duplicates = Number((await db.one(`select count(*) - count(distinct ${m.key}) n from ${m.name}`))?.n ?? 0);
      rebuilt.add(m.name);
      reports.push({ model: m.name, status: 'built', rows, duplicates, ms: Date.now() - t0 });
    } catch (e) {
      reports.push({ model: m.name, status: 'error', error: (e as Error).message });
      log.error({ model: m.name, err: (e as Error).message }, 'model build failed');
    }
  }
  await db.exec(`create or replace table _model_build as select * from (values ${reports
    .map((r) => `(${sqlString(r.model)}, ${sqlString(r.status)}, ${r.rows ?? 'null'}, ${r.duplicates ?? 'null'}, ${r.error ? sqlString(r.error.slice(0, 500)) : 'null'}, now())`)
    .join(',')}) t(model, status, rows, duplicates, error, built_at)`);
  return reports;
}
