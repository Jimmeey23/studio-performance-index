import { useEffect, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { api } from '../lib/api';
import type { Result } from '../lib/types';
import { BlockView } from '../components/blocks/Blocks';
import { Button, PageHeader } from '../components/ui';
import { fmtPeriod } from '../lib/format';

interface Overview { period: { start: string; end: string }; kpis: Result; byLocation: Result; trend: Result; revenueForecast: Result; anomalies: Result }
const ok = (r: unknown): r is Result => !!r && !(r as { error?: string }).error;

export default function Insights() {
  const [d, setD] = useState<Overview | null>(null);
  const [loading, setLoading] = useState(false);
  const load = (refresh = false) => { setLoading(true); api<Overview>(`/api/insights${refresh ? '?refresh=1' : ''}`).then(setD).finally(() => setLoading(false)); };
  useEffect(() => load(), []);
  const b = (type: string, result: Result | undefined, extra: Record<string, unknown> = {}) => ok(result) ? <BlockView block={{ id: `${type}_${result.id}`, type: type as never, result, ...extra }} /> : null;
  return (
    <div>
      <PageHeader title="Forecasts & insights" subtitle={d ? `Last complete month: ${fmtPeriod(d.period.start)} · compared with the same month last year` : 'Computing…'}
        actions={<Button variant="outline" onClick={() => load(true)} disabled={loading}><RefreshCw size={14} className={loading ? 'animate-spin' : ''} />Refresh</Button>} />
      {!d && <div className="grid gap-4">{[1, 2, 3].map((i) => <div key={i} className="shimmer h-40 rounded-2xl" />)}</div>}
      {d && (
        <div className="space-y-4">
          {b('kpis', d.kpis, { title: 'Headline numbers' })}
          <div className="grid gap-4 xl:grid-cols-2">
            {b('forecast_chart', d.revenueForecast, { title: 'Revenue forecast (next 3 months)' })}
            {b('chart', d.trend, { title: 'Monthly revenue — this year vs last year', chart: 'bar', y: ['revenue', 'revenue__prev'] })}
          </div>
          {b('table', d.byLocation, { title: 'Locations — last complete month vs last year' })}
          {ok(d.anomalies) && b('table', { ...d.anomalies, rows: d.anomalies.rows.filter((r) => r.flag !== 'Normal') }, { title: 'Unusual movements by location', columns: ['metric', 'segment', 'value', 'trailing_avg', 'z_score', 'mom', 'yoy', 'direction'] })}
        </div>
      )}
    </div>
  );
}
