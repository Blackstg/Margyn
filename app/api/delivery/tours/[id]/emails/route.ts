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

function buildEmailHtml(firstName: string, startDateStr: string): string {
  const start   = new Date(startDateStr + 'T00:00:00')
  const end     = addWorkingDays(startDateStr, 4)
  const startFr = fmtDateLong(start)
  const endFr   = fmtDateLong(end)

  return `<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:24px;color:#1a1a2e">
  <p>Bonjour ${firstName},</p>

  <p>Bonne nouvelle ! 🎉 Votre commande sera livrée cette semaine.<br>
  Notre livreur commencera sa tournée le <strong>${startFr}</strong> et passera chez vous dans les prochains jours (entre le ${startFr} et le ${endFr}).</p>

  <p>La livraison s'effectuera au pied du camion 🚛. Nous vous demandons donc de faire le nécessaire pour être accompagné(e) d'une autre personne afin de récupérer les panneaux en toute sécurité 🔧.</p>

  <p>Pour garantir une livraison en toute fluidité, notre livreur vous appellera très probablement au fil de sa tournée, en fonction de l'ordre des livraisons, afin de vérifier votre disponibilité. Vous serez joint(e) depuis le numéro suivant : <strong>06 02 40 15 86</strong>.</p>

  <p>Si vous êtes indisponible, merci de nous en informer par retour de mail, afin que nous puissions reprogrammer votre livraison.</p>

  <p>Nous nous réjouissons de finaliser votre livraison très prochainement ☀️.</p>

  <p>Cordialement,<br>
  <strong>Léa</strong><br>
  Service client<br>
  <img src="https://bowa-concept.com/cdn/shop/files/Logo_Bowa_concept.png" alt="Bowa Concept" style="height:40px;margin-top:8px" /></p>
</div>`
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
          const html = buildEmailHtml(firstNameOf(stop.customer_name ?? ''), startDateStr)

          const emailRes = await fetch('https://api.resend.com/emails', {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              from: 'Léa – Bowa Concept <lea@bowa-concept.com>',
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
