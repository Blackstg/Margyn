// Retour d'installation Shopify : vérifie state + HMAC, échange le code contre un
// jeton et l'enregistre chiffré dans tenant_integrations (type 'shopify').
// Le jeton n'est jamais affiché ni journalisé.
import { NextRequest, NextResponse } from 'next/server'
import crypto from 'crypto'
import { BRANDS, BRAND_LABELS, type Brand } from '@/lib/access'
import { saveShopifyToken } from '@/lib/tenant/integrations'

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
  return digest.length === hmac.length && crypto.timingSafeEqual(Buffer.from(digest), Buffer.from(hmac))
}

function page(title: string, body: string, status = 200) {
  return new NextResponse(
    `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${title}</title>
    <style>body{font-family:'Helvetica Neue',sans-serif;background:#faf9f8;color:#1a1a2e;padding:48px}
    h2{font-size:20px}p{color:#6b6b63;font-size:14px}a{color:#1a1a2e}</style></head><body>${body}</body></html>`,
    { status, headers: { 'Content-Type': 'text/html; charset=utf-8' } },
  )
}

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl
  const shop  = searchParams.get('shop')
  const code  = searchParams.get('code')
  const state = searchParams.get('state')
  const [brand, expectedShop] = (req.cookies.get('shopify_oauth_brand')?.value ?? '').split('|')

  if (!shop || !code) return page('Erreur', '<h2>Paramètres manquants</h2>', 400)
  if (!validateHmac(searchParams)) return page('Erreur', '<h2>Signature Shopify invalide</h2>', 403)
  if (!state || state !== req.cookies.get('shopify_oauth_state')?.value || !(BRANDS as string[]).includes(brand) || shop !== expectedShop) {
    return page('Erreur', '<h2>Session d’installation expirée</h2><p>Relance l’installation depuis Steero (lien valable 10 min).</p>', 400)
  }

  const tokenRes = await fetch(`https://${shop}/admin/oauth/access_token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ client_id: CLIENT_ID, client_secret: CLIENT_SECRET, code }),
  })
  const payload = await tokenRes.json().catch(() => ({})) as { access_token?: string; scope?: string }
  if (!payload.access_token) return page('Erreur', '<h2>Échange du jeton refusé par Shopify</h2>', 500)

  const label = BRAND_LABELS[brand as Brand]
  const error = await saveShopifyToken(brand, shop, payload.access_token)
  if (error) return page('Erreur', `<h2>Enregistrement impossible</h2><p>${error.replace(/</g, '&lt;')}</p>`, 500)

  const res = page(`${label} — Shopify connecté`,
    `<h2 style="color:#1a7f4b">✓ ${label} connecté à Steero</h2>
     <p>Boutique : <strong>${shop}</strong><br>Accès : <strong>${payload.scope ?? ''}</strong></p>
     <p>Le jeton est enregistré chiffré. <a href="/${brand}/dashboard">Ouvrir le dashboard ${label}</a></p>`)
  res.cookies.delete('shopify_oauth_state')
  res.cookies.delete('shopify_oauth_brand')
  return res
}
