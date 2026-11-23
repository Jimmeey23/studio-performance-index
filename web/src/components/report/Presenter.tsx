/**
 * Presenter & annotation toolkit for the performance review.
 *
 * - Pointing: laser, spotlight.
 * - Drawing: pen, highlighter, arrow, box, stroke eraser, colours and sizes, undo / clear.
 *   Ink is anchored to the chapter it was drawn on (stored relative to that chapter), so it
 *   survives scrolling, resizing and reloads, and is saved with the review.
 * - Annotations: structured sticky notes (Note / Question / Action / Risk / Insight) that can be
 *   dragged, minimised, resolved and edited; a notes panel lists, filters and jumps to them.
 * - Presentation mode, timer, keyboard shortcuts, live save status.
 */
import { createContext, useContext, useEffect, useMemo, useRef, useState, type RefObject } from 'react';
import clsx from 'clsx';
import {
  AlertTriangle, ArrowUpRight, Check, CheckCircle2, ChevronDown, CircleHelp, Cloud, CloudOff, Eraser, GripHorizontal, Highlighter, Keyboard, Lightbulb, ListTodo,
  Loader2, Minimize2, MousePointer2, PanelRight, PenLine, Presentation, ScanEye, Square, StickyNote, Sun, Timer, Trash2, Undo2, X,
} from 'lucide-react';
import type { SaveState } from '../../lib/autosave';

export type Tool = 'none' | 'laser' | 'spot' | 'pen' | 'hl' | 'arrow' | 'rect' | 'erase' | 'note';
export type NoteKind = 'note' | 'question' | 'action' | 'risk' | 'insight';
export interface ReviewNote { id: string; sec: string; x: number; y: number; text: string; color: string; kind?: NoteKind; done?: boolean; min?: boolean; by?: string; at: string; edited?: string }
export interface InkStroke { id: string; sec: string; kind: 'pen' | 'hl' | 'arrow' | 'rect'; c: string; w: number; pts: [number, number][] }

export const NOTE_KINDS: Record<NoteKind, { label: string; icon: typeof StickyNote; accent: string; tint: string }> = {
  note: { label: 'Note', icon: StickyNote, accent: '#64748b', tint: '#f8fafc' },
  question: { label: 'Question', icon: CircleHelp, accent: '#2563eb', tint: '#eff6ff' },
  action: { label: 'Action', icon: ListTodo, accent: '#16a34a', tint: '#f0fdf4' },
  risk: { label: 'Risk', icon: AlertTriangle, accent: '#dc2626', tint: '#fef2f2' },
  insight: { label: 'Insight', icon: Lightbulb, accent: '#d97706', tint: '#fffbeb' },
};
export const NOTE_COLORS = ['#fde68a', '#bbf7d0', '#bfdbfe', '#fbcfe8', '#e9d5ff'];   // legacy notes
const INK_COLORS = ['#e11d48', '#f97316', '#eab308', '#16a34a', '#2563eb', '#111827'];
const SIZES = [{ k: 'S', w: 2 }, { k: 'M', w: 4 }, { k: 'L', w: 7 }];
const kindOf = (n: ReviewNote): NoteKind => n.kind ?? 'note';
const ago = (iso: string) => { const s = (Date.now() - new Date(iso).getTime()) / 1000; return s < 60 ? 'just now' : s < 3600 ? `${Math.floor(s / 60)} min ago` : s < 86400 ? `${Math.floor(s / 3600)} h ago` : new Date(iso).toLocaleDateString(); };

type NotesApi = { notes: ReviewNote[]; update: (id: string, patch: Partial<ReviewNote>) => void; remove: (id: string) => void };
export const NotesCtx = createContext<NotesApi | null>(null);

