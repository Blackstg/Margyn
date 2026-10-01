// Coût de livraison RÉEL d'un mois de VENTES (Moom), rapproché PAR NUMÉRO DE COMMANDE.
//   GET ?brand=moom&from=YYYY-MM-01&to=YYYY-MM-DD
//   → { fulfillment: €, matched, orders, flat_used, note }
//
// Pourquoi : une facture logisticien (Hao) couvre les commandes EXPÉDIÉES un mois
// donné (≠ commandes VENDUES ce mois). Diviser le total facturé par le nb de ventes
// du mois fausse le coût/commande. Ici, on prend les commandes VENDUES sur la période
// et on leur attribue leur coût réel facturé (retrouvé par n° dans N'IMPORTE quelle
// facture), converti en EUR ; les commandes pas encore facturées prennent le tarif moyen.

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
interface Sale { variant_id: string | null; order_id: string | null }

// Taux USD→EUR du mois (1er du mois suivant), comme /api/exchange-rate.
async function eurRate(month: string): Promise<number> {
  const [y, m] = month.split('-').map(Number)
  const date = m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, '0')}-01`
  try {
    const r = await fetch(`https://api.frankfurter.app/${date}?from=USD&to=EUR`, { next: { revalidate: 86400 } })
    if (!r.ok) return 0.92
    const d = await r.json() as { rates?: { EUR?: number } }
    return d.rates?.EUR ?? 0.92
  } catch { return 0.92 }
}

export async function GET(req: NextRequest) {
  const brand = req.nextUrl.searchParams.get('brand') ?? ''
  const from  = req.nextUrl.searchParams.get('from') ?? ''
  const to    = req.nextUrl.searchParams.get('to')   ?? ''
  const creds = SHOPIFY[brand]
  if (!creds || !from || !to) return NextResponse.json({ fulfillment: -1, matched: 0, orders: 0 })

  const admin = createAdminClient()

  // 1. TOUTES les factures (tous mois) → coût réel EUR par n° de commande.
  //    Une commande vendue en août peut être facturée dans la facture de septembre.
  const { data: sums } = await admin
    .from('logistician_invoice_summaries')
    .select('month, invoice_rows')
    .eq('brand', brand)
  const realEurByName = new Map<string, number>()
  const rateCache = new Map<string, number>()
  // Par mois de facture : total EUR + nb de commandes → coût réel moyen/commande.
  const monthAgg = new Map<string, { eur: number; count: number }>()
  for (const s of (sums ?? []) as { month: string; invoice_rows?: InvoiceRow[] | null }[]) {
    let rate = rateCache.get(s.month)
    if (rate == null) { rate = await eurRate(s.month); rateCache.set(s.month, rate) }
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

  // Repli pour les commandes pas encore facturées : coût RÉEL moyen/commande de la
  // facture la plus récente (= "prix du mois dernier"), et NON un tarif figé. On
  // garde le tarif paramétré en ultime secours (aucune facture du tout).
  const { data: bs } = await admin.from('brand_settings').select('shipping_cost_per_order').eq('brand', brand).maybeSingle()
  const flat = Number(bs?.shipping_cost_per_order) || 0
  const latestInvMonth = [...monthAgg.keys()].sort().at(-1)
  const latestAgg = latestInvMonth ? monthAgg.get(latestInvMonth)! : null
  const recentCpo = latestAgg && latestAgg.count > 0 ? latestAgg.eur / latestAgg.count : 0
  const fallbackCpo = recentCpo > 0 ? recentCpo : flat

  // 2. Commandes VENDUES sur la période (order_id distincts) — paginé.
  const orderIds = new Set<string>()
  for (let offset = 0; ; offset += 1000) {
    const { data, error } = await admin
      .from('product_sales')
      .select('order_id')
      .eq('brand', brand).gte('date', from).lte('date', to)
      .not('order_id', 'is', null)
      .order('order_id', { ascending: true })
      .range(offset, offset + 999)
    if (error || !data || data.length === 0) break
    for (const r of data as Sale[]) if (r.order_id) orderIds.add(String(r.order_id))
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

  // 4. Somme : coût réel si la commande est facturée (par n°), sinon coût réel
  //    moyen/commande de la dernière facture (fallbackCpo).
  let total = 0, matched = 0, estimated = 0
  for (const oid of orderIds) {
    const name = idToName.get(oid)
    const real = name ? realEurByName.get(norm(name)) : undefined
    if (real != null) { total += real; matched++ }
    else { total += fallbackCpo; estimated++ }
  }

  const orders = orderIds.size
  if (orders === 0) return NextResponse.json({ fulfillment: -1, matched: 0, orders: 0 })

  const latestLabel = latestInvMonth
    ? new Date(Number(latestInvMonth.slice(0, 4)), Number(latestInvMonth.slice(5, 7)) - 1, 15)
        .toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' })
    : ''
  const estLabel = recentCpo > 0 ? `coût réel moyen ${latestLabel}` : 'tarif moyen'
  const note = matched === 0
    ? `Estimé — ${estLabel} (${Math.round(fallbackCpo)} €/cmd, aucune facture rapprochée)`
    : `Réel — ${matched}/${orders} commandes rapprochées par n°` +
      (estimated > 0 ? ` (${estimated} au ${estLabel} ${Math.round(fallbackCpo)} €/cmd, pas encore facturées)` : '')

  return NextResponse.json({ fulfillment: Math.round(total), matched, orders, estimated, cpo_fallback: Math.round(fallbackCpo), note })
}
