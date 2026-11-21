import { useEffect, useMemo, useState } from 'react';
import clsx from 'clsx';
import { ArrowDownWideNarrow, ArrowUpNarrowWide, Columns3, ListOrdered, RotateCcw, Search, SlidersHorizontal } from 'lucide-react';
import { api } from '../lib/api';
import type { Block, Result } from '../lib/types';
import { BlockView } from './blocks/Blocks';
import { usePref } from '../lib/prefs';

interface Options { groupings: { id: string; label: string }[]; criteria: { id: string; label: string; lowerBetter: boolean }[]; metrics: { key: string; label: string }[]; formats: string[]; days: string[] }
interface Q { grouping: string; rankBy: string; dir: 'desc' | 'asc'; minClasses: number; minAvg: number; minCheckins: number; hosted: 'exclude' | 'include' | 'only'; excludeEmpty: boolean; formats: string[]; days: string[]; ampm: 'all' | 'AM' | 'PM'; search: string; limit: number }
const DEFAULT: Q = { grouping: 'class-day-time-location', rankBy: 'score', dir: 'desc', minClasses: 3, minAvg: 0, minCheckins: 0, hosted: 'exclude', excludeEmpty: false, formats: [], days: [], ampm: 'all', search: '', limit: 200 };
const KEY_METRICS = ['score', 'classes', 'checkins', 'class_avg', 'fill', 'booking_fill', 'show_up', 'empty_rate', 'revenue', 'rev_class', 'rev_attendee', 'late_rate', 'sold_out', 'consistency'];
const SETS: Record<string, string[]> = {
  Key: KEY_METRICS,
  Attendance: ['score', 'classes', 'checkins', 'class_avg', 'class_avg_all', 'peak', 'consistency', 'empty', 'empty_rate', 'trainers'],
  Capacity: ['score', 'classes', 'capacity', 'avg_capacity', 'fill', 'booked', 'booking_fill', 'show_up', 'sold_out', 'high_fill', 'low_fill', 'unsold'],
  Revenue: ['score', 'classes', 'checkins', 'revenue', 'rev_class', 'rev_attendee', 'rev_seat', 'non_paid', 'comp', 'member_share', 'intro_share'],
  Cancellations: ['score', 'classes', 'booked', 'late_cancels', 'late_rate', 'show_up', 'checkins'],
};

