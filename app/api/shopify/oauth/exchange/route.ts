// Installation « embarquée » (Shopify ouvre /install avec un id_token) : échange
// contre un jeton hors-ligne, rangé chiffré pour la boutique pré-enregistrée.
// Le jeton n'est jamais renvoyé au navigateur.
import { NextRequest, NextResponse } from 'next/server'
import { saveShopifyToken, tenantForShop } from '@/lib/tenant/integrations'

const CLIENT_ID     = process.env.SHOPIFY_CLIENT_ID!
const CLIENT_SECRET = process.env.SHOPIFY_CLIENT_SECRET!
const SHOP_RE       = /^[a-z0-9][a-z0-9-]*\.myshopify\.com$/

export async function POST(req: NextRequest) {
  const { shop, id_token } = await req.json().catch(() => ({}))
  if (typeof shop !== 'string' || !SHOP_RE.test(shop) || typeof id_token !== 'string') {
    return NextResponse.json({ error: 'Missing shop or id_token' }, { status: 400 })
  }
  const tenant = await tenantForShop(shop)
  if (!tenant) return NextResponse.json({ error: 'Boutique non enregistrée dans Steero' }, { status: 404 })

  const res = await fetch(`https://${shop}/admin/oauth/access_token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_id:            CLIENT_ID,
      client_secret:        CLIENT_SECRET,
      grant_type:           'urn:ietf:params:oauth:grant-type:token-exchange',
      subject_token:        id_token,
      subject_token_type:   'urn:ietf:params:oauth:token-type:id_token',
      requested_token_type: 'urn:shopify:params:oauth:token-type:offline-access-token',
    }),
  })
  const data = await res.json().catch(() => ({})) as { access_token?: string; scope?: string }
  if (!data.access_token) return NextResponse.json({ error: 'Échange refusé par Shopify' }, { status: 502 })

  const err = await saveShopifyToken(tenant, shop, data.access_token)
  if (err) return NextResponse.json({ error: err }, { status: 500 })
  return NextResponse.json({ ok: true, brand: tenant, scope: data.scope })
}
