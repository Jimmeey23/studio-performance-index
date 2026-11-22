/**
 * Export / copy for the performance review. Works from the rendered report DOM so
 * every format matches what is on screen (including inline edits and pinned blocks).
 */

const SKIP = 'button, svg, canvas, video, audio, script, style, textarea, input, select, .no-print, .epr-sticky, [aria-hidden="true"]';

/** A clean copy of the report: interactive chrome removed. */
function cleanClone(root: HTMLElement): HTMLElement {
  const c = root.cloneNode(true) as HTMLElement;
  c.querySelectorAll(SKIP).forEach((el) => el.remove());
  c.querySelectorAll('[contenteditable]').forEach((el) => el.removeAttribute('contenteditable'));
  return c;
}

const txt = (el: Element) => (el.textContent ?? '').replace(/\s+/g, ' ').trim();
const cell = (s: string) => s.replace(/\|/g, '\\|');

function tableRows(t: HTMLTableElement): string[][] {
  return [...t.rows].map((r) => [...r.cells].map((c) => txt(c)));
}

/* ── Markdown ── */
export function toMarkdown(root: HTMLElement, title: string): string {
  const c = cleanClone(root);
  const out: string[] = [`# ${title}`, ''];
  const walk = (el: Element) => {
    const tag = el.tagName.toLowerCase();
    if (/^h[1-6]$/.test(tag)) { const t = txt(el); if (t) out.push('', `${'#'.repeat(Math.min(6, Number(tag[1]) + 1))} ${t}`, ''); return; }
    if (tag === 'p' || tag === 'blockquote') { const t = txt(el); if (t) out.push(tag === 'blockquote' ? `> ${t}` : t, ''); return; }
    if (tag === 'ul' || tag === 'ol') {
      [...el.children].filter((x) => x.tagName === 'LI').forEach((li, i) => { const t = txt(li); if (t) out.push(`${tag === 'ol' ? `${i + 1}.` : '-'} ${t}`); });
      out.push(''); return;
    }
    if (tag === 'table') {
      const rows = tableRows(el as HTMLTableElement).filter((r) => r.some(Boolean)); if (!rows.length) return;
      const w = Math.max(...rows.map((r) => r.length));
      const pad = (r: string[]) => [...r, ...Array(w - r.length).fill('')];
      out.push(`| ${pad(rows[0]).map(cell).join(' | ')} |`, `|${' --- |'.repeat(w)}`, ...rows.slice(1).map((r) => `| ${pad(r).map(cell).join(' | ')} |`), ''); return;
    }
    if (el.children.length === 0) { const t = txt(el); if (t && t.length > 1) out.push(t, ''); return; }
    [...el.children].forEach(walk);
  };
  walk(c);
  return out.join('\n').replace(/\n{3,}/g, '\n\n').trim() + '\n';
}

/* ── plain text ── */
export const toPlainText = (root: HTMLElement, title: string) =>
  toMarkdown(root, title).replace(/^#+ /gm, '').replace(/^\| ?/gm, '').replace(/ ?\|$/gm, '').replace(/ \| /g, '\t').replace(/^\t?(--- ?\t?)+$/gm, '').replace(/\\\|/g, '|');

/* ── CSV of every table ── */
export function toCsv(root: HTMLElement): string {
  const c = cleanClone(root); const q = (s: string) => (/[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);
  const parts: string[] = [];
  c.querySelectorAll('table').forEach((t, i) => {
    const holder = t.closest('section, article, div'); const h = holder?.querySelector('h1,h2,h3,h4,h5');
    parts.push(`# ${h ? txt(h) : `Table ${i + 1}`}`, ...tableRows(t).map((r) => r.map(q).join(',')), '');
  });
  return parts.join('\n');
}

/* ── self-contained HTML (styles inlined) ── */
function collectCss(): string {
  let css = '';
  for (const sh of [...document.styleSheets]) { try { for (const r of [...sh.cssRules]) css += r.cssText + '\n'; } catch { /* cross-origin sheet */ } }
  return css;
}
export function toHtml(root: HTMLElement, title: string): string {
  const c = cleanClone(root);
  const theme = document.documentElement.getAttribute('class') ?? '';
  return `<!doctype html><html class="${theme}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title.replace(/</g, '&lt;')}</title><style>${collectCss()}
body{background:#fff;margin:0}.epr-rv{opacity:1!important;transform:none!important}</style></head><body><div class="epr epr-standalone"><div style="max-width:1200px;margin:0 auto;padding:32px clamp(16px,5vw,64px)">${c.innerHTML}</div></div></body></html>`;
}

/* ── Word (.doc — Word opens HTML documents) ── */
export function toWord(root: HTMLElement, title: string): string {
  const c = cleanClone(root);
  return `<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word"><head><meta charset="utf-8"><title>${title}</title>
<style>body{font-family:Calibri,Arial,sans-serif;font-size:11pt;color:#111}h1,h2,h3,h4{font-family:Georgia,serif}table{border-collapse:collapse;margin:8pt 0}td,th{border:1px solid #ccc;padding:3pt 6pt;font-size:9pt}img{max-width:40px}</style></head><body><h1>${title}</h1>${c.innerHTML}</body></html>`;
}

/* ── Excel (.xls — every table on one sheet, titled) ── */
export function toExcel(root: HTMLElement, title: string): string {
  const c = cleanClone(root);
  const blocks = [...c.querySelectorAll('table')].map((t, i) => {
    const h = t.closest('section, article, div')?.querySelector('h1,h2,h3,h4,h5');
    return `<h3>${h ? txt(h) : `Table ${i + 1}`}</h3>${t.outerHTML}`;
  });
  return `<html xmlns:x="urn:schemas-microsoft-com:office:excel"><head><meta charset="utf-8"><title>${title}</title></head><body><h2>${title}</h2>${blocks.join('<br/>')}</body></html>`;
}

export function download(name: string, body: string, type: string) {
  const url = URL.createObjectURL(new Blob([type.includes('csv') ? '﻿' + body : body], { type }));
  const a = Object.assign(document.createElement('a'), { href: url, download: name });
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

/** Copies rich HTML (pastes formatted into Docs, Word, Gmail, Slack) with a plain-text fallback. */
export async function copyRich(root: HTMLElement, title: string) {
  const html = toWord(root, title); const plain = toPlainText(root, title);
  if (typeof ClipboardItem !== 'undefined' && navigator.clipboard?.write) {
    await navigator.clipboard.write([new ClipboardItem({ 'text/html': new Blob([html], { type: 'text/html' }), 'text/plain': new Blob([plain], { type: 'text/plain' }) })]);
  } else await navigator.clipboard.writeText(plain);
}
export const copyText = (s: string) => navigator.clipboard.writeText(s);

export const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 80) || 'report';
