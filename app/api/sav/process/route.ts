// POST /api/sav/process — classify + draft one ticket (AI, on-demand)

import { NextResponse } from 'next/server'
import { processOneTicket } from '@/lib/sav/orchestrator'

export const dynamic = 'force-dynamic'

export async function POST(req: Request) {
  try {
    const { ticket_id, subject, description, created_at, requester_id, status } =
      await req.json() as {
        ticket_id:    number
        subject:      string
        description:  string
        created_at:   string
        requester_id: number
        status?:      'new' | 'open' | 'pending'
      }

    const ticket = await processOneTicket(
      ticket_id,
      subject,
      description,
      created_at,
      requester_id,
      status ?? 'open',
    )
    return NextResponse.json(ticket)
  } catch (err) {
    console.error('[SAV] processOneTicket error:', err)
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Unknown error' },
      { status: 500 },
    )
  }
}
