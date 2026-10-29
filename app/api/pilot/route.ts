// Pilote — compte de résultat mensuel « par commandes du mois » (Bowa).
//
// Principe : chaque mois = les commandes PASSÉES ce mois-là, avec TOUS leurs coûts,
// même s'ils tombent plus tard (remboursement en novembre d'une commande d'octobre,
// livraison Terence en novembre…). Les coûts non rattachables à une commande
// (pub, salaires, applis, crédits, transport interne) restent au mois où ils sont dépensés.
//
// Sources :
//   - Shopify (direct, pas daily_snapshots) : CA, port payé, remboursements à date, annulations
//   - product_variants / products : coût d'achat
//   - /api/delivery/subcontract : prix Terence réel par commande livrée (grille)
//   - delivery_stops : commandes livrées en interne (Noah, Moha…) ou pas encore livrées
//   - ad_spends, fixed_costs, brand_settings, supplementary_revenue
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { shopifyCreds } from '@/lib/tenant/integrations'

export const dynamic = 'force-dynamic'
export const maxDuration = 120

const SUBCONTRACT_START = '2026-10-01'   // Terence livre Bowa depuis cette date
const VAT = 1.2

const BUCKETS = [
  { key: '1-3',  label: '1 à 3 panneaux',  max: 3 },
  { key: '4-7',  label: '4 à 7 panneaux',  max: 7 },
  { key: '8-12', label: '8 à 12 panneaux', max: 12 },
  { key: '13+',  label: '13 panneaux et +', max: Infinity },
]

const isSample  = (t: string) => /chantillon/i.test(t)
const isStone   = (t: string) => /stonepanel|feuille\s*de\s*pierre/i.test(t)
const isPanel   = (t: string) => /panneau/i.test(t) && !isStone(t)
const isBulky   = (t: string) => /tasseau|profil|baguette|plinthe|corniche|liteau|lambourde/i.test(t)

const parisDate = (iso: string) => new Date(iso).toLocaleDateString('sv-SE', { timeZone: 'Europe/Paris' })
const r0 = (n: number) => Math.round(n)

type LineItem = { id: number; variant_id: number | null; product_id: number | null; title: string; quantity: number; price: string; total_discount: string }
type Order = {
  id: number; name: string; created_at: string; total_price: string; total_tax: string
  financial_status: string; cancelled_at: string | null
  total_shipping_price_set?: { shop_money?: { amount?: string } }
  line_items: LineItem[]
  refunds?: { refund_line_items?: { line_item_id: number; quantity: number }[]; transactions?: { kind: string; status: string; amount: string }[] }[]
}
type SubLine = { order: string; date: string; price: number | null; billedQty: number; bucket: number }

async function shopifyOrders(brand: string, fromDate: string, toDate?: string): Promise<Order[]> {
  const c = await shopifyCreds(brand)
  if (!c.shop || !c.token) throw new Error('Shopify non configuré')
  const min = new Date(`${fromDate}T00:00:00+02:00`).toISOString()
  const fields = 'id,name,created_at,total_price,total_tax,financial_status,cancelled_at,total_shipping_price_set,line_items,refunds'
  const max = toDate ? `&created_at_max=${encodeURIComponent(new Date(`${toDate}T23:59:59+01:00`).toISOString())}` : ''
  let url: string | null = `https://${c.shop}/admin/api/2024-01/orders.json?status=any&limit=250&created_at_min=${encodeURIComponent(min)}${max}&fields=${fields}`
  const out: Order[] = []
  while (url) {
    const res: Response = await fetch(url, { headers: { 'X-Shopify-Access-Token': c.token }, cache: 'no-store' })
    if (!res.ok) throw new Error(`Shopify ${res.status}`)
    out.push(...((await res.json()) as { orders: Order[] }).orders)
    const m = /<([^>]+)>;\s*rel="next"/.exec(res.headers.get('link') ?? '')
    url = m ? m[1] : null
  }
  return out
}

