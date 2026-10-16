import type { Hires } from '../analysis/demand';
import {
  earliestStart,
  finishOf,
  nextStart,
  prevStart,
  relSatisfied,
  workDays,
  type Positions,
} from './context';
import type { PreparedContext } from './cpm';

const EPS = 1e-9;
/** Never scan further than this many days for a resource-feasible slot */
const MAX_SCAN_DAYS = 3650;

export type PriorityRule = 'MIN_TF' | 'LFT' | 'PROJECT_WEIGHT' | 'EST';
export const PRIORITY_RULES: PriorityRule[] = ['MIN_TF', 'LFT', 'PROJECT_WEIGHT', 'EST'];

export const RULE_LABELS: Record<PriorityRule, string> = {
  MIN_TF: 'Minimum total float',
  LFT: 'Latest finish time',
  PROJECT_WEIGHT: 'Project priority weight',
  EST: 'Earliest original start',
};

export interface SgsOptions {
  rule: PriorityRule;
  /** Pooled capacity across projects, or each project limited to its own share */
  mode: 'pooled' | 'project';
  /** [groupIdx][projectIdx] capacity shares (mode 'project') */
  shares?: number[][];
  /**
   * Latest acceptable start before hiring is considered:
   * 'none' = unlimited delay, 'float' = within CPM total float, 'deadline' = still meets the project deadline
   */
  window: 'none' | 'float' | 'deadline';
  /** 'unavoidable' = hire only when a single activity needs more than the capacity; 'window' = hire to stay in the window */
  hire: 'unavoidable' | 'window';
}

export interface Schedule extends Positions {
  hires: Hires;
}

/** Priority value per activity (lower = scheduled first). */
export function priorities(ctx: PreparedContext, rule: PriorityRule): number[] {
  const { cpm } = ctx;
  return ctx.acts.map((a, i) => {
    switch (rule) {
      case 'MIN_TF':
        return cpm.tf[i] * 1e5 + (cpm.lf[i] - 0) / 1e3;
      case 'LFT':
        return cpm.lf[i] * 1e3 + cpm.tf[i];
      case 'PROJECT_WEIGHT':
        return -ctx.projects[a.projectIdx].weight * 1e9 + cpm.lf[i] * 1e3 + cpm.tf[i];
      case 'EST':
        return ctx.baseline.start[i] * 1e3 + cpm.tf[i];
    }
  });
}

/**
 * Mutable resource usage for leveled groups: pooled totals and per-project totals, plus hired
 * units. Only groups with a known capacity that are included in leveling are tracked.
 */
export class ResourceState {
  readonly usage: Map<number, number>[];
  readonly projUsage: Map<number, number>[][];
  readonly hired: Map<number, number>[][];
  constructor(
    private readonly ctx: PreparedContext,
    private readonly opts: Pick<SgsOptions, 'mode' | 'shares'>,
  ) {
    this.usage = ctx.groups.map(() => new Map());
    this.projUsage = ctx.groups.map(() => ctx.projects.map(() => new Map()));
    // hires are tracked per project in 'project' mode, in slot 0 when pooled
    this.hired = ctx.groups.map(() => ctx.projects.map(() => new Map()));
  }

  private capOf(g: number, p: number): number {
    const grp = this.ctx.groups[g];
    if (this.opts.mode === 'project') return this.opts.shares?.[g]?.[p] ?? 0;
    return grp.capacity ?? Infinity;
  }

  private slot(p: number) {
    return this.opts.mode === 'project' ? p : 0;
  }

  /** Units in use against the relevant capacity (pool or project share) */
  private used(g: number, p: number, d: number): number {
    return this.opts.mode === 'project' ? this.projUsage[g][p].get(d) ?? 0 : this.usage[g].get(d) ?? 0;
  }

  add(i: number, days: number[], sign: 1 | -1) {
    const a = this.ctx.acts[i];
    for (const dem of a.demands) {
      if (!this.ctx.groups[dem.g].leveled) continue;
      for (const d of days) {
        this.usage[dem.g].set(d, (this.usage[dem.g].get(d) ?? 0) + sign * dem.units);
        const pu = this.projUsage[dem.g][a.projectIdx];
        pu.set(d, (pu.get(d) ?? 0) + sign * dem.units);
      }
    }
  }

