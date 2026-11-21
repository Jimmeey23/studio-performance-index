/**
 * Small, dependency-free forecasting toolkit. Candidate models are compared
 * with a rolling-origin backtest and the best (lowest MAE) is used. Intervals
 * come from the empirical backtest error, widened with horizon.
 */
export interface Fit { name: string; forecast: (h: number) => number[] }

const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / Math.max(1, xs.length);
const std = (xs: number[]) => { const m = mean(xs); return Math.sqrt(mean(xs.map((x) => (x - m) ** 2))); };

function naiveMean(y: number[], k = 3): Fit {
  const v = mean(y.slice(-k));
  return { name: `${k}-month average`, forecast: (h) => Array(h).fill(v) };
}

function seasonalNaive(y: number[], s = 12): Fit | null {
  if (y.length < s + 1) return null;
  // last year's same month scaled by recent YoY growth (trailing 3 months)
  const recent = y.slice(-3), ly = y.slice(-3 - s, -s);
  const g = ly.length === 3 && mean(ly) > 0 ? mean(recent) / mean(ly) : 1;
  const growth = Math.min(Math.max(g, 0.5), 2);
  return {
    name: 'Seasonal naive × YoY growth',
    forecast: (h) => Array.from({ length: h }, (_, i) => y[y.length - s + (i % s)] * growth),
  };
}

function holt(y: number[], damped = true): Fit | null {
  if (y.length < 6) return null;
  let best: { sse: number; a: number; b: number; phi: number } | null = null;
  for (const a of [0.1, 0.2, 0.3, 0.5, 0.7, 0.9]) for (const b of [0.01, 0.05, 0.1, 0.2, 0.3]) for (const phi of damped ? [0.8, 0.9, 0.98] : [1]) {
    let l = y[0], t = y[1] - y[0], sse = 0;
    for (let i = 1; i < y.length; i++) {
      const f = l + phi * t; sse += (y[i] - f) ** 2;
      const nl = a * y[i] + (1 - a) * (l + phi * t);
      t = b * (nl - l) + (1 - b) * phi * t; l = nl;
    }
    if (!best || sse < best.sse) best = { sse, a, b, phi };
  }
  const { a, b, phi } = best!;
  let l = y[0], t = y[1] - y[0];
  for (let i = 1; i < y.length; i++) { const nl = a * y[i] + (1 - a) * (l + phi * t); t = b * (nl - l) + (1 - b) * phi * t; l = nl; }
  return {
    name: damped ? 'Damped trend (Holt)' : 'Linear trend (Holt)',
    forecast: (h) => { const out = []; let s = 0; for (let k = 1; k <= h; k++) { s += phi ** k; out.push(l + s * t); } return out; },
  };
}

function holtWinters(y: number[], s = 12): Fit | null {
  if (y.length < 2 * s + 2) return null;
  const init = () => {
    const l0 = mean(y.slice(0, s));
    const t0 = (mean(y.slice(s, 2 * s)) - l0) / s;
    const seas = y.slice(0, s).map((v) => v - l0);
    return { l0, t0, seas };
  };
  const run = (a: number, b: number, g: number) => {
    const { l0, t0, seas } = init();
    let l = l0, t = t0; const S = [...seas]; let sse = 0;
    for (let i = s; i < y.length; i++) {
      const si = S[i % s];
      const f = l + t + si; sse += (y[i] - f) ** 2;
      const nl = a * (y[i] - si) + (1 - a) * (l + t);
      t = b * (nl - l) + (1 - b) * t;
      S[i % s] = g * (y[i] - nl) + (1 - g) * si;
      l = nl;
    }
    return { sse, l, t, S };
  };
  let best: { sse: number; a: number; b: number; g: number } | null = null;
  for (const a of [0.1, 0.2, 0.4, 0.6]) for (const b of [0.01, 0.05, 0.1]) for (const g of [0.05, 0.1, 0.3, 0.5]) {
    const r = run(a, b, g); if (!best || r.sse < best.sse) best = { sse: r.sse, a, b, g };
  }
  const { l, t, S } = run(best!.a, best!.b, best!.g);
  const n = y.length;
  return { name: 'Holt-Winters (trend + seasonality)', forecast: (h) => Array.from({ length: h }, (_, i) => l + (i + 1) * t + S[(n + i) % s]) };
}

