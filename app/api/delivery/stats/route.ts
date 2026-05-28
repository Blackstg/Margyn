// GET /api/delivery/stats?month=2026-05
// Returns per-driver stats for all tours (completed + in_progress) in a given month.

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

function computePanelCount(details: { title?: string; qty?: number }[]): number {
  return details
    .filter(d => isPanel(d.title ?? ''))
    .reduce((sum, d) => sum + panelSlots(d.title ?? '', d.qty ?? 0), 0)
}

// ── Types ─────────────────────────────────────────────────────────────────────

export interface StopEvent {
  sequence:      number
  order_name:    string
  customer_name: string
  city:          string
  status:        string   // delivered | partial | failed | pending
  delivered_at:  string | null
  panels:        number
}

export interface DayActivity {
  date:       string        // 'YYYY-MM-DD' (Paris time)
  deliveries: StopEvent[]  // stops delivered that day
}

export interface TourStat {
  id:              string
  name:            string
  status:          string   // planned | in_progress | completed | cancelled
  planned_date:    string
  started_at:      string | null
  completed_at:    string | null
  duration_ms:     number | null
  total_km:        number | null
  panels_delivered: number
  stops_delivered: number
  stops_partial:   number
  stops_failed:    number
  stops_pending:   number
  stops_total:     number
  // Days since start with no activity (for in_progress tours)
  days_since_start:  number | null
  days_with_activity: number
  idle_days:         number
  // Chronological timeline of deliveries, grouped by day
  days:              DayActivity[]
  // All stops for pending display
  pending_stops:     StopEvent[]
}

export interface DriverStats {
  driver_name:         string
  tours:               TourStat[]
  total_tours:         number
  completed_tours:     number
  active_tours:        number
  total_panels:        number
  total_km:            number | null
  total_duration_ms:   number | null
  avg_duration_ms:     number | null
  avg_panels_per_tour: number
}

