import {
  DEFAULT_WORKWEEK,
  WorkCalendar,
  finishBoundaryFromP6,
  parseClndrData,
  startBoundaryFromP6,
} from '../calendar';
import type {
  Activity,
  ActivityKind,
  ActivityStatus,
  Assignment,
  Calendar,
  DataIssue,
  FileSummary,
  PortfolioModel,
  Project,
  RelType,
  Relationship,
  Resource,
  ResourceType,
} from '../model';
import { emptyModel } from '../model';
import { parseRawXer, type RawXer } from './rawParser';

export const REQUIRED_TABLES = ['PROJECT', 'TASK'] as const;
export const OPTIONAL_TABLES = ['TASKPRED', 'CALENDAR', 'RSRC', 'TASKRSRC', 'RSRCRATE', 'PROJWBS'] as const;

const num = (v: string | undefined): number | null => {
  if (v === undefined || v.trim() === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

const TASK_KIND: Record<string, ActivityKind> = {
  TT_Task: 'task',
  TT_Rsrc: 'task',
  TT_Mile: 'start_milestone',
  TT_FinMile: 'finish_milestone',
  TT_LOE: 'level_of_effort',
  TT_WBS: 'wbs_summary',
};

const STATUS: Record<string, ActivityStatus> = {
  TK_NotStart: 'not_started',
  TK_Active: 'in_progress',
  TK_Complete: 'completed',
};

const REL: Record<string, RelType> = { PR_FS: 'FS', PR_SS: 'SS', PR_FF: 'FF', PR_SF: 'SF' };

const RSRC_TYPE: Record<string, ResourceType> = {
  RT_Labor: 'labor',
  RT_Equip: 'equipment',
  RT_Mat: 'material',
};

export const DEFAULT_DAY_HOURS = 8;

/** Convert an hour count to working days for a calendar with `dayHours` hours per day. */
export function hoursToDays(hours: number, dayHours: number = DEFAULT_DAY_HOURS): number {
  const dh = dayHours > 0 ? dayHours : DEFAULT_DAY_HOURS;
  if (!Number.isFinite(hours) || hours <= 0) return 0;
  return Math.ceil(hours / dh - 1e-9);
}

/** Units of a resource used per working hour/day: e.g. 80 h over a 40 h activity = 2 units. */
export function unitsPerDay(targetQty: number, durationHours: number): number {
  if (!Number.isFinite(targetQty) || !Number.isFinite(durationHours) || durationHours <= 0) return 0;
  return targetQty / durationHours;
}

export interface FileParseResult {
  summary: FileSummary;
  model: PortfolioModel;
}

/** Parse one XER file into a model fragment. Never throws for bad input; reports issues instead. */
export function parseXerFile(
  input: ArrayBuffer | Uint8Array | string,
  fileId: string,
  fileName: string,
): FileParseResult {
  const raw = parseRawXer(input);
  return buildFileModel(raw, fileId, fileName);
}

export function buildFileModel(raw: RawXer, fileId: string, fileName: string): FileParseResult {
  const model = emptyModel();
  const issues: DataIssue[] = [];
  const issue = (severity: DataIssue['severity'], code: string, message: string, projectKey?: string) =>
    issues.push({ severity, code, message, fileId, projectKey });

  for (const e of raw.errors) issue('error', 'invalid_file', e);
  for (const w of raw.warnings) issue('warning', 'parse_warning', w);

  const summary: FileSummary = {
    fileId,
    fileName,
    ok: raw.errors.length === 0,
    header: raw.header,
    tables: raw.tableOrder.map((name) => {
      const t = raw.tables.get(name)!;
      return { name, fields: t.fields, rowCount: t.rows.length };
    }),
    projectKeys: [],
    issues,
  };
  if (raw.errors.length > 0) {
    model.files.push(summary);
    model.issues.push(...issues);
    return { summary, model };
  }

  for (const t of REQUIRED_TABLES) {
    if (!raw.tables.has(t)) issue('error', 'missing_table', `Required table ${t} is missing.`);
  }
  const rows = (t: string) => raw.tables.get(t)?.rows ?? [];

  // ---- Calendars ----------------------------------------------------------
  const calendars = new Map<string, Calendar>();
  if (!raw.tables.has('CALENDAR')) {
    issue('warning', 'missing_calendar', 'No CALENDAR table: a default Mon–Fri, 8 h/day calendar is used (editable in Settings).');
  }
  for (const r of rows('CALENDAR')) {
    const parsed = parseClndrData(r.clndr_data);
    const dayHours = num(r.day_hr_cnt);
    const cal: Calendar = {
      key: `${fileId}:${r.clndr_id}`,
      clndrId: r.clndr_id,
      name: r.clndr_name || `Calendar ${r.clndr_id}`,
      dayHours: dayHours && dayHours > 0 ? dayHours : DEFAULT_DAY_HOURS,
      workWeek: parsed.workWeek ?? [...DEFAULT_WORKWEEK],
      holidays: parsed.holidays,
      extraWorkdays: parsed.extraWorkdays,
      parsedFromXer: parsed.workWeek !== null,
    };
    if (!dayHours) issue('warning', 'calendar_hours', `Calendar "${cal.name}" has no day_hr_cnt; 8 h/day assumed.`);
    if (!parsed.workWeek) {
      issue('warning', 'calendar_workweek', `Calendar "${cal.name}" workweek could not be read from clndr_data; Mon–Fri assumed (editable).`);
    }
    calendars.set(r.clndr_id, cal);
  }
  const defaultCalId = rows('CALENDAR').find((r) => r.default_flag === 'Y')?.clndr_id;
  const fallbackCalendar = (): Calendar => {
    const key = `${fileId}:__default`;
    let cal = calendars.get('__default');
    if (!cal) {
      cal = {
        key,
        clndrId: '__default',
        name: 'Default Mon–Fri 8h (assumed)',
        dayHours: DEFAULT_DAY_HOURS,
        workWeek: [...DEFAULT_WORKWEEK],
        holidays: [],
        extraWorkdays: [],
        parsedFromXer: false,
      };
      calendars.set('__default', cal);
    }
    return cal;
  };
  const calFor = (id: string | undefined, projectCal?: string | null): Calendar => {
    if (id && calendars.has(id)) return calendars.get(id)!;
    if (projectCal && calendars.has(projectCal)) return calendars.get(projectCal)!;
    if (defaultCalId && calendars.has(defaultCalId)) return calendars.get(defaultCalId)!;
    return fallbackCalendar();
  };

  // ---- Projects -----------------------------------------------------------
  const wbsRoots = new Map<string, string>();
  for (const w of rows('PROJWBS')) if (w.proj_node_flag === 'Y') wbsRoots.set(w.proj_id, w.wbs_name);

  const projects = new Map<string, Project>();
  for (const r of rows('PROJECT')) {
    if (r.project_flag && r.project_flag !== 'Y') continue;
    const key = `${fileId}:${r.proj_id}`;
    const dataDate = startBoundaryFromP6(r.last_recalc_date);
    const p: Project = {
      key,
      fileId,
      fileName,
      projId: r.proj_id,
      shortName: r.proj_short_name || `Project ${r.proj_id}`,
      displayName: r.proj_short_name || `Project ${r.proj_id}`,
      name: wbsRoots.get(r.proj_id) || r.proj_short_name || `Project ${r.proj_id}`,
      dataDate: dataDate !== null ? Math.floor(dataDate) : null,
      planStart: startBoundaryFromP6(r.plan_start_date),
      planEnd: finishBoundaryFromP6(r.plan_end_date),
      scheduledEnd: finishBoundaryFromP6(r.scd_end_date),
      calendarKey: r.clndr_id && calendars.has(r.clndr_id) ? calendars.get(r.clndr_id)!.key : null,
      p6Priority: num(r.priority_num),
    };
    // Data date is the start of the day given; P6 stores e.g. "2026-10-16 00:00".
    const dd = r.last_recalc_date ? r.last_recalc_date.slice(0, 10) : '';
    if (!dd) issue('warning', 'no_data_date', `Project ${p.shortName}: no data date (last_recalc_date); the earliest activity date is used.`, key);
    else p.dataDate = startBoundaryFromP6(`${dd} 00:00`);
    if (p.planEnd === null) {
      issue(
        'warning',
        'no_plan_end',
        p.scheduledEnd !== null
          ? `Project ${p.shortName}: no planned end date (plan_end_date); the P6 scheduled finish is the default deadline.`
          : `Project ${p.shortName}: no planned end date and no scheduled finish; set a deadline in Settings.`,
        key,
      );
    }
    projects.set(r.proj_id, p);
    summary.projectKeys.push(key);
  }
  if (projects.size === 0 && raw.tables.has('PROJECT')) issue('error', 'no_projects', 'The PROJECT table has no projects.');

  // ---- Activities ---------------------------------------------------------
  const activities = new Map<string, Activity>();
  let nonIntegerDurations = 0;
  let loeCount = 0;
  for (const r of rows('TASK')) {
    const project = projects.get(r.proj_id);
    if (!project) {
      issue('warning', 'orphan_task', `Activity ${r.task_code} references unknown project ${r.proj_id}; skipped.`);
      continue;
    }
    const cal = calFor(r.clndr_id, project.calendarKey ? project.calendarKey.split(':')[1] : null);
    const wc = new WorkCalendar(cal);
    const kind = TASK_KIND[r.task_type] ?? 'task';
    if (!TASK_KIND[r.task_type]) issue('warning', 'task_type', `Activity ${r.task_code}: unknown task_type "${r.task_type}" treated as a task.`, project.key);
    if (kind === 'level_of_effort' || kind === 'wbs_summary') loeCount++;
    const status = STATUS[r.status_code] ?? 'not_started';
    const targetHours = num(r.target_drtn_hr_cnt) ?? 0;
    const remainHours = num(r.remain_drtn_hr_cnt) ?? (status === 'completed' ? 0 : targetHours);
    const actualStart = startBoundaryFromP6(r.act_start_date);
    const actualFinish = finishBoundaryFromP6(r.act_end_date);
    const isMilestone = kind === 'start_milestone' || kind === 'finish_milestone';
    if (!isMilestone && (targetHours % cal.dayHours !== 0 || remainHours % cal.dayHours !== 0)) nonIntegerDurations++;

    let durationDays: number;
    if (isMilestone) durationDays = 0;
    else if (status === 'completed') {
      durationDays =
        actualStart !== null && actualFinish !== null
          ? wc.countWorkdays(actualStart, actualFinish)
          : hoursToDays(targetHours, cal.dayHours);
    } else durationDays = hoursToDays(remainHours, cal.dayHours);

    const a: Activity = {
      key: `${fileId}:${r.task_id}`,
      projectKey: project.key,
      taskId: r.task_id,
      code: r.task_code,
      name: r.task_name,
      kind,
      status,
      calendarKey: cal.key,
      targetHours,
      remainHours,
      durationDays,
      targetDays: isMilestone ? 0 : hoursToDays(targetHours, cal.dayHours),
      totalFloatHours: num(r.total_float_hr_cnt),
      earlyStart: startBoundaryFromP6(r.early_start_date),
      earlyFinish: finishBoundaryFromP6(r.early_end_date),
      lateStart: startBoundaryFromP6(r.late_start_date),
      lateFinish: finishBoundaryFromP6(r.late_end_date),
      targetStart: startBoundaryFromP6(r.target_start_date),
      targetFinish: finishBoundaryFromP6(r.target_end_date),
      actualStart,
      actualFinish,
      raw: {
        early_start_date: r.early_start_date ?? '',
        early_end_date: r.early_end_date ?? '',
        target_start_date: r.target_start_date ?? '',
        target_end_date: r.target_end_date ?? '',
        act_start_date: r.act_start_date ?? '',
        act_end_date: r.act_end_date ?? '',
        total_float_hr_cnt: r.total_float_hr_cnt ?? '',
      },
    };
    if (status === 'in_progress' && actualStart === null) {
      issue('warning', 'in_progress_no_actual', `Activity ${a.code} is in progress but has no actual start.`, project.key);
    }
    if (status === 'completed' && (actualStart === null || actualFinish === null)) {
      issue('warning', 'complete_no_actual', `Activity ${a.code} is complete but has no actual dates; planned dates kept fixed.`, project.key);
    }
    activities.set(r.task_id, a);
  }
  if (nonIntegerDurations > 0) {
    issue('info', 'fractional_durations', `${nonIntegerDurations} activities have durations that are not whole working days; they are rounded up to whole days.`);
  }
  if (loeCount > 0) {
    issue('info', 'loe', `${loeCount} level-of-effort / WBS-summary activities are kept at their P6 dates and are not leveled.`);
  }
  for (const p of projects.values()) {
    const n = [...activities.values()].filter((a) => a.projectKey === p.key).length;
    if (n === 0) issue('warning', 'empty_project', `Project ${p.shortName} has no activities.`, p.key);
    if (p.dataDate === null) {
      const starts = [...activities.values()]
        .filter((a) => a.projectKey === p.key)
        .map((a) => a.earlyStart ?? a.targetStart)
        .filter((d): d is number => d !== null);
      p.dataDate = starts.length ? Math.min(...starts) : null;
    }
  }

  // ---- Relationships ------------------------------------------------------
  if (!raw.tables.has('TASKPRED')) issue('warning', 'missing_taskpred', 'No TASKPRED table: activities have no logic links.');
  let crossFile = 0;
  for (const r of rows('TASKPRED')) {
    const succ = activities.get(r.task_id);
    const pred = activities.get(r.pred_task_id);
    if (!succ || !pred) {
      crossFile++;
      continue;
    }
    const type = REL[r.pred_type];
    if (!type) {
      issue('warning', 'rel_type', `Relationship ${r.task_pred_id}: unknown type "${r.pred_type}"; treated as FS.`);
    }
    const lagHours = num(r.lag_hr_cnt) ?? 0;
    const cal = calendars.get(succ.calendarKey.split(':')[1]) ?? fallbackCalendar();
    const lagDays = Math.sign(lagHours) * Math.round(Math.abs(lagHours) / cal.dayHours);
    if (lagHours % cal.dayHours !== 0) {
      issue('info', 'fractional_lag', `Relationship ${pred.code} → ${succ.code}: lag ${lagHours} h rounded to ${lagDays} working days.`);
    }
    model.relationships.push({
      key: `${fileId}:${r.task_pred_id || `${r.pred_task_id}-${r.task_id}`}`,
      predKey: pred.key,
      succKey: succ.key,
      type: type ?? 'FS',
      lagHours,
      lagDays,
    } satisfies Relationship);
  }
  if (crossFile > 0) issue('warning', 'dangling_rel', `${crossFile} relationships reference activities not in this file; ignored.`);

  // ---- Resources ----------------------------------------------------------
  const hasRsrc = raw.tables.has('RSRC');
  const hasTaskRsrc = raw.tables.has('TASKRSRC');
  if (!hasRsrc || !hasTaskRsrc) {
    issue(
      'warning',
      'no_resources',
      `No resource data (${[!hasRsrc && 'RSRC', !hasTaskRsrc && 'TASKRSRC'].filter(Boolean).join(', ')} missing). ` +
        'Resource conflicts cannot be analysed until assignments are imported (CSV) on the Upload page.',
    );
  }
  if (hasRsrc && !raw.tables.has('RSRCRATE')) {
    issue('warning', 'no_rsrcrate', 'No RSRCRATE table: resource capacities and cost rates must be entered in Settings.');
  }
  const rates = new Map<string, Record<string, string>[]>();
  for (const r of rows('RSRCRATE')) {
    const list = rates.get(r.rsrc_id) ?? [];
    list.push(r);
    rates.set(r.rsrc_id, list);
  }
  const resources = new Map<string, Resource>();
  for (const r of rows('RSRC')) {
    const rateRows = (rates.get(r.rsrc_id) ?? []).sort((a, b) => (a.start_date ?? '').localeCompare(b.start_date ?? ''));
    const rate = rateRows[rateRows.length - 1];
    const type = RSRC_TYPE[r.rsrc_type] ?? 'labor';
    const res: Resource = {
      key: `${fileId}:${r.rsrc_id}`,
      rsrcId: r.rsrc_id,
      name: r.rsrc_name || r.rsrc_short_name || `Resource ${r.rsrc_id}`,
      shortName: r.rsrc_short_name || r.rsrc_name || r.rsrc_id,
      type,
      maxUnits: rate ? num(rate.max_qty_per_hr) : null,
      costPerHour: rate ? num(rate.cost_per_qty) : null,
      source: 'xer',
      fileId,
    };
    resources.set(r.rsrc_id, res);
  }
  for (const r of rows('TASKRSRC')) {
    const act = activities.get(r.task_id);
    if (!act) continue;
    let res = resources.get(r.rsrc_id);
    if (!res) {
      res = {
        key: `${fileId}:${r.rsrc_id}`,
        rsrcId: r.rsrc_id,
        name: `Unknown resource ${r.rsrc_id}`,
        shortName: r.rsrc_id,
        type: 'labor',
        maxUnits: null,
        costPerHour: null,
        source: 'xer',
        fileId,
      };
      resources.set(r.rsrc_id, res);
      issue('warning', 'unknown_rsrc', `Assignment on ${act.code} references resource ${r.rsrc_id} not in RSRC.`);
    }
    const targetQty = num(r.target_qty) ?? 0;
    const durHours = act.targetHours > 0 ? act.targetHours : act.remainHours;
    model.assignments.push({
      key: `${fileId}:${r.taskrsrc_id || `${r.task_id}-${r.rsrc_id}`}`,
      activityKey: act.key,
      resourceKey: res.key,
      projectKey: act.projectKey,
      targetQty,
      remainQty: num(r.remain_qty) ?? targetQty,
      targetCost: num(r.target_cost),
      unitsPerDay: unitsPerDay(targetQty, durHours),
      source: 'xer',
    });
  }

  model.files.push(summary);
  model.projects.push(...projects.values());
  model.activities.push(...activities.values());
  model.resources.push(...resources.values());
  model.calendars.push(...calendars.values());
  model.issues.push(...issues);
  summary.ok = !issues.some((i) => i.severity === 'error');
  return { summary, model };
}

/** Merge fragments from several files; disambiguates duplicate project names. */
export function mergeModels(parts: PortfolioModel[]): PortfolioModel {
  const out = emptyModel();
  for (const p of parts) {
    out.files.push(...p.files);
    out.projects.push(...p.projects);
    out.activities.push(...p.activities);
    out.relationships.push(...p.relationships);
    out.resources.push(...p.resources);
    out.assignments.push(...p.assignments);
    out.calendars.push(...p.calendars);
    out.issues.push(...p.issues);
  }
  const byShort = new Map<string, Project[]>();
  for (const p of out.projects) {
    const list = byShort.get(p.shortName) ?? [];
    list.push(p);
    byShort.set(p.shortName, list);
  }
  for (const [shortName, list] of byShort) {
    if (list.length < 2) continue;
    for (const p of list) p.displayName = `${shortName} [${p.fileName.replace(/\.xer$/i, '')}]`;
    const sameId = new Set(list.map((p) => p.projId)).size === 1;
    out.issues.push({
      severity: 'warning',
      code: 'duplicate_project',
      message:
        `Project "${shortName}" appears in ${list.length} files (${list.map((p) => p.fileName).join(', ')})` +
        (sameId ? ` with the same proj_id ${list[0].projId}; they may be versions of one project.` : '.') +
        ' They are analysed as separate projects competing for the same resource pool.',
    });
  }
  return out;
}
