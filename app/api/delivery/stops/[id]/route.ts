import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { blockingAlert, alertMessage } from '@/lib/delivery/shopifyCancellations'
import { fulfillOrder } from '@/lib/delivery/shopifyFulfill'
import { callerName, logStopEvents, parsePosition, tourName, updateStop, type StopEvent } from '@/lib/delivery/trace'

function getAdmin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}

// ─── Satisfaction email ───────────────────────────────────────────────────────

function firstNameOf(fullName: string | null | undefined): string {
  return fullName?.split(' ')[0] ?? 'client'
}

function buildSatisfactionEmail(customerName: string, orderName: string): string {
  const firstName = firstNameOf(customerName)
  return `<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Votre commande Bowa est arrivée !</title>
</head>
<body style="margin:0;padding:0;background:#f1ebe7;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f1ebe7;padding:32px 16px;">
    <tr>
      <td align="center">
        <table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;">

          <!-- Logo -->
          <tr>
            <td align="center" style="padding-bottom:28px;">
              <img
                src="https://bowa-concept.com/cdn/shop/files/logo.png?v=1693451719"
                alt="Bowa Concept"
                width="140"
                style="display:block;height:auto;"
              />
            </td>
          </tr>

          <!-- Card -->
          <tr>
            <td style="background:#ffffff;border-radius:20px;padding:40px 40px 32px;box-shadow:0 4px 24px rgba(0,0,0,0.06);">

              <!-- Hero -->
              <p style="font-size:36px;margin:0 0 8px;text-align:center;">🎉</p>
              <h1 style="margin:0 0 24px;font-size:22px;font-weight:700;color:#1a1a2e;text-align:center;line-height:1.3;">
                Votre commande Bowa<br/>est arrivée !
              </h1>

              <!-- Body -->
              <p style="margin:0 0 16px;font-size:15px;color:#3a3a3a;line-height:1.6;">
                Bonjour <strong>${firstName}</strong>,
              </p>
              <p style="margin:0 0 16px;font-size:15px;color:#3a3a3a;line-height:1.6;">
                Nous espérons que votre livraison s'est bien passée et que vos panneaux sont exactement comme vous les imaginiez&nbsp;! 🌿
              </p>
              <p style="margin:0 0 24px;font-size:15px;color:#3a3a3a;line-height:1.6;">
                Chez Bowa, chaque commande est préparée avec soin et livrée par notre équipe dédiée — votre satisfaction est notre priorité.
              </p>

              <!-- Trustpilot CTA -->
              <table width="100%" cellpadding="0" cellspacing="0" style="background:#f8f4f1;border-radius:14px;padding:24px;margin-bottom:28px;">
                <tr>
                  <td align="center">
                    <p style="margin:0 0 6px;font-size:15px;color:#3a3a3a;line-height:1.6;font-weight:600;">
                      Si vous êtes satisfait(e) de votre expérience, nous serions vraiment touchés que vous partagiez votre avis.
                    </p>
                    <p style="margin:0 0 20px;font-size:14px;color:#6b6b63;line-height:1.5;">
                      Cela nous aide énormément à faire connaître Bowa et à continuer à nous améliorer.
                    </p>
                    <!-- Trustpilot star row -->
                    <p style="margin:0 0 16px;font-size:28px;letter-spacing:2px;">★★★★★</p>
                    <a
                      href="https://fr.trustpilot.com/evaluate/bowa-concept.com"
                      target="_blank"
                      style="display:inline-block;background:#00b67a;color:#ffffff;font-size:15px;font-weight:700;text-decoration:none;padding:14px 32px;border-radius:50px;letter-spacing:0.3px;"
                    >
                      👉 Laisser un avis sur Trustpilot
                    </a>
                  </td>
                </tr>
              </table>

              <!-- Support -->
              <p style="margin:0 0 8px;font-size:14px;color:#6b6b63;line-height:1.6;">
                <strong style="color:#3a3a3a;">Un problème avec votre commande ${orderName} ?</strong><br/>
                Notre équipe est disponible et fera tout pour vous aider. Répondez simplement à cet email.
              </p>

              <hr style="border:none;border-top:1px solid #ece8e4;margin:24px 0;" />

              <!-- Sign-off -->
              <p style="margin:0 0 4px;font-size:14px;color:#3a3a3a;line-height:1.6;">
                Merci pour votre confiance et à bientôt chez Bowa&nbsp;☀️
              </p>
              <p style="margin:0;font-size:14px;color:#3a3a3a;line-height:1.6;">
                Cordialement,<br/>
                <strong>Marine</strong><br/>
                <span style="color:#6b6b63;">Service client</span>
              </p>

            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td align="center" style="padding-top:20px;">
              <img
                src="https://bowa-concept.com/cdn/shop/files/logo.png?v=1693451719"
                alt="Bowa Concept"
                width="80"
                style="display:block;height:auto;opacity:0.4;margin-bottom:8px;"
              />
              <p style="margin:0;font-size:11px;color:#a0998f;line-height:1.5;">
                Bowa Concept — livraison de panneaux solaires en France<br/>
                <a href="https://bowa-concept.com" style="color:#a0998f;">bowa-concept.com</a>
              </p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>`
}

