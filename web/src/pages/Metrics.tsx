import { useState } from 'react';
import { Search } from 'lucide-react';
import { useCatalog } from '../lib/catalog';
import { Badge, Card, PageHeader } from '../components/ui';

export default function Metrics() {
  const c = useCatalog();
  const [q, setQ] = useState('');
  if (!c) return <div className="shimmer h-64 rounded-2xl" />;
  const match = (s: string) => s.toLowerCase().includes(q.toLowerCase());
  return (
    <div>
      <PageHeader title="Metrics & definitions" subtitle="The semantic layer every answer is computed from. The AI picks from these; it never invents formulas." />
      <div className="relative mb-5 max-w-sm">
        <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-3" />
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search metrics" className="h-9 w-full rounded-lg border border-line bg-surface pl-9 pr-3 text-sm outline-none focus:border-accent" />
      </div>
      <div className="space-y-6">
        {c.datasets.map((d) => {
          const ms = c.metrics.filter((m) => m.dataset === d.id && (match(m.label) || match(m.description) || match(m.id)));
          if (!ms.length) return null;
          return (
            <Card key={d.id} className="p-5">
              <div className="flex flex-wrap items-baseline gap-2">
                <div className="font-semibold">{d.label}</div>
                <span className="font-mono text-xs text-ink-3">{d.table}</span>
              </div>
              <div className="mt-1 text-xs text-ink-3">Source: {d.source} · Time axis: {d.time}{d.defaultRule ? ` · Always applied: ${d.defaultRule}` : ''}</div>
              <div className="mt-1 text-xs text-ink-3">Breakdowns: {d.dimensions.map((x) => c.dimensions[x]?.label ?? x).join(', ')}</div>
              <div className="mt-4 divide-y divide-line">
                {ms.map((m) => (
                  <div key={m.id} className="grid gap-1 py-2.5 md:grid-cols-[260px_1fr]">
                    <div><div className="text-sm font-medium">{m.label}</div><div className="font-mono text-[11px] text-ink-3">{m.id}</div></div>
                    <div className="text-sm text-ink-2">{m.description}
                      <div className="mt-1 flex flex-wrap gap-1.5"><Badge>{m.format}</Badge>{m.higherIsBetter === true && <Badge tone="good">higher is better</Badge>}{m.higherIsBetter === false && <Badge tone="bad">lower is better</Badge>}{m.additive && <Badge>additive</Badge>}</div>
                      {m.caveat && <div className="mt-1 text-xs text-warn">⚠ {m.caveat}</div>}
                    </div>
                  </div>
                ))}
              </div>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
