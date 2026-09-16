// GET /api/sav/delivery-proof?email=…  (ou &order=#1234)
// Retourne la/les livraison(s) Bowa correspondantes (date+heure, statut, signature,
// photo) pour qu'un agent SAV ait la preuve de livraison en cas de plainte.
// La livraison est une feature Bowa uniquement (table delivery_stops, sans colonne brand).
import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const email = (req.nextUrl.searchParams.get('email') ?? '').trim()
  const order = (req.nextUrl.searchParams.get('order') ?? '').trim()
  if (!email && !order) return NextResponse.json({ stops: [] })

  try {
    const sb = createAdminClient()
    let q = sb
      .from('delivery_stops')
      .select('order_name, customer_name, delivered_at, status, signature_url, photo_url, address1, address2, zip, city, comment, phone, created_at')
      .order('created_at', { ascending: false })
      .limit(10)

    if (email) q = q.ilike('email', email)     // exact insensible à la casse
    else if (order) q = q.eq('order_name', order)

    const { data, error } = await q
    if (error) return NextResponse.json({ stops: [], error: error.message }, { status: 500 })
    return NextResponse.json({ stops: data ?? [] })
  } catch (err) {
    return NextResponse.json({ stops: [], error: String(err) }, { status: 500 })
  }
}
