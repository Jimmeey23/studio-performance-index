import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(here, '..');

// Minimal .env loader (no dependency). Values in server/.env override the shell environment,
// so a stale ANTHROPIC_API_KEY exported in ~/.zshrc can't silently shadow the app's key.
const envFile = path.join(ROOT, '.env');
if (fs.existsSync(envFile)) {
  for (const line of fs.readFileSync(envFile, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (!m || line.trim().startsWith('#')) continue;
    const v = m[2].replace(/^["']|["']$/g, '');
    if (v !== '') process.env[m[1]] = v;
  }
}

const env = (k: string, d = '') => process.env[k] ?? d;

export const config = {
  port: Number(env('PORT', '8787')),
  dataDir: path.resolve(ROOT, env('DATA_DIR', 'data')),
  warehousePath: path.resolve(ROOT, env('DATA_DIR', 'data'), 'warehouse.duckdb'),
  appDbPath: path.resolve(ROOT, env('DATA_DIR', 'data'), 'app.duckdb'),
  rawDir: path.resolve(ROOT, env('DATA_DIR', 'data'), 'raw'),
  googleCredentialsFile: env('GOOGLE_APPLICATION_CREDENTIALS', path.join(ROOT, 'config', 'service-account.json')),
  anthropicKey: env('ANTHROPIC_API_KEY'),
  /** 'on' (default) lets the model reason before answering; 'off' disables extended thinking. */
  thinking: env('AI_THINKING', 'on'),
  anthropicModel: env('ANTHROPIC_MODEL', 'claude-sonnet-5-5'),
  jwtSecret: env('JWT_SECRET', 'change-me-in-.env'),
  authDisabled: env('AUTH_DISABLED', 'false') === 'true',
  syncCron: env('SYNC_INTERVAL_MINUTES', '60'),
  timezone: 'Asia/Kolkata',
  webDist: path.resolve(ROOT, '..', 'web', 'dist'),
};

fs.mkdirSync(config.dataDir, { recursive: true });
fs.mkdirSync(config.rawDir, { recursive: true });
