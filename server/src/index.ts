import fs from 'node:fs';
import path from 'node:path';
import express, { type Request, type Response, type NextFunction } from 'express';
import cookieParser from 'cookie-parser';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import multer from 'multer';
import { config } from './config.js';
import { log } from './util/log.js';
import { warehouse } from './warehouse/db.js';
import { appDb, createUser, newId, parseJson, getResult, audit } from './store/app.js';
import { answer, hydrateMessage, type StreamEvent } from './ai/orchestrator.js';
import { clearCoverageCache } from './ai/prompt.js';
import { DOMAINS, domainById } from './ai/domains.js';
import { MODELS as TIER_MODELS } from './ai/router.js';
import { catalog, runMetricsQuery, runDrill, QueryError } from './semantic/engine.js';
import { buildDashboard } from './ai/dashboard.js';
import { buildReport, getReport, ReportRequestSchema, TOPICS } from './report/build.js';
import * as reportStore from './report/store.js';
import { generateInsights, rulesInsights } from './report/insights.js';
import { detectAnomalies, forecast } from './analytics/analyses.js';
import { syncFromGoogle, syncFromFiles, rebuildOnly, syncInProgress } from './ingest/pipeline.js';
import { SOURCES } from './sources.js';
import { MODELS } from './warehouse/models.js';
import { loadRules, saveRules } from './warehouse/rules.js';
import { exploreClasses, explorerOptions } from './analytics/classExplorer.js';
import { designerCatalog, renderDesign, fillAi } from './report/designer.js';
import { listDesigns, getDesign, saveDesign, saveRendered, deleteDesign, cachedDashboard, storeDashboard, clearDashboards, getPrefs, setPref } from './store/persist.js';
import { houseKnowledge, saveHouseKnowledge, learnedKnowledge, listNotes, addNote, deleteNote } from './ai/brandBrain.js';

type User = { id: string; email: string; name: string; role: "admin" | "analyst" | "viewer"; [k: string]: unknown };
declare module 'express-serve-static-core' { interface Request { user?: User } }

const app = express();
app.use(express.json({ limit: '5mb' }));
app.use(cookieParser());
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 200 * 1024 * 1024 } });

const wrap = (fn: (req: Request, res: Response) => Promise<unknown>) => (req: Request, res: Response) =>
  fn(req, res).catch((e: Error) => {
    log.error({ path: req.path, err: e.message }, 'request failed');
    if (!res.headersSent) res.status(e instanceof QueryError ? 400 : 500).json({ error: e.message });
  });

/* ── auth ─────────────────────────────────────────────────────────────── */
function auth(req: Request, res: Response, next: NextFunction) {
  if (config.authDisabled) { req.user = { id: 'dev', email: 'dev@local', name: 'Developer', role: 'admin' }; return next(); }
  const token = req.cookies?.p57bi ?? (req.headers.authorization ?? '').replace(/^Bearer /, '');
  try { req.user = jwt.verify(token, config.jwtSecret) as User; next(); } catch { res.status(401).json({ error: 'Not signed in' }); }
}
const adminOnly = (req: Request, res: Response, next: NextFunction) => (req.user?.role === 'admin' ? next() : res.status(403).json({ error: 'Admins only' }));

app.post('/api/auth/login', wrap(async (req, res) => {
  const db = await appDb();
  const u = await db.one<User & { password_hash: string }>(`select * from users where email = ?`, [String(req.body.email ?? '').toLowerCase()]);
  if (!u || !bcrypt.compareSync(String(req.body.password ?? ''), u.password_hash)) return res.status(401).json({ error: 'Invalid email or password' });
  const user = { id: u.id, email: u.email, name: u.name, role: u.role };
  res.cookie('p57bi', jwt.sign(user, config.jwtSecret, { expiresIn: '14d' }), { httpOnly: true, sameSite: 'lax', maxAge: 14 * 864e5 });
  await audit(u.id, 'login', {});
  res.json(user);
}));
app.post('/api/auth/logout', (_req, res) => { res.clearCookie('p57bi'); res.json({ ok: true }); });
app.get('/api/me', auth, (req, res) => res.json({ ...req.user, authDisabled: config.authDisabled, aiConfigured: !!config.anthropicKey,
  model: `Auto: ${TIER_MODELS.fast.id} / ${TIER_MODELS.balanced.id} / ${TIER_MODELS.deep.id}`,
  models: { fast: TIER_MODELS.fast, balanced: TIER_MODELS.balanced, deep: TIER_MODELS.deep } }));

