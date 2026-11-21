import { useEffect, useState } from 'react';
import clsx from 'clsx';
import { AlertTriangle, CheckCircle2, ExternalLink, Info, XCircle, ChevronDown, ChevronRight } from 'lucide-react';
import { api } from '../lib/api';
import { Badge, Card, PageHeader } from '../components/ui';
import { fmt } from '../lib/format';

interface Sources {
  sources: { key: string; name: string; url: string; tabs: { tab: string; table: string; role: string; description: string; state: { row_count: number; col_count: number; loaded_at: string } | null }[]; ignoredTabs: { tab: string; reason: string }[] }[];
  models: { name: string; grain: string; description: string; sourceOfTruth?: string; key?: string; build: { status: string; rows: number; duplicates: number; error?: string; built_at: string } | null }[];
  syncs: { id: string; started_at: string; mode: string; status: string }[];
  googleConfigured: boolean;
}
interface Quality { check_id: string; severity: 'info' | 'warning' | 'error'; area: string; value: number; detail: string }
interface Dict { models: { model: string; grain: string; description: string; sourceOfTruth: string; rows: number; columns: { column: string; type: string; null_pct: number; distinct: number; min: string; max: string; top_values?: { value: string; rows: number }[] }[] }[]; rawColumns: { raw_table: string; column_name: string; original_header: string }[] }

export default function DataSources() {
  const [s, setS] = useState<Sources | null>(null);
  const [q, setQ] = useState<Quality[]>([]);
  const [dict, setDict] = useState<Dict | null>(null);
  const [tab, setTab] = useState<'sources' | 'models' | 'health'>('sources');
  useEffect(() => { api<Sources>('/api/sources').then(setS); api<Quality[]>('/api/quality').then(setQ); api<Dict>('/api/dictionary').then(setDict); }, []);
  const issues = q.filter((x) => x.severity !== 'info').length;
  return (
    <div>
      <PageHeader title="Data sources" subtitle={s ? `${s.sources.length} Google Sheets · ${s.models.filter((m) => m.build?.status === 'built').length} analytical models · last sync ${s.syncs[0]?.started_at?.slice(0, 16) ?? 'never'}${s.googleConfigured ? '' : ' · Google sync not configured (snapshot uploads only)'}` : 'Loading…'} />
      <div className="mb-5 inline-flex rounded-xl border border-line bg-surface p-1 text-sm">
        {[['sources', 'Sheets & tabs'], ['models', 'Data dictionary'], ['health', `Data health${issues ? ` (${issues})` : ''}`]].map(([k, l]) => (
          <button key={k} onClick={() => setTab(k as never)} className={clsx('rounded-lg px-3 py-1.5', tab === k ? 'bg-surface-2 font-medium' : 'text-ink-2')}>{l}</button>
        ))}
      </div>

      {tab === 'sources' && s && (
        <div className="space-y-4">
          {s.sources.map((src) => (
            <Card key={src.key} className="p-5">
              <div className="mb-3 flex items-center gap-2">
                <div className="font-semibold">{src.name}</div>
                <a href={src.url} target="_blank" rel="noreferrer" className="text-ink-3 hover:text-accent"><ExternalLink size={14} /></a>
              </div>
              <div className="overflow-x-auto rounded-xl border border-line">
                <table className="w-full text-sm">
                  <thead className="bg-surface-2/60 text-xs text-ink-2"><tr><th className="px-3 py-2 text-left font-medium">Tab</th><th className="px-3 py-2 text-left font-medium">Role</th><th className="px-3 py-2 text-left font-medium">What it holds</th><th className="px-3 py-2 text-right font-medium">Rows</th><th className="px-3 py-2 text-right font-medium">Loaded</th></tr></thead>
                  <tbody>{src.tabs.map((t) => (
                    <tr key={t.tab} className="border-t border-line">
                      <td className="whitespace-nowrap px-3 py-2 font-medium">{t.tab}</td>
                      <td className="px-3 py-2"><Badge tone={t.role === 'fact' ? 'accent' : 'neutral'}>{t.role}</Badge></td>
                      <td className="px-3 py-2 text-ink-2">{t.description}</td>
                      <td className="px-3 py-2 text-right tabular">{t.state ? fmt(t.state.row_count, 'number') : '—'}</td>
                      <td className="whitespace-nowrap px-3 py-2 text-right text-xs text-ink-3">{t.state?.loaded_at?.slice(0, 16) ?? 'not loaded'}</td>
                    </tr>
                  ))}</tbody>
                </table>
              </div>
              {src.ignoredTabs.length > 0 && (
                <details className="mt-3 text-sm"><summary className="cursor-pointer text-xs text-ink-3">{src.ignoredTabs.length} tab(s) deliberately not ingested</summary>
                  <ul className="mt-2 space-y-1 text-xs text-ink-2">{src.ignoredTabs.map((i) => <li key={i.tab}><span className="font-medium">{i.tab}</span> — {i.reason}</li>)}</ul>
                </details>
              )}
            </Card>
          ))}
        </div>
      )}

      {tab === 'models' && s && <div className="space-y-3">{s.models.map((m) => <ModelCard key={m.name} m={m} d={dict?.models.find((x) => x.model === m.name)} />)}</div>}

      {tab === 'health' && (
        <Card className="divide-y divide-line">
          {q.map((x) => (
            <div key={x.check_id} className="flex items-start gap-3 px-5 py-3 text-sm">
              {x.severity === 'error' ? <XCircle size={16} className="mt-0.5 shrink-0 text-bad" /> : x.severity === 'warning' ? <AlertTriangle size={16} className="mt-0.5 shrink-0 text-warn" /> : <Info size={16} className="mt-0.5 shrink-0 text-ink-3" />}
              <div className="flex-1"><div className="text-ink">{x.detail}</div><div className="text-xs text-ink-3">{x.area} · {x.check_id}</div></div>
            </div>
          ))}
          {!q.length && <div className="p-5 text-sm text-ink-3">No checks yet — run a sync.</div>}
        </Card>
      )}
    </div>
  );
}

