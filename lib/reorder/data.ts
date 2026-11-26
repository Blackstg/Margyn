// Chargement côté serveur des données Réappro (variantes, ventes sur un an, relevés
// de stock, commandes, lignes ignorées, réglages) et écritures associées.
import { mergeSettings, addDays, type ReorderSettings } from './plan'
import type { ReorderInputs, ReorderOrder } from './compute'
import { parisDay } from './snapshots'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = { from: (t: string) => any }

// PostgREST plafonne à 1000 lignes : on pagine.
async function all<T>(q: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>): Promise<T[]> {
  const out: T[] = []
  for (let p = 0; ; p++) {
    const { data, error } = await q(p * 1000, p * 1000 + 999)
    if (error) throw new Error(error.message)
    out.push(...(data ?? []))
    if ((data ?? []).length < 1000) return out
  }
}

export async function loadSettings(db: Db, brand: string): Promise<ReorderSettings> {
  const { data } = await db.from('reorder_settings').select('settings').eq('brand', brand).maybeSingle()
  return mergeSettings(data?.settings)
}

export async function saveSettings(db: Db, brand: string, patch: Partial<ReorderSettings>): Promise<ReorderSettings> {
  const next = { ...(await loadSettings(db, brand)), ...patch }
  const { error } = await db.from('reorder_settings').upsert({ brand, settings: next, updated_at: new Date().toISOString() }, { onConflict: 'brand' })
  if (error) throw new Error(error.message)
  return next
}

type OrderRow = {
  id: string; ordered_on: string; prod_done_on: string; arrival_on: string; status: ReorderOrder['status']; source: ReorderOrder['source']
  total_cost: number; received_on: string | null; note: string | null
  purchase_order_lines: { id: string; shopify_variant_id: string; product_title: string; variant_title: string | null; sku: string | null; qty: number; unit_cost: number; received_qty: number }[]
}

export async function loadOrders(db: Db, brand: string, today: string): Promise<ReorderOrder[]> {
  const { data, error } = await db.from('purchase_orders')
    .select('id, ordered_on, prod_done_on, arrival_on, status, source, total_cost, received_on, note, purchase_order_lines(id, shopify_variant_id, product_title, variant_title, sku, qty, unit_cost, received_qty)')
    .eq('brand', brand)
    .or(`status.eq.open,ordered_on.gte.${addDays(today, -180)}`)
    .order('ordered_on', { ascending: false })
  if (error) throw new Error(error.message)
  return ((data ?? []) as OrderRow[]).map((o) => ({
    id: o.id, orderedOn: o.ordered_on, prodDoneOn: o.prod_done_on, arrivalOn: o.arrival_on, status: o.status, source: o.source,
    totalCost: Number(o.total_cost), receivedOn: o.received_on, note: o.note,
    lines: o.purchase_order_lines.map((l) => ({
      id: l.id, variantId: l.shopify_variant_id, title: l.product_title, variantTitle: l.variant_title, sku: l.sku,
      qty: l.qty, unitCost: Number(l.unit_cost), receivedQty: l.received_qty,
    })),
  }))
}

export async function loadReorderInputs(db: Db, brand: string): Promise<ReorderInputs> {
  const today = parisDay()
  const settings = await loadSettings(db, brand)
  const salesFrom = addDays(today, -Math.max(settings.maxLookbackDays, 365))

  const [variantRows, exclRows, salesRows, snapRows, orders, snoozeRows, manualRows] = await Promise.all([
    all<{ shopify_variant_id: string; shopify_product_id: string; product_title: string; variant_title: string | null; sku: string | null; stock_quantity: number; image_url: string | null; sell_price: number | null; cost_price: number | null }>((a, b) =>
      db.from('product_variants').select('shopify_variant_id, shopify_product_id, product_title, variant_title, sku, stock_quantity, image_url, sell_price, cost_price').eq('brand', brand).order('shopify_variant_id').range(a, b)),
    all<{ product_title: string }>((a, b) => db.from('product_exclusions').select('product_title').eq('brand', brand).range(a, b)),
    all<{ variant_id: string; date: string; quantity: number }>((a, b) =>
      db.from('product_sales').select('variant_id, date, quantity').eq('brand', brand).gte('date', salesFrom).not('variant_id', 'is', null).neq('variant_id', '').order('date').order('order_id').range(a, b)),
    all<{ shopify_variant_id: string; day: string; stock: number }>((a, b) =>
      db.from('stock_snapshots').select('shopify_variant_id, day, stock').eq('brand', brand).gte('day', addDays(today, -180)).order('day').order('shopify_variant_id').order('location_id').range(a, b)),
    loadOrders(db, brand, today),
    all<{ shopify_variant_id: string; until: string }>((a, b) => db.from('reorder_snoozes').select('shopify_variant_id, until').eq('brand', brand).range(a, b)),
    all<{ shopify_variant_id: string; qty: number }>((a, b) => db.from('reorder_production').select('shopify_variant_id, qty').eq('brand', brand).range(a, b)),
  ])

  const sales: ReorderInputs['sales'] = {}
  const firstSale: ReorderInputs['firstSale'] = {}
  for (const r of salesRows) {
    const m = (sales[r.variant_id] ??= {})
    m[r.date] = (m[r.date] ?? 0) + (r.quantity ?? 0)
    if (!firstSale[r.variant_id] || r.date < firstSale[r.variant_id]) firstSale[r.variant_id] = r.date
  }
  const snapshots: ReorderInputs['snapshots'] = {}
  let earliestSnapshot: string | null = null
  for (const r of snapRows) {
    const m = (snapshots[r.shopify_variant_id] ??= {})
    m[r.day] = (m[r.day] ?? 0) + r.stock           // somme des entrepôts
    if (!earliestSnapshot || r.day < earliestSnapshot) earliestSnapshot = r.day
  }

  const excluded = new Set(exclRows.map((r) => r.product_title))
  const ordered = new Set(orders.filter((o) => o.status === 'open').flatMap((o) => o.lines.map((l) => l.variantId)))
  const variants = variantRows
    .filter((v) => !excluded.has(v.product_title) && !v.product_title.includes(' + '))
    // sans vente sur un an, sans stock et sans commande : rien à piloter
    .filter((v) => sales[v.shopify_variant_id] || v.stock_quantity !== 0 || ordered.has(v.shopify_variant_id))
    .map((v) => ({
      id: v.shopify_variant_id, productId: v.shopify_product_id, title: v.product_title, variantTitle: v.variant_title,
      sku: v.sku, image: v.image_url, stock: v.stock_quantity ?? 0, price: Number(v.sell_price ?? 0), cost: Number(v.cost_price ?? 0),
    }))

  return {
    today, variants, sales, firstSale, snapshots, earliestSnapshot, orders,
    snoozes: Object.fromEntries(snoozeRows.filter((r) => r.until > today).map((r) => [r.shopify_variant_id, r.until])),
    manual: Object.fromEntries(manualRows.filter((r) => r.qty > 0).map((r) => [r.shopify_variant_id, r.qty])),
    settings,
  }
}

