// Balises manuelles des tickets SAV (identification rapide du souci), scopées par
// marque. Multi-balises : une ligne par (brand, ticket_id, tag).
//   GET  ?brand= → { tags: { [ticket_id]: string[] } }
//   POST { ticket_id, tag, on } ?brand=  → ajoute (on=true) ou retire (on=false) une balise
import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase'
import { savBrandFromRequest } from '@/lib/sav/brand'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const sb = createAdminClient()
  const brand = savBrandFromRequest(req)
  const { data, error } = await sb.from('sav_ticket_tags').select('ticket_id, tag').eq('brand', brand)
  if (error) return NextResponse.json({ tags: {} }) // table peut ne pas exister encore
  const map: Record<number, string[]> = {}
  for (const r of data ?? []) {
    if (!r.tag) continue
    ;(map[r.ticket_id] ??= []).push(r.tag)
  }
  return NextResponse.json({ tags: map })
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({})) as { ticket_id?: number; tag?: string; on?: boolean }
  const ticket_id = Number(body.ticket_id)
  const tag = (body.tag ?? '').toString().trim()
  if (!ticket_id || !tag) return NextResponse.json({ error: 'ticket_id et tag requis' }, { status: 400 })

  const sb = createAdminClient()
  const brand = savBrandFromRequest(req)

  if (body.on === false) {
    const { error } = await sb.from('sav_ticket_tags')
      .delete().eq('brand', brand).eq('ticket_id', ticket_id).eq('tag', tag)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  } else {
    const { error } = await sb.from('sav_ticket_tags')
      .upsert({ ticket_id, brand, tag, updated_at: new Date().toISOString() }, { onConflict: 'brand,ticket_id,tag', ignoreDuplicates: true })
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  }
  return NextResponse.json({ ok: true })
}
