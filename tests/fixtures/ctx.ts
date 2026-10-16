import { suggestGroups } from '../../src/lib/resources/matching';
import { prepareContext } from '../../src/lib/scheduling/cpm';
import { defaultSettings, type Settings } from '../../src/lib/settings';
import { makeModel, type ModelSpec } from './modelBuilder';

/** Build a prepared context; every group gets `capacity` (or its own max) and a cost rate. */
export function ctxFrom(spec: ModelSpec, opts: { capacity?: Record<string, number>; settings?: (s: Settings) => void; cost?: number } = {}) {
  const model = makeModel(spec);
  const groups = suggestGroups(model).map((g) => ({
    ...g,
    capacity: opts.capacity?.[g.name] ?? g.capacity,
    capacitySource: 'user' as const,
    costPerUnitDay: g.costPerUnitDay ?? opts.cost ?? 100,
  }));
  const settings = defaultSettings(model);
  opts.settings?.(settings);
  return { model, groups, settings, ctx: prepareContext(model, groups, settings) };
}
