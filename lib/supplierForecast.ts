// Prévision usine (Krom) : un batch par mois, l'usine garde un stock tampon prêt.
// Partagé entre la page interne /[brand]/supplier et la page publique /factory/[token]
// (lien secret pour l'usine : ventes en unités, prévisions, batchs — jamais de prix,
// de CA ni de clients).
//
// Modèle (réappro périodique « order-up-to ») :
//   rythme   = 60 % ventes/jour des 30 derniers jours + 40 % des 90 derniers (lisse les pics)
//   batch N  = ventes prévues d'aujourd'hui jusqu'à l'arrivée du batch N+1
//              + sécurité (jours) − stock France − batchs déjà commandés non reçus
//   tampon   = ventes prévues pendant le temps de fabrication × (1 + marge %) :
//              l'usine l'a toujours prêt, donc un pic se rattrape sans attendre 15–20 j,
//              et Krom n'avance pas ce stock (payé quand il est expédié).
import type { SupabaseClient } from '@supabase/supabase-js'
import { randomBytes, timingSafeEqual } from 'crypto'

const BUCKET = 'app-config'
const configPath = (brand: string) => `supplier/${brand}.json`

export type Lang = 'en' | 'zh' | 'fr'

export type ItemConfig = {
  include: boolean
  name?: string        // nom pour l'usine (anglais conseillé)
  nameZh?: string
  sku?: string         // référence usine (sinon SKU Shopify)
  pack?: number        // multiple de commande (carton), 1 par défaut
  moq?: number         // minimum par batch quand on en commande
}

export type BatchStatus = 'confirmed' | 'shipped' | 'received'
export type Batch = {
  id: string
  date: string                    // date d'expédition prévue (YYYY-MM-DD)
  status: BatchStatus
  lines: Record<string, number>   // itemKey → quantité
  note?: string
  createdAt: string
}

export type SupplierConfig = {
  token: string
  factoryName: string
  lang: Lang
  productionDays: number   // fabrication à l'usine
  transitDays: number      // usine → stock France
  batchDay: number         // jour du mois où part le batch
  nextBatchDate?: string   // date forcée du prochain batch (ex. batch d'amorçage), YYYY-MM-DD
  safetyDays: number       // sécurité côté Krom en plus du tampon usine
  bufferPct: number        // marge sur le tampon usine
  showStock: boolean       // montrer le stock France à l'usine
  seasonality: Record<string, number>  // 'MM' → coefficient (1 = normal)
  items: Record<string, ItemConfig>
  note: string             // conditions du deal, affichées à l'usine
  batches: Batch[]
}

export const DEFAULT_NOTE =
  'Proposal: one batch per month. Each month we confirm a firm order for the next batch (column "Next batch"). ' +
  'Please keep the "Buffer stock" finished and ready to ship at all times: it covers your production time if sales jump. ' +
  'The buffer is not ordered yet; it is paid when it ships, and we commit to take it within the next batches. ' +
  'Months +2 and +3 are forecasts to help you plan materials, not firm orders.'

const DEFAULTS: Omit<SupplierConfig, 'token'> = {
  factoryName: '', lang: 'en',
  productionDays: 20, transitDays: 10, batchDay: 5, safetyDays: 7, bufferPct: 30,
  showStock: true, seasonality: {}, items: {}, note: DEFAULT_NOTE, batches: [],
}

export const newToken = (brand: string) => `${brand}-${randomBytes(16).toString('hex')}`

export async function loadConfig(sb: SupabaseClient, brand: string): Promise<SupplierConfig | null> {
  const { data, error } = await sb.storage.from(BUCKET).download(configPath(brand))
  if (error || !data) return null
  try {
    const saved = JSON.parse(await data.text()) as Partial<SupplierConfig>
    return { ...DEFAULTS, token: '', ...saved, seasonality: saved.seasonality ?? {}, items: saved.items ?? {}, batches: saved.batches ?? [] }
  } catch { return null }
}

// Config existante, sinon une neuve avec un lien secret
export async function loadOrInitConfig(sb: SupabaseClient, brand: string): Promise<SupplierConfig> {
  const c = await loadConfig(sb, brand)
  if (c?.token) return c
  const fresh: SupplierConfig = { ...DEFAULTS, ...(c ?? {}), token: newToken(brand) }
  await saveConfig(sb, brand, fresh)
  return fresh
}

export async function saveConfig(sb: SupabaseClient, brand: string, c: SupplierConfig) {
  const body = JSON.stringify(c)
  let { error } = await sb.storage.from(BUCKET).upload(configPath(brand), body, { upsert: true, contentType: 'application/json' })
  if (error && /not found|bucket/i.test(error.message)) {
    await sb.storage.createBucket(BUCKET, { public: false })
    ;({ error } = await sb.storage.from(BUCKET).upload(configPath(brand), body, { upsert: true, contentType: 'application/json' }))
  }
  if (error) throw new Error(error.message)
}

