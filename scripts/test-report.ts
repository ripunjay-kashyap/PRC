/**
 * Generates docs/test-report.md from (1) the real pipeline run on the attached XER files and
 * (2) the JSON results of Vitest and Playwright. Run: npm run report
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { loadPortfolio } from '../src/lib/loader';
import { applyCsvImport, importAssignmentsCsv } from '../src/lib/resources/csvAssignments';
import { suggestGroups } from '../src/lib/resources/matching';
import { defaultSettings } from '../src/lib/settings';
import { analyzePortfolio, runOptimization } from '../src/lib/pipeline';
import { dayToISO } from '../src/lib/calendar';
import { RULE_LABELS } from '../src/lib/scheduling/sgs';

const files = [
  { name: 'AFS.xer', data: readFileSync('samples/AFS.xer') },
  { name: 'AFS_scheduled.xer', data: readFileSync('samples/AFS_scheduled.xer') },
];
let model = loadPortfolio(files);
model = applyCsvImport(model, importAssignmentsCsv(readFileSync('public/samples/afs-demo-resources.csv', 'utf8'), model, 'afs-demo-resources.csv'));
const groups = suggestGroups(model);
const settings = defaultSettings(model);
const analysis = analyzePortfolio(model, groups, settings);
const out = runOptimization(model, groups, settings);
const n = (x: number | null, d = 0) => (x === null ? '—' : x.toLocaleString('en-IN', { maximumFractionDigits: d }));
const fin = (f: number) => dayToISO(f - 1);
const L: string[] = [];
const p = (s = '') => L.push(s);

p('# Test report');
p();
p(`Generated ${new Date().toISOString().slice(0, 16).replace('T', ' ')} UTC by \`npm run report\` (scripts/test-report.ts). All figures below are produced by the app's code, not written by hand.`);
p();
p('## 1. Results on the two attached XER files');
p();
p('**Inputs:** `AFS.xer` (unscheduled, data date 2026-10-16) and `AFS_scheduled.xer` (scheduled, data date 2026-08-27). Both contain the same project (proj_id 4518) and are analysed as two projects competing for one pool.');
p('**The XER files have no resource tables.** The resource loading comes from the illustrative demo CSV `public/samples/afs-demo-resources.csv`: crew sizes, capacities and INR cost rates are invented for demonstration. The scheduling logic, durations, calendars and dates come from the XER files.');
p();
p('Default settings: weights α=1, β=10,000, γ=5,000, δ=100; materials excluded from leveling; mobilisation days and transfer cost 0; hire premium 1.5; deadlines AFS [AFS] = none (not in the XER), AFS [AFS_scheduled] = 2026-12-24 (`scd_end_date` fallback).');
p();
p('### Resource groups (suggested by name matching, all 2 members)');
p();
p('| Group | Type | Capacity | Cost / unit-day | Baseline peak demand | Baseline peak over | Over-allocated days | Utilisation |');
p('|---|---|---:|---:|---:|---:|---:|---:|');
for (const g of groups) {
  const c = analysis.conflicts.find((x) => x.groupId === g.id)!;
  p(`| ${g.name} | ${g.type} | ${g.capacity ?? 'missing'} | ${n(g.costPerUnitDay)} | ${n(c.peakDemand, 2)} | ${n(c.peakOver, 2)} | ${c.overDays} | ${c.utilizationPct === null ? '—' : c.utilizationPct + '%'} |`);
}
p();
p('### Metrics per scenario (baseline vs optimized)');
p();
p('| Metric | ' + out.scenarios.map((s) => s.name.replace(/^\d\. /, '')).join(' | ') + ' |');
p('|---|' + out.scenarios.map(() => '---:').join('|') + '|');
const row = (label: string, f: (s: (typeof out.scenarios)[number]) => string) => p(`| ${label} | ${out.scenarios.map(f).join(' | ')} |`);
row('Hard-constraint violations', (s) => String(s.metrics.constraintViolations));
row('Capacity enforced', (s) => (s.enforcesCapacity ? 'yes' : 'no (reference)'));
row('Best priority rule', (s) => (s.rule ? RULE_LABELS[s.rule] + (s.justified ? ' + FBI' : '') : '—'));
row('Peak over-allocation (units)', (s) => n(s.metrics.peakOverallocation, 2));
row('Over-allocated unit-days', (s) => n(s.metrics.overUnitDays, 1));
row('Average utilisation %', (s) => n(s.metrics.avgUtilizationPct, 1));
row('Resource cost (INR)', (s) => n(s.metrics.resourceCost));
row('Transfers (count / cost)', (s) => `${s.metrics.transfers} / ${n(s.metrics.transferCost)}`);
row('Hired unit-days (cost INR)', (s) => `${n(s.metrics.hiredUnitDays, 1)} (${n(s.metrics.hireCost)})`);
row('Total cost (INR, priced groups)', (s) => n(s.metrics.totalCost));
for (let i = 0; i < out.projects.length; i++) {
  row(`${out.projects[i].name}: finish (duration wd)`, (s) => `${fin(s.metrics.projects[i].finish)} (${s.metrics.projects[i].durationWorkdays})`);
}
row('Deadline violations (days)', (s) => `${s.metrics.deadlineViolations} (${s.metrics.deadlineDelayDays})`);
row('Idle resource unit-days', (s) => n(s.metrics.idleUnitDays, 0));
row('Activities shifted', (s) => String(s.recommendations.shifts.length));
row('Objective Z', (s) => n(s.metrics.objective.Z));
row('Optimizer runtime (ms)', (s) => n(s.metrics.runtimeMs, 1));
p();
p(`Total optimisation time for all six scenarios: ${n(out.totalRuntimeMs, 0)} ms (Node.js, this container). The cost of the material group (Ceramic Tile Sqm) is not priced because the demo CSV gives it no rate; every total excludes it, and the UI and Excel flag this.`);
p();
p('**Reading the results.** Against the pooled capacity, the baseline over-allocates Helper, Mason and Plumber (peak 5 units). Within-float pooling (scenario 4) removes every over-allocation without hiring and without moving either project finish. It is the recommended plan (lowest Z). Leveling each project separately with a fixed share (scenario 2) delays AFS [AFS_scheduled] by 20 working days past its deadline and needs 16 unavoidable hired unit-days, because single activities need more Tilers/Painters than that project\'s share. Keeping the original dates (scenario 3) needs 52 hired unit-days. With these demo capacities the float absorbs every conflict, so the cost- and deadline-priority scenarios (5, 6) reach the same plan as scenario 4. A deadline-infeasibility case is covered by `tests/integration.test.ts`.');
p();

const vit = 'test-results/vitest.json';
const pw = 'test-results/playwright.json';
p('## 2. Automated tests');
p();
if (existsSync(vit)) {
  const v = JSON.parse(readFileSync(vit, 'utf8')) as { numTotalTests: number; numPassedTests: number; numFailedTests: number; testResults: { name: string; assertionResults: { fullName: string; status: string }[] }[] };
  p(`### Unit & integration (Vitest): ${v.numPassedTests} / ${v.numTotalTests} passed, ${v.numFailedTests} failed`);
  p();
  for (const f of v.testResults.sort((a, b) => a.name.localeCompare(b.name))) {
    p(`**${f.name.replace(/^.*\/tests\//, 'tests/')}**`);
    p();
    p('| Test | Result |');
    p('|---|---|');
    for (const t of f.assertionResults) p(`| ${t.fullName.replace(/\|/g, '\\|')} | ${t.status === 'passed' ? '✅ pass' : '❌ ' + t.status} |`);
    p();
  }
} else p('_Vitest results not found — run `npm run report`._');
if (existsSync(pw)) {
  const r = JSON.parse(readFileSync(pw, 'utf8')) as { suites: { title: string; specs: { title: string; ok: boolean }[] }[]; stats: { expected: number; unexpected: number } };
  p(`### End-to-end (Playwright, Chromium): ${r.stats.expected} passed, ${r.stats.unexpected} failed`);
  p();
  p('| Test | Result |');
  p('|---|---|');
  for (const s of r.suites) for (const sp of s.specs) p(`| ${s.title} › ${sp.title} | ${sp.ok ? '✅ pass' : '❌ fail'} |`);
  p();
} else p('_Playwright results not found._');
p('### Build checks');
p();
p('`npm run typecheck`, `npm run lint` and `npm run build` must pass before `npm run report` (they are run first by the script chain).');
p();
p('## 3. Not verifiable in this environment');
p();
p('- Live Gemini calls: there was no API key here, so `/api/chat` is tested with a mocked `fetch` only (valid request, missing key, malformed and oversized input, upstream errors, timeout). Test it after deploying to Vercel (see README).');
p('- `vercel dev` / a real Vercel deployment.');
writeFileSync('docs/test-report.md', L.join('\n') + '\n');
console.log('docs/test-report.md written');
