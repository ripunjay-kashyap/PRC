import type { PortfolioModel } from '../lib/model';
import { runOptimization, type OptimizationOutput } from '../lib/pipeline';
import type { ResourceGroup, Settings } from '../lib/settings';

/** Run the optimizer in a Web Worker (falls back to the main thread if workers are unavailable). */
export function optimizeInWorker(model: PortfolioModel, groups: ResourceGroup[], settings: Settings): Promise<OptimizationOutput> {
  if (typeof Worker === 'undefined') return Promise.resolve(runOptimization(model, groups, settings));
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./optimizer.worker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = (e: MessageEvent<{ ok: boolean; out?: OptimizationOutput; error?: string }>) => {
      worker.terminate();
      if (e.data.ok && e.data.out) resolve(e.data.out);
      else reject(new Error(e.data.error ?? 'Optimizer failed'));
    };
    worker.onerror = (e) => {
      worker.terminate();
      reject(new Error(e.message || 'Optimizer worker crashed'));
    };
    worker.postMessage({ model, groups, settings });
  });
}
