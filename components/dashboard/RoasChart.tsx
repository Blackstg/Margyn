'use client'

import { useState, useEffect } from 'react'
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ReferenceLine,
  ResponsiveContainer,
} from 'recharts'

export interface RoasPoint {
  date: string
  label: string
  [key: string]: number | string | null
}

interface Props {
  data: RoasPoint[]
  loading: boolean
  periodLabel: string
  activePlatforms: string[]
}

const PLATFORM_COLORS: Record<string, string> = {
  meta:      '#aeb0c9',
  google:    '#8b8dab',
  pinterest: '#e7c0c0',
  tiktok:    '#c4b4d4',
}

const PLATFORM_LABELS: Record<string, string> = {
  meta:      'Meta',
  google:    'Google Ads',
  pinterest: 'Pinterest',
  tiktok:    'TikTok',
}

interface TooltipPayloadEntry {
  dataKey: string
  value: number | null
  color: string
}

interface CustomTooltipProps {
  active?: boolean
  payload?: TooltipPayloadEntry[]
  label?: string
}

function CustomTooltip({ active, payload, label }: CustomTooltipProps) {
  if (!active || !payload || payload.length === 0) return null
  return (
    <div className="bg-white border border-[#e8e4e0] rounded-xl shadow-lg px-4 py-3 text-sm">
      <p className="text-[#6b6b63] text-xs mb-2">{label}</p>
      {payload.map((entry) => {
        if (entry.value == null) return null
        const platform = entry.dataKey as string
        return (
          <div key={platform} className="flex items-center gap-2 mb-1">
            <span
              className="w-2.5 h-2.5 rounded-full flex-shrink-0"
              style={{ backgroundColor: entry.color }}
            />
            <span className="text-[#1a1a2e] font-medium">
              {PLATFORM_LABELS[platform] ?? platform}
            </span>
            <span className="text-[#6b6b63] ml-auto pl-4">{entry.value.toFixed(2)}x</span>
          </div>
        )
      })}
    </div>
  )
}

export default function RoasChart({ data, loading, periodLabel, activePlatforms }: Props) {
  const [roasTarget, setRoasTarget] = useState(3.0)

  useEffect(() => {
    try {
      const raw = localStorage.getItem('steero_config')
      if (raw) {
        const config = JSON.parse(raw)
        if (typeof config.roasTarget === 'number') {
          setRoasTarget(config.roasTarget)
        }
      }
    } catch {
      // ignore
    }
  }, [])

  if (loading) {
    return <div className="h-48 bg-[#f5f0f2] rounded-xl animate-pulse" />
  }

  return (
    <div className="bg-white rounded-[20px] shadow-[0_2px_16px_rgba(0,0,0,0.06)] p-6">
      <div className="flex items-center justify-between mb-5">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-widest text-[#aeb0c9] mb-0.5">
            ROAS
          </p>
          <p className="text-sm text-[#6b6b63]">{periodLabel}</p>
        </div>
        <div className="flex items-center gap-4 flex-wrap justify-end">
          {activePlatforms.map((platform) => (
            <div key={platform} className="flex items-center gap-1.5">
              <span
                className="w-2.5 h-2.5 rounded-full"
                style={{ backgroundColor: PLATFORM_COLORS[platform] ?? '#aeb0c9' }}
              />
              <span className="text-xs text-[#6b6b63]">
                {PLATFORM_LABELS[platform] ?? platform}
              </span>
            </div>
          ))}
          <div className="flex items-center gap-1.5">
            <span className="text-[#6b6b63] text-xs tracking-widest">--- Cible</span>
          </div>
        </div>
      </div>
      <ResponsiveContainer width="100%" height={220}>
        <LineChart data={data} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#f0ede9" vertical={false} />
          <XAxis
            dataKey="label"
            tick={{ fontSize: 11, fill: '#9b9b93' }}
            axisLine={false}
            tickLine={false}
            interval="preserveStartEnd"
          />
          <YAxis
            tick={{ fontSize: 11, fill: '#9b9b93' }}
            axisLine={false}
            tickLine={false}
            tickFormatter={(v: number) => `${v}x`}
            width={36}
          />
          <Tooltip content={<CustomTooltip />} />
          <ReferenceLine
            y={roasTarget}
            stroke="#6b6b63"
            strokeDasharray="4 4"
            strokeOpacity={0.5}
          />
          {activePlatforms.map((platform) => (
            <Line
              key={platform}
              type="monotone"
              dataKey={platform}
              stroke={PLATFORM_COLORS[platform] ?? '#aeb0c9'}
              strokeWidth={2}
              dot={false}
              connectNulls
            />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </div>
  )
}
