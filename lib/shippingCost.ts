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
  trainModel, orderCost, backtest, sizeOf, predict, basketProducts, gridCost, isAttachment, shippingKey,
  type ShippingModel, type OrderFeatures, type Zone, type ShippingGrid,
} from '@/lib/shipping/model'

const SHOPIFY: Record<string, { shop: string; token: string }> = {
  moom: { shop: process.env.SHOPIFY_MOOM_SHOP!, token: process.env.SHOPIFY_MOOM_ACCESS_TOKEN! },
  krom: { shop: process.env.SHOPIFY_KROM_SHOP!, token: process.env.SHOPIFY_KROM_ACCESS_TOKEN! },
}

const norm = (v: unknown) => String(v ?? '').toLowerCase().replace(/[\s#_-]/g, '')
const TRAIN_MONTHS = 3

interface InvoiceRow { order_name: string; total_price: number; shipping_price?: number; service_price?: number }

export type SaleLine = { product_title: string | null; shopify_product_id: string | null; variant_id: string | null; quantity: number; revenue: number; order_id: string | null; date: string }

export type OrderInfo = OrderFeatures & { name: string | null; port: number; month: string; country: string }

export type CostSource = 'réel' | 'grille' | 'produit' | 'taille' | 'moyenne'
export type OrderCost = { cost: number; source: CostSource; port: number; size: number; zone: Zone }

export type ModelSummary = {
  window: { from: string; to: string }
  orders: number
  base: number
  intlExtra: number
  minOrders: number
  // Attaches fusionnées dans leur sac : jamais affichées seules.
  products: { key: string; title: string; coef: number; orders: number; used: boolean }[]
  bySize: { size: number; avg: number; orders: number }[]
}

export type TypicalBasket = { label: string; predicted: number; real: number | null; realOrders: number; frequent?: number }

export type OrderShippingCosts = {
  sales: SaleLine[]
  byOrder: Map<string, OrderCost>
  counts: Record<CostSource, number>
  fallbackCpo: number
  estLabel: string
  model: ShippingModel | null
  summary: ModelSummary | null
  typical: TypicalBasket[]
  grid: { importedAt: string } | null
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

type Invoices = { realByName: Map<string, number>; partsByName: Map<string, { ship: number; serv: number }>; fallbackCpo: number; latestMonth: string | null; stamp: string }

async function loadInvoices(brand: string): Promise<Invoices> {
  const { data: sums } = await createAdminClient().from('logistician_invoice_summaries').select('month, invoice_rows').eq('brand', brand)
  const realByName = new Map<string, number>()
  const partsByName = new Map<string, { ship: number; serv: number }>()
  const monthAgg = new Map<string, { eur: number; count: number }>()
  for (const s of (sums ?? []) as { month: string; invoice_rows?: InvoiceRow[] | null }[]) {
    const rate = await eurRate(s.month)
    const agg = monthAgg.get(s.month) ?? { eur: 0, count: 0 }
    for (const r of s.invoice_rows ?? []) {
      const k = norm(r.order_name)
      if (!k) continue
      const eur = (Number(r.total_price) || 0) * rate
      realByName.set(k, (realByName.get(k) ?? 0) + eur)
      const pr = partsByName.get(k) ?? { ship: 0, serv: 0 }
      pr.ship += (Number(r.shipping_price) || 0) * rate; pr.serv += (Number(r.service_price) || 0) * rate
      partsByName.set(k, pr)
      agg.eur += eur; agg.count++
    }
    monthAgg.set(s.month, agg)
  }
  const months = Array.from(monthAgg.keys()).sort()
  const latestMonth = months.at(-1) ?? null
  const latest = latestMonth ? monthAgg.get(latestMonth)! : null
  return {
    realByName, partsByName, latestMonth,
    fallbackCpo: latest && latest.count > 0 ? latest.eur / latest.count : 0,
    stamp: months.map(m => `${m}:${monthAgg.get(m)!.count}`).join(','),
  }
}

// ── Contenu des commandes (product_sales + Shopify) ──────────────────────────

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
  const out = new Map<string, { name: string; zone: Zone; country: string; port: number }>()
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
        out.set(String(o.id), { name: o.name, zone: cc === 'FR' ? 'FR' : 'X', country: cc, port: Number(o.total_shipping_price_set?.shop_money?.amount ?? 0) || 0 })
      }
      url = (r.headers.get('Link') ?? '').match(/<([^>]+)>;\s*rel="next"/)?.[1] ?? null
    }
  } catch { /* best-effort */ }
  return out
}

