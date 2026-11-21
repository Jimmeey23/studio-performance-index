import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { BrowserRouter, NavLink, Route, Routes, useNavigate, useParams } from 'react-router-dom';
import clsx from 'clsx';
import { FileText, BookMarked, Database, LogOut, Moon, Plus, Settings as SettingsIcon, Sigma, Sun, TrendingUp, Pin, Trash2, MessageSquare, PanelLeftClose, PanelLeftOpen, LayoutTemplate, ChevronDown, Search, Layers, PenTool, ShieldCheck, Gauge } from 'lucide-react';
import { api } from './lib/api';
import type { Conversation, Me, DomainMeta } from './lib/types';
import Domain from './pages/Domain';
import Templates from './pages/Templates';
import { Logo } from './components/Animated';
import { domainIcon } from './lib/domainIcons';
import { CatalogProvider } from './lib/catalog';
import Analyst from './pages/Analyst';
import Login from './pages/Login';
import DataSources from './pages/DataSources';
import Metrics from './pages/Metrics';
import Reports from './pages/Reports';
import Insights from './pages/Insights';
import Settings from './pages/Settings';
import Report from './pages/Report';
import CustomReports from './pages/CustomReports';
import Designer from './pages/Designer';
import Admin from './pages/Admin';
import Review from './pages/Review';
import { loadAppConfig, useAppConfig, applyNav } from './lib/appConfig';
import { DrillProvider } from './lib/drill';
import { DrillDrawer } from './components/DrillDrawer';
import { CommandPalette } from './components/CommandPalette';

const MeCtx = createContext<Me | null>(null);
export const useMe = () => useContext(MeCtx);

export default function App() {
  const [me, setMe] = useState<Me | null | undefined>(undefined);
  const load = useCallback(() => api<Me>('/api/me').then(async (m) => { await loadAppConfig(); setMe(m); }).catch(() => setMe(null)), []);
  useEffect(() => { load(); const h = () => setMe(null); window.addEventListener('p57:unauthorised', h); return () => window.removeEventListener('p57:unauthorised', h); }, [load]);
  if (me === undefined) return <div className="flex h-full items-center justify-center"><div className="h-6 w-6 animate-spin rounded-full border-2 border-line border-t-accent" /></div>;
  if (me === null) return <Login onLogin={load} />;
  return (
    <MeCtx.Provider value={me}>
      <CatalogProvider>
        <BrowserRouter><DrillProvider render={(req, close, ask) => <DrillDrawer req={req} onClose={close} ask={ask} />}><Shell /></DrillProvider></BrowserRouter>
      </CatalogProvider>
    </MeCtx.Provider>
  );
}

function Shell() {
  const [convs, setConvs] = useState<Conversation[]>([]);
  // Phones start with the rail collapsed so pages get the full width; crossing the breakpoint re-applies it.
  const [collapsed, setCollapsed] = useState(() => window.matchMedia('(max-width: 767px)').matches);
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 767px)');
    const on = (e: MediaQueryListEvent) => setCollapsed(e.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);
  const refresh = useCallback(() => { api<Conversation[]>('/api/conversations').then(setConvs).catch(() => {}); }, []);
  useEffect(() => { refresh(); }, [refresh]);
  return (
    <div className="flex h-full">
      <Sidebar convs={convs} refresh={refresh} collapsed={collapsed} setCollapsed={setCollapsed} />
      <main className="min-w-0 flex-1 overflow-hidden">
        <Routes>
          <Route path="/" element={<Analyst onConversationsChange={refresh} />} />
          <Route path="/c/:id" element={<Analyst onConversationsChange={refresh} />} />
          <Route path="/w/:domainId" element={<Domain onConversationsChange={refresh} />} />
          <Route path="/report" element={<Report />} />
          <Route path="/review" element={<Review />} />
          <Route path="/review/:reviewId" element={<Review />} />
          <Route path="/custom-reports" element={<CustomReports />} />
          <Route path="/designer" element={<Designer />} />
          <Route path="/designer/:id" element={<Designer />} />
          <Route path="/templates" element={<Page><Templates /></Page>} />
          <Route path="/insights" element={<Page><Insights /></Page>} />
          <Route path="/reports" element={<Page><Reports /></Page>} />
          <Route path="/reports/:id" element={<Page><Reports /></Page>} />
          <Route path="/data" element={<Page><DataSources /></Page>} />
          <Route path="/metrics" element={<Page><Metrics /></Page>} />
          <Route path="/settings" element={<Page><Settings /></Page>} />
          <Route path="/admin" element={<Admin />} />
        </Routes>
      </main>
    </div>
  );
}
const Page = ({ children }: { children: React.ReactNode }) => <div className="h-full overflow-y-auto"><div className="mx-auto max-w-[1240px] px-8 py-8">{children}</div></div>;

