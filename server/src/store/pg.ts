/**
 * Neon / Postgres backend for the app database.
 *
 * DuckDB's postgres extension attaches the Neon database and makes it the default catalog, so every
 * existing app query (reports, reviews, designs, prefs, config, conversations…) runs unchanged while
 * the rows live in Neon and survive redeploys. The schema is owned here and created with native
 * Postgres DDL. On first start, rows from an existing local data/app.duckdb are copied across once
 * (only into tables that are still empty), so switching backends loses nothing.
 */
import fs from 'node:fs';
import { Db } from '../warehouse/db.js';
import { log } from '../util/log.js';

const SCHEMA = `
create table if not exists users(id varchar primary key, email varchar unique, name varchar, role varchar, password_hash varchar, created_at timestamp default now());
create table if not exists conversations(id varchar primary key, user_id varchar, title varchar, pinned boolean default false, created_at timestamp default now(), updated_at timestamp default now(), domain varchar);
alter table conversations add column if not exists domain varchar;
create table if not exists messages(id varchar primary key, conversation_id varchar, role varchar, display text, llm text, created_at timestamp default now());
create index if not exists messages_conv on messages(conversation_id);
create table if not exists results(id varchar primary key, conversation_id varchar, payload text, created_at timestamp default now());
create table if not exists saved_reports(id varchar primary key, user_id varchar, title varchar, question varchar, conversation_id varchar, message_id varchar, display text, created_at timestamp default now());
create table if not exists audit(id varchar, user_id varchar, logged_at timestamp default now(), action varchar, detail text);
create table if not exists exec_reports(id varchar primary key, user_id varchar, req_key varchar, label varchar, scope varchar, data text, insights text, layout text, created_at timestamp default now(), updated_at timestamp default now(), kind varchar default 'executive');
alter table exec_reports add column if not exists kind varchar default 'executive';
create index if not exists exec_reports_user on exec_reports(user_id, updated_at);
create table if not exists exec_reviews(id varchar primary key, user_id varchar, req_key varchar, label varchar, scope varchar, data text, ai text, created_at timestamp default now(), updated_at timestamp default now());
create index if not exists exec_reviews_user on exec_reviews(user_id, updated_at);
create table if not exists report_designs(id varchar primary key, user_id varchar, title varchar, design text, rendered text, rendered_at timestamp, created_at timestamp default now(), updated_at timestamp default now());
create table if not exists dashboard_cache(key varchar primary key, data text, created_at timestamp default now());
create table if not exists user_prefs(user_id varchar, key varchar, value text, updated_at timestamp default now(), primary key (user_id, key));
create table if not exists app_config(key varchar primary key, value text, updated_at timestamp default now(), updated_by varchar);
create table if not exists knowledge_notes(id varchar primary key, text varchar, category varchar, source varchar, created_by varchar, created_at timestamp default now());
create table if not exists app_targets(month date, location varchar, metric varchar, target double precision, primary key (month, location, metric));
`;
/** DuckDB writes omitted columns as explicit NULLs, so Postgres column defaults never fire — fill them here. */
const DEFAULTS_FN = `create or replace function app_fill_defaults() returns trigger language plpgsql as $f$
declare j jsonb := to_jsonb(new);
begin
  if j ? 'created_at' and j->'created_at' = 'null'::jsonb then j := j || jsonb_build_object('created_at', now()); end if;
  if j ? 'updated_at' and j->'updated_at' = 'null'::jsonb then j := j || jsonb_build_object('updated_at', now()); end if;
  if j ? 'logged_at' and j->'logged_at' = 'null'::jsonb then j := j || jsonb_build_object('logged_at', now()); end if;
  if j ? 'pinned' and j->'pinned' = 'null'::jsonb then j := j || jsonb_build_object('pinned', false); end if;
  if j ? 'kind' and j->'kind' = 'null'::jsonb then j := j || jsonb_build_object('kind', 'executive'); end if;
  new := jsonb_populate_record(new, j);
  return new;
end $f$`;
const TABLES = ['users', 'conversations', 'messages', 'results', 'saved_reports', 'audit', 'exec_reports', 'exec_reviews', 'report_designs', 'user_prefs', 'app_config', 'knowledge_notes'];