async function loadOrders(brand: string, from: string, to: string) {
  const [sales, shop] = await Promise.all([loadSales(brand, from, to), loadShopifyOrders(brand, from, to)])
  const lines = new Map<string, { title: string; qty: number; free: boolean }[]>()
  const meta = new Map<string, { month: string; paid: number }>()
  const titles: Record<string, string> = {}
  for (const s of sales) {
    if (!s.order_id || !s.product_title) continue
    const oid = String(s.order_id)
    const free = !((s.revenue || 0) > 0)
    const a = lines.get(oid) ?? []
    a.push({ title: s.product_title, qty: s.quantity || 0, free })
    lines.set(oid, a)
    const m = meta.get(oid) ?? { month: s.date.slice(0, 7), paid: 0 }
    if (!free) m.paid += s.quantity || 0
    meta.set(oid, m)
    const k = shippingKey(s.product_title)
    if (!titles[k] || !free) titles[k] = s.product_title
  }
  const orders = new Map<string, OrderInfo>()
  for (const [oid, ls] of lines) {
    const sh = shop.get(oid), m = meta.get(oid)!
    orders.set(oid, {
      name: sh?.name ?? null, zone: sh?.zone ?? 'FR', country: sh?.country ?? 'FR', port: sh?.port ?? 0,
      paidItems: m.paid, products: basketProducts(ls), month: m.month,
    })
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
      .filter(([key]) => !isAttachment(titles[key] ?? key))
      .map(([key, p]) => ({ key, title: titles[key] ?? key, coef: p.coef, orders: p.orders, used: p.orders >= model.minOrders }))
      .sort((a, b) => b.orders - a.orders),
    bySize: [1, 2, 3, 4].map(size => ({ size, avg: model.bySize[String(size)].avg, orders: model.bySize[String(size)].orders })),
  }
}

const signature = (products: Record<string, number>) => Object.keys(products).sort().map(k => `${k}×${products[k]}`).join('|')

// Statistiques des colis facturés de la fenêtre d'apprentissage (France) : coût réel
// des colis identiques (« Colis types ») et des colis à un seul produit (anomalies).
type WindowStats = {
  realBySignature: Record<string, { n: number; sum: number }>
  solo: Record<string, { n: number; ship: number; serv: number }>
  perMonth: Record<string, number>     // colis contenant le produit, par mois (moyenne)
  prepPerOrder: number
}

function windowStats(orders: Map<string, OrderInfo>, inv: Invoices, months: Set<string>): WindowStats {
  const st: WindowStats = { realBySignature: {}, solo: {}, perMonth: {}, prepPerOrder: 0 }
  let serv = 0, n = 0
  for (const o of orders.values()) {
    if (!months.has(o.month)) continue
    for (const k of Object.keys(o.products)) st.perMonth[k] = (st.perMonth[k] ?? 0) + 1 / months.size
    const real = o.name ? inv.realByName.get(norm(o.name)) : undefined
    const parts = o.name ? inv.partsByName.get(norm(o.name)) : undefined
    if (real == null || !(real > 0) || !parts) continue
    serv += parts.serv; n++
    if (o.zone !== 'FR') continue
    const sig = signature(o.products)
    const r = st.realBySignature[sig] ?? { n: 0, sum: 0 }
    r.n++; r.sum += real; st.realBySignature[sig] = r
    const keys = Object.keys(o.products)
    if (keys.length === 1 && o.products[keys[0]] === 1) {
      const so = st.solo[keys[0]] ?? { n: 0, ship: 0, serv: 0 }
      so.n++; so.ship += parts.ship; so.serv += parts.serv; st.solo[keys[0]] = so
    }
  }
  st.prepPerOrder = n ? serv / n : 0
  return st
}

type CachedModel = { stamp: string; window: { from: string; to: string }; model: ShippingModel; summary: ModelSummary; titles: Record<string, string>; stats: WindowStats }

