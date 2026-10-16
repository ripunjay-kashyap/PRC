import { WorkCalendar } from '../calendar';
import type { Activity, DataIssue, DayNum, PortfolioModel, RelType } from '../model';
import type { ResourceGroup, Settings } from '../settings';
import { groupIndex } from '../resources/matching';

export interface Demand {
  /** Group index into Context.groups */
  g: number;
  units: number;
}

export interface SchedActivity {
  idx: number;
  key: string;
  code: string;
  name: string;
  projectIdx: number;
  kind: Activity['kind'];
  status: Activity['status'];
  durationDays: number;
  cal: WorkCalendar;
  /** Not movable (completed, in progress, level of effort) */
  fixed: boolean;
  /** Lower bound on the start: the project's data date */
  minStart: DayNum;
  demands: Demand[];
}

export interface SchedRel {
  pred: number;
  succ: number;
  type: RelType;
  lag: number;
}

export interface SchedGroup {
  id: string;
  name: string;
  type: ResourceGroup['type'];
  /** null = unknown capacity → not leveled */
  capacity: number | null;
  /** Leveled by the optimizer (capacity known and type included) */
  leveled: boolean;
  costPerUnitDay: number | null;
  hireCostPerUnitDay: number | null;
  maxHire: number;
  mobilizationDays: number;
  transferCostPerUnit: number;
}

export interface SchedProject {
  key: string;
  name: string;
  dataDate: DayNum;
  deadline: DayNum | null;
  weight: number;
  /** Baseline came from the app's CPM because P6 dates were missing */
  baselineFromCpm: boolean;
}

export interface Positions {
  start: number[];
  finish: number[];
}

export interface Context {
  acts: SchedActivity[];
  rels: SchedRel[];
  predRels: number[][];
  succRels: number[][];
  topo: number[];
  groups: SchedGroup[];
  projects: SchedProject[];
  baseline: Positions;
  /** Calendar used for portfolio-level daily series (first project's calendar) */
  portfolioCal: WorkCalendar;
  issues: DataIssue[];
  hasCycle: boolean;
}

/** Earliest start boundary allowed by predecessors already placed in `pos`. */
export function earliestStart(ctx: Context, i: number, pos: Positions, placed?: (j: number) => boolean): number {
  const a = ctx.acts[i];
  const cal = a.cal;
  let lbS = a.minStart;
  let lbF = -Infinity;
  for (const r of ctx.predRels[i]) {
    const rel = ctx.rels[r];
    if (placed && !placed(rel.pred)) continue;
    const ps = pos.start[rel.pred];
    const pf = pos.finish[rel.pred];
    switch (rel.type) {
      case 'FS':
        lbS = Math.max(lbS, cal.shift(pf, rel.lag));
        break;
      case 'SS':
        lbS = Math.max(lbS, cal.shift(ps, rel.lag));
        break;
      case 'FF':
        lbF = Math.max(lbF, cal.shift(pf, rel.lag));
        break;
      case 'SF':
        lbF = Math.max(lbF, cal.shift(ps, rel.lag));
        break;
    }
  }
  return startSatisfying(a, lbS, lbF);
}

/** Smallest valid start >= lbS whose finish is >= lbF. */
export function startSatisfying(a: SchedActivity, lbS: number, lbF: number): number {
  const d = a.durationDays;
  const cal = a.cal;
  if (d === 0) {
    const s = a.kind === 'finish_milestone' ? lbS : cal.nextWorkday(lbS);
    return Math.max(s, Number.isFinite(lbF) ? lbF : s);
  }
  let s = cal.nextWorkday(lbS);
  if (Number.isFinite(lbF) && cal.finishFrom(s, d) < lbF) {
    s = Math.max(s, cal.nextWorkday(cal.startFrom(lbF, d)));
    while (cal.finishFrom(s, d) < lbF) s = cal.nextWorkday(s + 1);
  }
  return s;
}

/** Next valid start strictly after s (for scanning). */
export function nextStart(a: SchedActivity, s: number): number {
  return a.durationDays === 0 && a.kind === 'finish_milestone' ? s + 1 : a.cal.nextWorkday(s + 1);
}

/** Previous valid start strictly before s. */
export function prevStart(a: SchedActivity, s: number): number {
  return a.durationDays === 0 && a.kind === 'finish_milestone' ? s - 1 : a.cal.prevWorkday(s - 1);
}

export function finishOf(a: SchedActivity, s: number): number {
  return a.cal.finishFrom(s, a.durationDays);
}

/** Does the relationship hold for the given positions? */
export function relSatisfied(ctx: Context, rel: SchedRel, pos: Positions): boolean {
  const cal = ctx.acts[rel.succ].cal;
  const ps = pos.start[rel.pred];
  const pf = pos.finish[rel.pred];
  const ss = pos.start[rel.succ];
  const sf = pos.finish[rel.succ];
  switch (rel.type) {
    case 'FS':
      return ss >= cal.shift(pf, rel.lag);
    case 'SS':
      return ss >= cal.shift(ps, rel.lag);
    case 'FF':
      return sf >= cal.shift(pf, rel.lag);
    case 'SF':
      return sf >= cal.shift(ps, rel.lag);
  }
}

/** Working days on which an activity consumes resources (from its project's data date). */
export function workDays(ctx: Context, i: number, start: number, finish: number): number[] {
  const a = ctx.acts[i];
  const out: number[] = [];
  const from = Math.max(start, a.minStart);
  for (let d = from; d < finish; d++) if (a.cal.isWorkday(d)) out.push(d);
  return out;
}

