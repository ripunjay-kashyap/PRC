import type ExcelJSNS from 'exceljs';
import { dayToISO } from '../calendar';
import type { PortfolioModel } from '../model';
import type { OptimizationOutput, PortfolioAnalysis } from '../pipeline';
import type { ScenarioResult } from '../scheduling/scenarios';
import type { ResourceGroup, Settings } from '../settings';
import { recommendedScenario } from '../chat/summary';

type ExcelJS = typeof ExcelJSNS;

export const SHEET_HEADERS = {
  Summary: ['Item', 'Value'],
  Projects: ['Project', 'File', 'Data date', 'Baseline start', 'Baseline finish', 'Duration (wd)', 'Activities', 'Critical', 'Deadline', 'Deadline source', 'Baseline source', 'Optimized finish', 'Delay (wd)'],
  'Daily Demand': ['Date', 'Resource group', 'Capacity', 'Baseline demand', 'Baseline over', 'Optimized demand', 'Hired units', 'Optimized over'],
  Conflicts: ['Resource group', 'From', 'To', 'Days', 'Peak demand', 'Capacity', 'Peak excess', 'Excess unit-days', 'Projects', 'Critical', 'Critical activities', 'Activities'],
  'Scenario Comparison': ['Scenario', 'Feasible', 'Constraint violations', 'Best rule', 'Peak over-allocation', 'Peak shortage', 'Avg utilisation %', 'Resource cost', 'Transfer cost', 'Transfers', 'Hire cost', 'Hired unit-days', 'Total cost', 'Deadline violations', 'Delay (wd)', 'Idle unit-days', 'Z', 'Runtime (ms)'],
  'Recommended Changes': ['Type', 'Project', 'Activity / group', 'Description', 'Old start', 'Old finish', 'New start', 'New finish', 'Shift (wd)', 'Float consumed', 'Units', 'Cost', 'Reason / note'],
  'Assumptions & Missing Data': ['Category', 'Item', 'Detail'],
} as const;

export type SheetName = keyof typeof SHEET_HEADERS;

export interface ReportInput {
  model: PortfolioModel;
  groups: ResourceGroup[];
  settings: Settings;
  analysis: PortfolioAnalysis;
  optimization: OptimizationOutput | null;
  selectedScenarioId?: string | null;
  generatedAt?: Date;
}

export const ASSUMPTIONS: [string, string][] = [
  ['Time unit', 'Whole working days. P6 hour durations are divided by the calendar day_hr_cnt (default 8) and rounded up; P6 timestamps before 12:00 count as the start of that day.'],
  ['Calendars', 'Each activity follows its P6 calendar (workweek and holiday exceptions parsed from clndr_data). Relationship lags are counted on the successor calendar.'],
  ['Resource units', 'Units per day = target_qty / activity duration hours (e.g. 80 h over a 40 h activity = 2 units).'],
  ['Pooled capacity', 'Matched resources form a pool; capacity = sum of member capacities (an identical XER resource appearing in several files is counted once).'],
  ['Materials', 'Material resources are excluded from capacity leveling unless enabled in Settings.'],
  ['Fixed work', 'Completed activities keep their actual dates; in-progress activities keep their actual start and finish their remaining duration from the data date.'],
  ['Data date', 'No activity that has not started is scheduled before its project data date.'],
  ['Unscheduled projects', 'If a P6 project has no calculated early dates, its baseline uses CPM early dates computed by the app from the data date.'],
  ['Deadlines', 'Default = plan_end_date, else scd_end_date (flagged), else none until the user sets one.'],
  ['Transfers', "A transfer is counted when one project's allocation of a pooled group drops on the same working day another project's allocation rises; cost = units × (transfer cost + mobilisation days × daily rate). Mobilisation is costed, not modelled as lost capacity."],
  ['Hiring', 'Extra units are only used where a scenario allows it and are always reported with dates and cost (default hire rate = daily cost rate × hire premium).'],
  ['Optimality', 'The serial SGS with priority rules and forward–backward improvement gives good feasible plans, not a proven optimum.'],
  ['Constraints not modelled', 'P6 activity constraints (e.g. start-on-or-after), resource calendars, resource curves and leveling priorities other than the four rules are not modelled.'],
];