export async function GET(req: NextRequest) {
  const brand = req.nextUrl.searchParams.get('brand') ?? 'bowa'
  if (brand !== 'bowa') return NextResponse.json({ error: 'Pilote disponible pour Bowa uniquement' }, { status: 400 })
  const nMonths = Math.min(12, Math.max(2, Number(req.nextUrl.searchParams.get('months') ?? 6)))
  // Mode « livraison des commandes de la période » (dashboard) : ?from=YYYY-MM-DD&to=YYYY-MM-DD
  const rFrom = req.nextUrl.searchParams.get('from'), rTo = req.nextUrl.searchParams.get('to')
  if (rFrom && rTo) {
    try { return NextResponse.json(await deliveryOfOrders(req, brand, rFrom, rTo)) }
    catch (e) { return NextResponse.json({ error: String(e) }, { status: 500 }) }
  }

  try {
    const today = parisDate(new Date().toISOString())
    const [ty, tm] = today.split('-').map(Number)
    const months: string[] = []
    for (let i = nMonths - 1; i >= 0; i--) {
      const d = new Date(Date.UTC(ty, tm - 1 - i, 1))
      months.push(d.toISOString().slice(0, 7))
    }
    const firstDay = `${months[0]}-01`
    const daysIn = (m: string) => new Date(Date.UTC(+m.slice(0, 4), +m.slice(5, 7), 0)).getUTCDate()
    // Mois en cours : les charges mensuelles sont proratisées aux jours écoulés.
    const elapsedRatio = (m: string) => m === today.slice(0, 7) ? Number(today.slice(8, 10)) / daysIn(m) : 1

    const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } })

    // ── Données ────────────────────────────────────────────────────────────────
    const orders = await shopifyOrders(brand, firstDay)

    const subFrom = firstDay > SUBCONTRACT_START ? firstDay : SUBCONTRACT_START
    const subRes = await fetch(`${req.nextUrl.origin}/api/delivery/subcontract?brand=${brand}&from=${subFrom}&to=${today}`, { cache: 'no-store' })
    const sub = subRes.ok ? await subRes.json() as { lines: SubLine[]; settings: { drivers: string[]; countStones?: boolean } } : null
    const terenceDrivers = new Set((sub?.settings.drivers ?? []).map(d => d.toLowerCase()))

    // Prix Terence par commande (forfait partagé si plusieurs commandes même adresse même jour)
    const terenceByOrder = new Map<string, number>()
    const invoiceByMonth = new Map<string, number>()
    const priceSum = BUCKETS.map(() => ({ sum: 0, n: 0 }))
    for (const l of sub?.lines ?? []) {
      const names = l.order.split(' + ').map(s => s.trim())
      for (const n of names) terenceByOrder.set(n, (terenceByOrder.get(n) ?? 0) + (l.price ?? 0) / names.length)
      const lm = parisDate(l.date).slice(0, 7)
      invoiceByMonth.set(lm, (invoiceByMonth.get(lm) ?? 0) + (l.price ?? 0))
      if (l.price != null && l.bucket >= 0) { priceSum[l.bucket].sum += l.price; priceSum[l.bucket].n++ }
    }
    const avgPrice = priceSum.map(p => p.n ? p.sum / p.n : null)
    const fallbackAvg = (() => { const t = priceSum.reduce((a, p) => ({ s: a.s + p.sum, n: a.n + p.n }), { s: 0, n: 0 }); return t.n ? t.s / t.n : 0 })()

    // Livraisons (statut + chauffeur) des commandes de la période
    const names = orders.map(o => o.name)
    type Stop = { order_name: string; status: string; delivered_at: string | null; tour_id: string }
    const stops: Stop[] = []
    for (let i = 0; i < names.length; i += 200) {
      const { data } = await sb.from('delivery_stops').select('order_name, status, delivered_at, tour_id').in('order_name', names.slice(i, i + 200))
      stops.push(...((data ?? []) as Stop[]))
    }
    const tourIds = [...new Set(stops.map(s => s.tour_id))]
    const driverOf = new Map<string, string>()
    for (let i = 0; i < tourIds.length; i += 200) {
      const { data } = await sb.from('delivery_tours').select('id, driver_name').in('id', tourIds.slice(i, i + 200))
      for (const t of data ?? []) driverOf.set(t.id as string, String(t.driver_name ?? ''))
    }
    const deliveredInternally = new Set<string>()
    for (const s of stops) {
      if (!['delivered', 'partial'].includes(s.status)) continue
      const drv = (driverOf.get(s.tour_id) ?? '').toLowerCase()
      if (drv && !terenceDrivers.has(drv)) deliveredInternally.add(s.order_name)
    }

    const [{ data: variants }, { data: products }] = await Promise.all([
      sb.from('product_variants').select('shopify_variant_id, cost_price').eq('brand', brand).not('cost_price', 'is', null).limit(10000),
      sb.from('products').select('shopify_id, cost_price').eq('brand', brand).not('cost_price', 'is', null).limit(10000),
    ])
    const costByVariant = new Map((variants ?? []).map(v => [String(v.shopify_variant_id), Number(v.cost_price)]))
    const costByProduct = new Map((products ?? []).map(p => [String(p.shopify_id), Number(p.cost_price)]))

    const lastDay = `${months[months.length - 1]}-${daysIn(months[months.length - 1])}`
    const [{ data: ads }, { data: fixed }, { data: settings }, { data: supp }] = await Promise.all([
      sb.from('ad_spends').select('date, platform, spend').eq('brand', brand).gte('date', firstDay).lte('date', lastDay).limit(20000),
      sb.from('fixed_costs').select('label, category, amount, month').eq('brand', brand),
      sb.from('brand_settings').select('transaction_fee_rate').eq('brand', brand).maybeSingle(),
      sb.from('supplementary_revenue').select('month, amount, fees, source').eq('brand', brand).gte('month', firstDay),
    ])
    const feeRate = Number(settings?.transaction_fee_rate ?? 0.017)

    // ── Agrégation par mois ───────────────────────────────────────────────────
    type Bucket = { key: string; label: string; orders: number; revenueHT: number; cogs: number; delivery: number; estimated: number; fees: number; shippingHT: number }
    const newBuckets = (): Bucket[] => [
      ...BUCKETS.map(b => ({ key: b.key, label: b.label, orders: 0, revenueHT: 0, cogs: 0, delivery: 0, estimated: 0, fees: 0, shippingHT: 0 })),
      { key: 'postal',  label: 'Accessoires (La Poste)', orders: 0, revenueHT: 0, cogs: 0, delivery: 0, estimated: 0, fees: 0, shippingHT: 0 },
      { key: 'samples', label: 'Échantillons',           orders: 0, revenueHT: 0, cogs: 0, delivery: 0, estimated: 0, fees: 0, shippingHT: 0 },
    ]
    const M = new Map(months.map(m => [m, {
      month: m, partial: m === today.slice(0, 7),
      counts: { orders: 0, paid: 0, truck: 0, samples: 0, postal: 0, gifts: 0, cancelled: 0, refunded: 0, undelivered: 0, internal: 0 },
      productsHT: 0, shippingHT: 0, refundsHT: 0, suppHT: 0, ttcNet: 0,
      cogs: 0, giftCogs: 0, missingCost: 0,
      terence: 0, terenceEstimated: 0,
      buckets: newBuckets(),
    }]))

    const missingTitles = new Map<string, number>()
    for (const o of orders) {
      const m = M.get(parisDate(o.created_at).slice(0, 7))
      if (!m || o.financial_status === 'voided') continue
      const total = parseFloat(o.total_price) || 0
      const tax = parseFloat(o.total_tax) || 0
      const shipTTC = parseFloat(o.total_shipping_price_set?.shop_money?.amount ?? '0') || 0
      const refundTTC = (o.refunds ?? []).flatMap(r => r.transactions ?? [])
        .filter(t => t.kind === 'refund' && t.status === 'success').reduce((s, t) => s + (parseFloat(t.amount) || 0), 0)
      const fullyRefunded = total > 0 && refundTTC >= total - 0.01
      if (o.cancelled_at && (fullyRefunded || total === 0 || o.financial_status !== 'paid')) { m.counts.cancelled++; continue }

      const shippingHT = shipTTC / VAT
      const productsHT = total - tax - shippingHT
      const refundsHT = refundTTC / VAT
      const refundedQty = new Map<number, number>()
      for (const r of o.refunds ?? []) for (const li of r.refund_line_items ?? []) refundedQty.set(li.line_item_id, (refundedQty.get(li.line_item_id) ?? 0) + li.quantity)

      let cogs = 0, panels = 0, stones = 0, truck = false, missing = false
      for (const li of o.line_items) {
        const qty = Math.max(0, li.quantity - (refundedQty.get(li.id) ?? 0))
        const unit = costByVariant.get(String(li.variant_id)) ?? costByProduct.get(String(li.product_id))
        if (unit == null) { if (qty > 0 && !isSample(li.title)) { missing = true; missingTitles.set(li.title, (missingTitles.get(li.title) ?? 0) + qty) } }
        else cogs += unit * qty
        if (isSample(li.title)) continue
        if (isPanel(li.title)) { panels += li.quantity; truck = true }
        else if (isStone(li.title)) { stones += li.quantity; truck = true }
        else if (isBulky(li.title)) truck = true
      }
      const samplesOnly = o.line_items.length > 0 && o.line_items.every(li => isSample(li.title))

      m.counts.orders++
      if (total === 0) { m.counts.gifts++; m.giftCogs += cogs; continue }
      m.counts.paid++
      if (refundTTC > 0) m.counts.refunded++
      if (missing) m.missingCost++
      m.productsHT += productsHT; m.shippingHT += shippingHT; m.refundsHT += refundsHT
      m.ttcNet += total - refundTTC
      m.cogs += cogs

      // Livraison de CETTE commande
      let delivery = 0, estimated = 0
      const billedQty = panels + (sub?.settings.countStones ? stones : 0)
      const bIdx = BUCKETS.findIndex(b => Math.max(1, billedQty) <= b.max)
      if (terenceByOrder.has(o.name)) delivery = terenceByOrder.get(o.name)!
      else if (deliveredInternally.has(o.name)) m.counts.internal++
      else if (truck && !fullyRefunded && m.month >= SUBCONTRACT_START.slice(0, 7)) {
        estimated = avgPrice[bIdx] ?? fallbackAvg
        m.counts.undelivered++
      }
      m.terence += delivery
      m.terenceEstimated += estimated

      const kind = samplesOnly ? 'samples' : truck ? BUCKETS[bIdx].key : 'postal'
      if (kind === 'samples') m.counts.samples++
      else if (kind === 'postal') m.counts.postal++
      else m.counts.truck++
      const b = m.buckets.find(x => x.key === kind)!
      b.orders++
      b.revenueHT += productsHT + shippingHT - refundsHT
      b.shippingHT += shippingHT
      b.cogs += cogs
      b.delivery += delivery + estimated
      b.estimated += estimated
      b.fees += (total - refundTTC) * feeRate
    }

    // ── Charges mensuelles ─────────────────────────────────────────────────────
    const out = months.map(month => {
      const m = M.get(month)!
      const ratio = elapsedRatio(month)
      const adsBy: Record<string, number> = {}
      for (const a of ads ?? []) if (String(a.date).startsWith(month)) adsBy[a.platform] = (adsBy[a.platform] ?? 0) + Number(a.spend || 0)
      const adsTotal = Object.values(adsBy).reduce((s, v) => s + v, 0)

      const recurring = (fixed ?? []).filter(r => r.month === '1900-01-01')
      const monthly = (fixed ?? []).filter(r => String(r.month ?? '').startsWith(month) && !/terence/i.test(r.label ?? ''))
      const group = (rows: typeof recurring, scale: number) => rows.map(r => ({ label: String(r.label ?? ''), amount: r0(Number(r.amount || 0) * scale) }))
      const team = group(recurring.filter(r => r.category === 'team'), ratio)
      const apps = group(recurring.filter(r => r.category === 'app'), ratio)
      const infra = group(recurring.filter(r => !['team', 'app', 'fulfillment'].includes(String(r.category))), ratio)
      const transport = [
        ...group(recurring.filter(r => r.category === 'fulfillment'), ratio),
        ...group(monthly.filter(r => r.category === 'fulfillment'), 1),
      ]
      const otherMonthly = group(monthly.filter(r => r.category !== 'fulfillment'), 1)
      const sum = (rows: { amount: number }[]) => rows.reduce((s, r) => s + r.amount, 0)

      const suppRows = (supp ?? []).filter(s => String(s.month).startsWith(month))
      const suppHT = suppRows.reduce((s, r) => s + Number(r.amount || 0), 0) / VAT
      const suppFees = suppRows.reduce((s, r) => s + Number(r.fees || 0), 0)

      const revenueHT = m.productsHT + m.shippingHT - m.refundsHT + suppHT
      const fees = m.ttcNet * feeRate
      const delivery = m.terence + m.terenceEstimated
      const costs = {
        products: r0(m.cogs + m.giftCogs),
        delivery: r0(delivery),
        deliveryEstimated: r0(m.terenceEstimated),
        transport: sum(transport),
        ads: r0(adsTotal),
        fees: r0(fees + suppFees),
        team: sum(team),
        apps: sum(apps),
        infra: sum(infra) + sum(otherMonthly),
      }
      const totalCosts = Object.entries(costs).filter(([k]) => k !== 'deliveryEstimated').reduce((s, [, v]) => s + v, 0)
      const panelOrders = m.counts.truck
      return {
        month, partial: m.partial, elapsedRatio: Math.round(ratio * 100) / 100,
        counts: m.counts,
        revenue: { productsHT: r0(m.productsHT), shippingHT: r0(m.shippingHT), refundsHT: r0(m.refundsHT), suppHT: r0(suppHT), netHT: r0(revenueHT) },
        costs,
        detail: {
          ads: Object.fromEntries(Object.entries(adsBy).map(([k, v]) => [k, r0(v)])),
          team, apps, infra: [...infra, ...otherMonthly], transport,
          giftCogs: r0(m.giftCogs),
        },
        result: r0(revenueHT - totalCosts),
        contributionBeforeAds: r0(revenueHT - costs.products - costs.delivery - costs.fees),
        terenceInvoice: r0(invoiceByMonth.get(month) ?? 0),
        missingCost: m.missingCost,
        kpis: {
          avgBasketHT: panelOrders ? r0(m.buckets.filter(b => BUCKETS.some(x => x.key === b.key)).reduce((s, b) => s + b.revenueHT, 0) / panelOrders) : null,
          cac: panelOrders ? r0(adsTotal / panelOrders) : null,           // pub ÷ commandes panneaux
          mer: adsTotal ? Math.round((revenueHT / adsTotal) * 100) / 100 : null, // CA HT ÷ pub
          deliveryPerOrder: panelOrders ? r0(delivery / panelOrders) : null,
        },
        buckets: m.buckets.map(b => ({
          ...b, revenueHT: r0(b.revenueHT), cogs: r0(b.cogs), delivery: r0(b.delivery), estimated: r0(b.estimated), fees: r0(b.fees), shippingHT: r0(b.shippingHT),
          contribution: r0(b.revenueHT - b.cogs - b.delivery - b.fees),
        })),
      }
    })

    return NextResponse.json({ brand, today, subcontractStart: SUBCONTRACT_START, feeRate, avgTerenceByBucket: avgPrice.map(v => v == null ? null : r0(v)),
      missingCostProducts: [...missingTitles.entries()].sort((a, b) => b[1] - a[1]).slice(0, 15).map(([title, qty]) => ({ title, qty })),
      months: out })
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 })
  }
}

