// GET /api/sav/customer-history?email=...&exclude=ticketId
// Returns all past tickets for a given customer email.

import { NextRequest, NextResponse } from 'next/server'
import { getCustomerTickets, getTicketComments } from '@/lib/sav/zendesk'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const email   = req.nextUrl.searchParams.get('email')?.trim()
  const exclude = parseInt(req.nextUrl.searchParams.get('exclude') ?? '0', 10) || undefined
  const withComments = req.nextUrl.searchParams.get('comments') === '1'

  if (!email) return NextResponse.json({ error: 'email requis' }, { status: 400 })

  try {
    const tickets = await getCustomerTickets(email, exclude)

    if (!withComments) return NextResponse.json({ tickets })

    // If comments=1, also fetch comments for the requested ticket id
    // (used when expanding a past ticket inline)
    const ticketId = parseInt(req.nextUrl.searchParams.get('ticket_id') ?? '0', 10)
    if (!ticketId) return NextResponse.json({ tickets })

    const comments = await getTicketComments(ticketId, 0)
    return NextResponse.json({ tickets, comments })
  } catch (err) {
    console.error('[SAV] customer-history error:', err)
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Unknown error' },
      { status: 500 },
    )
  }
}
