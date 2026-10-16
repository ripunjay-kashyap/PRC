import { describe, expect, it } from 'vitest';
import { analyzeConflicts } from '../src/lib/analysis/conflicts';
import { computeDemand, shortageHires } from '../src/lib/analysis/demand';
import { compareProjects } from '../src/lib/analysis/comparison';
import { prepareContext } from '../src/lib/scheduling/cpm';
import { suggestGroups } from '../src/lib/resources/matching';
import { defaultSettings } from '../src/lib/settings';
import { dayToISO } from '../src/lib/calendar';
import { makeModel } from './fixtures/modelBuilder';

function threeExcavatorProjects() {
  const model = makeModel({
    projects: [{ key: 'P1', dataDate: '2026-01-05' }, { key: 'P2', dataDate: '2026-01-05' }, { key: 'P3', dataDate: '2026-01-07' }],
    activities: [
      { project: 'P1', code: 'EXC', days: 5 },
      { project: 'P2', code: 'EXC', days: 5 },
      { project: 'P3', code: 'EXC', days: 2 },
    ],
    resources: [{ project: 'P1', name: 'Excavator', type: 'equipment' }, { project: 'P2', name: 'Excavator', type: 'equipment' }, { project: 'P3', name: 'Excavator', type: 'equipment' }],
    assignments: [
      { project: 'P1', code: 'EXC', resource: 'Excavator', units: 2 },
      { project: 'P2', code: 'EXC', resource: 'Excavator', units: 2 },
      { project: 'P3', code: 'EXC', resource: 'Excavator', units: 1 },
    ],
  });
  const groups = suggestGroups(model).map((g) => ({ ...g, capacity: 3, capacitySource: 'user' as const }));
  const ctx = prepareContext(model, groups, defaultSettings(model));
  return { model, groups, ctx };
}

describe('conflict detection', () => {
  it('2 + 2 + 1 excavators on overlapping days with capacity 3 → shortage of 2', () => {
    const { ctx } = threeExcavatorProjects();
    expect(ctx.groups).toHaveLength(1);
    const demand = computeDemand(ctx, ctx.baseline);
    const [c] = analyzeConflicts(ctx, demand, { tf: ctx.cpm.tf });
    expect(c.peakDemand).toBe(5);
    expect(c.peakOver).toBe(2);
    // daily demand Mon–Fri 4,4,5,5,4 vs capacity 3 → excess 1,1,2,2,1
    expect(c.overDays).toBe(5);
    expect(c.overUnitDays).toBe(7);
    expect(c.overPeriods).toHaveLength(1);
    expect(dayToISO(c.overPeriods[0].start)).toBe('2026-01-05');
    expect(dayToISO(c.overPeriods[0].end)).toBe('2026-01-09');
    expect(c.overPeriods[0].peakExcess).toBe(2);
    expect(c.overPeriods[0].projects.sort()).toEqual(['P1', 'P2', 'P3']);
    // each single-activity project is critical (zero float) → conflict on critical activities
    expect(c.overPeriods[0].critical).toBe(true);
    expect(c.criticalOverDays).toBe(5);
  });

  it('reports utilisation, idle and under-utilised periods', () => {
    const { ctx } = threeExcavatorProjects();
    const [c] = analyzeConflicts(ctx, computeDemand(ctx, ctx.baseline), { underutilizationThreshold: 0.5 });
    // demand per day Mon..Fri: 4,4,5,5,4 against capacity 3 → capped use 3/day
    expect(c.utilizationPct).toBe(100);
    expect(c.idleUnitDays).toBe(0);
    const { ctx: ctx2 } = threeExcavatorProjects();
    ctx2.groups[0].capacity = 10;
    const [c2] = analyzeConflicts(ctx2, computeDemand(ctx2, ctx2.baseline), { underutilizationThreshold: 0.6 });
    expect(c2.peakOver).toBe(0);
    expect(c2.utilizationPct).toBe(44);
    expect(c2.idleUnitDays).toBe(28);
    expect(c2.lowPeriods.map((p) => p.kind)).toEqual(['under']);
    expect(c2.lowPeriods[0].days).toBe(5);
  });

  it('hired units remove the over-allocation', () => {
    const { ctx } = threeExcavatorProjects();
    const hires = shortageHires(ctx, ctx.baseline);
    const gid = ctx.groups[0].id;
    expect(Object.values(hires[gid])).toEqual([1, 1, 2, 2, 1]);
    const [c] = analyzeConflicts(ctx, computeDemand(ctx, ctx.baseline, hires));
    expect(c.peakOver).toBe(0);
  });

  it('finds idle gaps inside the active window', () => {
    const model = makeModel({
      projects: [{ key: 'P', dataDate: '2026-01-05' }],
      activities: [{ project: 'P', code: 'A', days: 2 }, { project: 'P', code: 'B', days: 2, preds: [{ code: 'A', lag: 3 }] }],
      resources: [{ project: 'P', name: 'Crane', type: 'equipment', max: 1 }],
      assignments: [{ project: 'P', code: 'A', resource: 'Crane', units: 1 }, { project: 'P', code: 'B', resource: 'Crane', units: 1 }],
    });
    const groups = suggestGroups(model);
    const ctx = prepareContext(model, groups, defaultSettings(model));
    const [c] = analyzeConflicts(ctx, computeDemand(ctx, ctx.baseline));
    expect(c.lowPeriods).toEqual([expect.objectContaining({ kind: 'idle', days: 3 })]);
    expect(c.idleUnitDays).toBe(3);
  });
});

describe('project comparison', () => {
  it('summarises durations, demand and overlaps', () => {
    const { model, ctx } = threeExcavatorProjects();
    const cmp = compareProjects(model, ctx);
    expect(cmp.projects.map((p) => p.durationWorkdays)).toEqual([5, 5, 2]);
    expect(cmp.projects[0].demandByGroup[ctx.groups[0].id]).toBe(10);
    expect(cmp.projects[0].resourceTypes).toEqual(['equipment']);
    expect(cmp.overlaps).toHaveLength(3);
    expect(cmp.overlaps.find((o) => o.a === 'P1' && o.b === 'P3')!.workdays).toBe(2);
  });
});
