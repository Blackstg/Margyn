// POST /api/sav/webhook — Zendesk webhook handler
//
// Zendesk envoie un POST quand un ticket est mis à jour (réponse client, etc.).
// On supprime le ticket de sav_processed_tickets → il réapparaît dans Steero
// au prochain fetch, même si la table processed_at n'est pas encore migrée
// (le delete idempotent est toujours safe).
//
// Config Zendesk (Admin > Apps & integrations > Webhooks) :
//   URL:     https://<votre-domaine>/api/sav/webhook
//   Method:  POST
//   Auth:    Bearer <ZENDESK_WEBHOOK_SECRET>
//   Payload: { "ticket_id": "{{ticket.id}}", "status": "{{ticket.status}}" }
//
// Trigger Zendesk (Admin > Business rules > Triggers) :
//   Condition : ticket updated AND status = open
//              AND (commenter = requester OU tags = none)
//   Action    : Notify active webhook → webhook ci-dessus

import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase'

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  // ── Vérification du secret webhook ───────────────────────────────────────
  const secret = process.env.ZENDESK_WEBHOOK_SECRET
  if (secret) {
    const authHeader = req.headers.get('authorization') ?? ''
    const provided   = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : authHeader
    if (provided !== secret) {
      console.warn('[SAV webhook] Unauthorized — bad secret')
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
  }

  // ── Parse payload ────────────────────────────────────────────────────────
  let body: { ticket_id?: string | number; status?: string }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const ticketId = body.ticket_id ? Number(body.ticket_id) : null
  if (!ticketId || isNaN(ticketId)) {
    return NextResponse.json({ error: 'ticket_id missing or invalid' }, { status: 400 })
  }

  const status = body.status ?? 'unknown'
  console.log(`[SAV webhook] ticket #${ticketId} updated — status=${status}`)

  // ── Supprimer de sav_processed_tickets ──────────────────────────────────
  // Le ticket réapparaîtra dans Steero au prochain fetch (polling ou refresh manuel).
  // On ne supprime que si le ticket est "open" (= client a répondu et Zendesk a rouvert).
  // Pour "pending" on laisse — c'est Steero qui attend la réponse client, pas l'inverse.
  if (status === 'open' || status === 'new') {
    try {
      const sb = createAdminClient()
      const { error } = await sb
        .from('sav_processed_tickets')
        .delete()
        .eq('ticket_id', ticketId)

      if (error) {
        console.error(`[SAV webhook] delete error for #${ticketId}:`, error.message)
      } else {
        console.log(`[SAV webhook] ticket #${ticketId} supprimé de processed → réapparaîtra dans Steero`)
      }
    } catch (err) {
      console.error(`[SAV webhook] DB error:`, err)
    }
  }

  return NextResponse.json({ ok: true, ticket_id: ticketId, status })
}
