/**
 * Never-lose-a-change autosave for review edits, notes, ink and speaker notes.
 *
 * Every change is (1) written to localStorage immediately, (2) sent to the server after a
 * short debounce, (3) retried with back-off until the server confirms, and (4) flushed with
 * `keepalive` when the tab is hidden or closed. Anything still pending when the page loads
 * again (crash, offline, closed tab) is replayed on start-up.
 */
import { useEffect, useRef, useState } from 'react';

export type SaveState = 'idle' | 'saving' | 'saved' | 'offline' | 'error';
type Job = { url: string; body: unknown; v: number };
const STORE = 'epr-autosave-v1';

const readLocal = (): Record<string, Job> => { try { return JSON.parse(localStorage.getItem(STORE) ?? '{}'); } catch { return {}; } };
const writeLocal = (m: Map<string, Job>) => { try { localStorage.setItem(STORE, JSON.stringify(Object.fromEntries(m))); } catch { /* storage full / private mode */ } };

class Autosave {
  pending = new Map<string, Job>();
  private timer: ReturnType<typeof setTimeout> | null = null;
  private busy = false; private tries = 0; private v = 0;
  listeners = new Set<(s: SaveState) => void>();
  state: SaveState = 'idle';
  constructor() {
    for (const [k, j] of Object.entries(readLocal())) this.pending.set(k, j);
    if (this.pending.size) this.schedule(500);
    const bail = () => this.beacon();
    window.addEventListener('pagehide', bail);
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') bail(); });
    window.addEventListener('online', () => this.schedule(0));
    window.addEventListener('beforeunload', (e) => { if (this.pending.size) { this.beacon(); e.preventDefault(); } });
  }
  private set(s: SaveState) { this.state = s; this.listeners.forEach((f) => f(s)); }
  /** Queue the latest value for `key` (later calls for the same key replace earlier ones). */
  put(key: string, url: string, body: unknown, delay = 400) {
    this.pending.set(key, { url, body, v: ++this.v }); writeLocal(this.pending);
    this.set('saving'); this.schedule(delay);
  }
  private schedule(ms: number) { if (this.timer) clearTimeout(this.timer); this.timer = setTimeout(() => void this.flush(), ms); }
  async flush() {
    if (this.busy) { this.schedule(300); return; }
    if (!this.pending.size) { this.set('saved'); return; }
    this.busy = true;
    let failed = false;
    for (const [key, job] of [...this.pending]) {
      try {
        const res = await fetch(job.url, { method: 'PUT', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(job.body) });
        if (res.ok || res.status === 400 || res.status === 403 || res.status === 404) {
          // done (or permanently rejected — never retry forever); keep a newer version if one arrived meanwhile
          if (this.pending.get(key)?.v === job.v) this.pending.delete(key);
          if (!res.ok) this.set('error');
        } else { failed = true; if (res.status === 401) window.dispatchEvent(new Event('p57:unauthorised')); }
      } catch { failed = true; }
    }
    writeLocal(this.pending); this.busy = false;
    if (failed) { this.tries++; this.set(navigator.onLine ? 'error' : 'offline'); this.schedule(Math.min(30_000, 1500 * 2 ** this.tries)); }
    else { this.tries = 0; if (this.pending.size) this.schedule(200); else if (this.state !== 'error') this.set('saved'); }
  }
  /** Last-chance send when the page goes away; localStorage still holds a copy if this fails. */
  beacon() {
    for (const job of this.pending.values()) {
      const body = JSON.stringify(job.body);
      try { void fetch(job.url, { method: 'PUT', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body, keepalive: body.length < 60_000 }); } catch { /* */ }
    }
  }
}

let inst: Autosave | null = null;
export const autosave = () => (inst ??= new Autosave());

/** Current save status for the UI. */
export function useSaveState(): SaveState {
  const [s, setS] = useState<SaveState>(() => autosave().state);
  const ref = useRef(setS); ref.current = setS;
  useEffect(() => { const a = autosave(); const f = (x: SaveState) => ref.current(x); a.listeners.add(f); return () => { a.listeners.delete(f); }; }, []);
  return s;
}

/** Pending (unsent) value for a key, used to overlay server data on load so nothing is lost. */
export const pendingBody = <T,>(key: string): T | undefined => autosave().pending.get(key)?.body as T | undefined;
