import { NextRequest, NextResponse } from 'next/server'

// ─── GET /api/pinterest/auth?brand=moom|bowa ──────────────────────────────────
// Redirects the browser to the Pinterest OAuth consent screen.
// After the user approves, Pinterest redirects to /api/pinterest/auth/callback
// with ?code=...&state=<brand>.
//
// Prerequisites (set in Vercel env + .env.local):
//   PINTEREST_CLIENT_ID     — from developers.pinterest.com
//   PINTEREST_CLIENT_SECRET — from developers.pinterest.com
//   NEXT_PUBLIC_APP_URL     — e.g. https://steero.vercel.app
//
// The callback URL must be registered in the Pinterest app:
//   {NEXT_PUBLIC_APP_URL}/api/pinterest/auth/callback

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const brand = searchParams.get('brand')

  if (!brand || !['moom', 'bowa'].includes(brand)) {
    return NextResponse.json(
      { error: 'brand query param must be "moom" or "bowa"' },
      { status: 400 }
    )
  }

  const prefix   = brand.toUpperCase()
  const clientId = process.env[`PINTEREST_CLIENT_ID_${prefix}`] ?? process.env.PINTEREST_CLIENT_ID
  const appUrl   = process.env.NEXT_PUBLIC_APP_URL

  if (!clientId) {
    return NextResponse.json(
      { error: `PINTEREST_CLIENT_ID_${prefix} env var is not set` },
      { status: 500 }
    )
  }
  if (!appUrl) {
    return NextResponse.json(
      { error: 'NEXT_PUBLIC_APP_URL env var is not set' },
      { status: 500 }
    )
  }

  const redirectUri = `${appUrl}/api/pinterest/auth/callback`

  const authUrl = new URL('https://www.pinterest.com/oauth/')
  authUrl.searchParams.set('client_id',     clientId)
  authUrl.searchParams.set('redirect_uri',  redirectUri)
  authUrl.searchParams.set('response_type', 'code')
  authUrl.searchParams.set('scope',         'ads:read')
  authUrl.searchParams.set('state',         brand)

  return NextResponse.redirect(authUrl.toString())
}
