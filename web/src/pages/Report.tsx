import { useEffect, useMemo, useRef, useState } from 'react';
import clsx from 'clsx';
import { useNavigate } from 'react-router-dom';
import { FileText, Sparkles, CalendarRange, MapPin, GitCompare, Brain, Settings2, Loader2, CheckCircle2, AlertTriangle, Palette, History, Save, Zap, LayoutTemplate } from 'lucide-react';
import { api } from '../lib/api';
import { useMe } from '../App';
import { ReportDocument } from '../components/report/ReportDocument';
import { LayoutPanel } from '../components/report/LayoutPanel';
import { MON, PRESETS, range } from '../lib/periods';
import { ExportMenu } from '../components/report/ExportMenu';
import { arrange, DEFAULT_LAYOUT, normLayout, type ReportData, type ReportInsights, type ReportLayout } from '../lib/report';

type Saved = { insights: ReportInsights | null; layout: unknown; created_at: string; reused: boolean };
type SavedReport = ReportData & { saved?: Saved };
type HistoryItem = { id: string; label: string; scope: string; created_at: string; has_ai: boolean };

export default function Report() {
  const me = useMe();
  const now = new Date();
  const lastMonth = `${now.getMonth() === 0 ? now.getFullYear() - 1 : now.getFullYear()}-${String(now.getMonth() === 0 ? 12 : now.getMonth()).padStart(2, '0')}`;
  const [preset, setPreset] = useState<string>('lm');
  const [month, setMonth] = useState(lastMonth);
  const [custom, setCustom] = useState(range('l3'));
  const [locations, setLocations] = useState<string[]>([]);
  const [allLocs, setAllLocs] = useState<string[]>([]);
  const compare = 'previous_period' as const;
  const [tier, setTier] = useState<'balanced' | 'deep'>('balanced');
  const [data, setData] = useState<ReportData | null>(null);
  const [ins, setIns] = useState<ReportInsights | null>(null);
  const [layout, setLayoutState] = useState<ReportLayout>(DEFAULT_LAYOUT);
  const [savedInfo, setSavedInfo] = useState<Saved | null>(null);
  const [fresh, setFresh] = useState(false);
  const [building, setBuilding] = useState(false);
  const [aiLoading, setAiLoading] = useState(false);
  const [loadingSaved, setLoadingSaved] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [setupOpen, setSetupOpen] = useState(false);
  const [customOpen, setCustomOpen] = useState(false);
  const [history, setHistory] = useState<HistoryItem[] | null>(null);
  const [histOpen, setHistOpen] = useState(false);
  const navigate = useNavigate();
  const scroller = useRef<HTMLDivElement>(null);
  const [layoutState, setLayoutSave] = useState<'idle' | 'saving' | 'saved'>('idle');
  const docRef = useRef<HTMLDivElement>(null);
  const saveTimer = useRef<number | undefined>(undefined);
  useEffect(() => { api<string[]>('/api/locations').then(setAllLocs).catch(() => {}); }, []);

  /** Show a saved report exactly as it was left — its numbers, its commentary and its layout; no AI call. */
  const show = (r: SavedReport) => {
    const { saved, ...d } = r;
    setData(d); setIns(saved?.insights ?? null); setSavedInfo(saved ?? null); setLayoutState(normLayout(saved?.layout));
    setPreset('custom'); setCustom({ start: d.request.start, end: d.request.end }); setLocations(d.request.locations);
  };
  useEffect(() => {
    api<SavedReport | null>('/api/report/latest').then((r) => { if (r) show(r); else setSetupOpen(true); }).catch(() => setSetupOpen(true)).finally(() => setLoadingSaved(false));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const loadHistory = async () => { setHistOpen((o) => !o); try { setHistory(await api<HistoryItem[]>('/api/report/saved')); } catch { /* */ } };
  const openSaved = async (id: string) => { setHistOpen(false); try { show(await api<SavedReport>(`/api/report/${id}`)); setSetupOpen(false); } catch (e) { setErr((e as Error).message); } };

  const setLayout = (l: ReportLayout) => {
    setLayoutState(l);
    if (!data) return;
    window.clearTimeout(saveTimer.current); setLayoutSave('saving');
    saveTimer.current = window.setTimeout(() => {
      api(`/api/report/${data.id}/layout`, { method: 'PUT', json: { layout: l } }).then(() => setLayoutSave('saved')).catch(() => setLayoutSave('idle'));
    }, 600);
  };

  const period = preset === 'custom' ? custom : preset === 'month' ? range('month', month) : range(preset);
  const label = (() => { const s = new Date(period.start + 'T00:00:00Z'), e = new Date(period.end + 'T00:00:00Z'); return s.getUTCMonth() === e.getUTCMonth() && s.getUTCFullYear() === e.getUTCFullYear() && s.getUTCDate() === 1 ? `${MON[s.getUTCMonth()]}-${s.getUTCFullYear()}` : `${period.start} → ${period.end}`; })();

  const generate = async () => {
    setBuilding(true); setErr(null);
    try {
      const r = await api<SavedReport>('/api/report', { method: 'POST', json: { ...period, locations, compare, fresh, layout } });
      show(r); setSetupOpen(false);
      // commentary is written once per report; a saved report already carries it
      if (!r.saved?.insights) writeCommentary(r.id);
    } catch (e) { setErr((e as Error).message); } finally { setBuilding(false); }
  };
  const writeCommentary = async (id: string, again = false) => {
    setAiLoading(true);
    try { setIns(await api<ReportInsights>(`/api/report/${id}/insights`, { method: 'POST', json: { tier, fresh: again } })); }
    catch (e) { setErr(`Commentary: ${(e as Error).message}`); } finally { setAiLoading(false); }
  };
  const view = useMemo(() => (data ? arrange(data, layout) : null), [data, layout]);

  const chip = (on: boolean) => clsx('rounded-full border px-3 py-1.5 text-xs transition', on ? 'border-accent bg-accent text-white shadow-sm' : 'border-line bg-surface hover:border-accent/50');
  return (
    <div className="flex h-full flex-col">
      <div className="page-hero px-8 pb-5 pt-7 no-print">
        <div className="relative z-[1] mx-auto flex max-w-[1240px] flex-wrap items-center gap-5">
          <div className="hero-icon flex h-14 w-14 items-center justify-center rounded-2xl"><FileText size={26} /></div>
          <div className="min-w-0">
            <div className="mb-1 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-accent"><Sparkles size={12} />Senior management</div>
            <h1 className="text-[28px] font-bold leading-tight text-ink">Executive report</h1>
            <p className="mt-0.5 text-[13.5px] text-ink-3">Pick a period and studios — get a board-ready A4 report with AI commentary, every section of the business and exports.</p>
          </div>
          {data && (
            <div className="ml-auto flex items-center gap-2">
              <div className="relative">
                <button onClick={loadHistory} className="tool !h-10 !px-3.5"><History size={15} />Saved</button>
                {histOpen && (
                  <div className="pop-in absolute right-0 z-40 mt-2 max-h-96 w-80 overflow-y-auto rounded-2xl border border-line bg-surface p-2 shadow-2xl" onMouseLeave={() => setHistOpen(false)}>
                    {!history ? <div className="p-3 text-xs text-ink-3">Loading…</div> : !history.length ? <div className="p-3 text-xs text-ink-3">No saved reports yet.</div> : history.map((h) => (
                      <button key={h.id} onClick={() => openSaved(h.id)} className={clsx('flex w-full items-start gap-3 rounded-xl px-3 py-2 text-left hover:bg-accent-soft', h.id === data.id && 'bg-accent-soft')}>
                        <span className="panel-tile !h-8 !w-8"><FileText size={14} /></span>
                        <span className="min-w-0"><span className="block truncate text-sm font-semibold text-ink">{h.label} · {h.scope}</span><span className="block text-[11px] text-ink-3">{new Date(h.created_at.replace(' ', 'T')).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}{h.has_ai ? ' · AI commentary' : ''}</span></span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
              <button onClick={() => { setSetupOpen(true); setHistOpen(false); setTimeout(() => scroller.current?.scrollTo({ top: 0, behavior: 'smooth' }), 30); }} className={clsx('tool !h-10 !px-3.5', setupOpen && '!border-accent !text-accent')}><Settings2 size={15} />New report</button>
              <button onClick={() => navigate('/designer')} className="tool !h-10 !px-3.5" title="Design a custom report from a wireframe"><LayoutTemplate size={15} />Designer</button>
              <button onClick={() => setCustomOpen((o) => !o)} className={clsx('tool !h-10 !px-3.5', customOpen && '!border-accent !text-accent')}><Palette size={15} />Customise</button>
              {(!ins || (ins.source === 'rules' && me?.aiConfigured)) && !aiLoading && <button onClick={() => writeCommentary(data.id, !!ins)} className="tool !h-10 !px-3.5" title="Write the AI commentary for this report (saved once written)"><Sparkles size={15} />{ins ? 'Add AI commentary' : 'Write commentary'}</button>}
              {view && <ExportMenu data={view} insights={ins} layout={layout} docRef={docRef} onError={setErr} />}
            </div>
          )}
        </div>
      </div>

      <div ref={scroller} className="flex-1 overflow-y-auto">
        <div className="mx-auto max-w-[1240px] space-y-5 px-8 py-6">
          {loadingSaved && !data && <div className="panel flex items-center gap-2 p-6 text-sm text-ink-3"><Loader2 size={15} className="animate-spin" />Opening your last report…</div>}
          {(setupOpen || (!data && !loadingSaved)) && (
            <div className="panel fade-up p-6 no-print">
              <div className="grid gap-6 lg:grid-cols-[1.25fr_1fr]">
                <div>
                  <div className="mb-2 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wider text-ink-3"><CalendarRange size={13} className="text-accent" />1 · Period</div>
                  <div className="flex flex-wrap gap-1.5">{PRESETS.map(([id, l]) => <button key={id} className={chip(preset === id)} onClick={() => setPreset(id)}>{l}</button>)}</div>
                  {preset === 'month' && <input type="month" value={month} max={lastMonth} onChange={(e) => setMonth(e.target.value)} className="field mt-3 !h-10 w-48" />}
                  {preset === 'custom' && (
                    <div className="mt-3 flex items-center gap-2 text-sm">
                      <input type="date" value={custom.start} onChange={(e) => setCustom({ ...custom, start: e.target.value })} className="field !h-10" /><span className="text-ink-3">to</span>
                      <input type="date" value={custom.end} onChange={(e) => setCustom({ ...custom, end: e.target.value })} className="field !h-10" />
                    </div>
                  )}
                  <div className="mt-3 text-xs text-ink-3">Selected: <b className="text-ink">{label}</b> · {period.start} → {period.end}</div>

                  <div className="mb-2 mt-6 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wider text-ink-3"><GitCompare size={13} className="text-accent" />3 · Benchmarks (automatic)</div>
                  <div className="grid grid-cols-3 gap-2 text-xs">{[['Previous month', 'the period just before'], ['Current-year average', 'monthly mean, Jan → previous month'], ['Same month last year', 'seasonally like-for-like']].map(([a, b]) => <div key={a} className="rounded-xl border border-line bg-surface-2/60 p-2.5"><div className="font-semibold text-ink">{a}</div><div className="text-[11px] text-ink-3">{b}</div></div>)}</div>
                </div>
                <div>
                  <div className="mb-2 flex items-center justify-between text-[11px] font-semibold uppercase tracking-wider text-ink-3"><span className="flex items-center gap-2"><MapPin size={13} className="text-accent" />2 · Studios</span>
                    <span className="flex gap-2 normal-case tracking-normal"><button className="text-accent" onClick={() => setLocations([])}>All studios</button></span></div>
                  <div className="flex flex-wrap gap-1.5">
                    <button className={chip(locations.length === 0)} onClick={() => setLocations([])}>All studios</button>
                    {allLocs.map((l) => { const on = locations.includes(l); return <button key={l} className={chip(on)} onClick={() => setLocations(on ? locations.filter((x) => x !== l) : [...locations, l])}>{l}</button>; })}
                  </div>
                  <div className="mt-2 text-xs text-ink-3">{locations.length ? `${locations.length} studio${locations.length > 1 ? 's' : ''} selected` : 'Whole business — includes a studio comparison page'}</div>

                  <div className="mb-2 mt-6 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wider text-ink-3"><Brain size={13} className="text-accent" />4 · AI commentary</div>
                  <div className="seg">{([['balanced', 'Standard (Sonnet)'], ['deep', 'Deepest (Opus)']] as const).map(([v, l]) => <button key={v} className={clsx(tier === v && 'on')} onClick={() => setTier(v)}>{l}</button>)}</div>
                  {!me?.aiConfigured && <div className="mt-2 text-[11px] text-warn">AI key not configured — the report uses rule-based commentary.</div>}
                </div>
              </div>
              <div className="mt-6 flex items-center gap-3 border-t border-line pt-5">
                <button onClick={generate} disabled={building} className="btn-brand inline-flex h-11 items-center gap-2 rounded-xl px-6 text-sm font-semibold text-white disabled:opacity-60">{building ? <Loader2 size={16} className="animate-spin" /> : <Sparkles size={16} />}{building ? 'Building report…' : 'Generate report'}</button>
                <button onClick={() => setFresh((f) => !f)} className={clsx('flex h-11 shrink-0 items-center gap-2.5 rounded-xl border px-3.5 text-left text-xs transition', fresh ? 'border-accent bg-accent-soft' : 'border-line')} title="Off: if this period and studio selection was generated before, the saved report and its commentary are reused at no AI cost.">
                  <span className={clsx('relative h-5 w-9 rounded-full transition', fresh ? 'bg-accent' : 'bg-line')}><span className={clsx('absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-all', fresh ? 'left-[18px]' : 'left-0.5')} /></span>
                  <span><span className="flex items-center gap-1 font-semibold text-ink"><Zap size={12} className="text-accent" />Fresh report</span><span className="block text-[11px] text-ink-3">{fresh ? 'Recompute numbers & new AI commentary' : 'Reuse a saved report if one exists'}</span></span>
                </button>
                <span className="text-xs text-ink-3">Sales · New clients & conversion · Lead & funnel health · Trainer performance · Class performance & booking behaviour · Format comparison · Lapsed & membership churn · Late cancellation · Road ahead — plus scorecard and a 14-month appendix.</span>
              </div>
            </div>
          )}
          {err && <div className="no-print flex items-center gap-2 rounded-xl border border-bad/30 bg-bad/5 p-3 text-sm text-bad"><AlertTriangle size={15} />{err}</div>}
          {data && (
            <>
              <div className="no-print flex flex-wrap items-center gap-2 text-xs text-ink-3">
                <span className="chip"><CalendarRange size={12} />{data.period.label}</span>
                <span className="chip"><MapPin size={12} />{data.scope}</span>
                <span className="chip"><GitCompare size={12} />vs {data.period.prevLabel} · {data.period.ytdLabel} · {data.period.lyLabel}</span>
                {aiLoading ? <span className="chip text-accent"><Loader2 size={12} className="animate-spin" />Writing executive commentary…</span>
                  : ins ? <span className="chip"><CheckCircle2 size={12} className="text-good" />{ins.source === 'ai' ? `Commentary by ${ins.model}` : 'Rule-based commentary'}{ins.verification ? ` · ${ins.verification.checked - ins.verification.unmatched.length}/${ins.verification.checked} figures traced` : ''}</span> : null}
                {savedInfo && <span className="chip"><Save size={12} />{savedInfo.reused ? 'Saved report' : 'Saved'} · {new Date(savedInfo.created_at.replace(' ', 'T')).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</span>}
                {layoutState === 'saving' ? <span className="chip"><Loader2 size={12} className="animate-spin" />Saving layout…</span> : layoutState === 'saved' ? <span className="chip"><CheckCircle2 size={12} className="text-good" />Layout saved</span> : null}
                <span className="ml-auto">Click any number for the records behind it · A4 pages, ready to export</span>
              </div>
              <div ref={docRef} className="overflow-x-auto rounded-3xl bg-[#e8e8e3] py-10 dark:bg-[#1a1b20]">
                <ReportDocument data={view ?? data} insights={ins} aiLoading={aiLoading} layout={layout} />
              </div>
            </>
          )}
        </div>
      </div>
      {customOpen && data && <LayoutPanel layout={layout} data={data} onChange={setLayout} onClose={() => setCustomOpen(false)} />}
    </div>
  );
}
