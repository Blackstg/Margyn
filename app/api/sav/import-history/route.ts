// POST /api/sav/import-history
// Fetches all solved Zendesk tickets, extracts Q/A pairs,
// saves them to lib/sav/history.json (or /tmp on Vercel).

import { NextResponse } from 'next/server'
import { importHistory } from '@/lib/sav/history'

export const dynamic = 'force-dynamic'
// Zendesk can have hundreds of tickets — give the function enough time
export const maxDuration = 300

async function runImport() {
  const { count, oldest, newest } = await importHistory()
  return NextResponse.json({ count, oldest, newest })
}

export async function GET() {
  try { return await runImport() }
  catch (err) {
    console.error('[SAV] importHistory error:', err)
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Unknown error' },
      { status: 500 }
    )
  }
}

export async function POST() {
  try { return await runImport() }
  catch (err) {
    console.error('[SAV] importHistory error:', err)
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Unknown error' },
      { status: 500 }
    )
  }
}
