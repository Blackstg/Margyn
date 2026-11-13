// Planification automatique des tournées Bowa, apprise sur les tournées passées. PUR.
//
// 1. Une commande qui tombe sur le trajet d'une tournée déjà prévue (pas encore
//    partie, place restante) lui est ajoutée — détour max DETOUR_KM, élargi pour
//    les commandes qui attendent depuis longtemps.
// 2. Les autres vont au livreur qui livre habituellement ce secteur (ses points de
//    livraison récents les plus proches), puis sont regroupées en tournées
//    (≤ capacité camion) de proche en proche.
// 3. Une nouvelle tournée n'est proposée que si elle est assez remplie par rapport
//    aux tournées habituelles du livreur, ou si une commande attend trop ; sinon
//    le groupe reste « en attente » avec la raison.
// Rien n'est créé ici : l'interface montre les propositions, l'utilisateur valide.

export type LatLng = { lat: number; lng: number }

export type PlanOrder = LatLng & {
  order_name: string
  city: string
  zip: string
  zone: string
  panel_count: number
  created_at: string | null
  needs_replan?: boolean
}

export type PlanTour = {
  id: string
  name: string
  driver_name: string
  planned_date: string | null
  status: string
  stops: (Partial<LatLng> & { panel_count: number; sequence: number; delivered_at?: string | null })[]
}

export type DriverProfile = {
  driver: string
  tours: number
  medianPanels: number
  medianDays: number
  points: LatLng[]
}

export type Addition = { tour_id: string; tour_name: string; driver: string; planned_date: string | null; orders: { order_name: string; detour_km: number }[]; panels_after: number }
export type NewTour = { driver: string; planned_date: string; name: string; zone: string; orders: string[]; panels: number; depts: string[]; reason: string }
export type Waiting = { driver: string | null; orders: string[]; panels: number; oldest_days: number; depts: string[]; reason: string }
export type AutoPlan = { additions: Addition[]; new_tours: NewTour[]; waiting: Waiting[]; drivers: DriverProfile[] }

export const CAPACITY = 100
const DETOUR_KM = 40          // vol d'oiseau (~55 km de route)
const DETOUR_KM_URGENT = 120
const LINK_KM = 150           // distance max entre 2 commandes voisines d'une même tournée
const SPAN_KM = 450           // et entre la commande prioritaire (graine) et les autres
const URGENT_DAYS = 10        // au-delà, on part même avec une tournée peu remplie
const MIN_FILL = 0.6          // part des panneaux habituels du livreur pour lancer une tournée
const ACTIVE_DAYS = 21        // livreurs ayant une tournée récente ou prévue

const DAY = 864e5
const MONTHS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre']

export function km(a: LatLng, b: LatLng): number {
  const r = Math.PI / 180
  const dLat = (b.lat - a.lat) * r
  const dLng = (b.lng - a.lng) * r
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(dLng / 2) ** 2
  return 12742 * Math.asin(Math.sqrt(h))
}

const median = (xs: number[]) => {
  if (!xs.length) return 0
  const s = [...xs].sort((a, b) => a - b)
  const m = Math.floor(s.length / 2)
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}
const hasPos = <T extends Partial<LatLng>>(p: T): p is T & LatLng => typeof p.lat === 'number' && typeof p.lng === 'number'
const dept = (zip: string) => (zip || '').replace(/\D/g, '').slice(0, 2)
const ageDays = (o: PlanOrder, today: Date) => (o.created_at ? Math.max(0, Math.floor((today.getTime() - Date.parse(o.created_at)) / DAY)) : 0)
const isoDay = (d: Date) => d.toISOString().slice(0, 10)
const panneaux = (n: number) => `${n} panneau${n > 1 ? 'x' : ''}`

export function tourName(date: string, driver: string): string {
  const [y, m, d] = date.split('-').map(Number)
  return `${String(d).padStart(2, '0')} ${MONTHS[m - 1]} ${y} - ${driver}`
}

