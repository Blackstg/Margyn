// ─── SAV Orchestrator — Mōom ──────────────────────────────────────────────────
// Ties together Zendesk + Shopify + Claude classifier/reply generator.
// Two modes:
//   - Semi-auto (default): classify + draft reply, return for human validation
//   - Auto: classify + draft + post reply immediately (for high-confidence auto_reply)

import { getNewTickets, getRequesterEmail, postReply, escalateTicket, tagTicket } from './zendesk'
import { getMostRecentOrder } from './shopify'
import { classifyTicket, generateReply, detectPhishing } from './classifier'
import type { TicketCategory, ReplyAction } from './classifier'
import type { MoomOrder } from './shopify'
import { createAdminClient } from '@/lib/supabase'

// ─── Raw ticket (fast list, no AI) ───────────────────────────────────────────

export interface RawTicketItem {
  ticket_id:    number
  subject:      string
  description:  string
  created_at:   string
  status:       'new' | 'open' | 'pending'
  requester_id: number
}

export async function getRawTicketList(): Promise<RawTicketItem[]> {
  const [tickets, processedIds] = await Promise.all([getNewTickets(), getProcessedIds()])
  const fresh = tickets.filter(t => !processedIds.has(t.id))
  return fresh.map(t => ({
    ticket_id:    t.id,
    subject:      t.subject,
    description:  t.description,
    created_at:   t.created_at,
    status:       t.status as 'new' | 'open' | 'pending',
    requester_id: t.requester_id,
  }))
}

// ─── Processed tickets filter ─────────────────────────────────────────────────
// Fetches ticket IDs that were already handled via Steero (persisted in DB).
// Falls back to an empty set if the table doesn't exist yet.

async function getProcessedIds(): Promise<Set<number>> {
  try {
    const sb = createAdminClient()
    const { data, error } = await sb
      .from('sav_processed_tickets')
      .select('ticket_id')
    if (error) return new Set()
    return new Set((data as { ticket_id: number }[]).map(r => r.ticket_id))
  } catch {
    return new Set()
  }
}

export async function markTicketProcessed(
  ticketId: number,
  action:   'sent' | 'escalated' | 'archived',
): Promise<void> {
  try {
    const sb = createAdminClient()
    await sb.from('sav_processed_tickets').upsert(
      { ticket_id: ticketId, action },
      { onConflict: 'ticket_id' }
    )
  } catch (err) {
    console.error('[SAV] markTicketProcessed error:', err)
  }
}

export interface ProcessedTicket {
  ticket_id:      number
  subject:        string
  description:    string
  created_at:     string
  status:         'new' | 'open' | 'pending'
  requester_id:   number
  customer_email: string
  category:       TicketCategory
  action:         ReplyAction
  confidence:     number
  reason:         string
  order:          MoomOrder | null
  draft_reply:    string
  solved:         boolean
  partnership_email_sent?: boolean
  is_phishing?:   boolean
  phishing_signals?: string[]
}

// ─── Sage-femme detection ─────────────────────────────────────────────────────
// Returns true if the ticket seems to be from a midwife / medical professional.
// These partnership requests are handled separately (not forwarded to Pauline).

const SAGE_FEMME_KEYWORDS = [
  'sage-femme', 'sage femme', 'sages-femmes', 'sages femmes',
  'midwife', 'midwifery', 'profession de santé', 'professionnel de santé',
  'infirmière', 'infirmier', 'puéricultrice', 'puériculteur',
  'maternité', 'maternite', 'obstétrique', 'obstetrique',
  'cabinet médical', 'cabinet medical', 'clinique', 'hôpital', 'hopital',
]

function isSageFemme(subject: string, description: string): boolean {
  const text = `${subject} ${description}`.toLowerCase()
  return SAGE_FEMME_KEYWORDS.some((kw) => text.includes(kw))
}