function Sidebar({ convs, refresh, collapsed, setCollapsed }: { convs: Conversation[]; refresh: () => void; collapsed: boolean; setCollapsed: (b: boolean) => void }) {
  const me = useMe();
  const navigate = useNavigate();
  const [domains, setDomains] = useState<DomainMeta[]>([]);
  const [histOpen, setHistOpen] = useState(true);
  const [q, setQ] = useState('');
  const [dark, setDark] = useState(document.documentElement.dataset.theme === 'dark');
  const [palette, setPalette] = useState(false);
  const toggleTheme = () => { const d = !dark; setDark(d); document.documentElement.dataset.theme = d ? 'dark' : 'light'; try { localStorage.setItem('theme', d ? 'dark' : 'light'); } catch { /* */ } };
  const cfg = useAppConfig();
  useEffect(() => { api<DomainMeta[]>('/api/domains').then(setDomains).catch(() => {}); }, [cfg]);
  const libraryAll = [
    { to: '/review', icon: Gauge, label: 'Performance review' },
    { to: '/report', icon: FileText, label: 'Executive report' },
    { to: '/custom-reports', icon: Layers, label: 'Custom reports' },
    { to: '/designer', icon: PenTool, label: 'Report designer' },
    { to: '/insights', icon: TrendingUp, label: 'Forecasts & insights' },
    { to: '/templates', icon: LayoutTemplate, label: 'Templates' },
    { to: '/reports', icon: BookMarked, label: 'Saved reports' },
  ];
  const dataAll = [
    { to: '/data', icon: Database, label: 'Data sources' },
    { to: '/metrics', icon: Sigma, label: 'Metrics & definitions' },
    { to: '/settings', icon: SettingsIcon, label: 'Settings' },
    ...(me?.role === 'admin' ? [{ to: '/admin', icon: ShieldCheck, label: 'Admin console' }] : []),
  ];
  const library = applyNav(libraryAll, cfg);
  const data = applyNav(dataAll, cfg).concat(me?.role === 'admin' && cfg.nav.hidden?.includes('/admin') ? [{ to: '/admin', icon: ShieldCheck, label: 'Admin console' }] : []);
  const link = ({ isActive }: { isActive: boolean }) => clsx('side-link', isActive && 'side-link-active active');
  const pal = <CommandPalette open={palette} setOpen={setPalette} domains={domains} convs={convs} toggleTheme={toggleTheme} />;
  const Section = ({ title }: { title: string }) => <div className="side-section">{title}</div>;
  const general = convs.filter((c) => !c.domain && (!q || c.title.toLowerCase().includes(q.toLowerCase())));
  if (collapsed) {
    return (
      <aside className="sidebar flex w-[64px] shrink-0 flex-col items-center gap-1 py-3">
        {pal}
        <NavLink to="/" title="Home" className="mb-2"><Logo size={34} /></NavLink>
        <button onClick={() => setCollapsed(false)} className="side-icon" title="Expand sidebar"><PanelLeftOpen size={17} /></button>
        <button onClick={() => setPalette(true)} className="side-icon" title="Search (⌘K)"><Search size={17} /></button>
        <button onClick={() => navigate('/')} className="side-icon" title="New analysis"><Plus size={18} /></button>
        <div className="my-1.5 h-px w-7 bg-white/10" />
        {domains.map((d) => { const I = domainIcon(d.icon); return <NavLink key={d.id} to={`/w/${d.id}`} title={d.label} className={({ isActive }) => clsx('side-icon', isActive && 'side-icon-active')}><I size={17} /></NavLink>; })}
        <div className="my-1.5 h-px w-7 bg-white/10" />
        {[...library, ...data].map((n) => <NavLink key={n.to} to={n.to} title={n.label} className={({ isActive }) => clsx('side-icon', isActive && 'side-icon-active')}><n.icon size={17} /></NavLink>)}
      </aside>
    );
  }
  return (
    <aside className="sidebar flex w-[272px] shrink-0 flex-col">
      {pal}
      <div className="flex items-center gap-2.5 px-4 pb-4 pt-5">
        <NavLink to="/" title="Back to home" className="flex min-w-0 flex-1 items-center gap-3 rounded-xl transition hover:opacity-90">
          <Logo size={36} />
          <div className="min-w-0 flex-1">
            <div className="font-display text-[15px] font-semibold leading-tight tracking-tight text-white">Physique 57</div>
            <div className="text-[11px] tracking-wide text-[var(--side-ink-2)]">India · Intelligence</div>
          </div>
        </NavLink>
        <button onClick={() => setCollapsed(true)} className="side-icon !h-7 !w-7" title="Collapse"><PanelLeftClose size={15} /></button>
      </div>
      <div className="space-y-2 px-3">
        <button onClick={() => navigate('/')} className="btn-brand flex h-10 w-full items-center gap-2 rounded-xl px-3.5 text-[13.5px] font-semibold text-white"><Plus size={16} />New analysis</button>
        <button onClick={() => setPalette(true)} className="side-search flex h-9 w-full items-center gap-2 rounded-xl px-3 text-[13px]">
          <Search size={14} />Search or ask…<span className="ml-auto rounded-md border border-white/10 px-1.5 py-px font-mono text-[10px]">⌘K</span>
        </button>
      </div>
      <div className="side-scroll min-h-0 flex-1 overflow-y-auto pb-3">
        <Section title="Expert workspaces" />
        <nav className="space-y-0.5 px-3">
          {domains.map((d) => { const I = domainIcon(d.icon); return (
            <NavLink key={d.id} to={`/w/${d.id}`} className={link} title={d.blurb}>
              <span className="side-tile"><I size={14} /></span>{d.label}
            </NavLink>
          ); })}
        </nav>
        <Section title="Library" />
        <nav className="space-y-0.5 px-3">{library.map((n) => <NavLink key={n.to} to={n.to} className={link}><span className="side-tile"><n.icon size={14} /></span>{n.label}</NavLink>)}</nav>
        <Section title="Data & admin" />
        <nav className="space-y-0.5 px-3">{data.map((n) => <NavLink key={n.to} to={n.to} className={link}><span className="side-tile"><n.icon size={14} /></span>{n.label}</NavLink>)}</nav>
        <button onClick={() => setHistOpen((o) => !o)} className="side-section flex w-full items-center gap-1 hover:!text-white">
          <ChevronDown size={12} className={clsx('transition-transform', !histOpen && '-rotate-90')} />History
        </button>
        {histOpen && (
          <div className="px-3">
            {convs.length > 6 && (
              <div className="relative mb-1.5"><Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--side-ink-2)]" /><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search history" className="side-search h-7 w-full rounded-lg pl-7 pr-2 text-xs outline-none" /></div>
            )}
            {general.length === 0 && <div className="px-2.5 py-2 text-xs text-[var(--side-ink-2)]">Your analyses will appear here.</div>}
            {general.map((c) => <ConvItem key={c.id} c={c} refresh={refresh} />)}
          </div>
        )}
      </div>
      <div className="flex items-center gap-2.5 border-t border-white/[0.07] px-4 py-3">
        <div className="flex h-8 w-8 items-center justify-center rounded-full bg-gradient-to-br from-[var(--accent)] to-[var(--accent-2)] text-xs font-semibold text-white">{me?.name?.[0] ?? '?'}</div>
        <div className="min-w-0 flex-1"><div className="truncate text-[13px] font-medium text-white">{me?.name}</div><div className="truncate text-[11px] capitalize text-[var(--side-ink-2)]">{me?.role}</div></div>
        <button onClick={toggleTheme} className="side-icon !h-8 !w-8" title="Toggle theme">{dark ? <Sun size={15} /> : <Moon size={15} />}</button>
        {!me?.authDisabled && <button onClick={async () => { await api('/api/auth/logout', { method: 'POST' }); location.reload(); }} className="side-icon !h-8 !w-8" title="Sign out"><LogOut size={15} /></button>}
      </div>
    </aside>
  );
}