/* ═════════════ sticky notes ═════════════ */
function Sticky({ n, api }: { n: ReviewNote; api: NotesApi }) {
  const K = NOTE_KINDS[kindOf(n)]; const I = K.icon;
  const box = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ x: n.x, y: n.y });
  const [kindOpen, setKindOpen] = useState(false);
  const typing = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => setPos({ x: n.x, y: n.y }), [n.x, n.y]);
  // text can change from elsewhere (live presenter) — show it unless this box is being typed in
  const ta = useRef<HTMLTextAreaElement>(null);
  useEffect(() => { const t = ta.current; if (t && document.activeElement !== t && t.value !== n.text) t.value = n.text; }, [n.text]);
  const drag = (e: React.PointerEvent) => {
    if ((e.target as HTMLElement).closest('button')) return;
    const sec = box.current?.closest('[data-spy]') as HTMLElement | null; if (!sec) return;
    e.preventDefault(); const r = sec.getBoundingClientRect(); const ox = e.clientX - pos.x * r.width - r.left, oy = e.clientY - pos.y * r.height - r.top;
    let last = pos;
    const mv = (ev: PointerEvent) => { last = { x: Math.max(0, Math.min(0.92, (ev.clientX - ox - r.left) / r.width)), y: Math.max(0, Math.min(0.98, (ev.clientY - oy - r.top) / r.height)) }; setPos(last); };
    const up = () => { window.removeEventListener('pointermove', mv); window.removeEventListener('pointerup', up); if (last !== pos) api.update(n.id, { x: last.x, y: last.y }); };
    window.addEventListener('pointermove', mv); window.addEventListener('pointerup', up);
  };
  if (n.min) return (
    <button id={`note-${n.id}`} className="epr-sticky-dot no-print" style={{ left: `${pos.x * 100}%`, top: `${pos.y * 100}%`, background: K.accent }} onClick={() => api.update(n.id, { min: false })} title={`${K.label}: ${n.text.slice(0, 80) || '(empty)'}`}>
      <I size={13} />
    </button>
  );
  return (
    <div id={`note-${n.id}`} ref={box} className={clsx('epr-sticky2', n.done && 'done')} style={{ left: `${pos.x * 100}%`, top: `${pos.y * 100}%`, ['--k' as string]: K.accent, ['--kt' as string]: K.tint }}>
      <div className="epr-sticky2-h" onPointerDown={drag}>
        <GripHorizontal size={13} className="grip" />
        <div className="relative">
          <button className="kind" onClick={() => setKindOpen((o) => !o)} title="Change type"><I size={12} />{K.label}<ChevronDown size={11} /></button>
          {kindOpen && <div className="epr-sticky2-kinds" onMouseLeave={() => setKindOpen(false)}>
            {(Object.keys(NOTE_KINDS) as NoteKind[]).map((k) => { const KK = NOTE_KINDS[k]; const II = KK.icon; return <button key={k} onClick={() => { api.update(n.id, { kind: k }); setKindOpen(false); }}><II size={12} style={{ color: KK.accent }} />{KK.label}</button>; })}
          </div>}
        </div>
        <span className="sp" />
        <button onClick={() => api.update(n.id, { done: !n.done })} title={n.done ? 'Reopen' : 'Mark resolved'} className={clsx(n.done && 'on')}><CheckCircle2 size={13} /></button>
        <button onClick={() => api.update(n.id, { min: true })} title="Minimise"><Minimize2 size={13} /></button>
        <button onClick={() => { if (!n.text || confirm('Delete this note?')) api.remove(n.id); }} title="Delete"><Trash2 size={13} /></button>
      </div>
      <textarea ref={ta} defaultValue={n.text} autoFocus={!n.text} placeholder={kindOf(n) === 'question' ? 'Ask a question…' : kindOf(n) === 'action' ? 'What needs to happen, by whom…' : 'Write a note…'}
        onChange={(e) => { const v = e.target.value; if (typing.current) clearTimeout(typing.current); typing.current = setTimeout(() => api.update(n.id, { text: v, edited: new Date().toISOString() }), 350); }}
        onBlur={(e) => { if (typing.current) clearTimeout(typing.current); if (e.target.value !== n.text) api.update(n.id, { text: e.target.value, edited: new Date().toISOString() }); }} />
      <div className="epr-sticky2-f"><span>{n.by ?? 'Viewer'}</span><span>{n.done ? 'Resolved · ' : ''}{ago(n.edited ?? n.at)}</span></div>
    </div>
  );
}

