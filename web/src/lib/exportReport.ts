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

/* ── PDF: rendered with html-to-image (the browser's own layout engine, so every style survives)
      and laid out on A4 pages with jsPDF — page per chapter, no element cut unless it is taller than a page ── */
export async function toPdf(root: HTMLElement, title: string, onProgress?: (msg: string) => void): Promise<void> {
  const [{ toCanvas, getFontEmbedCSS }, { jsPDF }] = await Promise.all([import('html-to-image'), import('jspdf')]);
  document.documentElement.classList.add('epr-exporting');
  root.querySelectorAll('img[loading="lazy"]').forEach((i) => i.setAttribute('loading', 'eager'));
  await Promise.all([...root.querySelectorAll('img')].map((i) => (i.complete ? null : new Promise((r) => { i.onload = i.onerror = r; setTimeout(r, 4000); }))));
  await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  try {
    const pdf = new jsPDF({ unit: 'pt', format: 'a4', compress: true });
    const PW = pdf.internal.pageSize.getWidth(), PH = pdf.internal.pageSize.getHeight();
    const M = 30, TOP = 34, BOTTOM = 40, CW = PW - 2 * M, CH = PH - TOP - BOTTOM;
    const rootBox = root.getBoundingClientRect();
    const k = CW / rootBox.width;                       // pt per CSS px — the whole report keeps its proportions
    let fontEmbedCSS: string | undefined;
    try { fontEmbedCSS = await getFontEmbedCSS(root); } catch { /* fonts fall back */ }
    const opts = (h: number) => ({ pixelRatio: Math.min(2, 12000 / Math.max(1, h)), backgroundColor: '#ffffff', cacheBust: false, fontEmbedCSS, imagePlaceholder: 'data:image/gif;base64,R0lGODlhAQABAAAAACw=',
      filter: (n: Node) => !(n instanceof HTMLElement && (n.matches('button.epr-ibtn, .no-print, .epr-sticky, .epr-ink, video, audio, textarea') || n.classList.contains('epr-shimmer'))) });

    /** leaves to capture: split tall vertically-stacked containers into their rows */
    const stacked = (el: Element) => { const k2 = [...el.children].filter((c) => (c as HTMLElement).offsetHeight > 0); for (let i = 1; i < k2.length; i++) if (k2[i].getBoundingClientRect().top < k2[i - 1].getBoundingClientRect().bottom - 1) return null; return k2; };
    const leaves = (el: Element, out: Element[]) => {
      const h = el.getBoundingClientRect().height * k;
      const kids = h > CH * 0.7 ? stacked(el) : null;
      if (kids && kids.length > 1) kids.forEach((c) => leaves(c, out)); else out.push(el);
    };
    const chapters = [...root.querySelectorAll('.epr-main > *')].filter((c) => (c as HTMLElement).offsetHeight > 0);
    let page = 0, y = TOP;
    for (let ci = 0; ci < chapters.length; ci++) {
      onProgress?.(`Building PDF… chapter ${ci + 1} of ${chapters.length}`);
      if (page === 0) { page = 1; } else { pdf.addPage(); page++; y = TOP; }    // each chapter opens a new page
      const items: Element[] = []; leaves(chapters[ci], items);
      let prevBottom: number | null = null;
      for (const el of items) {
        const b = el.getBoundingClientRect(); if (b.height < 1 || b.width < 1) continue;
        const gap = prevBottom == null ? 0 : Math.min(28, Math.max(0, (b.top - prevBottom) * k)); prevBottom = b.bottom;
        let canvas: HTMLCanvasElement;
        try { canvas = await toCanvas(el as HTMLElement, opts(b.height)); } catch { continue; }
        const x = M + (b.left - rootBox.left) * k, w = b.width * k, h = b.height * k;
        if (y + gap + h <= TOP + CH) { y += gap; }
        else if (h <= CH) { pdf.addPage(); page++; y = TOP; }
        else if (y > TOP + CH * 0.25) { pdf.addPage(); page++; y = TOP; }
        // slice anything taller than the space left
        const pxPerPt = canvas.height / h; let done = 0;
        while (done < h - 0.5) {
          const room = TOP + CH - y; const take = Math.min(h - done, room);
          const s = document.createElement('canvas'); s.width = canvas.width; s.height = Math.max(1, Math.round(take * pxPerPt));
          s.getContext('2d')!.drawImage(canvas, 0, Math.round(done * pxPerPt), canvas.width, s.height, 0, 0, s.width, s.height);
          pdf.addImage(s.toDataURL('image/jpeg', 0.9), 'JPEG', x, y, w, take, undefined, 'FAST');
          done += take; y += take;
          if (done < h - 0.5) { pdf.addPage(); page++; y = TOP; }
        }
      }
    }
    // running header + footer
    const n = pdf.getNumberOfPages();
    for (let i = 1; i <= n; i++) {
      pdf.setPage(i); pdf.setFont('helvetica', 'normal'); pdf.setFontSize(7.5); pdf.setTextColor(130);
      if (i > 1) pdf.text(title.replace(/[—–]/g, '-'), M, 20);
      pdf.setDrawColor(225); pdf.line(M, PH - 26, PW - M, PH - 26);
      pdf.text('Physique 57 India · Confidential', M, PH - 14);
      pdf.text(`${i} / ${n}`, PW - M, PH - 14, { align: 'right' });
    }
    pdf.setProperties({ title, creator: 'Physique 57 Performance Review' });
    onProgress?.('Saving PDF…');
    pdf.save(`${slug(title)}.pdf`);
  } finally {
    document.documentElement.classList.remove('epr-exporting');
  }
}
