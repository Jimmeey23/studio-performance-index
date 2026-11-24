/**
 * Per-paragraph readouts: a small speaker button at the end of every text block that has a recorded clip.
 * Blocks come from the same walk as the Readout script export (lib/readout), matched to clips by text hash first,
 * then by block id when its hash still matches — edited text never plays a stale clip.
 * Buttons are appended to the report DOM and re-applied when React re-renders (MutationObserver, debounced).
 * One shared <audio>; after a clip ends it reads on through the following paragraphs (click again or Esc to stop).
 */
import { useEffect, useRef } from 'react';
import { collectReadouts } from '../../lib/readout';

type Clip = [string, string, number];   // [block id, text hash, seconds]
const ICON = '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 5 6 9H2v6h4l5 4V5z"/><path class="w1" d="M15.5 8.5a5 5 0 0 1 0 7"/><path class="w2" d="M19 5a10 10 0 0 1 0 14"/></svg>';

export function ReadoutIcons({ rid, clips, root, onPlay }: { rid: string; clips: Clip[]; root: React.RefObject<HTMLElement | null>; onPlay?: () => void }) {
  const audio = useRef<HTMLAudioElement | null>(null);
  const cur = useRef<{ btn: HTMLButtonElement; block: HTMLElement } | null>(null);
  useEffect(() => {
    const el = root.current; if (!el || !clips.length) return;
    const byHash = new Map(clips.map((c) => [c[1], c])); const byId = new Map(clips.map((c) => [c[0], c]));
    const a = audio.current ?? (audio.current = new Audio()); a.preload = 'none';
    const stop = () => { a.pause(); if (cur.current) { cur.current.btn.classList.remove('on'); cur.current.block.classList.remove('epr-ro-active'); } cur.current = null; };
    const play = (btn: HTMLButtonElement) => {
      const block = btn.parentElement as HTMLElement;
      if (cur.current?.btn === btn) { if (a.paused) { void a.play(); btn.classList.add('on'); } else { a.pause(); btn.classList.remove('on'); } return; }
      stop(); onPlay?.();
      a.src = `/api/public/review/${rid}/readout/${btn.dataset.ro}`;
      cur.current = { btn, block }; btn.classList.add('on'); block.classList.add('epr-ro-active');
      a.play().catch(() => stop());
      a.onerror = () => { btn.classList.add('na'); btn.title = 'Audio for this paragraph is not available yet'; stop(); };
    };
    a.onended = () => {
      const was = cur.current; stop();
      if (!was) return;   // read on through the following paragraphs until paused / Esc
      const all = [...el.querySelectorAll<HTMLButtonElement>('button.epr-ro')]; const next = all[all.indexOf(was.btn) + 1];
      if (next) { next.parentElement?.scrollIntoView({ behavior: 'smooth', block: 'center' }); play(next); }
    };
    const apply = () => {
      for (const b of collectReadouts(el)) {
        const clip = byHash.get(b.hash) ?? (byId.get(b.id)?.[1] === b.hash ? byId.get(b.id) : undefined);
        const have = b.el.querySelector<HTMLButtonElement>(':scope > button.epr-ro');
        if (!clip) { have?.remove(); continue; }
        if (have) { have.dataset.ro = clip[0]; continue; }
        const btn = document.createElement('button');
        btn.type = 'button'; btn.className = 'epr-ro no-print'; btn.dataset.ro = clip[0]; btn.dataset.liveSkip = '';
        btn.title = `Listen (${Math.round(clip[2])}s)`; btn.setAttribute('aria-label', 'Listen to this paragraph'); btn.innerHTML = ICON;
        b.el.appendChild(btn);
      }
    };
    let t: ReturnType<typeof setTimeout> | null = null;
    const mo = new MutationObserver((ms) => {
      if (ms.every((m) => [...m.addedNodes, ...m.removedNodes].every((n) => n instanceof HTMLElement && n.classList.contains('epr-ro')))) return;
      if (t) clearTimeout(t); t = setTimeout(apply, 400);
    });
    const click = (e: MouseEvent) => { const btn = (e.target as HTMLElement).closest?.('button.epr-ro') as HTMLButtonElement | null; if (!btn) return; e.preventDefault(); e.stopPropagation(); play(btn); };
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') stop(); };
    apply(); mo.observe(el, { childList: true, subtree: true, characterData: true });
    el.addEventListener('click', click, true); window.addEventListener('keydown', key);
    return () => { mo.disconnect(); if (t) clearTimeout(t); el.removeEventListener('click', click, true); window.removeEventListener('keydown', key); stop(); el.querySelectorAll('button.epr-ro').forEach((x) => x.remove()); };
  }, [rid, clips, root, onPlay]);
  return null;
}
