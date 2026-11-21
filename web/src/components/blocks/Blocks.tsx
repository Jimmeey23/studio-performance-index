import { useState, type ReactNode } from 'react';
import clsx from 'clsx';
import { Activity, Gauge, IndianRupee, Timer, Users, Grid3x3, Filter, Table2 as TableIcon, LineChart as LineChartIcon, AlertTriangle, ArrowDownRight, ArrowUpRight, BarChart3, CheckCircle2, Download, Eye, Info, Lightbulb, Maximize2, Minus, ShieldAlert, Sparkles, Table2, TrendingUp, Code2, ChevronRight, HelpCircle, CornerDownRight, BookOpen } from 'lucide-react';
import type { Block, Result } from '../../lib/types';
import { fmt, fmtChange, fmtPeriod } from '../../lib/format';
import { usePolarity } from '../../lib/catalog';
import { PivotTable } from './DataTable';
import { AdvancedTable } from './AdvancedTable';
import { InteractiveChart, ForecastChart, Heatmap, Funnel } from './Charts';
import { Badge, Drawer, Modal } from '../ui';
import { CountUp, Sparkline } from '../Animated';
import { useAsk } from '../../lib/ask';
import { drillFor, useDrill } from '../../lib/drill';
const DataTable = ({ result, pageSize, dense }: { result: Result; pageSize?: number; dense?: boolean; columns?: string[] }) => <AdvancedTable result={result} pageSize={pageSize} compact={dense} />;

export function KpiCards({ result, metrics, series: seriesResult }: { result: Result; metrics?: string[]; series?: Result }) {
  const polarity = usePolarity();
  const drill = useDrill();
  const cols = result.columns.filter((c) => c.kind === 'metric' && (!metrics?.length || metrics.includes(c.key)));
  const hasPeriod = result.columns.some((c) => c.kind === 'period');
  // with a monthly series, headline = last COMPLETE month; otherwise the totals / single row
  const complete = hasPeriod ? result.rows.filter((r) => !r.__partial) : [];
  const last = complete[complete.length - 1];
  const prevRow = complete[complete.length - 2];
  const src: Record<string, unknown> = hasPeriod && last ? last : result.totals ?? result.rows[0] ?? {};
  const srcRow = hasPeriod ? last ?? null : result.rows.length === 1 ? result.rows[0] : null;
  const sRows = seriesResult ? seriesResult.rows.filter((r) => !r.__partial) : complete;
  const cmpLabel = result.spec?.compare === 'previous_year' ? 'vs LY' : result.spec?.compare ? 'vs prev' : '';
  return (
    <div className={clsx('grid gap-3.5', cols.length >= 7 && 'grid-cols-2 lg:grid-cols-4')} style={cols.length >= 7 ? undefined : { gridTemplateColumns: `repeat(auto-fit, minmax(${cols.length >= 6 ? 170 : 200}px, 1fr))` }}>
      {cols.map((c, i) => {
        const v = Number(src[c.key]);
        const chg = src[`${c.key}__chg`] as number | null | undefined;
        const prev = src[`${c.key}__prev`];
        const mom = hasPeriod && prevRow ? (c.format === 'percent' ? v - Number(prevRow[c.key]) : Number(prevRow[c.key]) ? (v - Number(prevRow[c.key])) / Math.abs(Number(prevRow[c.key])) : null) : null;
        const pol = polarity(c.key);
                const arrow = (x: number | null | undefined) => (x === null || x === undefined ? <Minus size={12} /> : x > 0 ? <ArrowUpRight size={13} /> : <ArrowDownRight size={13} />);
        const series = sRows.map((r) => Number(r[c.key]) || 0);
        const req = drill ? drillFor(result, srcRow, c.key) : null;
        const good = chg === null || chg === undefined || pol === 0 ? null : chg * pol > 0;
        const Icon = c.format === 'currency' ? IndianRupee : c.format === 'percent' ? Gauge : c.format === 'days' ? Timer : /client|member|lead/.test(c.key) ? Users : Activity;
        const pill = (x: number | null | undefined) => (x === null || x === undefined || x === 0 || pol === 0 ? 'pill-flat' : x * pol > 0 ? 'pill-good' : 'pill-bad');
        return (
          <div key={c.key} onClick={req ? () => drill!(req) : undefined} title={req ? 'Click to see the records behind this number' : undefined} className={clsx('kpi-card card-in group relative flex flex-col overflow-hidden transition-all duration-200', req && 'cursor-pointer')} style={{ animationDelay: `${i * 50}ms` }}>
            <div className="kpi-inner flex-1">
              <div className="flex items-center gap-2.5">
                <span className="panel-tile !h-7 !w-7 !rounded-lg"><Icon size={14} /></span>
                <div className="min-w-0 flex-1 truncate text-[12.5px] font-medium text-ink-2">{c.label}</div>
                {req ? <span className="rounded-md bg-accent-soft px-1.5 py-0.5 text-[10px] font-semibold text-accent opacity-0 transition group-hover:opacity-100">records ↗</span>
                  : hasPeriod && last ? <span className="text-[10px] text-ink-3">{fmtPeriod(String(last.period), 'month')}</span> : null}
              </div>
              <div className="kpi-value mt-3 text-[30px] leading-none tabular">
                <CountUp value={v} format={(n) => fmt(c.format === 'number' ? Math.round(n) : n, c.format, { compact: c.format === 'currency' && Math.abs(v) >= 1e6 })} />
              </div>
              <div className="mt-2.5 flex flex-wrap items-center gap-1.5 text-[11px]">
                {chg !== undefined && <span className={clsx('inline-flex items-center gap-0.5 whitespace-nowrap rounded-full px-1.5 py-0.5 font-semibold tabular', pill(chg))}>{arrow(chg)}{fmtChange(chg, c.format === 'percent')}</span>}
                {chg !== undefined && <span className="whitespace-nowrap text-ink-3">{cmpLabel} {fmt(prev, c.format, { compact: true })}</span>}
                {mom !== null && <span className={clsx('inline-flex items-center gap-0.5 whitespace-nowrap rounded-full px-1.5 py-0.5 font-medium tabular', pill(mom))}>{arrow(mom)}{fmtChange(mom, c.format === 'percent')} MoM</span>}
              </div>
            </div>
            {series.length > 2 ? <div className="kpi-spark"><Sparkline values={series} labels={sRows.map((r) => fmtPeriod(String(r.period), 'month'))} format={(n) => fmt(n, c.format, { compact: true })} height={46} color={good === false ? 'var(--series-8)' : good ? 'var(--series-3)' : 'var(--accent)'} highlightLast={false} /></div> : <div className="h-4" />}
          </div>
        );
      })}
    </div>
  );
}

