/**
 * Text-based PDF of a review: headless Chromium renders the review page with its print stylesheet
 * and prints it (selectable, searchable text; vector layout; charts embedded as rendered).
 * Chromium comes from the image (CHROMIUM_PATH, default /usr/bin/chromium).
 */
import fs from 'node:fs';
import puppeteer, { type Browser } from 'puppeteer-core';
import path from 'node:path';
import { log } from '../util/log.js';
import { config } from '../config.js';

const CANDIDATES = [process.env.CHROMIUM_PATH, '/usr/bin/chromium', '/usr/bin/chromium-browser', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'].filter(Boolean) as string[];
let browserP: Promise<Browser> | null = null;
const browser = () => (browserP ??= (async () => {
  const exe = CANDIDATES.find((p) => fs.existsSync(p));
  if (!exe) throw new Error('PDF export needs Chromium on the server (set CHROMIUM_PATH).');
  const b = await puppeteer.launch({ executablePath: exe, headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage', '--font-render-hinting=none'] });
  b.on('disconnected', () => { browserP = null; });
  return b;
})().catch((e) => { browserP = null; throw e; }));

let running = 0;
/** Report mark as an inline image for the PDF footer (header/footer templates cannot load URLs). */
let logoData: string | null | undefined;
function logoTag() {
  if (logoData === undefined) { try { logoData = `data:image/png;base64,${fs.readFileSync(path.join(config.webDist, 'brand', 'review-mark-64.png')).toString('base64')}`; } catch { logoData = null; } }
  return logoData ? `<img src="${logoData}" style="width:12px;height:12px;border-radius:3px" />` : '';
}
export async function reviewPdf(url: string, title: string): Promise<Uint8Array> {
  if (running >= 2) throw new Error('Two PDFs are already being prepared — try again in a moment.');
  running++;
  const page = await (await browser()).newPage();
  try {
    await page.setViewport({ width: 1200, height: 1600, deviceScaleFactor: 1 });
    await page.emulateMediaType('print');
    await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: 'light' }, { name: 'prefers-reduced-motion', value: 'reduce' }]);
    await page.evaluateOnNewDocument(() => { try { localStorage.setItem('theme', 'light'); } catch { /* */ } });
    await page.goto(url, { waitUntil: 'networkidle0', timeout: 90_000 });
    await page.waitForSelector('.epr-sec', { timeout: 60_000 });
    // let every chapter, chart and font settle; lazy blocks render on scroll
    await page.evaluate(async () => {
      document.documentElement.classList.add('epr-pdf'); delete document.documentElement.dataset.theme;
      for (let y = 0; y < document.body.scrollHeight; y += 900) { window.scrollTo(0, y); await new Promise((r) => setTimeout(r, 60)); }
      window.scrollTo(0, 0);
      await document.fonts.ready;
    });
    await new Promise((r) => setTimeout(r, 1200));
    const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));
    const foot = `<div style="width:100%;font:8px Inter,Helvetica,Arial,sans-serif;color:#8a8a8a;padding:0 14mm;display:flex;justify-content:space-between;align-items:center"><span style="display:flex;align-items:center;gap:6px">${logoTag()}Physique 57 India · ${esc(title)} · Confidential</span><span>Prepared by Jimmeey G. · <span class="pageNumber"></span> / <span class="totalPages"></span></span></div>`;
    return await page.pdf({ format: 'A4', printBackground: true, displayHeaderFooter: true, headerTemplate: '<span></span>', footerTemplate: foot,
      margin: { top: '12mm', bottom: '16mm', left: '10mm', right: '10mm' }, preferCSSPageSize: false, scale: 0.62, tagged: true, outline: true, timeout: 120_000 });
  } catch (e) { log.warn({ err: (e as Error).message }, 'review pdf failed'); throw e; }
  finally { running--; await page.close().catch(() => {}); }
}
