// Traçabilité des arrêts de livraison : qui a fait quoi, quand, où.
// Tolère l'absence de la migration 032 (colonnes *_by / done_* / signed_at et table
// delivery_stop_events) : on n'empêche jamais un livreur de valider pour une trace.
import type { NextRequest } from 'next/server'
import { createServerClient } from '@supabase/auth-helpers-nextjs'
import type { SupabaseClient } from '@supabase/supabase-js'

export const TRACE_COLUMNS = ['comment_by', 'sav_note_by', 'done_by', 'done_lat', 'done_lng', 'done_accuracy', 'signed_at'] as const

export type Position = { lat: number; lng: number; accuracy?: number | null }

export function parsePosition(v: unknown): Position | null {
  const p = v as { lat?: unknown; lng?: unknown; accuracy?: unknown } | null
  if (!p || typeof p.lat !== 'number' || typeof p.lng !== 'number' || !isFinite(p.lat) || !isFinite(p.lng)) return null
  return { lat: p.lat, lng: p.lng, accuracy: typeof p.accuracy === 'number' ? Math.round(p.accuracy) : null }
}

// Nom de la personne connectée (livreur ou SAV), lu dans la session.
export async function callerName(req: NextRequest): Promise<string | null> {
  try {
    const sb = createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
      cookies: { getAll() { return req.cookies.getAll() }, setAll() { /* rafraîchi par le middleware */ } },
    })
    const { data: { user } } = await sb.auth.getUser()
    if (!user) return null
    const m = user.user_metadata ?? {}
    return String(m.full_name || m.name || user.email || '').trim() || null
  } catch { return null }
}

// Mise à jour d'un arrêt ; si la migration 032 n'est pas passée, on réessaie sans
// les colonnes de traçabilité.
export async function updateStop(admin: SupabaseClient, id: string, updates: Record<string, unknown>) {
  let res = await admin.from('delivery_stops').update(updates).eq('id', id).select().single()
  if (res.error && /column|schema cache/i.test(res.error.message)) {
    const base = Object.fromEntries(Object.entries(updates).filter(([k]) => !(TRACE_COLUMNS as readonly string[]).includes(k)))
    res = await admin.from('delivery_stops').update(base).eq('id', id).select().single()
  }
  return res
}

export type StopEvent = {
  stop_id?: string | null
  order_name: string
  tour_id?: string | null
  tour_name?: string | null
  kind: 'delivered' | 'partial' | 'failed' | 'already_delivered' | 'pending' | 'note_driver' | 'note_sav' | 'signature' | 'replanned' | 'removed' | 'moved'
  status?: string | null
  comment?: string | null
  author?: string | null
  position?: Position | null
}

export async function logStopEvents(admin: SupabaseClient, events: StopEvent[]) {
  if (!events.length) return
  const rows = events.map(({ position, ...e }) => ({ ...e, lat: position?.lat ?? null, lng: position?.lng ?? null, accuracy: position?.accuracy ?? null }))
  const { error } = await admin.from('delivery_stop_events').insert(rows)
  if (error) console.warn('[delivery_stop_events]', error.message)
}

export async function tourName(admin: SupabaseClient, tourId: string | null | undefined): Promise<string | null> {
  if (!tourId) return null
  const { data } = await admin.from('delivery_tours').select('name').eq('id', tourId).maybeSingle()
  return (data?.name as string | undefined) ?? null
}
