import { useMemo, useState } from 'react';
import ReactEChartsCore from 'echarts-for-react/lib/core';
import clsx from 'clsx';
import { SlidersHorizontal, BarChart3, LineChart as LineIcon, AreaChart, BarChartHorizontal, PieChart as PieIcon, Layers, Combine, MousePointerClick } from 'lucide-react';
import type { Result, Format } from '../../lib/types';
import { fmt, fmtPeriod } from '../../lib/format';
import { echarts, useThemeColors, type ThemeColors } from '../../lib/echarts';
import { drillFor, useDrill } from '../../lib/drill';

/* eslint-disable @typescript-eslint/no-explicit-any */
type Opt = Record<string, any>;

function baseOption(t: ThemeColors): Opt {
  return {
    color: t.series,
    textStyle: { fontFamily: 'Inter, ui-sans-serif, system-ui', color: t.ink2 },
    animationDuration: 700, animationEasing: 'cubicOut',
    grid: { left: 8, right: 28, top: 44, bottom: 8, containLabel: true },
    tooltip: {
      backgroundColor: t.surface, borderColor: t.line, borderWidth: 1, padding: [8, 12],
      textStyle: { color: t.ink, fontSize: 12 }, extraCssText: 'border-radius:10px;box-shadow:0 12px 32px -12px rgba(0,0,0,.25);',
    },
    legend: { type: 'scroll', top: 0, left: 0, right: 120, icon: 'circle', itemWidth: 8, itemHeight: 8, itemGap: 14, textStyle: { color: t.ink2, fontSize: 12 }, pageIconColor: t.ink2, pageTextStyle: { color: t.ink3 } },
    toolbox: {
      right: 0, top: -2, itemSize: 12, itemGap: 12, iconStyle: { borderColor: t.ink3, opacity: 0.6 }, emphasis: { iconStyle: { borderColor: t.accent, opacity: 1 } },
      feature: {
        dataZoom: { yAxisIndex: 'none', title: { zoom: 'Box zoom', back: 'Reset zoom' } },
        dataView: { readOnly: true, title: 'Data view', lang: ['Data', 'Close', 'Refresh'], backgroundColor: t.surface, textColor: t.ink, textareaColor: t.surface2, textareaBorderColor: t.line, buttonColor: t.accent },
        restore: { title: 'Restore' },
        saveAsImage: { title: 'Save PNG', pixelRatio: 2, backgroundColor: t.surface },
      },
    },
  };
}
const axisCommon = (t: ThemeColors) => ({ axisLine: { lineStyle: { color: t.line } }, axisTick: { show: false }, axisLabel: { color: t.ink3, fontSize: 11 }, splitLine: { lineStyle: { color: t.grid } } });

function tooltipFmt(format: Format | undefined, xFmt: (v: string) => string) {
  return (ps: any) => {
    const arr = Array.isArray(ps) ? ps : [ps];
    const head = `<div style="font-weight:600;margin-bottom:4px">${xFmt(String(arr[0]?.axisValue ?? arr[0]?.name ?? ''))}</div>`;
    const lines = arr.filter((p: any) => p.value !== null && p.value !== undefined && p.seriesName && !String(p.seriesName).startsWith('__'))
      .map((p: any) => `<div style="display:flex;justify-content:space-between;gap:16px"><span>${p.marker}${p.seriesName}</span><b style="font-variant-numeric:tabular-nums">${fmt(Array.isArray(p.value) ? p.value[1] : p.value, format)}</b></div>`).join('');
    return head + lines + '<div style="margin-top:4px;font-size:10px;opacity:.6">Click to see the records</div>';
  };
}

