import { useEffect, useState } from 'react';
import { CloudDownload, Hammer, Upload, Save, UserPlus } from 'lucide-react';
import { api } from '../lib/api';
import { useMe } from '../App';
import { Button, Card, PageHeader } from '../components/ui';
import { BrandKnowledge } from '../components/BrandKnowledge';

export default function Settings() {
  const me = useMe();
  const admin = me?.role === 'admin';
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState('');
  const [rules, setRules] = useState('');
  const [targets, setTargets] = useState<{ month: string; location: string; metric: string; target: number }[]>([]);
  const [users, setUsers] = useState<{ id: string; email: string; name: string; role: string }[]>([]);
  useEffect(() => {
    api('/api/rules').then((r) => setRules(JSON.stringify(r, null, 2)));
    api<typeof targets>('/api/targets').then(setTargets);
    if (admin) api<typeof users>('/api/users').then(setUsers);
  }, [admin]);
  const run = async (label: string, fn: () => Promise<unknown>) => {
    setBusy(label); setMsg('');
    try { const r = await fn() as { status?: string; quality?: { errors: number; warnings: number }; note?: string; saved?: number }; setMsg(r?.status ? `${label}: ${r.status}${r.quality ? ` · ${r.quality.errors} errors, ${r.quality.warnings} warnings in data health` : ''}` : r?.note ?? (r?.saved !== undefined ? `Saved ${r.saved} target rows.` : `${label} done.`)); }
    catch (e) { setMsg(`${label} failed: ${(e as Error).message}`); } finally { setBusy(''); }
  };
  const upload = async (files: FileList | null) => {
    if (!files?.length) return;
    const fd = new FormData();
    [...files].forEach((f) => fd.append('files', f));
    await run('Upload', () => api('/api/sync/upload', { method: 'POST', body: fd }));
  };
  const uploadTargets = async (file?: File) => {
    if (!file) return;
    const text = await file.text();
    const [head, ...lines] = text.trim().split(/\r?\n/);
    const h = head.toLowerCase().split(',').map((x) => x.trim());
    const rows = lines.map((l) => { const c = l.split(','); return { month: c[h.indexOf('month')]?.trim(), location: c[h.indexOf('location')]?.trim() || 'All', metric: c[h.indexOf('metric')]?.trim(), target: Number(c[h.indexOf('target')]) }; });
    await run('Targets', () => api('/api/targets', { method: 'POST', json: { rows } }));
    setTargets(await api('/api/targets'));
  };
  return (
    <div className="space-y-5">
      <PageHeader title="Settings" subtitle={`AI model: ${me?.model} · ${me?.aiConfigured ? 'configured' : 'not configured (add ANTHROPIC_API_KEY)'}`} />
      {msg && <div className="rounded-xl border border-line bg-surface p-3 text-sm">{msg}</div>}

      <Card className="p-5">
        <div className="font-semibold">Data refresh</div>
        <p className="mt-1 text-sm text-ink-3">Google sync reads the 7 sheets with the service account; unchanged sheets and tabs are skipped and only affected models are rebuilt. Uploading .xlsx exports works without Google access.</p>
        <div className="mt-4 flex flex-wrap gap-2">
          <Button variant="primary" disabled={!admin || !!busy} onClick={() => run('Sync', () => api('/api/sync', { method: 'POST', json: {} }))}><CloudDownload size={14} />{busy === 'Sync' ? 'Syncing…' : 'Sync from Google Sheets'}</Button>
          <Button variant="outline" disabled={!admin || !!busy} onClick={() => run('Full sync', () => api('/api/sync', { method: 'POST', json: { force: true } }))}>Force full sync</Button>
          <label className={`inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-lg border border-line px-3 text-sm text-ink-2 hover:bg-surface-2 ${!admin || busy ? 'pointer-events-none opacity-50' : ''}`}>
            <Upload size={14} />{busy === 'Upload' ? 'Loading…' : 'Upload .xlsx exports'}<input type="file" accept=".xlsx" multiple className="hidden" onChange={(e) => upload(e.target.files)} />
          </label>
          <Button variant="outline" disabled={!admin || !!busy} onClick={() => run('Rebuild', () => api('/api/rebuild', { method: 'POST' }))}><Hammer size={14} />Rebuild models</Button>
        </div>
      </Card>

      <BrandKnowledge admin={admin} />

      <Card className="p-5">
        <div className="font-semibold">Targets</div>
        <p className="mt-1 text-sm text-ink-3">Upload a CSV with columns <code className="font-mono text-xs">month,location,metric,target</code> (e.g. <code className="font-mono text-xs">2026-12,Supreme HQ, Bandra,revenue,5500000</code> — quote locations containing commas, or use “All”). Metric ids are listed under Metrics & definitions.</p>
        <label className={`mt-3 inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-lg border border-line px-3 text-sm text-ink-2 hover:bg-surface-2 ${!admin ? 'pointer-events-none opacity-50' : ''}`}><Upload size={14} />Upload targets CSV<input type="file" accept=".csv" className="hidden" onChange={(e) => uploadTargets(e.target.files?.[0])} /></label>
        <div className="mt-3 text-sm text-ink-2">{targets.length ? `${targets.length} target rows loaded (latest month ${targets[0]?.month?.slice(0, 7)}).` : 'No targets loaded.'}</div>
      </Card>

      <Card className="p-5">
        <div className="flex items-center justify-between">
          <div><div className="font-semibold">Business rules</div><p className="mt-1 text-sm text-ink-3">Location mapping, revenue basis, status vocabularies, renewal and win-back windows. Save, then rebuild models.</p></div>
          <Button variant="outline" disabled={!admin} onClick={() => run('Rules', async () => { const r = await api('/api/rules', { method: 'PUT', json: JSON.parse(rules) }); return r; })}><Save size={14} />Save rules</Button>
        </div>
        <textarea value={rules} onChange={(e) => setRules(e.target.value)} spellCheck={false} readOnly={!admin} className="mt-3 h-96 w-full rounded-xl border border-line bg-bg p-3 font-mono text-xs outline-none focus:border-accent" />
      </Card>

      {admin && (
        <Card className="p-5">
          <div className="font-semibold">Users</div>
          <div className="mt-3 divide-y divide-line text-sm">{users.map((u) => <div key={u.id} className="flex justify-between py-2"><span>{u.name} <span className="text-ink-3">{u.email}</span></span><span className="text-ink-3">{u.role}</span></div>)}</div>
          <AddUser onAdded={() => api<typeof users>('/api/users').then(setUsers)} />
        </Card>
      )}
    </div>
  );
}

function AddUser({ onAdded }: { onAdded: () => void }) {
  const [f, setF] = useState({ name: '', email: '', password: '', role: 'analyst' });
  const [err, setErr] = useState('');
  return (
    <form className="mt-4 flex flex-wrap gap-2" onSubmit={async (e) => { e.preventDefault(); setErr(''); try { await api('/api/users', { method: 'POST', json: f }); setF({ name: '', email: '', password: '', role: 'analyst' }); onAdded(); } catch (x) { setErr((x as Error).message); } }}>
      {(['name', 'email', 'password'] as const).map((k) => <input key={k} type={k === 'password' ? 'password' : 'text'} placeholder={k} value={f[k]} onChange={(e) => setF({ ...f, [k]: e.target.value })} className="h-8 rounded-lg border border-line bg-bg px-2 text-sm outline-none focus:border-accent" />)}
      <select value={f.role} onChange={(e) => setF({ ...f, role: e.target.value })} className="h-8 rounded-lg border border-line bg-bg px-2 text-sm"><option>analyst</option><option>viewer</option><option>admin</option></select>
      <Button variant="outline" type="submit"><UserPlus size={14} />Add user</Button>
      {err && <span className="text-sm text-bad">{err}</span>}
    </form>
  );
}
