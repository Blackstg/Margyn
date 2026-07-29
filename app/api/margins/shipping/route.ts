// Coût de livraison RÉEL par produit (Moom) à partir des factures logisticien.
//   GET ?brand=moom&from=YYYY-MM-DD&to=YYYY-MM-DD
//   → { byVariant: {variant_id: €}, byProduct: {product_id: €}, matched, total, real }
//
// Principe : chaque commande a un coût réel facturé (logistician_invoice_summaries).
// On relie order_name (facture) ↔ order_id (product_sales) via Shopify (id↔name),
// puis on répartit le coût réel de chaque commande sur ses produits au prorata du CA.
import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

const SHOPIFY: Record<string, { shop: string; token: string }> = {
  moom: { shop: process.env.SHOPIFY_MOOM_SHOP!, token: process.env.SHOPIFY_MOOM_ACCESS_TOKEN! },
  krom: { shop: process.env.SHOPIFY_KROM_SHOP!, token: process.env.SHOPIFY_KROM_ACCESS_TOKEN! },
}

const norm = (v: unknown) => String(v ?? '').toLowerCase().replace(/[\s#_-]/g, '')

interface InvoiceRow { order_name: string; total_price: number }
interface Sale { shopify_product_id: string | null; variant_id: string | null; revenue: number; order_id: string | null }

export async function GET(req: NextRequest) {
  const brand = req.nextUrl.searchParams.get('brand') ?? ''
  const from  = req.nextUrl.searchParams.get('from') ?? ''
  const to    = req.nextUrl.searchParams.get('to')   ?? ''
  const creds = SHOPIFY[brand]
  if (!creds || !from || !to) return NextResponse.json({ byVariant: {}, byProduct: {}, matched: 0, total: 0, real: 0 })

  const admin = createAdminClient()

  // 1. Factures logisticien → coût réel par commande (mois chevauchant la période)
  const months = [...new Set([from.slice(0, 7), to.slice(0, 7)])]
  const { data: sums } = await admin
    .from('logistician_invoice_summaries')
    .select('invoice_rows').eq('brand', brand).in('month', months)
  const realByName = new Map<string, number>()
  for (const s of sums ?? []) {
    for (const r of (s.invoice_rows ?? []) as InvoiceRow[]) {
      const k = norm(r.order_name)
      if (!k) continue
      realByName.set(k, (realByName.get(k) ?? 0) + (Number(r.total_price) || 0))
    }
  }

  // Tarif moyen (repli pour les commandes pas encore facturées)
  const { data: bs } = await admin.from('brand_settings').select('shipping_cost_per_order').eq('brand', brand).maybeSingle()
  const flat = Number(bs?.shipping_cost_per_order) || 0

  // 2. Ventes par ligne sur la période — paginé (PostgREST plafonne à 1000 lignes).
  const salesRows: Sale[] = []
  for (let offset = 0; ; offset += 1000) {
    const { data, error } = await admin
      .from('product_sales')
      .select('shopify_product_id, variant_id, revenue, order_id')
      .eq('brand', brand).gte('date', from).lte('date', to)
      .order('order_id', { ascending: true, nullsFirst: false })
      .order('variant_id', { ascending: true, nullsFirst: false })
      .range(offset, offset + 999)
    if (error || !data || data.length === 0) break
    salesRows.push(...(data as Sale[]))
    if (data.length < 1000) break
  }

  // 3. Mapping order_id → order_name via Shopify (commandes de la période)
  const idToName = new Map<string, string>()
  let url: string | null =
    `https://${creds.shop}/admin/api/2024-01/orders.json?status=any&limit=250` +
    `&created_at_min=${from}T00:00:00Z&created_at_max=${to}T23:59:59Z&fields=id,name`
  try {
    while (url) {
      const r: Response = await fetch(url, { headers: { 'X-Shopify-Access-Token': creds.token }, cache: 'no-store' })
      if (!r.ok) break
      const j = await r.json() as { orders?: { id: number; name: string }[] }
      for (const o of j.orders ?? []) idToName.set(String(o.id), o.name)
      const link: string | null = r.headers.get('Link')
      url = link ? link.match(/<([^>]+)>;\s*rel="next"/)?.[1] ?? null : null
    }
  } catch { /* best-effort */ }

  // 4. Coût réel par commande présente dans les ventes, réparti au prorata du CA
  const orderRevenue = new Map<string, number>()
  for (const s of salesRows) if (s.order_id) orderRevenue.set(s.order_id, (orderRevenue.get(s.order_id) ?? 0) + (s.revenue || 0))

  const byVariant: Record<string, number> = {}
  const byProduct: Record<string, number> = {}
  const matchedOrders = new Set<string>()
  let total = 0

  for (const s of salesRows) {
    if (!s.order_id) continue
    const name = idToName.get(String(s.order_id))
    const real = name ? realByName.get(norm(name)) : undefined
    const orderCost = real != null ? real : flat // réel si facturé, sinon moyenne paramétrée
    const tot = orderRevenue.get(s.order_id) ?? 0
    const share = tot > 0 ? orderCost * ((s.revenue || 0) / tot) : 0
    if (s.variant_id) byVariant[String(s.variant_id)] = (byVariant[String(s.variant_id)] ?? 0) + share
    if (s.shopify_product_id) byProduct[String(s.shopify_product_id)] = (byProduct[String(s.shopify_product_id)] ?? 0) + share
    if (real != null) matchedOrders.add(s.order_id)
    total += share
  }

  return NextResponse.json({
    byVariant, byProduct,
    matched: matchedOrders.size,   // commandes avec coût RÉEL (facturé)
    orders: orderRevenue.size,     // commandes totales sur la période
    real: Math.round(total),
  })
}
