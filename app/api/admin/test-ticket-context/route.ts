// GET /api/admin/test-ticket-context?ticket_id=18429&secret=...
// Vérifie que la détection de référence et le fetch du contexte fonctionnent.
// Retourne : message du ticket, références détectées, contexte fetché.

import { NextRequest, NextResponse } from 'next/server'
import { getTicketComments, fetchTicketContext } from '@/lib/sav/zendesk'

export const dynamic = 'force-dynamic'

const TICKET_REF_RE = /#(\d{4,8})\b/g

function extractRefs(text: string): number[] {
  return [...new Set([...text.matchAll(TICKET_REF_RE)].map(m => parseInt(m[1], 10)))]
}

export async function GET(req: NextRequest) {
  const secret   = req.nextUrl.searchParams.get('secret')
  const ticketId = Number(req.nextUrl.searchParams.get('ticket_id'))

  if (!secret || secret !== process.env.SETUP_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  if (!ticketId) {
    return NextResponse.json({ error: 'ticket_id required' }, { status: 400 })
  }

  // ── 1. Fetch the ticket itself ──────────────────────────────────────────
  const zdBase  = `https://${process.env.ZENDESK_SUBDOMAIN}.zendesk.com/api/v2`
  const auth    = Buffer.from(`${process.env.ZENDESK_EMAIL}/token:${process.env.ZENDESK_API_TOKEN}`).toString('base64')
  const headers = { Authorization: `Basic ${auth}`, 'Content-Type': 'application/json' }

  const ticketRes = await fetch(`${zdBase}/tickets/${ticketId}.json`, { headers, cache: 'no-store' })
  if (!ticketRes.ok) {
    return NextResponse.json({ error: `Zendesk GET ticket ${ticketRes.status}` }, { status: 502 })
  }
  const { ticket } = await ticketRes.json() as {
    ticket: { id: number; subject: string; description: string; requester_id: number }
  }

  // ── 2. Fetch comments ───────────────────────────────────────────────────
  const comments = await getTicketComments(ticketId, ticket.requester_id).catch(() => [])

  // ── 3. Detect references ────────────────────────────────────────────────
  const commentBodies = comments.map(c => c.body).join('\n')
  const refText       = `${ticket.subject} ${ticket.description} ${commentBodies}`
  const refsInSubject = extractRefs(`${ticket.subject} ${ticket.description}`)
  const refsInComments = extractRefs(commentBodies)
  const allRefs        = extractRefs(refText)

  // ── 4. Fetch context for each reference ─────────────────────────────────
  const contexts: Record<number, string | null> = {}
  for (const refId of allRefs) {
    contexts[refId] = await fetchTicketContext(refId).catch(() => null)
  }

  return NextResponse.json({
    ticket: { id: ticketId, subject: ticket.subject },
    comments_count: comments.length,
    comments_preview: comments.map(c => ({
      author_type: c.author_type,
      body_excerpt: c.body.slice(0, 200),
      attachments: c.attachments?.length ?? 0,
    })),
    detection: {
      refs_in_subject_or_description: refsInSubject,
      refs_in_comments:               refsInComments,
      all_refs_detected:              allRefs,
    },
    fetched_contexts: Object.fromEntries(
      Object.entries(contexts).map(([id, ctx]) => [
        `#${id}`,
        ctx ? ctx.slice(0, 600) + (ctx.length > 600 ? '…' : '') : null,
      ])
    ),
  })
}
