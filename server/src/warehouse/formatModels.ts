/**
 * Format economics: client-level models that follow each client across class formats
 * (Barre / powerCycle / Strength Lab), so the business each format brings can be measured —
 * acquisition, conversion, retention, LTV, frequency, cross-format behaviour and renewals.
 *
 * fct_client_format     one row per client: first format, main format, visit mix, frequency, revenue split by visit share
 * fct_membership_format one row per membership instance, credited to the format the client used most in the
 *                       60 days before it ended (falls back to the whole membership term)
 */
import type { ModelDef } from './models.js';
import { FORMAT } from '../semantic/metrics.js';

const F = (c: string) => FORMAT(c);

export const FORMAT_MODELS: ModelDef[] = [
  {
    name: 'fct_client_format',
    grain: 'One row per client (member_id) with at least one attended class',
    description: 'Per-client format profile: first and main format, visits by format, cross-format flags, frequency, lifetime revenue and revenue split by visit share, joined to new-client outcomes.',
    raw: {},
    deps: ['fct_visits', 'fct_sales', 'fct_new_clients'],
    key: 'member_id',
    sql: () => `
      with v as (
        select member_id, ${F('class_name')} as fmt, session_ts, date_trunc('month', session_ts)::date as m, location
        from fct_visits
        where attended and not coalesce(is_imported, false) and member_id is not null and session_ts is not null),
      vf as (select * from v where fmt in ('Barre', 'powerCycle', 'Strength Lab')),
      agg as (
        select member_id,
          count(*) as visits,
          count(*) filter (where fmt = 'Barre') as barre_visits,
          count(*) filter (where fmt = 'powerCycle') as cycle_visits,
          count(*) filter (where fmt = 'Strength Lab') as strength_visits,
          count(distinct fmt) as formats_used,
          count(distinct m) as active_months,
          min(session_ts) as first_visit_ts, max(session_ts) as last_visit_ts,
          arg_min(fmt, session_ts) as first_format,
          mode(location) as home_location
        from vf group by 1),
      second as (
        select vf.member_id, min(vf.session_ts) as second_format_ts, arg_min(vf.fmt, vf.session_ts) as second_format
        from vf join agg using (member_id) where vf.fmt <> agg.first_format group by 1),
      s as (select member_id, sum(gross_amount) as lifetime_revenue from fct_sales where member_id is not null group by 1),
      n as (select member_id, any_value(is_converted) as is_converted, any_value(is_retained) as is_retained, any_value(ltv) as nc_ltv,
              min(first_visit_ts) as nc_first_visit_ts from fct_new_clients where member_id is not null group by 1)
      select a.*,
        greatest(a.barre_visits, a.cycle_visits, a.strength_visits) / a.visits::double as main_share,
        case when greatest(a.barre_visits, a.cycle_visits, a.strength_visits) / a.visits::double < 0.6 then 'Mixed'
             when a.strength_visits >= a.barre_visits and a.strength_visits >= a.cycle_visits then 'Strength Lab'
             when a.cycle_visits >= a.barre_visits then 'powerCycle' else 'Barre' end as main_format,
        case a.formats_used when 1 then 'Single format' when 2 then 'Two formats' else 'All three formats' end as format_mix,
        sc.second_format, sc.second_format_ts, date_diff('day', a.first_visit_ts, sc.second_format_ts) as days_to_second_format,
        a.visits / greatest(a.active_months, 1)::double as visits_per_active_month,
        coalesce(s.lifetime_revenue, 0) as lifetime_revenue,
        coalesce(s.lifetime_revenue, 0) * a.barre_visits / a.visits::double as barre_revenue,
        coalesce(s.lifetime_revenue, 0) * a.cycle_visits / a.visits::double as cycle_revenue,
        coalesce(s.lifetime_revenue, 0) * a.strength_visits / a.visits::double as strength_revenue,
        n.member_id is not null as is_new_client, coalesce(n.is_converted, false) as is_converted, coalesce(n.is_retained, false) as is_retained,
        n.nc_ltv, l.city
      from agg a
      left join second sc using (member_id)
      left join s using (member_id)
      left join n using (member_id)
      left join dim_location l on l.location = a.home_location`,
  },
  {
    name: 'fct_membership_format',
    grain: 'One row per membership instance (same key as fct_memberships)',
    description: 'Each membership credited to the format the client attended most in the 60 days before it ended (whole term if none), with visits by format during the term.',
    raw: {},
    deps: ['fct_memberships', 'fct_visits'],
    key: 'membership_key',
    sql: () => `
      with v as (
        select member_id, ${F('class_name')} as fmt, session_ts from fct_visits
        where attended and not coalesce(is_imported, false) and member_id is not null and session_ts is not null),
      mv as (
        select ms.membership_key, v.fmt,
          count(*) filter (where v.session_ts >= ms.end_ts - interval 60 day) as late_n,
          count(*) as term_n
        from fct_memberships ms join v on v.member_id = ms.member_id
          and v.session_ts >= coalesce(ms.start_ts, ms.end_ts - interval 365 day) and v.session_ts <= ms.end_ts
        where ms.end_ts is not null and v.fmt in ('Barre', 'powerCycle', 'Strength Lab')
        group by 1, 2),
      pick as (
        select membership_key,
          coalesce(arg_max(fmt, late_n) filter (where late_n > 0), arg_max(fmt, term_n)) as credited_format,
          sum(term_n) as term_visits,
          sum(term_n) filter (where fmt = 'Barre') as term_barre,
          sum(term_n) filter (where fmt = 'powerCycle') as term_cycle,
          sum(term_n) filter (where fmt = 'Strength Lab') as term_strength,
          count(*) as term_formats
        from mv group by 1)
      select ms.*, coalesce(p.credited_format, 'No classes') as credited_format,
        coalesce(p.term_visits, 0) as term_visits, coalesce(p.term_barre, 0) as term_barre, coalesce(p.term_cycle, 0) as term_cycle,
        coalesce(p.term_strength, 0) as term_strength, coalesce(p.term_formats, 0) as term_formats
      from fct_memberships ms left join pick p using (membership_key)`,
  },
];
