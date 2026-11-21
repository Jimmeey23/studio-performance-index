/**
 * Saved executive reports: the computed data, the AI commentary and the user's
 * layout / styling choices. Re-opening a report never re-spends AI tokens;
 * only an explicit "fresh report" rebuilds data and commentary.
 */
import { appDb, parseJson, ddl } from '../store/app.js';
import type { Report } from './build.js';
import { repairInsights, type ReportInsights } from './insights.js';

let ready = false;
async function db() {
  const d = await appDb();
  if (!ready) {
    await ddl(d, `create table if not exists exec_reports(id varchar primary key, user_id varchar, req_key varchar, label varchar, scope varchar, data json, insights json, layout json, created_at timestamp default now(), updated_at timestamp default now());`);
    await ddl(d, `alter table exec_reports add column if not exists kind varchar default 'executive';`);
    ready = true;
  }
  return d;
}
type Req = { start: string; end: string; locations: string[]; kind?: string; topics?: string[]; depth?: string; title?: string; audience?: string; briefs?: { prompt: string }[] };
export const reqKey = (r: Req) => r.kind === 'custom'
  ? `custom|${r.start}|${r.end}|${[...r.locations].sort().join(',')}|${(r.topics ?? []).join(',')}|${r.depth ?? ''}|${r.audience ?? ''}|${(r.title ?? '').trim().toLowerCase()}|${(r.briefs ?? []).map((b) => b.prompt.trim().toLowerCase()).join('§')}`
  : `${r.start}|${r.end}|${[...r.locations].sort().join(',')}`;
export interface SavedReport { id: string; data: Omit<Report, 'results'>; insights: ReportInsights | null; layout: unknown; created_at: string; updated_at: string }
type Row = { id: string; data: string; insights: string | null; layout: string | null; created_at: string; updated_at: string };
const hydrate = (r: Row | undefined | null): SavedReport | null => (r ? { id: r.id, data: parseJson(r.data), insights: r.insights ? repairInsights(parseJson<ReportInsights>(r.insights)) : null, layout: r.layout ? parseJson(r.layout) : null, created_at: r.created_at, updated_at: r.updated_at } : null);
const cols = `id, data, insights, layout, created_at::varchar created_at, updated_at::varchar updated_at`;

export async function findByRequest(userId: string, key: string) {
  return hydrate(await (await db()).one<Row>(`select ${cols} from exec_reports where user_id = ? and req_key = ? order by created_at desc limit 1`, [userId, key]));
}
export async function latest(userId: string, kind = 'executive') {
  return hydrate(await (await db()).one<Row>(`select ${cols} from exec_reports where user_id = ? and coalesce(kind, 'executive') = ? order by updated_at desc limit 1`, [userId, kind]));
}
export async function byId(userId: string, id: string) {
  return hydrate(await (await db()).one<Row>(`select ${cols} from exec_reports where user_id = ? and id = ?`, [userId, id]));
}
export async function list(userId: string, kind = 'executive') {
  return (await db()).all<{ id: string; label: string; scope: string; created_at: string; has_ai: boolean; title: string | null; topics: string | null }>(`select id, label, scope, created_at::varchar created_at, coalesce(json_extract_string(insights, '$.source') = 'ai', false) as has_ai,
    json_extract_string(data, '$.request.title') as title, json_extract(data, '$.request.topics')::varchar as topics
    from exec_reports where user_id = ? and coalesce(kind, 'executive') = ? order by created_at desc limit 60`, [userId, kind]);
}
export async function saveNew(userId: string, r: Report, layout: unknown) {
  const { results: _r, ...data } = r;
  await (await db()).all(`insert into exec_reports(id, user_id, req_key, label, scope, data, insights, layout, kind) values (?, ?, ?, ?, ?, ?, null, ?, ?)`,
    [r.id, userId, reqKey(r.request), r.period.label, r.scope, JSON.stringify(data), layout ? JSON.stringify(layout) : null, r.request.kind ?? 'executive']);
}
export async function saveInsights(id: string, ins: ReportInsights) {
  await (await db()).all(`update exec_reports set insights = ?, updated_at = now() where id = ?`, [JSON.stringify(ins), id]);
}
export async function saveLayout(userId: string, id: string, layout: unknown) {
  await (await db()).all(`update exec_reports set layout = ?, updated_at = now() where id = ? and user_id = ?`, [JSON.stringify(layout), id, userId]);
}
export async function remove(userId: string, id: string) {
  await (await db()).all(`delete from exec_reports where id = ? and user_id = ?`, [id, userId]);
}
