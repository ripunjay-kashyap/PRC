import { useState, type ReactNode } from 'react';
import { useStore } from '../state/store';
import { Badge, Card, DataTable, EmptyState, Notice, PageHeader, StatTile } from '../components/ui';
import { DemandChart } from '../charts/DemandChart';
import { fmtDay, fmtNum, fmtPct } from '../lib/format';
import type { PageProps } from './types';
import type { OverPeriod } from '../lib/analysis/conflicts';

export function ConflictsPage({ go }: PageProps) {
  const { state, analysis } = useStore();
  const [gid, setGid] = useState<string | null>(null);
  if (!state.model || !analysis) return <EmptyState title="No projects loaded" action={<button className="btn-primary" onClick={() => go('upload')}>Go to Upload</button>}>Upload XER files first.</EmptyState>;
  if (!state.model.assignments.length) return <EmptyState title="No resource data" action={<button className="btn-primary" onClick={() => go('upload')}>Import assignments</button>}>Conflicts need resource assignments, which the XER files do not contain. Import a CSV on the Upload page.</EmptyState>;
  if (!state.groupsConfirmed)
    return <EmptyState title="Confirm the resource mapping first" action={<button className="btn-primary" onClick={() => go('mapping')}>Review mapping</button>}>Conflict analysis uses the confirmed resource groups.</EmptyState>;

  const conflicts = analysis.conflicts;
  const ranked = [...conflicts].sort((a, b) => b.overUnitDays - a.overUnitDays || b.peakDemand - a.peakDemand);
  const current = conflicts.find((c) => c.groupId === gid) ?? ranked[0];
  const series = analysis.baselineDemand.find((d) => d.groupId === current?.groupId);
  const projectNames = analysis.projects.map((p) => p.name);
  const overGroups = conflicts.filter((c) => c.peakOver > 0);
  const excluded = new Set(analysis.groups.filter((g) => g.type === 'material' && !state.settings?.includeMaterials).map((g) => g.id));
  const missingCap = conflicts.filter((c) => c.capacity === null && c.activeDays > 0 && !excluded.has(c.groupId));
  const critDays = conflicts.reduce((s, c) => s + c.criticalOverDays, 0);

  return (
    <div>
      <PageHeader title="Conflict analysis" subtitle="Daily demand of every pooled resource group across all projects (baseline dates) against its capacity." />
      <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatTile label="Over-allocated groups" value={`${overGroups.length} / ${conflicts.length}`} tone={overGroups.length ? 'bad' : 'good'} hint={overGroups.length ? overGroups.map((c) => c.name).join(', ') : 'no conflicts'} />
        <StatTile label="Peak over-allocation" value={fmtNum(Math.max(0, ...conflicts.map((c) => c.peakOver)), 2)} hint="units above capacity on the worst day" tone={overGroups.length ? 'bad' : 'neutral'} />
        <StatTile label="Over-allocated unit-days" value={fmtNum(conflicts.reduce((s, c) => s + c.overUnitDays, 0), 1)} />
        <StatTile label="Days hitting critical work" value={critDays} hint="over-allocated days on activities with float ≤ 0" tone={critDays ? 'bad' : 'neutral'} />
      </div>
      {missingCap.length > 0 && (
        <div className="mb-4">
          <Notice kind="warning" title={`${missingCap.length} group(s) have no capacity: ${missingCap.map((c) => c.name).join(', ')}`} action={<button className="btn-secondary" onClick={() => go('settings')}>Enter capacities</button>}>
            Their demand is shown but no conflicts can be measured until a capacity is entered.
          </Notice>
        </div>
      )}

      {current && series && (
        <Card
          className="mb-6"
          title={`Daily demand vs capacity — ${current.name}`}
          subtitle="Stacked by project. Dashed line = capacity; red bands = over-allocated days."
          actions={
            <select className="input w-auto" value={current.groupId} onChange={(e) => setGid(e.target.value)} aria-label="Resource group" data-testid="conflict-group">
              {ranked.map((c) => <option key={c.groupId} value={c.groupId}>{c.name}{c.peakOver > 0 ? ` — over by ${fmtNum(c.peakOver, 2)}` : ''}</option>)}
            </select>
          }
        >
          <div className="mb-4 flex flex-wrap gap-x-8 gap-y-2 text-sm">
            <Metric label="Capacity" value={current.capacity === null ? 'missing' : fmtNum(current.capacity, 2)} />
            <Metric label="Peak demand" value={fmtNum(current.peakDemand, 2)} />
            <Metric label="Peak over" value={fmtNum(current.peakOver, 2)} bad={current.peakOver > 0} />
            <Metric label="Over-allocated days" value={current.overDays} bad={current.overDays > 0} />
            <Metric label="Utilisation" value={fmtPct(current.utilizationPct)} />
            <Metric label="Idle unit-days" value={fmtNum(current.idleUnitDays, 1)} />
            {!current.leveled && <Badge tone="warn">not leveled ({excluded.has(current.groupId) ? 'material, excluded' : 'no capacity'})</Badge>}
          </div>
          <DemandChart series={series} projectNames={projectNames} />
        </Card>
      )}

      <div className="grid gap-6 xl:grid-cols-2">
        <Card title="Over-allocated periods" subtitle={current ? current.name : ''}>
          <DataTable<OverPeriod>
            rows={current?.overPeriods ?? []}
            rowKey={(p) => String(p.start)}
            empty="No over-allocation for this group."
            columns={[
              { key: 's', header: 'From', value: (p) => p.start, render: (p) => fmtDay(p.start) },
              { key: 'e', header: 'To', value: (p) => p.end, render: (p) => fmtDay(p.end) },
              { key: 'd', header: 'Days', align: 'right', value: (p) => p.days, render: (p) => p.days },
              { key: 'x', header: 'Peak excess', align: 'right', value: (p) => p.peakExcess, render: (p) => <span className="font-medium text-[#9b1c1c]">{fmtNum(p.peakExcess, 2)}</span> },
              { key: 'p', header: 'Projects', wrap: true, value: (p) => p.projects.join(', '), render: (p) => p.projects.join(', ') },
              { key: 'c', header: 'Critical', value: (p) => (p.critical ? 1 : 0), render: (p) => (p.critical ? <Badge tone="bad" title={p.criticalActivities.join(', ')}>⚠ {p.criticalActivities.length} critical</Badge> : <span className="text-ink-3">no</span>) },
            ]}
          />
        </Card>
        <Card title="Idle and under-utilised periods" subtitle={current ? `${current.name} — inside its active window` : ''}>
          <DataTable
            rows={current?.lowPeriods ?? []}
            rowKey={(p) => String(p.start)}
            empty="No idle or under-utilised periods."
            columns={[
              { key: 'k', header: 'Type', value: (p) => p.kind, render: (p) => (p.kind === 'idle' ? <Badge>idle</Badge> : <Badge tone="warn">under-utilised</Badge>) },
              { key: 's', header: 'From', value: (p) => p.start, render: (p) => fmtDay(p.start) },
              { key: 'e', header: 'To', value: (p) => p.end, render: (p) => fmtDay(p.end) },
              { key: 'd', header: 'Days', align: 'right', value: (p) => p.days, render: (p) => p.days },
              { key: 'u', header: 'Avg utilisation', align: 'right', value: (p) => p.avgUtilizationPct, render: (p) => fmtPct(p.avgUtilizationPct) },
            ]}
          />
        </Card>
      </div>

      <Card className="mt-6" title="All resource groups">
        <DataTable
          rows={ranked}
          rowKey={(c) => c.groupId}
          testId="conflict-table"
          columns={[
            { key: 'n', header: 'Group', value: (c) => c.name, render: (c) => <button className="font-medium text-navy-500 hover:underline" onClick={() => setGid(c.groupId)}>{c.name}</button> },
            { key: 'cap', header: 'Capacity', align: 'right', value: (c) => c.capacity, render: (c) => (c.capacity === null ? <Badge tone="warn">missing</Badge> : fmtNum(c.capacity, 2)) },
            { key: 'pd', header: 'Peak demand', align: 'right', value: (c) => c.peakDemand, render: (c) => fmtNum(c.peakDemand, 2) },
            { key: 'po', header: 'Peak over', align: 'right', value: (c) => c.peakOver, render: (c) => (c.peakOver > 0 ? <span className="font-medium text-[#9b1c1c]">{fmtNum(c.peakOver, 2)}</span> : '0') },
            { key: 'od', header: 'Over days', align: 'right', value: (c) => c.overDays, render: (c) => c.overDays },
            { key: 'ou', header: 'Over unit-days', align: 'right', value: (c) => c.overUnitDays, render: (c) => fmtNum(c.overUnitDays, 1) },
            { key: 'cr', header: 'Critical days', align: 'right', value: (c) => c.criticalOverDays, render: (c) => c.criticalOverDays },
            { key: 'u', header: 'Utilisation', align: 'right', value: (c) => c.utilizationPct, render: (c) => fmtPct(c.utilizationPct) },
            { key: 'i', header: 'Idle unit-days', align: 'right', value: (c) => c.idleUnitDays, render: (c) => fmtNum(c.idleUnitDays, 1) },
          ]}
        />
      </Card>
      <div className="mt-6 flex justify-end"><button className="btn-primary" onClick={() => go('settings')}>Optimization Settings →</button></div>
    </div>
  );
}

function Metric({ label, value, bad }: { label: string; value: ReactNode; bad?: boolean }) {
  return (
    <div>
      <div className="label">{label}</div>
      <div className={`text-base font-semibold tabular ${bad ? 'text-[#9b1c1c]' : 'text-ink'}`}>{value}</div>
    </div>
  );
}
