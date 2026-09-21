import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

export const dynamic = 'force-dynamic'

// ─── Sonde de santé du service Auth Supabase ─────────────────────────────────
// But : détecter en ~5 min quand le login/refresh de token est HS (comme la panne
// où GoTrue renvoyait des 522 de 90 s) et prévenir par email AVANT les utilisateurs.
//
// Deux usages :
//  • GET public → 200 si l'Auth répond, 503 sinon. À brancher sur un monitor
//    externe (UptimeRobot/Better Uptime) pour une alerte indépendante de Vercel.
//  • Cron Vercel (toutes les 5 min) → si l'Auth est down, envoie un email d'alerte.

function cronAuthorized(req: NextRequest): boolean {
  if (req.headers.get('x-vercel-cron') === '1') return true
  const secret = process.env.CRON_SECRET
  if (!secret) return false
  const token = (req.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '')
  return token === secret
}

async function probeAuth(): Promise<{ ok: boolean; status: number | string; ms: number }> {
  const url  = process.env.NEXT_PUBLIC_SUPABASE_URL
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  const start = Date.now()
  if (!url || !anon) return { ok: false, status: 'no-env', ms: 0 }
  try {
    const ctl = new AbortController()
    const to  = setTimeout(() => ctl.abort(), 7000)
    const r = await fetch(`${url}/auth/v1/health`, {
      headers: { apikey: anon },
      signal: ctl.signal,
      cache: 'no-store',
    })
    clearTimeout(to)
    return { ok: r.status === 200, status: r.status, ms: Date.now() - start }
  } catch {
    return { ok: false, status: 'timeout', ms: Date.now() - start }
  }
}

async function sendAlert(probe: { status: number | string; ms: number }) {
  const key = process.env.RESEND_API_KEY
  const to  = process.env.ALERT_EMAIL
  if (!key || !to) return
  const ref = (process.env.NEXT_PUBLIC_SUPABASE_URL || '').match(/^https:\/\/([^.]+)\./)?.[1] ?? ''
  const dash = `https://supabase.com/dashboard/project/${ref}/settings/general`
  await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: 'Steero Alerts <alerts@steero.co>',
      to: [to],
      subject: '🔴 Steero — Service Auth Supabase INJOIGNABLE (connexions bloquées)',
      html: `
        <div style="font-family:sans-serif;max-width:560px">
          <h2 style="color:#c0392b">🔴 Le service Auth de Supabase ne répond plus</h2>
          <p>Les utilisateurs ne peuvent plus se connecter et les sessions vont expirer.
             La base de données, elle, n'est pas concernée.</p>
          <table style="border-collapse:collapse;width:100%">
            <tr><td style="padding:4px 8px;font-weight:bold">Réponse Auth</td><td style="color:#c0392b">${probe.status}</td></tr>
            <tr><td style="padding:4px 8px;font-weight:bold">Latence</td><td>${probe.ms} ms</td></tr>
            <tr><td style="padding:4px 8px;font-weight:bold">Heure</td><td>${new Date().toISOString()}</td></tr>
          </table>
          <p style="margin-top:1.25rem"><strong>Action :</strong> redémarrer le projet Supabase
             (Settings → General → <em>Restart project</em>). Ça relance GoTrue et débloque le login.</p>
          <a href="${dash}" style="display:inline-block;padding:10px 20px;background:#1a1a2e;color:#fff;text-decoration:none;border-radius:6px;margin-top:0.25rem">
            Ouvrir les réglages du projet Supabase
          </a>
          <p style="margin-top:1.5rem;color:#888;font-size:0.85rem">
            Alerte automatique Steero — sonde /api/health/auth (toutes les 5 min).
          </p>
        </div>`,
    }),
  }).catch(() => {})
}

async function handle(req: NextRequest) {
  const probe = await probeAuth()
  if (!probe.ok && cronAuthorized(req)) await sendAlert(probe)
  return NextResponse.json(
    { ok: probe.ok, service: 'supabase-auth', status: probe.status, ms: probe.ms, at: new Date().toISOString() },
    { status: probe.ok ? 200 : 503 },
  )
}

export const GET  = handle
export const POST = handle
