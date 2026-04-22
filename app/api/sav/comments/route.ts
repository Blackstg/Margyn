// GET /api/sav/comments?ticket_id=xxx&requester_id=xxx
// Returns all public comments for a ticket with author type (client / agent).

import { NextRequest, NextResponse } from 'next/server'
import { getTicketComments } from '@/lib/sav/zendesk'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const params      = req.nextUrl.searchParams
  const ticketId    = Number(params.get('ticket_id'))
  const requesterId = Number(params.get('requester_id') ?? 0)

  if (!ticketId) {
    return NextResponse.json(
      { error: 'ticket_id is required' },
      { status: 400 }
    )
  }

  console.log(`[SAV] GET /api/sav/comments — ticket_id=${ticketId} requester_id=${requesterId}`)

  try {
    const comments = await getTicketComments(ticketId, requesterId)
    console.log(`[SAV] GET /api/sav/comments — #${ticketId}: returning ${comments.length} comment(s)`)
    if (comments.length === 0) {
      console.warn(`[SAV] GET /api/sav/comments — #${ticketId}: 0 comments returned — requester_id=${requesterId}`)
    }
    return NextResponse.json({ comments })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error(`[SAV] GET /api/sav/comments — #${ticketId} FAILED: ${msg}`)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
