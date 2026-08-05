// GET /api/sav/tickets  — return raw Zendesk ticket list (fast, no AI)
// POST /api/sav/tickets — same (for cron compatibility)

import { NextRequest, NextResponse } from 'next/server'
import { getRawTicketList } from '@/lib/sav/orchestrator'
import { savBrandFromRequest } from '@/lib/sav/brand'

export const dynamic = 'force-dynamic'

async function handle(req: NextRequest) {
  try {
    const tickets = await getRawTicketList(savBrandFromRequest(req))
    return NextResponse.json({ tickets, count: tickets.length })
  } catch (err) {
    console.error('[SAV] getRawTicketList error:', err)
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Unknown error' },
      { status: 500 },
    )
  }
}

export const GET  = handle
export const POST = handle
