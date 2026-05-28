'use client'

import { useState, useEffect, useCallback } from 'react'
import { BarChart2, TrendingUp, Clock, Route, Package, ChevronDown, ChevronRight, AlertTriangle, Calendar, MapPin } from 'lucide-react'
import type { StatsResponse, DriverStats, TourStat, DayActivity, StopEvent } from '@/app/api/delivery/stats/route'

// ── Formatters ────────────────────────────────────────────────────────────────

function fmtDuration(ms: number | null): string {
  if (ms == null || ms <= 0) return '—'
  const totalMin = Math.round(ms / 60_000)
  const days  = Math.floor(totalMin / 1440)
  const hours = Math.floor((totalMin % 1440) / 60)
  const mins  = totalMin % 60
  if (days > 0) return hours > 0 ? `${days}j ${hours}h` : `${days}j`
  if (hours === 0) return `${mins}min`
  return mins > 0 ? `${hours}h${String(mins).padStart(2, '0')}` : `${hours}h`
}

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' })
}

function fmtDateTime(iso: string): string {
  return new Date(iso).toLocaleString('fr-FR', {
    timeZone: 'Europe/Paris',
    day: 'numeric', month: 'short',
    hour: '2-digit', minute: '2-digit',
  })
}

function fmtTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('fr-FR', {
    timeZone: 'Europe/Paris',
    hour: '2-digit', minute: '2-digit',
  })
}

function fmtDayLabel(yyyymmdd: string): string {
  const [y, m, d] = yyyymmdd.split('-').map(Number)
  return new Date(y, m - 1, d).toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'short' })
}

function fmtMonth(ym: string): string {
  const [y, m] = ym.split('-')
  return new Date(Number(y), Number(m) - 1).toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' })
}

// ── Sub-components ────────────────────────────────────────────────────────────

