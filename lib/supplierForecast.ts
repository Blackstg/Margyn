// Page « usine » (Krom) : rassurer le fabricant avec les ventes en direct, la
// progression par produit et les prévisions, pour qu'il prépare du stock pour nous
// sans que Krom avance la marchandise. Partagé entre la page interne /[brand]/supplier
// et la page publique /factory/[token] (lien secret ; unités seulement — jamais de
// prix, de CA ni de clients).
//
// Modèle :
//   rythme      = 60 % ventes/jour des 30 derniers jours + 40 % des 90 derniers,
//                 × coefficient du mois (Black Friday, Noël…)
//   délai       = fabrication + transport jusqu'à l'entrepôt Forrest
//   urgent      = ventes prévues pendant ce délai + sécurité − stock Forrest
//                 (ce qui manquera avant qu'une nouvelle production puisse arriver)
//   à préparer  = ventes prévues sur délai + N mois + sécurité − stock Forrest
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
}

export type SupplierConfig = {
  token: string
  factoryName: string
  lang: Lang
  productionDays: number   // fabrication à l'usine
  transitDays: number      // usine → entrepôt Forrest
  horizonMonths: number    // mois de ventes couverts par le stock à préparer, après le délai
  safetyDays: number
  showStock: boolean       // montrer le stock Forrest à l'usine
  seasonality: Record<string, number>  // 'MM' → coefficient (1 = normal)
  items: Record<string, ItemConfig>
  note: string             // message libre affiché à l'usine
  factory: FactoryState    // ce que l'usine déclare elle-même sur sa page
}

// Déclaré par l'usine sur sa page (lien secret) : son stock prêt pour nous et ses envois.
// Un envoi compte « en route » jusqu'à ce que le stock Forrest remonte (réception dans
// Shopify), ou au plus tard quelques jours après l'arrivée prévue.
export type FactoryShipment = {
  id: string
  date: string                       // date d'envoi (YYYY-MM-DD)
  lines: Record<string, number>      // itemKey → quantité
  stockAt: Record<string, number>    // stock Forrest au moment de la déclaration
  createdAt: string
}
export type FactoryState = {
  ready: Record<string, number>      // itemKey → pièces prêtes pour nous à l'usine
  readyAt: Record<string, string>    // itemKey → date de mise à jour
  shipments: FactoryShipment[]
}

const DEFAULTS: Omit<SupplierConfig, 'token'> = {
  factoryName: '', lang: 'en',
  productionDays: 20, transitDays: 3, horizonMonths: 2, safetyDays: 7,
  showStock: true, seasonality: { '11': 1.3, '12': 1.3 }, items: {}, note: '',
  factory: { ready: {}, readyAt: {}, shipments: [] },
}

export const newToken = (brand: string) => `${brand}-${randomBytes(16).toString('hex')}`

