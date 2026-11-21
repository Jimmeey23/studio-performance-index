import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import clsx from 'clsx';
import { X, ChevronLeft, Search, Download, Sparkles, Table2, PieChart, LineChart, Info, CheckCircle2, AlertTriangle, Filter, Code2, ChevronRight } from 'lucide-react';
import { api } from '../lib/api';
import type { DrillRequest, DrillFilter } from '../lib/drill';
import type { Result, Format } from '../lib/types';
import { fmt, fmtPeriod } from '../lib/format';
import { useCatalog } from '../lib/catalog';
import { AdvancedTable } from './blocks/AdvancedTable';
import { MiniTrend } from './blocks/Charts';
import { CountUp } from './Animated';

interface DrillResult extends Result {
  metric: { id: string; label: string; format: Format; description: string; value: number | null };
  breakdowns: { dimension: string; label: string; rows: { value: string | null; metric: number | null; records: number }[] }[];
  trend: { period: string; metric: number | null }[];
}

const ISO = /^\d{4}-\d{2}-\d{2}([ T]\d{2}:\d{2})?/;
function prettyRecords(r: DrillResult): Result {
  // show timestamps as readable dates
  const rows = r.rows.map((row) => {
    const o: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(row)) o[k] = typeof v === 'string' && ISO.test(v) ? v.slice(0, 16).replace('T', ' ') : v;
    return o;
  });
  return { ...r, rows, kind: 'records' };
}

