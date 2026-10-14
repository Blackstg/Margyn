import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

function getAdmin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  )
}

// Feuille de pierre (stonepanel) : livrée par camion mais comptée à part.
const isStonepanel = (title: string) => /stonepanel|feuille\s*de\s*pierre/i.test(title)
// Panneaux « slots » (ExtPanel = 1, Akupanel 60 = ½ place). On fait confiance à
// panel_count (recalculé à l'enregistrement) pour les panneaux, et on isole les
// feuilles de pierre depuis panel_details.
function stonesFromDetails(details: unknown): number {
  if (!Array.isArray(details)) return 0
  return (details as { title?: string; qty?: number }[])
    .filter(d => isStonepanel(d.title ?? ''))
    .reduce((s, d) => s + (d.qty ?? 0), 0)
}

// Classe un poste de la feuille transport en FIXE (indépendant du volume) ou
// VARIABLE (lié aux tournées / au volume livré). Sert au pilotage : un coût très
// « fixe » plaide pour maximiser le remplissage ; très « variable » se compare
// mieux à un tarif 3PL au panneau.
function isFixedPost(label: string): boolean {
  const l = label.toLowerCase()
  return /salaire|leasing|assurance|d[ée]p[ôo]t|loyer|cr[ée]dit/.test(l)
}

type MonthRow = {
  month: string
  cost: number
  breakdown: { label: string; amount: number; kind: 'fixe' | 'variable' }[]
  fixed: number
  variable: number
  orders: number
  panels: number
  stones: number
  costPerOrder: number | null
  costPerPanel: number | null
  tours: number
  km: number
  costPerKm: number | null
  costPerTour: number | null
  panelsPerTour: number | null
  fillRate: number | null   // % de la capacité camion (100 panneaux) utilisée en moyenne
  shopifyOrders: number      // total commandes Shopify (échantillons inclus)
  sampleOrders: number       // commandes 100% échantillons (La Poste)
  billableOrders: number     // commandes réelles hors échantillons
  costPerShopifyOrder: number | null   // coût réparti sur les commandes HORS échantillons
}

