// Coût de livraison par commande VENDUE sur une période — source UNIQUE du tableau
// de bord (/api/margins/fulfillment), de la page Marges (/api/margins/shipping) et
// du contrôle qualité (Coûts logisticien). Les pages doivent toujours donner le
// même total.
//
//  - Commande facturée par le logisticien (Hao) : coût RÉEL, retrouvé par n° de
//    commande dans N'IMPORTE quelle facture (mois facturé ≠ mois vendu), USD → EUR
//    au taux du mois.
//  - Pas encore facturée : PRÉVISION selon le contenu du colis (lib/shipping/model),
//    apprise sur les commandes facturées des 3 derniers mois clôturés. Dès que la
//    facture arrive, le réel remplace la prévision.
//  - Port payé par le client (Shopify) : renvoyé à part. Le tableau de bord le compte
//    déjà dans son CA ; la page Marges l'ajoute en revenu.
import 'server-only'
import { createAdminClient } from '@/lib/supabase'
import {
  trainModel, orderCost, backtest, sizeOf,
  type ShippingModel, type OrderFeatures, type Zone,
} from '@/lib/shipping/model'

const SHOPIFY: Record<string, { shop: string; token: string }> = {
  moom: { shop: process.env.SHOPIFY_MOOM_SHOP!, token: process.env.SHOPIFY_MOOM_ACCESS_TOKEN! },
  krom: { shop: process.env.SHOPIFY_KROM_SHOP!, token: process.env.SHOPIFY_KROM_ACCESS_TOKEN! },
}

const norm = (v: unknown) => String(v ?? '').toLowerCase().replace(/[\s#_-]/g, '')
const TRAIN_MONTHS = 3

interface InvoiceRow { order_name: string; total_price: number }

export type SaleLine = { product_title: string | null; shopify_product_id: string | null; variant_id: string | null; quantity: number; revenue: number; order_id: string | null; date: string }

export type OrderInfo = OrderFeatures & { name: string | null; port: number; month: string }

export type CostSource = 'réel' | 'produit' | 'taille' | 'moyenne'
export type OrderCost = { cost: number; source: CostSource; port: number; size: number; zone: Zone }

export type ModelSummary = {
  window: { from: string; to: string }
  orders: number
  base: number
  intlExtra: number
  minOrders: number
  products: { key: string; title: string; coef: number; orders: number; used: boolean }[]
  bySize: { size: number; avg: number; orders: number }[]
}

export type OrderShippingCosts = {
  sales: SaleLine[]
  byOrder: Map<string, OrderCost>
  counts: Record<CostSource, number>
  fallbackCpo: number
  estLabel: string
  model: ShippingModel | null
  summary: ModelSummary | null
}

// ── Taux et factures ──────────────────────────────────────────────────────────

const rateCache = new Map<string, number>()
// Taux USD→EUR du mois (1er du mois suivant), comme /api/exchange-rate.
async function eurRate(month: string): Promise<number> {
  const hit = rateCache.get(month)
  if (hit) return hit
  const [y, m] = month.split('-').map(Number)
  const date = m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, '0')}-01`
  let rate = 0.92
  try {
    const r = await fetch(`https://api.frankfurter.dev/v1/${date}?from=USD&to=EUR`, { next: { revalidate: 86400 } })
    if (r.ok) rate = ((await r.json()) as { rates?: { EUR?: number } }).rates?.EUR ?? 0.92
  } catch { /* 0.92 */ }
  rateCache.set(month, rate)
  return rate
}

type Invoices = { realByName: Map<string, number>; fallbackCpo: number; latestMonth: string | null; stamp: string }

