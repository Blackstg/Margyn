// POST /api/sav/send
// Body: { ticket_id: number, reply_body: string, solved: boolean, action: 'auto_reply' | 'escalate' }
// Sends a validated (human-approved) reply to a Zendesk ticket.

import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@supabase/auth-helpers-nextjs'
import { cookies } from 'next/headers'
import { createAdminClient } from '@/lib/supabase'
import { sendValidatedReply, markTicketProcessed } from '@/lib/sav/orchestrator'
import type { ReplyAction } from '@/lib/sav/classifier'
import { getBonRetourToken } from '@/lib/sav/bon-retour'
import { savBrandFromRequest } from '@/lib/sav/brand'

export const dynamic = 'force-dynamic'

// Nom de l'agent connecté (pour l'attribution). Lu depuis la session, pas du client.
async function currentAgent(): Promise<{ name: string; role: string }> {
  try {
    const store = await cookies()
    const sb = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      { cookies: { getAll() { return store.getAll() }, setAll() {} } },
    )
    const { data: { user } } = await sb.auth.getUser()
    const m = user?.user_metadata ?? {}
    return { name: ((m.full_name ?? m.name ?? '') as string).trim(), role: (m.role as string) ?? 'admin' }
  } catch {
    return { name: '', role: 'admin' }
  }
}

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
  const force = (body as { force?: boolean }).force === true
  const brand = savBrandFromRequest(req)

  if (!ticket_id || !action) {
    return NextResponse.json({ error: 'ticket_id and action are required' }, { status: 400 })
  }

  // ── Garde-fou anti-double-réponse ────────────────────────────────────────────
  // Deux agents ne doivent pas répondre au même ticket. On revendique le ticket de
  // façon ATOMIQUE (insert-si-absent) : le 1er à envoyer le « verrouille ». Si un
  // AUTRE agent le détient déjà, on bloque (409) — sauf reprise explicite (force).
  const { name: agent, role } = await currentAgent()
  if (agent) {
    try {
      const admin = createAdminClient()
      // Scopé par marque : les ticket_id des 2 Zendesk se chevauchent.
      const { error: claimErr } = await admin.from('sav_assignments').upsert(
        { ticket_id, brand, assignee: agent, updated_by: agent, updated_at: new Date().toISOString() },
        { onConflict: 'brand,ticket_id', ignoreDuplicates: true },
      )
      // Contrainte composite (brand,ticket_id) pas encore migrée → on saute le garde-fou
      // (l'envoi passe quand même) plutôt que de bloquer.
      if (!claimErr) {
        const { data: row } = await admin.from('sav_assignments').select('assignee').eq('ticket_id', ticket_id).eq('brand', brand).maybeSingle()
        const holder = (row?.assignee ?? '').trim()
        const isOwner = role === 'admin'
        if (holder && holder !== agent && !force && !isOwner) {
          return NextResponse.json(
            { error: `Ce ticket est déjà pris en charge par ${holder}. Actualise la liste avant de répondre.`, held_by: holder },
            { status: 409 },
          )
        }
        if (holder !== agent && (force || isOwner)) {
          await admin.from('sav_assignments').upsert(
            { ticket_id, brand, assignee: agent, updated_by: agent, updated_at: new Date().toISOString() },
            { onConflict: 'brand,ticket_id' },
          )
        }
      }
    } catch (e) {
      console.error('[SAV] garde-fou attribution ignoré:', e)
    }
  }

  if (action === 'auto_reply' && !reply_body) {
    return NextResponse.json({ error: 'reply_body is required for auto_reply action' }, { status: 400 })
  }

  try {
    // Joindre le bon de retour PDF (spécifique Moom) pour les tickets retour/remb.
    const allUploads = [...uploads]
    if (brand === 'moom' && category === 'retour_remboursement') {
      try {
        const bonRetourToken = await getBonRetourToken()
        allUploads.push(bonRetourToken)
        console.log(`[SAV] Bon de retour joint automatiquement (ticket #${ticket_id})`)
      } catch (err) {
        // Non-bloquant : on envoie quand même sans le PDF
        console.error('[SAV] Impossible de joindre le bon de retour:', err)
      }
    }

    await sendValidatedReply(ticket_id, reply_body, solved ?? false, action, allUploads, brand)
    // Persist so this ticket is excluded from future fetches
    await markTicketProcessed(ticket_id, action === 'escalate' ? 'escalated' : 'sent', brand)
    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error('[SAV] sendValidatedReply error:', err)
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Unknown error' },
      { status: 500 },
    )
  }
}
