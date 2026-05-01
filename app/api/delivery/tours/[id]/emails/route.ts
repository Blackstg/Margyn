import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

function getAdmin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}

function firstNameOf(fullName: string): string {
  return fullName?.split(' ')[0] ?? fullName ?? ''
}

function addWorkingDays(dateStr: string, days: number): Date {
  const result = new Date(dateStr + 'T00:00:00')
  result.setDate(result.getDate() + days)
  return result
}

function fmtDateLong(d: Date): string {
  return d.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
}

const APP_URL = 'https://www.steero.io'

function buildEmailHtml(firstName: string, startDateStr: string, stopId: string): string {
  const start   = new Date(startDateStr + 'T00:00:00')
  const end     = addWorkingDays(startDateStr, 4)
  const startFr = fmtDateLong(start)
  const endFr   = fmtDateLong(end)

  const confirmUrl     = `${APP_URL}/api/delivery/confirm?stop=${stopId}&action=confirmed`
  const unavailableUrl = `${APP_URL}/api/delivery/confirm?stop=${stopId}&action=unavailable`

  return `<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Votre livraison Bowa arrive cette semaine !</title>
</head>
<body style="margin:0;padding:0;background:#f1ebe7;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f1ebe7;padding:32px 16px;">
    <tr>
      <td align="center">
        <table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;">

          <!-- Logo -->
          <tr>
            <td align="center" style="padding-bottom:28px;">
              <img src="https://bowa-concept.com/cdn/shop/files/logo.png?v=1693451719"
                alt="Bowa Concept" width="140" style="display:block;height:auto;" />
            </td>
          </tr>

          <!-- Card -->
          <tr>
            <td style="background:#ffffff;border-radius:20px;padding:40px 40px 32px;box-shadow:0 4px 24px rgba(0,0,0,0.06);">

              <p style="font-size:36px;margin:0 0 8px;text-align:center;">🚛</p>
              <h1 style="margin:0 0 24px;font-size:22px;font-weight:700;color:#1a1a2e;text-align:center;line-height:1.3;">
                Votre livraison Bowa<br/>arrive cette semaine !
              </h1>

              <p style="margin:0 0 16px;font-size:15px;color:#3a3a3a;line-height:1.6;">
                Bonjour <strong>${firstName}</strong>,
              </p>
              <p style="margin:0 0 16px;font-size:15px;color:#3a3a3a;line-height:1.6;">
                Bonne nouvelle&nbsp;! 🎉 Votre commande sera livrée cette semaine.<br/>
                Notre livreur commencera sa tournée le <strong>${startFr}</strong> et passera chez vous dans les prochains jours (entre le ${startFr} et le ${endFr}).
              </p>
              <p style="margin:0 0 24px;font-size:15px;color:#3a3a3a;line-height:1.6;">
                La livraison s'effectuera au pied du camion 🚛. Nous vous demandons donc de faire le nécessaire pour être accompagné(e) d'une autre personne afin de récupérer les panneaux en toute sécurité 🔧.
              </p>
              <p style="margin:0 0 28px;font-size:15px;color:#3a3a3a;line-height:1.6;">
                Notre livreur vous appellera avant de passer, depuis le numéro suivant&nbsp;: <strong>06 02 40 15 86</strong>.
              </p>

              <!-- Availability CTA -->
              <table width="100%" cellpadding="0" cellspacing="0" style="background:#f8f4f1;border-radius:14px;padding:24px;margin-bottom:28px;">
                <tr>
                  <td align="center">
                    <p style="margin:0 0 20px;font-size:15px;color:#3a3a3a;line-height:1.6;font-weight:600;">
                      Serez-vous disponible pour réceptionner votre commande cette semaine ?
                    </p>
                    <table cellpadding="0" cellspacing="0">
                      <tr>
                        <td style="padding-right:10px;">
                          <a href="${confirmUrl}" target="_blank"
                            style="display:inline-block;background:#1a7f4b;color:#ffffff;font-size:14px;font-weight:700;text-decoration:none;padding:13px 24px;border-radius:50px;letter-spacing:0.2px;">
                            ✅ Oui, je serai présent(e)
                          </a>
                        </td>
                        <td>
                          <a href="${unavailableUrl}" target="_blank"
                            style="display:inline-block;background:#ffffff;color:#c2410c;font-size:14px;font-weight:700;text-decoration:none;padding:12px 24px;border-radius:50px;letter-spacing:0.2px;border:2px solid #fed7aa;">
                            ❌ Je ne serai pas disponible
                          </a>
                        </td>
                      </tr>
                    </table>
                    <p style="margin:16px 0 0;font-size:12px;color:#9ca3af;line-height:1.5;">
                      Sans réponse de votre part, nous considérons que vous serez disponible.
                    </p>
                  </td>
                </tr>
              </table>

              <hr style="border:none;border-top:1px solid #ece8e4;margin:0 0 20px;" />

              <p style="margin:0 0 4px;font-size:14px;color:#3a3a3a;line-height:1.6;">
                Nous nous réjouissons de finaliser votre livraison très prochainement ☀️
              </p>
              <p style="margin:0 0 16px;font-size:14px;color:#3a3a3a;line-height:1.6;">
                Cordialement,<br/>
                <strong>Léa</strong><br/>
                <span style="color:#6b6b63;">Service client</span>
              </p>
              <p style="margin:0;font-size:12px;color:#9ca3af;line-height:1.6;">
                Pour toute question, écrivez-nous à
                <a href="mailto:lea@bowa-concept.com" style="color:#6b6b63;text-decoration:none;">lea@bowa-concept.com</a>
              </p>

            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td align="center" style="padding-top:20px;">
              <img src="https://bowa-concept.com/cdn/shop/files/logo.png?v=1693451719"
                alt="Bowa Concept" width="80" style="display:block;height:auto;opacity:0.4;margin-bottom:8px;" />
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

// GET — returns list of stops (with/without email) for preview in modal
export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const admin = getAdmin()

    const { data: stops, error } = await admin
      .from('delivery_stops')
      .select('id, customer_name, email, email_sent_at')
      .eq('tour_id', params.id)
      .order('sequence', { ascending: true })

    if (error) throw error

    return NextResponse.json({ stops: stops ?? [] })
  } catch (err) {
    console.error('[delivery/tours/:id/emails GET]', err)
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}

// POST — send notification emails (only to stops without email_sent_at)
export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const body = await req.json().catch(() => ({}))
    const force = body?.force === true   // force re-send even if already notified

    const admin = getAdmin()

    // Fetch tour info for the date
    const { data: tour, error: tourError } = await admin
      .from('delivery_tours')
      .select('planned_date, name')
      .eq('id', params.id)
      .single()

    if (tourError) throw tourError

    // Fetch target stops
    let query = admin
      .from('delivery_stops')
      .select('id, customer_name, email, email_sent_at')
      .eq('tour_id', params.id)

    if (!force) {
      query = query.is('email_sent_at', null)
    }

    const { data: stops, error: stopsError } = await query
    if (stopsError) throw stopsError

    const pendingStops = (stops ?? []).filter((s) => s.email)
    const startDateStr = tour.planned_date ?? ''
    let sent = 0
    let errors = 0

    for (const stop of pendingStops) {
      try {
        if (process.env.RESEND_API_KEY) {
          const html = buildEmailHtml(firstNameOf(stop.customer_name ?? ''), startDateStr, stop.id)

          const emailRes = await fetch('https://api.resend.com/emails', {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              from: 'Léa – Bowa Concept <notifications@notifications.bowa-concept.com>',
              to: stop.email,
              subject: 'BOWA CONCEPT : LIVRAISON',
              html,
            }),
          })

          if (!emailRes.ok) {
            const errText = await emailRes.text()
            throw new Error(`Resend ${emailRes.status}: ${errText}`)
          }
        }

        await admin
          .from('delivery_stops')
          .update({ email_sent_at: new Date().toISOString() })
          .eq('id', stop.id)

        sent++
      } catch (e) {
        console.error(`Failed to send email for stop ${stop.id}:`, e)
        errors++
      }
    }

    return NextResponse.json({ sent, errors })
  } catch (err) {
    console.error('[delivery/tours/:id/emails POST]', err)
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
