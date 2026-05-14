// POST /api/sav/import-history
// Fetches solved Zendesk tickets (1 page = ~100 tickets), extracts Q/A pairs, saves to Supabase.
// Call repeatedly until { done: true }.
// batch=1 page × ~100 tickets × ~0.15s/comment = ~15s → fits in 60s Vercel Hobby limit.

import { NextRequest, NextResponse } from 'next/server'
import { importHistoryBatch } from '@/lib/sav/history'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

async function runBatch(batchSize: number) {
  const result = await importHistoryBatch(batchSize)
  return NextResponse.json(result)
}

export async function GET(req: NextRequest) {
  const batch = parseInt(req.nextUrl.searchParams.get('batch') ?? '1', 10)
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
  const batch = parseInt(body?.batch ?? '1', 10)
  try { return await runBatch(batch) }
  catch (err) {
    console.error('[SAV] importHistoryBatch error:', err)
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Unknown error' },
      { status: 500 }
    )
  }
}
