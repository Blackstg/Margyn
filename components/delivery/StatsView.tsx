'use client'

import { useState, useEffect, useCallback } from 'react'
import { BarChart2, TrendingUp, Clock, Route, Package, ChevronDown, ChevronRight } from 'lucide-react'
import type { StatsResponse, DriverStats, TourStat } from '@/app/api/delivery/stats/route'

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

function TourRow({ tour }: { tour: TourStat }) {
  const [open, setOpen] = useState(false)
  const successRate = tour.stops_total > 0
    ? Math.round(((tour.stops_delivered + tour.stops_partial) / tour.stops_total) * 100)
    : null

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
            <span className="text-[10px] text-[#9b9b93]">{fmtDate(tour.planned_date)}</span>
          </div>
        </div>
        <div className="flex items-center gap-4 shrink-0 text-right">
          <div className="hidden sm:block">
            <p className="text-xs font-bold text-[#1a1a2e]">{tour.panels_delivered} panneaux</p>
            <p className="text-[10px] text-[#9b9b93]">{tour.stops_delivered + tour.stops_partial}/{tour.stops_total} stops</p>
          </div>
          <div className="hidden sm:block">
            <p className="text-xs font-bold text-[#1a1a2e]">{fmtDuration(tour.duration_ms)}</p>
            {tour.total_km != null && <p className="text-[10px] text-[#9b9b93]">{tour.total_km} km</p>}
          </div>
          {successRate != null && (
            <div className={`w-10 h-10 rounded-full flex items-center justify-center text-[11px] font-bold shrink-0 ${
              successRate === 100 ? 'bg-[#dcfce7] text-[#15803d]'
              : successRate >= 75  ? 'bg-[#fef9c3] text-[#a16207]'
              : 'bg-[#fee2e2] text-[#b91c1c]'
            }`}>
              {successRate}%
            </div>
          )}
        </div>
      </button>

      {open && (
        <div className="border-t border-[#f0f0ee] bg-[#fafaf8] px-4 py-3">
          {/* Mobile details */}
          <div className="sm:hidden flex flex-wrap gap-3 mb-3 text-sm">
            <span><span className="font-semibold">{tour.panels_delivered}</span> panneaux</span>
            <span><span className="font-semibold">{tour.stops_delivered + tour.stops_partial}</span>/{tour.stops_total} stops</span>
            <span><span className="font-semibold">{fmtDuration(tour.duration_ms)}</span></span>
            {tour.total_km != null && <span><span className="font-semibold">{tour.total_km} km</span></span>}
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
            <div className="bg-white rounded-[8px] px-3 py-2">
              <p className="text-[#9b9b93]">Départ</p>
              <p className="font-semibold text-[#1a1a2e]">{tour.started_at ? new Date(tour.started_at).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }) : '—'}</p>
            </div>
            <div className="bg-white rounded-[8px] px-3 py-2">
              <p className="text-[#9b9b93]">Fin</p>
              <p className="font-semibold text-[#1a1a2e]">{tour.completed_at ? new Date(tour.completed_at).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }) : '—'}</p>
            </div>
            <div className="bg-white rounded-[8px] px-3 py-2">
              <p className="text-[#9b9b93]">Stops OK / Partiel / Raté</p>
              <p className="font-semibold text-[#1a1a2e]">
                <span className="text-[#15803d]">{tour.stops_delivered}</span>
                {' / '}
                <span className="text-[#a16207]">{tour.stops_partial}</span>
                {' / '}
                <span className="text-[#b91c1c]">{tour.stops_failed}</span>
              </p>
            </div>
            <div className="bg-white rounded-[8px] px-3 py-2">
              <p className="text-[#9b9b93]">Panneaux livrés</p>
              <p className="font-semibold text-[#1a1a2e]">{tour.panels_delivered}</p>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function DriverCard({ driver, defaultOpen }: { driver: DriverStats; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen ?? false)

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
          <p className="font-bold text-[#1a1a2e] text-base leading-tight">{driver.driver_name}</p>
          <p className="text-xs text-[#9b9b93]">{driver.total_tours} tournée{driver.total_tours > 1 ? 's' : ''}</p>
        </div>
        {open ? <ChevronDown size={16} className="text-[#9b9b93] shrink-0" /> : <ChevronRight size={16} className="text-[#9b9b93] shrink-0" />}
      </button>

      {/* Summary stats */}
      <div className="px-5 pb-4 grid grid-cols-2 sm:grid-cols-4 gap-2">
        <StatBadge
          icon={<Package size={16} />}
          label="Panneaux livrés"
          value={String(driver.total_panels)}
          sub={`~${driver.avg_panels_per_tour}/tournée`}
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
          sub={driver.total_km && driver.total_tours > 1 ? `~${Math.round(driver.total_km / driver.total_tours)} km/tournée` : undefined}
        />
        <StatBadge
          icon={<TrendingUp size={16} />}
          label="Tournées"
          value={String(driver.total_tours)}
        />
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
  const [month, setMonth]     = useState<string>('')   // '' = current month

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
              <p className="text-[11px] text-[#9b9b93]">Tournées complétées</p>
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
            <p className="text-base font-semibold text-[#1a1a2e]">Aucune tournée complétée</p>
            <p className="text-sm text-[#9b9b93] mt-1">sur {data?.month ? fmtMonth(data.month) : 'cette période'}</p>
          </div>
        ) : (
          <>
            {/* Total recap at the top */}
            {(
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

                {/* Per-driver comparison table — only when multiple drivers */}
                {data.drivers.length > 1 && <div className="border-t border-white/10 pt-4 space-y-2">
                  {data.drivers.map(d => (
                    <div key={d.driver_name} className="flex items-center gap-3 text-sm">
                      <div className="w-7 h-7 rounded-full bg-white/10 text-white flex items-center justify-center font-bold text-xs shrink-0">
                        {d.driver_name.charAt(0).toUpperCase()}
                      </div>
                      <span className="flex-1 font-medium text-white">{d.driver_name}</span>
                      <span className="text-white/60 text-xs">{d.total_tours} tournée{d.total_tours > 1 ? 's' : ''}</span>
                      <span className="font-semibold text-white w-20 text-right">{d.total_panels} pan.</span>
                      <span className="text-white/60 w-16 text-right">{d.total_km != null ? `${d.total_km} km` : '—'}</span>
                      <span className="text-white/60 w-16 text-right">{fmtDuration(d.total_duration_ms)}</span>
                    </div>
                  ))}
                </div>}
              </div>
            )}

            {/* One card per driver */}
            {data.drivers.map((driver) => (
              <DriverCard key={driver.driver_name} driver={driver} defaultOpen />
            ))}
          </>
        )}
      </div>
    </div>
  )
}
