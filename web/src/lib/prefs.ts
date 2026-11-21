/** Per-user preferences and drafts, persisted in the backend database (user_prefs) — survive reloads, browsers and devices. */
import { useEffect, useRef, useState } from 'react';
import { api } from './api';

let cache: Promise<Record<string, unknown>> | null = null;
const load = () => (cache ??= api<Record<string, unknown>>('/api/prefs').catch(() => ({} as Record<string, unknown>)));
const timers = new Map<string, ReturnType<typeof setTimeout>>();
export function savePref(key: string, value: unknown) {
  load().then((c) => { c[key] = value; });
  clearTimeout(timers.get(key));
  timers.set(key, setTimeout(() => { api(`/api/prefs/${encodeURIComponent(key)}`, { method: 'PUT', json: { value } }).catch(() => {}); }, 600));
}
/** useState that loads from and saves to the user's stored preferences. `ready` is false until the stored value has loaded. */
export function usePref<T>(key: string, initial: T): [T, (v: T | ((x: T) => T)) => void, boolean] {
  const [v, setV] = useState<T>(initial);
  const [ready, setReady] = useState(false);
  const loaded = useRef(false);
  useEffect(() => { load().then((c) => { if (c[key] !== undefined) setV({ ...(typeof initial === 'object' && !Array.isArray(initial) ? initial : {}), ...(c[key] as object) } as T); loaded.current = true; setReady(true); }); }, [key]); // eslint-disable-line react-hooks/exhaustive-deps
  const set = (x: T | ((p: T) => T)) => setV((p) => { const n = typeof x === 'function' ? (x as (p: T) => T)(p) : x; if (loaded.current) savePref(key, n); return n; });
  return [v, set, ready];
}
