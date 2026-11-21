import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import { Db } from '../warehouse/db.js';
import { config } from '../config.js';

let _db: Db | null = null;
export async function appDb(): Promise<Db> {
  if (_db) return _db;
  _db = await Db.open(config.appDbPath);
  await _db.exec(`
    create table if not exists users(id varchar primary key, email varchar unique, name varchar, role varchar, password_hash varchar, created_at timestamp default now());
    create table if not exists conversations(id varchar primary key, user_id varchar, title varchar, pinned boolean default false, created_at timestamp default now(), updated_at timestamp default now());
    create table if not exists messages(id varchar primary key, conversation_id varchar, role varchar, display json, llm json, created_at timestamp default now());
    create table if not exists results(id varchar primary key, conversation_id varchar, payload json, created_at timestamp default now());
    create table if not exists saved_reports(id varchar primary key, user_id varchar, title varchar, question varchar, conversation_id varchar, message_id varchar, display json, created_at timestamp default now());
    alter table conversations add column if not exists domain varchar;
    create table if not exists audit(id varchar, user_id varchar, logged_at timestamp default now(), action varchar, detail json);
  `);
  const n = Number((await _db.one(`select count(*) n from users`))?.n);
  if (n === 0) {
    const email = process.env.ADMIN_EMAIL ?? 'admin@physique57india.com';
    const pw = process.env.ADMIN_PASSWORD ?? crypto.randomBytes(9).toString('base64url');
    await createUser({ email, name: 'Administrator', role: 'admin', password: pw });
    if (!process.env.ADMIN_PASSWORD) console.log(`\n  Created admin user ${email} with password: ${pw}\n  (set ADMIN_EMAIL / ADMIN_PASSWORD in .env to choose your own)\n`);
  }
  return _db;
}

export const newId = (p: string) => `${p}_${crypto.randomBytes(8).toString('hex')}`;

export async function createUser(u: { email: string; name: string; role: 'admin' | 'analyst' | 'viewer'; password: string }) {
  const db = await appDb();
  const id = newId('u');
  await db.all(`insert into users(id, email, name, role, password_hash) values (?, ?, ?, ?, ?)`, [id, u.email.toLowerCase(), u.name, u.role, bcrypt.hashSync(u.password, 10)]);
  return id;
}

export async function audit(userId: string, action: string, detail: unknown) {
  const db = await appDb();
  await db.all(`insert into audit(id, user_id, action, detail) values (?, ?, ?, ?)`, [newId('a'), userId, action, JSON.stringify(detail ?? {})]);
}

export async function saveResult(conversationId: string, payload: { id: string }) {
  const db = await appDb();
  await db.all(`insert or replace into results(id, conversation_id, payload) values (?, ?, ?)`, [payload.id, conversationId, JSON.stringify(payload)]);
}
export async function getResult(id: string) {
  const db = await appDb();
  const r = await db.one<{ payload: string }>(`select payload from results where id = ?`, [id]);
  return r ? JSON.parse(r.payload) : null;
}
export const parseJson = <T>(s: unknown): T => (typeof s === 'string' ? JSON.parse(s) : s) as T;
