// GET /api/sav/search?q=...  → recherche de tickets Zendesk (tous statuts), pour
// retrouver un ticket sans aller sur Zendesk (par n° commande, email, sujet, n° ticket).
import { NextRequest, NextResponse } from 'next/server'
import { searchTickets, getRequesterEmail } from '@/lib/sav/zendesk'
import { getOrderByNumber } from '@/lib/sav/shopify'
import { savBrandFromRequest } from '@/lib/sav/brand'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const q = (req.nextUrl.searchParams.get('q') ?? '').trim()
  if (q.length < 2) return NextResponse.json({ tickets: [] })
  const brand = savBrandFromRequest(req)

  try {
    // Si la requête est un n° de commande, on récupère AUSSI la commande Shopify —
    // pour la retrouver même quand aucun ticket n'existe (cas #10530 Bowa).
    const isNumber = /^#?\d{3,}$/.test(q)
    const [found, order] = await Promise.all([
      searchTickets(q, brand),
      isNumber ? getOrderByNumber(q, brand).catch(() => null) : Promise.resolve(null),
    ])

    const top = found.slice(0, 20)
    const emails = await Promise.all(
      top.map(t => getRequesterEmail(t.requester_id, brand).catch(() => '')),
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
    return NextResponse.json({ tickets, order })
  } catch (e) {
    return NextResponse.json({ tickets: [], error: e instanceof Error ? e.message : 'search failed' }, { status: 500 })
  }
}
