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
  lat?: number | null
  lng?: number | null
}

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const { stops } = (await req.json()) as { stops: ShopifyOrderSummary[] }
    const admin = getAdmin()

    // Get existing stops for this tour (sequence + order_name + status)
    const { data: existingStops } = await admin
      .from('delivery_stops')
      .select('id, sequence, order_name, status')
      .eq('tour_id', params.id)
      .order('sequence', { ascending: false })

    const existingByName = new Map(
      (existingStops ?? []).map((s: { id: string; order_name: string; status: string }) => [s.order_name, s])
    )
    const maxSeq = existingStops?.[0]?.sequence ?? -1

    // Ré-ajouter une commande déjà présente MAIS échouée/partielle = la REPLANIFIER :
    // on remet l'arrêt en 'pending' (efface l'échec) au lieu d'ignorer l'ajout, sinon
    // elle resterait signalée « à replanifier » à gauche malgré sa présence dans la tournée.
    const toReplan = stops
      .map((s) => existingByName.get(s.order_name))
      .filter((s): s is { id: string; order_name: string; status: string } => !!s && (s.status === 'failed' || s.status === 'partial'))
    for (const s of toReplan) {
      // Nouvelle tentative → on repart de zéro : la réponse du client (présent/absent)
      // ET l'envoi du mail sont réinitialisés, sinon un ancien « Présent » resterait
      // affiché alors qu'on n'a pas encore re-sollicité le client pour cette tentative.
      await admin.from('delivery_stops')
        .update({ status: 'pending', comment: null, delivered_at: null, client_availability: null, email_sent_at: null })
        .eq('id', s.id)
    }

    const newStops = stops.filter((s) => !existingByName.has(s.order_name))
    if (newStops.length === 0) return NextResponse.json({ added: 0, replanned: toReplan.length })

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
      lat: typeof s.lat === 'number' ? s.lat : null,
      lng: typeof s.lng === 'number' ? s.lng : null,
      sequence: maxSeq + 1 + i,
    }))

    let { error } = await admin.from('delivery_stops').insert(rows)
    // Si les colonnes lat/lng n'existent pas encore (migration non appliquée),
    // on ré-insère sans elles pour ne jamais casser la création d'arrêts.
    if (error && /lat|lng|column/i.test(error.message)) {
      const rowsNoCoord = rows.map(({ lat, lng, ...r }) => r) // eslint-disable-line @typescript-eslint/no-unused-vars
      ;({ error } = await admin.from('delivery_stops').insert(rowsNoCoord))
    }
    if (error) throw error

    return NextResponse.json({ added: rows.length, replanned: toReplan.length, skipped: stops.length - rows.length - toReplan.length })
  } catch (err) {
    console.error('[delivery/tours/:id/stops POST]', err)
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