app.use('/api', auth);

/* ── chat ─────────────────────────────────────────────────────────────── */
app.post('/api/chat', async (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();
  const emit = (e: StreamEvent) => res.write(`data: ${JSON.stringify(e)}\n\n`);
  const ping = setInterval(() => res.write(': ping\n\n'), 15000);
  try {
    await answer({ conversationId: req.body.conversationId, userId: req.user!.id, question: String(req.body.question ?? '').slice(0, 4000), emit,
      controls: req.body.controls, domain: req.body.domain && domainById.has(req.body.domain) ? req.body.domain : undefined });
  } catch (e) { emit({ type: 'error', message: (e as Error).message }); }
  clearInterval(ping);
  res.end();
});

app.get('/api/conversations', wrap(async (req, res) => {
  const db = await appDb();
  const domain = typeof req.query.domain === 'string' ? req.query.domain : null;
  res.json(await db.all(`select id, title, pinned, domain, created_at::varchar created_at, updated_at::varchar updated_at from conversations where user_id = ? ${domain ? 'and domain = ?' : ''} order by pinned desc, updated_at desc limit 200`, domain ? [req.user!.id, domain] : [req.user!.id]));
}));
app.get('/api/conversations/:id', wrap(async (req, res) => {
  const db = await appDb();
  const c = await db.one(`select id, title, pinned, user_id, domain from conversations where id = ?`, [req.params.id]);
  if (!c || (c.user_id !== req.user!.id && req.user!.role !== 'admin')) return res.status(404).json({ error: 'Not found' });
  const msgs = await db.all<{ id: string; role: string; display: string; created_at: string }>(`select id, role, display, created_at::varchar created_at from messages where conversation_id = ? order by created_at`, [req.params.id]);
  const out = [];
  for (const m of msgs) out.push({ id: m.id, role: m.role, created_at: m.created_at, ...(await hydrateMessage(parseJson(m.display))) });
  res.json({ ...c, messages: out });
}));
app.patch('/api/conversations/:id', wrap(async (req, res) => {
  const db = await appDb();
  if (req.body.title !== undefined) await db.all(`update conversations set title = ? where id = ? and user_id = ?`, [String(req.body.title).slice(0, 120), req.params.id, req.user!.id]);
  if (req.body.pinned !== undefined) await db.all(`update conversations set pinned = ? where id = ? and user_id = ?`, [!!req.body.pinned, req.params.id, req.user!.id]);
  res.json({ ok: true });
}));
app.delete('/api/conversations/:id', wrap(async (req, res) => {
  const db = await appDb();
  const c = await db.one(`select id from conversations where id = ? and user_id = ?`, [req.params.id, req.user!.id]);
  if (!c) return res.status(404).json({ error: 'Not found' });
  await db.all(`delete from messages where conversation_id = ?`, [req.params.id]);
  await db.all(`delete from conversations where id = ?`, [req.params.id]);
  res.json({ ok: true });
}));

