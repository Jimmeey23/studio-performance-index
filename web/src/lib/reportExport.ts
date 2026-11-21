/**
 * Report exports. PDF uses the browser's print engine on the A4 pages (exact
 * fidelity); Word / PowerPoint / Excel are rebuilt natively from the report
 * data with chart snapshots; HTML is a self-contained copy of the styled pages.
 */
import type { Column, Format, Result } from './types';
import { fmt, fmtPeriod } from './format';
import { DEFAULT_LAYOUT, fmtDelta, fileBase, tone, type Kpi, type ReportData, type ReportInsights, type ReportLayout, type Priority } from './report';
import { BRAND, brandData, coverPhotoFor, dataToBytes, photoForSection } from './brand';
const coverPhotoUrl = (d: ReportData) => coverPhotoFor(d.request.kind === 'custom' ? d.sections[0]?.id ?? 'cover' : 'cover');

const isCustom = (d: ReportData) => d.request.kind === 'custom';
const reportTitle = (d: ReportData, l?: ReportLayout) => l?.title || (isCustom(d) ? d.request.title || 'Custom report' : d.scope);
const reportKicker = (d: ReportData) => (isCustom(d) ? 'Custom report' : 'Executive performance report');

const save = (blob: Blob, name: string) => { const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; a.style.display = 'none'; document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 4000); };
const fk = (v: number | null | undefined, f: Format) => fmt(v, f, { compact: f === 'currency' });

/** PNG snapshots (white background) of every report chart, keyed by chart id. */
export function captureCharts(root: HTMLElement): Map<string, { data: string; w: number; h: number }> {
  const out = new Map<string, { data: string; w: number; h: number }>();
  root.querySelectorAll<HTMLElement>('[data-chart-id]').forEach((el) => {
    const id = el.dataset.chartId!;
    const canvas = el.querySelector('canvas'); if (!canvas || out.has(id)) return;
    const c = document.createElement('canvas'); c.width = canvas.width; c.height = canvas.height;
    const ctx = c.getContext('2d')!; ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, c.width, c.height); ctx.drawImage(canvas, 0, 0);
    out.set(id, { data: c.toDataURL('image/png'), w: c.width, h: c.height });
  });
  return out;
}

/* ───────── HTML ───────── */
export async function exportHtml(root: HTMLElement, data: ReportData) {
  const clone = root.cloneNode(true) as HTMLElement;
  clone.querySelector('.rp-measure')?.remove();
  for (const im of [...clone.querySelectorAll('img')]) { const src = im.getAttribute('src') ?? ''; if (src.startsWith('/')) { const d = await brandData(src); if (d) im.setAttribute('src', d.data); } }
  for (const el of [...clone.querySelectorAll<HTMLElement>('[style*="/brand/"]')]) { const m = el.getAttribute('style')!.match(/url\(["']?(\/brand\/[^"')]+)["']?\)/); if (m) { const d = await brandData(m[1]); if (d) el.setAttribute('style', el.getAttribute('style')!.replace(m[1], d.data)); } }
  const src = [...root.querySelectorAll('canvas')], dst = [...clone.querySelectorAll('canvas')];
  dst.forEach((cv, i) => { const img = document.createElement('img'); img.src = src[i].toDataURL('image/png'); img.style.width = src[i].style.width || `${src[i].clientWidth}px`; img.style.height = src[i].style.height || `${src[i].clientHeight}px`; cv.replaceWith(img); });
  let css = '';
  for (const sh of [...document.styleSheets]) { try { css += [...sh.cssRules].map((r) => r.cssText).join('\n'); } catch { /* cross-origin font sheet */ } }
  const html = `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><title>${fileBase(data)}</title>
<link rel="preconnect" href="https://fonts.googleapis.com"><link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Plus+Jakarta+Sans:wght@500;600;700;800&display=swap" rel="stylesheet">
<style>${css}
body{background:#e9e9e4;margin:0;padding:12mm 0} #print-host{position:static;left:auto}
@media print{body{padding:0;background:#fff} .report-paper{display:block!important;gap:0!important} .a4{box-shadow:none!important;break-after:page}}</style></head>
<body>${clone.outerHTML.replace(/id="report-print-root"/, '')}</body></html>`;
  save(new Blob([html], { type: 'text/html' }), `${fileBase(data)}.html`);
}

/* ───────── shared table shaping ───────── */
function tableMatrix(r: Result, maxRows = 12): { header: string[]; rows: string[][]; total?: string[] } {
  const grain = (r.spec?.grain as string) ?? 'month';
  const dims = r.columns.filter((c) => c.kind === 'dimension' || c.kind === 'period');
  const metrics = r.columns.filter((c) => c.kind === 'metric');
  const chg = (m: Column) => r.columns.some((c) => c.key === `${m.key}__chg`);
  const header = [...dims.map((d) => d.label), ...metrics.flatMap((m) => (chg(m) ? [m.label, 'Δ'] : [m.label]))];
  const line = (row: Record<string, unknown>, isTotal = false) => [
    ...dims.map((d, i) => (isTotal ? (i === 0 ? 'Total' : '') : d.kind === 'period' ? fmtPeriod(String(row[d.key]), grain) : String(row[d.key] ?? '(blank)'))),
    ...metrics.flatMap((m) => { const v = fk(row[m.key] as number, m.format as Format); return chg(m) ? [v, fmtDelta(row[`${m.key}__chg`] as number, m.format as Format)] : [v]; }),
  ];
  const rows = r.rows.slice(0, maxRows).map((x) => line(x));
  return { header, rows, total: r.totals && r.rows.length > 1 && r.rowCount <= maxRows ? line(r.totals, true) : undefined };
}
const kpiRow = (k: Kpi) => [k.label, fk(k.value, k.format), fk(k.prev, k.format), fmtDelta(k.chg, k.format), fk(k.ytd, k.format), fmtDelta(k.chgYtd, k.format), fk(k.ly, k.format), fmtDelta(k.chgLy, k.format)];
const kpiHeader = (d: ReportData) => ['Metric', d.period.label, d.period.prevLabel, 'Δ', d.period.ytdLabel, 'Δ', d.period.lyLabel, 'Δ'];
function priorities(d: ReportData, ins: ReportInsights | null): Priority[] {
  return ins?.road_ahead?.priorities?.length ? ins.road_ahead.priorities : d.autoInsights.recommendations.map((r) => ({ ...r, owner: 'Studio leadership', timing: 'Next month', target: '—', priority: r.priority as Priority['priority'] }));
}
type Imgs = Map<string, { data: string; w: number; h: number }>;

