/**
 * Class explorer — rank classes by any grouping (class · day · time · location · trainer · AM/PM …)
 * on any of 12 criteria, with ~28 comparable metrics per group and minimum-volume filters.
 * Source: Day End Report - Part 3 › Sessions (fct_sessions, past classes only).
 */
import crypto from 'node:crypto';
import { z } from 'zod';
import type { Column } from '../semantic/engine.js';
import { warehouse, sqlString } from '../warehouse/db.js';
import { FORMAT } from '../semantic/metrics.js';

/* ── fields a grouping can be built from ── */
const HR = 'extract(hour from session_ts)';
const F: Record<string, { label: string; sql: string; order?: string }> = {
  class: { label: 'Class', sql: "coalesce(nullif(trim(session_name), ''), '(blank)')" },
  format: { label: 'Format', sql: `coalesce(${FORMAT('session_name')}, 'Other')` },
  class_format: { label: 'Class type', sql: "coalesce(nullif(trim(class_type), ''), '(blank)')" },
  day: { label: 'Day', sql: 'day_of_week', order: 'isodow(session_ts)' },
  time: { label: 'Time', sql: "coalesce(start_time, strftime(session_ts, '%H:%M'))" },
  hour: { label: 'Hour', sql: `lpad(${HR}::varchar, 2, '0') || ':00'` },
  ampm: { label: 'AM / PM', sql: `case when ${HR} < 12 then 'AM' else 'PM' end` },
  band: { label: 'Time band', sql: `case when ${HR} < 11 then 'Morning (before 11)' when ${HR} < 16 then 'Midday (11–4)' else 'Evening (4 onwards)' end` },
  prime: { label: 'Prime / off-peak', sql: `case when (${HR} between 7 and 9) or (${HR} between 17 and 20) then 'Prime' else 'Off-peak' end` },
  weekpart: { label: 'Weekday / weekend', sql: "case when isodow(session_ts) >= 6 then 'Weekend' else 'Weekday' end" },
  location: { label: 'Location', sql: "coalesce(location, '(blank)')" },
  city: { label: 'City', sql: "coalesce(city, '(blank)')" },
  trainer: { label: 'Trainer', sql: "coalesce(nullif(trim(teacher), ''), '(blank)')" },
  month: { label: 'Month', sql: "strftime(session_ts, '%Y-%m')" },
  room: { label: 'Room size', sql: "case when capacity <= 8 then 'Small (≤8)' when capacity <= 12 then 'Medium (9–12)' else 'Large (13+)' end" },
};

/** Groupings offered in the explorer (field lists, in display order). */
export const GROUPINGS: { id: string; label: string; fields: string[] }[] = [
  ['class-day-time-location', ['class', 'day', 'time', 'location']],
  ['class-day-time-location-trainer', ['class', 'day', 'time', 'location', 'trainer']],
  ['class-day-time', ['class', 'day', 'time']],
  ['day-time', ['day', 'time']],
  ['day-time-location', ['day', 'time', 'location']],
  ['location-ampm', ['location', 'ampm']],
  ['location-day-ampm', ['location', 'day', 'ampm']],
  ['class', ['class']],
  ['class-location', ['class', 'location']],
  ['class-trainer', ['class', 'trainer']],
  ['class-location-trainer', ['class', 'location', 'trainer']],
  ['class-ampm', ['class', 'ampm']],
  ['class-month', ['class', 'month']],
  ['class_format', ['class_format']],
  ['class_format-location', ['class_format', 'location']],
  ['format', ['format']],
  ['format-location', ['format', 'location']],
  ['format-day', ['format', 'day']],
  ['format-time', ['format', 'time']],
  ['format-band', ['format', 'band']],
  ['format-trainer', ['format', 'trainer']],
  ['format-location-day-time', ['format', 'location', 'day', 'time']],
  ['trainer', ['trainer']],
  ['trainer-location', ['trainer', 'location']],
  ['trainer-day-time', ['trainer', 'day', 'time']],
  ['trainer-ampm', ['trainer', 'ampm']],
  ['trainer-format', ['trainer', 'format']],
  ['trainer-month', ['trainer', 'month']],
  ['location', ['location']],
  ['location-day', ['location', 'day']],
  ['location-time', ['location', 'time']],
  ['location-hour', ['location', 'hour']],
  ['location-band', ['location', 'band']],
  ['location-prime', ['location', 'prime']],
  ['location-weekpart', ['location', 'weekpart']],
  ['location-month', ['location', 'month']],
  ['location-room', ['location', 'room']],
  ['day', ['day']],
  ['time', ['time']],
  ['hour', ['hour']],
  ['day-hour', ['day', 'hour']],
  ['day-band', ['day', 'band']],
  ['ampm', ['ampm']],
  ['band', ['band']],
  ['prime', ['prime']],
  ['weekpart', ['weekpart']],
  ['room', ['room']],
  ['city-format', ['city', 'format']],
  ['month', ['month']],
].map(([id, fields]) => ({ id: id as string, fields: fields as string[], label: (fields as string[]).map((f) => F[f].label).join(' · ') }));

