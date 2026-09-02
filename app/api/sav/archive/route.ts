// POST /api/sav/archive
// Body: { ticket_id: number }
// Closes the Zendesk ticket as solved without posting any public reply,
// then marks it as processed in Supabase so it won't reappear.

import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@supabase/auth-helpers-nextjs'
import { cookies } from 'next/headers'
import { archiveTicket } from '@/lib/sav/zendesk'
import { savBrandFromRequest } from '@/lib/sav/brand'
import { markTicketProcessed } from '@/lib/sav/orchestrator'
import { createAdminClient } from '@/lib/supabase'

export const dynamic = 'force-dynamic'

// Email de l'agent connecté (attribution serveur, pas de confiance au client).
async function currentAgentEmail(): Promise<string> {
  try {
    const store = await cookies()
    const sb = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      { cookies: { getAll() { return store.getAll() }, setAll() {} } },
    )
    const { data: { user } } = await sb.auth.getUser()
    return user?.email ?? ''
  } catch { return '' }
}

export async function POST(req: NextRequest) {
  let body: { ticket_id?: number; category?: string }
  try { body = await req.json() }
  catch { return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 }) }

  const { ticket_id, category } = body
  if (!ticket_id) {
    return NextResponse.json({ error: 'ticket_id is required' }, { status: 400 })
  }

  const brand = savBrandFromRequest(req)
  try {
    await archiveTicket(ticket_id, brand)
    await markTicketProcessed(ticket_id, 'archived', brand)

    // Log métrique Qualité côté serveur (source unique fiable)
    try {
      const agentEmail = await currentAgentEmail()
      await createAdminClient().from('sav_actions').insert({
        brand, ticket_id, action: 'archived',
        category: category ?? null, user_email: agentEmail || null,
      })
    } catch (e) {
      console.error('[SAV] log sav_actions (archive) échoué:', e)
    }
    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error('[SAV] archiveTicket error:', err)
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Unknown error' },
      { status: 500 }
    )
  }
}
