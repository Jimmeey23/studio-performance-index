/**
 * Lead channel & source analysis — the lead funnel by channel and source, for all studios and each studio.
 *
 *   Leads → Trials completed → Purchasing members
 *
 * • Leads: CRM leads created in the period (❖ PM - Leads ❖ › ◉ Leads), studio = the lead's centre.
 * • Channel: the governed source → channel mapping (config/business-rules.json → leads.channels).
 * • Trials completed: the lead's trial status shows a completed trial.
 * • Purchasing members: leads whose member record has a qualifying sale on or after the lead was created
 *   (Momence sales; retail, money credits, partner credits, intro / 2-for-1 newcomer offers, test, voided and
 *   zero-value items excluded) — a sale, not just a linked member record.
 * • Converted / retained / LTV: the CRM's own conversion & retention status and lifetime value for the lead.
 */
import crypto from 'node:crypto';
import type { Column } from '../semantic/engine.js';
import { warehouse, sqlString } from '../warehouse/db.js';
import { leadChannelSql, leadStatusSql, leadRules } from '../warehouse/rules.js';
import type { AnalysisResult } from './analyses.js';

interface Lead { id: string; month: string; studio: string; source: string; channel: string; trial: boolean; purch: boolean; conv: boolean; ret: boolean; ltv: number; qual: boolean; disq: boolean; unresp: boolean }
interface Agg { leads: number; trials: number; purch: number; conv: number; ret: number; ltv: number; qual: number; disq: number; unresp: number }
const empty = (): Agg => ({ leads: 0, trials: 0, purch: 0, conv: 0, ret: 0, ltv: 0, qual: 0, disq: 0, unresp: 0 });
function agg(ls: Lead[]): Agg { const a = empty(); for (const l of ls) { a.leads++; if (l.trial) a.trials++; if (l.purch) a.purch++; if (l.conv) a.conv++; if (l.ret) a.ret++; a.ltv += l.ltv; if (l.qual) a.qual++; if (l.disq) a.disq++; if (l.unresp) a.unresp++; } return a; }
const rate = (a: number, b: number) => (b ? a / b : null);
const rowOf = (a: Agg) => ({ leads: a.leads, trials: a.trials, lead_to_trial: rate(a.trials, a.leads), purchasers: a.purch, trial_to_member: rate(a.purch, a.trials), lead_to_member: rate(a.purch, a.leads),
  qualified: a.qual, disqualified: a.disq, converted: a.conv, retained: a.ret, ltv: a.ltv, ltv_per_purchaser: a.purch ? a.ltv / a.purch : null });
const group = <T,>(xs: T[], k: (x: T) => string) => { const m = new Map<string, T[]>(); for (const x of xs) { const kk = k(x); m.set(kk, [...(m.get(kk) ?? []), x]); } return m; };
const pctS = (v: number | null, d = 1) => (v === null ? '—' : `${(v * 100).toFixed(d)}%`);
const inr = (v: number) => (v >= 1e7 ? `₹${(v / 1e7).toFixed(2)}Cr` : v >= 1e5 ? `₹${(v / 1e5).toFixed(2)}L` : `₹${Math.round(v).toLocaleString('en-IN')}`);
const N = (v: number | undefined) => (v ?? 0).toLocaleString('en-IN');
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const monL = (m: string) => `${MON[Number(m.slice(5, 7)) - 1]} ${m.slice(2, 4)}`;

const rid = () => 'r_' + crypto.randomBytes(5).toString('hex');
const col = (key: string, label: string, format: string, kind: Column['kind'] = 'metric') => ({ key, label, kind, format } as Column);
const SOURCES = ['❖ PM - Leads ❖ › ◉ Leads (fct_leads)', 'Momence sales (fct_sales)'];
function result(title: string, columns: Column[], rows: Record<string, unknown>[], totals?: Record<string, unknown>): AnalysisResult {
  return { id: rid(), kind: 'lead_channels', title, columns, rows, totals, sql: [], sources: SOURCES, definitions: [], notes: [], checks: [], verified: true, rowCount: rows.length };
}
const FUNNEL_COLS = (first: Column) => [first, col('leads', 'Leads', 'number'), col('trials', 'Trials', 'number'), col('lead_to_trial', 'Lead→trial', 'percent'), col('purchasers', 'Purchasing members', 'number'),
  col('trial_to_member', 'Trial→member', 'percent'), col('lead_to_member', 'Lead→member', 'percent'), col('converted', 'Converted (CRM)', 'number'), col('retained', 'Retained', 'number'), col('ltv', 'LTV', 'currency')];