// Coût de livraison Terence des commandes PASSÉES entre from et to : réel si livrée
// (où qu'en soit la date), estimé (prix moyen Terence de la même tranche) sinon.
// Les commandes livrées en interne relèvent de la feuille transport (non comptées ici).
async function deliveryOfOrders(req: NextRequest, brand: string, from: string, to: string) {
  const today = parisDate(new Date().toISOString())
  const orders = (await shopifyOrders(brand, from, to)).filter(o => {
    const d = parisDate(o.created_at)
    return d >= from && d <= to && o.financial_status !== 'voided' && !o.cancelled_at && parseFloat(o.total_price) > 0
  })
  const subFrom = from > SUBCONTRACT_START ? from : SUBCONTRACT_START
  const subRes = await fetch(`${req.nextUrl.origin}/api/delivery/subcontract?brand=${brand}&from=${subFrom}&to=${today}`, { cache: 'no-store' })
  const sub = subRes.ok ? await subRes.json() as { lines: SubLine[]; settings: { drivers: string[]; countStones?: boolean } } : null
  const byOrder = new Map<string, number>()
  const priceSum = BUCKETS.map(() => ({ sum: 0, n: 0 }))
  for (const l of sub?.lines ?? []) {
    const names = l.order.split(' + ').map(x => x.trim())
    for (const n of names) byOrder.set(n, (byOrder.get(n) ?? 0) + (l.price ?? 0) / names.length)
    if (l.price != null && l.bucket >= 0) { priceSum[l.bucket].sum += l.price; priceSum[l.bucket].n++ }
  }
  const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } })
  const terence = new Set((sub?.settings.drivers ?? []).map(d => d.toLowerCase()))
  const internal = new Set<string>()
  const names = orders.map(o => o.name)
  for (let i = 0; i < names.length; i += 200) {
    const { data } = await sb.from('delivery_stops').select('order_name, status, tour_id').in('order_name', names.slice(i, i + 200)).in('status', ['delivered', 'partial'])
    const ids = [...new Set((data ?? []).map(s => s.tour_id as string))]
    const { data: tours } = ids.length ? await sb.from('delivery_tours').select('id, driver_name').in('id', ids) : { data: [] }
    const drv = new Map((tours ?? []).map(t => [t.id as string, String(t.driver_name ?? '').toLowerCase()]))
    for (const s of data ?? []) { const d = drv.get(s.tour_id as string); if (d && !terence.has(d)) internal.add(s.order_name as string) }
  }
  let actual = 0, estimated = 0, delivered = 0, pending = 0, internalCount = 0
  for (const o of orders) {
    if (byOrder.has(o.name)) { actual += byOrder.get(o.name)!; delivered++; continue }
    if (internal.has(o.name)) { internalCount++; continue }
    if (parisDate(o.created_at) < SUBCONTRACT_START) continue
    let panels = 0, stones = 0, truck = false
    for (const li of o.line_items) {
      if (isSample(li.title)) continue
      if (isPanel(li.title)) { panels += li.quantity; truck = true }
      else if (isStone(li.title)) { stones += li.quantity; truck = true }
      else if (isBulky(li.title)) truck = true
    }
    if (!truck) continue
    const qty = panels + (sub?.settings.countStones ? stones : 0)
    const b = BUCKETS.findIndex(x => Math.max(1, qty) <= x.max)
    estimated += priceSum[b].n ? priceSum[b].sum / priceSum[b].n : 0
    pending++
  }
  return { from, to, actual: r0(actual), estimated: r0(estimated), total: r0(actual + estimated), delivered, pending, internal: internalCount }
}
