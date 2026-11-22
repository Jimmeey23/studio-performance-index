/**
 * Chapter video explainers for the Executive Performance Review, generated with
 * NotebookLM through the notebooklm-py CLI (https://github.com/teng-lin/notebooklm-py).
 *
 * Setup (server): install the CLI (`pipx install notebooklm-py` / `uv tool install notebooklm-py`)
 * and provide one Google account's NotebookLM auth via NOTEBOOKLM_AUTH_JSON (or a profile under
 * NOTEBOOKLM_HOME). Jobs run strictly one at a time and back off on rate limits — no account rotation.
 *
 * Per chapter: create a notebook → add the chapter brief as a source → generate an explainer video →
 * poll until done → download the MP4 to DATA_DIR/explainers/<review>/<part>.mp4 → delete the notebook.
 * Status lives in the review's extras (videos[part]) so every viewer sees progress.
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { config } from '../config.js';
import { log } from '../util/log.js';
import * as reviewStore from './reviewStore.js';
import type { Review, ReviewAI } from './review.js';
import { blobConfigured, blobKey, putFile } from './blobStore.js';

export type VideoState = { status: 'queued' | 'processing' | 'ready' | 'failed'; step?: string; progress: number; startedAt?: string; at: string; error?: string; file?: string; storage?: 'local' | 'blomp'; key?: string; bytes?: number };
const BIN = process.env.NOTEBOOKLM_BIN || 'notebooklm';
const dir = (rid: string) => path.join(config.dataDir, 'explainers', rid.replace(/[^a-z0-9_-]/gi, ''));
export const videoFile = (rid: string, part: string) => path.join(dir(rid), `${part.replace(/[^a-z0-9_-]/gi, '')}.mp4`);

let available: boolean | null = null;
export async function explainersAvailable(): Promise<boolean> {
  if (available !== null) return available;
  try { await run(['--version'], 20_000); available = true; } catch { available = false; }
  return available;
}

function run(args: string[], timeout = 120_000): Promise<string> {
  return new Promise((resolve, reject) => {
    const p = spawn(BIN, args, { env: process.env, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '', err = '';
    const t = setTimeout(() => { p.kill('SIGKILL'); reject(new Error(`notebooklm ${args[0]} timed out`)); }, timeout);
    p.stdout.on('data', (d) => (out += d)); p.stderr.on('data', (d) => (err += d));
    p.on('error', (e) => { clearTimeout(t); reject(e); });
    p.on('close', (code) => { clearTimeout(t); code === 0 ? resolve(out) : reject(new Error((err || out).trim().slice(0, 400) || `exit ${code}`)); });
  });
}
const json = (s: string) => { const i = s.indexOf('{'); try { return JSON.parse(s.slice(i)); } catch { return {}; } };
const findId = (o: unknown): string | undefined => {
  if (!o || typeof o !== 'object') return undefined;
  const r = o as Record<string, unknown>;
  for (const k of ['notebook_id', 'id', 'task_id', 'artifact_id']) if (typeof r[k] === 'string') return r[k] as string;
  for (const v of Object.values(r)) { const x = findId(v); if (x) return x; }
  return undefined;
};
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/* ── status persistence (merged into review extras under the review's lock-free single writer: this queue) ── */
function setState(rid: string, part: string, patch: Partial<VideoState>) { return reviewStore.locked(rid, () => writeState(rid, part, patch)); }
async function writeState(rid: string, part: string, patch: Partial<VideoState>) {
  const cur = await reviewStore.byIdPublic(rid); if (!cur) return;
  const ex = (cur.ai.extras ?? {}) as NonNullable<ReviewAI['extras']> & { videos?: Record<string, VideoState> };
  const videos = { ...(ex.videos ?? {}) };
  videos[part] = { ...(videos[part] ?? { status: 'queued', progress: 0, at: '' }), ...patch, at: new Date().toISOString() } as VideoState;
  await reviewStore.saveAi(rid, { ...cur.ai, extras: { ...ex, videos } as ReviewAI['extras'] });
}
export async function videoStates(rid: string): Promise<Record<string, VideoState>> {
  const cur = await reviewStore.byIdPublic(rid);
  const v = ((cur?.ai.extras ?? {}) as { videos?: Record<string, VideoState> }).videos ?? {};
  // a file on disk can vanish (redeploy without a volume) — report it as needing regeneration
  for (const [p, s] of Object.entries(v)) if (s.status === 'ready' && s.storage !== 'blomp' && !fs.existsSync(videoFile(rid, p))) v[p] = { ...s, status: 'failed', error: 'Video file is no longer on the server — regenerate it.' };
  return v;
}