const INSIGHT = {
  observation: { icon: Eye, label: 'Observation', tone: 'neutral' as const },
  risk: { icon: ShieldAlert, label: 'Risk', tone: 'bad' as const },
  opportunity: { icon: TrendingUp, label: 'Opportunity', tone: 'good' as const },
  recommendation: { icon: Lightbulb, label: 'Recommendation', tone: 'accent' as const },
};
export function Insights({ items }: { items: NonNullable<Block['items']> }) {
  const order = { high: 0, medium: 1, low: 2 } as Record<string, number>;
  const sorted = [...items].sort((a, b) => (order[a.priority ?? 'medium'] - order[b.priority ?? 'medium']));
  return (
    <div className="grid gap-3 md:grid-cols-2">
      {sorted.map((it, i) => {
        const k = INSIGHT[it.kind] ?? INSIGHT.observation;
        const Icon = k.icon;
        return (
          <div key={i} className="rounded-xl border border-line bg-bg/40 p-4">
            <div className="mb-1.5 flex items-center gap-2">
              <Badge tone={k.tone}><Icon size={12} />{k.label}</Badge>
              {it.priority && <span className={clsx('text-[11px] font-medium', it.priority === 'high' ? 'text-bad' : it.priority === 'medium' ? 'text-warn' : 'text-ink-3')}>{it.priority} priority</span>}
            </div>
            <div className="text-sm font-semibold">{it.title}</div>
            <div className="mt-1 text-sm leading-relaxed text-ink-2">{it.detail}</div>
          </div>
        );
      })}
    </div>
  );
}

