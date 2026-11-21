import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { config } from '../config.js';
import { Db, ident, sqlString } from '../warehouse/db.js';
import { sanitizeHeaders } from '../util/columns.js';
import type { TabData } from './sheets.js';

export async function ensureMetaTables(db: Db) {
  await db.exec(`
    create table if not exists _meta_columns(raw_table varchar, position int, column_name varchar, original_header varchar);
    create table if not exists _tab_state(raw_table varchar primary key, source_key varchar, source_name varchar, tab varchar,
      drive_modified varchar, content_hash varchar, row_count bigint, col_count int, loaded_at timestamp);
    create table if not exists _sync_log(id varchar, started_at timestamp, finished_at timestamp, mode varchar, status varchar,
      details json);
  `);
}

const csvCell = (v: string) => (/[",\n\r]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);

export interface LoadResult {
  rawTable: string; rows: number; changed: boolean;
  inserted: number; removed: number; unchanged: number;
}

/**
 * Replace raw_<table> with the tab contents. Each row carries a content hash so
 * the sync log can report row-level inserts/removals, and unchanged tabs are
 * skipped entirely (no model rebuild needed).
 */
export async function loadRawTab(
  db: Db, table: string, data: TabData,
  meta: { sourceKey: string; sourceName: string; tab: string; driveModified?: string | null },
): Promise<LoadResult> {
  const rawTable = `raw_${table}`;
  const cols = sanitizeHeaders(data.headers);
  const hashes = data.rows.map((r) => crypto.createHash('md5').update(r.join('\u0001')).digest('hex'));
  const contentHash = crypto.createHash('md5').update(cols.join('|') + hashes.join('')).digest('hex');

  const prev = await db.one<{ content_hash: string }>(`select content_hash from _tab_state where raw_table = ?`, [rawTable]);
  const exists = await db.tableExists(rawTable);
  if (exists && prev?.content_hash === contentHash) {
    return { rawTable, rows: data.rows.length, changed: false, inserted: 0, removed: 0, unchanged: data.rows.length };
  }

  let inserted = data.rows.length, removed = 0, unchanged = 0;
  if (exists) {
    const old = new Set((await db.all<{ h: string }>(`select _row_hash as h from ${ident(rawTable)}`)).map((r) => r.h));
    const now = new Set(hashes);
    inserted = hashes.filter((h) => !old.has(h)).length;
    unchanged = hashes.length - inserted;
    removed = [...old].filter((h) => !now.has(h)).length;
  }

  const file = path.join(config.rawDir, `${rawTable}.csv`);
  const out = fs.createWriteStream(file, { encoding: 'utf8' });
  out.write([...cols, '_row_num', '_row_hash'].map(csvCell).join(',') + '\n');
  data.rows.forEach((r, i) => out.write([...r.map((c) => csvCell(c ?? '')), String(i + 2), hashes[i]].join(',') + '\n'));
  await new Promise<void>((res, rej) => out.end((e?: Error | null) => (e ? rej(e) : res())));

  const colTypes = [...cols.map((c) => `${sqlString(c)}: 'VARCHAR'`), `'_row_num': 'BIGINT'`, `'_row_hash': 'VARCHAR'`].join(', ');
  await db.exec(`
    create or replace table ${ident(rawTable)} as
    select * from read_csv(${sqlString(file)}, header=true, quote='"', escape='"', columns={${colTypes}},
      null_padding=true, max_line_size=10000000, parallel=false);
    delete from _meta_columns where raw_table = ${sqlString(rawTable)};
  `);
  const metaRows = cols.map((c, i) => `(${sqlString(rawTable)}, ${i + 1}, ${sqlString(c)}, ${sqlString(data.headers[i] ?? '')})`);
  if (metaRows.length) await db.exec(`insert into _meta_columns values ${metaRows.join(',')}`);
  await db.exec(`
    insert or replace into _tab_state values (${sqlString(rawTable)}, ${sqlString(meta.sourceKey)}, ${sqlString(meta.sourceName)},
      ${sqlString(meta.tab)}, ${meta.driveModified ? sqlString(meta.driveModified) : 'null'}, ${sqlString(contentHash)},
      ${data.rows.length}, ${cols.length}, now());
  `);
  return { rawTable, rows: data.rows.length, changed: true, inserted, removed, unchanged };
}