function ModelCard({ m, d }: { m: Sources['models'][number]; d?: Dict['models'][number] }) {
  const [open, setOpen] = useState(false);
  const b = m.build;
  return (
    <Card className="p-4">
      <button onClick={() => setOpen((o) => !o)} className="flex w-full items-start gap-3 text-left">
        {open ? <ChevronDown size={16} className="mt-1 text-ink-3" /> : <ChevronRight size={16} className="mt-1 text-ink-3" />}
        <div className="flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-sm font-medium">{m.name}</span>
            {b?.status === 'built' ? <Badge tone="good"><CheckCircle2 size={11} />{fmt(b.rows, 'number')} rows</Badge> : <Badge tone={b?.status === 'error' ? 'bad' : 'neutral'}>{b?.status ?? 'not built'}</Badge>}
            {b && b.duplicates > 0 && <Badge tone="bad">{b.duplicates} duplicate keys</Badge>}
          </div>
          <div className="mt-1 text-sm text-ink-2">{m.description}</div>
          <div className="mt-1 text-xs text-ink-3">Grain: {m.grain}{m.sourceOfTruth ? ` · Source of truth: ${m.sourceOfTruth}` : ''}{m.key ? ` · Key: ${m.key}` : ''}</div>
          {b?.error && b.status === 'error' && <div className="mt-1 text-xs text-bad">{b.error}</div>}
        </div>
      </button>
      {open && d && (
        <div className="mt-3 overflow-x-auto rounded-xl border border-line">
          <table className="w-full text-xs">
            <thead className="bg-surface-2/60 text-ink-2"><tr><th className="px-3 py-2 text-left font-medium">Column</th><th className="px-3 py-2 text-left font-medium">Type</th><th className="px-3 py-2 text-right font-medium">Null %</th><th className="px-3 py-2 text-right font-medium">Distinct</th><th className="px-3 py-2 text-left font-medium">Range / top values</th></tr></thead>
            <tbody>{d.columns.map((c) => (
              <tr key={c.column} className="border-t border-line align-top">
                <td className="px-3 py-1.5 font-mono">{c.column}</td><td className="px-3 py-1.5 text-ink-3">{c.type}</td>
                <td className="px-3 py-1.5 text-right tabular">{(c.null_pct * 100).toFixed(1)}%</td><td className="px-3 py-1.5 text-right tabular">{fmt(c.distinct, 'number')}</td>
                <td className="px-3 py-1.5 text-ink-2">{c.top_values ? c.top_values.slice(0, 6).map((t) => `${t.value ?? '∅'} (${t.rows})`).join(', ') : c.min !== null ? `${String(c.min).slice(0, 24)} → ${String(c.max).slice(0, 24)}` : ''}</td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      )}
    </Card>
  );
}
