import { useMemo, useState, useRef, useEffect, type ReactNode } from 'react';
import {
  useReactTable, getCoreRowModel, getSortedRowModel, getFilteredRowModel, getPaginationRowModel, getGroupedRowModel, getExpandedRowModel,
  flexRender, type ColumnDef, type SortingState, type VisibilityState, type ColumnFiltersState, type GroupingState, type Row as TRow, type ColumnPinningState,
} from '@tanstack/react-table';
import {
  ArrowDown, ArrowUp, ChevronDown, ChevronRight, Columns3, Search, Filter, Layers, Rows3, Table2, CalendarDays, Grid3x3, Flame, Download, X, AlignJustify,
  Trophy, ArrowLeftRight, Sigma, LayoutGrid, BarChartHorizontal, Copy, Plus, ChevronsDownUp, ChevronsUpDown, MousePointerClick, Check,
} from 'lucide-react';
import clsx from 'clsx';
import type { Column, Result, Format } from '../../lib/types';
import { fmt, fmtChange, fmtPeriod } from '../../lib/format';
import { useCatalog, usePolarity } from '../../lib/catalog';
import { drillFor, useDrill } from '../../lib/drill';
import { api } from '../../lib/api';

type Row = Record<string, unknown>;
export type TableView = 'table' | 'mom' | 'pivot' | 'grouped' | 'ranked' | 'transposed' | 'heatmap' | 'stats' | 'cards';

const isNumFmt = (f?: Format) => f === 'currency' || f === 'number' || f === 'percent' || f === 'decimal' || f === 'days';
const NON_ADDITIVE_KEY = /(rate|avg|average|share|of_top|z_score|ratio|per_|_pct|atv|fill|cpl|ctr|roas|cohort_size)/i;
const x_ok = (v: number) => typeof v === 'number' && isFinite(v);
const isMetricCol = (c: Column) => isNumFmt(c.format) && c.kind !== 'period' && c.kind !== 'dimension';

function useAdditive() {
  const c = useCatalog();
  return (col: Column) => {
    if (!isNumFmt(col.format) || col.kind === 'change') return false;
    const id = col.key.replace(/__(prev|chg)$/, '');
    const m = c?.metrics.find((x) => x.id === id);
    if (m) return m.additive;
    return (col.format === 'currency' || col.format === 'number') && !NON_ADDITIVE_KEY.test(col.key);
  };
}

/** Opens the item-level records behind a number. Returns null when the result can't be drilled. */
function useCellDrill(result: Result) {
  const drill = useDrill();
  const can = !!drill && result.kind === 'metrics';
  return {
    can,
    canKey: (key: string) => can && !key.endsWith('__chg') && ((result.spec?.metrics as string[] | undefined) ?? []).includes(key.replace(/__prev$/, '')),
    open: (row: Row | null, key: string, slice?: Row) => { const r = drillFor(result, row, key, slice); if (r && drill) drill(r); },
  };
}

