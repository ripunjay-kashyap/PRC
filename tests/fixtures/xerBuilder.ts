/** Build small synthetic XER files for tests. */
export interface XerTableSpec {
  name: string;
  fields: string[];
  rows: (string | number)[][];
}

export function buildXer(tables: XerTableSpec[], opts: { eol?: string; end?: boolean } = {}): string {
  const eol = opts.eol ?? '\r\n';
  const lines = ['ERMHDR\t25.12\t2026-10-16\tProject\tADMIN\ttest\tdb\tProject Management\tINR'];
  for (const t of tables) {
    lines.push(`%T\t${t.name}`);
    lines.push(`%F\t${t.fields.join('\t')}`);
    for (const r of t.rows) lines.push(`%R\t${r.map(String).join('\t')}`);
  }
  if (opts.end !== false) lines.push('%E');
  return lines.join(eol) + eol;
}

export const CAL_DATA_MON_FRI =
  '(0||CalendarData()(  (0||DaysOfWeek()(    (0||1()())    (0||2()(      (0||0(s|08:00|f|16:00)())))    (0||3()(      (0||0(s|08:00|f|16:00)())))    (0||4()(      (0||0(s|08:00|f|16:00)())))    (0||5()(      (0||0(s|08:00|f|16:00)())))    (0||6()(      (0||0(s|08:00|f|16:00)())))    (0||7()())))  (0||Exceptions()(    (0||0(d|46304)())))))';

export const PROJECT_FIELDS = ['proj_id', 'proj_short_name', 'clndr_id', 'last_recalc_date', 'plan_start_date', 'plan_end_date', 'scd_end_date', 'priority_num'];
export const TASK_FIELDS = [
  'task_id', 'proj_id', 'clndr_id', 'task_type', 'status_code', 'task_code', 'task_name', 'total_float_hr_cnt',
  'remain_drtn_hr_cnt', 'target_drtn_hr_cnt', 'act_start_date', 'act_end_date', 'early_start_date', 'early_end_date',
  'late_start_date', 'late_end_date', 'target_start_date', 'target_end_date',
];
export const PRED_FIELDS = ['task_pred_id', 'task_id', 'pred_task_id', 'pred_type', 'lag_hr_cnt'];
export const RSRC_FIELDS = ['rsrc_id', 'rsrc_name', 'rsrc_short_name', 'rsrc_type'];
export const TASKRSRC_FIELDS = ['taskrsrc_id', 'task_id', 'proj_id', 'rsrc_id', 'target_qty', 'remain_qty', 'target_cost', 'target_start_date', 'target_end_date'];
export const RATE_FIELDS = ['rsrc_rate_id', 'rsrc_id', 'max_qty_per_hr', 'cost_per_qty', 'start_date'];

/** Two projects, resources with rates, all four relationship types. */
export function multiProjectXer(): string {
  return buildXer([
    { name: 'PROJECT', fields: PROJECT_FIELDS, rows: [
      ['10', 'ALPHA', '1', '2026-01-05 00:00', '2026-01-05 00:00', '2026-02-27 17:00', '', '1'],
      ['20', 'BETA', '1', '2026-01-05 00:00', '2026-01-05 00:00', '', '2026-03-13 17:00', '2'],
    ] },
    { name: 'CALENDAR', fields: ['clndr_id', 'default_flag', 'clndr_name', 'day_hr_cnt', 'clndr_data'], rows: [['1', 'Y', 'Std', '8', CAL_DATA_MON_FRI]] },
    { name: 'TASK', fields: TASK_FIELDS, rows: [
      ['100', '10', '1', 'TT_Task', 'TK_Complete', 'A1', 'Done task', '0', '0', '16', '2026-01-05 08:00', '2026-01-06 16:00', '', '', '', '', '2026-01-05 08:00', '2026-01-06 16:00'],
      ['101', '10', '1', 'TT_Task', 'TK_Active', 'A2', 'Running task', '0', '24', '40', '2026-01-07 08:00', '', '2026-01-07 08:00', '2026-01-09 16:00', '', '', '2026-01-07 08:00', '2026-01-13 16:00'],
      ['102', '10', '1', 'TT_Task', 'TK_NotStart', 'A3', 'Excavation', '', '40', '40', '', '', '', '', '', '', '', ''],
      ['200', '20', '1', 'TT_Mile', 'TK_NotStart', 'B0', 'Start', '', '0', '0', '', '', '', '', '', '', '', ''],
      ['201', '20', '1', 'TT_Task', 'TK_NotStart', 'B1', 'Excavation B', '', '20', '20', '', '', '', '', '', '', '', ''],
      ['202', '20', '1', 'TT_Task', 'TK_NotStart', 'B2', 'Concrete B', '', '16', '16', '', '', '', '', '', '', '', ''],
    ] },
    { name: 'TASKPRED', fields: PRED_FIELDS, rows: [
      ['1', '101', '100', 'PR_FS', '0'],
      ['2', '102', '101', 'PR_SS', '8'],
      ['3', '201', '200', 'PR_FS', '0'],
      ['4', '202', '201', 'PR_FF', '16'],
      ['5', '202', '200', 'PR_SF', '0'],
    ] },
    { name: 'RSRC', fields: RSRC_FIELDS, rows: [
      ['1', 'Excavator Operator', 'EXOP', 'RT_Labor'],
      ['2', 'Excavator Driver - Project B', 'EXDR', 'RT_Labor'],
      ['3', 'Cement', 'CEM', 'RT_Mat'],
      ['4', 'Excavator', 'EXC', 'RT_Equip'],
    ] },
    { name: 'RSRCRATE', fields: RATE_FIELDS, rows: [
      ['1', '1', '2', '50', '2025-01-01 00:00'],
      ['2', '2', '1', '55', '2025-01-01 00:00'],
      ['3', '4', '1.5', '', '2025-01-01 00:00'],
    ] },
    { name: 'TASKRSRC', fields: TASKRSRC_FIELDS, rows: [
      ['1', '102', '10', '1', '80', '80', '4000', '', ''],
      ['2', '201', '20', '2', '20', '20', '', '', ''],
      ['3', '202', '20', '3', '30', '30', '', '', ''],
      ['4', '102', '10', '4', '40', '40', '', '', ''],
    ] },
  ]);
}
