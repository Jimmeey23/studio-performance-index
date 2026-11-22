/**
 * Permanent trainer changes on recurring classes (studio · class · weekday · time), with a
 * before / after comparison and a verdict.
 *
 * Rules
 *  - Hosted classes are excluded.
 *  - Temporary cover is ignored: a run of ≤ 2 sessions (≈ 1–2 weeks) by another trainer that is
 *    followed by the original trainer again is treated as a substitution, not a change.
 *  - A change counts only when the new trainer then teaches ≥ 3 sessions in a row and the old
 *    trainer taught ≥ 2 sessions before it; the change date must fall inside the period.
 *  - "Before" = up to 8 sessions by the outgoing trainer immediately before the change (looks back
 *    up to 120 days before the period); "After" = the incoming trainer's sessions from the change
 *    to the period end.
 */
import crypto from 'node:crypto';
import { warehouse, sqlString } from '../warehouse/db.js';

type S = { slot: string; ts: string; teacher: string; cap: number; booked: number; ci: number; lc: number; rev: number };
type Agg = { classes: number; avg: number; fill: number | null; empty: number; rev: number; showup: number | null; lcr: number | null };
const HOSTED = "(lower(coalesce(session_name, '')) like '%hosted%' or lower(coalesce(session_title, '')) like '%hosted%')";

function agg(x: S[]): Agg {
  const n = x.length, ci = x.reduce((a, s) => a + s.ci, 0), cap = x.reduce((a, s) => a + s.cap, 0), bk = x.reduce((a, s) => a + s.booked, 0);
  return { classes: n, avg: n ? ci / n : 0, fill: cap ? ci / cap : null, empty: n ? x.filter((s) => s.ci === 0).length / n : 0,
    rev: n ? x.reduce((a, s) => a + s.rev, 0) / n : 0, showup: bk ? ci / bk : null, lcr: bk + x.reduce((a, s) => a + s.lc, 0) ? x.reduce((a, s) => a + s.lc, 0) / (bk + x.reduce((a, s) => a + s.lc, 0)) : null };
}
const rel = (a: number, b: number) => (a > 0 ? (b - a) / a : b > 0 ? 1 : 0);

export function verdict(b: Agg, a: Agg): { score: number; label: string } {
  // weighted: attendance 50%, fill 30%, revenue per class 20% — each capped at ±50%
  const c = (x: number) => Math.max(-0.5, Math.min(0.5, x));
  const fillD = b.fill !== null && a.fill !== null ? (a.fill - b.fill) / Math.max(b.fill, 0.05) : 0;
  const score = 0.5 * c(rel(b.avg, a.avg)) + 0.3 * c(fillD) + 0.2 * c(rel(b.rev, a.rev));
  const label = a.classes < 4 ? 'Too early to call' : score >= 0.15 ? 'Strong improvement' : score >= 0.05 ? 'Good change' : score > -0.05 ? 'Neutral' : score > -0.15 ? 'Weaker' : 'Poor change';
  return { score: Math.round(score * 1000) / 10, label };
}