async function loadLeads(start: string, end: string, locations: string[]): Promise<Lead[]> {
  const db = await warehouse();
  const lf = locations.length ? ` and location in (${locations.map(sqlString).join(', ')})` : '';
  const rows = await db.all<Record<string, unknown>>(`
    with l as (
      select lead_id, member_id, created_ts, strftime(created_ts, '%Y-%m') as month, coalesce(location, '(no studio)') as studio, coalesce(nullif(trim(source), ''), '(blank)') as source,
        ${leadChannelSql('source')} as channel, coalesce(is_trial_completed, false) as trial, coalesce(is_converted, false) as conv, coalesce(is_retained, false) as ret, coalesce(ltv, 0) as ltv,
        coalesce(${leadStatusSql('qualified')}, false) as qual, coalesce(${leadStatusSql('disqualified')}, false) as disq, coalesce(${leadStatusSql('unresponsive')}, false) as unresp
      from fct_leads where created_ts::date between ${sqlString(start)} and ${sqlString(end)}${lf}),
    p as (
      select distinct l.lead_id from l join fct_sales s on s.member_id = l.member_id and s.payment_ts >= l.created_ts
      where l.member_id is not null and not coalesce(s.is_voided, false) and coalesce(s.gross_amount, 0) > 0
        and coalesce(s.category, '') not in ('Retail', 'Money Credits', 'Gift Cards')
        and not regexp_matches(lower(coalesce(s.product, '')), '(2 for 1|credit|intro pack|^test$)'))
    select l.* exclude (member_id, created_ts), p.lead_id is not null as purch from l left join p using (lead_id)`);
  return rows.map((r) => ({ id: String(r.lead_id), month: String(r.month), studio: String(r.studio), source: String(r.source), channel: String(r.channel), trial: !!r.trial, purch: !!r.purch, conv: !!r.conv, ret: !!r.ret, ltv: Number(r.ltv) || 0, qual: !!r.qual, disq: !!r.disq, unresp: !!r.unresp }));
}

export interface LeadSection {
  id: string; title: string; icon: string; summary: string; notes?: string[];
  answer?: { question: string; headline: string; points: string[] };
  stats?: { label: string; value: number | null; format: string; note?: string }[];
  observations?: string[]; insights?: string[]; actions?: string[];
  definitions?: { term: string; text: string }[];
  visuals?: { funnel?: { label: string; value: number | null; note?: string }[] };
  charts: { result: AnalysisResult; chart: 'bar' | 'horizontal_bar' | 'stacked_bar' | 'pie' | 'line'; y: string[]; seriesBy?: string }[];
  tables: { result: AnalysisResult; style?: 'heat' | 'grouped' }[];
}

export const LEAD_METHOD = () => {
  const lr = leadRules();
  return [
    { term: 'Leads', text: 'CRM leads created in the period; studio = the centre on the lead.' },
    { term: 'Trials completed', text: 'Leads whose trial status shows a completed trial.' },
    { term: 'Purchasing members', text: 'Leads whose member record has a qualifying Momence sale on or after the date the lead was created. Excluded: retail, money credits, gift cards, partner credits, intro packs and 2-for-1 newcomer offers, test, voided and zero-value items.' },
    { term: 'Lead→trial / Trial→member / Lead→member', text: 'Trials ÷ leads; purchasing members ÷ trials; purchasing members ÷ leads.' },
    { term: 'Converted / Retained / LTV', text: "The CRM's conversion and retention status for the lead and its recorded lifetime value." },
    { term: 'Lead statuses', text: `Qualified = ${lr.qualified_statuses.join(' / ')} or a completed trial or conversion; Disqualified = ${lr.disqualified_statuses.join(' / ')}; Lost = ${lr.lost_statuses.join(' / ')}; Unresponsive = ${lr.unresponsive_statuses.join(' / ')}` },
    { term: 'Channel attribution', text: `Each lead has one source; sources are grouped into channels by the governed mapping (business rules). Sources not listed fall into “${lr.channel_fallback}”.` },
  ];
};

