// Données publiques d'une facture (page facture hébergée, lien dans l'email client).
// GET ?brand=bowa&order=<numero ou #numero>  → { order, settings }
// Public (pas d'auth) : sert uniquement une commande précise pour l'afficher au client.
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { shopifyCreds } from '@/lib/tenant/integrations'
import { loadBillingOverride, applyBillingOverride } from '@/lib/billing/overrides'

export const dynamic = 'force-dynamic'

const KNOWN_BRANDS = ['bowa', 'moom', 'krom']

const FIELDS = 'id,name,created_at,customer,total_price,subtotal_price,total_tax,total_discounts,financial_status,billing_address,currency,line_items,gateway,payment_gateway_names,refunds'

export async function GET(req: NextRequest) {
  const brand = (req.nextUrl.searchParams.get('brand') ?? 'bowa').toLowerCase()
  const orderParam = (req.nextUrl.searchParams.get('order') ?? '').trim()
  if (!KNOWN_BRANDS.includes(brand)) return NextResponse.json({ error: 'Marque inconnue' }, { status: 400 })
  const creds = await shopifyCreds(brand)
  if (!creds?.shop || !creds?.token) return NextResponse.json({ error: 'Marque inconnue' }, { status: 400 })
  if (!orderParam) return NextResponse.json({ error: 'Commande manquante' }, { status: 400 })

  try {
    // Recherche par NUMÉRO de commande (name) — l'email Shopify fournit order_number.
    // On accepte "10462", "#10462" ou l'id interne (chiffres longs).
    let order: unknown = null
    const name = orderParam.startsWith('#') ? orderParam : `#${orderParam.replace(/^#/, '')}`
    const byName = await fetch(
      `https://${creds.shop}/admin/api/2024-01/orders.json?status=any&name=${encodeURIComponent(name)}&fields=${FIELDS}`,
      { headers: { 'X-Shopify-Access-Token': creds.token }, cache: 'no-store' },
    )
    if (byName.ok) {
      const d = await byName.json() as { orders?: unknown[] }
      order = d.orders?.[0] ?? null
    }
    // Repli : id interne Shopify (si le param est un id long)
    if (!order && /^\d{6,}$/.test(orderParam)) {
      const byId = await fetch(
        `https://${creds.shop}/admin/api/2024-01/orders/${orderParam}.json?fields=${FIELDS}`,
        { headers: { 'X-Shopify-Access-Token': creds.token }, cache: 'no-store' },
      )
      if (byId.ok) order = (await byId.json()).order ?? null
    }
    if (!order) return NextResponse.json({ error: 'Commande introuvable' }, { status: 404 })

    const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } })
    const { data: settings } = await sb.from('invoice_settings').select('*').eq('brand', brand).maybeSingle()

    const o = order as { id?: number; billing_address?: Record<string, unknown> | null }
    const override = o.id ? await loadBillingOverride(brand, o.id) : null
    // Champs internes (auteur de la modif) non exposés sur la page publique.
    const merged = applyBillingOverride(o, override)
    delete (merged as { billing_override?: unknown }).billing_override

    return NextResponse.json({ order: merged, settings: settings ?? null })
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 })
  }
}
