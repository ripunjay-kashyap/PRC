import { useMemo, type ReactNode } from 'react';
import { useStore } from '../state/store';
import { Badge, Card, EmptyState, Notice, PageHeader, Spinner } from '../components/ui';
import { updateGroup } from '../lib/resources/matching';
import { dayToISO, isoToDay } from '../lib/calendar';
import { prepareContext } from '../lib/scheduling/cpm';
import { computeShares } from '../lib/scheduling/scenarios';
import { DEFAULT_WEIGHTS, type ObjectiveWeights, type ResourceGroup } from '../lib/settings';
import { fmtFinish } from '../lib/format';
import type { PageProps } from './types';

const num = (v: string): number | null => (v.trim() === '' || !Number.isFinite(Number(v)) ? null : Number(v));

export function SettingsPage({ go }: PageProps) {
  const { state, setSettings, setGroups, runOptimization, analysis, currency } = useStore();
  const { model, settings, groups } = state;
  const autoShares = useMemo(() => {
    if (!model || !settings) return null;
    try {
      const ctx = prepareContext(model, groups, { ...settings, shares: {} });
      return computeShares(ctx, { ...settings, shares: {} });
    } catch {
      return null;
    }
  }, [model, groups, settings]);
  if (!model || !settings) return <EmptyState title="No projects loaded" action={<button className="btn-primary" onClick={() => go('upload')}>Go to Upload</button>}>Upload XER files first.</EmptyState>;

  const setW = (k: keyof ObjectiveWeights, v: string) => setSettings({ ...settings, weights: { ...settings.weights, [k]: num(v) ?? 0 } });
  const setG = (id: string, patch: Partial<ResourceGroup>) => setGroups(updateGroup(groups, id, patch));
  const leveledGroups = groups.filter((g) => settings.includeMaterials || g.type !== 'material');
  const missingCap = leveledGroups.filter((g) => g.capacity === null);
  const canRun = state.groupsConfirmed || groups.length === 0;

  return (
    <div>
      <PageHeader
        title="Optimization settings"
        subtitle="Capacities, costs, deadlines and objective weights. Defaults come from the XER files where available; every value you change is used by all six scenarios."
        actions={
          <button className="btn-primary" disabled={!canRun || state.optStatus === 'running'} onClick={async () => { await runOptimization(); go('scenarios'); }} data-testid="run-optimization-settings">
            {state.optStatus === 'running' ? <Spinner label="Optimizing…" /> : 'Run optimization'}
          </button>
        }
      />
      {!canRun && <div className="mb-4"><Notice kind="warning" title="Confirm the resource mapping before optimizing." action={<button className="btn-secondary" onClick={() => go('mapping')}>Review mapping</button>} /></div>}
      {missingCap.length > 0 && (
        <div className="mb-4"><Notice kind="warning" title={`Capacity missing for ${missingCap.map((g) => g.name).join(', ')}`}>These groups are flagged and not leveled until a capacity is entered below.</Notice></div>
      )}

      <Card className="mb-6" title="Objective  Z = α·C + β·D + γ·O + δ·U" subtitle="The optimizer keeps the plan with the lowest Z (cost and deadline scenarios rank by C or D first).">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Field label="α — cost weight" hint={`× C: resource + transfer + hire cost (${currency || 'currency'})`}><input className="input" type="number" step="any" min={0} value={settings.weights.alpha} onChange={(e) => setW('alpha', e.target.value)} /></Field>
          <Field label="β — delay weight" hint="per working day late × project weight"><input className="input" type="number" step="any" min={0} value={settings.weights.beta} onChange={(e) => setW('beta', e.target.value)} /></Field>
          <Field label="γ — over-allocation weight" hint="per unit-day above capacity"><input className="input" type="number" step="any" min={0} value={settings.weights.gamma} onChange={(e) => setW('gamma', e.target.value)} /></Field>
          <Field label="δ — idle weight" hint="per idle unit-day"><input className="input" type="number" step="any" min={0} value={settings.weights.delta} onChange={(e) => setW('delta', e.target.value)} /></Field>
        </div>
        <button className="btn-ghost mt-3 text-xs" onClick={() => setSettings({ ...settings, weights: { ...DEFAULT_WEIGHTS } })}>Reset weights to defaults</button>
      </Card>

      <Card className="mb-6" title="Projects — deadlines and priority">
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-line text-sm">
            <thead><tr><th className="th">Project</th><th className="th">Deadline (last working day)</th><th className="th">Source</th><th className="th">Logic-only finish</th><th className="th">Priority weight</th></tr></thead>
            <tbody className="divide-y divide-line">
              {model.projects.map((p) => {
                const ps = settings.projects[p.key];
                const info = analysis?.projects.find((x) => x.key === p.key);
                const late = ps?.deadline != null && info && info.logicFinish > ps.deadline;
                return (
                  <tr key={p.key}>
                    <td className="td font-medium">{p.displayName}</td>
                    <td className="td">
                      <input
                        type="date"
                        className="input w-44"
                        value={ps?.deadline != null ? dayToISO(ps.deadline - 1) : ''}
                        onChange={(e) => {
                          const d = isoToDay(e.target.value);
                          setSettings({ ...settings, projects: { ...settings.projects, [p.key]: { ...ps, deadline: d === null ? null : d + 1, deadlineSource: d === null ? 'none' : 'user' } } });
                        }}
                        aria-label={`Deadline for ${p.displayName}`}
                      />
                    </td>
                    <td className="td">{ps?.deadlineSource === 'none' ? <Badge tone="warn">not set</Badge> : <Badge tone={ps?.deadlineSource === 'user' ? 'info' : ps?.deadlineSource === 'scd_end' ? 'warn' : 'neutral'}>{{ plan_end: 'XER planned end', scd_end: 'XER scheduled finish (fallback)', user: 'entered', none: '' }[ps?.deadlineSource ?? 'none']}</Badge>}</td>
                    <td className="td tabular">{fmtFinish(info?.logicFinish)} {late && <Badge tone="bad">deadline infeasible</Badge>}</td>
                    <td className="td"><input className="input w-24" type="number" min={0} step="0.5" value={ps?.priorityWeight ?? 1} onChange={(e) => setSettings({ ...settings, projects: { ...settings.projects, [p.key]: { ...ps, priorityWeight: num(e.target.value) ?? 1 } } })} aria-label={`Priority weight for ${p.displayName}`} /></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>

      <Card className="mb-6" title="Resource groups — capacity, costs, transfers and hiring" subtitle={`Costs in ${currency || 'the project currency'} per unit per working day. Hire cost blank = cost rate × hire premium.`}>
        {groups.length === 0 ? (
          <p className="text-sm text-ink-2">No resource groups — import assignments on the Upload page.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-line text-sm" data-testid="group-settings">
              <thead><tr>{['Group', 'Capacity', 'Cost / unit-day', 'Mobilisation days', 'Transfer cost / unit', 'Hire cost / unit-day', 'Max hire / day'].map((h) => <th key={h} className="th">{h}</th>)}</tr></thead>
              <tbody className="divide-y divide-line">
                {groups.map((g) => (
                  <tr key={g.id} className={g.capacity === null && (settings.includeMaterials || g.type !== 'material') ? 'bg-[#fff8e8]' : ''}>
                    <td className="td"><div className="font-medium">{g.name}</div><div className="text-xs text-ink-3">{g.type}{g.type === 'material' && !settings.includeMaterials ? ' · excluded from leveling' : ''}</div></td>
                    <td className="td">
                      <input className="input w-24" type="number" min={0} step="any" value={g.capacity ?? ''} placeholder={g.capacityHint !== null ? `hint ${g.capacityHint}` : 'required'} onChange={(e) => setG(g.id, { capacity: num(e.target.value), capacitySource: num(e.target.value) === null ? null : 'user' })} aria-label={`Capacity for ${g.name}`} />
                      <div className="mt-0.5 text-[11px] text-ink-3">{g.capacitySource ? `from ${g.capacitySource === 'user' ? 'you' : g.capacitySource.toUpperCase()}` : 'missing'}</div>
                    </td>
                    <td className="td"><input className="input w-28" type="number" min={0} step="any" value={g.costPerUnitDay ?? ''} placeholder="not set" onChange={(e) => setG(g.id, { costPerUnitDay: num(e.target.value), costSource: 'user' })} aria-label={`Cost for ${g.name}`} /></td>
                    <td className="td"><input className="input w-20" type="number" min={0} step="1" value={g.mobilizationDays} onChange={(e) => setG(g.id, { mobilizationDays: num(e.target.value) ?? 0 })} aria-label={`Mobilisation days for ${g.name}`} /></td>
                    <td className="td"><input className="input w-24" type="number" min={0} step="any" value={g.transferCostPerUnit} onChange={(e) => setG(g.id, { transferCostPerUnit: num(e.target.value) ?? 0 })} aria-label={`Transfer cost for ${g.name}`} /></td>
                    <td className="td"><input className="input w-28" type="number" min={0} step="any" value={g.hireCostPerUnitDay ?? ''} placeholder={g.costPerUnitDay !== null ? `${g.costPerUnitDay * settings.hirePremium}` : 'not set'} onChange={(e) => setG(g.id, { hireCostPerUnitDay: num(e.target.value) })} aria-label={`Hire cost for ${g.name}`} /></td>
                    <td className="td"><input className="input w-20" type="number" min={0} step="1" value={g.maxHire} onChange={(e) => setG(g.id, { maxHire: num(e.target.value) ?? 0 })} aria-label={`Max hire for ${g.name}`} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {groups.length > 0 && model.projects.length > 1 && autoShares && (
        <Card className="mb-6" title="Scenario 2 — capacity share per project" subtitle="Units of each group dedicated to each project when projects are leveled separately. Blank = proportional to baseline demand (shown as placeholder).">
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-line text-sm">
              <thead><tr><th className="th">Group</th>{model.projects.map((p) => <th key={p.key} className="th">{p.displayName}</th>)}<th className="th">Capacity</th><th className="th" /></tr></thead>
              <tbody className="divide-y divide-line">
                {groups.filter((g) => g.capacity !== null && (settings.includeMaterials || g.type !== 'material')).map((g) => {
                  const gi = groups.indexOf(g);
                  const user = settings.shares[g.id];
                  const sum = model.projects.reduce((s, p, pi) => s + (user?.[p.key] ?? autoShares[gi]?.[pi] ?? 0), 0);
                  return (
                    <tr key={g.id}>
                      <td className="td font-medium">{g.name}</td>
                      {model.projects.map((p, pi) => (
                        <td key={p.key} className="td">
                          <input
                            className="input w-20"
                            type="number"
                            min={0}
                            step="any"
                            value={user?.[p.key] ?? ''}
                            placeholder={String(autoShares[gi]?.[pi] ?? '')}
                            onChange={(e) => {
                              const v = num(e.target.value);
                              const next = { ...(settings.shares[g.id] ?? Object.fromEntries(model.projects.map((x, xi) => [x.key, autoShares[gi]?.[xi] ?? 0]))) };
                              if (v === null) delete next[p.key];
                              else next[p.key] = v;
                              setSettings({ ...settings, shares: { ...settings.shares, [g.id]: next } });
                            }}
                            aria-label={`Share of ${g.name} for ${p.displayName}`}
                          />
                        </td>
                      ))}
                      <td className="td tabular">{g.capacity} {sum > (g.capacity ?? 0) + 1e-9 && <Badge tone="bad">shares exceed capacity</Badge>}</td>
                      <td className="td">{user && <button className="btn-ghost px-2 py-1 text-xs" onClick={() => { const s = { ...settings.shares }; delete s[g.id]; setSettings({ ...settings, shares: s }); }}>Reset</button>}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      <Card title="Other options">
        <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
          <Field label="Material resources" hint="Excluded from capacity leveling by default">
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" className="h-4 w-4 accent-navy-700" checked={settings.includeMaterials} onChange={(e) => setSettings({ ...settings, includeMaterials: e.target.checked })} /> Include materials in leveling</label>
          </Field>
          <Field label="Under-utilisation threshold" hint="Days below this share of capacity are flagged">
            <input className="input" type="number" min={0} max={1} step="0.05" value={settings.underutilizationThreshold} onChange={(e) => setSettings({ ...settings, underutilizationThreshold: num(e.target.value) ?? 0.5 })} />
          </Field>
          <Field label="Hire premium" hint="Hire cost = cost rate × premium (when not entered)">
            <input className="input" type="number" min={0} step="0.1" value={settings.hirePremium} onChange={(e) => setSettings({ ...settings, hirePremium: num(e.target.value) ?? 1 })} />
          </Field>
          <Field label="Unscheduled P6 projects" hint="Baseline when the file has no calculated dates">
            <select className="input" value={settings.unscheduledBaseline} onChange={(e) => setSettings({ ...settings, unscheduledBaseline: e.target.value as 'cpm' | 'target' })}>
              <option value="cpm">CPM dates computed by the app</option>
              <option value="target">P6 target dates (may break logic)</option>
            </select>
          </Field>
        </div>
      </Card>
    </div>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <div className="block">
      <span className="text-[13px] font-medium text-ink-2">{label}</span>
      <div className="mt-1">{children}</div>
      {hint && <span className="mt-1 block text-xs text-ink-3">{hint}</span>}
    </div>
  );
}