export interface StatsResponse {
  month:   string
  months:  string[]
  drivers: DriverStats[]
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function toParisDayISO(iso: string): string {
  const d = new Date(iso)
  const s = d.toLocaleString('en-US', { timeZone: 'Europe/Paris' })
  const p = new Date(s)
  return [
    p.getFullYear(),
    String(p.getMonth() + 1).padStart(2, '0'),
    String(p.getDate()).padStart(2, '0'),
  ].join('-')
}

function normalizeName(raw: string): string {
  return raw.trim().toLowerCase().split(/\s+/)
    .map((w: string) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ')
}

// ── Handler ───────────────────────────────────────────────────────────────────

export async function GET(req: NextRequest) {
  try {
    const month = req.nextUrl.searchParams.get('month') ?? ''
    const admin = getAdmin()

    let fromDate: string | null = null
    let toDate:   string | null = null
    if (month && /^\d{4}-\d{2}$/.test(month)) {
      fromDate = `${month}-01`
      const [y, m] = month.split('-').map(Number)
      const nextMonth = m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}`
      toDate = `${nextMonth}-01`
    }

    // Include in_progress tours so current state is visible
    let query = admin
      .from('delivery_tours')
      .select(`
        id, name, driver_name, planned_date, status,
        started_at, completed_at, total_km,
        delivery_stops(
          sequence, order_name, customer_name, city,
          status, delivered_at, panel_count, panel_details
        )
      `)
      .eq('brand', 'bowa')
      .in('status', ['completed', 'in_progress'])
      .order('planned_date', { ascending: false })

    // For month filter: include any tour that overlaps with the selected month.
    // Two chained .or() (AND between them):
    //   1st: at least one date >= month start  (tour starts/ends after month begins)
    //   2nd: at least one date <  month end    (tour starts/ends before month ends)
    // Together they capture: planned in month, started in month, completed in month,
    // or spanning the month (e.g. April tour that ends May 2).
    if (fromDate && toDate) {
      const fromISO = `${fromDate}T00:00:00Z`
      const toISO   = `${toDate}T00:00:00Z`
      query = query.or(
        `planned_date.gte.${fromDate},started_at.gte.${fromISO},completed_at.gte.${fromISO},planned_date.is.null`
      )
      query = query.or(
        `planned_date.lt.${toDate},started_at.lt.${toISO},completed_at.lt.${toISO},status.eq.in_progress`
      )
    }

    const [{ data: tours, error }, { data: allDates }] = await Promise.all([
      query,
      admin
        .from('delivery_tours')
        .select('planned_date')
        .eq('brand', 'bowa')
        .in('status', ['completed', 'in_progress'])
        .not('planned_date', 'is', null),
    ])

    if (error) throw error

    // Available months for picker
    const monthSet = new Set<string>()
    for (const t of allDates ?? []) {
      if (t.planned_date) monthSet.add(t.planned_date.slice(0, 7))
    }
    const months = [...monthSet].sort().reverse()

    const driverMap = new Map<string, TourStat[]>()

    for (const tour of tours ?? []) {
      const rawStops = (tour.delivery_stops ?? []) as {
        sequence:      number
        order_name:    string
        customer_name: string
        city:          string
        status:        string
        delivered_at:  string | null
        panel_count:   number
        panel_details?: { title?: string; qty?: number }[]
      }[]

      // Sort stops by sequence
      const stops = [...rawStops].sort((a, b) => (a.sequence ?? 0) - (b.sequence ?? 0))

      // Panel count per stop
      const stopEvents: StopEvent[] = stops.map(s => {
        const details = s.panel_details ?? []
        const panels  = details.length > 0 ? computePanelCount(details) : (s.panel_count ?? 0)
        return {
          sequence:      s.sequence ?? 0,
          order_name:    s.order_name,
          customer_name: s.customer_name ?? '',
          city:          s.city ?? '',
          status:        s.status,
          delivered_at:  s.delivered_at ?? null,
          panels,
        }
      })

      // Group deliveries by Paris calendar day
      const dayMap = new Map<string, StopEvent[]>()
      for (const s of stopEvents) {
        if ((s.status === 'delivered' || s.status === 'partial') && s.delivered_at) {
          const day = toParisDayISO(s.delivered_at)
          if (!dayMap.has(day)) dayMap.set(day, [])
          dayMap.get(day)!.push(s)
        }
      }
      const days: DayActivity[] = [...dayMap.entries()]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([date, deliveries]) => ({
          date,
          deliveries: deliveries.sort((a, b) =>
            (a.delivered_at ?? '').localeCompare(b.delivered_at ?? '')
          ),
        }))

      // Days with activity vs idle days since start
      const daysWithActivity = days.length
      let daysSinceStart: number | null = null
      let idleDays = 0
      if (tour.started_at) {
        const startDay  = toParisDayISO(tour.started_at)
        const endStr    = tour.completed_at ? toParisDayISO(tour.completed_at) : toParisDayISO(new Date().toISOString())
        const startMs   = new Date(startDay).getTime()
        const endMs     = new Date(endStr).getTime()
        const totalDays = Math.floor((endMs - startMs) / 86_400_000) + 1
        daysSinceStart  = totalDays
        idleDays        = Math.max(0, totalDays - daysWithActivity)
      }

      const delivered    = stopEvents.filter(s => s.status === 'delivered' || s.status === 'partial')
      const pendingStops = stopEvents.filter(s => s.status === 'pending')
      const panels_delivered = delivered.reduce((s, e) => s + e.panels, 0)

      const duration_ms =
        tour.started_at && tour.completed_at
          ? new Date(tour.completed_at).getTime() - new Date(tour.started_at).getTime()
          : null

      const stat: TourStat = {
        id:              tour.id,
        name:            tour.name,
        status:          tour.status,
        planned_date:    tour.planned_date,
        started_at:      tour.started_at,
        completed_at:    tour.completed_at,
        duration_ms,
        total_km:        tour.total_km ?? null,
        panels_delivered,
        stops_delivered: stopEvents.filter(s => s.status === 'delivered').length,
        stops_partial:   stopEvents.filter(s => s.status === 'partial').length,
        stops_failed:    stopEvents.filter(s => s.status === 'failed').length,
        stops_pending:   pendingStops.length,
        stops_total:     stops.length,
        days_since_start:   daysSinceStart,
        days_with_activity: daysWithActivity,
        idle_days:          idleDays,
        days,
        pending_stops:   pendingStops,
      }

      const driver = normalizeName(tour.driver_name?.trim() || 'Inconnu')
      if (!driverMap.has(driver)) driverMap.set(driver, [])
      driverMap.get(driver)!.push(stat)
    }

    const drivers: DriverStats[] = [...driverMap.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([driver_name, driverTours]) => {
        const completed = driverTours.filter(t => t.status === 'completed')
        const total_panels   = driverTours.reduce((s, t) => s + t.panels_delivered, 0)
        const kmValues       = completed.filter(t => t.total_km != null).map(t => t.total_km!)
        const total_km       = kmValues.length > 0 ? Math.round(kmValues.reduce((a, b) => a + b, 0)) : null
        const durValues      = completed.filter(t => t.duration_ms != null).map(t => t.duration_ms!)
        const total_duration_ms = durValues.length > 0 ? durValues.reduce((a, b) => a + b, 0) : null
        const avg_duration_ms   = durValues.length > 0 ? Math.round(total_duration_ms! / durValues.length) : null

        return {
          driver_name,
          tours: driverTours,
          total_tours:         driverTours.length,
          completed_tours:     completed.length,
          active_tours:        driverTours.filter(t => t.status === 'in_progress').length,
          total_panels,
          total_km,
          total_duration_ms,
          avg_duration_ms,
          avg_panels_per_tour: completed.length > 0
            ? Math.round(completed.reduce((s, t) => s + t.panels_delivered, 0) / completed.length)
            : 0,
        }
      })

    return NextResponse.json({ month: month || 'all', months, drivers } satisfies StatsResponse)

  } catch (err) {
    console.error('[delivery/stats GET]', err)
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
