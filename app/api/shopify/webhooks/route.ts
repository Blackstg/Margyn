// Webhooks de l'app Shopify (déclarés dans shopify.app.toml) :
//   · app/uninstalled  → on oublie le jeton de la boutique ;
//   · conformité RGPD obligatoire (customers/data_request, customers/redact,
//     shop/redact) → journalisés sans données perso dans Storage
//     app-config/shopify-compliance/, à traiter sous 30 jours.
// Signature vérifiée sur le corps brut ; 401 si invalide (exigé par Shopify).
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { clearShopifyToken, tenantForShop } from '@/lib/tenant/integrations'
import { SHOP_RE, appsForShop, validWebhookHmac } from '@/lib/shopify/app'

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  const raw   = await req.text()
  const topic = req.headers.get('x-shopify-topic') ?? ''
  const shop  = req.headers.get('x-shopify-shop-domain') ?? ''
  const hmac  = req.headers.get('x-shopify-hmac-sha256')
  if (!SHOP_RE.test(shop)) return NextResponse.json({ error: 'bad shop' }, { status: 401 })

  const tenant = await tenantForShop(shop)
  const apps = await appsForShop(shop, tenant)
  if (!apps.some(a => validWebhookHmac(raw, hmac, a.secret))) return NextResponse.json({ error: 'bad hmac' }, { status: 401 })

  let body: Record<string, unknown> = {}
  try { body = JSON.parse(raw) } catch {}

  if (topic === 'app/uninstalled' || topic === 'shop/redact') {
    if (tenant) await clearShopifyToken(tenant)
  }
  if (topic === 'customers/data_request' || topic === 'customers/redact' || topic === 'shop/redact') {
    const customer = body.customer as { id?: number } | undefined
    const entry = {
      topic, shop, tenant, receivedAt: new Date().toISOString(), status: 'à traiter',
      customerId: customer?.id ?? null,
      orders: (body.orders_requested ?? body.orders_to_redact ?? []) as number[],
      requestId: (body.data_request as { id?: number } | undefined)?.id ?? null,
    }
    const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { autoRefreshToken: false, persistSession: false } })
    const path = `shopify-compliance/${entry.receivedAt.slice(0, 10)}-${topic.replace('/', '_')}-${shop}-${Date.now()}.json`
    await db.storage.from('app-config').upload(path, JSON.stringify(entry, null, 2), { contentType: 'application/json' })
  }
  return NextResponse.json({ ok: true })
}