/** Stable colours for well-known entities so the same format / studio is the same colour in every chart. */
const FIXED_COLOR: Record<string, number> = {
  'Barre': 0, 'powerCycle': 1, 'Strength Lab': 2, 'Other': 7,
  'Kwality House, Kemps Corner': 0, 'Supreme HQ, Bandra': 1, 'Kenkere House': 2, 'Pop-up': 3, 'The Studio by Copper + Cloves': 4, 'Plash Pilates': 5,
};
export function colorFor(name: string, i: number, palette: string[]): string {
  const f = FIXED_COLOR[name];
  return palette[(f ?? i) % palette.length];
}

export interface ChartProps { result: Result; chart?: string; x?: string; y?: string[]; seriesBy?: string; height?: number | string; avg?: boolean; labels?: boolean; zoom?: boolean; theme?: ThemeColors; bare?: boolean }

export function ChartBlock({ result, chart = 'bar', x, y, seriesBy, height = 300, avg, labels, zoom, theme, bare }: ChartProps) {
  const appTheme = useThemeColors();
  const t = theme ?? appTheme;
  const drill = useDrill();
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const cols = result.columns;
  const xKey = x ?? cols.find((c) => c.kind === 'period')?.key ?? cols.find((c) => c.kind === 'dimension')?.key ?? cols[0].key;
  const sBy = seriesBy && seriesBy !== xKey ? seriesBy : undefined;
  const yKeys = y?.length ? y : cols.filter((c) => c.kind === 'metric').map((c) => c.key).slice(0, sBy ? 1 : 3);
  const xCol = cols.find((c) => c.key === xKey);
  const grain = (result.spec?.grain as string) ?? 'month';
  const xFmt = (v: string) => (xCol?.kind === 'period' ? fmtPeriod(v, grain) : v === 'null' || v === '' ? '(blank)' : v);
  const formats = yKeys.map((k) => cols.find((c) => c.key === k)?.format);
  const format = formats[0];
  const mixed = new Set(formats).size > 1;

  const model = useMemo(() => {
    let cats = [...new Set(result.rows.map((r) => String(r[xKey])))];
    if (xCol?.kind === 'period') cats.sort();
    if (!sBy) {
      const byX = new Map(result.rows.map((r) => [String(r[xKey]), r]));
      return { cats, series: yKeys.map((k) => ({ id: k, name: cols.find((c) => c.key === k)?.label ?? k, data: cats.map((c) => { const v = byX.get(c)?.[k]; return v === null || v === undefined ? null : Number(v); }) })) };
    }
    const metric = yKeys[0];
    const totals = new Map<string, number>();
    for (const r of result.rows) totals.set(String(r[sBy]), (totals.get(String(r[sBy])) ?? 0) + (Number(r[metric]) || 0));
    let names = [...totals.entries()].sort((a, b) => b[1] - a[1]).map((e) => e[0]);
    const other = names.length > 8 ? names.slice(7) : [];
    names = names.slice(0, other.length ? 7 : 8);
    const cell = new Map<string, number>();
    for (const r of result.rows) {
      const s = String(r[sBy]); const target = names.includes(s) ? s : '__other';
      const k = `${target}\u0001${r[xKey]}`; cell.set(k, (cell.get(k) ?? 0) + (Number(r[metric]) || 0));
    }
    if (xCol?.kind !== 'period') cats = cats.sort((a, b) => (totals.get(b) ?? 0) - (totals.get(a) ?? 0));
    const series = [...names, ...(other.length ? ['__other'] : [])].map((n) => ({ id: n, name: n === '__other' ? `Other (${other.length})` : n === 'null' ? '(blank)' : n, data: cats.map((c) => cell.get(`${n}\u0001${c}`) ?? null) }));
    return { cats, series };
  }, [result.rows, xKey, sBy, yKeys.join(), cols, xCol?.kind]);

  if (mixed && chart !== 'pie') {
    return (
      <div className="grid gap-4 md:grid-cols-2">
        {yKeys.map((k) => (
          <div key={k}>
            <div className="mb-1 text-xs font-medium text-ink-2">{cols.find((c) => c.key === k)?.label}</div>
            <ChartBlock result={result} chart={chart === 'combo' ? 'bar' : chart} x={xKey} y={[k]} height={typeof height === 'number' ? Math.max(220, height - 80) : height} avg={avg} labels={labels} zoom={zoom} theme={theme} bare={bare} />
          </div>
        ))}
      </div>
    );
  }

  const onClick = (p: any) => {
    if (!drill) return;
    if (chart === 'pie') { const raw = p.data?.raw; const k = sBy ?? xKey; const req = drillFor(result, null, yKeys[0], { [k]: raw === 'null' ? null : raw }); if (req) drill(req); return; }
    const cat = model.cats[p.dataIndex];
    if (cat === undefined) return;
    const row: Record<string, unknown> = { [xKey]: cat === 'null' ? null : cat };
    let key = yKeys[0];
    if (sBy) { const sid = model.series[p.seriesIndex]?.id; if (!sid || sid === '__other') return; row[sBy] = sid === 'null' ? null : sid; }
    else if (chart !== 'pie') key = model.series[p.seriesIndex]?.id ?? key;
    const rawRow = sBy ? result.rows.find((r) => String(r[xKey]) === String(cat) && String(r[sBy]) === String(row[sBy])) : result.rows.find((r) => String(r[xKey]) === String(cat));
    const req = drillFor(result, rawRow ?? row, key, row);
    if (req) drill(req);
  };

  const o = baseOption(t);
  const valFmt = (v: number) => fmt(v, format, { compact: true });
  const ax = axisCommon(t);
  const stacked = chart === 'stacked_bar' || (chart === 'area' && !!sBy);

  if (chart === 'pie') {
    const metric = yKeys[0];
    const pk = sBy ?? xKey;
    const agg = new Map<string, number>();
    for (const r of result.rows) agg.set(String(r[pk]), (agg.get(String(r[pk])) ?? 0) + (Number(r[metric]) || 0));
    const pkCol = cols.find((c) => c.key === pk);
    const data = [...agg.entries()].map(([k, v]) => ({ name: pkCol?.kind === 'period' ? fmtPeriod(k, grain) : k === 'null' ? '(blank)' : k, raw: k, value: v })).filter((d) => d.value > 0).sort((a, b) => b.value - a.value).map((d, i) => ({ ...d, itemStyle: { color: colorFor(d.raw, i, t.series) } }));
    Object.assign(o, {
      legend: { ...o.legend, type: 'scroll', orient: 'vertical', right: 0, top: 'middle', left: undefined },
      toolbox: { ...o.toolbox, feature: { saveAsImage: o.toolbox.feature.saveAsImage, dataView: o.toolbox.feature.dataView } },
      tooltip: { ...o.tooltip, trigger: 'item', formatter: (p: any) => `${p.marker}${p.name}<br/><b>${fmt(p.value, format)}</b> · ${p.percent}%` },
      series: [{ type: 'pie', radius: ['52%', '80%'], center: ['38%', '52%'], itemStyle: { borderColor: t.surface, borderWidth: 2, borderRadius: 4 }, label: { show: !!labels, color: t.ink2, formatter: '{d}%' }, data,
        emphasis: { scaleSize: 6, label: { show: true, fontWeight: 600, formatter: (p: any) => `${p.name}\n${valFmt(p.value)}` } } }],
    });
  } else {
    const horizontal = chart === 'horizontal_bar';
    const catAxis = { ...ax, type: 'category', data: model.cats, axisLabel: { ...ax.axisLabel, formatter: xFmt, hideOverlap: true, width: horizontal ? 160 : undefined, overflow: 'truncate' }, splitLine: { show: false }, inverse: horizontal };
    const valAxis = { ...ax, type: 'value', axisLabel: { ...ax.axisLabel, formatter: valFmt }, axisLine: { show: false } };
    const avgLine = avg ? { markLine: { silent: true, symbol: 'none', lineStyle: { type: 'dashed', color: t.ink3 }, label: { color: t.ink3, fontSize: 10, formatter: (p: any) => `avg ${valFmt(p.value)}` }, data: [{ type: 'average' }] } } : {};
    const series = model.series.map((s, i) => {
      const isLine = chart === 'line' || chart === 'area' || (chart === 'combo' && i > 0);
      const color = s.id === '__other' ? t.ink3 : sBy ? colorFor(s.id, i, t.series) : t.series[i % 8];
      return {
        id: s.id, name: s.name, type: isLine ? 'line' : 'bar', data: s.data, color,
        stack: stacked ? 'total' : undefined, smooth: isLine ? 0.25 : undefined, showSymbol: isLine && model.cats.length < 24, symbolSize: 6, connectNulls: true,
        lineStyle: isLine ? { width: 2.25 } : undefined,
        areaStyle: chart === 'area' ? { opacity: sBy ? 0.55 : 1, color: sBy ? color : new echarts.graphic.LinearGradient(0, 0, 0, 1, [{ offset: 0, color: color + '55' }, { offset: 1, color: color + '05' }]) } : undefined,
        barMaxWidth: 38, itemStyle: !isLine ? { borderRadius: stacked ? 0 : horizontal ? [0, 4, 4, 0] : [4, 4, 0, 0] } : undefined,
        emphasis: { focus: 'series' },
        label: labels ? { show: true, position: horizontal ? 'right' : stacked ? 'inside' : 'top', color: t.ink2, fontSize: 10, formatter: (p: any) => (p.value ? valFmt(p.value) : '') } : undefined,
        ...(i === 0 ? avgLine : {}),
      };
    });
    Object.assign(o, {
      tooltip: { ...o.tooltip, trigger: 'axis', axisPointer: { type: chart === 'line' || chart === 'area' ? 'line' : 'shadow', shadowStyle: { color: t.surface2 + '99' }, lineStyle: { color: t.line } }, formatter: tooltipFmt(format, xFmt) },
      legend: { ...o.legend, show: series.length > 1 },
      xAxis: horizontal ? valAxis : catAxis, yAxis: horizontal ? catAxis : valAxis,
      dataZoom: zoom ? [{ type: 'inside', [horizontal ? 'yAxisIndex' : 'xAxisIndex']: 0 }, { type: 'slider', [horizontal ? 'yAxisIndex' : 'xAxisIndex']: 0, height: 18, bottom: 0, borderColor: t.line, fillerColor: t.accent + '22', handleStyle: { color: t.accent }, textStyle: { color: t.ink3, fontSize: 10 }, labelFormatter: (_: number, v: string) => xFmt(v) }] : undefined,
      grid: { ...o.grid, bottom: zoom ? 34 : 8, top: series.length > 1 ? 44 : 30 },
      series,
    });
  }
  if (bare) {
    o.toolbox = { show: false }; o.animation = false;
    const nSeries = chart === 'pie' ? 0 : model.series.length;
    o.legend = { ...o.legend, type: 'plain', right: 0, itemGap: 8, itemWidth: 7, itemHeight: 7, textStyle: { ...o.legend.textStyle, fontSize: 9 } };
    if (chart === 'pie') o.series[0] = { ...o.series[0], center: ['50%', '50%'], radius: ['44%', '74%'] };
    else if (o.grid) o.grid = { ...o.grid, top: 10, left: 2, right: 6 };
    void nSeries;
    if (o.xAxis?.axisLabel) o.xAxis.axisLabel.fontSize = 9; if (o.yAxis?.axisLabel) o.yAxis.axisLabel.fontSize = 9;
  }
  const h = chart === 'horizontal_bar' && typeof height === 'number' ? Math.max(height, model.cats.length * (bare ? 16 : 26) + (bare ? 36 : 60)) : height;
  // HTML legend above the canvas: wraps naturally and never collides with the plot or the toolbox
  const legendItems: { name: string; color: string }[] = chart === 'pie'
    ? ((o.series?.[0]?.data ?? []) as any[]).map((d) => ({ name: String(d.name), color: d.itemStyle?.color ?? t.ink3 }))
    : ((o.series ?? []) as any[]).filter((x) => !String(x.name).startsWith('__')).map((x) => ({ name: String(x.name), color: x.color ?? t.ink3 }));
  o.legend = { show: false, data: legendItems.map((i) => i.name), selected: Object.fromEntries([...hidden].map((n) => [n, false])) };
  if (o.grid && !bare && chart !== 'pie') o.grid = { ...o.grid, top: 30 };
  if (chart === 'pie' && !bare) o.series[0] = { ...o.series[0], center: ['50%', '52%'], radius: ['46%', '76%'] };
  const toggle = (n: string) => setHidden((hs) => { const x = new Set(hs); x.has(n) ? x.delete(n) : x.add(n); return x; });
  return (
    <div className="chart-wrap">
      {legendItems.length > 1 && (
        <div className="chart-legend">{legendItems.map((i) => (
          <button key={i.name} onClick={() => toggle(i.name)} className={clsx(hidden.has(i.name) && 'off')} title="Show / hide"><i style={{ background: i.color }} />{i.name}</button>
        ))}</div>
      )}
      <ReactEChartsCore echarts={echarts} option={o} notMerge lazyUpdate style={{ height: h, width: '100%', cursor: drill ? 'pointer' : undefined }} onEvents={{ click: onClick }} />
    </div>
  );
}