function StatBadge({ icon, label, value, sub }: {
  icon: React.ReactNode
  label: string
  value: string
  sub?: string
}) {
  return (
    <div className="bg-[#f8f7f5] rounded-[14px] px-4 py-3 flex items-center gap-3 min-w-0">
      <div className="w-9 h-9 rounded-[10px] bg-white shadow-sm flex items-center justify-center text-[#6366f1] shrink-0">
        {icon}
      </div>
      <div className="min-w-0">
        <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-[#9b9b93] truncate">{label}</p>
        <p className="text-lg font-bold text-[#1a1a2e] leading-tight">{value}</p>
        {sub && <p className="text-[10px] text-[#9b9b93]">{sub}</p>}
      </div>
    </div>
  )
}

function StopLine({ stop, showTime = true }: { stop: StopEvent; showTime?: boolean }) {
  const color = stop.status === 'delivered' ? '#15803d'
    : stop.status === 'partial' ? '#a16207'
    : stop.status === 'failed'  ? '#b91c1c'
    : '#6b7280'

  return (
    <div className="flex items-start gap-2 py-1.5">
      <div className="w-1.5 h-1.5 rounded-full mt-1.5 shrink-0" style={{ background: color }} />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          {showTime && stop.delivered_at && (
            <span className="text-[10px] font-mono text-[#9b9b93] shrink-0">{fmtTime(stop.delivered_at)}</span>
          )}
          <span className="text-xs font-semibold text-[#1a1a2e] truncate">{stop.customer_name || stop.order_name}</span>
          {stop.city && <span className="text-[10px] text-[#9b9b93] shrink-0">— {stop.city}</span>}
        </div>
        <div className="flex items-center gap-2 mt-0.5 flex-wrap">
          <span className="text-[10px] text-[#9b9b93]">{stop.order_name}</span>
          {stop.panels > 0 && (
            <span className="text-[10px] font-medium" style={{ color }}>
              {stop.panels} panneau{stop.panels > 1 ? 'x' : ''}
            </span>
          )}
        </div>
      </div>
    </div>
  )
}

// ── Activity Calendar ─────────────────────────────────────────────────────────

function toParisDayStr(iso: string): string {
  const d = new Date(iso)
  const s = d.toLocaleString('en-US', { timeZone: 'Europe/Paris' })
  const p = new Date(s)
  return [p.getFullYear(), String(p.getMonth() + 1).padStart(2, '0'), String(p.getDate()).padStart(2, '0')].join('-')
}

function addDays(yyyymmdd: string, n: number): string {
  const [y, m, d] = yyyymmdd.split('-').map(Number)
  const dt = new Date(y, m - 1, d + n)
  return [dt.getFullYear(), String(dt.getMonth() + 1).padStart(2, '0'), String(dt.getDate()).padStart(2, '0')].join('-')
}

function shortDayFr(yyyymmdd: string): string {
  const [y, m, d] = yyyymmdd.split('-').map(Number)
  return new Date(y, m - 1, d).toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric', month: 'short' })
}

function ActivityCalendar({ tour }: { tour: TourStat }) {
  const [tooltip, setTooltip] = useState<string | null>(null)

  if (!tour.started_at) return null

  const startDay = toParisDayStr(tour.started_at)
  const endDay   = tour.completed_at ? toParisDayStr(tour.completed_at) : toParisDayStr(new Date().toISOString())

  // Build ordered day list
  const days: string[] = []
  let cur = startDay
  while (cur <= endDay) {
    days.push(cur)
    cur = addDays(cur, 1)
  }

  if (days.length === 0) return null

  // Map of date → delivery count
  const activityMap = new Map<string, number>()
  for (const d of tour.days) activityMap.set(d.date, d.deliveries.length)

  const workDays = days.filter(d => activityMap.has(d)).length
  const idleDays = days.length - workDays

  return (
    <div>
      {/* Summary counters */}
      <div className="flex items-center gap-3 mb-2 flex-wrap">
        <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-[#9b9b93]">
          Calendrier d&apos;activité
        </p>
        <span className="text-[10px] font-semibold text-[#15803d] bg-[#dcfce7] px-2 py-0.5 rounded-full">
          {workDays}j travaillé{workDays > 1 ? 's' : ''}
        </span>
        {idleDays > 0 && (
          <span className="text-[10px] font-semibold text-[#b91c1c] bg-[#fee2e2] px-2 py-0.5 rounded-full">
            {idleDays}j sans activité
          </span>
        )}
        <span className="text-[10px] text-[#9b9b93]">
          {days.length}j au total ({shortDayFr(startDay)} → {shortDayFr(endDay)})
        </span>
      </div>

      {/* Day squares */}
      <div className="flex flex-wrap gap-1 relative">
        {days.map(day => {
          const count = activityMap.get(day) ?? 0
          const isWork = count > 0

          let bg: string
          if (isWork) {
            const intensity = Math.min(count, 5)
            const greens = ['#bbf7d0', '#86efac', '#4ade80', '#22c55e', '#16a34a']
            bg = greens[intensity - 1]
          } else {
            bg = '#fecaca' // red — no activity (including weekends)
          }

          const label = `${shortDayFr(day)}${isWork ? ` · ${count} livraison${count > 1 ? 's' : ''}` : ' · Aucune activité'}`

          return (
            <div
              key={day}
              className="relative"
              onMouseEnter={() => setTooltip(label)}
              onMouseLeave={() => setTooltip(null)}
            >
              <div
                className="w-7 h-7 rounded-[5px] flex items-center justify-center text-[10px] font-bold cursor-default select-none"
                style={{
                  background: bg,
                  color: isWork && count >= 3 ? '#14532d' : isWork ? '#15803d' : '#b91c1c',
                  border: day === toParisDayStr(new Date().toISOString()) ? '2px solid #6366f1' : '2px solid transparent',
                }}
              >
                {new Date(Number(day.split('-')[0]), Number(day.split('-')[1]) - 1, Number(day.split('-')[2])).getDate()}
              </div>
            </div>
          )
        })}
      </div>

      {/* Active tooltip */}
      {tooltip && (
        <p className="text-[11px] text-[#1a1a2e] bg-white border border-[#e8e8e4] rounded-[7px] px-2.5 py-1.5 mt-2 shadow-sm inline-block">
          {tooltip}
        </p>
      )}

      {/* Legend */}
      <div className="flex items-center gap-3 mt-2 flex-wrap">
        {[
          { color: '#4ade80', label: 'Jours travaillés' },
          { color: '#fecaca', label: 'Jours sans activité' },
        ].map(({ color, label }) => (
          <div key={label} className="flex items-center gap-1">
            <div className="w-3 h-3 rounded-[3px]" style={{ background: color }} />
            <span className="text-[10px] text-[#9b9b93]">{label}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

function DayBlock({ day }: { day: DayActivity }) {
  return (
    <div className="mb-3">
      <div className="flex items-center gap-2 mb-1">
        <Calendar size={11} className="text-[#9b9b93]" />
        <span className="text-[10px] font-semibold uppercase tracking-[0.07em] text-[#9b9b93]">
          {fmtDayLabel(day.date)}
        </span>
        <span className="text-[10px] text-[#9b9b93]">— {day.deliveries.length} livraison{day.deliveries.length > 1 ? 's' : ''}</span>
      </div>
      <div className="pl-3 border-l-2 border-[#e8e8e4]">
        {day.deliveries.map((s, i) => (
          <StopLine key={`${s.order_name}-${i}`} stop={s} showTime />
        ))}
      </div>
    </div>
  )
}

function TourRow({ tour }: { tour: TourStat }) {
  const [open, setOpen] = useState(tour.status === 'in_progress')

  const successRate = tour.stops_total > 0
    ? Math.round(((tour.stops_delivered + tour.stops_partial) / tour.stops_total) * 100)
    : null

  const isActive = tour.status === 'in_progress'
  const hasIdleDays = isActive && tour.idle_days > 1

  return (
    <div className="border border-[#f0f0ee] rounded-[12px] overflow-hidden">
      <button
        onClick={() => setOpen(v => !v)}
        className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-[#fafaf8] transition-colors"
      >
        {open ? <ChevronDown size={14} className="text-[#9b9b93] shrink-0" /> : <ChevronRight size={14} className="text-[#9b9b93] shrink-0" />}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-semibold text-sm text-[#1a1a2e]">{tour.name}</span>
            {tour.planned_date && <span className="text-[10px] text-[#9b9b93]">{fmtDate(tour.planned_date)}</span>}
            {isActive && (
              <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-[#fef9c3] text-[#a16207]">
                en cours
              </span>
            )}
          </div>
          {/* Alert: idle days for in-progress tour */}
          {hasIdleDays && (
            <div className="flex items-center gap-1 mt-0.5">
              <AlertTriangle size={10} className="text-[#b91c1c]" />
              <span className="text-[10px] text-[#b91c1c] font-medium">
                {tour.idle_days} jour{tour.idle_days > 1 ? 's' : ''} sans activité sur {tour.days_since_start} jours au total
              </span>
            </div>
          )}
        </div>
        <div className="flex items-center gap-4 shrink-0 text-right">
          <div className="hidden sm:block">
            <p className="text-xs font-bold text-[#1a1a2e]">{tour.panels_delivered} panneaux</p>
            <p className="text-[10px] text-[#9b9b93]">{tour.stops_delivered + tour.stops_partial}/{tour.stops_total} stops</p>
          </div>
          {!isActive && (
            <div className="hidden sm:block">
              <p className="text-xs font-bold text-[#1a1a2e]">{fmtDuration(tour.duration_ms)}</p>
              {tour.total_km != null && <p className="text-[10px] text-[#9b9b93]">{tour.total_km} km</p>}
            </div>
          )}
          {successRate != null && (
            <div className={`w-10 h-10 rounded-full flex items-center justify-center text-[11px] font-bold shrink-0 ${
              isActive           ? 'bg-[#fef9c3] text-[#a16207]'
              : successRate === 100 ? 'bg-[#dcfce7] text-[#15803d]'
              : successRate >= 75   ? 'bg-[#fef9c3] text-[#a16207]'
              : 'bg-[#fee2e2] text-[#b91c1c]'
            }`}>
              {successRate}%
            </div>
          )}
        </div>
      </button>

      {open && (
        <div className="border-t border-[#f0f0ee] bg-[#fafaf8] px-4 py-4 space-y-4">

          {/* Alert banner for procrastination */}
          {hasIdleDays && (
            <div className="bg-[#fee2e2] border border-[#fecaca] rounded-[10px] px-4 py-3 flex items-start gap-2">
              <AlertTriangle size={14} className="text-[#b91c1c] shrink-0 mt-0.5" />
              <div>
                <p className="text-xs font-bold text-[#b91c1c]">Activité fragmentée</p>
                <p className="text-[11px] text-[#b91c1c]/80 mt-0.5">
                  Démarré le {fmtDateTime(tour.started_at!)}, {tour.days_with_activity} jour{tour.days_with_activity > 1 ? 's' : ''} avec livraisons sur {tour.days_since_start} jours calendaires — {tour.idle_days} jour{tour.idle_days > 1 ? 's' : ''} sans activité.
                </p>
              </div>
            </div>
          )}

          {/* Started at / timestamps */}
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 text-xs">
            <div className="bg-white rounded-[8px] px-3 py-2">
              <p className="text-[#9b9b93] text-[10px]">Chargement / Départ</p>
              <p className="font-semibold text-[#1a1a2e]">
                {tour.started_at ? fmtDateTime(tour.started_at) : '—'}
              </p>
            </div>
            <div className="bg-white rounded-[8px] px-3 py-2">
              <p className="text-[#9b9b93] text-[10px]">Fin de tournée</p>
              <p className="font-semibold text-[#1a1a2e]">
                {tour.completed_at ? fmtDateTime(tour.completed_at) : isActive ? 'En cours…' : '—'}
              </p>
            </div>
            <div className="bg-white rounded-[8px] px-3 py-2">
              <p className="text-[#9b9b93] text-[10px]">Stops OK / Partiel / Raté</p>
              <p className="font-semibold text-[#1a1a2e]">
                <span className="text-[#15803d]">{tour.stops_delivered}</span>
                {' / '}
                <span className="text-[#a16207]">{tour.stops_partial}</span>
                {' / '}
                <span className="text-[#b91c1c]">{tour.stops_failed}</span>
                {tour.stops_pending > 0 && (
                  <span className="text-[#9b9b93]"> + {tour.stops_pending} en attente</span>
                )}
              </p>
            </div>
          </div>

          {/* Mobile summary */}
          <div className="sm:hidden flex flex-wrap gap-3 text-sm">
            <span><span className="font-semibold">{tour.panels_delivered}</span> panneaux livrés</span>
            {!isActive && <span><span className="font-semibold">{fmtDuration(tour.duration_ms)}</span></span>}
            {tour.total_km != null && <span><span className="font-semibold">{tour.total_km} km</span></span>}
          </div>

          {/* Activity calendar */}
          {tour.started_at && (
            <div className="bg-white rounded-[10px] px-4 py-3">
              <ActivityCalendar tour={tour} />
            </div>
          )}

          {/* Day-by-day timeline */}
          {tour.days.length > 0 && (
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-[#9b9b93] mb-3">
                Chronologie des livraisons
              </p>
              {tour.days.map(day => (
                <DayBlock key={day.date} day={day} />
              ))}
            </div>
          )}

          {/* Pending stops */}
          {tour.pending_stops.length > 0 && (
            <div>
              <div className="flex items-center gap-2 mb-2">
                <MapPin size={11} className="text-[#9b9b93]" />
                <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-[#9b9b93]">
                  Restant à livrer ({tour.pending_stops.length})
                </p>
              </div>
              <div className="pl-3 border-l-2 border-[#e8e8e4]">
                {tour.pending_stops.map((s, i) => (
                  <StopLine key={`${s.order_name}-${i}`} stop={s} showTime={false} />
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ── Driver Monthly Calendar ───────────────────────────────────────────────────

function DriverMonthCalendar({ driver, month }: { driver: DriverStats; month: string }) {
  const [tooltip, setTooltip] = useState<string | null>(null)

  if (!month || !/^\d{4}-\d{2}$/.test(month)) return null

  const [y, m] = month.split('-').map(Number)
  const daysInMonth = new Date(y, m, 0).getDate()
  const today = toParisDayStr(new Date().toISOString())

  // Build delivery map across ALL tours: date → total deliveries
  const deliveryMap = new Map<string, number>()
  for (const tour of driver.tours) {
    for (const day of tour.days) {
      deliveryMap.set(day.date, (deliveryMap.get(day.date) ?? 0) + day.deliveries.length)
    }
  }

  // Summary counters for the month
  let workDays = 0, idleDays = 0
  const allMonthDays: string[] = []
  for (let d = 1; d <= daysInMonth; d++) {
    const day = `${month}-${String(d).padStart(2, '0')}`
    allMonthDays.push(day)
    if (day > today) continue
    const hasWork = deliveryMap.has(day)
    if (hasWork) workDays++
    else idleDays++
  }

  // Week headers
  const firstDow = new Date(y, m - 1, 1).getDay() // 0=Sun
  const mondayOffset = (firstDow + 6) % 7 // shift so Mon=0

  return (
    <div className="bg-[#f8f7f5] rounded-[14px] px-3 py-2.5 w-full">
      {/* Counters */}
      <div className="flex items-center gap-2 mb-2 flex-wrap">
        <span className="text-[10px] font-bold text-[#15803d] bg-[#dcfce7] px-1.5 py-0.5 rounded-full">
          {workDays}j ✓
        </span>
        {idleDays > 0 && (
          <span className="text-[10px] font-bold text-[#b91c1c] bg-[#fee2e2] px-1.5 py-0.5 rounded-full">
            {idleDays}j repos
          </span>
        )}
      </div>

      {/* Day-of-week header */}
      <div className="grid grid-cols-7 gap-0.5 mb-0.5">
        {['L', 'M', 'M', 'J', 'V', 'S', 'D'].map((d, i) => (
          <div key={i} className="text-center text-[8px] font-semibold text-[#9b9b93]">{d}</div>
        ))}
      </div>

      {/* Calendar grid */}
      <div className="grid grid-cols-7 gap-0.5">
        {Array.from({ length: mondayOffset }).map((_, i) => (
          <div key={`e${i}`} />
        ))}

        {allMonthDays.map(day => {
          const d = Number(day.split('-')[2])
          const isFuture  = day > today
          const count     = deliveryMap.get(day) ?? 0
          const hasWork   = count > 0
          const isToday   = day === today

          let bg: string
          let textColor: string

          if (isFuture) {
            bg = 'transparent'; textColor = '#d1d5db'
          } else if (hasWork) {
            const intensity = Math.min(count, 5)
            const greens = ['#bbf7d0', '#86efac', '#4ade80', '#22c55e', '#16a34a']
            bg = greens[intensity - 1]
            textColor = intensity >= 3 ? '#14532d' : '#15803d'
          } else {
            // Tous les jours passés sans livraison = rouge (repos)
            bg = '#fecaca'; textColor = '#b91c1c'
          }

          const label = isFuture
            ? shortDayFr(day)
            : hasWork
              ? `${shortDayFr(day)} · ${count} livraison${count > 1 ? 's' : ''}`
              : `${shortDayFr(day)} · Repos`

          return (
            <div
              key={day}
              className="w-full aspect-square min-h-[28px]"
              onMouseEnter={() => setTooltip(label)}
              onMouseLeave={() => setTooltip(null)}
            >
              <div
                className="relative w-full h-full rounded-[3px] flex items-center justify-center text-[9px] font-bold cursor-default select-none"
                style={{
                  background: bg,
                  color: textColor,
                  outline: isToday ? '1.5px solid #6366f1' : 'none',
                  outlineOffset: '1px',
                }}
              >
                {d}
                {hasWork && (
                  <span
                    className="absolute bottom-[2px] right-[2px] w-[14px] h-[14px] rounded-full bg-white flex items-center justify-center text-[9px] font-bold leading-none"
                    style={{ color: textColor }}
                  >
                    {count}
                  </span>
                )}
              </div>
            </div>
          )
        })}
      </div>

      {/* Tooltip */}
      {tooltip && (
        <p className="text-[10px] text-[#1a1a2e] bg-white border border-[#e8e8e4] rounded-[6px] px-2 py-1 mt-1.5 shadow-sm inline-block">
          {tooltip}
        </p>
      )}

      {/* Minimal legend */}
      <div className="flex items-center gap-2 mt-1.5 flex-wrap">
        {[
          { color: '#4ade80', label: 'Travaillé' },
          { color: '#fecaca', label: 'Inactif' },
        ].map(({ color, label }) => (
          <div key={label} className="flex items-center gap-1">
            <div className="w-2.5 h-2.5 rounded-[2px]" style={{ background: color }} />
            <span className="text-[9px] text-[#9b9b93]">{label}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

function DriverCard({ driver, defaultOpen, month }: { driver: DriverStats; defaultOpen?: boolean; month: string }) {
  const [open, setOpen] = useState(defaultOpen ?? false)
  const hasActiveTours = driver.active_tours > 0

  return (
    <div className="bg-white border border-[#e8e8e4] rounded-[18px] overflow-hidden shadow-sm">
      {/* Header */}
      <button
        onClick={() => setOpen(v => !v)}
        className="w-full flex items-center gap-4 px-5 py-4 text-left hover:bg-[#fafaf8] transition-colors"
      >
        <div className="w-10 h-10 rounded-full bg-[#1a1a2e] text-white flex items-center justify-center font-bold text-base shrink-0">
          {driver.driver_name.charAt(0).toUpperCase()}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <p className="font-bold text-[#1a1a2e] text-base leading-tight">{driver.driver_name}</p>
            {hasActiveTours && (
              <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-[#fef9c3] text-[#a16207]">
                {driver.active_tours} en cours
              </span>
            )}
          </div>
          <p className="text-xs text-[#9b9b93]">
            {driver.total_tours} tournée{driver.total_tours > 1 ? 's' : ''}
            {driver.completed_tours > 0 && ` · ${driver.completed_tours} terminée${driver.completed_tours > 1 ? 's' : ''}`}
          </p>
        </div>
        {open ? <ChevronDown size={16} className="text-[#9b9b93] shrink-0" /> : <ChevronRight size={16} className="text-[#9b9b93] shrink-0" />}
      </button>

      {/* Two-column body: stats left, calendar right */}
      <div className="px-5 pb-4 flex gap-4 items-start">
        {/* Left: stat badges stacked vertically */}
        <div className="flex flex-col gap-2 shrink-0 w-[160px]">
          <StatBadge
            icon={<Package size={16} />}
            label="Panneaux livrés"
            value={String(driver.total_panels)}
            sub={driver.completed_tours > 0 ? `~${driver.avg_panels_per_tour}/tournée` : undefined}
          />
          <StatBadge
            icon={<Clock size={16} />}
            label="Durée totale"
            value={fmtDuration(driver.total_duration_ms)}
            sub={driver.avg_duration_ms ? `moy. ${fmtDuration(driver.avg_duration_ms)}` : undefined}
          />
          <StatBadge
            icon={<Route size={16} />}
            label="Km parcourus"
            value={driver.total_km != null ? `${driver.total_km} km` : '—'}
            sub={driver.total_km && driver.completed_tours > 1 ? `~${Math.round(driver.total_km / driver.completed_tours)} km/tournée` : undefined}
          />
          <StatBadge
            icon={<TrendingUp size={16} />}
            label="Tournées"
            value={String(driver.total_tours)}
          />
        </div>

        {/* Right: compact monthly calendar */}
        <div className="flex-1 min-w-0">
          <DriverMonthCalendar driver={driver} month={month} />
        </div>
      </div>

      {/* Tour list */}
      {open && (
        <div className="border-t border-[#f0f0ee] px-5 py-4 space-y-2">
          <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-[#9b9b93] mb-3">
            Détail des tournées
          </p>
          {driver.tours.map(t => <TourRow key={t.id} tour={t} />)}
        </div>
      )}
    </div>
  )
}

// ── Main component ────────────────────────────────────────────────────────────

export default function StatsView() {
  const [data, setData]       = useState<StatsResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [month, setMonth]     = useState<string>('')

  // Default to current month
  useEffect(() => {
    const now = new Date()
    const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
    setMonth(currentMonth)
  }, [])

  const load = useCallback(async (m: string) => {
    setLoading(true)
    try {
      const params = m ? `?month=${m}` : ''
      const r = await fetch(`/api/delivery/stats${params}`, { cache: 'no-store' })
      const d = await r.json() as StatsResponse
      setData(d)
    } catch { /* ignore */ } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (month) load(month)
  }, [month, load])

  const totalPanels   = data?.drivers.reduce((s, d) => s + d.total_panels, 0) ?? 0
  const totalTours    = data?.drivers.reduce((s, d) => s + d.total_tours, 0) ?? 0
  const totalKm       = data?.drivers.every(d => d.total_km == null)
    ? null
    : data?.drivers.reduce((s, d) => s + (d.total_km ?? 0), 0) ?? null
  const totalDuration = data?.drivers.every(d => d.total_duration_ms == null)
    ? null
    : data?.drivers.reduce((s, d) => s + (d.total_duration_ms ?? 0), 0) ?? null

  return (
    <div className="min-h-screen bg-[#f5f4f2] pb-20">
      {/* Top bar */}
      <div className="bg-white border-b border-[#e8e8e4] px-4 sm:px-6 py-4">
        <div className="max-w-4xl mx-auto flex items-center justify-between gap-4 flex-wrap">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-[10px] bg-[#1a1a2e] flex items-center justify-center">
              <BarChart2 size={18} className="text-white" />
            </div>
            <div>
              <h1 className="text-base font-bold text-[#1a1a2e]">Stats livreurs</h1>
              <p className="text-[11px] text-[#9b9b93]">Complétées + en cours</p>
            </div>
          </div>

          {/* Month picker */}
          <div className="flex items-center gap-2">
            <select
              value={month}
              onChange={e => setMonth(e.target.value)}
              className="text-sm font-medium text-[#1a1a2e] bg-[#f5f4f2] border border-[#e8e8e4] rounded-[10px] px-3 py-2 outline-none cursor-pointer"
            >
              {(data?.months ?? []).includes(month) ? null : month ? (
                <option value={month}>{fmtMonth(month)}</option>
              ) : null}
              {(data?.months ?? []).map(m => (
                <option key={m} value={m}>{fmtMonth(m)}</option>
              ))}
            </select>
          </div>
        </div>
      </div>

      <div className="max-w-4xl mx-auto px-4 sm:px-6 pt-5 space-y-4">
        {loading ? (
          <div className="flex items-center justify-center py-20">
            <p className="text-sm text-[#9b9b93]">Chargement…</p>
          </div>
        ) : !data || data.drivers.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <p className="text-base font-semibold text-[#1a1a2e]">Aucune tournée</p>
            <p className="text-sm text-[#9b9b93] mt-1">sur {data?.month ? fmtMonth(data.month) : 'cette période'}</p>
          </div>
        ) : (
          <>
            {/* Total recap at the top */}
            <div className="bg-[#1a1a2e] rounded-[18px] px-5 py-5 shadow-sm">
              <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-white/50 mb-4">
                Total — {data.month !== 'all' ? fmtMonth(data.month) : 'toute période'}
              </p>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
                {[
                  { label: 'Panneaux livrés', value: String(totalPanels), icon: <Package size={15} /> },
                  { label: 'Tournées',         value: String(totalTours),  icon: <BarChart2 size={15} /> },
                  { label: 'Km parcourus',     value: totalKm != null ? `${totalKm} km` : '—', icon: <Route size={15} /> },
                  { label: 'Temps cumulé',     value: fmtDuration(totalDuration), icon: <Clock size={15} /> },
                ].map(({ label, value, icon }) => (
                  <div key={label} className="bg-white/8 rounded-[12px] px-4 py-3">
                    <div className="flex items-center gap-1.5 mb-1 text-white/50">
                      {icon}
                      <p className="text-[10px] font-semibold uppercase tracking-[0.07em]">{label}</p>
                    </div>
                    <p className="text-2xl font-bold text-white leading-tight">{value}</p>
                  </div>
                ))}
              </div>

              {/* Per-driver comparison table */}
              {data.drivers.length > 1 && (
                <div className="border-t border-white/10 pt-4 space-y-2">
                  {data.drivers.map(d => (
                    <div key={d.driver_name} className="flex items-center gap-3 text-sm">
                      <div className="w-7 h-7 rounded-full bg-white/10 text-white flex items-center justify-center font-bold text-xs shrink-0">
                        {d.driver_name.charAt(0).toUpperCase()}
                      </div>
                      <span className="flex-1 font-medium text-white">{d.driver_name}</span>
                      {d.active_tours > 0 && (
                        <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-[#a16207]/30 text-[#fef9c3]">
                          {d.active_tours} en cours
                        </span>
                      )}
                      <span className="text-white/60 text-xs">{d.total_tours} tournée{d.total_tours > 1 ? 's' : ''}</span>
                      <span className="font-semibold text-white w-20 text-right">{d.total_panels} pan.</span>
                      <span className="text-white/60 w-16 text-right">{d.total_km != null ? `${d.total_km} km` : '—'}</span>
                      <span className="text-white/60 w-16 text-right">{fmtDuration(d.total_duration_ms)}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* One card per driver */}
            {data.drivers.map((driver) => (
              <DriverCard key={driver.driver_name} driver={driver} month={month} defaultOpen />
            ))}
          </>
        )}
      </div>
    </div>
  )
}