/* ───────── Word (.docx) ───────── */
export async function exportDocx(data: ReportData, ins: ReportInsights | null, charts: Imgs, layout: ReportLayout = DEFAULT_LAYOUT) {
  const logo = await brandData(BRAND.logoOnLight), photo = layout.photos ? await brandData(coverPhotoUrl(data)) : null;
  const d = await import('docx');
  const { Document, Packer, Paragraph, TextRun, HeadingLevel, Table, TableRow, TableCell, WidthType, AlignmentType, ShadingType, ImageRun, PageOrientation, BorderStyle, Footer, PageNumber, PageBreak } = d;
  const INK = '13152A', MUTED = '8A8BA0', NAVY = '0B2550', GOLD = '1B6FA3', GOOD = '0F7B5B', BAD = 'C2413F';
  const sans = 'Calibri', serif = 'Calibri Light';
  const P = (text: string, o: { size?: number; bold?: boolean; color?: string; after?: number; italics?: boolean; font?: string; align?: (typeof AlignmentType)[keyof typeof AlignmentType] } = {}) =>
    new Paragraph({ alignment: o.align, spacing: { after: o.after ?? 100 }, children: [new TextRun({ text, size: o.size ?? 18, bold: o.bold, color: o.color ?? INK, italics: o.italics, font: o.font ?? sans })] });
  const kicker = (t: string) => new Paragraph({ spacing: { before: 60, after: 20 }, children: [new TextRun({ text: t.toUpperCase(), size: 14, bold: true, color: GOLD, font: sans, characterSpacing: 40 })] });
  const H = (text: string, k?: string, brk = true) => [
    ...(brk ? [new Paragraph({ children: [new PageBreak()] })] : []),
    ...(k ? [kicker(k)] : []),
    new Paragraph({ heading: HeadingLevel.HEADING_1, spacing: { after: 120 }, border: { bottom: { style: BorderStyle.SINGLE, size: 8, color: '14163A', space: 4 } }, children: [new TextRun({ text, size: 36, color: INK, font: serif })] }),
  ];
  const sub = (t: string) => new Paragraph({ spacing: { before: 140, after: 60 }, children: [new TextRun({ text: t.toUpperCase(), size: 13, bold: true, color: NAVY, font: sans, characterSpacing: 30 })] });
  const quote = (t: string) => new Paragraph({ shading: { type: ShadingType.CLEAR, color: 'auto', fill: 'F7F6FB' }, spacing: { before: 80, after: 160 }, border: { left: { style: BorderStyle.SINGLE, size: 24, color: 'C8A46A', space: 8 } }, children: [new TextRun({ text: t, size: 23, color: '14163A', font: serif, italics: true })] });
  const bullets = (items: string[], color = INK) => items.map((x, i) => new Paragraph({ spacing: { after: 50 }, indent: { left: 280, hanging: 280 }, children: [new TextRun({ text: `${i + 1}.  `, bold: true, size: 17, color: GOLD, font: sans }), new TextRun({ text: x, size: 17, color, font: sans })] }));
  const nb = { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' };
  const cellB = { top: nb, left: nb, right: nb, bottom: { style: BorderStyle.SINGLE, size: 2, color: 'EEEDF4' } };
  const tbl = (header: string[], rows: string[][], o: { total?: string[] } = {}) => new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows: [
      new TableRow({ tableHeader: true, children: header.map((h, i) => new TableCell({ borders: { ...cellB, bottom: { style: BorderStyle.SINGLE, size: 10, color: '14163A' } }, margins: { top: 40, bottom: 40, left: 70, right: 70 },
        children: [new Paragraph({ alignment: i === 0 ? AlignmentType.LEFT : AlignmentType.RIGHT, children: [new TextRun({ text: h.toUpperCase(), size: 12, bold: true, color: MUTED, font: sans })] })] })) }),
      ...[...rows, ...(o.total ? [o.total] : [])].map((r, ri) => new TableRow({ children: r.map((v, i) => {
        const isTot = o.total && ri === rows.length;
        const col = header[i]?.startsWith('Δ') ? (v.startsWith('+') ? GOOD : v.startsWith('-') ? BAD : MUTED) : INK;
        return new TableCell({ shading: isTot ? { type: ShadingType.CLEAR, color: 'auto', fill: 'F7F6FB' } : ri % 2 ? { type: ShadingType.CLEAR, color: 'auto', fill: 'FAFAFD' } : undefined, borders: cellB, margins: { top: 30, bottom: 30, left: 70, right: 70 },
          children: [new Paragraph({ alignment: i === 0 ? AlignmentType.LEFT : AlignmentType.RIGHT, children: [new TextRun({ text: v, size: 15, bold: !!isTot || i === 0, color: col, font: sans })] })] });
      }) })),
    ],
  });
  const img = (id: string, widthPx = 640) => {
    const c = charts.get(id); if (!c) return [];
    const bin = atob(c.data.split(',')[1]); const buf = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
    let w = widthPx, h = Math.round((widthPx * c.h) / c.w);
    if (h > 290) { w = Math.round((w * 290) / h); h = 290; }
    return [new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 120 }, children: [new ImageRun({ type: 'png', data: buf, transformation: { width: w, height: h } })] })];
  };
  const Pd = data.period;
  const body: (InstanceType<typeof Paragraph> | InstanceType<typeof Table>)[] = [
    logo ? new Paragraph({ spacing: { after: 60 }, children: [new ImageRun({ type: 'png', data: dataToBytes(logo.data), transformation: { width: 130, height: Math.round((130 * logo.h) / logo.w) } })] })
      : new Paragraph({ spacing: { after: 40 }, children: [new TextRun({ text: 'PHYSIQUE 57 · INDIA', size: 20, bold: true, color: NAVY, font: sans, characterSpacing: 80 })] }),
    kicker(`${reportKicker(data)} · confidential`),
    ...(photo ? [new Paragraph({ spacing: { before: 160, after: 80 }, children: [new ImageRun({ type: 'jpg', data: dataToBytes(photo.data), transformation: { width: 620, height: Math.round((620 * photo.h) / photo.w) } })] })] : []),
    new Paragraph({ spacing: { before: photo ? 200 : 400, after: 80 }, children: [new TextRun({ text: reportTitle(data, layout), size: 60, color: INK, font: serif })] }),
    ...(isCustom(data) || layout.title ? [P(data.scope, { size: 22, color: NAVY, bold: true, after: 40 })] : []),
    ...(isCustom(data) ? [P(`Topics: ${data.sections.map((x) => x.title).join(' · ')}`, { size: 16, color: MUTED, after: 60 })] : []),
    ...(layout.preparedFor ? [P(`Prepared for ${layout.preparedFor}`, { size: 16, color: MUTED, after: 60 })] : []),
    new Paragraph({ spacing: { after: 60 }, children: [new TextRun({ text: Pd.label, size: 36, bold: true, color: NAVY, font: sans })] }),
    P(`${fmtPeriod(Pd.start, 'day')} – ${fmtPeriod(Pd.end, 'day')} · benchmarked against ${Pd.prevLabel}, the ${Pd.ytdLabel} and ${Pd.lyLabel}. Prepared ${new Date(data.generatedAt).toLocaleDateString('en-IN')}.`, { color: MUTED, size: 17, after: 240 }),
    ...(ins ? [quote(ins.headline)] : []),
    tbl(kpiHeader(data), data.headline.map(kpiRow)),
    ...H('Executive summary', 'Overview'),
    ...(ins ? ins.executive_summary.split(/\n\s*\n/).map((x) => P(x, { size: 19, after: 140 })) : []),
    ...(ins?.at_a_glance?.length ? [sub('In ten seconds'), ...bullets(ins.at_a_glance)] : []),
    sub('What went well'), ...bullets(ins?.wins ?? data.autoInsights.highlights),
    sub('Watch-outs'), ...bullets(ins?.watch_outs ?? data.autoInsights.concerns),
    ...(ins?.themes ?? []).flatMap((t, i) => [sub(`Theme ${i + 1} · ${t.title}`), P(t.detail, { size: 17 })]),
    ...H('Performance scorecard', 'Scorecard'),
    tbl(kpiHeader(data), data.scorecard.map(kpiRow)),
    ...(data.studios ? [sub('Studio comparison'), (() => { const m = tableMatrix(data.studios!.result); return tbl(m.header, m.rows, { total: m.total }); })()] : []),
  ];
  for (const s of data.sections) {
    const c = ins?.sections?.[s.id];
    body.push(...H(s.title, s.kicker));
    if (s.id === 'road') {
      const ra = ins?.road_ahead;
      body.push(P(s.summary, { color: MUTED, size: 16 }));
      body.push(tbl(['Forecast / pipeline', 'Value', 'Detail'], [
        ...(s.visuals?.forecasts ?? []).map((f) => [`${f.label} · ${f.month}`, fk(f.value, f.format), `80% range ${fk(f.lo, f.format)} – ${fk(f.hi, f.format)}`]),
        ...(s.visuals?.pipeline ?? []).map((p) => [p.label, fk(p.value, p.format), p.note]),
      ]));
      if (ra?.summary) body.push(sub('Outlook'), P(ra.summary, { size: 18 }));
      body.push(sub('Priorities for next month'));
      priorities(data, ins).forEach((p, i) => body.push(
        new Paragraph({ spacing: { before: 60, after: 30 }, children: [new TextRun({ text: `${i + 1}. ${p.title}`, size: 20, color: INK, font: serif }), new TextRun({ text: `   ${p.priority.toUpperCase()}`, size: 13, bold: true, color: p.priority === 'high' ? BAD : GOLD, font: sans })] }),
        P(p.detail, { size: 17, after: 30 }), P(`Owner: ${p.owner} · When: ${p.timing} · KPI: ${p.kpi}${p.target && p.target !== '—' ? ` · Target: ${p.target}` : ''}`, { size: 14, color: MUTED, after: 100 })));
      if (ra?.risks?.length) body.push(sub('Risks'), ...bullets(ra.risks));
      if (ra?.opportunities?.length) body.push(sub('Opportunities'), ...bullets(ra.opportunities));
      if (ra?.targets?.length) body.push(sub('Suggested targets'), tbl(['Metric', 'Target', 'Rationale'], ra.targets.map((t) => [t.metric, t.target, t.rationale])));
      continue;
    }
    if (s.notes?.length) body.push(...s.notes.map((x) => P(x, { size: 14, color: MUTED, after: 30 })));
    if (s.answer) { body.push(sub(`Q · ${s.answer.question}`), quote(c?.headline || s.answer.headline)); if (s.answer.points.length) body.push(...bullets(s.answer.points)); }
    else if (c?.headline) body.push(quote(c.headline));
    if (s.stats?.length) body.push(tbl(s.stats.map((x) => x.label), [s.stats.map((x) => `${fk(x.value, x.format)}${x.note ? ` (${x.note})` : ''}`)]));
    body.push(P(c?.narrative || s.summary, { size: 18, after: 140 }));
    if (s.kpis.length) body.push(tbl(kpiHeader(data), s.kpis.map(kpiRow)));
    if (s.visuals?.funnel) body.push(sub('Funnel'), P(s.visuals.funnel.map((f) => `${f.label}: ${fk(f.value, 'number')}`).join('  →  '), { size: 17 }));
    if (s.visuals?.formats) body.push(sub('Format head-to-head'), tbl(['Metric', ...s.visuals.formats.map((f) => f.format)], s.visuals.formats[0].kpis.map((k, i) => [k.label, ...s.visuals!.formats!.map((f) => fk(f.kpis[i]?.value ?? null, k.format))])));
    if (s.visuals?.spotlight?.length) body.push(sub('Trainer spotlight'), tbl(['Trainer', 'Class avg', 'Fill', 'Classes', 'Check-ins'], s.visuals.spotlight.map((t) => [t.name, fmt(t.avg, 'decimal'), fmt(t.fill, 'percent'), String(t.classes), fmt(t.checkins, 'number')])));
    if (s.visuals?.strict) body.push(P(`Strict renewal rate (membership / package repurchased within 30 days): ${fmt(s.visuals.strict.renewal_rate, 'percent')}.`, { size: 15, color: MUTED }));
    for (const ch of s.charts) body.push(sub(ch.title), ...img(ch.id, s.charts.length > 1 ? 560 : 640));
    body.push(sub('Key findings'), ...bullets(c?.findings?.length ? c.findings : s.insights));
    if (c?.actions?.length) body.push(sub('Actions'), ...bullets(c.actions));
    for (const t of s.tables) { const m = tableMatrix(t.result, ['trainer_scorecard', 'lead_channels'].includes((t.result as { kind?: string }).kind ?? '') ? 80 : t.result.columns.filter((c) => c.kind === 'dimension').length > 1 ? 120 : 12); body.push(sub(t.title), tbl(m.header, m.rows, { total: m.total })); }
    if (s.definitions?.length) body.push(sub('Definitions'), ...s.definitions.map((d) => new Paragraph({ spacing: { after: 60 }, children: [new TextRun({ text: `${d.term} — `, bold: true, size: 16, font: sans }), new TextRun({ text: d.text, size: 16, color: '3A3C54', font: sans })] })));
  }
  const mom = data.appendix.mom.result;
  const months = [...new Set(mom.rows.map((r) => String(r.period)))].sort((a, b) => b.localeCompare(a));
  const byP = new Map(mom.rows.map((r) => [String(r.period), r]));
  const momRows = mom.columns.filter((c) => c.kind === 'metric').flatMap((m) => [
    [m.label, ...months.map((p) => fk(byP.get(p)?.[m.key] as number, m.format as Format))],
    ['  Last year', ...months.map((p) => fk(byP.get(p)?.[`${m.key}__prev`] as number, m.format as Format))],
    ['  YoY Δ', ...months.map((p) => fmtDelta(byP.get(p)?.[`${m.key}__chg`] as number, m.format as Format))],
  ]);
  const footer = new Footer({ children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: `PHYSIQUE 57 · INDIA   ·   ${data.scope}   ·   ${Pd.label}   ·   `, size: 13, color: MUTED, font: sans }), new TextRun({ children: [PageNumber.CURRENT], size: 13, color: MUTED, font: sans })] })] });
  const page = { size: { width: 11906, height: 16838 }, margin: { top: 800, bottom: 800, left: 850, right: 850 } };
  const doc = new Document({
    creator: 'Physique 57 BI', title: fileBase(data), styles: { default: { document: { run: { font: sans, size: 18 } } } },
    sections: [
      { properties: { page }, footers: { default: footer }, children: body },
      ...(layout.pages.mom ? [{ properties: { page: { size: { width: 11906, height: 16838, orientation: PageOrientation.LANDSCAPE }, margin: { top: 700, bottom: 700, left: 700, right: 700 } } }, footers: { default: footer },
        children: [...H('Month-on-month — last 14 months', 'Appendix A', false), tbl(['Metric', ...months.map((p) => fmtPeriod(p, 'month'))], momRows)] }] : []),
      ...(layout.pages.defs ? [{ properties: { page }, footers: { default: footer },
        children: [...H('Definitions & method', 'Appendix B', false), ...data.appendix.definitions.map((x) => new Paragraph({ spacing: { after: 50 }, children: [new TextRun({ text: `${x.label} — `, bold: true, size: 15, font: sans }), new TextRun({ text: x.description, size: 15, color: '3A3C54', font: sans })] }))] }] : []),
    ],
  });
  save(await Packer.toBlob(doc), `${fileBase(data)}.docx`);
}