const candidates = (y: number[]) => [naiveMean(y), seasonalNaive(y), holt(y, true), holtWinters(y)].filter(Boolean) as Fit[];
const builders: Record<string, (y: number[]) => Fit | null> = {
  '3-month average': (y) => naiveMean(y),
  'Seasonal naive × YoY growth': (y) => seasonalNaive(y),
  'Damped trend (Holt)': (y) => holt(y, true),
  'Holt-Winters (trend + seasonality)': (y) => holtWinters(y),
};

export interface ForecastOutput {
  method: string;
  compared: { method: string; mae: number; mape: number | null; folds: number }[];
  points: { step: number; value: number; lo80: number; hi80: number; lo95: number; hi95: number }[];
  sigma: number;
  backtestFolds: number;
}

export function forecastSeries(y: number[], horizon: number, opts: { min?: number; max?: number } = {}): ForecastOutput {
  if (y.length < 4) throw new Error(`Only ${y.length} historical periods — at least 4 are needed to forecast.`);
  const folds = Math.min(6, Math.max(2, Math.floor(y.length / 4)));
  const errs = new Map<string, { e: number[]; pe: number[] }>();
  for (let k = folds; k >= 1; k--) {
    const train = y.slice(0, y.length - k);
    const actual = y[y.length - k];
    for (const c of candidates(train)) {
      const f = c.forecast(1)[0];
      const rec = errs.get(c.name) ?? { e: [], pe: [] };
      rec.e.push(actual - f);
      if (actual !== 0) rec.pe.push(Math.abs((actual - f) / actual));
      errs.set(c.name, rec);
    }
  }
  const compared = [...errs.entries()]
    .filter(([, v]) => v.e.length >= Math.max(2, folds - 1))
    .map(([method, v]) => ({ method, mae: mean(v.e.map(Math.abs)), mape: v.pe.length ? mean(v.pe) : null, folds: v.e.length }))
    .sort((a, b) => a.mae - b.mae);
  const bestName = compared[0]?.method ?? '3-month average';
  const fit = builders[bestName](y) ?? naiveMean(y);
  const bestErr = errs.get(bestName)?.e ?? [std(y)];
  const sigma = Math.max(std(bestErr), mean(bestErr.map(Math.abs)) * 1.25, 1e-9);
  const clamp = (v: number) => Math.min(opts.max ?? Infinity, Math.max(opts.min ?? -Infinity, v));
  const points = fit.forecast(horizon).map((v, i) => {
    const s = sigma * Math.sqrt(1 + 0.5 * i);
    return { step: i + 1, value: clamp(v), lo80: clamp(v - 1.2816 * s), hi80: clamp(v + 1.2816 * s), lo95: clamp(v - 1.96 * s), hi95: clamp(v + 1.96 * s) };
  });
  return { method: fit.name, compared, points, sigma, backtestFolds: folds };
}

/** P(X >= target) for X ~ Normal(mu, sigma). */
export function probAtLeast(mu: number, sigma: number, target: number): number {
  if (sigma <= 0) return mu >= target ? 1 : 0;
  const z = (target - mu) / sigma;
  return 1 - normCdf(z);
}
function normCdf(z: number) {
  const t = 1 / (1 + 0.2316419 * Math.abs(z));
  const d = 0.3989423 * Math.exp((-z * z) / 2);
  const p = d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274))));
  return z > 0 ? 1 - p : p;
}

export const stats = { mean, std };
