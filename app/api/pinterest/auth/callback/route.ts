import { NextRequest, NextResponse } from 'next/server'
import { saveInitialTokens } from '@/lib/pinterest-auth'

// ─── GET /api/pinterest/auth/callback ─────────────────────────────────────────
// Pinterest redirects here after the user approves the OAuth consent screen.
// Exchanges the authorization code for access + refresh tokens,
// saves them to Supabase (runtime) and Vercel env (deployment persistence).

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const code  = searchParams.get('code')
  const brand = searchParams.get('state') // passed via state param in /auth
  const error = searchParams.get('error')

  if (error) {
    return htmlResponse('❌ OAuth Error', `Pinterest returned an error: <strong>${error}</strong>`, '#c0392b')
  }
  if (!code || !brand || !['moom', 'bowa'].includes(brand)) {
    return htmlResponse('❌ Invalid Request', 'Missing code or unrecognized brand in state param.', '#c0392b')
  }

  const prefix       = brand.toUpperCase()
  const clientId     = process.env[`PINTEREST_CLIENT_ID_${prefix}`]     ?? process.env.PINTEREST_CLIENT_ID
  const clientSecret = process.env[`PINTEREST_CLIENT_SECRET_${prefix}`] ?? process.env.PINTEREST_CLIENT_SECRET
  const appUrl       = process.env.NEXT_PUBLIC_APP_URL

  if (!clientId || !clientSecret || !appUrl) {
    return htmlResponse('❌ Config Error', `PINTEREST_CLIENT_ID_${prefix}, PINTEREST_CLIENT_SECRET_${prefix} or NEXT_PUBLIC_APP_URL is not set.`, '#c0392b')
  }

  const redirectUri = `${appUrl}/api/pinterest/auth/callback`

  // Exchange authorization code for tokens
  const tokenRes = await fetch('https://api.pinterest.com/v5/oauth/token', {
    method: 'POST',
    headers: {
      Authorization:  `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      grant_type:   'authorization_code',
      code,
      redirect_uri: redirectUri,
    }).toString(),
    cache: 'no-store',
  })

  if (!tokenRes.ok) {
    const text = await tokenRes.text()
    return htmlResponse('❌ Token Exchange Failed', `Pinterest API returned ${tokenRes.status}:<br><code>${text}</code>`, '#c0392b')
  }

  const data = await tokenRes.json() as {
    access_token:              string
    refresh_token:             string
    expires_in:                number
    refresh_token_expires_in?: number
    scope?:                    string
  }

  if (!data.access_token || !data.refresh_token) {
    return htmlResponse('❌ Missing Tokens', 'Pinterest response did not include access_token or refresh_token.', '#c0392b')
  }

  try {
    const { accessExp, refreshExp } = await saveInitialTokens(
      brand,
      data.access_token,
      data.refresh_token,
      data.expires_in,
      data.refresh_token_expires_in ?? 31_536_000
    )

    return htmlResponse(
      '✅ Pinterest Connected',
      `
        <table style="border-collapse:collapse;width:100%;margin-top:1rem">
          <tr><td style="padding:6px 12px;font-weight:bold;background:#f5f5f5">Brand</td><td style="padding:6px 12px">${brand}</td></tr>
          <tr><td style="padding:6px 12px;font-weight:bold;background:#f5f5f5">Access token expires</td><td style="padding:6px 12px">${accessExp}</td></tr>
          <tr><td style="padding:6px 12px;font-weight:bold;background:#f5f5f5">Refresh token expires</td><td style="padding:6px 12px">${refreshExp}</td></tr>
          <tr><td style="padding:6px 12px;font-weight:bold;background:#f5f5f5">Scope</td><td style="padding:6px 12px">${data.scope ?? 'ads:read'}</td></tr>
        </table>
        <p style="margin-top:1.5rem">
          The system will automatically refresh the access token when it has fewer than 5 days of validity remaining.
          The refresh token lasts 1 year — no manual intervention needed until <strong>${refreshExp.slice(0, 10)}</strong>.
        </p>
      `,
      '#27ae60'
    )
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return htmlResponse('❌ Save Failed', `Tokens were retrieved from Pinterest but could not be saved:<br><code>${msg}</code>`, '#c0392b')
  }
}

// ─── HTML response helper ─────────────────────────────────────────────────────

function htmlResponse(title: string, body: string, color: string) {
  return new NextResponse(
    `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>${title} — Steero Pinterest Auth</title>
</head>
<body style="font-family:system-ui,sans-serif;max-width:600px;margin:3rem auto;padding:0 1.5rem">
  <h2 style="color:${color}">${title}</h2>
  ${body}
</body>
</html>`,
    { headers: { 'Content-Type': 'text/html; charset=utf-8' } }
  )
}
