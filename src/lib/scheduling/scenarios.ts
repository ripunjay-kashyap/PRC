import { computeDemand, shortageHires, type GroupDemand, type Hires } from '../analysis/demand';
import type { GroupConflicts } from '../analysis/conflicts';
import type { Settings } from '../settings';
import type { Positions } from './context';
import type { PreparedContext } from './cpm';
import { evaluateSchedule, type Evaluation, type ScenarioMetrics } from './objective';
import { buildRecommendations, type Recommendations } from './recommendations';
import { justify, PRIORITY_RULES, serialSgs, type PriorityRule, type Schedule, type SgsOptions } from './sgs';
import { validateSchedule, type ValidationResult } from './validator';

export type ScenarioId = 'baseline' | 'project_leveling' | 'pooled_original' | 'pooled_float' | 'cost_priority' | 'deadline_priority';

export const SCENARIO_INFO: Record<ScenarioId, { name: string; short: string; description: string }> = {
  baseline: {
    name: '1. Baseline (original P6 dates)',
    short: 'Baseline',
    description: 'Original P6 dates (CPM dates for unscheduled projects). No leveling, no hiring; over-allocation against the pooled capacity is reported as-is.',
  },
  project_leveling: {
    name: '2. Leveling within each project',
    short: 'Per-project',
    description: 'Each project is leveled on its own against a dedicated share of each resource (default: proportional to baseline demand). No sharing or transfers between projects.',
  },
  pooled_original: {
    name: '3. Pooled resources, original dates',
    short: 'Pooled, fixed dates',
    description: 'Resources are pooled across projects but every activity keeps its original dates; the remaining shortages are shown as units that would have to be hired.',
  },
  pooled_float: {
    name: '4. Pooled, flexible starts within float',
    short: 'Pooled within float',
    description: 'Pooled resources; activities may move only within their total float so no project end moves. Shortages that cannot be absorbed within float are hired.',
  },
  cost_priority: {
    name: '5. Cost priority',
    short: 'Cost priority',
    description: 'Pooled resources, no hiring (except units a single activity needs beyond total capacity). Activities are delayed as needed; the plan with the lowest cost C is chosen (then lowest Z).',
  },
  deadline_priority: {
    name: '6. Deadline priority',
    short: 'Deadline priority',
    description: 'Pooled resources; extra units are hired whenever waiting for resources would breach a project deadline. The plan with the least deadline delay D is chosen (then lowest Z).',
  },
};

export interface CandidateSummary {
  rule: PriorityRule;
  justified: boolean;
  Z: number;
  C: number;
  D: number;
  valid: boolean;
}

/** Demand series without per-day contributor lists (compact, serialisable) */
export type DemandSeries = Omit<GroupDemand, 'contributors'>;

export interface ScenarioResult {
  id: ScenarioId;
  name: string;
  description: string;
  rule: PriorityRule | null;
  justified: boolean;
  candidates: CandidateSummary[];
  start: number[];
  finish: number[];
  hires: Hires;
  metrics: ScenarioMetrics;
  validation: ValidationResult;
  /** All hard constraints satisfied (capacity checked only for scenarios that enforce it) */
  feasible: boolean;
  enforcesCapacity: boolean;
  notes: string[];
  recommendations: Recommendations;
  demand: DemandSeries[];
  conflicts: GroupConflicts[];
}

const compact = (d: GroupDemand[]): DemandSeries[] => d.map(({ contributors: _c, ...rest }) => rest);

/** Default scenario-2 shares: capacity split in proportion to each project's baseline demand. */
export function computeShares(ctx: PreparedContext, settings: Settings): number[][] {
  const demand = computeDemand(ctx, ctx.baseline);
  return ctx.groups.map((g, gi) => {
    const user = settings.shares[g.id];
    if (user && ctx.projects.every((p) => typeof user[p.key] === 'number')) return ctx.projects.map((p) => user[p.key]);
    const cap = g.capacity ?? 0;
    const totals = ctx.projects.map((_, pi) => demand[gi].byProject[pi].reduce((s, v) => s + v, 0));
    const sum = totals.reduce((s, v) => s + v, 0);
    if (sum === 0) return ctx.projects.map(() => (ctx.projects.length ? cap / ctx.projects.length : 0));
    const exact = totals.map((t) => (cap * t) / sum);
    if (!Number.isInteger(cap)) return exact.map((x) => Math.round(x * 100) / 100);
    // Largest remainder; every project with demand gets at least one unit when capacity allows.
    const shares = exact.map(Math.floor);
    let left = cap - shares.reduce((s, v) => s + v, 0);
    const order = exact.map((x, i) => [x - Math.floor(x), i] as const).sort((a, b) => b[0] - a[0]);
    for (const [, i] of order) {
      if (left <= 0) break;
      shares[i]++;
      left--;
    }
    for (let i = 0; i < shares.length; i++) {
      if (totals[i] > 0 && shares[i] === 0) {
        const donor = shares.indexOf(Math.max(...shares));
        if (shares[donor] > 1) {
          shares[donor]--;
          shares[i]++;
        }
      }
    }
    return shares;
  });
}