async function loadInvoices(brand: string): Promise<Invoices> {
  const { data: sums } = await createAdminClient().from('logistician_invoice_summaries').select('month, invoice_rows').eq('brand', brand)
  const realByName = new Map<string, number>()
  const monthAgg = new Map<string, { eur: number; count: number }>()
  for (const s of (sums ?? []) as { month: string; invoice_rows?: InvoiceRow[] | null }[]) {
    const rate = await eurRate(s.month)
    const agg = monthAgg.get(s.month) ?? { eur: 0, count: 0 }
    for (const r of s.invoice_rows ?? []) {
      const k = norm(r.order_name)
      if (!k) continue
      const eur = (Number(r.total_price) || 0) * rate
      realByName.set(k, (realByName.get(k) ?? 0) + eur)
      agg.eur += eur; agg.count++
    }
    monthAgg.set(s.month, agg)
  }
  const months = Array.from(monthAgg.keys()).sort()
  const latestMonth = months.at(-1) ?? null
  const latest = latestMonth ? monthAgg.get(latestMonth)! : null
  return {
    realByName, latestMonth,
    fallbackCpo: latest && latest.count > 0 ? latest.eur / latest.count : 0,
    stamp: months.map(m => `${m}:${monthAgg.get(m)!.count}`).join(','),
  }
}

// ── Contenu des commandes (product_sales + Shopify) ──────────────────────────

const productKey = (s: SaleLine) =>
  (s.shopify_product_id ? `p${s.shopify_product_id}` : `t${s.product_title ?? ''}`) + ((s.revenue || 0) > 0 ? '' : ':offert')

async function loadSales(brand: string, from: string, to: string): Promise<SaleLine[]> {
  const admin = createAdminClient()
  const out: SaleLine[] = []
  for (let offset = 0; ; offset += 1000) {
    const { data, error } = await admin.from('product_sales')
      .select('product_title, shopify_product_id, variant_id, quantity, revenue, order_id, date')
      .eq('brand', brand).gte('date', from).lte('date', to)
      .order('order_id', { ascending: true, nullsFirst: false })
      .order('variant_id', { ascending: true, nullsFirst: false })
      .order('product_title', { ascending: true })
      .range(offset, offset + 999)
    if (error || !data || data.length === 0) break
    out.push(...(data as SaleLine[]))
    if (data.length < 1000) break
  }
  return out
}

// id → n°, pays, port payé (commandes créées sur la période ± 1 jour, fuseau Paris).
async function loadShopifyOrders(brand: string, from: string, to: string) {
  const creds = SHOPIFY[brand]
  const out = new Map<string, { name: string; zone: Zone; port: number }>()
  if (!creds) return out
  const min = new Date(Date.parse(`${from}T00:00:00Z`) - 86400_000).toISOString()
  const max = new Date(Date.parse(`${to}T23:59:59Z`) + 86400_000).toISOString()
  let url: string | null =
    `https://${creds.shop}/admin/api/2024-10/orders.json?status=any&limit=250&created_at_min=${min}&created_at_max=${max}` +
    `&fields=id,name,shipping_address,total_shipping_price_set`
  try {
    while (url) {
      const r: Response = await fetch(url, { headers: { 'X-Shopify-Access-Token': creds.token }, cache: 'no-store' })
      if (!r.ok) break
      const j = await r.json() as { orders?: { id: number; name: string; shipping_address?: { country_code?: string } | null; total_shipping_price_set?: { shop_money?: { amount?: string } } }[] }
      for (const o of j.orders ?? []) {
        const cc = o.shipping_address?.country_code ?? 'FR'
        out.set(String(o.id), { name: o.name, zone: cc === 'FR' ? 'FR' : 'X', port: Number(o.total_shipping_price_set?.shop_money?.amount ?? 0) || 0 })
      }
      url = (r.headers.get('Link') ?? '').match(/<([^>]+)>;\s*rel="next"/)?.[1] ?? null
    }
  } catch { /* best-effort */ }
  return out
}

