// Attribution des tickets SAV Mōom (qui répond : Satiana / Todi).
//   GET  → { assignments: { [ticket_id]: assignee } }
//   POST { ticket_id, assignee, updated_by }  → upsert (assignee null → désattribue)
import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase'

export const dynamic = 'force-dynamic'

export async function GET() {
  const sb = createAdminClient()
  const { data, error } = await sb.from('sav_assignments').select('ticket_id, assignee')
  if (error) return NextResponse.json({ assignments: {} }) // table peut ne pas exister encore
  const map: Record<number, string> = {}
  for (const r of data ?? []) if (r.assignee) map[r.ticket_id] = r.assignee
  return NextResponse.json({ assignments: map })
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({})) as { ticket_id?: number; assignee?: string | null; updated_by?: string }
  const ticket_id = Number(body.ticket_id)
  if (!ticket_id) return NextResponse.json({ error: 'ticket_id requis' }, { status: 400 })

  const sb = createAdminClient()
  const assignee = (body.assignee ?? '').toString().trim()
  if (assignee) {
    const { error } = await sb.from('sav_assignments').upsert(
      { ticket_id, assignee, updated_by: body.updated_by ?? null, updated_at: new Date().toISOString() },
      { onConflict: 'ticket_id' },
    )
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  } else {
    const { error } = await sb.from('sav_assignments').delete().eq('ticket_id', ticket_id)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  }
  return NextResponse.json({ ok: true })
}
