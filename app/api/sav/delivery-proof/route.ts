// GET /api/sav/delivery-proof?email=…&order=#1234  (l'un ou l'autre, ou les deux)
// Retourne la/les livraison(s) Bowa correspondantes (date+heure, statut, signature,
// photo) pour qu'un agent SAV ait la preuve de livraison en cas de plainte.
// La livraison est une feature Bowa uniquement (table delivery_stops, sans colonne brand).
import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase'

export const dynamic = 'force-dynamic'
export const fetchCache = 'force-no-store'

export async function GET(req: NextRequest) {
  const email = (req.nextUrl.searchParams.get('email') ?? '').trim()
  const order = (req.nextUrl.searchParams.get('order') ?? '').trim()
  if (!email && !order) return NextResponse.json({ stops: [] })

  try {
    const sb = createAdminClient()
    const base = () => sb
      .from('delivery_stops')
      .select('order_name, customer_name, delivered_at, status, signature_url, photo_url, address1, address2, zip, city, comment, phone, created_at')
      .order('created_at', { ascending: false })
      .limit(10)

    // Par email (exact, insensible à la casse) ET par n° de commande : le client écrit
    // parfois depuis une autre adresse que celle de la commande.
    const orderName = order ? (order.startsWith('#') ? order : `#${order}`) : ''
    // Séquentiel : en parallèle sur le même client, une requête peut revenir vide.
    const results = [
      email ? await base().ilike('email', email) : null,
      orderName ? await base().eq('order_name', orderName) : null,
    ]
    const err = results.find(r => r?.error)?.error
    if (err) return NextResponse.json({ stops: [], error: err.message }, { status: 500 })
    const seen = new Set<string>()
    const stops = results.flatMap(r => r?.data ?? [])
      .filter(s => { const k = `${s.order_name}|${s.created_at}`; if (seen.has(k)) return false; seen.add(k); return true })
      .sort((x, y) => String(y.created_at).localeCompare(String(x.created_at)))
    return NextResponse.json({ stops })
  } catch (err) {
    return NextResponse.json({ stops: [], error: String(err) }, { status: 500 })
  }
}