export function csvDownload(name: string, header: string[], rows: (string | number | null | undefined)[][]) {
  const esc = (v: unknown) => { const s = v === null || v === undefined ? '' : String(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  const csv = '﻿' + [header.map(esc).join(','), ...rows.map((r) => r.map(esc).join(','))].join('\n');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
  a.download = `${name.replace(/[^\w\- ]+/g, '').slice(0, 60) || 'table'}.csv`;
  a.click();
}
function copyTsv(header: string[], rows: unknown[][]) {
  const tsv = [header.join('\t'), ...rows.map((r) => r.map((v) => (v === null || v === undefined ? '' : String(v))).join('\t'))].join('\n');
  navigator.clipboard?.writeText(tsv);
}

/** Adds derived Year / Quarter columns for period-based results so they can be grouped. */
function withDerived(result: Result): Result {
  if (!result.columns.some((c) => c.key === 'period') || result.kind !== 'metrics') return result;
  const grain = (result.spec?.grain as string) ?? 'month';
  if (grain === 'year' || grain === 'all') return result;
  const rows = result.rows.map((r) => {
    const p = String(r.period ?? '');
    const y = p.slice(0, 4), m = Number(p.slice(5, 7));
    return { ...r, __year: y, __quarter: m ? `${y}-Q${Math.floor((m - 1) / 3) + 1}` : null };
  });
  const derived: Column[] = [
    { key: '__year', label: 'Year', kind: 'dimension', format: 'text' },
    ...(grain !== 'quarter' ? [{ key: '__quarter', label: 'Quarter', kind: 'dimension' as const, format: 'text' as const }] : []),
  ];
  return { ...result, rows, columns: [...derived, ...result.columns] };
}

const btn = (on?: boolean) => clsx('tool', on && 'on');

/* ───────────────────────────── Shell with view switcher ───────────────────────────── */
export function AdvancedTable({ result: raw, columns: only, view: initial, groupBy, pageSize = 15, compact, records }: {
  result: Result; columns?: string[]; view?: TableView; groupBy?: string; pageSize?: number; compact?: boolean; records?: boolean;
}) {
  const result = useMemo(() => withDerived(raw), [raw]);
  const hasPeriod = raw.columns.some((c) => c.kind === 'period');
  const grain = (raw.spec?.grain as string) ?? (hasPeriod ? 'month' : 'all');
  const dims = raw.columns.filter((c) => c.kind === 'dimension');
  const metricCols = raw.columns.filter(isMetricCol);
  const momPossible = hasPeriod && dims.length <= 1 && !records;
  const nAxes = raw.columns.filter((c) => c.kind === 'dimension' || c.kind === 'period').length;
  const pivotPossible = nAxes >= 2 || (raw.kind === 'metrics' && nAxes >= 1 && !records);
  const multi = raw.rows.length > 1;
  const defaultView: TableView = initial === 'grouped' && !groupBy && !dims.length && !hasPeriod ? 'table' : initial ?? (momPossible && grain === 'month' && raw.rows.length > 2 ? 'mom' : groupBy ? 'grouped' : 'table');
  const [view, setView] = useState<TableView>(defaultView);
  useEffect(() => setView(defaultView), [raw.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const views: { id: TableView; label: string; icon: typeof Table2; ok: boolean }[] = [
    { id: 'table', label: 'Table', icon: Table2, ok: true },
    { id: 'mom', label: 'Month-on-month', icon: CalendarDays, ok: momPossible },
    { id: 'grouped', label: 'Grouped', icon: Layers, ok: (dims.length > 0 || hasPeriod) && multi },
    { id: 'pivot', label: 'Pivot', icon: Grid3x3, ok: pivotPossible && !records },
    { id: 'ranked', label: 'Ranked', icon: Trophy, ok: metricCols.length > 0 && multi && !records },
    { id: 'heatmap', label: 'Heatmap', icon: Flame, ok: metricCols.length > 0 && multi },
    { id: 'transposed', label: 'Transposed', icon: ArrowLeftRight, ok: metricCols.length > 0 && raw.rows.length <= 40 && !records },
    { id: 'cards', label: 'Cards', icon: LayoutGrid, ok: metricCols.length > 0 && multi && raw.rows.length <= 60 && !records },
    { id: 'stats', label: 'Statistics', icon: Sigma, ok: metricCols.length > 0 && multi },
  ];
  const avail = views.filter((v) => v.ok);
  const switcher = !compact && avail.length > 1 ? (
    <div className="seg shrink-0">
      {avail.map((v) => (
        <button key={v.id} onClick={() => setView(v.id)} title={v.label} className={clsx(view === v.id && 'on')}>
          <v.icon size={14} />{view === v.id && <span>{v.label}</span>}
        </button>
      ))}
    </div>
  ) : null;
  const own = (node: ReactNode) => <div>{switcher && <div className="mb-3 flex items-center">{switcher}</div>}{node}</div>;
  return view === 'mom' && momPossible ? <MomTable result={raw} only={only} lead={switcher} />
    : view === 'pivot' && pivotPossible ? <PivotView result={raw} lead={switcher} />
    : view === 'ranked' ? <RankedView result={raw} lead={switcher} />
    : view === 'transposed' ? own(<TransposedView result={raw} />)
    : view === 'cards' ? own(<CardsView result={raw} />)
    : view === 'stats' ? own(<StatsView result={raw} />)
    : <GridTable key={view} result={result} only={only} lead={switcher} heatDefault={view === 'heatmap'} groupBy={view === 'grouped' ? (groupBy ? (result.columns.some((c) => c.key === groupBy) ? groupBy : dims[0]?.key) : (dims[0]?.key ?? (hasPeriod ? '__year' : undefined))) : undefined} pageSize={pageSize} records={records} />;
}

/* ───────────────────────────── shared cell renderer ───────────────────────────── */
function useRenderValue(result: Result) {
  const polarity = usePolarity();
  const grain = (result.spec?.grain as string) ?? 'month';
  return (c: Column, v: unknown, row?: Row): ReactNode => {
    if (c.kind === 'change') {
      const metricKey = c.key.replace(/__chg$/, '');
      const pp = result.columns.find((x) => x.key === metricKey)?.format === 'percent' || row?.format === 'percent';
      const pol = row?.metric_id ? polarity(String(row.metric_id)) : polarity(metricKey);
      const n = Number(v);
      const tone = v === null || v === undefined || !isFinite(n) || n === 0 || pol === 0 ? 'text-ink-2' : n * pol > 0 ? 'text-good' : 'text-bad';
      const bg = tone === 'text-good' ? 'bg-good/8' : tone === 'text-bad' ? 'bg-bad/8' : '';
      return <span className={clsx('tabular rounded px-1 py-0.5 text-[12px] font-medium', tone, bg)}>{fmtChange(v, pp)}</span>;
    }
    if (c.kind === 'period') return <span className="whitespace-nowrap">{fmtPeriod(String(v ?? ''), grain)}{row?.__partial ? <span className="ml-1.5 rounded bg-warn/10 px-1 text-[10px] text-warn">partial</span> : null}</span>;
    const f = (['value', 'trailing_avg'].includes(c.key) && row?.format ? row.format : c.format) as Format;
    if (isNumFmt(c.format)) return <span className={clsx('tabular', c.kind === 'comparison' && 'text-ink-3')}>{fmt(v, f)}</span>;
    return <span className="block max-w-[380px] truncate whitespace-nowrap" title={String(v ?? '')}>{v === null || v === '' ? <span className="text-ink-3">(blank)</span> : fmt(v, c.format)}</span>;
  };
}

/* ───────────────────────────── Grid (sort, filter, multi-level group, totals, drill) ───────────────────────────── */
function ColumnFilter({ col, value, onChange, values }: { col: Column; value: unknown; onChange: (v: unknown) => void; values: string[] }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => { const h = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && setOpen(false); document.addEventListener('mousedown', h); return () => document.removeEventListener('mousedown', h); }, []);
  const numeric = isNumFmt(col.format) && col.kind !== 'period';
  const active = value !== undefined && value !== '' && !(Array.isArray(value) && value.every((x) => x === '' || x === undefined));
  const range = (Array.isArray(value) ? value : ['', '']) as [string, string];
  return (
    <div ref={ref} className="relative inline-block" onClick={(e) => e.stopPropagation()}>
      <button onClick={() => setOpen((o) => !o)} className={clsx('rounded p-0.5', active ? 'text-accent' : 'text-ink-3 opacity-0 group-hover/th:opacity-100')} title="Filter"><Filter size={11} /></button>
      {open && (
        <div className="pop-in absolute left-0 top-6 z-30 w-60 rounded-xl border border-line bg-surface p-3 text-left font-normal normal-case tracking-normal shadow-xl">
          <div className="mb-2 text-[11px] font-medium text-ink-3">Filter {col.label}</div>
          {numeric ? (
            <div className="flex gap-2">
              <input value={range[0]} onChange={(e) => onChange([e.target.value, range[1]])} placeholder="min" className="h-8 w-full rounded-md border border-line bg-bg px-2 text-xs outline-none focus:border-accent" />
              <input value={range[1]} onChange={(e) => onChange([range[0], e.target.value])} placeholder="max" className="h-8 w-full rounded-md border border-line bg-bg px-2 text-xs outline-none focus:border-accent" />
            </div>
          ) : (
            <>
              <input autoFocus value={typeof value === 'string' ? value : ''} onChange={(e) => onChange(e.target.value)} placeholder="contains…" className="h-8 w-full rounded-md border border-line bg-bg px-2 text-xs outline-none focus:border-accent" />
              {values.length <= 60 && (
                <div className="mt-2 max-h-48 space-y-0.5 overflow-auto">
                  {values.map((v) => {
                    const sel = Array.isArray(value) && !numeric ? (value as string[]).includes(v) : false;
                    return (
                      <button key={v} onClick={() => { const cur = Array.isArray(value) ? (value as string[]) : []; const next = sel ? cur.filter((x) => x !== v) : [...cur, v]; onChange(next.length ? next : undefined); }} className="flex w-full items-center gap-2 truncate rounded px-1.5 py-1 text-left text-xs text-ink-2 hover:bg-surface-2">
                        <span className={clsx('flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded border', sel ? 'border-accent bg-accent text-white' : 'border-line')}>{sel && <Check size={10} />}</span>
                        <span className="truncate">{col.kind === 'period' ? fmtPeriod(v) : v || '(blank)'}</span>
                      </button>
                    );
                  })}
                </div>
              )}
            </>
          )}
          {active && <button onClick={() => onChange(undefined)} className="mt-2 inline-flex items-center gap-1 text-[11px] text-ink-3 hover:text-ink"><X size={11} />Clear</button>}
        </div>
      )}
    </div>
  );
}

function GridTable({ result: base, only, groupBy, pageSize, heatDefault, records, lead }: { result: Result; only?: string[]; groupBy?: string; pageSize: number; heatDefault?: boolean; records?: boolean; lead?: ReactNode }) {
  const catalog = useCatalog();
  // `result` can be re-queried at a finer grain when the user groups by a dimension that isn't in the table yet
  const [result, setResult] = useState<Result>(base);
  const [regrouping, setRegrouping] = useState(false);
  const [subtotals, setSubtotals] = useState<Map<string, Row>>(new Map());
  useEffect(() => { setResult(base); }, [base]);
  const spec = result.spec as { metrics?: string[]; dimensions?: string[]; grain?: string; filters?: unknown[]; compare?: string | null; include_future?: boolean; include_imported?: boolean } | undefined;
  const serverable = result.kind === 'metrics' && !!spec?.metrics?.length && !records;
  /** every dimension shared by all models behind this result */
  const allDims = useMemo(() => {
    if (!serverable || !catalog) return [] as { key: string; label: string }[];
    const models = new Set(spec!.metrics!.map((m) => catalog.metrics.find((x) => x.id === m)?.dataset));
    const sets = [...models].map((md) => new Set(catalog.datasets.find((d) => d.id === md)?.dimensions ?? []));
    const inter = sets.length ? [...sets[0]].filter((x) => sets.every((st) => st.has(x))) : [];
    return inter.filter((x) => x !== 'client').map((x) => ({ key: x, label: catalog.dimensions[x]?.label ?? x })).sort((a, b) => a.label.localeCompare(b.label));
  }, [serverable, catalog, spec]);
  const requery = (dims: string[], grain?: string) => api<Result>('/api/query', { method: 'POST', json: {
    ...spec, dimensions: dims, grain: grain ?? spec?.grain ?? 'all', start: result.period?.start, end: result.period?.end, limit: 5000, sort: { by: spec!.metrics![0], dir: 'desc' } } });
  const addServerDim = async (dim: string) => {
    setRegrouping(true);
    try {
      const r = await requery([...(spec?.dimensions ?? []), dim]);
      r.title = result.title;
      setResult(withDerived(r));
      setGrouping((g) => [...g, dim]);
    } finally { setRegrouping(false); }
  };
  const additive = useAdditive();
  const renderValue = useRenderValue(result);
  const cd = useCellDrill(result);
  const cols = useMemo(() => {
    if (!only?.length) return result.columns;
    const keep = new Set(only);
    const sel = result.columns.filter((c) => keep.has(c.key) || keep.has(c.key.replace(/__(prev|chg)$/, '')) || c.kind === 'dimension' || c.kind === 'period');
    return sel.length ? sel : result.columns;
  }, [result.columns, only]);

  const [sorting, setSorting] = useState<SortingState>([]);
  const [filter, setFilter] = useState('');
  const [colFilters, setColFilters] = useState<ColumnFiltersState>([]);
  const [visibility, setVisibility] = useState<VisibilityState>(() => Object.fromEntries(result.columns.filter((c) => c.key.startsWith('__')).map((c) => [c.key, false])));
  const [grouping, setGrouping] = useState<GroupingState>(groupBy ? [groupBy] : []);
  const [pinning, setPinning] = useState<ColumnPinningState>({ left: [] });
  const [showCols, setShowCols] = useState(false);
  const [heat, setHeat] = useState(!!heatDefault);
  const [bars, setBars] = useState(false);
  const [dense, setDense] = useState(false);
  const [copied, setCopied] = useState(false);
  const [expanded, setExpanded] = useState<true | Record<string, boolean>>({});
  useEffect(() => setGrouping(groupBy ? [groupBy] : []), [groupBy]);
  // exact subtotals for every grouping level (ratios can't be summed): one engine query per level prefix
  useEffect(() => {
    if (!serverable || !grouping.length) { setSubtotals(new Map()); return; }
    let live = true;
    (async () => {
      const m = new Map<string, Row>();
      for (let i = 0; i < grouping.length; i++) {
        const prefix = grouping.slice(0, i + 1);
        if (prefix.some((g) => g.startsWith('__'))) break;
        const hasPeriod = prefix.includes('period');
        const dims = prefix.filter((g) => g !== 'period');
        try {
          const r = await requery(dims, hasPeriod ? spec?.grain : 'all');
          for (const row of r.rows) m.set(prefix.map((g) => String(row[g] ?? '')).join('\u0001'), row);
        } catch { /* fall back to client aggregation */ }
      }
      if (live) setSubtotals(m);
    })();
    return () => { live = false; };
  }, [grouping, serverable, result.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const ranges = useMemo(() => {
    const m: Record<string, [number, number]> = {};
    for (const c of cols) if (isNumFmt(c.format) && c.kind !== 'period') {
      const vs = result.rows.map((r) => Number(r[c.key])).filter((v) => isFinite(v));
      m[c.key] = [Math.min(...vs, 0), Math.max(...vs, 0)];
    }
    return m;
  }, [cols, result.rows]);

  const defs = useMemo<ColumnDef<Row>[]>(() => cols.map((c: Column) => ({
    id: c.key, accessorFn: (r) => r[c.key], header: c.label,
    sortingFn: (a, b, id) => { const x = a.getValue(id), y = b.getValue(id); return typeof x === 'number' && typeof y === 'number' ? x - y : x === null ? -1 : y === null ? 1 : String(x ?? '').localeCompare(String(y ?? ''), undefined, { numeric: true }); },
    filterFn: (row, id, val) => {
      const v = row.getValue(id);
      if (Array.isArray(val) && isNumFmt(c.format) && c.kind !== 'period') { const n = Number(v); const [lo, hi] = val as string[]; return (lo === '' || lo === undefined || n >= Number(lo)) && (hi === '' || hi === undefined || n <= Number(hi)); }
      if (Array.isArray(val)) return (val as string[]).includes(String(v ?? ''));
      return String(v ?? '').toLowerCase().includes(String(val).toLowerCase());
    },
    aggregationFn: additive(c) ? 'sum' : undefined,
    enableGrouping: c.kind === 'dimension' || c.kind === 'period',
    size: c.kind === 'dimension' ? 260 : 120, minSize: 60,
    cell: (info) => renderValue(c, info.getValue(), info.row.original),
    aggregatedCell: (info) => {
      const r = info.row;
      const path = [...r.getParentRows(), r].map((x) => String(x.groupingValue ?? '')).join('\u0001');
      const exact = subtotals.get(path);
      if (exact && c.key in exact) return <span className="font-semibold">{renderValue(c, exact[c.key], exact)}</span>;
      // client-side roll-up of the leaf rows so grouped rows are never blank
      const leaves = r.getLeafRows().filter((x) => !x.getIsGrouped()).map((x) => x.original);
      const colOf = (k: string) => result.columns.find((x) => x.key === k);
      const roll = (k: string): { v: number | null; avg: boolean } => {
        const col = colOf(k); const nums = leaves.map((x) => Number(x[k])).filter((v) => x_ok(v));
        if (!col || !nums.length) return { v: null, avg: false };
        return additive(col) ? { v: nums.reduce((p, q) => p + q, 0), avg: false } : { v: nums.reduce((p, q) => p + q, 0) / nums.length, avg: true };
      };
      if (c.kind === 'change') {
        const base = c.key.replace(/__chg$/, ''); const cur = roll(base).v, prev = roll(`${base}__prev`).v;
        if (cur === null || prev === null) return null;
        const chg = colOf(base)?.format === 'percent' ? cur - prev : prev ? (cur - prev) / Math.abs(prev) : null;
        return <span className="font-semibold">{renderValue(c, chg)}</span>;
      }
      if (isNumFmt(c.format) && c.kind !== 'period') {
        const { v, avg } = roll(c.key);
        if (v === null) return null;
        return <span className="font-semibold">{renderValue(c, v)}{avg && <span className="ml-1 text-[9px] font-normal uppercase tracking-wide text-ink-3">avg</span>}</span>;
      }
      const vals = [...new Set(leaves.map((x) => x[c.key]).filter((v) => v !== null && v !== undefined && v !== ''))];
      if (!vals.length) return null;
      if (vals.length === 1) return <span className="text-ink-2">{renderValue(c, vals[0])}</span>;
      if (c.kind === 'period' || /(_ts|date|time|period)/i.test(c.key)) {
        const sorted = vals.map(String).sort();
        return <span className="text-[11px] text-ink-3">{c.kind === 'period' ? `${fmtPeriod(sorted[0])} – ${fmtPeriod(sorted[sorted.length - 1])}` : `${sorted[0].slice(0, 10)} – ${sorted[sorted.length - 1].slice(0, 10)}`}</span>;
      }
      return <span className="text-[11px] text-ink-3">{vals.length} {c.label.toLowerCase()}{/s$/.test(c.label) ? '' : 's'}</span>;
    },
    meta: { col: c, align: isNumFmt(c.format) && c.kind !== 'period' ? 'right' : 'left' },
  })), [cols, additive, renderValue, cd.canKey, subtotals]); // eslint-disable-line react-hooks/exhaustive-deps

  const table = useReactTable({
    data: result.rows, columns: defs,
    state: { sorting, globalFilter: filter, columnVisibility: visibility, columnFilters: colFilters, grouping, columnPinning: pinning, expanded },
    onSortingChange: setSorting, onGlobalFilterChange: setFilter, onColumnVisibilityChange: setVisibility, onColumnFiltersChange: setColFilters, onGroupingChange: setGrouping,
    onColumnPinningChange: setPinning, onExpandedChange: setExpanded,
    getCoreRowModel: getCoreRowModel(), getSortedRowModel: getSortedRowModel(), getFilteredRowModel: getFilteredRowModel(),
    getGroupedRowModel: getGroupedRowModel(), getExpandedRowModel: getExpandedRowModel(), getPaginationRowModel: getPaginationRowModel(),
    initialState: { pagination: { pageSize } }, isMultiSortEvent: (e) => (e as MouseEvent).shiftKey, autoResetExpanded: false,
    enableColumnResizing: true, columnResizeMode: 'onChange',
    globalFilterFn: (row, _id, value) => Object.values(row.original).some((v) => String(v ?? '').toLowerCase().includes(String(value).toLowerCase())),
  });

  const filtered = table.getFilteredRowModel().rows.filter((r) => !r.getIsGrouped()).map((r) => r.original);
  const isFiltered = filter !== '' || colFilters.length > 0;
  const totalFor = (c: Column): unknown => {
    if (!isNumFmt(c.format) || c.kind === 'period') return undefined;
    if (!isFiltered && result.totals && result.totals[c.key] !== undefined) return result.totals[c.key];
    if (additive(c)) return filtered.reduce((a, r) => a + (Number(r[c.key]) || 0), 0);
    if (c.kind === 'change') return undefined;
    const vs = filtered.map((r) => Number(r[c.key])).filter((v) => isFinite(v));
    return vs.length ? vs.reduce((a, b) => a + b, 0) / vs.length : undefined;
  };
  const totalIsAvg = (c: Column) => !(!isFiltered && result.totals && result.totals[c.key] !== undefined) && !additive(c) && c.kind !== 'change';
  const groupable = result.columns.filter((c) => c.kind === 'dimension' || c.kind === 'period');
  const moreDims = allDims.filter((x) => !groupable.some((c) => c.key === x.key));
  const visibleCols = table.getVisibleLeafColumns();
  const header = visibleCols.map((c) => String(c.columnDef.header));
  const body = () => filtered.map((r) => visibleCols.map((c) => r[c.id] as string));
  const exportCsv = () => csvDownload(result.title ?? 'table', header, body());

  /** dims of a grouped row + its parents, e.g. {location: 'Kenkere House', __year: '2026'} */
  const groupSlice = (r: TRow<Row>): Row => {
    const s: Row = {};
    for (const x of [r, ...r.getParentRows()]) if (x.groupingColumnId) s[x.groupingColumnId] = x.groupingValue;
    return s;
  };

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-1.5">
        {lead}
        <div className="relative">
          <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-3" />
          <input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Search" className="field w-36 pl-8 transition-all focus:w-52" />
        </div>
        {(groupable.length > 0 || moreDims.length > 0) && (
          <div className="tool !px-1.5">
            <Layers size={13} className="ml-0.5 text-ink-3" />
            {grouping.map((g, i) => (
              <span key={g} className="inline-flex items-center gap-1 rounded-md bg-accent-soft px-1.5 py-0.5 text-[11px] text-accent">
                {i > 0 && <ChevronRight size={10} />}{groupable.find((c) => c.key === g)?.label ?? g}
                <button onClick={() => setGrouping(grouping.filter((x) => x !== g))}><X size={10} /></button>
              </span>
            ))}
            <label className="relative inline-flex cursor-pointer items-center gap-0.5 rounded px-1 text-[11px] text-ink-3 hover:text-ink">
              <Plus size={11} />{grouping.length ? '' : 'Group by'}
              <select value="" onChange={(e) => { const v = e.target.value; if (!v) return; if (v.startsWith('+')) addServerDim(v.slice(1)); else setGrouping([...grouping, v]); }} className="absolute inset-0 cursor-pointer opacity-0">
                <option value="">Add grouping level…</option>
                {groupable.filter((c) => !grouping.includes(c.key)).length > 0 && <optgroup label="In this table">{groupable.filter((c) => !grouping.includes(c.key)).map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}</optgroup>}
                {moreDims.length > 0 && <optgroup label="Break down further by…">{moreDims.map((x) => <option key={x.key} value={`+${x.key}`}>{x.label}</option>)}</optgroup>}
              </select>
            </label>
          </div>
        )}
        {grouping.length > 0 && <button title="Expand / collapse all" onClick={() => setExpanded(expanded === true ? {} : true)} className={btn()}>{expanded === true ? <ChevronsDownUp size={13} /> : <ChevronsUpDown size={13} />}</button>}
        <div className="relative">
          <button onClick={() => setShowCols((s) => !s)} className={btn(showCols)} title="Columns"><Columns3 size={13} /></button>
          {showCols && (
            <div className="pop-in absolute z-30 mt-1 max-h-80 w-64 overflow-auto rounded-xl border border-line bg-surface p-2 shadow-xl">
              <div className="mb-1 flex justify-between px-2 text-[10px] uppercase tracking-wide text-ink-3"><span>Show</span><span>Pin</span></div>
              {table.getAllLeafColumns().map((c) => (
                <div key={c.id} className="flex items-center gap-2 rounded px-2 py-1 text-xs hover:bg-surface-2">
                  <label className="flex flex-1 cursor-pointer items-center gap-2"><input type="checkbox" checked={c.getIsVisible()} onChange={c.getToggleVisibilityHandler()} />{String(c.columnDef.header)}</label>
                  <button onClick={() => c.pin(c.getIsPinned() ? false : 'left')} className={clsx('rounded px-1 text-[10px]', c.getIsPinned() ? 'bg-accent-soft text-accent' : 'text-ink-3 hover:text-ink')}>{c.getIsPinned() ? 'pinned' : 'pin'}</button>
                </div>
              ))}
            </div>
          )}
        </div>
        <button onClick={() => setHeat((h) => !h)} className={btn(heat)} title="Colour scale"><Flame size={13} /></button>
        <button onClick={() => setBars((h) => !h)} className={btn(bars)} title="In-cell data bars"><BarChartHorizontal size={13} /></button>
        <button onClick={() => setDense((d) => !d)} className={btn(dense)} title="Compact rows"><AlignJustify size={13} /></button>
        <button onClick={() => { copyTsv(header, body()); setCopied(true); setTimeout(() => setCopied(false), 1200); }} className={btn(copied)} title="Copy to clipboard (paste into Sheets/Excel)">{copied ? <Check size={13} /> : <Copy size={13} />}</button>
        <button onClick={exportCsv} className={btn()} title="Download CSV"><Download size={13} /></button>
        {(isFiltered || sorting.length > 0) && <button onClick={() => { setFilter(''); setColFilters([]); setSorting([]); }} className="inline-flex h-8 items-center gap-1 px-1 text-xs text-ink-3 hover:text-ink"><X size={12} />Reset</button>}
        <span className="ml-auto flex items-center gap-2 text-[11px] text-ink-3">
          {cd.can && <span className="hidden items-center gap-1 lg:inline-flex"><MousePointerClick size={11} />click any number for records</span>}
          {regrouping && <span className="inline-flex items-center gap-1 text-accent"><span className="h-3 w-3 animate-spin rounded-full border-2 border-line border-t-accent" />regrouping…</span>}
          {filtered.length.toLocaleString('en-IN')} rows{result.truncated ? ` of ${result.rowCount.toLocaleString('en-IN')}` : ''}
        </span>
      </div>
      <div className="data-wrap overflow-x-auto">
        <table className={clsx('data-table w-full', dense ? 'text-[12px]' : 'text-[13px]')} style={{ minWidth: table.getTotalSize() }}>
          <thead className="sticky top-0 z-10">
            {table.getHeaderGroups().map((hg) => (
              <tr key={hg.id}>
                {hg.headers.map((h, i) => {
                  const meta = h.column.columnDef.meta as { align: string; col: Column };
                  const s = h.column.getIsSorted();
                  const pinned = h.column.getIsPinned();
                  const vals = [...new Set(result.rows.map((r) => String(r[h.column.id] ?? '')))].slice(0, 61);
                  return (
                    <th key={h.id} style={{ width: h.getSize(), left: pinned ? h.column.getStart('left') : undefined }} className={clsx('group/th relative whitespace-nowrap px-3 py-2.5 uppercase', meta.align === 'right' ? 'text-right' : 'text-left', (i === 0 || pinned) && 'sticky z-10', i === 0 && !pinned && 'left-0')}>
                      <span className={clsx('inline-flex items-center gap-1', meta.align === 'right' && 'flex-row-reverse')}>
                        <button onClick={h.column.getToggleSortingHandler()} className="inline-flex items-center gap-1 hover:text-ink">
                          {flexRender(h.column.columnDef.header, h.getContext())}
                          {s === 'asc' ? <ArrowUp size={11} className="text-accent" /> : s === 'desc' ? <ArrowDown size={11} className="text-accent" /> : null}
                          {s && sorting.length > 1 && <span className="text-[9px]">{h.column.getSortIndex() + 1}</span>}
                        </button>
                        <ColumnFilter col={meta.col} value={h.column.getFilterValue()} onChange={(v) => h.column.setFilterValue(v)} values={vals} />
                      </span>
                      <span onMouseDown={h.getResizeHandler()} onTouchStart={h.getResizeHandler()} className={clsx('absolute right-0 top-1 h-[calc(100%-8px)] w-1 cursor-col-resize rounded bg-accent/0 hover:bg-accent/50', h.column.getIsResizing() && 'bg-accent')} />
                    </th>
                  );
                })}
              </tr>
            ))}
          </thead>
          <tbody>
            {table.getRowModel().rows.map((r: TRow<Row>) => (
              <tr key={r.id} className={clsx('group/tr border-t border-line/60 transition-colors hover:[&>td:not(.sticky)]:!bg-accent-soft/50', r.getIsGrouped() && 'bg-surface-2/50', r.original?.__partial ? 'italic' : '')}>
                {r.getVisibleCells().map((cell, i) => {
                  const meta = cell.column.columnDef.meta as { align: string; col: Column };
                  const c = meta.col;
                  const n = Number(cell.getValue());
                  const rg = ranges[c.key];
                  const pinned = cell.column.getIsPinned();
                  const scale = rg && isFinite(n) && c.kind !== 'change' && rg[1] > rg[0] ? (n - rg[0]) / (rg[1] - rg[0]) : null;
                  const heatBg = heat && scale !== null && !r.getIsGrouped() ? `color-mix(in srgb, var(--accent) ${Math.round(scale * 30)}%, transparent)` : undefined;
                  const drillable = cd.canKey(c.key) && !cell.getIsPlaceholder();
                  const onClick = drillable ? () => (r.getIsGrouped() ? cd.open(null, c.key, groupSlice(r)) : cd.open(r.original, c.key)) : undefined;
                  return (
                    <td key={cell.id} onClick={onClick} style={{ background: heatBg && (i === 0 || pinned) ? `linear-gradient(${heatBg}, ${heatBg}), var(--surface)` : heatBg, width: cell.column.getSize(), left: pinned ? cell.column.getStart('left') : undefined }}
                      className={clsx('relative whitespace-nowrap px-3', dense ? 'py-1' : 'py-2', meta.align === 'right' ? 'text-right' : 'text-left', (i === 0 || pinned) && 'sticky z-[1]', i === 0 && !pinned && 'left-0',
                        drillable && 'drill-cell cursor-pointer')}>
                      {bars && scale !== null && !r.getIsGrouped() && <span className="pointer-events-none absolute inset-y-1.5 right-1 rounded-sm bg-accent/15" style={{ width: `calc(${Math.max(2, scale * 100)}% - 8px)` }} />}
                      <span className="relative">
                        {cell.getIsGrouped() ? (
                          <button onClick={(e) => { e.stopPropagation(); r.getToggleExpandedHandler()(); }} className="inline-flex items-center gap-1.5 font-medium" style={{ paddingLeft: r.depth * 14 }}>
                            {r.getIsExpanded() ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
                            {renderValue(c, cell.getValue())}<span className="text-[11px] font-normal text-ink-3">({r.getLeafRows().length})</span>
                          </button>
                        ) : cell.getIsAggregated() ? flexRender(cell.column.columnDef.aggregatedCell ?? cell.column.columnDef.cell, cell.getContext())
                          : cell.getIsPlaceholder() ? null : flexRender(cell.column.columnDef.cell, cell.getContext())}
                      </span>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t-2 border-line bg-surface-2/80 font-semibold">
              {visibleCols.map((col, i) => {
                const c = (col.columnDef.meta as { col: Column }).col;
                const v = totalFor(c);
                const drillable = !isFiltered && !records && cd.canKey(c.key) && v !== undefined;
                return (
                  <td key={col.id} onClick={drillable ? () => cd.open(null, c.key) : undefined} className={clsx('whitespace-nowrap px-3 py-2.5', isNumFmt(c.format) && c.kind !== 'period' ? 'text-right' : 'text-left', i === 0 && 'sticky left-0 bg-surface-2', drillable && 'drill-cell cursor-pointer')}>
                    {i === 0 ? (isFiltered ? 'Total (filtered)' : 'Total') : v === undefined ? '' : c.kind === 'change' ? renderValue(c, v) : <span className="tabular">{fmt(v, c.format)}{totalIsAvg(c) && <span className="ml-1 text-[10px] font-normal text-ink-3">avg</span>}</span>}
                  </td>
                );
              })}
            </tr>
          </tfoot>
        </table>
      </div>
      {table.getPageCount() > 1 && (
        <div className="mt-2 flex items-center justify-end gap-2 text-xs text-ink-3">
          <span>Page {table.getState().pagination.pageIndex + 1} of {table.getPageCount()}</span>
          <button className="rounded-md border border-line px-2 py-1 hover:bg-surface-2 disabled:opacity-40" disabled={!table.getCanPreviousPage()} onClick={() => table.previousPage()}>Prev</button>
          <button className="rounded-md border border-line px-2 py-1 hover:bg-surface-2 disabled:opacity-40" disabled={!table.getCanNextPage()} onClick={() => table.nextPage()}>Next</button>
          <select className="rounded-md border border-line bg-bg px-1 py-1" value={table.getState().pagination.pageSize} onChange={(e) => table.setPageSize(Number(e.target.value))}>
            {[10, 15, 25, 50, 100, 500].map((n) => <option key={n} value={n}>{n} / page</option>)}
          </select>
        </div>
      )}
    </div>
  );
}

/* ───────────────────────────── Ranked (leaderboard with share & Pareto) ───────────────────────────── */
function labelOf(result: Result, r: Row) {
  const grain = (result.spec?.grain as string) ?? 'month';
  return result.columns.filter((c) => c.kind === 'dimension' || c.kind === 'period').map((c) => (c.kind === 'period' ? fmtPeriod(String(r[c.key] ?? ''), grain) : r[c.key] === null || r[c.key] === '' ? '(blank)' : String(r[c.key]))).join(' · ') || 'All';
}
function RankedView({ result, lead }: { result: Result; lead?: ReactNode }) {
  const additive = useAdditive();
  const polarity = usePolarity();
  const cd = useCellDrill(result);
  const metrics = result.columns.filter((c) => c.kind === 'metric');
  const [mk, setMk] = useState(metrics[0]?.key);
  const [dir, setDir] = useState<'desc' | 'asc'>('desc');
  const [n, setN] = useState(25);
  const m = metrics.find((c) => c.key === mk) ?? metrics[0];
  if (!m) return null;
  const add = additive(m);
  const rows = [...result.rows].filter((r) => r[m.key] !== null && r[m.key] !== undefined).sort((a, b) => (dir === 'desc' ? 1 : -1) * ((Number(b[m.key]) || 0) - (Number(a[m.key]) || 0)));
  const total = rows.reduce((a, r) => a + (Number(r[m.key]) || 0), 0);
  const max = Math.max(...rows.map((r) => Math.abs(Number(r[m.key]) || 0)), 1e-9);
  let cum = 0;
  const others = metrics.filter((c) => c.key !== m.key).slice(0, 3);
  const hasChg = result.columns.some((c) => c.key === `${m.key}__chg`);
  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-1.5 text-xs">
        {lead}
        <select value={m.key} onChange={(e) => setMk(e.target.value)} className="field">{metrics.map((c) => <option key={c.key} value={c.key}>Rank by {c.label}</option>)}</select>
        <button onClick={() => setDir(dir === 'desc' ? 'asc' : 'desc')} className={btn()}>{dir === 'desc' ? <ArrowDown size={13} /> : <ArrowUp size={13} />}{dir === 'desc' ? 'Highest first' : 'Lowest first'}</button>
        <select value={n} onChange={(e) => setN(Number(e.target.value))} className="field">{[10, 25, 50, 100, 1000].map((x) => <option key={x} value={x}>Top {x}</option>)}</select>
        <span className="ml-auto text-[11px] text-ink-3">{rows.length} ranked{add ? ' · share & cumulative share (Pareto)' : ''}</span>
      </div>
      <div className="data-wrap">
        {rows.slice(0, n).map((r, i) => {
          const v = Number(r[m.key]) || 0;
          cum += v;
          const chg = r[`${m.key}__chg`] as number | null | undefined;
          const pol = polarity(m.key);
          return (
            <div key={i} onClick={cd.canKey(m.key) ? () => cd.open(r, m.key) : undefined} className={clsx('group relative grid grid-cols-[36px_minmax(0,1fr)_auto] items-center gap-3 border-t border-line/70 px-3 py-2 first:border-t-0', cd.canKey(m.key) && 'cursor-pointer hover:bg-accent-soft/40')}>
              <div className={clsx('flex h-6 w-6 items-center justify-center rounded-full text-[11px] font-semibold tabular', i < 3 && dir === 'desc' ? 'bg-accent text-white' : 'bg-surface-2 text-ink-2')}>{i + 1}</div>
              <div className="min-w-0">
                <div className="truncate text-[13px] font-medium">{labelOf(result, r)}</div>
                <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-surface-2"><div className="bar-grow h-full rounded-full bg-accent/70" style={{ width: `${(Math.abs(v) / max) * 100}%`, animationDelay: `${i * 25}ms` }} /></div>
                {others.length > 0 && <div className="mt-1 flex flex-wrap gap-x-3 text-[11px] text-ink-3">{others.map((o) => <span key={o.key}>{o.label} <b className="font-medium text-ink-2 tabular">{fmt(r[o.key], o.format)}</b></span>)}</div>}
              </div>
              <div className="text-right">
                <div className="text-sm font-semibold tabular">{fmt(v, m.format)}</div>
                <div className="flex justify-end gap-2 text-[11px] tabular text-ink-3">
                  {add && total ? <span>{((v / total) * 100).toFixed(1)}% · cum {((cum / total) * 100).toFixed(0)}%</span> : null}
                  {hasChg && chg !== null && chg !== undefined && <span className={clsx(pol === 0 ? '' : chg * pol > 0 ? 'text-good' : 'text-bad')}>{fmtChange(chg, m.format === 'percent')}</span>}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ───────────────────────────── Transposed (metrics as rows, entities as columns) ───────────────────────────── */
function TransposedView({ result }: { result: Result }) {
  const renderValue = useRenderValue(result);
  const polarity = usePolarity();
  const cd = useCellDrill(result);
  const [cmp, setCmp] = useState<'chg' | 'all' | 'none'>('chg');
  const hasCmp = result.columns.some((c) => c.kind === 'comparison');
  const metrics = result.columns.filter((c) => c.kind === 'metric' || (c.kind === 'comparison' && cmp === 'all') || (c.kind === 'change' && cmp !== 'none'));
  const rows = result.rows.slice(0, 40);
  const additive = useAdditive();
  const best = (m: Column) => {
    const pol = polarity(m.key);
    if (m.kind !== 'metric' || !pol || rows.length < 2 || additive(m)) return -1; // rates only — volumes just reward the biggest format
    let bi = -1, bv = -Infinity;
    rows.forEach((r, i) => { const v = Number(r[m.key]); if (isFinite(v) && v * pol > bv) { bv = v * pol; bi = i; } });
    return bi;
  };
  return (
    <div>
      {hasCmp && (
        <div className="mb-3 flex items-center gap-2 text-xs text-ink-3">
          <div className="seg">{([['chg', 'Δ vs comparison'], ['all', 'Comparison + Δ'], ['none', 'Values only']] as const).map(([k, l]) => <button key={k} className={clsx(cmp === k && 'on')} onClick={() => setCmp(k)}>{l}</button>)}</div>
          <span className="ml-auto inline-flex items-center gap-1"><Trophy size={12} className="text-accent" />best rate in each row highlighted</span>
        </div>
      )}
      <div className="data-wrap overflow-x-auto">
        <table className="data-table w-full text-[13px]">
          <thead><tr>
            <th className="sticky left-0 z-10 px-3 py-2.5 text-left uppercase">Metric</th>
            {rows.map((r, i) => <th key={i} className="whitespace-nowrap px-3 py-2.5 text-right uppercase">{labelOf(result, r)}</th>)}
            {result.totals && <th className="border-l border-line px-3 py-2.5 text-right uppercase">Total</th>}
          </tr></thead>
          <tbody>{metrics.map((m) => {
            const bi = best(m);
            return (
              <tr key={m.key} className={clsx('border-t border-line/60', m.kind !== 'metric' && 'text-xs text-ink-3')}>
                <td className={clsx('sticky left-0 whitespace-nowrap bg-surface px-3 py-2', m.kind === 'metric' ? 'font-medium text-ink' : 'pl-6')}>{m.kind === 'metric' ? m.label : m.kind === 'change' ? `${m.label.replace(/^Δ/, 'Δ')} ${result.spec?.compare === 'previous_year' ? 'vs LY' : 'vs prev'}` : m.label}</td>
                {rows.map((r, i) => (
                  <td key={i} onClick={cd.canKey(m.key) ? () => cd.open(r, m.key) : undefined} className={clsx('whitespace-nowrap px-3 py-2 text-right', cd.canKey(m.key) && 'drill-cell cursor-pointer', i === bi && 'font-semibold text-accent')}>
                    {i === bi && <Trophy size={11} className="mr-1 inline -translate-y-px" />}{renderValue(m, r[m.key], r)}
                  </td>
                ))}
                {result.totals && <td onClick={cd.canKey(m.key) ? () => cd.open(null, m.key) : undefined} className={clsx('whitespace-nowrap border-l border-line px-3 py-2 text-right font-semibold', cd.canKey(m.key) && 'drill-cell cursor-pointer')}>{renderValue(m, result.totals[m.key])}</td>}
              </tr>
            );
          })}</tbody>
        </table>
      </div>
    </div>
  );
}

/* ───────────────────────────── Cards (one card per row) ───────────────────────────── */
function CardsView({ result }: { result: Result }) {
  const renderValue = useRenderValue(result);
  const cd = useCellDrill(result);
  const metrics = result.columns.filter((c) => c.kind === 'metric').slice(0, 6);
  return (
    <div className="grid gap-3" style={{ gridTemplateColumns: `repeat(auto-fit, minmax(230px, ${result.rows.length <= 4 ? '1fr' : '280px'}))` }}>
      {result.rows.map((r, i) => (
        <div key={i} className="card-in lift rounded-2xl border border-line bg-bg/40 p-4" style={{ animationDelay: `${Math.min(i, 20) * 30}ms` }}>
          <div className="mb-3 truncate text-sm font-semibold" title={labelOf(result, r)}>{labelOf(result, r)}</div>
          <div className="space-y-1.5">
            {metrics.map((m) => (
              <div key={m.key} onClick={cd.canKey(m.key) ? () => cd.open(r, m.key) : undefined} className={clsx('flex items-baseline justify-between gap-2 rounded-md px-1 text-[13px]', cd.canKey(m.key) && 'cursor-pointer hover:bg-surface-2')}>
                <span className="truncate text-ink-3">{m.label}</span>
                <span className="flex items-baseline gap-1.5"><b className="font-semibold tabular">{fmt(r[m.key], m.format)}</b>{r[`${m.key}__chg`] !== undefined && renderValue(result.columns.find((c) => c.key === `${m.key}__chg`)!, r[`${m.key}__chg`])}</span>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

/* ───────────────────────────── Statistics (distribution of every numeric column) ───────────────────────────── */
function StatsView({ result }: { result: Result }) {
  const additive = useAdditive();
  const cols = result.columns.filter((c) => isMetricCol(c) && c.kind !== 'change');
  const q = (s: number[], p: number) => { if (!s.length) return null; const i = (s.length - 1) * p; const lo = Math.floor(i), hi = Math.ceil(i); return s[lo] + (s[hi] - s[lo]) * (i - lo); };
  const stats = cols.map((c) => {
    const vs = result.rows.map((r) => Number(r[c.key])).filter((v) => isFinite(v)).sort((a, b) => a - b);
    const n = vs.length, sum = vs.reduce((a, b) => a + b, 0), mean = n ? sum / n : null;
    const sd = n > 1 && mean !== null ? Math.sqrt(vs.reduce((a, b) => a + (b - mean) ** 2, 0) / (n - 1)) : null;
    const maxRow = result.rows.find((r) => Number(r[c.key]) === vs[n - 1]); const minRow = result.rows.find((r) => Number(r[c.key]) === vs[0]);
    return { c, n, sum: additive(c) ? sum : null, mean, median: q(vs, 0.5), min: vs[0] ?? null, p25: q(vs, 0.25), p75: q(vs, 0.75), max: vs[n - 1] ?? null, sd, cv: sd !== null && mean ? sd / Math.abs(mean) : null, maxRow, minRow };
  });
  const H = ['Metric', 'Count', 'Sum', 'Mean', 'Median', 'Std dev', 'CV', 'Min', 'P25', 'P75', 'Max', 'Highest', 'Lowest'];
  return (
    <div className="data-wrap overflow-x-auto">
      <table className="data-table w-full text-[13px]">
        <thead className="bg-surface-2"><tr>{H.map((h, i) => <th key={h} className={clsx('whitespace-nowrap px-3 py-2 text-[11px] font-semibold uppercase tracking-wide text-ink-3', i === 0 || i > 10 ? 'text-left' : 'text-right')}>{h}</th>)}</tr></thead>
        <tbody>{stats.map((s) => (
          <tr key={s.c.key} className="border-t border-line/70 hover:bg-accent-soft/40">
            <td className="whitespace-nowrap px-3 py-2 font-medium">{s.c.label}</td>
            <td className="px-3 py-2 text-right tabular">{s.n}</td>
            {[s.sum, s.mean, s.median, s.sd].map((v, i) => <td key={i} className="whitespace-nowrap px-3 py-2 text-right tabular">{v === null ? '—' : fmt(v, s.c.format)}</td>)}
            <td className="px-3 py-2 text-right tabular">{s.cv === null ? '—' : `${(s.cv * 100).toFixed(0)}%`}</td>
            {[s.min, s.p25, s.p75, s.max].map((v, i) => <td key={i} className="whitespace-nowrap px-3 py-2 text-right tabular">{v === null ? '—' : fmt(v, s.c.format)}</td>)}
            <td className="max-w-[180px] truncate px-3 py-2 text-ink-2">{s.maxRow ? labelOf(result, s.maxRow) : '—'}</td>
            <td className="max-w-[180px] truncate px-3 py-2 text-ink-2">{s.minRow ? labelOf(result, s.minRow) : '—'}</td>
          </tr>
        ))}</tbody>
      </table>
    </div>
  );
}

/* ───────────────────────────── Month-on-month (months as columns, newest left) ───────────────────────────── */
function MomTable({ result, only, lead }: { result: Result; only?: string[]; lead?: ReactNode }) {
  const cd = useCellDrill(result);
  const polarity = usePolarity();
  const additive = useAdditive();
  const [showLY, setShowLY] = useState(true);
  const [heat, setHeat] = useState(true);
  const dim = result.columns.find((c) => c.kind === 'dimension');
  const metrics = result.columns.filter((c) => c.kind === 'metric' && (!only?.length || only.includes(c.key)));
  const hasLY = result.columns.some((c) => c.kind === 'comparison');
  const months = [...new Set(result.rows.map((r) => String(r.period)))].sort((a, b) => b.localeCompare(a)); // newest first
  const partial = new Set(result.rows.filter((r) => r.__partial).map((r) => String(r.period)));
  const dimVals = dim ? [...new Set(result.rows.map((r) => String(r[dim.key])))] : [''];
  const cell = new Map(result.rows.map((r) => [`${dim ? r[dim.key] : ''}\u0001${r.period}`, r]));

  type Line = { key: string; label: string; sub?: string; kind: 'metric' | 'ly' | 'chg'; metric: Column; dimVal: string; values: unknown[]; total: unknown; group?: boolean };
  const lines: Line[] = [];
  for (const dv of dimVals) {
    for (const m of metrics) {
      const vals = months.map((p) => cell.get(`${dv}\u0001${p}`)?.[m.key] ?? null);
      const total = !dim && result.totals?.[m.key] !== undefined ? result.totals[m.key] : additive(m) ? vals.reduce((a: number, v) => a + (Number(v) || 0), 0) : null;
      lines.push({ key: `${dv}|${m.key}`, label: m.label, sub: dim ? dv : undefined, kind: 'metric', metric: m, dimVal: dv, values: vals, total });
      if (hasLY && showLY) {
        const ly = months.map((p) => cell.get(`${dv}\u0001${p}`)?.[`${m.key}__prev`] ?? null);
        const lyTotal = !dim && result.totals?.[`${m.key}__prev`] !== undefined ? result.totals[`${m.key}__prev`] : additive(m) ? ly.reduce((a: number, v) => a + (Number(v) || 0), 0) : null;
        lines.push({ key: `${dv}|${m.key}|ly`, label: 'Last year', kind: 'ly', metric: m, dimVal: dv, values: ly, total: lyTotal });
        const chg = months.map((p) => cell.get(`${dv}\u0001${p}`)?.[`${m.key}__chg`] ?? null);
        const chgTotal = !dim ? result.totals?.[`${m.key}__chg`] ?? null : null;
        lines.push({ key: `${dv}|${m.key}|chg`, label: m.format === 'percent' ? 'YoY Δ pp' : 'YoY Δ %', kind: 'chg', metric: m, dimVal: dv, values: chg, total: chgTotal });
      }
    }
  }
  // grand-total line across dimension values (additive metrics only)
  const totalLines = dim ? metrics.filter((m) => additive(m)).map((m) => ({
    m, values: months.map((p) => dimVals.reduce((a, dv) => a + (Number(cell.get(`${dv}\u0001${p}`)?.[m.key]) || 0), 0)),
  })) : [];

  const rowRange = (l: Line) => { const vs = l.values.map(Number).filter(isFinite); return [Math.min(...vs), Math.max(...vs)] as [number, number]; };
  const label = (p: string) => fmtPeriod(p, 'month');
  const exportCsv = () => csvDownload(`${result.title ?? 'month-on-month'}`, [dim?.label ?? '', 'Metric', ...months.map(label), 'Total'],
    [...lines.map((l) => [l.sub ?? '', l.kind === 'metric' ? l.label : `${l.metric.label} — ${l.label}`, ...l.values.map((v) => v as number), l.total as number]),
     ...totalLines.map((t) => ['All', t.m.label, ...t.values, t.values.reduce((a, b) => a + b, 0)])]);

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-1.5 text-xs">
        {lead}
        {hasLY && <button onClick={() => setShowLY((s) => !s)} className={btn(showLY)}><Rows3 size={13} />Last year rows</button>}
        <button onClick={() => setHeat((h) => !h)} className={btn(heat)}><Flame size={13} />Heat</button>
        <button onClick={exportCsv} className={btn()}><Download size={13} />CSV</button>
        <span className="ml-auto text-[11px] text-ink-3">{months.length} months · newest on the left</span>
      </div>
      <div className="data-wrap overflow-x-auto">
        <table className="data-table w-full text-[13px]">
          <thead className="bg-surface-2">
            <tr>
              {dim && <th className="sticky left-0 z-10 w-[140px] min-w-[140px] max-w-[140px] bg-surface-2 px-3 py-2 text-left text-[11px] font-medium uppercase tracking-wide text-ink-3">{dim.label}</th>}
              <th className={clsx('sticky z-10 min-w-[170px] bg-surface-2 px-3 py-2 text-left text-[11px] font-medium uppercase tracking-wide text-ink-3', dim ? 'left-[140px]' : 'left-0')}>Metric</th>
              {months.map((p) => <th key={p} className="whitespace-nowrap px-3 py-2 text-right text-[11px] font-medium uppercase tracking-wide text-ink-3">{label(p)}{partial.has(p) && <div className="text-[9px] normal-case text-warn">partial</div>}</th>)}
              <th className="whitespace-nowrap border-l border-line px-3 py-2 text-right text-[11px] font-semibold uppercase tracking-wide text-ink-2">Total</th>
            </tr>
          </thead>
          <tbody>
            {lines.map((l, i) => {
              const rg = rowRange(l);
              const first = l.kind === 'metric' && (i === 0 || lines[i - 1].dimVal !== l.dimVal);
              return (
                <tr key={l.key} className={clsx('hover:bg-surface-2/60', l.kind === 'metric' ? 'border-t border-line' : '', first && dim && i > 0 && 'border-t-2')}>
                  {dim && <td className="sticky left-0 w-[140px] min-w-[140px] max-w-[140px] truncate bg-surface px-3 py-1.5 font-medium" title={l.sub}>{first ? l.sub : ''}</td>}
                  <td className={clsx('sticky bg-surface px-3 py-1.5 whitespace-nowrap', dim ? 'left-[140px]' : 'left-0', l.kind === 'metric' ? 'font-medium' : 'pl-6 text-xs text-ink-3')}>{l.label}</td>
                  {l.values.map((v, j) => {
                    const n = Number(v);
                    const pol = polarity(l.metric.key);
                    const bg = heat && l.kind === 'metric' && isFinite(n) && rg[1] > rg[0] ? `color-mix(in srgb, var(--accent) ${Math.round(((n - rg[0]) / (rg[1] - rg[0])) * 24)}%, transparent)` : undefined;
                    const dkey = l.kind === 'ly' ? `${l.metric.key}__prev` : l.metric.key;
                    const can = l.kind !== 'chg' && v !== null && cd.canKey(dkey);
                    const src = cell.get(`${l.dimVal}\u0001${months[j]}`);
                    return (
                      <td key={j} style={{ background: bg }} onClick={can ? () => cd.open(src ?? null, dkey, { period: months[j], ...(dim ? { [dim.key]: src?.[dim.key] ?? l.dimVal } : {}) }) : undefined} className={clsx('whitespace-nowrap px-3 py-1.5 text-right tabular', l.kind === 'ly' && 'text-xs text-ink-3', partial.has(months[j]) && 'italic', can && 'drill-cell cursor-pointer')}>
                        {l.kind === 'chg' ? <span className={clsx('text-xs font-medium', v === null || !isFinite(n) || n === 0 || pol === 0 ? 'text-ink-3' : n * pol > 0 ? 'text-good' : 'text-bad')}>{fmtChange(v, l.metric.format === 'percent')}</span> : fmt(v, l.metric.format)}
                      </td>
                    );
                  })}
                  <td onClick={l.kind === 'metric' && cd.canKey(l.metric.key) ? () => cd.open(null, l.metric.key, dim ? { [dim.key]: result.rows.find((r) => String(r[dim.key]) === l.dimVal)?.[dim.key] ?? l.dimVal } : {}) : undefined} className={clsx('whitespace-nowrap border-l border-line bg-surface-2/40 px-3 py-1.5 text-right font-semibold tabular', l.kind === 'metric' && cd.canKey(l.metric.key) && 'drill-cell cursor-pointer')}>
                    {l.kind === 'chg' ? (l.total === null ? '' : fmtChange(l.total, l.metric.format === 'percent')) : l.total === null ? <span className="font-normal text-ink-3" title="Ratio metrics can't be summed across months">—</span> : fmt(l.total, l.metric.format)}
                  </td>
                </tr>
              );
            })}
          </tbody>
          {totalLines.length > 0 && (
            <tfoot>
              {totalLines.map((t) => (
                <tr key={t.m.key} className="border-t-2 border-line bg-surface-2/70 font-semibold">
                  <td className="sticky left-0 w-[140px] min-w-[140px] bg-surface-2 px-3 py-2">Total</td>
                  <td className="sticky left-[140px] bg-surface-2 px-3 py-2 whitespace-nowrap">{t.m.label}</td>
                  {t.values.map((v, j) => <td key={j} onClick={cd.canKey(t.m.key) ? () => cd.open(null, t.m.key, { period: months[j] }) : undefined} className={clsx('px-3 py-2 text-right tabular whitespace-nowrap', cd.canKey(t.m.key) && 'drill-cell cursor-pointer')}>{fmt(v, t.m.format)}</td>)}
                  <td className="border-l border-line px-3 py-2 text-right tabular">{fmt(t.values.reduce((a, b) => a + b, 0), t.m.format)}</td>
                </tr>
              ))}
            </tfoot>
          )}
        </table>
      </div>
    </div>
  );
}


/** Re-query a metrics result with extra dimensions (any dimension its datasets support). */
function useRegroup(base: Result) {
  const catalog = useCatalog();
  const [result, setResult] = useState<Result>(base);
  const [loading, setLoading] = useState(false);
  useEffect(() => { setResult(base); }, [base]);
  const spec = result.spec as { metrics?: string[]; dimensions?: string[]; grain?: string } | undefined;
  const ok = result.kind === 'metrics' && !!spec?.metrics?.length;
  const allDims = useMemo(() => {
    if (!ok || !catalog) return [] as { key: string; label: string }[];
    const models = new Set(spec!.metrics!.map((m) => catalog.metrics.find((x) => x.id === m)?.dataset));
    const sets = [...models].map((md) => new Set(catalog.datasets.find((d) => d.id === md)?.dimensions ?? []));
    const inter = sets.length ? [...sets[0]].filter((x) => sets.every((st) => st.has(x))) : [];
    return inter.filter((x) => x !== 'client' && !(spec!.dimensions ?? []).includes(x)).map((x) => ({ key: x, label: catalog.dimensions[x]?.label ?? x })).sort((a, b) => a.label.localeCompare(b.label));
  }, [ok, catalog, spec]);
  const addDim = async (dim: string) => {
    setLoading(true);
    try {
      const r = await api<Result>('/api/query', { method: 'POST', json: { ...spec, dimensions: [...(spec?.dimensions ?? []), dim], start: result.period?.start, end: result.period?.end, limit: 5000, sort: { by: spec!.metrics![0], dir: 'desc' } } });
      r.title = result.title; setResult(r);
    } finally { setLoading(false); }
  };
  return { result, allDims, addDim, loading };
}

/* ───────────────────────────── Pivot (choose rows × columns × value) ───────────────────────────── */
function PivotView({ result: base, lead }: { result: Result; lead?: ReactNode }) {
  const rg = useRegroup(base);
  const result = rg.result;
  const cd = useCellDrill(result);
  const additive = useAdditive();
  const axes = result.columns.filter((c) => c.kind === 'dimension' || c.kind === 'period');
  const values = result.columns.filter((c) => c.kind === 'metric' || c.kind === 'comparison');
  const [rk, setRk] = useState(axes[axes.length > 1 && axes[0].kind === 'period' ? 1 : 0]?.key);
  const [ck, setCk] = useState(axes.find((a) => a.key !== rk)?.key ?? axes[0]?.key);
  const [vk, setVk] = useState(values[0]?.key);
  const more = rg.allDims.length ? <optgroup label="Add a dimension…">{rg.allDims.map((x) => <option key={x.key} value={`+${x.key}`}>{x.label}</option>)}</optgroup> : null;
  const pick = async (v: string, set: (k: string) => void) => { if (v.startsWith('+')) { await rg.addDim(v.slice(1)); set(v.slice(1)); } else set(v); };
  const vCol = values.find((c) => c.key === vk);
  const rCol = axes.find((c) => c.key === rk), cCol = axes.find((c) => c.key === ck);
  const lab = (c: Column | undefined, v: string) => (c?.kind === 'period' ? fmtPeriod(v, (result.spec?.grain as string) ?? 'month') : v || '(blank)');
  let colVals = [...new Set(result.rows.map((r) => String(r[ck])))];
  colVals = cCol?.kind === 'period' ? colVals.sort((a, b) => b.localeCompare(a)) : colVals.sort();
  const rowVals = [...new Set(result.rows.map((r) => String(r[rk])))];
  const rawOf = (k: string, sv: string) => { const hit = result.rows.find((r) => String(r[k]) === sv); return hit ? hit[k] : sv; };
  const map = new Map<string, number>();
  const cnt = new Map<string, number>();
  for (const r of result.rows) { const k = `${r[rk]}\u0001${r[ck]}`; map.set(k, (map.get(k) ?? 0) + (Number(r[vk]) || 0)); cnt.set(k, (cnt.get(k) ?? 0) + 1); }
  const add = vCol ? additive(vCol) : true;
  const val = (k: string) => (map.has(k) ? (add ? map.get(k)! : map.get(k)! / cnt.get(k)!) : null);
  const max = Math.max(...[...map.keys()].map((k) => Math.abs(val(k) ?? 0)), 0);
  const sel = 'field';
  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-1.5 text-xs text-ink-2">
        {lead}
        Rows <select className={sel} value={rk} onChange={(e) => pick(e.target.value, setRk)}>{axes.map((a) => <option key={a.key} value={a.key}>{a.label}</option>)}{more}</select>
        Columns <select className={sel} value={ck} onChange={(e) => pick(e.target.value, setCk)}>{axes.map((a) => <option key={a.key} value={a.key}>{a.label}</option>)}{more}</select>
        {rg.loading && <span className="h-3 w-3 animate-spin rounded-full border-2 border-line border-t-accent" />}
        Value <select className={sel} value={vk} onChange={(e) => setVk(e.target.value)}>{values.map((a) => <option key={a.key} value={a.key}>{a.label}</option>)}</select>
      </div>
      {rk === ck ? <div className="text-sm text-ink-3">Choose different row and column fields.</div> : (
        <div className="data-wrap overflow-x-auto">
          <table className="data-table w-full text-[13px]">
            <thead className="bg-surface-2"><tr>
              <th className="sticky left-0 bg-surface-2 px-3 py-2 text-left text-[11px] font-medium uppercase tracking-wide text-ink-3">{rCol?.label} \ {cCol?.label}</th>
              {colVals.map((c) => <th key={c} className="whitespace-nowrap px-3 py-2 text-right text-[11px] font-medium uppercase tracking-wide text-ink-3">{lab(cCol, c)}</th>)}
              <th className="border-l border-line px-3 py-2 text-right text-[11px] font-semibold uppercase tracking-wide text-ink-2">{add ? 'Total' : 'Average'}</th>
            </tr></thead>
            <tbody>{rowVals.map((r) => {
              const vs = colVals.map((c) => val(`${r}\u0001${c}`));
              const nums = vs.filter((v): v is number => v !== null);
              const t = add ? nums.reduce((a, b) => a + b, 0) : nums.length ? nums.reduce((a, b) => a + b, 0) / nums.length : null;
              return (
                <tr key={r} className="border-t border-line hover:bg-surface-2/60">
                  <td className="sticky left-0 whitespace-nowrap bg-surface px-3 py-1.5 font-medium">{lab(rCol, r)}</td>
                  {vs.map((v, i) => <td key={i} onClick={v !== null && cd.canKey(vk) ? () => cd.open(null, vk, { [rk]: rawOf(rk, r), [ck]: rawOf(ck, colVals[i]) }) : undefined} className={clsx('whitespace-nowrap px-3 py-1.5 text-right tabular', v !== null && cd.canKey(vk) && 'drill-cell cursor-pointer')} style={{ background: v !== null && max ? `color-mix(in srgb, var(--accent) ${Math.round((Math.abs(v) / max) * 22)}%, transparent)` : undefined }}>{fmt(v, vCol?.format)}</td>)}
                  <td className="whitespace-nowrap border-l border-line bg-surface-2/40 px-3 py-1.5 text-right font-semibold tabular">{fmt(t, vCol?.format)}</td>
                </tr>
              );
            })}</tbody>
            <tfoot><tr className="border-t-2 border-line bg-surface-2/70 font-semibold">
              <td className="sticky left-0 bg-surface-2 px-3 py-2">{add ? 'Total' : 'Average'}</td>
              {colVals.map((c) => { const vs = rowVals.map((r) => val(`${r}\u0001${c}`)).filter((v): v is number => v !== null); const t = add ? vs.reduce((a, b) => a + b, 0) : vs.length ? vs.reduce((a, b) => a + b, 0) / vs.length : null; return <td key={c} className="whitespace-nowrap px-3 py-2 text-right tabular">{fmt(t, vCol?.format)}</td>; })}
              <td className="border-l border-line px-3 py-2 text-right tabular">{(() => { const vs = [...map.keys()].map(val).filter((v): v is number => v !== null); return fmt(add ? vs.reduce((a, b) => a + b, 0) : vs.length ? vs.reduce((a, b) => a + b, 0) / vs.length : null, vCol?.format); })()}</td>
            </tr></tfoot>
          </table>
        </div>
      )}
    </div>
  );
}