// ─── Partnership email ────────────────────────────────────────────────────────
// Forwards partnership requests to Pauline via Resend (same provider used for
// delivery emails). Fire-and-forget — failure is logged but does not block.

async function sendPartnershipEmail(
  subject:     string,
  description: string,
  fromEmail:   string,
): Promise<boolean> {
  const apiKey = process.env.RESEND_API_KEY
  if (!apiKey) {
    console.warn('[SAV] RESEND_API_KEY not set — partnership email skipped')
    return false
  }

  const emailSubject = `Demande partenariat à étudier — ${subject}`
  const emailHtml = `
<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:24px">
  <h2 style="color:#1a1a2e;margin-bottom:4px">Nouvelle demande de partenariat</h2>
  <p style="color:#6b6b63;margin-top:0">Reçue via Zendesk SAV — expéditeur : <strong>${fromEmail}</strong></p>
  <hr style="border:none;border-top:1px solid #e8e8e4;margin:16px 0">
  <p style="color:#1a1a2e;white-space:pre-wrap;line-height:1.6">${description.replace(/</g, '&lt;').replace(/>/g, '&gt;')}</p>
  <hr style="border:none;border-top:1px solid #e8e8e4;margin:16px 0">
  <p style="color:#9b9b93;font-size:12px">Envoyé automatiquement par Steero · SAV Mōom</p>
</div>`

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from:    'sav@moom-paris.co',
      to:      'pauline@moom-paris.co',
      reply_to: fromEmail,
      subject: emailSubject,
      html:    emailHtml,
    }),
  })

  if (!res.ok) {
    console.error(`[SAV] Partnership email failed: ${res.status} ${await res.text()}`)
    return false
  }

  console.log(`[SAV] Partnership email sent for ticket "${subject}"`)
  return true
}

// ─── processPendingTickets ────────────────────────────────────────────────────
// Fetches new Zendesk tickets, classifies each, fetches Shopify order,
// generates a draft reply. Returns all processed tickets for review.

export async function processPendingTickets(): Promise<ProcessedTicket[]> {
  const [tickets, processedIds] = await Promise.all([getNewTickets(), getProcessedIds()])

  const fresh = tickets.filter(t => !processedIds.has(t.id))
  console.log(`[SAV] getNewTickets=${tickets.length}, déjà traités=${tickets.length - fresh.length}, à traiter=${fresh.length}`)
  if (fresh.length === 0) return []

  // Process at most 3 tickets concurrently to avoid hammering Zendesk's rate limit
  // (trial plan: ~10 req/min). Each ticket makes 2+ Zendesk calls, so 3 in parallel
  // ≈ 6 simultaneous Zendesk requests — safe without triggering 429s.
  const CONCURRENCY = 3
  const results: PromiseSettledResult<ProcessedTicket>[] = []
  for (let i = 0; i < fresh.length; i += CONCURRENCY) {
    const batch = fresh.slice(i, i + CONCURRENCY)
    const batchResults = await Promise.allSettled(
      batch.map(ticket => processOneTicket(ticket.id, ticket.subject, ticket.description, ticket.created_at, ticket.requester_id, ticket.status as 'new' | 'open' | 'pending'))
    )
    results.push(...batchResults)
    if (i + CONCURRENCY < fresh.length) {
      // Small pause between batches to give Zendesk's rate limit window time to recover
      await new Promise(r => setTimeout(r, 500))
    }
  }

  results
    .filter((r): r is PromiseRejectedResult => r.status === 'rejected')
    .forEach((r, i) => console.error(`[SAV] ticket[${i}] failed:`, r.reason))

  return results
    .filter((r): r is PromiseFulfilledResult<ProcessedTicket> => r.status === 'fulfilled')
    .map((r) => r.value)
}

