# Physique 57 India — Business Intelligence

A conversational analytics platform. Ask questions in plain English; the answer comes back with tables, charts, forecasts and recommendations. Every number comes from a deterministic SQL engine over your 7 Google Sheets, never from the AI's own arithmetic.

```
Google Sheets ──► ingestion (incremental) ──► DuckDB warehouse
  7 workbooks       raw_* tables (text)        typed models fct_* / dim_* (deduped, one grain each)
                                                     │
                                semantic layer: 70 metrics × 24 dimensions, business rules
                                                     │
          Claude (tool use) ◄── query engine · forecasts · cohorts · funnels · renewals · win-backs · guarded SQL
                 │
          React app: chat, rich blocks (KPI cards, sortable tables, pivots, charts, forecast bands,
                     cohort heatmaps, funnels), provenance drawer, saved reports, data health
```

## Quick start (Mac)

Requires Node 20+.

```bash
cd p57-bi
npm run setup                          # installs + builds the web app
cp server/.env.example server/.env     # then fill in the values (see below)
npm run import -- "$HOME/Downloads/p57-bi-data"   # first load from the .xlsx snapshot
npm start                              # http://localhost:8787
```

Sign in with `ADMIN_EMAIL` / `ADMIN_PASSWORD` from `.env`. Add colleagues under Settings › Users.

For development with hot reload: `npm run dev` (web on :5173, API on :8787).

## Configure

**1. AI engine.** Put an Anthropic API key in `ANTHROPIC_API_KEY`. Models per tier can be overridden with `ANTHROPIC_MODEL_FAST`, `ANTHROPIC_MODEL_BALANCED` and `ANTHROPIC_MODEL_DEEP`. Extended thinking is on by default (the model reasons before answering; the budget scales with the tier); set `AI_THINKING=off` to disable it. Data pages, saved reports and the insights page work without a key; the chat needs it.

**2. Google Sheets (live refresh).**
1. In Google Cloud Console, create a project, enable the **Google Sheets API** and **Google Drive API**.
2. Create a service account and download its JSON key to `server/config/service-account.json`.
3. Share each of the 7 spreadsheets with the service account's email (Viewer).
4. Settings › "Sync from Google Sheets" (or `npm run sync`). After that it syncs every `SYNC_INTERVAL_MINUTES`.

The sync is incremental. A spreadsheet whose Drive modified-time hasn't changed is skipped. A tab whose content hash is unchanged isn't reloaded. Only models downstream of changed tabs are rebuilt. Each run logs inserted, removed and unchanged rows.

You don't need Google access to get going: Settings › "Upload .xlsx exports" (or `npm run import -- <folder>`) loads exported workbooks. Each one is matched to its source automatically.

**3. Database (Neon).** Set `DATABASE_URL` to your Neon Postgres connection string (`...?sslmode=require`). Users, conversations, saved executive reports and their layouts, performance reviews and AI commentary, report designs, preferences, admin configuration, brand knowledge notes and targets are then stored in Neon and survive redeploys. The schema is created automatically on start-up, and any data already in a local `data/app.duckdb` is copied across once (only into empty tables). Without `DATABASE_URL` everything stays in the local file. The synced studio data (warehouse) stays in local DuckDB and is rebuilt from Google Sheets.

## What's ingested, and what isn't

| Workbook | Tabs used → model | Source of truth for |
|---|---|---|
| Sales - Raw | Sales → `fct_sales`; Memberships → `dim_product`; Pricing Bengaluru | Revenue, transactions, paying clients, discounts, associates |
| Day End Report - Part 1 | New → `fct_new_clients`; Late Cancellations; Payroll → `fct_teacher_month` | New clients, trial conversion, retention, teacher stats |
| Day End Report - Part 3 | Sessions → `fct_sessions`; VC → `fct_member_month` | Classes, capacity, fill rate, class averages |
| Day End Report - Part 4 | Checkins → `fct_checkins` | Visits and bookings from 2024 |
| ❖ PM - Leads ❖ | ◉ Leads → `fct_leads`; Meta_Daily_Data → `fct_ad_spend`; Tasks | Leads, funnel, channels, ad spend / CPL |
| Lapsed New | Lapsed → `fct_memberships` | Expiries, lapse, renewal status |
| Bookings Data 2018-2026 | Bookings → `stg_bookings` | Visit history before Checkins coverage |

Pivot tabs, filtered copies (30+, 60+, Consolidated Members, Recurring), the older Sales copy inside PM Leads and broken/scratch tabs are deliberately ignored, because they would double count. Each one is listed with its reason on the Data sources page and in `server/src/sources.ts`.

`fct_visits` combines Checkins (from its first date) with Bookings history before that date, so the two never overlap. `dim_client` joins every source on Momence Member ID.

## Business logic (the parts that matter)

