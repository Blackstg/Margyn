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
  return { ...DEFAULT_SETTINGS, ...(saved ?? {}) }
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
  note?: string
}

// GET ?brand=bowa&month=2026-10 → lignes facturables du mois + réglages
export async function GET(req: NextRequest) {
  try {
    const brand = req.nextUrl.searchParams.get('brand') ?? 'bowa'
    const month = req.nextUrl.searchParams.get('month') ?? new Date().toISOString().slice(0, 7)
    const admin = getAdmin()
    const settings = await loadSettings(admin, brand)

    // Tournées depuis le début de la collaboration (marge d'une semaine pour les
    // tournées planifiées un peu avant).
    const since = new Date(new Date(settings.startDate).getTime() - 7 * 86400_000).toISOString().slice(0, 10)
    const { data: tours } = await admin
      .from('delivery_tours').select('id, driver_name, planned_date')
      .eq('brand', brand).gte('planned_date', since).limit(5000)

    const allDrivers = [...new Set((tours ?? []).flatMap(t => driverParts(t.driver_name)))].sort((a, b) => a.localeCompare(b, 'fr'))
    const selected = settings.drivers.length > 0
      ? new Set(settings.drivers.map(d => d.toLowerCase()))
      : new Set(allDrivers.filter(d => /^terence/i.test(d)).map(d => d.toLowerCase()))
    const subTours = (tours ?? []).filter(t => driverParts(t.driver_name).some(p => selected.has(p.toLowerCase())))
    const tourDriver = new Map(subTours.map(t => [t.id as string, t.driver_name as string]))
    const tourIds = [...tourDriver.keys()]

    type Stop = {
      id: string; tour_id: string; order_name: string | null; customer_name: string | null; city: string | null; zip: string | null
      status: string; delivered_at: string | null; panel_count: number | null; panel_details: unknown; lat: number | null; lng: number | null
    }
    const stops: Stop[] = []
    for (let i = 0; i < tourIds.length; i += 100) {
      const ids = tourIds.slice(i, i + 100)
      for (let from = 0; from < 20_000; from += 1000) {
        const { data } = await admin
          .from('delivery_stops')
          .select('id, tour_id, order_name, customer_name, city, zip, status, delivered_at, panel_count, panel_details, lat, lng')
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
        const failed = group.filter(s => s.status === 'failed' && String(s.delivered_at ?? '').startsWith(month))
        if (failed.length > 0) {
          const f = failed[0]
          unbilled.push({ order, customer: f.customer_name ?? '', city: f.city ?? '', driver: tourDriver.get(f.tour_id) ?? '', date: f.delivered_at, reason: 'Échec / absence — pas encore livrée' })
        }
        continue
      }
      if (!String(first.delivered_at).startsWith(month)) continue

      const panels = Math.max(...delivered.map(s => Number(s.panel_count) || 0))
      const stones = Math.max(...delivered.map(s => stonesFromDetails(s.panel_details)))
      const billedQty = panels + (settings.countStones ? stones : 0)
      const attempts = group.filter(s => s.status === 'failed' || s.status === 'delivered' || s.status === 'partial').length
      const driver = tourDriver.get(first.tour_id) ?? ''
      if (billedQty === 0) {
        unbilled.push({ order, customer: first.customer_name ?? '', city: first.city ?? '', driver, date: first.delivered_at, reason: 'Accessoires seuls — inclus dans le prix panneau' })
        continue
      }
      const bucket = BUCKETS.findIndex(b => billedQty <= b.max)
      const line: Line = {
        order, customer: first.customer_name ?? '', city: first.city ?? '', zip: first.zip ?? '', driver,
        date: String(first.delivered_at), km: null, kmEstimated: false, zone: null,
        panels, stones, billedQty, bucket, price: null, attempts,
        note: attempts > 1 ? `${attempts - 1} passage(s) en échec non refacturé(s)` : undefined,
      }
      lines.push(line)
      if (first.lat != null && first.lng != null) geoOf.set(line, { lat: Number(first.lat), lng: Number(first.lng) })
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
    }
    lines.sort((a, b) => a.date.localeCompare(b.date) || a.order.localeCompare(b.order))

    const totalHT = lines.reduce((s, l) => s + (l.price ?? 0), 0)
    const totalPanels = lines.reduce((s, l) => s + l.billedQty, 0)
    // Matrice zone × tranche : nb de commandes et montant
    const matrix = settings.grid.map((_, z) => BUCKETS.map((_, b) => {
      const ls = lines.filter(l => l.zone === z && l.bucket === b)
      return { count: ls.length, amount: ls.reduce((s, l) => s + (l.price ?? 0), 0) }
    }))

    return NextResponse.json({
      brand, month, settings: { ...settings, drivers: [...selected] }, allDrivers,
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
        failedNotBilled: lines.reduce((s, l) => s + (l.attempts - 1), 0) + unbilled.filter(u => u.reason.startsWith('Échec')).length,
      },
      matrix,
    })
  } catch (err) {
    console.error('[delivery/subcontract]', err)
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 })
  }
}

// PUT { brand, grid?, drivers?, countStones? } → enregistre les réglages
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
    await writeJson(admin, settingsPath(brand), next)
    return NextResponse.json({ ok: true, settings: next })
  } catch (err) {
    console.error('[delivery/subcontract PUT]', err)
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 })
  }
}