interface Built {
  sched: Schedule;
  evaluation: Evaluation;
  validation: ValidationResult;
  forced: number[];
}

function finish(
  ctx: PreparedContext,
  id: ScenarioId,
  base: Evaluation,
  built: Built,
  extra: { rule: PriorityRule | null; justified: boolean; candidates: CandidateSummary[]; enforcesCapacity: boolean; notes: string[]; runtimeMs: number },
): ScenarioResult {
  const { sched, evaluation, validation } = built;
  evaluation.metrics.runtimeMs = Math.round(extra.runtimeMs * 10) / 10;
  evaluation.metrics.constraintViolations = Object.values(validation.counts).reduce((s, c) => s + c, 0);
  const notes = [...extra.notes];
  if (built.forced.length) {
    notes.push(`${built.forced.length} activities could not be placed within ${10} years of scanning and were forced to their earliest start (see violations).`);
  }
  const info = SCENARIO_INFO[id];
  return {
    id,
    name: info.name,
    description: info.description,
    rule: extra.rule,
    justified: extra.justified,
    candidates: extra.candidates,
    start: sched.start,
    finish: sched.finish,
    hires: sched.hires,
    metrics: evaluation.metrics,
    validation,
    feasible: validation.ok && built.forced.length === 0,
    enforcesCapacity: extra.enforcesCapacity,
    notes,
    recommendations: buildRecommendations(ctx, ctx.baseline, sched, base.metrics.projects, evaluation.metrics.projects, evaluation.transfers),
    demand: compact(evaluation.demand),
    conflicts: evaluation.conflicts,
  };
}

function evaluate(ctx: PreparedContext, settings: Settings, pos: Positions, hires: Hires, countTransfers: boolean): Evaluation {
  return evaluateSchedule(ctx, pos, hires, {
    weights: settings.weights,
    underutilizationThreshold: settings.underutilizationThreshold,
    countTransfers,
  });
}

function build(ctx: PreparedContext, settings: Settings, sched: Schedule, checkCapacity: boolean, countTransfers: boolean, forced: number[] = []): Built {
  return {
    sched,
    evaluation: evaluate(ctx, settings, sched, sched.hires, countTransfers),
    validation: validateSchedule(ctx, sched, { checkCapacity, fixedRef: ctx.baseline }),
    forced,
  };
}

type RankFn = (b: Built) => number[];

const lexLess = (a: number[], b: number[]) => {
  for (let k = 0; k < Math.max(a.length, b.length); k++) {
    const x = a[k] ?? 0;
    const y = b[k] ?? 0;
    if (Math.abs(x - y) > 1e-6) return x < y;
  }
  return false;
};

const violations = (b: Built) => Object.values(b.validation.counts).reduce((s, c) => s + c, 0) + b.forced.length;

/** Run the SGS with every priority rule, apply justification, keep the best by `rank`. */
function optimize(ctx: PreparedContext, settings: Settings, opts: Omit<SgsOptions, 'rule'>, rank: RankFn, countTransfers: boolean) {
  const t0 = now();
  const candidates: CandidateSummary[] = [];
  let best: { built: Built; rule: PriorityRule; justified: boolean } | null = null;
  for (const rule of PRIORITY_RULES) {
    const o: SgsOptions = { ...opts, rule };
    const raw = serialSgs(ctx, o);
    const b1 = build(ctx, settings, raw, true, countTransfers, raw.forced);
    const j = justify(ctx, raw, o);
    const b2 = build(ctx, settings, j, true, countTransfers, raw.forced);
    const useJ = violations(b2) <= violations(b1) && !lexLess(rank(b1), rank(b2));
    const chosen = useJ ? b2 : b1;
    for (const [b, justified] of [[b1, false], [b2, true]] as const) {
      const m = b.evaluation.metrics.objective;
      candidates.push({ rule, justified, Z: m.Z, C: m.C, D: m.D, valid: violations(b) === 0 });
    }
    if (!best || lexLess([violations(chosen), ...rank(chosen)], [violations(best.built), ...rank(best.built)])) {
      best = { built: chosen, rule, justified: useJ };
    }
  }
  return { ...best!, candidates, runtimeMs: now() - t0 };
}

const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

export interface RunOptions {
  /** Restrict which scenarios run (default: all six) */
  only?: ScenarioId[];
}