export interface BuildOptions {
  model: PortfolioModel;
  groups: ResourceGroup[];
  settings: Settings;
}

/** Build the scheduling context. Baseline/CPM fields are filled by `prepareContext` (cpm.ts). */
export function buildContextSkeleton({ model, groups, settings }: BuildOptions): Omit<Context, 'baseline' | 'topo' | 'hasCycle'> & {
  topo: number[];
  hasCycle: boolean;
} {
  const issues: DataIssue[] = [];
  const calendars = new Map(model.calendars.map((c) => [c.key, new WorkCalendar(c)]));
  const fallbackCal = new WorkCalendar({ key: '__default', dayHours: 8, workWeek: [false, true, true, true, true, true, false], holidays: [], extraWorkdays: [] });
  const projects = model.projects.map((p) => {
    const ps = settings.projects[p.key];
    const dd =
      p.dataDate ??
      Math.min(...model.activities.filter((a) => a.projectKey === p.key).map((a) => a.earlyStart ?? a.targetStart ?? Infinity));
    return {
      key: p.key,
      name: p.displayName,
      dataDate: Number.isFinite(dd) ? dd : 0,
      deadline: ps?.deadline ?? null,
      weight: ps?.priorityWeight ?? 1,
      baselineFromCpm: false,
    } satisfies SchedProject;
  });
  const projIdx = new Map(projects.map((p, i) => [p.key, i]));

  const memberToGroup = groupIndex(groups);
  const schedGroups: SchedGroup[] = groups.map((g) => ({
    id: g.id,
    name: g.name,
    type: g.type,
    capacity: g.capacity,
    leveled: g.capacity !== null && (settings.includeMaterials || g.type !== 'material'),
    costPerUnitDay: g.costPerUnitDay,
    hireCostPerUnitDay: g.hireCostPerUnitDay ?? (g.costPerUnitDay !== null ? g.costPerUnitDay * settings.hirePremium : null),
    maxHire: g.maxHire,
    mobilizationDays: g.mobilizationDays,
    transferCostPerUnit: g.transferCostPerUnit,
  }));
  const gIdx = new Map(schedGroups.map((g, i) => [g.id, i]));
  for (const g of schedGroups) {
    if (g.capacity === null && (settings.includeMaterials || g.type !== 'material')) {
      issues.push({ severity: 'warning', code: 'no_capacity', message: `Resource group "${g.name}" has no capacity: enter one in Optimization Settings. It is shown but not leveled.` });
    }
  }

  const actIdx = new Map<string, number>();
  const acts: SchedActivity[] = [];
  for (const a of model.activities) {
    const pi = projIdx.get(a.projectKey);
    if (pi === undefined) continue;
    const idx = acts.length;
    actIdx.set(a.key, idx);
    const fixed = a.status !== 'not_started' || a.kind === 'level_of_effort' || a.kind === 'wbs_summary';
    acts.push({
      idx,
      key: a.key,
      code: a.code,
      name: a.name,
      projectIdx: pi,
      kind: a.kind,
      status: a.status,
      durationDays: a.durationDays,
      cal: calendars.get(a.calendarKey) ?? fallbackCal,
      fixed,
      minStart: projects[pi].dataDate,
      demands: [],
    });
  }
  // Demands: sum units per group per activity
  for (const asg of model.assignments) {
    const i = actIdx.get(asg.activityKey);
    const gid = memberToGroup.get(asg.resourceKey);
    if (i === undefined || gid === undefined) continue;
    const g = gIdx.get(gid)!;
    if (asg.unitsPerDay <= 0) continue;
    const existing = acts[i].demands.find((d) => d.g === g);
    if (existing) existing.units += asg.unitsPerDay;
    else acts[i].demands.push({ g, units: asg.unitsPerDay });
  }

  const rels: SchedRel[] = [];
  for (const r of model.relationships) {
    const p = actIdx.get(r.predKey);
    const s = actIdx.get(r.succKey);
    if (p === undefined || s === undefined) continue;
    rels.push({ pred: p, succ: s, type: r.type, lag: r.lagDays });
  }
  const predRels: number[][] = acts.map(() => []);
  const succRels: number[][] = acts.map(() => []);
  rels.forEach((r, k) => {
    predRels[r.succ].push(k);
    succRels[r.pred].push(k);
  });

  // Topological order (Kahn). Activities on a cycle are appended and reported.
  const indeg = acts.map((_, i) => predRels[i].length);
  const queue = acts.map((_, i) => i).filter((i) => indeg[i] === 0);
  const topo: number[] = [];
  while (queue.length) {
    const i = queue.shift()!;
    topo.push(i);
    for (const r of succRels[i]) if (--indeg[rels[r].succ] === 0) queue.push(rels[r].succ);
  }
  const hasCycle = topo.length < acts.length;
  if (hasCycle) {
    const onCycle = acts.filter((_, i) => indeg[i] > 0);
    issues.push({ severity: 'error', code: 'logic_cycle', message: `Logic loop detected among: ${onCycle.slice(0, 6).map((a) => a.code).join(', ')}. These activities cannot be scheduled reliably.` });
    for (const a of onCycle) topo.push(a.idx);
  }

  const firstProj = model.projects[0];
  const portfolioCal = (firstProj?.calendarKey && calendars.get(firstProj.calendarKey)) || calendars.values().next().value || fallbackCal;

  return { acts, rels, predRels, succRels, topo, groups: schedGroups, projects, portfolioCal, issues, hasCycle };
}