/* ── metrics compared for every group ── */
type M = { key: string; label: string; format: string; sql: string; lowerBetter?: boolean };
const PAID = 'nullif(sum(membership_checkins + package_checkins + intro_offer_checkins + single_class_checkins), 0)';
export const METRICS: M[] = [
  { key: 'classes', label: 'Classes', format: 'number', sql: 'count(*)' },
  { key: 'checkins', label: 'Check-ins', format: 'number', sql: 'sum(checked_in)' },
  { key: 'class_avg', label: 'Avg attendance', format: 'decimal', sql: 'sum(checked_in) / nullif(count(*) filter (where checked_in > 0), 0)' },
  { key: 'class_avg_all', label: 'Avg att. (incl. empty)', format: 'decimal', sql: 'sum(checked_in) / nullif(count(*), 0)' },
  { key: 'fill', label: 'Fill rate', format: 'percent', sql: 'sum(checked_in) / nullif(sum(capacity), 0)' },
  { key: 'capacity', label: 'Capacity', format: 'number', sql: 'sum(capacity)' },
  { key: 'avg_capacity', label: 'Avg capacity', format: 'decimal', sql: 'avg(capacity)' },
  { key: 'booked', label: 'Booked', format: 'number', sql: 'sum(booked)' },
  { key: 'booking_fill', label: 'Booking fill', format: 'percent', sql: 'sum(booked) / nullif(sum(capacity), 0)' },
  { key: 'show_up', label: 'Show-up rate', format: 'percent', sql: 'sum(checked_in) / nullif(sum(booked), 0)' },
  { key: 'empty', label: 'Empty classes', format: 'number', sql: 'count(*) filter (where checked_in = 0)', lowerBetter: true },
  { key: 'empty_rate', label: 'Empty %', format: 'percent', sql: 'count(*) filter (where checked_in = 0) / nullif(count(*), 0)', lowerBetter: true },
  { key: 'peak', label: 'Peak attendance', format: 'number', sql: 'max(checked_in)' },
  { key: 'consistency', label: 'Consistency (0–100)', format: 'decimal', sql: 'greatest(0, 100 * (1 - coalesce(stddev_samp(checked_in), 0) / nullif(avg(checked_in), 0)))' },
  { key: 'sold_out', label: 'Sold-out %', format: 'percent', sql: 'count(*) filter (where checked_in >= capacity and capacity > 0) / nullif(count(*), 0)' },
  { key: 'high_fill', label: '≥ 75% full', format: 'percent', sql: 'count(*) filter (where checked_in >= 0.75 * capacity and capacity > 0) / nullif(count(*), 0)' },
  { key: 'low_fill', label: '< 35% full', format: 'percent', sql: 'count(*) filter (where checked_in < 0.35 * capacity) / nullif(count(*), 0)', lowerBetter: true },
  { key: 'revenue', label: 'Revenue', format: 'currency', sql: 'sum(revenue)' },
  { key: 'rev_class', label: 'Revenue / class', format: 'currency', sql: 'sum(revenue) / nullif(count(*), 0)' },
  { key: 'rev_attendee', label: 'Revenue / attendee', format: 'currency', sql: 'sum(revenue) / nullif(sum(checked_in), 0)' },
  { key: 'rev_seat', label: 'Revenue / seat', format: 'currency', sql: 'sum(revenue) / nullif(sum(capacity), 0)' },
  { key: 'unsold', label: 'Unsold seats', format: 'number', sql: 'sum(greatest(capacity - checked_in, 0))', lowerBetter: true },
  { key: 'late_cancels', label: 'Late cancels', format: 'number', sql: 'sum(late_cancelled)', lowerBetter: true },
  { key: 'late_rate', label: 'Late-cancel %', format: 'percent', sql: 'sum(late_cancelled) / nullif(sum(booked) + sum(late_cancelled), 0)', lowerBetter: true },
  { key: 'non_paid', label: 'Non-paid %', format: 'percent', sql: 'sum(non_paid) / nullif(sum(checked_in), 0)', lowerBetter: true },
  { key: 'comp', label: 'Comp check-ins', format: 'number', sql: 'sum(complimentary)' },
  { key: 'member_share', label: 'Membership %', format: 'percent', sql: `sum(membership_checkins) / ${PAID}` },
  { key: 'intro_share', label: 'Intro-offer %', format: 'percent', sql: `sum(intro_offer_checkins) / ${PAID}` },
  { key: 'trainers', label: 'Trainers', format: 'number', sql: "count(distinct nullif(trim(teacher), ''))" },
  { key: 'first', label: 'First class', format: 'text', sql: "strftime(min(session_ts), '%d %b %y')" },
  { key: 'last', label: 'Last class', format: 'text', sql: "strftime(max(session_ts), '%d %b %y')" },
];

