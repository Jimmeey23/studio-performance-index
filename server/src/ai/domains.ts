/**
 * Expert workspaces. Each is run by a domain-expert sub-agent: a specialist
 * brief (KPI tree, diagnostic playbook, data pitfalls, levers) layered on the
 * core analyst, plus a comprehensive dashboard of widgets and preset questions.
 */
type F = { dimension: string; op?: 'in' | 'not_in'; values: string[] };
export type Widget = (
  | { type: 'kpis'; title: string; metrics: string[] }
  | { type: 'chart'; title: string; metrics: string[]; dimension?: string; chart: 'line' | 'bar' | 'area' | 'stacked_bar' | 'horizontal_bar' | 'pie'; grain?: 'week' | 'month' | 'quarter'; span?: 1 | 2 }
  | { type: 'table'; title: string; metrics: string[]; dimensions: string[]; view?: 'table' | 'grouped' | 'ranked' | 'heatmap' | 'pivot' | 'transposed' | 'cards'; limit?: number; span?: 1 | 2; sort?: string }
  | { type: 'mom'; title: string; metrics: string[]; dimension?: string }
  | { type: 'ranking'; title: string; metric: string; dimension: string; extra?: string[]; limit?: number; span?: 1 | 2 }
  | { type: 'analysis'; title: string; tool: 'forecast' | 'funnel' | 'cohort_retention' | 'renewal_analysis' | 'winback_analysis' | 'detect_anomalies' | 'format_overlap'; input: Record<string, unknown>; block: 'forecast_chart' | 'funnel' | 'heatmap' | 'table'; span?: 1 | 2 }
) & { filters?: F[]; section?: string };

export interface Domain {
  id: string; label: string; icon: string; blurb: string;
  expert: string;
  kpis: string[];
  widgets: Widget[];
  presets: string[];
}


const NOT_OTHER = [{ dimension: 'format', op: 'not_in' as const, values: ['Other', '(blank)'] }];
const COMMON_METHOD = `Method: (1) restate the question as a metric + segment + period; (2) pull the headline and its comparison; (3) decompose the change (mix vs rate, volume vs price, by location/segment) to find where it comes from; (4) test at least one alternative explanation (seasonality, calendar/partial month, a one-off annual sale, data coverage); (5) quantify the opportunity in ₹ or clients; (6) recommend 2–4 actions with owner, timing and the metric that will show it worked. Flag small samples (< 30 records) and maturing cohorts.`;