/* ── results / direct queries ─────────────────────────────────────────── */
app.get('/api/results/:id', wrap(async (req, res) => { const r = await getResult(String(req.params.id)); r ? res.json(r) : res.status(404).json({ error: 'Not found' }); }));
app.get('/api/results/:id/csv', wrap(async (req, res) => {
  const r = await getResult(String(req.params.id));
  if (!r) return res.status(404).end();
  const cols = r.columns as { key: string; label: string }[];
  const esc = (v: unknown) => { const s = v === null || v === undefined ? '' : String(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  const csv = [cols.map((c) => esc(c.label)).join(','), ...(r.rows as Record<string, unknown>[]).map((row) => cols.map((c) => esc(row[c.key])).join(','))].join('\n');
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${(r.title ?? r.id).replace(/[^\w\- ]+/g, '').slice(0, 60) || 'result'}.csv"`);
  res.send('﻿' + csv);
}));
app.post('/api/query', wrap(async (req, res) => res.json(await runMetricsQuery(req.body))));
app.get('/api/catalog', wrap(async (_req, res) => res.json({ ...catalog(), rules: loadRules() })));

/* ── insights overview (cached) ───────────────────────────────────────── */
let insightsCache: { at: number; data: unknown } | null = null;
app.get('/api/insights', wrap(async (req, res) => {
  if (insightsCache && Date.now() - insightsCache.at < 30 * 60e3 && !req.query.refresh) return res.json(insightsCache.data);
  const now = new Date(Date.now() + 5.5 * 3600e3);
  const lmStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1)).toISOString().slice(0, 10);
  const lmEnd = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 0)).toISOString().slice(0, 10);
  const safe = async <T,>(f: () => Promise<T>) => { try { return await f(); } catch (e) { return { error: (e as Error).message }; } };
  const data = {
    period: { start: lmStart, end: lmEnd },
    kpis: await safe(() => runMetricsQuery({ metrics: ['revenue', 'paying_clients', 'visits', 'visiting_clients', 'new_clients', 'conversion_rate', 'fill_rate', 'leads'], start: lmStart, end: lmEnd, compare: 'previous_year' })),
    byLocation: await safe(() => runMetricsQuery({ metrics: ['revenue', 'visits', 'new_clients', 'conversion_rate'], dimensions: ['location'], start: lmStart, end: lmEnd, compare: 'previous_year', filters: [{ dimension: 'location', op: 'not_in', values: ['(blank)'] }] })),
    trend: await safe(() => runMetricsQuery({ metrics: ['revenue'], grain: 'month', compare: 'previous_year' })),
    revenueForecast: await safe(() => forecast({ metric: 'revenue', horizon: 3 })),
    anomalies: await safe(() => detectAnomalies({ split_by: 'location' })),
  };
  insightsCache = { at: Date.now(), data };
  res.json(data);
}));

/* ── domain workspaces ────────────────────────────────────────────────── */
app.get('/api/domains', (_req, res) => res.json(DOMAINS.map(({ expert, ...d }) => d)));
const domainCache = new Map<string, { at: number; data: unknown }>();
/** Workspace dashboards: memory first, then the database (survives restarts), then computed and stored. Cleared on data refresh. */
async function domainHandler(req: Request, res: Response) {
  const d = domainById.get(String(req.params.id));
  if (!d) return res.status(404).json({ error: 'Unknown workspace' });
  const filters = req.method === 'POST' ? (req.body?.filters ?? {}) : {};
  const key = d.id + JSON.stringify(filters);
  const fresh = !!req.query.refresh || !!req.body?.refresh;
  const hit = domainCache.get(key);
  if (!fresh && hit && Date.now() - hit.at < 12 * 3600e3) return res.json(hit.data);
  if (!fresh) { const stored = await cachedDashboard(key, 24 * 60).catch(() => null); if (stored) { domainCache.set(key, { at: Date.now(), data: stored }); return res.json(stored); } }
  const data = await buildDashboard(d, filters);
  domainCache.set(key, { at: Date.now(), data });
  storeDashboard(key, data).catch(() => {});
  res.json(data);
}
app.get('/api/domains/:id', wrap(domainHandler));
app.post('/api/domains/:id', wrap(domainHandler));

