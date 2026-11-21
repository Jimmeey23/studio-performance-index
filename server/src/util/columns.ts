/** Convert a sheet header into a stable snake_case column name. */
export function sanitize(h: string): string {
  const s = String(h ?? '')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[◉❖]/g, '')
    .replace(/%/g, ' pct ')
    .replace(/#/g, ' num ')
    .replace(/[^A-Za-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .toLowerCase();
  return s || 'col';
}

/** Sanitize a header row, de-duplicating repeated names with _2, _3 … */
export function sanitizeHeaders(headers: string[]): string[] {
  const seen = new Map<string, number>();
  return headers.map((h, i) => {
    let base = sanitize(h) || `col_${i + 1}`;
    if (/^\d/.test(base)) base = `c_${base}`;
    const n = (seen.get(base) ?? 0) + 1;
    seen.set(base, n);
    return n === 1 ? base : `${base}_${n}`;
  });
}
