import type { ProjectComparison } from '../lib/analysis/comparison';
import { fmtDay, fmtFinish } from '../lib/format';
import { dayToISO } from '../lib/calendar';
import { INK, seriesColor } from './palette';

/** Project spans on one time axis, with deadlines and the overlapping window. */
export function Timeline({ projects }: { projects: ProjectComparison[] }) {
  if (!projects.length) return null;
  const lo = Math.min(...projects.map((p) => p.start));
  const hi = Math.max(...projects.map((p) => Math.max(p.finish, p.deadline ?? 0))) + 3;
  const pct = (d: number) => ((d - lo) / (hi - lo)) * 100;
  const ovS = Math.max(...projects.map((p) => p.start));
  const ovE = Math.min(...projects.map((p) => p.finish));
  const ticks: number[] = [];
  for (let d = lo; d <= hi; d++) if (dayToISO(d).endsWith('-01')) ticks.push(d);
  return (
    <div className="overflow-x-auto">
      <div className="relative min-w-[560px] pb-6">
        {projects.length > 1 && ovE > ovS && (
          <div className="absolute inset-y-0 rounded bg-[#fdebe3]" style={{ left: `calc(170px + (100% - 170px) * ${pct(ovS) / 100})`, width: `calc((100% - 170px) * ${(pct(ovE) - pct(ovS)) / 100})` }} title="All projects overlap here">
            <span className="absolute -bottom-0 left-1 text-[11px] font-medium text-[#9a3d14]">Overlap</span>
          </div>
        )}
        {projects.map((p, i) => (
          <div key={p.key} className="relative flex h-11 items-center">
            <div className="w-[170px] shrink-0 truncate pr-3 text-sm font-medium text-ink" title={p.name}>{p.name}</div>
            <div className="relative h-full flex-1">
              <div
                className="absolute top-3 h-5 rounded"
                style={{ left: `${pct(p.start)}%`, width: `${pct(p.finish) - pct(p.start)}%`, background: seriesColor(i) }}
                title={`${p.name}: ${fmtDay(p.start)} → ${fmtFinish(p.finish)}`}
              />
              {p.deadline !== null && (
                <div className="absolute top-1.5 h-8 w-0.5" style={{ left: `${pct(p.deadline)}%`, background: INK.primary }} title={`Deadline ${fmtFinish(p.deadline)}`}>
                  <span className="absolute -top-0.5 left-1 whitespace-nowrap text-[10px] text-ink-2">deadline</span>
                </div>
              )}
            </div>
          </div>
        ))}
        <div className="relative ml-[170px] h-4 border-t border-line">
          {ticks.map((d) => (
            <span key={d} className="absolute top-1 text-[11px] text-ink-3" style={{ left: `${pct(d)}%` }}>{fmtDay(d).slice(-8)}</span>
          ))}
        </div>
      </div>
    </div>
  );
}