  /** Extra units per group that a single activity needs beyond the capacity (can never fit otherwise). */
  unavoidable(i: number): number[] {
    const a = this.ctx.acts[i];
    const out = this.ctx.groups.map(() => 0);
    for (const dem of a.demands) {
      if (!this.ctx.groups[dem.g].leveled) continue;
      out[dem.g] += Math.max(0, dem.units - this.capOf(dem.g, a.projectIdx));
    }
    return out;
  }

  /**
   * Shortage if activity i ran on `days`: the largest number of extra units needed on any day
   * per group, beyond capacity + already hired units. Returns [maxShortage, totalShortage].
   */
  shortage(i: number, days: number[], allowance: number[]): { max: number; total: number; beyondAllowance: number } {
    const a = this.ctx.acts[i];
    const p = a.projectIdx;
    let max = 0;
    let total = 0;
    let beyond = 0;
    for (const dem of a.demands) {
      if (!this.ctx.groups[dem.g].leveled) continue;
      const cap = this.capOf(dem.g, p);
      const hiredMap = this.hired[dem.g][this.slot(p)];
      for (const d of days) {
        const need = this.used(dem.g, p, d) + dem.units - cap - (hiredMap.get(d) ?? 0);
        if (need > EPS) {
          max = Math.max(max, need);
          total += need;
          beyond = Math.max(beyond, need - allowance[dem.g]);
        }
      }
    }
    return { max, total, beyondAllowance: beyond };
  }

  /** Record hires so that activity i fits on `days` (call before add). */
  hireFor(i: number, days: number[]) {
    const a = this.ctx.acts[i];
    const p = a.projectIdx;
    for (const dem of a.demands) {
      if (!this.ctx.groups[dem.g].leveled) continue;
      const cap = this.capOf(dem.g, p);
      const hiredMap = this.hired[dem.g][this.slot(p)];
      for (const d of days) {
        const need = this.used(dem.g, p, d) + dem.units - cap - (hiredMap.get(d) ?? 0);
        if (need > EPS) hiredMap.set(d, (hiredMap.get(d) ?? 0) + need);
      }
    }
  }

  maxHireOk(i: number, days: number[]): boolean {
    const a = this.ctx.acts[i];
    const p = a.projectIdx;
    for (const dem of a.demands) {
      const grp = this.ctx.groups[dem.g];
      if (!grp.leveled) continue;
      const cap = this.capOf(dem.g, p);
      const hiredMap = this.hired[dem.g][this.slot(p)];
      for (const d of days) {
        const need = this.used(dem.g, p, d) + dem.units - cap;
        if (need - EPS > Math.max(grp.maxHire, (hiredMap.get(d) ?? 0))) return false;
      }
    }
    return true;
  }

  /** Hires actually needed for the current usage (trims hires made unnecessary by later moves). */
  finalHires(): Hires {
    const out: Hires = {};
    this.ctx.groups.forEach((grp, g) => {
      if (!grp.leveled) return;
      const per: Record<number, number> = {};
      if (this.opts.mode === 'project') {
        this.ctx.projects.forEach((_, p) => {
          for (const [d, u] of this.projUsage[g][p]) {
            const ex = u - this.capOf(g, p);
            if (ex > EPS) per[d] = round6((per[d] ?? 0) + ex);
          }
        });
      } else {
        for (const [d, u] of this.usage[g]) {
          const ex = u - (grp.capacity ?? Infinity);
          if (ex > EPS) per[d] = round6(ex);
        }
      }
      if (Object.keys(per).length) out[grp.id] = per;
    });
    return out;
  }
}

const round6 = (x: number) => Math.round(x * 1e6) / 1e6;

export interface SgsResult extends Schedule {
  /** Activities that could not be placed within the scan limit (forced, reported) */
  forced: number[];
}

