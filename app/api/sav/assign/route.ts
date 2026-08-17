// Attribution des tickets SAV (qui répond), scopée par marque.
//   GET  ?brand= → { assignments: { [ticket_id]: assignee } }
//   POST { ticket_id, assignee, updated_by, claim } ?brand=  → upsert / claim / désattribue
import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase'
import { savBrandFromRequest } from '@/lib/sav/brand'

export const dynamic = 'force-dynamic'

// Upsert résilient : tente la clé composite (brand,ticket_id) ; si elle n'est pas
// encore migrée, repli sur l'ancienne clé ticket_id (Moom garde son attribution).
async function upsertAssign(
  sb: ReturnType<typeof createAdminClient>,
  row: Record<string, unknown>,
  ignoreDuplicates: boolean,
): Promise<{ error: { message: string } | null }> {
  const { error } = await sb.from('sav_assignments').upsert(row, { onConflict: 'brand,ticket_id', ignoreDuplicates })
  if (error && /no unique|exclusion|constraint|conflict/i.test(error.message)) {
    return await sb.from('sav_assignments').upsert(row, { onConflict: 'ticket_id', ignoreDuplicates })
  }
  return { error }
}

export async function GET(req: NextRequest) {
  const sb = createAdminClient()
  const brand = savBrandFromRequest(req)
  // On tente de récupérer aussi qui a affecté (updated_by) et quand (updated_at).
  // Repli sur la sélection minimale si ces colonnes n'existent pas encore.
  type Row = { ticket_id: number; assignee: string | null; updated_by?: string | null; updated_at?: string | null }
  const full = await sb.from('sav_assignments').select('ticket_id, assignee, updated_by, updated_at').eq('brand', brand)
  let rows: Row[] = []
  if (full.error) {
    const min = await sb.from('sav_assignments').select('ticket_id, assignee').eq('brand', brand)
    if (min.error) return NextResponse.json({ assignments: {}, meta: {} })
    rows = (min.data ?? []) as Row[]
  } else {
    rows = (full.data ?? []) as Row[]
  }
  const map: Record<number, string> = {}
  const meta: Record<number, { by: string | null; at: string | null }> = {}
  for (const r of rows) {
    if (r.assignee) map[r.ticket_id] = r.assignee
    meta[r.ticket_id] = { by: r.updated_by ?? null, at: r.updated_at ?? null }
  }
  return NextResponse.json({ assignments: map, meta })
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({})) as { ticket_id?: number; assignee?: string | null; updated_by?: string; claim?: boolean }
  const ticket_id = Number(body.ticket_id)
  if (!ticket_id) return NextResponse.json({ error: 'ticket_id requis' }, { status: 400 })

  const sb = createAdminClient()
  const brand = savBrandFromRequest(req)
  const assignee = (body.assignee ?? '').toString().trim()

  // Mode « claim » : revendication à l'ouverture — n'attribue QUE si non déjà pris.
  if (body.claim && assignee) {
    await upsertAssign(sb, { ticket_id, brand, assignee, updated_by: body.updated_by ?? null, updated_at: new Date().toISOString() }, true)
    const { data: row } = await sb.from('sav_assignments').select('assignee').eq('ticket_id', ticket_id).eq('brand', brand).maybeSingle()
    return NextResponse.json({ ok: true, assignee: (row?.assignee ?? assignee) })
  }

  if (assignee) {
    const { error } = await upsertAssign(sb, { ticket_id, brand, assignee, updated_by: body.updated_by ?? null, updated_at: new Date().toISOString() }, false)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  } else {
    const { error } = await sb.from('sav_assignments').delete().eq('ticket_id', ticket_id).eq('brand', brand)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  }
  return NextResponse.json({ ok: true })
}
