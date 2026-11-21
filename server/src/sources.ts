/**
 * Source registry: which Google Sheets / tabs feed the warehouse, and why
 * other tabs are deliberately ignored. Every ingested tab lands in a raw table
 * (all VARCHAR) named `raw_<table>`; typed models are built on top of these.
 */
export interface TabSpec {
  tab: string;            // exact tab name in the spreadsheet
  table: string;          // raw table suffix -> raw_<table>
  description: string;
  role: 'fact' | 'dimension' | 'reference' | 'secondary';
  chunkRows?: number;     // rows per API request for very large tabs
}

export interface SourceSpec {
  key: string;
  name: string;
  spreadsheetId: string;
  tabs: TabSpec[];
  ignoredTabs: { tab: string; reason: string }[];
}

export const SOURCES: SourceSpec[] = [
  {
    key: 'sales_raw',
    name: 'Sales - Raw',
    spreadsheetId: '1HbGnJk-peffUp7XoXSlsL55924E9yUt8cP_h93cdTT0',
    tabs: [
      { tab: 'Sales', table: 'sales', role: 'fact', chunkRows: 20000,
        description: 'Momence sale-item ledger. One row per sale item (Sale Item ID). Source of truth for revenue.' },
      { tab: 'Memberships', table: 'products', role: 'dimension',
        description: 'Momence membership/package catalog (price, duration, credits, intro-offer flag).' },
      { tab: 'Pricing Bengaluru', table: 'pricing_blr', role: 'reference',
        description: 'Bengaluru price list (pre/post tax, validity, sessions).' },
    ],
    ignoredTabs: [
      { tab: 'Late Cancellations', reason: 'Duplicate of Day End Report - Part 1 › Late Cancellations (Part 1 is canonical: longer history).' },
      { tab: 'Meta CAPI Log', reason: 'Technical log of conversions sent to Meta; not a business record.' },
      { tab: 'Bengaluru', reason: 'Presentation copy of the catalog; Memberships tab is canonical.' },
      { tab: 'Mumbai', reason: 'Presentation copy of the catalog; Memberships tab is canonical.' },
      { tab: 'Pivot Table *', reason: 'Derived pivots — recomputed from the ledger instead.' },
      { tab: 'Detail*', reason: 'Pivot drill-down extracts (subset of Sales).' },
      { tab: 'Notes', reason: 'App annotation log.' },
    ],
  },
  {
    key: 'part1',
    name: 'Day End Report - Part 1',
    spreadsheetId: '149ILDqovzZA6FRUJKOwzutWdVqmqWBtWPfzG3A0zxTI',
    tabs: [
      { tab: 'New', table: 'new_clients', role: 'fact', chunkRows: 20000,
        description: 'One row per client (Member Id) with first visit, trial, conversion and retention attributes. Source of truth for new-client conversion/retention.' },
      { tab: 'Late Cancellations', table: 'late_cancellations', role: 'fact', chunkRows: 20000,
        description: 'Late-cancellation events (member, session, penalty).' },
      { tab: 'Payroll', table: 'teacher_month', role: 'fact',
        description: 'Teacher × location × month aggregates: sessions, customers, paid, conversions, retention.' },
    ],
    ignoredTabs: [{ tab: 'Pivot Table *', reason: 'Derived pivots.' }],
  },
  {
    key: 'part3',
    name: 'Day End Report - Part 3',
    spreadsheetId: '16wFlke0bHFcmfn-3UyuYlGnImBq0DY7ouVYAlAFTZys',
    tabs: [
      { tab: 'Sessions', table: 'sessions', role: 'fact', chunkRows: 20000,
        description: 'One row per scheduled class (SessionID): capacity, booked, checked-in, revenue. Includes future scheduled classes.' },
      { tab: 'VC', table: 'member_month_wide', role: 'secondary', chunkRows: 5000,
        description: 'Wide member × month matrix (booked/visits/cancellations/paid/comp). Unpivoted; secondary to Checkins.' },
    ],
    ignoredTabs: [
      { tab: 'Recurring', reason: 'Aggregates derived from Sessions — would double count.' },
      { tab: 'Teacher Recurring', reason: 'Aggregates derived from Sessions — would double count.' },
    ],
  },
  {
    key: 'part4',
    name: 'Day End Report - Part 4',
    spreadsheetId: '1a7XKv2WCog7o8nYuV8YcFdqtfPYJNRO6DelJ6Hn_z6Q',
    tabs: [
      { tab: 'Checkins', table: 'checkins', role: 'fact', chunkRows: 25000,
        description: 'One row per booking (Member ID × Session ID) from 2024 with check-in, late-cancel, per-visit paid value, product and new-client label. Source of truth for visits from 2024.' },
    ],
    ignoredTabs: [{ tab: 'Pivot Table *', reason: 'Derived pivots.' }],
  },
  {
    key: 'pm_leads',
    name: '❖ PM - Leads ❖',
    spreadsheetId: '1dQMNF69WnXVQdhlLvUZTig3kL97NA21k6eZ9HRu6xiQ',
    tabs: [
      { tab: '◉ Leads', table: 'leads', role: 'fact', chunkRows: 20000,
        description: 'One row per lead (ID): source, channel, stage, associate, centre, trial/conversion/retention status, UTM.' },
      { tab: 'Meta_Daily_Data', table: 'meta_ads', role: 'fact',
        description: 'Daily Meta Ads performance by campaign/platform: spend, impressions, clicks, leads, purchases.' },
      { tab: 'Tasks', table: 'tasks', role: 'secondary',
        description: 'Momence staff tasks (client check-ins/follow-ups) with assignee and completion.' },
    ],
    ignoredTabs: [
      { tab: 'Sales', reason: 'Older partial copy of the sales ledger — Sales - Raw is canonical (would double count revenue).' },
      { tab: 'Customer Notes', reason: 'Free-text staff notes; excluded from analytics (privacy, no metric value).' },
      { tab: 'Sheet57', reason: 'Scratch values with no headers.' },
      { tab: 'Sheet61', reason: 'Broken lookups (#REF!).' },
      { tab: 'Sheet62', reason: 'Filtered extract of Leads.' },
      { tab: 'Pivot Table *', reason: 'Derived pivots.' },
    ],
  },
  {
    key: 'lapsed',
    name: 'Lapsed New',
    spreadsheetId: '1x-0iFgnYmEqt-b2MfAgHVx5CErcX5NtZYB9p5Rh6f1I',
    tabs: [
      { tab: 'Lapsed', table: 'memberships', role: 'fact', chunkRows: 15000,
        description: 'One row per membership instance with status, start/end, churn date, amount paid, usage and attendance. Source of truth for expiries and lapse.' },
      { tab: 'Excluded Memberships', table: 'excluded_memberships', role: 'reference',
        description: 'Memberships excluded from lapse tracking (intro/comp products).' },
    ],
    ignoredTabs: [
      { tab: '30+', reason: 'Filtered subset of Lapsed.' },
      { tab: '60+', reason: 'Filtered subset of Lapsed.' },
      { tab: 'Lapsed Members', reason: 'Filtered subset of Lapsed.' },
      { tab: 'Consolidated Members', reason: 'Member-level roll-up of Lapsed (would double count memberships).' },
      { tab: 'Renewals', reason: 'Working list for associates; renewals are computed from Sales instead.' },
      { tab: 'Tag Log', reason: 'respond.io tagging log.' },
      { tab: 'Admin', reason: 'Associate assignment list.' },
      { tab: 'KH / SHQ / Blr', reason: 'Broken formula tabs (#VALUE!).' },
      { tab: 'Pivot Table * / Detail*', reason: 'Derived pivots.' },
    ],
  },
  {
    key: 'bookings',
    name: 'Bookings Data - 2018-2026',
    spreadsheetId: '1OO-Pk7P__1uqsRdmFZ82JBl4-LGPPr7MCTbwKgeLqL0',
    tabs: [
      { tab: 'Bookings', table: 'bookings', role: 'fact', chunkRows: 25000,
        description: 'Full booking history (incl. imported legacy visits). Used for visits before Checkins coverage and for cancellations/no-shows.' },
    ],
    ignoredTabs: [],
  },
];

export const allTabs = () =>
  SOURCES.flatMap((s) => s.tabs.map((t) => ({ ...t, source: s })));