// Profil de chaque livreur actif : secteur (points livrés), remplissage et durée habituels.
// Une tournée à deux (« A & B ») compte pour chacun.
export function driverProfiles(history: PlanTour[], today: Date): DriverProfile[] {
  const by = new Map<string, { tours: PlanTour[]; last: number }>()
  for (const t of history) {
    if (t.status === 'cancelled') continue
    const done = t.status === 'completed' || t.status === 'in_progress'
    for (const d of t.driver_name.split('&').map((s) => s.trim()).filter(Boolean)) {
      const e = by.get(d) ?? { tours: [], last: 0 }
      if (done) e.tours.push(t)
      e.last = Math.max(e.last, t.planned_date ? Date.parse(t.planned_date) : 0)
      by.set(d, e)
    }
  }
  const out: DriverProfile[] = []
  for (const [driver, { tours, last }] of by) {
    if (!tours.length || today.getTime() - last > ACTIVE_DAYS * DAY) continue
    const solo = tours.filter((t) => !t.driver_name.includes('&'))
    const ref = solo.length ? solo : tours
    const days = ref.map((t) => {
      const ds = t.stops.map((s) => s.delivered_at?.slice(0, 10)).filter((x): x is string => !!x).sort()
      return ds.length ? Math.min(7, Math.round((Date.parse(ds[ds.length - 1]) - Date.parse(ds[0])) / DAY) + 1) : 0
    }).filter((n) => n > 0)
    out.push({
      driver,
      tours: tours.length,
      medianPanels: median(ref.map((t) => t.stops.reduce((n, s) => n + (s.panel_count || 0), 0))),
      medianDays: Math.max(1, Math.round(median(days)) || 2),
      points: tours.flatMap((t) => t.stops.filter(hasPos).map((s) => ({ lat: s.lat, lng: s.lng }))),
    })
  }
  return out.sort((a, b) => b.tours - a.tours)
}

// Livreur du secteur : celui dont les livraisons passées sont les plus proches
// (moyenne, sur les commandes du groupe, des 5 livraisons les plus proches).
function sectorDriver(group: LatLng[], profiles: DriverProfile[]): string | null {
  let best: { driver: string; km: number } | null = null
  for (const p of profiles) {
    if (!p.points.length) continue
    const score = group.reduce((sum, o) => {
      const near = p.points.map((q) => km(o, q)).sort((x, y) => x - y).slice(0, 5)
      return sum + near.reduce((x, y) => x + y, 0) / near.length
    }, 0) / group.length
    if (!best || score < best.km) best = { driver: p.driver, km: score }
  }
  return best?.driver ?? null
}

// Détour (vol d'oiseau) pour insérer o dans le trajet pts, et la position d'insertion.
function insertion(pts: LatLng[], o: LatLng): { extra: number; at: number } {
  if (!pts.length) return { extra: Infinity, at: 0 }
  let best = { extra: km(o, pts[0]), at: 0 }
  const end = km(pts[pts.length - 1], o)
  if (end < best.extra) best = { extra: end, at: pts.length }
  for (let i = 0; i < pts.length - 1; i++) {
    const extra = km(pts[i], o) + km(o, pts[i + 1]) - km(pts[i], pts[i + 1])
    if (extra < best.extra) best = { extra, at: i + 1 }
  }
  return best
}

// Prochain jour ouvré libre du livreur, après ses tournées déjà prévues.
function nextFreeDay(driver: string, upcoming: PlanTour[], profile: DriverProfile | undefined, today: Date): string {
  let t = today.getTime() + DAY
  for (const tour of upcoming) {
    if (!tour.planned_date || !tour.driver_name.split('&').map((s) => s.trim()).includes(driver)) continue
    t = Math.max(t, Date.parse(tour.planned_date) + (profile?.medianDays ?? 2) * DAY)
  }
  const d = new Date(t)
  while (d.getUTCDay() === 0 || d.getUTCDay() === 6) d.setUTCDate(d.getUTCDate() + 1)
  return isoDay(d)
}

