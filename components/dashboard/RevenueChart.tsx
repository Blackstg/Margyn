'use client'

import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  CartesianGrid,
  Tooltip,
} from 'recharts'

export interface ChartPoint {
  date: string
  label: string
  sales: number
  spend: number
}

interface Props {
  data: ChartPoint[]
  loading: boolean
  periodLabel: string
}

const fmtEur = (n: number) =>
  new Intl.NumberFormat('fr-FR', {
    style: 'currency',
    currency: 'EUR',
    maximumFractionDigits: 0,
  }).format(n)

function CustomTooltip({ active, payload, label }: {
  active?: boolean
  payload?: { name: string; value: number; color: string }[]
  label?: string
}) {
  if (!active || !payload?.length) return null
  return (
    <div className="bg-white rounded-xl shadow-[0_4px_24px_rgba(0,0,0,0.1)] p-3 text-xs min-w-[130px]">
      <p className="font-semibold text-[#1a1a18] mb-2">{label}</p>
      {payload.map((p) => (
        <div key={p.name} className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full" style={{ background: p.color }} />
            <span className="text-[#6b6b63]">{p.name}</span>
          </div>
          <span className="font-semibold text-[#1a1a18] tabular-nums">{fmtEur(p.value)}</span>
        </div>
      ))}
    </div>
  )
}

export default function RevenueChart({ data, loading, periodLabel }: Props) {
  return (
    <div className="bg-white rounded-[20px] shadow-[0_2px_16px_rgba(0,0,0,0.06)] p-6">
      <div className="flex items-center justify-between mb-6">
        <p className="text-[10px] font-semibold text-[#6b6b63] uppercase tracking-[0.1em]">
          CA vs Spend — {periodLabel}
        </p>
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-full bg-[#aeb0c9]" />
            <span className="text-xs text-[#6b6b63]">CA</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-full bg-[#e7c0c0]" />
            <span className="text-xs text-[#6b6b63]">Spend</span>
          </div>
        </div>
      </div>

      {loading ? (
        <div className="h-48 bg-[#F0F0EE] rounded-xl animate-pulse" />
      ) : (
        <ResponsiveContainer width="100%" height={200}>
          <LineChart data={data} margin={{ top: 4, right: 4, bottom: 0, left: 0 }}>
            <CartesianGrid
              strokeDasharray="3 3"
              stroke="#f0f0ee"
              vertical={false}
            />
            <XAxis
              dataKey="label"
              tick={{ fontSize: 11, fill: '#6b6b63' }}
              axisLine={false}
              tickLine={false}
              interval="preserveStartEnd"
            />
            <Tooltip content={<CustomTooltip />} cursor={{ stroke: '#e8e8e4', strokeWidth: 1 }} />
            <Line
              type="monotone"
              dataKey="sales"
              name="CA"
              stroke="#aeb0c9"
              strokeWidth={2.5}
              dot={false}
              activeDot={{ r: 4, strokeWidth: 0 }}
            />
            <Line
              type="monotone"
              dataKey="spend"
              name="Spend"
              stroke="#e7c0c0"
              strokeWidth={2}
              dot={false}
              activeDot={{ r: 4, strokeWidth: 0 }}
            />
          </LineChart>
        </ResponsiveContainer>
      )}
    </div>
  )
}
