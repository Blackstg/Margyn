// GET /api/debug/tour-email?email=test@example.com&name=Prénom&date=2026-05-05
// Sends a test tour notification email without touching any real tour data.

import { NextRequest, NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

function firstNameOf(fullName: string): string {
  return fullName?.split(' ')[0] ?? fullName ?? 'client'
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
  <img src="https://bowa-concept.com/cdn/shop/files/logo.png?v=1693451719" alt="Bowa Concept" style="height:40px;margin-top:8px" /></p>
</div>`
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const toEmail = searchParams.get('email')?.trim()
  const name    = searchParams.get('name')?.trim() || 'Client Test'
  const date    = searchParams.get('date')?.trim() || new Date().toISOString().slice(0, 10)

  if (!toEmail) {
    return NextResponse.json(
      { error: 'Paramètre "email" requis. Ex: /api/debug/tour-email?email=toi@gmail.com&name=Prénom&date=2026-05-05' },
      { status: 400 }
    )
  }

  if (!process.env.RESEND_API_KEY) {
    return NextResponse.json({ error: 'RESEND_API_KEY non configuré' }, { status: 500 })
  }

  const firstName = firstNameOf(name)
  const html = buildEmailHtml(firstName, date)

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: 'Léa – Bowa Concept <notifications@notifications.bowa-concept.com>',
      to:   toEmail,
      subject: '[TEST] BOWA CONCEPT : LIVRAISON',
      html,
    }),
  })

  if (!res.ok) {
    const err = await res.text()
    return NextResponse.json({ error: `Resend ${res.status}: ${err}` }, { status: 500 })
  }

  const data = await res.json()
  return NextResponse.json({
    ok: true,
    message: `Email de test envoyé à ${toEmail}`,
    name,
    date,
    resend_id: data.id,
  })
}
