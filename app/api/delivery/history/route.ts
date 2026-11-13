// GET /api/delivery/history?order=%2310792
// Journal d'une commande (replanifiée, retirée, déplacée, notes…) + position GPS
// de chaque passage validé. Pour les passages antérieurs à la capture GPS au
// moment de la validation, on retrouve le point du livreur enregistré au même
// instant (l'app livreur l'envoie à chaque « livré / partiel / non livré »).
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

export const dynamic = 'force-dynamic'

const WINDOW_MS = 5 * 60_000

export async function GET(req: NextRequest) {
  const order = req.nextUrl.searchParams.get('order') ?? ''
  if (!order) return NextResponse.json({ error: 'order requis' }, { status: 400 })
  const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)

  const { data: events } = await admin
    .from('delivery_stop_events')
    .select('id, stop_id, tour_name, kind, status, comment, author, lat, lng, accuracy, created_at')
    .eq('order_name', order)
    .order('created_at', { ascending: true })

  const { data: stops } = await admin
    .from('delivery_stops')
    .select('*, delivery_tours(driver_name)')
    .eq('order_name', order)

  const positions: Record<string, { lat: number; lng: number; accuracy: number | null; at: string; source: 'validation' | 'suivi' }> = {}
  for (const s of (stops ?? []) as Record<string, unknown>[]) {
    const id = s.id as string
    if (typeof s.done_lat === 'number' && typeof s.done_lng === 'number') {
      positions[id] = { lat: s.done_lat, lng: s.done_lng, accuracy: (s.done_accuracy as number | null) ?? null, at: s.delivered_at as string, source: 'validation' }
      continue
    }
    const at = s.delivered_at as string | null
    if (!at || s.status === 'pending') continue
    const t = Date.parse(at)
    const { data: pts } = await admin
      .from('driver_locations')
      .select('driver_name, lat, lng, accuracy, recorded_at')
      .gte('recorded_at', new Date(t - WINDOW_MS).toISOString())
      .lte('recorded_at', new Date(t + WINDOW_MS).toISOString())
      .limit(200)
    // Livreur de la tournée (« Terence 2 » ↔ compte « Terence ») : on compare le prénom.
    const first = (v: unknown) => String(v ?? '').trim().split(/\s+/)[0]?.toLocaleLowerCase('fr-FR') ?? ''
    const driver = first((s.delivery_tours as { driver_name?: string } | null)?.driver_name ?? s.done_by)
    const candidates = (pts ?? []).filter((p) => !driver || first(p.driver_name) === driver)
    const best = candidates.sort((a, b) => Math.abs(Date.parse(a.recorded_at) - t) - Math.abs(Date.parse(b.recorded_at) - t))[0]
    if (best) positions[id] = { lat: best.lat, lng: best.lng, accuracy: best.accuracy ?? null, at: best.recorded_at, source: 'suivi' }
  }

  return NextResponse.json({ events: events ?? [], positions })
}
