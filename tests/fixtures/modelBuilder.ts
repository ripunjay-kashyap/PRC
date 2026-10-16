import { dayFromYMD } from '../../src/lib/calendar';
import type { Activity, ActivityStatus, PortfolioModel, RelType, ResourceType } from '../../src/lib/model';
import { emptyModel } from '../../src/lib/model';

export const D = (iso: string) => dayFromYMD(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)), Number(iso.slice(8, 10)));

export interface ActSpec {
  project: string;
  code: string;
  days: number;
  kind?: Activity['kind'];
  status?: ActivityStatus;
  actualStart?: string;
  actualFinish?: string;
  earlyStart?: string;
  earlyFinish?: string;
  preds?: { code: string; type?: RelType; lag?: number }[];
}

export interface ModelSpec {
  projects: { key: string; dataDate: string; planEnd?: string }[];
  activities: ActSpec[];
  resources?: { project: string; name: string; type?: ResourceType; max?: number | null; costPerHour?: number | null }[];
  assignments?: { project: string; code: string; resource: string; units: number }[];
  workWeek?: boolean[];
  holidays?: string[];
}

/** Build a PortfolioModel directly (8 h/day calendar, Mon–Fri by default). */
export function makeModel(spec: ModelSpec): PortfolioModel {
  const m = emptyModel();
  m.calendars.push({
    key: 'cal', clndrId: '1', name: 'Std', dayHours: 8, parsedFromXer: true,
    workWeek: spec.workWeek ?? [false, true, true, true, true, true, false],
    holidays: (spec.holidays ?? []).map(D), extraWorkdays: [],
  });
  for (const p of spec.projects) {
    m.projects.push({
      key: p.key, fileId: p.key, fileName: `${p.key}.xer`, projId: p.key, shortName: p.key, displayName: p.key, name: p.key,
      dataDate: D(p.dataDate), planStart: D(p.dataDate), planEnd: p.planEnd ? D(p.planEnd) : null, scheduledEnd: null,
      calendarKey: 'cal', p6Priority: null,
    });
  }
  for (const a of spec.activities) {
    const kind = a.kind ?? (a.days === 0 ? 'start_milestone' : 'task');
    m.activities.push({
      key: `${a.project}:${a.code}`, projectKey: a.project, taskId: a.code, code: a.code, name: a.code, kind,
      status: a.status ?? 'not_started', calendarKey: 'cal', targetHours: a.days * 8, remainHours: a.days * 8,
      durationDays: a.days, targetDays: a.days, totalFloatHours: null,
      earlyStart: a.earlyStart ? D(a.earlyStart) : null, earlyFinish: a.earlyFinish ? D(a.earlyFinish) : null,
      lateStart: null, lateFinish: null, targetStart: null, targetFinish: null,
      actualStart: a.actualStart ? D(a.actualStart) : null, actualFinish: a.actualFinish ? D(a.actualFinish) : null, raw: {},
    });
    for (const p of a.preds ?? []) {
      m.relationships.push({
        key: `${a.project}:${p.code}->${a.code}`, predKey: `${a.project}:${p.code}`, succKey: `${a.project}:${a.code}`,
        type: p.type ?? 'FS', lagHours: (p.lag ?? 0) * 8, lagDays: p.lag ?? 0,
      });
    }
  }
  for (const r of spec.resources ?? []) {
    m.resources.push({
      key: `${r.project}:${r.name}`, rsrcId: r.name, name: r.name, shortName: r.name, type: r.type ?? 'labor',
      maxUnits: r.max ?? null, costPerHour: r.costPerHour ?? null, source: 'csv', fileId: r.project,
    });
  }
  for (const a of spec.assignments ?? []) {
    const act = m.activities.find((x) => x.key === `${a.project}:${a.code}`)!;
    m.assignments.push({
      key: `${a.project}:${a.code}:${a.resource}`, activityKey: act.key, resourceKey: `${a.project}:${a.resource}`, projectKey: a.project,
      targetQty: a.units * act.targetHours, remainQty: a.units * act.targetHours, targetCost: null, unitsPerDay: a.units, source: 'csv',
    });
  }
  return m;
}
