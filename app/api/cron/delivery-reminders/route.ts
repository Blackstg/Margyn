// Relance auto des clients Bowa qui n'ont pas répondu au mail de livraison.
// GET (Vercel cron, 1×/jour) : pour chaque arrêt d'une tournée ACTIVE, encore à
// livrer, sans réponse (client_availability null), dont le 1er mail a été envoyé
// il y a entre 48h et 72h → envoie un mail de rappel. La fenêtre 48–72h garantit
// UN seul rappel par client (le cron tourne 1×/jour).

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { buildReminderEmailHtml, firstNameOf } from '@/lib/delivery/reminderEmail'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

function getAdmin() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
}
function isAuthorized(req: NextRequest): boolean {
  if (!process.env.CRON_SECRET) return true
  const h = req.headers.get('authorization') ?? ''
  const t = h.startsWith('Bearer ') ? h.slice(7) : h
  return t === process.env.CRON_SECRET || req.headers.get('x-vercel-cron') === '1'
}

async function run() {
  const admin = getAdmin()
  const now = Date.now()
  const min = new Date(now - 48 * 3600_000).toISOString()  // envoyé il y a ≥ 48h
  const max = new Date(now - 72 * 3600_000).toISOString()  // … et ≤ 72h

  const { data: stops, error } = await admin
    .from('delivery_stops')
    .select('id, customer_name, email, email_sent_at, delivery_tours!inner(planned_date, status, brand)')
    .eq('delivery_tours.brand', 'bowa')
    .in('delivery_tours.status', ['draft', 'planned', 'in_progress'])
    .eq('status', 'pending')
    .is('client_availability', null)
    .not('email_sent_at', 'is', null)
    .lte('email_sent_at', min)
    .gte('email_sent_at', max)
  if (error) throw error

  type StopRow = { id: string; customer_name: string; email: string; delivery_tours: { planned_date: string | null } | { planned_date: string | null }[] }
  const targets = ((stops ?? []) as unknown as StopRow[]).filter((s) => s.email)
  let sent = 0, errors = 0
  const apiKey = process.env.RESEND_API_KEY

  for (const s of targets) {
    try {
      if (apiKey) {
        const t = Array.isArray(s.delivery_tours) ? s.delivery_tours[0] : s.delivery_tours
        const html = buildReminderEmailHtml(firstNameOf(s.customer_name ?? ''), t?.planned_date ?? '', s.id)
        const res = await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            from: 'Léa – Bowa Concept <notifications@notifications.bowa-concept.com>',
            to: s.email,
            reply_to: 'lea@bowa-concept.com',
            subject: 'BOWA CONCEPT : RAPPEL LIVRAISON — confirmez votre présence',
            html,
          }),
        })
        if (!res.ok) throw new Error(`Resend ${res.status}: ${await res.text()}`)
      }
      sent++
    } catch (e) {
      console.error(`[cron/delivery-reminders] échec relance stop ${s.id}:`, e)
      errors++
    }
  }
  return { targeted: targets.length, sent, errors }
}

export async function GET(req: NextRequest) {
  if (!isAuthorized(req)) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  try {
    return NextResponse.json({ ok: true, ...(await run()) })
  } catch (err) {
    console.error('[cron/delivery-reminders]', err)
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}

// Déclenchement manuel (admin) — même logique.
export async function POST(req: NextRequest) {
  if (!isAuthorized(req)) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  try {
    return NextResponse.json({ ok: true, ...(await run()) })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
