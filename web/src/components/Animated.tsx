import { useEffect, useId, useRef, useState } from 'react';
import clsx from 'clsx';

/** Animated brand mark: a "57" monogram inside a drawing gradient ring; spins while the analyst is working. */
export function Logo({ size = 32, busy = false, className }: { size?: number; busy?: boolean; className?: string }) {
  const id = useId().replace(/:/g, '');
  return (
    <svg width={size} height={size} viewBox="0 0 40 40" className={clsx('shrink-0', className)} aria-label="Physique 57">
      <defs>
        <linearGradient id={`g${id}`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="var(--accent)" />
          <stop offset="55%" stopColor="var(--accent-2)" />
          <stop offset="100%" stopColor="#ffffff" stopOpacity=".85" />
        </linearGradient>
      </defs>
      <rect x="3" y="3" width="34" height="34" rx="11" fill="#14151c" stroke="rgba(255,255,255,.14)" strokeWidth="1" />
      <g className={busy ? 'logo-spin-fast' : 'logo-spin'} style={{ transformOrigin: '20px 20px' }}>
        <circle cx="20" cy="20" r="16.5" fill="none" stroke={`url(#g${id})`} strokeWidth="2.2" strokeLinecap="round" strokeDasharray="70 34" className="logo-draw" />
      </g>
      <text x="20" y="24.6" textAnchor="middle" fontSize="13" fontWeight="700" fontFamily="Plus Jakarta Sans, Inter, system-ui" fill="#ffffff" letterSpacing="-0.5">57</text>
      {busy && <circle cx="31" cy="9" r="2.6" fill="var(--accent-2)" className="pulse-dot" />}
    </svg>
  );
}

/** Counts up to the target value whenever it changes. */
export function CountUp({ value, format, duration = 900 }: { value: number; format: (n: number) => string; duration?: number }) {
  const [v, setV] = useState(0);
  const from = useRef(0);
  useEffect(() => {
    if (!isFinite(value)) return;
    const start = performance.now(); const a = from.current;
    let raf = 0;
    const tick = (t: number) => {
      const p = Math.min(1, (t - start) / duration);
      const e = 1 - Math.pow(1 - p, 3);
      setV(a + (value - a) * e);
      if (p < 1) raf = requestAnimationFrame(tick); else from.current = value;
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [value, duration]);
  return <>{isFinite(value) ? format(v) : '—'}</>;
}

/** Sparkline that draws itself in; hover shows the value at each point. */
export function Sparkline({ values, labels, format, height = 40, color = 'var(--series-1)', highlightLast = true }: {
  values: number[]; labels?: string[]; format?: (n: number) => string; height?: number; color?: string; highlightLast?: boolean;
}) {
  const id = useId().replace(/:/g, '');
  const [hover, setHover] = useState<number | null>(null);
  const w = 200, h = height, pad = 3;
  const vs = values.map((v) => (isFinite(v) ? v : 0));
  if (vs.length < 2) return <div style={{ height }} />;
  const min = Math.min(...vs), max = Math.max(...vs);
  const xs = (i: number) => pad + (i / (vs.length - 1)) * (w - pad * 2);
  const ys = (v: number) => (max === min ? h / 2 : h - pad - ((v - min) / (max - min)) * (h - pad * 2));
  const d = vs.map((v, i) => `${i ? 'L' : 'M'}${xs(i).toFixed(1)},${ys(v).toFixed(1)}`).join(' ');
  const area = `${d} L${xs(vs.length - 1)},${h} L${xs(0)},${h} Z`;
  return (
    <div className="relative">
      <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" className="spark-reveal block w-full overflow-visible" style={{ height }}
        onMouseLeave={() => setHover(null)}
        onMouseMove={(e) => { const r = (e.currentTarget as SVGElement).getBoundingClientRect(); const i = Math.round(((e.clientX - r.left) / r.width) * (vs.length - 1)); setHover(Math.max(0, Math.min(vs.length - 1, i))); }}>
        <defs>
          <linearGradient id={`a${id}`} x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor={color} stopOpacity="0.25" /><stop offset="100%" stopColor={color} stopOpacity="0" /></linearGradient>
        </defs>
        <path d={area} fill={`url(#a${id})`} className="spark-fade" />
        <path d={d} fill="none" stroke={color} strokeWidth="1.8" vectorEffect="non-scaling-stroke" strokeLinejoin="round" strokeLinecap="round" />
        {highlightLast && <circle cx={xs(vs.length - 1)} cy={ys(vs[vs.length - 1])} r="2.6" fill={color} className="spark-fade" vectorEffect="non-scaling-stroke" />}
        {hover !== null && <line x1={xs(hover)} x2={xs(hover)} y1={0} y2={h} stroke="var(--line)" vectorEffect="non-scaling-stroke" />}
        {hover !== null && <circle cx={xs(hover)} cy={ys(vs[hover])} r="3" fill={color} stroke="var(--surface)" strokeWidth="1.5" vectorEffect="non-scaling-stroke" />}
      </svg>
      {hover !== null && (
        <div className="pointer-events-none absolute -top-7 z-10 whitespace-nowrap rounded-md border border-line bg-surface px-1.5 py-0.5 text-[10px] shadow" style={{ left: `${(xs(hover) / w) * 100}%`, transform: 'translateX(-50%)' }}>
          {labels?.[hover] ? <span className="text-ink-3">{labels[hover]} · </span> : null}<span className="font-medium tabular">{format ? format(vs[hover]) : vs[hover]}</span>
        </div>
      )}
    </div>
  );
}
