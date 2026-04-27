// POST /api/sav/decide
// Body: { ticket_id, subject, description, category, order, customer_email, decision_key, decision_label, requester_id }
// Generates a reply based on the human decision chosen in the decision panel.

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
    decision_key:   string
    decision_label: string
    ticket_id?:     number
    requester_id?:  number
  }

  try { body = await req.json() }
  catch { return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 }) }

  const { subject, description, category, order, customer_email, decision_label, ticket_id, requester_id } = body

  if (!subject || !description || !category || !customer_email || !decision_label) {
    return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
  }

  let comments = undefined
  if (ticket_id) {
    try {
      comments = await getTicketComments(ticket_id, requester_id ?? 0)
      console.log(`[SAV] decide — #${ticket_id}: ${comments.length} commentaire(s) récupéré(s)`)
    } catch (err) {
      console.warn(`[SAV] decide — could not fetch comments for #${ticket_id}:`, err)
    }
  }

  try {
    const result = await generateReply(
      subject, description, category, order ?? null, customer_email, comments, decision_label
    )
    return NextResponse.json({ body: result.body, solved: result.solved, situation_detectee: result.situation_detectee })
  } catch (err) {
    console.error('[SAV] decide error:', err)
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Unknown error' },
      { status: 500 },
    )
  }
}
