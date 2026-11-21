import { useMemo, useState, Fragment } from 'react';
import {
  useReactTable, getCoreRowModel, getSortedRowModel, getFilteredRowModel, getPaginationRowModel,
  flexRender, type ColumnDef, type SortingState, type VisibilityState,
} from '@tanstack/react-table';
import { ArrowDown, ArrowUp, ChevronDown, ChevronRight, Columns3, Search } from 'lucide-react';
import clsx from 'clsx';
import type { Column, Result } from '../../lib/types';
import { fmt, fmtChange, fmtPeriod } from '../../lib/format';
import { usePolarity } from '../../lib/catalog';

type Row = Record<string, unknown>;

export function DataTable({ result, columns: only, pageSize = 15, dense }: { result: Result; columns?: string[]; pageSize?: number; dense?: boolean }) {
  const polarity = usePolarity();
  const grain = (result.spec?.grain as string) ?? 'month';
  const cols = useMemo(() => {
    const all = result.columns;
    if (!only?.length) return all;
    const keep = new Set(only);
    // keep comparison/change columns of selected metrics
    return all.filter((c) => keep.has(c.key) || keep.has(c.key.replace(/__(prev|chg)$/, '')));
  }, [result.columns, only]);

  // max per metric column for in-cell data bars
  const maxes = useMemo(() => {
    const m: Record<string, number> = {};
    for (const c of cols) if (c.kind === 'metric' && c.format !== 'percent') m[c.key] = Math.max(0, ...result.rows.map((r) => Math.abs(Number(r[c.key]) || 0)));
    return m;
  }, [cols, result.rows]);

  const [sorting, setSorting] = useState<SortingState>([]);
  const [filter, setFilter] = useState('');
  const [visibility, setVisibility] = useState<VisibilityState>({});
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [showCols, setShowCols] = useState(false);
  const hidden = result.columns.filter((c) => !cols.includes(c));

  const defs = useMemo<ColumnDef<Row>[]>(() => cols.map((c: Column) => ({
    id: c.key, accessorFn: (r) => r[c.key], header: c.label,
    sortingFn: (a, b, id) => {
      const x = a.getValue(id), y = b.getValue(id);
      if (typeof x === 'number' && typeof y === 'number') return x - y;
      return String(x ?? '').localeCompare(String(y ?? ''));
    },
    cell: (info) => {
      const v = info.getValue();
      if (c.kind === 'change') {
        const metricKey = c.key.replace(/__chg$/, '');
        const pp = result.columns.find((x) => x.key === metricKey)?.format === 'percent' || info.row.original.format === 'percent';
        const pol = info.row.original.metric_id ? polarity(String(info.row.original.metric_id)) : polarity(metricKey);
        const n = Number(v);
        const tone = v === null || v === undefined || !isFinite(n) || n === 0 || pol === 0 ? 'text-ink-2' : n * pol > 0 ? 'text-good' : 'text-bad';
        return <span className={clsx('tabular font-medium', tone)}>{fmtChange(v, pp)}</span>;
      }
      if (c.kind === 'period') return <span className="whitespace-nowrap">{fmtPeriod(String(v ?? ''), grain)}{info.row.original.__partial ? <span className="ml-1.5 rounded bg-warn/10 px-1 text-[10px] text-warn">partial</span> : null}</span>;
      if (c.kind === 'metric' || c.kind === 'comparison') {
        const max = maxes[c.key];
        const n = Math.abs(Number(v) || 0);
        return (
          <div className="relative">
            {c.kind === 'metric' && max ? <div className="absolute inset-y-[-3px] right-0 rounded-sm bg-accent/10" style={{ width: `${(n / max) * 100}%` }} /> : null}
            <span className={clsx('relative tabular', c.kind === 'comparison' && 'text-ink-3')}>{fmt(v, (['value', 'trailing_avg'].includes(c.key) && info.row.original.format ? info.row.original.format : c.format) as never)}</span>
          </div>
        );
      }
      return <span className="block max-w-[280px] truncate whitespace-nowrap text-ink" title={String(v ?? '')}>{fmt(v, c.format)}</span>;
    },
    meta: { align: c.kind === 'dimension' || c.kind === 'period' ? 'left' : 'right' },
  })), [cols, maxes, polarity, result.columns, grain]);

  const table = useReactTable({
    data: result.rows, columns: defs, state: { sorting, globalFilter: filter, columnVisibility: visibility },
    onSortingChange: setSorting, onGlobalFilterChange: setFilter, onColumnVisibilityChange: setVisibility,
    getCoreRowModel: getCoreRowModel(), getSortedRowModel: getSortedRowModel(), getFilteredRowModel: getFilteredRowModel(),
    getPaginationRowModel: getPaginationRowModel(), initialState: { pagination: { pageSize } },
    globalFilterFn: (row, _id, value) => Object.values(row.original).some((v) => String(v ?? '').toLowerCase().includes(String(value).toLowerCase())),
  });
  const totals = result.totals;
  const showTools = result.rows.length > 8;

  return (
    <div>
      {showTools && (
        <div className="mb-2 flex items-center gap-2">
          <div className="relative">
            <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-3" />
            <input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Search rows" className="h-8 w-52 rounded-lg border border-line bg-bg pl-8 pr-2 text-sm outline-none focus:border-accent" />
          </div>
          <div className="relative">
            <button onClick={() => setShowCols((s) => !s)} className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-line px-2.5 text-xs text-ink-2 hover:bg-surface-2"><Columns3 size={14} />Columns</button>
            {showCols && (
              <div className="absolute z-20 mt-1 max-h-72 w-60 overflow-auto rounded-xl border border-line bg-surface p-2 shadow-xl">
                {table.getAllLeafColumns().map((c) => (
                  <label key={c.id} className="flex cursor-pointer items-center gap-2 rounded px-2 py-1 text-sm hover:bg-surface-2">
                    <input type="checkbox" checked={c.getIsVisible()} onChange={c.getToggleVisibilityHandler()} />
                    {String(c.columnDef.header)}
                  </label>
                ))}
              </div>
            )}
          </div>
          <span className="ml-auto text-xs text-ink-3">{table.getFilteredRowModel().rows.length.toLocaleString('en-IN')} rows{result.truncated ? ` (of ${result.rowCount.toLocaleString('en-IN')})` : ''}</span>
        </div>
      )}
      <div className="overflow-x-auto rounded-xl border border-line">
        <table className={clsx('w-full text-sm', dense && 'text-[13px]')}>
          <thead className="bg-surface-2/60">
            {table.getHeaderGroups().map((hg) => (
              <tr key={hg.id}>
                {hidden.length > 0 && <th className="w-6" />}
                {hg.headers.map((h) => {
                  const align = (h.column.columnDef.meta as { align: string }).align;
                  const s = h.column.getIsSorted();
                  return (
                    <th key={h.id} onClick={h.column.getToggleSortingHandler()} className={clsx('cursor-pointer select-none whitespace-nowrap px-3 py-2 text-xs font-medium text-ink-2 hover:text-ink', align === 'right' ? 'text-right' : 'text-left')}>
                      <span className="inline-flex items-center gap-1">{flexRender(h.column.columnDef.header, h.getContext())}{s === 'asc' ? <ArrowUp size={12} /> : s === 'desc' ? <ArrowDown size={12} /> : null}</span>
                    </th>
                  );
                })}
              </tr>
            ))}
          </thead>
          <tbody>
            {table.getRowModel().rows.map((r) => (
              <Fragment key={r.id}>
                <tr className={clsx('border-t border-line hover:bg-surface-2/50', r.original.__partial ? 'italic' : '')}>
                  {hidden.length > 0 && (
                    <td className="pl-2"><button onClick={() => setExpanded((e) => ({ ...e, [r.id]: !e[r.id] }))} className="text-ink-3 hover:text-ink">{expanded[r.id] ? <ChevronDown size={14} /> : <ChevronRight size={14} />}</button></td>
                  )}
                  {r.getVisibleCells().map((cell) => (
                    <td key={cell.id} className={clsx('px-3', dense ? 'py-1.5' : 'py-2', (cell.column.columnDef.meta as { align: string }).align === 'right' ? 'text-right' : 'text-left')}>
                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </td>
                  ))}
                </tr>
                {expanded[r.id] && (
                  <tr className="bg-surface-2/40"><td colSpan={99} className="px-10 py-3">
                    <div className="grid grid-cols-2 gap-x-8 gap-y-1 text-xs sm:grid-cols-3">
                      {hidden.map((c) => <div key={c.key} className="flex justify-between gap-3"><span className="text-ink-3">{c.label}</span><span className="tabular">{fmt(r.original[c.key], c.format)}</span></div>)}
                    </div>
                  </td></tr>
                )}
              </Fragment>
            ))}
          </tbody>
          {totals && cols.some((c) => c.kind === 'metric' && totals[c.key] !== undefined) && (
            <tfoot>
              <tr className="border-t-2 border-line bg-surface-2/40 font-medium">
                {hidden.length > 0 && <td />}
                {table.getVisibleLeafColumns().map((col, i) => {
                  const c = cols.find((x) => x.key === col.id)!;
                  const v = totals[c.key];
                  return <td key={col.id} className={clsx('px-3 py-2', c.kind === 'dimension' || c.kind === 'period' ? 'text-left' : 'text-right')}>
                    {i === 0 ? 'Total' : c.kind === 'change' ? <span className="tabular">{fmtChange(v, result.columns.find((x) => x.key === c.key.replace(/__chg$/, ''))?.format === 'percent')}</span> : c.kind === 'metric' || c.kind === 'comparison' ? <span className="tabular">{fmt(v, c.format)}</span> : ''}
                  </td>;
                })}
              </tr>
            </tfoot>
          )}
        </table>
      </div>
      {table.getPageCount() > 1 && (
        <div className="mt-2 flex items-center justify-end gap-2 text-xs text-ink-3">
          <span>Page {table.getState().pagination.pageIndex + 1} of {table.getPageCount()}</span>
          <button className="rounded border border-line px-2 py-1 disabled:opacity-40" disabled={!table.getCanPreviousPage()} onClick={() => table.previousPage()}>Prev</button>
          <button className="rounded border border-line px-2 py-1 disabled:opacity-40" disabled={!table.getCanNextPage()} onClick={() => table.nextPage()}>Next</button>
          <select className="rounded border border-line bg-bg px-1 py-1" value={table.getState().pagination.pageSize} onChange={(e) => table.setPageSize(Number(e.target.value))}>
            {[10, 15, 25, 50, 100].map((n) => <option key={n} value={n}>{n} / page</option>)}
          </select>
        </div>
      )}
    </div>
  );
}

