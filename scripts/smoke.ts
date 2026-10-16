import { readFileSync } from 'node:fs';
import { loadPortfolio } from '../src/lib/loader';
import { applyCsvImport, importAssignmentsCsv } from '../src/lib/resources/csvAssignments';
import { suggestGroups } from '../src/lib/resources/matching';
import { defaultSettings } from '../src/lib/settings';
import { runOptimization, analyzePortfolio } from '../src/lib/pipeline';
import { dayToISO } from '../src/lib/calendar';
let model = loadPortfolio([{ name: 'AFS.xer', data: readFileSync('samples/AFS.xer') }, { name: 'AFS_scheduled.xer', data: readFileSync('samples/AFS_scheduled.xer') }]);
const csv = importAssignmentsCsv(readFileSync('public/samples/afs-demo-resources.csv', 'utf8'), model, 'demo.csv');
model = applyCsvImport(model, csv);
console.log(csv.issues.map(i=>i.message));
const groups = suggestGroups(model);
console.log(groups.map(g => `${g.name} [${g.type}] cap=${g.capacity} cost=${g.costPerUnitDay} members=${g.memberKeys.length}`).join('\n'));
const settings = defaultSettings(model);
const an = analyzePortfolio(model, groups, settings);
for (const c of an.conflicts) console.log(c.name, 'peak', c.peakDemand, 'over', c.peakOver, 'overDays', c.overDays, 'util', c.utilizationPct, 'crit', c.criticalOverDays);
const out = runOptimization(model, groups, settings);
for (const s of out.scenarios) {
  const m = s.metrics;
  console.log(`\n${s.name} rule=${s.rule} just=${s.justified} feasible=${s.feasible} viol=${JSON.stringify(s.validation.counts)}`);
  console.log(`  peakOver=${m.peakOverallocation} overUD=${m.overUnitDays} util=${m.avgUtilizationPct} cost=${m.resourceCost} transfer=${m.transferCost}(${m.transfers}) hire=${m.hireCost} (${m.hiredUnitDays}ud) total=${m.totalCost} idle=${m.idleUnitDays} Z=${m.objective.Z} D=${m.objective.D} rt=${m.runtimeMs}`);
  console.log('  ', m.projects.map(p => `${p.name}: ${dayToISO(p.start)}→${dayToISO(p.finish-1)} ${p.durationWorkdays}d delay=${p.delayDays}`).join(' | '));
  console.log('  shifts', s.recommendations.shifts.length, 'hires', s.recommendations.hires.length, s.notes);
  if (!s.validation.ok) console.log(s.validation.violations.slice(0,5));
}
console.log('total ms', out.totalRuntimeMs);
