import { useMemo, useState } from 'react';
import { useStore } from '../state/store';
import { Badge, Card, DataTable, EmptyState, Notice, PageHeader, Spinner, StatTile } from '../components/ui';
import { ScenarioChart } from '../charts/ScenarioChart';
import { Gantt } from '../charts/Gantt';
import { DemandChart } from '../charts/DemandChart';
import { recommendedScenario } from '../lib/chat/summary';
import { RULE_LABELS } from '../lib/scheduling/sgs';
import { SCENARIO_INFO, type ScenarioResult } from '../lib/scheduling/scenarios';
import type { ScenarioMetrics } from '../lib/scheduling/objective';
import { fmtDay, fmtFinish, fmtMoney, fmtNum, fmtPct } from '../lib/format';
import type { PageProps } from './types';

const METRICS: { key: string; label: string; unit: string; get: (m: ScenarioMetrics) => number }[] = [
  { key: 'peak', label: 'Peak over-allocation', unit: 'units', get: (m) => m.peakOverallocation },
  { key: 'cost', label: 'Total cost', unit: 'cost', get: (m) => m.totalCost },
  { key: 'hire', label: 'Hired unit-days', unit: 'unit-days', get: (m) => m.hiredUnitDays },
  { key: 'delay', label: 'Deadline delay', unit: 'working days', get: (m) => m.deadlineDelayDays },
  { key: 'util', label: 'Average utilisation', unit: '%', get: (m) => m.avgUtilizationPct ?? 0 },
  { key: 'idle', label: 'Idle unit-days', unit: 'unit-days', get: (m) => m.idleUnitDays },
  { key: 'transfers', label: 'Transfers', unit: 'transfers', get: (m) => m.transfers },
  { key: 'z', label: 'Objective Z', unit: 'Z', get: (m) => m.objective.Z },
];

