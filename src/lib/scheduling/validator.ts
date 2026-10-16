import { dayToISO } from '../calendar';
import type { Hires } from '../analysis/demand';
import { relSatisfied, type Context, type Positions } from './context';

export type ViolationKind = 'relationship' | 'duration' | 'data_date' | 'fixed' | 'capacity' | 'hire';

export interface Violation {
  kind: ViolationKind;
  message: string;
  activity?: string;
  group?: string;
  day?: number;
}

export interface ValidationResult {
  ok: boolean;
  violations: Violation[];
  counts: Record<ViolationKind, number>;
  checked: { activities: number; relationships: number; groupDays: number; capacityChecked: boolean };
}

export interface ValidateOptions {
  /** Check pooled capacity (+ hired units). Off for unleveled reference schedules such as the baseline. */
  checkCapacity: boolean;
  /** Reference positions for fixed (completed / in-progress) activities */
  fixedRef: Positions;
  /** Stop listing after this many violations of one kind (counts stay exact) */
  maxListed?: number;
}

const EPS = 1e-6;

/**
 * Check a schedule against every hard constraint, independently of how it was produced:
 *  - every relationship (FS/SS/FF/SF with lag) holds
 *  - activity durations equal their (remaining) working-day durations
 *  - nothing that has not started is scheduled before its project's data date
 *  - completed / in-progress activities keep their actual dates
 *  - daily demand of each leveled group ≤ capacity + explicitly hired units
 */
export function validateSchedule(ctx: Context, sched: Positions & { hires?: Hires }, opts: ValidateOptions): ValidationResult {
  const counts: Record<ViolationKind, number> = { relationship: 0, duration: 0, data_date: 0, fixed: 0, capacity: 0, hire: 0 };
  const violations: Violation[] = [];
  const max = opts.maxListed ?? 50;
  const push = (v: Violation) => {
    counts[v.kind]++;
    if (counts[v.kind] <= max) violations.push(v);
  };
  const label = (i: number) => `${ctx.projects[ctx.acts[i].projectIdx].name}: ${ctx.acts[i].code}`;

  ctx.acts.forEach((a, i) => {
    const s = sched.start[i];
    const f = sched.finish[i];
    if (!Number.isFinite(s) || !Number.isFinite(f)) {
      push({ kind: 'duration', activity: label(i), message: `${label(i)} has no valid dates.` });
      return;
    }
    if (a.fixed) {
      if (s !== opts.fixedRef.start[i] || (a.status === 'completed' && f !== opts.fixedRef.finish[i])) {
        push({ kind: 'fixed', activity: label(i), message: `${label(i)} is ${a.status.replace('_', ' ')} but was moved (actual start ${dayToISO(opts.fixedRef.start[i])}).` });
      }
      return;
    }
    if (a.durationDays === 0) {
      if (f !== s) push({ kind: 'duration', activity: label(i), message: `${label(i)} is a milestone but has a non-zero span.` });
    } else {
      const n = a.cal.countWorkdays(s, f);
      if (n !== a.durationDays || !a.cal.isWorkday(s) || !a.cal.isWorkday(f - 1)) {
        push({ kind: 'duration', activity: label(i), message: `${label(i)} spans ${n} working days; its duration is ${a.durationDays}.` });
      }
    }
    if (s < a.minStart) {
      push({ kind: 'data_date', activity: label(i), message: `${label(i)} starts ${dayToISO(s)}, before the data date ${dayToISO(a.minStart)}.` });
    }
  });

  for (const rel of ctx.rels) {
    if (!relSatisfied(ctx, rel, sched)) {
      push({
        kind: 'relationship',
        activity: label(rel.succ),
        message: `${label(rel.pred)} → ${label(rel.succ)} (${rel.type}${rel.lag ? ` lag ${rel.lag}d` : ''}) is violated.`,
      });
    }
  }

  let groupDays = 0;
  if (opts.checkCapacity) {
    // Independent daily-demand recomputation
    const usage = ctx.groups.map(() => new Map<number, number>());
    ctx.acts.forEach((a, i) => {
      for (const dem of a.demands) {
        if (!ctx.groups[dem.g].leveled) continue;
        for (let d = Math.max(sched.start[i], a.minStart); d < sched.finish[i]; d++) {
          if (a.cal.isWorkday(d)) usage[dem.g].set(d, (usage[dem.g].get(d) ?? 0) + dem.units);
        }
      }
    });
    ctx.groups.forEach((g, gi) => {
      if (!g.leveled || g.capacity === null) return;
      const hired = sched.hires?.[g.id] ?? {};
      for (const [d, h] of Object.entries(hired)) {
        if (h < -EPS) push({ kind: 'hire', group: g.name, day: Number(d), message: `${g.name}: negative hire on ${dayToISO(Number(d))}.` });
      }
      for (const [d, u] of [...usage[gi].entries()].sort((x, y) => x[0] - y[0])) {
        groupDays++;
        const avail = g.capacity + (hired[d] ?? 0);
        if (u > avail + EPS) {
          push({
            kind: 'capacity',
            group: g.name,
            day: d,
            message: `${g.name} on ${dayToISO(d)}: demand ${round2(u)} exceeds capacity ${g.capacity}${hired[d] ? ` + ${round2(hired[d])} hired` : ''}.`,
          });
        }
      }
    });
  }
  const total = Object.values(counts).reduce((s, c) => s + c, 0);
  return {
    ok: total === 0,
    violations,
    counts,
    checked: { activities: ctx.acts.length, relationships: ctx.rels.length, groupDays, capacityChecked: opts.checkCapacity },
  };
}

const round2 = (x: number) => Math.round(x * 100) / 100;