/* ── executive report ─────────────────────────────────────────────────── */
app.post('/api/report', wrap(async (req, res) => {
  const uid = req.user!.id; const fresh = !!req.body?.fresh;
  const rq = ReportRequestSchema.parse(req.body);
  if (!fresh) {
    const saved = await reportStore.findByRequest(uid, reportStore.reqKey(rq));
    if (saved) return res.json({ ...saved.data, id: saved.id, saved: { insights: saved.insights, layout: saved.layout, created_at: saved.created_at, reused: true } });
  }
  const r = await buildReport(rq);
  const prev = await reportStore.latest(uid, rq.kind);     // carry the user's last layout forward (per report kind)
  await reportStore.saveNew(uid, r, req.body?.layout ?? prev?.layout ?? null);
  const { results, ...out } = r;
  res.json({ ...out, saved: { insights: null, layout: req.body?.layout ?? prev?.layout ?? null, created_at: r.generatedAt, reused: false } });
}));
app.get('/api/report/topics', (_req, res) => res.json(TOPICS));
app.get('/api/report/latest', wrap(async (req, res) => {
  const s = await reportStore.latest(req.user!.id, req.query.kind === 'custom' ? 'custom' : 'executive');
  res.json(s ? { ...s.data, id: s.id, saved: { insights: s.insights, layout: s.layout, created_at: s.created_at, reused: true } } : null);
}));
app.get('/api/report/saved', wrap(async (req, res) => res.json(await reportStore.list(req.user!.id, req.query.kind === 'custom' ? 'custom' : 'executive'))));
app.get('/api/report/:id', wrap(async (req, res) => {
  const s = await reportStore.byId(req.user!.id, String(req.params.id));
  if (!s) return res.status(404).json({ error: 'Report not found' });
  res.json({ ...s.data, id: s.id, saved: { insights: s.insights, layout: s.layout, created_at: s.created_at, reused: true } });
}));
app.put('/api/report/:id/layout', wrap(async (req, res) => { await reportStore.saveLayout(req.user!.id, String(req.params.id), req.body?.layout ?? null); res.json({ ok: true }); }));
app.delete('/api/report/:id', wrap(async (req, res) => { await reportStore.remove(req.user!.id, String(req.params.id)); res.json({ ok: true }); }));
/** AI commentary is generated once per saved report; a stored copy is always returned unless `fresh` is set. */
app.post('/api/report/:id/insights', wrap(async (req, res) => {
  const uid = req.user!.id; const id = String(req.params.id);
  const saved = await reportStore.byId(uid, id);
  if (saved?.insights && !req.body?.fresh) return res.json({ ...saved.insights, cached: true });
  let r = getReport(id);
  if (!r) {
    if (!saved) return res.status(404).json({ error: 'Report not found — generate it again.' });
    r = await buildReport(saved.data.request);           // server restarted: recompute the numbers behind the saved report
  }
  const tier = ['fast', 'balanced', 'deep'].includes(req.body?.tier) ? req.body.tier : 'balanced';
  const ins = req.body?.rules ? rulesInsights(r) : await generateInsights(r, tier);
  // don't keep a fallback written because the AI call failed — the next open can try again
  const failed = !req.body?.rules && ins.source !== 'ai' && /AI commentary unavailable/.test(ins.executive_summary);
  if (saved && !failed) await reportStore.saveInsights(id, ins);
  res.json(ins);
}));

/* ── drill-through: item-level records behind any number ──────────────── */
app.post('/api/drill', wrap(async (req, res) => res.json(await runDrill(req.body))));
/* report designer (wireframe reports) */
app.get('/api/designer/catalog', (_req, res) => res.json(designerCatalog()));
app.get('/api/designs', wrap(async (req, res) => { res.json(await listDesigns(req.user!.id)); }));
app.get('/api/designs/:id', wrap(async (req, res) => { const d = await getDesign(req.user!.id, String(req.params.id)); if (!d) return res.status(404).json({ error: 'Not found' }); res.json(d); }));
app.post('/api/designs', wrap(async (req, res) => { const id = await saveDesign(req.user!.id, req.body?.id ?? null, req.body?.design ?? {}); res.json({ id }); }));
app.delete('/api/designs/:id', wrap(async (req, res) => { await deleteDesign(req.user!.id, String(req.params.id)); res.json({ ok: true }); }));
app.post('/api/designs/render', wrap(async (req, res) => {
  const r = await renderDesign(req.body?.design ?? {});
  const ai = req.body?.ai ? await fillAi(r, req.body?.tier === 'balanced' || req.body?.tier === 'deep' ? req.body.tier : 'fast') : (req.body?.keepAi ?? {});
  const out = { ...r, ai };
  if (req.body?.id) await saveRendered(req.user!.id, String(req.body.id), out);
  res.json(out);
}));
/* per-user preferences and drafts */
app.get('/api/prefs', wrap(async (req, res) => { res.json(await getPrefs(req.user!.id)); }));
app.put('/api/prefs/:key', wrap(async (req, res) => { await setPref(req.user!.id, String(req.params.key), req.body?.value); res.json({ ok: true }); }));
/* brand knowledge: house notes, data-learned facts and notes the team taught the analyst */
app.get('/api/knowledge', wrap(async (_req, res) => { res.json({ house: houseKnowledge(), learned: await learnedKnowledge(), notes: await listNotes() }); }));
app.put('/api/knowledge/house', adminOnly, wrap(async (req, res) => { saveHouseKnowledge(String(req.body?.markdown ?? '')); res.json({ ok: true }); }));
app.post('/api/knowledge/rebuild', adminOnly, wrap(async (_req, res) => { res.json({ learned: await learnedKnowledge(true) }); }));
app.post('/api/knowledge/notes', wrap(async (req, res) => { res.json(await addNote(String(req.body?.text ?? ''), String(req.body?.category ?? 'general'), 'settings', req.user!.email ?? req.user!.id)); }));
app.delete('/api/knowledge/notes/:id', wrap(async (req, res) => { await deleteNote(String(req.params.id)); res.json({ ok: true }); }));
app.get('/api/classes/explore/options', wrap(async (_req, res) => { res.json(explorerOptions()); }));
app.post('/api/classes/explore', wrap(async (req, res) => { res.json(await exploreClasses(req.body)); }));
app.get('/api/locations', wrap(async (_req, res) => {
  const r = await runMetricsQuery({ metrics: ['revenue'], dimensions: ['location'], filters: [{ dimension: 'location', op: 'not_in', values: ['(blank)'] }] });
  res.json(r.rows.map((x) => String(x.location)));
}));

