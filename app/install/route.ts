// URL de l'app (application_url) : Shopify y envoie le marchand qui installe ou
// ouvre Steero (?shop=&hmac=&timestamp=). On vérifie la signature puis on lance
// l'autorisation OAuth ; le callback range le jeton.
import { NextRequest, NextResponse } from 'next/server'
import { SHOP_RE, appsForShop, authorizeRedirect, htmlPage, validQueryHmac } from '@/lib/shopify/app'

export async function GET(req: NextRequest) {
  const params = req.nextUrl.searchParams
  const shop = params.get('shop') ?? ''
  if (!SHOP_RE.test(shop)) {
    return htmlPage('Steero', '<h2>Installer Steero</h2><p>Lance l’installation depuis l’admin de ta boutique Shopify.</p>', 400)
  }
  const ts = Number(params.get('timestamp'))
  if (!ts || Math.abs(Date.now() / 1000 - ts) > 600) return htmlPage('Erreur', '<h2>Lien expiré</h2><p>Relance depuis Shopify.</p>', 400)

  const app = (await appsForShop(shop)).find(a => validQueryHmac(params, a.secret))
  if (!app) return htmlPage('Erreur', '<h2>Signature Shopify invalide</h2>', 403)
  return authorizeRedirect(new NextResponse(null, { status: 302 }), req.nextUrl.origin, shop, app, null)
}
