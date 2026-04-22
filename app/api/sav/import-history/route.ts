// POST /api/sav/import-history
// Fetches all solved Zendesk tickets, extracts Q/A pairs,
// saves them to lib/sav/history.json (or /tmp on Vercel).

import { NextResponse } from 'next/server'
import { importHistory } from '@/lib/sav/history'

export const dynamic = 'force-dynamic'
// Zendesk can have hundreds of tickets — give the function enough time
export const maxDuration = 60

export async function POST() {
  try {
    const { count } = await importHistory()
    return NextResponse.json({ count })
  } catch (err) {
    console.error('[SAV] importHistory error:', err)
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Unknown error' },
      { status: 500 }
    )
  }
}