export function autoPlan(input: { orders: PlanOrder[]; tours: PlanTour[]; today?: Date }): AutoPlan {
  const today = input.today ?? new Date()
  const todayIso = isoDay(today)
  const profiles = driverProfiles(input.tours, today)
  const profileOf = new Map(profiles.map((p) => [p.driver, p]))

  // Les commandes à replanifier et les plus anciennes d'abord (0 panneau = tasseaux,
  // feuilles de pierre : camion mais hors capacité).
  const orders = input.orders
    .filter(hasPos)
    .sort((a, b) => Number(!!b.needs_replan) - Number(!!a.needs_replan) || ageDays(b, today) - ageDays(a, today))

  // 1) Insertion dans les tournées prévues, pas encore parties.
  const upcoming = input.tours.filter((t) => (t.status === 'draft' || t.status === 'planned') && (!t.planned_date || t.planned_date >= todayIso))
  const open = upcoming.map((t) => {
    const sorted = [...t.stops].sort((a, b) => a.sequence - b.sequence)
    return { tour: t, pts: sorted.filter(hasPos).map((s) => ({ lat: s.lat, lng: s.lng })), panels: t.stops.reduce((n, s) => n + (s.panel_count || 0), 0), added: [] as { order_name: string; detour_km: number }[] }
  })
  const rest: PlanOrder[] = []
  for (const o of orders) {
    const limit = ageDays(o, today) >= URGENT_DAYS || o.needs_replan ? DETOUR_KM_URGENT : DETOUR_KM
    let best: { slot: (typeof open)[number]; extra: number; at: number } | null = null
    for (const slot of open) {
      if (slot.panels + o.panel_count > CAPACITY) continue
      const ins = insertion(slot.pts, o)
      if (ins.extra <= limit && (!best || ins.extra < best.extra)) best = { slot, ...ins }
    }
    if (!best) { rest.push(o); continue }
    best.slot.pts.splice(best.at, 0, { lat: o.lat, lng: o.lng })
    best.slot.panels += o.panel_count
    best.slot.added.push({ order_name: o.order_name, detour_km: Math.round(best.extra) })
  }
  const additions: Addition[] = open.filter((s) => s.added.length).map((s) => ({
    tour_id: s.tour.id, tour_name: s.tour.name, driver: s.tour.driver_name, planned_date: s.tour.planned_date,
    orders: s.added, panels_after: s.panels,
  }))

  // 2) Regroupement de proche en proche (≤ capacité), puis livreur du secteur.
  const new_tours: NewTour[] = []
  const waiting: Waiting[] = []
  const busy: PlanTour[] = [...input.tours.filter((t) => t.status !== 'completed' && t.status !== 'cancelled')]
  const left = [...rest] // déjà triée : prioritaires d'abord
  while (left.length) {
    const group = [left.shift()!]
    let panels = group[0].panel_count
    for (;;) {
      let pick = -1, pickKm = Infinity
      left.forEach((o, i) => {
        if (panels + o.panel_count > CAPACITY) return
        const d = Math.min(...group.map((g) => km(g, o)))
        if (d <= LINK_KM && km(group[0], o) <= SPAN_KM && d < pickKm) { pick = i; pickKm = d }
      })
      if (pick < 0) break
      const [o] = left.splice(pick, 1)
      group.push(o)
      panels += o.panel_count
    }

    const driver = sectorDriver(group, profiles)
    const oldest = Math.max(...group.map((o) => ageDays(o, today)))
    const replan = group.some((o) => o.needs_replan)
    const usual = driver ? profileOf.get(driver)?.medianPanels ?? CAPACITY : CAPACITY
    const target = Math.round(Math.min(CAPACITY, usual) * MIN_FILL)
    const depts = [...new Set(group.map((o) => dept(o.zip)))].sort()
    const names = group.map((o) => o.order_name)

    // Une commande qui attend trop part quand même, mais pas seule au bout de la France.
    if (driver && (panels >= target || (oldest >= URGENT_DAYS && panels >= target / 2))) {
      const date = nextFreeDay(driver, busy, profileOf.get(driver), today)
      const zones = new Set(group.map((o) => o.zone))
      const reason = panels >= target
        ? `${panneaux(panels)}, ${driver} part d'habitude avec ~${Math.round(usual)}`
        : `${panneaux(panels)}, mais la plus ancienne commande attend depuis ${oldest} jours`
      new_tours.push({ driver, planned_date: date, name: tourName(date, driver), zone: zones.size === 1 ? [...zones][0] : 'mixte', orders: names, panels, depts, reason })
      busy.push({ id: '', name: '', driver_name: driver, planned_date: date, status: 'draft', stops: [] })
    } else {
      const reason = !driver
        ? 'aucun livreur actif ne livre ce secteur'
        : `${panneaux(panels)} sur ~${target} pour lancer une tournée de ${driver}${replan ? ' (dont une à replanifier)' : ''}${oldest >= URGENT_DAYS ? ` — attend depuis ${oldest} jours : à ajouter à la main à une tournée qui passe` : ''}`
      waiting.push({ driver, orders: names, panels, oldest_days: oldest, depts, reason })
    }
  }
  waiting.sort((x, y) => y.oldest_days - x.oldest_days)

  return { additions, new_tours, waiting, drivers: profiles.map((p) => ({ ...p, points: [] })) }
}