// ─── Commandes ────────────────────────────────────────────────────────────────

export type NewOrder = {
  orderedOn: string
  source: ReorderOrder['source']
  note?: string | null
  lines: { variantId: string; qty: number; receivedQty?: number }[]
}

export async function createOrder(db: Db, brand: string, o: NewOrder): Promise<string> {
  const settings = await loadSettings(db, brand)
  const ids = o.lines.map((l) => l.variantId)
  const { data: vs } = await db.from('product_variants').select('shopify_variant_id, product_title, variant_title, sku, cost_price').eq('brand', brand).in('shopify_variant_id', ids)
  const byId = new Map(((vs ?? []) as { shopify_variant_id: string; product_title: string; variant_title: string | null; sku: string | null; cost_price: number | null }[]).map((v) => [v.shopify_variant_id, v]))
  const lines = o.lines.filter((l) => l.qty > 0 && byId.has(l.variantId)).map((l) => {
    const v = byId.get(l.variantId)!
    return { shopify_variant_id: l.variantId, product_title: v.product_title, variant_title: v.variant_title, sku: v.sku, qty: Math.floor(l.qty), unit_cost: Number(v.cost_price ?? 0), received_qty: Math.min(Math.floor(l.qty), Math.max(0, Math.floor(l.receivedQty ?? 0))) }
  })
  if (!lines.length) throw new Error('Aucune ligne valide')
  const total = lines.reduce((a, l) => a + l.qty * l.unit_cost, 0)
  const fullyReceived = lines.every((l) => l.received_qty >= l.qty)
  const { data: po, error } = await db.from('purchase_orders').insert({
    brand, ordered_on: o.orderedOn, source: o.source, note: o.note ?? null,
    prod_done_on: addDays(o.orderedOn, settings.fabDays),
    arrival_on: addDays(o.orderedOn, settings.fabDays + settings.transitDays),
    total_cost: Math.round(total * 100) / 100,
    status: fullyReceived ? 'received' : 'open', received_on: fullyReceived ? parisDay() : null,
  }).select('id').single()
  if (error) throw new Error(error.message)
  const { error: lerr } = await db.from('purchase_order_lines').insert(lines.map((l) => ({ ...l, order_id: po.id })))
  if (lerr) { await db.from('purchase_orders').delete().eq('id', po.id); throw new Error(lerr.message) }
  return po.id
}

// Ajoute des unités reçues à une ligne ; la commande se clôt quand tout est reçu.
export async function receive(db: Db, brand: string, orderId: string, items: { variantId: string; qty: number }[], close = false) {
  const { data: po } = await db.from('purchase_orders').select('id').eq('brand', brand).eq('id', orderId).maybeSingle()
  if (!po) throw new Error('Commande introuvable')
  const { data: lines } = await db.from('purchase_order_lines').select('id, shopify_variant_id, qty, received_qty').eq('order_id', orderId)
  const rows = (lines ?? []) as { id: string; shopify_variant_id: string; qty: number; received_qty: number }[]
  for (const it of items) {
    const l = rows.find((r) => r.shopify_variant_id === it.variantId)
    if (!l || it.qty <= 0) continue
    l.received_qty = Math.min(l.qty, l.received_qty + Math.floor(it.qty))
    await db.from('purchase_order_lines').update({ received_qty: l.received_qty }).eq('id', l.id)
  }
  const done = close || rows.every((r) => r.received_qty >= r.qty)
  if (done) await db.from('purchase_orders').update({ status: 'received', received_on: parisDay(), updated_at: new Date().toISOString() }).eq('id', orderId)
  return { closed: done }
}
