import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { normalizeDriverName } from '@/lib/delivery/driver'

export const dynamic = 'force-dynamic'

function getAdmin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}

// Only advertising panels count toward the 100-slot tour capacity.
// Re-computed from panel_details each time so historical stops with wrong
// panel_count values are corrected without a DB migration.
const isPanel      = (title: string) => /panneau/i.test(title)
const isExtPanel   = (title: string) => /extpanel|ext[_\s-]?panel/i.test(title)
const isAkupanel60 = (title: string) => /akupanel.{0,10}60/i.test(title)
const panelSlots   = (title: string, qty: number) => {
  if (isExtPanel(title))   return Math.ceil(qty / 4)
  if (isAkupanel60(title)) return Math.ceil(qty / 2)
  return qty
}

function computePanelCount(
  stop: { panel_count: number; panel_details?: { title?: string; qty?: number }[] }
): number {
  const details = stop.panel_details ?? []
  if (details.length > 0) {
    return details
      .filter((d) => isPanel(d.title ?? ''))
      .reduce((sum, d) => sum + panelSlots(d.title ?? '', d.qty ?? 0), 0)
  }
  // Fallback: no panel_details stored (very old stops) — use raw panel_count
  return stop.panel_count ?? 0
}

export async function GET() {
  try {
    const admin = getAdmin()

    // Requête lourde (toutes les tournées + tous les arrêts). Sous charge/incident
    // Supabase, PostgREST échoue par intermittence depuis Vercel → on RÉESSAIE
    // plutôt que de renvoyer une liste vide (qui faisait croire "plus de tournées").
    let tours: { delivery_stops?: unknown[] }[] | null = null
    let error: { message?: string } | null = null
    for (let attempt = 0; attempt < 4; attempt++) {
      const res = await admin
        .from('delivery_tours')
        .select('*, delivery_stops(*)')
        .eq('brand', 'bowa')
        .order('planned_date', { ascending: false })
      tours = res.data as { delivery_stops?: unknown[] }[] | null
      error = res.error
      if (!error && tours) break
      await new Promise((r) => setTimeout(r, 200 * (attempt + 1)))
    }

    if (error) throw error

    const result = (tours ?? []).map((tour) => {
      const rawStops = (tour.delivery_stops ?? []) as { panel_count: number; panel_details?: { title?: string; qty?: number }[] }[]
      // On RECALCULE le panel_count de chaque arrêt (exclut la feuille de pierre et
      // applique les slots extpanel/akupanel60) pour que la CARTE — qui somme les
      // panel_count par arrêt — affiche le même total que la LISTE (total_panels).
      const stops = rawStops.map((s) => ({ ...s, panel_count: computePanelCount(s) }))
      const total_panels = stops.reduce((sum: number, s) => sum + s.panel_count, 0)
      return {
        ...tour,
        stops,
        total_panels,
        delivery_stops: undefined,
      }
    })

    return NextResponse.json({ tours: result })
  } catch (err) {
    console.error('[delivery/tours GET]', err)
    const msg = err instanceof Error ? err.message : (err && typeof err === 'object' ? JSON.stringify(err) : String(err))
    return NextResponse.json({ tours: [], error: msg }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const { name, zone, driver_name, planned_date } = body as {
      name: string
      zone: string
      driver_name: string
      planned_date: string
    }

    const admin = getAdmin()
    const { data, error } = await admin
      .from('delivery_tours')
      .insert({ name, zone, driver_name: normalizeDriverName(driver_name), planned_date, brand: 'bowa' })
      .select()
      .single()

    if (error) throw error

    return NextResponse.json({ tour: data })
  } catch (err) {
    console.error('[delivery/tours POST]', err)
    const msg = err instanceof Error ? err.message : JSON.stringify(err)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