async function getModel(brand: string, inv: Invoices): Promise<CachedModel | null> {
  if (!inv.latestMonth) return null
  const cur = parisMonth()
  const window = { from: `${addMonths(cur, -TRAIN_MONTHS)}-01`, to: lastDay(addMonths(cur, -1)) }
  const stamp = `${inv.stamp}|${window.from}|v2`
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
  const c: CachedModel = { stamp, window, model, summary: summarize(model, titles, window), titles, stats: windowStats(orders, inv, months) }
  await sb.storage.from('app-config').upload(path, JSON.stringify(c), { contentType: 'application/json', upsert: true }).catch(() => null)
  return c
}

// ── Poids et grille tarifaire ────────────────────────────────────────────────

// Poids d'expédition par produit (g) : le plus lourd de ses variantes (Produits).
async function loadWeights(brand: string): Promise<Record<string, number>> {
  const { data } = await createAdminClient().from('product_variants').select('product_title, weight_g').eq('brand', brand)
  const out: Record<string, number> = {}
  for (const v of (data ?? []) as { product_title: string; weight_g: number | null }[]) {
    const k = shippingKey(v.product_title)
    if (v.weight_g && v.weight_g > (out[k] ?? 0)) out[k] = v.weight_g
    else if (!(k in out)) out[k] = 0
  }
  return out
}

export async function loadGrid(brand: string): Promise<ShippingGrid | null> {
  try {
    const { data } = await createAdminClient().storage.from('app-config').download(`${brand}/shipping-grid.json`)
    if (!data) return null
    const g = JSON.parse(await data.text()) as ShippingGrid
    return g.rows?.length ? g : null
  } catch { return null }
}

export async function saveGrid(brand: string, rows: ShippingGrid['rows']): Promise<ShippingGrid> {
  const inv = await loadInvoices(brand)
  const cached = await getModel(brand, inv)
  const grid: ShippingGrid = { importedAt: new Date().toISOString(), rows, prepPerOrder: Math.round((cached?.stats.prepPerOrder ?? 0) * 100) / 100 }
  const { error } = await createAdminClient().storage.from('app-config')
    .upload(`${brand}/shipping-grid.json`, JSON.stringify(grid), { contentType: 'application/json', upsert: true })
  if (error) throw new Error(error.message)
  return grid
}

// État de la bascule vers la grille : grille importée ? poids manquants ?
export async function gridStatus(brand: string) {
  const [grid, weights, inv] = await Promise.all([loadGrid(brand), loadWeights(brand), loadInvoices(brand)])
  const cached = await getModel(brand, inv)
  const sold = cached ? Object.entries(cached.stats.perMonth).filter(([k]) => !isAttachment(cached.titles[k] ?? k)) : []
  const missing = sold.filter(([k]) => !(weights[k] > 0)).map(([k, perMonth]) => ({ title: cached!.titles[k] ?? k, perMonth: Math.round(perMonth) }))
    .sort((a, b) => b.perMonth - a.perMonth)
  return { grid: grid ? { importedAt: grid.importedAt, rows: grid.rows.length, prepPerOrder: grid.prepPerOrder } : null, missingWeights: missing, products: sold.length }
}

// ── Coût par commande d'une période ──────────────────────────────────────────

const TYPICAL: { label: string; names: string[] }[] = [
  { label: 'MumExplorer seul', names: ['mumexplorer'] },
  { label: 'MumExplorer + tapis', names: ['mumexplorer', 'matexplorer'] },
  { label: 'MumExplorer + tapis + pochette', names: ['mumexplorer', 'matexplorer', 'kitexplorer'] },
  { label: 'MumExplorer + CaryExplorer', names: ['mumexplorer', 'caryexplorer'] },
  { label: 'CaryExplorer + WalkExplorer', names: ['caryexplorer', 'walkexplorer'] },
  { label: 'MumEssential seul', names: ['mumessential'] },
  { label: 'MumEssential + tapis', names: ['mumessential', 'matexplorer'] },
]
const shortTitle = (t: string) => t.split('™')[0].trim()

