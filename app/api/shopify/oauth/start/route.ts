import { NextRequest, NextResponse } from 'next/server'
import crypto from 'crypto'

const CLIENT_ID = process.env.SHOPIFY_CLIENT_ID!
const SCOPES    = 'read_orders,read_products,read_inventory'

export async function GET(req: NextRequest) {
  const shop        = req.nextUrl.searchParams.get('shop') ?? 'krom-7516.myshopify.com'
  const state       = crypto.randomBytes(16).toString('hex')
  const redirectUri = `${req.nextUrl.origin}/api/shopify/oauth/callback`

  const authUrl =
    `https://${shop}/admin/oauth/authorize?` +
    new URLSearchParams({ client_id: CLIENT_ID, scope: SCOPES, redirect_uri: redirectUri, state })

  const res = NextResponse.redirect(authUrl)
  res.cookies.set('shopify_oauth_state', state, { httpOnly: true, maxAge: 600, path: '/' })
  return res
}
