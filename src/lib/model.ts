/**
 * Normalized internal model built from one or more Primavera P6 XER files.
 *
 * Time convention: all dates are integer "day numbers" (days since 1970-01-01, UTC).
 * Activity spans are half-open working-day intervals [start, finish): work happens on the
 * working days d with start <= d < finish. A zero-duration milestone has start === finish.
 */

export type DayNum = number;

export type RelType = 'FS' | 'SS' | 'FF' | 'SF';
export type ResourceType = 'labor' | 'equipment' | 'material';
export type ActivityStatus = 'not_started' | 'in_progress' | 'completed';
export type ActivityKind = 'task' | 'start_milestone' | 'finish_milestone' | 'level_of_effort' | 'wbs_summary';

export interface Calendar {
  /** Key unique across files: `${fileId}:${clndr_id}` */
  key: string;
  clndrId: string;
  name: string;
  dayHours: number;
  /** Index 0 = Sunday ... 6 = Saturday */
  workWeek: boolean[];
  /** Non-working exception days */
  holidays: DayNum[];
  /** Working exception days on normally non-working weekdays */
  extraWorkdays: DayNum[];
  /** True when the workweek was parsed from clndr_data; false when a default was applied */
  parsedFromXer: boolean;
}

export interface Project {
  /** Key unique across files: `${fileId}:${proj_id}` */
  key: string;
  fileId: string;
  fileName: string;
  projId: string;
  shortName: string;
  /** Display name, disambiguated when the same project appears in more than one file */
  displayName: string;
  name: string;
  dataDate: DayNum | null;
  planStart: DayNum | null;
  planEnd: DayNum | null;
  scheduledEnd: DayNum | null;
  calendarKey: string | null;
  /** P6 priority_num (1 = highest in P6). Informational only. */
  p6Priority: number | null;
}

export interface Activity {
  /** Key unique across files: `${fileId}:${task_id}` */
  key: string;
  projectKey: string;
  taskId: string;
  code: string;
  name: string;
  kind: ActivityKind;
  status: ActivityStatus;
  calendarKey: string;
  /** Original (planned) duration in hours */
  targetHours: number;
  /** Remaining duration in hours */
  remainHours: number;
  /** Remaining duration in working days of the activity's calendar (what the scheduler uses) */
  durationDays: number;
  /** Original total duration in working days */
  targetDays: number;
  totalFloatHours: number | null;
  earlyStart: DayNum | null;
  earlyFinish: DayNum | null;
  lateStart: DayNum | null;
  lateFinish: DayNum | null;
  targetStart: DayNum | null;
  targetFinish: DayNum | null;
  actualStart: DayNum | null;
  actualFinish: DayNum | null;
  /** Date strings exactly as in the XER, for traceability */
  raw: Record<string, string>;
}

export interface Relationship {
  key: string;
  predKey: string;
  succKey: string;
  type: RelType;
  lagHours: number;
  /** Lag in working days (rounded), measured on the successor's calendar */
  lagDays: number;
}

export interface Resource {
  /** Key unique across files: `${fileId}:${rsrc_id}` or `csv:${name}` */
  key: string;
  rsrcId: string;
  name: string;
  shortName: string;
  type: ResourceType;
  /** Max units available (from RSRCRATE max_qty_per_hr) or null if unknown */
  maxUnits: number | null;
  /** Cost per hour per unit (RSRCRATE cost_per_qty) or null */
  costPerHour: number | null;
  source: 'xer' | 'csv';
  fileId: string;
}

export interface Assignment {
  key: string;
  activityKey: string;
  resourceKey: string;
  projectKey: string;
  /** Planned total quantity (hours for labor/equipment) */
  targetQty: number;
  remainQty: number;
  targetCost: number | null;
  /** Units used per working day while the activity runs (target_qty / duration_hours) */
  unitsPerDay: number;
  source: 'xer' | 'csv';
}

export type IssueSeverity = 'error' | 'warning' | 'info';

export interface DataIssue {
  severity: IssueSeverity;
  code: string;
  message: string;
  fileId?: string;
  projectKey?: string;
}

export interface TableSummary {
  name: string;
  fields: string[];
  rowCount: number;
}

export interface FileSummary {
  fileId: string;
  fileName: string;
  ok: boolean;
  header: string[];
  tables: TableSummary[];
  projectKeys: string[];
  issues: DataIssue[];
}

export interface PortfolioModel {
  files: FileSummary[];
  projects: Project[];
  activities: Activity[];
  relationships: Relationship[];
  resources: Resource[];
  assignments: Assignment[];
  calendars: Calendar[];
  issues: DataIssue[];
}

export const emptyModel = (): PortfolioModel => ({
  files: [],
  projects: [],
  activities: [],
  relationships: [],
  resources: [],
  assignments: [],
  calendars: [],
  issues: [],
});
