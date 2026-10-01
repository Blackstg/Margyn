import { NextRequest, NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

// ─── Sonde du token de management Supabase ───────────────────────────────────
// But : ne JAMAIS laisser l'auto-restart mourir en silence. Le 30 sept, le token
// avait expiré → l'auto-restart recevait 401 sans que personne le sache, et la
// panne nocturne n'a pas été réparée. Ce cron (1×/jour) valide le token et
// envoie une alerte distincte s'il est invalide, pour qu'on le régénère AVANT
// qu'une panre n'arrive.

function cronAuthorized(req: NextRequest): boolean {
  if (req.headers.get('x-vercel-cron') === '1') return true
  const secret = process.env.CRON_SECRET
  if (!secret) return false
  return (req.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '') === secret
}

async function sendTokenDeadAlert(status: number | string) {
  const key = process.env.RESEND_API_KEY
  const to  = process.env.ALERT_EMAIL
  if (!key || !to) return
  await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: 'Steero Alerts <alerts@steero.co>',
      to: [to],
      subject: '⚠️ Steero — AUTO-RESTART HORS SERVICE (token Supabase invalide)',
      html: `<div style="font-family:sans-serif;max-width:560px">
        <h2 style="color:#c0392b">⚠️ Le filet de sécurité auto-restart est cassé</h2>
        <p>Le token de management Supabase n'est plus valide (réponse ${status}).
           Tant qu'il n'est pas régénéré, <strong>un plantage Auth/base ne sera PAS réparé
           automatiquement</strong>.</p>
        <p><strong>Action :</strong> régénère un token sur
           <a href="https://supabase.com/dashboard/account/tokens">supabase.com/dashboard/account/tokens</a>
           et transmets-le pour remettre l'auto-restart en service.</p>
        <p style="color:#888;font-size:0.85rem">${new Date().toISOString()}</p>
      </div>`,
    }),
  }).catch(() => {})
}

async function handle(req: NextRequest) {
  const token = process.env.SUPABASE_ACCESS_TOKEN
  if (!token) {
    if (cronAuthorized(req)) await sendTokenDeadAlert('absent')
    return NextResponse.json({ ok: false, reason: 'no-token' }, { status: 503 })
  }
  let status: number | string = 'error'
  try {
    const r = await fetch('https://api.supabase.com/v1/projects', {
      headers: { Authorization: `Bearer ${token}` },
      cache: 'no-store',
    })
    status = r.status
  } catch { status = 'error' }
  const ok = status === 200
  if (!ok && cronAuthorized(req)) await sendTokenDeadAlert(status)
  return NextResponse.json({ ok, managementToken: ok ? 'valid' : 'invalid', status, at: new Date().toISOString() }, { status: ok ? 200 : 503 })
}

export const GET  = handle
export const POST = handle
