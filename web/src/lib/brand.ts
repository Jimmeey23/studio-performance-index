/**
 * Physique 57 India brand assets, taken from physique57india.com and bundled with the app
 * (web/public/brand) so reports and exports work offline.
 */
const B = (n: string) => `/brand/p57-${n}.jpg`;
export const BRAND = {
  /** white "PHYSIQUE" wordmark with the blue 57 — for dark backgrounds */
  logoOnDark: '/brand/p57-logo-white.png',
  /** charcoal "PHYSIQUE" wordmark with the blue 57 — for light backgrounds */
  logoOnLight: '/brand/p57-logo.png',
  /** studio photography (supplied by Physique 57 India) */
  photos: ['barre-group', 'cycle-group', 'studio-barre', 'strength-kettlebell', 'cycle-ride', 'trainers-pair', 'strength-lunge', 'cycle-mono', 'trainers-duo'].map(B),
  /** wide studio shot for banners */
  banner: B('studio-barre'),
  blue: '#6ecff6',
  ink: '#20201e',
  site: 'physique57india.com',
};
/** The photograph that best fits each report topic. */
const BY_SECTION: Record<string, string> = {
  cover: 'barre-group', sales: 'studio-barre', new_clients: 'barre-group', leads: 'cycle-group', trainers: 'trainers-pair', classes: 'cycle-ride',
  formats: 'strength-lunge', churn: 'strength-kettlebell', late: 'cycle-mono', studios: 'studio-barre', associates: 'trainers-duo', clients: 'cycle-group', road: 'strength-lunge',
};
/** Cover photographs: subjects sit in the upper half, clear of the title block. */
const COVER_BY_SECTION: Record<string, string> = { cover: 'cycle-group', trainers: 'trainers-pair', associates: 'trainers-duo', churn: 'strength-kettlebell', clients: 'strength-kettlebell', classes: 'cycle-ride', late: 'cycle-ride', leads: 'cycle-ride', formats: 'strength-kettlebell' };
export const coverPhotoFor = (id: string) => B(COVER_BY_SECTION[id] ?? 'cycle-group');
export const photoForSection = (id: string) => B(BY_SECTION[id] ?? 'barre-group');
export const photoFor = (i: number) => BRAND.photos[((i % BRAND.photos.length) + BRAND.photos.length) % BRAND.photos.length];

const cache = new Map<string, Promise<{ data: string; w: number; h: number } | null>>();
/** An asset as a data URL with its pixel size (for Word / PowerPoint / HTML exports). */
export function brandData(url: string) {
  if (!cache.has(url)) cache.set(url, (async () => {
    try {
      const blob = await (await fetch(url)).blob();
      const data = await new Promise<string>((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result)); r.onerror = rej; r.readAsDataURL(blob); });
      const img = new Image(); img.src = data; await img.decode();
      return { data, w: img.naturalWidth, h: img.naturalHeight };
    } catch { return null; }
  })());
  return cache.get(url)!;
}
export const dataToBytes = (data: string) => { const bin = atob(data.split(',')[1]); const buf = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i); return buf; };