async function sendSatisfactionEmail(
  admin: any, // eslint-disable-line @typescript-eslint/no-explicit-any
  stopId: string,
  email: string,
  customerName: string,
  orderName: string
): Promise<void> {
  if (!process.env.RESEND_API_KEY || !email) return

  const html = buildSatisfactionEmail(customerName, orderName)

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: 'Marine – Bowa Concept <notifications@notifications.bowa-concept.com>',
      to: email,
      subject: 'Votre commande Bowa est arrivée ! 🎉',
      html,
    }),
  })

  if (!res.ok) {
    const err = await res.text()
    throw new Error(`Resend ${res.status}: ${err}`)
  }

  await admin
    .from('delivery_stops')
    .update({ satisfaction_sent_at: new Date().toISOString() })
    .eq('id', stopId)
}

// ─── Route handlers ───────────────────────────────────────────────────────────

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const body = await req.json()
    const { status, sequence, email_sent_at, comment, sav_note, signature_url, photo_url, partial_delivered, tour_id, force, already_delivered, signed_at } = body as {
      force?: boolean
      status?: string
      sequence?: number
      email_sent_at?: string
      comment?: string
      sav_note?: string | null
      signature_url?: string | null
      photo_url?: string | null
      partial_delivered?: { sku: string; title: string; qty_ordered: number; qty_delivered: number }[] | null
      tour_id?: string
      // « Déjà livrée » : le livreur (ou le SAV) constate que la commande a été livrée
      // lors d'un passage précédent → livrée, sans mail de satisfaction ni nouvelle replanif.
      already_delivered?: boolean
      signed_at?: string
    }
    const position = parsePosition(body.position)
    const admin = getAdmin()
    const author = await callerName(req)

    const { data: before } = await admin
      .from('delivery_stops')
      .select('order_name, tour_id, status, shopify_order_id, panel_details')
      .eq('id', params.id)
      .single()
    const event = (e: Omit<StopEvent, 'order_name' | 'stop_id' | 'author'>): StopEvent => ({
      stop_id: params.id, order_name: before?.order_name ?? '?', author, ...e,
    })

    // Déplacer l'arrêt vers UNE AUTRE tournée : change tour_id et le place en fin
    // de séquence de la tournée cible (le planificateur réordonne ensuite si besoin).
    if (tour_id !== undefined) {
      const { data: last } = await admin
        .from('delivery_stops')
        .select('sequence')
        .eq('tour_id', tour_id)
        .order('sequence', { ascending: false })
        .limit(1)
        .maybeSingle()
      const nextSeq = ((last?.sequence as number | undefined) ?? -1) + 1
      const { data, error } = await admin
        .from('delivery_stops')
        .update({ tour_id, sequence: nextSeq })
        .eq('id', params.id)
        .select()
        .single()
      if (error) throw error
      const [from, to] = await Promise.all([tourName(admin, before?.tour_id), tourName(admin, tour_id)])
      await logStopEvents(admin, [event({ kind: 'moved', tour_id, tour_name: to, comment: from ? `Depuis « ${from} »` : null })])
      return NextResponse.json({ stop: data })
    }

    // Livraison d'une commande annulée / remboursée sur Shopify entre-temps : refusée
    // (sauf correction volontaire, force=true). Ne concerne que le passage à livré.
    if ((status === 'delivered' || status === 'partial') && !force && !already_delivered) {
      if (before && before.status !== 'delivered' && before.status !== 'partial') {
        const alert = await blockingAlert(before)
        if (alert) return NextResponse.json({ error: alertMessage(alert), code: 'ORDER_CANCELLED', alert }, { status: 409 })
      }
    }

    const now = new Date().toISOString()
    const updates: Record<string, unknown> = {}
    if (status !== undefined) {
      updates.status = status
      if (status === 'delivered' || status === 'failed' || status === 'partial') {
        updates.delivered_at = now
        updates.done_by = author
        updates.done_lat = position?.lat ?? null
        updates.done_lng = position?.lng ?? null
        updates.done_accuracy = position?.accuracy ?? null
      }
    }
    if (partial_delivered !== undefined) updates.partial_delivered = partial_delivered
    if (sequence !== undefined) updates.sequence = sequence
    if (email_sent_at !== undefined) updates.email_sent_at = email_sent_at
    if (comment !== undefined) {
      updates.comment = comment
      updates.comment_at = now
      updates.comment_by = author
    }
    if (sav_note !== undefined) {
      updates.sav_note = sav_note
      updates.sav_note_at = sav_note ? now : null
      updates.sav_note_by = sav_note ? author : null
    }
    if (signature_url !== undefined) {
      updates.signature_url = signature_url
      if (signature_url) updates.signed_at = signed_at && !isNaN(Date.parse(signed_at)) ? signed_at : now
    }
    if (photo_url !== undefined)     updates.photo_url = photo_url

    const { data, error } = await updateStop(admin, params.id, updates)

    if (error) throw error

    // Journal : chaque changement de statut / note, avec son auteur et sa position.
    const events: StopEvent[] = []
    const tName = status !== undefined || comment !== undefined || sav_note !== undefined ? await tourName(admin, data.tour_id) : null
    if (status !== undefined && status !== before?.status) {
      const kind = already_delivered ? 'already_delivered'
        : status === 'delivered' || status === 'partial' || status === 'failed' || status === 'pending' ? status : null
      if (kind) events.push(event({ kind, status, tour_id: data.tour_id, tour_name: tName, comment: comment ?? null, position }))
    } else if (comment !== undefined && comment) {
      events.push(event({ kind: 'note_driver', tour_id: data.tour_id, tour_name: tName, comment, position }))
    }
    if (sav_note !== undefined) events.push(event({ kind: 'note_sav', tour_id: data.tour_id, tour_name: tName, comment: sav_note }))
    if (signature_url) events.push(event({ kind: 'signature', tour_id: data.tour_id, status: data.status }))
    await logStopEvents(admin, events)

    // Marque « traitée » dans Shopify ce qui vient d'être livré. Un échec ne bloque
    // jamais le livreur : le rattrapage nocturne (/api/delivery/shopify-fulfill) repasse.
    if ((status === 'delivered' || status === 'partial') && data.shopify_order_id) {
      const { data: orderStops } = await admin
        .from('delivery_stops')
        .select('order_name, shopify_order_id, status, panel_details, partial_delivered')
        .eq('shopify_order_id', data.shopify_order_id)
      const r = await fulfillOrder(orderStops ?? [data])
      if (r.error) console.error('[shopify fulfill]', r.order, r.error)
    }

    // Send satisfaction email only on full delivery
    if (status === 'delivered' && !already_delivered && data.email && !data.satisfaction_sent_at) {
      sendSatisfactionEmail(
        admin,
        params.id,
        data.email,
        data.customer_name ?? '',
        data.order_name ?? ''
      ).catch((err) => console.error('[satisfaction email]', err))
    }

    return NextResponse.json({ stop: data })
  } catch (err) {
    console.error('[delivery/stops/:id PATCH]', err)
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const admin = getAdmin()
    const { data: stop } = await admin
      .from('delivery_stops')
      .select('order_name, tour_id, status')
      .eq('id', params.id)
      .maybeSingle()
    // Un arrêt livré porte la preuve de livraison (date, signature, photo) : le
    // supprimer ferait « disparaître » la livraison pour le SAV et renverrait la
    // commande à planifier.
    if (stop && (stop.status === 'delivered' || stop.status === 'partial')) {
      return NextResponse.json({ error: 'Arrêt déjà livré : il ne peut pas être retiré de la tournée.' }, { status: 409 })
    }
    if (stop) {
      await logStopEvents(admin, [{
        stop_id: null, order_name: stop.order_name, tour_id: stop.tour_id, tour_name: await tourName(admin, stop.tour_id),
        kind: 'removed', status: stop.status, author: await callerName(req),
      }])
    }
    const { error } = await admin
      .from('delivery_stops')
      .delete()
      .eq('id', params.id)

    if (error) throw error

    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error('[delivery/stops/:id DELETE]', err)
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