const q = (s: string) => `'${s.replace(/'/g, "''")}'`;
const isConnErr = (e: unknown) => /connection|SSL|terminat|closed|reset|timeout|EOF|could not (?:connect|receive|send)/i.test(String((e as Error)?.message ?? e));

export async function openPostgresApp(url: string, localPath: string): Promise<Db> {
  const d = await Db.open(':memory:');
  await d.exec(`install postgres; load postgres;`);
  const attach = async () => {
    await d.exec(`attach ${q(url)} as app (type postgres)`);
    await d.exec(`use app`);
  };
  await attach();
  for (const stmt of SCHEMA.split(';').map((x) => x.trim()).filter(Boolean)) await d.exec(`call postgres_execute('app', ${q(stmt)})`);
  await d.exec(`call postgres_execute('app', ${q(DEFAULTS_FN)})`);
  for (const t of [...TABLES, 'dashboard_cache']) await d.exec(`call postgres_execute('app', ${q(`create or replace trigger ${t}_defaults before insert on ${t} for each row execute function app_fill_defaults()`)})`);
  await d.exec(`call postgres_clear_cache()`);
  await migrateLocal(d, localPath);

  // Neon scales to zero and drops idle connections: reattach once and retry on a connection error.
  const rawAll = d.all.bind(d); const rawExec = d.exec.bind(d);
  const retry = async <T>(fn: () => Promise<T>): Promise<T> => {
    try { return await fn(); } catch (e) {
      if (!isConnErr(e)) throw e;
      log.warn({ err: String(e) }, 'postgres connection lost, reattaching');
      try { await rawExec(`use memory`); await rawExec(`detach app`); } catch { /* already gone */ }
      await rawExec(`attach ${q(url)} as app (type postgres)`); await rawExec(`use app`);
      return fn();
    }
  };
  (d as { all: Db['all'] }).all = ((sql: string, params?: unknown[]) => retry(() => rawAll(sql, params))) as Db['all'];
  (d as { exec: Db['exec'] }).exec = ((sql: string) => retry(() => rawExec(sql))) as Db['exec'];
  log.info('app database: Neon/Postgres');
  return d;
}

/** Copy rows from a previous local app.duckdb into Postgres tables that are still empty. */
async function migrateLocal(d: Db, localPath: string) {
  if (!fs.existsSync(localPath)) return;
  try {
    await d.exec(`attach ${q(localPath)} as local_app (read_only)`);
  } catch (e) { log.warn({ err: String(e) }, 'local app.duckdb could not be opened for migration'); return; }
  try {
    for (const t of TABLES) {
      const local = await d.all<{ c: string }>(`select column_name c from duckdb_columns() where database_name = 'local_app' and table_name = ?`, [t]);
      if (!local.length) continue;
      const n = Number((await d.one<{ n: number }>(`select count(*)::int n from app.${t}`))?.n ?? 0);
      if (n > 0) continue;
      const remote = new Set((await d.all<{ c: string }>(`select column_name c from duckdb_columns() where database_name = 'app' and table_name = ?`, [t])).map((r) => r.c));
      const cols = local.map((r) => r.c).filter((c) => remote.has(c)).map((c) => `"${c}"`).join(', ');
      if (!cols) continue;
      await d.exec(`insert into app.${t} (${cols}) select ${cols} from local_app.main.${t}`);
      const m = Number((await d.one<{ n: number }>(`select count(*)::int n from app.${t}`))?.n ?? 0);
      if (m) log.info({ table: t, rows: m }, 'migrated local app data to Postgres');
    }
  } catch (e) { log.warn({ err: String(e) }, 'local → Postgres migration incomplete'); }
  finally { try { await d.exec(`detach local_app`); } catch { /* */ } }
}
