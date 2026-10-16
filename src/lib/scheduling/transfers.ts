import type { GroupDemand } from '../analysis/demand';
import type { DayNum } from '../model';
import type { Context } from './context';

export interface Transfer {
  groupId: string;
  groupName: string;
  day: DayNum;
  fromProject: string;
  toProject: string;
  units: number;
  mobilizationDays: number;
  cost: number | null;
}

const EPS = 1e-9;

/**
 * Transfer rule (documented assumption): on working day t, if one project's allocation of a pooled
 * group drops relative to the previous working day while another project's allocation rises,
 * min(total drop, total rise) units are taken to move between those projects. Units are paired
 * greedily, largest drop to largest rise.
 *
 * Cost per transferred unit = transfer cost + mobilisation days × daily cost rate (the unit is
 * paid while it is being moved). Mobilisation is costed, not modelled as lost capacity.
 */
export function computeTransfers(ctx: Context, demand: GroupDemand[]): Transfer[] {
  const out: Transfer[] = [];
  for (const gd of demand) {
    const g = ctx.groups[gd.groupIdx];
    if (ctx.projects.length < 2) continue;
    for (let k = 1; k < gd.days.length; k++) {
      const drops: { p: number; u: number }[] = [];
      const rises: { p: number; u: number }[] = [];
      ctx.projects.forEach((_, p) => {
        const delta = gd.byProject[p][k] - gd.byProject[p][k - 1];
        if (delta < -EPS) drops.push({ p, u: -delta });
        else if (delta > EPS) rises.push({ p, u: delta });
      });
      if (!drops.length || !rises.length) continue;
      drops.sort((a, b) => b.u - a.u);
      rises.sort((a, b) => b.u - a.u);
      let di = 0;
      let ri = 0;
      while (di < drops.length && ri < rises.length) {
        const u = Math.min(drops[di].u, rises[ri].u);
        if (u > EPS) {
          const unitCost = g.costPerUnitDay !== null ? g.transferCostPerUnit + g.mobilizationDays * g.costPerUnitDay : g.mobilizationDays > 0 ? null : g.transferCostPerUnit;
          out.push({
            groupId: g.id,
            groupName: g.name,
            day: gd.days[k],
            fromProject: ctx.projects[drops[di].p].name,
            toProject: ctx.projects[rises[ri].p].name,
            units: round2(u),
            mobilizationDays: g.mobilizationDays,
            cost: unitCost === null ? null : round2(u * unitCost),
          });
        }
        drops[di].u -= u;
        rises[ri].u -= u;
        if (drops[di].u <= EPS) di++;
        if (rises[ri].u <= EPS) ri++;
      }
    }
  }
  return out;
}

const round2 = (x: number) => Math.round(x * 100) / 100;
