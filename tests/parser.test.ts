import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseRawXer, decodeXer } from '../src/lib/xer/rawParser';
import { hoursToDays, mergeModels, parseXerFile, unitsPerDay } from '../src/lib/xer/buildModel';
import { buildXer, multiProjectXer, PROJECT_FIELDS, TASK_FIELDS } from './fixtures/xerBuilder';

const afs = readFileSync('samples/AFS.xer');
const afsSched = readFileSync('samples/AFS_scheduled.xer');

describe('raw XER parser — attached sample files', () => {
  it('reads every table with correct row counts (AFS.xer)', () => {
    const raw = parseRawXer(afs);
    expect(raw.errors).toEqual([]);
    expect(raw.encoding).toBe('windows-1252');
    expect(raw.tableOrder).toEqual(['CURRTYPE', 'FINTMPL', 'OBS', 'PROJECT', 'CALENDAR', 'PROJWBS', 'TASK', 'TASKPRED']);
    expect(raw.tables.get('TASK')!.rows).toHaveLength(35);
    expect(raw.tables.get('TASKPRED')!.rows).toHaveLength(45);
    expect(raw.tables.get('TASK')!.fields).toHaveLength(61);
    expect(raw.hasEndMarker).toBe(true);
  });

  it('reads SCHEDOPTIONS in the scheduled file', () => {
    const raw = parseRawXer(afsSched);
    expect(raw.tableOrder).toContain('SCHEDOPTIONS');
    expect(raw.tables.get('PROJECT')!.rows[0].scd_end_date).toBe('2026-12-24 18:00');
  });

  it('decodes windows-1252 characters (en dash in WBS name)', () => {
    const { model } = parseXerFile(afs, 'a', 'AFS.xer');
    expect(model.projects[0].name).toContain('AFS Tambaram – Plumbing');
    expect(model.projects[0].name).toContain('(2026–27)');
  });

  it('builds the model for AFS_scheduled.xer', () => {
    const { model, summary } = parseXerFile(afsSched, 'b', 'AFS_scheduled.xer');
    expect(summary.ok).toBe(true);
    expect(model.projects).toHaveLength(1);
    const p = model.projects[0];
    expect(p.shortName).toBe('AFS');
    expect(p.planEnd).toBeNull();
    expect(p.scheduledEnd).not.toBeNull();
    expect(model.activities).toHaveLength(35);
    expect(model.relationships).toHaveLength(45);
    expect(model.relationships.every((r) => r.type === 'FS' && r.lagHours === 0)).toBe(true);
    expect(model.calendars[0].workWeek).toEqual([false, true, true, true, true, true, false]);
    expect(model.calendars[0].dayHours).toBe(8);
    const a230 = model.activities.find((a) => a.code === 'A230')!;
    expect(a230.durationDays).toBe(10);
    expect(a230.totalFloatHours).toBe(0);
    expect(model.issues.some((i) => i.code === 'no_resources')).toBe(true);
  });

  it('flags the unscheduled AFS.xer file (no early dates) and missing deadline', () => {
    const { model } = parseXerFile(afs, 'a', 'AFS.xer');
    expect(model.activities.every((a) => a.earlyStart === null)).toBe(true);
    expect(model.issues.find((i) => i.code === 'no_plan_end')!.message).toMatch(/set a deadline/);
  });

  it('merges files and disambiguates duplicate projects', () => {
    const m = mergeModels([parseXerFile(afs, 'a', 'AFS.xer').model, parseXerFile(afsSched, 'b', 'AFS_scheduled.xer').model]);
    expect(m.projects.map((p) => p.displayName)).toEqual(['AFS [AFS]', 'AFS [AFS_scheduled]']);
    expect(new Set(m.activities.map((a) => a.key)).size).toBe(70);
    expect(m.issues.some((i) => i.code === 'duplicate_project')).toBe(true);
  });
});

