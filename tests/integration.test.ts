import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { loadPortfolio } from '../src/lib/loader';
import { applyCsvImport, importAssignmentsCsv } from '../src/lib/resources/csvAssignments';
import { suggestGroups } from '../src/lib/resources/matching';
import { defaultSettings } from '../src/lib/settings';
import { analyzePortfolio, runOptimization } from '../src/lib/pipeline';
import { prepareContext } from '../src/lib/scheduling/cpm';
import { relSatisfied } from '../src/lib/scheduling/context';

const files = [
  { name: 'AFS.xer', data: readFileSync('samples/AFS.xer') },
  { name: 'AFS_scheduled.xer', data: readFileSync('samples/AFS_scheduled.xer') },
];
const csvText = readFileSync('public/samples/afs-demo-resources.csv', 'utf8');

function pipeline(mutate?: (s: ReturnType<typeof defaultSettings>) => void) {
  let model = loadPortfolio(files);
  model = applyCsvImport(model, importAssignmentsCsv(csvText, model, 'afs-demo-resources.csv'));
  const groups = suggestGroups(model);
  const settings = defaultSettings(model);
  mutate?.(settings);
  return { model, groups, settings, out: runOptimization(model, groups, settings) };
}

describe('full pipeline on both attached XER files', () => {
  const { model, groups, settings, out } = pipeline();
  const ctx = prepareContext(model, groups, settings);

  it('imports the demo loading and matches resources across the two files', () => {
    expect(model.assignments.length).toBe(112);
    expect(groups.map((g) => g.name)).toEqual([
      'Ceramic Tile Sqm', 'Concrete Mixer', 'Fabricator', 'Helper', 'Mason', 'Painter', 'Plumber', 'Site Engineer', 'Tiler', 'Waterproofing',
    ]);
    expect(groups.every((g) => g.memberKeys.length === 2)).toBe(true);
    expect(groups.find((g) => g.name === 'Ceramic Tile Sqm')!.type).toBe('material');
  });

  it('detects baseline conflicts against pooled capacity', () => {
    const an = analyzePortfolio(model, groups, settings);
    const over = an.conflicts.filter((c) => c.peakOver > 0).map((c) => c.name).sort();
    expect(over).toEqual(['Helper', 'Mason', 'Plumber']);
    expect(an.conflicts.find((c) => c.name === 'Ceramic Tile Sqm')!.leveled).toBe(false); // materials excluded by default
    expect(an.comparison.overlaps).toHaveLength(1);
  });

  it('runs all six scenarios', () => {
    expect(out.scenarios.map((s) => s.id)).toEqual(['baseline', 'project_leveling', 'pooled_original', 'pooled_float', 'cost_priority', 'deadline_priority']);
  });

  for (const id of ['baseline', 'project_leveling', 'pooled_original', 'pooled_float', 'cost_priority', 'deadline_priority']) {
    it(`scenario ${id}: zero hard-constraint violations, durations unchanged, every relationship satisfied`, () => {
      const sc = out.scenarios.find((s) => s.id === id)!;
      expect(sc.feasible).toBe(true);
      expect(sc.validation.violations).toEqual([]);
      expect(sc.metrics.constraintViolations).toBe(0);
      ctx.acts.forEach((a, i) => {
        if (a.durationDays > 0) expect(a.cal.countWorkdays(sc.start[i], sc.finish[i]), `${a.code}`).toBe(a.durationDays);
        else expect(sc.finish[i]).toBe(sc.start[i]);
        expect(sc.start[i]).toBeGreaterThanOrEqual(a.minStart);
      });
      for (const rel of ctx.rels) expect(relSatisfied(ctx, rel, sc)).toBe(true);
      if (sc.enforcesCapacity) expect(sc.metrics.peakOverallocation).toBe(0);
    });
  }

  it('leveled pooled scenarios remove the baseline over-allocation', () => {
    const base = out.scenarios[0].metrics;
    expect(base.peakOverallocation).toBeGreaterThan(0);
    for (const sc of out.scenarios.slice(1)) expect(sc.metrics.peakOverallocation).toBe(0);
    const flt = out.scenarios.find((s) => s.id === 'pooled_float')!;
    // within float no project end moves
    flt.metrics.projects.forEach((p, pi) => expect(p.finish).toBeLessThanOrEqual(Math.max(base.projects[pi].finish, out.projects[pi].logicFinish)));
  });

  it('reports a deadline miss honestly when a deadline is infeasible', () => {
    const tight = pipeline((s) => {
      // 30 Nov 2026 is well before the logic-only finish of AFS_scheduled (24 Dec)
      s.projects['f2:4518'].deadline = 20787; // 2026-12-01 boundary
      s.projects['f2:4518'].deadlineSource = 'user';
    });
    const dl = tight.out.scenarios.find((s) => s.id === 'deadline_priority')!;
    const p = dl.metrics.projects.find((x) => x.key === 'f2:4518')!;
    expect(p.delayDays).toBeGreaterThan(0);
    expect(dl.metrics.deadlineViolations).toBeGreaterThan(0);
    expect(dl.notes.join(' ')).toMatch(/misses its deadline by \d+ working days \(at least \d+ are unavoidable/);
    const impact = dl.recommendations.deadlines.find((d) => d.project === p.name)!;
    expect(impact.minUnavoidableDelayDays).toBeGreaterThan(0);
    expect(tight.out.issues.some((i) => i.code === 'deadline_infeasible')).toBe(true);
  });

  it('works on the XER files alone (no resources): scenarios run, nothing to level', () => {
    const model2 = loadPortfolio(files);
    const out2 = runOptimization(model2, [], defaultSettings(model2));
    expect(out2.scenarios.every((s) => s.feasible)).toBe(true);
    expect(out2.scenarios[0].notes.join(' ')).toMatch(/nothing can be leveled/);
  });
});
