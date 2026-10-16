import type { Assignment, DataIssue, PortfolioModel, Project, Resource, ResourceType } from '../model';

/**
 * Resource-assignment CSV import, used when the XER files have no RSRC/TASKRSRC tables.
 *
 * Columns (header row required, case-insensitive):
 *   project            optional: project short name, display name, file name or proj_id; blank = every project
 *   activity_code      required: P6 task_code
 *   resource_name      required
 *   resource_type      optional: labor | equipment | material (default labor)
 *   units_per_day      units used on each working day of the activity   } one of the two is required
 *   total_qty          total quantity (hours) → units = total_qty / activity duration hours  }
 *   max_units          optional: capacity of this resource (units)
 *   cost_per_unit_day  optional: cost of one unit for one working day
 */

export interface CsvImportResult {
  resources: Resource[];
  assignments: Assignment[];
  issues: DataIssue[];
  rowCount: number;
}

export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  const src = text.replace(/^﻿/, '');
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (quoted) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          cell += '"';
          i++;
        } else quoted = false;
      } else cell += ch;
      continue;
    }
    if (ch === '"') quoted = true;
    else if (ch === ',') {
      row.push(cell);
      cell = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && src[i + 1] === '\n') i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
    } else cell += ch;
  }
  if (cell !== '' || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }
  return rows.filter((r) => r.some((c) => c.trim() !== '') && !r[0].trim().startsWith('#'));
}

const TYPES: Record<string, ResourceType> = {
  labor: 'labor',
  labour: 'labor',
  rt_labor: 'labor',
  equipment: 'equipment',
  equip: 'equipment',
  rt_equip: 'equipment',
  nonlabor: 'equipment',
  material: 'material',
  rt_mat: 'material',
};

const slug = (s: string) => s.trim().toLowerCase().replace(/\s+/g, ' ');

function matchProjects(projects: Project[], ref: string): Project[] {
  const r = ref.trim().toLowerCase();
  if (!r) return projects;
  const strip = (s: string) => s.toLowerCase().replace(/\.xer$/, '');
  const exact = projects.filter(
    (p) => strip(p.fileName) === strip(r) || p.displayName.toLowerCase() === r || p.projId === ref.trim(),
  );
  if (exact.length) return exact;
  return projects.filter((p) => p.shortName.toLowerCase() === r);
}

