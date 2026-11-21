import { useEffect, useState } from 'react';
import clsx from 'clsx';
import { Brain, RefreshCw, Save, Trash2, Plus } from 'lucide-react';
import { api } from '../lib/api';
import { Button, Card } from './ui';

type Note = { id: string; text: string; category: string; source: string; created_by: string; created_at: string };
const CATS = ['terminology', 'definition', 'target', 'preference', 'studio', 'trainer', 'product', 'policy', 'general'];

/** What the AI analyst knows about the brand: house knowledge (editable), facts learned from data, and notes it was taught. */
export function BrandKnowledge({ admin }: { admin: boolean }) {
  const [tab, setTab] = useState<'notes' | 'house' | 'learned'>('notes');
  const [house, setHouse] = useState('');
  const [learned, setLearned] = useState('');
  const [notes, setNotes] = useState<Note[]>([]);
  const [text, setText] = useState('');
  const [cat, setCat] = useState('general');
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);
  const load = () => api<{ house: string; learned: string; notes: Note[] }>('/api/knowledge').then((k) => { setHouse(k.house); setLearned(k.learned); setNotes(k.notes); }).catch((e) => setMsg((e as Error).message));
  useEffect(() => { load(); }, []);
  const act = async (fn: () => Promise<unknown>, ok: string) => { setBusy(true); setMsg(''); try { await fn(); setMsg(ok); await load(); } catch (e) { setMsg((e as Error).message); } setBusy(false); };
  return (
    <Card className="p-5">
      <div className="flex items-center gap-2 font-semibold"><Brain size={15} className="text-accent" />Brand knowledge</div>
      <p className="mt-1 text-sm text-ink-3">What the AI analyst knows about Physique 57 India before it runs a query: the brand, method, studios, formats, rates and policies; facts it learns from your data after every sync (studios, trainers, class mix, product ladder, lead channels, benchmarks, seasonality); and notes the team teaches it. Ask it to "remember" something in chat, or add a note here.</p>
      <div className="seg mt-3">{([['notes', `Taught notes (${notes.length})`], ['house', 'House knowledge'], ['learned', 'Learned from data']] as const).map(([v, l]) => <button key={v} onClick={() => setTab(v)} className={clsx('h-7 px-3 text-xs', tab === v && 'on')}>{l}</button>)}</div>
      {msg && <div className="mt-3 text-xs text-ink-2">{msg}</div>}
      {tab === 'notes' && (
        <div className="mt-3 space-y-3">
          <div className="flex flex-wrap gap-2">
            <input value={text} onChange={(e) => setText(e.target.value)} placeholder='e.g. "We call Supreme HQ, Bandra SHQ" or "Always exclude hosted classes from conversion"' className="field min-w-[320px] flex-1" />
            <select value={cat} onChange={(e) => setCat(e.target.value)} className="field w-36">{CATS.map((c) => <option key={c}>{c}</option>)}</select>
            <Button variant="primary" disabled={busy || text.trim().length < 4} onClick={() => act(async () => { await api('/api/knowledge/notes', { method: 'POST', json: { text, category: cat } }); setText(''); }, 'Note saved.')}><Plus size={14} />Add note</Button>
          </div>
          {!notes.length && <div className="text-sm text-ink-3">No notes yet.</div>}
          <ul className="divide-y divide-line/70">{notes.map((n) => (
            <li key={n.id} className="flex items-start gap-3 py-2 text-sm">
              <span className="chip !h-5 shrink-0 text-[10.5px]">{n.category}</span>
              <span className="flex-1">{n.text}<span className="block text-[11px] text-ink-3">{n.source === 'assistant' ? 'learned in chat' : `added by ${n.created_by}`} · {n.created_at.slice(0, 16)}</span></span>
              <button onClick={() => act(() => api(`/api/knowledge/notes/${n.id}`, { method: 'DELETE' }), 'Note removed.')} className="tool !h-7 !min-w-7 !px-1.5 hover:!text-bad" title="Forget"><Trash2 size={13} /></button>
            </li>
          ))}</ul>
        </div>
      )}
      {tab === 'house' && (
        <div className="mt-3 space-y-2">
          <textarea value={house} onChange={(e) => setHouse(e.target.value)} readOnly={!admin} spellCheck={false} className="h-[420px] w-full rounded-xl border border-line bg-surface-2 p-3 font-mono text-xs leading-relaxed text-ink outline-none" />
          {admin && <Button variant="primary" disabled={busy} onClick={() => act(() => api('/api/knowledge/house', { method: 'PUT', json: { markdown: house } }), 'House knowledge saved — used from the next question.')}><Save size={14} />Save house knowledge</Button>}
        </div>
      )}
      {tab === 'learned' && (
        <div className="mt-3 space-y-2">
          <pre className="max-h-[420px] overflow-auto whitespace-pre-wrap rounded-xl border border-line bg-surface-2 p-3 text-xs leading-relaxed text-ink-2">{learned || 'Not built yet.'}</pre>
          {admin && <Button variant="outline" disabled={busy} onClick={() => act(() => api('/api/knowledge/rebuild', { method: 'POST' }), 'Relearned from the latest data.')}><RefreshCw size={14} className={busy ? 'animate-spin' : ''} />Relearn from data now</Button>}
        </div>
      )}
    </Card>
  );
}
