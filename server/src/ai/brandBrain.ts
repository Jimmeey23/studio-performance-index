/**
 * Brand brain — what the analyst knows about Physique 57 India before it runs a single query.
 *
 *  1. House knowledge: config/brand-knowledge.md (brand, method, studios, formats, rates, policies) — editable in Settings.
 *  2. Learned from data: studios, trainers, class mix, product ladder and prices, lead channels, client mix,
 *     monthly benchmarks per studio and seasonality — recomputed from the warehouse after each sync (cached a day).
 *  3. Notes the team taught it: durable facts saved with the `remember` tool or in Settings (knowledge_notes).
 *
 * All three go into the cached part of the system prompt, so the knowledge costs little per question.
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { config, ROOT } from '../config.js';
import { runMetricsQuery } from '../semantic/engine.js';
import { appDb } from '../store/app.js';
import { fmtVal } from '../report/build.js';
import { log } from '../util/log.js';

const HOUSE = path.join(ROOT, 'config', 'brand-knowledge.md');
const LEARNED = path.join(config.dataDir, 'brand-brain.md');
const MAX_AGE = 24 * 3600e3;

export const houseKnowledge = () => { try { return fs.readFileSync(HOUSE, 'utf8'); } catch { return ''; } };
export const saveHouseKnowledge = (md: string) => { fs.writeFileSync(HOUSE, md.slice(0, 60000)); };

/* ── learned from data ── */
const iso = (d: Date) => d.toISOString().slice(0, 10);
function window12() {
  const n = new Date(Date.now() + 5.5 * 3600e3);
  const end = new Date(Date.UTC(n.getUTCFullYear(), n.getUTCMonth(), 0));           // last complete month end
  const start = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth() - 11, 1)); // 12 complete months
  const start24 = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth() - 23, 1));
  return { start: iso(start), end: iso(end), start24: iso(start24) };
}
const q = async (spec: Record<string, unknown>) => { try { return (await runMetricsQuery(spec)).rows; } catch (e) { log.warn({ err: (e as Error).message.slice(0, 160), spec: JSON.stringify(spec).slice(0, 200) }, 'brand brain query failed'); return []; } };
const v = (x: unknown, f: string) => fmtVal(x === null || x === undefined ? null : f === 'number' ? Math.round(Number(x)) : Number(x), f);
const blank = (x: unknown) => x === null || x === undefined || x === '(blank)' || x === '';

