import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

// Chiffrage mensuel de ce qu'on doit au sous-traitant livraison (Terence, dépôt
// Bordeaux) d'après SA grille : un forfait HT par commande livrée, selon la zone
// (distance routière aller depuis le dépôt) × la tranche de panneaux.
//
// Règles métier :
//  - un seul forfait par commande : une représentation après absence (arrêt
//    « failed » puis re-livré) ou un fractionnement n'est PAS refacturé ;
//  - seuls les arrêts livrés (delivered/partial) sont facturés ;
//  - accessoires (colle, vis, tasseaux…) et envois La Poste non refacturés :
//    le prix au panneau est volontairement gonflé pour les inclure. Une commande
//    sans aucun panneau n'est donc pas facturée.

function getAdmin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  )
}

// Réglages + cache des distances stockés en JSON dans Storage (pas de table dédiée).
const BUCKET = 'app-config'
const settingsPath = (brand: string) => `${brand}/subcontract-billing.json`
const kmCachePath = (brand: string) => `${brand}/subcontract-km.json`

export type SubcontractSettings = {
  name: string
  depot: { label: string; lat: number; lng: number }
  zoneLimitsKm: [number, number]       // Zone 1 ≤ a, Zone 2 ≤ b, Zone 3 au-delà
  grid: number[][]                     // [zone][tranche] en € HT
  drivers: string[]                    // chauffeurs (noms des tournées) facturés par le sous-traitant
  countStones: boolean                 // feuilles de pierre comptées comme panneaux
  startDate: string                    // début de la collaboration
  vatRate: number
  internal: InternalDriverSettings     // onglet « Moha » : chauffeur interne vs tout chez Terence
}

// Chauffeur indépendant payé à la journée, sur NOTRE camion avec NOTRE CB
// (carburant, péages, hôtel, repas). Valeurs par défaut tirées de la feuille
// transport mai–sept. 2026 (carburant ≈ 0,30 €/km, péages ≈ 0,11 €/km).
export type InternalDriverSettings = {
  dayRate: number          // tarif actuel €/jour
  askedRate: number        // tarif qu'il demande
  fuelPerKm: number
  tollPerKm: number
  hotelNight: number       // hôtel par nuit dehors
  mealsPerDay: number      // repas midi + soir
  travelDays: number       // jours d'aller/retour en plus des jours de livraison
  truckMonthly: number     // leasing + assurance + entretien (économisé si tout part chez Terence)
  depotMonthly: number     // loyer dépôt Bourges (supprimé si tout part chez Terence)
  adminHours: number       // gestion du gars / mois (tickets, notes de frais, planning)
  hourlyRate: number
  toursPerMonth: number    // tournées confiées au chauffeur interne par mois
  daysByTour: Record<string, number>    // jours payés par tournée (sinon jours de livraison)
  nightsByTour: Record<string, number>
}

// Grille « Bowa — Tarifs de livraison, départ Bordeaux » du 9 octobre 2026.
const DEFAULT_SETTINGS: SubcontractSettings = {
  name: 'Terence',
  depot: { label: '5 chemin de la Palue de la Blanche, 33440 Ambarès-et-Lagrave', lat: 44.942786, lng: -0.51302 },
  zoneLimitsKm: [100, 300],
  grid: [
    [70, 100, 160, 240],
    [90, 130, 190, 280],
    [130, 160, 240, 360],
  ],
  drivers: [],                         // vide = auto : tous les « Terence… »
  countStones: true,
  startDate: '2026-10-01',
  vatRate: 20,
  internal: {
    dayRate: 200, askedRate: 250, fuelPerKm: 0.30, tollPerKm: 0.11, hotelNight: 90, mealsPerDay: 30,
    travelDays: 1, truckMonthly: 1400, depotMonthly: 990, adminHours: 4, hourlyRate: 35, toursPerMonth: 2,
    daysByTour: {}, nightsByTour: {},
  },
}

const BUCKETS = [
  { label: '1 à 3', max: 3 },
  { label: '4 à 7', max: 7 },
  { label: '8 à 12', max: 12 },
  { label: '13+', max: Infinity },
]

const isStonepanel = (title: string) => /stonepanel|feuille\s*de\s*pierre/i.test(title)
function stonesFromDetails(details: unknown): number {
  if (!Array.isArray(details)) return 0
  return (details as { title?: string; qty?: number }[])
    .filter(d => isStonepanel(d.title ?? ''))
    .reduce((s, d) => s + (d.qty ?? 0), 0)
}

