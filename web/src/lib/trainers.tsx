/** Trainer thumbnails (photos from the atlas repo, public/instructors/<slug>.jpg) shown wherever a trainer name appears. */
const PHOTOS = new Set(['anisha-shah', 'anmol-sharma', 'atulan-purohit', 'bret-saldanha', 'cauveri-vikrant', 'chaitanya-nahar', 'kajol-kanchan', 'karan-bhatia',
  'mayasaa-nafis', 'mrigakshi-n-jaiswal', 'pranjali-jain', 'pushyank-nahar', 'raunak-khemuka', 'reshma-sharma', 'richard-dcosta', 'rohan-dahima', 'shruti-kulkarni',
  'siddhartha-kusuma', 'simonelle-de-vitre', 'simran-dutt', 'siya-mukund', 'vivaran']);
const slug = (n: string) => n.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[.']/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
/** Photo URL for a trainer name, or null. Matches full name, then first name alone (e.g. "Vivaran"). */
export function trainerPhoto(name: string | null | undefined): string | null {
  if (!name) return null;
  const s = slug(name); if (PHOTOS.has(s)) return `/instructors/${s}.jpg`;
  const first = s.split('-')[0]; const hits = [...PHOTOS].filter((p) => p === first || p.startsWith(`${first}-`));
  return hits.length === 1 ? `/instructors/${hits[0]}.jpg` : null;
}
const initials = (n: string) => n.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]?.toUpperCase()).join('');
export function TrainerAvatar({ name, size = 22 }: { name: string; size?: number }) {
  const src = trainerPhoto(name);
  const st = { width: size, height: size, minWidth: size, borderRadius: '50%', fontSize: Math.round(size * 0.4) } as const;
  return src
    ? <img src={src} alt="" loading="lazy" style={{ ...st, objectFit: 'cover', objectPosition: 'center 20%' }} className="ring-1 ring-line" />
    : <span style={st} className="inline-flex items-center justify-center bg-surface-2 font-medium text-ink-3 ring-1 ring-line">{initials(name)}</span>;
}
export function TrainerName({ name, size = 22 }: { name: string; size?: number }) {
  return <span className="inline-flex min-w-0 items-center gap-2"><TrainerAvatar name={name} size={size} /><span className="truncate">{name}</span></span>;
}
export const isTrainerKey = (k: string) => /^(teacher|trainer|instructor)$/i.test(k);
