import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

function getAdmin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}

interface ShopifyOrderSummary {
  order_name: string
  shopify_order_id: string
  customer_name: string
  email: string
  phone?: string
  address1: string
  address2?: string
  city: string
  zip: string
  zone: 'nord' | 'sud'
  panel_count: number
  panel_details: { sku: string; title: string; qty: number }[]
}

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const { stops } = (await req.json()) as { stops: ShopifyOrderSummary[] }
    const admin = getAdmin()

    // Get existing stops for this tour (sequence + order_name)
    const { data: existingStops } = await admin
      .from('delivery_stops')
      .select('sequence, order_name')
      .eq('tour_id', params.id)
      .order('sequence', { ascending: false })

    const existingOrderNames = new Set((existingStops ?? []).map((s: { order_name: string }) => s.order_name))
    const maxSeq = existingStops?.[0]?.sequence ?? -1

    const newStops = stops.filter((s) => !existingOrderNames.has(s.order_name))
    if (newStops.length === 0) return NextResponse.json({ added: 0 })

    const rows = newStops.map((s, i) => ({
      tour_id: params.id,
      order_name: s.order_name,
      shopify_order_id: s.shopify_order_id,
      customer_name: s.customer_name,
      email: s.email,
      phone: s.phone ?? '',
      address1: s.address1,
      address2: s.address2 ?? '',
      city: s.city,
      zip: s.zip,
      zone: s.zone,
      panel_count: s.panel_count,
      panel_details: s.panel_details,
      sequence: maxSeq + 1 + i,
    }))

    const { error } = await admin.from('delivery_stops').insert(rows)
    if (error) throw error

    return NextResponse.json({ added: rows.length, skipped: stops.length - rows.length })
  } catch (err) {
    console.error('[delivery/tours/:id/stops POST]', err)
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