// « Terence & Terence 1 » → ['Terence', 'Terence 1']
const driverParts = (name: string | null) =>
  (name ?? '').split(/\s*[&,]\s*/).map(s => s.trim()).filter(Boolean)

async function readJson<T>(admin: ReturnType<typeof getAdmin>, path: string): Promise<T | null> {
  const { data, error } = await admin.storage.from(BUCKET).download(path)
  if (error || !data) return null
  try { return JSON.parse(await data.text()) as T } catch { return null }
}
async function writeJson(admin: ReturnType<typeof getAdmin>, path: string, value: unknown) {
  const body = Buffer.from(JSON.stringify(value))
  let { error } = await admin.storage.from(BUCKET).upload(path, body, { upsert: true, contentType: 'application/json' })
  if (error && /bucket/i.test(error.message)) {
    await admin.storage.createBucket(BUCKET, { public: false })
    ;({ error } = await admin.storage.from(BUCKET).upload(path, body, { upsert: true, contentType: 'application/json' }))
  }
  if (error) throw new Error(error.message)
}

async function loadSettings(admin: ReturnType<typeof getAdmin>, brand: string): Promise<SubcontractSettings> {
  const saved = await readJson<Partial<SubcontractSettings>>(admin, settingsPath(brand))
  return { ...DEFAULT_SETTINGS, ...(saved ?? {}), internal: { ...DEFAULT_SETTINGS.internal, ...(saved?.internal ?? {}) } }
}

const haversineKm = (a: { lat: number; lng: number }, b: { lat: number; lng: number }) => {
  const R = 6371, dLat = (b.lat - a.lat) * Math.PI / 180, dLng = (b.lng - a.lng) * Math.PI / 180
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * Math.PI / 180) * Math.cos(b.lat * Math.PI / 180) * Math.sin(dLng / 2) ** 2
  return R * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h))
}

// Distances routières dépôt → destinations via OSRM (OpenStreetMap, sans clé).
// Renvoie km par index ; null si le service ne répond pas (repli vol d'oiseau).
async function roadKm(depot: { lat: number; lng: number }, dests: { lat: number; lng: number }[]): Promise<(number | null)[]> {
  const out: (number | null)[] = []
  for (let i = 0; i < dests.length; i += 80) {
    const chunk = dests.slice(i, i + 80)
    const coords = [depot, ...chunk].map(p => `${p.lng.toFixed(5)},${p.lat.toFixed(5)}`).join(';')
    try {
      const res = await fetch(`https://router.project-osrm.org/table/v1/driving/${coords}?sources=0&annotations=distance`, {
        signal: AbortSignal.timeout(15_000), cache: 'no-store',
      })
      const j = await res.json()
      const row: (number | null)[] = j?.distances?.[0] ?? []
      chunk.forEach((_, k) => { const m = row[k + 1]; out.push(typeof m === 'number' ? Math.round(m / 1000) : null) })
    } catch {
      chunk.forEach(() => out.push(null))
    }
  }
  return out
}

type Line = {
  order: string
  customer: string
  city: string
  zip: string
  driver: string
  tourId: string
  date: string            // date de livraison facturée (1ʳᵉ livraison)
  km: number | null
  kmEstimated: boolean    // true = vol d'oiseau × 1,3 (routage indisponible)
  zone: number | null     // 0..2, null = sur devis (Corse) ou sans géoloc
  panels: number
  stones: number
  billedQty: number
  bucket: number
  price: number | null
  attempts: number        // passages (dont absences) — seule la livraison est facturée
  merged: number          // nb de commandes regroupées (même adresse, même jour)
  revenueHT: number | null  // CA HT des commandes livrées (Shopify, TTC ÷ 1,2)
  cogs: number | null       // coût d'achat des produits
  margin: number | null     // CA HT − coût produits − prix livraison
  note?: string
}

