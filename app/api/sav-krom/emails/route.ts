// GET /api/sav-krom/emails — liste les threads Gmail non traités (pas d'IA)

import { NextResponse } from 'next/server'
import { getRawThreadList } from '@/lib/sav-krom/orchestrator'

export const dynamic = 'force-dynamic'

async function handle() {
  try {
    const threads = await getRawThreadList()
    return NextResponse.json({ threads, count: threads.length })
  } catch (err) {
    console.error('[SAV-Krom] getRawThreadList error:', err)
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Unknown error' },
      { status: 500 }
    )
  }
}

export const GET  = handle
export const POST = handle
