import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { normalizeDriverName } from '@/lib/delivery/driver'

export const dynamic = 'force-dynamic'

function getAdmin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  )
}

// POST /api/delivery/tours/[id]/split
// body: { parts: [{ driver_name, stop_ids: string[] }, ...] }
// → crée UNE nouvelle tournée par part (relais), y déplace ses arrêts, assigne le
//   chauffeur. La tournée d'origine conserve ce qui n'est pas réparti (ex. arrêts
//   déjà livrés). Cas d'usage : un camion casse, on répartit le reste sur N chauffeurs.
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const body = await req.json().catch(() => ({}))
    const parts = Array.isArray(body?.parts) ? body.parts : []
    if (parts.length < 2) {
      return NextResponse.json({ error: 'Au moins 2 parts requises' }, { status: 400 })
    }

    const admin = getAdmin()
    const { data: tour, error: tErr } = await admin
      .from('delivery_tours')
      .select('name, zone, brand, planned_date')
      .eq('id', params.id)
      .single()
    if (tErr || !tour) throw tErr ?? new Error('tournée introuvable')

    const created: { id: string; name: string; driver_name: string; stops: number }[] = []

    for (let i = 0; i < parts.length; i++) {
      const p = parts[i] as { driver_name?: string; stop_ids?: string[] }
      const stopIds = Array.isArray(p?.stop_ids) ? p.stop_ids.filter(Boolean) : []
      const driver  = normalizeDriverName(String(p?.driver_name ?? '').trim())
      if (stopIds.length === 0) continue

      // Nouvelle tournée (même date/zone/marque), nommée « … — relais N (Chauffeur) »
      const { data: newTour, error: cErr } = await admin
        .from('delivery_tours')
        .insert({
          brand:        tour.brand,
          name:         `${tour.name} — relais ${i + 1}${driver ? ` (${driver})` : ''}`,
          zone:         tour.zone,
          driver_name:  driver || null,
          planned_date: tour.planned_date,
          status:       'planned',
        })
        .select('id, name, driver_name')
        .single()
      if (cErr || !newTour) throw cErr ?? new Error('création tournée échouée')

      // Déplace les arrêts (réordonnés 0..n) vers la nouvelle tournée.
      let seq = 0
      for (const sid of stopIds) {
        await admin.from('delivery_stops')
          .update({ tour_id: newTour.id, sequence: seq++ })
          .eq('id', sid)
          .eq('tour_id', params.id)   // garde-fou : on ne déplace que des arrêts de CETTE tournée
      }

      created.push({ id: newTour.id, name: newTour.name, driver_name: newTour.driver_name ?? '', stops: stopIds.length })
    }

    return NextResponse.json({ tours: created })
  } catch (err) {
    console.error('[delivery/tours/:id/split]', err)
    const msg = err instanceof Error ? err.message : JSON.stringify(err)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
