import type { DayNum, PortfolioModel, ResourceType } from './model';

export type CapacitySource = 'xer' | 'csv' | 'user' | null;

/** A pooled resource: one or more matched resources treated as interchangeable across projects. */
export interface ResourceGroup {
  id: string;
  name: string;
  type: ResourceType;
  memberKeys: string[];
  /** Units available per working day; null = unknown (must be entered by the user) */
  capacity: number | null;
  capacitySource: CapacitySource;
  /** Sum of the known member capacities, shown as a hint when some are unknown */
  capacityHint: number | null;
  costPerUnitDay: number | null;
  costSource: CapacitySource;
  /** Working days lost when a unit moves between projects */
  mobilizationDays: number;
  /** One-off cost per unit transferred between projects */
  transferCostPerUnit: number;
  /** Cost of one extra hired unit for one day; null = cost rate × hire premium */
  hireCostPerUnitDay: number | null;
  /** Upper limit on extra units that may be hired per day (scenarios that allow hiring) */
  maxHire: number;
  confirmed: boolean;
}

export type DeadlineSource = 'plan_end' | 'scd_end' | 'user' | 'none';

export interface ProjectSettings {
  /** Deadline as a finish boundary (work must end before the start of this day); null = none */
  deadline: DayNum | null;
  deadlineSource: DeadlineSource;
  /** Relative importance (higher = scheduled first under the project-priority rule; multiplies delay penalty) */
  priorityWeight: number;
}

export interface ObjectiveWeights {
  /** α — weight on cost C (currency) */
  alpha: number;
  /** β — currency per weighted working day of deadline delay D */
  beta: number;
  /** γ — currency per unit-day of unresolved over-allocation O */
  gamma: number;
  /** δ — currency per idle unit-day U */
  delta: number;
}

export interface Settings {
  weights: ObjectiveWeights;
  projects: Record<string, ProjectSettings>;
  /** Scenario 2 capacity shares: groupId → projectKey → units. Missing = proportional default. */
  shares: Record<string, Record<string, number>>;
  includeMaterials: boolean;
  /** Days with utilisation below this fraction (but > 0) count as under-utilised */
  underutilizationThreshold: number;
  /** Hire cost multiplier applied to the normal cost rate when no hire cost is entered */
  hirePremium: number;
  /** How to baseline a project whose P6 file has no calculated (early) dates */
  unscheduledBaseline: 'cpm' | 'target';
}

export const DEFAULT_WEIGHTS: ObjectiveWeights = { alpha: 1, beta: 10000, gamma: 5000, delta: 100 };

export function defaultProjectSettings(model: PortfolioModel): Record<string, ProjectSettings> {
  const out: Record<string, ProjectSettings> = {};
  for (const p of model.projects) {
    if (p.planEnd !== null) out[p.key] = { deadline: p.planEnd, deadlineSource: 'plan_end', priorityWeight: 1 };
    else if (p.scheduledEnd !== null) out[p.key] = { deadline: p.scheduledEnd, deadlineSource: 'scd_end', priorityWeight: 1 };
    else out[p.key] = { deadline: null, deadlineSource: 'none', priorityWeight: 1 };
  }
  return out;
}

export function defaultSettings(model: PortfolioModel): Settings {
  return {
    weights: { ...DEFAULT_WEIGHTS },
    projects: defaultProjectSettings(model),
    shares: {},
    includeMaterials: false,
    underutilizationThreshold: 0.5,
    hirePremium: 1.5,
    unscheduledBaseline: 'cpm',
  };
}

/** Keep user edits for projects that still exist, add defaults for new ones. */
export function reconcileSettings(model: PortfolioModel, prev: Settings | null): Settings {
  const base = defaultSettings(model);
  if (!prev) return base;
  const projects: Record<string, ProjectSettings> = {};
  for (const p of model.projects) projects[p.key] = prev.projects[p.key] ?? base.projects[p.key];
  return { ...base, ...prev, weights: { ...base.weights, ...prev.weights }, projects };
}

export function hireCost(g: ResourceGroup, s: Settings): number | null {
  if (g.hireCostPerUnitDay !== null) return g.hireCostPerUnitDay;
  return g.costPerUnitDay !== null ? g.costPerUnitDay * s.hirePremium : null;
}
