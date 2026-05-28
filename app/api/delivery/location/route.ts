// POST /api/delivery/location   → enregistre une position GPS
// GET  /api/delivery/location?driver=Khalid&since=2026-05-29T00:00:00Z  → historique

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

export const dynamic = 'force-dynamic'

function getAdmin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const { driver_name, lat, lng, accuracy, battery } = body

    if (!driver_name || lat == null || lng == null) {
      return NextResponse.json({ error: 'driver_name, lat, lng requis' }, { status: 400 })
    }

    const admin = getAdmin()
    const { error } = await admin.from('driver_locations').insert({
      driver_name,
      lat,
      lng,
      accuracy:      accuracy ?? null,
      battery_level: battery  ?? null,
      recorded_at:   new Date().toISOString(),
    })

    if (error) throw error
    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error('[delivery/location POST]', err)
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}

export async function GET(req: NextRequest) {
  try {
    const driver = req.nextUrl.searchParams.get('driver') ?? ''
    const since  = req.nextUrl.searchParams.get('since')  ?? new Date(Date.now() - 24 * 3600_000).toISOString()

    if (!driver) {
      return NextResponse.json({ error: 'driver requis' }, { status: 400 })
    }

    const admin = getAdmin()
    const { data, error } = await admin
      .from('driver_locations')
      .select('id, lat, lng, accuracy, battery_level, recorded_at')
      .eq('driver_name', driver)
      .gte('recorded_at', since)
      .order('recorded_at', { ascending: true })

    if (error) throw error
    return NextResponse.json({ positions: data ?? [] })
  } catch (err) {
    console.error('[delivery/location GET]', err)
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