/* ───────── PowerPoint (.pptx) ───────── */
export async function exportPptx(data: ReportData, ins: ReportInsights | null, charts: Imgs, layout: ReportLayout = DEFAULT_LAYOUT) {
  const logoL = await brandData(BRAND.logoOnLight), logoD = await brandData(BRAND.logoOnDark);
  const cover = layout.photos ? await brandData(coverPhotoUrl(data)) : null;
  const secPhoto = new Map<string, Awaited<ReturnType<typeof brandData>>>();
  if (layout.photos) for (const sec of data.sections) secPhoto.set(sec.id, await brandData(photoForSection(sec.id)));
  const PptxGenJS = (await import('pptxgenjs')).default;
  const pptx = new PptxGenJS();
  pptx.layout = 'LAYOUT_WIDE';
  pptx.title = fileBase(data);
  const F = 'Calibri', SER = 'Calibri Light', INK = '13152A', MUTED = '8A8BA0', NAVY = '071731', IND = '0B2550', GOLD = '1B6FA3';
  const Pd = data.period;
  pptx.defineSlideMaster({ title: 'P57', background: { color: 'FFFFFF' }, objects: [
    { rect: { x: 0, y: 0, w: 13.33, h: 0.07, fill: { color: IND } } },
    ...(logoL ? [{ image: { data: logoL.data, x: 0.5, y: 6.98, w: 0.55, h: (0.55 * logoL.h) / logoL.w } }] : [{ text: { text: 'PHYSIQUE 57 · INDIA', options: { x: 0.5, y: 7.05, w: 4, h: 0.3, fontSize: 8, bold: true, color: IND, fontFace: F, charSpacing: 4 } } }]),
    { text: { text: `${data.scope.length > 50 ? `${data.request.locations.length} studios` : data.scope} · ${Pd.label}`, options: { x: 4.5, y: 7.05, w: 6, h: 0.3, fontSize: 8, color: MUTED, fontFace: F, align: 'center' } } },
  ], slideNumber: { x: 12.4, y: 7.05, w: 0.6, h: 0.3, fontSize: 9, color: MUTED, fontFace: F } });
  type S = ReturnType<typeof pptx.addSlide>;
  const head = (s: S, kicker: string, title: string, subt?: string) => {
    s.addText(kicker.toUpperCase(), { x: 0.5, y: 0.28, w: 12, h: 0.3, fontSize: 9, bold: true, color: GOLD, fontFace: F, charSpacing: 4 });
    s.addText(title, { x: 0.5, y: 0.52, w: 12.3, h: 0.6, fontSize: 26, color: INK, fontFace: SER });
    if (subt) s.addText(subt, { x: 0.5, y: 1.1, w: 12.3, h: 0.4, fontSize: 11.5, color: '2A2C44', fontFace: SER, italic: true });
  };
  const band = (s: S, kicker: string, title: string, subt?: string, sid?: string) => {
    s.background = { color: 'FFFFFF' };
    s.addShape(pptx.ShapeType.rect, { x: 0, y: 0, w: 13.33, h: 1.55, fill: { color: NAVY } });
    const ph = sid ? secPhoto.get(sid) ?? null : null;
    if (ph) { s.addImage({ data: ph.data, x: 9.33, y: 0, w: 4, h: 1.55, sizing: { type: 'cover', w: 4, h: 1.55 } }); s.addShape(pptx.ShapeType.rect, { x: 9.33, y: 0, w: 4, h: 1.55, fill: { color: NAVY, transparency: 45 }, line: { type: 'none' } }); }
    else s.addShape(pptx.ShapeType.ellipse, { x: 10.6, y: -1.6, w: 4, h: 4, fill: { color: '123A72', transparency: 40 }, line: { type: 'none' } });
    s.addText(kicker.toUpperCase(), { x: 0.5, y: 0.22, w: 10, h: 0.3, fontSize: 9, bold: true, color: '8FD8F7', fontFace: F, charSpacing: 4 });
    s.addText(title, { x: 0.5, y: 0.45, w: 11, h: 0.6, fontSize: 26, color: 'FFFFFF', fontFace: SER });
    if (subt) s.addText(subt, { x: 0.5, y: 1.02, w: layout.photos ? 8.6 : 12.2, h: 0.45, fontSize: 11, color: 'FFFFFF', fontFace: SER, italic: true });
  };
  const kpiBoxes = (s: S, ks: Kpi[], y: number, perRow = 4, x0 = 0.5, w = 12.3) => {
    const bw = (w - (perRow - 1) * 0.12) / perRow;
    ks.forEach((k, i) => {
      const x = x0 + (i % perRow) * (bw + 0.12), yy = y + Math.floor(i / perRow) * 1.02;
      const t = tone(k, k.chg);
      s.addShape(pptx.ShapeType.rect, { x, y: yy, w: bw, h: 0.92, fill: { color: 'FFFFFF' }, line: { color: 'E7E5EF', width: 0.75 } });
      s.addShape(pptx.ShapeType.rect, { x, y: yy, w: bw, h: 0.05, fill: { color: t > 0 ? '0F7B5B' : t < 0 ? 'C2413F' : 'C9C8D6' }, line: { type: 'none' } });
      s.addText(k.label, { x: x + 0.1, y: yy + 0.08, w: bw - 0.2, h: 0.22, fontSize: 8.5, color: MUTED, fontFace: F });
      s.addText(fk(k.value, k.format), { x: x + 0.1, y: yy + 0.28, w: bw - 0.2, h: 0.34, fontSize: 17, bold: true, color: INK, fontFace: F });
      const cc = (c: number | null) => (tone(k, c) > 0 ? '0F7B5B' : tone(k, c) < 0 ? 'C2413F' : MUTED);
      s.addText([
        { text: `${fmtDelta(k.chg, k.format)} `, options: { color: cc(k.chg), bold: true } }, { text: 'prev  ', options: { color: MUTED } },
        { text: `${fmtDelta(k.chgYtd, k.format)} `, options: { color: cc(k.chgYtd), bold: true } }, { text: 'avg  ', options: { color: MUTED } },
        { text: `${fmtDelta(k.chgLy, k.format)} `, options: { color: cc(k.chgLy), bold: true } }, { text: 'LY', options: { color: MUTED } },
      ], { x: x + 0.1, y: yy + 0.62, w: bw - 0.15, h: 0.24, fontSize: 7.5, fontFace: F });
    });
  };
  const bulletsBox = (s: S, items: string[], o: { x: number; y: number; w: number; h: number; title?: string; color?: string; size?: number }) => {
    if (o.title) s.addText(o.title.toUpperCase(), { x: o.x, y: o.y, w: o.w, h: 0.28, fontSize: 9, bold: true, color: o.color ?? IND, fontFace: F, charSpacing: 3 });
    s.addText(items.map((t) => ({ text: t, options: { bullet: { code: '25CF' }, breakLine: true } })), { x: o.x, y: o.y + (o.title ? 0.3 : 0), w: o.w, h: o.h, fontSize: o.size ?? 10.5, color: '2A2C44', fontFace: F, valign: 'top', paraSpaceAfter: 5 });
  };
  const tableAt = (s: S, header: string[], body: string[][], x: number, y: number, w: number, fs = 8.5) => {
    s.addTable([header.map((t) => ({ text: t.toUpperCase(), options: { bold: true, color: MUTED, fontSize: fs - 1.5, border: [{ type: 'none' }, { type: 'none' }, { type: 'solid', pt: 1.5, color: NAVY }, { type: 'none' }] } })),
      ...body.map((row, ri) => row.map((v, i) => ({ text: v, options: { fontSize: fs, bold: i === 0, align: (i === 0 ? 'left' : 'right') as 'left' | 'right', color: header[i]?.startsWith('Δ') ? (v.startsWith('+') ? '0F7B5B' : v.startsWith('-') ? 'C2413F' : MUTED) : INK, fill: { color: ri % 2 ? 'FAFAFD' : 'FFFFFF' } } })))] as never,
      { x, y, w, fontFace: F, border: { type: 'solid', pt: 0.4, color: 'EEEDF4' }, autoPage: false });
  };
  // cover
  const c = pptx.addSlide();
  c.background = { color: '040C20' };
  if (!cover) c.addShape(pptx.ShapeType.ellipse, { x: 8.6, y: -2.6, w: 7, h: 7, fill: { color: '123A72', transparency: 40 }, line: { type: 'none' } });
  if (!cover) c.addShape(pptx.ShapeType.ellipse, { x: -2, y: 4.5, w: 6, h: 6, fill: { color: '0B2550', transparency: 50 }, line: { type: 'none' } });
  const cw = 11.6;
  if (cover) {
    // full-bleed photograph under a deep-blue shade, darker where the text sits
    c.addImage({ data: cover.data, x: 0, y: 0, w: 13.33, h: 7.5, sizing: { type: 'cover', w: 13.33, h: 7.5 } });
    c.addShape(pptx.ShapeType.rect, { x: 0, y: 0, w: 13.33, h: 7.5, fill: { color: '040C20', transparency: 45 }, line: { type: 'none' } });
    c.addShape(pptx.ShapeType.rect, { x: 0, y: 1.7, w: 13.33, h: 5.8, fill: { color: '040C20', transparency: 25 }, line: { type: 'none' } });
  }
  if (logoD) c.addImage({ data: logoD.data, x: 0.7, y: 0.45, w: 1.1, h: (1.1 * logoD.h) / logoD.w });
  else c.addText('PHYSIQUE 57 · INDIA', { x: 0.7, y: 0.55, w: 8, h: 0.4, fontSize: 14, bold: true, color: 'FFFFFF', fontFace: F, charSpacing: 8 });
  c.addText(reportKicker(data).toUpperCase(), { x: 0.7, y: 1.35, w: 7, h: 0.3, fontSize: 9, color: '8FD8F7', fontFace: F, charSpacing: 5 });
  c.addText(reportTitle(data, layout), { x: 0.7, y: 2.0, w: cw, h: 1.3, fontSize: 36, color: 'FFFFFF', fontFace: SER, valign: 'top', fit: 'shrink' });
  c.addText(Pd.label, { x: 0.7, y: 3.35, w: 8, h: 0.6, fontSize: 24, bold: true, color: '8FD8F7', fontFace: F });
  c.addText(`${isCustom(data) || layout.title ? `${data.scope} · ` : ''}benchmarked against ${Pd.prevLabel}, the ${Pd.ytdLabel} and ${Pd.lyLabel}`, { x: 0.7, y: 3.95, w: cw, h: 0.5, fontSize: 12, color: 'C7C9F7', fontFace: F, valign: 'top' });
  if (ins) c.addText(ins.headline, { x: 0.7, y: 4.6, w: cw, h: 1.2, fontSize: 14, color: 'FFFFFF', fontFace: SER, italic: true, valign: 'top', fit: 'shrink' });
  data.headline.slice(0, 4).forEach((k, i) => {
    const x = 0.7 + i * 3.0;
    c.addShape(pptx.ShapeType.rect, { x, y: 6.0, w: 2.85, h: 0.95, fill: { color: 'FFFFFF' }, line: { type: 'none' } });
    c.addText(k.label.toUpperCase(), { x: x + 0.12, y: 6.06, w: 2.6, h: 0.22, fontSize: 7, color: MUTED, fontFace: F, bold: true });
    c.addText(fk(k.value, k.format), { x: x + 0.12, y: 6.26, w: 2.6, h: 0.38, fontSize: 18, bold: true, color: INK, fontFace: F });
    c.addText(`${fmtDelta(k.chg, k.format)} vs ${Pd.prevLabel}`, { x: x + 0.12, y: 6.62, w: 2.6, h: 0.24, fontSize: 8, bold: true, color: tone(k, k.chg) > 0 ? '0F7B5B' : tone(k, k.chg) < 0 ? 'C2413F' : MUTED, fontFace: F });
  });
  // exec summary
  const s1 = pptx.addSlide({ masterName: 'P57' }); head(s1, 'Executive summary', `${Pd.label} at a glance`, ins?.headline);
  if (ins) s1.addText(ins.executive_summary.replace(/\n\s*\n/g, '\n\n'), { x: 0.5, y: 1.6, w: 7.6, h: 5.2, fontSize: 11.5, color: '262840', fontFace: F, valign: 'top', lineSpacingMultiple: 1.12 });
  bulletsBox(s1, ins?.at_a_glance ?? [], { x: 8.4, y: 1.6, w: 4.4, h: 5.1, title: 'In ten seconds', size: 11 });
  const s1b = pptx.addSlide({ masterName: 'P57' }); head(s1b, 'Executive summary', 'Headline performance', `Δ vs ${Pd.prevLabel} · the ${Pd.ytdLabel} · ${Pd.lyLabel}`);
  kpiBoxes(s1b, data.headline, 1.65);
  bulletsBox(s1b, ins?.wins ?? data.autoInsights.highlights, { x: 0.5, y: 3.85, w: 6, h: 3, title: 'What went well', color: '0F7B5B', size: 10 });
  bulletsBox(s1b, ins?.watch_outs ?? data.autoInsights.concerns, { x: 6.85, y: 3.85, w: 6, h: 3, title: 'Watch-outs', color: 'C2413F', size: 10 });
  if (ins?.themes?.length) {
    const st = pptx.addSlide({ masterName: 'P57' }); head(st, 'Strategic themes', 'What connects the numbers');
    ins.themes.forEach((t, i) => {
      const x = 0.5 + i * 4.15;
      st.addShape(pptx.ShapeType.rect, { x, y: 1.7, w: 3.95, h: 4.9, fill: { color: NAVY }, line: { type: 'none' } });
      st.addText(`THEME ${i + 1}`, { x: x + 0.25, y: 1.9, w: 3.5, h: 0.3, fontSize: 9, bold: true, color: '8FD8F7', fontFace: F, charSpacing: 4 });
      st.addText(t.title, { x: x + 0.25, y: 2.2, w: 3.5, h: 0.9, fontSize: 18, color: 'FFFFFF', fontFace: SER, valign: 'top' });
      st.addText(t.detail, { x: x + 0.25, y: 3.2, w: 3.5, h: 3.2, fontSize: 11.5, color: 'E6E6F5', fontFace: F, valign: 'top' });
    });
  }
  // scorecard
  const s3 = pptx.addSlide({ masterName: 'P57' }); head(s3, 'Scorecard', 'Performance against three baselines');
  tableAt(s3, kpiHeader(data), data.scorecard.map(kpiRow), 0.5, 1.3, 12.3, 7.5);
  if (data.studios) { const s = pptx.addSlide({ masterName: 'P57' }); head(s, 'Network', 'Studio comparison', Pd.label); const m = tableMatrix(data.studios.result); tableAt(s, m.header, [...m.rows, ...(m.total ? [m.total] : [])], 0.5, 1.6, 12.3, 9); }
  for (const sec of data.sections) {
    const cm = ins?.sections?.[sec.id];
    if (sec.id === 'road') {
      const ra = ins?.road_ahead;
      const s = pptx.addSlide({ masterName: 'P57' }); band(s, sec.kicker, sec.title, ra?.summary ?? sec.summary, sec.id);
      const items = [...(sec.visuals?.forecasts ?? []).map((f) => ({ l: `${f.label} forecast · ${f.month}`, v: fk(f.value, f.format), n: `80% range ${fk(f.lo, f.format)} – ${fk(f.hi, f.format)}` })), ...(sec.visuals?.pipeline ?? []).map((p) => ({ l: p.label, v: fk(p.value, p.format), n: p.note }))].slice(0, 7);
      items.forEach((it, i) => { const x = 0.5 + (i % 4) * 3.1, y = 1.85 + Math.floor(i / 4) * 1.05; s.addShape(pptx.ShapeType.rect, { x, y, w: 2.95, h: 0.92, fill: { color: i < 3 ? '1F2366' : 'F7F6FB' }, line: { type: 'none' } });
        s.addText(it.l.toUpperCase(), { x: x + 0.12, y: y + 0.06, w: 2.7, h: 0.22, fontSize: 7, bold: true, color: i < 3 ? 'C7C9F7' : MUTED, fontFace: F });
        s.addText(it.v, { x: x + 0.12, y: y + 0.26, w: 2.7, h: 0.36, fontSize: 17, bold: true, color: i < 3 ? 'FFFFFF' : INK, fontFace: F });
        s.addText(it.n, { x: x + 0.12, y: y + 0.62, w: 2.7, h: 0.24, fontSize: 7.5, color: i < 3 ? 'C7C9F7' : MUTED, fontFace: F }); });
      bulletsBox(s, ra?.risks ?? [], { x: 0.5, y: 4.15, w: 6, h: 2.6, title: 'Risks', color: 'C2413F', size: 10 });
      bulletsBox(s, ra?.opportunities ?? [], { x: 6.85, y: 4.15, w: 6, h: 2.6, title: 'Opportunities', color: '0F7B5B', size: 10 });
      const s2 = pptx.addSlide({ masterName: 'P57' }); head(s2, 'Road ahead', 'Priorities for next month');
      tableAt(s2, ['#', 'Priority', 'Owner', 'When', 'KPI', 'Target'], priorities(data, ins).map((p, i) => [String(i + 1), `${p.title} — ${p.detail}`, p.owner, p.timing, p.kpi, p.target ?? '']), 0.5, 1.35, 12.3, 9);
      continue;
    }
    const s = pptx.addSlide({ masterName: 'P57' }); band(s, sec.kicker, sec.title, cm?.headline ?? sec.summary, sec.id);
    const ks = sec.kpis.slice(0, 8);
    kpiBoxes(s, ks, 1.75);
    const yA = 1.75 + Math.ceil(ks.length / 4) * 1.02 + 0.08;
    const ch = sec.charts[0] && charts.get(sec.charts[0].id);
    if (ch) { const hh = Math.min(6.9 - yA, (6.6 * ch.h) / ch.w); s.addImage({ data: ch.data, x: 0.5, y: yA, w: (hh * ch.w) / ch.h, h: hh }); }
    bulletsBox(s, cm?.findings?.length ? cm.findings : sec.insights, { x: ch ? 7.4 : 0.5, y: yA, w: ch ? 5.4 : 12.3, h: 6.85 - yA - 0.3, title: 'Key findings', size: 9.5 });
    const s2 = pptx.addSlide({ masterName: 'P57' }); head(s2, `${sec.kicker} · analysis`, `${sec.title} — what it means`);
    s2.addText(cm?.narrative ?? sec.summary, { x: 0.5, y: 1.35, w: 7.3, h: 2.6, fontSize: 12, color: '262840', fontFace: F, valign: 'top', lineSpacingMultiple: 1.12 });
    bulletsBox(s2, cm?.actions ?? [], { x: 8.1, y: 1.35, w: 4.7, h: 2.6, title: 'Actions', color: 'A8843F', size: 10.5 });
    const tb = sec.tables.slice(0, 2);
    tb.forEach((t, i) => { const m = tableMatrix(t.result, 8); s2.addText(t.title, { x: i ? 6.85 : 0.5, y: 4.05, w: 6, h: 0.3, fontSize: 11, color: INK, fontFace: SER }); tableAt(s2, m.header, m.rows, i ? 6.85 : 0.5, 4.4, tb.length > 1 ? 5.98 : 12.3, 7.5); });
  }
  await pptx.writeFile({ fileName: `${fileBase(data)}.pptx` });
}