export async function buildLearned(): Promise<string> {
  const W = window12();
  const P = { start: W.start, end: W.end };
  const L: string[] = [`# Learned from the data (12 complete months: ${W.start.slice(0, 7)} → ${W.end.slice(0, 7)}; rebuilt ${new Date().toISOString().slice(0, 16).replace('T', ' ')} UTC)`];

  // studios
  const st = await q({ metrics: ['revenue', 'paying_clients', 'transactions', 'atv', 'visits', 'new_clients', 'conversion_rate'], dimensions: ['location'], ...P, limit: 30 });
  const totRev = st.reduce((a, r) => a + Number(r.revenue ?? 0), 0);
  L.push('\n## Studios (last 12 months)', ...st.filter((r) => !blank(r.location) && Number(r.revenue) > 0).sort((a, b) => Number(b.revenue) - Number(a.revenue))
    .map((r) => `- ${r.location}: revenue ${v(r.revenue, 'currency')} (${totRev ? ((Number(r.revenue) / totRev) * 100).toFixed(1) : '—'}% of total), ${v(r.paying_clients, 'number')} paying clients, ATV ${v(r.atv, 'currency')}, ${v(r.visits, 'number')} visits, ${v(r.new_clients, 'number')} new clients, trial→paid ${v(r.conversion_rate, 'percent')}`));

  // monthly benchmarks per studio
  const bm = await q({ metrics: ['revenue', 'visits', 'new_clients', 'conversion_rate', 'fill_rate', 'class_average', 'sheet_renewal_rate', 'leads'], dimensions: ['location'], grain: 'month', ...P, limit: 2000 });
  const byLoc = new Map<string, Record<string, unknown>[]>();
  for (const r of bm) if (!blank(r.location)) byLoc.set(String(r.location), [...(byLoc.get(String(r.location)) ?? []), r]);
  const avg = (rs: Record<string, unknown>[], k: string) => { const xs = rs.map((r) => Number(r[k])).filter((x) => isFinite(x) && x !== 0); return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null; };
  L.push('\n## Typical month per studio (12-month monthly averages — use as benchmarks)');
  for (const [loc, rs] of [...byLoc.entries()].filter(([, rs]) => rs.length >= 3).sort((a, b) => (avg(b[1], 'revenue') ?? 0) - (avg(a[1], 'revenue') ?? 0))) {
    L.push(`- ${loc}: revenue ${v(avg(rs, 'revenue'), 'currency')}, visits ${v(avg(rs, 'visits'), 'number')}, new clients ${v(avg(rs, 'new_clients'), 'number')}, trial→paid ${v(avg(rs, 'conversion_rate'), 'percent')}, fill ${v(avg(rs, 'fill_rate'), 'percent')}, class average ${v(avg(rs, 'class_average'), 'decimal')}, renewal (sheet) ${v(avg(rs, 'sheet_renewal_rate'), 'percent')}, leads ${v(avg(rs, 'leads'), 'number')}`);
  }

  // seasonality
  const se = await q({ metrics: ['revenue', 'visits', 'new_clients'], grain: 'month', start: W.start24, end: W.end, limit: 100 });
  if (se.length >= 12) {
    const mon = (r: Record<string, unknown>) => Number(String(r.period).slice(5, 7));
    const idx = (k: string) => { const all = se.map((r) => Number(r[k])).filter(isFinite); const mean = all.reduce((a, b) => a + b, 0) / all.length; const M = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
      return M.map((m, i) => { const xs = se.filter((r) => mon(r) === i + 1).map((r) => Number(r[k])).filter(isFinite); return xs.length ? `${m} ${Math.round(((xs.reduce((a, b) => a + b, 0) / xs.length) / mean) * 100)}` : null; }).filter(Boolean).join(', '); };
    L.push('\n## Seasonality (index, 100 = average month, last 24 months)', `- Revenue: ${idx('revenue')}`, `- Visits: ${idx('visits')}`, `- New clients: ${idx('new_clients')}`,
      '- Annual-membership pushes make some months lumpy; compare like-for-like months.');
  }

  // class formats (Class column)
  const cf = await q({ metrics: ['classes', 'class_checkins', 'class_average', 'fill_rate'], dimensions: ['class_name'], ...P, limit: 40 });
  const totCi = cf.reduce((a, r) => a + Number(r.class_checkins ?? 0), 0);
  L.push('\n## Class mix (Class column, last 12 months)', ...cf.filter((r) => !blank(r.class_name)).sort((a, b) => Number(b.class_checkins) - Number(a.class_checkins)).slice(0, 25)
    .map((r) => `- ${r.class_name}: ${v(r.classes, 'number')} classes, ${totCi ? ((Number(r.class_checkins) / totCi) * 100).toFixed(1) : '—'}% of check-ins, class average ${v(r.class_average, 'decimal')}, fill ${v(r.fill_rate, 'percent')}`));

  // trainers (last 90 days)
  const t90 = new Date(Date.parse(W.end) - 89 * 864e5);
  const tr = await q({ metrics: ['classes', 'class_average', 'fill_rate'], dimensions: ['teacher', 'location'], start: iso(t90), end: W.end, limit: 400 });
  const tByLoc = new Map<string, string[]>();
  for (const r of tr.filter((r) => !blank(r.teacher) && Number(r.classes) >= 4).sort((a, b) => Number(b.classes) - Number(a.classes))) tByLoc.set(String(r.location), [...(tByLoc.get(String(r.location)) ?? []), `${r.teacher} (${r.classes} classes, avg ${v(r.class_average, 'decimal')})`]);
  L.push('\n## Active trainers by studio (last 90 days, 4+ classes)', ...[...tByLoc.entries()].map(([loc, ts]) => `- ${loc}: ${ts.slice(0, 18).join('; ')}`));

  // products & price ladder
  const pf = await q({ metrics: ['revenue', 'units_sold', 'transactions'], dimensions: ['product_family'], ...P, limit: 30 });
  L.push('\n## Revenue by product family (last 12 months)', ...pf.filter((r) => !blank(r.product_family)).sort((a, b) => Number(b.revenue) - Number(a.revenue)).map((r) => `- ${r.product_family}: ${v(r.revenue, 'currency')} (${totRev ? ((Number(r.revenue) / totRev) * 100).toFixed(1) : '—'}%), ${v(r.units_sold, 'number')} units`));
  const pr = await q({ metrics: ['revenue', 'units_sold', 'avg_unit_price', 'discount_rate'], dimensions: ['product'], ...P, limit: 40 });
  L.push('\n## Top products (last 12 months: revenue, units, average price paid incl. GST, discount %)', ...pr.filter((r) => !blank(r.product)).sort((a, b) => Number(b.revenue) - Number(a.revenue)).slice(0, 25)
    .map((r) => `- ${r.product}: ${v(r.revenue, 'currency')}, ${v(r.units_sold, 'number')} units, avg ${v(r.avg_unit_price, 'currency')}, discount ${v(r.discount_rate, 'percent')}`));

  // leads & new-client mix
  const lc = await q({ metrics: ['leads', 'lead_to_trial_rate', 'lead_conversion_rate'], dimensions: ['channel'], ...P, limit: 30 });
  const totL = lc.reduce((a, r) => a + Number(r.leads ?? 0), 0);
  L.push('\n## Lead channels (last 12 months)', ...lc.filter((r) => !blank(r.channel)).sort((a, b) => Number(b.leads) - Number(a.leads)).map((r) => `- ${r.channel}: ${v(r.leads, 'number')} leads (${totL ? ((Number(r.leads) / totL) * 100).toFixed(1) : '—'}%), lead→trial ${v(r.lead_to_trial_rate, 'percent')}, lead→member ${v(r.lead_conversion_rate, 'percent')}`));
  const nm = await q({ metrics: ['new_clients', 'conversion_rate', 'retention_rate'], dimensions: ['new_client_type'], ...P, limit: 20 });
  L.push('\n## New-client mix by first-visit type (last 12 months — conversion differs hugely by type)', ...nm.filter((r) => !blank(r.new_client_type)).sort((a, b) => Number(b.new_clients) - Number(a.new_clients)).map((r) => `- ${r.new_client_type}: ${v(r.new_clients, 'number')} new clients, trial→paid ${v(r.conversion_rate, 'percent')}, retained ${v(r.retention_rate, 'percent')}`));

  L.push('\n(These are context and benchmarks only. Always quote numbers from tool results in answers.)');
  const md = L.join('\n');
  if (st.length) fs.writeFileSync(LEARNED, md); // don't cache an empty brain before the first sync
  return md;
}
let building: Promise<string> | null = null;
/** Cached learned facts; rebuilt when older than a day (or forced after a sync). */
export async function learnedKnowledge(force = false): Promise<string> {
  try {
    const st = fs.statSync(LEARNED);
    if (!force && Date.now() - st.mtimeMs < MAX_AGE) return fs.readFileSync(LEARNED, 'utf8');
  } catch { /* not built yet */ }
  building ??= buildLearned().finally(() => { building = null; });
  try { return await building; } catch (e) { log.warn({ err: (e as Error).message }, 'brand brain build failed'); return ''; }
}

