// POST /api/sav-krom/process — classifie + génère le draft pour un thread Gmail

import { NextRequest, NextResponse } from 'next/server'
import { processOneThread } from '@/lib/sav-krom/orchestrator'

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  let body: {
    thread_id:     string
    subject:       string
    body:          string
    sender_email:  string
    sender_name:   string
    received_at:   string
    message_count: number
  }

  try { body = await req.json() }
  catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }

  if (!body.thread_id) {
    return NextResponse.json({ error: 'thread_id required' }, { status: 400 })
  }

  try {
    const result = await processOneThread(
      body.thread_id,
      body.subject,
      body.body,
      body.sender_email,
      body.sender_name,
      body.received_at,
      body.message_count,
    )
    return NextResponse.json(result)
  } catch (err) {
    console.error('[SAV-Krom] processOneThread error:', err)
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Unknown error' },
      { status: 500 }
    )
  }
}