/** Ranking criteria (12). "score" is a composite computed after aggregation. */
export const CRITERIA: { id: string; label: string; key: string; lowerBetter?: boolean }[] = [
  { id: 'score', label: 'Composite class score', key: 'score' },
  { id: 'class_avg', label: 'Avg attendance', key: 'class_avg' },
  { id: 'fill', label: 'Fill rate', key: 'fill' },
  { id: 'checkins', label: 'Total check-ins', key: 'checkins' },
  { id: 'revenue', label: 'Revenue', key: 'revenue' },
  { id: 'rev_class', label: 'Revenue per class', key: 'rev_class' },
  { id: 'rev_attendee', label: 'Revenue per attendee', key: 'rev_attendee' },
  { id: 'booking_fill', label: 'Booking fill', key: 'booking_fill' },
  { id: 'show_up', label: 'Show-up rate', key: 'show_up' },
  { id: 'sold_out', label: 'Sold-out %', key: 'sold_out' },
  { id: 'consistency', label: 'Consistency', key: 'consistency' },
  { id: 'empty_rate', label: 'Empty %', key: 'empty_rate', lowerBetter: true },
  { id: 'late_rate', label: 'Late-cancel %', key: 'late_rate', lowerBetter: true },
  { id: 'classes', label: 'Number of classes', key: 'classes' },
];

export const ExploreSchema = z.object({
  start: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  end: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  locations: z.array(z.string()).default([]),
  grouping: z.string().default('class-day-time-location'),
  rankBy: z.string().default('score'),
  dir: z.enum(['desc', 'asc']).default('desc'),
  minClasses: z.number().int().min(0).default(3),
  minAvg: z.number().min(0).default(0),          // minimum average attendance (excl. empty)
  minCheckins: z.number().int().min(0).default(0),
  hosted: z.enum(['exclude', 'include', 'only']).default('exclude'),
  excludeEmpty: z.boolean().default(false),       // drop empty classes entirely
  formats: z.array(z.string()).default([]),       // Barre / powerCycle / Strength Lab / Other
  days: z.array(z.string()).default([]),
  ampm: z.enum(['all', 'AM', 'PM']).default('all'),
  trainers: z.array(z.string()).default([]),
  search: z.string().max(80).default(''),
  limit: z.number().int().min(1).max(1000).default(200),
});
export type ExploreInput = z.infer<typeof ExploreSchema>;

