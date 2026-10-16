import { describe, expect, it } from 'vitest';
import { dayToISO } from '../src/lib/calendar';
import { computeDemand } from '../src/lib/analysis/demand';
import { justify, PRIORITY_RULES, serialSgs, type SgsOptions } from '../src/lib/scheduling/sgs';
import { validateSchedule } from '../src/lib/scheduling/validator';
import { runScenarios } from '../src/lib/scheduling/scenarios';
import type { RelType } from '../src/lib/model';
import { ctxFrom } from './fixtures/ctx';
import type { ActSpec } from './fixtures/modelBuilder';

const pooled: SgsOptions = { rule: 'MIN_TF', mode: 'pooled', window: 'none', hire: 'unavoidable' };
const iso = (d: number) => dayToISO(d);
const code = (ctx: { acts: { code: string }[] }, c: string) => ctx.acts.findIndex((a) => a.code === c);

describe('serial SGS — relationship types with lags', () => {
  // Mon 2026-01-05 data date; Mon–Fri calendar
  const relCase = (type: RelType, lag: number) => {
    const { ctx } = ctxFrom({
      projects: [{ key: 'P', dataDate: '2026-01-05' }],
      activities: [
        { project: 'P', code: 'A', days: 3 },
        { project: 'P', code: 'B', days: 2, preds: [{ code: 'A', type, lag }] },
      ],
    });
    const s = serialSgs(ctx, pooled);
    const a = code(ctx, 'A');
    const b = code(ctx, 'B');
    return { s, ctx, a, b };
  };

  it('FS with lag 2: B starts 2 working days after A finishes', () => {
    const { s, a, b } = relCase('FS', 2);
    expect(iso(s.start[a])).toBe('2026-01-05'); // A Mon–Wed
    expect(iso(s.start[b])).toBe('2026-01-12'); // skip Thu, Fri → Mon
  });
  it('SS with lag 1: B starts 1 working day after A starts', () => {
    const { s, b } = relCase('SS', 1);
    expect(iso(s.start[b])).toBe('2026-01-06');
  });
  it('FF with lag 1: B finishes 1 working day after A finishes', () => {
    const { s, b } = relCase('FF', 1);
    // A finishes end of Wed 7th → B must finish end of Thu 8th → B runs Wed–Thu
    expect(iso(s.finish[b] - 1)).toBe('2026-01-08');
    expect(iso(s.start[b])).toBe('2026-01-07');
  });
  it('SF with lag 3: B finishes no earlier than 3 working days after A starts', () => {
    const { s, b } = relCase('SF', 3);
    expect(iso(s.finish[b] - 1)).toBe('2026-01-07');
    expect(iso(s.start[b])).toBe('2026-01-06');
  });
  it('negative lag (lead) on FS', () => {
    const { s, b } = relCase('FS', -1);
    expect(iso(s.start[b])).toBe('2026-01-07');
  });
  it('the validator accepts all of them and catches a manual violation', () => {
    for (const t of ['FS', 'SS', 'FF', 'SF'] as RelType[]) {
      const { s, ctx, b } = relCase(t, 2);
      expect(validateSchedule(ctx, s, { checkCapacity: true, fixedRef: ctx.baseline }).ok).toBe(true);
      const broken = { ...s, start: [...s.start], finish: [...s.finish] };
      broken.start[b] -= 7;
      broken.finish[b] -= 7;
      const v = validateSchedule(ctx, broken, { checkCapacity: true, fixedRef: ctx.baseline });
      expect(v.counts.relationship + v.counts.data_date).toBeGreaterThan(0);
    }
  });
});

