// GET /api/delivery/stats?month=2026-05
// Returns per-driver stats for all completed tours in a given month.
// If no month param, returns the last 12 months.

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

export const dynamic = 'force-dynamic'

function getAdmin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}

const isPanel      = (title: string) => /panneau/i.test(title)
const isExtPanel   = (title: string) => /extpanel|ext[_\s-]?panel/i.test(title)
const isAkupanel60 = (title: string) => /akupanel.{0,10}60/i.test(title)
const panelSlots   = (title: string, qty: number) => {
  if (isExtPanel(title))   return Math.ceil(qty / 4)
  if (isAkupanel60(title)) return Math.ceil(qty / 2)
  return qty
}

function computePanelCount(
  details: { title?: string; qty?: number }[]
): number {
  return details
    .filter(d => isPanel(d.title ?? ''))
    .reduce((sum, d) => sum + panelSlots(d.title ?? '', d.qty ?? 0), 0)
}

export interface TourStat {
  id:              string
  name:            string
  planned_date:    string
  started_at:      string | null
  completed_at:    string | null
  duration_ms:     number | null
  total_km:        number | null
  panels_delivered: number
  stops_delivered: number
  stops_partial:   number
  stops_failed:    number
  stops_total:     number
}

export interface DriverStats {
  driver_name:     string
  tours:           TourStat[]
  total_tours:     number
  total_panels:    number
  total_km:        number | null
  total_duration_ms: number | null
  avg_duration_ms: number | null
  avg_panels_per_tour: number
}

export interface StatsResponse {
  month:   string   // 'YYYY-MM' or 'all'
  months:  string[] // available months with data
  drivers: DriverStats[]
}

export async function GET(req: NextRequest) {
  try {
    const month = req.nextUrl.searchParams.get('month') ?? ''
    const admin = getAdmin()

    // Date range filter
    let fromDate: string | null = null
    let toDate:   string | null = null
    if (month && /^\d{4}-\d{2}$/.test(month)) {
      fromDate = `${month}-01`
      const [y, m] = month.split('-').map(Number)
      const nextMonth = m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}`
      toDate = `${nextMonth}-01`
    }

    let query = admin
      .from('delivery_tours')
      .select('id, name, driver_name, planned_date, started_at, completed_at, total_km, delivery_stops(status, panel_count, panel_details)')
      .eq('brand', 'bowa')
      .eq('status', 'completed')
      .order('planned_date', { ascending: false })

    if (fromDate) query = query.gte('planned_date', fromDate)
    if (toDate)   query = query.lt('planned_date', toDate)

    const { data: tours, error } = await query

    if (error) throw error

    // Collect all distinct months for the picker
    const monthSet = new Set<string>()
    for (const t of tours ?? []) {
      if (t.planned_date) monthSet.add(t.planned_date.slice(0, 7))
    }
    const months = [...monthSet].sort().reverse()

    // Aggregate by driver
    const driverMap = new Map<string, TourStat[]>()

    for (const tour of tours ?? []) {
      const stops = (tour.delivery_stops ?? []) as {
        status: string
        panel_count: number
        panel_details?: { title?: string; qty?: number }[]
      }[]

      const delivered = stops.filter(s => s.status === 'delivered' || s.status === 'partial')
      const panels_delivered = delivered.reduce((sum, s) => {
        const details = s.panel_details ?? []
        return sum + (details.length > 0 ? computePanelCount(details) : (s.panel_count ?? 0))
      }, 0)

      const duration_ms =
        tour.started_at && tour.completed_at
          ? new Date(tour.completed_at).getTime() - new Date(tour.started_at).getTime()
          : null

      const stat: TourStat = {
        id:              tour.id,
        name:            tour.name,
        planned_date:    tour.planned_date,
        started_at:      tour.started_at,
        completed_at:    tour.completed_at,
        duration_ms,
        total_km:        tour.total_km ?? null,
        panels_delivered,
        stops_delivered: stops.filter(s => s.status === 'delivered').length,
        stops_partial:   stops.filter(s => s.status === 'partial').length,
        stops_failed:    stops.filter(s => s.status === 'failed').length,
        stops_total:     stops.length,
      }

      const driver = tour.driver_name?.trim() || 'Inconnu'
      if (!driverMap.has(driver)) driverMap.set(driver, [])
      driverMap.get(driver)!.push(stat)
    }

    // Build driver summaries, sorted by name
    const drivers: DriverStats[] = [...driverMap.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([driver_name, driverTours]) => {
        const total_panels    = driverTours.reduce((s, t) => s + t.panels_delivered, 0)
        const kmValues        = driverTours.filter(t => t.total_km != null).map(t => t.total_km!)
        const total_km        = kmValues.length > 0 ? Math.round(kmValues.reduce((a, b) => a + b, 0)) : null
        const durValues       = driverTours.filter(t => t.duration_ms != null).map(t => t.duration_ms!)
        const total_duration_ms = durValues.length > 0 ? durValues.reduce((a, b) => a + b, 0) : null
        const avg_duration_ms = durValues.length > 0 ? Math.round(total_duration_ms! / durValues.length) : null

        return {
          driver_name,
          tours: driverTours,
          total_tours:         driverTours.length,
          total_panels,
          total_km,
          total_duration_ms,
          avg_duration_ms,
          avg_panels_per_tour: driverTours.length > 0 ? Math.round(total_panels / driverTours.length) : 0,
        }
      })

    return NextResponse.json({
      month: month || 'all',
      months,
      drivers,
    } satisfies StatsResponse)

  } catch (err) {
    console.error('[delivery/stats GET]', err)
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
