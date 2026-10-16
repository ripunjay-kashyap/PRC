import type { DayNum, PortfolioModel, ResourceType } from '../model';
import type { PreparedContext } from '../scheduling/cpm';

export interface ProjectComparison {
  key: string;
  name: string;
  fileName: string;
  dataDate: DayNum;
  start: DayNum;
  /** Finish boundary (work ends the day before) */
  finish: DayNum;
  durationWorkdays: number;
  durationCalendarDays: number;
  activityCount: number;
  taskCount: number;
  milestoneCount: number;
  relationshipCount: number;
  criticalCount: number;
  resourceTypes: ResourceType[];
  /** groupId → planned unit-days */
  demandByGroup: Record<string, number>;
  deadline: DayNum | null;
  baselineFromCpm: boolean;
}

export interface Overlap {
  a: string;
  b: string;
  start: DayNum;
  /** Exclusive end */
  end: DayNum;
  workdays: number;
}

export interface ComparisonResult {
  projects: ProjectComparison[];
  overlaps: Overlap[];
}

export function compareProjects(model: PortfolioModel, ctx: PreparedContext): ComparisonResult {
  const projects: ProjectComparison[] = ctx.projects.map((p, pi) => {
    const idx = ctx.acts.filter((a) => a.projectIdx === pi).map((a) => a.idx);
    const starts = idx.map((i) => ctx.baseline.start[i]);
    const finishes = idx.map((i) => ctx.baseline.finish[i]);
    const start = starts.length ? Math.min(...starts, p.dataDate) : p.dataDate;
    const finish = finishes.length ? Math.max(...finishes) : p.dataDate;
    const types = new Set<ResourceType>();
    const demandByGroup: Record<string, number> = {};
    for (const i of idx) {
      const a = ctx.acts[i];
      const days = a.cal.countWorkdays(Math.max(ctx.baseline.start[i], a.minStart), ctx.baseline.finish[i]);
      for (const d of a.demands) {
        const g = ctx.groups[d.g];
        types.add(g.type);
        demandByGroup[g.id] = round2((demandByGroup[g.id] ?? 0) + d.units * days);
      }
    }
    const src = model.projects.find((x) => x.key === p.key)!;
    return {
      key: p.key,
      name: p.name,
      fileName: src.fileName,
      dataDate: p.dataDate,
      start,
      finish,
      durationWorkdays: ctx.portfolioCal.countWorkdays(start, finish),
      durationCalendarDays: finish - start,
      activityCount: idx.length,
      taskCount: idx.filter((i) => ctx.acts[i].durationDays > 0).length,
      milestoneCount: idx.filter((i) => ctx.acts[i].kind.endsWith('milestone')).length,
      relationshipCount: ctx.rels.filter((r) => ctx.acts[r.succ].projectIdx === pi).length,
      criticalCount: idx.filter((i) => ctx.cpm.tf[i] <= 0).length,
      resourceTypes: [...types].sort(),
      demandByGroup,
      deadline: p.deadline,
      baselineFromCpm: p.baselineFromCpm,
    };
  });
  const overlaps: Overlap[] = [];
  for (let i = 0; i < projects.length; i++) {
    for (let j = i + 1; j < projects.length; j++) {
      const s = Math.max(projects[i].start, projects[j].start);
      const e = Math.min(projects[i].finish, projects[j].finish);
      if (e > s) overlaps.push({ a: projects[i].name, b: projects[j].name, start: s, end: e, workdays: ctx.portfolioCal.countWorkdays(s, e) });
    }
  }
  return { projects, overlaps };
}

const round2 = (x: number) => Math.round(x * 100) / 100;