/* ── the brief NotebookLM turns into a video ── */
function brief(rv: Review, ai: ReviewAI, part: string): { title: string; text: string } | null {
  const P = rv.period;
  if (part === 'glance') {
    const g = ai.glance; if (!g) return null;
    return { title: `${rv.scope} — ${P.label} — At a glance`, text: [`# ${rv.scope}: Executive Performance Review, ${P.label}`, g.headline, g.summary, '## Key insights', ...g.insights.map((x) => `- ${x}`), '## Watch-outs', ...g.watch.map((x) => `- ${x}`),
      '## Headline numbers', ...rv.cover.headlineKpis.map((k) => `- ${k.label}: ${k.value ?? 'n/a'} (change vs ${P.prevLabel}: ${k.chg ?? 'n/a'})`)].join('\n\n') };
  }
  const s = rv.sections.find((x) => x.id === part); const a = ai.sections?.[part]; if (!s || !a) return null;
  return { title: `${rv.scope} — ${P.label} — ${s.title}`, text: [`# ${s.title} — ${rv.scope}, ${P.label}`, a.headline, a.summary, '## Insights', ...a.insights.map((x) => `- ${x}`), '## Findings', ...a.findings.map((x) => `- ${x}`),
    '## Recommended actions', ...a.recommendations.map((r) => `- ${r.title} (${r.owner}${r.timeline ? `, ${r.timeline}` : ''}): ${r.detail}`),
    '## Numbers', ...s.kpis.map((k) => `- ${k.label}: ${k.value ?? 'n/a'} (vs ${P.prevLabel}: ${k.chg ?? 'n/a'}; vs ${P.lyLabel}: ${k.chgLy ?? 'n/a'})`)].join('\n\n') };
}

/* ── one job at a time ── */
const queue: { rid: string; part: string }[] = [];
let busy = false;
export async function enqueue(rid: string, parts: string[], force = false) {
  const states = await videoStates(rid);
  for (const part of parts) {
    const st = states[part];
    if (!force && st && (st.status === 'ready' || st.status === 'processing' || st.status === 'queued')) continue;
    if (queue.some((q) => q.rid === rid && q.part === part)) continue;
    queue.push({ rid, part });
    await setState(rid, part, { status: 'queued', progress: 0, step: 'Waiting in queue', error: undefined });
  }
  void pump();
}
async function pump() {
  if (busy) return; busy = true;
  try { while (queue.length) { const j = queue.shift()!; await generate(j.rid, j.part); await sleep(5_000); } }
  finally { busy = false; }
}