/** Sticky notes belonging to one chapter, positioned relative to the chapter. */
export function ChapterNotes({ sec }: { sec: string }) {
  const api = useContext(NotesCtx);
  const mine = api?.notes.filter((n) => n.sec === sec) ?? [];
  if (!api || !mine.length) return null;
  return <>{mine.map((n) => <Sticky key={n.id} n={n} api={api} />)}</>;
}

/** Side panel: every note in the review, filterable, click to jump. */
export function NotesPanel({ chapters, onClose }: { chapters: { id: string; title: string }[]; onClose: () => void }) {
  const api = useContext(NotesCtx);
  const [kind, setKind] = useState<NoteKind | 'all'>('all'); const [showDone, setShowDone] = useState(true);
  const notes = (api?.notes ?? []).filter((n) => (kind === 'all' || kindOf(n) === kind) && (showDone || !n.done));
  const byCh = chapters.map((c) => ({ ...c, notes: notes.filter((n) => n.sec === c.id) })).filter((c) => c.notes.length);
  const counts = useMemo(() => Object.fromEntries((Object.keys(NOTE_KINDS) as NoteKind[]).map((k) => [k, (api?.notes ?? []).filter((n) => kindOf(n) === k).length])), [api?.notes]);
  const jump = (n: ReviewNote) => { if (n.min) api?.update(n.id, { min: false }); setTimeout(() => { const el = document.getElementById(`note-${n.id}`); el?.scrollIntoView({ behavior: 'smooth', block: 'center' }); el?.classList.add('flash'); setTimeout(() => el?.classList.remove('flash'), 1400); }, 60); };
  return (
    <aside className="epr-notesp no-print">
      <div className="epr-notesp-h"><StickyNote size={14} /><b>Annotations</b><em>{api?.notes.length ?? 0}</em><button onClick={onClose} title="Close"><X size={15} /></button></div>
      <div className="epr-notesp-f">
        <button className={clsx(kind === 'all' && 'on')} onClick={() => setKind('all')}>All</button>
        {(Object.keys(NOTE_KINDS) as NoteKind[]).map((k) => { const K = NOTE_KINDS[k]; const I = K.icon; return <button key={k} className={clsx(kind === k && 'on')} onClick={() => setKind(k)} title={K.label}><I size={12} style={{ color: K.accent }} />{counts[k] || ''}</button>; })}
        <label><input type="checkbox" checked={showDone} onChange={(e) => setShowDone(e.target.checked)} />Resolved</label>
      </div>
      <div className="epr-notesp-b">
        {!byCh.length && <p className="empty">No annotations yet. Pick <b>Note</b> in the toolbar (or press N) and click anywhere on the report.</p>}
        {byCh.map((c) => <section key={c.id}><h6>{c.title}</h6>{c.notes.map((n) => { const K = NOTE_KINDS[kindOf(n)]; const I = K.icon; return (
          <button key={n.id} className={clsx('item', n.done && 'done')} onClick={() => jump(n)} style={{ ['--k' as string]: K.accent }}>
            <I size={13} /><span><b>{n.text || <i>Empty {K.label.toLowerCase()}</i>}</b><em>{n.by ?? 'Viewer'} · {ago(n.edited ?? n.at)}{n.done ? ' · resolved' : ''}</em></span>
          </button>); })}</section>)}
      </div>
    </aside>
  );
}