export function ForecastChart({ result, height = 320 }: { result: Result; height?: number }) {
  const t = useThemeColors();
  const format = (result.extra?.format as Format) ?? 'number';
  const split = !!result.extra?.splitBy;
  const seriesNames = [...new Set(result.rows.map((r) => String(r.series)))];
  const [sel, setSel] = useState(seriesNames[0]);
  const rows = result.rows.filter((r) => !split || r.series === sel);
  const lastActual = [...rows].reverse().find((r) => r.actual !== null);
  const cats = rows.map((r) => String(r.period));
  const num = (v: unknown) => (v === null || v === undefined ? null : Number(v));
  const lo95 = rows.map((r) => num(r.lo95)), hi95 = rows.map((r) => num(r.hi95)), lo80 = rows.map((r) => num(r.lo80)), hi80 = rows.map((r) => num(r.hi80));
  const firstF = rows.findIndex((r) => r.forecast !== null && r.forecast !== undefined);
  const o = baseOption(t);
  const ax = axisCommon(t);
  const xFmt = (v: string) => fmtPeriod(v, 'month');
  Object.assign(o, {
    toolbox: { ...o.toolbox, feature: { dataZoom: o.toolbox.feature.dataZoom, dataView: o.toolbox.feature.dataView, restore: o.toolbox.feature.restore, saveAsImage: o.toolbox.feature.saveAsImage } },
    tooltip: { ...o.tooltip, trigger: 'axis', formatter: tooltipFmt(format, xFmt).bind(null) },
    legend: { ...o.legend, data: ['Actual', 'Forecast', '80% range', '95% range'] },
    xAxis: { ...ax, type: 'category', data: cats, boundaryGap: false, axisLabel: { ...ax.axisLabel, formatter: xFmt }, splitLine: { show: false } },
    yAxis: { ...ax, type: 'value', scale: true, axisLabel: { ...ax.axisLabel, formatter: (v: number) => fmt(v, format, { compact: true }) }, axisLine: { show: false } },
    series: [
      { name: '__lo95', type: 'line', data: lo95, stack: 'b95', lineStyle: { opacity: 0 }, symbol: 'none', tooltip: { show: false } },
      { name: '95% range', type: 'line', data: hi95.map((v, i) => (v === null || lo95[i] === null ? null : v - (lo95[i] as number))), stack: 'b95', lineStyle: { opacity: 0 }, symbol: 'none', areaStyle: { color: t.series[0], opacity: 0.1 }, color: t.series[0] },
      { name: '__lo80', type: 'line', data: lo80, stack: 'b80', lineStyle: { opacity: 0 }, symbol: 'none' },
      { name: '80% range', type: 'line', data: hi80.map((v, i) => (v === null || lo80[i] === null ? null : v - (lo80[i] as number))), stack: 'b80', lineStyle: { opacity: 0 }, symbol: 'none', areaStyle: { color: t.series[0], opacity: 0.2 }, color: t.series[0] },
      { name: 'Actual', type: 'line', data: rows.map((r) => num(r.actual)), color: t.ink, lineStyle: { width: 2.25 }, symbolSize: 5, smooth: 0.2,
        markLine: firstF > 0 ? { silent: true, symbol: 'none', lineStyle: { type: 'dashed', color: t.ink3 }, label: { formatter: 'Forecast →', color: t.ink3, fontSize: 10, position: 'insideEndTop' }, data: [{ xAxis: cats[firstF] }] } : undefined },
      { name: 'Forecast', type: 'line', data: rows.map((r) => num(r.forecast) ?? (r === lastActual ? num(r.actual) : null)), color: t.series[0], lineStyle: { width: 2.25, type: 'dashed' }, symbolSize: 6 },
    ],
    grid: { ...o.grid, top: 44 },
  });
  return (
    <div>
      {split && <div className="mb-2 flex flex-wrap gap-1">{seriesNames.map((s) => <button key={s} onClick={() => setSel(s)} className={clsx('rounded-full px-2.5 py-1 text-xs transition', s === sel ? 'bg-ink text-bg' : 'bg-surface-2 text-ink-2 hover:text-ink')}>{s}</button>)}</div>}
      <ReactEChartsCore echarts={echarts} option={o} notMerge lazyUpdate style={{ height, width: '100%' }} />
    </div>
  );
}

