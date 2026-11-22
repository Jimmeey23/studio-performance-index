import { useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import clsx from 'clsx';
import { AlertTriangle, BookmarkPlus, Check, CheckCircle2, ChevronDown, ChevronRight, CircleDashed, Copy, XCircle, Cpu, CalendarRange, MapPin, GitCompare, Brain, ListChecks, Circle, MinusCircle, Plus } from 'lucide-react';
import { Logo } from './Animated';
import type { Message } from '../lib/types';
import { usePin } from '../lib/pin';
import { BlockView } from './blocks/Blocks';
import { api } from '../lib/api';

function Steps({ steps, pending }: { steps: NonNullable<Message['steps']>; pending?: boolean }) {
  const [open, setOpen] = useState(!!pending);
  if (!steps.length) return null;
  const errors = steps.filter((s) => s.status === 'error').length;
  return (
    <div className="mb-3">
      <button onClick={() => setOpen((o) => !o)} className="inline-flex items-center gap-1.5 text-xs text-ink-3 hover:text-ink-2">
        {open || pending ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
        {pending ? 'Analysing' : `Analysis: ${steps.length} step${steps.length > 1 ? 's' : ''}`}{errors ? ` · ${errors} retried` : ''}
      </button>
      {(open || pending) && (
        <ol className="mt-2 space-y-1.5 border-l border-line pl-4">
          {steps.map((s) => (
            <li key={s.id} className="flex items-start gap-2 text-xs">
              {s.status === 'running' ? <CircleDashed size={13} className="mt-0.5 shrink-0 animate-spin text-accent" /> : s.status === 'error' ? <XCircle size={13} className="mt-0.5 shrink-0 text-warn" /> : <CheckCircle2 size={13} className="mt-0.5 shrink-0 text-good" />}
              <span><span className="font-medium text-ink-2">{s.label}</span>{s.detail && <span className="text-ink-3"> — {s.detail}</span>}</span>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

/** The analyst's plan for a multi-step question, as a live checklist. */
function PlanCard({ plan, pending }: { plan: NonNullable<Message['plan']>; pending?: boolean }) {
  const done = plan.steps.filter((s) => s.status === 'done' || s.status === 'skipped').length;
  return (
    <div className="mb-3 rounded-xl border border-line bg-surface-2/60 px-3.5 py-3">
      <div className="flex items-center gap-2 text-xs font-semibold text-ink-2"><ListChecks size={13} className="text-accent" />Plan<span className="font-normal text-ink-3">{done}/{plan.steps.length} done</span></div>
      {plan.goal && <div className="mt-1 text-[12.5px] text-ink">{plan.goal}</div>}
      <ol className="mt-2 space-y-1.5">
        {plan.steps.map((s) => (
          <li key={s.id} className="flex items-start gap-2 text-xs">
            {s.status === 'done' ? <CheckCircle2 size={13} className="mt-0.5 shrink-0 text-good" /> : s.status === 'skipped' ? <MinusCircle size={13} className="mt-0.5 shrink-0 text-ink-3" />
              : s.status === 'running' || (pending && s.status === 'pending' && plan.steps.find((x) => x.status === 'pending')?.id === s.id) ? <CircleDashed size={13} className="mt-0.5 shrink-0 animate-spin text-accent" /> : <Circle size={13} className="mt-0.5 shrink-0 text-ink-3" />}
            <span className={clsx(s.status === 'skipped' && 'line-through opacity-60')}><span className="text-ink-2">{s.text}</span>{s.note && <span className="text-ink-3"> — {s.note}</span>}</span>
          </li>
        ))}
      </ol>
    </div>
  );
}

export function MessageView({ m, onSaved }: { m: Message; onSaved?: () => void }) {
  const pin = usePin();
  const [copied, setCopied] = useState(false);
  const [saved, setSaved] = useState(false);
  if (m.role === 'user') {
    return (
      <div className="flex justify-end fade-up">
        <div className="max-w-[80%]">
          <div className="rounded-2xl rounded-br-md bg-ink px-4 py-2.5 text-[15px] leading-relaxed text-bg whitespace-pre-wrap">{m.text}</div>
          {m.controls && (m.controls.period?.start || m.controls.locations?.length || m.controls.compare) && (
            <div className="mt-1.5 flex flex-wrap justify-end gap-1 text-[11px] text-ink-3">
              {m.controls.period?.start && <span className="inline-flex items-center gap-1 rounded-full bg-surface-2 px-2 py-0.5"><CalendarRange size={11} />{m.controls.period.label}</span>}
              {!!m.controls.locations?.length && <span className="inline-flex items-center gap-1 rounded-full bg-surface-2 px-2 py-0.5"><MapPin size={11} />{m.controls.locations.join(', ')}</span>}
              {m.controls.compare && <span className="inline-flex items-center gap-1 rounded-full bg-surface-2 px-2 py-0.5"><GitCompare size={11} />{m.controls.compare === 'previous_year' ? 'vs LY' : 'vs prev'}</span>}
            </div>
          )}
        </div>
      </div>
    );
  }
  const unverified = m.verification?.unmatched ?? [];
  const save = async () => {
    const title = window.prompt('Report name', 'Saved analysis');
    if (!title) return;
    await api('/api/reports', { method: 'POST', json: { messageId: m.id, title } });
    setSaved(true); onSaved?.();
  };
  return (
    <div className="fade-up">
      <div className="mb-2 flex items-center gap-2">
        <Logo size={24} busy={m.pending} />
        <span className="text-xs font-medium text-ink-2">Analyst</span>
        {m.model && <span title={m.tierReason} className="inline-flex items-center gap-1 rounded-full border border-line px-2 py-0.5 text-[10px] text-ink-3"><Cpu size={10} />{m.model}{m.tierReason ? ` · ${m.tierReason}` : ''}</span>}
      </div>
      {!!m.thinking && <Thinking text={m.thinking} live={!!m.pending && !m.text} />}
      {m.plan && <PlanCard plan={m.plan} pending={m.pending} />}
      {m.steps && <Steps steps={m.steps} pending={m.pending} />}
      {m.error && <div className="mb-3 flex items-start gap-2 rounded-xl border border-bad/30 bg-bad/5 p-3 text-sm text-bad"><AlertTriangle size={16} className="mt-0.5 shrink-0" />{m.error}</div>}
      {m.text && <div className="prose-answer"><ReactMarkdown remarkPlugins={[remarkGfm]}>{m.text}</ReactMarkdown></div>}
      {m.pending && !m.text && !m.blocks?.length && (
        <div className="mt-2 space-y-2"><div className="shimmer h-4 w-2/3 rounded" /><div className="shimmer h-4 w-1/2 rounded" /></div>
      )}
      {(() => {
        const main = (m.blocks ?? []).filter((b) => b.type !== 'details' && b.type !== 'followups');
        const details = (m.blocks ?? []).filter((b) => b.type === 'details');
        const fus = (m.blocks ?? []).filter((b) => b.type === 'followups');
        return <>
          {pin && !m.pending && m.role === 'assistant' && !!m.text?.trim() && <button onClick={() => pin({ id: `t_${m.id}`, type: 'insights', title: 'From the assistant', items: [{ kind: 'observation', title: m.text.trim().split(/\n/)[0].replace(/[#*_`]/g, '').slice(0, 120), detail: m.text.trim().replace(/[#*_`]/g, '') }] })} className="chip mt-3 !h-7 hover:border-accent hover:text-accent" title="Add this written answer to a chapter"><Plus size={12} />Add answer to report</button>}
          {!!main.length && <div className="mt-4 space-y-4">{main.map((b) => <div key={b.id} className="relative">{pin && !m.pending && b.type !== 'clarify' && <button onClick={() => pin(b)} className="chip mb-2 !h-7 hover:border-accent hover:text-accent" title="Add this to a chapter of the report"><Plus size={12} />Add to report</button>}<BlockView block={b} /></div>)}</div>}
          {!m.pending && !!details.length && <div className="mt-4 space-y-4">{details.map((b) => <BlockView key={b.id} block={b} />)}</div>}
          {!m.pending && !!fus.length && <div className="mt-5">{fus.slice(-1).map((b) => <BlockView key={b.id} block={b} />)}</div>}
        </>;
      })()}
      {!m.pending && !m.error && (
        <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-ink-3">
          {m.verification && (unverified.length
            ? <span className="inline-flex items-center gap-1 rounded-full bg-warn/10 px-2 py-0.5 text-warn" title={`Could not trace: ${unverified.join(', ')}`}><AlertTriangle size={12} />{unverified.length} figure{unverified.length > 1 ? 's' : ''} in the text could not be traced to computed results: {unverified.slice(0, 4).join(', ')}</span>
            : m.verification.checked > 0 && <span className="inline-flex items-center gap-1 rounded-full bg-good/10 px-2 py-0.5 text-good"><CheckCircle2 size={12} />All {m.verification.checked} figures traced to computed results</span>)}
          {m.ms && <span>{(m.ms / 1000).toFixed(1)}s</span>}
          <span className="flex-1" />
          <button onClick={() => { navigator.clipboard.writeText(m.text); setCopied(true); setTimeout(() => setCopied(false), 1200); }} className={clsx('inline-flex items-center gap-1 rounded-md px-2 py-1 hover:bg-surface-2 hover:text-ink')}>{copied ? <Check size={13} /> : <Copy size={13} />}Copy</button>
          <button onClick={save} disabled={saved} className="inline-flex items-center gap-1 rounded-md px-2 py-1 hover:bg-surface-2 hover:text-ink disabled:text-good">{saved ? <Check size={13} /> : <BookmarkPlus size={13} />}{saved ? 'Saved' : 'Save report'}</button>
        </div>
      )}
    </div>
  );
}

function Thinking({ text, live }: { text: string; live: boolean }) {
  const [open, setOpen] = useState(false);
  const show = open || live;
  return (
    <div className="mb-3 rounded-xl border border-line bg-surface-2/40">
      <button onClick={() => setOpen((o) => !o)} className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs text-ink-2">
        <Brain size={13} className={live ? 'pulse-dot text-accent' : 'text-ink-3'} />
        {live ? 'Thinking it through…' : 'Reasoning'}
        <span className="text-ink-3">· {text.split(/\s+/).length} words</span>
        <ChevronDown size={13} className={`ml-auto text-ink-3 transition-transform ${show ? 'rotate-180' : ''}`} />
      </button>
      {show && <div className="max-h-56 overflow-y-auto whitespace-pre-wrap border-t border-line px-3 py-2 text-[12px] leading-relaxed text-ink-3">{live ? text.slice(-1800) : text}</div>}
    </div>
  );
}