/* ═════════════ ink ═════════════ */
const secEl = (id: string) => document.getElementById(`epr-${id}`) ?? document.getElementById(id === 'glance' ? 'epr-glance' : `epr-${id}`);
function sectionAt(y: number, x: number): HTMLElement | null {
  for (const el of document.querySelectorAll<HTMLElement>('[data-spy]')) { const r = el.getBoundingClientRect(); if (y >= r.top && y <= r.bottom && x >= r.left - 200 && x <= r.right + 200) return el; }
  return null;
}
const distSeg = (p: [number, number], a: [number, number], b: [number, number]) => {
  const dx = b[0] - a[0], dy = b[1] - a[1]; const l = dx * dx + dy * dy; const t = l ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l)) : 0;
  return Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy);
};

/** Pen, highlighter, arrow, box and eraser over a viewport-sized canvas. Strokes are stored per chapter
 *  (x and y as fractions of the chapter width), redrawn on scroll/resize, and saved via `onChange`. */
export function InkLayer({ scroller, tool, color, size, strokes, onChange }: {
  scroller: RefObject<HTMLElement | null>; tool: Tool; color: string; size: number; strokes: InkStroke[]; onChange: (s: InkStroke[]) => void;
}) {
  const cv = useRef<HTMLCanvasElement>(null);
  const live = useRef<InkStroke | null>(null);
  const list = useRef(strokes); list.current = strokes;
  const active = tool === 'pen' || tool === 'hl' || tool === 'arrow' || tool === 'rect' || tool === 'erase';
  const toScreen = (s: InkStroke) => { const el = secEl(s.sec); const c = cv.current; if (!el || !c) return null; const r = el.getBoundingClientRect(), cr = c.getBoundingClientRect();
    return s.pts.map(([x, y]) => [r.left - cr.left + x * r.width, r.top - cr.top + y * r.width] as [number, number]); };
  const draw = () => {
    const c = cv.current; const sc = scroller.current; if (!c || !sc) return;
    const r = sc.getBoundingClientRect(); const dpr = Math.min(window.devicePixelRatio || 1, 2);
    c.style.left = `${r.left}px`; c.style.top = `${r.top}px`; c.style.width = `${sc.clientWidth}px`; c.style.height = `${sc.clientHeight}px`;
    const W = Math.round(sc.clientWidth * dpr), H = Math.round(sc.clientHeight * dpr); if (c.width !== W || c.height !== H) { c.width = W; c.height = H; }
    const g = c.getContext('2d'); if (!g) return;
    g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, sc.clientWidth, sc.clientHeight); g.lineCap = 'round'; g.lineJoin = 'round';
    for (const s of [...list.current, ...(live.current ? [live.current] : [])]) {
      const p = toScreen(s); if (!p || !p.length) continue;
      g.globalAlpha = s.kind === 'hl' ? 0.3 : 0.95; g.strokeStyle = s.c; g.fillStyle = s.c; g.lineWidth = s.kind === 'hl' ? s.w * 4.5 : s.w;
      if (s.kind === 'rect' && p.length > 1) { const [a, b] = [p[0], p[p.length - 1]]; g.beginPath(); g.roundRect?.(Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.abs(b[0] - a[0]), Math.abs(b[1] - a[1]), 6); g.stroke(); continue; }
      if (s.kind === 'arrow' && p.length > 1) {
        const [a, b] = [p[0], p[p.length - 1]]; const ang = Math.atan2(b[1] - a[1], b[0] - a[0]); const h = 10 + s.w * 2.5;
        g.beginPath(); g.moveTo(a[0], a[1]); g.lineTo(b[0], b[1]); g.stroke();
        g.beginPath(); g.moveTo(b[0], b[1]); g.lineTo(b[0] - h * Math.cos(ang - 0.45), b[1] - h * Math.sin(ang - 0.45)); g.lineTo(b[0] - h * Math.cos(ang + 0.45), b[1] - h * Math.sin(ang + 0.45)); g.closePath(); g.fill(); continue;
      }
      g.beginPath(); p.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y))); g.stroke();
    }
  };
  const shown = active || strokes.length > 0;
  useEffect(() => { draw(); }); // redraw on every prop change
  useEffect(() => {
    if (!shown) return; const sc = scroller.current; if (!sc) return;
    const f = () => requestAnimationFrame(draw); sc.addEventListener('scroll', f, { passive: true }); window.addEventListener('resize', f);
    const ro = new ResizeObserver(f); ro.observe(sc.firstElementChild ?? sc);
    return () => { sc.removeEventListener('scroll', f); window.removeEventListener('resize', f); ro.disconnect(); };
  }, [shown]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!shown) return null;
  const rel = (e: React.PointerEvent, sec: HTMLElement): [number, number] => { const r = sec.getBoundingClientRect(); return [+((e.clientX - r.left) / r.width).toFixed(4), +((e.clientY - r.top) / r.width).toFixed(4)]; };
  const erase = (e: React.PointerEvent) => {
    const c = cv.current!.getBoundingClientRect(); const pt: [number, number] = [e.clientX - c.left, e.clientY - c.top];
    const keep = list.current.filter((s) => { const p = toScreen(s); if (!p) return true; if (p.length === 1) return Math.hypot(p[0][0] - pt[0], p[0][1] - pt[1]) > 12;
      const segs = s.kind === 'rect' ? (() => { const [a, b] = [p[0], p[p.length - 1]]; const q: [number, number][] = [a, [b[0], a[1]], b, [a[0], b[1]], a]; return q; })() : s.kind === 'arrow' ? [p[0], p[p.length - 1]] : p;
      for (let i = 1; i < segs.length; i++) if (distSeg(pt, segs[i - 1], segs[i]) < 12) return false; return true; });
    if (keep.length !== list.current.length) onChange(keep);
  };
  return <canvas ref={cv} className={clsx('epr-ink', active && 'on', tool === 'erase' && 'erase')}
    onPointerDown={(e) => {
      if (!active) return; (e.target as HTMLElement).setPointerCapture(e.pointerId);
      if (tool === 'erase') { erase(e); return; }
      const sec = sectionAt(e.clientY, e.clientX); if (!sec) return;
      live.current = { id: `k${Date.now().toString(36)}`, sec: sec.id.replace(/^epr-/, ''), kind: tool as InkStroke['kind'], c: color, w: size, pts: [rel(e, sec)] }; draw();
    }}
    onPointerMove={(e) => {
      if (!active || !e.buttons) return;
      if (tool === 'erase') { erase(e); return; }
      const s = live.current; if (!s) return; const sec = secEl(s.sec); if (!sec) return;
      const p = rel(e, sec); if (s.kind === 'arrow' || s.kind === 'rect') s.pts = [s.pts[0], p]; else s.pts.push(p); draw();
    }}
    onPointerUp={() => { const s = live.current; live.current = null; if (s && (s.pts.length > 1 || s.kind === 'pen')) onChange([...list.current, s]); else draw(); }} />;
}