/* ── saved reports ────────────────────────────────────────────────────── */
app.get('/api/reports', wrap(async (req, res) => {
  const db = await appDb();
  res.json(await db.all(`select id, title, question, conversation_id, created_at::varchar created_at from saved_reports where user_id = ? order by created_at desc`, [req.user!.id]));
}));
app.post('/api/reports', wrap(async (req, res) => {
  const db = await appDb();
  const m = await db.one<{ display: string; conversation_id: string }>(`select display, conversation_id from messages where id = ?`, [req.body.messageId]);
  if (!m) return res.status(404).json({ error: 'Message not found' });
  const q = await db.one<{ display: string }>(`select display from messages where conversation_id = ? and role = 'user' and created_at < (select created_at from messages where id = ?) order by created_at desc limit 1`, [m.conversation_id, req.body.messageId]);
  const id = newId('rep');
  await db.all(`insert into saved_reports(id, user_id, title, question, conversation_id, message_id, display) values (?, ?, ?, ?, ?, ?, ?)`,
    [id, req.user!.id, String(req.body.title ?? 'Saved report').slice(0, 120), q ? parseJson<{ text: string }>(q.display).text : '', m.conversation_id, req.body.messageId, m.display]);
  res.json({ id });
}));
app.get('/api/reports/:id', wrap(async (req, res) => {
  const db = await appDb();
  const r = await db.one<{ display: string }>(`select * from saved_reports where id = ? and user_id = ?`, [req.params.id, req.user!.id]);
  if (!r) return res.status(404).json({ error: 'Not found' });
  res.json({ ...r, display: await hydrateMessage(parseJson(r.display)) });
}));
/** Re-run every metrics block in a saved report against the latest data. */
app.post('/api/reports/:id/refresh', wrap(async (req, res) => {
  const db = await appDb();
  const r = await db.one<{ display: string }>(`select * from saved_reports where id = ? and user_id = ?`, [req.params.id, req.user!.id]);
  if (!r) return res.status(404).json({ error: 'Not found' });
  const display = await hydrateMessage(parseJson(r.display)) as { blocks?: { result?: { kind: string; spec: unknown; title?: string } }[] };
  let refreshed = 0;
  for (const b of display.blocks ?? []) {
    if (b.result?.kind === 'metrics') { const t = b.result.title; b.result = await runMetricsQuery(b.result.spec) as never; if (t) (b.result as { title?: string }).title = t; refreshed++; }
  }
  res.json({ ...r, display, refreshed });
}));
app.delete('/api/reports/:id', wrap(async (req, res) => {
  const db = await appDb();
  await db.all(`delete from saved_reports where id = ? and user_id = ?`, [req.params.id, req.user!.id]);
  res.json({ ok: true });
}));

