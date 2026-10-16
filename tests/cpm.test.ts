import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { loadPortfolio } from '../src/lib/loader';
import { prepareContext } from '../src/lib/scheduling/cpm';
import { defaultSettings } from '../src/lib/settings';
import { dayToISO } from '../src/lib/calendar';

const files = [
  { name: 'AFS.xer', data: readFileSync('samples/AFS.xer') },
  { name: 'AFS_scheduled.xer', data: readFileSync('samples/AFS_scheduled.xer') },
];

describe('CPM on the attached files', () => {
  const model = loadPortfolio(files);
  const settings = defaultSettings(model);
  const ctx = prepareContext(model, [], settings);

  it('reproduces P6 early dates and total float for AFS_scheduled.xer', () => {
    const p6 = model.activities.filter((a) => a.projectKey === 'f2:4518');
    expect(p6).toHaveLength(35);
    let compared = 0;
    for (const a of p6) {
      const i = ctx.acts.findIndex((x) => x.key === a.key);
      expect(ctx.cpm.es[i], `${a.code} ES`).toBe(a.earlyStart);
      expect(ctx.cpm.ef[i], `${a.code} EF`).toBe(a.earlyFinish);
      expect(ctx.cpm.tf[i], `${a.code} TF`).toBe((a.totalFloatHours ?? 0) / 8);
      if (a.durationDays > 0) expect(ctx.cpm.ls[i], `${a.code} LS`).toBe(a.lateStart);
      compared++;
    }
    expect(compared).toBe(35);
    expect(dayToISO(ctx.cpm.projectFinish[1] - 1)).toBe('2026-12-24');
  });

  it('computes a CPM baseline for the unscheduled AFS.xer from its data date', () => {
    expect(ctx.projects[0].baselineFromCpm).toBe(true);
    expect(ctx.projects[1].baselineFromCpm).toBe(false);
    expect(ctx.issues.some((i) => i.code === 'unscheduled_project')).toBe(true);
    const idx = ctx.acts.filter((a) => a.projectIdx === 0).map((a) => a.idx);
    expect(Math.min(...idx.map((i) => ctx.baseline.start[i]))).toBe(ctx.projects[0].dataDate);
    // same logic and durations, starting 16 Oct instead of 27 Aug
    expect(dayToISO(ctx.cpm.projectFinish[0] - 1)).toBe('2027-02-15'); // 85 working days, independently checked
  });

  it('defaults the deadline to scd_end_date when plan_end_date is empty', () => {
    expect(settings.projects['f2:4518'].deadlineSource).toBe('scd_end');
    expect(settings.projects['f1:4518'].deadlineSource).toBe('none');
  });
});