export function importAssignmentsCsv(text: string, model: PortfolioModel, sourceName = 'assignments.csv'): CsvImportResult {
  const issues: DataIssue[] = [];
  const out: CsvImportResult = { resources: [], assignments: [], issues, rowCount: 0 };
  const rows = parseCsv(text);
  if (rows.length < 2) {
    issues.push({ severity: 'error', code: 'csv_empty', message: `${sourceName}: no data rows.` });
    return out;
  }
  const header = rows[0].map((h) => h.trim().toLowerCase());
  const col = (name: string) => header.indexOf(name);
  const need = ['activity_code', 'resource_name'];
  for (const n of need) {
    if (col(n) < 0) {
      issues.push({ severity: 'error', code: 'csv_header', message: `${sourceName}: missing required column "${n}".` });
    }
  }
  if (col('units_per_day') < 0 && col('total_qty') < 0) {
    issues.push({ severity: 'error', code: 'csv_header', message: `${sourceName}: needs a "units_per_day" or "total_qty" column.` });
  }
  if (issues.length) return out;

  const resources = new Map<string, Resource>();
  const actIndex = new Map<string, Map<string, (typeof model.activities)[number]>>();
  for (const a of model.activities) {
    let m = actIndex.get(a.projectKey);
    if (!m) actIndex.set(a.projectKey, (m = new Map()));
    m.set(a.code.trim().toLowerCase(), a);
  }
  const calHours = new Map(model.calendars.map((c) => [c.key, c.dayHours]));
  const get = (r: string[], name: string) => (col(name) >= 0 ? (r[col(name)] ?? '').trim() : '');
  const unmatchedCodes = new Set<string>();

  rows.slice(1).forEach((r, idx) => {
    const line = idx + 2;
    out.rowCount++;
    const code = get(r, 'activity_code');
    const rname = get(r, 'resource_name');
    if (!code || !rname) {
      issues.push({ severity: 'warning', code: 'csv_row', message: `${sourceName} line ${line}: activity_code and resource_name are required; row skipped.` });
      return;
    }
    const typeRaw = slug(get(r, 'resource_type') || 'labor');
    const type = TYPES[typeRaw];
    if (!type) {
      issues.push({ severity: 'warning', code: 'csv_type', message: `${sourceName} line ${line}: unknown resource_type "${typeRaw}"; labor assumed.` });
    }
    const projRef = get(r, 'project');
    const targets = matchProjects(model.projects, projRef);
    if (targets.length === 0) {
      issues.push({ severity: 'warning', code: 'csv_project', message: `${sourceName} line ${line}: project "${projRef}" not loaded; row skipped.` });
      return;
    }
    const upd = get(r, 'units_per_day');
    const tq = get(r, 'total_qty');
    const maxUnits = get(r, 'max_units');
    const cost = get(r, 'cost_per_unit_day');
    for (const p of targets) {
      const act = actIndex.get(p.key)?.get(code.toLowerCase());
      if (!act) {
        unmatchedCodes.add(`${code} (${p.displayName})`);
        continue;
      }
      const dayHours = calHours.get(act.calendarKey) ?? 8;
      const durHours = act.targetHours > 0 ? act.targetHours : act.remainHours;
      let units = upd !== '' ? Number(upd) : durHours > 0 ? Number(tq) / durHours : NaN;
      if (!Number.isFinite(units) || units < 0) {
        issues.push({ severity: 'warning', code: 'csv_units', message: `${sourceName} line ${line}: invalid quantity for ${code}; row skipped.` });
        continue;
      }
      if (act.durationDays === 0 && units > 0) {
        issues.push({ severity: 'info', code: 'csv_milestone', message: `${sourceName} line ${line}: ${code} is a milestone; its assignment has no duration and is ignored.` });
        units = 0;
      }
      const resKey = `csv:${p.fileId}:${slug(rname)}`;
      let res = resources.get(resKey);
      if (!res) {
        res = {
          key: resKey,
          rsrcId: slug(rname),
          name: rname,
          shortName: rname,
          type: type ?? 'labor',
          maxUnits: null,
          costPerHour: null,
          source: 'csv',
          fileId: p.fileId,
        };
        resources.set(resKey, res);
      }
      if (maxUnits !== '' && res.maxUnits === null && Number.isFinite(Number(maxUnits))) res.maxUnits = Number(maxUnits);
      if (cost !== '' && res.costPerHour === null && Number.isFinite(Number(cost))) res.costPerHour = Number(cost) / dayHours;
      const qty = units * durHours;
      out.assignments.push({
        key: `csv:${act.key}:${resKey}:${line}`,
        activityKey: act.key,
        resourceKey: resKey,
        projectKey: act.projectKey,
        targetQty: qty,
        remainQty: qty,
        targetCost: res.costPerHour !== null ? qty * res.costPerHour : null,
        unitsPerDay: units,
        source: 'csv',
      });
    }
  });
  if (unmatchedCodes.size > 0) {
    issues.push({
      severity: 'warning',
      code: 'csv_unmatched',
      message: `${sourceName}: ${unmatchedCodes.size} activity codes not found: ${[...unmatchedCodes].slice(0, 8).join(', ')}${unmatchedCodes.size > 8 ? '…' : ''}`,
    });
  }
  out.resources = [...resources.values()];
  issues.push({
    severity: 'info',
    code: 'csv_loaded',
    message: `${sourceName}: ${out.assignments.length} assignments for ${out.resources.length} resources imported (source: CSV, not XER).`,
  });
  return out;
}

/** Return a new model with CSV resources/assignments replacing any earlier CSV import. */
export function applyCsvImport(model: PortfolioModel, result: CsvImportResult): PortfolioModel {
  return {
    ...model,
    resources: [...model.resources.filter((r) => r.source !== 'csv'), ...result.resources],
    assignments: [...model.assignments.filter((a) => a.source !== 'csv'), ...result.assignments],
    issues: [...model.issues.filter((i) => !i.code.startsWith('csv_')), ...result.issues],
  };
}
