import type { DayNum } from '../model';
import type { Context, Positions } from '../scheduling/context';

/** Hired units: groupId → day → extra units on that day */
export type Hires = Record<string, Record<number, number>>;

export interface GroupDemand {
  groupIdx: number;
  groupId: string;
  name: string;
  capacity: number | null;
  leveled: boolean;
  /** Working days covered (portfolio calendar workdays, plus any day that carries demand) */
  days: DayNum[];
  total: number[];
  /** [projectIdx][dayIdx] */
  byProject: number[][];
  hired: number[];
  /** Activity indexes using the group on each day */
  contributors: number[][];
}

const EPS = 1e-9;

/** Daily demand per resource group (and per project) for a set of activity positions. */
export function computeDemand(ctx: Context, pos: Positions, hires: Hires = {}): GroupDemand[] {
  let from = Infinity;
  let to = -Infinity;
  ctx.projects.forEach((p) => (from = Math.min(from, p.dataDate)));
  ctx.acts.forEach((a, i) => {
    if (a.demands.length === 0) return;
    from = Math.min(from, Math.max(pos.start[i], a.minStart));
    to = Math.max(to, pos.finish[i]);
  });
  if (!Number.isFinite(from) || !Number.isFinite(to) || to <= from) {
    return ctx.groups.map((g, gi) => emptyDemand(ctx, gi, g.id));
  }
  const span = to - from;
  const totals = ctx.groups.map(() => new Float64Array(span));
  const byProj = ctx.groups.map(() => ctx.projects.map(() => new Float64Array(span)));
  const contrib = ctx.groups.map(() => new Map<number, number[]>());
  const anyDemand = new Uint8Array(span);
  ctx.acts.forEach((a, i) => {
    if (a.demands.length === 0) return;
    const s = Math.max(pos.start[i], a.minStart);
    for (let d = s; d < pos.finish[i]; d++) {
      if (!a.cal.isWorkday(d)) continue;
      const k = d - from;
      anyDemand[k] = 1;
      for (const dem of a.demands) {
        totals[dem.g][k] += dem.units;
        byProj[dem.g][a.projectIdx][k] += dem.units;
        const list = contrib[dem.g].get(k);
        if (list) list.push(i);
        else contrib[dem.g].set(k, [i]);
      }
    }
  });
  const dayIdx: number[] = [];
  for (let k = 0; k < span; k++) if (anyDemand[k] || ctx.portfolioCal.isWorkday(from + k)) dayIdx.push(k);
  return ctx.groups.map((g, gi) => {
    const h = hires[g.id] ?? {};
    return {
      groupIdx: gi,
      groupId: g.id,
      name: g.name,
      capacity: g.capacity,
      leveled: g.leveled,
      days: dayIdx.map((k) => from + k),
      total: dayIdx.map((k) => round6(totals[gi][k])),
      byProject: ctx.projects.map((_, pi) => dayIdx.map((k) => round6(byProj[gi][pi][k]))),
      hired: dayIdx.map((k) => h[from + k] ?? 0),
      contributors: dayIdx.map((k) => contrib[gi].get(k) ?? []),
    };
  });
}

function emptyDemand(ctx: Context, gi: number, id: string): GroupDemand {
  const g = ctx.groups[gi];
  return { groupIdx: gi, groupId: id, name: g.name, capacity: g.capacity, leveled: g.leveled, days: [], total: [], byProject: ctx.projects.map(() => []), hired: [], contributors: [] };
}

const round6 = (x: number) => (Math.abs(x) < EPS ? 0 : Math.round(x * 1e6) / 1e6);

/** Hires implied by over-allocation of the given positions: max(0, demand − capacity) per day. */
export function shortageHires(ctx: Context, pos: Positions): Hires {
  const out: Hires = {};
  for (const gd of computeDemand(ctx, pos)) {
    if (gd.capacity === null || !gd.leveled) continue;
    gd.days.forEach((d, k) => {
      const ex = gd.total[k] - (gd.capacity as number);
      if (ex > EPS) (out[gd.groupId] ??= {})[d] = round6(ex);
    });
  }
  return out;
}
