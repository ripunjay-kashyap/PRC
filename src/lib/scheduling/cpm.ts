import type { PortfolioModel } from '../model';
import type { ResourceGroup, Settings } from '../settings';
import {
  buildContextSkeleton,
  earliestStart,
  finishOf,
  type Context,
  type Positions,
} from './context';

export interface CpmResult {
  es: number[];
  ef: number[];
  ls: number[];
  lf: number[];
  /** Total float in working days (negative when a deadline is earlier than the logic allows) */
  tf: number[];
  /** Logic-only (resource-unconstrained) finish of each project */
  projectFinish: number[];
}

export interface PreparedContext extends Context {
  cpm: CpmResult;
  /** Latest start that still meets the project deadline (Infinity when no deadline) */
  deadlineLS: number[];
}

/** Fixed positions for activities that cannot move (completed, in progress, LOE). */
function fixedPosition(ctx: Context, model: PortfolioModel, i: number): [number, number] {
  const a = ctx.acts[i];
  const src = model.activities.find((x) => x.key === a.key)!;
  const dataDate = ctx.projects[a.projectIdx].dataDate;
  if (a.status === 'completed') {
    const s = src.actualStart ?? src.earlyStart ?? src.targetStart ?? dataDate;
    const f = src.actualFinish ?? src.earlyFinish ?? src.targetFinish ?? a.cal.finishFrom(s, a.durationDays);
    return [s, Math.max(s, f)];
  }
  if (a.status === 'in_progress') {
    const s = src.actualStart ?? src.earlyStart ?? dataDate;
    // Remaining duration runs from the data date (P6 retained-logic behaviour, simplified).
    const resume = a.cal.nextWorkday(Math.max(s, dataDate));
    return [s, a.durationDays > 0 ? a.cal.finishFrom(resume, a.durationDays) : Math.max(s, dataDate)];
  }
  // Level of effort / WBS summary: keep P6 dates, else span from data date.
  const s = src.earlyStart ?? src.targetStart ?? dataDate;
  const f = src.earlyFinish ?? src.targetFinish ?? a.cal.finishFrom(s, a.durationDays);
  return [s, Math.max(s, f)];
}

/** Resource-unconstrained forward pass from fixed positions and data dates. */
export function forwardPass(ctx: Context, fixed: Positions): Positions {
  const pos: Positions = { start: [...fixed.start], finish: [...fixed.finish] };
  for (const i of ctx.topo) {
    const a = ctx.acts[i];
    if (a.fixed) continue;
    const s = earliestStart(ctx, i, pos);
    pos.start[i] = s;
    pos.finish[i] = finishOf(a, s);
  }
  return pos;
}

/** Backward pass: late dates given a per-project end boundary. */
export function backwardPass(ctx: Context, early: Positions, endFor: (projectIdx: number) => number): { ls: number[]; lf: number[] } {
  const n = ctx.acts.length;
  const ls = new Array<number>(n).fill(Infinity);
  const lf = new Array<number>(n).fill(Infinity);
  for (let k = ctx.topo.length - 1; k >= 0; k--) {
    const i = ctx.topo[k];
    const a = ctx.acts[i];
    if (a.fixed) {
      ls[i] = early.start[i];
      lf[i] = early.finish[i];
      continue;
    }
    const cal = a.cal;
    let lfBound = endFor(a.projectIdx);
    let lsBound = Infinity;
    for (const r of ctx.succRels[i]) {
      const rel = ctx.rels[r];
      const j = rel.succ;
      const scal = ctx.acts[j].cal;
      switch (rel.type) {
        case 'FS':
          lfBound = Math.min(lfBound, scal.shift(ls[j], -rel.lag));
          break;
        case 'SS':
          lsBound = Math.min(lsBound, scal.shift(ls[j], -rel.lag));
          break;
        case 'FF':
          lfBound = Math.min(lfBound, scal.shift(lf[j], -rel.lag));
          break;
        case 'SF':
          lsBound = Math.min(lsBound, scal.shift(lf[j], -rel.lag));
          break;
      }
    }
    const d = a.durationDays;
    let s: number;
    if (d === 0) s = Math.min(lfBound, lsBound);
    else {
      s = cal.startFrom(lfBound, d);
      if (lsBound < s) s = cal.prevWorkday(lsBound);
    }
    ls[i] = s;
    lf[i] = d === 0 ? s : cal.finishFrom(s, d);
  }
  return { ls, lf };
}

function signedWorkdays(ctx: Context, i: number, from: number, to: number): number {
  const cal = ctx.acts[i].cal;
  return to >= from ? cal.countWorkdays(from, to) : -cal.countWorkdays(to, from);
}