/* ── data sources, dictionary, quality, sync ──────────────────────────── */
app.get('/api/sources', wrap(async (_req, res) => {
  const wh = await warehouse();
  const state = (await wh.tableExists('_tab_state')) ? await wh.all(`select raw_table, row_count, col_count, loaded_at::varchar loaded_at, drive_modified from _tab_state`) : [];
  const builds = (await wh.tableExists('_model_build')) ? await wh.all(`select model, status, rows, duplicates, error, built_at::varchar built_at from _model_build`) : [];
  const syncs = (await wh.tableExists('_sync_log')) ? await wh.all(`select id, started_at::varchar started_at, finished_at::varchar finished_at, mode, status from _sync_log order by started_at desc limit 20`) : [];
  res.json({
    sources: SOURCES.map((s) => ({ ...s, url: `https://docs.google.com/spreadsheets/d/${s.spreadsheetId}`, tabs: s.tabs.map((t) => ({ ...t, state: state.find((x) => x.raw_table === `raw_${t.table}`) ?? null })) })),
    models: MODELS.map((m) => ({ name: m.name, grain: m.grain, description: m.description, sourceOfTruth: m.sourceOfTruth, key: m.key, build: builds.find((b) => b.model === m.name) ?? null })),
    syncs, syncing: syncInProgress(), googleConfigured: fs.existsSync(config.googleCredentialsFile),
  });
}));
app.get('/api/dictionary', wrap(async (_req, res) => {
  const wh = await warehouse();
  if (!(await wh.tableExists('_dictionary'))) return res.json([]);
  const rows = await wh.all<{ profile: string }>(`select profile from _dictionary`);
  const raw = (await wh.tableExists('_meta_columns')) ? await wh.all(`select raw_table, position, column_name, original_header from _meta_columns order by raw_table, position`) : [];
  res.json({ models: rows.map((r) => parseJson(r.profile)), rawColumns: raw });
}));
app.get('/api/quality', wrap(async (_req, res) => {
  const wh = await warehouse();
  res.json((await wh.tableExists('_quality')) ? await wh.all(`select check_id, severity, area, value, detail, checked_at::varchar checked_at from _quality order by case severity when 'error' then 0 when 'warning' then 1 else 2 end, area`) : []);
}));
app.get('/api/sync/:id', wrap(async (req, res) => {
  const wh = await warehouse();
  const r = await wh.one<{ details: string }>(`select details from _sync_log where id = ?`, [req.params.id]);
  r ? res.json(parseJson(r.details)) : res.status(404).json({ error: 'Not found' });
}));
const afterSync = () => { insightsCache = null; domainCache.clear(); clearDashboards().catch(() => {}); clearCoverageCache(); learnedKnowledge(true).catch(() => {}); };
app.post('/api/sync', adminOnly, wrap(async (req, res) => { const r = await syncFromGoogle({ force: !!req.body.force }); afterSync(); await audit(req.user!.id, 'sync', { status: r.status }); res.json(r); }));
app.post('/api/sync/upload', adminOnly, upload.array('files', 10), wrap(async (req, res) => {
  const files = ((req.files as Express.Multer.File[]) ?? []).map((f) => ({ name: f.originalname, buffer: f.buffer }));
  const r = await syncFromFiles(files); afterSync(); await audit(req.user!.id, 'upload_sync', { files: files.map((f) => f.name), status: r.status }); res.json(r);
}));
app.post('/api/rebuild', adminOnly, wrap(async (req, res) => { const r = await rebuildOnly(); afterSync(); await audit(req.user!.id, 'rebuild', {}); res.json(r); }));
app.get('/api/rules', wrap(async (_req, res) => res.json(loadRules())));
app.put('/api/rules', adminOnly, wrap(async (req, res) => { saveRules(req.body); await audit(req.user!.id, 'rules_update', {}); res.json({ ok: true, note: 'Saved. Rebuild models to apply.' }); }));

