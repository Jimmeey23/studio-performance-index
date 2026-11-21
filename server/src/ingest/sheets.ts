import fs from 'node:fs';
import { google } from 'googleapis';
import { config } from '../config.js';
import type { SourceSpec, TabSpec } from '../sources.js';
import { log } from '../util/log.js';

export interface TabData { headers: string[]; rows: string[][] }

function auth() {
  if (!fs.existsSync(config.googleCredentialsFile)) {
    throw new Error(
      `Google service-account key not found at ${config.googleCredentialsFile}. ` +
        'See README › "Connect Google Sheets".',
    );
  }
  return new google.auth.GoogleAuth({
    keyFile: config.googleCredentialsFile,
    scopes: [
      'https://www.googleapis.com/auth/spreadsheets.readonly',
      'https://www.googleapis.com/auth/drive.metadata.readonly',
    ],
  });
}

export async function driveModifiedTime(fileId: string): Promise<string | null> {
  const drive = google.drive({ version: 'v3', auth: auth() });
  const r = await drive.files.get({ fileId, fields: 'modifiedTime', supportsAllDrives: true });
  return r.data.modifiedTime ?? null;
}

const colLetter = (n: number) => {
  let s = '';
  while (n > 0) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); }
  return s;
};

/**
 * Read one tab as formatted strings (exactly what users see in Sheets), in row
 * chunks so 200k+ row tabs don't exceed API response limits.
 */
export async function fetchTab(src: SourceSpec, tab: TabSpec): Promise<TabData> {
  const sheets = google.sheets({ version: 'v4', auth: auth() });
  const meta = await sheets.spreadsheets.get({
    spreadsheetId: src.spreadsheetId,
    fields: 'sheets.properties(title,gridProperties)',
  });
  const sheet = meta.data.sheets?.find((s) => s.properties?.title === tab.tab);
  if (!sheet) throw new Error(`Tab "${tab.tab}" not found in "${src.name}"`);
  const rowCount = sheet.properties?.gridProperties?.rowCount ?? 0;
  const colCount = sheet.properties?.gridProperties?.columnCount ?? 26;
  const lastCol = colLetter(colCount);
  const q = (r: string) => `'${tab.tab.replace(/'/g, "''")}'!${r}`;

  const chunk = tab.chunkRows ?? 50000;
  const ranges: string[] = [];
  for (let start = 1; start <= rowCount; start += chunk) {
    ranges.push(q(`A${start}:${lastCol}${Math.min(rowCount, start + chunk - 1)}`));
  }
  const all: string[][] = [];
  // batchGet a few chunks at a time to stay well within quota/payload limits.
  for (let i = 0; i < ranges.length; i += 4) {
    const res = await withRetry(() =>
      sheets.spreadsheets.values.batchGet({
        spreadsheetId: src.spreadsheetId,
        ranges: ranges.slice(i, i + 4),
        valueRenderOption: 'FORMATTED_VALUE',
        majorDimension: 'ROWS',
      }),
    );
    for (const vr of res.data.valueRanges ?? []) {
      for (const row of vr.values ?? []) all.push(row.map((c) => (c === null || c === undefined ? '' : String(c))));
    }
  }
  const [headerRow = [], ...body] = all;
  let width = headerRow.length;
  while (width > 0 && !String(headerRow[width - 1]).trim()) width--;
  const headers = headerRow.slice(0, width).map(String);
  const rows = body
    .map((r) => { const o = r.slice(0, width); while (o.length < width) o.push(''); return o; })
    .filter((r) => r.some((c) => c.trim() !== ''));
  log.info({ source: src.name, tab: tab.tab, rows: rows.length, cols: width }, 'fetched tab');
  return { headers, rows };
}

async function withRetry<T>(fn: () => Promise<T>, tries = 5): Promise<T> {
  let delay = 1500;
  for (let i = 1; ; i++) {
    try { return await fn(); } catch (e: unknown) {
      const code = (e as { code?: number }).code;
      if (i >= tries || (code && code < 429 && code !== 408)) throw e;
      await new Promise((r) => setTimeout(r, delay));
      delay *= 2;
    }
  }
}
