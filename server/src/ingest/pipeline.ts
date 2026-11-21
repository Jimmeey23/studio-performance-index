import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { warehouse, sqlString } from '../warehouse/db.js';
import { SOURCES } from '../sources.js';
import { fetchTab, driveModifiedTime, type TabData } from './sheets.js';
import { parseWorkbook } from './xlsx.js';
import { ensureMetaTables, loadRawTab, type LoadResult } from './load.js';
import { buildModels, type BuildReport } from '../warehouse/models.js';
import { buildDictionary, runQualityChecks } from '../warehouse/quality.js';
import { log } from '../util/log.js';

export interface SyncReport {
  id: string; mode: string; status: 'ok' | 'partial' | 'error';
  startedAt: string; finishedAt?: string;
  tabs: (LoadResult & { source: string; tab: string; skippedReason?: string; error?: string })[];
  models: BuildReport[];
  quality?: { errors: number; warnings: number };
  error?: string;
}

let running: Promise<SyncReport> | null = null;
export const syncInProgress = () => running !== null;

/**
 * Incremental sync from Google Sheets: a spreadsheet whose Drive modifiedTime
 * hasn't changed is skipped; changed tabs are reloaded only if their content
 * hash differs; only models downstream of changed raw tables are rebuilt.
 */
export function syncFromGoogle(opts: { force?: boolean } = {}): Promise<SyncReport> {
  if (running) return running;
  running = (async () => {
    const db = await warehouse();
    await ensureMetaTables(db);
    const report: SyncReport = { id: crypto.randomUUID(), mode: 'google', status: 'ok', startedAt: new Date().toISOString(), tabs: [], models: [] };
    const changed = new Set<string>();
    for (const src of SOURCES) {
      let modified: string | null = null;
      try { modified = await driveModifiedTime(src.spreadsheetId); } catch (e) { log.warn({ src: src.name, err: (e as Error).message }, 'drive metadata failed'); }
      for (const tab of src.tabs) {
        const rawTable = `raw_${tab.table}`;
        try {
          const prev = await db.one<{ drive_modified: string }>(`select drive_modified from _tab_state where raw_table = ?`, [rawTable]);
          if (!opts.force && modified && prev?.drive_modified === modified && (await db.tableExists(rawTable))) {
            report.tabs.push({ source: src.name, tab: tab.tab, rawTable, rows: 0, changed: false, inserted: 0, removed: 0, unchanged: 0, skippedReason: 'spreadsheet unchanged since last sync' });
            continue;
          }
          const data = await fetchTab(src, tab);
          const r = await loadRawTab(db, tab.table, data, { sourceKey: src.key, sourceName: src.name, tab: tab.tab, driveModified: modified });
          if (r.changed) changed.add(rawTable);
          else await db.exec(`update _tab_state set drive_modified = ${modified ? sqlString(modified) : 'null'} where raw_table = ${sqlString(rawTable)}`);
          report.tabs.push({ source: src.name, tab: tab.tab, ...r });
        } catch (e) {
          report.status = 'partial';
          report.tabs.push({ source: src.name, tab: tab.tab, rawTable, rows: 0, changed: false, inserted: 0, removed: 0, unchanged: 0, error: (e as Error).message });
          log.error({ src: src.name, tab: tab.tab, err: (e as Error).message }, 'tab sync failed');
        }
      }
    }
    await finish(report, changed, opts.force);
    return report;
  })().finally(() => { running = null; });
  return running;
}

/** Load exported workbooks (.xlsx) — used for the first snapshot or when Google access isn't configured. */
export async function syncFromFiles(files: { name: string; buffer: Buffer }[]): Promise<SyncReport> {
  if (running) await running;
  const db = await warehouse();
  await ensureMetaTables(db);
  const report: SyncReport = { id: crypto.randomUUID(), mode: 'upload', status: 'ok', startedAt: new Date().toISOString(), tabs: [], models: [] };
  const changed = new Set<string>();
  for (const f of files) {
    try {
      const { source, tabs } = parseWorkbook(f.buffer, f.name);
      for (const spec of source.tabs) {
        const data: TabData | undefined = tabs.get(spec.tab);
        if (!data) { report.tabs.push({ source: source.name, tab: spec.tab, rawTable: `raw_${spec.table}`, rows: 0, changed: false, inserted: 0, removed: 0, unchanged: 0, error: `tab missing in ${f.name}` }); report.status = 'partial'; continue; }
        const r = await loadRawTab(db, spec.table, data, { sourceKey: source.key, sourceName: source.name, tab: spec.tab, driveModified: null });
        if (r.changed) changed.add(r.rawTable);
        report.tabs.push({ source: source.name, tab: spec.tab, ...r });
      }
    } catch (e) {
      report.status = 'partial';
      report.tabs.push({ source: f.name, tab: '*', rawTable: '', rows: 0, changed: false, inserted: 0, removed: 0, unchanged: 0, error: (e as Error).message });
    }
  }
  await finish(report, changed);
  return report;
}

export async function syncFromDir(dir: string) {
  const files = fs.readdirSync(dir).filter((f) => /\.xlsx$/i.test(f)).map((f) => ({ name: f, buffer: fs.readFileSync(path.join(dir, f)) }));
  if (!files.length) throw new Error(`No .xlsx files in ${dir}`);
  return syncFromFiles(files);
}

export async function rebuildOnly(): Promise<SyncReport> {
  const db = await warehouse();
  await ensureMetaTables(db);
  const report: SyncReport = { id: crypto.randomUUID(), mode: 'rebuild', status: 'ok', startedAt: new Date().toISOString(), tabs: [], models: [] };
  await finish(report, new Set(), true);
  return report;
}

async function finish(report: SyncReport, changed: Set<string>, force = false) {
  const db = await warehouse();
  const anyChange = changed.size > 0 || force || !(await db.tableExists('fct_sales'));
  if (anyChange) {
    report.models = await buildModels(db, force ? undefined : changed);
    if (report.models.some((m) => m.status === 'error')) report.status = 'partial';
    await buildDictionary(db);
    const q = await runQualityChecks(db);
    report.quality = { errors: q.filter((x) => x.severity === 'error').length, warnings: q.filter((x) => x.severity === 'warning').length };
  }
  report.finishedAt = new Date().toISOString();
  const ms = new Date(report.finishedAt).getTime() - new Date(report.startedAt).getTime();
  await db.exec(`insert into _sync_log values (${sqlString(report.id)}, now()::timestamp - interval ${Math.round(ms)} millisecond, now()::timestamp,
    ${sqlString(report.mode)}, ${sqlString(report.status)}, ${sqlString(JSON.stringify(report))})`);
  log.info({ id: report.id, status: report.status, changed: [...changed] }, 'sync finished');
}