describe('serial SGS — resources, fixed work and data date', () => {
  const twoProjects = () =>
    ctxFrom(
      {
        projects: [{ key: 'P1', dataDate: '2026-01-05' }, { key: 'P2', dataDate: '2026-01-05' }],
        activities: [
          { project: 'P1', code: 'X1', days: 3 },
          { project: 'P1', code: 'Y1', days: 2, preds: [{ code: 'X1' }] },
          { project: 'P2', code: 'X2', days: 4 },
        ],
        resources: [{ project: 'P1', name: 'Crane', type: 'equipment' }, { project: 'P2', name: 'Crane', type: 'equipment' }],
        assignments: [
          { project: 'P1', code: 'X1', resource: 'Crane', units: 1 },
          { project: 'P1', code: 'Y1', resource: 'Crane', units: 1 },
          { project: 'P2', code: 'X2', resource: 'Crane', units: 1 },
        ],
      },
      { capacity: { Crane: 1 } },
    );

  it('never exceeds pooled capacity', () => {
    const { ctx } = twoProjects();
    for (const rule of PRIORITY_RULES) {
      const s = serialSgs(ctx, { ...pooled, rule });
      const [crane] = computeDemand(ctx, s, s.hires);
      expect(Math.max(...crane.total)).toBeLessThanOrEqual(1);
      expect(s.hires).toEqual({});
      expect(validateSchedule(ctx, s, { checkCapacity: true, fixedRef: ctx.baseline }).ok).toBe(true);
    }
  });

  it('keeps completed activities fixed and in-progress activities at their actual start', () => {
    const { ctx } = ctxFrom({
      projects: [{ key: 'P', dataDate: '2026-01-07' }],
      activities: [
        { project: 'P', code: 'DONE', days: 2, status: 'completed', actualStart: '2026-01-01', actualFinish: '2026-01-03' },
        { project: 'P', code: 'RUN', days: 3, status: 'in_progress', actualStart: '2026-01-05', preds: [{ code: 'DONE' }] },
        { project: 'P', code: 'NEXT', days: 1, preds: [{ code: 'RUN' }] },
        { project: 'P', code: 'FREE', days: 1 },
      ],
      resources: [{ project: 'P', name: 'Crew' }],
      assignments: [{ project: 'P', code: 'RUN', resource: 'Crew', units: 1 }, { project: 'P', code: 'FREE', resource: 'Crew', units: 1 }],
    }, { capacity: { Crew: 1 } });
    const s = serialSgs(ctx, pooled);
    const done = code(ctx, 'DONE');
    const run = code(ctx, 'RUN');
    expect(iso(s.start[done])).toBe('2026-01-01');
    expect(iso(s.finish[done])).toBe('2026-01-03');
    expect(iso(s.start[run])).toBe('2026-01-05'); // actual start kept
    expect(iso(s.finish[run] - 1)).toBe('2026-01-09'); // 3 remaining days from the data date (Wed–Fri)
    expect(iso(s.start[code(ctx, 'NEXT')])).toBe('2026-01-12');
    // FREE competes with the in-progress RUN for the single crew → after it
    expect(iso(s.start[code(ctx, 'FREE')])).toBe('2026-01-12');
    expect(validateSchedule(ctx, s, { checkCapacity: true, fixedRef: ctx.baseline }).ok).toBe(true);
    // moving a completed activity is caught
    const moved = { ...s, start: [...s.start], finish: [...s.finish] };
    moved.start[done] += 1;
    expect(validateSchedule(ctx, moved, { checkCapacity: true, fixedRef: ctx.baseline }).counts.fixed).toBe(1);
  });

  it('never schedules before the data date', () => {
    const { ctx } = ctxFrom({
      projects: [{ key: 'P', dataDate: '2026-03-04' }],
      activities: [{ project: 'P', code: 'A', days: 2, earlyStart: '2026-02-02', earlyFinish: '2026-02-04' }, { project: 'P', code: 'B', days: 1 }],
    });
    const s = serialSgs(ctx, pooled);
    for (let i = 0; i < ctx.acts.length; i++) expect(s.start[i]).toBeGreaterThanOrEqual(ctx.acts[i].minStart);
    expect(iso(s.start[0])).toBe('2026-03-04');
  });

  it('hires (and reports) units a single activity needs beyond capacity', () => {
    const { ctx } = ctxFrom({
      projects: [{ key: 'P', dataDate: '2026-01-05' }],
      activities: [{ project: 'P', code: 'BIG', days: 2 }],
      resources: [{ project: 'P', name: 'Crane', type: 'equipment' }],
      assignments: [{ project: 'P', code: 'BIG', resource: 'Crane', units: 3 }],
    }, { capacity: { Crane: 2 } });
    const s = serialSgs(ctx, pooled);
    expect(Object.values(s.hires[ctx.groups[0].id])).toEqual([1, 1]);
    expect(validateSchedule(ctx, s, { checkCapacity: true, fixedRef: ctx.baseline }).ok).toBe(true);
    expect(validateSchedule(ctx, { ...s, hires: {} }, { checkCapacity: true, fixedRef: ctx.baseline }).counts.capacity).toBe(2);
  });

  it('within-float window hires instead of delaying a critical activity', () => {
    const { ctx } = twoProjects();
    const s = serialSgs(ctx, { rule: 'MIN_TF', mode: 'pooled', window: 'float', hire: 'window' });
    // every project keeps its logic-only finish
    for (let i = 0; i < ctx.acts.length; i++) expect(s.start[i]).toBeLessThanOrEqual(Math.max(ctx.cpm.es[i], ctx.cpm.ls[i]));
    expect(Object.keys(s.hires).length).toBe(1);
    expect(validateSchedule(ctx, s, { checkCapacity: true, fixedRef: ctx.baseline }).ok).toBe(true);
  });
});