// GET ?brand=bowa&month=2026-10 → lignes facturables du mois + réglages
export async function GET(req: NextRequest) {
  try {
    const brand = req.nextUrl.searchParams.get('brand') ?? 'bowa'
    // Période : ?month=YYYY-MM, ou ?from=YYYY-MM-DD&to=YYYY-MM-DD (dashboard). Jours en heure de Paris.
    const month = req.nextUrl.searchParams.get('month') ?? new Date().toISOString().slice(0, 7)
    const [my, mm] = month.split('-').map(Number)
    const from = req.nextUrl.searchParams.get('from') ?? `${month}-01`
    const to = req.nextUrl.searchParams.get('to') ?? `${month}-${String(new Date(my, mm, 0).getDate()).padStart(2, '0')}`
    const parisDay = (iso: string) => new Date(iso).toLocaleDateString('sv-SE', { timeZone: 'Europe/Paris' })
    const inPeriod = (iso: string | null) => { if (!iso) return false; const d = parisDay(iso); return d >= from && d <= to }
    const admin = getAdmin()
    const settings = await loadSettings(admin, brand)

    // Tournées depuis le début de la collaboration (marge d'une semaine pour les
    // tournées planifiées un peu avant).
    // ?drivers=moha,noah : simulation « et si Terence avait fait ces tournées »
    // (onglet Moha) — ne modifie pas la sélection enregistrée.
    const driversParam = req.nextUrl.searchParams.get('drivers')
    const start = driversParam && from < settings.startDate ? from : settings.startDate
    const since = new Date(new Date(start).getTime() - 7 * 86400_000).toISOString().slice(0, 10)
    const { data: tours } = await admin
      .from('delivery_tours').select('id, name, driver_name, planned_date, total_km, cost_fuel, cost_toll, cost_hotel, cost_meal')
      .eq('brand', brand).gte('planned_date', since).limit(5000)

    const allDrivers = [...new Set((tours ?? []).flatMap(t => driverParts(t.driver_name)))].sort((a, b) => a.localeCompare(b, 'fr'))
    const selected = driversParam
      ? new Set(driversParam.split(',').map(d => d.trim().toLowerCase()).filter(Boolean))
      : settings.drivers.length > 0
      ? new Set(settings.drivers.map(d => d.toLowerCase()))
      : new Set(allDrivers.filter(d => /^terence/i.test(d)).map(d => d.toLowerCase()))
    const subTours = (tours ?? []).filter(t => driverParts(t.driver_name).some(p => selected.has(p.toLowerCase())))
    const tourDriver = new Map(subTours.map(t => [t.id as string, t.driver_name as string]))
    const tourIds = [...tourDriver.keys()]

    type Stop = {
      id: string; tour_id: string; order_name: string | null; shopify_order_id: string | null; customer_name: string | null; city: string | null; zip: string | null
      address1: string | null; status: string; delivered_at: string | null; panel_count: number | null; panel_details: unknown; lat: number | null; lng: number | null
    }
    const stops: Stop[] = []
    for (let i = 0; i < tourIds.length; i += 100) {
      const ids = tourIds.slice(i, i + 100)
      for (let from = 0; from < 20_000; from += 1000) {
        const { data } = await admin
          .from('delivery_stops')
          .select('id, tour_id, order_name, shopify_order_id, customer_name, address1, city, zip, status, delivered_at, panel_count, panel_details, lat, lng')
          .in('tour_id', ids).order('id').range(from, from + 999)
        if (!data || data.length === 0) break
        stops.push(...(data as Stop[]))
        if (data.length < 1000) break
      }
    }

    // Regroupement par commande : un seul forfait, daté de la 1ʳᵉ livraison.
    const byOrder = new Map<string, Stop[]>()
    for (const s of stops) {
      const key = s.order_name || s.id
      byOrder.set(key, [...(byOrder.get(key) ?? []), s])
    }

    const kmCache = (await readJson<Record<string, number>>(admin, kmCachePath(brand))) ?? {}
    const depotKey = `${settings.depot.lat.toFixed(4)},${settings.depot.lng.toFixed(4)}`
    const cacheKey = (lat: number, lng: number) => `${depotKey}>${lat.toFixed(4)},${lng.toFixed(4)}`

    // Commandes livrées du mois, avant regroupement par adresse
    type Billable = { order: string; first: Stop; panels: number; stones: number; failed: number; sids: string[] }
    const billable: Billable[] = []
    const lines: Line[] = []
    const geoOf = new Map<Line, { lat: number; lng: number }>()
    const unbilled: { order: string; customer: string; city: string; driver: string; date: string | null; reason: string }[] = []

    for (const [order, group] of byOrder) {
      const delivered = group
        .filter(s => (s.status === 'delivered' || s.status === 'partial') && s.delivered_at)
        .sort((a, b) => String(a.delivered_at).localeCompare(String(b.delivered_at)))
      const first = delivered[0]
      if (!first) {
        // Échecs (absence…) sans livraison : rien à payer. Affichés pour info si dans le mois.
        const failed = group.filter(s => s.status === 'failed' && inPeriod(s.delivered_at))
        if (failed.length > 0) {
          const f = failed[0]
          unbilled.push({ order, customer: f.customer_name ?? '', city: f.city ?? '', driver: tourDriver.get(f.tour_id) ?? '', date: f.delivered_at, reason: 'Échec / absence — pas encore livrée' })
        }
        continue
      }
      if (!inPeriod(first.delivered_at)) continue

      const panels = Math.max(...delivered.map(s => Number(s.panel_count) || 0))
      const stones = Math.max(...delivered.map(s => stonesFromDetails(s.panel_details)))
      const billedQty = panels + (settings.countStones ? stones : 0)
      const failed = group.filter(s => s.status === 'failed').length
      const driver = tourDriver.get(first.tour_id) ?? ''
      if (billedQty === 0) {
        unbilled.push({ order, customer: first.customer_name ?? '', city: first.city ?? '', driver, date: first.delivered_at, reason: 'Accessoires seuls — inclus dans le prix panneau' })
        continue
      }
      billable.push({ order, first, panels, stones, failed, sids: [...new Set(group.map(s => s.shopify_order_id).filter(Boolean) as string[])] })
    }

    // Plusieurs commandes livrées à la MÊME adresse le MÊME jour = un seul arrêt
    // → un seul forfait, sur le total de panneaux (« un forfait par adresse »).
    const norm = (v: string | null) => (v ?? '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, ' ').trim()
    const byAddress = new Map<string, Billable[]>()
    for (const b of billable) {
      const key = `${norm(b.first.address1)}|${norm(b.first.zip)}|${parisDay(String(b.first.delivered_at))}`
      byAddress.set(key, [...(byAddress.get(key) ?? []), b])
    }
    const sidsOf = new Map<Line, string[]>()
    for (const group of byAddress.values()) {
      group.sort((a, b) => a.order.localeCompare(b.order))
      const first = group[0].first
      const panels = group.reduce((acc, b) => acc + b.panels, 0)
      const stones = group.reduce((acc, b) => acc + b.stones, 0)
      const billedQty = panels + (settings.countStones ? stones : 0)
      const failed = group.reduce((acc, b) => acc + b.failed, 0)
      const notes = [
        group.length > 1 ? `${group.length} commandes même adresse même jour → 1 forfait` : '',
        failed > 0 ? `${failed} passage(s) en échec non refacturé(s)` : '',
      ].filter(Boolean)
      const line: Line = {
        order: group.map(b => b.order).join(' + '),
        customer: first.customer_name ?? '', city: first.city ?? '', zip: first.zip ?? '',
        driver: tourDriver.get(first.tour_id) ?? '', tourId: first.tour_id,
        date: String(first.delivered_at), km: null, kmEstimated: false, zone: null,
        panels, stones, billedQty, bucket: BUCKETS.findIndex(b => billedQty <= b.max), price: null,
        attempts: failed + 1, merged: group.length, revenueHT: null, cogs: null, margin: null,
        note: notes.length ? notes.join(' · ') : undefined,
      }
      lines.push(line)
      sidsOf.set(line, group.flatMap(b => b.sids))
      if (first.lat != null && first.lng != null) geoOf.set(line, { lat: Number(first.lat), lng: Number(first.lng) })
    }

    // CA + coût produits des commandes livrées (product_sales × coûts variantes)
    const allSids = [...new Set([...sidsOf.values()].flat())]
    const salesByOrder = new Map<string, { revenue: number; cogs: number; missingCost: boolean }>()
    if (allSids.length > 0) {
      type Sale = { order_id: string; variant_id: string | null; shopify_product_id: string | null; quantity: number | null; revenue: number | null }
      const sales: Sale[] = []
      for (let i = 0; i < allSids.length; i += 100) {
        for (let off = 0; off < 10_000; off += 1000) {
          const { data } = await admin.from('product_sales')
            .select('order_id, variant_id, shopify_product_id, quantity, revenue')
            .eq('brand', brand).in('order_id', allSids.slice(i, i + 100))
            .order('order_id').order('variant_id').range(off, off + 999)
          if (!data || data.length === 0) break
          sales.push(...(data as Sale[]))
          if (data.length < 1000) break
        }
      }
      const [{ data: variants }, { data: products }] = await Promise.all([
        admin.from('product_variants').select('shopify_variant_id, cost_price').eq('brand', brand).not('cost_price', 'is', null).limit(5000),
        admin.from('products').select('shopify_id, cost_price').eq('brand', brand).not('cost_price', 'is', null).limit(5000),
      ])
      const costByVariant = new Map((variants ?? []).map(v => [String(v.shopify_variant_id), Number(v.cost_price)]))
      const costByProduct = new Map((products ?? []).map(p => [String(p.shopify_id), Number(p.cost_price)]))
      for (const sale of sales) {
        const e = salesByOrder.get(sale.order_id) ?? { revenue: 0, cogs: 0, missingCost: false }
        const unit = costByVariant.get(String(sale.variant_id)) ?? costByProduct.get(String(sale.shopify_product_id))
        e.revenue += Number(sale.revenue) || 0
        if (unit == null) e.missingCost = true
        else e.cogs += unit * (Number(sale.quantity) || 0)
        salesByOrder.set(sale.order_id, e)
      }
    }
    for (const [line, sids] of sidsOf) {
      const found = sids.map(id => salesByOrder.get(id)).filter(Boolean) as { revenue: number; cogs: number }[]
      if (found.length === 0) continue
      line.revenueHT = Math.round(found.reduce((acc, e) => acc + e.revenue, 0) / 1.2)
      line.cogs = Math.round(found.reduce((acc, e) => acc + e.cogs, 0))
    }

    // Distances routières (cache → OSRM → repli vol d'oiseau × 1,3)
    const toFetch = [...new Map([...geoOf.values()].filter(g => kmCache[cacheKey(g.lat, g.lng)] == null).map(g => [cacheKey(g.lat, g.lng), g])).values()]
    if (toFetch.length > 0) {
      const kms = await roadKm(settings.depot, toFetch)
      let changed = false
      toFetch.forEach((g, i) => { if (kms[i] != null) { kmCache[cacheKey(g.lat, g.lng)] = kms[i]!; changed = true } })
      if (changed) await writeJson(admin, kmCachePath(brand), kmCache).catch(() => {})
    }
    const [lim1, lim2] = settings.zoneLimitsKm
    for (const l of lines) {
      const corse = /^(20|2A|2B)/i.test(l.zip.trim())
      const g = geoOf.get(l)
      if (g) {
        const cached = kmCache[cacheKey(g.lat, g.lng)]
        if (cached != null) l.km = cached
        else { l.km = Math.round(haversineKm(settings.depot, g) * 1.3); l.kmEstimated = true }
      }
      if (corse) { l.zone = null; l.note = 'Corse — sur devis' }
      else if (l.km != null) l.zone = l.km <= lim1 ? 0 : l.km <= lim2 ? 1 : 2
      else l.note = 'Adresse non géolocalisée — zone à vérifier'
      l.price = l.zone != null ? settings.grid[l.zone]?.[l.bucket] ?? null : null
      if (l.revenueHT != null) l.margin = l.revenueHT - (l.cogs ?? 0) - (l.price ?? 0)
    }
    lines.sort((a, b) => a.date.localeCompare(b.date) || a.order.localeCompare(b.order))

    const totalHT = lines.reduce((s, l) => s + (l.price ?? 0), 0)
    const totalPanels = lines.reduce((s, l) => s + l.billedQty, 0)
    // Matrice zone × tranche : nb de commandes et montant
    const matrix = settings.grid.map((_, z) => BUCKETS.map((_, b) => {
      const ls = lines.filter(l => l.zone === z && l.bucket === b)
      return { count: ls.length, amount: ls.reduce((s, l) => s + (l.price ?? 0), 0) }
    }))

    const withSales = lines.filter(l => l.revenueHT != null)
    const revenueHT = withSales.reduce((s, l) => s + (l.revenueHT ?? 0), 0)
    const salesCogs = withSales.reduce((s, l) => s + (l.cogs ?? 0), 0)
    const salesDelivery = withSales.reduce((s, l) => s + (l.price ?? 0), 0)

    // Jours consécutifs de la tournée (une re-livraison isolée quelques jours plus
    // tard, pointée sur la même tournée, n'allonge pas la tournée).
    const tourDays = (days: string[]) => {
      const sorted = [...new Set(days)].sort()
      const out = sorted.slice(0, 1)
      for (const d of sorted.slice(1)) {
        if ((new Date(d).getTime() - new Date(out[out.length - 1]).getTime()) / 86400_000 > 1) break
        out.push(d)
      }
      return out
    }
    // Résumé par tournée (onglet Moha) : jours de livraison, km, ce que Terence aurait facturé
    const tourRows = subTours
      .filter(t => t.planned_date >= from && t.planned_date <= to)
      .map(t => {
        const ts = stops.filter(s => s.tour_id === t.id && s.delivered_at && ['delivered', 'partial', 'failed'].includes(s.status))
        const tl = lines.filter(l => l.tourId === t.id)
        return {
          id: t.id as string, name: t.name as string, driver: t.driver_name as string, plannedDate: t.planned_date as string,
          totalKm: Number(t.total_km) || 0,
          costs: { fuel: t.cost_fuel, toll: t.cost_toll, hotel: t.cost_hotel, meal: t.cost_meal } as Record<string, number | null>,
          deliveryDays: tourDays(ts.map(s => parisDay(String(s.delivered_at)))),
          delivered: ts.filter(s => s.status !== 'failed').length,
          failed: ts.filter(s => s.status === 'failed').length,
          billed: tl.length,
          panels: tl.reduce((a, l) => a + l.billedQty, 0),
          terenceHT: tl.reduce((a, l) => a + (l.price ?? 0), 0),
          toQuote: tl.filter(l => l.price == null).length,
          revenueHT: tl.reduce((a, l) => a + (l.revenueHT ?? 0), 0),
        }
      })
      .sort((a, b) => b.plannedDate.localeCompare(a.plannedDate))

    return NextResponse.json({
      brand, month, from, to, settings: { ...settings, drivers: [...selected] }, allDrivers, tours: tourRows,
      buckets: BUCKETS.map(b => b.label),
      lines, unbilled,
      summary: {
        orders: lines.length,
        panels: totalPanels,
        totalHT,
        vat: Math.round(totalHT * settings.vatRate) / 100,
        totalTTC: Math.round(totalHT * (100 + settings.vatRate)) / 100,
        perPanel: totalPanels > 0 ? Math.round((totalHT / totalPanels) * 10) / 10 : null,
        perOrder: lines.length > 0 ? Math.round(totalHT / lines.length) : null,
        toQuote: lines.filter(l => l.price == null).length,
        estimatedKm: lines.filter(l => l.kmEstimated).length,
        revenueHT,
        cogs: salesCogs,
        marginAfterDelivery: revenueHT - salesCogs - salesDelivery,
        deliveryPctOfRevenue: revenueHT > 0 ? Math.round((salesDelivery / revenueHT) * 1000) / 10 : null,
        linesWithSales: withSales.length,
        lossLines: withSales.filter(l => (l.margin ?? 0) < 0).length,
        mergedOrders: lines.reduce((s, l) => s + l.merged - 1, 0),
        failedNotBilled: lines.reduce((s, l) => s + (l.attempts - 1), 0) + unbilled.filter(u => u.reason.startsWith('Échec')).length,
      },
      matrix,
    })
  } catch (err) {
    console.error('[delivery/subcontract]', err)
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 })
  }
}