const HOSTED = "(lower(coalesce(session_name, '')) like '%hosted%' or lower(coalesce(session_title, '')) like '%hosted%')";
const pct = (vals: number[], v: number) => (vals.length <= 1 ? 50 : ((vals.filter((x) => x < v).length + (vals.filter((x) => x === v).length - 1) / 2) / (vals.length - 1)) * 100);

export async function exploreClasses(raw: unknown) {
  const q = ExploreSchema.parse(raw);
  const g = GROUPINGS.find((x) => x.id === q.grouping) ?? GROUPINGS[0];
  const crit = CRITERIA.find((c) => c.id === q.rankBy) ?? CRITERIA[0];
  const where = [`is_past`, `session_ts::date between ${sqlString(q.start)} and ${sqlString(q.end)}`];
  if (q.locations.length) where.push(`location in (${q.locations.map(sqlString).join(', ')})`);
  if (q.hosted === 'exclude') where.push(`not ${HOSTED}`); else if (q.hosted === 'only') where.push(HOSTED);
  if (q.excludeEmpty) where.push('checked_in > 0');
  if (q.formats.length) where.push(`${F.format.sql} in (${q.formats.map(sqlString).join(', ')})`);
  if (q.days.length) where.push(`day_of_week in (${q.days.map(sqlString).join(', ')})`);
  if (q.ampm !== 'all') where.push(`${F.ampm.sql} = ${sqlString(q.ampm)}`);
  if (q.trainers.length) where.push(`teacher in (${q.trainers.map(sqlString).join(', ')})`);
  if (q.search.trim()) where.push(`lower(coalesce(session_name, '') || ' ' || coalesce(session_title, '') || ' ' || coalesce(teacher, '') || ' ' || coalesce(location, '')) like ${sqlString('%' + q.search.trim().toLowerCase() + '%')}`);
  const dims = g.fields.map((f, i) => `${F[f].sql} as g${i}`);
  const orderKeys = g.fields.map((f) => (F[f].order ? `min(${F[f].order})` : null));
  const sql = `select ${dims.join(', ')}, ${orderKeys.map((o, i) => (o ? `${o} as o${i}` : `null as o${i}`)).join(', ')}, ${METRICS.map((m) => `${m.sql} as ${m.key}`).join(', ')}
    from fct_sessions where ${where.join(' and ')} group by ${g.fields.map((_, i) => i + 1).join(', ')}`;
  const db = await warehouse();
  const all = (await db.all<Record<string, unknown>>(sql)).map((r) => {
    const o: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(r)) o[k] = typeof v === 'bigint' ? Number(v) : v;
    return o;
  });
  const totalGroups = all.length;
  let rows = all.filter((r) => Number(r.classes) >= q.minClasses && Number(r.class_avg ?? 0) >= q.minAvg && Number(r.checkins) >= q.minCheckins);
  // composite: attendance 35, fill 30, revenue per class 20, show-up 15, less up to 10 for empty classes — percentiles among the groups shown
  const V = (k: string) => rows.map((r) => Number(r[k])).filter((x) => isFinite(x));
  const va = V('class_avg'), vf = V('fill'), vr = V('rev_class'), vs = V('show_up');
  for (const r of rows) {
    const p = (vals: number[], k: string) => (isFinite(Number(r[k])) && r[k] !== null ? pct(vals, Number(r[k])) / 100 : 0.5);
    const s = 35 * p(va, 'class_avg') + 30 * p(vf, 'fill') + 20 * p(vr, 'rev_class') + 15 * p(vs, 'show_up') - Math.min(10, Number(r.empty_rate ?? 0) * 40);
    r.score = Math.round(Math.max(0, Math.min(100, s)) * 10) / 10;
  }
  const sign = q.dir === 'desc' ? -1 : 1;
  rows.sort((a, b) => { const x = Number(a[crit.key]), y = Number(b[crit.key]); const nx = isFinite(x) && a[crit.key] !== null, ny = isFinite(y) && b[crit.key] !== null; if (!nx || !ny) return nx ? -1 : ny ? 1 : 0; return sign * (x - y) || Number(b.checkins) - Number(a.checkins); });
  rows.forEach((r, i) => { r.rank = i + 1; });
  const shown = rows.slice(0, q.limit).map((r) => {
    const o: Record<string, unknown> = { rank: r.rank };
    o.group = g.fields.map((_, i) => String(r[`g${i}`] ?? '(blank)')).join(' · ');
    o.score = r.score; for (const m of METRICS) o[m.key] = r[m.key];
    return o;
  });
  // totals: every class in the groups that meet the filters (true ratios, not averages of averages)
  const having = [`count(*) >= ${q.minClasses}`, `coalesce(sum(checked_in) / nullif(count(*) filter (where checked_in > 0), 0), 0) >= ${q.minAvg}`, `sum(checked_in) >= ${q.minCheckins}`];
  const gk = g.fields.map((_, i) => `g${i}`).join(', ');
  const tot = (await db.all<Record<string, unknown>>(`with s as (select *, ${dims.join(', ')} from fct_sessions where ${where.join(' and ')}),
    k as (select ${gk} from s group by ${gk} having ${having.join(' and ')})
    select ${METRICS.map((m) => `${m.sql} as ${m.key}`).join(', ')} from s join k using (${gk})`))[0] ?? {};
  const totals: Record<string, unknown> = { rank: null, score: null };
  for (const m of METRICS) { const v = tot[m.key]; totals[m.key] = m.key === 'peak' || m.key === 'first' || m.key === 'last' ? null : typeof v === 'bigint' ? Number(v) : v; }
  const col = (key: string, label: string, format: string, kind: Column['kind'] = 'metric') => ({ key, label, kind, format } as Column);
  const critCol = METRICS.find((m) => m.key === crit.key);
  const metricCols = [col('score', 'Class score', 'decimal'), ...METRICS.map((m) => col(m.key, m.label, m.format, m.format === 'text' ? 'dimension' : 'metric'))];
  // the ranking metric right after the dimensions
  const ordered = critCol ? [metricCols.find((c) => c.key === crit.key)!, ...metricCols.filter((c) => c.key !== crit.key)] : metricCols;
  const columns = [col('group', g.label, 'text', 'dimension'), col('rank', 'Rank', 'number'), ...ordered];
  const result = {
    id: 'r_' + crypto.randomBytes(5).toString('hex'), kind: 'class_explorer',
    title: `${g.label} — ranked by ${crit.label.toLowerCase()} (${q.dir === 'desc' ? 'high → low' : 'low → high'})`,
    columns, rows: shown, totals, sql: [sql], sources: ['Day End Report - Part 3 › Sessions (fct_sessions)'], definitions: [], checks: [], verified: true,
    notes: [`${rows.length} of ${totalGroups} groups meet the filters (min ${q.minClasses} classes${q.minAvg ? `, avg attendance ≥ ${q.minAvg}` : ''}${q.minCheckins ? `, ≥ ${q.minCheckins} check-ins` : ''}; hosted classes ${q.hosted === 'exclude' ? 'excluded' : q.hosted === 'only' ? 'only' : 'included'}).`,
      'Class score = percentile among the groups shown: avg attendance 35, fill 30, revenue per class 20, show-up 15, minus up to 10 for empty classes.'],
    rowCount: rows.length, truncated: rows.length > shown.length,
  };
  return { result, totalGroups, matched: rows.length };
}

export const explorerOptions = () => ({
  groupings: GROUPINGS.map(({ id, label }) => ({ id, label })),
  criteria: CRITERIA.map(({ id, label, lowerBetter }) => ({ id, label, lowerBetter: !!lowerBetter })),
  metrics: METRICS.map(({ key, label }) => ({ key, label })),
  formats: ['Barre', 'powerCycle', 'Strength Lab', 'Other'],
  days: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'],
});
