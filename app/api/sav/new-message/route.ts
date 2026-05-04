// POST /api/sav/new-message
// Creates a new outbound Zendesk ticket — sends an email to a customer
// without requiring an existing ticket.

import { NextRequest, NextResponse } from 'next/server'
import { createOutboundTicket } from '@/lib/sav/zendesk'

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  try {
    const { to_email, subject, body } = await req.json() as {
      to_email: string
      subject:  string
      body:     string
    }

    if (!to_email || !subject || !body) {
      return NextResponse.json({ error: 'to_email, subject et body sont requis' }, { status: 400 })
    }

    const ticketId = await createOutboundTicket(to_email.trim(), subject.trim(), body.trim())
    return NextResponse.json({ ticket_id: ticketId })
  } catch (err) {
    console.error('[SAV] new-message error:', err)
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Unknown error' },
      { status: 500 },
    )
  }
}
