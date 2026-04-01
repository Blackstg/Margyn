'use client'

import { useState, useEffect } from 'react'
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid,
  Tooltip, ReferenceLine, ResponsiveContainer,
} from 'recharts'
import { PlatformIcon } from '@/components/ui/PlatformIcon'
import type { SpendByPlatform } from './SpendBreakdown'
import type { RoasPoint } from './RoasChart'

// ─── Platform config ──────────────────────────────────────────────────────────

const PLATFORM_LABELS: Record<string, string> = {
  meta:      'Meta',
  google:    'Google Ads',
  pinterest: 'Pinterest',
  tiktok:    'TikTok',
}

// Official brand colors — used for chart lines + bars
const PLATFORM_COLORS: Record<string, string> = {
  meta:      '#1877F2',
  google:    '#34A853',
  pinterest: '#E60023',
  tiktok:    '#69C9D0', // cyan — black is invisible on charts
}

// For the progress bar fill: TikTok stays dark for contrast on white bg
const PLATFORM_BAR_COLORS: Record<string, string> = {
  ...PLATFORM_COLORS,
  tiktok: '#010101',
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const fmtEur = (n: number) =>
  new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }).format(n)

// ─── Tooltip ─────────────────────────────────────────────────────────────────

interface TooltipEntry { dataKey: string; value: number | null; color: string }
interface TooltipProps  { active?: boolean; payload?: TooltipEntry[]; label?: string }

function CustomTooltip({ active, payload, label }: TooltipProps) {
  if (!active || !payload || payload.length === 0) return null
  return (
    <div className="bg-white border border-[#e8e4e0] rounded-xl shadow-lg px-3.5 py-2.5 text-sm min-w-[140px]">
      <p className="text-[10px] text-[#6b6b63] mb-2 font-medium">{label}</p>
      {payload.map((entry) => {
        if (entry.value == null) return null
        return (
          <div key={entry.dataKey} className="flex items-center gap-2 mb-1 last:mb-0">
            <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: entry.color }} />
            <span className="text-[#1a1a2e] text-xs">{PLATFORM_LABELS[entry.dataKey] ?? entry.dataKey}</span>
            <span className="text-[#6b6b63] text-xs ml-auto pl-3 tabular-nums">{entry.value.toFixed(2)}x</span>
          </div>
        )
      })}
    </div>
  )
}

// ─── Props ────────────────────────────────────────────────────────────────────

interface Props {
  spendData:       SpendByPlatform[]
  roasData:        RoasPoint[]
  activePlatforms: string[]
  loading:         boolean
  periodLabel:     string
}

// ─── AdPanel ──────────────────────────────────────────────────────────────────

