import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

function getAdmin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}

function buildEmailHtml(
  customerName: string,
  orderName: string,
  date: string,
  address1: string,
  city: string,
  zip: string
): string {
  return `<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:24px">
  <h2 style="color:#1a1a2e">Votre livraison est planifiée</h2>
  <p>Bonjour ${customerName},</p>
  <p>Votre commande <strong>${orderName}</strong> sera livrée le <strong>${date}</strong>.</p>
  <p>Adresse de livraison :<br><strong>${address1}, ${city} ${zip}</strong></p>
  <p>Notre livreur passera en journée. Vous recevrez un appel avant le passage.</p>
  <p>Pour toute question, contactez-nous à <a href="mailto:contact@bowa-concept.com">contact@bowa-concept.com</a></p>
  <br><p style="color:#6b6b63">L'équipe Bowa</p>
</div>`
}

export async function POST(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const admin = getAdmin()

    // Fetch tour info for the date
    const { data: tour, error: tourError } = await admin
      .from('delivery_tours')
      .select('planned_date, name')
      .eq('id', params.id)
      .single()

    if (tourError) throw tourError

    // Fetch stops that haven't had emails sent
    const { data: stops, error: stopsError } = await admin
      .from('delivery_stops')
      .select('id, order_name, customer_name, email, address1, city, zip')
      .eq('tour_id', params.id)
      .is('email_sent_at', null)

    if (stopsError) throw stopsError

    const pendingStops = stops ?? []
    let sent = 0
    let errors = 0

    const date = tour.planned_date
      ? new Date(tour.planned_date).toLocaleDateString('fr-FR', {
          weekday: 'long',
          day: 'numeric',
          month: 'long',
          year: 'numeric',
        })
      : tour.name

    for (const stop of pendingStops) {
      try {
        if (process.env.RESEND_API_KEY && stop.email) {
          const html = buildEmailHtml(
            stop.customer_name ?? '',
            stop.order_name,
            date,
            stop.address1 ?? '',
            stop.city ?? '',
            stop.zip ?? ''
          )

          const emailRes = await fetch('https://api.resend.com/emails', {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              from: 'livraison@bowa-concept.com',
              to: stop.email,
              subject: `Votre livraison Bowa - ${stop.order_name}`,
              html,
            }),
          })

          if (!emailRes.ok) {
            throw new Error(`Resend error: ${emailRes.status}`)
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