export function Provenance({ result }: { result: Result }) {
  const spec = result.spec as Record<string, unknown> | undefined;
  return (
    <div className="space-y-5 text-sm">
      <section>
        <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-ink-3">Status</div>
        {result.verified ? <Badge tone="good"><CheckCircle2 size={12} />All validation checks passed</Badge> : <Badge tone="warn"><AlertTriangle size={12} />Some checks need attention</Badge>}
      </section>
      {result.period?.start && (
        <section>
          <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-ink-3">Period</div>
          <div>{fmtPeriod(result.period.start, 'day')} → {fmtPeriod(result.period.end ?? '', 'day')}{result.period.comparisonStart && <span className="text-ink-3"> · compared with {fmtPeriod(result.period.comparisonStart, 'day')} → {fmtPeriod(result.period.comparisonEnd ?? '', 'day')}</span>}</div>
        </section>
      )}
      {spec && (
        <section>
          <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-ink-3">Query</div>
          <pre className="overflow-auto rounded-lg bg-surface-2 p-3 font-mono text-xs">{JSON.stringify(spec, null, 2)}</pre>
        </section>
      )}
      {result.definitions.length > 0 && (
        <section>
          <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-ink-3">Definitions</div>
          <ul className="space-y-1.5">{result.definitions.map((d) => <li key={d.metric}><span className="font-medium">{d.label}</span> — <span className="text-ink-2">{d.description}</span>{d.caveat && <div className="text-xs text-warn">⚠ {d.caveat}</div>}</li>)}</ul>
        </section>
      )}
      <section>
        <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-ink-3">Data sources</div>
        <ul className="list-disc pl-5 text-ink-2">{result.sources.map((s) => <li key={s}>{s}</li>)}</ul>
      </section>
      {(result.notes.length > 0 || result.checks.length > 0) && (
        <section>
          <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-ink-3">Notes & checks</div>
          <ul className="space-y-1">
            {result.checks.map((c) => <li key={c.name} className="flex gap-2">{c.passed ? <CheckCircle2 size={14} className="mt-0.5 shrink-0 text-good" /> : <AlertTriangle size={14} className="mt-0.5 shrink-0 text-warn" />}<span className="text-ink-2">{c.detail}</span></li>)}
            {result.notes.map((n, i) => <li key={i} className="flex gap-2"><Info size={14} className="mt-0.5 shrink-0 text-ink-3" /><span className="text-ink-2">{n}</span></li>)}
          </ul>
        </section>
      )}
      {result.sql.length > 0 && (
        <section>
          <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-ink-3">SQL executed</div>
          {result.sql.map((s, i) => <pre key={i} className="mb-2 max-h-72 overflow-auto rounded-lg bg-surface-2 p-3 font-mono text-[11px] leading-relaxed">{s}</pre>)}
        </section>
      )}
    </div>
  );
}

const BLOCK_ICON: Record<string, typeof Sparkles> = { chart: LineChartIcon, forecast_chart: TrendingUp, heatmap: Grid3x3, funnel: Filter, table: TableIcon, kpis: Activity };
function periodSub(r?: Result) {
  if (!r?.period?.start) return null;
  const p = `${fmtPeriod(r.period.start, 'day')} – ${fmtPeriod(r.period.end ?? '', 'day')}`;
  return r.period.comparisonStart ? `${p} · vs ${fmtPeriod(r.period.comparisonStart, 'day')} – ${fmtPeriod(r.period.comparisonEnd ?? '', 'day')}` : p;
}
function Frame({ title, children, actions, result, icon, kind }: { title?: string; children: ReactNode; actions?: ReactNode; result?: Result; icon?: ReactNode; kind?: string }) {
  const [prov, setProv] = useState(false);
  const I = BLOCK_ICON[kind ?? ''] ?? Sparkles;
  const sub = periodSub(result);
  return (
    <div className="panel group/panel fade-up">
      <div className="panel-head">
        <span className="panel-tile">{icon ?? <I size={16} />}</span>
        <div className="min-w-0 flex-1">
          <div className="panel-title truncate">{title}</div>
          {sub && <div className="panel-sub truncate">{sub}</div>}
        </div>
        {result && !result.verified && <Badge tone="warn"><AlertTriangle size={11} />check notes</Badge>}
        <div className="flex items-center gap-0.5 opacity-60 transition group-hover/panel:opacity-100">{actions}
          {result && <button title="How this was calculated" onClick={() => setProv(true)} className="rounded-lg p-1.5 text-ink-3 hover:bg-surface-2 hover:text-ink"><Code2 size={15} /></button>}
        </div>
      </div>
      <div className="panel-body">{children}</div>
      {result && <Drawer open={prov} onClose={() => setProv(false)} title="How this was calculated"><Provenance result={result} /></Drawer>}
    </div>
  );
}

const iconBtn = 'rounded-lg p-1.5 text-ink-3 hover:bg-surface-2 hover:text-ink';