const HEADER_FILL = { type: 'pattern' as const, pattern: 'solid' as const, fgColor: { argb: 'FF1F3A5F' } };
const RED_FILL = { type: 'pattern' as const, pattern: 'solid' as const, bgColor: { argb: 'FFF8D0CC' }, fgColor: { argb: 'FFF8D0CC' } };
const iso = (d: number | null | undefined) => (d === null || d === undefined || !Number.isFinite(d) ? '' : dayToISO(d));
const isoF = (d: number | null | undefined) => (d === null || d === undefined || !Number.isFinite(d) ? '' : dayToISO(d - 1));

function addSheet(wb: ExcelJSNS.Workbook, name: SheetName, widths: number[]) {
  const ws = wb.addWorksheet(name, { views: [{ state: 'frozen', ySplit: 1 }] });
  const headers = SHEET_HEADERS[name];
  ws.columns = headers.map((h, i) => ({ header: h, key: `c${i}`, width: widths[i] ?? 16 }));
  const row = ws.getRow(1);
  row.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  row.fill = HEADER_FILL;
  row.alignment = { vertical: 'middle', wrapText: true };
  row.height = 30;
  return ws;
}

function addRedRule(ws: ExcelJSNS.Worksheet, col: string, lastRow: number) {
  if (lastRow < 2) return;
  ws.addConditionalFormatting({
    ref: `${col}2:${col}${lastRow}`,
    rules: [{ type: 'cellIs', operator: 'greaterThan', formulae: ['0'], priority: 1, style: { fill: RED_FILL, font: { color: { argb: 'FF9B1C1C' }, bold: true } } }],
  });
}

