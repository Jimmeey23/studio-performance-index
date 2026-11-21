/** Preset question templates. {period} / {location} placeholders are filled from the composer controls when used. */
export interface Template { title: string; prompt: string; category: string }

export const TEMPLATE_CATEGORIES = ['Reports', 'Revenue', 'Clients & retention', 'Leads & marketing', 'Classes & teachers', 'Forecasts & planning', 'Diagnostics'] as const;

export const TEMPLATES: Template[] = [
  { category: 'Reports', title: 'Top trainers — composite ranking YTD', prompt: 'Using the trainer scorecard, show year to date: 1) who our top trainers are (composite ranking with sessions, non-empty and empty classes, check-ins, class average, fill, late cancels, experience); 2) their individual and total class revenue contribution; 3) their new-client conversion and retention, net and %; 4) conversion and retention of the top trainers ordered by revenue; 5) the same ranking for each studio separately. First all studios combined, then each studio. Explain the scoring and why low-newcomer trainers are not penalised.' },
  { category: 'Reports', title: 'Monthly business review', prompt: 'Give me a monthly business review for the last complete month: revenue, paying vs total clients, visits, new clients, conversion, fill rate and leads by location, vs last year, with the key risks and actions.' },
  { category: 'Reports', title: 'Month-on-month KPI table', prompt: 'Month-on-month table for the last 14 months of revenue, paying clients, visiting clients (paying and total), visits, new clients and conversion rate, with last year alongside.' },
  { category: 'Reports', title: 'Location scorecard', prompt: 'Location scorecard for the last 3 complete months: revenue, ATV, paying clients, visits, fill rate, new clients, conversion and renewal rate, ranked, with growth vs last year.' },
  { category: 'Reports', title: 'Weekly pulse', prompt: 'How did the last 4 complete weeks go? Revenue, visits and new clients by week and location, vs the same weeks last year.' },
  { category: 'Revenue', title: 'Revenue bridge vs last year', prompt: 'Explain last month\'s revenue change vs last year: split it into volume (transactions, clients), price (ATV) and product mix, by location.' },
  { category: 'Revenue', title: 'Product mix', prompt: 'Revenue and units by product category and top products for the last 6 months, month-on-month, with share of total.' },
  { category: 'Revenue', title: 'Associate leaderboard', prompt: 'Rank sales associates by revenue, transactions and ATV for the last 3 months, with month-on-month trend.' },
  { category: 'Revenue', title: 'Discount leakage', prompt: 'How much did discounts cost us in the last 6 months, by discount code and location, and what share of list value did we give away?' },
  { category: 'Clients & retention', title: 'Cohort retention', prompt: 'Cohort retention by first-visit month for the last 12 months. Where is the biggest drop-off and which locations retain best?' },
  { category: 'Clients & retention', title: 'Renewals & at-risk members', prompt: 'Renewal rate by location for the last 6 months (both definitions) and the list of members whose renewal window is open now.' },
  { category: 'Clients & retention', title: 'Lapsed pool & win-backs', prompt: 'How big is the lapsed client pool by location and lifetime value, and how many clients did we win back each month?' },
  { category: 'Clients & retention', title: 'Trial conversion by product', prompt: 'Trial→paid conversion by trial product and location for the last 6 months, with volumes and days to convert.' },
  { category: 'Leads & marketing', title: 'Lead funnel by channel', prompt: 'Lead funnel by channel for the last quarter: leads, trials, conversions and rates. Where do we lose the most?' },
  { category: 'Leads & marketing', title: 'Meta ads efficiency', prompt: 'Meta ads spend, leads and cost per lead by city and campaign for the last 2 months, and how that compares to CRM lead conversion.' },
  { category: 'Leads & marketing', title: 'Associate follow-up', prompt: 'Lead associate leaderboard for the last quarter: leads handled, trials, conversions and conversion rate.' },
  { category: 'Classes & teachers', title: 'Schedule optimisation', prompt: 'Which class slots should we cut, move or add? Show fill rate and class average by studio, day and time slot for the last 3 months.' },
  { category: 'Classes & teachers', title: 'Teacher performance', prompt: 'Teacher leaderboard for the last 3 months: sessions, class average, new-client conversion and retention.' },
  { category: 'Classes & teachers', title: 'Late cancellations', prompt: 'Late-cancel rate by location, class and time slot last month, month-on-month trend, and penalties charged.' },
  { category: 'Forecasts & planning', title: 'Revenue forecast', prompt: 'Forecast revenue for the next 3 months by location, with confidence ranges and what\'s driving it.' },
  { category: 'Forecasts & planning', title: 'Month-end landing', prompt: 'Where will this month land for revenue and visits based on month-to-date and history? Show the range.' },
  { category: 'Forecasts & planning', title: 'What-if: +10% conversion', prompt: 'What would revenue look like over the next 3 months if trial conversion improved by 5 percentage points? Show the assumptions.' },
  { category: 'Diagnostics', title: 'What changed last month?', prompt: 'Scan all key metrics by location for unusual movements last month and explain the biggest ones.' },
  { category: 'Diagnostics', title: 'Biggest opportunity', prompt: 'Across locations, which single improvement (conversion, retention, renewals, fill rate or pricing) would add the most revenue? Quantify it.' },
];
