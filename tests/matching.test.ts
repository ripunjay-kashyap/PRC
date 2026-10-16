import { describe, expect, it } from 'vitest';
import { mergeGroups, normalizeName, projectTokens, similarity, splitMember, suggestGroups, MATCH_THRESHOLD } from '../src/lib/resources/matching';
import { makeModel } from './fixtures/modelBuilder';

const tokens = projectTokens([
  { shortName: 'A', fileName: 'ProjA.xer', displayName: 'A' },
  { shortName: 'B', fileName: 'ProjB.xer', displayName: 'B' },
  { shortName: 'AFS', fileName: 'AFS_scheduled.xer', displayName: 'AFS' },
]);

describe('resource name normalisation', () => {
  it('normalises case, punctuation, plurals and synonyms', () => {
    expect(normalizeName('EXCAVATOR  OPERATOR')).toBe('excavator operator');
    expect(normalizeName('Excavator Driver')).toBe('excavator operator');
    expect(normalizeName('Masons')).toBe('mason');
    expect(normalizeName('Helpers / Mazdoor')).toBe('helper');
    expect(normalizeName('Waterproofing Crew')).toBe('waterproofing');
    expect(normalizeName('Crew')).toBe('crew'); // stop-word-only names are kept
    expect(similarity('Crew', 'Crew - Project B', tokens)).toBe(1);
  });
  it('strips project suffixes', () => {
    expect(normalizeName('Excavator Operator - Project B', tokens)).toBe('excavator operator');
    expect(normalizeName('PLUMBER (AFS_scheduled)', tokens)).toBe('plumber');
    expect(normalizeName('Site Engineer - AFS Sched', tokens)).toBe('site engineer');
    expect(normalizeName('Painter - Sched', tokens)).toBe('painter');
    expect(normalizeName('Ceramic Tiles (sqm)', tokens)).toBe('ceramic tile sqm');
  });
});

describe('similarity scoring', () => {
  it('matches the spec example names', () => {
    expect(similarity('Excavator Operator', 'Excavator Driver', tokens)).toBe(1);
    expect(similarity('Excavator Operator', 'Excavator Operator - Project B', tokens)).toBe(1);
    expect(similarity('Welder / Fabricator', 'Fabricator', tokens)).toBeGreaterThanOrEqual(MATCH_THRESHOLD);
  });
  it('does not match different trades', () => {
    expect(similarity('Plumber', 'Painter', tokens)).toBeLessThan(MATCH_THRESHOLD);
    expect(similarity('Mason', 'Concrete Mixer', tokens)).toBeLessThan(MATCH_THRESHOLD);
    expect(similarity('Tower Crane', 'Crane Operator', tokens)).toBeLessThan(MATCH_THRESHOLD);
  });
});

describe('group suggestion and editing', () => {
  const model = makeModel({
    projects: [{ key: 'A', dataDate: '2026-01-05' }, { key: 'B', dataDate: '2026-01-05' }, { key: 'C', dataDate: '2026-01-05' }],
    activities: [{ project: 'A', code: 'X', days: 5 }, { project: 'B', code: 'X', days: 5 }, { project: 'C', code: 'X', days: 5 }],
    resources: [
      { project: 'A', name: 'Excavator Operator', max: 2, costPerHour: 100 },
      { project: 'B', name: 'Excavator Driver', max: 1, costPerHour: 120 },
      { project: 'C', name: 'Excavator Operator - Project C', max: null },
      { project: 'A', name: 'Excavator', type: 'equipment', max: 1 },
    ],
    assignments: [
      { project: 'A', code: 'X', resource: 'Excavator Operator', units: 1 },
      { project: 'B', code: 'X', resource: 'Excavator Driver', units: 1 },
      { project: 'C', code: 'X', resource: 'Excavator Operator - Project C', units: 1 },
      { project: 'A', code: 'X', resource: 'Excavator', units: 1 },
    ],
  });
  it('groups matching labour across projects but never across types', () => {
    const groups = suggestGroups(model);
    expect(groups).toHaveLength(2);
    const ops = groups.find((g) => g.type === 'labor')!;
    expect(ops.name).toBe('Excavator Operator');
    expect(ops.memberKeys).toHaveLength(3);
    // one member has no capacity → capacity unknown, hint shows the known sum
    expect(ops.capacity).toBeNull();
    expect(ops.capacityHint).toBe(3);
    expect(ops.costPerUnitDay).toBe(880);
  });
  it('supports split and merge', () => {
    const groups = suggestGroups(model);
    const ops = groups.find((g) => g.type === 'labor')!;
    const split = splitMember(model, groups, ops.id, 'C:Excavator Operator - Project C');
    expect(split).toHaveLength(3);
    const rest = split.find((g) => g.id === ops.id)!;
    expect(rest.capacity).toBe(3);
    const single = split.find((g) => g.memberKeys.includes('C:Excavator Operator - Project C'))!;
    const merged = mergeGroups(model, split, [ops.id, single.id]);
    expect(merged).toHaveLength(2);
    expect(() => mergeGroups(model, merged, merged.map((g) => g.id))).toThrow(/same type/);
  });
});