/** Serial schedule generation scheme with optional hiring. */
export function serialSgs(ctx: PreparedContext, opts: SgsOptions): SgsResult {
  const n = ctx.acts.length;
  const prio = priorities(ctx, opts.rule);
  const state = new ResourceState(ctx, opts);
  const pos: Positions = { start: new Array(n).fill(0), finish: new Array(n).fill(0) };
  const placed = new Array<boolean>(n).fill(false);
  const remainingPreds = ctx.acts.map((_, i) => ctx.predRels[i].length);
  const forced: number[] = [];

  const place = (i: number, s: number) => {
    pos.start[i] = s;
    pos.finish[i] = finishOf(ctx.acts[i], s);
    placed[i] = true;
    for (const r of ctx.succRels[i]) remainingPreds[ctx.rels[r].succ]--;
  };

  // Fixed activities first: they occupy resources and are never moved.
  for (const a of ctx.acts) {
    if (!a.fixed) continue;
    pos.start[a.idx] = ctx.baseline.start[a.idx];
    pos.finish[a.idx] = ctx.baseline.finish[a.idx];
    const days = workDays(ctx, a.idx, pos.start[a.idx], pos.finish[a.idx]);
    state.hireFor(a.idx, days); // over-allocation by work already under way is unavoidable
    state.add(a.idx, days, 1);
    placed[a.idx] = true;
  }
  for (const a of ctx.acts) if (a.fixed) for (const r of ctx.succRels[a.idx]) remainingPreds[ctx.rels[r].succ]--;

  const topoRank = new Array<number>(n);
  ctx.topo.forEach((i, k) => (topoRank[i] = k));
  let eligible = ctx.acts.filter((a) => !a.fixed && remainingPreds[a.idx] <= 0).map((a) => a.idx);
  const pending = new Set(ctx.acts.filter((a) => !a.fixed).map((a) => a.idx));

  while (pending.size > 0) {
    if (eligible.length === 0) {
      // logic loop: release the remaining activity with the lowest topological rank
      eligible = [[...pending].sort((x, y) => topoRank[x] - topoRank[y])[0]];
    }
    eligible.sort((x, y) => prio[x] - prio[y] || topoRank[x] - topoRank[y]);
    const i = eligible.shift()!;
    pending.delete(i);
    const a = ctx.acts[i];
    const es = earliestStart(ctx, i, pos, (j) => placed[j]);
    const levelDemands = a.demands.some((d) => ctx.groups[d.g].leveled);
    if (!levelDemands) {
      place(i, es);
    } else {
      const s = findSlot(ctx, state, i, es, opts, forced);
      const days = workDays(ctx, i, s, finishOf(a, s));
      state.hireFor(i, days);
      state.add(i, days, 1);
      place(i, s);
    }
    for (const r of ctx.succRels[i]) {
      const j = ctx.rels[r].succ;
      if (pending.has(j) && remainingPreds[j] <= 0 && !eligible.includes(j)) eligible.push(j);
    }
  }
  return { ...pos, hires: state.finalHires(), forced };
}

function findSlot(ctx: PreparedContext, state: ResourceState, i: number, es: number, opts: SgsOptions, forced: number[]): number {
  const a = ctx.acts[i];
  const unavoid = state.unavoidable(i);
  const lds =
    opts.window === 'float' ? Math.max(es, ctx.cpm.ls[i]) : opts.window === 'deadline' ? Math.max(es, ctx.deadlineLS[i]) : Infinity;
  const limit = es + MAX_SCAN_DAYS;

  // 1) earliest start within the window that fits capacity (+ unavoidable hires)
  for (let t = es; t <= Math.min(lds, limit); t = nextStart(a, t)) {
    if (state.shortage(i, workDays(ctx, i, t, finishOf(a, t)), unavoid).beyondAllowance <= EPS) return t;
  }
  // 2) hire to stay within the window: least shortage, then earliest
  if (opts.hire === 'window' && Number.isFinite(lds)) {
    let best = -1;
    let bestKey: [number, number] = [Infinity, Infinity];
    for (let t = es; t <= Math.min(lds, limit); t = nextStart(a, t)) {
      const days = workDays(ctx, i, t, finishOf(a, t));
      if (!state.maxHireOk(i, days)) continue;
      const sh = state.shortage(i, days, unavoid);
      if (sh.max < bestKey[0] - EPS || (Math.abs(sh.max - bestKey[0]) <= EPS && sh.total < bestKey[1] - EPS)) {
        best = t;
        bestKey = [sh.max, sh.total];
      }
    }
    if (best >= 0) return best;
  }
  // 3) delay beyond the window until it fits
  const from = Number.isFinite(lds) ? nextStart(a, lds) : es;
  for (let t = Math.max(from, es); t <= limit; t = nextStart(a, t)) {
    if (state.shortage(i, workDays(ctx, i, t, finishOf(a, t)), unavoid).beyondAllowance <= EPS) return t;
  }
  forced.push(i);
  return es;
}

