/**
 * Presenter tools for the performance review: laser pointer, spotlight, pen and
 * highlighter (drawn over the report, scrolls with it), sticky-note annotations
 * pinned to a chapter, a presentation timer and keyboard shortcuts.
 */
import { createContext, useContext, useEffect, useRef, useState, type RefObject } from 'react';
import clsx from 'clsx';
import { Eraser, Highlighter, Keyboard, MousePointer2, PenLine, Presentation, ScanEye, StickyNote, Timer, Undo2, X } from 'lucide-react';

export type Tool = 'none' | 'laser' | 'spot' | 'pen' | 'hl' | 'note';
export interface ReviewNote { id: string; sec: string; x: number; y: number; text: string; color: string; by?: string; at: string }
export const NOTE_COLORS = ['#fde68a', '#bbf7d0', '#bfdbfe', '#fbcfe8', '#e9d5ff'];
const PEN_COLORS = ['#e11d48', '#2563eb', '#16a34a', '#111827'];

type NotesApi = { notes: ReviewNote[]; update: (id: string, patch: Partial<ReviewNote>) => void; remove: (id: string) => void };
export const NotesCtx = createContext<NotesApi | null>(null);

/** Sticky notes belonging to one chapter, positioned relative to the chapter. */
export function ChapterNotes({ sec }: { sec: string }) {
  const api = useContext(NotesCtx);
  const mine = api?.notes.filter((n) => n.sec === sec) ?? [];
  if (!api || !mine.length) return null;
  return <>{mine.map((n) => (
    <div key={n.id} className="epr-sticky no-print-hide" style={{ left: `${n.x * 100}%`, top: `${n.y * 100}%`, background: n.color }}>
      <div className="epr-sticky-bar">
        {NOTE_COLORS.map((c) => <button key={c} style={{ background: c }} className={clsx(c === n.color && 'on')} onClick={() => api.update(n.id, { color: c })} aria-label="Note colour" />)}
        <button className="x" onClick={() => api.remove(n.id)} title="Delete note"><X size={12} /></button>
      </div>
      <textarea defaultValue={n.text} autoFocus={!n.text} placeholder="Write a note…" onBlur={(e) => e.target.value !== n.text && api.update(n.id, { text: e.target.value })} />
      {n.by && <div className="epr-sticky-by">{n.by}</div>}
    </div>
  ))}</>;
}

/** Freehand pen / highlighter. The canvas only covers the visible viewport (a full-report canvas can exceed
 *  the browser's canvas size limit and blank the page); strokes are stored in report coordinates and
 *  redrawn on scroll, so ink stays attached to the content. Nothing is mounted until ink is used. */
export function InkLayer({ scroller, tool, color, clearKey, undoKey }: { scroller: RefObject<HTMLElement | null>; tool: Tool; color: string; clearKey: number; undoKey: number }) {
  const cv = useRef<HTMLCanvasElement>(null);
  const strokes = useRef<{ c: string; w: number; a: number; pts: [number, number][] }[]>([]);
  const [count, setCount] = useState(0);
  const active = tool === 'pen' || tool === 'hl';
  const draw = () => {
    const c = cv.current; const sc = scroller.current; if (!c || !sc) return;
    const r = sc.getBoundingClientRect(); const dpr = Math.min(window.devicePixelRatio || 1, 2);
    c.style.left = `${r.left}px`; c.style.top = `${r.top}px`; c.style.width = `${sc.clientWidth}px`; c.style.height = `${sc.clientHeight}px`;
    const W = Math.round(sc.clientWidth * dpr), H = Math.round(sc.clientHeight * dpr);
    if (c.width !== W || c.height !== H) { c.width = W; c.height = H; }
    const g = c.getContext('2d'); if (!g) return;
    g.setTransform(dpr, 0, 0, dpr, 0, -sc.scrollTop * dpr); g.clearRect(0, sc.scrollTop, sc.clientWidth, sc.clientHeight); g.lineCap = 'round'; g.lineJoin = 'round';
    for (const s of strokes.current) { g.globalAlpha = s.a; g.strokeStyle = s.c; g.lineWidth = s.w; g.beginPath(); s.pts.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y))); g.stroke(); }
  };
  useEffect(() => { strokes.current = []; setCount(0); draw(); }, [clearKey]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { strokes.current.pop(); setCount(strokes.current.length); draw(); }, [undoKey]); // eslint-disable-line react-hooks/exhaustive-deps
  const shown = active || count > 0;
  useEffect(() => {
    if (!shown) return; const sc = scroller.current; if (!sc) return;
    draw(); sc.addEventListener('scroll', draw, { passive: true }); window.addEventListener('resize', draw);
    return () => { sc.removeEventListener('scroll', draw); window.removeEventListener('resize', draw); };
  }, [shown]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!shown) return null;
  const pos = (e: React.PointerEvent) => { const r = cv.current!.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top + (scroller.current?.scrollTop ?? 0)] as [number, number]; };
  return <canvas ref={cv} className={clsx('epr-ink', active && 'on')}
    onPointerDown={(e) => { if (!active) return; (e.target as HTMLElement).setPointerCapture(e.pointerId); strokes.current.push({ c: color, w: tool === 'hl' ? 18 : 3, a: tool === 'hl' ? 0.28 : 0.95, pts: [pos(e)] }); setCount(strokes.current.length); draw(); }}
    onPointerMove={(e) => { if (!active || !e.buttons) return; strokes.current[strokes.current.length - 1]?.pts.push(pos(e)); draw(); }} />;
}

