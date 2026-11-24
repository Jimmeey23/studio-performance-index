/**
 * Report videos behind a music icon at the top of the report: a playlist player in a modal.
 * Locked for everyone but the review's owner: viewers cannot open, play, pause, seek or switch parts — the player opens
 * on their screen only when the owner plays. Shown frameless (edge-to-edge video on black).
 * Only the review's owner drives playback: every play / pause / seek / track change, plus a heartbeat every 2 s
 * while playing, is broadcast on the live channel; every other open copy follows.
 * Followers compute the presenter's position from the event (time + its age on the server + time since it arrived)
 * and stay locked to it: a jump when more than 1 s off, a gentle playback-rate nudge for smaller drift.
 */
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Music, X, Play, Volume2, Lock } from 'lucide-react';
import clsx from 'clsx';

export type MediaSync = { open: boolean; idx: number; playing: boolean; time: number; at: number; seq: number; sent?: number; rx: number };
type Send = (st: { open: boolean; idx: number; playing: boolean; time: number }) => void;

export function MediaPlaylist({ rid, items, presenter, send, remote }: { rid: string; items: { title: string }[]; presenter: boolean; send: Send; remote: MediaSync | null }) {
  const [open, setOpen] = useState(false); const [idx, setIdx] = useState(0);
  const [muted, setMuted] = useState(false); const [blocked, setBlocked] = useState(false);
  const vref = useRef<HTMLVideoElement>(null);
  const following = !presenter && !!remote?.open;

  /* ── presenter: broadcast ── */
  const emit = (o = open, i = idx) => { if (!presenter) return; const el = vref.current; send({ open: o, idx: i, playing: o && !!el && !el.paused && !el.ended, time: el?.currentTime ?? 0 }); };
  useEffect(() => { if (presenter && open) emit(); }, [idx]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!presenter || !open) return;
    const t = setInterval(() => { const el = vref.current; if (el && !el.paused) emit(); }, 2000);
    return () => clearInterval(t);
  }, [presenter, open, idx]); // eslint-disable-line react-hooks/exhaustive-deps
  const close = () => { vref.current?.pause(); setOpen(false); emit(false); };

  /* ── followers: mirror the presenter ── */
  useEffect(() => {
    if (presenter || !remote) return;
    setOpen(remote.open);
    if (remote.open && remote.idx !== idx) setIdx(remote.idx);
    if (!remote.open) vref.current?.pause();
  }, [remote?.seq]); // eslint-disable-line react-hooks/exhaustive-deps
  const target = () => {
    if (!remote) return 0;
    const age = remote.sent ? Math.max(0, remote.sent - remote.at) / 1000 : 0;      // how old the event already was when the server sent it
    const since = (performance.now() - remote.rx) / 1000;                            // time since it arrived here
    return remote.time + (remote.playing ? age + since + 0.12 : 0);                  // + typical network hop
  };
  const lock = () => {
    const el = vref.current; if (presenter || !remote?.open || !el || remote.idx !== idx || el.readyState < 1) return;
    const want = target(); const drift = el.currentTime - want;
    if (!remote.playing) { if (!el.paused) el.pause(); if (Math.abs(drift) > 0.25) el.currentTime = want; el.playbackRate = 1; return; }
    if (Math.abs(drift) > 1) { el.currentTime = want; el.playbackRate = 1; }
    else el.playbackRate = Math.abs(drift) < 0.08 ? 1 : Math.min(1.1, Math.max(0.9, 1 - drift * 0.5));
    if (el.paused) el.play().then(() => setBlocked(false)).catch(() => { el.muted = true; setMuted(true); el.play().then(() => setBlocked(false)).catch(() => setBlocked(true)); });
  };
  useEffect(lock, [remote?.seq, idx, open]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (!following) return; const t = setInterval(lock, 1000); return () => clearInterval(t); }, [following, remote?.seq, idx]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!items.length) return null;
  return <>
    {presenter
      ? <button className="epr-vid ready epr-media-btn no-print" onClick={() => { setOpen(true); setTimeout(() => emit(true), 0); }} title={`Report videos (${items.length}) — plays on every screen viewing this report`} data-live-skip>
          <span className="ic"><Music size={12} /></span>Videos · {items.length}
        </button>
      : <span className="epr-vid epr-media-btn locked no-print" title="Videos play here when the presenter starts them" data-live-skip>
          <span className="ic"><Lock size={11} /></span>Videos · {items.length}
        </span>}
    {open && createPortal(<div className={clsx('epr-mx no-print', following && 'follow')} data-live-skip onClick={(e) => e.stopPropagation()}>
      <video ref={vref} key={idx} src={`/api/public/review/${rid}/media/${idx}`} controls={presenter} controlsList="nodownload noplaybackrate" disablePictureInPicture={!presenter}
        playsInline preload="auto" autoPlay={presenter} onContextMenu={(e) => { if (!presenter) e.preventDefault(); }}
        onLoadedMetadata={lock} onPlay={() => emit()} onPause={() => emit()} onSeeked={() => emit()}
        onEnded={() => { if (presenter) { if (idx + 1 < items.length) setIdx(idx + 1); else emit(); } }} />
      <div className="epr-mx-top">
        <span className="epr-mx-t"><Music size={13} />{items[idx]?.title}</span>
        {presenter ? <button className="epr-mx-x" onClick={close} title="Close for everyone"><X size={18} /></button> : <span className="epr-media-live"><i />Presenter is playing</span>}
      </div>
      {presenter && items.length > 1 && <div className="epr-mx-list">{items.map((it, i) => (
        <button key={i} className={clsx(i === idx && 'on')} onClick={() => setIdx(i)}><Play size={11} /><span>{it.title}</span></button>))}
      </div>}
      {!presenter && (muted || blocked) && <button className="epr-media-unmute" onClick={() => { const el = vref.current; if (!el) return; el.muted = false; setMuted(false); el.play().then(() => setBlocked(false)).catch(() => {}); }}>
        <Volume2 size={14} />{blocked ? 'Tap to join the presenter' : 'Tap to unmute'}</button>}
    </div>, document.body)}
  </>;
}
