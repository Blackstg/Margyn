// POST /api/sav/archive
// Body: { ticket_id: number }
// Closes the Zendesk ticket as solved without posting any public reply,
// then marks it as processed in Supabase so it won't reappear.

import { NextRequest, NextResponse } from 'next/server'
import { archiveTicket } from '@/lib/sav/zendesk'
import { markTicketProcessed } from '@/lib/sav/orchestrator'

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  let body: { ticket_id?: number }
  try { body = await req.json() }
  catch { return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 }) }

  const { ticket_id } = body
  if (!ticket_id) {
    return NextResponse.json({ error: 'ticket_id is required' }, { status: 400 })
  }

  try {
    await archiveTicket(ticket_id)
    await markTicketProcessed(ticket_id, 'archived')
    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error('[SAV] archiveTicket error:', err)
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Unknown error' },
      { status: 500 }
    )
  }
}
