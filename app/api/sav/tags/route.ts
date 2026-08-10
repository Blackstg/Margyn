// Balises manuelles des tickets SAV (identification rapide du souci), scopées par marque.
//   GET  ?brand= → { tags: { [ticket_id]: tag } }
//   POST { ticket_id, tag } ?brand=  → upsert (tag vide/null = retire la balise)
import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase'
import { savBrandFromRequest } from '@/lib/sav/brand'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const sb = createAdminClient()
  const brand = savBrandFromRequest(req)
  const { data, error } = await sb.from('sav_ticket_tags').select('ticket_id, tag').eq('brand', brand)
  if (error) return NextResponse.json({ tags: {} }) // table peut ne pas exister encore
  const map: Record<number, string> = {}
  for (const r of data ?? []) if (r.tag) map[r.ticket_id] = r.tag
  return NextResponse.json({ tags: map })
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({})) as { ticket_id?: number; tag?: string | null }
  const ticket_id = Number(body.ticket_id)
  if (!ticket_id) return NextResponse.json({ error: 'ticket_id requis' }, { status: 400 })

  const sb = createAdminClient()
  const brand = savBrandFromRequest(req)
  const tag = (body.tag ?? '').toString().trim()

  if (tag) {
    const { error } = await sb
      .from('sav_ticket_tags')
      .upsert({ ticket_id, brand, tag, updated_at: new Date().toISOString() }, { onConflict: 'brand,ticket_id' })
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  } else {
    const { error } = await sb.from('sav_ticket_tags').delete().eq('ticket_id', ticket_id).eq('brand', brand)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  }
  return NextResponse.json({ ok: true })
}
