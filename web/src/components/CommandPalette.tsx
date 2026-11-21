import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import clsx from 'clsx';
import { FileText, Search, Sparkles, Plus, Moon, LayoutTemplate, Sigma, MessageSquare, CornerDownLeft, TrendingUp, BookMarked, Database, Settings, type LucideIcon } from 'lucide-react';
import type { Conversation, DomainMeta } from '../lib/types';
import { TEMPLATES } from '../lib/templates';
import { useCatalog } from '../lib/catalog';
import { domainIcon } from '../lib/domainIcons';
import { useDrill } from '../lib/drill';

interface Item { id: string; group: string; label: string; hint?: string; icon: LucideIcon; run: () => void }

export function CommandPalette({ open, setOpen, domains, convs, toggleTheme }: { open: boolean; setOpen: (b: boolean) => void; domains: DomainMeta[]; convs: Conversation[]; toggleTheme: () => void }) {
  const [q, setQ] = useState('');
  const [sel, setSel] = useState(0);
  const navigate = useNavigate();
  const catalog = useCatalog();
  const drill = useDrill();
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const h = (e: KeyboardEvent) => { if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); setOpen(!open); } };
    window.addEventListener('keydown', h); return () => window.removeEventListener('keydown', h);
  }, [open, setOpen]);
  useEffect(() => { if (open) { setQ(''); setSel(0); setTimeout(() => inputRef.current?.focus(), 10); } }, [open]);

  const items = useMemo<Item[]>(() => {
    const go = (to: string, state?: unknown) => () => { setOpen(false); navigate(to, state ? { state } : undefined); };
    const ask = (text: string) => go('/', { q: text, n: Date.now() });
    const now = new Date();
    const lmStart = new Date(Date.UTC(now.getFullYear(), now.getMonth() - 1, 1)).toISOString().slice(0, 10);
    const lmEnd = new Date(Date.UTC(now.getFullYear(), now.getMonth(), 0)).toISOString().slice(0, 10);
    const base: Item[] = [
      { id: 'new', group: 'Actions', label: 'New analysis', icon: Plus, run: go('/') },
      { id: 'theme', group: 'Actions', label: 'Toggle dark mode', icon: Moon, run: () => { toggleTheme(); setOpen(false); } },
      ...domains.map((d) => ({ id: `w-${d.id}`, group: 'Expert workspaces', label: d.label, hint: d.blurb, icon: domainIcon(d.icon), run: go(`/w/${d.id}`) })),
      { id: 'p-rep2', group: 'Pages', label: 'Executive report', icon: FileText, run: go('/report') },
      { id: 'p-ins', group: 'Pages', label: 'Forecasts & insights', icon: TrendingUp, run: go('/insights') },
      { id: 'p-tpl', group: 'Pages', label: 'Templates', icon: LayoutTemplate, run: go('/templates') },
      { id: 'p-rep', group: 'Pages', label: 'Saved reports', icon: BookMarked, run: go('/reports') },
      { id: 'p-data', group: 'Pages', label: 'Data sources', icon: Database, run: go('/data') },
      { id: 'p-met', group: 'Pages', label: 'Metrics & definitions', icon: Sigma, run: go('/metrics') },
      { id: 'p-set', group: 'Pages', label: 'Settings', icon: Settings, run: go('/settings') },
      ...TEMPLATES.map((t) => ({ id: `t-${t.title}`, group: 'Templates', label: t.title, hint: t.prompt, icon: LayoutTemplate, run: ask(t.prompt.replace(/\{period\}/g, 'the last 3 complete months').replace(/\{location\}/g, 'all locations')) })),
      ...(catalog?.metrics ?? []).map((m) => ({ id: `m-${m.id}`, group: 'Metrics — open last month\'s records', label: m.label, hint: m.description, icon: Sigma,
        run: () => { setOpen(false); drill?.({ metric: m.id, filters: [], start: lmStart, end: lmEnd, context: ['Last complete month'] }); } })),
      ...convs.slice(0, 40).map((c) => ({ id: `c-${c.id}`, group: 'Recent analyses', label: c.title, icon: MessageSquare, run: go(`/c/${c.id}`) })),
    ];
    const terms = q.toLowerCase().split(/\s+/).filter(Boolean);
    const score = (it: Item) => { const s = `${it.label} ${it.group} ${it.hint ?? ''}`.toLowerCase(); return terms.every((t) => s.includes(t)) ? (it.label.toLowerCase().startsWith(terms[0] ?? '') ? 2 : 1) : 0; };
    const hits = terms.length ? base.map((it) => [it, score(it)] as const).filter(([, s]) => s > 0).sort((a, b) => b[1] - a[1]).map(([it]) => it).slice(0, 40) : base.filter((it) => !['Templates', 'Metrics — open last month\'s records'].includes(it.group)).slice(0, 30);
    return q.trim() ? [{ id: 'ask', group: 'Ask the AI analyst', label: q.trim(), icon: Sparkles, run: ask(q.trim()) }, ...hits] : hits;
  }, [q, domains, convs, catalog, navigate, setOpen, toggleTheme, drill]);

  useEffect(() => { setSel(0); }, [q]);
  useEffect(() => { listRef.current?.querySelector(`[data-i="${sel}"]`)?.scrollIntoView({ block: 'nearest' }); }, [sel]);
  if (!open) return null;
  const groups = [...new Set(items.map((i) => i.group))];
  let idx = -1;
  return createPortal(
    <div className="fixed inset-0 z-[60] flex items-start justify-center bg-black/35 px-4 pt-[12vh] backdrop-blur-[3px]" onClick={() => setOpen(false)}>
      <div className="pop-in ring-gradient w-full max-w-[640px] overflow-hidden rounded-2xl bg-surface shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-3 border-b border-line px-4">
          <Search size={17} className="text-ink-3" />
          <input ref={inputRef} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search workspaces, metrics, templates — or ask anything…"
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown') { e.preventDefault(); setSel((s) => Math.min(items.length - 1, s + 1)); }
              if (e.key === 'ArrowUp') { e.preventDefault(); setSel((s) => Math.max(0, s - 1)); }
              if (e.key === 'Enter') items[sel]?.run();
              if (e.key === 'Escape') setOpen(false);
            }}
            className="h-14 flex-1 bg-transparent text-[15px] outline-none placeholder:text-ink-3" />
          <kbd>esc</kbd>
        </div>
        <div ref={listRef} className="max-h-[56vh] overflow-y-auto p-2">
          {groups.map((g) => (
            <div key={g} className="mb-1">
              <div className="px-2.5 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-[0.08em] text-ink-3">{g}</div>
              {items.filter((i) => i.group === g).map((it) => {
                idx++;
                const i = idx;
                return (
                  <button key={it.id} data-i={i} onMouseEnter={() => setSel(i)} onClick={it.run} className={clsx('flex w-full items-center gap-3 rounded-xl px-2.5 py-2 text-left', sel === i ? 'bg-accent-soft' : '')}>
                    <span className={clsx('flex h-7 w-7 shrink-0 items-center justify-center rounded-lg', sel === i ? 'bg-accent text-white' : 'bg-surface-2 text-ink-3')}><it.icon size={14} /></span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm">{it.label}</span>
                      {it.hint && <span className="block truncate text-[11px] text-ink-3">{it.hint}</span>}
                    </span>
                    {sel === i && <CornerDownLeft size={14} className="text-accent" />}
                  </button>
                );
              })}
            </div>
          ))}
          {!items.length && <div className="px-3 py-8 text-center text-sm text-ink-3">No matches.</div>}
        </div>
        <div className="flex items-center gap-3 border-t border-line px-4 py-2 text-[11px] text-ink-3"><kbd>↑</kbd><kbd>↓</kbd> navigate <kbd>↵</kbd> open <span className="ml-auto">Type a question and press ↵ to ask the analyst</span></div>
      </div>
    </div>,
    document.body,
  );
}
