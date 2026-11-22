/**
 * Saved Executive Performance Reviews: the computed review and its AI commentary,
 * stored per part (glance + each section) so a part is written once and reused.
 */
import { appDb, parseJson, ddl } from '../store/app.js';
import type { Review, ReviewAI } from './review.js';

let ready = false;
async function db() {
  const d = await appDb();
  if (!ready) { await ddl(d, `create table if not exists exec_reviews(id varchar primary key, user_id varchar, req_key varchar, label varchar, scope varchar, data json, ai json, created_at timestamp default now(), updated_at timestamp default now());`); ready = true; }
  return d;
}
export const reviewKey = (r: { start: string; end: string; locations: string[] }) => `${r.start}|${r.end}|${[...r.locations].sort().join(',')}`;
export interface SavedReview { review: Review; ai: ReviewAI; created_at: string; updated_at: string }
type Row = { data: string; ai: string | null; created_at: string; updated_at: string };
const cols = `data, ai, created_at::varchar created_at, updated_at::varchar updated_at`;
const hydrate = (r: Row | null | undefined): SavedReview | null => (r ? { review: parseJson<Review>(r.data), ai: r.ai ? parseJson<ReviewAI>(r.ai) : { sections: {} }, created_at: r.created_at, updated_at: r.updated_at } : null);

export async function findByKey(uid: string, key: string) { return hydrate(await (await db()).one<Row>(`select ${cols} from exec_reviews where user_id = ? and req_key = ? order by created_at desc limit 1`, [uid, key])); }
export async function latest(uid: string) { return hydrate(await (await db()).one<Row>(`select ${cols} from exec_reviews where user_id = ? order by updated_at desc limit 1`, [uid])); }
/** Public read by link (no user check) — review links are shareable without sign-in. */
export async function byIdPublic(id: string) { return hydrate(await (await db()).one<Row>(`select ${cols} from exec_reviews where id = ?`, [id])); }
export async function byId(uid: string, id: string) { return hydrate(await (await db()).one<Row>(`select ${cols} from exec_reviews where user_id = ? and id = ?`, [uid, id])); }
export async function list(uid: string) {
  return (await db()).all<{ id: string; label: string; scope: string; created_at: string; updated_at: string; ai_parts: number }>(`select id, label, scope, created_at::varchar created_at, updated_at::varchar updated_at,
    coalesce(len(json_keys(ai, '$.sections')), 0) + case when json_extract(ai, '$.glance') is null then 0 else 1 end as ai_parts from exec_reviews where user_id = ? order by created_at desc limit 100`, [uid]);
}
export async function saveNew(uid: string, key: string, rv: Review) {
  await (await db()).all(`insert into exec_reviews(id, user_id, req_key, label, scope, data, ai) values (?, ?, ?, ?, ?, ?, ?)`, [rv.id, uid, key, rv.period.label, rv.scope, JSON.stringify(rv), JSON.stringify({ sections: {} })]);
}
export async function saveAi(id: string, ai: ReviewAI) { await (await db()).all(`update exec_reviews set ai = ?, updated_at = now() where id = ?`, [JSON.stringify(ai), id]); }
export async function touch(uid: string, id: string) { await (await db()).all(`update exec_reviews set updated_at = now() where id = ? and user_id = ?`, [id, uid]); }
export async function remove(uid: string, id: string) { await (await db()).all(`delete from exec_reviews where id = ? and user_id = ?`, [id, uid]); }