// ---------------------------------------------------------------------------
// Forward–backward improvement (double justification)
// ---------------------------------------------------------------------------

/** Rebuild resource state from positions and hires. */
function stateFrom(ctx: PreparedContext, sched: Schedule, opts: SgsOptions): ResourceState {
  const st = new ResourceState(ctx, opts);
  ctx.acts.forEach((_, i) => {
    const days = workDays(ctx, i, sched.start[i], sched.finish[i]);
    st.hireFor(i, days);
    st.add(i, days, 1);
  });
  return st;
}

/**
 * Right-justify every movable activity (latest feasible start that keeps each project's finish)
 * then left-justify (earliest feasible start). Every move stays resource- and logic-feasible
 * given the other activities' current positions, so the result is feasible whenever the input is.
 * Hired units are frozen during the passes and trimmed afterwards.
 */
export function justify(ctx: PreparedContext, sched: Schedule, opts: SgsOptions): Schedule {
  const pos: Positions = { start: [...sched.start], finish: [...sched.finish] };
  const st = stateFrom(ctx, sched, opts);
  const noAllowance = ctx.groups.map(() => 0);
  const projEnd = ctx.projects.map(() => -Infinity);
  ctx.acts.forEach((a, i) => (projEnd[a.projectIdx] = Math.max(projEnd[a.projectIdx], pos.finish[i])));

  const fitsAt = (i: number, s: number) => st.shortage(i, workDays(ctx, i, s, finishOf(ctx.acts[i], s)), noAllowance).beyondAllowance <= 1e-9;
  const move = (i: number, s: number) => {
    st.add(i, workDays(ctx, i, pos.start[i], pos.finish[i]), -1);
    pos.start[i] = s;
    pos.finish[i] = finishOf(ctx.acts[i], s);
    st.add(i, workDays(ctx, i, pos.start[i], pos.finish[i]), 1);
  };
  const succOk = (i: number, s: number) => {
    const old = [pos.start[i], pos.finish[i]];
    pos.start[i] = s;
    pos.finish[i] = finishOf(ctx.acts[i], s);
    const ok = ctx.succRels[i].every((r) => relSatisfied(ctx, ctx.rels[r], pos));
    [pos.start[i], pos.finish[i]] = old;
    return ok;
  };

  // Backward (right) pass
  const byFinish = ctx.acts.filter((a) => !a.fixed).map((a) => a.idx).sort((x, y) => pos.finish[y] - pos.finish[x] || pos.start[y] - pos.start[x]);
  for (const i of byFinish) {
    const a = ctx.acts[i];
    const cur = pos.start[i];
    const end = projEnd[a.projectIdx];
    let s = a.durationDays > 0 ? a.cal.startFrom(end, a.durationDays) : end;
    if (a.durationDays > 0) s = a.cal.prevWorkday(s);
    st.add(i, workDays(ctx, i, pos.start[i], pos.finish[i]), -1);
    let chosen = cur;
    for (; s > cur; s = prevStart(a, s)) {
      if (finishOf(a, s) > end) continue;
      if (succOk(i, s) && fitsAt(i, s)) {
        chosen = s;
        break;
      }
    }
    st.add(i, workDays(ctx, i, pos.start[i], pos.finish[i]), 1);
    if (chosen !== cur) move(i, chosen);
  }
  // Forward (left) pass
  const byStart = ctx.acts.filter((a) => !a.fixed).map((a) => a.idx).sort((x, y) => pos.start[x] - pos.start[y] || pos.finish[x] - pos.finish[y]);
  for (const i of byStart) {
    const a = ctx.acts[i];
    const cur = pos.start[i];
    const es = earliestStart(ctx, i, pos);
    st.add(i, workDays(ctx, i, pos.start[i], pos.finish[i]), -1);
    let chosen = cur;
    for (let s = es; s < cur; s = nextStart(a, s)) {
      if (fitsAt(i, s)) {
        chosen = s;
        break;
      }
    }
    st.add(i, workDays(ctx, i, pos.start[i], pos.finish[i]), 1);
    if (chosen !== cur) move(i, chosen);
  }
  return { ...pos, hires: st.finalHires() };
}
