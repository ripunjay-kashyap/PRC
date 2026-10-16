import { useMemo, useState } from 'react';
import { useStore } from '../state/store';
import { Badge, Card, EmptyState, Notice, PageHeader } from '../components/ui';
import { mergeGroups, normalizeName, projectTokens, splitMember, updateGroup } from '../lib/resources/matching';
import type { PageProps } from './types';

export function MappingPage({ go }: PageProps) {
  const { state, setGroups, confirmGroups } = useStore();
  const [selected, setSelected] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState('');
  const model = state.model;
  const tokens = useMemo(() => (model ? projectTokens(model.projects) : new Set<string>()), [model]);
  if (!model) return <EmptyState title="No projects loaded" action={<button className="btn-primary" onClick={() => go('upload')}>Go to Upload</button>}>Upload XER files first.</EmptyState>;
  if (!model.assignments.length)
    return (
      <EmptyState title="No resources to map" action={<button className="btn-primary" onClick={() => go('upload')}>Import assignments</button>}>
        The loaded XER files contain no resource assignments. Import an assignment CSV on the Upload page (or load the sample data).
      </EmptyState>
    );

  const resByKey = new Map(model.resources.map((r) => [r.key, r]));
  const projOfFile = (fileId: string) => model.projects.filter((p) => p.fileId === fileId).map((p) => p.displayName).join(', ');
  const groups = state.groups.filter((g) => !q || g.name.toLowerCase().includes(q.toLowerCase()) || g.memberKeys.some((k) => resByKey.get(k)?.name.toLowerCase().includes(q.toLowerCase())));
  const edit = (next: typeof state.groups) => {
    setError(null);
    setGroups(next, true);
  };
  const merge = () => {
    try {
      edit(mergeGroups(model, state.groups, selected));
      setSelected([]);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };
  const moveTo = (fromId: string, memberKey: string, toId: string) => {
    if (state.groups.find((x) => x.id === fromId)?.memberKeys.length === 1) {
      edit(mergeGroups(model, state.groups, [toId, fromId]));
      return;
    }
    const afterSplit = splitMember(model, state.groups, fromId, memberKey);
    const single = afterSplit.find((g) => g.memberKeys.length === 1 && g.memberKeys[0] === memberKey && g.id !== fromId)!;
    try {
      edit(mergeGroups(model, afterSplit, [toId, single.id]));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <div>
      <PageHeader eyebrow="Step 3 · Map resources"
        title="Resource mapping"
        subtitle="Resources with similar names across projects are suggested as one pooled group (names normalised for case, punctuation, plurals, synonyms and project suffixes). Review, rename, merge or split, then confirm. All further analysis uses the confirmed groups."
        actions={
          state.groupsConfirmed ? (
            <>
              <Badge tone="good">Mapping confirmed</Badge>
              <button className="btn-secondary" onClick={() => confirmGroups(false)}>Edit again</button>
              <button className="btn-primary" onClick={() => go('conflicts')}>Conflict Analysis →</button>
            </>
          ) : (
            <button className="btn-primary" data-testid="confirm-mapping" onClick={() => confirmGroups(true)}>Confirm mapping ({state.groups.length} groups)</button>
          )
        }
      />
      {!state.groupsConfirmed && <div className="mb-4"><Notice kind="warning" title="Review the suggested groups and confirm them to continue." /></div>}
      {error && <div className="mb-4"><Notice kind="error" title={error} /></div>}
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <input className="input max-w-xs" placeholder="Search groups or resources…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search resources" />
        <button className="btn-secondary" disabled={selected.length < 2} onClick={merge}>Merge selected ({selected.length})</button>
        {selected.length > 0 && <button className="btn-ghost" onClick={() => setSelected([])}>Clear selection</button>}
      </div>
      <div className="grid gap-4 lg:grid-cols-2" data-testid="groups">
        {groups.map((g) => (
          <Card
            key={g.id}
            title={
              <span className="flex items-center gap-2">
                <input type="checkbox" className="h-4 w-4 accent-navy-700" checked={selected.includes(g.id)} onChange={(e) => setSelected((s) => (e.target.checked ? [...s, g.id] : s.filter((x) => x !== g.id)))} aria-label={`Select ${g.name}`} />
                <input className="rounded border border-transparent bg-transparent px-1 py-0.5 font-semibold hover:border-line focus:border-navy-500 focus:outline-none" value={g.name} onChange={(e) => setGroups(updateGroup(state.groups, g.id, { name: e.target.value }))} aria-label="Group name" />
              </span>
            }
            actions={
              <>
                <Badge tone="info">{g.type}</Badge>
                {g.capacity === null ? <Badge tone="warn" title={g.capacityHint !== null ? `Known members sum to ${g.capacityHint}` : undefined}>capacity missing</Badge> : <Badge>capacity {g.capacity} ({g.capacitySource})</Badge>}
                {g.memberKeys.length > 1 ? <Badge tone="good">{g.memberKeys.length} matched</Badge> : <Badge>single</Badge>}
              </>
            }
            bodyClass="p-0"
          >
            <ul className="divide-y divide-line">
              {g.memberKeys.map((k) => {
                const r = resByKey.get(k);
                return (
                  <li key={k} className="flex flex-wrap items-center gap-2 px-5 py-2.5 text-sm">
                    <div className="min-w-0 flex-1">
                      <div className="font-medium text-ink">{r?.name ?? k}</div>
                      <div className="text-xs text-ink-3">
                        {projOfFile(r?.fileId ?? '')} · normalised “{normalizeName(r?.name ?? '', tokens)}” · max {r?.maxUnits ?? '—'} · {r?.source.toUpperCase()}
                      </div>
                    </div>
                    {g.memberKeys.length > 1 && <button className="btn-ghost px-2 py-1 text-xs" onClick={() => edit(splitMember(model, state.groups, g.id, k))}>Split out</button>}
                    <select
                      className="input w-auto py-1 text-xs"
                      value=""
                      onChange={(e) => e.target.value && moveTo(g.id, k, e.target.value)}
                      aria-label={`Move ${r?.name} to group`}
                      disabled={g.memberKeys.length < 2 && state.groups.filter((x) => x.type === g.type).length < 2}
                    >
                      <option value="">Move to…</option>
                      {state.groups.filter((x) => x.id !== g.id && x.type === g.type).map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
                    </select>
                  </li>
                );
              })}
            </ul>
          </Card>
        ))}
      </div>
    </div>
  );
}