function typicalBaskets(c: CachedModel, periodOrders: Map<string, OrderInfo>): TypicalBasket[] {
  // Clé du produit le plus vendu dont le nom commence par `name`.
  const keyOf = (name: string) => Object.entries(c.model.products)
    .filter(([k]) => k.startsWith(name + '™') || k.startsWith(name + ' '))
    .sort((a, b) => b[1].orders - a[1].orders)[0]?.[0]
  const basket = (label: string, products: Record<string, number>, frequent?: number): TypicalBasket => {
    const real = c.stats.realBySignature[signature(products)]
    const paidItems = Object.values(products).reduce((a, b) => a + b, 0)
    return { label, predicted: predict(c.model, { zone: 'FR', paidItems, products }).cost, real: real ? real.sum / real.n : null, realOrders: real?.n ?? 0, frequent }
  }
  const out: TypicalBasket[] = []
  for (const t of TYPICAL) {
    const keys = t.names.map(keyOf)
    if (keys.some(k => !k)) continue
    out.push(basket(t.label, Object.fromEntries(keys.map(k => [k!, 1]))))
  }
  // Panier le plus fréquent de la période (France)
  const freq = new Map<string, { n: number; products: Record<string, number> }>()
  for (const o of periodOrders.values()) {
    if (o.zone !== 'FR' || !Object.keys(o.products).length) continue
    const sig = signature(o.products)
    const f = freq.get(sig) ?? { n: 0, products: o.products }
    f.n++; freq.set(sig, f)
  }
  const top = Array.from(freq.values()).sort((a, b) => b.n - a.n)[0]
  if (top) {
    const label = Object.entries(top.products).map(([k, q]) => `${q > 1 ? `${q} × ` : ''}${shortTitle(c.titles[k] ?? k)}`).join(' + ')
    out.push(basket(`Le plus fréquent : ${label}`, top.products, top.n))
  }
  return out
}

export async function orderShippingCosts(brand: string, from: string, to: string): Promise<OrderShippingCosts | null> {
  if (!SHOPIFY[brand]) return null
  const [inv, flatRes, grid, weights] = await Promise.all([
    loadInvoices(brand),
    createAdminClient().from('brand_settings').select('shipping_cost_per_order').eq('brand', brand).maybeSingle(),
    loadGrid(brand),
    loadWeights(brand),
  ])
  const flat = Number(flatRes.data?.shipping_cost_per_order) || 0
  const fallbackCpo = inv.fallbackCpo > 0 ? inv.fallbackCpo : flat
  const [cached, { sales, orders }] = await Promise.all([getModel(brand, inv), loadOrders(brand, from, to)])
  const model = cached?.model ?? null

  const byOrder = new Map<string, OrderCost>()
  const counts: Record<CostSource, number> = { réel: 0, grille: 0, produit: 0, taille: 0, moyenne: 0 }
  for (const [oid, o] of orders) {
    const real = o.name ? inv.realByName.get(norm(o.name)) : undefined
    const c = orderCost(real, model, o, fallbackCpo, real == null ? gridCost(grid, o.country, o.products, weights) : null)
    counts[c.source]++
    byOrder.set(oid, { ...c, port: o.port, size: sizeOf(o.paidItems), zone: o.zone })
  }

  const latestLabel = inv.latestMonth
    ? new Date(Number(inv.latestMonth.slice(0, 4)), Number(inv.latestMonth.slice(5, 7)) - 1, 15).toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' })
    : ''
  return {
    sales, byOrder, counts, fallbackCpo, model, summary: cached?.summary ?? null,
    typical: cached ? typicalBaskets(cached, orders) : [],
    grid: grid ? { importedAt: grid.importedAt } : null,
    estLabel: inv.fallbackCpo > 0 ? `coût réel moyen ${latestLabel}` : 'tarif moyen',
  }
}

