// Coût de livraison RÉEL par commande VENDUE sur une période (Moom), rapproché PAR
// NUMÉRO DE COMMANDE avec les factures logisticien. Source unique du tableau de bord
// (/api/margins/fulfillment, total) et de la page Marges (/api/margins/shipping,
// réparti par produit) : les deux doivent toujours donner le même chiffre.
//
// Une facture (Hao) couvre les commandes EXPÉDIÉES un mois donné (≠ VENDUES ce mois) :
// on cherche donc chaque commande dans TOUTES les factures, montants USD convertis en
// EUR au taux du mois. Commandes pas encore facturées : coût réel moyen/commande de la
// facture la plus récente, le tarif paramétré n'étant qu'un ultime secours.
import 'server-only'
import { createAdminClient } from '@/lib/supabase'

const SHOPIFY: Record<string, { shop: string; token: string }> = {
  moom: { shop: process.env.SHOPIFY_MOOM_SHOP!, token: process.env.SHOPIFY_MOOM_ACCESS_TOKEN! },
  krom: { shop: process.env.SHOPIFY_KROM_SHOP!, token: process.env.SHOPIFY_KROM_ACCESS_TOKEN! },
}

const norm = (v: unknown) => String(v ?? '').toLowerCase().replace(/[\s#_-]/g, '')

interface InvoiceRow { order_name: string; total_price: number }

export type SaleLine = { shopify_product_id: string | null; variant_id: string | null; revenue: number; order_id: string | null }

export type OrderShippingCosts = {
  sales: SaleLine[]                     // lignes de vente de la période
  costByOrder: Map<string, number>      // order_id → coût EUR (réel ou estimé)
  matched: number                       // commandes au coût réel facturé
  estimated: number                     // commandes au coût moyen de repli
  fallbackCpo: number
  estLabel: string                      // « coût réel moyen octobre 2026 » / « tarif moyen »
}

// Taux USD→EUR du mois (1er du mois suivant), comme /api/exchange-rate.
async function eurRate(month: string): Promise<number> {
  const [y, m] = month.split('-').map(Number)
  const date = m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, '0')}-01`
  try {
    const r = await fetch(`https://api.frankfurter.dev/v1/${date}?from=USD&to=EUR`, { next: { revalidate: 86400 } })
    if (!r.ok) return 0.92
    const d = await r.json() as { rates?: { EUR?: number } }
    return d.rates?.EUR ?? 0.92
  } catch { return 0.92 }
}

export async function orderShippingCosts(brand: string, from: string, to: string): Promise<OrderShippingCosts | null> {
  const creds = SHOPIFY[brand]
  if (!creds) return null
  const admin = createAdminClient()

  // 1. Toutes les factures → coût réel EUR par n° de commande + moyenne par mois.
  const { data: sums } = await admin.from('logistician_invoice_summaries').select('month, invoice_rows').eq('brand', brand)
  const realEurByName = new Map<string, number>()
  const monthAgg = new Map<string, { eur: number; count: number }>()
  for (const s of (sums ?? []) as { month: string; invoice_rows?: InvoiceRow[] | null }[]) {
    const rate = await eurRate(s.month)
    const agg = monthAgg.get(s.month) ?? { eur: 0, count: 0 }
    for (const r of s.invoice_rows ?? []) {
      const k = norm(r.order_name)
      if (!k) continue
      const eur = (Number(r.total_price) || 0) * rate
      realEurByName.set(k, (realEurByName.get(k) ?? 0) + eur)
      agg.eur += eur; agg.count++
    }
    monthAgg.set(s.month, agg)
  }

  const { data: bs } = await admin.from('brand_settings').select('shipping_cost_per_order').eq('brand', brand).maybeSingle()
  const flat = Number(bs?.shipping_cost_per_order) || 0
  const latestInvMonth = [...monthAgg.keys()].sort().at(-1)
  const latestAgg = latestInvMonth ? monthAgg.get(latestInvMonth)! : null
  const recentCpo = latestAgg && latestAgg.count > 0 ? latestAgg.eur / latestAgg.count : 0
  const fallbackCpo = recentCpo > 0 ? recentCpo : flat
  const latestLabel = latestInvMonth
    ? new Date(Number(latestInvMonth.slice(0, 4)), Number(latestInvMonth.slice(5, 7)) - 1, 15).toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' })
    : ''

  // 2. Ventes de la période — paginé (PostgREST plafonne à 1000 lignes).
  const sales: SaleLine[] = []
  for (let offset = 0; ; offset += 1000) {
    const { data, error } = await admin.from('product_sales')
      .select('shopify_product_id, variant_id, revenue, order_id')
      .eq('brand', brand).gte('date', from).lte('date', to)
      .order('order_id', { ascending: true, nullsFirst: false })
      .order('variant_id', { ascending: true, nullsFirst: false })
      .range(offset, offset + 999)
    if (error || !data || data.length === 0) break
    sales.push(...(data as SaleLine[]))
    if (data.length < 1000) break
  }

  // 3. order_id → order_name via Shopify (commandes créées sur la période).
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

  // 4. Coût par commande : réel si facturée, sinon moyenne de la dernière facture.
  const costByOrder = new Map<string, number>()
  let matched = 0, estimated = 0
  for (const s of sales) {
    const oid = s.order_id ? String(s.order_id) : ''
    if (!oid || costByOrder.has(oid)) continue
    const name = idToName.get(oid)
    const real = name ? realEurByName.get(norm(name)) : undefined
    if (real != null) { costByOrder.set(oid, real); matched++ }
    else { costByOrder.set(oid, fallbackCpo); estimated++ }
  }

  return {
    sales, costByOrder, matched, estimated, fallbackCpo,
    estLabel: recentCpo > 0 ? `coût réel moyen ${latestLabel}` : 'tarif moyen',
  }
}
