// POST /api/sav-krom/send — envoie la réponse validée par email (Gmail)

import { NextRequest, NextResponse } from 'next/server'
import { sendValidatedReply, markThreadProcessed, logKromAction } from '@/lib/sav-krom/orchestrator'

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  let body: {
    thread_id:         string
    to_email:          string
    subject:           string
    reply_body:        string
    was_modified?:     boolean
    category?:         string
    confidence?:       number
    time_to_action_ms?: number
  }

  try { body = await req.json() }
  catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }

  const { thread_id, to_email, subject, reply_body } = body
  if (!thread_id || !to_email || !reply_body) {
    return NextResponse.json({ error: 'thread_id, to_email, reply_body required' }, { status: 400 })
  }

  try {
    await sendValidatedReply(thread_id, to_email, subject ?? '(sans objet)', reply_body)
    await Promise.all([
      markThreadProcessed(thread_id, 'sent'),
      logKromAction({
        thread_id,
        action:            'sent',
        was_modified:      body.was_modified ?? null,
        category:          body.category ?? null,
        confidence:        body.confidence ?? null,
        time_to_action_ms: body.time_to_action_ms ?? null,
      }),
    ])
    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error('[SAV-Krom] send error:', err)
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Unknown error' },
      { status: 500 }
    )
  }
}