async function loadOrders(brand: string, from: string, to: string) {
  const [sales, shop] = await Promise.all([loadSales(brand, from, to), loadShopifyOrders(brand, from, to)])
  const orders = new Map<string, OrderInfo>()
  const titles: Record<string, string> = {}
  for (const s of sales) {
    if (!s.order_id) continue
    const oid = String(s.order_id)
    const sh = shop.get(oid)
    const o = orders.get(oid) ?? { name: sh?.name ?? null, zone: sh?.zone ?? 'FR', port: sh?.port ?? 0, paidItems: 0, products: {}, month: s.date.slice(0, 7) }
    const k = productKey(s)
    o.products[k] = (o.products[k] ?? 0) + (s.quantity || 0)
    if ((s.revenue || 0) > 0) o.paidItems += s.quantity || 0
    titles[k] = (s.product_title ?? k) + ((s.revenue || 0) > 0 ? '' : ' (offert)')
    orders.set(oid, o)
  }
  return { sales, orders, titles }
}

// ── Modèle (mis en cache dans Storage, réappris quand une facture arrive) ─────

const parisMonth = (d = new Date()) => d.toLocaleDateString('fr-CA', { timeZone: 'Europe/Paris' }).slice(0, 7)
function addMonths(ym: string, n: number) {
  const [y, m] = ym.split('-').map(Number)
  const d = new Date(Date.UTC(y, m - 1 + n, 1))
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`
}
const lastDay = (ym: string) => { const [y, m] = ym.split('-').map(Number); return `${ym}-${String(new Date(Date.UTC(y, m, 0)).getUTCDate()).padStart(2, '0')}` }

function trainingSamples(orders: Map<string, OrderInfo>, inv: Invoices, months: Set<string>) {
  const out: { features: OrderFeatures; cost: number }[] = []
  for (const o of orders.values()) {
    if (!months.has(o.month) || !o.name) continue
    const real = inv.realByName.get(norm(o.name))
    if (real != null) out.push({ features: o, cost: real })
  }
  return out
}

function summarize(model: ShippingModel, titles: Record<string, string>, window: { from: string; to: string }): ModelSummary {
  return {
    window, orders: model.orders, base: model.base, intlExtra: model.intlExtra, minOrders: model.minOrders,
    products: Object.entries(model.products)
      .map(([key, p]) => ({ key, title: titles[key] ?? key, coef: p.coef, orders: p.orders, used: p.orders >= model.minOrders }))
      .sort((a, b) => b.orders - a.orders),
    bySize: [1, 2, 3, 4].map(size => ({ size, avg: model.bySize[String(size)].avg, orders: model.bySize[String(size)].orders })),
  }
}

type CachedModel = { stamp: string; window: { from: string; to: string }; model: ShippingModel; summary: ModelSummary }

async function getModel(brand: string, inv: Invoices): Promise<CachedModel | null> {
  if (!inv.latestMonth) return null
  const cur = parisMonth()
  const window = { from: `${addMonths(cur, -TRAIN_MONTHS)}-01`, to: lastDay(addMonths(cur, -1)) }
  const stamp = `${inv.stamp}|${window.from}|v1`
  const sb = createAdminClient()
  const path = `${brand}/shipping-model.json`
  try {
    const { data } = await sb.storage.from('app-config').download(path)
    if (data) {
      const c = JSON.parse(await data.text()) as CachedModel
      if (c.stamp === stamp) return c
    }
  } catch { /* à recalculer */ }
  const { orders, titles } = await loadOrders(brand, window.from, window.to)
  const months = new Set(Array.from({ length: TRAIN_MONTHS }, (_, i) => addMonths(cur, -TRAIN_MONTHS + i)))
  const model = trainModel(trainingSamples(orders, inv, months))
  if (model.orders === 0) return null
  const c: CachedModel = { stamp, window, model, summary: summarize(model, titles, window) }
  await sb.storage.from('app-config').upload(path, JSON.stringify(c), { contentType: 'application/json', upsert: true }).catch(() => null)
  return c
}

// ── Coût par commande d'une période ──────────────────────────────────────────

export async function orderShippingCosts(brand: string, from: string, to: string): Promise<OrderShippingCosts | null> {
  if (!SHOPIFY[brand]) return null
  const [inv, flatRes] = await Promise.all([
    loadInvoices(brand),
    createAdminClient().from('brand_settings').select('shipping_cost_per_order').eq('brand', brand).maybeSingle(),
  ])
  const flat = Number(flatRes.data?.shipping_cost_per_order) || 0
  const fallbackCpo = inv.fallbackCpo > 0 ? inv.fallbackCpo : flat
  const [cached, { sales, orders }] = await Promise.all([getModel(brand, inv), loadOrders(brand, from, to)])
  const model = cached?.model ?? null

  const byOrder = new Map<string, OrderCost>()
  const counts: Record<CostSource, number> = { réel: 0, produit: 0, taille: 0, moyenne: 0 }
  for (const [oid, o] of orders) {
    const real = o.name ? inv.realByName.get(norm(o.name)) : undefined
    const c = orderCost(real, model, o, fallbackCpo)
    counts[c.source]++
    byOrder.set(oid, { ...c, port: o.port, size: sizeOf(o.paidItems), zone: o.zone })
  }

  const latestLabel = inv.latestMonth
    ? new Date(Number(inv.latestMonth.slice(0, 4)), Number(inv.latestMonth.slice(5, 7)) - 1, 15).toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' })
    : ''
  return {
    sales, byOrder, counts, fallbackCpo, model, summary: cached?.summary ?? null,
    estLabel: inv.fallbackCpo > 0 ? `coût réel moyen ${latestLabel}` : 'tarif moyen',
  }
}

export function costNote(c: OrderShippingCosts): string {
  const n = c.byOrder.size
  const pctOf = (x: number) => `${Math.round((x / (n || 1)) * 100)} %`
  const prev = c.counts.produit + c.counts.taille
  const parts = [`${c.counts.réel}/${n} commandes au réel facturé (${pctOf(c.counts.réel)})`]
  if (prev) parts.push(`${prev} en prévision (${pctOf(prev)}) : ${c.counts.produit} selon les produits du colis, ${c.counts.taille} selon la taille du panier`)
  if (c.counts.moyenne) parts.push(`${c.counts.moyenne} au ${c.estLabel} ${Math.round(c.fallbackCpo)} €/cmd`)
  return parts.join(' · ')
}

// ── Contrôle qualité : prévision « à l'aveugle » vs facture, mois par mois ────

export type BacktestMonth = {
  month: string; invoicedShare: number
  bySize: { size: number; orders: number; real: number; predicted: number; errorPct: number | null }[]
  total: { orders: number; real: number; predicted: number; errorPct: number | null }
}

export async function shippingBacktest(brand: string): Promise<BacktestMonth[]> {
  const inv = await loadInvoices(brand)
  if (!inv.latestMonth || !SHOPIFY[brand]) return []
  const sb = createAdminClient()
  const path = `${brand}/shipping-backtest.json`
  const stamp = `${inv.stamp}|v1`
  try {
    const { data } = await sb.storage.from('app-config').download(path)
    if (data) { const c = JSON.parse(await data.text()) as { stamp: string; months: BacktestMonth[] }; if (c.stamp === stamp) return c.months }
  } catch { /* à recalculer */ }

  const first = inv.stamp.split(',')[0].split(':')[0]
  const last = addMonths(parisMonth(), -1)
  const { orders } = await loadOrders(brand, `${first}-01`, lastDay(last))
  const months: BacktestMonth[] = []
  for (let m = addMonths(first, TRAIN_MONTHS); m <= last; m = addMonths(m, 1)) {
    const sold = Array.from(orders.values()).filter(o => o.month === m)
    const test = trainingSamples(orders, inv, new Set([m])).filter(t => t.cost > 0)
    if (!sold.length || test.length / sold.length < 0.8) continue   // mois pas encore assez facturé
    const trainSet = new Set(Array.from({ length: TRAIN_MONTHS }, (_, i) => addMonths(m, -TRAIN_MONTHS + i)))
    const model = trainModel(trainingSamples(orders, inv, trainSet))
    if (!model.orders) continue
    months.push({ month: m, invoicedShare: test.length / sold.length, ...backtest(model, test) })
  }
  await sb.storage.from('app-config').upload(path, JSON.stringify({ stamp, months }), { contentType: 'application/json', upsert: true }).catch(() => null)
  return months
}
