import { describe, expect, it } from 'vitest';
import { serialSgs } from '../src/lib/scheduling/sgs';
import { validateSchedule } from '../src/lib/scheduling/validator';
import { ctxFrom } from './fixtures/ctx';

function setup() {
  return ctxFrom(
    {
      projects: [{ key: 'P', dataDate: '2026-01-05' }],
      activities: [
        { project: 'P', code: 'DONE', days: 1, status: 'completed', actualStart: '2026-01-02', actualFinish: '2026-01-03' },
        { project: 'P', code: 'A', days: 3, preds: [{ code: 'DONE' }] },
        { project: 'P', code: 'B', days: 2, preds: [{ code: 'A', type: 'SS', lag: 1 }] },
        { project: 'P', code: 'M', days: 0, kind: 'finish_milestone', preds: [{ code: 'B' }] },
      ],
      resources: [{ project: 'P', name: 'Crew' }],
      assignments: [{ project: 'P', code: 'A', resource: 'Crew', units: 1 }, { project: 'P', code: 'B', resource: 'Crew', units: 1 }],
    },
    { capacity: { Crew: 1 } },
  );
}

describe('constraint validator', () => {
  const { ctx } = setup();
  const good = serialSgs(ctx, { rule: 'MIN_TF', mode: 'pooled', window: 'none', hire: 'unavoidable' });
  const check = (s: Omit<typeof good, 'forced'>, capacity = true) => validateSchedule(ctx, s, { checkCapacity: capacity, fixedRef: ctx.baseline });
  const clone = () => ({ start: [...good.start], finish: [...good.finish], hires: { ...good.hires } });
  const idx = (c: string) => ctx.acts.findIndex((a) => a.code === c);

  it('accepts a valid schedule', () => {
    const r = check(good);
    expect(r.ok).toBe(true);
    expect(r.checked.relationships).toBe(3);
    expect(r.checked.capacityChecked).toBe(true);
  });
  it('catches a shortened duration', () => {
    const s = clone();
    s.finish[idx('A')] -= 1;
    expect(check(s).counts.duration).toBe(1);
  });
  it('catches a relationship violation', () => {
    const s = clone();
    s.start[idx('M')] = s.finish[idx('M')] = s.start[idx('A')];
    const r = check(s);
    expect(r.counts.relationship).toBe(1);
    expect(r.violations[0].message).toMatch(/B → .*M \(FS\)/);
  });
  it('catches a start before the data date', () => {
    const s = clone();
    s.start[idx('A')] -= 7;
    s.finish[idx('A')] -= 7;
    expect(check(s).counts.data_date).toBe(1);
  });
  it('catches a moved completed activity', () => {
    const s = clone();
    s.start[idx('DONE')] += 1;
    expect(check(s).counts.fixed).toBe(1);
  });
  it('catches over-capacity unless the extra units are hired', () => {
    const s = clone();
    // run B in parallel with A (still satisfies SS+1) → 2 crews needed on two days
    const a = idx('A');
    const b = idx('B');
    s.start[b] = ctx.acts[b].cal.shift(s.start[a], 1);
    s.finish[b] = ctx.acts[b].cal.finishFrom(s.start[b], 2);
    s.start[idx('M')] = s.finish[idx('M')] = s.finish[b];
    const r = check(s);
    expect(r.counts.capacity).toBe(2);
    expect(r.counts.relationship).toBe(0);
    expect(check(s, false).ok).toBe(true);
    const gid = ctx.groups[0].id;
    s.hires = { [gid]: { [s.start[b]]: 1, [s.start[b] + 1]: 1 } };
    expect(check(s).ok).toBe(true);
    s.hires = { [gid]: { [s.start[b]]: -1 } };
    expect(check(s).counts.hire).toBe(1);
  });
});