function ConvItem({ c, refresh }: { c: Conversation; refresh: () => void }) {
  const { id } = useParams();
  const navigate = useNavigate();
  const active = location.pathname === `/c/${c.id}` || id === c.id;
  return (
    <div className={clsx('group flex items-center gap-1 rounded-lg pr-1 transition', active ? 'bg-white/[0.08]' : 'hover:bg-white/[0.05]')}>
      <button onClick={() => navigate(`/c/${c.id}`)} className={clsx('flex min-w-0 flex-1 items-center gap-2 px-2.5 py-1.5 text-left text-[12.5px]', active ? 'text-white' : 'text-[var(--side-ink)]')}>
        {c.pinned ? <Pin size={12} className="shrink-0 text-[var(--accent-2)]" /> : <MessageSquare size={12} className="shrink-0 text-[var(--side-ink-2)]" />}
        <span className="truncate">{c.title}</span>
      </button>
      <button onClick={async () => { await api(`/api/conversations/${c.id}`, { method: 'PATCH', json: { pinned: !c.pinned } }); refresh(); }} className="hidden rounded p-1 text-[var(--side-ink-2)] hover:text-white group-hover:block" title="Pin"><Pin size={12} /></button>
      <button onClick={async () => { if (!confirm('Delete this conversation?')) return; await api(`/api/conversations/${c.id}`, { method: 'DELETE' }); refresh(); if (active) navigate('/'); }} className="hidden rounded p-1 text-[var(--side-ink-2)] hover:text-[#ff8a8a] group-hover:block" title="Delete"><Trash2 size={12} /></button>
    </div>
  );
}
