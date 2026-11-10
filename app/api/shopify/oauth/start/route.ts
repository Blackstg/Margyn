// Connexion Shopify lancée depuis Steero (Paramètres → Connecter Shopify), admin connecté.
// /api/shopify/oauth/start?brand=yone&shop=xxx.myshopify.com → Shopify → callback.
// ?brand=…&status=1 → état de la connexion pour la carte des Paramètres.
import { NextRequest, NextResponse } from 'next/server'
import { BRANDS } from '@/lib/access'
import { cfgStr, getIntegration } from '@/lib/tenant/integrations'
import { SHOP_RE, adminSession, appsForShop, authorizeRedirect, customApp, withCookies } from '@/lib/shopify/app'

export async function GET(req: NextRequest) {
  const brand = req.nextUrl.searchParams.get('brand') ?? ''
  const shop  = (req.nextUrl.searchParams.get('shop') ?? '').trim().toLowerCase()
  if (!(BRANDS as string[]).includes(brand)) return NextResponse.json({ error: 'Marque inconnue' }, { status: 400 })
  const auth = await adminSession(req, brand)
  if (!auth.user) return NextResponse.redirect(new URL('/login', req.url))
  if (!auth.admin) return withCookies(NextResponse.json({ error: 'Réservé aux admins' }, { status: 403 }), auth.refreshed)

  if (req.nextUrl.searchParams.get('status')) {
    const integ  = await getIntegration(brand, 'shopify')
    const custom = await customApp(brand)
    return withCookies(NextResponse.json({
      shop: cfgStr(integ, 'shop') ?? null, connected: !!integ?.secret, customClientId: custom?.clientId ?? null,
    }), auth.refreshed)
  }
  if (!SHOP_RE.test(shop)) return withCookies(NextResponse.json({ error: 'Boutique invalide (xxx.myshopify.com)' }, { status: 400 }), auth.refreshed)

  const [app] = await appsForShop(shop, brand)
  if (!app) return withCookies(NextResponse.json({ error: 'Aucune app Shopify configurée' }, { status: 500 }), auth.refreshed)
  const res = withCookies(new NextResponse(null, { status: 302 }), auth.refreshed)
  return authorizeRedirect(res, req.nextUrl.origin, shop, app, brand)
}
