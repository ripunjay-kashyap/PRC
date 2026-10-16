import { dayToISO } from '../calendar';
import type { PortfolioModel } from '../model';
import type { OptimizationOutput, PortfolioAnalysis } from '../pipeline';
import type { ScenarioResult } from '../scheduling/scenarios';
import type { ResourceGroup, Settings } from '../settings';

export const SUMMARY_LIMIT_BYTES = 28 * 1024;

/** The scenario recommended by default: lowest Z among feasible, capacity-respecting scenarios. */
export function recommendedScenario(scenarios: ScenarioResult[]): ScenarioResult | null {
  const cand = scenarios.filter((s) => s.enforcesCapacity && s.feasible);
  if (!cand.length) return null;
  return cand.reduce((best, s) => (s.metrics.objective.Z < best.metrics.objective.Z ? s : best));
}

const iso = (d: number | null | undefined) => (d === null || d === undefined || !Number.isFinite(d) ? null : dayToISO(d));
/** Finish boundaries are exclusive; show the last working day. */
const isoFinish = (d: number | null | undefined) => (d === null || d === undefined || !Number.isFinite(d) ? null : dayToISO(d - 1));

export interface SummaryInput {
  model: PortfolioModel;
  groups: ResourceGroup[];
  settings: Settings;
  analysis: PortfolioAnalysis | null;
  optimization: OptimizationOutput | null;
  selectedScenarioId?: string | null;
}

/**
 * Compact JSON summary sent to /api/chat. Contains only numbers computed by the app and the
 * data-quality flags; never raw XER content. Lists are trimmed until it fits the size limit.
 */
