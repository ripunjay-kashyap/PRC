import { useStore } from '../state/store';
import { Badge, Card, DataTable, EmptyState, Notice, PageHeader, StatTile } from '../components/ui';
import { Timeline } from '../charts/Timeline';
import { seriesColor } from '../charts/palette';
import { fmtDay, fmtFinish, fmtNum } from '../lib/format';
import type { PageProps } from './types';

export function ComparisonPage({ go }: PageProps) {
  const { state, analysis, analysisError } = useStore();
  if (!state.model) return <EmptyState title="No projects loaded" action={<button className="btn-primary" onClick={() => go('upload')}>Go to Upload</button>}>Upload XER files or load the sample data first.</EmptyState>;
  if (analysisError) return <Notice kind="error" title="Analysis failed">{analysisError}</Notice>;
  if (!analysis) return null;
  const cmp = analysis.comparison;
  const groups = analysis.groups;
  return (
    <div>
      <PageHeader title="Project comparison" subtitle="Durations, size, resource needs and the period in which the projects compete for resources (baseline dates)." />
      <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatTile label="Projects" value={cmp.projects.length} hint={`${state.model.files.length} file(s)`} />
        <StatTile label="Activities" value={fmtNum(analysis.activities.length)} hint={`${analysis.activities.filter((a) => a.totalFloat <= 0).length} critical (float ≤ 0)`} />
        <StatTile label="Resource groups" value={groups.length} hint={`${groups.filter((g) => g.leveled).length} with known capacity`} tone={groups.length && !groups.some((g) => g.leveled) ? 'warn' : 'neutral'} />
        <StatTile label="Overlap" value={cmp.overlaps.length ? `${Math.max(...cmp.overlaps.map((o) => o.workdays))} wd` : '—'} hint={cmp.overlaps.length ? 'longest pairwise overlap' : 'projects do not overlap'} />
      </div>

      <Card title="Timeline" subtitle="Baseline spans; the shaded band is where all projects run at the same time. Black marks are deadlines." className="mb-6">
        <Timeline projects={cmp.projects} />
      </Card>

      <Card title="Projects" className="mb-6">
        <DataTable
          rows={cmp.projects}
          rowKey={(p) => p.key}
          filterPlaceholder={null}
          columns={[
            { key: 'name', header: 'Project', value: (p) => p.name, render: (p) => <span className="flex items-center gap-2 font-medium"><span className="h-2.5 w-2.5 rounded-sm" style={{ background: seriesColor(cmp.projects.indexOf(p)) }} />{p.name}</span> },
            { key: 'file', header: 'File', value: (p) => p.fileName, render: (p) => <span className="text-ink-2">{p.fileName}</span> },
            { key: 'dd', header: 'Data date', value: (p) => p.dataDate, render: (p) => fmtDay(p.dataDate) },
            { key: 'start', header: 'Start', value: (p) => p.start, render: (p) => fmtDay(p.start) },
            { key: 'finish', header: 'Finish', value: (p) => p.finish, render: (p) => fmtFinish(p.finish) },
            { key: 'dur', header: 'Duration (wd)', align: 'right', value: (p) => p.durationWorkdays, render: (p) => fmtNum(p.durationWorkdays) },
            { key: 'acts', header: 'Activities', align: 'right', value: (p) => p.activityCount, render: (p) => `${p.activityCount} (${p.milestoneCount} ms)` },
            { key: 'rels', header: 'Links', align: 'right', value: (p) => p.relationshipCount, render: (p) => p.relationshipCount },
            { key: 'crit', header: 'Critical', align: 'right', value: (p) => p.criticalCount, render: (p) => p.criticalCount },
            { key: 'types', header: 'Resource types', render: (p) => (p.resourceTypes.length ? p.resourceTypes.join(', ') : <span className="text-ink-3">none</span>) },
            { key: 'dl', header: 'Deadline', value: (p) => p.deadline, render: (p) => (p.deadline === null ? <Badge tone="warn">not set</Badge> : fmtFinish(p.deadline)) },
            { key: 'src', header: 'Dates', render: (p) => (p.baselineFromCpm ? <Badge tone="warn" title="The P6 file was not scheduled; dates computed by CPM from the data date">CPM (app)</Badge> : <Badge tone="info">P6</Badge>) },
          ]}
        />
      </Card>

      <Card title="Total planned demand per resource group" subtitle="Unit-days over each project's baseline (units per day × working days).">
        {groups.length === 0 ? (
          <p className="text-sm text-ink-2">No resource assignments loaded — import them on the Upload page.</p>
        ) : (
          <DataTable
            rows={groups}
            rowKey={(g) => g.id}
            columns={[
              { key: 'g', header: 'Resource group', value: (g) => g.name, render: (g) => <span className="font-medium">{g.name}</span> },
              { key: 't', header: 'Type', value: (g) => g.type, render: (g) => g.type },
              ...cmp.projects.map((p, pi) => ({
                key: `p${pi}`,
                header: p.name,
                align: 'right' as const,
                value: (g: (typeof groups)[number]) => p.demandByGroup[g.id] ?? 0,
                render: (g: (typeof groups)[number]) => fmtNum(p.demandByGroup[g.id] ?? 0, 1),
              })),
              { key: 'tot', header: 'Total', align: 'right', value: (g) => cmp.projects.reduce((s, p) => s + (p.demandByGroup[g.id] ?? 0), 0), render: (g) => <span className="font-medium">{fmtNum(cmp.projects.reduce((s, p) => s + (p.demandByGroup[g.id] ?? 0), 0), 1)}</span> },
              { key: 'cap', header: 'Capacity', align: 'right', value: (g) => g.capacity, render: (g) => (g.capacity === null ? <Badge tone="warn">missing</Badge> : g.capacity) },
            ]}
          />
        )}
      </Card>
    </div>
  );
}