/** Tiny trend chart used in drill panels. */
export function MiniTrend({ points, format, height = 160, onClick }: { points: { period: string; value: number | null }[]; format?: Format; height?: number; onClick?: (period: string) => void }) {
  const t = useThemeColors();
  const o = baseOption(t);
  const ax = axisCommon(t);
  Object.assign(o, {
    toolbox: { show: false }, legend: { show: false }, grid: { left: 4, right: 8, top: 12, bottom: 4, containLabel: true },
    tooltip: { ...o.tooltip, trigger: 'axis', formatter: (ps: any) => `${fmtPeriod(ps[0].axisValue, 'month')}<br/><b>${fmt(ps[0].value, format)}</b>` },
    xAxis: { ...ax, type: 'category', data: points.map((p) => p.period), axisLabel: { ...ax.axisLabel, formatter: (v: string) => fmtPeriod(v, 'month') }, splitLine: { show: false } },
    yAxis: { ...ax, type: 'value', axisLabel: { ...ax.axisLabel, formatter: (v: number) => fmt(v, format, { compact: true }) }, axisLine: { show: false } },
    series: [{ type: 'bar', data: points.map((p) => p.value), color: t.series[0], barMaxWidth: 22, itemStyle: { borderRadius: [3, 3, 0, 0] } }],
  });
  return <ReactEChartsCore echarts={echarts} option={o} notMerge style={{ height, width: '100%', cursor: onClick ? 'pointer' : undefined }} onEvents={{ click: (p: any) => onClick?.(points[p.dataIndex]?.period) }} />;
}

