/**
 * Readout script: every readable text block in a rendered review (headlines, leads, paragraphs, insight and
 * recommendation items, notes), in reading order, each with a stable id such as `sales-p-03`.
 * The same walk is used to export the script for recording and, later, to attach a clip next to each block,
 * so ids line up as long as the report text is unchanged (`hash` flags edits).
 */
/** `same`: this text already appears earlier in the report (that block's id) — it reuses that clip, no new recording. */
export type Readout = { id: string; chapter: string; chapterTitle: string; kind: string; text: string; words: number; hash: string; file: string; same?: string };

const BLOCKS = 'h1, h2, h3, .epr-hero-lead, blockquote, p, li';
const SKIP = '.no-print, nav, button, table, .epr-kpi, .epr-narr, .epr-spk, .epr-modal, .epr-pop, .gx-layer, .epr-sticky, .epr-pin, .epr-chart, figure, .epr-tch-list, .epr-tb-list, .epr-hspark, .epr-end, [aria-hidden="true"]';
const PLACEHOLDER = /will appear here|not yet written|loading|writing commentary|click any number/i;
const KIND: [string, string][] = [['h1', 'title'], ['h2', 'heading'], ['h3', 'heading'], ['.epr-hero-lead', 'lead'], ['blockquote', 'quote'], ['li', 'item'], ['p', 'p']];

const clean = (t: string) => t.replace(/\s+/g, ' ').trim();
function hash(t: string) { let h = 2166136261; for (let i = 0; i < t.length; i++) { h ^= t.charCodeAt(i); h = Math.imul(h, 16777619); } return (h >>> 0).toString(36); }

export function collectReadouts(root: HTMLElement): (Readout & { el: HTMLElement })[] {
  const out: (Readout & { el: HTMLElement })[] = [];
  const first = new Map<string, Readout>();
  for (const sec of root.querySelectorAll<HTMLElement>('[data-spy]')) {
    const chapter = sec.id.replace(/^epr-/, '');
    const chapterTitle = clean(sec.querySelector('h1, h2')?.textContent ?? chapter);
    const counts: Record<string, number> = {};
    const taken: HTMLElement[] = [];
    for (const el of sec.querySelectorAll<HTMLElement>(BLOCKS)) {
      if (el.closest(SKIP)) continue;
      if (taken.some((t) => t.contains(el))) continue;            // an <li> already read covers the <p> inside it
      const text = clean(el.innerText || el.textContent || '').replace(/^\d{1,2}\s+(?=\S)/, '');   // drop list numbering ("03 …")
      const realWords = (text.match(/[a-z]{2,}/gi) ?? []).length;
      if (text.length < 20 || realWords < 4) continue;             // labels, leaderboard rows, number tiles, fragments
      if (PLACEHOLDER.test(text)) continue;
      taken.push(el);
      const kind = KIND.find(([sel]) => el.matches(sel))?.[1] ?? 'p';
      const k = kind === 'title' || kind === 'heading' ? 'h' : kind === 'lead' || kind === 'quote' ? 'lead' : kind === 'item' ? 'li' : 'p';
      counts[k] = (counts[k] ?? 0) + 1;
      const id = `${chapter}-${k}-${String(counts[k]).padStart(2, '0')}`;
      const h = hash(text.toLowerCase()); const prev = first.get(h);
      const r = { id, chapter, chapterTitle, kind, text, words: text.split(' ').length, hash: h, file: prev ? prev.file : `${id}.mp3`, ...(prev ? { same: prev.id } : {}), el };
      if (!prev) first.set(h, r);
      out.push(r);
    }
  }
  return out;
}

const csvCell = (v: string | number) => { const s = String(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
export function readoutCsv(rs: Readout[]) {
  const head = ['id', 'chapter', 'chapter_title', 'kind', 'file', 'record', 'reuses', 'words', 'est_seconds', 'hash', 'text'];
  return [head.join(','), ...rs.map((r) => [r.id, r.chapter, r.chapterTitle, r.kind, r.file, r.same ? 'no' : 'yes', r.same ?? '', r.words, Math.round(r.words / 2.5), r.hash, r.text].map(csvCell).join(','))].join('\n');
}
export function readoutMarkdown(rs: Readout[], title: string) {
  const rec = rs.filter((r) => !r.same); const total = rec.reduce((a, r) => a + r.words, 0);
  const lines = [`# ${title}`, '## Readout script', '', `${rec.length} clips to record · ${total.toLocaleString()} words · about ${Math.round(total / 150)} min of audio at 150 wpm. (${rs.length - rec.length} more blocks repeat text already listed and reuse those clips.)`, '',
    'Record one clip per block and name it with the block id (e.g. `sales-p-03.mp3`). Keep the ids: they are how each clip is placed next to its paragraph.', ''];
  let ch = '';
  for (const r of rec) {
    if (r.chapter !== ch) { ch = r.chapter; lines.push(`### ${r.chapterTitle}`, ''); }
    lines.push(`**${r.id}** · ${r.kind} · ${r.words} words · \`${r.file}\``, '', r.text, '');
  }
  return lines.join('\n');
}
export const readoutJson = (rs: Readout[], meta: Record<string, unknown>) => JSON.stringify({ ...meta, generatedAt: new Date().toISOString(), blocks: rs }, null, 2);