// PUT { brand, grid?, drivers?, countStones?, internal? } → enregistre les réglages
export async function PUT(req: NextRequest) {
  try {
    const body = await req.json()
    const brand = String(body.brand ?? 'bowa')
    const admin = getAdmin()
    const cur = await loadSettings(admin, brand)
    const next: SubcontractSettings = { ...cur }
    if (Array.isArray(body.grid) && body.grid.length === 3 && body.grid.every((r: unknown) => Array.isArray(r) && r.length === 4)) {
      next.grid = (body.grid as unknown[][]).map(r => r.map(v => Math.max(0, Number(v) || 0)))
    }
    if (Array.isArray(body.drivers)) next.drivers = body.drivers.map((d: unknown) => String(d).trim()).filter(Boolean)
    if (typeof body.countStones === 'boolean') next.countStones = body.countStones
    if (body.internal && typeof body.internal === 'object') {
      const inc = body.internal as Record<string, unknown>
      const merged = { ...cur.internal } as Record<string, unknown>
      for (const [k, v] of Object.entries(inc)) {
        if (!(k in DEFAULT_SETTINGS.internal)) continue
        if (k === 'daysByTour' || k === 'nightsByTour') {
          merged[k] = Object.fromEntries(Object.entries((v ?? {}) as Record<string, unknown>).map(([id, n]) => [id, Math.max(0, Number(n) || 0)]))
        } else merged[k] = Math.max(0, Number(v) || 0)
      }
      next.internal = merged as InternalDriverSettings
    }
    await writeJson(admin, settingsPath(brand), next)
    return NextResponse.json({ ok: true, settings: next })
  } catch (err) {
    console.error('[delivery/subcontract PUT]', err)
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 })
  }
}