export function BlockView({ block, onAsk, height }: { block: Block; onAsk?: () => void; height?: number }) {
  const [view, setView] = useState<'chart' | 'table'>('chart');
  const [expand, setExpand] = useState(false);
  const r = block.result;
  if (block.type === 'insights') return <Frame title={block.title ?? 'Key insights'} icon={<Sparkles size={15} />}><Insights items={block.items ?? []} /></Frame>;
  if (block.type === 'clarify') return <Clarify block={block} />;
  if (block.type === 'followups') return <Followups questions={block.questions ?? []} />;
  if (block.type === 'details') return <Details block={block} />;
  if (!r) return null;
  const download = <a key="dl" href={`/api/results/${r.id}/csv`} title="Download CSV" className={iconBtn}><Download size={15} /></a>;
  const expandBtn = <button key="ex" title="Open in workspace" onClick={() => setExpand(true)} className={iconBtn}><Maximize2 size={15} /></button>;
  const toggle = <button key="tg" title={view === 'chart' ? 'Show table' : 'Show chart'} onClick={() => setView(view === 'chart' ? 'table' : 'chart')} className={iconBtn}>{view === 'chart' ? <Table2 size={15} /> : <BarChart3 size={15} />}</button>;

  const body = (big = false) => {
    switch (block.type) {
      case 'kpis': return <KpiCards result={r} metrics={block.metrics} />;
      case 'table': return block.pivot ? <PivotTable result={r} {...block.pivot} /> : <AdvancedTable result={r} columns={block.columns} view={block.view} groupBy={block.group_by} pageSize={big ? 50 : 15} />;
      case 'chart': return view === 'chart' ? <InteractiveChart result={r} chart={block.chart} x={block.x} y={block.y} seriesBy={block.series_by} height={big ? 520 : height ?? 300} /> : <DataTable result={r} pageSize={big ? 50 : 15} />;
      case 'forecast_chart': return view === 'chart' ? <ForecastExtras result={r}><ForecastChart result={r} height={big ? 520 : 320} /></ForecastExtras> : <DataTable result={r} pageSize={big ? 50 : 15} />;
      case 'heatmap': return <Heatmap result={r} />;
      case 'funnel': return view === 'chart' ? <Funnel result={r} /> : <DataTable result={r} />;
      default: return <DataTable result={r} />;
    }
  };
  const askBtn = onAsk ? <button key="ask" title="Ask the expert about this" onClick={onAsk} className={iconBtn}><Sparkles size={15} /></button> : null;
  const actions = [
    ...(askBtn ? [askBtn] : []),
    ...(['chart', 'forecast_chart', 'funnel'].includes(block.type) ? [toggle] : []),
    ...(block.type !== 'kpis' ? [expandBtn] : []), download,
  ];
  return (
    <>
      <Frame title={block.title ?? r.title} result={r} actions={actions} kind={block.type}>{body()}</Frame>
      <Modal open={expand} onClose={() => setExpand(false)} title={block.title ?? r.title} wide>
        <div className="space-y-6">
          {body(true)}
          {block.type !== 'table' && <AdvancedTable result={r} pageSize={25} />}
          <div className="rounded-xl border border-line p-4"><Provenance result={r} /></div>
        </div>
      </Modal>
    </>
  );
}

function ForecastExtras({ result, children }: { result: Result; children: ReactNode }) {
  const methods = result.extra?.methods as Record<string, { method: string; compared: { method: string; mae: number; mape: number | null }[] }> | undefined;
  const first = methods ? Object.values(methods)[0] : undefined;
  const mtd = result.extra?.monthToDate as { value: number; daysElapsed: number; daysInMonth: number; linearRunRate: number } | undefined;
  const tp = result.extra?.targetProbability as { target: number; probability: number } | undefined;
  const fmtKey = (result.extra?.format as never) ?? 'number';
  return (
    <div>
      {children}
      <div className="mt-3 flex flex-wrap gap-2 text-xs">
        {first && <Badge tone="accent">Model: {first.method}{first.compared[0]?.mape != null ? ` · backtest MAPE ${(first.compared[0].mape * 100).toFixed(1)}%` : ''}</Badge>}
        {mtd && <Badge>Month to date: {fmt(mtd.value, fmtKey, { compact: true })} ({mtd.daysElapsed}/{mtd.daysInMonth} days) · run-rate {fmt(mtd.linearRunRate, fmtKey, { compact: true })}</Badge>}
        {tp && <Badge tone={tp.probability >= 0.6 ? 'good' : tp.probability >= 0.35 ? 'warn' : 'bad'}>P(≥ {fmt(tp.target, fmtKey, { compact: true })}) ≈ {(tp.probability * 100).toFixed(0)}%</Badge>}
      </div>
    </div>
  );
}