// « Livraison : 37 % au réel, 63 % estimé » (une phrase, pour les bandeaux).
export function costNote(c: OrderShippingCosts): string {
  const n = c.byOrder.size || 1
  const realPct = Math.round((c.counts.réel / n) * 100)
  return `Livraison : ${realPct} % au réel, ${100 - realPct} % estimé`
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
  const stamp = `${inv.stamp}|v2`
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

// ── Coûts anormaux (à présenter au logisticien) ──────────────────────────────
// Sur les colis France à un seul produit facturés pendant la fenêtre d'apprentissage :
//  - même poids mais transport bien plus cher qu'un autre produit ;
//  - plus léger mais plus cher qu'un produit plus lourd ;
//  - préparation facturée bien au-dessus des autres produits.
// Surcoût mensuel = écart par colis × colis du mois contenant le produit.
export type Anomaly = { kind: 'poids' | 'léger' | 'préparation'; product: string; compared: string | null; detail: string; perParcel: number; parcelsPerMonth: number; perMonth: number }

export async function shippingAnomalies(brand: string): Promise<{ anomalies: Anomaly[]; window: { from: string; to: string } | null; missingWeights: string[] }> {
  const inv = await loadInvoices(brand)
  const [cached, weights] = await Promise.all([getModel(brand, inv), loadWeights(brand)])
  if (!cached) return { anomalies: [], window: null, missingWeights: [] }
  const MIN = 20
  const title = (k: string) => shortTitle(cached.titles[k] ?? k)
  const eur2 = (n: number) => `${n.toFixed(2).replace('.', ',')} €`
  const kg = (g: number) => `${(g / 1000).toLocaleString('fr-FR', { maximumFractionDigits: 2 })} kg`
  const solo = Object.entries(cached.stats.solo)
    .filter(([k, s]) => s.n >= MIN && !isAttachment(cached.titles[k] ?? k))
    .map(([k, s]) => ({ k, n: s.n, ship: s.ship / s.n, serv: s.serv / s.n, w: weights[k] ?? 0, perMonth: cached.stats.perMonth[k] ?? 0 }))
  const out: Anomaly[] = []
  const push = (a: Omit<Anomaly, 'perMonth'>) => out.push({ ...a, perMonth: a.perParcel * a.parcelsPerMonth })

  for (const a of solo) {
    if (!(a.w > 0)) continue
    // Même poids (±10 %), transport ≥ 30 % plus cher : on garde la comparaison la plus forte.
    const same = solo.filter(b => b !== a && b.w > 0 && Math.abs(b.w - a.w) / a.w <= 0.1 && a.ship >= b.ship * 1.3).sort((x, y) => x.ship - y.ship)[0]
    if (same) push({ kind: 'poids', product: title(a.k), compared: title(same.k), perParcel: a.ship - same.ship, parcelsPerMonth: a.perMonth,
      detail: `Même poids que ${title(same.k)} (${kg(a.w)}) mais transport ${eur2(a.ship)} contre ${eur2(same.ship)} par colis (${a.n} et ${same.n} colis observés).` })
    // Plus léger (≤ 70 %) mais plus cher qu'un produit plus lourd.
    const heavier = solo.filter(b => b !== a && b.w > 0 && a.w <= b.w * 0.7 && a.ship + a.serv > b.ship + b.serv).sort((x, y) => (x.ship + x.serv) - (y.ship + y.serv))[0]
    if (heavier) push({ kind: 'léger', product: title(a.k), compared: title(heavier.k), perParcel: (a.ship + a.serv) - (heavier.ship + heavier.serv), parcelsPerMonth: a.perMonth,
      detail: `${kg(a.w)} contre ${kg(heavier.w)} pour ${title(heavier.k)}, mais colis facturé ${eur2(a.ship + a.serv)} contre ${eur2(heavier.ship + heavier.serv)}.` })
  }
  // Préparation : comparée au tarif le plus bas pratiqué.
  const minServ = Math.min(...solo.map(s => s.serv))
  for (const a of solo) if (a.serv >= minServ * 2 && a.serv - minServ >= 0.5) push({ kind: 'préparation', product: title(a.k), compared: null, perParcel: a.serv - minServ, parcelsPerMonth: a.perMonth,
    detail: `Préparation facturée ${eur2(a.serv)} par colis contre ${eur2(minServ)} pour les produits les moins chers à préparer.` })

  const missingWeights = solo.filter(s => !(s.w > 0)).map(s => title(s.k))
  return { anomalies: out.sort((a, b) => b.perMonth - a.perMonth), window: cached.window, missingWeights }
}
