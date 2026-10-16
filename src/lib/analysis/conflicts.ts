import type { DayNum } from '../model';
import type { Context } from '../scheduling/context';
import type { GroupDemand } from './demand';

export interface OverPeriod {
  start: DayNum;
  /** Last day of the period (inclusive) */
  end: DayNum;
  days: number;
  peakDemand: number;
  peakExcess: number;
  excessUnitDays: number;
  projects: string[];
  activities: string[];
  critical: boolean;
  criticalActivities: string[];
}

export interface LowPeriod {
  start: DayNum;
  end: DayNum;
  days: number;
  kind: 'idle' | 'under';
  avgUtilizationPct: number;
}

export interface GroupConflicts {
  groupId: string;
  name: string;
  capacity: number | null;
  leveled: boolean;
  peakDemand: number;
  /** Largest daily excess over capacity (+ hired units) */
  peakOver: number;
  overDays: number;
  overUnitDays: number;
  utilizationPct: number | null;
  idleUnitDays: number;
  activeDays: number;
  overPeriods: OverPeriod[];
  lowPeriods: LowPeriod[];
  criticalOverDays: number;
}

const EPS = 1e-9;

export interface ConflictOptions {
  /** Total float per activity (working days); activities with tf <= 0 are critical */
  tf?: number[];
  underutilizationThreshold?: number;
}

/** Over-allocation, utilisation and idle analysis for one resource group's daily demand. */
export function analyzeGroup(ctx: Pick<Context, 'acts' | 'projects'>, gd: GroupDemand, opts: ConflictOptions = {}): GroupConflicts {
  const threshold = opts.underutilizationThreshold ?? 0.5;
  const cap = gd.capacity;
  const out: GroupConflicts = {
    groupId: gd.groupId,
    name: gd.name,
    capacity: cap,
    leveled: gd.leveled,
    peakDemand: gd.total.reduce((m, v) => Math.max(m, v), 0),
    peakOver: 0,
    overDays: 0,
    overUnitDays: 0,
    utilizationPct: null,
    idleUnitDays: 0,
    activeDays: 0,
    overPeriods: [],
    lowPeriods: [],
    criticalOverDays: 0,
  };
  const first = gd.total.findIndex((v) => v > EPS);
  if (first < 0) return out;
  let last = gd.total.length - 1;
  while (last > first && gd.total[last] <= EPS) last--;
  out.activeDays = last - first + 1;
  if (cap === null) return out;

  let used = 0;
  let current: OverPeriod | null = null;
  let low: LowPeriod | null = null;
  let lowSum = 0;
  const isCritical = (i: number) => opts.tf !== undefined && opts.tf[i] <= 0;
  const closeLow = () => {
    if (low) {
      low.avgUtilizationPct = cap > 0 ? round1((lowSum / low.days / cap) * 100) : 0;
      out.lowPeriods.push(low);
      low = null;
      lowSum = 0;
    }
  };
  for (let k = first; k <= last; k++) {
    const day = gd.days[k];
    const demand = gd.total[k];
    const avail = cap + (gd.hired[k] ?? 0);
    const excess = demand - avail;
    used += Math.min(demand, cap);
    out.idleUnitDays += Math.max(0, cap - demand);
    if (excess > EPS) {
      closeLow();
      out.overDays++;
      out.overUnitDays += excess;
      out.peakOver = Math.max(out.peakOver, excess);
      const acts = gd.contributors[k];
      const crit = acts.filter(isCritical);
      if (crit.length) out.criticalOverDays++;
      if (!current) {
        current = { start: day, end: day, days: 0, peakDemand: 0, peakExcess: 0, excessUnitDays: 0, projects: [], activities: [], critical: false, criticalActivities: [] };
        out.overPeriods.push(current);
      }
      current.end = day;
      current.days++;
      current.peakDemand = Math.max(current.peakDemand, demand);
      current.peakExcess = Math.max(current.peakExcess, excess);
      current.excessUnitDays += excess;
      for (const i of acts) {
        const a = ctx.acts[i];
        const pname = ctx.projects[a.projectIdx].name;
        if (!current.projects.includes(pname)) current.projects.push(pname);
        if (!current.activities.includes(`${pname}: ${a.code}`)) current.activities.push(`${pname}: ${a.code}`);
        if (isCritical(i) && !current.criticalActivities.includes(`${pname}: ${a.code}`)) {
          current.criticalActivities.push(`${pname}: ${a.code}`);
          current.critical = true;
        }
      }
    } else {
      current = null;
      const util = cap > 0 ? demand / cap : 1;
      const kind: LowPeriod['kind'] | null = demand <= EPS ? 'idle' : util < threshold ? 'under' : null;
      if (kind && low && low.kind === kind) {
        low.end = day;
        low.days++;
        lowSum += demand;
      } else {
        closeLow();
        if (kind) {
          low = { start: day, end: day, days: 1, kind, avgUtilizationPct: 0 };
          lowSum = demand;
        }
      }
    }
  }
  closeLow();
  out.utilizationPct = cap > 0 ? round1((used / (cap * out.activeDays)) * 100) : null;
  out.overUnitDays = round2(out.overUnitDays);
  out.idleUnitDays = round2(out.idleUnitDays);
  out.peakOver = round2(out.peakOver);
  for (const p of out.overPeriods) p.excessUnitDays = round2(p.excessUnitDays);
  return out;
}

export function analyzeConflicts(ctx: Pick<Context, 'acts' | 'projects'>, demand: GroupDemand[], opts: ConflictOptions = {}): GroupConflicts[] {
  return demand.map((gd) => analyzeGroup(ctx, gd, opts));
}

const round1 = (x: number) => Math.round(x * 10) / 10;
const round2 = (x: number) => Math.round(x * 100) / 100;