/** Laser dot and spotlight follow the cursor. */
export function PointerFx({ tool, at }: { tool: Tool; at?: { x: number; y: number } | null }) {
  const [own, setP] = useState<{ x: number; y: number } | null>(null);
  const p = at !== undefined ? at : own;
  useEffect(() => {
    if (at !== undefined || (tool !== 'laser' && tool !== 'spot')) return;
    const m = (e: PointerEvent) => setP({ x: e.clientX, y: e.clientY });
    window.addEventListener('pointermove', m); return () => window.removeEventListener('pointermove', m);
  }, [tool, at]);
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

export function SaveChip({ state, canSave }: { state: SaveState; canSave: boolean }) {
  if (!canSave) return <span className="epr-savechip local" title="Not signed in — annotations stay on this device"><CloudOff size={12} />This device</span>;
  const m = { idle: [Cloud, 'Autosave on'], saving: [Loader2, 'Saving…'], saved: [Check, 'All changes saved'], offline: [CloudOff, 'Offline — will retry'], error: [AlertTriangle, 'Retrying save…'] } as const;
  const [I, t] = m[state];
  return <span className={clsx('epr-savechip', state)} title={t}><I size={12} className={state === 'saving' ? 'animate-spin' : ''} />{t}</span>;
}

/** The presenter toolbar: grouped, labelled, auto-collapses to a pill when idle. */
export function PresenterBar({ tool, setTool, color, setColor, size, setSize, noteKind, setNoteKind, onClear, onUndo, present, togglePresent, open, setOpen, notesOpen, toggleNotes, noteCount, save, canSave }: {
  tool: Tool; setTool: (t: Tool) => void; color: string; setColor: (c: string) => void; size: number; setSize: (n: number) => void;
  noteKind: NoteKind; setNoteKind: (k: NoteKind) => void; onClear: () => void; onUndo: () => void;
  present: boolean; togglePresent: () => void; open: boolean; setOpen: (o: boolean) => void; notesOpen: boolean; toggleNotes: () => void; noteCount: number; save: SaveState; canSave: boolean;
}) {
  const [timer, setTimer] = useState(false); const [help, setHelp] = useState(false); const [kinds, setKinds] = useState(false);
  const [mini, setMini] = useState(false);
  const idle = useRef<ReturnType<typeof setTimeout> | null>(null);
  const arm = (ms = 2600) => { if (idle.current) clearTimeout(idle.current); idle.current = setTimeout(() => { setMini(true); setHelp(false); setKinds(false); }, ms); };
  const wake = () => { if (idle.current) clearTimeout(idle.current); setMini(false); };
  useEffect(() => { if (open) arm(present ? 1600 : 4500); return () => { if (idle.current) clearTimeout(idle.current); }; }, [open, present, tool]); // eslint-disable-line react-hooks/exhaustive-deps
  const clock = useClock(timer || present);
  const drawing = ['pen', 'hl', 'arrow', 'rect'].includes(tool);
  const T = ({ t, icon: I, label, k }: { t: Tool; icon: typeof PenLine; label: string; k: string }) => (
    <button className={clsx(tool === t && 'on')} onClick={() => setTool(tool === t ? 'none' : t)} title={`${label} (${k})`}><I size={15} /><span>{label}</span></button>
  );
  if (!open) return <button className="epr-pbar-fab no-print" onClick={() => { setOpen(true); wake(); }} title="Presenter & annotation tools"><Presentation size={16} />Tools</button>;
  const CurIcon = ({ laser: ScanEye, spot: Sun, pen: PenLine, hl: Highlighter, arrow: ArrowUpRight, rect: Square, erase: Eraser, note: StickyNote, none: MousePointer2 } as const)[tool];
  if (mini) return (
    <button className="epr-pbar-mini no-print" onMouseEnter={wake} onFocus={wake} onClick={wake} title="Presenter tools">
      <CurIcon size={15} />{(timer || present) && <span className="tab">{clock}</span>}<i />
    </button>
  );
  const NK = NOTE_KINDS[noteKind]; const NI = NK.icon;
  return (
    <div className="epr-pbar2 no-print" role="toolbar" aria-label="Presenter tools" onMouseEnter={wake} onMouseLeave={() => arm()}>
      <div className="g"><span className="gl">Present</span><div className="row">
        <button className={clsx(present && 'on')} onClick={togglePresent} title="Presentation mode — full screen, ← → between chapters (F)"><Presentation size={15} /><span>{present ? 'Exit' : 'Present'}</span></button>
        <button className={clsx(timer && 'on')} onClick={() => setTimer((x) => !x)} title="Presentation timer"><Timer size={15} /><span className="tab">{timer || present ? clock : 'Timer'}</span></button>
      </div></div>
      <div className="g"><span className="gl">Point</span><div className="row">
        <button className={clsx(tool === 'none' && 'on')} onClick={() => setTool('none')} title="Select (Esc)"><MousePointer2 size={15} /><span>Select</span></button>
        <T t="laser" icon={ScanEye} label="Laser" k="L" /><T t="spot" icon={Sun} label="Spotlight" k="S" />
      </div></div>
      <div className="g"><span className="gl">Draw</span><div className="row">
        <T t="pen" icon={PenLine} label="Pen" k="P" /><T t="hl" icon={Highlighter} label="Marker" k="H" /><T t="arrow" icon={ArrowUpRight} label="Arrow" k="A" /><T t="rect" icon={Square} label="Box" k="R" /><T t="erase" icon={Eraser} label="Erase" k="E" />
        <button onClick={onUndo} title="Undo last stroke (U)"><Undo2 size={15} /><span>Undo</span></button>
        <button onClick={() => { if (confirm('Clear all ink on this review?')) onClear(); }} title="Clear all ink (C)"><Trash2 size={15} /><span>Clear</span></button>
      </div>{drawing && <div className="opts">
        {INK_COLORS.map((c) => <button key={c} style={{ background: c }} className={clsx('sw', color === c && 'on')} onClick={() => setColor(c)} aria-label="Ink colour" />)}
        <i className="sep" />{SIZES.map((s) => <button key={s.k} className={clsx('sz', size === s.w && 'on')} onClick={() => setSize(s.w)} title={`Stroke ${s.k}`}><i style={{ width: s.w + 3, height: s.w + 3 }} /></button>)}
      </div>}</div>
      <div className="g"><span className="gl">Annotate</span><div className="row">
        <div className="relative split">
          <button className={clsx(tool === 'note' && 'on')} onClick={() => setTool(tool === 'note' ? 'none' : 'note')} title={`Add a ${NK.label.toLowerCase()} — click on the report to place it (N)`}><NI size={15} style={{ color: tool === 'note' ? undefined : NK.accent }} /><span>{NK.label}</span></button>
          <button className="caret" onClick={() => setKinds((x) => !x)} title="Note type"><ChevronDown size={12} /></button>
          {kinds && <div className="epr-pbar2-menu">{(Object.keys(NOTE_KINDS) as NoteKind[]).map((k) => { const K = NOTE_KINDS[k]; const I = K.icon; return <button key={k} className={clsx(noteKind === k && 'on')} onClick={() => { setNoteKind(k); setTool('note'); setKinds(false); }}><I size={13} style={{ color: K.accent }} />{K.label}</button>; })}</div>}
        </div>
        <button className={clsx(notesOpen && 'on')} onClick={toggleNotes} title="All annotations"><PanelRight size={15} /><span>Notes{noteCount ? ` · ${noteCount}` : ''}</span></button>
      </div></div>
      <div className="g end">
        <SaveChip state={save} canSave={canSave} />
        <div className="row">
          <button className={clsx(help && 'on')} onClick={() => setHelp((x) => !x)} title="Keyboard shortcuts (?)"><Keyboard size={15} /></button>
          <button onClick={() => { setTool('none'); setOpen(false); }} title="Hide tools"><X size={15} /></button>
        </div>
      </div>
      {help && <div className="epr-pbar-help">
        {[['F', 'Presentation mode'], ['← / →', 'Previous / next chapter'], ['L', 'Laser'], ['S', 'Spotlight'], ['P', 'Pen'], ['H', 'Marker'], ['A', 'Arrow'], ['R', 'Box'], ['E', 'Eraser'], ['N', 'Note (click to place)'], ['U', 'Undo stroke'], ['C', 'Clear ink'], ['Esc', 'Back to select'], ['/', 'Ask the assistant']].map(([k, v]) => <div key={k}><kbd>{k}</kbd><span>{v}</span></div>)}
      </div>}
    </div>
  );
}