export async function buildWorkbook(ExcelJS: ExcelJS, input: ReportInput): Promise<ExcelJSNS.Workbook> {
  const { model, analysis, optimization, settings } = input;
  const wb = new ExcelJS.Workbook();
  wb.creator = 'P6 Multi-Project Resource Allocator';
  wb.created = input.generatedAt ?? new Date();
  const scenarios = optimization?.scenarios ?? [];
  const selected: ScenarioResult | null = scenarios.find((s) => s.id === input.selectedScenarioId) ?? recommendedScenario(scenarios);
  const baseline = scenarios.find((s) => s.id === 'baseline') ?? null;

  // ---- Summary
  const sum = addSheet(wb, 'Summary', [34, 90]);
  const kv: [string, string | number][] = [
    ['Report generated', (input.generatedAt ?? new Date()).toISOString().replace('T', ' ').slice(0, 16)],
    ['XER files', model.files.map((f) => f.fileName).join(', ')],
    ['Projects', analysis.projects.map((p) => p.name).join(', ')],
    ['Activities', analysis.activities.length],
    ['Resource groups (leveled / total)', `${analysis.groups.filter((g) => g.leveled).length} / ${analysis.groups.length}`],
    ['Resource data source', model.assignments.length === 0 ? 'NONE — no assignments loaded' : model.assignments.some((a) => a.source === 'csv') ? 'CSV import (not from the XER files) — see Assumptions sheet' : 'XER TASKRSRC'],
    ['Baseline peak over-allocation (units)', baseline?.metrics.peakOverallocation ?? analysis.conflicts.reduce((m, c) => Math.max(m, c.peakOver), 0)],
    ['Baseline over-allocated unit-days', baseline?.metrics.overUnitDays ?? ''],
    ['Recommended / selected scenario', selected ? selected.name : 'Optimisation not run'],
  ];
  if (selected) {
    const m = selected.metrics;
    kv.push(
      ['  Constraint check', selected.validation.ok ? 'All hard constraints satisfied' : `${m.constraintViolations} violation(s) — see scenario`],
      ['  Peak over-allocation (units)', m.peakOverallocation],
      ['  Average utilisation %', m.avgUtilizationPct ?? 'n/a'],
      ['  Total cost (known rates)', m.totalCost],
      ['  Hired unit-days / cost', `${m.hiredUnitDays} / ${m.hireCost}`],
      ['  Transfers / cost', `${m.transfers} / ${m.transferCost}`],
      ['  Deadline violations', `${m.deadlineViolations} (${m.deadlineDelayDays} working days)`],
      ['  Objective Z', m.objective.Z],
    );
    if (m.costMissing.length) kv.push(['  Costs not priced (no rate)', m.costMissing.join(', ')]);
  }
  kv.forEach(([k, v]) => sum.addRow([k, v]));
  sum.getColumn(1).font = { bold: true };

  // ---- Projects
  const proj = addSheet(wb, 'Projects', [26, 22, 12, 14, 14, 12, 11, 9, 12, 14, 30, 15, 10]);
  analysis.comparison.projects.forEach((p, pi) => {
    const ps = settings.projects[p.key];
    const after = selected?.metrics.projects[pi];
    proj.addRow([p.name, p.fileName, iso(p.dataDate), iso(p.start), isoF(p.finish), p.durationWorkdays, p.activityCount, p.criticalCount, isoF(ps?.deadline), ps?.deadlineSource ?? 'none', p.baselineFromCpm ? 'CPM (P6 file not scheduled)' : 'P6 early dates', isoF(after?.finish), after?.delayDays ?? '']);
  });
  addRedRule(proj, 'M', proj.rowCount);

  // ---- Daily demand vs capacity
  const dd = addSheet(wb, 'Daily Demand', [12, 24, 10, 15, 13, 16, 12, 15]);
  const optDemand = new Map((selected?.demand ?? []).map((g) => [g.groupId, g]));
  for (const g of analysis.baselineDemand) {
    if (!g.total.some((v) => v > 0)) continue;
    const o = optDemand.get(g.groupId);
    const days = new Set<number>([...g.days, ...(o?.days ?? [])]);
    const bIdx = new Map(g.days.map((d, k) => [d, k]));
    const oIdx = new Map((o?.days ?? []).map((d, k) => [d, k]));
    for (const d of [...days].sort((a, b) => a - b)) {
      const bk = bIdx.get(d);
      const ok = oIdx.get(d);
      const bd = bk !== undefined ? g.total[bk] : 0;
      const od = o && ok !== undefined ? o.total[ok] : 0;
      const hired = o && ok !== undefined ? o.hired[ok] : 0;
      if (bd === 0 && od === 0) continue;
      const cap = g.capacity;
      dd.addRow([iso(d), g.name, cap ?? 'n/a', bd, cap === null ? '' : round2(Math.max(0, bd - cap)), o ? od : '', o ? hired : '', o && cap !== null ? round2(Math.max(0, od - cap - hired)) : '']);
    }
  }
  addRedRule(dd, 'E', dd.rowCount);
  addRedRule(dd, 'H', dd.rowCount);
  dd.autoFilter = { from: 'A1', to: 'H1' };

  // ---- Conflicts
  const cf = addSheet(wb, 'Conflicts', [22, 12, 12, 7, 12, 10, 11, 14, 32, 9, 40, 60]);
  for (const c of analysis.conflicts) {
    for (const p of c.overPeriods) {
      cf.addRow([c.name, iso(p.start), iso(p.end), p.days, p.peakDemand, c.capacity ?? 'n/a', p.peakExcess, p.excessUnitDays, p.projects.join(', '), p.critical ? 'YES' : 'no', p.criticalActivities.join(', '), p.activities.join(', ')]);
    }
  }
  if (cf.rowCount === 1) cf.addRow(['No over-allocation found in the baseline (or no capacities entered).']);
  addRedRule(cf, 'G', cf.rowCount);
  cf.autoFilter = { from: 'A1', to: 'L1' };

  // ---- Scenario comparison
  const sc = addSheet(wb, 'Scenario Comparison', [38, 9, 11, 22, 12, 11, 11, 14, 12, 10, 12, 12, 14, 11, 10, 12, 14, 11]);
  for (const s of scenarios) {
    const m = s.metrics;
    sc.addRow([s.name, s.feasible ? 'yes' : 'NO', m.constraintViolations, s.rule ?? '—', m.peakOverallocation, m.peakShortage, m.avgUtilizationPct ?? 'n/a', m.resourceCost, m.transferCost, m.transfers, m.hireCost, m.hiredUnitDays, m.totalCost, m.deadlineViolations, m.deadlineDelayDays, m.idleUnitDays, m.objective.Z, m.runtimeMs]);
  }
  if (!scenarios.length) sc.addRow(['Optimisation has not been run.']);
  addRedRule(sc, 'C', sc.rowCount);
  addRedRule(sc, 'E', sc.rowCount);
  addRedRule(sc, 'N', sc.rowCount);

  // ---- Recommended changes
  const rc = addSheet(wb, 'Recommended Changes', [12, 24, 26, 40, 12, 12, 12, 12, 10, 12, 8, 12, 50]);
  if (selected) {
    const r = selected.recommendations;
    rc.addRow(['Scenario', '', selected.name, selected.description]);
    for (const d of r.deadlines) {
      rc.addRow(['Deadline', d.project, '', d.deadline === null ? 'No deadline set' : `Deadline ${isoF(d.deadline)}; delay ${d.newDelayDays} wd (min. unavoidable ${d.minUnavoidableDelayDays})`, '', isoF(d.baselineFinish), '', isoF(d.newFinish), d.finishChangeDays, '', '', '', d.newDelayDays > 0 ? 'Deadline missed' : 'Deadline met or none set']);
    }
    for (const s of r.shifts) {
      rc.addRow(['Shift', s.project, s.code, s.name, iso(s.oldStart), isoF(s.oldFinish), iso(s.newStart), isoF(s.newFinish), s.shiftDays, s.floatConsumed, '', '', s.reason + (s.beyondFloat > 0 ? ` (${s.beyondFloat} wd beyond float)` : '')]);
    }
    for (const t of r.transfers) {
      rc.addRow(['Transfer', `${t.fromProject} → ${t.toProject}`, t.groupName, `Move ${t.units} unit(s); mobilisation ${t.mobilizationDays} d`, iso(t.day), '', '', '', '', '', t.units, t.cost ?? 'n/a', '']);
    }
    for (const h of r.hires) {
      rc.addRow(['Hire', '', h.groupName, `Hire up to ${h.peakUnits} extra unit(s)`, iso(h.start), iso(h.end), '', '', '', '', h.unitDays, h.cost ?? 'n/a', `${h.days} working day(s)`]);
    }
  } else rc.addRow(['—', '', '', 'Run the optimisation to get recommendations.']);

  // ---- Assumptions & missing data
  const am = addSheet(wb, 'Assumptions & Missing Data', [18, 30, 110]);
  if (model.assignments.some((a) => a.source === 'csv')) {
    am.addRow(['DATA SOURCE', 'Resource loading', 'Resource assignments, capacities and cost rates were imported from a CSV, not from the XER files.' + (model.issues.some((i) => i.code === 'demo_resources') ? ' The sample CSV is ILLUSTRATIVE DEMO DATA (invented values).' : '')]);
  }
  for (const i of analysis.issues) am.addRow([i.severity === 'error' ? 'ERROR' : i.severity === 'warning' ? 'Missing / flagged' : 'Info', i.code, i.message]);
  for (const g of input.groups) {
    if (g.capacity === null) am.addRow(['Missing / flagged', `Capacity: ${g.name}`, 'No capacity known; not leveled until entered in Settings.']);
    if (g.costPerUnitDay === null) am.addRow(['Missing / flagged', `Cost rate: ${g.name}`, 'No cost rate; excluded from cost totals.']);
  }
  for (const [k, v] of ASSUMPTIONS) am.addRow(['Assumption', k, v]);
  am.addRow(['Setting', 'Objective weights', `α=${settings.weights.alpha}, β=${settings.weights.beta}, γ=${settings.weights.gamma}, δ=${settings.weights.delta}`]);
  am.addRow(['Setting', 'Include materials in leveling', settings.includeMaterials ? 'yes' : 'no']);
  am.addRow(['Setting', 'Hire premium', String(settings.hirePremium)]);
  am.getColumn(3).alignment = { wrapText: true, vertical: 'top' };
  return wb;
}

export async function exportWorkbook(ExcelJS: ExcelJS, input: ReportInput): Promise<ArrayBuffer> {
  const wb = await buildWorkbook(ExcelJS, input);
  return (await wb.xlsx.writeBuffer()) as ArrayBuffer;
}

const round2 = (x: number) => Math.round(x * 100) / 100;
