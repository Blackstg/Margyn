import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

function getAdmin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const body = await req.json()
    const { name, zone, driver_name, planned_date, status, started_at, completed_at, total_km } = body as {
      name?: string
      zone?: string
      driver_name?: string
      planned_date?: string
      status?: string
      started_at?: string
      completed_at?: string
      total_km?: number
    }

    const updates: Record<string, unknown> = { updated_at: new Date().toISOString() }
    if (name !== undefined) updates.name = name
    if (zone !== undefined) updates.zone = zone
    if (driver_name !== undefined) updates.driver_name = driver_name
    if (planned_date !== undefined) updates.planned_date = planned_date
    if (status !== undefined) updates.status = status
    if (started_at !== undefined) updates.started_at = started_at
    if (completed_at !== undefined) updates.completed_at = completed_at
    if (total_km !== undefined) updates.total_km = total_km

    const admin = getAdmin()
    const { data, error } = await admin
      .from('delivery_tours')
      .update(updates)
      .eq('id', params.id)
      .select()
      .single()

    if (error) throw error

    return NextResponse.json({ tour: data })
  } catch (err) {
    console.error('[delivery/tours/:id PATCH]', err)
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const admin = getAdmin()
    const { error } = await admin
      .from('delivery_tours')
      .delete()
      .eq('id', params.id)

    if (error) throw error

    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error('[delivery/tours/:id DELETE]', err)
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
