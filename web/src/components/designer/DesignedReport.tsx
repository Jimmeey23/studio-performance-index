import { Fragment, useEffect, useRef, type ReactNode } from 'react';
import clsx from 'clsx';
import { Brain, AlertTriangle } from 'lucide-react';
import type { Block } from '../../lib/types';
import { BlockView, KpiCards } from '../blocks/Blocks';
import { layoutById, slotLetters, type Rendered, type RenderedSlot } from '../../lib/designer';
import { BRAND } from '../../lib/brand';
import { fmtPeriod } from '../../lib/format';

/** A rendered data element as an app block (same visuals as the workspace tabs). */
export function slotBlock(s: RenderedSlot): Block | null {
  const d = s.data; const w = d?.widget; const r = d?.result;
  if (!r) return null;
  const title = s.label || w?.title;
  switch (w?.type) {
    case 'chart': return { id: s.id, type: 'chart', title, result: r, chart: w.chart, series_by: w.dimension };
    case 'table': return { id: s.id, type: 'table', title, result: r, view: (w.view as Block['view']) ?? 'table', group_by: w.view === 'grouped' ? w.dimensions?.[0] : undefined };
    case 'ranking': return { id: s.id, type: 'table', title, result: r, view: 'ranked' };
    case 'mom': return { id: s.id, type: 'table', title, result: r, view: 'mom' };
    case 'analysis': return { id: s.id, type: (w.block ?? 'table') as Block['type'], title, result: r };
    default: return null;
  }
}

/** Lines from AI or text slots: bullets and numbered points become lists, the rest paragraphs. */
export function RichText({ text, className }: { text: string; className?: string }) {
  const lines = text.split(/\n+/).map((l) => l.trim()).filter(Boolean);
  const out: ReactNode[] = []; let list: string[] = []; let ordered = false;
  const flush = () => { if (list.length) { out.push(ordered ? <ol key={out.length} className="ml-5 list-decimal space-y-1">{list.map((x, i) => <li key={i}>{x}</li>)}</ol> : <ul key={out.length} className="ml-5 list-disc space-y-1">{list.map((x, i) => <li key={i}>{x}</li>)}</ul>); list = []; } };
  for (const l of lines) {
    const b = l.match(/^[-•*]\s+(.*)/), n = l.match(/^\d+[.)]\s+(.*)/);
    if (b || n) { if (list.length && ordered !== !!n) flush(); ordered = !!n; list.push((b ?? n)![1]); } else { flush(); out.push(<p key={out.length}>{l.replace(/\*\*/g, '')}</p>); }
  }
  flush();
  return <div className={clsx('space-y-2', className)}>{out}</div>;
}

export function SlotView({ s, ai, compact }: { s: RenderedSlot | null; ai: Record<string, string>; compact?: boolean }) {
  if (!s) return <div className="dz-empty" />;
  const h = compact ? 220 : 260;
  switch (s.kind) {
    case 'title': return <div className="dz-title"><h2>{s.text || 'Title'}</h2>{s.body && <p>{s.body}</p>}</div>;
    case 'text': return <div className="dz-text">{s.title && <h4>{s.title}</h4>}<RichText text={s.body || ''} /></div>;
    case 'quote': return <blockquote className="dz-quote"><span>“</span><p>{s.text}</p>{s.by && <cite>— {s.by}</cite>}</blockquote>;
    case 'image': return <div className="dz-image" style={{ backgroundImage: `url(${s.photo || BRAND.photos[0]})` }} />;
    case 'divider': return <div className="dz-divider"><span />{s.text && <em>{s.text}</em>}<span /></div>;
    case 'spacer': return <div />;
    case 'ai': {
      const t = ai[s.id];
      return <div className={clsx('dz-ai', s.style === 'callout' && 'callout')}><div className="dz-ai-k"><Brain size={11} />{s.label && s.label !== 'AI commentary' ? s.label : 'Analyst commentary'}</div>{t ? <RichText text={t} /> : <p className="dz-ai-wait">AI content will be written here: “{s.prompt}”</p>}</div>;
    }
  }
  const d = s.data;
  if (d?.error) return <div className="dz-err"><AlertTriangle size={13} />{s.label ? `${s.label}: ` : ''}{d.error}</div>;
  if (!d?.result) return <div className="dz-empty" />;
  if (s.kind === 'metric' || s.kind === 'metrics' || d.widget?.type === 'kpis') return <div className="dz-kpis">{s.label && s.kind !== 'metric' && <div className="dz-cap">{s.label}</div>}<KpiCards result={d.result} series={d.series} /></div>;
  const b = slotBlock(s);
  return b ? <BlockView block={b} height={h} /> : <div className="dz-empty" />;
}

