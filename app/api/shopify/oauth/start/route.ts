// Installation de l'app Steero sur une boutique Shopify (admin connecté uniquement).
// /api/shopify/oauth/start?brand=yone&shop=xxx.myshopify.com → Shopify → callback,
// qui enregistre le jeton chiffré dans tenant_integrations (jamais affiché).
import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@supabase/auth-helpers-nextjs'
import crypto from 'crypto'
import { BRANDS, effectiveBrands, isAdminRole } from '@/lib/access'
import { cfgStr, getIntegration } from '@/lib/tenant/integrations'

const CLIENT_ID = (process.env.SHOPIFY_CLIENT_ID ?? '').trim()
const SCOPES    = 'read_orders,read_products,read_inventory'
const SHOP_RE   = /^[a-z0-9][a-z0-9-]*\.myshopify\.com$/

type CookieToSet = { name: string; value: string; options?: Record<string, unknown> }

// Session lue ET renouvelée ici : les routes /api/ ne passent pas par le
// middleware, donc un jeton d'accès expiré doit être rafraîchi et réécrit sur la réponse.
async function adminFor(req: NextRequest, brand: string): Promise<{ user: boolean; admin: boolean; refreshed: CookieToSet[] }> {
  const refreshed: CookieToSet[] = []
  try {
    const sb = createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
      cookies: { getAll() { return req.cookies.getAll() }, setAll(list: CookieToSet[]) { refreshed.push(...list) } },
    })
    const { data: { user } } = await sb.auth.getUser()
    const m = user?.user_metadata ?? {}
    return { user: !!user, admin: !!user && isAdminRole(m.role) && (effectiveBrands(m.role, m.brands) as string[]).includes(brand), refreshed }
  } catch { return { user: false, admin: false, refreshed } }
}

function withCookies(res: NextResponse, list: CookieToSet[]) {
  list.forEach(({ name, value, options }) => res.cookies.set(name, value, options))
  return res
}

export async function GET(req: NextRequest) {
  const brand = req.nextUrl.searchParams.get('brand') ?? ''
  const shop  = (req.nextUrl.searchParams.get('shop') ?? '').trim().toLowerCase()
  if (!(BRANDS as string[]).includes(brand)) return NextResponse.json({ error: 'Marque inconnue' }, { status: 400 })
  const auth = await adminFor(req, brand)
  if (!auth.user) return NextResponse.redirect(new URL('/login', req.url))
  if (!auth.admin) return withCookies(NextResponse.json({ error: 'Réservé aux admins' }, { status: 403 }), auth.refreshed)

  // ?status=1 → état de la connexion (bouton des Paramètres)
  if (req.nextUrl.searchParams.get('status')) {
    const integ = await getIntegration(brand, 'shopify')
    return withCookies(NextResponse.json({ shop: cfgStr(integ, 'shop') ?? null, connected: !!integ?.secret }), auth.refreshed)
  }
  if (!SHOP_RE.test(shop)) return withCookies(NextResponse.json({ error: 'Boutique invalide (xxx.myshopify.com)' }, { status: 400 }), auth.refreshed)

  const state       = crypto.randomBytes(16).toString('hex')
  const redirectUri = `${req.nextUrl.origin}/api/shopify/oauth/callback`
  const authUrl =
    `https://${shop}/admin/oauth/authorize?` +
    new URLSearchParams({ client_id: CLIENT_ID, scope: SCOPES, redirect_uri: redirectUri, state })

  const res = withCookies(NextResponse.redirect(authUrl), auth.refreshed)
  const opts = { httpOnly: true, secure: true, sameSite: 'lax' as const, maxAge: 600, path: '/' }
  res.cookies.set('shopify_oauth_state', state, opts)
  res.cookies.set('shopify_oauth_brand', `${brand}|${shop}`, opts)
  return res
}