export async function trainerChanges(req: { start: string; end: string; locations: string[] }) {
  const look = new Date(new Date(req.start + 'T00:00:00Z').getTime() - 120 * 864e5).toISOString().slice(0, 10);
  const where = ['is_past', `session_ts::date between ${sqlString(look)} and ${sqlString(req.end)}`, `not ${HOSTED}`, "coalesce(nullif(trim(teacher), ''), '') <> ''"];
  if (req.locations.length) where.push(`location in (${req.locations.map(sqlString).join(', ')})`);
  const db = await warehouse();
  const rows = await db.all<Record<string, unknown>>(`select coalesce(location,'') || ' · ' || coalesce(session_name,'') || ' · ' || strftime(session_ts, '%a %H:%M') as slot,
      session_ts::varchar as ts, trim(teacher) as teacher, coalesce(capacity,0) as cap, coalesce(booked,0) as booked, coalesce(checked_in,0) as ci,
      coalesce(late_cancelled,0) as lc, coalesce(revenue,0) as rev
    from fct_sessions where ${where.join(' and ')} order by slot, session_ts`);
  const bySlot = new Map<string, S[]>();
  for (const r of rows) { const s = { slot: String(r.slot), ts: String(r.ts), teacher: String(r.teacher), cap: Number(r.cap), booked: Number(r.booked), ci: Number(r.ci), lc: Number(r.lc), rev: Number(r.rev) }; (bySlot.get(s.slot) ?? bySlot.set(s.slot, []).get(s.slot)!).push(s); }
  const out: Record<string, unknown>[] = [];
  for (const [slot, ss] of bySlot) {
    // runs of the same trainer
    let runs: { t: string; s: S[] }[] = [];
    for (const s of ss) { const l = runs[runs.length - 1]; if (l && l.t === s.teacher) l.s.push(s); else runs.push({ t: s.teacher, s: [s] }); }
    // drop temporary cover (≤ 2 sessions sandwiched by the same trainer), then re-merge
    runs = runs.filter((r, i) => !(r.s.length <= 2 && i > 0 && i < runs.length - 1 && runs[i - 1].t === runs[i + 1].t));
    const merged: typeof runs = [];
    for (const r of runs) { const l = merged[merged.length - 1]; if (l && l.t === r.t) l.s.push(...r.s); else merged.push({ t: r.t, s: [...r.s] }); }
    for (let i = 1; i < merged.length; i++) {
      const A = merged[i - 1], B = merged[i]; const at = B.s[0].ts.slice(0, 10);
      if (A.s.length < 2 || B.s.length < 3 || at < req.start || at > req.end) continue;
      const before = agg(A.s.slice(-8)), after = agg(B.s); const v = verdict(before, after);
      out.push({ slot, change: `${A.t} → ${B.t}`, changed_on: at,
        classes_before: before.classes, classes_after: after.classes,
        avg_before: before.avg, avg_after: after.avg, avg_chg: rel(before.avg, after.avg),
        fill_before: before.fill, fill_after: after.fill, fill_chg: before.fill !== null && after.fill !== null ? after.fill - before.fill : null,
        rev_before: before.rev, rev_after: after.rev, empty_before: before.empty, empty_after: after.empty,
        showup_before: before.showup, showup_after: after.showup, lcr_before: before.lcr, lcr_after: after.lcr,
        score: v.score, verdict: v.label });
    }
  }
  out.sort((a, b) => Number(b.score) - Number(a.score));
  if (!out.length) return null;
  const c = (key: string, label: string, format: string, kind = 'metric') => ({ key, label, kind, format });
  const good = out.filter((r) => /improvement|Good/.test(String(r.verdict))).length, poor = out.filter((r) => /Weaker|Poor/.test(String(r.verdict))).length;
  return {
    id: `xt${crypto.randomUUID().slice(0, 6)}`, title: 'Trainer changes — before vs after',
    note: `${out.length} permanent trainer changes (${good} good, ${poor} weaker or poor). Hosted classes and temporary cover (another trainer for 1–2 weeks before the regular trainer returns) are excluded. Before = up to 8 classes by the outgoing trainer; after = every class by the new trainer. Verdict weights attendance 50%, fill 30%, revenue per class 20%; fewer than 4 classes after the change = too early to call.`,
    result: {
      id: 'r_' + crypto.randomUUID().slice(0, 10), kind: 'trainer_changes', sql: [], title: 'Trainer changes — before vs after',
      columns: [c('slot', 'Class slot', 'text', 'dimension'), c('change', 'Trainer change', 'text', 'dimension'), c('changed_on', 'Changed on', 'text', 'dimension'), c('verdict', 'Verdict', 'text', 'dimension'),
        c('classes_before', 'Classes before', 'number'), c('classes_after', 'Classes after', 'number'),
        c('avg_before', 'Avg attendance before', 'decimal'), c('avg_after', 'Avg attendance after', 'decimal'), c('avg_chg', 'Attendance Δ', 'percent', 'change'),
        c('fill_before', 'Fill before', 'percent'), c('fill_after', 'Fill after', 'percent'), c('fill_chg', 'Fill Δ (pp)', 'percent', 'change'),
        c('rev_before', 'Revenue / class before', 'currency'), c('rev_after', 'Revenue / class after', 'currency'),
        c('empty_before', 'Empty rate before', 'percent'), c('empty_after', 'Empty rate after', 'percent'),
        c('showup_before', 'Show-up before', 'percent'), c('showup_after', 'Show-up after', 'percent'),
        c('lcr_before', 'Late-cancel before', 'percent'), c('lcr_after', 'Late-cancel after', 'percent'), c('score', 'Change score', 'decimal')],
      rows: out, sources: ['Day End Report - Part 3 › Sessions (fct_sessions)'], notes: [], definitions: [], checks: [], verified: true, rowCount: out.length,
    },
  };
}