export default function AdPanel({ spendData, roasData, activePlatforms, loading, periodLabel }: Props) {
  const [roasTarget, setRoasTarget] = useState(3.0)

  useEffect(() => {
    try {
      const raw = localStorage.getItem('steero_config')
      if (raw) {
        const c = JSON.parse(raw)
        if (typeof c.roasTarget === 'number') setRoasTarget(c.roasTarget)
      }
    } catch { /* ignore */ }
  }, [])

  const activeSpend = spendData.filter((d) => d.spend > 0)
  const totalSpend  = activeSpend.reduce((s, d) => s + d.spend, 0)

  return (
    <div className="bg-white rounded-[20px] shadow-[0_2px_16px_rgba(0,0,0,0.06)] overflow-hidden">
      <div className="flex flex-col divide-y divide-[#f0f0ee] md:flex-row md:divide-x md:divide-y-0">

        {/* ── Left: Spend list ──────────────────────────────────────────────── */}
        <div className="w-full md:w-[30%] md:shrink-0 p-5 flex flex-col">
          <p className="text-[10px] font-semibold uppercase tracking-[0.1em] text-[#aeb0c9] mb-4">
            Répartition Spend
          </p>

          {loading ? (
            <div className="space-y-4 flex-1">
              {Array.from({ length: 3 }).map((_, i) => (
                <div key={i} className="space-y-2">
                  <div className="flex items-center gap-2">
                    <div className="w-5 h-5 bg-[#f0f0ee] rounded animate-pulse" />
                    <div className="h-2.5 w-16 bg-[#f0f0ee] rounded animate-pulse" />
                  </div>
                  <div className="h-1.5 w-full bg-[#f0f0ee] rounded-full animate-pulse" />
                </div>
              ))}
            </div>
          ) : activeSpend.length === 0 ? (
            <p className="text-xs text-[#9b9b93] flex-1">Aucun spend</p>
          ) : (
            <div className="flex flex-col flex-1 justify-between">
              <div className="space-y-4">
                {activeSpend.map((d) => {
                  const label   = PLATFORM_LABELS[d.platform] ?? d.platform
                  const barColor = PLATFORM_BAR_COLORS[d.platform] ?? '#6b6b63'
                  const pct     = totalSpend > 0 ? (d.spend / totalSpend) * 100 : 0

                  return (
                    <div key={d.platform} className="space-y-1.5">
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-2 min-w-0">
                          <PlatformIcon platform={d.platform} size={18} />
                          <span className="text-xs font-medium text-[#1a1a2e] truncate">{label}</span>
                        </div>
                        <span className="text-xs font-semibold text-[#1a1a2e] tabular-nums shrink-0">
                          {fmtEur(d.spend)}
                        </span>
                      </div>
                      <div className="h-1.5 w-full bg-[#f5f0f2] rounded-full overflow-hidden">
                        <div
                          className="h-full rounded-full transition-all duration-700"
                          style={{ width: `${pct}%`, backgroundColor: barColor }}
                        />
                      </div>
                    </div>
                  )
                })}
              </div>

              {/* Total */}
              <div className="mt-5 pt-4 border-t border-[#f0f0ee] flex items-center justify-between">
                <span className="text-xs text-[#6b6b63]">Total</span>
                <span className="text-sm font-bold text-[#1a1a2e] tabular-nums">{fmtEur(totalSpend)}</span>
              </div>
            </div>
          )}
        </div>

        {/* ── Right: ROAS chart (70%) ───────────────────────────────────────── */}
        <div className="flex-1 p-5">
          <div className="flex items-start justify-between mb-4">
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-[0.1em] text-[#aeb0c9]">
                ROAS par plateforme
              </p>
              <p className="text-xs text-[#6b6b63] mt-0.5">{periodLabel}</p>
            </div>
            <div className="flex items-center gap-3 flex-wrap justify-end">
              {activePlatforms.map((p) => (
                <div key={p} className="flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded-full" style={{ backgroundColor: PLATFORM_COLORS[p] ?? '#aeb0c9' }} />
                  <span className="text-[10px] text-[#6b6b63]">{PLATFORM_LABELS[p] ?? p}</span>
                </div>
              ))}
              <div className="flex items-center gap-1.5">
                <span className="text-[10px] text-[#9b9b93]">- - Cible {roasTarget}x</span>
              </div>
            </div>
          </div>

          {loading ? (
            <div className="h-[200px] bg-[#f5f0f2] rounded-xl animate-pulse" />
          ) : roasData.length === 0 ? (
            <div className="h-[200px] flex items-center justify-center">
              <p className="text-xs text-[#9b9b93]">Aucune donnée</p>
            </div>
          ) : (
            <ResponsiveContainer width="100%" height={200}>
              <LineChart data={roasData} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f0ede9" vertical={false} />
                <XAxis
                  dataKey="label"
                  tick={{ fontSize: 10, fill: '#9b9b93' }}
                  axisLine={false}
                  tickLine={false}
                  interval="preserveStartEnd"
                />
                <YAxis
                  tick={{ fontSize: 10, fill: '#9b9b93' }}
                  axisLine={false}
                  tickLine={false}
                  tickFormatter={(v: number) => `${v}x`}
                  width={32}
                />
                <Tooltip content={<CustomTooltip />} />
                <ReferenceLine
                  y={roasTarget}
                  stroke="#999"
                  strokeDasharray="4 4"
                  strokeOpacity={0.6}
                />
                {activePlatforms.map((p) => (
                  <Line
                    key={p}
                    type="monotone"
                    dataKey={p}
                    stroke={PLATFORM_COLORS[p] ?? '#aeb0c9'}
                    strokeWidth={2}
                    dot={false}
                    connectNulls
                  />
                ))}
              </LineChart>
            </ResponsiveContainer>
          )}
        </div>

      </div>
    </div>
  )
}
