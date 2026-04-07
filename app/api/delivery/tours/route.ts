import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

function getAdmin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}

export async function GET() {
  try {
    const admin = getAdmin()

    const { data: tours, error } = await admin
      .from('delivery_tours')
      .select('*, delivery_stops(*)')
      .eq('brand', 'bowa')
      .order('planned_date', { ascending: false })

    if (error) throw error

    const result = (tours ?? []).map((tour) => {
      const stops = tour.delivery_stops ?? []
      const total_panels = stops.reduce(
        (sum: number, s: { panel_count: number }) => sum + (s.panel_count ?? 0),
        0
      )
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
    return NextResponse.json({ tours: [], error: String(err) }, { status: 500 })
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
      .insert({ name, zone, driver_name, planned_date, brand: 'bowa' })
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
