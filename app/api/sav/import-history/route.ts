// POST /api/sav/import-history
// Fetches all solved Zendesk tickets, extracts Q/A pairs,
// saves them to lib/sav/history.json (or /tmp on Vercel).

import { NextRequest, NextResponse } from 'next/server'
import { importHistoryBatch } from '@/lib/sav/history'

export const dynamic = 'force-dynamic'
export const maxDuration = 120

// Each call imports one batch (~25 tickets) and saves cursor to DB.
// Call repeatedly until { done: true }.

async function runBatch(batchSize: number) {
  const result = await importHistoryBatch(batchSize)
  return NextResponse.json(result)
}

export async function GET(req: NextRequest) {
  const batch = parseInt(req.nextUrl.searchParams.get('batch') ?? '25', 10)
  try { return await runBatch(batch) }
  catch (err) {
    console.error('[SAV] importHistoryBatch error:', err)
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Unknown error' },
      { status: 500 }
    )
  }
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}))
  const batch = parseInt(body?.batch ?? '25', 10)
  try { return await runBatch(batch) }
  catch (err) {
    console.error('[SAV] importHistoryBatch error:', err)
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Unknown error' },
      { status: 500 }
    )
  }
}