export async function loadConfig(sb: SupabaseClient, brand: string): Promise<SupplierConfig | null> {
  const { data, error } = await sb.storage.from(BUCKET).download(configPath(brand))
  if (error || !data) return null
  try {
    // (les anciens réglages « batch mensuel » sont ignorés)
    const { batches: _b, batchDay: _d, nextBatchDate: _n, bufferPct: _p, ...saved } = JSON.parse(await data.text()) as Partial<SupplierConfig> & Record<string, unknown>
    void _b; void _d; void _n; void _p
    return {
      ...DEFAULTS, token: '', ...saved,
      // pas encore de saisonnalité enregistrée → Black Friday / Noël par défaut
      seasonality: saved.seasonality && Object.keys(saved.seasonality).length ? saved.seasonality : DEFAULTS.seasonality,
      items: saved.items ?? {},
      factory: { ready: saved.factory?.ready ?? {}, readyAt: saved.factory?.readyAt ?? {}, shipments: saved.factory?.shipments ?? [] },
    }
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

// ─── Calcul ──────────────────────────────────────────────────────────────────
export type ItemForecast = {
  key: string
  name: string; nameZh: string; nameFr: string; sku: string | null
  image: string | null
  machine: boolean
  composition: { title: string; variant: string | null; mult: number; variantId: string }[]
  include: boolean; pack: number
  history: { month: string; units: number; partial: boolean; estimate: number | null }[]  // estimate = mois en cours projeté
  forecast: { month: string; units: number }[]  // 3 mois suivants
  perMonth: number          // rythme actuel, ventes / mois
  last7: number; last30: number; monthToDate: number
  growth: number | null     // 30 derniers jours vs 30 précédents
  stock: number             // stock Forrest (Shopify), lots × contenu
  stockoutDate: string | null
  urgent: number            // à envoyer au plus vite (rupture avant une nouvelle production)
  suggested: number         // stock à préparer pour nous (inclut l'urgent)
  incoming: number          // envoyé par l'usine, pas encore reçu chez Forrest
  incomingArrival: string | null
  ready: number | null      // stock prêt pour nous déclaré par l'usine
  readyAt: string | null
}

export type Forecast = {
  brand: string
  generatedAt: string
  today: string
  config: Omit<SupplierConfig, 'token'>
  leadDays: number
  coverUntil: string        // le stock à préparer couvre jusqu'à cette date
  items: ItemForecast[]
}

const coefOf = (c: SupplierConfig, day: string) => Number(c.seasonality[day.slice(5, 7)] ?? 1) || 1
// Ventes prévues sur [from, to[ au rythme r, avec les coefficients de saison
function demand(c: SupplierConfig, r: number, from: string, to: string) {
  let s = 0
  for (let d = from; d < to; d = addDays(d, 1)) s += r * coefOf(c, d)
  return s
}
// Quantités « rondes » : au carton si renseigné, sinon par 5 (< 50), 10 (< 200) ou 50
const step = (q: number) => q < 50 ? 5 : q < 200 ? 10 : 50
const roundUp = (q: number, pack: number) => {
  if (q <= 0.5) return 0
  const unit = pack > 1 ? pack : step(q)
  return Math.ceil(q / unit) * unit
}
// En dessous de ce volume (unités / mois), l'article n'est pas montré par défaut
export const MIN_MONTHLY = 5
const isMachine = (title: string) => /machine|maker/i.test(title)

export async function computeForecast(sb: SupabaseClient, brand: string, config: SupplierConfig, now = new Date()): Promise<Forecast> {
  const today = parisDay(now)
  const histFrom = `${addMonths(monthOf(today), -11)}-01`

  const { data: variants } = await sb.from('product_variants')
    .select('shopify_variant_id, product_title, variant_title, sku, stock_quantity, image_url')
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
  const vInfo = new Map<string, { title: string; variant: string | null; sku: string | null; stock: number; image: string | null }>()
  for (const v of variants ?? []) vInfo.set(String(v.shopify_variant_id), {
    title: v.product_title ?? '', variant: v.variant_title ?? null, sku: v.sku ?? null, stock: Math.max(0, Number(v.stock_quantity) || 0), image: v.image_url ?? null,
  })
  for (const s of sales) {
    const id = String(s.variant_id ?? '')
    if (!id) continue
    const cur = vInfo.get(id)
    if (!cur) vInfo.set(id, { title: s.product_title ?? '', variant: s.variant_title || null, sku: null, stock: 0, image: null })
    else if (!cur.variant && s.variant_title) cur.variant = s.variant_title
  }

  // Variantes → articles usine
  type Group = { key: string; title: string; variant: string | null; sku: string | null; image: string | null; comp: ItemForecast['composition']; stock: number }
  const groups = new Map<string, Group>()
  const groupOf = new Map<string, { key: string; mult: number }>()
  for (const [id, v] of vInfo) {
    const { base, mult } = baseOf(v.title)
    const key = slug(`${base} ${v.variant ?? ''}`)
    const g = groups.get(key) ?? { key, title: base, variant: v.variant, sku: null, image: null, comp: [], stock: 0 }
    g.comp.push({ title: v.title, variant: v.variant, mult, variantId: id })
    g.stock += v.stock * mult
    if (mult === 1 && v.sku && !FREE_RE.test(v.title)) g.sku = g.sku ?? v.sku
    if (v.image && (!g.image || (mult === 1 && !FREE_RE.test(v.title)))) g.image = v.image
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

  const leadDays = config.productionDays + config.transitDays
  const leadEnd = addDays(today, leadDays)
  const coverUntil = addDays(leadEnd, Math.round(config.horizonMonths * 30.4))
  const yesterday = addDays(today, -1)
  const curMonth = monthOf(today)
  const nextMonthStart = `${addMonths(curMonth, 1)}-01`

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
    const cfg = config.items[g.key]
    const perDay = 0.6 * rateOver(30) + 0.4 * rateOver(90)
    const include = cfg?.include ?? perDay * 30.4 >= MIN_MONTHLY
    const pack = Math.max(1, Math.round(cfg?.pack ?? 1))
    const safety = perDay * config.safetyDays
    // Envois déclarés par l'usine, pas encore entrés dans le stock Forrest
    const enRoute = config.factory.shipments.filter(sh => (sh.lines[g.key] ?? 0) > 0
      && addDays(sh.date, config.transitDays + 4) > today && g.stock <= (sh.stockAt[g.key] ?? 0))
    const incoming = enRoute.reduce((a, sh) => a + sh.lines[g.key], 0)
    const have = g.stock + incoming

    const last30 = sumRange(addDays(today, -30), yesterday)
    const prev30 = sumRange(addDays(today, -60), addDays(today, -31))
    const monthToDate = sumRange(`${curMonth}-01`, today)

    let left = have, stockoutDate: string | null = null
    if (perDay > 0) for (let day = today, i = 0; i < 400; i++, day = addDays(day, 1)) {
      left -= perDay * coefOf(config, day)
      if (left < 0) { stockoutDate = day; break }
    }

    const fr = g.variant ? `${g.title} — ${g.variant}` : g.title
    items.push({
      key: g.key,
      name: cfg?.name || translate(fr, EN), nameZh: cfg?.nameZh || translate(fr, ZH), nameFr: fr,
      sku: cfg?.sku || g.sku, image: g.image, machine: isMachine(g.title),
      composition: g.comp.sort((a, b) => a.mult - b.mult || a.title.localeCompare(b.title)),
      include, pack,
      history: Array.from({ length: 12 }, (_, i) => addMonths(curMonth, i - 11))
        .filter(m => f && m >= monthOf(f))
        .map(m => {
          const units = sumRange(`${m}-01`, `${m}-31`)
          const partial = m === curMonth
          return { month: m, units, partial, estimate: partial ? Math.round(monthToDate + demand(config, perDay, today, nextMonthStart)) : null }
        }),
      forecast: [1, 2, 3].map(k => {
        const m = addMonths(curMonth, k)
        return { month: m, units: Math.round(demand(config, perDay, `${m}-01`, `${addMonths(m, 1)}-01`)) }
      }),
      perMonth: perDay * 30.4,
      last7: sumRange(addDays(today, -7), today), last30, monthToDate,
      growth: prev30 >= 3 ? last30 / prev30 - 1 : null,
      stock: g.stock, stockoutDate,
      urgent: roundUp(demand(config, perDay, today, leadEnd) + safety - have, pack),
      suggested: roundUp(demand(config, perDay, today, coverUntil) + safety - have, pack),
      incoming, incomingArrival: enRoute.length ? addDays(enRoute.map(sh => sh.date).sort().at(-1)!, config.transitDays) : null,
      ready: config.factory.ready[g.key] ?? null, readyAt: config.factory.readyAt[g.key] ?? null,
    })
  }
  // Machines d'abord, puis le reste ; chacun par volume de ventes
  items.sort((a, b) => Number(b.include) - Number(a.include) || Number(b.machine) - Number(a.machine) || b.perMonth - a.perMonth)

  const { token: _t, ...publicConfig } = config
  void _t
  return { brand, generatedAt: now.toISOString(), today, config: publicConfig, leadDays, coverUntil, items }
}