/* ── notes the team taught it ── */
export type Note = { id: string; text: string; category: string; source: string; created_by: string; created_at: string };
async function notesDb() {
  const db = await appDb();
  await db.exec(`create table if not exists knowledge_notes(id varchar primary key, text varchar, category varchar, source varchar, created_by varchar, created_at timestamp default now())`);
  return db;
}
export async function listNotes(): Promise<Note[]> { return (await notesDb()).all<Note>(`select id, text, category, source, created_by, created_at::varchar created_at from knowledge_notes order by created_at desc`); }
export async function addNote(text: string, category = 'general', source = 'assistant', by = 'assistant'): Promise<Note> {
  const t = text.trim().slice(0, 600);
  if (t.length < 4) throw new Error('Note is too short');
  const db = await notesDb();
  const dup = await db.all<{ id: string }>(`select id from knowledge_notes where lower(text) = lower(?)`, [t]);
  if (dup.length) return (await listNotes()).find((n) => n.id === dup[0].id)!;
  const id = 'n_' + crypto.randomBytes(5).toString('hex');
  await db.all(`insert into knowledge_notes(id, text, category, source, created_by) values (?, ?, ?, ?, ?)`, [id, t, category.slice(0, 40), source, by]);
  return (await listNotes()).find((n) => n.id === id)!;
}
export async function deleteNote(id: string) { await (await notesDb()).all(`delete from knowledge_notes where id = ?`, [id]); }

/** Everything the analyst knows about the brand, for the cached system prompt. */
export async function brandContext(): Promise<string> {
  const [house, learned, notes] = await Promise.all([houseKnowledge(), learnedKnowledge(), listNotes().catch(() => [] as Note[])]);
  const n = notes.slice(0, 80).map((x) => `- [${x.category}] ${x.text}`).join('\n');
  return [house && `# BRAND KNOWLEDGE\n${house}`, learned, n && `# Notes the team has taught you (durable facts and preferences — follow them)\n${n}`].filter(Boolean).join('\n\n');
}

/** Keyword search across all brand knowledge — for the brand_knowledge tool. */
export async function searchKnowledge(query: string): Promise<{ section: string; text: string }[]> {
  const all = await brandContext();
  const words = query.toLowerCase().split(/\W+/).filter((w) => w.length > 2);
  const sections = all.split(/\n(?=#{1,3} )/);
  return sections.map((s) => ({ s, score: words.reduce((a, w) => a + (s.toLowerCase().split(w).length - 1), 0) }))
    .filter((x) => x.score > 0).sort((a, b) => b.score - a.score).slice(0, 5)
    .map((x) => ({ section: x.s.split('\n')[0].replace(/^#+\s*/, ''), text: x.s.slice(0, 3500) }));
}
