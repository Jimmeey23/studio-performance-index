import { DuckDBInstance, DuckDBConnection } from '@duckdb/node-api';
import { config } from '../config.js';

export type Row = Record<string, unknown>;

function normalise(v: unknown): unknown {
  if (typeof v === 'bigint') return Number(v);
  if (v === null || v === undefined) return null;
  if (typeof v === 'object') {
    const s = String(v);
    // DuckDB value wrappers (DATE, TIMESTAMP, DECIMAL, ...) stringify sensibly.
    if (/^-?\d+(\.\d+)?$/.test(s)) return Number(s);
    return s;
  }
  return v;
}

export class Db {
  private constructor(private inst: DuckDBInstance, private conn: DuckDBConnection) {}

  static async open(path: string, readOnly = false): Promise<Db> {
    // Keep the database engine lean on small hosts (Railway): bounded memory and threads, configurable by env.
    const limits = { memory_limit: process.env.DUCKDB_MEMORY_LIMIT || '512MB', threads: process.env.DUCKDB_THREADS || '2' };
    const inst = await DuckDBInstance.create(path, readOnly ? { access_mode: 'READ_ONLY', ...limits } : limits);
    const conn = await inst.connect();
    return new Db(inst, conn);
  }

  async exec(sql: string): Promise<void> {
    await this.conn.run(sql);
  }

  async all<T extends Row = Row>(sql: string, params: unknown[] = []): Promise<T[]> {
    const reader = params.length
      ? await this.conn.runAndReadAll(sql, params as never)
      : await this.conn.runAndReadAll(sql);
    const rows = reader.getRowObjects();
    return rows.map((r) => {
      const o: Row = {};
      for (const [k, v] of Object.entries(r)) o[k] = normalise(v);
      return o as T;
    });
  }

  async one<T extends Row = Row>(sql: string, params: unknown[] = []): Promise<T | undefined> {
    return (await this.all<T>(sql, params))[0];
  }

  async columns(table: string): Promise<{ name: string; type: string }[]> {
    const rows = await this.all<{ column_name: string; data_type: string }>(
      `select column_name, data_type from information_schema.columns where table_name = ? order by ordinal_position`,
      [table],
    );
    return rows.map((r) => ({ name: r.column_name, type: r.data_type }));
  }

  async tableExists(table: string): Promise<boolean> {
    const r = await this.one(`select count(*) as n from information_schema.tables where table_name = ?`, [table]);
    return Number(r?.n) > 0;
  }

  close() {
    this.conn.closeSync();
  }
}

let _wh: Db | null = null;
export async function warehouse(): Promise<Db> {
  if (!_wh) {
    const d = await Db.open(config.warehousePath);
    // A model is skipped when its source tab was never synced. Turn DuckDB's catalog error into a clear, actionable one.
    const raw = d.all.bind(d);
    (d as { all: Db['all'] }).all = (async (sql: string, params?: unknown[]) => {
      try { return await raw(sql, params); } catch (e) {
        const m = String((e as Error)?.message ?? e).match(/Table with name (\w+) does not exist/);
        if (!m) throw e;
        const { MODELS } = await import('./models.js');
        const model = MODELS.find((x) => x.name === m[1]);
        const src = model?.sourceOfTruth ? ` "${model.sourceOfTruth}"` : '';
        const err = new Error(`Data not loaded: ${m[1]} is missing because its source${src} hasn't been synced into this server's warehouse. Run Settings › Sync from Google Sheets (force), and check that sheet is shared with the service account. See the sync report for the skipped model.`);
        (err as Error & { status?: number }).status = 409;
        throw err;
      }
    }) as Db['all'];
    _wh = d;
  }
  return _wh;
}

export const sqlString = (s: string) => `'${s.replace(/'/g, "''")}'`;
export const ident = (s: string) => `"${s.replace(/"/g, '""')}"`;