/** Rank classes by any grouping and criterion, with volume filters — the class explorer on the Class performance page. */
export function ClassExplorer({ start, end, locations }: { start: string; end: string; locations: string[] }) {
  const [opt, setOpt] = useState<Options | null>(null);
  const [q, setQ] = usePref<Q>('classExplorer.query', DEFAULT);
  const [shownP, setShownP] = usePref<{ cols: string[] }>('classExplorer.columns', { cols: KEY_METRICS });
  const shown = shownP.cols; const setShown = (x: string[] | ((p: string[]) => string[])) => setShownP((p) => ({ cols: typeof x === 'function' ? x(p.cols) : x }));
  const [res, setRes] = useState<{ result: Result; totalGroups: number; matched: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [pickCols, setPickCols] = useState(false);
  useEffect(() => { api<Options>('/api/classes/explore/options').then(setOpt).catch((e) => setErr((e as Error).message)); }, []);
  const key = JSON.stringify([start, end, locations, q]);
  useEffect(() => {
    const t = setTimeout(async () => {
      setBusy(true); setErr('');
      try { setRes(await api('/api/classes/explore', { method: 'POST', json: { start, end, locations, ...q } })); } catch (e) { setErr((e as Error).message); }
      setBusy(false);
    }, q.search ? 350 : 120);
    return () => clearTimeout(t);
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps
  const set = <K extends keyof Q>(k: K, v: Q[K]) => setQ((x) => ({ ...x, [k]: v }));
  const toggle = (k: 'formats' | 'days', v: string) => setQ((x) => ({ ...x, [k]: x[k].includes(v) ? x[k].filter((y) => y !== v) : [...x[k], v] }));
  const crit = opt?.criteria.find((c) => c.id === q.rankBy);
  const block: Block | null = useMemo(() => {
    if (!res) return null;
    const r = res.result;
    const keep = new Set([...shown, q.rankBy === 'score' ? 'score' : q.rankBy]);
    const columns = r.columns.filter((c) => c.kind === 'dimension' || c.key === 'rank' || keep.has(c.key)).filter((c) => !['first', 'last'].includes(c.key) || keep.has(c.key));
    return { id: 'class-explorer', type: 'table', title: r.title, result: { ...r, columns }, view: 'table' } as Block;
  }, [res, shown, q.rankBy]);

  const num = (k: 'minClasses' | 'minAvg' | 'minCheckins', label: string, step = 1) => (
    <label className="flex flex-col gap-1 text-[11px] font-medium uppercase tracking-wide text-ink-3">{label}
      <input type="number" min={0} step={step} value={q[k]} onChange={(e) => set(k, Math.max(0, Number(e.target.value) || 0))} className="field w-24 normal-case tracking-normal" />
    </label>
  );
  const seg = <T extends string>(value: T, opts: [T, string][], on: (v: T) => void) => (
    <div className="seg">{opts.map(([v, l]) => <button key={v} onClick={() => on(v)} className={clsx('h-7 px-2.5 text-xs', value === v && 'on')}>{l}</button>)}</div>
  );
  const chip = (on: boolean, label: string, fn: () => void) => <button key={label} onClick={fn} className={clsx('rounded-full border px-2.5 py-0.5 text-xs transition', on ? 'border-accent bg-accent-soft text-accent' : 'border-line text-ink-2 hover:border-accent/50')}>{label}</button>;

  return (
    <section className="space-y-3 pt-2">
      <div className="section-title"><span className="dot" />Class explorer<span className="text-[11px] font-medium text-ink-3">rank any grouping on any criterion</span></div>
      <div className="panel space-y-4 p-5">
        <div className="flex flex-wrap items-end gap-3">
          <label className="flex min-w-[260px] flex-1 flex-col gap-1 text-[11px] font-medium uppercase tracking-wide text-ink-3">Group by
            <select value={q.grouping} onChange={(e) => set('grouping', e.target.value)} className="field normal-case tracking-normal">
              {opt?.groupings.map((g) => <option key={g.id} value={g.id}>{g.label}</option>)}
            </select>
          </label>
          <label className="flex min-w-[220px] flex-col gap-1 text-[11px] font-medium uppercase tracking-wide text-ink-3"><span className="inline-flex items-center gap-1"><ListOrdered size={11} />Rank by</span>
            <select value={q.rankBy} onChange={(e) => { const c = opt?.criteria.find((x) => x.id === e.target.value); setQ((x) => ({ ...x, rankBy: e.target.value, dir: c?.lowerBetter ? 'asc' : 'desc' })); }} className="field normal-case tracking-normal">
              {opt?.criteria.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
            </select>
          </label>
          <button onClick={() => set('dir', q.dir === 'desc' ? 'asc' : 'desc')} className="tool !h-8 gap-1.5 px-2.5 text-xs" title="Sort direction">
            {q.dir === 'desc' ? <ArrowDownWideNarrow size={14} /> : <ArrowUpNarrowWide size={14} />}{q.dir === 'desc' ? 'High → low' : 'Low → high'}
          </button>
          {num('minClasses', 'Min classes')}
          {num('minAvg', 'Min avg attendance', 0.5)}
          {num('minCheckins', 'Min check-ins')}
        </div>
        <div className="flex flex-wrap items-center gap-x-5 gap-y-3 text-xs">
          <div className="flex items-center gap-2"><span className="text-ink-3">Hosted classes</span>{seg(q.hosted, [['exclude', 'Exclude'], ['include', 'Include'], ['only', 'Only']], (v) => set('hosted', v))}</div>
          <div className="flex items-center gap-2"><span className="text-ink-3">Time</span>{seg(q.ampm, [['all', 'All'], ['AM', 'AM'], ['PM', 'PM']], (v) => set('ampm', v))}</div>
          <label className="inline-flex items-center gap-1.5 text-ink-2"><input type="checkbox" checked={q.excludeEmpty} onChange={(e) => set('excludeEmpty', e.target.checked)} className="accent-[var(--accent)]" />Leave out empty classes</label>
          <label className="flex items-center gap-1.5 text-ink-3">Show
            <select value={q.limit} onChange={(e) => set('limit', Number(e.target.value))} className="field !h-7 w-20">{[25, 50, 100, 200, 500, 1000].map((n) => <option key={n} value={n}>{n}</option>)}</select>
          </label>
          <div className="relative ml-auto"><Search size={13} className="absolute left-2.5 top-2 text-ink-3" /><input value={q.search} onChange={(e) => set('search', e.target.value)} placeholder="Class, trainer or studio…" className="field !h-8 w-56 pl-7" /></div>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <span className="text-ink-3">Format</span>{opt?.formats.map((f) => chip(q.formats.includes(f), f, () => toggle('formats', f)))}
          <span className="ml-3 text-ink-3">Days</span>{opt?.days.map((d) => chip(q.days.includes(d), d.slice(0, 3), () => toggle('days', d)))}
        </div>
        <div className="flex flex-wrap items-center gap-2 border-t border-line/70 pt-3 text-xs">
          <span className="inline-flex items-center gap-1 text-ink-3"><Columns3 size={12} />Metrics</span>
          {Object.entries(SETS).map(([n, ks]) => chip(JSON.stringify(shown) === JSON.stringify(ks), n, () => setShown(ks)))}
          {chip(shown.length === (opt?.metrics.length ?? 0) + 1, `All (${(opt?.metrics.length ?? 0) + 1})`, () => setShown(['score', ...(opt?.metrics.map((m) => m.key) ?? [])]))}
          <button onClick={() => setPickCols((x) => !x)} className="inline-flex items-center gap-1 text-accent"><SlidersHorizontal size={12} />Choose…</button>
          <button onClick={() => { setQ(DEFAULT); setShown(KEY_METRICS); }} className="ml-auto inline-flex items-center gap-1 text-ink-3 hover:text-ink"><RotateCcw size={12} />Reset</button>
        </div>
        {pickCols && opt && (
          <div className="flex flex-wrap gap-1.5 rounded-xl bg-surface-2 p-3">
            {[{ key: 'score', label: 'Class score' }, ...opt.metrics].map((m) => chip(shown.includes(m.key), m.label, () => setShown((s) => (s.includes(m.key) ? s.filter((x) => x !== m.key) : [...s, m.key]))))}
          </div>
        )}
        <div className="flex flex-wrap items-center gap-2 text-[11.5px] text-ink-3">
          {busy && <span className="h-3 w-3 animate-spin rounded-full border-2 border-line border-t-accent" />}
          {res && <span><b className="text-ink">{res.matched.toLocaleString('en-IN')}</b> of {res.totalGroups.toLocaleString('en-IN')} groups meet the filters · ranked by <b className="text-ink">{crit?.label}</b>, {q.dir === 'desc' ? 'highest first' : 'lowest first'}</span>}
          {err && <span className="text-bad">{err}</span>}
        </div>
      </div>
      {block && <div className={clsx('transition-opacity', busy && 'opacity-60')}><BlockView key={q.grouping + shown.join()} block={block} height={340} /></div>}
      {res?.result.notes?.[1] && <div className="px-1 text-[11px] text-ink-3">{res.result.notes[1]}</div>}
    </section>
  );
}
