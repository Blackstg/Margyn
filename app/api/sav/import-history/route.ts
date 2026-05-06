// POST /api/sav/import-history
// Fetches solved Zendesk tickets (batch of 10), extracts Q/A pairs, saves to Supabase.
// Call repeatedly until { done: true }.
// Batch size kept at 10 to stay within 60s Vercel Hobby function limit.

import { NextRequest, NextResponse } from 'next/server'
import { importHistoryBatch } from '@/lib/sav/history'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

async function runBatch(batchSize: number) {
  const result = await importHistoryBatch(batchSize)
  return NextResponse.json(result)
}

export async function GET(req: NextRequest) {
  const batch = parseInt(req.nextUrl.searchParams.get('batch') ?? '10', 10)
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
  const batch = parseInt(body?.batch ?? '10', 10)
  try { return await runBatch(batch) }
  catch (err) {
    console.error('[SAV] importHistoryBatch error:', err)
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Unknown error' },
      { status: 500 }
    )
  }
}
