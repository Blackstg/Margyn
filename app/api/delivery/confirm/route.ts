// GET /api/delivery/confirm?stop=<id>&action=confirmed|unavailable
// Called when a customer clicks a button in the tour notification email.

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

export const dynamic = 'force-dynamic'

function getAdmin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const stopId = searchParams.get('stop')?.trim()
  const action = searchParams.get('action')?.trim()

  if (!stopId || !['confirmed', 'unavailable'].includes(action ?? '')) {
    return new NextResponse('Lien invalide.', { status: 400, headers: { 'Content-Type': 'text/plain' } })
  }

  const admin = getAdmin()
  const { error } = await admin
    .from('delivery_stops')
    .update({ client_availability: action })
    .eq('id', stopId)

  if (error) {
    console.error('[delivery/confirm]', error)
    return new NextResponse(buildPage(false, null), { status: 500, headers: { 'Content-Type': 'text/html; charset=utf-8' } })
  }

  const isConfirmed = action === 'confirmed'
  return new NextResponse(buildPage(true, isConfirmed), {
    status: 200,
    headers: { 'Content-Type': 'text/html; charset=utf-8' },
  })
}

function buildPage(ok: boolean, confirmed: boolean | null): string {
  if (!ok) {
    return page('Erreur', '⚠️', 'Une erreur est survenue', 'Veuillez réessayer ou contacter notre équipe à <a href="mailto:lea@bowa-concept.com" style="color:#1a1a2e;">lea@bowa-concept.com</a>.')
  }
  if (confirmed) {
    return page(
      'Présence confirmée',
      '✅',
      'Parfait, nous en prenons note !',
      'Votre présence est confirmée. Notre livreur passera chez vous cette semaine et vous contactera avant de se déplacer.'
    )
  }
  return page(
    'Livraison reportée',
    '📅',
    'Pas de problème !',
    'Nous allons reprogrammer votre livraison. Notre équipe vous contactera prochainement pour convenir d\'une nouvelle date.'
  )
}

function page(title: string, icon: string, heading: string, body: string): string {
  return `<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${title} — Bowa Concept</title>
</head>
<body style="margin:0;padding:0;background:#f1ebe7;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;min-height:100vh;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f1ebe7;padding:60px 16px;">
    <tr>
      <td align="center">
        <table width="480" cellpadding="0" cellspacing="0" style="max-width:480px;width:100%;">
          <tr>
            <td style="background:#ffffff;border-radius:20px;padding:48px 40px;text-align:center;box-shadow:0 4px 24px rgba(0,0,0,0.08);">
              <p style="font-size:52px;margin:0 0 16px;">${icon}</p>
              <h1 style="margin:0 0 16px;font-size:22px;font-weight:700;color:#1a1a2e;line-height:1.3;">${heading}</h1>
              <p style="margin:0 0 28px;font-size:15px;color:#3a3a3a;line-height:1.7;">${body}</p>
              <hr style="border:none;border-top:1px solid #ece8e4;margin:0 0 20px;" />
              <p style="margin:0;font-size:13px;color:#9ca3af;line-height:1.6;">
                Pour toute question, écrivez-nous à<br/>
                <a href="mailto:lea@bowa-concept.com" style="color:#6b6b63;text-decoration:none;font-weight:600;">lea@bowa-concept.com</a>
              </p>
            </td>
          </tr>
          <tr>
            <td align="center" style="padding-top:24px;">
              <img src="https://bowa-concept.com/cdn/shop/files/logo.png?v=1693451719" alt="Bowa Concept" width="80"
                style="display:block;height:auto;opacity:0.4;margin:0 auto 8px;" />
              <p style="margin:0;font-size:11px;color:#a0998f;">
                <a href="https://bowa-concept.com" style="color:#a0998f;text-decoration:none;">bowa-concept.com</a>
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
