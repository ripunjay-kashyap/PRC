import { useMemo, useState } from 'react';
import type { ActivityInfo } from '../lib/pipeline';
import { fmtDay, fmtFinish } from '../lib/format';
import { dayToISO } from '../lib/calendar';
import { seriesColor } from './palette';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** Original (grey outline) vs optimized (project colour) bars per activity. */
export function Gantt({ activities, start, finish, projectNames, onlyShifted = false }: {
  activities: ActivityInfo[];
  start: number[];
  finish: number[];
  projectNames: string[];
  onlyShifted?: boolean;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const rows = useMemo(
    () =>
      activities
        .map((a, i) => ({ a, i }))
        .filter(({ a, i }) => !onlyShifted || start[i] !== a.baselineStart || finish[i] !== a.baselineFinish)
        .sort((x, y) => x.a.projectIdx - y.a.projectIdx || Math.min(start[x.i], x.a.baselineStart) - Math.min(start[y.i], y.a.baselineStart) || x.a.code.localeCompare(y.a.code)),
    [activities, start, finish, onlyShifted],
  );
  if (!rows.length) return <div className="py-10 text-center text-sm text-ink-3">No activities moved in this scenario.</div>;
  const lo = Math.min(...rows.map(({ a, i }) => Math.min(a.baselineStart, start[i])));
  const hi = Math.max(...rows.map(({ a, i }) => Math.max(a.baselineFinish, finish[i]))) + 1;
  const span = Math.max(1, hi - lo);
  const pct = (d: number) => ((d - lo) / span) * 100;
  const months: { d: number; label: string }[] = [];
  for (let d = lo; d <= hi; d++) {
    const iso = dayToISO(d);
    if (iso.endsWith('-01') || d === lo) months.push({ d, label: `${MONTHS[Number(iso.slice(5, 7)) - 1]} ${iso.slice(0, 4)}` });
  }
  return (
    <div className="overflow-x-auto" data-testid="gantt">
      <div className="min-w-[720px]">
        <div className="mb-2 flex flex-wrap items-center gap-4 text-xs text-ink-2">
          <span className="flex items-center gap-1.5"><span className="h-2.5 w-5 rounded-sm border border-[#898781] bg-[#ecebe6]" />Original</span>
          {projectNames.map((n, p) => (
            <span key={p} className="flex items-center gap-1.5"><span className="h-2.5 w-5 rounded-sm" style={{ background: seriesColor(p) }} />Optimized — {n}</span>
          ))}
        </div>
        <div className="grid grid-cols-[minmax(160px,220px)_1fr]">
          <div />
          <div className="relative h-6 border-b border-line">
            {months.map((m) => (
              <span key={m.d} className="absolute top-0 -translate-x-0 pl-1 text-[11px] text-ink-3" style={{ left: `${pct(m.d)}%` }}>{m.label}</span>
            ))}
          </div>
          {rows.map(({ a, i }) => {
            const moved = start[i] !== a.baselineStart;
            const ms = a.durationDays === 0;
            return (
              <div key={a.key} className="contents" onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}>
                <div className={`truncate border-b border-line/60 py-1 pr-2 text-xs ${hover === i ? 'bg-navy-50' : ''}`} title={`${a.code} ${a.name}`}>
                  <span className="font-medium text-ink">{a.code}</span> <span className="text-ink-2">{a.name}</span>
                </div>
                <div className={`relative h-[30px] border-b border-line/60 ${hover === i ? 'bg-navy-50' : ''}`}>
                  {months.map((m) => <span key={m.d} className="absolute inset-y-0 w-px bg-line/70" style={{ left: `${pct(m.d)}%` }} />)}
                  {ms ? (
                    <>
                      <span className="absolute top-[5px] h-2.5 w-2.5 -translate-x-1/2 rotate-45 border border-[#898781] bg-[#ecebe6]" style={{ left: `${pct(a.baselineStart)}%` }} />
                      <span className="absolute top-[15px] h-2.5 w-2.5 -translate-x-1/2 rotate-45" style={{ left: `${pct(start[i])}%`, background: seriesColor(a.projectIdx) }} />
                    </>
                  ) : (
                    <>
                      <span className="absolute top-[4px] h-[9px] rounded-sm border border-[#898781] bg-[#ecebe6]" style={{ left: `${pct(a.baselineStart)}%`, width: `max(3px, ${pct(a.baselineFinish) - pct(a.baselineStart)}%)` }} />
                      <span className="absolute top-[16px] h-[9px] rounded-sm" style={{ left: `${pct(start[i])}%`, width: `max(3px, ${pct(finish[i]) - pct(start[i])}%)`, background: seriesColor(a.projectIdx), outline: moved ? '1.5px solid #0b0b0b' : 'none', outlineOffset: 1 }} />
                    </>
                  )}
                  {hover === i && (
                    <div className="pointer-events-none absolute left-1/2 top-[30px] z-20 w-72 -translate-x-1/2 rounded-lg bg-white p-2.5 text-xs shadow-pop">
                      <div className="font-semibold">{a.projectName} · {a.code}</div>
                      <div className="text-ink-2">{a.name}</div>
                      <div className="mt-1 grid grid-cols-2 gap-x-2 tabular">
                        <span className="text-ink-3">Original</span><span>{fmtDay(a.baselineStart)} → {fmtFinish(a.baselineFinish)}</span>
                        <span className="text-ink-3">Optimized</span><span>{fmtDay(start[i])} → {fmtFinish(finish[i])}</span>
                        <span className="text-ink-3">Total float</span><span>{a.totalFloat} wd</span>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