export async function leadChannelReport(input: { start: string; end: string; locations?: string[]; months?: string[] }) {
  const leads = await loadLeads(input.start, input.end, input.locations ?? []);
  const lr = leadRules();
  const order = [...lr.channels.map((c) => c.channel), lr.channel_fallback, '(blank)'];
  const chSort = (a: string, b: string) => (order.indexOf(a) < 0 ? 99 : order.indexOf(a)) - (order.indexOf(b) < 0 ? 99 : order.indexOf(b));
  // studios: the main studios on their own, the rest consolidated
  const byStudioRaw = group(leads, (l) => l.studio);
  const main = [...byStudioRaw.entries()].filter(([s, ls]) => s !== '(no studio)' && ls.length >= Math.max(150, leads.length * 0.05)).sort((a, b) => b[1].length - a[1].length).map(([s]) => s);
  const OTHER = 'Pop-ups & Other';
  for (const l of leads) if (!main.includes(l.studio)) l.studio = OTHER;
  const studios = [...main, ...(leads.some((l) => l.studio === OTHER) ? [OTHER] : [])];
  const months = [...new Set(leads.map((l) => l.month))].sort();
  const T = agg(leads);

  /* tables & charts */
  const channelTable = (ls: Lead[], title: string) => {
    const g = group(ls, (l) => l.channel);
    const rows = [...g.entries()].sort((a, b) => chSort(a[0], b[0])).map(([c, x]) => ({ channel: c, ...rowOf(agg(x)) }));
    return result(title, FUNNEL_COLS(col('channel', 'Channel', 'text', 'dimension')), rows, rowOf(agg(ls)));
  };
  const sourceTable = (ls: Lead[], title: string) => {
    const rows: Record<string, unknown>[] = [];
    for (const [c, x] of [...group(ls, (l) => l.channel).entries()].sort((a, b) => chSort(a[0], b[0]))) {
      rows.push({ name: c, _kind: 'group', ...rowOf(agg(x)) });
      for (const [s, y] of [...group(x, (l) => l.source).entries()].sort((a, b) => b[1].length - a[1].length)) rows.push({ name: s, _kind: 'sub', ...rowOf(agg(y)) });
    }
    return result(title, FUNNEL_COLS(col('name', 'Channel / source', 'text', 'dimension')).filter((c) => c.key !== 'retained'), rows, rowOf(agg(ls)));
  };
  const bar = (ls: Lead[], key: 'leads' | 'lead_to_member' | 'purchasers', title: string, label: string, format: string) => {
    const rows = [...group(ls, (l) => l.channel).entries()].sort((a, b) => chSort(a[0], b[0])).map(([c, x]) => ({ channel: c, [key]: rowOf(agg(x))[key] })).filter((r) => key === 'leads' || Number(r[key] ?? 0) > 0 || true);
    return result(title, [col('channel', 'Channel', 'text', 'dimension'), col(key, label, format)], rows);
  };
  const monthlyChannel = (ls: Lead[], title: string) => {
    const g = group(ls, (l) => l.channel);
    const rows = [...g.entries()].sort((a, b) => chSort(a[0], b[0])).map(([c, x]) => { const r: Record<string, unknown> = { channel: c }; for (const m of months) r[`m${m}`] = x.filter((l) => l.month === m).length; r.total = x.length; return r; });
    const tot: Record<string, unknown> = {}; for (const m of months) tot[`m${m}`] = ls.filter((l) => l.month === m).length; tot.total = ls.length;
    return result(title, [col('channel', 'Channel', 'text', 'dimension'), ...months.map((m) => col(`m${m}`, monL(m), 'number')), col('total', 'Total', 'number')], rows, tot);
  };
  const monthlyFunnel = (ls: Lead[], title: string) => {
    const rows = months.map((m) => ({ month: monL(m), ...rowOf(agg(ls.filter((l) => l.month === m))) }));
    return result(title, FUNNEL_COLS(col('month', 'Month', 'text', 'dimension')), rows, rowOf(agg(ls)));
  };
  const trendChart = (ls: Lead[], title: string) => {
    const rows: Record<string, unknown>[] = [];
    for (const m of months) for (const [c, x] of [...group(ls.filter((l) => l.month === m), (l) => l.channel).entries()].sort((a, b) => chSort(a[0], b[0]))) rows.push({ month: monL(m), channel: c, leads: x.length });
    return result(title, [col('month', 'Month', 'text', 'dimension'), col('channel', 'Channel', 'text', 'dimension'), col('leads', 'Leads', 'number')], rows);
  };
  const heat = () => {
    const chans = [...new Set(leads.map((l) => l.channel))].sort(chSort);
    const rowFor = (name: string, ls: Lead[]) => { const r: Record<string, unknown> = { studio: name }; for (const c of chans) { const x = ls.filter((l) => l.channel === c); r[`c${chans.indexOf(c)}`] = x.length >= 10 ? rate(x.filter((l) => l.purch).length, x.length) : null; } r.all = rate(ls.filter((l) => l.purch).length, ls.length); return r; };
    return result('Lead→member % by studio × channel (cells with 10+ leads)', [col('studio', 'Studio', 'text', 'dimension'), ...chans.map((c, i) => col(`c${i}`, c, 'percent')), col('all', 'All channels', 'percent')],
      [...studios.map((s) => rowFor(s, leads.filter((l) => l.studio === s))), rowFor('All studios', leads)]);
  };
  const studioScorecard = () => result('Studio scorecard', FUNNEL_COLS(col('studio', 'Studio', 'text', 'dimension')), studios.map((s) => ({ studio: s, ...rowOf(agg(leads.filter((l) => l.studio === s))) })), rowOf(T));
  const mapping = () => {
    const g = group(leads, (l) => l.channel);
    const rows = [...new Set([...order.filter((c) => c !== '(blank)'), ...g.keys()])].filter((c) => c !== '(blank)' || g.has(c)).map((c) => {
      const found = [...group(g.get(c) ?? [], (l) => l.source).entries()].sort((a, b) => b[1].length - a[1].length).map(([s, x]) => `${s} (${x.length})`);
      const rule = lr.channels.find((x) => x.channel === c);
      return { channel: c, rule: rule ? [...rule.sources, ...rule.patterns.map((p) => `pattern: ${p}`)].join(', ') || '—' : c === lr.channel_fallback ? 'any source not mapped elsewhere' : '—', found: found.join(', ') || '—', leads: g.get(c)?.length ?? 0 };
    });
    return result('Channel mapping — the sources included in each channel', [col('channel', 'Channel', 'text', 'dimension'), col('rule', 'Mapping rule', 'text', 'dimension'), col('found', 'Sources found this period (leads)', 'text', 'dimension'), col('leads', 'Leads', 'number')], rows);
  };

  /* narrative helpers */
  const chAgg = (ls: Lead[]) => [...group(ls, (l) => l.channel).entries()].map(([c, x]) => ({ c, a: agg(x) }));
  const best = (ls: Lead[], min = 30) => chAgg(ls).filter((x) => x.a.leads >= min).sort((a, b) => (rate(b.a.purch, b.a.leads) ?? 0) - (rate(a.a.purch, a.a.leads) ?? 0));
  const biggest = (ls: Lead[]) => chAgg(ls).sort((a, b) => b.a.leads - a.a.leads);
  const topSource = (ls: Lead[], min = 20) => [...group(ls, (l) => l.source).entries()].map(([s, x]) => ({ s, a: agg(x) })).filter((x) => x.a.leads >= min).sort((a, b) => b.a.purch - a.a.purch);
  const funnelOf = (a: Agg) => [{ label: 'Leads', value: a.leads }, { label: 'Trials completed', value: a.trials }, { label: 'Purchasing members', value: a.purch }];
  const statsOf = (a: Agg) => [{ label: 'Leads', value: a.leads, format: 'number' }, { label: 'Trials completed', value: a.trials, format: 'number', note: `${pctS(rate(a.trials, a.leads))} of leads` },
    { label: 'Purchasing members', value: a.purch, format: 'number', note: `${pctS(rate(a.purch, a.leads))} of leads` }, { label: 'Trial→member', value: rate(a.purch, a.trials), format: 'percent' },
    { label: 'Converted · retained', value: a.conv, format: 'number', note: `${a.ret} retained` }, { label: 'LTV', value: a.ltv, format: 'currency', note: a.purch ? `${inr(a.ltv / a.purch)} per purchaser` : undefined }];
  const observe = (ls: Lead[], scope: string) => {
    const a = agg(ls); const bg = biggest(ls), bs = best(ls, Math.max(15, ls.length * 0.03)), ts = topSource(ls, 10);
    const out: string[] = [];
    if (bg[0]) out.push(`${bg[0].c} brings the most leads at ${scope} — ${N(bg[0].a.leads)} (${pctS(rate(bg[0].a.leads, a.leads), 0)}), converting ${pctS(rate(bg[0].a.purch, bg[0].a.leads))} to purchasing members.`);
    if (bs[0] && bs[0].c !== bg[0]?.c) out.push(`${bs[0].c} converts best: ${pctS(rate(bs[0].a.purch, bs[0].a.leads))} lead→member on ${N(bs[0].a.leads)} leads.`);
    if (bs.length > 1) { const w = bs[bs.length - 1]; if ((rate(w.a.purch, w.a.leads) ?? 0) < (rate(a.purch, a.leads) ?? 0) * 0.6) out.push(`${w.c} lags at ${pctS(rate(w.a.purch, w.a.leads))} lead→member on ${N(w.a.leads)} leads${w.a.trials ? `, with ${pctS(rate(w.a.trials, w.a.leads))} reaching a trial` : ''}.`); }
    if (ts[0]) out.push(`Top source by purchasing members: ${ts[0].s} — ${N(ts[0].a.purch)} of ${N(ts[0].a.leads)} leads (${pctS(rate(ts[0].a.purch, ts[0].a.leads))}).`);
    const mm = months.map((m) => ls.filter((l) => l.month === m).length);
    if (mm.length >= 4) { const h1 = mm.slice(0, Math.floor(mm.length / 2)), h2 = mm.slice(Math.floor(mm.length / 2)); const av = (x: number[]) => x.reduce((p, q) => p + q, 0) / x.length; const ch = av(h1) ? av(h2) / av(h1) - 1 : null;
      if (ch !== null && Math.abs(ch) > 0.1) out.push(`Monthly lead volume ${ch > 0 ? 'rose' : 'fell'} ${pctS(Math.abs(ch), 0)} in the second half of the period (${Math.round(av(h2))}/month vs ${Math.round(av(h1))}).`); }
    if (a.unresp > a.leads * 0.15) out.push(`${N(a.unresp)} leads (${pctS(rate(a.unresp, a.leads), 0)}) are marked unresponsive.`);
    return out;
  };

  /* sections */
  const sections: LeadSection[] = [];
  const period = months.length ? `${monL(months[0])} – ${monL(months[months.length - 1])}` : '';
  sections.push({ id: 'lead_channels', title: 'Scope, definitions & channel mapping', icon: 'BookOpen',
    summary: `${N(T.leads)} leads created ${period} across ${studios.length} studio groups${studios.includes(OTHER) ? ` (smaller locations consolidated into “${OTHER}”)` : ''}. How each figure is defined and which sources make up each channel.`,
    definitions: LEAD_METHOD(), charts: [], tables: [{ result: mapping() }],
    notes: [`${leads.filter((l) => l.source === '(blank)').length} leads have no source recorded.`].filter((x) => !x.startsWith('0 ')) });

  const bAll = best(leads, Math.max(30, leads.length * 0.03)), gAll = biggest(leads);
  sections.push({ id: 'lead_channels_all', title: 'All studios — channel overview', icon: 'Megaphone',
    summary: 'Every channel through the funnel — leads, trials and purchasing members — with new-client outcomes and LTV, and how channel conversion differs by studio.',
    answer: { question: 'Which channels bring leads that become members?',
      headline: `${N(T.leads)} leads → ${N(T.trials)} trials (${pctS(rate(T.trials, T.leads))}) → ${N(T.purch)} purchasing members (${pctS(rate(T.purch, T.leads))} lead→member).${bAll[0] ? ` ${bAll[0].c} converts best (${pctS(rate(bAll[0].a.purch, bAll[0].a.leads))}); ${gAll[0]?.c} brings the most leads (${N(gAll[0]?.a.leads)}).` : ''}`,
      points: observe(leads, 'all studios') },
    stats: statsOf(T), visuals: { funnel: funnelOf(T) },
    charts: [{ result: bar(leads, 'leads', 'Leads by channel', 'Leads', 'number'), chart: 'horizontal_bar', y: ['leads'] }, { result: bar(leads, 'lead_to_member', 'Lead→member % by channel', 'Lead→member', 'percent'), chart: 'horizontal_bar', y: ['lead_to_member'] }],
    tables: [{ result: channelTable(leads, 'Funnel by channel — all studios') }, { result: heat(), style: 'heat' }, { result: studioScorecard() }] });

  for (const [i, s] of studios.entries()) {
    const ls = leads.filter((l) => l.studio === s); const a = agg(ls);
    const obs = observe(ls, s); const bs = best(ls, Math.max(15, ls.length * 0.03));
    sections.push({ id: `lead_channels_${i + 1}`, title: s, icon: 'MapPin',
      summary: `Lead funnel at ${s}: channels, the sources inside each channel and the monthly trend.`,
      answer: { question: `How do leads perform at ${s}?`, headline: `${N(a.leads)} leads → ${N(a.trials)} trials (${pctS(rate(a.trials, a.leads))}) → ${N(a.purch)} purchasing members (${pctS(rate(a.purch, a.leads))}).${bs[0] ? ` Best channel: ${bs[0].c} (${pctS(rate(bs[0].a.purch, bs[0].a.leads))}).` : ''}`, points: obs },
      stats: statsOf(a), observations: obs, visuals: { funnel: funnelOf(a) },
      charts: [{ result: bar(ls, 'leads', `Leads by channel — ${s}`, 'Leads', 'number'), chart: 'horizontal_bar', y: ['leads'] }, { result: trendChart(ls, `Monthly leads by channel — ${s}`), chart: 'stacked_bar', y: ['leads'], seriesBy: 'channel' }],
      tables: [{ result: channelTable(ls, `Funnel by channel — ${s}`) }, { result: sourceTable(ls, `Sources within each channel — ${s}`), style: 'grouped' },
        { result: monthlyChannel(ls, `Monthly leads by channel — ${s}`) }, { result: monthlyFunnel(ls, `Monthly funnel — ${s}`) }] });
  }

  /* report-level findings & recommendations */
  const highlights: string[] = [], concerns: string[] = [];
  const recs: { title: string; detail: string; priority: 'high' | 'medium' | 'low'; kpi: string }[] = [];
  highlights.push(`${N(T.purch)} of ${N(T.leads)} leads became purchasing members (${pctS(rate(T.purch, T.leads))}); trial→member ${pctS(rate(T.purch, T.trials))}.`);
  if (bAll[0]) highlights.push(`${bAll[0].c} is the most efficient channel: ${pctS(rate(bAll[0].a.purch, bAll[0].a.leads))} lead→member on ${N(bAll[0].a.leads)} leads, ${inr(bAll[0].a.ltv)} LTV.`);
  const sc = studios.map((s) => ({ s, a: agg(leads.filter((l) => l.studio === s)) })).filter((x) => x.a.leads >= 50).sort((x, y) => (rate(y.a.purch, y.a.leads) ?? 0) - (rate(x.a.purch, x.a.leads) ?? 0));
  if (sc.length > 1) highlights.push(`${sc[0].s} converts leads best (${pctS(rate(sc[0].a.purch, sc[0].a.leads))}); ${sc[sc.length - 1].s} lowest (${pctS(rate(sc[sc.length - 1].a.purch, sc[sc.length - 1].a.leads))}).`);
  for (const w of bAll.filter((x) => x.a.leads >= 100 && (rate(x.a.purch, x.a.leads) ?? 0) < (rate(T.purch, T.leads) ?? 0) * 0.6).slice(0, 2)) {
    concerns.push(`${w.c}: ${N(w.a.leads)} leads but only ${pctS(rate(w.a.purch, w.a.leads))} become members (${pctS(rate(w.a.trials, w.a.leads))} reach a trial).`);
    recs.push({ title: `Tighten ${w.c} follow-up`, detail: `Call ${w.c} leads within 24 hours and push a booked trial on the first contact; review lead quality with whoever owns the channel. Bringing it to the average lead→member rate adds about ${Math.max(0, Math.round(w.a.leads * (rate(T.purch, T.leads) ?? 0) - w.a.purch))} members.`, priority: 'high', kpi: 'Lead→member %' });
  }
  const lowTrial = chAgg(leads).filter((x) => x.a.leads >= 80 && (rate(x.a.trials, x.a.leads) ?? 0) < (rate(T.trials, T.leads) ?? 0) * 0.6).sort((a, b) => b.a.leads - a.a.leads)[0];
  if (lowTrial) { concerns.push(`${lowTrial.c} leads rarely reach a trial (${pctS(rate(lowTrial.a.trials, lowTrial.a.leads))} vs ${pctS(rate(T.trials, T.leads))} overall).`); recs.push({ title: `Book trials from ${lowTrial.c} leads`, detail: 'Offer a dated trial slot in the first reply and send a reminder the day before; track lead→trial weekly.', priority: 'medium', kpi: 'Lead→trial %' }); }
  if (bAll[0]) recs.push({ title: `Grow ${bAll[0].c}`, detail: `It converts at ${pctS(rate(bAll[0].a.purch, bAll[0].a.leads))}. Put more budget and attention here — e.g. referral rewards, partner events or better website forms, depending on the channel.`, priority: 'medium', kpi: 'Purchasing members' });
  if (T.unresp > T.leads * 0.12) { concerns.push(`${N(T.unresp)} leads (${pctS(rate(T.unresp, T.leads), 0)}) are unresponsive.`); recs.push({ title: 'Re-engage unresponsive leads', detail: 'Run a WhatsApp re-engagement sequence with a limited-time trial offer, then close out leads that stay silent after three touches.', priority: 'medium', kpi: 'Unresponsive leads' }); }
  if (sc.length > 1) recs.push({ title: `Share ${sc[0].s}'s follow-up playbook`, detail: `${sc[0].s} turns ${pctS(rate(sc[0].a.purch, sc[0].a.leads))} of leads into members vs ${pctS(rate(sc[sc.length - 1].a.purch, sc[sc.length - 1].a.leads))} at ${sc[sc.length - 1].s}; pair the sales teams for a month.`, priority: 'low', kpi: 'Lead→member % by studio' });

  const k = (id: string, label: string, value: number | null, format: string, description: string) => ({ id, label, format, description, higherIsBetter: true, additive: false, value, prev: null, chg: null, ytd: null, chgYtd: null, ly: null, chgLy: null, series: [] as (number | null)[] });
  const headline = [
    k('leads', 'Leads', T.leads, 'number', 'CRM leads created in the period.'),
    k('lead_trials', 'Trials completed', T.trials, 'number', 'Leads with a completed trial.'),
    k('lead_to_trial_rate', 'Lead→trial', rate(T.trials, T.leads), 'percent', 'Trials ÷ leads.'),
    k('l_purch', 'Purchasing members', T.purch, 'number', 'Leads with a qualifying sale on/after lead creation.'),
    k('l_l2m', 'Lead→member', rate(T.purch, T.leads), 'percent', 'Purchasing members ÷ leads.'),
    k('l_t2m', 'Trial→member', rate(T.purch, T.trials), 'percent', 'Purchasing members ÷ trials.'),
    k('lead_conversions', `Converted · ${T.ret} retained`, T.conv, 'number', 'CRM conversion status.'),
    k('lead_ltv', 'LTV', T.ltv, 'currency', 'Lifetime value recorded on the leads.'),
  ];
  return { sections, headline, summaryTables: [{ result: studioScorecard(), style: undefined as 'heat' | 'grouped' | undefined }], insights: { highlights, concerns, recommendations: recs.slice(0, 8) } };
}
