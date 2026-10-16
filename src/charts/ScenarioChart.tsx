import { Bar, BarChart, CartesianGrid, Cell, LabelList, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { INK } from './palette';
import { fmtNum } from '../lib/format';

export interface ScenarioBar {
  name: string;
  value: number;
  baseline?: boolean;
  infeasible?: boolean;
}

/** One metric across scenarios (single axis; pick the metric above the chart). */
export function ScenarioChart({ data, unit, height = 280 }: { data: ScenarioBar[]; unit: string; height?: number }) {
  return (
    <div style={{ height }} role="img" aria-label={`Scenario comparison of ${unit}`}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 20, right: 12, bottom: 4, left: 4 }} barCategoryGap="28%">
          <CartesianGrid stroke={INK.grid} vertical={false} />
          <XAxis dataKey="name" tick={{ fontSize: 11, fill: INK.secondary }} axisLine={{ stroke: INK.axis }} tickLine={false} interval={0} />
          <YAxis tick={{ fontSize: 11, fill: INK.muted }} axisLine={false} tickLine={false} width={70} tickFormatter={(v: number) => fmtNum(v)} />
          <Tooltip
            cursor={{ fill: 'rgba(31,58,95,0.06)' }}
            formatter={(v: number) => [fmtNum(v, 2), unit]}
            contentStyle={{ borderRadius: 8, border: 'none', boxShadow: '0 8px 24px -6px rgba(10,10,10,0.12), 0 0 0 1px rgba(10,10,10,0.06)', fontSize: 12 }}
          />
          <Bar dataKey="value" radius={[4, 4, 0, 0]} isAnimationActive={false} maxBarSize={56}>
            {data.map((d, i) => (
              <Cell key={i} fill={d.baseline ? '#b6b4ab' : d.infeasible ? '#d03b3b' : '#2a78d6'} />
            ))}
            <LabelList dataKey="value" position="top" formatter={(v: number) => fmtNum(v, 1)} style={{ fontSize: 11, fill: INK.secondary }} />
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
