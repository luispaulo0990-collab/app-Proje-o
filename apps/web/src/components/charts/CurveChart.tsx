import {
  Bar,
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { useMemo } from 'react';
import { resolveColors, typography } from '@/constants/tokens';
import { formatPercent } from '@/utils/format';

export interface CurveChartPoint {
  label: string;
  monthly: string;
  cumulative: string;
}

/** Monthly % as bars + cumulative % as line (the classic S-curve view). */
export function CurveChart({
  points,
  height = 300,
}: {
  points: CurveChartPoint[];
  height?: number;
}) {
  const colors = useMemo(() => resolveColors(), []);
  const data = points.map((p) => ({
    label: p.label,
    monthly: Number(p.monthly) * 100,
    cumulative: Number(p.cumulative) * 100,
  }));
  const pct = (v: number) => `${v.toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%`;
  return (
    <div style={{ height }} className="w-full">
      <ResponsiveContainer>
        <ComposedChart
          data={data}
          margin={{ top: 8, right: 8, bottom: 0, left: 0 }}
          style={{ fontFamily: typography.sans, fontSize: 12 }}
        >
          <CartesianGrid stroke={colors.grid} vertical={false} />
          <XAxis
            dataKey="label"
            tick={{ fill: colors.textMuted }}
            tickLine={false}
            axisLine={{ stroke: colors.border }}
            interval="preserveStartEnd"
          />
          <YAxis
            yAxisId="m"
            tickFormatter={pct}
            tick={{ fill: colors.textMuted }}
            tickLine={false}
            axisLine={false}
            width={48}
          />
          <YAxis
            yAxisId="c"
            orientation="right"
            domain={[0, 100]}
            tickFormatter={pct}
            tick={{ fill: colors.textMuted }}
            tickLine={false}
            axisLine={false}
            width={48}
          />
          <Tooltip
            formatter={(value, name) => [
              formatPercent(String(Number(value) / 100)),
              name === 'monthly' ? 'Mensal' : 'Acumulado',
            ]}
            contentStyle={{ borderRadius: 8, borderColor: colors.border }}
          />
          <Legend formatter={(v) => (v === 'monthly' ? '% mensal' : '% acumulado')} />
          <Bar
            yAxisId="m"
            dataKey="monthly"
            fill={colors.primary}
            radius={[3, 3, 0, 0]}
            maxBarSize={28}
          />
          <Line
            yAxisId="c"
            dataKey="cumulative"
            stroke={colors.secondary}
            strokeWidth={2}
            dot={false}
            type="monotone"
          />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}
