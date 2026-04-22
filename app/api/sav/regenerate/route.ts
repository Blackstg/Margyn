// POST /api/sav/regenerate
// Body: { subject, description, category, order, customer_email, ticket_id, requester_id }
// Re-runs generateReply() with fresh rules from DB and the full conversation thread.

import { NextRequest, NextResponse } from 'next/server'
import { generateReply } from '@/lib/sav/classifier'
import type { TicketCategory } from '@/lib/sav/classifier'
import type { MoomOrder } from '@/lib/sav/shopify'
import { getTicketComments } from '@/lib/sav/zendesk'

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  let body: {
    subject:        string
    description:    string
    category:       TicketCategory
    order:          MoomOrder | null
    customer_email: string
    ticket_id?:     number
    requester_id?:  number
  }

  try { body = await req.json() }
  catch { return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 }) }

  const { subject, description, category, order, customer_email, ticket_id, requester_id } = body

  if (!subject || !description || !category || !customer_email) {
    return NextResponse.json({ error: 'subject, description, category and customer_email are required' }, { status: 400 })
  }

  // Fetch the full conversation thread so Claude can answer the last client message
  let comments = undefined
  if (ticket_id) {
    try {
      comments = await getTicketComments(ticket_id, requester_id ?? 0)
      console.log(`[SAV] regenerate — #${ticket_id}: ${comments.length} commentaire(s) récupéré(s)`)
    } catch (err) {
      console.warn(`[SAV] regenerate — could not fetch comments for #${ticket_id}:`, err)
    }
  }

  try {
    const result = await generateReply(subject, description, category, order ?? null, customer_email, comments)
    return NextResponse.json({ body: result.body, solved: result.solved })
  } catch (err) {
    console.error('[SAV] regenerate error:', err)
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Unknown error' },
      { status: 500 }
    )
  }
}
