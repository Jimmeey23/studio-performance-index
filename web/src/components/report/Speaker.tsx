/**
 * Speaker notes for the performance review: a right sidebar that follows the
 * chapter on screen, with a talk track, the numbers to quote, the transition to
 * the next chapter, a per-chapter time budget and the presenter's own notes —
 * plus a live teleprompter (auto-scroll, speed, size, mirror, auto-advance).
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import clsx from 'clsx';
import { ChevronLeft, ChevronRight, FlipHorizontal2, Minus, Pause, Play, Plus, ScrollText, Timer, X } from 'lucide-react';

export interface SpeakerChapter { id: string; n: string; title: string; headline?: string; summary?: string; points: string[]; numbers: { label: string; value: string; delta: string; tone: number }[]; actions: string[] }

const words = (t: string) => t.split(/\s+/).filter(Boolean).length;
const mmss = (s: number) => `${Math.floor(s / 60)}:${String(Math.max(0, Math.floor(s % 60))).padStart(2, '0')}`;

/** The spoken script for one chapter, built from its written commentary. */
export function script(c: SpeakerChapter, own?: string): string {
  return [c.headline, c.summary, ...(c.points.length ? ['Three things to land:', ...c.points.slice(0, 3)] : []), ...(c.actions.length ? ['What we will do:', ...c.actions.slice(0, 3)] : []), own].filter(Boolean).join('\n\n');
}

export function SpeakerPanel({ chapters, active, onJump, notes, onNote, canSave, onClose }: {
  chapters: SpeakerChapter[]; active: string; onJump: (id: string) => void; notes: Record<string, string>; onNote: (id: string, text: string) => void; canSave: boolean; onClose: () => void;
}) {
  const [follow, setFollow] = useState(true);
  const [pinned, setPinned] = useState(active);
  const [talkMins, setTalkMins] = useState(20);
  const [prompter, setPrompter] = useState(false);
  const [chStart, setChStart] = useState(Date.now()); const [, tick] = useState(0);
  useEffect(() => { if (follow) setPinned(active); }, [active, follow]);
  useEffect(() => { setChStart(Date.now()); }, [pinned]);
  useEffect(() => { const i = setInterval(() => tick((x) => x + 1), 1000); return () => clearInterval(i); }, []);
  const i = Math.max(0, chapters.findIndex((c) => c.id === pinned));
  const c = chapters[i]; const next = chapters[i + 1];
  const budget = useMemo(() => {   // time per chapter in proportion to its script length
    const w = chapters.map((x) => words(script(x, notes[x.id])) || 1); const tot = w.reduce((a, b) => a + b, 0);
    return Object.fromEntries(chapters.map((x, j) => [x.id, (w[j] / tot) * talkMins * 60]));
  }, [chapters, notes, talkMins]);
  if (!c) return null;
  const spent = (Date.now() - chStart) / 1000; const b = budget[c.id] ?? 60;
  const go = (j: number) => { const t = chapters[j]; if (!t) return; setFollow(false); setPinned(t.id); onJump(t.id); };
  return (
    <aside className="epr-spk no-print">
      <div className="epr-spk-h">
        <ScrollText size={14} /><b>Speaker notes</b>
        <label className="epr-spk-follow" title="Follow the chapter on screen"><input type="checkbox" checked={follow} onChange={(e) => setFollow(e.target.checked)} />Follow</label>
        <button onClick={onClose} title="Close"><X size={15} /></button>
      </div>
      <div className="epr-spk-nav">
        <button onClick={() => go(i - 1)} disabled={!i} title="Previous chapter"><ChevronLeft size={15} /></button>
        <div className="min-w-0 flex-1"><span>{c.n}</span><b>{c.title}</b></div>
        <button onClick={() => go(i + 1)} disabled={!next} title="Next chapter"><ChevronRight size={15} /></button>
      </div>
      <div className={clsx('epr-spk-time', spent > b ? 'over' : spent > b * 0.8 ? 'near' : '')}>
        <Timer size={13} /><span>{mmss(spent)} / {mmss(b)}</span><i style={{ width: `${Math.min(100, (spent / b) * 100)}%` }} />
        <select value={talkMins} onChange={(e) => setTalkMins(Number(e.target.value))} title="Total talk length">{[10, 15, 20, 30, 45, 60].map((m) => <option key={m} value={m}>{m} min talk</option>)}</select>
      </div>
      <div className="epr-spk-body">
        {c.headline && <section><h5>Open with</h5><p className="lead">{c.headline}</p></section>}
        {c.numbers.length > 0 && <section><h5>Numbers to quote</h5><ul className="nums">{c.numbers.map((x) => <li key={x.label}><span>{x.label}</span><b>{x.value}</b><em className={x.tone > 0 ? 'good' : x.tone < 0 ? 'bad' : ''}>{x.delta}</em></li>)}</ul></section>}
        {c.points.length > 0 && <section><h5>Talking points</h5><ol>{c.points.map((p, j) => <li key={j}>{p}</li>)}</ol></section>}
        {c.actions.length > 0 && <section><h5>Ask of the room</h5><ul>{c.actions.map((p, j) => <li key={j}>{p}</li>)}</ul></section>}
        <section><h5>My notes {!canSave && <em>(this device only)</em>}</h5>
          <textarea key={c.id} defaultValue={notes[c.id] ?? ''} placeholder="Add your own cues, anecdotes or questions to expect…" onBlur={(e) => e.target.value !== (notes[c.id] ?? '') && onNote(c.id, e.target.value)} />
        </section>
        {next && <section className="next"><h5>Transition</h5><p>“That brings us to {next.title.toLowerCase()} — {next.headline ? next.headline.charAt(0).toLowerCase() + next.headline.slice(1) : 'let’s look at what happened there.'}”</p></section>}
      </div>
      <button className="epr-spk-tp" onClick={() => setPrompter(true)}><Play size={14} />Open teleprompter</button>
      {prompter && <Teleprompter chapters={chapters} start={i} notes={notes} onJump={onJump} onClose={() => setPrompter(false)} />}
    </aside>
  );
}