describe('serial SGS — randomised property test', () => {
  it('produces feasible schedules for random multi-project networks', () => {
    let seed = 12345;
    const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
    const types: RelType[] = ['FS', 'SS', 'FF', 'SF'];
    for (let trial = 0; trial < 25; trial++) {
      const projects = [{ key: 'A', dataDate: '2026-01-05' }, { key: 'B', dataDate: '2026-01-12' }, { key: 'C', dataDate: '2026-01-07' }];
      const activities: ActSpec[] = [];
      const assignments: { project: string; code: string; resource: string; units: number }[] = [];
      for (const p of projects) {
        const n = 6 + Math.floor(rnd() * 8);
        for (let k = 0; k < n; k++) {
          const preds = [];
          for (let j = 0; j < k; j++) if (rnd() < 0.25) preds.push({ code: `T${j}`, type: types[Math.floor(rnd() * 4)], lag: Math.floor(rnd() * 5) - 1 });
          activities.push({ project: p.key, code: `T${k}`, days: rnd() < 0.1 ? 0 : 1 + Math.floor(rnd() * 6), preds });
          for (const r of ['Crane', 'Crew']) if (rnd() < 0.6) assignments.push({ project: p.key, code: `T${k}`, resource: r, units: 1 + Math.floor(rnd() * 3) });
        }
      }
      const resources = projects.flatMap((p) => [{ project: p.key, name: 'Crane', type: 'equipment' as const }, { project: p.key, name: 'Crew' }]);
      const { ctx, settings } = ctxFrom({ projects, activities, resources, assignments: assignments.filter((a) => activities.find((x) => x.project === a.project && x.code === a.code)!.days > 0) }, { capacity: { Crane: 3, Crew: 4 } });
      for (const window of ['none', 'float', 'deadline'] as const) {
        for (const rule of PRIORITY_RULES) {
          const opts: SgsOptions = { rule, mode: 'pooled', window, hire: window === 'none' ? 'unavoidable' : 'window' };
          const s = serialSgs(ctx, opts);
          const v = validateSchedule(ctx, s, { checkCapacity: true, fixedRef: ctx.baseline });
          expect(v.violations, `trial ${trial} ${window} ${rule}`).toEqual([]);
          const j = justify(ctx, s, opts);
          expect(validateSchedule(ctx, j, { checkCapacity: true, fixedRef: ctx.baseline }).violations).toEqual([]);
          // justification never lengthens a project
          for (let p = 0; p < ctx.projects.length; p++) {
            const end = (x: { finish: number[] }) => Math.max(...ctx.acts.filter((a) => a.projectIdx === p).map((a) => x.finish[a.idx]));
            expect(end(j)).toBeLessThanOrEqual(end(s));
          }
          // durations unchanged
          ctx.acts.forEach((a, i) => expect(a.cal.countWorkdays(j.start[i], j.finish[i])).toBe(a.durationDays));
        }
      }
      for (const sc of runScenarios(ctx, settings)) {
        if (sc.enforcesCapacity) expect(sc.validation.violations, `${trial} ${sc.id}`).toEqual([]);
        else expect(sc.validation.counts.relationship + sc.validation.counts.duration).toBe(0);
      }
    }
  });
});
