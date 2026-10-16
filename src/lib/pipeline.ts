import { analyzeConflicts, type GroupConflicts } from './analysis/conflicts';
import { compareProjects, type ComparisonResult } from './analysis/comparison';
import { computeDemand } from './analysis/demand';
import type { DataIssue, DayNum, PortfolioModel } from './model';
import type { ResourceGroup, Settings } from './settings';
import { prepareContext, type PreparedContext } from './scheduling/cpm';
import { runScenarios, type DemandSeries, type RunOptions, type ScenarioResult } from './scheduling/scenarios';

/** Serializable per-activity info (index-aligned with scenario start/finish arrays). */
export interface ActivityInfo {
  key: string;
  code: string;
  name: string;
  projectIdx: number;
  projectName: string;
  durationDays: number;
  kind: string;
  status: string;
  fixed: boolean;
  baselineStart: DayNum;
  baselineFinish: DayNum;
  es: DayNum;
  ef: DayNum;
  ls: DayNum;
  lf: DayNum;
  totalFloat: number;
  demands: { groupId: string; units: number }[];
}

export interface GroupInfo {
  id: string;
  name: string;
  type: string;
  capacity: number | null;
  leveled: boolean;
  costPerUnitDay: number | null;
  hireCostPerUnitDay: number | null;
}

export interface ProjectInfo {
  key: string;
  name: string;
  dataDate: DayNum;
  deadline: DayNum | null;
  weight: number;
  baselineFromCpm: boolean;
  logicFinish: DayNum;
}

export interface PortfolioAnalysis {
  activities: ActivityInfo[];
  projects: ProjectInfo[];
  groups: GroupInfo[];
  comparison: ComparisonResult;
  baselineDemand: DemandSeries[];
  conflicts: GroupConflicts[];
  issues: DataIssue[];
  /** Working days of the portfolio calendar between the earliest and latest dates, for chart axes */
  hasResources: boolean;
}

export function describeContext(ctx: PreparedContext): Pick<PortfolioAnalysis, 'activities' | 'projects' | 'groups'> {
  return {
    activities: ctx.acts.map((a, i) => ({
      key: a.key,
      code: a.code,
      name: a.name,
      projectIdx: a.projectIdx,
      projectName: ctx.projects[a.projectIdx].name,
      durationDays: a.durationDays,
      kind: a.kind,
      status: a.status,
      fixed: a.fixed,
      baselineStart: ctx.baseline.start[i],
      baselineFinish: ctx.baseline.finish[i],
      es: ctx.cpm.es[i],
      ef: ctx.cpm.ef[i],
      ls: ctx.cpm.ls[i],
      lf: ctx.cpm.lf[i],
      totalFloat: ctx.cpm.tf[i],
      demands: a.demands.map((d) => ({ groupId: ctx.groups[d.g].id, units: d.units })),
    })),
    projects: ctx.projects.map((p, pi) => ({
      key: p.key,
      name: p.name,
      dataDate: p.dataDate,
      deadline: p.deadline,
      weight: p.weight,
      baselineFromCpm: p.baselineFromCpm,
      logicFinish: ctx.cpm.projectFinish[pi],
    })),
    groups: ctx.groups.map((g) => ({
      id: g.id,
      name: g.name,
      type: g.type,
      capacity: g.capacity,
      leveled: g.leveled,
      costPerUnitDay: g.costPerUnitDay,
      hireCostPerUnitDay: g.hireCostPerUnitDay,
    })),
  };
}

/** Comparison and baseline conflict analysis (fast; runs on the main thread). */
export function analyzePortfolio(model: PortfolioModel, groups: ResourceGroup[], settings: Settings): PortfolioAnalysis {
  const ctx = prepareContext(model, groups, settings);
  const demand = computeDemand(ctx, ctx.baseline);
  const conflicts = analyzeConflicts(ctx, demand, { tf: ctx.cpm.tf, underutilizationThreshold: settings.underutilizationThreshold });
  return {
    ...describeContext(ctx),
    comparison: compareProjects(model, ctx),
    baselineDemand: demand.map(({ contributors: _c, ...rest }) => rest),
    conflicts,
    issues: [...model.issues, ...ctx.issues],
    hasResources: model.assignments.length > 0,
  };
}

export interface OptimizationOutput {
  scenarios: ScenarioResult[];
  activities: ActivityInfo[];
  projects: ProjectInfo[];
  groups: GroupInfo[];
  issues: DataIssue[];
  totalRuntimeMs: number;
  /** Hash of the inputs, so the UI can tell when results are stale */
  inputSignature: string;
}

/** All six scenarios (the heavy part; runs in a Web Worker in the app). */
export function runOptimization(model: PortfolioModel, groups: ResourceGroup[], settings: Settings, opts: RunOptions = {}): OptimizationOutput {
  const t0 = typeof performance !== 'undefined' ? performance.now() : Date.now();
  const ctx = prepareContext(model, groups, settings);
  const scenarios = runScenarios(ctx, settings, opts);
  const t1 = typeof performance !== 'undefined' ? performance.now() : Date.now();
  return {
    scenarios,
    ...describeContext(ctx),
    issues: ctx.issues,
    totalRuntimeMs: Math.round((t1 - t0) * 10) / 10,
    inputSignature: inputSignature(model, groups, settings),
  };
}

/** Cheap deterministic signature of the optimisation inputs. */
export function inputSignature(model: PortfolioModel, groups: ResourceGroup[], settings: Settings): string {
  const s = JSON.stringify([
    model.files.map((f) => f.fileName),
    model.activities.length,
    model.assignments.length,
    model.assignments.reduce((sum, a) => sum + a.unitsPerDay, 0),
    groups.map((g) => [g.id, g.memberKeys, g.capacity, g.costPerUnitDay, g.mobilizationDays, g.transferCostPerUnit, g.hireCostPerUnitDay, g.maxHire]),
    settings,
  ]);
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(16);
}
