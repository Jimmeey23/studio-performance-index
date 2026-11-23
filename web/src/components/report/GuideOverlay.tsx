/**
 * Narration annotations: while a narrated clip plays, the element being discussed gets a hand-drawn mark
 * (circle for a KPI, box for a chart/card, bracket + fill for a table row, marker underline for prose),
 * an animated arrow from a sticky-note callout carrying the spoken line, the spoken numbers as chips and a trend icon.
 * Everything is an absolutely positioned SVG/HTML layer that tracks the target on every frame (scroll, resize, layout).
 */
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Quote, TrendingDown, TrendingUp, Sparkles } from 'lucide-react';

export type AnnCue = { text?: string; dir?: '' | 'up' | 'down'; nums: { v: number; u: '' | '%' | 'pp' }[] };
export type Ann = { el: HTMLElement; cue: AnnCue; key: number } | null;

const ANN_EVENT = 'narr:ann';
export const showAnn = (a: Ann) => window.dispatchEvent(new CustomEvent<Ann>(ANN_EVENT, { detail: a }));

type Kind = 'circle' | 'box' | 'row' | 'mark';
const kindOf = (el: HTMLElement): Kind =>
  el.matches('tr') ? 'row' : el.matches('.epr-kpi') ? 'circle' : el.matches('.epr-card, .epr-spot, .epr-sum') ? 'box' : 'mark';

const fmtNum = (n: AnnCue['nums'][number]) => n.u ? `${n.v}${n.u === '%' ? '%' : ' pp'}`
  : n.v >= 1e7 ? `₹${+(n.v / 1e7).toFixed(2)}Cr` : n.v >= 1e5 ? `₹${+(n.v / 1e5).toFixed(1)}L` : n.v.toLocaleString('en-IN');

/** Slightly wobbly closed path around a rect: reads as hand-drawn. */
function scribble(x: number, y: number, w: number, h: number, round: boolean, seed: number) {
  const r = (i: number) => Math.sin(seed * 9.13 + i * 0.9) * 3;
  if (round) {
    const cx = x + w / 2, cy = y + h / 2, rx = w / 2 + 14, ry = h / 2 + 12; const pts: string[] = [];
    for (let i = 0; i <= 52; i++) { const a = -Math.PI / 2 + (i / 48) * Math.PI * 2; pts.push(`${(cx + Math.cos(a) * (rx + r(i))).toFixed(1)},${(cy + Math.sin(a) * (ry + r(i + 5))).toFixed(1)}`); }
    return `M${pts.join(' L')}`;
  }
  const p = 8;
  return `M${x - p + r(1)},${y - p} L${x + w + p},${y - p + r(2)} L${x + w + p + r(3)},${y + h + p} L${x - p},${y + h + p + r(4)} L${x - p + r(5)},${y - p - 4}`;
}

/** Box of the first rendered line of text inside el, so the underline sits under the words, not across them. */
function firstLine(el: HTMLElement): DOMRect | null {
  const r = document.createRange(); r.selectNodeContents(el);
  const rs = [...r.getClientRects()].filter((x) => x.width > 2 && x.height > 2);
  if (!rs.length) return null;
  const top = rs[0].top; const line = rs.filter((x) => Math.abs(x.top - top) < 4);
  const left = Math.min(...line.map((x) => x.left)); const right = Math.max(...line.map((x) => x.right)); const bottom = Math.max(...line.map((x) => x.bottom));
  return new DOMRect(left, top, right - left, bottom - top);
}