export function buildChatSummary(input: SummaryInput, limits = { shifts: 20, periods: 4, issues: 15, transfers: 10, hires: 10 }): Record<string, unknown> {
  const { model, groups, settings, analysis, optimization } = input;
  const csvUsed = model.assignments.some((a) => a.source === 'csv');
  const demoUsed = model.issues.some((i) => i.code === 'csv_loaded' && /demo/i.test(i.message));
  const sel =
    optimization?.scenarios.find((s) => s.id === input.selectedScenarioId) ?? (optimization ? recommendedScenario(optimization.scenarios) : null);

  const summary: Record<string, unknown> = {
    about:
      'All numbers below were computed deterministically by the app (XER parser, CPM, conflict detection, serial SGS optimizer). Dates are ISO; finish dates are the last working day. Durations are in working days.',
    dataSources: {
      xerFiles: model.files.map((f) => ({ file: f.fileName, ok: f.ok, tables: f.tables.map((t) => t.name) })),
      resourceAssignments: !model.assignments.length
        ? 'none loaded'
        : csvUsed
          ? demoUsed
            ? 'ILLUSTRATIVE DEMO CSV — invented crew sizes, capacities and costs; NOT from the XER files'
            : 'imported from a user CSV (not from the XER files)'
          : 'from the XER files (TASKRSRC)',
      flaggedIssues: [...(analysis?.issues ?? model.issues)]
        .filter((i) => i.severity !== 'info')
        .slice(0, limits.issues)
        .map((i) => `${i.severity}: ${i.message}`),
    },
    settings: {
      objective: 'Z = alpha*C + beta*D + gamma*O + delta*U',
      weights: settings.weights,
      includeMaterials: settings.includeMaterials,
    },
    projects: (analysis?.comparison.projects ?? []).map((p) => {
      const ps = settings.projects[p.key];
      return {
        name: p.name,
        file: p.fileName,
        dataDate: iso(p.dataDate),
        baselineStart: iso(p.start),
        baselineFinish: isoFinish(p.finish),
        durationWorkdays: p.durationWorkdays,
        activities: p.activityCount,
        criticalActivities: p.criticalCount,
        deadline: isoFinish(ps?.deadline ?? null),
        deadlineSource: ps?.deadlineSource ?? 'none',
        priorityWeight: ps?.priorityWeight ?? 1,
        baselineSource: p.baselineFromCpm ? 'CPM computed by the app (P6 file not scheduled)' : 'P6 early dates',
      };
    }),
    resourceGroups: groups.map((g) => ({
      name: g.name,
      type: g.type,
      members: g.memberKeys.length,
      capacity: g.capacity,
      capacitySource: g.capacitySource ?? 'missing',
      costPerUnitDay: g.costPerUnitDay,
      leveled: g.capacity !== null && (settings.includeMaterials || g.type !== 'material'),
      mobilizationDays: g.mobilizationDays,
      transferCostPerUnit: g.transferCostPerUnit,
    })),
    baselineConflicts: (analysis?.conflicts ?? [])
      .filter((c) => c.activeDays > 0)
      .map((c) => ({
        group: c.name,
        capacity: c.capacity,
        peakDemand: c.peakDemand,
        peakOverallocation: c.peakOver,
        overallocatedDays: c.overDays,
        overallocatedUnitDays: c.overUnitDays,
        utilizationPct: c.utilizationPct,
        idleUnitDays: c.idleUnitDays,
        daysOverallocatedOnCriticalActivities: c.criticalOverDays,
        periods: c.overPeriods
          .slice()
          .sort((a, b) => b.excessUnitDays - a.excessUnitDays)
          .slice(0, limits.periods)
          .map((p) => ({
            from: iso(p.start),
            to: iso(p.end),
            peakExcess: p.peakExcess,
            projects: p.projects,
            activities: p.activities.slice(0, 8),
            criticalActivities: p.criticalActivities.slice(0, 8),
          })),
      })),
    scenarios: (optimization?.scenarios ?? []).map((s) => ({
      id: s.id,
      name: s.name,
      description: s.description,
      feasible: s.feasible,
      constraintViolations: s.metrics.constraintViolations,
      bestPriorityRule: s.rule,
      peakOverallocation: s.metrics.peakOverallocation,
      peakShortageBeforeHiring: s.metrics.peakShortage,
      avgUtilizationPct: s.metrics.avgUtilizationPct,
      resourceCost: s.metrics.resourceCost,
      transferCost: s.metrics.transferCost,
      transfers: s.metrics.transfers,
      hireCost: s.metrics.hireCost,
      hiredUnitDays: s.metrics.hiredUnitDays,
      totalCost: s.metrics.totalCost,
      costsMissingFor: s.metrics.costMissing,
      idleUnitDays: s.metrics.idleUnitDays,
      deadlineViolations: s.metrics.deadlineViolations,
      deadlineDelayDays: s.metrics.deadlineDelayDays,
      projectFinishes: s.metrics.projects.map((p) => ({ project: p.name, finish: isoFinish(p.finish), durationWorkdays: p.durationWorkdays, delayDays: p.delayDays })),
      objective: s.metrics.objective,
      notes: s.notes,
    })),
  };

  if (sel) {
    const r = sel.recommendations;
    summary.selectedScenario = {
      id: sel.id,
      name: sel.name,
      whySelected: input.selectedScenarioId ? 'chosen by the user' : 'lowest objective Z among feasible scenarios that respect capacity',
      activityShifts: r.shifts.slice(0, limits.shifts).map((s) => ({
        project: s.project,
        activity: `${s.code} ${s.name}`,
        oldStart: iso(s.oldStart),
        oldFinish: isoFinish(s.oldFinish),
        newStart: iso(s.newStart),
        newFinish: isoFinish(s.newFinish),
        shiftWorkdays: s.shiftDays,
        totalFloat: s.totalFloat,
        floatConsumed: s.floatConsumed,
        beyondFloat: s.beyondFloat,
        critical: s.critical,
        reason: s.reason,
      })),
      totalActivitiesShifted: r.shifts.length,
      transfers: r.transfers.slice(0, limits.transfers).map((t) => ({ group: t.groupName, date: iso(t.day), from: t.fromProject, to: t.toProject, units: t.units, cost: t.cost })),
      totalTransfers: r.transfers.length,
      hires: r.hires.slice(0, limits.hires).map((h) => ({ group: h.groupName, from: iso(h.start), to: iso(h.end), peakUnits: h.peakUnits, unitDays: h.unitDays, cost: h.cost })),
      deadlineImpact: r.deadlines.map((d) => ({
        project: d.project,
        deadline: isoFinish(d.deadline),
        baselineFinish: isoFinish(d.baselineFinish),
        newFinish: isoFinish(d.newFinish),
        finishChangeWorkdays: d.finishChangeDays,
        delayDays: d.newDelayDays,
        minimumUnavoidableDelayDays: d.minUnavoidableDelayDays,
      })),
    };
  }
  if (!optimization) summary.optimization = 'not run yet';

  const size = new TextEncoder().encode(JSON.stringify(summary)).length;
  if (size > SUMMARY_LIMIT_BYTES && limits.shifts > 2) {
    return buildChatSummary(input, {
      shifts: Math.floor(limits.shifts / 2),
      periods: Math.max(1, limits.periods - 1),
      issues: Math.max(3, Math.floor(limits.issues / 2)),
      transfers: Math.floor(limits.transfers / 2),
      hires: Math.floor(limits.hires / 2),
    });
  }
  return summary;
}