export function Heatmap({ result }: { result: Result }) {
  const mCols = result.columns.filter((c) => /^m\d+$/.test(c.key));
  const rows = [...result.rows, ...(result.totals ? [result.totals] : [])];
  const vals = result.rows.flatMap((r) => mCols.slice(1).map((c) => Number(r[c.key]))).filter((v) => isFinite(v));
  const max = Math.max(...vals, 0.0001);
  const shade = (v: number) => {
    const step = Math.min(7, Math.max(1, Math.ceil((v / max) * 7)));
    return { background: `var(--seq-${step})`, color: step >= 4 ? '#fff' : 'var(--ink)' };
  };
  return (
    <div className="overflow-x-auto rounded-xl border border-line">
      <table className="w-full text-sm">
        <thead className="bg-surface-2/60">
          <tr>
            <th className="px-3 py-2 text-left text-xs font-medium text-ink-2">{result.columns[0].label}</th>
            <th className="px-3 py-2 text-right text-xs font-medium text-ink-2">Clients</th>
            {mCols.map((c) => <th key={c.key} className="px-2 py-2 text-center text-xs font-medium text-ink-2">{c.label}</th>)}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => {
            const isAvg = i === result.rows.length;
            return (
              <tr key={String(r.cohort)} className={isAvg ? 'border-t-2 border-line font-medium' : 'border-t border-line'}>
                <td className="whitespace-nowrap px-3 py-1.5">{isAvg ? String(r.cohort) : fmtPeriod(String(r.cohort), 'month')}</td>
                <td className="px-3 py-1.5 text-right tabular text-ink-2">{fmt(r.cohort_size, 'number')}</td>
                {mCols.map((c, j) => {
                  const v = r[c.key];
                  if (v === null || v === undefined) return <td key={c.key} className="px-1 py-1"><div className="h-7 rounded bg-surface-2/40" /></td>;
                  const n = Number(v);
                  return <td key={c.key} className="px-1 py-1"><div className="flex h-7 items-center justify-center rounded text-xs tabular" style={j === 0 ? { background: 'var(--surface-2)' } : shade(n)}>{(n * 100).toFixed(n < 0.1 ? 1 : 0)}%</div></td>;
                })}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export function Funnel({ result }: { result: Result }) {
  const segs = [...new Set(result.rows.map((r) => String(r.segment)))];
  return (
    <div className="grid gap-6" style={{ gridTemplateColumns: `repeat(auto-fit, minmax(${segs.length > 1 ? 260 : 400}px, 1fr))` }}>
      {segs.map((s) => {
        const rows = result.rows.filter((r) => String(r.segment) === s);
        const top = Number(rows[0]?.count) || 1;
        return (
          <div key={s}>
            {segs.length > 1 && <div className="mb-2 text-xs font-medium text-ink-2">{s}</div>}
            <div className="space-y-2">
              {rows.map((r, i) => (
                <div key={i}>
                  <div className="mb-0.5 flex justify-between text-xs"><span className="text-ink-2">{String(r.stage)}</span><span className="tabular text-ink">{fmt(r.count, 'number')}{r.step_rate !== null ? <span className="ml-2 text-ink-3">{fmt(r.step_rate, 'percent')} of previous</span> : null}</span></div>
                  <div className="h-7 rounded-md bg-surface-2"><div className="h-7 rounded-md" style={{ width: `${Math.max(2, (Number(r.count) / top) * 100)}%`, background: `var(--seq-${Math.max(3, 6 - i)})` }} /></div>
                </div>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}



/* Interactive wrapper: chart type, metric picker, average line, data labels, zoom — every point drills to records. */
const TYPES = [
  { id: 'bar', label: 'Bar', icon: BarChart3 }, { id: 'line', label: 'Line', icon: LineIcon }, { id: 'area', label: 'Area', icon: AreaChart },
  { id: 'stacked_bar', label: 'Stacked', icon: Layers }, { id: 'horizontal_bar', label: 'Horizontal', icon: BarChartHorizontal },
  { id: 'combo', label: 'Combo', icon: Combine }, { id: 'pie', label: 'Donut', icon: PieIcon },
];
export function InteractiveChart({ result, chart = 'bar', x, y, seriesBy, height = 300, minimal }: ChartProps & { minimal?: boolean }) {
  const metricCols = result.columns.filter((c) => c.kind === 'metric' || c.kind === 'comparison');
  const dimCols = result.columns.filter((c) => c.kind === 'dimension' || c.kind === 'period');
  const [type, setType] = useState(chart);
  const [metrics, setMetrics] = useState<string[]>(y?.length ? y : metricCols.filter((c) => c.kind === 'metric').slice(0, seriesBy ? 1 : 2).map((c) => c.key));
  const [xKey, setX] = useState(x ?? dimCols.find((c) => c.kind === 'period')?.key ?? dimCols[0]?.key);
  const [split, setSplit] = useState<string | undefined>(seriesBy);
  const [avg, setAvg] = useState(false);
  const [labels, setLabels] = useState(false);
  const [zoom, setZoom] = useState(new Set(result.rows.map((r) => String(r[x ?? dimCols.find((c) => c.kind === 'period')?.key ?? dimCols[0]?.key ?? '']))).size > 18);
  const [opts, setOpts] = useState(false);
  const toggle = (k: string) => setMetrics((m) => (split ? [k] : m.includes(k) ? (m.length > 1 ? m.filter((q) => q !== k) : m) : [...m, k]));
  const chip = (on: boolean) => clsx(on && 'on');
  const sel = 'field !h-[34px]';
  return (
    <div>
      {!minimal && (
        <div className="mb-3 flex flex-wrap items-center gap-1.5">
          <div className="seg">{TYPES.map((tp) => <button key={tp.id} title={tp.label} className={chip(type === tp.id)} onClick={() => setType(tp.id)}><tp.icon size={14} />{type === tp.id && <span>{tp.label}</span>}</button>)}</div>
          {metricCols.length > 1 && <div className="seg max-w-full flex-wrap">{metricCols.slice(0, 10).map((c) => <button key={c.key} className={chip(metrics.includes(c.key))} onClick={() => toggle(c.key)}>{c.label}</button>)}</div>}
          {dimCols.length > 1 && (
            <>
              <select className={sel} value={xKey} onChange={(e) => { setX(e.target.value); if (split === e.target.value) setSplit(undefined); }} title="X axis">{dimCols.map((c) => <option key={c.key} value={c.key}>x: {c.label}</option>)}</select>
              <select className={sel} value={split ?? ''} onChange={(e) => { setSplit(e.target.value || undefined); if (e.target.value) setMetrics((m) => m.slice(0, 1)); }} title="Split series by">
                <option value="">no split</option>{dimCols.filter((c) => c.key !== xKey).map((c) => <option key={c.key} value={c.key}>split: {c.label}</option>)}
              </select>
            </>
          )}
          <div className="relative">
            <button className={clsx('tool !h-[34px]', (avg || labels || zoom || opts) && 'on')} onClick={() => setOpts(!opts)} title="Chart options"><SlidersHorizontal size={14} /></button>
            {opts && (
              <div className="pop-in absolute left-0 z-30 mt-1 w-44 rounded-xl border border-line bg-surface p-1.5 text-xs shadow-xl" onMouseLeave={() => setOpts(false)}>
                {([['Average line', avg, setAvg], ['Data labels', labels, setLabels], ['Zoom slider', zoom, setZoom]] as const).map(([l, v, set]) => (
                  <button key={l} onClick={() => set(!v)} className="flex w-full items-center justify-between rounded-lg px-2.5 py-1.5 text-left text-ink-2 hover:bg-surface-2">{l}<span className={clsx('h-4 w-7 rounded-full p-0.5 transition', v ? 'bg-accent' : 'bg-line')}><span className={clsx('block h-3 w-3 rounded-full bg-white transition', v && 'translate-x-3')} /></span></button>
                ))}
              </div>
            )}
          </div>
          <span className="ml-auto hidden items-center gap-1 text-[10px] text-ink-3 md:inline-flex"><MousePointerClick size={11} />click a point for records</span>
        </div>
      )}
      <ChartBlock result={result} chart={type} x={xKey} y={metrics} seriesBy={split} height={height} avg={avg} labels={labels} zoom={zoom} />
    </div>
  );
}
