// Transfert d'un ticket SAV par mail à un tiers (collègue, entrepôt, fournisseur…).
//   POST { ticket_id, to, note?, customer_email?, subject? } ?brand=
// Envoie via Resend (domaine steero.co vérifié), reply_to = client, et ajoute une
// note INTERNE sur le ticket Zendesk pour tracer le transfert.
import { NextRequest, NextResponse } from 'next/server'
import { savBrandFromRequest } from '@/lib/sav/brand'
import { getTicketComments, addInternalNote } from '@/lib/sav/zendesk'

export const dynamic = 'force-dynamic'

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

export async function POST(req: NextRequest) {
  const brand = savBrandFromRequest(req)
  const body = await req.json().catch(() => ({})) as {
    ticket_id?: number; to?: string; note?: string; customer_email?: string; subject?: string; requester_id?: number
  }
  const ticketId = Number(body.ticket_id)
  const requesterId = Number(body.requester_id) || 0
  const to = (body.to ?? '').toString().trim()
  const note = (body.note ?? '').toString().trim()
  const subject = (body.subject ?? '').toString().trim() || `Ticket #${ticketId}`

  if (!ticketId) return NextResponse.json({ error: 'ticket_id requis' }, { status: 400 })
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(to)) return NextResponse.json({ error: 'Adresse e-mail invalide' }, { status: 400 })

  const apiKey = process.env.RESEND_API_KEY
  if (!apiKey) return NextResponse.json({ error: 'RESEND_API_KEY manquant' }, { status: 500 })

  // 1) Conversation du ticket
  let convoHtml = '<p style="color:#9b9b93">(conversation indisponible)</p>'
  try {
    const comments = await getTicketComments(ticketId, requesterId, brand)
    if (comments.length > 0) {
      convoHtml = comments.map(c => {
        const who = c.author_type === 'client' ? 'Client' : 'SAV'
        const color = c.author_type === 'client' ? '#1a1a2e' : '#1565c0'
        return `<div style="margin:0 0 14px">
          <p style="margin:0 0 2px;font-size:11px;font-weight:700;color:${color}">${who}</p>
          <p style="margin:0;white-space:pre-wrap;line-height:1.55;color:#1a1a2e">${esc(c.body)}</p>
        </div>`
      }).join('')
    }
  } catch { /* on transfère quand même avec la note */ }

  const brandLabel = brand === 'bowa' ? 'Bowa' : 'Mōom Paris'
  const noteHtml = note
    ? `<div style="background:#fff8ed;border:1px solid #f5e6c8;border-radius:8px;padding:12px 14px;margin:0 0 18px">
         <p style="margin:0;font-size:13px;color:#8a6d1f;white-space:pre-wrap;line-height:1.5"><strong>Message :</strong> ${esc(note)}</p>
       </div>`
    : ''
  const html = `
<div style="font-family:Arial,sans-serif;max-width:640px;margin:0 auto;padding:24px">
  <h2 style="color:#1a1a2e;margin:0 0 2px">Transfert d'un ticket SAV — ${brandLabel}</h2>
  <p style="color:#6b6b63;margin:0 0 16px">Ticket #${ticketId} · ${esc(subject)}${body.customer_email ? ` · client : <strong>${esc(body.customer_email)}</strong>` : ''}</p>
  ${noteHtml}
  <hr style="border:none;border-top:1px solid #e8e8e4;margin:0 0 16px">
  ${convoHtml}
  <hr style="border:none;border-top:1px solid #e8e8e4;margin:16px 0">
  <p style="color:#9b9b93;font-size:12px">Transféré via Steero · SAV ${brandLabel}${body.customer_email ? ' · répondez à ce mail pour écrire au client' : ''}</p>
</div>`

  // 2) Envoi Resend
  const payload: Record<string, unknown> = {
    from:    'Steero SAV <sav@steero.co>',
    to,
    subject: `[SAV ${brandLabel}] Transfert — ${subject}`,
    html,
  }
  if (body.customer_email) payload.reply_to = body.customer_email

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
  if (!res.ok) {
    return NextResponse.json({ error: `Envoi impossible: ${await res.text()}` }, { status: 500 })
  }

  // 3) Note interne Zendesk (traçabilité) — best-effort
  try {
    await addInternalNote(ticketId, `📤 Ticket transféré à ${to}${note ? `\nMessage : ${note}` : ''}`, brand)
  } catch { /* non bloquant */ }

  return NextResponse.json({ ok: true })
}
