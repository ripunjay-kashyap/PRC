import type { Hires } from '../analysis/demand';
import type { DayNum } from '../model';
import { earliestStart, type Positions } from './context';
import type { PreparedContext } from './cpm';
import type { ProjectOutcome } from './objective';
import type { Transfer } from './transfers';

export interface ActivityShift {
  key: string;
  project: string;
  code: string;
  name: string;
  oldStart: DayNum;
  oldFinish: DayNum;
  newStart: DayNum;
  newFinish: DayNum;
  /** Signed working-day shift of the start (positive = later) */
  shiftDays: number;
  totalFloat: number;
  /** Working days of total float used by the shift (0..shift) */
  floatConsumed: number;
  /** Working days of shift beyond the activity's float (pushes the project end unless absorbed) */
  beyondFloat: number;
  critical: boolean;
  reason: string;
}

export interface HirePlan {
  groupId: string;
  groupName: string;
  start: DayNum;
  /** Last day (inclusive) */
  end: DayNum;
  days: number;
  peakUnits: number;
  unitDays: number;
  cost: number | null;
}

export interface DeadlineImpact {
  project: string;
  deadline: DayNum | null;
  baselineFinish: DayNum;
  newFinish: DayNum;
  baselineDelayDays: number;
  newDelayDays: number;
  /** Working days the finish moved (positive = later) */
  finishChangeDays: number;
  /** Delay that is unavoidable from logic alone (resource-unconstrained CPM) */
  minUnavoidableDelayDays: number;
}

export interface Recommendations {
  shifts: ActivityShift[];
  transfers: Transfer[];
  hires: HirePlan[];
  deadlines: DeadlineImpact[];
}

export function buildRecommendations(
  ctx: PreparedContext,
  base: Positions,
  next: Positions & { hires: Hires },
  baseOutcomes: ProjectOutcome[],
  nextOutcomes: ProjectOutcome[],
  transfers: Transfer[],
): Recommendations {
  const shifts: ActivityShift[] = [];
  ctx.acts.forEach((a, i) => {
    if (a.fixed || (next.start[i] === base.start[i] && next.finish[i] === base.finish[i])) return;
    const s0 = base.start[i];
    const s1 = next.start[i];
    const shiftDays = s1 >= s0 ? a.cal.countWorkdays(s0, s1) : -a.cal.countWorkdays(s1, s0);
    const tf = ctx.cpm.tf[i];
    const floatConsumed = shiftDays > 0 ? Math.min(shiftDays, Math.max(0, tf)) : 0;
    const beyondFloat = shiftDays > 0 ? Math.max(0, shiftDays - Math.max(0, tf)) : 0;
    shifts.push({
      key: a.key,
      project: ctx.projects[a.projectIdx].name,
      code: a.code,
      name: a.name,
      oldStart: s0,
      oldFinish: base.finish[i],
      newStart: s1,
      newFinish: next.finish[i],
      shiftDays,
      totalFloat: tf,
      floatConsumed,
      beyondFloat,
      critical: tf <= 0,
      reason: shiftReason(ctx, i, base, next, shiftDays),
    });
  });
  shifts.sort((x, y) => Math.abs(y.shiftDays) - Math.abs(x.shiftDays) || x.project.localeCompare(y.project) || x.code.localeCompare(y.code));

  const hires: HirePlan[] = [];
  for (const g of ctx.groups) {
    const per = next.hires[g.id];
    if (!per) continue;
    const days = Object.keys(per).map(Number).sort((x, y) => x - y);
    let cur: HirePlan | null = null;
    let prevDay = -Infinity;
    for (const d of days) {
      const u = per[d];
      const contiguous = cur && ctx.portfolioCal.countWorkdays(prevDay + 1, d) === 0;
      if (!cur || !contiguous) {
        cur = { groupId: g.id, groupName: g.name, start: d, end: d, days: 0, peakUnits: 0, unitDays: 0, cost: 0 };
        hires.push(cur);
      }
      cur.end = d;
      cur.days++;
      cur.peakUnits = Math.max(cur.peakUnits, u);
      cur.unitDays = round2(cur.unitDays + u);
      prevDay = d;
    }
    for (const h of hires.filter((x) => x.groupId === g.id)) h.cost = g.hireCostPerUnitDay !== null ? round2(h.unitDays * g.hireCostPerUnitDay) : null;
  }

  const deadlines: DeadlineImpact[] = ctx.projects.map((p, pi) => {
    const b = baseOutcomes[pi];
    const n = nextOutcomes[pi];
    const change = n.finish >= b.finish ? ctx.portfolioCal.countWorkdays(b.finish, n.finish) : -ctx.portfolioCal.countWorkdays(n.finish, b.finish);
    const logicFinish = ctx.cpm.projectFinish[pi];
    return {
      project: p.name,
      deadline: p.deadline,
      baselineFinish: b.finish,
      newFinish: n.finish,
      baselineDelayDays: b.delayDays,
      newDelayDays: n.delayDays,
      finishChangeDays: change,
      minUnavoidableDelayDays: p.deadline !== null && logicFinish > p.deadline ? ctx.portfolioCal.countWorkdays(p.deadline, logicFinish) : 0,
    };
  });
  return { shifts, transfers, hires, deadlines };
}

/** Deterministic explanation of why an activity moved. */
function shiftReason(ctx: PreparedContext, i: number, base: Positions, next: Positions, shiftDays: number): string {
  if (shiftDays < 0) return 'Started earlier: logic and resources allow it (schedule compression).';
  const es = earliestStart(ctx, i, next);
  const a = ctx.acts[i];
  if (es >= next.start[i] && es > base.start[i]) {
    // pushed by logic: find the driving predecessor that moved
    const drivers = ctx.predRels[i]
      .map((r) => ctx.rels[r].pred)
      .filter((p) => next.finish[p] > base.finish[p] || next.start[p] > base.start[p])
      .map((p) => ctx.acts[p].code);
    if (drivers.length) return `Follows its delayed predecessor${drivers.length > 1 ? 's' : ''} ${drivers.join(', ')}.`;
    if (es > base.start[i] && a.minStart > base.start[i]) return 'Cannot start before the data date.';
  }
  const groups = a.demands.filter((d) => ctx.groups[d.g].leveled).map((d) => `${ctx.groups[d.g].name} (${round2(d.units)}/day, capacity ${ctx.groups[d.g].capacity})`);
  if (groups.length) return `Waits for ${groups.join(', ')} to become available.`;
  return 'Moved by leveling of related activities.';
}

const round2 = (x: number) => Math.round(x * 100) / 100;
