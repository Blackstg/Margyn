// Retour d'autorisation Shopify : vérifie state + HMAC, échange le code et range le
// jeton chiffré. Marque : celle choisie dans Steero, sinon celle déjà rattachée à
// la boutique, sinon une nouvelle marque « en attente ». Jeton jamais affiché.
import { NextRequest } from 'next/server'
import { BRAND_LABELS, type Brand } from '@/lib/access'
import { saveShopifyToken, tenantForShop } from '@/lib/tenant/integrations'
import { SHOP_RE, appsForShop, ensurePendingTenant, exchangeCode, htmlPage, validQueryHmac } from '@/lib/shopify/app'

export async function GET(req: NextRequest) {
  const params = req.nextUrl.searchParams
  const shop  = params.get('shop') ?? ''
  const code  = params.get('code')
  const state = params.get('state')
  const [cookieBrand, cookieShop] = (req.cookies.get('shopify_oauth_brand')?.value ?? '').split('|')

  if (!SHOP_RE.test(shop) || !code) return htmlPage('Erreur', '<h2>Paramètres manquants</h2>', 400)
  if (!state || state !== req.cookies.get('shopify_oauth_state')?.value || cookieShop !== shop) {
    return htmlPage('Erreur', '<h2>Session d’installation expirée</h2><p>Relance l’installation (lien valable 10 min).</p>', 400)
  }

  const known = await tenantForShop(shop)
  const app = (await appsForShop(shop, cookieBrand || known)).find(a => validQueryHmac(params, a.secret))
  if (!app) return htmlPage('Erreur', '<h2>Signature Shopify invalide</h2>', 403)

  const { token, scope } = await exchangeCode(shop, app, code)
  if (!token) return htmlPage('Erreur', '<h2>Échange du jeton refusé par Shopify</h2>', 502)

  const tenant  = cookieBrand || known || await ensurePendingTenant(shop)
  const pending = !cookieBrand && !known
  const error = await saveShopifyToken(tenant, shop, token)
  if (error) return htmlPage('Erreur', `<h2>Enregistrement impossible</h2><p>${error.replace(/</g, '&lt;')}</p>`, 500)

  const label = BRAND_LABELS[tenant as Brand] ?? shop
  const res = htmlPage(`${label} — Shopify connecté`, pending
    ? `<h2 style="color:#1a7f4b">✓ Steero est installé sur ${shop}</h2>
       <p>Ta boutique est connectée. L’équipe Steero active ton espace et te contacte.</p>`
    : `<h2 style="color:#1a7f4b">✓ ${label} connecté à Steero</h2>
       <p>Boutique : <strong>${shop}</strong><br>Accès : <strong>${scope ?? ''}</strong></p>
       <p>Le jeton est enregistré chiffré. <a href="/${tenant}/dashboard">Ouvrir le dashboard ${label}</a></p>`)
  res.headers.append('Set-Cookie', 'shopify_oauth_state=; Path=/; Max-Age=0')
  res.headers.append('Set-Cookie', 'shopify_oauth_brand=; Path=/; Max-Age=0')
  return res
}
