/**
 * Live presenter helpers: describe a clicked/typed element in a way that survives small DOM differences between
 * the presenter's (signed-in, with edit controls) and a viewer's (public link) copy of the same report, and find it again.
 *
 * Description = nearest ancestor with an id (the "anchor") + a key built from tag, role-ish attributes and visible text,
 * + its index among elements in that anchor with the same key.
 */
export type ElDesc = { a: string | null; k: string; n: number };

const INTERACTIVE = 'button, a, summary, label, input, select, textarea, [role="button"], [role="tab"], [role="switch"], [data-drill], [tabindex]';

export function interactive(el: EventTarget | null): HTMLElement | null {
  return el instanceof Element ? (el.closest(INTERACTIVE) as HTMLElement | null) : null;
}

function keyOf(el: HTMLElement): string {
  const text = (el.getAttribute('aria-label') || el.getAttribute('title') || el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 80);
  const extra = el instanceof HTMLInputElement ? `${el.type}:${el.name}:${el.placeholder}` : el instanceof HTMLSelectElement || el instanceof HTMLTextAreaElement ? `${el.name}:${(el as HTMLTextAreaElement).placeholder ?? ''}` : '';
  return `${el.tagName}|${extra}|${text}`;
}

function anchorOf(el: HTMLElement): HTMLElement | null {
  let p = el.parentElement;
  while (p && !p.id) p = p.parentElement;
  return p;
}

function candidates(scope: ParentNode, k: string): HTMLElement[] {
  return [...scope.querySelectorAll<HTMLElement>(INTERACTIVE)].filter((x) => keyOf(x) === k);
}

export function describe(el: HTMLElement): ElDesc {
  const a = anchorOf(el); const k = keyOf(el);
  const list = candidates(a ?? document, k);
  return { a: a?.id ?? null, k, n: Math.max(0, list.indexOf(el)) };
}

export function locate(d: ElDesc): HTMLElement | null {
  const scope = (d.a && document.getElementById(d.a)) || document;
  const list = candidates(scope, d.k);
  return list[d.n] ?? list[0] ?? null;
}

/** Sets a value on a React-controlled input/select/textarea and fires the events React listens for. */
export function setValue(el: HTMLElement, v: string | boolean) {
  if (el instanceof HTMLInputElement && (el.type === 'checkbox' || el.type === 'radio')) {
    if (el.checked !== !!v) el.click();
    return;
  }
  const proto = el instanceof HTMLSelectElement ? HTMLSelectElement.prototype : el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, 'value')?.set?.call(el, String(v));
  el.dispatchEvent(new Event('input', { bubbles: true }));
  el.dispatchEvent(new Event('change', { bubbles: true }));
}

/** Section-relative position: which chapter ([data-spy]) a viewport point is in and where, as fractions. */
export function sectionPoint(x: number, y: number): { sec: string; fx: number; fy: number } | null {
  const secs = document.querySelectorAll<HTMLElement>('[data-spy]');
  for (const s of secs) {
    const r = s.getBoundingClientRect();
    if (y >= r.top && y <= r.bottom) return { sec: s.id, fx: (x - r.left) / r.width, fy: (y - r.top) / r.height };
  }
  return null;
}
export function sectionToViewport(p: { sec: string; fx: number; fy: number }): { x: number; y: number } | null {
  const s = document.getElementById(p.sec); if (!s) return null;
  const r = s.getBoundingClientRect();
  return { x: r.left + p.fx * r.width, y: r.top + p.fy * r.height };
}