export function PivotTable({ result, rows: rk, columns: ck, value: vk }: { result: Result; rows: string; columns: string; value: string }) {
  const colDef = result.columns.find((c) => c.key === vk);
  const grain = (result.spec?.grain as string) ?? 'month';
  const label = (k: string, v: unknown) => (result.columns.find((c) => c.key === k)?.kind === 'period' ? fmtPeriod(String(v), grain) : String(v ?? '(blank)'));
  const colVals = [...new Set(result.rows.map((r) => String(r[ck])))].sort();
  const rowVals = [...new Set(result.rows.map((r) => String(r[rk])))];
  const map = new Map(result.rows.map((r) => [`${r[rk]}\u0001${r[ck]}`, r[vk]]));
  const additive = colDef?.format !== 'percent' && colDef?.format !== 'decimal';
  const vals = result.rows.map((r) => Number(r[vk]) || 0);
  const max = Math.max(...vals, 0);
  return (
    <div className="overflow-x-auto rounded-xl border border-line">
      <table className="w-full text-sm">
        <thead className="bg-surface-2/60">
          <tr>
            <th className="px-3 py-2 text-left text-xs font-medium text-ink-2">{result.columns.find((c) => c.key === rk)?.label}</th>
            {colVals.map((c) => <th key={c} className="whitespace-nowrap px-3 py-2 text-right text-xs font-medium text-ink-2">{label(ck, c)}</th>)}
            {additive && <th className="px-3 py-2 text-right text-xs font-semibold text-ink-2">Total</th>}
          </tr>
        </thead>
        <tbody>
          {rowVals.map((r) => {
            const rowTotal = colVals.reduce((a, c) => a + (Number(map.get(`${r}\u0001${c}`)) || 0), 0);
            return (
              <tr key={r} className="border-t border-line hover:bg-surface-2/50">
                <td className="whitespace-nowrap px-3 py-2">{label(rk, r)}</td>
                {colVals.map((c) => {
                  const v = map.get(`${r}\u0001${c}`);
                  const n = Number(v) || 0;
                  return <td key={c} className="px-3 py-2 text-right tabular" style={{ background: max ? `color-mix(in srgb, var(--accent) ${Math.round((n / max) * 18)}%, transparent)` : undefined }}>{fmt(v, colDef?.format)}</td>;
                })}
                {additive && <td className="px-3 py-2 text-right font-medium tabular">{fmt(rowTotal, colDef?.format)}</td>}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