- **Lapsed / renewal / churn scope:** only recurring memberships count. Zero-value memberships and every name in `renewal.exclude_memberships_exact` (`server/config/business-rules.json`, exact match, case-insensitive) are excluded everywhere: the Churn and Renewals workspaces, the sheet renewal rate, the strict renewal analysis and the AI's answers. Edit that list to change the scope.
- **Format:** Barre / powerCycle / Strength Lab is derived from the class name (Other = hosted / unknown classes, excluded from comparisons).

All of this is editable in `server/config/business-rules.json` or Settings › Business rules, then "Rebuild models".

- **Revenue** = cash collected (Payment Value) on succeeded, non-voided sale items, incl. GST. `net_revenue` excludes GST. Amounts paid from earlier money credits aren't counted twice. Sales revenue is kept separate from *recognised class value* (the per-visit value of credits used), and the two are never added together.
- **New clients / conversion / retention**: first-visit cohort from Part 1 › New. "Not New" legacy imports are excluded. Recent cohorts are flagged as still maturing.
- **Renewals (strict)**: a paid membership or package ending in the period counts as renewed if the same member buys a Membership or Class Package after it started and within 30 days of it ending. Intro, trial, complimentary and staff products are excluded. The Lapsed sheet's own "Renewed/Lapsed" status counts any later purchase, so it runs higher (about 74% vs 52% for May–Oct 2026). Both are reported, labelled.
- **Win-back** = a purchase by a client whose last attended visit was 90+ days earlier.
- **Locations** are normalised to canonical names with city and type. Unmapped values appear on the Data health page.
- **Defaults**: the last complete month (never the month in progress), 14-month trends with prior-year months alongside, and paying vs total clients side by side.

## What's in the app