export function ScenariosPage({ go }: PageProps) {
  const { state, runOptimization, stale, selectScenario, currency } = useStore();
  const [metric, setMetric] = useState('peak');
  const [tab, setTab] = useState<'recs' | 'gantt' | 'demand'>('recs');
  const [onlyShifted, setOnlyShifted] = useState(true);
  const [gid, setGid] = useState<string | null>(null);
  const opt = state.optimization;
  const rec = useMemo(() => (opt ? recommendedScenario(opt.scenarios) : null), [opt]);
  if (!state.model) return <EmptyState title="No projects loaded" action={<button className="btn-primary" onClick={() => go('upload')}>Go to Upload</button>}>Upload XER files first.</EmptyState>;
  const canRun = state.groupsConfirmed || state.groups.length === 0;
  const runBtn = (
    <button className="btn-primary" disabled={!canRun || state.optStatus === 'running'} onClick={() => void runOptimization()} data-testid="run-optimization">
      {state.optStatus === 'running' ? <Spinner label="Optimizing…" /> : opt ? 'Re-run optimization' : 'Run optimization'}
    </button>
  );
  const header = <PageHeader eyebrow="Step 6 · Optimize" title="Scenarios & recommendations" subtitle="Six resource strategies evaluated against the same hard constraints, with the recommended changes for the selected one." actions={runBtn} />;
  if (!opt)
    return (
      <div>
        {header}
        {state.optStatus === 'error' && <div className="mb-4"><Notice kind="error" title="Optimization failed">{state.optError}</Notice></div>}
        {!canRun && <div className="mb-4"><Notice kind="warning" title="Confirm the resource mapping first." action={<button className="btn-secondary" onClick={() => go('mapping')}>Review mapping</button>} /></div>}
        {state.optStatus === 'running' ? <div className="card p-10 text-center"><Spinner label="Comparing six resource strategies…" /></div> : <EmptyState title="No results yet">Run the optimization to compare six ways of sharing your crews across projects.</EmptyState>}
      </div>
    );

  const sel: ScenarioResult = opt.scenarios.find((s) => s.id === state.selectedScenarioId) ?? rec ?? opt.scenarios[0];
  const projectNames = opt.projects.map((p) => p.name);
  const base = opt.scenarios.find((s) => s.id === 'baseline');
  const m = METRICS.find((x) => x.key === metric)!;
  const demandGroups = sel.demand.filter((d) => d.total.some((v) => v > 0));
  const series = demandGroups.find((d) => d.groupId === gid) ?? demandGroups[0];

  return (
    <div>
      {header}
      {state.optStatus === 'error' && <div className="mb-4"><Notice kind="error" title="Optimization failed">{state.optError}</Notice></div>}
      {stale && <div className="mb-4"><Notice kind="warning" title="Inputs changed since these results were computed." action={runBtn}>Re-run to update the scenarios.</Notice></div>}

      <Card className="mb-6" title="Scenario comparison" subtitle={`Total optimizer runtime ${fmtNum(opt.totalRuntimeMs, 0)} ms. Select a row for details. ★ = recommended (lowest Z among feasible, capacity-respecting scenarios).`} bodyClass="p-0">
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-line text-sm" data-testid="scenario-table">
            <thead className="bg-plane">
              <tr>
                {['Scenario', 'Constraints', 'Peak over', 'Avg util.', 'Resource cost', 'Transfers', 'Hire cost', 'Total cost', 'Deadlines missed', 'Idle unit-days', 'Finish (per project)', 'Z', 'Runtime'].map((h) => <th key={h} className="th">{h}</th>)}
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {opt.scenarios.map((s) => {
                const mm = s.metrics;
                const active = s.id === sel.id;
                return (
                  <tr key={s.id} onClick={() => selectScenario(s.id)} className={`cursor-pointer ${active ? 'bg-[#eff6ff] shadow-[inset_3px_0_0_#2563eb]' : 'hover:bg-plane'}`} aria-selected={active}>
                    <td className="td whitespace-nowrap font-medium">{rec?.id === s.id && <span title="Recommended" className="mr-1 text-accent">★</span>}{s.name}</td>
                    <td className="td">{s.validation.ok ? <Badge tone="good">✓ satisfied</Badge> : <Badge tone="bad">{mm.constraintViolations} violations</Badge>}{!s.enforcesCapacity && <div className="mt-0.5 text-[11px] text-ink-3">capacity not enforced</div>}</td>
                    <td className="td tabular">{mm.peakOverallocation > 0 ? <span className="font-medium text-[#9b1c1c]">{fmtNum(mm.peakOverallocation, 2)}</span> : '0'}</td>
                    <td className="td tabular">{fmtPct(mm.avgUtilizationPct)}</td>
                    <td className="td tabular">{fmtMoney(mm.resourceCost)}</td>
                    <td className="td tabular">{mm.transfers} · {fmtMoney(mm.transferCost)}</td>
                    <td className="td tabular">{fmtMoney(mm.hireCost)}<div className="text-[11px] text-ink-3">{fmtNum(mm.hiredUnitDays, 1)} unit-days</div></td>
                    <td className="td tabular font-medium">{fmtMoney(mm.totalCost)}{!mm.costComplete && <div className="text-[11px] font-normal text-ink-3" title={mm.costMissing.join(', ')}>excl. {mm.costMissing.length} unpriced</div>}</td>
                    <td className="td tabular">{mm.deadlineViolations ? <Badge tone="bad">{mm.deadlineViolations} · {mm.deadlineDelayDays} wd</Badge> : <Badge tone="good">0</Badge>}</td>
                    <td className="td tabular">{fmtNum(mm.idleUnitDays, 0)}</td>
                    <td className="td whitespace-nowrap text-xs">{mm.projects.map((p) => <div key={p.key}>{fmtFinish(p.finish)} <span className="text-ink-3">({p.durationWorkdays} wd)</span></div>)}</td>
                    <td className="td tabular">{fmtNum(mm.objective.Z, 0)}</td>
                    <td className="td tabular text-ink-3">{fmtNum(mm.runtimeMs, 0)} ms</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>

      <Card
        className="mb-6"
        title={`Scenario comparison — ${m.label}`}
        subtitle="Grey = baseline, red = scenario with constraint violations. One metric at a time."
        actions={<select className="input w-auto" value={metric} onChange={(e) => setMetric(e.target.value)} aria-label="Metric">{METRICS.map((x) => <option key={x.key} value={x.key}>{x.label}</option>)}</select>}
      >
        <ScenarioChart unit={m.unit === 'cost' ? currency || 'cost' : m.unit} data={opt.scenarios.map((s) => ({ name: SCENARIO_INFO[s.id].short, value: m.get(s.metrics), baseline: s.id === 'baseline', infeasible: !s.validation.ok }))} />
      </Card>

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <h2 className="text-lg font-semibold">{sel.name}</h2>
        {rec?.id === sel.id && <Badge tone="navy">★ Recommended</Badge>}
        {sel.rule && <Badge tone="info">best rule: {RULE_LABELS[sel.rule]}{sel.justified ? ' + justification' : ''}</Badge>}
        <select className="input ml-auto w-auto" value={sel.id} onChange={(e) => selectScenario(e.target.value)} aria-label="Scenario" data-testid="scenario-select">
          {opt.scenarios.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
      </div>
      <p className="mb-4 max-w-4xl text-sm text-ink-2">{sel.description}</p>

      <div className="mb-4" data-testid="validation-status">
        {sel.validation.ok ? (
          <Notice kind="ok" title="All constraints satisfied">
            Checked {sel.validation.checked.relationships} relationships, {sel.validation.checked.activities} activity durations, data dates, fixed (completed / in-progress) work{sel.validation.checked.capacityChecked ? ` and ${sel.validation.checked.groupDays} resource-group days against capacity + hired units` : '; capacity is not enforced in this reference scenario'}.
          </Notice>
        ) : (
          <Notice kind="error" title={`${sel.metrics.constraintViolations} constraint violation(s)`}>
            <ul className="mt-1 list-disc pl-5">{sel.validation.violations.slice(0, 12).map((v, i) => <li key={i}>{v.message}</li>)}</ul>
          </Notice>
        )}
      </div>
      {sel.notes.length > 0 && <div className="mb-4 space-y-2">{sel.notes.map((n, i) => <Notice key={i} kind="info" title={n} />)}</div>}

      <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-5">
        <StatTile label="Activities shifted" value={sel.recommendations.shifts.length} hint={`${sel.recommendations.shifts.filter((s) => s.beyondFloat > 0).length} beyond their float`} />
        <StatTile label="Transfers" value={sel.recommendations.transfers.length} hint={fmtMoney(sel.metrics.transferCost, currency)} />
        <StatTile label="Extra units hired" value={fmtNum(sel.metrics.peakHired, 1)} hint={`${fmtNum(sel.metrics.hiredUnitDays, 1)} unit-days · ${fmtMoney(sel.metrics.hireCost, currency)}`} tone={sel.metrics.hiredUnitDays > 0 ? 'warn' : 'neutral'} />
        <StatTile label="Deadlines missed" value={sel.metrics.deadlineViolations} hint={`${sel.metrics.deadlineDelayDays} working days in total`} tone={sel.metrics.deadlineViolations ? 'bad' : 'good'} />
        <StatTile label="Peak over-allocation" value={fmtNum(sel.metrics.peakOverallocation, 2)} hint={base ? `baseline ${fmtNum(base.metrics.peakOverallocation, 2)}` : undefined} tone={sel.metrics.peakOverallocation > 0 ? 'bad' : 'good'} />
      </div>

      <div className="mb-5 inline-flex gap-1 rounded-xl border border-line bg-plane p-1" role="tablist">
        {([['recs', 'Recommended changes'], ['gantt', 'Gantt: original vs optimized'], ['demand', 'Resource demand']] as const).map(([id, label]) => (
          <button key={id} role="tab" aria-selected={tab === id} onClick={() => setTab(id)} className={`rounded-lg px-3.5 py-1.5 text-sm font-medium transition-all ${tab === id ? 'bg-white text-ink shadow-card ring-1 ring-line' : 'text-ink-2 hover:text-ink'}`}>{label}</button>
        ))}
      </div>

      {tab === 'recs' && (
        <div className="space-y-6" data-testid="recommendations">
          <Card title="Deadline impact">
            <DataTable
              rows={sel.recommendations.deadlines}
              rowKey={(d) => d.project}
              filterPlaceholder={null}
              columns={[
                { key: 'p', header: 'Project', value: (d) => d.project, render: (d) => <span className="font-medium">{d.project}</span> },
                { key: 'dl', header: 'Deadline', value: (d) => d.deadline, render: (d) => (d.deadline === null ? <Badge tone="warn">not set</Badge> : fmtFinish(d.deadline)) },
                { key: 'bf', header: 'Baseline finish', value: (d) => d.baselineFinish, render: (d) => fmtFinish(d.baselineFinish) },
                { key: 'nf', header: 'New finish', value: (d) => d.newFinish, render: (d) => fmtFinish(d.newFinish) },
                { key: 'ch', header: 'Change (wd)', align: 'right', value: (d) => d.finishChangeDays, render: (d) => (d.finishChangeDays > 0 ? `+${d.finishChangeDays}` : d.finishChangeDays) },
                { key: 'dy', header: 'Delay vs deadline', align: 'right', value: (d) => d.newDelayDays, render: (d) => (d.deadline === null ? '—' : d.newDelayDays > 0 ? <Badge tone="bad">{d.newDelayDays} wd late</Badge> : <Badge tone="good">met</Badge>) },
                { key: 'mu', header: 'Min. unavoidable delay', align: 'right', value: (d) => d.minUnavoidableDelayDays, render: (d) => `${d.minUnavoidableDelayDays} wd` },
              ]}
            />
          </Card>
          <Card title={`Activity shifts (${sel.recommendations.shifts.length})`} subtitle="Working-day shift of each moved activity, the float it consumes and why it moved.">
            <DataTable
              rows={sel.recommendations.shifts}
              rowKey={(s) => s.key}
              empty="No activity is moved in this scenario."
              columns={[
                { key: 'p', header: 'Project', value: (s) => s.project, render: (s) => s.project },
                { key: 'c', header: 'Activity', wrap: true, value: (s) => `${s.code} ${s.name}`, render: (s) => <div><span className="font-medium">{s.code}</span> <span className="text-ink-2">{s.name}</span>{s.critical && <Badge tone="bad">critical</Badge>}</div> },
                { key: 'o', header: 'Original', value: (s) => s.oldStart, render: (s) => <span className="whitespace-nowrap tabular">{fmtDay(s.oldStart)} → {fmtFinish(s.oldFinish)}</span> },
                { key: 'n', header: 'Optimized', value: (s) => s.newStart, render: (s) => <span className="whitespace-nowrap tabular">{fmtDay(s.newStart)} → {fmtFinish(s.newFinish)}</span> },
                { key: 'sh', header: 'Shift (wd)', align: 'right', value: (s) => s.shiftDays, render: (s) => (s.shiftDays > 0 ? `+${s.shiftDays}` : s.shiftDays) },
                { key: 'tf', header: 'Float', align: 'right', value: (s) => s.totalFloat, render: (s) => s.totalFloat },
                { key: 'fc', header: 'Float used', align: 'right', value: (s) => s.floatConsumed, render: (s) => (s.beyondFloat > 0 ? <span title={`${s.beyondFloat} wd beyond float`}>{s.floatConsumed} <Badge tone="bad">+{s.beyondFloat}</Badge></span> : s.floatConsumed) },
                { key: 'r', header: 'Reason', wrap: true, value: (s) => s.reason, render: (s) => <span className="text-ink-2">{s.reason}</span> },
              ]}
            />
          </Card>
          <div className="grid gap-6 xl:grid-cols-2">
            <Card title={`Resource transfers (${sel.recommendations.transfers.length})`} subtitle="A unit leaves one project's work and joins another's on the same day.">
              <DataTable
                rows={sel.recommendations.transfers}
                rowKey={(t, i) => `${t.groupId}-${t.day}-${i}`}
                empty={sel.id === 'project_leveling' ? 'Dedicated resources per project — no transfers.' : 'No transfers.'}
                columns={[
                  { key: 'd', header: 'Date', value: (t) => t.day, render: (t) => fmtDay(t.day) },
                  { key: 'g', header: 'Group', value: (t) => t.groupName, render: (t) => t.groupName },
                  { key: 'f', header: 'From → to', value: (t) => t.fromProject, render: (t) => `${t.fromProject} → ${t.toProject}` },
                  { key: 'u', header: 'Units', align: 'right', value: (t) => t.units, render: (t) => fmtNum(t.units, 2) },
                  { key: 'c', header: 'Cost', align: 'right', value: (t) => t.cost, render: (t) => fmtMoney(t.cost) },
                ]}
              />
            </Card>
            <Card title={`Extra units to hire (${sel.recommendations.hires.length})`} subtitle="Explicit hires with dates and cost — never hidden in the capacity.">
              <DataTable
                rows={sel.recommendations.hires}
                rowKey={(h) => `${h.groupId}-${h.start}`}
                empty="No hiring needed."
                columns={[
                  { key: 'g', header: 'Group', value: (h) => h.groupName, render: (h) => h.groupName },
                  { key: 's', header: 'From', value: (h) => h.start, render: (h) => fmtDay(h.start) },
                  { key: 'e', header: 'To', value: (h) => h.end, render: (h) => fmtDay(h.end) },
                  { key: 'p', header: 'Peak units', align: 'right', value: (h) => h.peakUnits, render: (h) => fmtNum(h.peakUnits, 2) },
                  { key: 'u', header: 'Unit-days', align: 'right', value: (h) => h.unitDays, render: (h) => fmtNum(h.unitDays, 1) },
                  { key: 'c', header: 'Cost', align: 'right', value: (h) => h.cost, render: (h) => fmtMoney(h.cost) },
                ]}
              />
            </Card>
          </div>
        </div>
      )}

      {tab === 'gantt' && (
        <Card title="Original vs optimized" actions={<label className="flex items-center gap-2 text-sm"><input type="checkbox" className="h-4 w-4 accent-navy-700" checked={onlyShifted} onChange={(e) => setOnlyShifted(e.target.checked)} /> Only moved activities</label>}>
          <Gantt activities={opt.activities} start={sel.start} finish={sel.finish} projectNames={projectNames} onlyShifted={onlyShifted} />
        </Card>
      )}

      {tab === 'demand' && series && (
        <Card
          title={`Daily demand — ${series.name} (${SCENARIO_INFO[sel.id].short})`}
          actions={<select className="input w-auto" value={series.groupId} onChange={(e) => setGid(e.target.value)} aria-label="Resource group">{demandGroups.map((d) => <option key={d.groupId} value={d.groupId}>{d.name}</option>)}</select>}
        >
          <DemandChart series={series} projectNames={projectNames} />
        </Card>
      )}
      <div className="mt-6 flex justify-end gap-2">
        <button className="btn-secondary" onClick={() => go('assistant')}>Ask the AI assistant</button>
        <button className="btn-primary" onClick={() => go('reports')}>Export report →</button>
      </div>
    </div>
  );
}