function Teleprompter({ chapters, start, notes, onJump, onClose }: { chapters: SpeakerChapter[]; start: number; notes: Record<string, string>; onJump: (id: string) => void; onClose: () => void }) {
  const [i, setI] = useState(start);
  const [play, setPlay] = useState(false);
  const [speed, setSpeed] = useState(1);        // ~ lines per second scale
  const [size, setSize] = useState(40);
  const [mirror, setMirror] = useState(false);
  const [auto, setAuto] = useState(true);
  const box = useRef<HTMLDivElement>(null);
  const c = chapters[i];
  useEffect(() => { box.current?.scrollTo({ top: 0 }); onJump(c.id); }, [i]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!play) return; let raf = 0; let last = performance.now();
    const step = (t: number) => {
      const el = box.current; if (!el) return;
      el.scrollTop += (t - last) * 0.03 * speed * (size / 40); last = t;
      if (el.scrollTop + el.clientHeight >= el.scrollHeight - 2) { if (auto && i < chapters.length - 1) { setI((x) => x + 1); } else { setPlay(false); return; } }
      raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step); return () => cancelAnimationFrame(raf);
  }, [play, speed, size, auto, i, chapters.length]);
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if (e.key === ' ') { e.preventDefault(); setPlay((p) => !p); }
      else if (e.key === 'ArrowUp') setSpeed((s) => Math.min(4, +(s + 0.25).toFixed(2)));
      else if (e.key === 'ArrowDown') setSpeed((s) => Math.max(0.25, +(s - 0.25).toFixed(2)));
      else if (e.key === 'ArrowRight') setI((x) => Math.min(chapters.length - 1, x + 1));
      else if (e.key === 'ArrowLeft') setI((x) => Math.max(0, x - 1));
      else if (e.key === 'Escape') onClose();
      e.stopPropagation();
    };
    window.addEventListener('keydown', k, true); return () => window.removeEventListener('keydown', k, true);
  }, [chapters.length, onClose]);
  return (
    <div className="epr-tp">
      <div className="epr-tp-bar">
        <span className="t">{c.n} · {c.title}</span>
        <button onClick={() => setI((x) => Math.max(0, x - 1))} title="Previous (←)"><ChevronLeft size={16} /></button>
        <button className="play" onClick={() => setPlay((p) => !p)} title="Play / pause (space)">{play ? <Pause size={16} /> : <Play size={16} />}</button>
        <button onClick={() => setI((x) => Math.min(chapters.length - 1, x + 1))} title="Next (→)"><ChevronRight size={16} /></button>
        <span className="g">Speed<button onClick={() => setSpeed((s) => Math.max(0.25, +(s - 0.25).toFixed(2)))}><Minus size={13} /></button><b>{speed.toFixed(2)}×</b><button onClick={() => setSpeed((s) => Math.min(4, +(s + 0.25).toFixed(2)))}><Plus size={13} /></button></span>
        <span className="g">Size<button onClick={() => setSize((s) => Math.max(24, s - 4))}><Minus size={13} /></button><b>{size}</b><button onClick={() => setSize((s) => Math.min(80, s + 4))}><Plus size={13} /></button></span>
        <button className={clsx(mirror && 'on')} onClick={() => setMirror((m) => !m)} title="Mirror for a beam-splitter prompter"><FlipHorizontal2 size={16} /></button>
        <label className="g"><input type="checkbox" checked={auto} onChange={(e) => setAuto(e.target.checked)} />Auto-advance</label>
        <button onClick={onClose} title="Close (Esc)"><X size={16} /></button>
      </div>
      <div ref={box} className="epr-tp-text" style={{ fontSize: size, transform: mirror ? 'scaleX(-1)' : undefined }}>
        <div className="pad" />
        <h2>{c.title}</h2>
        {script(c, notes[c.id]).split(/\n\n/).map((p, j) => <p key={j}>{p}</p>)}
        <div className="pad" />
      </div>
      <div className="epr-tp-guide" aria-hidden />
    </div>
  );
}