export function GuideOverlay() {
  const [ann, setAnn] = useState<Ann>(null);
  const [rect, setRect] = useState<DOMRect | null>(null);
  const [vw, setVw] = useState(window.innerWidth);
  const raf = useRef(0);
  useEffect(() => {
    const on = (e: Event) => setAnn((e as CustomEvent<Ann>).detail);
    window.addEventListener(ANN_EVENT, on); return () => window.removeEventListener(ANN_EVENT, on);
  }, []);
  useLayoutEffect(() => {
    cancelAnimationFrame(raf.current);
    if (!ann) { setRect(null); return; }
    let last = '';
    const tick = () => {
      const r = ann.el.getBoundingClientRect(); const k = `${r.x|0},${r.y|0},${r.width|0},${r.height|0},${window.innerWidth}`;
      if (k !== last) { last = k; setRect(r); setVw(window.innerWidth); }
      raf.current = requestAnimationFrame(tick);
    };
    tick(); return () => cancelAnimationFrame(raf.current);
  }, [ann]);
  if (!ann || !rect || !ann.el.isConnected) return null;

  const kind = kindOf(ann.el); const { cue } = ann;
  const visible = rect.bottom > 0 && rect.top < window.innerHeight;
  // callout: beside the target where there is room, else above/below
  const W = Math.min(280, vw - 32);
  const right = rect.right + 40 + W < vw; const left = rect.left - 40 - W > 0;
  const side = right ? 'r' : left ? 'l' : rect.top > 220 ? 't' : 'b';
  const cx = side === 'r' ? rect.right + 40 : side === 'l' ? rect.left - 40 - W : Math.max(16, Math.min(vw - W - 16, rect.left + rect.width / 2 - W / 2));
  const cy = side === 't' ? rect.top - 150 : side === 'b' ? rect.bottom + 34 : Math.max(16, rect.top + rect.height / 2 - 50);
  // arrow: from callout edge to target edge, curved
  const ax = side === 'r' ? cx : side === 'l' ? cx + W : cx + W / 2; const ay = side === 't' ? cy + 120 : side === 'b' ? cy : cy + 40;
  const tx = side === 'r' ? rect.right + 8 : side === 'l' ? rect.left - 8 : rect.left + rect.width / 2; const ty = side === 't' ? rect.top - 8 : side === 'b' ? rect.bottom + 8 : rect.top + rect.height / 2;
  const mx = (ax + tx) / 2 + (side === 'r' || side === 'l' ? 0 : 40); const my = (ay + ty) / 2 - (side === 'r' || side === 'l' ? 36 : 0);
  const ang = Math.atan2(ty - my, tx - mx); const ah = (d: number) => `${tx - 12 * Math.cos(ang + d)},${ty - 12 * Math.sin(ang + d)}`;
  const Dir = cue.dir === 'up' ? TrendingUp : cue.dir === 'down' ? TrendingDown : Sparkles;

  return createPortal(<div className="gx-layer" aria-hidden key={ann.key}>
    {kind === 'row' && <div className="gx-rowfill" style={{ left: rect.left, top: rect.top, width: rect.width, height: rect.height }} />}
    <svg className="gx-svg" width="100%" height="100%">
      {kind === 'circle' && <path className="gx-draw gx-ink" d={scribble(rect.left, rect.top, rect.width, rect.height, true, ann.key)} pathLength={1} />}
      {kind === 'box' && <path className="gx-draw gx-ink" d={scribble(rect.left, rect.top, rect.width, rect.height, false, ann.key)} pathLength={1} />}
      {kind === 'row' && <>
        <path className="gx-draw gx-ink" d={`M${rect.left - 6},${rect.top - 2} L${rect.left - 14},${rect.top - 2} L${rect.left - 14},${rect.bottom + 2} L${rect.left - 6},${rect.bottom + 2}`} pathLength={1} />
        <path className="gx-draw gx-ink thin" d={`M${rect.left},${rect.bottom + 3} Q${rect.left + rect.width / 2},${rect.bottom + 7} ${rect.right},${rect.bottom + 2}`} pathLength={1} />
      </>}
      {kind === 'mark' && (() => { const ln = firstLine(ann.el) ?? rect; const y = ln.bottom + 4; const x2 = Math.min(ln.right, ln.left + 520);
        return <path className="gx-draw gx-marker" d={`M${ln.left},${y} Q${(ln.left + x2) / 2},${y + 3} ${x2},${y - 1}`} pathLength={1} />; })()}
      {visible && <g className="gx-arrow">
        <path className="gx-draw gx-ink thin" d={`M${ax},${ay} Q${mx},${my} ${tx},${ty}`} pathLength={1} />
        <path className="gx-head" d={`M${ah(0.45)} L${tx},${ty} L${ah(-0.45)}`} />
      </g>}
    </svg>
    {kind === 'circle' && <span className={`gx-badge ${cue.dir || 'flat'}`} style={{ left: rect.right - 6, top: rect.top - 14 }}><Dir size={14} /></span>}
    {visible && cue.text && <div className={`gx-note s-${side}`} style={{ left: cx, top: cy, width: W }}>
      <div className="gx-pin" />
      <div className="gx-note-h"><Quote size={12} /><span>Now discussing</span><Dir size={13} className={`gx-dir ${cue.dir || 'flat'}`} /></div>
      <p>{cue.text}</p>
      {!!cue.nums.length && <div className="gx-chips">{cue.nums.slice(0, 4).map((n, i) => <b key={i} style={{ animationDelay: `${0.5 + i * 0.12}s` }}>{fmtNum(n)}</b>)}</div>}
    </div>}
  </div>, document.body);
}
