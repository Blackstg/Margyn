// POST /api/sav-krom/archive — archive le thread Gmail sans répondre

import { NextRequest, NextResponse } from 'next/server'
import { archiveThread, markThreadProcessed, logKromAction } from '@/lib/sav-krom/orchestrator'

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  let body: { thread_id: string; category?: string; confidence?: number; time_to_action_ms?: number }

  try { body = await req.json() }
  catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }

  if (!body.thread_id) {
    return NextResponse.json({ error: 'thread_id required' }, { status: 400 })
  }

  try {
    await archiveThread(body.thread_id)
    await Promise.all([
      markThreadProcessed(body.thread_id, 'archived'),
      logKromAction({
        thread_id:         body.thread_id,
        action:            'archived',
        was_modified:      null,
        category:          body.category ?? null,
        confidence:        body.confidence ?? null,
        time_to_action_ms: body.time_to_action_ms ?? null,
      }),
    ])
    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error('[SAV-Krom] archive error:', err)
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Unknown error' },
      { status: 500 }
    )
  }
}