async function generate(rid: string, part: string) {
  const saved = await reviewStore.byIdPublic(rid); if (!saved) return;
  const b = brief(saved.review, saved.ai, part);
  if (!b) { await setState(rid, part, { status: 'failed', progress: 0, error: 'Chapter commentary is not written yet.' }); return; }
  const started = Date.now(); let nb: string | undefined;
  const step = (stepName: string, progress: number) => setState(rid, part, { status: 'processing', step: stepName, progress, startedAt: new Date(started).toISOString() });
  try {
    await step('Creating notebook', 3);
    nb = findId(json(await run(['create', b.title.slice(0, 90), '--json'])));
    if (!nb) throw new Error('Could not read the new notebook id');
    await step('Adding the chapter brief', 8);
    fs.mkdirSync(dir(rid), { recursive: true });
    const src = path.join(dir(rid), `${part}.md`); fs.writeFileSync(src, b.text);
    await run(['source', 'add', src, '--title', b.title.slice(0, 90), '-n', nb, '--json'], 180_000);
    await step('Generating the video', 12);
    const prompt = `A concise explainer for Physique 57 senior management on "${b.title}". Lead with the headline number, explain the drivers, and finish with the recommended actions. Use only the figures in the source.`;
    let task: string | undefined;
    for (let attempt = 0; attempt < 4 && !task; attempt++) {
      try { task = findId(json(await run(['generate', 'video', prompt, '--format', 'explainer', '-n', nb, '--json'], 180_000))); }
      catch (e) { if (!/rate|quota|429|limit/i.test((e as Error).message) || attempt === 3) throw e; await step(`Rate-limited — retrying in ${2 ** attempt} min`, 12); await sleep(2 ** attempt * 60_000); }
    }
    if (!task) throw new Error('Video generation did not return a task id');
    // poll: NotebookLM videos usually take 5–15 minutes; progress is time-based until it reports completion
    const deadline = Date.now() + 40 * 60_000;
    for (;;) {
      await sleep(20_000);
      const st = json(await run(['artifact', 'poll', task, '-n', nb, '--json'], 60_000)) as { status?: string; error?: string };
      const s = String(st.status ?? '').toLowerCase();
      if (/fail|error/.test(s)) throw new Error(st.error || 'NotebookLM reported the video failed');
      if (/complete|ready|done|success/.test(s)) break;
      if (Date.now() > deadline) throw new Error('Timed out waiting for NotebookLM (40 min)');
      const el = (Date.now() - started) / 60_000;
      await step('Generating the video', Math.min(90, Math.round(12 + (78 * el) / 12)));
    }
    await step('Downloading', 94);
    const out = videoFile(rid, part);
    await run(['download', 'video', out, '-n', nb, '-a', task, '--force', '--json'], 300_000);
    if (!fs.existsSync(out)) throw new Error('Download finished but no file was written');
    await step('Compressing', 96);
    const final = await compress(out);
    let storage: VideoState['storage'] = 'local'; let key: string | undefined;
    if (blobConfigured()) {
      await step('Uploading to storage', 98);
      key = blobKey(`explainers/${rid}/${part}.mp4`);
      await putFile(key, final, 'video/mp4');
      storage = 'blomp';
      fs.rmSync(final, { force: true });   // the server disk is not kept between deploys; Blomp is the copy of record
    }
    const bytes = storage === 'local' ? fs.statSync(final).size : undefined;
    await setState(rid, part, { status: 'ready', progress: 100, step: 'Ready', file: path.basename(out), storage, key, bytes, error: undefined });
    log.info({ rid, part, secs: Math.round((Date.now() - started) / 1000) }, 'explainer video ready');
  } catch (e) {
    const m = (e as Error).message;
    log.warn({ rid, part, err: m }, 'explainer video failed');
    await setState(rid, part, { status: 'failed', progress: 0, step: 'Failed', error: m.slice(0, 300) });
  } finally {
    if (nb) run(['delete', '-n', nb, '-y', '--json'], 60_000).catch(() => {});
  }
}

/** Re-encode to 720p H.264 / AAC with fast-start for streaming; falls back to the original if ffmpeg is missing or fails. */
function compress(file: string): Promise<string> {
  const out = file.replace(/\.mp4$/, '.c.mp4');
  return new Promise((resolve) => {
    const p = spawn(process.env.FFMPEG_BIN || 'ffmpeg', ['-y', '-loglevel', 'error', '-i', file, '-vf', "scale=-2:'min(720,ih)'", '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '28',
      '-c:a', 'aac', '-b:a', '96k', '-movflags', '+faststart', out], { stdio: 'ignore' });
    p.on('error', () => resolve(file));
    p.on('close', (code) => {
      if (code === 0 && fs.existsSync(out) && fs.statSync(out).size > 0 && fs.statSync(out).size < fs.statSync(file).size) { fs.renameSync(out, file); resolve(file); }
      else { fs.rmSync(out, { force: true }); resolve(file); }
    });
  });
}