// GET ?brand=bowa → analyse coût de livraison mois par mois + agrégats.
export async function GET(req: NextRequest) {
  try {
    const brand = req.nextUrl.searchParams.get('brand') ?? 'bowa'
    const admin = getAdmin()

    // 1) Coût transport mensuel (feuille synchronisée → fixed_costs fulfillment)
    const { data: costRows } = await admin
      .from('fixed_costs')
      .select('month, label, amount')
      .eq('brand', brand).eq('category', 'fulfillment')
      .neq('month', '1900-01-01')
      .limit(5000)

    const costByMonth = new Map<string, { label: string; amount: number; kind: 'fixe' | 'variable' }[]>()
    for (const r of costRows ?? []) {
      const ym = String(r.month).slice(0, 7)
      const arr = costByMonth.get(ym) ?? []
      arr.push({ label: r.label, amount: Number(r.amount) || 0, kind: isFixedPost(r.label) ? 'fixe' : 'variable' })
      costByMonth.set(ym, arr)
    }

    // 2) Volume livré par mois (stops livrés des tournées de la marque)
    const { data: tours } = await admin
      .from('delivery_tours').select('id, planned_date, total_km, status').eq('brand', brand).limit(5000)
    const tourIds = new Set((tours ?? []).map(t => t.id as string))

    // Tournées & km par mois (rattachés au mois de planned_date). Sert au coût/km,
    // coût/tournée et au taux de remplissage camion.
    const tourByMonth = new Map<string, { tours: number; km: number }>()
    for (const t of tours ?? []) {
      if (!t.planned_date || (t.status !== 'completed' && t.status !== 'in_progress')) continue
      const ym = String(t.planned_date).slice(0, 7)
      const e = tourByMonth.get(ym) ?? { tours: 0, km: 0 }
      e.tours += 1
      e.km += Number(t.total_km) || 0
      tourByMonth.set(ym, e)
    }
    const TRUCK_CAPACITY = 100  // panneaux max par tournée (hors feuilles de pierre)

    // Commandes Shopify par mois, en distinguant les commandes d'ÉCHANTILLONS
    // (livrées par La Poste, pas par le camion) des vraies commandes. La vue
    // « coût réparti par commande » doit se faire HORS échantillons, sinon le coût
    // transport est dilué par des commandes qui ne montent jamais dans le camion.
    const isSample = (t: string) => /échantillon|echantillon|sample/i.test(t ?? '')
    const orderTitlesByMonth = new Map<string, Map<string, boolean>>()  // ym → orderId → aAuMoinsUnNonEchantillon
    for (let off = 0; off < 100_000; off += 1000) {
      const { data: lines } = await admin
        .from('product_sales').select('order_id, product_title, date')
        .eq('brand', brand)
        .order('date', { ascending: false })
        .range(off, off + 999)
      if (!lines || lines.length === 0) break
      for (const l of lines) {
        if (l.order_id == null) continue
        const ym = String(l.date).slice(0, 7)
        const m = orderTitlesByMonth.get(ym) ?? new Map<string, boolean>()
        const oid = String(l.order_id)
        const prev = m.get(oid) ?? false
        m.set(oid, prev || !isSample(l.product_title))  // true dès qu'une ligne n'est pas un échantillon
        orderTitlesByMonth.set(ym, m)
      }
      if (lines.length < 1000) break
    }
    // Par mois : total commandes, commandes 100% échantillons, commandes « réelles »
    const ordersByMonth = new Map<string, { total: number; sample: number; billable: number }>()
    for (const [ym, m] of orderTitlesByMonth.entries()) {
      let total = 0, billable = 0
      for (const hasReal of m.values()) { total++; if (hasReal) billable++ }
      ordersByMonth.set(ym, { total, sample: total - billable, billable })
    }

    // Dépôt Bourges — origine pour estimer la distance (donc le variable) par zone.
    const BOURGES = { lat: 47.0810, lng: 2.3988 }
    // Bordeaux — dépôt du sous-traitant envisagé (pour le testeur de grille 3PL).
    const BORDEAUX = { lat: 44.8378, lng: -0.5792 }
    const ROAD_FACTOR = 1.3  // route ≈ 1.3 × distance à vol d'oiseau
    const gridStopsRaw: { ym: string; km: number; panels: number }[] = []
    const haversineKm = (a: { lat: number; lng: number }, b: { lat: number; lng: number }) => {
      const R = 6371, dLat = (b.lat - a.lat) * Math.PI / 180, dLng = (b.lng - a.lng) * Math.PI / 180
      const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * Math.PI / 180) * Math.cos(b.lat * Math.PI / 180) * Math.sin(dLng / 2) ** 2
      return R * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h))
    }

    const volByMonth = new Map<string, { orders: number; panels: number; stones: number }>()
    // Par mois → par zone : panneaux, arrêts, somme des distances (pour la distance moyenne)
    const zoneByMonth = new Map<string, Map<string, { panels: number; stops: number; sumDist: number }>>()
    const PAGE = 1000
    for (let from = 0; from < 50_000; from += PAGE) {
      const { data: stops } = await admin
        .from('delivery_stops')
        .select('tour_id, status, delivered_at, panel_count, panel_details, zone, lat, lng')
        .in('status', ['delivered', 'partial'])
        .not('delivered_at', 'is', null)
        .order('delivered_at', { ascending: false })
        .range(from, from + PAGE - 1)
      if (!stops || stops.length === 0) break
      for (const s of stops) {
        if (!tourIds.has(s.tour_id as string)) continue
        const ym = String(s.delivered_at).slice(0, 7)
        if (!ym) continue
        const panels = Number(s.panel_count) || 0
        const v = volByMonth.get(ym) ?? { orders: 0, panels: 0, stones: 0 }
        v.orders += 1
        v.panels += panels
        v.stones += stonesFromDetails(s.panel_details)
        volByMonth.set(ym, v)

        // Agrégat zone (seulement les arrêts avec panneaux + géoloc)
        if (panels > 0 && s.lat && s.lng) {
          const zone = (s.zone as string) || 'inconnue'
          const zm = zoneByMonth.get(ym) ?? new Map()
          const z = zm.get(zone) ?? { panels: 0, stops: 0, sumDist: 0 }
          z.panels += panels
          z.stops += 1
          z.sumDist += haversineKm(BOURGES, { lat: Number(s.lat), lng: Number(s.lng) })
          zm.set(zone, z)
          zoneByMonth.set(ym, zm)
          // Données pour le testeur de grille 3PL (distance routière depuis Bordeaux)
          gridStopsRaw.push({ ym, km: Math.round(haversineKm(BORDEAUX, { lat: Number(s.lat), lng: Number(s.lng) }) * ROAD_FACTOR), panels })
        }
      }
      if (stops.length < PAGE) break
    }

    // 3) Fusion coût × volume, mois par mois
    const allMonths = [...new Set([...costByMonth.keys(), ...volByMonth.keys()])].sort()
    const months: MonthRow[] = allMonths.map(ym => {
      const breakdown = (costByMonth.get(ym) ?? []).slice().sort((a, b) => b.amount - a.amount)
      const cost = breakdown.reduce((s, b) => s + b.amount, 0)
      const fixed = breakdown.filter(b => b.kind === 'fixe').reduce((s, b) => s + b.amount, 0)
      const variable = breakdown.filter(b => b.kind === 'variable').reduce((s, b) => s + b.amount, 0)
      const vol = volByMonth.get(ym) ?? { orders: 0, panels: 0, stones: 0 }
      const tv = tourByMonth.get(ym) ?? { tours: 0, km: 0 }
      return {
        month: ym,
        cost: Math.round(cost),
        breakdown,
        fixed: Math.round(fixed),
        variable: Math.round(variable),
        orders: vol.orders,
        panels: vol.panels,
        stones: vol.stones,
        costPerOrder: cost > 0 && vol.orders > 0 ? Math.round(cost / vol.orders) : null,
        costPerPanel: cost > 0 && vol.panels > 0 ? Math.round(cost / vol.panels) : null,
        tours: tv.tours,
        km: Math.round(tv.km),
        costPerKm: cost > 0 && tv.km > 0 ? Math.round((cost / tv.km) * 100) / 100 : null,
        costPerTour: cost > 0 && tv.tours > 0 ? Math.round(cost / tv.tours) : null,
        panelsPerTour: tv.tours > 0 && vol.panels > 0 ? Math.round((vol.panels / tv.tours) * 10) / 10 : null,
        fillRate: tv.tours > 0 && vol.panels > 0 ? Math.round((vol.panels / tv.tours / TRUCK_CAPACITY) * 100) : null,
        shopifyOrders: ordersByMonth.get(ym)?.total ?? 0,
        sampleOrders: ordersByMonth.get(ym)?.sample ?? 0,
        billableOrders: ordersByMonth.get(ym)?.billable ?? 0,
        costPerShopifyOrder: cost > 0 && (ordersByMonth.get(ym)?.billable ?? 0) > 0 ? Math.round(cost / (ordersByMonth.get(ym)!.billable)) : null,
      }
    })

    // 4) Agrégats sur les mois où on a À LA FOIS coût ET volume (comparables)
    const complete = months.filter(m => m.cost > 0 && m.orders > 0)
    const sum = (f: (m: MonthRow) => number) => complete.reduce((s, m) => s + f(m), 0)
    const totalCost = sum(m => m.cost)
    const totalOrders = sum(m => m.orders)
    const totalPanels = sum(m => m.panels)
    const totalStones = sum(m => m.stones)
    const totalFixed = sum(m => m.fixed)
    const totalVariable = sum(m => m.variable)
    const totalKm = sum(m => m.km)
    const totalTours = sum(m => m.tours)
    const totalShopifyOrders = sum(m => m.shopifyOrders)
    const totalSampleOrders = sum(m => m.sampleOrders)
    const totalBillableOrders = sum(m => m.billableOrders)

    // Structure de coût agrégée (part de chaque poste sur la période comparable)
    const postMap = new Map<string, { amount: number; kind: 'fixe' | 'variable' }>()
    for (const m of complete) for (const b of m.breakdown) {
      const p = postMap.get(b.label) ?? { amount: 0, kind: b.kind }
      p.amount += b.amount; postMap.set(b.label, p)
    }
    const costStructure = [...postMap.entries()]
      .map(([label, v]) => ({ label, amount: Math.round(v.amount), kind: v.kind, pct: totalCost > 0 ? Math.round((v.amount / totalCost) * 1000) / 10 : 0 }))
      .sort((a, b) => b.amount - a.amount)

    // ── Coût alloué par ZONE géographique ──────────────────────────────────────
    // La feuille ne ventile pas par zone : on ESTIME. Le fixe (salaire, leasing,
    // dépôt) est réparti à plat par panneau (il ne dépend pas de la zone) ; le
    // variable (carburant, péages) est réparti au prorata de la distance depuis
    // Bourges × panneaux → une zone 2× plus loin « porte » ~2× le variable/panneau.
    const completeSet = new Set(complete.map(m => m.month))
    const zoneAgg = new Map<string, { panels: number; stops: number; sumDist: number }>()
    for (const [ym, zm] of zoneByMonth) {
      if (!completeSet.has(ym)) continue
      for (const [zone, v] of zm) {
        const a = zoneAgg.get(zone) ?? { panels: 0, stops: 0, sumDist: 0 }
        a.panels += v.panels; a.stops += v.stops; a.sumDist += v.sumDist
        zoneAgg.set(zone, a)
      }
    }
    const fixedPerPanelFlat = totalPanels > 0 ? totalFixed / totalPanels : 0
    const zoneRows0 = [...zoneAgg.entries()].map(([zone, v]) => {
      const avgDist = v.stops > 0 ? v.sumDist / v.stops : 0
      return { zone, panels: v.panels, stops: v.stops, avgDist, w: v.panels * avgDist }
    })
    const sumW = zoneRows0.reduce((s, z) => s + z.w, 0)
    const zones = zoneRows0.map(z => {
      const variableAlloc = sumW > 0 ? totalVariable * (z.w / sumW) : 0
      const variablePerPanel = z.panels > 0 ? variableAlloc / z.panels : 0
      return {
        zone: z.zone,
        panels: z.panels,
        stops: z.stops,
        avgDistKm: Math.round(z.avgDist),
        fixedPerPanel: Math.round(fixedPerPanelFlat),
        variablePerPanel: Math.round(variablePerPanel),
        costPerPanel: Math.round(fixedPerPanelFlat + variablePerPanel),
        allocatedCost: Math.round(fixedPerPanelFlat * z.panels + variableAlloc),
      }
    }).sort((a, b) => b.costPerPanel - a.costPerPanel)

    const summary = {
      monthsCount: complete.length,
      totalCost, totalOrders, totalPanels, totalStones,
      avgCostPerOrder: totalOrders > 0 ? Math.round(totalCost / totalOrders) : null,
      avgCostPerPanel: totalPanels > 0 ? Math.round(totalCost / totalPanels) : null,
      avgCostPerMonth: complete.length > 0 ? Math.round(totalCost / complete.length) : null,
      avgPanelsPerOrder: totalOrders > 0 ? Math.round((totalPanels / totalOrders) * 10) / 10 : null,
      fixedPct: totalCost > 0 ? Math.round((totalFixed / totalCost) * 100) : null,
      variablePct: totalCost > 0 ? Math.round((totalVariable / totalCost) * 100) : null,
      // Coût variable par panneau : base de comparaison la plus juste avec un 3PL
      // (le fixe — leasing, dépôts, salaire — disparaît en partie si on sous-traite).
      variableCostPerPanel: totalPanels > 0 ? Math.round(totalVariable / totalPanels) : null,
      totalKm, totalTours,
      avgCostPerKm: totalKm > 0 ? Math.round((totalCost / totalKm) * 100) / 100 : null,
      avgCostPerTour: totalTours > 0 ? Math.round(totalCost / totalTours) : null,
      avgPanelsPerTour: totalTours > 0 ? Math.round((totalPanels / totalTours) * 10) / 10 : null,
      avgFillRate: totalTours > 0 ? Math.round((totalPanels / totalTours / 100) * 100) : null,
      totalShopifyOrders,
      totalSampleOrders,
      totalBillableOrders,
      avgCostPerShopifyOrder: totalBillableOrders > 0 ? Math.round(totalCost / totalBillableOrders) : null,
    }

    // Livraisons pour le testeur de grille (mois comparables uniquement) — on garde
    // le mois pour pouvoir simuler sur UN mois réel précis (ex. septembre).
    const gridStops = gridStopsRaw
      .filter(g => completeSet.has(g.ym))
      .map(g => ({ km: g.km, panels: g.panels, month: g.ym }))

    return NextResponse.json({ brand, months, summary, costStructure, zones, gridStops })
  } catch (err) {
    console.error('[delivery/cost-analysis]', err)
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 })
  }
}
