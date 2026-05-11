// GET  /api/delivery/deferred-orders       — list all deferred orders
// POST /api/delivery/deferred-orders       — defer an order  { order_name, deferred_until?, note? }
// DELETE /api/delivery/deferred-orders     — undefer an order  { order_name }

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

function getAdmin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}

export async function GET() {
  const admin = getAdmin()
  const { data, error } = await admin
    .from('delivery_deferred_orders')
    .select('order_name, deferred_until, note, created_at')
    .order('created_at', { ascending: false })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ deferred: data ?? [] })
}

export async function POST(req: NextRequest) {
  const { order_name, deferred_until, note } = await req.json() as {
    order_name: string
    deferred_until?: string | null
    note?: string | null
  }
  if (!order_name) return NextResponse.json({ error: 'order_name required' }, { status: 400 })

  const admin = getAdmin()
  const { error } = await admin
    .from('delivery_deferred_orders')
    .upsert(
      { order_name, deferred_until: deferred_until || null, note: note || null },
      { onConflict: 'order_name' }
    )

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}

export async function DELETE(req: NextRequest) {
  const { order_name } = await req.json() as { order_name: string }
  if (!order_name) return NextResponse.json({ error: 'order_name required' }, { status: 400 })

  const admin = getAdmin()
  const { error } = await admin
    .from('delivery_deferred_orders')
    .delete()
    .eq('order_name', order_name)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