export const DOMAINS: Domain[] = [
  {
    id: 'sales', label: 'Sales & revenue', icon: 'IndianRupee',
    blurb: 'Revenue, transactions, product mix, pricing, discounts and associate performance.',
    expert: `You are the Sales & Revenue expert for Physique 57 India — a commercial finance lead for a premium boutique barre brand.
KPI tree: Revenue = paying clients × purchases per client × ATV. ATV is driven by product mix (annual / 6-month / 3-month / monthly unlimited vs class packs vs singles), discount rate and GST. Membership revenue share indicates recurring-revenue quality.
Know the data: revenue is cash collected (incl. GST) per sale item; annual memberships make some months (e.g. April, August) lumpy, so compare like-for-like months and look at transactions and clients as well as rupees. "Online / self-serve" means no associate. Privates, retail and money credits are separate categories. Money-credit redemptions are not double counted.
Diagnostics you use: YoY revenue bridge (volume vs price vs mix), product-family mix shift, discount leakage by code and associate, associate productivity (revenue, transactions, ATV per associate), location contribution and growth, self-serve share.
Typical levers: upsell packs → unlimited, annual/6-month pushes timed to renewal windows, tighten discount codes, associate targets and coaching, bundles for newcomers, pricing tests by studio.
${COMMON_METHOD}`,
    kpis: ['revenue', 'net_revenue', 'transactions', 'units_sold', 'paying_clients', 'atv', 'revenue_per_client', 'new_revenue', 'repeat_revenue', 'new_revenue_share', 'new_buyers', 'membership_rev_share', 'discount_amount', 'discount_rate', 'avg_unit_price', 'discounted_txn_share'],
    widgets: [
      { type: 'kpis', title: 'Headline', metrics: ['revenue', 'net_revenue', 'transactions', 'units_sold', 'paying_clients', 'atv', 'revenue_per_client', 'new_revenue', 'repeat_revenue', 'new_revenue_share', 'new_buyers', 'membership_rev_share', 'discount_amount', 'discount_rate', 'avg_unit_price', 'discounted_txn_share'] },
      { type: 'chart', title: 'New vs repeat revenue', metrics: ['new_revenue', 'repeat_revenue'], chart: 'stacked_bar', span: 2 },
      { type: 'table', title: 'New vs repeat by location', metrics: ['revenue', 'new_revenue', 'repeat_revenue', 'new_revenue_share', 'new_buyers'], dimensions: ['location'] },
      { type: 'chart', title: 'Revenue by location', metrics: ['revenue'], dimension: 'location', chart: 'stacked_bar', span: 2 },
      { type: 'chart', title: 'Revenue by product family', metrics: ['revenue'], dimension: 'product_family', chart: 'area' },
      { type: 'chart', title: 'Transactions, units & paying clients', metrics: ['transactions', 'units_sold', 'paying_clients'], chart: 'line' },
      { type: 'table', title: 'Location scorecard', metrics: ['revenue', 'net_revenue', 'transactions', 'units_sold', 'paying_clients', 'atv', 'avg_unit_price', 'discount_amount', 'discount_rate', 'discounted_txn_share', 'membership_rev_share'], dimensions: ['location'], span: 2 },
      { type: 'chart', title: 'Discount value & discount %', metrics: ['discount_amount', 'discount_rate'], chart: 'line', span: 2 },
      { type: 'table', title: 'Product families', metrics: ['revenue', 'units_sold', 'transactions', 'avg_unit_price', 'discount_amount', 'discount_rate'], dimensions: ['product_family'] },
      { type: 'table', title: 'Top products', metrics: ['revenue', 'units_sold', 'transactions', 'avg_unit_price', 'atv', 'discount_amount', 'discount_rate'], dimensions: ['product'], span: 2, limit: 25 },
      { type: 'table', title: 'Associate leaderboard', metrics: ['revenue', 'transactions', 'units_sold', 'paying_clients', 'atv', 'discount_amount', 'discount_rate', 'discounted_txn_share'], dimensions: ['sold_by'], span: 2, limit: 20 },
      { type: 'table', title: 'Category × location', metrics: ['revenue', 'transactions', 'units_sold', 'discount_amount', 'discount_rate'], dimensions: ['category', 'location'], view: 'grouped', span: 2 },
      { type: 'table', title: 'Discount codes', metrics: ['discount_amount', 'transactions', 'units_sold', 'revenue', 'list_value', 'discount_rate', 'avg_discount'], dimensions: ['discount_code'], limit: 20 },
      { type: 'table', title: 'Payment methods', metrics: ['revenue', 'transactions', 'units_sold', 'atv'], dimensions: ['payment_method'] },
      { type: 'mom', title: 'Month-on-month', metrics: ['revenue', 'net_revenue', 'transactions', 'units_sold', 'paying_clients', 'atv', 'discount_amount', 'discount_rate'] },
      { type: 'analysis', title: 'Revenue forecast', tool: 'forecast', input: { metric: 'revenue', horizon: 3 }, block: 'forecast_chart', span: 2 },
    ],
    presets: [
      'Month-on-month revenue table for the last 14 months, paying clients and ATV, with last year alongside.',
      'Break down last month\'s revenue change vs last year into volume, price and product mix.',
      'Rank sales associates by revenue, transactions and ATV for the last 3 months.',
      'Which discount codes cost us the most last quarter, and what share of list value did we give away?',
      'How has the product-family mix shifted vs last year, and what did it do to ATV?',
      'Forecast revenue for the next 3 months by location.',
    ],
  },
  {
    id: 'leads', label: 'Leads & marketing', icon: 'Megaphone',
    blurb: 'Lead volume and quality, sources, channels, associates, pipeline and Meta ads efficiency.',
    expert: `You are the Leads & Marketing expert — a growth marketer who owns the funnel from enquiry to first visit and member.
KPI tree: Members from leads = leads × lead→trial rate × trial→member rate. Paid efficiency = spend ÷ leads (CPL) and spend ÷ converted leads (cost per member).
Know the data: CRM leads carry source, channel, centre, associate, stage/status, trial status and conversion status. "Converted At" is when the lead was linked to a member record, not a sale. Meta numbers are platform-reported (leads, purchases, ROAS) and are not reconciled with the sales ledger. Website leads dominate volume; referrals and walk-ins usually convert best — check it in our data before saying it.
Diagnostics: source/channel conversion matrix (volume vs rate), associate conversion and pipeline hygiene (open vs lost), lead-to-trial leakage by centre, Meta CPL and CTR by campaign/city, cohort maturity of recent leads.
Levers: shift budget to channels with lower cost per member, speed-to-lead and follow-up cadence, trial booking scripts, referral incentives, campaign creative refresh when CTR falls.
${COMMON_METHOD}`,
    kpis: ['leads', 'lead_trials', 'lead_to_trial_rate', 'lead_conversions', 'lead_conversion_rate', 'open_leads', 'ad_spend', 'cost_per_lead'],
    widgets: [
      { type: 'kpis', title: 'Headline', metrics: ['leads', 'lead_trials', 'lead_to_trial_rate', 'lead_conversions', 'lead_conversion_rate', 'open_leads', 'ad_spend', 'cost_per_lead'] },
      { type: 'chart', title: 'Leads by channel', metrics: ['leads'], dimension: 'channel', chart: 'stacked_bar', span: 2 },
      { type: 'chart', title: 'Lead→trial and lead→member rates', metrics: ['lead_to_trial_rate', 'lead_conversion_rate'], chart: 'line' },
      { type: 'chart', title: 'Paid ad spend by network', metrics: ['ad_spend'], dimension: 'ad_network', chart: 'bar' },
      { type: 'table', title: 'Source performance', metrics: ['leads', 'lead_trials', 'lead_to_trial_rate', 'lead_conversions', 'lead_conversion_rate', 'trial_to_member_rate'], dimensions: ['source'], span: 2, limit: 25 },
      { type: 'ranking', title: 'Associate conversions', metric: 'lead_conversions', dimension: 'associate', extra: ['leads', 'lead_conversion_rate', 'open_leads'], limit: 12 },
      { type: 'table', title: 'Centre funnel', metrics: ['leads', 'lead_trials', 'lead_to_trial_rate', 'lead_conversions', 'lead_conversion_rate'], dimensions: ['location'] },
      { type: 'table', title: 'Paid ad campaigns (Meta + Google)', metrics: ['ad_spend', 'impressions', 'ad_clicks', 'ctr', 'ad_leads', 'cost_per_lead', 'cpc'], dimensions: ['campaign'], span: 2, limit: 20 },
      { type: 'analysis', title: 'Lead funnel by channel', tool: 'funnel', input: { type: 'leads', split_by: 'channel' }, block: 'funnel', span: 2 },
      { type: 'mom', title: 'Month-on-month', metrics: ['leads', 'lead_trials', 'lead_conversions', 'lead_conversion_rate', 'ad_spend', 'cost_per_lead'] },
    ],
    presets: [
      'Month-on-month leads, trials and conversions for the last 14 months.',
      'Which lead sources convert best to members? Rank by conversion rate with volume.',
      'Associate leaderboard: leads handled, trials, conversions and conversion rate last quarter.',
      'Paid ads (Meta + Google): spend, leads and cost per lead by network, city and campaign for the last 2 months.',
      'Lead funnel by centre for the last 3 months — where do we lose people?',
    ],
  },
  {
    id: 'funnel', label: 'Conversion funnel', icon: 'Filter',
    blurb: 'First visits, trial products, second visits, trial→paid conversion and speed to convert.',
    expert: `You are the Conversion expert — you own a newcomer's journey from first class to first paid purchase.
KPI tree: Converted = new clients × second-visit rate × conversion of returners. Watch zero-return rate (never came back), days to convert (median and mean), first purchase value and early LTV.
Know the data: the first-visit cohort comes from Part 1 › New; "Not New" legacy records are excluded. Conversion and retention are cohort outcomes, so the last 30–60 days are still maturing — never call a recent dip a decline without saying this. Trial products include Open Barre, referral classes, 2-for-1 and paid singles; the first-visit teacher matters.
Diagnostics: conversion by trial product, teacher, location, time slot and source; second-visit rate as the leading indicator; speed-to-convert buckets; first-purchase product mix.
Levers: 48-hour follow-up after a first class, booking the second class before they leave, teacher allocation for newcomer-heavy slots, intro offer redesign, newcomer-friendly class formats.
${COMMON_METHOD}`,
    kpis: ['new_clients', 'second_visit_rate', 'zero_return_rate', 'converted_clients', 'conversion_rate', 'retention_rate', 'median_days_to_convert', 'avg_first_purchase'],
    widgets: [
      { type: 'kpis', title: 'Headline', metrics: ['new_clients', 'second_visit_rate', 'zero_return_rate', 'converted_clients', 'conversion_rate', 'retention_rate', 'median_days_to_convert', 'avg_first_purchase'] },
      { type: 'chart', title: 'New clients by location', metrics: ['new_clients'], dimension: 'location', chart: 'stacked_bar', span: 2 },
      { type: 'chart', title: 'Conversion rate by location', metrics: ['conversion_rate'], dimension: 'location', chart: 'line' },
      { type: 'chart', title: 'Second-visit vs conversion', metrics: ['second_visit_rate', 'conversion_rate'], chart: 'line' },
      { type: 'table', title: 'Trial products', metrics: ['new_clients', 'second_visit_rate', 'conversion_rate', 'retention_rate', 'avg_days_to_convert', 'avg_first_purchase'], dimensions: ['trial_product'], span: 2, limit: 20 },
      { type: 'ranking', title: 'First-visit teachers by conversion', metric: 'conversion_rate', dimension: 'teacher', extra: ['new_clients', 'converted_clients'], limit: 15 },
      { type: 'table', title: 'First-visit time slots', metrics: ['new_clients', 'conversion_rate', 'second_visit_rate'], dimensions: ['prime_time', 'day_of_week'], view: 'grouped' },
      { type: 'table', title: 'Sources', metrics: ['new_clients', 'conversion_rate', 'retention_rate', 'new_client_avg_ltv'], dimensions: ['source'], limit: 15 },
      { type: 'analysis', title: 'New-client funnel by location', tool: 'funnel', input: { type: 'new_clients', split_by: 'location' }, block: 'funnel', span: 2 },
      { type: 'mom', title: 'Month-on-month', metrics: ['new_clients', 'second_visit_rate', 'conversion_rate', 'retention_rate', 'avg_days_to_convert'] },
    ],
    presets: [
      'Trial→paid conversion by trial product for the last 6 months, with volumes.',
      'Which teachers convert first-time clients best? Minimum 20 new clients.',
      'What share of new clients never come back after the first class, by location and slot?',
      'How long does it take new clients to convert, and does faster conversion retain better?',
    ],
  },
  {
    id: 'retention', label: 'Retention & cohorts', icon: 'Repeat',
    blurb: 'Active clients, visit frequency, cohort retention and lifetime value.',
    expert: `You are the Retention expert — you own habit formation and the active client base.
KPI tree: Active paying clients = retained base + new converts − lapses. Frequency (visits per client) is the strongest leading indicator of renewal. Track paying vs total visiting clients (complimentary/staff visits inflate totals).
Know the data: visits come from Check-ins (2024+) with older history from Bookings; imported legacy visits and future bookings are excluded. Cohort retention (first visit or first purchase) shows M1/M3/M6 drop-off.
Diagnostics: cohort heatmaps, frequency distribution by location and product, show-up rate, paying vs total active clients, retention of new clients by trial product and teacher.
Levers: first-30-day onboarding, milestone recognition, habit nudges for clients whose frequency drops, class mix for retention-heavy formats, membership vs pack migration.
${COMMON_METHOD}`,
    kpis: ['visiting_clients', 'paying_visiting_clients', 'visits', 'visits_per_client', 'show_up_rate', 'unique_bookers', 'retention_rate', 'new_client_avg_ltv'],
    widgets: [
      { type: 'kpis', title: 'Headline', metrics: ['visiting_clients', 'paying_visiting_clients', 'visits', 'visits_per_client', 'show_up_rate', 'unique_bookers', 'retention_rate', 'new_client_avg_ltv'] },
      { type: 'chart', title: 'Paying vs total visiting clients', metrics: ['visiting_clients', 'paying_visiting_clients'], chart: 'line', span: 2 },
      { type: 'chart', title: 'Visits per client by location', metrics: ['visits_per_client'], dimension: 'location', chart: 'line' },
      { type: 'chart', title: 'Visits by paid product', metrics: ['visits'], dimension: 'category', chart: 'stacked_bar' },
      { type: 'table', title: 'Location retention scorecard', metrics: ['visiting_clients', 'paying_visiting_clients', 'visits', 'visits_per_client', 'show_up_rate'], dimensions: ['location'], span: 2 },
      { type: 'analysis', title: 'Cohort retention (first-visit cohorts)', tool: 'cohort_retention', input: { months: 6 }, block: 'heatmap', span: 2 },
      { type: 'analysis', title: 'Cohort retention (first-purchase cohorts)', tool: 'cohort_retention', input: { months: 6, basis: 'first_purchase', activity: 'purchase' }, block: 'heatmap', span: 2 },
      { type: 'mom', title: 'Month-on-month', metrics: ['visiting_clients', 'paying_visiting_clients', 'visits', 'visits_per_client', 'show_up_rate'] },
    ],
    presets: [
      'Cohort retention by first-visit month for the last 12 months — where is the biggest drop?',
      'Active paying vs total clients month-on-month for the last 14 months, by location.',
      'Which locations have the highest visits per client, and how has that changed vs last year?',
      'Purchase-based cohort retention for first-time buyers in the last 9 months.',
    ],
  },
  {
    id: 'churn', label: 'Churn & win-backs', icon: 'UserMinus',
    blurb: 'Lapsed memberships, churn rate, value lost, the lapsed pool and reactivations.',
    expert: `You are the Churn expert — you quantify and reverse lapse.
KPI tree: Churn = lapsed ÷ (renewed + lapsed) by membership end date; value lost = amount paid on lapsed memberships; win-backs = purchases after 90+ days without a visit.
Know the data: the Lapsed sheet status (Renewed / Lapsed / Active / Frozen / Not Activated) counts any later purchase as a renewal; the strict renewal analysis requires a membership/package repurchase. Complimentary, staff, referral and intro products inflate counts — segment by product family. The lapsed pool comes from the client master (last visit 90–365 days, lifetime revenue > 0).
Diagnostics: churn by membership type, location and seller; value at risk; lapsed pool by lifetime value; win-back rate trend; usage before lapse (remaining sessions, last visit).
Levers: save offers before expiry, win-back campaigns prioritised by LTV, pause/freeze options instead of lapse, associate ownership of high-value lapses.
${COMMON_METHOD}`,
    kpis: ['memberships_expiring', 'lapsed_memberships', 'churn_rate', 'lapsed_value', 'sheet_renewal_rate', 'expiring_value'],
    widgets: [
      { type: 'kpis', title: 'Headline', metrics: ['memberships_expiring', 'lapsed_memberships', 'churn_rate', 'lapsed_value', 'sheet_renewal_rate', 'expiring_value'] },
      { type: 'chart', title: 'Lapsed vs renewed memberships', metrics: ['lapsed_memberships', 'memberships_renewed_flag'], chart: 'stacked_bar', span: 2 },
      { type: 'chart', title: 'Churn rate by location', metrics: ['churn_rate'], dimension: 'location', chart: 'line' },
      { type: 'chart', title: 'Lapsed value by product family', metrics: ['lapsed_value'], dimension: 'product_family', chart: 'pie' },
      { type: 'table', title: 'Churn by membership', metrics: ['memberships_expiring', 'lapsed_memberships', 'churn_rate', 'lapsed_value'], dimensions: ['membership'], span: 2, limit: 25 },
      { type: 'table', title: 'Churn by location', metrics: ['memberships_expiring', 'lapsed_memberships', 'churn_rate', 'lapsed_value'], dimensions: ['location'] },
      { type: 'analysis', title: 'Win-backs by month', tool: 'winback_analysis', input: { group_by: 'month' }, block: 'table' },
      { type: 'mom', title: 'Month-on-month', metrics: ['memberships_expiring', 'lapsed_memberships', 'churn_rate', 'lapsed_value'] },
    ],
    presets: [
      'How big is the lapsed client pool by location and lifetime value?',
      'Win-backs month-on-month: clients and revenue from people inactive 90+ days.',
      'Which membership types churn most, and how much value did we lose last quarter?',
      'Who are the highest-value clients who lapsed in the last 60 days?',
    ],
  },
  {
    id: 'renewals', label: 'Renewals', icon: 'RefreshCcw',
    blurb: 'Expiries, renewal rates (strict and sheet), pending renewals and at-risk members.',
    expert: `You are the Renewals expert.
KPI tree: Renewal rate = renewed ÷ (renewed + closed windows). Use renewal_analysis for the strict rate (membership/package repurchase from start to 30 days after end) and the sheet status rate as a cross-check — always say which. Value at stake = amount paid on memberships ending.
Diagnostics: renewal by location, membership type, seller and usage; pending renewals in the next 30 days; renewal timing (early vs late); renewal product (upgrade/downgrade).
Levers: 14-day pre-expiry outreach, upgrade offers for heavy users, associate ownership lists, auto-renew adoption.
${COMMON_METHOD}`,
    kpis: ['memberships_expiring', 'memberships_renewed_flag', 'sheet_renewal_rate', 'expiring_value'],
    widgets: [
      { type: 'kpis', title: 'Headline', metrics: ['memberships_expiring', 'members_expiring', 'memberships_renewed_flag', 'sheet_renewal_rate', 'expiring_value', 'lapsed_value'] },
      { type: 'analysis', title: 'Strict renewal rate by location (last 6 months)', tool: 'renewal_analysis', input: { group_by: 'location' }, block: 'table', span: 2 },
      { type: 'chart', title: 'Renewal rate (sheet) by location', metrics: ['sheet_renewal_rate'], dimension: 'location', chart: 'line' },
      { type: 'chart', title: 'Memberships ending', metrics: ['memberships_expiring'], dimension: 'product_family', chart: 'stacked_bar' },
      { type: 'table', title: 'Renewal by membership', metrics: ['memberships_expiring', 'sheet_renewal_rate', 'expiring_value'], dimensions: ['membership'], span: 2, limit: 25 },
      { type: 'ranking', title: 'Sellers by renewals', metric: 'memberships_renewed_flag', dimension: 'sold_by', extra: ['memberships_expiring', 'sheet_renewal_rate'], limit: 12 },
      { type: 'analysis', title: 'Strict renewal rate by month', tool: 'renewal_analysis', input: { group_by: 'month' }, block: 'table' },
      { type: 'mom', title: 'Month-on-month', metrics: ['memberships_expiring', 'memberships_renewed_flag', 'sheet_renewal_rate', 'expiring_value'] },
    ],
    presets: [
      'Renewal rate by location for the last 6 months, both definitions.',
      'Which members are up for renewal in the next 30 days and haven\'t renewed?',
      'Renewal rate by membership type — which products renew worst?',
      'Month-on-month renewal rate for the last 14 months.',
    ],
  },
  {
    id: 'late_cancels', label: 'Late cancellations', icon: 'CalendarX',
    blurb: 'Late-cancel volume and rate, notice given, repeat cancellers, classes and penalties.',
    expert: `You are the Late Cancellation expert.
KPI tree: Late-cancel rate = late cancels ÷ bookings; capacity lost = late cancels that weren't backfilled; penalty yield = penalties ÷ late cancels.
Know the data: rates come from bookings (fct_visits); the dedicated late-cancellation log adds notice given and penalties. Notice bands (<1h, 1–3h, 3–6h…) show policy pressure.
Diagnostics: rate by location, class, slot, weekday, membership type; repeat cancellers (distinct clients vs events); penalty enforcement; notice distribution.
Levers: enforce penalties consistently, reminder nudges before the cut-off, waitlist auto-fill, policy differences for unlimited vs pack holders.
${COMMON_METHOD}`,
    kpis: ['late_cancellations', 'late_cancel_rate', 'bookings', 'late_cancel_events', 'late_cancel_clients', 'late_cancel_penalties', 'avg_notice_hours'],
    widgets: [
      { type: 'kpis', title: 'Headline', metrics: ['bookings', 'late_cancellations', 'late_cancel_rate', 'late_cancel_clients', 'late_cancel_penalties', 'avg_notice_hours'] },
      { type: 'chart', title: 'Late-cancel rate by location', metrics: ['late_cancel_rate'], dimension: 'location', chart: 'line', span: 2 },
      { type: 'chart', title: 'Notice given', metrics: ['late_cancel_events'], dimension: 'notice', chart: 'stacked_bar' },
      { type: 'chart', title: 'Late cancels by weekday', metrics: ['late_cancel_events'], dimension: 'day_of_week', chart: 'stacked_bar' },
      { type: 'table', title: 'Classes', metrics: ['bookings', 'late_cancellations', 'late_cancel_rate'], dimensions: ['class_name'], span: 2, limit: 20 },
      { type: 'table', title: 'Slots', metrics: ['bookings', 'late_cancellations', 'late_cancel_rate'], dimensions: ['location', 'time_slot'], view: 'grouped' },
      { type: 'ranking', title: 'Memberships with most late cancels', metric: 'late_cancel_events', dimension: 'membership', extra: ['late_cancel_clients', 'late_cancel_penalties'], limit: 12 },
      { type: 'mom', title: 'Month-on-month', metrics: ['bookings', 'late_cancellations', 'late_cancel_rate'] },
    ],
    presets: [
      'Late-cancel rate by location and time slot last month.',
      'Month-on-month late cancellations and rate for the last 14 months.',
      'How much notice do late cancellers give, and does it vary by membership?',
      'How much penalty did we charge vs number of late cancellations by month?',
    ],
  },
  {
    id: 'classes', label: 'Class performance', icon: 'CalendarRange',
    blurb: 'Fill, class size, show-up, empty classes, yield and schedule slots by format, teacher and studio.',
    expert: `You are the Class Performance expert — a scheduling and yield analyst.
KPI tree: Check-ins = classes × capacity × fill. Fill = booking fill × show-up. Yield = revenue per attendee and per seat; unsold-seat opportunity = unsold seats × revenue per attendee.
Know the data: classes come from Sessions (past only by default); a "recurring class" is studio + class + weekday + time; slots are weekday + time; room size bands come from capacity. Class revenue is usage-based (not cash).
Diagnostics: fill and class average by recurring class, slot, format, teacher and room size; empty-class rate; booking fill vs show-up gaps; prime vs off-peak; weekday vs weekend.
Levers: cut or merge chronic under-fillers (state the evidence: ≥ 6 sessions, fill < 35%), add capacity at over-subscribed slots, move formats to better slots, teacher swaps on matched slots.
${COMMON_METHOD}`,
    kpis: ['classes', 'class_checkins', 'fill_rate', 'booking_fill_rate', 'class_show_up_rate', 'class_average', 'empty_class_rate', 'revenue_per_attendee'],
    widgets: [
      { type: 'kpis', title: 'Headline', metrics: ['classes', 'class_checkins', 'fill_rate', 'booking_fill_rate', 'class_show_up_rate', 'class_average', 'empty_class_rate', 'revenue_per_attendee'] },
      { type: 'chart', title: 'Fill rate by location', metrics: ['fill_rate'], dimension: 'location', chart: 'line', span: 2 },
      { type: 'chart', title: 'Check-ins by class type', metrics: ['class_checkins'], dimension: 'class_type', chart: 'stacked_bar' },
      { type: 'chart', title: 'Unsold-seat opportunity', metrics: ['lost_revenue'], dimension: 'location', chart: 'bar' },
      { type: 'table', title: 'Recurring classes', metrics: ['classes', 'fill_rate', 'class_average', 'empty_classes', 'revenue_per_class'], dimensions: ['recurring_class'], span: 2, limit: 40 },
      { type: 'table', title: 'Slot heatmap (fill)', metrics: ['fill_rate', 'class_average', 'classes'], dimensions: ['day_of_week', 'hour'], view: 'grouped', span: 2 },
      { type: 'ranking', title: 'Formats', metric: 'class_average', dimension: 'class_name', extra: ['classes', 'fill_rate', 'empty_class_rate'], limit: 15 },
      { type: 'table', title: 'Room size', metrics: ['classes', 'capacity', 'fill_rate', 'class_average'], dimensions: ['room_size'] },
      { type: 'table', title: 'Prime vs off-peak', metrics: ['classes', 'fill_rate', 'class_average', 'revenue_per_seat'], dimensions: ['prime_time', 'location'], view: 'grouped' },
      { type: 'mom', title: 'Month-on-month', metrics: ['classes', 'class_checkins', 'fill_rate', 'class_average', 'empty_class_rate'] },
    ],
    presets: [
      'Lowest fill-rate recurring classes by studio last 3 months (minimum 6 sessions).',
      'Fill rate by day of week and time slot for each studio, last 3 months.',
      'Which slots are over-subscribed (high booking fill) and could take more capacity?',
      'Which class formats have the most empty classes?',
    ],
  },
  {
    id: 'teachers', label: 'Teachers', icon: 'GraduationCap',
    blurb: 'Sessions taught, class averages, empty classes, attributed revenue, newcomer conversion and retention.',
    expert: `You are the Teacher Performance expert — fair, evidence-based and volume-aware.
KPI tree: Teacher impact = class average (draw) × sessions + newcomer conversion and retention. Normalise for slot and studio: compare teachers on matched classes where possible.
Know the data: payroll aggregates (sessions, customers, paid, new, converted, retained) by teacher × location × month; class-level detail from Sessions. Small samples are common — require ≥ 20 newcomers or ≥ 12 sessions before ranking.
Diagnostics: class average and empty-class rate, newcomer conversion/retention vs studio average, revenue per session, trend over months, format specialisation.
Levers: put strong converters on newcomer-heavy slots, coaching for low retention, rebalance schedules.
${COMMON_METHOD}`,
    kpis: ['teacher_sessions', 'teacher_customers', 'teacher_avg_class', 'teacher_empty_rate', 'teacher_paid', 'teacher_conversion_rate', 'teacher_retention_rate'],
    widgets: [
      { type: 'kpis', title: 'Headline', metrics: ['teacher_sessions', 'teacher_customers', 'teacher_avg_class', 'teacher_empty_rate', 'teacher_paid', 'teacher_new_clients', 'teacher_conversion_rate', 'teacher_retention_rate'] },
      { type: 'table', title: 'Teacher scorecard', metrics: ['teacher_sessions', 'teacher_customers', 'teacher_avg_class', 'teacher_empty_rate', 'teacher_paid', 'teacher_new_clients', 'teacher_conversion_rate', 'teacher_retention_rate'], dimensions: ['teacher'], span: 2, limit: 40 },
      { type: 'chart', title: 'Customers taught by location', metrics: ['teacher_customers'], dimension: 'location', chart: 'stacked_bar' },
      { type: 'ranking', title: 'Class average', metric: 'teacher_avg_class', dimension: 'teacher', extra: ['teacher_sessions'], limit: 15 },
      { type: 'ranking', title: 'Newcomer conversion', metric: 'teacher_conversion_rate', dimension: 'teacher', extra: ['teacher_new_clients'], limit: 15 },
      { type: 'table', title: 'Teacher × location', metrics: ['teacher_sessions', 'teacher_avg_class', 'teacher_conversion_rate'], dimensions: ['teacher', 'location'], view: 'grouped', span: 2 },
      { type: 'table', title: 'Class × teacher (sessions)', metrics: ['classes', 'fill_rate', 'class_average'], dimensions: ['class_teacher'], limit: 30, span: 2 },
      { type: 'mom', title: 'Month-on-month', metrics: ['teacher_sessions', 'teacher_customers', 'teacher_avg_class', 'teacher_conversion_rate'] },
    ],
    presets: [
      'Teacher leaderboard for the last 3 months: sessions, class average, conversion and retention.',
      'Which teachers have the most empty or under-filled classes?',
      'Month-on-month class average by teacher for the last 6 months.',
      'Compare teachers on the same recurring classes — who draws more?',
    ],
  },
  {
    id: 'formats', label: 'Format comparison', icon: 'Shapes',
    blurb: 'Barre vs powerCycle vs Strength Lab — demand, fill, yield, clients, newcomers, teachers, schedule and cross-over.',
    expert: `You are the Format Strategy expert — you compare Barre, powerCycle and Strength Lab head-to-head to guide schedule, capacity, teacher and marketing decisions.
Formats are derived from the class name: Barre = Barre 57, Mat 57, FIT, Cardio Barre (+ Express / Plus), Back Body Blaze, Recovery, Trainer's Choice, Amped Up!; powerCycle = all cycle classes; Strength Lab = Full Body / Push / Pull. "Other" (hosted / unknown) is excluded from comparisons.
KPI tree per format: Check-ins = classes × capacity × fill; fill = booking fill × show-up. Yield = revenue per attendee / per class / per seat (usage-based class revenue). Demand quality = sold-out rate, ≥75%-full share, under-filler (<35%) share, empty-class rate. Client depth = visiting clients, visits per client, late-cancel rate. Acquisition = new clients by first-visit format, second-visit and conversion rates.
Know the data: rooms differ — powerCycle capacity is bike-bound, Strength Lab rooms are small — so compare RATES (fill, class average relative to capacity, yield) not just volumes; normalise for the number of classes and locations offering each format; Strength Lab is newer, so its history is short and samples are small (flag < 30 classes). Products are mostly shared across formats, so format revenue is usage-based, not cash.
Diagnostics: head-to-head scorecard with LY; mix shift in check-ins; fill by format × location / slot / weekday; sub-format ranking within each format; teacher coverage and class averages per format; client cross-over (single-format vs multi-format clients and their frequency); newcomer conversion by first format.
Levers: reallocate slots from chronic under-filling formats to sold-out ones, add capacity where sold-out rate is high, cross-sell (Barre-only clients → Strength Lab), format-specific intro offers, teacher development for weak formats.
${COMMON_METHOD}`,
    kpis: ['classes', 'class_checkins', 'fill_rate', 'class_average', 'empty_class_rate', 'revenue_per_attendee', 'visiting_clients', 'new_clients'],
    widgets: [
      { type: 'kpis', title: 'All formats', metrics: ['classes', 'class_checkins', 'fill_rate', 'class_average', 'sold_out_rate', 'empty_class_rate', 'revenue_per_attendee', 'class_revenue'], filters: NOT_OTHER },
      { type: 'table', title: 'Format scorecards', section: 'Head-to-head', metrics: ['class_checkins', 'classes', 'fill_rate', 'class_average', 'revenue_per_attendee', 'empty_class_rate'], dimensions: ['format'], view: 'cards', span: 2, filters: NOT_OTHER },
      { type: 'table', title: 'Head-to-head: class performance (all metrics)', section: 'Head-to-head', metrics: ['classes', 'class_checkins', 'capacity', 'booked_seats', 'fill_rate', 'booking_fill_rate', 'class_show_up_rate', 'class_average', 'avg_capacity', 'sold_out_rate', 'high_fill_rate', 'low_fill_rate', 'empty_class_rate', 'class_late_cancel_rate', 'class_revenue', 'revenue_per_class', 'revenue_per_attendee', 'revenue_per_seat', 'lost_revenue', 'session_teachers', 'classes_per_teacher'], dimensions: ['format'], view: 'transposed', span: 2, filters: NOT_OTHER },
      { type: 'chart', title: 'Check-ins by format', section: 'Trends & share', metrics: ['class_checkins'], dimension: 'format', chart: 'stacked_bar', span: 2, filters: NOT_OTHER },
      { type: 'chart', title: 'Fill rate by format', section: 'Trends & share', metrics: ['fill_rate'], dimension: 'format', chart: 'line', filters: NOT_OTHER },
      { type: 'chart', title: 'Class average by format', section: 'Trends & share', metrics: ['class_average'], dimension: 'format', chart: 'line', filters: NOT_OTHER },
      { type: 'chart', title: 'Revenue per attendee by format', section: 'Trends & share', metrics: ['revenue_per_attendee'], dimension: 'format', chart: 'line', filters: NOT_OTHER },
      { type: 'chart', title: 'Share of check-ins', section: 'Trends & share', metrics: ['class_checkins'], dimension: 'format', chart: 'pie', filters: NOT_OTHER },
      { type: 'table', title: 'Head-to-head: clients & attendance', section: 'Head-to-head', metrics: ['visits', 'visiting_clients', 'paying_visiting_clients', 'visits_per_client', 'show_up_rate', 'late_cancel_rate', 'complimentary_visits', 'trial_visits', 'new_client_visits'], dimensions: ['format'], view: 'transposed', span: 2, filters: NOT_OTHER },
      { type: 'table', title: 'Head-to-head: newcomers by first-visit format', section: 'Head-to-head', metrics: ['new_clients', 'second_visit_rate', 'zero_return_rate', 'conversion_rate', 'retention_rate', 'avg_days_to_convert', 'avg_first_purchase', 'new_client_avg_ltv'], dimensions: ['format'], view: 'transposed', span: 2, filters: NOT_OTHER },
      { type: 'analysis', title: 'Client format mix', section: 'Clients & cross-over', tool: 'format_overlap', input: { mode: 'segments' }, block: 'table', span: 2 },
      { type: 'analysis', title: 'Format cross-over', section: 'Clients & cross-over', tool: 'format_overlap', input: { mode: 'matrix' }, block: 'table', span: 2 },
      { type: 'mom', title: 'Month-on-month by format', section: 'Trends & share', metrics: ['classes', 'class_checkins', 'fill_rate', 'class_average', 'revenue_per_attendee'], dimension: 'format', filters: NOT_OTHER },
      { type: 'table', title: 'Format × location', section: 'Where & when', metrics: ['classes', 'class_checkins', 'fill_rate', 'class_average', 'sold_out_rate', 'revenue_per_class'], dimensions: ['format', 'location'], view: 'grouped', span: 2, filters: NOT_OTHER },
      { type: 'table', title: 'Fill rate: weekday × format', section: 'Where & when', metrics: ['fill_rate', 'class_average', 'classes'], dimensions: ['day_of_week', 'format'], view: 'pivot', filters: NOT_OTHER },
      { type: 'table', title: 'Fill rate: hour × format', section: 'Where & when', metrics: ['fill_rate', 'class_average', 'classes'], dimensions: ['hour', 'format'], view: 'pivot', filters: NOT_OTHER },
      { type: 'table', title: 'Prime time vs off-peak', section: 'Where & when', metrics: ['classes', 'fill_rate', 'class_average', 'sold_out_rate', 'revenue_per_seat'], dimensions: ['format', 'prime_time'], view: 'grouped', filters: NOT_OTHER },
      { type: 'table', title: 'Weekday vs weekend', section: 'Where & when', metrics: ['classes', 'fill_rate', 'class_average', 'empty_class_rate'], dimensions: ['format', 'weekpart'], view: 'grouped', filters: NOT_OTHER },
      { type: 'table', title: 'Sub-formats within each format', section: 'Sub-formats & teachers', metrics: ['classes', 'class_checkins', 'fill_rate', 'class_average', 'empty_class_rate', 'revenue_per_attendee'], dimensions: ['format', 'class_name'], view: 'grouped', span: 2, filters: NOT_OTHER },
      { type: 'table', title: 'Teachers by format', section: 'Sub-formats & teachers', metrics: ['classes', 'class_checkins', 'class_average', 'fill_rate', 'empty_class_rate'], dimensions: ['format', 'teacher'], view: 'grouped', span: 2, limit: 120, filters: NOT_OTHER },
      { type: 'table', title: 'Room size × format', section: 'Where & when', metrics: ['classes', 'avg_capacity', 'fill_rate', 'class_average'], dimensions: ['format', 'room_size'], view: 'grouped', filters: NOT_OTHER },
      { type: 'table', title: 'Late cancels by format', section: 'Where & when', metrics: ['bookings', 'late_cancellations', 'late_cancel_rate', 'show_up_rate'], dimensions: ['format', 'location'], view: 'grouped', filters: NOT_OTHER },
    ],
    presets: [
      'Compare Barre, powerCycle and Strength Lab for the last 3 months vs last year: fill, class average, yield and clients.',
      'Which format is growing fastest, and is it taking share from the others? Month-on-month check-ins by format for 14 months.',
      'Where are powerCycle and Strength Lab under-filling? Fill by location, weekday and time slot.',
      'How many Barre clients also do powerCycle or Strength Lab, and do multi-format clients visit more often?',
      'Which first-visit format converts newcomers best?',
      'Should we move slots between formats? Show sold-out vs under-filled classes by format and slot.',
    ],
  },
  {
    id: 'format_economics', label: 'Format economics', icon: 'Gem',
    blurb: 'The business each format brings: new clients, conversion, retention, LTV, frequency, cross-format journeys and renewals credited to each format.',
    expert: `You are the Format Economics expert — you measure the commercial value each format (Barre, powerCycle, Strength Lab) brings to Physique 57, client by client.
Data: fct_client_format has one row per client — first format (first attended class), main format (60%+ of their classes, else "Mixed"), format mix (single / two / all three), visits by format, visits per active month, active months, lifetime revenue (all sales), revenue split across formats by visit share, and new-client outcomes (converted, retained). fct_membership_format credits each ending recurring membership to the format the client attended most in its last 60 days.
Use: "how many new clients came through X" = format_new_clients by first_format; "their LTV / retention / conversion" = client_avg_ltv, format_retention_rate, format_conversion_rate by first_format; "frequency" = visits_per_active_month by main_format or frequency_band; "cross-format behaviour" = multi_format_rate, format_mix, second_format by first_format, avg_days_to_second_format; "renewed mostly due to X" = credited_renewals and credited_renewal_rate by credited_format; "revenue X brings" = barre/cycle/strength_revenue_share.
Caveats you always state: revenue split and renewal credit are behavioural attributions (the data does not record why a client paid or renewed); client_avg_ltv credits the whole client to one segment; the client profile is cohorted by first class date, so recent cohorts look smaller on tenure and LTV — compare like-for-like cohorts; Strength Lab is newer, so samples are small.
${COMMON_METHOD}`,
    kpis: ['format_new_clients', 'format_conversion_rate', 'format_retention_rate', 'client_avg_ltv', 'visits_per_active_month', 'multi_format_rate', 'credited_renewal_rate'],
    widgets: [
      { type: 'kpis', title: 'Headline', metrics: ['format_clients', 'format_new_clients', 'format_conversion_rate', 'format_retention_rate', 'client_avg_ltv', 'visits_per_active_month', 'multi_format_rate', 'credited_renewal_rate'] },
      { type: 'table', title: 'Acquisition → LTV by first format', section: 'Acquisition & value', metrics: ['format_clients', 'format_new_clients', 'format_conversion_rate', 'format_retention_rate', 'client_avg_ltv', 'client_lifetime_visits', 'client_active_months', 'visits_per_active_month', 'multi_format_rate', 'avg_days_to_second_format'], dimensions: ['first_format'], view: 'transposed', span: 2 },
      { type: 'chart', title: 'New clients by first format', section: 'Acquisition & value', metrics: ['format_new_clients'], dimension: 'first_format', chart: 'stacked_bar', span: 2 },
      { type: 'table', title: 'Revenue credited to each format (visit share)', section: 'Acquisition & value', metrics: ['barre_revenue_share', 'cycle_revenue_share', 'strength_revenue_share', 'format_lifetime_revenue'], dimensions: ['location'], span: 2 },
      { type: 'table', title: 'Main format: depth and value', section: 'Frequency & loyalty', metrics: ['format_clients', 'visits_per_active_month', 'client_lifetime_visits', 'client_active_months', 'client_avg_ltv'], dimensions: ['main_format'], view: 'transposed', span: 2 },
      { type: 'table', title: 'Frequency bands by main format', section: 'Frequency & loyalty', metrics: ['format_clients', 'client_avg_ltv', 'client_active_months'], dimensions: ['main_format', 'frequency_band'], view: 'pivot', span: 2 },
      { type: 'table', title: 'Where clients go next (first → second format)', section: 'Cross-format journeys', metrics: ['format_clients'], dimensions: ['first_format', 'second_format'], view: 'pivot', span: 2 },
      { type: 'table', title: 'Single vs multi-format clients', section: 'Cross-format journeys', metrics: ['format_clients', 'visits_per_active_month', 'client_active_months', 'client_avg_ltv', 'format_retention_rate'], dimensions: ['format_mix'], view: 'transposed', span: 2 },
      { type: 'table', title: 'Renewals credited to each format', section: 'Renewals', metrics: ['credited_memberships_ending', 'credited_renewals', 'credited_renewal_rate', 'credited_renewal_value', 'term_visits_per_membership'], dimensions: ['credited_format'], view: 'transposed', span: 2 },
      { type: 'table', title: 'Renewal: single vs multi-format members', section: 'Renewals', metrics: ['credited_memberships_ending', 'credited_renewal_rate', 'term_visits_per_membership'], dimensions: ['format_mix'], span: 2 },
      { type: 'table', title: 'Renewal by format × studio', section: 'Renewals', metrics: ['credited_memberships_ending', 'credited_renewals', 'credited_renewal_rate'], dimensions: ['credited_format', 'location'], view: 'grouped', span: 2 },
      { type: 'mom', title: 'Month-on-month new clients by first format', section: 'Acquisition & value', metrics: ['format_new_clients', 'format_conversion_rate', 'format_retention_rate'], dimension: 'first_format' },
    ],
    presets: [
      'How many new clients came through Strength Lab in the last 6 months, and what are their conversion, retention and average LTV vs Barre and powerCycle?',
      'How often do Strength Lab-first clients attend, and how many go on to try Barre or powerCycle?',
      'How many renewals in the last quarter were credited to Strength Lab, and what is its renewal rate vs other formats?',
      'Do multi-format clients stay longer and spend more than single-format clients?',
      'How much revenue does each format bring when we split each client by their visit share?',
    ],
  },
];

export const domainById = new Map(DOMAINS.map((d) => [d.id, d]));
