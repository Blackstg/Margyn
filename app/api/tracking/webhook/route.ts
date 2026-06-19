// POST /api/tracking/webhook
// Reçoit les push 17Track (TRACKING_UPDATED…) et met à jour le cache carrier_tracking.
// À configurer dans le dashboard 17Track (API → WebHook) :
//   https://www.steero.io/api/tracking/webhook

import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase'
import { normalize } from '@/lib/track17'

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => null)
    const data = body?.data
    const number = data?.number
    if (!number) return NextResponse.json({ ok: true, skipped: true })

    const result = normalize(data)
    const admin = createAdminClient()
    const { data: row } = await admin.from('carrier_tracking').select('brand, order_name').eq('tracking_number', number).maybeSingle()

    await admin.from('carrier_tracking').upsert({
      tracking_number: number,
      brand:      row?.brand ?? null,
      order_name: row?.order_name ?? null,
      carrier:    result?.carrier_name ?? null,
      status:     result?.status ?? null,
      step:       result?.step ?? null,
      delivered:  result?.delivered ?? false,
      eta_from:   result?.eta_from ?? null,
      eta_to:     result?.eta_to ?? null,
      events:     result?.events ?? [],
      registered: true,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'tracking_number' })

    return NextResponse.json({ ok: true })
  } catch (e) {
    console.error('[tracking/webhook]', e)
    return NextResponse.json({ ok: false }, { status: 200 }) // 200 pour éviter les retries en boucle
  }
}