export function tokenMatches(expected: string, given: string): boolean {
  const a = Buffer.from(expected), b = Buffer.from(given)
  return a.length === b.length && a.length > 0 && timingSafeEqual(a, b)
}

// ─── Regroupement des variantes Shopify en articles « usine » ────────────────
// « Bouteille d'eau 1L (Lot de 2) » = 2 × « Bouteille d'eau 1L » ;
// « … Free » (offerte avec la machine) = la même bouteille.
const PACK_RE = /\s*\((?:lot|pack)\s+de\s+(\d+)\)\s*/i
const FREE_RE = /\s+(?:free|offerte?|gratuite?)\s*$/i

export function baseOf(title: string): { base: string; mult: number } {
  const m = title.match(PACK_RE)
  const base = title.replace(PACK_RE, ' ').replace(FREE_RE, '').replace(/\s+/g, ' ').trim()
  return { base, mult: m ? Math.max(1, Number(m[1])) : 1 }
}

const slug = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')

// Traduction par défaut des noms (modifiable dans la page interne)
const EN: [RegExp, string][] = [
  [/sparkle®?\s*pro\s*-\s*machine à eau pétillante/i, 'Sparkle Pro sparkling water maker'],
  [/sparkle®?\s*-\s*machine à eau pétillante/i, 'Sparkle sparkling water maker'],
  [/bouteille d'eau en verre/i, 'Glass water bottle'],
  [/bouteille isotherme acier/i, 'Insulated steel bottle'],
  [/bouteille d'eau/i, 'Water bottle'],
  [/bouchon bouteille/i, 'Bottle cap'],
  [/cylindre de gaz co2/i, 'CO2 gas cylinder'],
  [/noir mat/i, 'Matte black'],
]
const ZH: [RegExp, string][] = [
  [/sparkle®?\s*pro\s*-\s*machine à eau pétillante/i, 'Sparkle Pro 气泡水机'],
  [/sparkle®?\s*-\s*machine à eau pétillante/i, 'Sparkle 气泡水机'],
  [/bouteille d'eau en verre/i, '玻璃水瓶'],
  [/bouteille isotherme acier/i, '不锈钢保温瓶'],
  [/bouteille d'eau/i, '水瓶'],
  [/bouchon bouteille/i, '瓶盖'],
  [/cylindre de gaz co2/i, 'CO2 气瓶'],
  [/noir mat/i, '哑光黑'],
  [/silver/i, '银色'],
]
const translate = (s: string, dict: [RegExp, string][]) => dict.reduce((acc, [re, to]) => acc.replace(re, to), s)

// ─── Dates (jour de Paris) ───────────────────────────────────────────────────
const parisDay = (d: Date) => d.toLocaleDateString('sv-SE', { timeZone: 'Europe/Paris' })
const addDays = (day: string, n: number) => { const d = new Date(day + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10) }
const diffDays = (a: string, b: string) => Math.round((new Date(b + 'T12:00:00Z').getTime() - new Date(a + 'T12:00:00Z').getTime()) / 86400_000)
const monthOf = (day: string) => day.slice(0, 7)
const addMonths = (month: string, n: number) => { const [y, m] = month.split('-').map(Number); const d = new Date(Date.UTC(y, m - 1 + n, 1)); return d.toISOString().slice(0, 7) }
const daysInMonth = (month: string) => { const [y, m] = month.split('-').map(Number); return new Date(Date.UTC(y, m, 0)).getUTCDate() }
const atDay = (month: string, day: number) => `${month}-${String(Math.min(day, daysInMonth(month))).padStart(2, '0')}`

// ─── Calcul ──────────────────────────────────────────────────────────────────
export type ItemForecast = {
  key: string
  name: string; nameZh: string; nameFr: string; sku: string | null
  composition: { title: string; variant: string | null; mult: number; variantId: string }[]
  include: boolean; pack: number; moq: number
  history: { month: string; units: number; partial: boolean }[]
  perDay: number            // rythme retenu
  perMonth: number          // = perDay × 30,4
  stock: number             // stock France (Shopify), packs × contenu
  incoming: number          // batchs commandés non reçus
  stockoutDate: string | null
  nextBatch: number         // commande ferme proposée par le calcul
  confirmed: number | null  // quantité validée pour ce batch (prime sur le calcul)
  buffer: number            // tampon à garder prêt à l'usine
  forecast: { month: string; units: number }[]  // ventes prévues M+1..M+3
  following: number[]       // batchs suivants (indicatifs)
}

export type Forecast = {
  brand: string
  generatedAt: string
  today: string
  config: Omit<SupplierConfig, 'token'>
  schedule: { batchDate: string; orderBy: string; arrival: string; following: { batchDate: string; arrival: string }[] }
  items: ItemForecast[]
  lateWarning: boolean      // rupture avant l'arrivée du prochain batch sur au moins un article
}

const coefOf = (c: SupplierConfig, day: string) => Number(c.seasonality[day.slice(5, 7)] ?? 1) || 1
// Ventes prévues sur [from, to[ au rythme r, avec les coefficients de saison
function demand(c: SupplierConfig, r: number, from: string, to: string) {
  let s = 0
  for (let d = from; d < to; d = addDays(d, 1)) s += r * coefOf(c, d)
  return s
}
const roundUp = (q: number, pack: number, moq: number) => {
  if (q <= 0) return 0
  const v = Math.ceil(Math.max(q, moq) / pack) * pack
  return v
}

export async function computeForecast(sb: SupabaseClient, brand: string, config: SupplierConfig, now = new Date()): Promise<Forecast> {
  const today = parisDay(now)
  const histFrom = atDay(addMonths(monthOf(today), -11), 1)

  const { data: variants } = await sb.from('product_variants')
    .select('shopify_variant_id, product_title, variant_title, sku, stock_quantity, product_status')
    .eq('brand', brand)
  const sales: { date: string; variant_id: string | null; quantity: number | null; product_title: string | null; variant_title: string | null }[] = []
  for (let p = 0; ; p++) {
    const { data, error } = await sb.from('product_sales')
      .select('date, variant_id, quantity, product_title, variant_title')
      .eq('brand', brand).gte('date', histFrom).order('date').range(p * 1000, p * 1000 + 999)
    if (error) throw new Error(error.message)
    sales.push(...(data ?? []))
    if (!data || data.length < 1000) break
  }

  // Titre par variante : catalogue Shopify, sinon la vente la plus récente
  const vInfo = new Map<string, { title: string; variant: string | null; sku: string | null; stock: number }>()
  for (const v of variants ?? []) vInfo.set(String(v.shopify_variant_id), {
    title: v.product_title ?? '', variant: v.variant_title ?? null, sku: v.sku ?? null, stock: Math.max(0, Number(v.stock_quantity) || 0),
  })
  for (const s of sales) {
    const id = String(s.variant_id ?? '')
    if (!id) continue
    const cur = vInfo.get(id)
    if (!cur) vInfo.set(id, { title: s.product_title ?? '', variant: s.variant_title || null, sku: null, stock: 0 })
    else if (!cur.variant && s.variant_title) cur.variant = s.variant_title
  }

  // Variantes → articles usine
  type Group = { key: string; title: string; variant: string | null; sku: string | null; comp: ItemForecast['composition']; stock: number }
  const groups = new Map<string, Group>()
  const groupOf = new Map<string, { key: string; mult: number }>()
  for (const [id, v] of vInfo) {
    const { base, mult } = baseOf(v.title)
    const key = slug(`${base} ${v.variant ?? ''}`)
    const g = groups.get(key) ?? { key, title: base, variant: v.variant, sku: null, comp: [], stock: 0 }
    g.comp.push({ title: v.title, variant: v.variant, mult, variantId: id })
    g.stock += v.stock * mult
    if (mult === 1 && v.sku && !FREE_RE.test(v.title)) g.sku = g.sku ?? v.sku
    groups.set(key, g)
    groupOf.set(id, { key, mult })
  }

  // Ventes par article et par jour
  const daily = new Map<string, Map<string, number>>()
  const first = new Map<string, string>()
  for (const s of sales) {
    const g = groupOf.get(String(s.variant_id ?? ''))
    if (!g) continue
    const q = (Number(s.quantity) || 0) * g.mult
    const m = daily.get(g.key) ?? new Map<string, number>()
    m.set(s.date, (m.get(s.date) ?? 0) + q)
    daily.set(g.key, m)
    if (!first.has(g.key) || s.date < first.get(g.key)!) first.set(g.key, s.date)
  }

  // Calendrier : batch le `batchDay` du mois, commande ferme `productionDays` avant
  // (ou à la date forcée, tant qu'elle n'est pas passée)
  let bMonth = monthOf(today)
  while (diffDays(today, atDay(bMonth, config.batchDay)) < config.productionDays) bMonth = addMonths(bMonth, 1)
  const forced = config.nextBatchDate && config.nextBatchDate >= today ? config.nextBatchDate : null
  if (forced) bMonth = monthOf(forced)
  const batchDate = forced ?? atDay(bMonth, config.batchDay)
  const arrivalOf = (m: string) => addDays(atDay(m, config.batchDay), config.transitDays)
  const arrival = addDays(batchDate, config.transitDays)
  const following = [1, 2, 3].map(k => ({ batchDate: atDay(addMonths(bMonth, k), config.batchDay), arrival: arrivalOf(addMonths(bMonth, k)) }))

  const openBatches = config.batches.filter(b => b.status !== 'received')
  const thisBatch = config.batches.find(b => b.date === batchDate && b.status !== 'received')
  const yesterday = addDays(today, -1)
  const histMonths = Array.from({ length: 12 }, (_, i) => addMonths(monthOf(today), i - 11))

  const items: ItemForecast[] = []
  for (const g of groups.values()) {
    const d = daily.get(g.key) ?? new Map<string, number>()
    const f = first.get(g.key)
    const sumRange = (from: string, to: string) => { let s = 0; for (const [day, q] of d) if (day >= from && day <= to) s += q; return s }
    const rateOver = (days: number) => {
      if (!f) return 0
      const from = addDays(today, -days)
      const span = Math.max(1, Math.min(days, diffDays(f, today)))
      return sumRange(from > f ? from : f, yesterday) / span
    }
    const sold90 = f ? sumRange(addDays(today, -90), today) : 0
    const cfg = config.items[g.key]
    const include = cfg?.include ?? sold90 > 0
    const perDay = 0.6 * rateOver(30) + 0.4 * rateOver(90)
    const pack = Math.max(1, Math.round(cfg?.pack ?? 1))
    const moq = Math.max(0, Math.round(cfg?.moq ?? 0))
    const incoming = openBatches.filter(b => b !== thisBatch).reduce((s, b) => s + (b.lines[g.key] ?? 0), 0)

    // Commande ferme : couvrir jusqu'à l'arrivée du batch suivant (+ sécurité)
    const need = demand(config, perDay, today, following[0].arrival) + perDay * config.safetyDays - g.stock - incoming
    const nextBatch = roundUp(need, pack, moq)
    const confirmed = thisBatch ? thisBatch.lines[g.key] ?? 0 : null
    // Batchs suivants : un mois de ventes chacun (entre deux arrivées)
    const arrivals = following.map(x => x.arrival)
    const followingQty = arrivals.slice(0, 2).map((a, i) => roundUp(demand(config, perDay, a, arrivals[i + 1]), pack, 0))
    // Tampon usine : ventes pendant la fabrication, au rythme du mois du batch
    const buffer = perDay > 0 ? roundUp(perDay * coefOf(config, batchDate) * config.productionDays * (1 + config.bufferPct / 100), pack, 0) : 0

    // Rupture (stock + commandé) au rythme prévu
    let left = g.stock + incoming, stockoutDate: string | null = null
    if (perDay > 0) for (let day = today, i = 0; i < 400; i++, day = addDays(day, 1)) {
      left -= perDay * coefOf(config, day)
      if (left < 0) { stockoutDate = day; break }
    }

    const fr = g.variant ? `${g.title} — ${g.variant}` : g.title
    items.push({
      key: g.key,
      name: cfg?.name || translate(fr, EN), nameZh: cfg?.nameZh || translate(fr, ZH), nameFr: fr,
      sku: cfg?.sku || g.sku,
      composition: g.comp.sort((a, b) => a.mult - b.mult || a.title.localeCompare(b.title)),
      include, pack, moq,
      history: histMonths.filter(m => !f || m >= monthOf(f)).map(m => ({
        month: m, units: sumRange(`${m}-01`, `${m}-31`), partial: m === monthOf(today),
      })),
      perDay, perMonth: perDay * 30.4,
      stock: g.stock, incoming, stockoutDate,
      nextBatch, confirmed, buffer,
      forecast: [1, 2, 3].map(k => {
        const m = addMonths(monthOf(today), k)
        return { month: m, units: Math.round(demand(config, perDay, `${m}-01`, `${addMonths(m, 1)}-01`)) }
      }),
      following: followingQty,
    })
  }
  items.sort((a, b) => Number(b.include) - Number(a.include) || b.perDay - a.perDay)

  const { token: _t, ...publicConfig } = config
  void _t
  return {
    brand, generatedAt: now.toISOString(), today, config: publicConfig,
    schedule: { batchDate, orderBy: [addDays(batchDate, -config.productionDays), today].sort()[1], arrival, following },
    items,
    lateWarning: items.some(i => i.include && i.stockoutDate != null && i.stockoutDate < arrival),
  }
}
