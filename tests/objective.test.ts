import { describe, expect, it } from 'vitest';
import { evaluateSchedule, objectiveZ } from '../src/lib/scheduling/objective';
import { computeTransfers } from '../src/lib/scheduling/transfers';
import { computeDemand } from '../src/lib/analysis/demand';
import { D } from './fixtures/modelBuilder';
import { ctxFrom } from './fixtures/ctx';

const W = { alpha: 1, beta: 10, gamma: 100, delta: 0.5 };

describe('objective function Z = αC + βD + γO + δU', () => {
  it('combines the four components linearly', () => {
    expect(objectiveZ({ C: 1000, D: 3, O: 2, U: 10 }, W)).toBe(1000 + 30 + 200 + 5);
    expect(objectiveZ({ C: 1000, D: 3, O: 2, U: 10 }, { alpha: 0, beta: 0, gamma: 0, delta: 0 })).toBe(0);
  });

  it('evaluates cost, delay, over-allocation and idle time from a schedule', () => {
    const { ctx } = ctxFrom(
      {
        projects: [{ key: 'P1', dataDate: '2026-01-05', planEnd: '2026-01-07' }, { key: 'P2', dataDate: '2026-01-05' }],
        activities: [{ project: 'P1', code: 'A', days: 4 }, { project: 'P2', code: 'B', days: 2 }],
        resources: [{ project: 'P1', name: 'Crew' }, { project: 'P2', name: 'Crew' }],
        assignments: [{ project: 'P1', code: 'A', resource: 'Crew', units: 2 }, { project: 'P2', code: 'B', resource: 'Crew', units: 2 }],
      },
      { capacity: { Crew: 3 }, cost: 50, settings: (s) => { s.projects.P1.priorityWeight = 2; } },
    );
    // baseline: A Mon–Thu (2/day), B Mon–Tue (2/day) → demand 4,4,2,2 vs capacity 3
    const e = evaluateSchedule(ctx, ctx.baseline, {}, { weights: W, underutilizationThreshold: 0.5, countTransfers: true });
    const m = e.metrics;
    expect(m.resourceCost).toBe((8 + 4) * 50);
    expect(m.objective.O).toBe(2); // 1 + 1 unit-days over
    expect(m.peakOverallocation).toBe(1);
    expect(m.objective.U).toBe(2); // 1 + 1 idle unit-days on Wed/Thu
    // P1 deadline is the start of Wed 7 Jan → finishes end of Thu → 2 working days late, weight 2
    expect(m.projects[0].delayDays).toBe(2);
    expect(m.objective.D).toBe(4);
    expect(m.deadlineViolations).toBe(1);
    expect(m.objective.Z).toBe(600 + 40 + 200 + 1);
    expect(m.costComplete).toBe(true);
  });

  it('prices hires and flags groups with no cost rate', () => {
    const { ctx } = ctxFrom(
      {
        projects: [{ key: 'P', dataDate: '2026-01-05' }],
        activities: [{ project: 'P', code: 'A', days: 2 }],
        resources: [{ project: 'P', name: 'Crew' }],
        assignments: [{ project: 'P', code: 'A', resource: 'Crew', units: 2 }],
      },
      { capacity: { Crew: 1 } },
    );
    const gid = ctx.groups[0].id;
    const hires = { [gid]: { [D('2026-01-05')]: 1, [D('2026-01-06')]: 1 } };
    const e = evaluateSchedule(ctx, ctx.baseline, hires, { weights: W, underutilizationThreshold: 0.5, countTransfers: true });
    expect(e.metrics.hiredUnitDays).toBe(2);
    expect(e.metrics.hireCost).toBe(2 * 100 * 1.5); // cost 100/day × hire premium 1.5
    expect(e.metrics.objective.O).toBe(0);
    ctx.groups[0].costPerUnitDay = null;
    ctx.groups[0].hireCostPerUnitDay = null;
    const e2 = evaluateSchedule(ctx, ctx.baseline, hires, { weights: W, underutilizationThreshold: 0.5, countTransfers: true });
    expect(e2.metrics.costComplete).toBe(false);
    expect(e2.metrics.costMissing).toEqual(['Crew']);
  });
});

describe('transfers', () => {
  it('detects a unit moving from one project to another on the same day', () => {
    const { ctx } = ctxFrom(
      {
        projects: [{ key: 'P1', dataDate: '2026-01-05' }, { key: 'P2', dataDate: '2026-01-05' }],
        activities: [{ project: 'P1', code: 'A', days: 2 }, { project: 'P2', code: 'W', days: 2 }, { project: 'P2', code: 'B', days: 2, preds: [{ code: 'W' }] }],
        resources: [{ project: 'P1', name: 'Crane', type: 'equipment' }, { project: 'P2', name: 'Crane', type: 'equipment' }],
        assignments: [{ project: 'P1', code: 'A', resource: 'Crane', units: 1 }, { project: 'P2', code: 'B', resource: 'Crane', units: 1 }],
      },
      { capacity: { Crane: 1 }, cost: 200 },
    );
    ctx.groups[0].transferCostPerUnit = 500;
    ctx.groups[0].mobilizationDays = 1;
    const t = computeTransfers(ctx, computeDemand(ctx, ctx.baseline));
    expect(t).toHaveLength(1);
    expect(t[0]).toMatchObject({ fromProject: 'P1', toProject: 'P2', units: 1, mobilizationDays: 1, cost: 700 });
  });
});
