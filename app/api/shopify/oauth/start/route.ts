// Installation de l'app Steero sur une boutique Shopify (admin connecté uniquement).
// /api/shopify/oauth/start?brand=yone&shop=xxx.myshopify.com → Shopify → callback,
// qui enregistre le jeton chiffré dans tenant_integrations (jamais affiché).
import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@supabase/auth-helpers-nextjs'
import { cookies } from 'next/headers'
import crypto from 'crypto'
import { BRANDS, effectiveBrands, isAdminRole } from '@/lib/access'

const CLIENT_ID = process.env.SHOPIFY_CLIENT_ID!
const SCOPES    = 'read_orders,read_products,read_inventory'
const SHOP_RE   = /^[a-z0-9][a-z0-9-]*\.myshopify\.com$/

async function isAdminFor(brand: string): Promise<boolean> {
  try {
    const store = await cookies()
    const sb = createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      { cookies: { getAll() { return store.getAll() }, setAll() {} } })
    const { data: { user } } = await sb.auth.getUser()
    const m = user?.user_metadata ?? {}
    return !!user && isAdminRole(m.role) && (effectiveBrands(m.role, m.brands) as string[]).includes(brand)
  } catch { return false }
}

export async function GET(req: NextRequest) {
  const brand = req.nextUrl.searchParams.get('brand') ?? ''
  const shop  = (req.nextUrl.searchParams.get('shop') ?? '').trim().toLowerCase()
  if (!(BRANDS as string[]).includes(brand)) return NextResponse.json({ error: 'Marque inconnue' }, { status: 400 })
  if (!SHOP_RE.test(shop)) return NextResponse.json({ error: 'Boutique invalide (xxx.myshopify.com)' }, { status: 400 })
  if (!(await isAdminFor(brand))) return NextResponse.json({ error: 'Réservé aux admins connectés' }, { status: 403 })

  const state       = crypto.randomBytes(16).toString('hex')
  const redirectUri = `${req.nextUrl.origin}/api/shopify/oauth/callback`
  const authUrl =
    `https://${shop}/admin/oauth/authorize?` +
    new URLSearchParams({ client_id: CLIENT_ID, scope: SCOPES, redirect_uri: redirectUri, state })

  const res = NextResponse.redirect(authUrl)
  const opts = { httpOnly: true, secure: true, sameSite: 'lax' as const, maxAge: 600, path: '/' }
  res.cookies.set('shopify_oauth_state', state, opts)
  res.cookies.set('shopify_oauth_brand', `${brand}|${shop}`, opts)
  return res
}
