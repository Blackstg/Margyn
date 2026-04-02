import { NextRequest, NextResponse } from 'next/server'
import crypto from 'crypto'

const CLIENT_ID     = process.env.SHOPIFY_CLIENT_ID!
const CLIENT_SECRET = process.env.SHOPIFY_CLIENT_SECRET!

function validateHmac(params: URLSearchParams): boolean {
  const hmac = params.get('hmac')
  if (!hmac) return false
  const message = Array.from(params.entries())
    .filter(([k]) => k !== 'hmac')
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}=${v}`)
    .join('&')
  const digest = crypto.createHmac('sha256', CLIENT_SECRET).update(message).digest('hex')
  return crypto.timingSafeEqual(Buffer.from(digest), Buffer.from(hmac))
}

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl
  const shop  = searchParams.get('shop')
  const code  = searchParams.get('code')

  if (!shop || !code) {
    return NextResponse.json({
      error: 'Missing parameters',
      received: Object.fromEntries(searchParams.entries()),
    }, { status: 400 })
  }

  if (!validateHmac(searchParams)) {
    return NextResponse.json({ error: 'Invalid HMAC' }, { status: 403 })
  }

  const tokenRes = await fetch(`https://${shop}/admin/oauth/access_token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ client_id: CLIENT_ID, client_secret: CLIENT_SECRET, code }),
  })
  const payload = await tokenRes.json() as { access_token?: string; scope?: string; errors?: string }

  if (!payload.access_token) {
    return NextResponse.json({ error: 'Token exchange failed', details: payload }, { status: 500 })
  }

  const token = payload.access_token

  return new NextResponse(
    `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Krom — Token OK</title>
    <style>
      body { font-family: 'Helvetica Neue', sans-serif; background: #faf9f8; color: #1a1a2e; padding: 48px; }
      h2 { color: #1a7f4b; font-size: 20px; }
      pre { background: #1a1a2e; color: #dcf5e7; padding: 24px; border-radius: 12px; font-size: 14px; word-break: break-all; white-space: pre-wrap; }
      p { color: #6b6b63; font-size: 14px; }
      strong { color: #1a1a2e; }
    </style></head><body>
    <h2>✓ Token obtenu avec succès</h2>
    <p>Boutique : <strong>${shop}</strong><br>Scopes : <strong>${payload.scope}</strong></p>
    <p>Ajoute cette variable dans <strong>Vercel → Settings → Environment Variables</strong> :</p>
    <pre>SHOPIFY_KROM_ACCESS_TOKEN=${token}</pre>
    </body></html>`,
    { headers: { 'Content-Type': 'text/html' } },
  )
}
