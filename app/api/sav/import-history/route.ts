// POST /api/sav/import-history
// Fetches all solved Zendesk tickets, extracts Q/A pairs,
// saves them to lib/sav/history.json (or /tmp on Vercel).

import { NextRequest, NextResponse } from 'next/server'
import { importHistory } from '@/lib/sav/history'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

async function runImport(limit: number) {
  const { count, oldest, newest } = await importHistory(limit)
  return NextResponse.json({ count, oldest, newest, limit })
}

export async function GET(req: NextRequest) {
  const limit = parseInt(req.nextUrl.searchParams.get('limit') ?? '50', 10)
  try { return await runImport(limit) }
  catch (err) {
    console.error('[SAV] importHistory error:', err)
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Unknown error' },
      { status: 500 }
    )
  }
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}))
  const limit = parseInt(body?.limit ?? '50', 10)
  try { return await runImport(limit) }
  catch (err) {
    console.error('[SAV] importHistory error:', err)
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Unknown error' },
      { status: 500 }
    )
  }
}
