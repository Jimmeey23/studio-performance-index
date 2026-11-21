/**
 * Backend persistence for the app experience (embedded DuckDB database, data/app.duckdb):
 *  • report_designs   — wireframe report designs (pages, layouts, elements) and their last rendered result
 *  • dashboard_cache  — computed workspace dashboards, so tabs open instantly even after a restart
 *                       (cleared whenever the data is refreshed)
 *  • user_prefs       — per-user settings and drafts (builder state, explorer filters, workspace filters…)
 * Executive and custom reports were already persisted in exec_reports; conversations in messages/results.
 */
import crypto from 'node:crypto';
import { appDb, parseJson } from './app.js';

let ready: Promise<void> | null = null;
async function db() {
  const d = await appDb();
  ready ??= (async () => {
    await d.exec(`create table if not exists report_designs(id varchar primary key, user_id varchar, title varchar, design json, rendered json, rendered_at timestamp, created_at timestamp default now(), updated_at timestamp default now())`);
    await d.exec(`create table if not exists dashboard_cache(key varchar primary key, data json, created_at timestamp default now())`);
    await d.exec(`create table if not exists user_prefs(user_id varchar, key varchar, value json, updated_at timestamp default now(), primary key (user_id, key))`);
  })();
  await ready;
  return d;
}

/* ── designs ── */
export interface DesignRow { id: string; title: string; design: unknown; rendered: unknown | null; rendered_at: string | null; created_at: string; updated_at: string }
type Raw = { id: string; title: string; design: string; rendered: string | null; rendered_at: string | null; created_at: string; updated_at: string };
const hydrate = (r?: Raw): DesignRow | null => (r ? { ...r, design: parseJson(r.design), rendered: r.rendered ? parseJson(r.rendered) : null } : null);
const cols = `id, title, design, rendered, rendered_at::varchar rendered_at, created_at::varchar created_at, updated_at::varchar updated_at`;
export async function listDesigns(uid: string) {
  return (await db()).all<{ id: string; title: string; pages: number; updated_at: string; rendered_at: string | null }>(
    `select id, title, coalesce(json_array_length(json_extract(design, '$.pages')), 0)::int pages, updated_at::varchar updated_at, rendered_at::varchar rendered_at from report_designs where user_id = ? order by updated_at desc limit 100`, [uid]);
}
export async function getDesign(uid: string, id: string) { return hydrate((await (await db()).all<Raw>(`select ${cols} from report_designs where user_id = ? and id = ?`, [uid, id]))[0]); }
export async function saveDesign(uid: string, id: string | null, design: { title?: string }) {
  const d = await db();
  const title = String(design.title ?? 'Untitled report').slice(0, 140);
  if (id && (await getDesign(uid, id))) {
    await d.all(`update report_designs set title = ?, design = ?, updated_at = now() where id = ? and user_id = ?`, [title, JSON.stringify(design), id, uid]);
    return id;
  }
  const nid = 'des_' + crypto.randomBytes(5).toString('hex');
  await d.all(`insert into report_designs(id, user_id, title, design) values (?, ?, ?, ?)`, [nid, uid, title, JSON.stringify(design)]);
  return nid;
}
export async function saveRendered(uid: string, id: string, rendered: unknown) {
  await (await db()).all(`update report_designs set rendered = ?, rendered_at = now() where id = ? and user_id = ?`, [JSON.stringify(rendered), id, uid]);
}
export async function deleteDesign(uid: string, id: string) { await (await db()).all(`delete from report_designs where id = ? and user_id = ?`, [id, uid]); }

/* ── dashboard cache (survives restarts; cleared on data refresh) ── */
export async function cachedDashboard(key: string, maxAgeMin: number) {
  const r = (await (await db()).all<{ data: string; age: number }>(`select data, date_diff('minute', created_at, now())::int age from dashboard_cache where key = ?`, [key]))[0];
  return r && r.age <= maxAgeMin ? parseJson(r.data) : null;
}
export async function storeDashboard(key: string, data: unknown) {
  const d = await db();
  await d.all(`delete from dashboard_cache where key = ?`, [key]);
  await d.all(`insert into dashboard_cache(key, data) values (?, ?)`, [key, JSON.stringify(data)]);
}
export async function clearDashboards() { await (await db()).all(`delete from dashboard_cache`); }

/* ── user preferences & drafts ── */
export async function getPrefs(uid: string): Promise<Record<string, unknown>> {
  const rows = await (await db()).all<{ key: string; value: string }>(`select key, value from user_prefs where user_id = ?`, [uid]);
  return Object.fromEntries(rows.map((r) => [r.key, parseJson(r.value)]));
}
export async function setPref(uid: string, key: string, value: unknown) {
  const d = await db();
  await d.all(`delete from user_prefs where user_id = ? and key = ?`, [uid, key.slice(0, 80)]);
  if (value !== null && value !== undefined) await d.all(`insert into user_prefs(user_id, key, value) values (?, ?, ?)`, [uid, key.slice(0, 80), JSON.stringify(value).slice(0, 200000)]);
}
