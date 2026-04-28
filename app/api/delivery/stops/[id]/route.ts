import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

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
                src="https://bowa-concept.com/cdn/shop/files/Logo_Bowa_concept.png"
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
                src="https://bowa-concept.com/cdn/shop/files/Logo_Bowa_concept.png"
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
      from: 'Marine – Bowa Concept <hello@bowa-concept.com>',
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
    const { status, sequence, email_sent_at, comment, sav_note } = body as {
      status?: string
      sequence?: number
      email_sent_at?: string
      comment?: string
      sav_note?: string | null
    }

    const updates: Record<string, unknown> = {}
    if (status !== undefined) {
      updates.status = status
      if (status === 'delivered' || status === 'failed') {
        updates.delivered_at = new Date().toISOString()
      }
    }
    if (sequence !== undefined) updates.sequence = sequence
    if (email_sent_at !== undefined) updates.email_sent_at = email_sent_at
    if (comment !== undefined) {
      updates.comment = comment
      updates.comment_at = new Date().toISOString()
    }
    if (sav_note !== undefined) {
      updates.sav_note = sav_note
      updates.sav_note_at = sav_note ? new Date().toISOString() : null
    }

    const admin = getAdmin()
    const { data, error } = await admin
      .from('delivery_stops')
      .update(updates)
      .eq('id', params.id)
      .select()
      .single()

    if (error) throw error

    // Send satisfaction email when stop is marked delivered
    if (status === 'delivered' && data.email && !data.satisfaction_sent_at) {
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
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const admin = getAdmin()
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
