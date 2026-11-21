/**
 * Random accent per page load. One curated pair (accent + secondary) is picked
 * and written as CSS variables for light and dark themes, so every surface —
 * sidebar, buttons, charts, logo, report — picks it up.
 */
export interface AccentPair { name: string; a: string; b: string }
export const ACCENTS: AccentPair[] = [
  { name: 'Physique 57', a: '#1b8fc4', b: '#6ecff6' },
  { name: 'Indigo', a: '#4f56d9', b: '#9b5cf0' },
  { name: 'Emerald', a: '#0e9f6e', b: '#0ea5a4' },
  { name: 'Rose', a: '#e11d48', b: '#f97316' },
  { name: 'Ocean', a: '#0284c7', b: '#6366f1' },
  { name: 'Violet', a: '#7c3aed', b: '#db2777' },
  { name: 'Amber', a: '#d97706', b: '#e11d48' },
  { name: 'Teal', a: '#0d9488', b: '#2563eb' },
  { name: 'Fuchsia', a: '#c026d3', b: '#7c3aed' },
  { name: 'Cobalt', a: '#2563eb', b: '#06b6d4' },
  { name: 'Coral', a: '#ea580c', b: '#db2777' },
];
const hex = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const toHex = (c: number[]) => '#' + c.map((x) => Math.round(Math.max(0, Math.min(255, x))).toString(16).padStart(2, '0')).join('');
export const mix = (a: string, b: string, t: number) => { const x = hex(a), y = hex(b); return toHex(x.map((v, i) => v + (y[i] - v) * t)); };
const rgb = (h: string) => hex(h).join(' ');

let current: AccentPair = ACCENTS[0];
export const currentAccent = () => current;

export function applyAccent(p: AccentPair) {
  current = p;
  const css = `
:root { --accent: ${p.a}; --accent-2: ${p.b}; --accent-soft: ${mix(p.a, '#ffffff', 0.9)}; --accent-rgb: ${rgb(p.a)}; --accent2-rgb: ${rgb(p.b)};
  --accent-deep: ${mix(p.a, '#0b0c1e', 0.62)}; --accent-ink: ${mix(p.a, '#0b0c1e', 0.35)}; --series-1: ${p.a}; }
:root[data-theme="dark"] { --accent: ${mix(p.a, '#ffffff', 0.32)}; --accent-2: ${mix(p.b, '#ffffff', 0.28)}; --accent-soft: ${mix(p.a, '#14151b', 0.78)}; --series-1: ${mix(p.a, '#ffffff', 0.18)}; }`;
  let el = document.getElementById('p57-accent') as HTMLStyleElement | null;
  if (!el) { el = document.createElement('style'); el.id = 'p57-accent'; document.head.appendChild(el); }
  el.textContent = css;
}
export function randomAccent() {
  let prev = '';
  try { prev = sessionStorage.getItem('p57-accent') ?? ''; } catch { /* */ }
  const pool = ACCENTS.filter((x) => x.name !== prev);
  const pick = pool[Math.floor(Math.random() * pool.length)];
  try { sessionStorage.setItem('p57-accent', pick.name); } catch { /* */ }
  applyAccent(pick);
}
