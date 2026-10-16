/// <reference lib="webworker" />
import { runOptimization } from '../lib/pipeline';
import type { PortfolioModel } from '../lib/model';
import type { ResourceGroup, Settings } from '../lib/settings';

self.onmessage = (e: MessageEvent<{ model: PortfolioModel; groups: ResourceGroup[]; settings: Settings }>) => {
  try {
    const { model, groups, settings } = e.data;
    (self as unknown as Worker).postMessage({ ok: true, out: runOptimization(model, groups, settings) });
  } catch (err) {
    (self as unknown as Worker).postMessage({ ok: false, error: err instanceof Error ? err.message : String(err) });
  }
};