describe('raw XER parser — synthetic fixtures', () => {
  it('parses multiple projects, resources, rates and all relationship types', () => {
    const { model } = parseXerFile(multiProjectXer(), 'm', 'multi.xer');
    expect(model.projects.map((p) => p.shortName)).toEqual(['ALPHA', 'BETA']);
    expect(model.activities).toHaveLength(6);
    expect(model.relationships.map((r) => r.type).sort()).toEqual(['FF', 'FS', 'FS', 'SF', 'SS']);
    expect(model.relationships.find((r) => r.type === 'SS')!.lagDays).toBe(1);
    expect(model.relationships.find((r) => r.type === 'FF')!.lagDays).toBe(2);
    const exop = model.resources.find((r) => r.shortName === 'EXOP')!;
    expect(exop.maxUnits).toBe(2);
    expect(exop.costPerHour).toBe(50);
    expect(model.resources.find((r) => r.shortName === 'CEM')!.type).toBe('material');
    expect(model.resources.find((r) => r.shortName === 'EXC')!.type).toBe('equipment');
    const asg = model.assignments.find((a) => a.resourceKey === exop.key)!;
    expect(asg.unitsPerDay).toBe(2); // 80 h over a 40 h activity
    const statuses = model.activities.map((a) => a.status);
    expect(statuses).toEqual(['completed', 'in_progress', 'not_started', 'not_started', 'not_started', 'not_started']);
    const done = model.activities.find((a) => a.code === 'A1')!;
    expect(done.durationDays).toBe(2);
    expect(model.activities.find((a) => a.code === 'A2')!.durationDays).toBe(3);
    expect(model.activities.find((a) => a.code === 'B0')!.kind).toBe('start_milestone');
    // fractional duration (20 h) rounds up to 3 days and is reported
    expect(model.activities.find((a) => a.code === 'B1')!.durationDays).toBe(3);
    expect(model.issues.some((i) => i.code === 'fractional_durations')).toBe(true);
    // the holiday exception (serial 46304 = 2026-10-09) was parsed
    expect(model.calendars[0].holidays).toContain(46304 - 25569);
  });

  it('reports missing tables instead of throwing', () => {
    const xer = buildXer([{ name: 'PROJECT', fields: PROJECT_FIELDS, rows: [['1', 'P', '', '2026-01-05 00:00', '', '', '', '']] }]);
    const { model, summary } = parseXerFile(xer, 'x', 'x.xer');
    expect(summary.ok).toBe(false);
    const codes = model.issues.map((i) => i.code);
    expect(codes).toContain('missing_table'); // TASK
    expect(codes).toContain('missing_calendar');
    expect(codes).toContain('missing_taskpred');
    expect(codes).toContain('no_resources');
  });

  it('handles empty values and short rows', () => {
    const xer = buildXer([
      { name: 'PROJECT', fields: PROJECT_FIELDS, rows: [['1', 'P', '', '', '', '', '', '']] },
      { name: 'TASK', fields: TASK_FIELDS, rows: [['5', '1', '', 'TT_Task', 'TK_NotStart', 'X1', 'Short row']] },
    ]);
    const { model } = parseXerFile(xer, 'x', 'x.xer');
    const a = model.activities[0];
    expect(a.code).toBe('X1');
    expect(a.durationDays).toBe(0);
    expect(a.totalFloatHours).toBeNull();
    expect(a.earlyStart).toBeNull();
    expect(model.calendars[0].parsedFromXer).toBe(false);
    expect(model.issues.some((i) => i.code === 'no_data_date')).toBe(true);
  });

  it('accepts LF line endings, UTF-8 BOM and a missing end marker', () => {
    const text = buildXer([{ name: 'PROJECT', fields: PROJECT_FIELDS, rows: [['1', 'Ünïcødé', '', '2026-01-05 00:00', '', '', '', '']] }], { eol: '\n', end: false });
    const bytes = new Uint8Array([0xef, 0xbb, 0xbf, ...new TextEncoder().encode(text)]);
    const raw = parseRawXer(bytes);
    expect(raw.encoding).toBe('utf-8');
    expect(raw.tables.get('PROJECT')!.rows[0].proj_short_name).toBe('Ünïcødé');
    expect(raw.warnings.some((w) => /end marker/.test(w))).toBe(true);
  });

  it('decodes windows-1252 bytes that are invalid UTF-8', () => {
    const bytes = new Uint8Array([0x41, 0x96, 0x42, 0xa3]); // A – B £
    expect(decodeXer(bytes)).toEqual({ text: 'A–B£', encoding: 'windows-1252' });
  });

  it('rejects files that are not XER', () => {
    const raw = parseRawXer('hello,world\n1,2');
    expect(raw.errors[0]).toMatch(/Not a Primavera XER/);
    const { summary } = parseXerFile('hello', 'x', 'x.txt');
    expect(summary.ok).toBe(false);
    expect(parseRawXer('').errors[0]).toMatch(/empty/);
  });
});

describe('unit conversions', () => {
  it('converts hours to working days using day_hr_cnt', () => {
    expect(hoursToDays(40, 8)).toBe(5);
    expect(hoursToDays(80, 8)).toBe(10);
    expect(hoursToDays(20, 8)).toBe(3);
    expect(hoursToDays(30, 10)).toBe(3);
    expect(hoursToDays(0, 8)).toBe(0);
    expect(hoursToDays(16, 0)).toBe(2); // invalid day_hr_cnt falls back to 8
  });
  it('computes units per day as target_qty / duration hours', () => {
    expect(unitsPerDay(80, 40)).toBe(2);
    expect(unitsPerDay(40, 40)).toBe(1);
    expect(unitsPerDay(20, 40)).toBe(0.5);
    expect(unitsPerDay(10, 0)).toBe(0);
  });
});
