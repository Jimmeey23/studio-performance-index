import { useState } from 'react';
import { api } from '../lib/api';
import { Logo } from '../components/Animated';

export default function Login({ onLogin }: { onLogin: () => void }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault(); setBusy(true); setError('');
    try { await api('/api/auth/login', { method: 'POST', json: { email, password } }); onLogin(); } catch (err) { setError((err as Error).message); } finally { setBusy(false); }
  };
  return (
    <div className="hero-glow flex h-full items-center justify-center p-6">
      <form onSubmit={submit} className="w-full max-w-sm rounded-2xl border border-line bg-surface p-8 shadow-sm fade-up">
        <div className="mb-6 flex items-center gap-3">
          <Logo size={42} />
          <div><div className="font-semibold">Physique 57 India</div><div className="text-xs text-ink-3">Business Intelligence</div></div>
        </div>
        <label className="block text-xs font-medium text-ink-2">Email</label>
        <input value={email} onChange={(e) => setEmail(e.target.value)} type="email" autoFocus className="mt-1 h-10 w-full rounded-lg border border-line bg-bg px-3 text-sm outline-none focus:border-accent" />
        <label className="mt-4 block text-xs font-medium text-ink-2">Password</label>
        <input value={password} onChange={(e) => setPassword(e.target.value)} type="password" className="mt-1 h-10 w-full rounded-lg border border-line bg-bg px-3 text-sm outline-none focus:border-accent" />
        {error && <div className="mt-3 text-sm text-bad">{error}</div>}
        <button disabled={busy} className="mt-6 h-10 w-full rounded-lg bg-ink text-sm font-medium text-bg disabled:opacity-50">{busy ? 'Signing in…' : 'Sign in'}</button>
      </form>
    </div>
  );
}
