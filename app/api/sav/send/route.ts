// POST /api/sav/send
// Body: { ticket_id: number, reply_body: string, solved: boolean, action: 'auto_reply' | 'escalate' }
// Sends a validated (human-approved) reply to a Zendesk ticket.

import { NextRequest, NextResponse } from 'next/server'
import { sendValidatedReply, markTicketProcessed } from '@/lib/sav/orchestrator'
import type { ReplyAction } from '@/lib/sav/classifier'
import { getBonRetourToken } from '@/lib/sav/bon-retour'

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  let body: {
    ticket_id:  number
    reply_body: string
    solved:     boolean
    action:     ReplyAction
    category?:  string
    uploads?:   string[]
  }

  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const { ticket_id, reply_body, solved, action, category, uploads = [] } = body

  if (!ticket_id || !action) {
    return NextResponse.json({ error: 'ticket_id and action are required' }, { status: 400 })
  }

  if (action === 'auto_reply' && !reply_body) {
    return NextResponse.json({ error: 'reply_body is required for auto_reply action' }, { status: 400 })
  }

  try {
    // Joindre automatiquement le bon de retour PDF pour les tickets retour/remb.
    const allUploads = [...uploads]
    if (category === 'retour_remboursement') {
      try {
        const bonRetourToken = await getBonRetourToken()
        allUploads.push(bonRetourToken)
        console.log(`[SAV] Bon de retour joint automatiquement (ticket #${ticket_id})`)
      } catch (err) {
        // Non-bloquant : on envoie quand même sans le PDF
        console.error('[SAV] Impossible de joindre le bon de retour:', err)
      }
    }

    await sendValidatedReply(ticket_id, reply_body, solved ?? false, action, allUploads)
    // Persist so this ticket is excluded from future fetches
    await markTicketProcessed(ticket_id, action === 'escalate' ? 'escalated' : 'sent')
    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error('[SAV] sendValidatedReply error:', err)
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Unknown error' },
      { status: 500 },
    )
  }
}
