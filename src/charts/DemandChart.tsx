import { useMemo } from 'react';
import { Bar, CartesianGrid, ComposedChart, Legend, Line, ReferenceArea, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import type { DemandSeries } from '../lib/scheduling/scenarios';
import { fmtDay, fmtNum, fmtShort } from '../lib/format';
import { INK, STATUS, seriesColor } from './palette';

interface Row {
  day: number;
  label: string;
  capacity: number | null;
  capHired: number | null;
  total: number;
  over: number;
  hired: number;
  [k: string]: number | string | null;
}

/** Stacked daily demand per project with the capacity line; over-allocated days shaded. */
export function DemandChart({ series, projectNames, height = 300 }: { series: DemandSeries; projectNames: string[]; height?: number }) {
  const { rows, overRanges, hasHires } = useMemo(() => {
    const cap = series.capacity;
    const rows: Row[] = series.days.map((d, k) => {
      const hired = series.hired[k] ?? 0;
      const r: Row = {
        day: d,
        label: fmtShort(d),
        capacity: cap,
        capHired: cap === null ? null : cap + hired,
        total: series.total[k],
        hired,
        over: cap === null ? 0 : Math.max(0, series.total[k] - cap - hired),
      };
      projectNames.forEach((_, p) => (r[`p${p}`] = series.byProject[p]?.[k] ?? 0));
      return r;
    });
    const overRanges: [string, string][] = [];
    let start: string | null = null;
    rows.forEach((r, k) => {
      if (r.over > 1e-9 && start === null) start = r.label + '#' + k;
      const endHere = start !== null && (k === rows.length - 1 || rows[k + 1].over <= 1e-9);
      if (endHere) {
        overRanges.push([start!, r.label + '#' + k]);
        start = null;
      }
    });
    return { rows: rows.map((r, k) => ({ ...r, label: r.label + '#' + k })), overRanges, hasHires: rows.some((r) => r.hired > 0) };
  }, [series, projectNames]);

  if (!rows.length) return <div className="flex h-40 items-center justify-center text-sm text-ink-3">No demand for this resource.</div>;
  const tickFmt = (v: string) => v.split('#')[0];
  return (
    <div style={{ height }} role="img" aria-label={`Daily demand for ${series.name} by project${series.capacity !== null ? ` against a capacity of ${series.capacity}` : ''}`}>
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={rows} margin={{ top: 8, right: 12, bottom: 0, left: -12 }} barCategoryGap={1}>
          <CartesianGrid stroke={INK.grid} vertical={false} />
          {overRanges.map(([a, b]) => (
            <ReferenceArea key={a} x1={a} x2={b} fill={STATUS.critical} fillOpacity={0.1} stroke="none" ifOverflow="extendDomain" />
          ))}
          <XAxis dataKey="label" tickFormatter={tickFmt} tick={{ fontSize: 11, fill: INK.muted }} axisLine={{ stroke: INK.axis }} tickLine={false} minTickGap={28} />
          <YAxis tick={{ fontSize: 11, fill: INK.muted }} axisLine={false} tickLine={false} allowDecimals={false} width={44} />
          <Tooltip content={<DemandTooltip projectNames={projectNames} />} cursor={{ fill: 'rgba(31,58,95,0.06)' }} />
          <Legend wrapperStyle={{ fontSize: 12, color: INK.secondary }} iconType="square" iconSize={10} />
          {projectNames.map((n, p) => (
            <Bar key={p} dataKey={`p${p}`} name={n} stackId="d" fill={seriesColor(p)} stroke="#fcfcfb" strokeWidth={projectNames.length > 1 ? 1 : 0} isAnimationActive={false} />
          ))}
          {series.capacity !== null && (
            <Line type="stepAfter" dataKey="capacity" name="Capacity" stroke={INK.primary} strokeWidth={2} strokeDasharray="6 3" dot={false} isAnimationActive={false} />
          )}
          {hasHires && <Line type="stepAfter" dataKey="capHired" name="Capacity + hired" stroke={INK.secondary} strokeWidth={1.5} strokeDasharray="2 3" dot={false} isAnimationActive={false} />}
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}

function DemandTooltip({ active, payload, projectNames }: { active?: boolean; payload?: { payload: Row }[]; projectNames: string[] }) {
  if (!active || !payload?.length) return null;
  const r = payload[0].payload;
  return (
    <div className="rounded-lg bg-white px-3 py-2 text-xs shadow-card">
      <div className="mb-1 font-semibold text-ink">{fmtDay(r.day)}</div>
      {projectNames.map((n, p) => (
        <div key={p} className="flex items-center justify-between gap-4">
          <span className="flex items-center gap-1.5 text-ink-2"><span className="h-2 w-2 rounded-sm" style={{ background: seriesColor(p) }} />{n}</span>
          <span className="tabular text-ink">{fmtNum(r[`p${p}`] as number, 2)}</span>
        </div>
      ))}
      <div className="mt-1 flex justify-between gap-4 border-t border-line pt-1"><span className="text-ink-2">Total demand</span><span className="tabular font-medium">{fmtNum(r.total, 2)}</span></div>
      {r.capacity !== null && <div className="flex justify-between gap-4"><span className="text-ink-2">Capacity</span><span className="tabular">{fmtNum(r.capacity, 2)}</span></div>}
      {r.hired > 0 && <div className="flex justify-between gap-4"><span className="text-ink-2">Hired</span><span className="tabular">{fmtNum(r.hired, 2)}</span></div>}
      {r.over > 0 && <div className="mt-1 font-medium text-[#9b1c1c]">⚠ Over-allocated by {fmtNum(r.over, 2)}</div>}
    </div>
  );
}
