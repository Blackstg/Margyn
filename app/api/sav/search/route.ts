// GET /api/sav/search?q=...  → recherche de tickets Zendesk (tous statuts), pour
// retrouver un ticket sans aller sur Zendesk (par n° commande, email, sujet, n° ticket).
import { NextRequest, NextResponse } from 'next/server'
import { searchTickets, getRequesterEmail } from '@/lib/sav/zendesk'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const q = (req.nextUrl.searchParams.get('q') ?? '').trim()
  if (q.length < 2) return NextResponse.json({ tickets: [] })

  try {
    const found = await searchTickets(q)
    // Email du demandeur (best-effort, en parallèle borné) pour l'affichage.
    const top = found.slice(0, 20)
    const emails = await Promise.all(
      top.map(t => getRequesterEmail(t.requester_id).catch(() => '')),
    )
    const tickets = top.map((t, i) => ({
      ticket_id:      t.id,
      subject:        t.subject,
      description:    t.description ?? '',
      status:         t.status,
      requester_id:   t.requester_id,
      requester_email: emails[i],
      created_at:     t.created_at,
      updated_at:     t.updated_at,
    }))
    return NextResponse.json({ tickets })
  } catch (e) {
    return NextResponse.json({ tickets: [], error: e instanceof Error ? e.message : 'search failed' }, { status: 500 })
  }
}