/** Laser dot and spotlight follow the cursor. */
export function PointerFx({ tool }: { tool: Tool }) {
  const [p, setP] = useState<{ x: number; y: number } | null>(null);
  useEffect(() => {
    if (tool !== 'laser' && tool !== 'spot') return;
    const m = (e: PointerEvent) => setP({ x: e.clientX, y: e.clientY });
    window.addEventListener('pointermove', m); return () => window.removeEventListener('pointermove', m);
  }, [tool]);
  if (!p) return null;
  if (tool === 'laser') return <div className="epr-laser" style={{ left: p.x, top: p.y }} />;
  if (tool === 'spot') return <div className="epr-spot-fx" style={{ background: `radial-gradient(circle 170px at ${p.x}px ${p.y}px, transparent 0 160px, rgb(0 0 0 / .62) 172px)` }} />;
  return null;
}

function useClock(on: boolean) {
  const [t0, setT0] = useState<number | null>(null); const [, tick] = useState(0);
  useEffect(() => { if (!on) { setT0(null); return; } setT0(Date.now()); const i = setInterval(() => tick((x) => x + 1), 1000); return () => clearInterval(i); }, [on]);
  const s = t0 ? Math.floor((Date.now() - t0) / 1000) : 0;
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}

/** The presenter toolbar (floating, bottom centre). */
export function PresenterBar({ tool, setTool, color, setColor, onClear, onUndo, present, togglePresent, open, setOpen }: {
  tool: Tool; setTool: (t: Tool) => void; color: string; setColor: (c: string) => void; onClear: () => void; onUndo: () => void;
  present: boolean; togglePresent: () => void; open: boolean; setOpen: (o: boolean) => void;
}) {
  const [timer, setTimer] = useState(false); const [help, setHelp] = useState(false);
  const clock = useClock(timer || present);
  const T = ({ t, icon: I, label, k }: { t: Tool; icon: typeof PenLine; label: string; k: string }) => (
    <button className={clsx(tool === t && 'on')} onClick={() => setTool(tool === t ? 'none' : t)} title={`${label} (${k})`}><I size={15} /><span>{label}</span></button>
  );
  if (!open) return <button className="epr-pbar-fab no-print" onClick={() => setOpen(true)} title="Presenter tools"><Presentation size={16} />Present</button>;
  return (
    <div className="epr-pbar no-print" role="toolbar" aria-label="Presenter tools">
      <button className={clsx(present && 'on')} onClick={togglePresent} title="Presentation mode — full screen, ← → between chapters (F)"><Presentation size={15} /><span>{present ? 'Exit' : 'Present'}</span></button>
      <i className="sep" />
      <button className={clsx(tool === 'none' && 'on')} onClick={() => setTool('none')} title="Select (Esc)"><MousePointer2 size={15} /><span>Select</span></button>
      <T t="laser" icon={ScanEye} label="Laser" k="L" />
      <T t="spot" icon={ScanEye} label="Spotlight" k="S" />
      <T t="pen" icon={PenLine} label="Pen" k="P" />
      <T t="hl" icon={Highlighter} label="Highlight" k="H" />
      <T t="note" icon={StickyNote} label="Note" k="N" />
      {(tool === 'pen' || tool === 'hl') && <span className="epr-pbar-colors">{PEN_COLORS.map((c) => <button key={c} style={{ background: c }} className={clsx(color === c && 'on')} onClick={() => setColor(c)} aria-label="Ink colour" />)}</span>}
      <button onClick={onUndo} title="Undo last stroke (U)"><Undo2 size={15} /></button>
      <button onClick={onClear} title="Clear ink (C)"><Eraser size={15} /></button>
      <i className="sep" />
      <button className={clsx(timer && 'on')} onClick={() => setTimer((x) => !x)} title="Presentation timer"><Timer size={15} /><span className="tab">{timer || present ? clock : 'Timer'}</span></button>
      <button className={clsx(help && 'on')} onClick={() => setHelp((x) => !x)} title="Keyboard shortcuts (?)"><Keyboard size={15} /></button>
      <button onClick={() => { setTool('none'); setOpen(false); }} title="Hide tools"><X size={15} /></button>
      {help && <div className="epr-pbar-help">
        {[['F', 'Presentation mode'], ['← / →', 'Previous / next chapter'], ['J / K', 'Next / previous chapter'], ['L', 'Laser pointer'], ['S', 'Spotlight'], ['P', 'Pen'], ['H', 'Highlighter'], ['N', 'Sticky note (click to place)'], ['U', 'Undo stroke'], ['C', 'Clear ink'], ['Esc', 'Back to select'], ['/', 'Ask the assistant']].map(([k, v]) => <div key={k}><kbd>{k}</kbd><span>{v}</span></div>)}
      </div>}
    </div>
  );
}