/* ───────── Excel (.xlsx) ───────── */
export async function exportXlsx(data: ReportData, ins: ReportInsights | null) {
  const XLSX = await import('xlsx');
  const wb = XLSX.utils.book_new();
  const Pd = data.period;
  const num = (v: number | null) => (v === null || v === undefined ? null : v);
  const kRows = (ks: Kpi[]) => ks.map((k) => ({ Metric: k.label, [Pd.label]: num(k.value), [Pd.prevLabel]: num(k.prev), [`Δ vs ${Pd.prevLabel}`]: num(k.chg), [Pd.ytdLabel]: num(k.ytd), [`Δ vs ${Pd.ytdLabel}`]: num(k.chgYtd), [Pd.lyLabel]: num(k.ly), [`Δ vs ${Pd.lyLabel}`]: num(k.chgLy), Format: k.format }));
  const add = (name: string, rows: Record<string, unknown>[] | unknown[][], aoa = false) => {
    if (!rows.length) return;
    const ws = aoa ? XLSX.utils.aoa_to_sheet(rows as unknown[][]) : XLSX.utils.json_to_sheet(rows as Record<string, unknown>[]);
    const first = (aoa ? (rows as unknown[][])[0] : Object.keys((rows as Record<string, unknown>[])[0] ?? {})) as unknown[];
    ws['!cols'] = first.map((_, i) => ({ wch: i === 0 ? 38 : 16 }));
    XLSX.utils.book_append_sheet(wb, ws, name.replace(/[\\/?*[\]:]/g, '').slice(0, 31));
  };
  add('Summary', [
    [`Physique 57 India — ${reportKicker(data)}: ${reportTitle(data)}`], [`Scope: ${data.scope}`], ...(isCustom(data) ? [[`Topics: ${data.sections.map((x) => x.title).join(', ')}`]] : []), [`Period: ${Pd.label} (${Pd.start} to ${Pd.end})`], [`Baselines: ${Pd.prevLabel} · ${Pd.ytdLabel} · ${Pd.lyLabel}`], [],
    ...(ins ? [['Headline'], [ins.headline], [], ['Executive summary'], ...ins.executive_summary.split(/\n\s*\n/).map((x) => [x]), [], ['In ten seconds'], ...ins.at_a_glance.map((x) => [x]), []] : []),
    ['What went well'], ...(ins?.wins ?? data.autoInsights.highlights).map((x) => [x]), [], ['Watch-outs'], ...(ins?.watch_outs ?? data.autoInsights.concerns).map((x) => [x]),
    ...(ins?.themes?.length ? [[], ['Strategic themes'], ...ins.themes.map((t) => [`${t.title}: ${t.detail}`])] : []),
  ], true);
  add('Scorecard', kRows(data.scorecard));
  add('Priorities', priorities(data, ins).map((p, i) => ({ '#': i + 1, Priority: p.title, Detail: p.detail, Owner: p.owner, When: p.timing, KPI: p.kpi, Target: p.target, Level: p.priority })));
  const rawTable = (r: Result) => r.rows.map((row) => Object.fromEntries(r.columns.map((c) => [c.label, row[c.key] ?? null])));
  if (data.studios) add('Studios', rawTable(data.studios.result));
  for (const s of data.sections) {
    const short = s.title.replace(/&/g, 'and').split(' ').slice(0, 2).join(' ');
    if (s.kpis.length) add(`${short} KPIs`, kRows(s.kpis));
    const cm = ins?.sections?.[s.id];
    if (cm?.narrative) add(`${short} commentary`, [[cm.headline], [], [cm.narrative], [], ['Findings'], ...cm.findings.map((x) => [x]), [], ['Actions'], ...cm.actions.map((x) => [x])], true);
    if (s.visuals?.formats) add('Formats', s.visuals.formats.flatMap((f) => f.kpis.map((k) => ({ Format: f.format, Metric: k.label, Value: num(k.value), [`Δ vs ${Pd.prevLabel}`]: num(k.chg), [`Δ vs ${Pd.lyLabel}`]: num(k.chgLy) }))));
    if (s.visuals?.forecasts) add('Forecasts', s.visuals.forecasts.map((f) => ({ Metric: f.label, Month: f.month, Forecast: num(f.value), 'Low (80%)': num(f.lo), 'High (80%)': num(f.hi), Method: f.method ?? '' })));
    s.tables.forEach((t, i) => add(`${short} ${i + 1} ${t.title}`, rawTable(t.result)));
  }
  add('Month-on-month', rawTable(data.appendix.mom.result));
  add('Definitions', data.appendix.definitions.map((d) => ({ Metric: d.label, Id: d.metric, Definition: d.description })));
  XLSX.writeFile(wb, `${fileBase(data)}.xlsx`);
}