- **Drill-through everywhere.** Every number is clickable: table cells, totals, grouped subtotals, month-on-month cells (including last-year rows), pivot cells, ranked rows, KPI cards and chart points/bars/slices. Each click opens a panel with the exact records behind that number (filtered to the row's location, product, teacher, month, etc.), a recomputed value that is checked against what you clicked, breakdowns you can click to go deeper (with breadcrumbs), the monthly trend, the SQL, server-side search, CSV export and "Ask AI about this".
- **Analyst chat with extended thinking** and automatic model selection: Haiku for lookups and quick refinements, Sonnet for standard analysis, Opus for diagnosis, forecasts and strategy. The model plans, forms hypotheses and sanity-checks results before writing; its reasoning streams into a collapsible "Reasoning" panel. You can override the model in the composer.
- **Composer controls**: period presets, location filter, comparison, model and templates. New questions queue while an answer is being prepared.
- **Clarifying questions** with clickable answers, **curated answers** (headline, findings, drivers, actions) and **3 follow-up questions** on every answer. Metric definitions, sources and methodology sit in a collapsed section at the bottom.
- **Advanced tables** with nine views: Table, Month-on-month (months as columns, newest first, LY and YoY rows), Grouped, Pivot, Ranked (leaderboard with share and cumulative Pareto share), Heatmap, Transposed, Cards and Statistics (count, sum, mean, median, std dev, CV, quartiles, highest/lowest). The grid has multi-level grouping (any dimension, plus derived Year and Quarter) with subtotals, expand/collapse all, multi-select and range column filters, multi-sort, column pinning and resizing, heat colouring, in-cell data bars, compact mode, copy-to-clipboard, CSV and a totals row.
- **Interactive charts (Apache ECharts)**: bar, line, area, stacked, horizontal, combo and donut; metric picker, X-axis and split-by pickers, average line, data labels, zoom slider, and a toolbox (box zoom, switch line/bar/stack, data view, restore, save as PNG). Forecast charts show 80% and 95% bands.
- **Animated KPI cards** with count-up values, vs-LY and MoM changes and sparklines. Click a card for its records.
- **Expert workspaces** (sidebar): Sales & revenue, Leads & marketing, Conversion funnel, Retention & cohorts, Churn & win-backs, Renewals, Late cancellations, Class performance, Teachers, and **Format comparison** (Barre vs powerCycle vs Strength Lab: scorecards, three head-to-head tables covering class performance, clients and newcomers with the best rate highlighted, trends and share, month-on-month by format, client cross-over and format mix, format × location / weekday / hour / prime time / room size, sub-formats and teachers per format). Each overview has 8–12 widgets (KPI strip, trends, scorecards, leaderboards, mix tables, slot/format analysis, cohort heatmaps, funnels, forecasts, renewal and win-back analyses, month-on-month) and a collapsible **global filter** section (period presets or custom dates, locations, comparison, trend grain). Each widget has "Ask the expert". Every workspace is run by a domain-expert sub-agent with a KPI tree, diagnostic playbook, data pitfalls and levers (`server/src/ai/domains.ts`).
- **Executive report** (sidebar › Library): pick a period (last month, any month, last quarter, last 3/6 months, YTD, FY, MTD or custom) and one or more studios. Every KPI is benchmarked three ways — the **previous month**, the **current-year monthly average** (Jan → month before the period; volumes scaled to the period length) and the **same month last year** — with a 14-month sparkline. The report (≈22 A4 pages, editorial design, brand wordmark and graphics, pages auto-filled to minimise white space) contains: cover; executive summary (headline, AI summary, "in ten seconds", wins, watch-outs, three strategic themes); scorecard (27 metrics × three baselines, studio comparison); the mandatory sections **Sales, New Clients & Conversion, Lead & Funnel Health, Trainer Performance, Class Performance & Booking Behaviour, Format Comparison, Lapsed & Membership Churn, Late Cancellation** (each: AI headline, KPI tiles, charts / funnels / weekday×hour heatmap / format cards / trainer spotlight, analysis, actions, then a findings & detail page) and **Road Ahead** (revenue / new-client / visit forecasts with ranges, renewals due, pipeline, outlook, prioritised actions with owners and targets, risks, opportunities, suggested targets); a landscape 14-month appendix and definitions. Claude writes the commentary from the computed figures (every figure verified); rule-based commentary is used without an API key. Exports: **PDF** (exact A4 pages incl. the landscape appendix), **Word**, **PowerPoint**, **Excel** and **HTML**. Every number on screen opens the underlying records.
- **Grouping** in every table: group by any column in the table plus derived Year / Quarter, or "Break down further by…" any other dimension the data supports (the table is re-queried at the finer grain). Subtotals for every grouping level are exact engine values, including rates. Pivot views can add any dimension too.
- **Command palette** (⌘K / Ctrl+K): jump to workspaces and pages, run templates, open any metric's records for last month, reopen recent analyses, or type a question to ask the analyst.
- Clicking the logo returns to the home page.

## How an answer is produced

1. Claude reads the question with the metric catalog, business rules, today's date and data coverage.
2. It calls tools: `query_metrics` (the semantic engine), `forecast`, `cohort_retention`, `funnel`, `renewal_analysis`, `winback_analysis`, `detect_anomalies`, `target_vs_actual`, `find_values`, `client_lookup`, `run_sql` (read-only, curated models only) and `calculate` (exact arithmetic for derived figures).
3. Metrics from different datasets are aggregated separately and joined at the same grain, so there is no fan-out double counting. Additive breakdowns are reconciled against totals.
4. `render` places blocks that reference result IDs. The server attaches the data, so the model never re-types numbers.
5. Every figure in the written answer is checked against the computed results. Anything it can't trace is flagged in the UI.
6. Each block has "How this was calculated": the query, definitions, period, sources, checks and the exact SQL.

Follow-up questions keep the conversation's earlier tool calls, so filters, periods and entities carry over.

## Forecasting

Monthly series are fitted with up to four candidate models: 3-month average, seasonal naive × YoY growth, damped Holt trend, and Holt-Winters when there are 24+ months. They are compared with a rolling-origin backtest, and the model with the lowest MAE is used. 80% and 95% bands come from the empirical backtest error. The output also includes the month-to-date run-rate, YoY and seasonal-index drivers, and (if a target is given) the probability of reaching it. Forecasts are always labelled as estimates.

## Targets

No targets exist in the source sheets. Upload a CSV under Settings › Targets (`month,location,metric,target`) to enable target-vs-actual and target-probability answers.

## Validation

```bash
python3 server/scripts/independent_check.py "<folder of .xlsx>" server/data/expected.json   # pandas, separate code path
npm run validate                                                                              # engine vs pandas + invariants + benchmarks
npx --prefix server tsx server/scripts/test-orchestrator.ts                                  # AI loop with a scripted model (incl. thinking fallback)
(cd server && npx tsx scripts/check_drill.ts)                                                # every metric's drill-through reconciles with the engine
(cd server && npx tsx scripts/check_dashboards.ts)                                           # every workspace widget computes
```

Results on the 19 Nov 2026 snapshot: **73/73 checks passed**. These cover revenue, visits, classes, fill rate, new clients, conversion, retention, leads and memberships against pandas; duplicate keys; join inflation; date boundaries; YoY alignment; future and imported-visit exclusion; guarded SQL; and 18 benchmark questions. Check-ins and class check-ins reconcile within 0.3% per month. The report is written to `server/data/validation-report.json`. Drill-through: all 99 metrics recompute exactly to the engine value, and record-level sums reconcile to the clicked cell.

## Project layout

```
server/
  src/sources.ts            sheet/tab registry (+ why tabs are ignored)
  src/ingest/               Google Sheets + xlsx readers, incremental raw loader, pipeline
  src/warehouse/models.ts   typed models, grains, dedupe, source-of-truth rules
  src/warehouse/quality.ts  data dictionary + data-health checks
  src/semantic/             metric catalog + deterministic query engine
  src/analytics/            forecasts, cohorts, funnels, renewals, win-backs, anomalies, guarded SQL
  src/ai/                   prompt, tools, orchestration loop, narrative verification
  config/business-rules.json
web/src/                    React app (chat workspace, blocks, pages)
```

Logs: `server/data/logs/app.log`. Every question, answer, sync and rule change is recorded in the audit table.
