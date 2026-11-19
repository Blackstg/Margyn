// POST /api/tracking/webhook
// Reçoit les push 17Track (TRACKING_UPDATED…) et met à jour le cache carrier_tracking.
// À configurer dans le dashboard 17Track (API → WebHook) :
//   https://www.steero.io/api/tracking/webhook

import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase'
import { normalize, mergeResults, type Track17Result } from '@/lib/track17'

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => null)
    const data = body?.data
    const number = data?.number
    if (!number) return NextResponse.json({ ok: true, skipped: true })

    const pushed = normalize(data)
    const admin = createAdminClient()
    const { data: row } = await admin.from('carrier_tracking').select('*').eq('tracking_number', number).maybeSingle()

    // Le numéro est suivi sur 2 transporteurs (YunExpress + transporteur final) et
    // chacun pousse ses propres events. On FUSIONNE avec l'existant au lieu d'écraser :
    // un push Colissimo/Colis Privé (« étiquette créée ») effaçait tout le trajet
    // YunExpress et le suivi client retombait sur « Commande en préparation ».
    const prior: Track17Result | null = row?.events?.length ? {
      status: row.status ?? 'NotFound', step: row.step ?? 2, delivered: !!row.delivered,
      carrier_name: row.carrier ?? null, eta_from: row.eta_from ?? null, eta_to: row.eta_to ?? null,
      events: row.events,
    } : null
    const result = mergeResults([pushed, prior].filter(Boolean) as Track17Result[]) ?? pushed

    await admin.from('carrier_tracking').upsert({
      tracking_number: number,
      brand:      row?.brand ?? null,
      order_name: row?.order_name ?? null,
      carrier:    result?.carrier_name ?? row?.carrier ?? null,
      status:     result?.status ?? row?.status ?? null,
      step:       result?.step ?? row?.step ?? null,
      delivered:  result?.delivered ?? row?.delivered ?? false,
      eta_from:   result?.eta_from ?? row?.eta_from ?? null,
      eta_to:     result?.eta_to ?? row?.eta_to ?? null,
      events:     result?.events ?? [],
      registered: true,
      // On ne rallonge PAS la fraîcheur du cache : un push ne concerne qu'un des
      // transporteurs, la page doit continuer à réinterroger les deux.
      updated_at: row?.updated_at ?? new Date(0).toISOString(),
    }, { onConflict: 'tracking_number' })

    return NextResponse.json({ ok: true })
  } catch (e) {
    console.error('[tracking/webhook]', e)
    return NextResponse.json({ ok: false }, { status: 200 }) // 200 pour éviter les retries en boucle
  }
}
