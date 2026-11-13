import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { autoPlan, type PlanOrder, type PlanTour } from '@/lib/delivery/autoplan'
import { callerName } from '@/lib/delivery/trace'

export const dynamic = 'force-dynamic'

// Propositions de planification (rien n'est écrit). Le client envoie les commandes
// « à planifier » qu'il a déjà chargées ; on lit ici l'historique des tournées.
export async function POST(req: NextRequest) {
  if (!(await callerName(req))) return NextResponse.json({ error: 'Non connecté' }, { status: 401 })
  try {
    const { orders } = (await req.json()) as { orders: PlanOrder[] }
    const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
    const since = new Date(Date.now() - 90 * 864e5).toISOString().slice(0, 10)

    const { data: tours, error } = await admin
      .from('delivery_tours')
      .select('id, name, driver_name, planned_date, status')
      .eq('brand', 'bowa')
      .or(`status.neq.completed,planned_date.gte.${since}`)
    if (error) throw error

    const ids = (tours ?? []).map((t) => t.id as string)
    const stops: { tour_id: string; lat: number | null; lng: number | null; panel_count: number; sequence: number; delivered_at: string | null }[] = []
    for (let i = 0; i < ids.length; i += 100) {
      const { data, error: e } = await admin
        .from('delivery_stops')
        .select('tour_id, lat, lng, panel_count, sequence, delivered_at')
        .in('tour_id', ids.slice(i, i + 100))
      if (e) throw e
      stops.push(...(data ?? []))
    }

    const planTours: PlanTour[] = (tours ?? []).map((t) => ({
      id: t.id, name: t.name, driver_name: t.driver_name ?? '', planned_date: t.planned_date, status: t.status,
      stops: stops.filter((s) => s.tour_id === t.id).map((s) => ({ ...s, lat: s.lat ?? undefined, lng: s.lng ?? undefined })),
    }))

    return NextResponse.json(autoPlan({ orders: orders ?? [], tours: planTours }))
  } catch (err) {
    console.error('[delivery/autoplan]', err)
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 })
  }
}
