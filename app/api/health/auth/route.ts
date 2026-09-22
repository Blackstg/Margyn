import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

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

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

// Redémarre le projet via la Management API Supabase (relance GoTrue). Inerte
// tant que SUPABASE_ACCESS_TOKEN (token sbp_…) n'est pas configuré.
async function restartProject(): Promise<{ triggered: boolean; status?: number | string; detail?: string }> {
  const token = process.env.SUPABASE_ACCESS_TOKEN
  const ref = (process.env.NEXT_PUBLIC_SUPABASE_URL || '').match(/^https:\/\/([^.]+)\./)?.[1]
  if (!token || !ref) return { triggered: false, detail: 'no-token' }
  try {
    const r = await fetch(`https://api.supabase.com/v1/projects/${ref}/restart`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    })
    return { triggered: true, status: r.status, detail: (await r.text()).slice(0, 200) }
  } catch (e) {
    return { triggered: true, status: 'error', detail: String(e).slice(0, 200) }
  }
}

async function sendRestartNotice(res: { status?: number | string; detail?: string }) {
  const key = process.env.RESEND_API_KEY
  const to  = process.env.ALERT_EMAIL
  if (!key || !to) return
  const okRestart = typeof res.status === 'number' && res.status < 300
  await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: 'Steero Alerts <alerts@steero.co>',
      to: [to],
      subject: okRestart
        ? '🔄 Steero — Auto-restart du projet Supabase déclenché'
        : '⚠️ Steero — Auto-restart Supabase ÉCHOUÉ (à faire à la main)',
      html: `<div style="font-family:sans-serif;max-width:560px">
        <h2 style="color:${okRestart ? '#1a7f4b' : '#c0392b'}">${okRestart ? '🔄 Redémarrage automatique lancé' : '⚠️ Le redémarrage automatique a échoué'}</h2>
        <p>Le service Auth était bloqué (2 vérifications de suite). ${okRestart
          ? 'Le projet a été redémarré automatiquement — l\'Auth devrait revenir dans 1-2 min.'
          : 'Merci de redémarrer le projet à la main (Settings → General → Restart project).'}</p>
        <p style="color:#888;font-size:0.85rem">Réponse Management API : ${res.status} — ${res.detail ?? ''}</p>
        <p style="font-size:0.85rem">${new Date().toISOString()}</p>
      </div>`,
    }),
  }).catch(() => {})
}

async function handle(req: NextRequest) {
  const probe = await probeAuth()
  if (probe.ok) {
    return NextResponse.json({ ok: true, service: 'supabase-auth', status: probe.status, ms: probe.ms, autoRestartArmed: !!process.env.SUPABASE_ACCESS_TOKEN, at: new Date().toISOString() })
  }

  // Auth semble down. Depuis un monitor public → on renvoie juste 503.
  if (!cronAuthorized(req)) {
    return NextResponse.json({ ok: false, service: 'supabase-auth', status: probe.status, ms: probe.ms, at: new Date().toISOString() }, { status: 503 })
  }

  // Chemin cron : double-vérification à 25 s pour ignorer les blips passagers.
  await sleep(25_000)
  const probe2 = await probeAuth()
  if (probe2.ok) {
    return NextResponse.json({ ok: true, recovered: true, at: new Date().toISOString() })
  }

  // Toujours down après 2 vérifs → alerte + auto-restart (si token configuré).
  await sendAlert(probe2)
  const restart = await restartProject()
  if (restart.triggered) await sendRestartNotice(restart)

  return NextResponse.json(
    { ok: false, service: 'supabase-auth', status: probe2.status, ms: probe2.ms, autoRestart: restart, at: new Date().toISOString() },
    { status: 503 },
  )
}

export const GET  = handle
export const POST = handle
