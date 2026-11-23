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
/** One annotation event: the elements discussed by the current cue. `add` keeps earlier marks that are still on the same screen. */
export type Ann = { els: HTMLElement[]; cue: AnnCue; key: number; add?: boolean } | null;
type Item = { el: HTMLElement; key: number; current: boolean };

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
  const [items, setItems] = useState<Item[]>([]);
  const [cue, setCue] = useState<AnnCue | null>(null);
  const [rects, setRects] = useState<DOMRect[]>([]);
  const [vw, setVw] = useState(window.innerWidth);
  const raf = useRef(0);
  useEffect(() => {
    const on = (e: Event) => {
      const a = (e as CustomEvent<Ann>).detail;
      if (!a) { setItems([]); setCue(null); return; }
      setCue(a.cue);
      setItems((prev) => {
        const keep = a.add ? prev.filter((p) => !a.els.includes(p.el)).map((p) => ({ ...p, current: false })) : [];
        return [...keep, ...a.els.map((el, i) => ({ el, key: a.key + i, current: true }))].slice(-8);
      });
    };
    window.addEventListener(ANN_EVENT, on); return () => window.removeEventListener(ANN_EVENT, on);
  }, []);
  useLayoutEffect(() => {
    cancelAnimationFrame(raf.current);
    if (!items.length) { setRects([]); return; }
    let last = '';
    const tick = () => {
      const rs = items.map((it) => it.el.getBoundingClientRect());
      const k = rs.map((r) => `${r.x | 0},${r.y | 0},${r.width | 0},${r.height | 0}`).join('|') + window.innerWidth;
      if (k !== last) { last = k; setRects(rs); setVw(window.innerWidth); }
      raf.current = requestAnimationFrame(tick);
    };
    tick(); return () => cancelAnimationFrame(raf.current);
  }, [items]);
  if (!items.length || rects.length !== items.length || !cue) return null;
  const vh = window.innerHeight;
  const on = (r: DOMRect) => r.bottom > 0 && r.top < vh;
  const cur = items.map((it, i) => ({ it, r: rects[i] })).filter((x) => x.it.current && x.it.el.isConnected && on(x.r));
  // one sticky note for the current cue, placed beside the group of elements it discusses
  const W = Math.min(280, vw - 32);
  const g = cur.length ? cur.reduce((a, x) => ({ l: Math.min(a.l, x.r.left), t: Math.min(a.t, x.r.top), rr: Math.max(a.rr, x.r.right), b: Math.max(a.b, x.r.bottom) }), { l: 1e9, t: 1e9, rr: -1e9, b: -1e9 }) : null;
  let note: { x: number; y: number; side: string } | null = null;
  if (g) {
    const side = g.rr + 40 + W < vw ? 'r' : g.l - 40 - W > 0 ? 'l' : g.t > 220 ? 't' : 'b';
    note = { side,
      x: side === 'r' ? g.rr + 40 : side === 'l' ? g.l - 40 - W : Math.max(16, Math.min(vw - W - 16, (g.l + g.rr) / 2 - W / 2)),
      y: side === 't' ? g.t - 150 : side === 'b' ? Math.min(vh - 170, g.b + 34) : Math.max(16, Math.min(vh - 190, (g.t + g.b) / 2 - 50)) };
  }
  const Dir = cue.dir === 'up' ? TrendingUp : cue.dir === 'down' ? TrendingDown : Sparkles;
  const arrow = (r: DOMRect, i: number) => {
    if (!note) return null; const { side } = note;
    const ax = side === 'r' ? note.x : side === 'l' ? note.x + W : note.x + W / 2; const ay = side === 't' ? note.y + 120 : side === 'b' ? note.y : note.y + 40;
    // aim at the nearest edge of each target
    const tx = side === 'r' ? r.right + 8 : side === 'l' ? r.left - 8 : r.left + r.width / 2;
    const ty = side === 't' ? r.top - 8 : side === 'b' ? r.bottom + 8 : r.top + r.height / 2;
    const mx = (ax + tx) / 2 + (side === 'r' || side === 'l' ? 0 : 40); const my = (ay + ty) / 2 - (side === 'r' || side === 'l' ? 36 : 0) - i * 8;
    const ang = Math.atan2(ty - my, tx - mx); const ah = (d: number) => `${tx - 12 * Math.cos(ang + d)},${ty - 12 * Math.sin(ang + d)}`;
    return <g className="gx-arrow" key={`a${i}`} style={{ ['--gx-d' as string]: `${0.45 + i * 0.18}s` }}>
      <path className="gx-draw gx-ink thin" d={`M${ax},${ay} Q${mx},${my} ${tx},${ty}`} pathLength={1} />
      <path className="gx-head" d={`M${ah(0.45)} L${tx},${ty} L${ah(-0.45)}`} />
    </g>;
  };
  return createPortal(<div className="gx-layer" aria-hidden>
    {items.map((it, i) => { const rect = rects[i]; if (!it.el.isConnected || !on(rect)) return null; const kind = kindOf(it.el); const delay = it.current ? `${cur.findIndex((c) => c.it === it) * 0.18}s` : '0s';
      return <div key={it.key} className={it.current ? 'gx-item' : 'gx-item old'} style={{ ['--gx-i' as string]: delay }}>
        {kind === 'row' && <div className="gx-rowfill" style={{ left: rect.left, top: rect.top, width: rect.width, height: rect.height }} />}
        <svg className="gx-svg" width="100%" height="100%">
          {kind === 'circle' && <path className="gx-draw gx-ink" d={scribble(rect.left, rect.top, rect.width, rect.height, true, it.key)} pathLength={1} />}
          {kind === 'box' && <path className="gx-draw gx-ink" d={scribble(rect.left, rect.top, rect.width, rect.height, false, it.key)} pathLength={1} />}
          {kind === 'row' && <>
            <path className="gx-draw gx-ink" d={`M${rect.left - 6},${rect.top - 2} L${rect.left - 14},${rect.top - 2} L${rect.left - 14},${rect.bottom + 2} L${rect.left - 6},${rect.bottom + 2}`} pathLength={1} />
            <path className="gx-draw gx-ink thin" d={`M${rect.left},${rect.bottom + 3} Q${rect.left + rect.width / 2},${rect.bottom + 7} ${rect.right},${rect.bottom + 2}`} pathLength={1} />
          </>}
          {kind === 'mark' && (() => { const ln = firstLine(it.el) ?? rect; const y = ln.bottom + 4; const x2 = Math.min(ln.right, ln.left + 520);
            return <path className="gx-draw gx-marker" d={`M${ln.left},${y} Q${(ln.left + x2) / 2},${y + 3} ${x2},${y - 1}`} pathLength={1} />; })()}
        </svg>
        {kind === 'circle' && it.current && <span className={`gx-badge ${cue.dir || 'flat'}`} style={{ left: rect.right - 6, top: rect.top - 14 }}><Dir size={14} /></span>}
      </div>; })}
    <svg className="gx-svg" width="100%" height="100%">{cur.map((x, i) => arrow(x.r, i))}</svg>
    {note && cue.text && <div key={items[items.length - 1].key} className={`gx-note s-${note.side}`} style={{ left: note.x, top: note.y, width: W }}>
      <div className="gx-pin" />
      <div className="gx-note-h"><Quote size={12} /><span>Now discussing</span><Dir size={13} className={`gx-dir ${cue.dir || 'flat'}`} /></div>
      <p>{cue.text}</p>
      {!!cue.nums.length && <div className="gx-chips">{cue.nums.slice(0, 4).map((n, i) => <b key={i} style={{ animationDelay: `${0.5 + i * 0.12}s` }}>{fmtNum(n)}</b>)}</div>}
    </div>}
  </div>, document.body);
}