/** Evaluate all six scenarios against the same hard constraints. */
export function runScenarios(ctx: PreparedContext, settings: Settings, opts: RunOptions = {}): ScenarioResult[] {
  const want = (id: ScenarioId) => !opts.only || opts.only.includes(id);
  const out: ScenarioResult[] = [];
  const noHires: Hires = {};

  // 1. Baseline
  let t0 = now();
  const baseBuilt = build(ctx, settings, { ...ctx.baseline, hires: noHires }, false, true);
  const base = baseBuilt.evaluation;
  const leveledGroups = ctx.groups.filter((g) => g.leveled).length;
  const commonNotes = leveledGroups === 0 ? ['No resource group has both demand and a known capacity: nothing can be leveled. Import assignments and enter capacities first.'] : [];
  if (want('baseline')) {
    const notes = [...commonNotes];
    if (ctx.projects.some((p) => p.baselineFromCpm)) notes.push('Projects without P6-calculated dates use CPM early dates from their data date.');
    if (base.metrics.overUnitDays > 0) notes.push(`Over-allocated by ${base.metrics.overUnitDays} unit-days in total against the pooled capacity (not leveled).`);
    out.push(finish(ctx, 'baseline', base, baseBuilt, { rule: null, justified: false, candidates: [], enforcesCapacity: false, notes, runtimeMs: now() - t0 }));
  }

  // 2. Leveling within each project
  if (want('project_leveling')) {
    const shares = computeShares(ctx, settings);
    const notes = [...commonNotes, 'Shares (units per project): ' + ctx.groups.filter((g) => g.leveled).map((g) => `${g.name} ${shares[ctx.groups.indexOf(g)].map((s, pi) => `${ctx.projects[pi].name}=${s}`).join(', ')}`).join('; ')];
    ctx.groups.forEach((g, gi) => {
      if (g.leveled && g.capacity !== null && shares[gi].reduce((s, v) => s + v, 0) > g.capacity + 1e-9) {
        notes.push(`${g.name}: project shares add up to more than the pooled capacity (${g.capacity}).`);
      }
    });
    const r = optimize(ctx, settings, { mode: 'project', shares, window: 'none', hire: 'unavoidable' }, (b) => [b.evaluation.metrics.objective.Z], false);
    out.push(finish(ctx, 'project_leveling', base, r.built, { rule: r.rule, justified: r.justified, candidates: r.candidates, enforcesCapacity: true, notes, runtimeMs: r.runtimeMs }));
  }

  // 3. Pooled, original dates
  if (want('pooled_original')) {
    t0 = now();
    const hires = shortageHires(ctx, ctx.baseline);
    const built = build(ctx, settings, { ...ctx.baseline, hires }, true, true);
    const notes = [...commonNotes];
    const over = ctx.groups.filter((g) => hires[g.id] && Object.values(hires[g.id]).some((u) => u > g.maxHire));
    if (over.length) notes.push(`Shortage exceeds the hire limit for: ${over.map((g) => g.name).join(', ')}.`);
    out.push(finish(ctx, 'pooled_original', base, built, { rule: null, justified: false, candidates: [], enforcesCapacity: true, notes, runtimeMs: now() - t0 }));
  }

  // 4. Pooled, flexible within float
  if (want('pooled_float')) {
    const r = optimize(ctx, settings, { mode: 'pooled', window: 'float', hire: 'window' }, (b) => [b.evaluation.metrics.objective.Z], true);
    out.push(finish(ctx, 'pooled_float', base, r.built, { rule: r.rule, justified: r.justified, candidates: r.candidates, enforcesCapacity: true, notes: [...commonNotes], runtimeMs: r.runtimeMs }));
  }

  // 5. Cost priority
  if (want('cost_priority')) {
    const r = optimize(ctx, settings, { mode: 'pooled', window: 'none', hire: 'unavoidable' }, (b) => [b.evaluation.metrics.objective.C, b.evaluation.metrics.objective.Z], true);
    out.push(finish(ctx, 'cost_priority', base, r.built, { rule: r.rule, justified: r.justified, candidates: r.candidates, enforcesCapacity: true, notes: [...commonNotes], runtimeMs: r.runtimeMs }));
  }

  // 6. Deadline priority
  if (want('deadline_priority')) {
    const notes = [...commonNotes];
    const noDeadline = ctx.projects.filter((p) => p.deadline === null).map((p) => p.name);
    if (noDeadline.length) notes.push(`No deadline set for ${noDeadline.join(', ')}: those projects are leveled by delay (no hiring) until a deadline is entered.`);
    const r = optimize(ctx, settings, { mode: 'pooled', window: 'deadline', hire: 'window' }, (b) => [b.evaluation.metrics.objective.D, b.evaluation.metrics.objective.Z], true);
    const unmet = r.built.evaluation.metrics.projects.filter((p) => p.delayDays > 0);
    for (const p of unmet) {
      const pi = ctx.projects.findIndex((x) => x.key === p.key);
      const logic = ctx.cpm.projectFinish[pi];
      const minDelay = p.deadline !== null && logic > p.deadline ? ctx.portfolioCal.countWorkdays(p.deadline, logic) : 0;
      notes.push(`${p.name} misses its deadline by ${p.delayDays} working days${minDelay > 0 ? ` (at least ${minDelay} are unavoidable from logic alone)` : ' (hire limit reached)'}.`);
    }
    out.push(finish(ctx, 'deadline_priority', base, r.built, { rule: r.rule, justified: r.justified, candidates: r.candidates, enforcesCapacity: true, notes, runtimeMs: r.runtimeMs }));
  }
  return out;
}
