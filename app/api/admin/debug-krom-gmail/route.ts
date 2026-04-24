// GET /api/admin/debug-krom-gmail — teste la connexion Gmail Krom + pipeline complet

import { NextResponse } from 'next/server'
import { getRawThreadList } from '@/lib/sav-krom/orchestrator'

export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    const threads = await getRawThreadList()
    return NextResponse.json({ ok: true, count: threads.length, threads })
  } catch (err) {
    return NextResponse.json({
      ok: false,
      error: err instanceof Error ? err.message : String(err),
      stack: err instanceof Error ? err.stack : undefined,
    }, { status: 500 })
  }
}
