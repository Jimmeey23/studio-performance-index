export type Format = 'currency' | 'number' | 'percent' | 'decimal' | 'days' | 'date' | 'text';
export interface Column { key: string; label: string; kind: 'period' | 'dimension' | 'metric' | 'comparison' | 'change'; format?: Format }
export interface Check { name: string; passed: boolean; detail: string }
export interface Result {
  id: string; kind: string; title?: string;
  columns: Column[]; rows: Record<string, unknown>[]; totals?: Record<string, unknown>;
  sql: string[]; sources: string[]; notes: string[]; checks: Check[]; verified: boolean;
  definitions: { metric: string; label: string; description: string; caveat?: string }[];
  period?: { start?: string; end?: string; comparisonStart?: string; comparisonEnd?: string };
  spec?: Record<string, unknown>; extra?: Record<string, unknown>; rowCount: number; truncated?: boolean;
}
export interface Block {
  id: string; type: 'kpis' | 'table' | 'chart' | 'forecast_chart' | 'heatmap' | 'funnel' | 'insights' | 'clarify' | 'followups' | 'details';
  view?: 'table' | 'mom' | 'pivot' | 'grouped' | 'ranked' | 'transposed' | 'heatmap' | 'stats' | 'cards'; group_by?: string;
  question?: string; options?: string[]; why?: string; questions?: string[];
  drilldowns?: Result[]; definitions?: Result['definitions']; sources?: string[]; notes?: string[];
  title?: string; chart?: string; x?: string; y?: string[]; series_by?: string; metrics?: string[]; columns?: string[];
  pivot?: { rows: string; columns: string; value: string };
  items?: { kind: 'observation' | 'risk' | 'opportunity' | 'recommendation'; title: string; detail: string; priority?: 'high' | 'medium' | 'low' }[];
  result?: Result;
}
export interface Step { id: string; label: string; detail?: string; status: 'running' | 'done' | 'error'; ms?: number }
export interface Verification { checked: number; unmatched: string[] }
export interface Message {
  id: string; role: 'user' | 'assistant'; text: string; blocks?: Block[]; steps?: Step[];
  verification?: Verification; ms?: number; pending?: boolean; error?: string; created_at?: string;
  model?: string; tier?: 'fast' | 'balanced' | 'deep'; tierReason?: string; controls?: Controls; queued?: boolean; thinking?: string;
  plan?: { goal: string; steps: { id: string; text: string; status: 'pending' | 'running' | 'done' | 'skipped'; note?: string }[] };
}
export interface Controls {
  period?: { label?: string; start?: string; end?: string };
  locations?: string[];
  compare?: 'previous_period' | 'previous_year' | null;
  tier?: 'auto' | 'fast' | 'balanced' | 'deep';
}
export interface DomainMeta { id: string; label: string; icon: string; blurb: string; kpis: string[]; presets: string[] }
export interface Conversation { id: string; title: string; pinned: boolean; updated_at: string; domain?: string | null }
export interface Me { id: string; email: string; name: string; role: 'admin' | 'analyst' | 'viewer'; aiConfigured: boolean; model: string; authDisabled: boolean; models?: Record<'fast' | 'balanced' | 'deep', { id: string; label: string }> }
