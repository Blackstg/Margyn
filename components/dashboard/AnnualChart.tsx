'use client'

import { useState, useRef, useEffect } from 'react'

// ─── Types ────────────────────────────────────────────────────────────────────

export interface MonthPoint {
  month: number
  label: string
  ca: number
  net_margin: number
  isFuture: boolean
  ca_prev: number
  net_margin_prev: number
}

interface Props {
  data: MonthPoint[]
  loading: boolean
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const fmtEur = (n: number) =>
  new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }).format(n)

function fmtAxis(v: number): string {
  if (v === 0) return '0'
  if (Math.abs(v) >= 1000) return `${Math.round(v / 1000)}k€`
  return `${v}€`
}

function niceTicks(maxVal: number, count = 4): number[] {
  if (maxVal <= 0) return [0]
  const rawStep = maxVal / count
  const magnitude = Math.pow(10, Math.floor(Math.log10(rawStep)))
  const step = Math.ceil(rawStep / magnitude) * magnitude
  const ticks: number[] = []
  for (let v = 0; v <= maxVal + step * 0.1; v += step) ticks.push(v)
  return ticks
}

// ─── Tooltip ─────────────────────────────────────────────────────────────────

function TooltipContent({ point, currentYear }: { point: MonthPoint; currentYear: number }) {
  const caPct       = point.ca_prev !== 0 ? ((point.ca - point.ca_prev) / Math.abs(point.ca_prev)) * 100 : null
  const marginPct     = point.ca > 0       ? (point.net_margin / point.ca) * 100           : null
  const marginPrevPct = point.ca_prev > 0  ? (point.net_margin_prev / point.ca_prev) * 100 : null

  return (
    <>
      <p className="text-[10px] text-[#6b6b63] mb-3 font-semibold uppercase tracking-wide">
        {point.label}
      </p>

      {/* CA */}
      <p className="text-[9px] font-semibold uppercase tracking-widest text-[#aeb0c9] mb-1.5">CA</p>
      <div className="space-y-1 mb-1">
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-sm shrink-0 bg-[#aeb0c9]" />
            <span className="text-xs text-[#6b6b63]">{currentYear}</span>
          </div>
          <span className="text-xs font-semibold text-[#1a1a2e] tabular-nums">{fmtEur(point.ca)}</span>
        </div>
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-sm shrink-0 bg-[#e7c0c0]" />
            <span className="text-xs text-[#6b6b63]">{currentYear - 1}</span>
          </div>
          <span className="text-xs font-semibold text-[#1a1a2e] tabular-nums">{fmtEur(point.ca_prev)}</span>
        </div>
        {caPct !== null && (
          <div className="pt-1.5 border-t border-[#f0f0ee] flex items-center justify-between">
            <span className="text-[10px] text-[#9b9b93]">vs {currentYear - 1}</span>
            <span className={`text-xs font-bold tabular-nums ${caPct >= 0 ? 'text-[#1a7f4b]' : 'text-[#c7293a]'}`}>
              {caPct >= 0 ? '+' : ''}{caPct.toFixed(1)}%
            </span>
          </div>
        )}
      </div>

      {/* Marge nette */}
      <div className="pt-2 mt-2 border-t border-[#f0f0ee]">
        <p className="text-[9px] font-semibold uppercase tracking-widest text-[#aeb0c9] mb-1.5">Marge nette</p>
        <div className="space-y-1">
          <div className="flex items-center justify-between gap-4">
            <span className="text-xs text-[#6b6b63]">{currentYear}</span>
            <div className="flex items-center gap-2">
              {marginPct !== null && (
                <span className="text-[10px] text-[#9b9b93] tabular-nums">{marginPct.toFixed(1)}%</span>
              )}
              <span className="text-xs font-semibold text-[#1a1a2e] tabular-nums">{fmtEur(point.net_margin)}</span>
            </div>
          </div>
          <div className="flex items-center justify-between gap-4">
            <span className="text-xs text-[#6b6b63]">{currentYear - 1}</span>
            <div className="flex items-center gap-2">
              {marginPrevPct !== null && (
                <span className="text-[10px] text-[#9b9b93] tabular-nums">{marginPrevPct.toFixed(1)}%</span>
              )}
              <span className="text-xs font-semibold text-[#1a1a2e] tabular-nums">{fmtEur(point.net_margin_prev)}</span>
            </div>
          </div>
        </div>
      </div>
    </>
  )
}

// ─── AnnualChart ──────────────────────────────────────────────────────────────

export default function AnnualChart({ data, loading }: Props) {
  const wrapperRef  = useRef<HTMLDivElement>(null)
  const [svgWidth, setSvgWidth] = useState(0)
  const [tooltip, setTooltip]   = useState<{ x: number; point: MonthPoint } | null>(null)
  const [focus, setFocus]       = useState<'current' | 'prev' | null>(null)
  const currentYear             = new Date().getFullYear()

  useEffect(() => {
    if (!wrapperRef.current) return
    setSvgWidth(wrapperRef.current.offsetWidth)
    const obs = new ResizeObserver(([entry]) => setSvgWidth(entry.contentRect.width))
    obs.observe(wrapperRef.current)
    return () => obs.disconnect()
  }, [loading])

  // ── Chart geometry ──────────────────────────────────────────────────────────
  const H = 248, ML = 44, MR = 10, MT = 8, MB = 24
  const chartW = Math.max(svgWidth - ML - MR, 10)
  const chartH = H - MT - MB

  const maxCA = data.length > 0
    ? Math.max(...data.map((d) => Math.max(d.ca, d.ca_prev, 0)), 1)
    : 1

  const ticks  = niceTicks(maxCA)
  const axisMax = ticks[ticks.length - 1] || 1
  const scaleH  = (v: number) => (Math.max(v, 0) / axisMax) * chartH

  const n       = data.length || 12
  const colW    = chartW / n
  const colPad  = Math.max(colW * 0.12, 2)
  const innerW  = colW - colPad * 2
  const barGap  = Math.max(innerW * 0.06, 1)
  const barW    = (innerW - barGap) / 2   // each bar gets half the inner width

  // Focus: atténue l'autre année mais jamais en dessous de 0.3
  const currentOp = focus === 'prev'    ? 0.3 : 1
  const prevOp    = focus === 'current' ? 0.3 : 1

  return (
    <div className="bg-white rounded-[20px] shadow-[0_2px_16px_rgba(0,0,0,0.06)] p-5">

      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between mb-5">

        {/* Legend */}
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-[0.1em] text-[#aeb0c9] mb-3">
            Vue annuelle
          </p>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5">
            {/* CA current */}
            <div className="flex items-center gap-1.5">
              <span className="w-3 h-3 rounded-[3px] bg-[#aeb0c9]" />
              <span className="text-[10px] text-[#6b6b63]">CA {currentYear}</span>
            </div>
            {/* CA prev */}
            <div className="flex items-center gap-1.5">
              <span className="w-3 h-3 rounded-[3px] bg-[#e7c0c0]" />
              <span className="text-[10px] text-[#6b6b63]">CA {currentYear - 1}</span>
            </div>
            {/* Marge current */}
            <div className="flex items-center gap-1.5">
              <svg width="13" height="13" style={{ borderRadius: 3, overflow: 'hidden', display: 'block' }}>
                <defs>
                  <pattern id="lgd-curr" patternUnits="userSpaceOnUse" width="4" height="4" patternTransform="rotate(45)">
                    <line x1="0" y1="0" x2="0" y2="4" stroke="#6b6e9a" strokeWidth="1.6" />
                  </pattern>
                </defs>
                <rect width="13" height="13" fill="#aeb0c9" />
                <rect width="13" height="13" fill="url(#lgd-curr)" />
              </svg>
              <span className="text-[10px] text-[#6b6b63]">Marge {currentYear}</span>
            </div>
            {/* Marge prev */}
            <div className="flex items-center gap-1.5">
              <svg width="13" height="13" style={{ borderRadius: 3, overflow: 'hidden', display: 'block' }}>
                <defs>
                  <pattern id="lgd-prev" patternUnits="userSpaceOnUse" width="4" height="4" patternTransform="rotate(45)">
                    <line x1="0" y1="0" x2="0" y2="4" stroke="#b06070" strokeWidth="1.6" />
                  </pattern>
                </defs>
                <rect width="13" height="13" fill="#e7c0c0" />
                <rect width="13" height="13" fill="url(#lgd-prev)" />
              </svg>
              <span className="text-[10px] text-[#6b6b63]">Marge {currentYear - 1}</span>
            </div>
          </div>
        </div>

        {/* Focus selector */}
        <div className="flex flex-col items-start sm:items-end gap-2">
          <p className="text-xs text-[#6b6b63]">Mettre en avant</p>
          <div className="inline-flex items-center bg-[#faf9f8] rounded-xl p-1 gap-0.5">
            <button
              onClick={() => setFocus(focus === 'current' ? null : 'current')}
              className={`px-3.5 py-1.5 rounded-lg text-xs font-medium transition-all ${
                focus === 'current' ? 'bg-[#aeb0c9] text-white' : 'text-[#6b6b63] hover:text-[#1a1a2e]'
              }`}
            >
              {currentYear}
            </button>
            <button
              onClick={() => setFocus(focus === 'prev' ? null : 'prev')}
              className={`px-3.5 py-1.5 rounded-lg text-xs font-medium transition-all ${
                focus === 'prev' ? 'bg-[#e7c0c0] text-[#1a1a2e]' : 'text-[#6b6b63] hover:text-[#1a1a2e]'
              }`}
            >
              {currentYear - 1}
            </button>
          </div>
        </div>
      </div>

      {/* ── Chart ──────────────────────────────────────────────────────────── */}
      {loading ? (
        <div className="h-[248px] bg-[#f5f0f2] rounded-xl animate-pulse" />
      ) : (
        <div ref={wrapperRef} className="relative select-none w-full" onMouseLeave={() => setTooltip(null)}>
          {svgWidth === 0 ? (
            <div style={{ height: H }} />
          ) : (
            <>
              <svg width="100%" height={H}>
                <defs>
                  <pattern id="hatch-curr" patternUnits="userSpaceOnUse" width="5" height="5" patternTransform="rotate(45)">
                    <rect width="5" height="5" fill="transparent" />
                    <line x1="0" y1="0" x2="0" y2="5" stroke="#6b6e9a" strokeWidth="1.8" />
                  </pattern>
                  <pattern id="hatch-prev" patternUnits="userSpaceOnUse" width="5" height="5" patternTransform="rotate(45)">
                    <rect width="5" height="5" fill="transparent" />
                    <line x1="0" y1="0" x2="0" y2="5" stroke="#b06070" strokeWidth="1.8" />
                  </pattern>
                </defs>

                <g transform={`translate(${ML}, ${MT})`}>
                  {ticks.map((tick) => (
                    <g key={tick}>
                      <line
                        x1={0} y1={chartH - scaleH(tick)}
                        x2={chartW} y2={chartH - scaleH(tick)}
                        stroke="#f0ede9" strokeWidth={1}
                      />
                      <text
                        x={-6} y={chartH - scaleH(tick)}
                        dy="0.35em" textAnchor="end"
                        fontSize={10} fill="#9b9b93" fontFamily="inherit"
                      >
                        {fmtAxis(tick)}
                      </text>
                    </g>
                  ))}

                  {data.map((point, i) => {
                    const bottom = chartH
                    const h2026  = scaleH(point.ca)
                    const h2025  = scaleH(point.ca_prev)
                    const hm2026 = Math.min(scaleH(Math.max(point.net_margin, 0)), h2026)
                    const hm2025 = Math.min(scaleH(Math.max(point.net_margin_prev, 0)), h2025)

                    return (
                      <g
                        key={point.month}
                        onMouseEnter={() => setTooltip({ x: ML + i * colW + colW / 2, point })}
                        style={{ cursor: 'default' }}
                      >
                        <rect x={i * colW} y={0} width={colW} height={chartH} fill="transparent" />

                        {(() => {
                          const x2026 = i * colW + colPad
                          if (point.isFuture) return (
                            <rect x={x2026} y={bottom - 3} width={barW} height={3}
                              fill="#aeb0c9" fillOpacity={0.15} rx={2} />
                          )
                          return h2026 > 0 ? (
                            <>
                              <rect x={x2026} y={bottom - h2026} width={barW} height={h2026}
                                fill="#aeb0c9" fillOpacity={currentOp} rx={3} />
                              {hm2026 > 0 && (
                                <rect x={x2026} y={bottom - hm2026} width={barW} height={hm2026}
                                  fill="url(#hatch-curr)" fillOpacity={currentOp} rx={3} />
                              )}
                            </>
                          ) : null
                        })()}

                        {(() => {
                          const x2025 = i * colW + colPad + barW + barGap
                          return h2025 > 0 ? (
                            <>
                              <rect x={x2025} y={bottom - h2025} width={barW} height={h2025}
                                fill="#e7c0c0" fillOpacity={0.85 * prevOp} rx={3} />
                              {hm2025 > 0 && (
                                <rect x={x2025} y={bottom - hm2025} width={barW} height={hm2025}
                                  fill="url(#hatch-prev)" fillOpacity={prevOp} rx={3} />
                              )}
                            </>
                          ) : null
                        })()}

                        <text
                          x={i * colW + colW / 2} y={chartH + 16}
                          textAnchor="middle" fontSize={10} fill="#9b9b93" fontFamily="inherit"
                        >
                          {point.label}
                        </text>
                      </g>
                    )
                  })}
                </g>
              </svg>

              {tooltip && (
                <div
                  className="absolute pointer-events-none z-10 bg-white border border-[#e8e4e0] rounded-xl shadow-lg px-3.5 py-3 min-w-[210px]"
                  style={{
                    left: Math.min(Math.max(tooltip.x - 105, 0), svgWidth - 220),
                    top: 4,
                  }}
                >
                  <TooltipContent point={tooltip.point} currentYear={currentYear} />
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  )
}