/* ── targets ──────────────────────────────────────────────────────────── */
app.get('/api/targets', wrap(async (_req, res) => {
  const wh = await warehouse();
  await wh.exec(`create table if not exists app_targets(month date, location varchar, metric varchar, target double)`);
  res.json(await wh.all(`select month::varchar as "month", location, metric, target from app_targets order by 1 desc, location, metric`));
}));
app.post('/api/targets', adminOnly, wrap(async (req, res) => {
  const wh = await warehouse();
  await wh.exec(`create table if not exists app_targets(month date, location varchar, metric varchar, target double)`);
  const rows = (req.body.rows ?? []) as { month: string; location: string; metric: string; target: number }[];
  let n = 0;
  for (const r of rows) {
    if (!/^\d{4}-\d{2}/.test(r.month) || !r.metric || !isFinite(Number(r.target))) continue;
    const month = r.month.slice(0, 7) + '-01';
    await wh.all(`delete from app_targets where month = ?::date and location = ? and metric = ?`, [month, r.location ?? 'All', r.metric]);
    await wh.all(`insert into app_targets values (?::date, ?, ?, ?)`, [month, r.location ?? 'All', r.metric, Number(r.target)]);
    n++;
  }
  await audit(req.user!.id, 'targets_upload', { rows: n });
  res.json({ saved: n });
}));

/* ── users ────────────────────────────────────────────────────────────── */
app.get('/api/users', adminOnly, wrap(async (_req, res) => { const db = await appDb(); res.json(await db.all(`select id, email, name, role, created_at::varchar created_at from users order by created_at`)); }));
app.post('/api/users', adminOnly, wrap(async (req, res) => {
  const { email, name, role, password } = req.body;
  if (!email || !password || String(password).length < 8) return res.status(400).json({ error: 'Email and a password of at least 8 characters are required' });
  res.json({ id: await createUser({ email, name: name ?? email, role: ['admin', 'analyst', 'viewer'].includes(role) ? role : 'analyst', password }) });
}));

/* ── static web app ───────────────────────────────────────────────────── */
if (fs.existsSync(config.webDist)) {
  app.use(express.static(config.webDist));
  app.get(/^(?!\/api).*/, (_req, res) => res.sendFile(path.join(config.webDist, 'index.html')));
}

/* ── start ────────────────────────────────────────────────────────────── */
try {
  await appDb();
  await warehouse();
} catch (e) {
  const m = (e as Error).message;
  const pid = m.match(/PID (\d+)/)?.[1];
  if (/Could not set lock/.test(m)) {
    console.error(`\n  Another copy of the server is already running${pid ? ` (process ${pid})` : ''} and holds the database.\n  Stop it first${pid ? ` with:  kill ${pid}` : ' (Ctrl+C in its terminal)'}  — then run npm start again.\n`);
    process.exit(1);
  }
  throw e;
}
app.listen(config.port, () => log.info(`Physique 57 BI listening on http://localhost:${config.port}`));

/**
 * Self-heal after an update: if a model gained columns the stored warehouse doesn't have yet,
 * rebuild the models from the already-synced raw sheets (no re-download) so no one has to
 * remember Settings → Rebuild models.
 */
const REQUIRED_COLUMNS: Record<string, string[]> = { fct_new_clients: ['is_trial', 'is_new_client'], fct_sessions: ['session_title'] };
(async () => {
  try {
    const db = await warehouse();
    const missing: string[] = [];
    for (const [table, cols] of Object.entries(REQUIRED_COLUMNS)) {
      if (!(await db.tableExists(table))) continue;
      const have = new Set((await db.columns(table)).map((c) => c.name));
      missing.push(...cols.filter((c) => !have.has(c)).map((c) => `${table}.${c}`));
    }
    if (!missing.length || syncInProgress()) return;
    log.info({ missing }, 'warehouse is older than the models — rebuilding from synced data');
    const r = await rebuildOnly();
    afterSync();
    log.info({ status: r.status }, 'automatic model rebuild finished');
  } catch (e) { log.warn({ err: (e as Error).message }, 'automatic model rebuild failed — use Settings → Rebuild models'); }
  finally { learnedKnowledge().then((k) => log.info({ chars: k.length }, 'brand knowledge ready')).catch(() => {}); }
})();

const minutes = Number(config.syncCron);
if (minutes > 0 && fs.existsSync(config.googleCredentialsFile)) {
  setInterval(() => { syncFromGoogle().then(afterSync).catch((e) => log.error({ err: e.message }, 'scheduled sync failed')); }, minutes * 60e3);
  log.info(`Scheduled Google Sheets sync every ${minutes} minutes`);
}
