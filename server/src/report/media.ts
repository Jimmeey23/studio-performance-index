/**
 * Extra videos shown at the top of specific reviews (the music-icon playlist). Files live in the Blomp bucket at
 * absolute keys (not under BLOMP_PREFIX). A review matches when its scope and period month match.
 */
export interface MediaItem { title: string; key: string }
export interface MediaSet { scope: RegExp; month: string; items: MediaItem[] }

export const MEDIA: MediaSet[] = [
  { scope: /bandra|supreme/i, month: '2026-10', items: [
    { title: 'Bandra · Part 1', key: 'Bandra-1.mp4' },
    { title: 'Bandra · Part 2', key: 'Bandra - 2.mp4' },
    { title: 'Bandra · Part 3', key: 'Bandra - 3.mp4' },
  ] },
  { scope: /kwality|kemps/i, month: '2026-10', items: [
    { title: 'Kemps Corner · Part 1', key: 'Kemps -1.mp4' },
    { title: 'Kemps Corner · Part 2', key: 'Kemps - 2.mp4' },
  ] },
];

export const mediaFor = (scope: string, periodStart: string) => MEDIA.find((m) => m.scope.test(scope) && periodStart.startsWith(m.month));