function Clarify({ block }: { block: Block }) {
  const ask = useAsk();
  const [chosen, setChosen] = useState<string | null>(null);
  return (
    <div className="card-in rounded-2xl border border-accent/30 bg-accent-soft/40 p-4">
      <div className="flex items-start gap-2.5">
        <HelpCircle size={18} className="mt-0.5 shrink-0 text-accent" />
        <div className="min-w-0 flex-1">
          <div className="text-[15px] font-medium">{block.question}</div>
          {block.why && <div className="mt-0.5 text-xs text-ink-3">{block.why}</div>}
          <div className="mt-3 flex flex-wrap gap-2">
            {(block.options ?? []).map((o) => (
              <button key={o} disabled={!!chosen || !ask} onClick={() => { setChosen(o); ask?.(o); }}
                className={clsx('rounded-full border px-3.5 py-1.5 text-sm transition', chosen === o ? 'border-accent bg-accent text-white' : 'border-line bg-surface hover:border-accent/50 hover:text-accent disabled:opacity-50')}>{o}</button>
            ))}
          </div>
          <div className="mt-2 text-[11px] text-ink-3">Or type your own answer below.</div>
        </div>
      </div>
    </div>
  );
}

export function Followups({ questions }: { questions: string[] }) {
  const ask = useAsk();
  if (!questions.length) return null;
  return (
    <div className="card-in">
      <div className="mb-2 text-[11px] font-medium uppercase tracking-wider text-ink-3">Ask next</div>
      <div className="grid gap-2 md:grid-cols-3">
        {questions.map((q) => (
          <button key={q} disabled={!ask} onClick={() => ask?.(q)} className="lift group flex items-start gap-2 rounded-xl border border-line bg-surface p-3 text-left text-[13px] text-ink-2 hover:border-accent/40 hover:text-ink">
            <CornerDownRight size={14} className="mt-0.5 shrink-0 text-ink-3 group-hover:text-accent" />{q}
          </button>
        ))}
      </div>
    </div>
  );
}

function Details({ block }: { block: Block }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="panel">
      <button onClick={() => setOpen((o) => !o)} className="flex w-full items-center gap-2 px-4 py-3 text-left">
        <ChevronRight size={15} className={clsx('text-ink-3 transition-transform', open && 'rotate-90')} />
        <BookOpen size={15} className="text-ink-3" />
        <span className="text-sm font-semibold">Metric definitions, sources & methodology</span>
        <span className="ml-auto text-xs text-ink-3">{block.definitions?.length ?? 0} definitions · {block.sources?.length ?? 0} sources</span>
      </button>
      {open && (
        <div className="space-y-6 border-t border-line px-4 py-4 fade-up">
          {!!block.definitions?.length && (
            <div>
              <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-3">Metric definitions</div>
              <div className="grid gap-2 md:grid-cols-2">
                {block.definitions.map((d) => (
                  <div key={d.metric} className="rounded-lg border border-line bg-bg/40 p-3 text-sm">
                    <div className="font-medium">{d.label} <span className="font-mono text-[10px] text-ink-3">{d.metric}</span></div>
                    <div className="mt-0.5 text-ink-2">{d.description}</div>
                    {d.caveat && <div className="mt-1 text-xs text-warn">⚠ {d.caveat}</div>}
                  </div>
                ))}
              </div>
            </div>
          )}
          {(!!block.sources?.length || !!block.notes?.length) && (
            <div className="grid gap-4 md:grid-cols-2 text-sm">
              {!!block.sources?.length && <div><div className="mb-1 text-xs font-semibold uppercase tracking-wide text-ink-3">Data sources</div><ul className="list-disc pl-5 text-ink-2">{block.sources.map((x) => <li key={x}>{x}</li>)}</ul></div>}
              {!!block.notes?.length && <div><div className="mb-1 text-xs font-semibold uppercase tracking-wide text-ink-3">Methodology notes</div><ul className="space-y-1 text-ink-2">{block.notes.map((x, i) => <li key={i} className="flex gap-2"><Info size={13} className="mt-0.5 shrink-0 text-ink-3" />{x}</li>)}</ul></div>}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