export function computeCpm(ctx: Context, fixed: Positions): CpmResult & { deadlineLS: number[] } {
  const early = forwardPass(ctx, fixed);
  const projectFinish = ctx.projects.map(() => -Infinity);
  ctx.acts.forEach((a, i) => {
    projectFinish[a.projectIdx] = Math.max(projectFinish[a.projectIdx], early.finish[i]);
  });
  // Float is measured to the project's logic finish, or to its deadline when that is earlier.
  const late = backwardPass(ctx, early, (p) => Math.min(projectFinish[p], ctx.projects[p].deadline ?? Infinity));
  const tf = ctx.acts.map((_, i) => signedWorkdays(ctx, i, early.start[i], late.ls[i]));
  const dl = backwardPass(ctx, early, (p) => ctx.projects[p].deadline ?? Infinity);
  return { es: early.start, ef: early.finish, ls: late.ls, lf: late.lf, tf, projectFinish, deadlineLS: dl.ls };
}

/**
 * Build the full scheduling context: activities, logic, resource groups, fixed positions,
 * the baseline schedule and CPM dates/float.
 */
export function prepareContext(model: PortfolioModel, groups: ResourceGroup[], settings: Settings): PreparedContext {
  const sk = buildContextSkeleton({ model, groups, settings });
  const n = sk.acts.length;
  const ctx: Context = { ...sk, baseline: { start: new Array(n).fill(0), finish: new Array(n).fill(0) } };
  const fixed: Positions = { start: new Array(n).fill(0), finish: new Array(n).fill(0) };
  ctx.acts.forEach((a, i) => {
    if (a.fixed) [fixed.start[i], fixed.finish[i]] = fixedPosition(ctx, model, i);
  });
  const cpm = computeCpm(ctx, fixed);

  // Baseline: P6 early dates when the project was scheduled, otherwise CPM (or target dates).
  const byKey = new Map(model.activities.map((a) => [a.key, a]));
  ctx.projects.forEach((p, pi) => {
    const idxs = ctx.acts.filter((a) => a.projectIdx === pi && !a.fixed).map((a) => a.idx);
    const scheduled = idxs.every((i) => byKey.get(ctx.acts[i].key)!.earlyStart !== null && byKey.get(ctx.acts[i].key)!.earlyFinish !== null);
    for (const i of ctx.acts.filter((a) => a.projectIdx === pi && a.fixed).map((a) => a.idx)) {
      ctx.baseline.start[i] = fixed.start[i];
      ctx.baseline.finish[i] = fixed.finish[i];
    }
    if (scheduled && idxs.length > 0) {
      for (const i of idxs) {
        const src = byKey.get(ctx.acts[i].key)!;
        ctx.baseline.start[i] = src.earlyStart!;
        ctx.baseline.finish[i] = src.earlyFinish!;
      }
      return;
    }
    const useTarget = settings.unscheduledBaseline === 'target' && idxs.every((i) => byKey.get(ctx.acts[i].key)!.targetStart !== null);
    for (const i of idxs) {
      const src = byKey.get(ctx.acts[i].key)!;
      if (useTarget) {
        ctx.baseline.start[i] = src.targetStart!;
        ctx.baseline.finish[i] = src.targetFinish ?? ctx.acts[i].cal.finishFrom(src.targetStart!, ctx.acts[i].durationDays);
      } else {
        ctx.baseline.start[i] = cpm.es[i];
        ctx.baseline.finish[i] = cpm.ef[i];
      }
    }
    if (idxs.length > 0) {
      p.baselineFromCpm = !useTarget;
      ctx.issues.push({
        severity: 'warning',
        code: 'unscheduled_project',
        projectKey: p.key,
        message: useTarget
          ? `${p.name} has no calculated dates in P6; its baseline uses the P6 target dates, which may violate the logic.`
          : `${p.name} has no calculated dates in P6 (not scheduled); its baseline uses CPM early dates computed by this app from the data date.`,
      });
    }
  });
  ctx.projects.forEach((p, pi) => {
    if (p.deadline !== null && cpm.projectFinish[pi] > p.deadline) {
      const days = ctx.portfolioCal.countWorkdays(p.deadline, cpm.projectFinish[pi]);
      ctx.issues.push({
        severity: 'warning',
        code: 'deadline_infeasible',
        projectKey: p.key,
        message: `${p.name}: the deadline cannot be met even with unlimited resources; minimum unavoidable delay is ${days} working days (logic only).`,
      });
    }
  });
  return { ...ctx, cpm, deadlineLS: cpm.deadlineLS };
}