export function DrillDrawer({ req, onClose, ask }: { req: DrillRequest | null; onClose: () => void; ask: ((q: string) => void) | null }) {
  const [stack, setStack] = useState<DrillRequest[]>([]);
  const [data, setData] = useState<DrillResult | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [tab, setTab] = useState<'records' | 'breakdown' | 'trend' | 'method'>('records');
  const [search, setSearch] = useState('');
  const [limit, setLimit] = useState(1000);
  const navigate = useNavigate();
  const catalog = useCatalog();
  const dimLabel = (d: string) => catalog?.dimensions[d]?.label ?? d;

  useEffect(() => { if (req) { setStack([req]); setTab('records'); setSearch(''); setLimit(1000); } else setStack([]); }, [req]);
  const cur = stack[stack.length - 1];
  useEffect(() => {
    if (!cur) return;
    let live = true;
    setLoading(true); setErr(null);
    const t = setTimeout(() => {
      api<DrillResult>('/api/drill', { method: 'POST', json: { metric: cur.metric, filters: cur.filters, start: cur.start, end: cur.end, include_future: cur.include_future, search: search || undefined, limit } })
        .then((d) => live && setData(d)).catch((e) => live && setErr((e as Error).message)).finally(() => live && setLoading(false));
    }, search ? 300 : 0);
    return () => { live = false; clearTimeout(t); };
  }, [cur, search, limit]);
  useEffect(() => {
    if (!req) return;
    const h = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', h); return () => window.removeEventListener('keydown', h);
  }, [req, onClose]);

  const records = useMemo(() => (data ? prettyRecords(data) : null), [data]);
  if (!req || !cur) return null;

  const push = (r: DrillRequest) => { setStack((s) => [...s, r]); setSearch(''); };
  const refine = (dimension: string, value: string | null) => push({
    ...cur, expected: null,
    filters: [...cur.filters.filter((f) => f.dimension !== dimension), { dimension, op: 'in', values: [value ?? '(blank)'] }],
    context: [...(cur.context ?? []), value ?? '(blank)'],
  });
  const removeFilter = (f: DrillFilter) => push({ ...cur, expected: null, filters: cur.filters.filter((x) => x !== f), context: (cur.context ?? []).filter((c) => !f.values.map(String).includes(c)) });
  const onMonth = (p: string) => {
    const d = new Date(p + 'T00:00:00Z');
    const end = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).toISOString().slice(0, 10);
    push({ ...cur, start: p, end, expected: null, context: [...(cur.context ?? []).filter((c) => !/\d{4}/.test(c)), fmtPeriod(p, 'month')] });
  };
  const m = data?.metric;
  const question = `Explain ${m?.label ?? cur.metric} for ${(cur.context ?? []).join(' · ') || 'this slice'}: what's driving it, how it compares with the previous period and last year, and what we should do.`;
  const askAI = () => { onClose(); if (ask) ask(question); else navigate('/', { state: { q: question, n: Date.now() } }); };
  const mismatch = cur.expected !== null && cur.expected !== undefined && m?.value !== null && m?.value !== undefined && Math.abs(Number(cur.expected) - Number(m.value)) > Math.max(0.5, Math.abs(Number(cur.expected)) * 0.001);
  const tabs = [
    { id: 'records' as const, label: 'Records', icon: Table2, n: data?.rowCount },
    { id: 'breakdown' as const, label: 'Breakdown', icon: PieChart },
    { id: 'trend' as const, label: 'Trend', icon: LineChart },
    { id: 'method' as const, label: 'Method', icon: Code2 },
  ];

  return createPortal(
    <div className="fixed inset-0 z-50 bg-black/30 backdrop-blur-[1.5px]" onClick={onClose}>
      <div className="drawer-in absolute right-0 top-0 flex h-full w-full max-w-[1080px] flex-col border-l border-line bg-surface shadow-2xl" onClick={(e) => e.stopPropagation()}>
        {/* header */}
        <div className="hero-glow border-b border-line px-6 pb-4 pt-4">
          <div className="flex items-center gap-2">
            {stack.length > 1 && <button onClick={() => setStack((s) => s.slice(0, -1))} className="rounded-md p-1 text-ink-3 hover:bg-surface-2 hover:text-ink" title="Back"><ChevronLeft size={17} /></button>}
            <div className="flex min-w-0 flex-1 items-center gap-1 overflow-hidden text-[11px] text-ink-3">
              <span className="font-semibold uppercase tracking-wider">Drill-through</span>
              {stack.map((s, i) => <span key={i} className="inline-flex items-center gap-1 truncate"><ChevronRight size={11} /><button onClick={() => setStack((st) => st.slice(0, i + 1))} className={clsx('truncate hover:text-ink', i === stack.length - 1 && 'text-ink-2')}>{i === 0 ? (m?.label ?? s.metric) : (s.context ?? []).slice(-1)[0]}</button></span>)}
            </div>
            <button onClick={onClose} className="rounded-md p-1.5 text-ink-3 hover:bg-surface-2 hover:text-ink"><X size={17} /></button>
          </div>
          <div className="mt-3 flex flex-wrap items-end gap-x-8 gap-y-3">
            <div>
              <div className="text-sm font-medium text-ink-2">{m?.label ?? cur.metric}</div>
              <div className="mt-1 text-[34px] font-semibold leading-none tracking-tight tabular">
                {m && m.value !== null ? <CountUp value={Number(m.value)} format={(n) => fmt(n, m.format)} /> : loading ? <span className="shimmer inline-block h-8 w-40 rounded" /> : '—'}
              </div>
              {mismatch && <div className="mt-1 inline-flex items-center gap-1 text-[11px] text-warn"><AlertTriangle size={11} />Clicked value {fmt(cur.expected, m?.format)} — slice recomputed from records</div>}
              {!mismatch && cur.expected !== null && cur.expected !== undefined && m && <div className="mt-1 inline-flex items-center gap-1 text-[11px] text-good"><CheckCircle2 size={11} />Reconciles with the clicked value</div>}
            </div>
            <div className="text-sm">
              <div className="text-ink-3">Records</div>
              <div className="text-xl font-semibold tabular">{data ? data.rowCount.toLocaleString('en-IN') : '…'}</div>
            </div>
            <div className="text-sm">
              <div className="text-ink-3">Period</div>
              <div className="font-medium">{cur.start ? `${fmtPeriod(cur.start, 'day')} – ${fmtPeriod(cur.end ?? '', 'day')}` : 'All time'}</div>
            </div>
            <div className="ml-auto flex gap-2">
              {data && <a href="#" onClick={(e) => { e.preventDefault(); downloadCsv(records!); }} className="inline-flex h-9 items-center gap-1.5 rounded-xl border border-line bg-surface px-3 text-sm text-ink-2 hover:bg-surface-2"><Download size={14} />CSV</a>}
              <button onClick={askAI} className="btn-glow inline-flex h-9 items-center gap-1.5 rounded-xl bg-ink px-3.5 text-sm font-medium text-bg"><Sparkles size={14} />Ask AI about this</button>
            </div>
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-1.5">
            <Filter size={12} className="text-ink-3" />
            {cur.filters.length === 0 && <span className="text-xs text-ink-3">No filters — all records in the period</span>}
            {cur.filters.map((f, i) => (
              <span key={i} className="inline-flex items-center gap-1 rounded-full border border-line bg-surface px-2.5 py-0.5 text-xs">
                <span className="text-ink-3">{dimLabel(f.dimension)}{f.op === 'not_in' ? ' ≠' : ':'}</span>{f.values.join(', ')}
                <button onClick={() => removeFilter(f)} className="text-ink-3 hover:text-bad" title="Remove filter"><X size={11} /></button>
              </span>
            ))}
          </div>
          {m?.description && <div className="mt-2 flex items-start gap-1.5 text-xs text-ink-3"><Info size={12} className="mt-0.5 shrink-0" />{m.description}</div>}
        </div>
        {/* tabs */}
        <div className="flex items-center gap-1 border-b border-line px-6">
          {tabs.map((t) => (
            <button key={t.id} onClick={() => setTab(t.id)} className={clsx('inline-flex items-center gap-1.5 border-b-2 px-3 py-2.5 text-sm transition', tab === t.id ? 'border-accent font-medium text-ink' : 'border-transparent text-ink-3 hover:text-ink')}>
              <t.icon size={14} />{t.label}{t.n !== undefined && <span className="rounded-full bg-surface-2 px-1.5 text-[10px] tabular">{t.n.toLocaleString('en-IN')}</span>}
            </button>
          ))}
          {tab === 'records' && (
            <div className="relative ml-auto">
              <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-3" />
              <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search all records (server)" className="h-8 w-64 rounded-lg border border-line bg-bg pl-8 pr-2 text-xs outline-none focus:border-accent" />
            </div>
          )}
        </div>
        <div className={clsx('min-h-0 flex-1 overflow-y-auto px-6 py-4 transition-opacity', loading && 'opacity-60')}>
          {err && <div className="rounded-xl border border-bad/30 bg-bad/5 p-4 text-sm text-bad">{err}</div>}
          {!data && !err && <div className="space-y-3">{[1, 2, 3, 4].map((i) => <div key={i} className="shimmer h-10 rounded-lg" />)}</div>}
          {data && tab === 'records' && records && (
            <div>
              {data.notes?.length > 0 && <div className="mb-3 space-y-1">{data.notes.map((n, i) => <div key={i} className="flex gap-1.5 text-xs text-ink-3"><Info size={12} className="mt-0.5 shrink-0" />{n}</div>)}</div>}
              <AdvancedTable key={`${stack.length}-${search}-${limit}`} result={records} pageSize={25} records />
              {data.truncated && (
                <div className="mt-3 flex items-center gap-2 text-xs text-ink-3">
                  Showing {data.rows.length.toLocaleString('en-IN')} of {data.rowCount.toLocaleString('en-IN')} records.
                  {limit < 5000 && <button onClick={() => setLimit(5000)} className="rounded-md border border-line px-2 py-1 text-ink-2 hover:bg-surface-2">Load up to 5,000</button>}
                  <span>Narrow down with a breakdown or the search box.</span>
                </div>
              )}
            </div>
          )}
          {data && tab === 'breakdown' && (
            <div className="grid gap-5 md:grid-cols-2">
              {data.breakdowns.map((b) => {
                const max = Math.max(...b.rows.map((r) => Math.abs(Number(r.metric) || 0)), 1e-9);
                return (
                  <div key={b.dimension} className="rounded-2xl border border-line bg-bg/40 p-4">
                    <div className="mb-2 flex items-center justify-between text-sm font-semibold">{b.label}<span className="text-[11px] font-normal text-ink-3">click to drill deeper</span></div>
                    <div className="space-y-1">
                      {b.rows.slice(0, 14).map((r, i) => (
                        <button key={i} onClick={() => refine(b.dimension, r.value)} className="group relative block w-full overflow-hidden rounded-lg px-2.5 py-1.5 text-left hover:bg-surface-2">
                          <div className="absolute inset-y-1 left-0 rounded-r-md bg-accent/12 transition-all group-hover:bg-accent/20" style={{ width: `${(Math.abs(Number(r.metric) || 0) / max) * 100}%` }} />
                          <div className="relative flex items-center justify-between gap-3 text-[13px]">
                            <span className="truncate">{r.value ?? '(blank)'}</span>
                            <span className="shrink-0 tabular"><b className="font-semibold">{fmt(r.metric, m?.format, { compact: true })}</b><span className="ml-2 text-[11px] text-ink-3">{r.records.toLocaleString('en-IN')} rec</span></span>
                          </div>
                        </button>
                      ))}
                    </div>
                  </div>
                );
              })}
              {!data.breakdowns.length && <div className="text-sm text-ink-3">No further breakdowns for this slice.</div>}
            </div>
          )}
          {data && tab === 'trend' && (
            <div className="rounded-2xl border border-line bg-bg/40 p-4">
              <div className="mb-2 text-sm font-semibold">{m?.label} by month <span className="font-normal text-ink-3">· click a month to drill into it</span></div>
              <MiniTrend points={data.trend.map((p) => ({ period: p.period, value: p.metric === null ? null : Number(p.metric) }))} format={m?.format} height={300} onClick={onMonth} />
            </div>
          )}
          {data && tab === 'method' && (
            <div className="space-y-4 text-sm">
              <div><div className="mb-1 text-xs font-semibold uppercase tracking-wide text-ink-3">Data sources</div><ul className="list-disc pl-5 text-ink-2">{data.sources.map((s) => <li key={s}>{s}</li>)}</ul></div>
              {data.definitions?.map((d) => <div key={d.metric} className="rounded-lg border border-line p-3"><b>{d.label}</b> — <span className="text-ink-2">{d.description}</span>{d.caveat && <div className="mt-1 text-xs text-warn">⚠ {d.caveat}</div>}</div>)}
              {data.sql.map((s, i) => <pre key={i} className="max-h-72 overflow-auto rounded-lg bg-surface-2 p-3 font-mono text-[11px] leading-relaxed">{s}</pre>)}
            </div>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}

function downloadCsv(r: Result) {
  const esc = (v: unknown) => { const s = v === null || v === undefined ? '' : String(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  const csv = '﻿' + [r.columns.map((c) => esc(c.label)).join(','), ...r.rows.map((row) => r.columns.map((c) => esc(row[c.key])).join(','))].join('\n');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
  a.download = `${(r.title ?? 'records').replace(/[^\w\- ]+/g, '').slice(0, 60)}.csv`;
  a.click();
}