export async function processOneTicket(
  ticketId:    number,
  subject:     string,
  description: string,
  createdAt:   string,
  requesterId: number,
  ticketStatus: 'new' | 'open' | 'pending' = 'open',
): Promise<ProcessedTicket> {
  // ─── Phishing fast-path (before any Claude call) ──────────────────────────
  // Fetch email first — needed for sender-based phishing check.
  const email = await getRequesterEmail(requesterId)

  const phishing = detectPhishing(email, subject, description)
  if (phishing) {
    console.warn(`[SAV] Phishing détecté ticket #${ticketId} — signaux:`, phishing.signals)
    // Tag Zendesk asynchronously (fire-and-forget)
    tagTicket(ticketId, ['phishing']).catch((err) =>
      console.error('[SAV] tagTicket phishing failed:', err)
    )
    return {
      ticket_id:       ticketId,
      subject,
      description,
      created_at:      createdAt,
      status:          ticketStatus,
      requester_id:    requesterId,
      customer_email:  email,
      category:        'autre',
      action:          'escalate',
      confidence:      1,
      reason:          `Phishing détecté : ${phishing.signals.join(' | ')}`,
      order:           null,
      draft_reply:     '',
      solved:          false,
      is_phishing:     true,
      phishing_signals: phishing.signals,
    }
  }

  // Run classification + Shopify order fetch in parallel
  const [classification, shopifyOrder] = await Promise.allSettled([
    classifyTicket(subject, description),
    getMostRecentOrder(email),
  ])

  const order: MoomOrder | null =
    shopifyOrder.status === 'fulfilled' ? shopifyOrder.value : null

  if (classification.status === 'rejected') {
    throw new Error(`[SAV] classifyTicket failed: ${classification.reason}`)
  }
  const cls = classification.value

  // ─── Pending tickets ──────────────────────────────────────────────────────
  // "Pending" means waiting for the client to reply — no action needed from
  // the team right now. Skip reply generation to save Claude API calls.
  if (ticketStatus === 'pending') {
    return {
      ticket_id:      ticketId,
      subject,
      description,
      created_at:     createdAt,
      status:         'pending',
      requester_id:   requesterId,
      customer_email: email,
      category:       cls.category,
      action:         cls.action,
      confidence:     cls.confidence,
      reason:         cls.reason,
      order,
      draft_reply:    '',
      solved:         false,
    }
  }

  // ─── Partnership routing ──────────────────────────────────────────────────
  // If the ticket is a partnership request and NOT from a sage-femme,
  // forward the full message to Pauline. This happens before reply generation
  // since partnership tickets don't need a Claude draft.
  let partnershipEmailSent: boolean | undefined

  if (cls.category === 'partenariat') {
    if (isSageFemme(subject, description)) {
      console.log(`[SAV] #${ticketId} partenariat sage-femme — pas de transfert Pauline`)
    } else {
      partnershipEmailSent = await sendPartnershipEmail(subject, description, email).catch((err) => {
        console.error(`[SAV] #${ticketId} partnership email error:`, err)
        return false
      })
    }
  }

  // Generate reply draft
  const reply = await generateReply(subject, description, cls.category, order, email)

  return {
    ticket_id:      ticketId,
    subject,
    description,
    created_at:     createdAt,
    status:         ticketStatus,
    requester_id:   requesterId,
    customer_email: email,
    category:       cls.category,
    action:         cls.action,
    confidence:     cls.confidence,
    reason:         cls.reason,
    order,
    draft_reply:    reply.body,
    solved:         reply.solved,
    ...(partnershipEmailSent !== undefined && { partnership_email_sent: partnershipEmailSent }),
  }
}

// ─── sendValidatedReply ───────────────────────────────────────────────────────
// Called after a human validates (or edits) the draft.
// action = 'escalate' → adds the escalade tag, no public reply
// action = 'auto_reply' → posts the reply + closes/opens the ticket

export async function sendValidatedReply(
  ticketId:   number,
  replyBody:  string,
  solved:     boolean,
  action:     ReplyAction,
): Promise<void> {
  if (action === 'escalate') {
    await escalateTicket(ticketId)
  } else {
    await postReply(ticketId, replyBody, solved)
  }
}
