// POST /api/sav-krom/decide
// Body: { thread_id, subject, body, category, sender_email, decision_key, decision_label }
// Generates a reply based on the human decision chosen in the decision panel.

import { NextRequest, NextResponse } from 'next/server'
import { generateReply } from '@/lib/sav-krom/classifier'
import type { KromCategory } from '@/lib/sav-krom/classifier'
import { getThreadMessages } from '@/lib/sav-krom/gmail'

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  let body: {
    thread_id:      string
    subject:        string
    body:           string
    category:       KromCategory
    sender_email:   string
    decision_key:   string
    decision_label: string
  }

  try { body = await req.json() }
  catch { return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 }) }

  const { thread_id, subject, body: emailBody, category, sender_email, decision_label } = body

  if (!thread_id || !subject || !category || !sender_email || !decision_label) {
    return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
  }

  let messages = undefined
  try {
    messages = await getThreadMessages(thread_id)
    console.log(`[SAV-Krom] decide — ${thread_id}: ${messages.length} message(s) récupéré(s)`)
  } catch (err) {
    console.warn(`[SAV-Krom] decide — could not fetch messages for ${thread_id}:`, err)
  }

  try {
    const result = await generateReply(subject, emailBody, category, sender_email, messages, decision_label)
    return NextResponse.json({ body: result.body, solved: result.solved, situation_detectee: result.situation_detectee })
  } catch (err) {
    console.error('[SAV-Krom] decide error:', err)
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Unknown error' },
      { status: 500 },
    )
  }
}
