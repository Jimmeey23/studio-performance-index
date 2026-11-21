import fs from 'node:fs';
import path from 'node:path';
import pino from 'pino';
import { config } from '../config.js';

const logDir = path.join(config.dataDir, 'logs');
fs.mkdirSync(logDir, { recursive: true });

export const log = pino(
  { level: process.env.LOG_LEVEL ?? 'info', base: undefined },
  pino.multistream([
    { stream: process.stdout },
    { stream: fs.createWriteStream(path.join(logDir, 'app.log'), { flags: 'a' }) },
  ]),
);
