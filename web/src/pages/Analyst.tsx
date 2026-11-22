import { useCallback, useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { Sparkles, LineChart, Users, RefreshCcw, Target, Megaphone, CalendarClock, ArrowRight } from 'lucide-react';
import { api, streamChat } from '../lib/api';
import type { Block, Controls, DomainMeta, Message, Step, Verification } from '../lib/types';
import { MessageView } from '../components/MessageView';
import { Composer } from '../components/Composer';
import { Logo } from '../components/Animated';
import { AskCtx } from '../lib/ask';
import { domainIcon } from '../lib/domainIcons';
import { useMe } from '../App';
import { TEMPLATES } from '../lib/templates';

const HOME_SUGGESTIONS = [
  { icon: LineChart, q: 'Compare revenue across all locations for the last six months, with growth, rankings and a forecast for next month.' },
  { icon: Users, q: 'Month-on-month new clients, conversion and retention for the last 14 months by location. Where is the biggest drop-off?' },
  { icon: RefreshCcw, q: 'What is our membership renewal rate by location for the last 6 months, and which members are up for renewal now?' },
  { icon: Megaphone, q: 'Which lead sources and channels convert best? Show the lead funnel by channel for the last quarter.' },
  { icon: CalendarClock, q: 'Which classes and time slots have the lowest fill rate at each studio last month?' },
  { icon: Target, q: 'Forecast revenue for the next 3 months. What is driving the trend, and how confident is it?' },
];

export default function Analyst({ onConversationsChange, domain, embedded, conversationId: fixedConv, seed, reviewId, prompts, intro }: {
  onConversationsChange: () => void; domain?: DomainMeta; embedded?: boolean; conversationId?: string; seed?: { q: string; n: number }; reviewId?: string; prompts?: string[]; intro?: string;
}) {
  const params = useParams();
  const routeId = embedded ? fixedConv : params.id;
  const navigate = useNavigate();
  const [domains, setDomains] = useState<DomainMeta[]>([]);
  useEffect(() => { if (!embedded) api<DomainMeta[]>('/api/domains').then(setDomains).catch(() => {}); }, [embedded]);
  const me = useMe();
  const [messages, setMessages] = useState<Message[]>([]);
  const [busy, setBusy] = useState(false);
  const [queue, setQueue] = useState<string[]>([]);
  const [controls, setControls] = useState<Controls>({ tier: 'auto' });
  const [convId, setConvId] = useState<string | undefined>(routeId);
  const abort = useRef<AbortController | null>(null);
  const bottom = useRef<HTMLDivElement>(null);
  const skipLoad = useRef(false);
  const convRef = useRef(convId); convRef.current = convId;

  useEffect(() => {
    if (skipLoad.current) { skipLoad.current = false; return; }
    setConvId(routeId);
    if (!routeId) { setMessages([]); return; }
    api<{ messages: Message[] }>(`/api/conversations/${routeId}`).then((c) => setMessages(c.messages)).catch(() => setMessages([]));
  }, [routeId]);

  useEffect(() => { bottom.current?.scrollIntoView({ behavior: 'smooth', block: 'end' }); }, [messages.length, messages[messages.length - 1]?.blocks?.length]);

  const run = useCallback(async (question: string) => {
    setBusy(true);
    const pendingId = `p_${Date.now()}`;
    const ctl = { ...controls };
    setMessages((m) => [...m, { id: `u_${Date.now()}`, role: 'user', text: question, controls: ctl }, { id: pendingId, role: 'assistant', text: '', steps: [], blocks: [], pending: true }]);
    const update = (fn: (m: Message) => Message) => setMessages((ms) => ms.map((x) => (x.id === pendingId ? fn(x) : x)));
    const started = Date.now();
    abort.current = new AbortController();
    try {
      await streamChat({ question, conversationId: convRef.current, controls: ctl, domain: domain?.id, reviewId } as never, (e) => {
        switch (e.type) {
          case 'meta': update((m) => ({ ...m, model: String(e.modelLabel), tier: e.tier as Message['tier'], tierReason: String(e.reason) })); break;
          case 'step': update((m) => {
            const s = e as unknown as Step;
            const steps = m.steps ?? [];
            const i = steps.findIndex((x) => x.id === s.id);
            return { ...m, steps: i >= 0 ? steps.map((x, j) => (j === i ? { ...x, ...s } : x)) : [...steps, s] };
          }); break;
          case 'text': update((m) => ({ ...m, text: m.text + String(e.delta) })); break;
          case 'thinking': update((m) => ({ ...m, thinking: (m.thinking ?? '') + String(e.delta) })); break;
          case 'plan': update((m) => ({ ...m, plan: e.plan as Message['plan'] })); break;
          case 'text_reset': update((m) => ({ ...m, text: '' })); break;
          case 'block': update((m) => ({ ...m, blocks: [...(m.blocks ?? []), e.block as Block] })); break;
          case 'verification': update((m) => ({ ...m, verification: e.verification as Verification })); break;
          case 'error': update((m) => ({ ...m, error: String(e.message), pending: false })); break;
          case 'done': {
            update((m) => ({ ...m, id: String(e.messageId), pending: false, ms: Date.now() - started }));
            if (!convRef.current) {
              convRef.current = String(e.conversationId); setConvId(convRef.current);
              if (!embedded) { skipLoad.current = true; navigate(`/c/${e.conversationId}`, { replace: true }); }
            }
            onConversationsChange();
            break;
          }
        }
      }, abort.current.signal);
    } catch (err) {
      if ((err as Error).name !== 'AbortError') update((m) => ({ ...m, error: (err as Error).message }));
    } finally {
      update((m) => ({ ...m, pending: false }));
      setBusy(false);
    }
  }, [controls, domain?.id, embedded, navigate, onConversationsChange, reviewId]);

  // queue: anything asked while busy runs as soon as the current answer finishes
  const ask = useCallback((q: string) => { if (!q.trim()) return; if (busy) setQueue((x) => [...x, q]); else run(q); }, [busy, run]);
  useEffect(() => { if (!busy && queue.length) { const [next, ...rest] = queue; setQueue(rest); run(next); } }, [busy, queue, run]);
  const seeded = useRef(0);
  useEffect(() => { if (seed && seed.n !== seeded.current) { seeded.current = seed.n; ask(seed.q); } }, [seed, ask]);
  const loc = useLocation();
  useEffect(() => {
    const st = loc.state as { q?: string; n?: number } | null;
    if (!embedded && st?.q && st.n !== seeded.current) { seeded.current = st.n ?? Date.now(); navigate(loc.pathname, { replace: true, state: null }); ask(st.q); }
  }, [loc.state, embedded, ask, navigate, loc.pathname]);

  const empty = messages.length === 0;
  const suggestions = prompts ? prompts.map((q) => ({ icon: Sparkles, q })) : domain ? domain.presets.slice(0, 6).map((q) => ({ icon: Sparkles, q })) : HOME_SUGGESTIONS;
  return (
    <AskCtx.Provider value={ask}>
      <div className="flex h-full flex-col">
        <div className="flex-1 overflow-y-auto">
          <div className={`mx-auto w-full max-w-[1040px] px-6 ${embedded ? 'py-5' : 'py-8'}`}>
            {empty ? (
              <div className={embedded ? 'pt-2' : 'hero-glow -mx-6 rounded-3xl px-6 pb-4 pt-[7vh]'}>
                {!embedded && <>
                  <div className="mb-6 flex items-center gap-3"><Logo size={46} /><div className="chip !h-7"><Sparkles size={13} className="text-accent" />AI business analyst · thinks before it answers · auto-selects Haiku, Sonnet or Opus</div></div>
                  <h1 className="text-[42px] font-bold leading-[1.1]">Good {greeting()}, {me?.name?.split(' ')[0] ?? 'there'}.<br /><span className="gradient-text">What would you like to understand today?</span></h1>
                  <p className="mt-3 max-w-xl text-sm text-ink-3">Revenue, clients, conversion, renewals, churn, leads, classes or forecasts. Every number is computed from your synced sheets, with the method shown. Keep typing while an answer is being prepared — follow-ups queue up.</p>
                  {!me?.aiConfigured && <div className="mt-4 rounded-xl border border-warn/30 bg-warn/5 p-3 text-sm text-warn">The AI engine isn't configured yet — add ANTHROPIC_API_KEY to server/.env and restart. Data pages work without it.</div>}
                </>}
                {embedded && intro && <div className="mb-3 text-sm text-ink-3">{intro}</div>}
                {embedded && domain && <div className="mb-3 text-sm text-ink-3">Ask the {domain.label} expert anything — it knows the definitions, data and levers for this area.</div>}
                <div className={embedded && prompts ? "mt-4 grid gap-2" : "mt-6 grid gap-3 sm:grid-cols-2"}>
                  {suggestions.map(({ icon: Icon, q }, i) => (
                    <button key={q} onClick={() => ask(q)} className="panel card-in lift group flex items-start gap-3 p-4 text-left text-[13.5px] leading-relaxed text-ink-2 hover:text-ink" style={{ animationDelay: `${i * 50}ms` }}>
                      <span className="panel-tile"><Icon size={15} /></span><span className="flex-1">{q}</span><ArrowRight size={14} className="mt-0.5 shrink-0 text-ink-3 opacity-0 transition group-hover:translate-x-0.5 group-hover:opacity-100" />
                    </button>
                  ))}
                </div>
                {!embedded && domains.length > 0 && (
                  <div className="mt-8">
                    <div className="section-title mb-3"><span className="dot" />Expert workspaces</div>
                    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                      {domains.map((d, i) => { const I = domainIcon(d.icon); return (
                        <button key={d.id} onClick={() => navigate(`/w/${d.id}`)} className="panel card-in lift group flex items-start gap-3 p-4 text-left" style={{ animationDelay: `${i * 40}ms` }}>
                          <span className="hero-icon flex h-9 w-9 shrink-0 items-center justify-center rounded-xl"><I size={16} /></span>
                          <span className="min-w-0"><span className="block font-display text-[14px] font-semibold text-ink">{d.label}</span><span className="mt-0.5 line-clamp-2 block text-[12px] leading-snug text-ink-3">{d.blurb}</span></span>
                        </button>
                      ); })}
                    </div>
                  </div>
                )}
                {!embedded && (
                  <div className="mt-8">
                    <div className="section-title mb-3"><span className="dot" />Report templates</div>
                    <div className="flex flex-wrap gap-2">
                      {TEMPLATES.filter((t) => t.category === 'Reports' || t.category === 'Diagnostics').map((t) => (
                        <button key={t.title} onClick={() => ask(t.prompt)} className="chip !h-8 !px-3.5 transition hover:!text-ink hover:shadow-[inset_0_0_0_1px_var(--accent)]">{t.title}</button>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <div className="space-y-10">{messages.map((m) => <MessageView key={m.id} m={m} />)}<div ref={bottom} /></div>
            )}
          </div>
        </div>
        <div className="bg-gradient-to-t from-bg via-bg/90 to-transparent pt-2">
          <div className="mx-auto w-full max-w-[1040px] px-6 py-3.5">
            <Composer busy={busy} queue={queue} onSend={ask} onStop={() => abort.current?.abort()} onRemoveQueued={(i) => setQueue((q) => q.filter((_, j) => j !== i))}
              placeholder={domain ? `Ask the ${domain.label} expert…` : empty ? 'Ask anything about the business…' : 'Ask a follow-up — filters, periods and locations carry over'}
              controls={controls} setControls={setControls} autoFocus={!embedded} />
            <div className="mt-1.5 text-center text-[11px] text-ink-3">Figures come from the deterministic engine; anything not traceable is flagged. Forecasts are estimates.</div>
          </div>
        </div>
      </div>
    </AskCtx.Provider>
  );
}

function greeting() { const h = new Date().getHours(); return h < 12 ? 'morning' : h < 17 ? 'afternoon' : 'evening'; }