/* ───────── Markdown ───────── */
export function exportMarkdown(data: ReportData, ins: ReportInsights | null) {
  const Pd = data.period;
  const L: string[] = [];
  const mdTable = (header: string[], rows: string[][]) => [`| ${header.join(' | ')} |`, `| ${header.map((_, i) => (i ? '---:' : ':---')).join(' | ')} |`, ...rows.map((r) => `| ${r.map((x) => x.replace(/\|/g, '/')).join(' | ')} |`)].join('\n');
  L.push(`# ${reportTitle(data)}`, '', `**Physique 57 India** · ${reportKicker(data)} · ${data.scope} · ${Pd.label} (${Pd.start} → ${Pd.end})`, '', `Baselines: ${Pd.prevLabel} · ${Pd.ytdLabel} · ${Pd.lyLabel}`, '');
  if (ins) L.push(`> ${ins.headline}`, '', '## Executive summary', '', ins.executive_summary, '');
  L.push('## Headline KPIs', '', mdTable(kpiHeader(data), data.headline.map(kpiRow)), '');
  L.push('## What went well', '', ...(ins?.wins ?? data.autoInsights.highlights).map((x) => `- ${x}`), '', '## Watch-outs', '', ...(ins?.watch_outs ?? data.autoInsights.concerns).map((x) => `- ${x}`), '');
  for (const s of data.sections) {
    const c = ins?.sections?.[s.id];
    L.push(`## ${s.title}`, '');
    if (s.id === 'road') {
      (s.visuals?.forecasts ?? []).forEach((f) => L.push(`- **${f.label} forecast (${f.month})**: ${fk(f.value, f.format)} (80% range ${fk(f.lo, f.format)} – ${fk(f.hi, f.format)})`));
      if (ins?.road_ahead?.summary) L.push('', ins.road_ahead.summary);
      L.push('', '### Priorities', '', ...priorities(data, ins).map((p, i) => `${i + 1}. **${p.title}** (${p.priority}) — ${p.detail} _Owner: ${p.owner} · When: ${p.timing} · KPI: ${p.kpi}_`), '');
      continue;
    }
    if (s.answer) L.push(`**Q: ${s.answer.question}**`, '', `> ${c?.headline || s.answer.headline}`, '', ...s.answer.points.map((x) => `- ${x}`), '');
    else if (c?.headline) L.push(`> ${c.headline}`, '');
    if (s.stats?.length) L.push(mdTable(s.stats.map((x) => x.label), [s.stats.map((x) => `${fk(x.value, x.format)}${x.note ? ` (${x.note})` : ''}`)]), '');
    L.push(c?.narrative || s.summary, '');
    if (s.kpis.length) L.push(mdTable(kpiHeader(data), s.kpis.map(kpiRow)), '');
    const f = c?.findings?.length ? c.findings : s.insights;
    if (f.length) L.push('**Key findings**', '', ...f.map((x) => `- ${x}`), '');
    if (c?.actions?.length) L.push('**Actions**', '', ...c.actions.map((x) => `- ${x}`), '');
    for (const t of s.tables) { const m = tableMatrix(t.result, 120); L.push(`### ${t.title}`, '', mdTable(m.header, m.total ? [...m.rows, m.total] : m.rows), ''); }
    if (s.definitions?.length) L.push('### Definitions', '', ...s.definitions.map((d) => `- **${d.term}** — ${d.text}`), '');
  }
  save(new Blob([L.join('\n')], { type: 'text/markdown' }), `${fileBase(data)}.md`);
}