const TINT: Record<string, string> = { soft: 'dz-tint-soft', navy: 'dz-tint-navy', sand: 'dz-tint-sand' };
function PageView({ p, ai, landscape, n }: { p: Rendered['pages'][number]; ai: Record<string, string>; landscape: boolean; n: number }) {
  const ref = useRef<HTMLElement>(null);
  useEffect(() => {
    const el = ref.current; if (!el) return;
    const io = new IntersectionObserver(([e]) => { if (e.isIntersecting) { el.classList.add('in'); io.disconnect(); } }, { threshold: 0.12 });
    io.observe(el); return () => io.disconnect();
  }, []);
  const L = layoutById(p.layout); const letters = slotLetters(L);
  const section = p.layout === 'section-break';
  return (
    <section ref={ref} className={clsx('dz-page', landscape && 'land', `anim-${p.animation ?? 'none'}`, TINT[p.tint ?? ''], section && 'dz-section')}>
      {(p.kicker || p.title || p.subtitle) && (
        <header className="dz-head">
          <div className="dz-kicker">{p.kicker || `Page ${String(n).padStart(2, '0')}`}</div>
          {p.title && <h1>{p.title}</h1>}
          {p.subtitle && <p>{p.subtitle}</p>}
        </header>
      )}
      <div className="dz-grid" style={{ gridTemplateAreas: L.areas.map((a) => `"${a}"`).join(' '), gridTemplateColumns: L.cols, gridTemplateRows: L.rows }}>
        {letters.map((a, i) => <div key={a} className={clsx('dz-cell', L.small?.includes(i) && 'small')} style={{ gridArea: a, ['--i' as string]: i }}><SlotView s={p.slots[i] ?? null} ai={ai} compact={L.slots > 3} /></div>)}
      </div>
      <footer className="dz-foot"><img src={BRAND.logoOnLight} alt="" /><span>{n}</span></footer>
    </section>
  );
}

/** The designed report: optional cover, then one page per designed page. */
export function DesignedReport({ r }: { r: Rendered }) {
  const d = r.design; const landscape = d.orientation === 'landscape';
  return (
    <div className="dz-doc" id="report-print-root">
      {d.cover && (
        <section className={clsx('dz-page dz-cover anim-fade in', landscape && 'land')}>
          <div className="dz-cover-bg" style={{ backgroundImage: `url(${BRAND.photos[1]})` }} />
          <div className="dz-cover-in">
            <img src={BRAND.logoOnDark} alt="" className="dz-cover-logo" />
            <div className="dz-cover-mid">
              <div className="dz-kicker">Custom report</div>
              <h1>{d.title}</h1>
              {d.subtitle && <p>{d.subtitle}</p>}
              <div className="dz-cover-meta">{r.scope} · {fmtPeriod(r.period.start, 'day')} – {fmtPeriod(r.period.end, 'day')}</div>
            </div>
            <ol className="dz-cover-toc">{r.pages.map((p, i) => <Fragment key={p.id}>{p.title && <li><span>{String(i + 1).padStart(2, '0')}</span>{p.title}</li>}</Fragment>)}</ol>
          </div>
        </section>
      )}
      {r.pages.map((p, i) => <PageView key={p.id} p={p} ai={r.ai ?? {}} landscape={landscape} n={i + 1} />)}
    </div>
  );
}
