import { analyzeConflicts, type GroupConflicts } from '../analysis/conflicts';
import { computeDemand, type GroupDemand, type Hires } from '../analysis/demand';
import type { DayNum } from '../model';
import type { ObjectiveWeights } from '../settings';
import type { Positions } from './context';
import type { PreparedContext } from './cpm';
import { computeTransfers, type Transfer } from './transfers';

export interface ObjectiveBreakdown {
  /** C: resource + transfer + hire cost (known costs only) */
  C: number;
  /** D: Σ project weight × working days of delay past the deadline */
  D: number;
  /** O: unresolved over-allocation, unit-days above capacity + hired units */
  O: number;
  /** U: idle unit-days of leveled groups within their active windows */
  U: number;
  Z: number;
}

export interface ProjectOutcome {
  key: string;
  name: string;
  start: DayNum;
  finish: DayNum;
  durationWorkdays: number;
  deadline: DayNum | null;
  /** Working days past the deadline (0 if met or no deadline) */
  delayDays: number;
}

export interface ScenarioMetrics {
  peakOverallocation: number;
  /** Largest daily demand above base capacity before hiring (what would need hiring) */
  peakShortage: number;
  overUnitDays: number;
  avgUtilizationPct: number | null;
  /** Resource cost of groups with a known cost rate */
  resourceCost: number;
  transferCost: number;
  transfers: number;
  unitsTransferred: number;
  hireCost: number;
  hiredUnitDays: number;
  peakHired: number;
  /** resource + transfer + hire cost (known rates only) */
  totalCost: number;
  /** True when every group with demand (or hires/transfers) has a cost rate */
  costComplete: boolean;
  /** Groups whose cost could not be priced (no rate entered) */
  costMissing: string[];
  projects: ProjectOutcome[];
  deadlineViolations: number;
  deadlineDelayDays: number;
  idleUnitDays: number;
  runtimeMs: number;
  constraintViolations: number;
  objective: ObjectiveBreakdown;
}

export interface Evaluation {
  metrics: ScenarioMetrics;
  demand: GroupDemand[];
  conflicts: GroupConflicts[];
  transfers: Transfer[];
}

/** Z = α·C + β·D + γ·O + δ·U */
export function objectiveZ(parts: Omit<ObjectiveBreakdown, 'Z'>, w: ObjectiveWeights): number {
  return w.alpha * parts.C + w.beta * parts.D + w.gamma * parts.O + w.delta * parts.U;
}

export function projectOutcomes(ctx: PreparedContext, pos: Positions): ProjectOutcome[] {
  return ctx.projects.map((p, pi) => {
    const idx = ctx.acts.filter((a) => a.projectIdx === pi).map((a) => a.idx);
    const start = idx.length ? Math.min(...idx.map((i) => pos.start[i]), p.dataDate) : p.dataDate;
    const finish = idx.length ? Math.max(...idx.map((i) => pos.finish[i])) : p.dataDate;
    const delayDays = p.deadline !== null && finish > p.deadline ? ctx.portfolioCal.countWorkdays(p.deadline, finish) : 0;
    return { key: p.key, name: p.name, start, finish, durationWorkdays: ctx.portfolioCal.countWorkdays(start, finish), deadline: p.deadline, delayDays };
  });
}

export interface EvaluateOptions {
  weights: ObjectiveWeights;
  underutilizationThreshold: number;
  /** Count transfers (false when each project has dedicated resources) */
  countTransfers: boolean;
  runtimeMs?: number;
  constraintViolations?: number;
}

export function evaluateSchedule(ctx: PreparedContext, pos: Positions, hires: Hires, opts: EvaluateOptions): Evaluation {
  const demand = computeDemand(ctx, pos, hires);
  const conflicts = analyzeConflicts(ctx, demand, { tf: ctx.cpm.tf, underutilizationThreshold: opts.underutilizationThreshold });
  const transfers = opts.countTransfers ? computeTransfers(ctx, demand.filter((d) => ctx.groups[d.groupIdx].leveled)) : [];

  let resourceCost = 0;
  let hireCost = 0;
  const costMissing = new Set<string>();
  let hiredUnitDays = 0;
  let peakHired = 0;
  let peakShortage = 0;
  for (const gd of demand) {
    const g = ctx.groups[gd.groupIdx];
    const unitDays = gd.total.reduce((s, v) => s + v, 0);
    if (unitDays > 0) {
      if (g.costPerUnitDay === null) costMissing.add(g.name);
      else resourceCost += unitDays * g.costPerUnitDay;
    }
    if (g.leveled && g.capacity !== null) {
      for (const v of gd.total) peakShortage = Math.max(peakShortage, v - g.capacity);
    }
    const h = Object.values(hires[g.id] ?? {});
    const hud = h.reduce((s, v) => s + v, 0);
    hiredUnitDays += hud;
    peakHired = Math.max(peakHired, ...h, 0);
    if (hud > 0) {
      if (g.hireCostPerUnitDay === null) costMissing.add(g.name);
      else hireCost += hud * g.hireCostPerUnitDay;
    }
  }
  for (const t of transfers) if (t.cost === null) costMissing.add(t.groupName);
  const transferCost = transfers.reduce((s, t) => s + (t.cost ?? 0), 0);
  const leveled = conflicts.filter((c) => c.leveled && c.capacity !== null && c.activeDays > 0);
  const utils = leveled.map((c) => c.utilizationPct).filter((u): u is number => u !== null);
  const O = leveled.reduce((s, c) => s + c.overUnitDays, 0);
  const U = leveled.reduce((s, c) => s + c.idleUnitDays, 0);
  const projects = projectOutcomes(ctx, pos);
  const D = projects.reduce((s, p, pi) => s + ctx.projects[pi].weight * p.delayDays, 0);
  const C = resourceCost + transferCost + hireCost;
  const parts = { C: round2(C), D, O: round2(O), U: round2(U) };
  const metrics: ScenarioMetrics = {
    peakOverallocation: leveled.reduce((m, c) => Math.max(m, c.peakOver), 0),
    peakShortage: round2(Math.max(0, peakShortage)),
    overUnitDays: round2(O),
    avgUtilizationPct: utils.length ? round1(utils.reduce((s, u) => s + u, 0) / utils.length) : null,
    resourceCost: round2(resourceCost),
    transferCost: round2(transferCost),
    transfers: transfers.length,
    unitsTransferred: round2(transfers.reduce((s, t) => s + t.units, 0)),
    hireCost: round2(hireCost),
    hiredUnitDays: round2(hiredUnitDays),
    peakHired: round2(peakHired),
    totalCost: round2(C),
    costComplete: costMissing.size === 0,
    costMissing: [...costMissing].sort(),
    projects,
    deadlineViolations: projects.filter((p) => p.delayDays > 0).length,
    deadlineDelayDays: projects.reduce((s, p) => s + p.delayDays, 0),
    idleUnitDays: round2(U),
    runtimeMs: opts.runtimeMs ?? 0,
    constraintViolations: opts.constraintViolations ?? 0,
    objective: { ...parts, Z: round2(objectiveZ(parts, opts.weights)) },
  };
  return { metrics, demand, conflicts, transfers };
}

const round1 = (x: number) => Math.round(x * 10) / 10;
const round2 = (x: number) => Math.round(x * 100) / 100;
