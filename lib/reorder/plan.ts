// Réappro : ventes par jour glissantes, position de stock, date de rupture, date
// limite pour commander, quantité conseillée, réceptions détectées et indicateurs.
// Pur (sans I/O) : utilisé par la page Réappro et le récap du lundi, testé dans
// plan.test.ts. Les jours sont des chaînes 'YYYY-MM-DD' (heure de Paris).

export type Promo = { from: string; to: string; label: string }
export type ProductRule = { moq?: number | null; pack?: number | null }

export type ReorderSettings = {
  fabDays: number          // délai de fabrication
  transitDays: number      // délai de transport
  safetyDays: number       // sécurité
  orderCoverDays: number   // une commande couvre ce nombre de jours au-delà du seuil
  windowDays: number       // fenêtre glissante des ventes par jour
  minUsefulDays: number    // sous ce nombre de jours utiles, on remonte en arrière…
  maxLookbackDays: number  // … jusqu'à cette limite
  spikeFactor: number      // un jour est plafonné à spikeFactor × la moyenne…
  spikeFloor: number       // … mais jamais sous ce nombre d'unités
  snoozeDays: number       // « Pas maintenant »
  soonDays: number         // date limite dans moins de N jours : « Bientôt »
  refPeriod: { from: string; to: string } | null   // période de référence manuelle (saisonnalité)
  promos: Promo[]          // jours exclus du calcul, comme les jours de rupture
  closures: Promo[]        // fermetures d'usine : la fabrication s'arrête, le délai s'allonge d'autant
  products: Record<string, ProductRule>            // clé : shopify_product_id
  recipients: string[]     // récap du lundi
  colorAliases: Record<string, string>    // couleur sur les factures → couleur Shopify (« marron » → « brown aubergine »)
  invoiceAliases: Record<string, string>  // ligne de facture déjà rapprochée (`produit|couleur` normalisés) → variante
  dismissedJumps: string[] // `${variantId}|${day}` : hausses de stock déjà traitées
}

export const DEFAULT_SETTINGS: ReorderSettings = {
  fabDays: 30, transitDays: 40, safetyDays: 30, orderCoverDays: 30,
  windowDays: 60, minUsefulDays: 30, maxLookbackDays: 365,
  spikeFactor: 3, spikeFloor: 3, snoozeDays: 14, soonDays: 21,
  refPeriod: null,
  promos: [{ from: '2026-11-06', to: '2026-11-30', label: 'Black Friday 2026' }],
  // Nouvel An chinois le 6 février 2027 : usines fermées environ une semaine avant et deux après (à confirmer).
  closures: [{ from: '2027-01-30', to: '2027-02-21', label: 'Nouvel An chinois 2027' }],
  products: {}, recipients: [], dismissedJumps: [],
  colorAliases: { marron: 'brown aubergine', jean: 'denim brut', cream: 'creme' },
  invoiceAliases: {},
}

export function mergeSettings(partial: Partial<ReorderSettings> | null | undefined): ReorderSettings {
  return { ...DEFAULT_SETTINGS, ...(partial ?? {}) }
}

export const leadDays    = (s: ReorderSettings) => s.fabDays + s.transitDays
export const triggerDays = (s: ReorderSettings) => leadDays(s) + s.safetyDays     // 100 j par défaut
export const targetDays  = (s: ReorderSettings) => triggerDays(s) + s.orderCoverDays // 130 j par défaut

// ─── Jours ────────────────────────────────────────────────────────────────────

export function addDays(day: string, n: number): string {
  const d = new Date(day + 'T00:00:00Z')
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}
export const daysBetween = (a: string, b: string) =>
  Math.round((new Date(b + 'T00:00:00Z').getTime() - new Date(a + 'T00:00:00Z').getTime()) / 86_400_000)

const inPromo = (day: string, promos: Promo[]) => promos.some((p) => day >= p.from && day <= p.to)

// ─── Fermetures d'usine ───────────────────────────────────────────────────────

// Fin de fabrication : fabDays jours ouvrés de l'usine (les jours de fermeture ne comptent pas).
export function fabEnd(orderedOn: string, s: ReorderSettings): string {
  let d = orderedOn
  for (let n = 0, guard = 0; n < s.fabDays && guard < 3650; guard++) {
    d = addDays(d, 1)
    if (!inPromo(d, s.closures)) n++
  }
  return d
}
export const arrivalFor = (orderedOn: string, s: ReorderSettings) => addDays(fabEnd(orderedOn, s), s.transitDays)
export const effLead = (orderedOn: string, s: ReorderSettings) => daysBetween(orderedOn, arrivalFor(orderedOn, s))

// Dernier jour pour commander et recevoir au plus tard le jour `by`.
export function latestOrderFor(by: string, s: ReorderSettings): string {
  let o = addDays(by, -leadDays(s))
  for (let i = 0; i < 400 && arrivalFor(o, s) > by; i++) o = addDays(o, -1)
  return o
}

// ─── Ventes par jour ──────────────────────────────────────────────────────────

export type SalesHistory = {
  sales: Record<string, number>   // jour → unités vendues
  stock: Record<string, number>   // jour → stock relevé (tous entrepôts)
  stockNow: number
  firstSale: string | null
  lastSale: string | null
}

// Jour de rupture : relevé à 0 ; sans relevé, estimation tant que l'historique
// manque : à 0 aujourd'hui → en rupture depuis la dernière vente.
export function isRuptureDay(day: string, h: SalesHistory): boolean {
  const s = h.stock[day]
  if (s != null) return s <= 0
  return h.stockNow <= 0 && (!h.lastSale || day > h.lastSale)
}

export type Velocity = {
  daily: number
  usefulDays: number
  from: string; to: string
  rupture: number; promo: number; capped: number
  mode: 'glissant' | 'référence'
  // variante récente : ventes en promo ramenées au rythme normal (rapport constaté sur les autres couleurs)
  estimated?: { ratio: number; promoDays: number; promoSales: number } | null
}

export function velocity(h: SalesHistory, s: ReorderSettings, today: string): Velocity {
  const useful: number[] = []
  let rupture = 0, promo = 0, from = today
  const take = (day: string) => {
    if (!h.firstSale || day < h.firstSale) return
    if (inPromo(day, s.promos)) { promo++; return }
    if (isRuptureDay(day, h)) { rupture++; return }
    useful.push(h.sales[day] ?? 0)
    from = day
  }

  const to = s.refPeriod ? s.refPeriod.to : addDays(today, -1)   // aujourd'hui n'est pas fini
  if (s.refPeriod) {
    for (let d = s.refPeriod.from; d <= s.refPeriod.to; d = addDays(d, 1)) take(d)
  } else {
    let d = to, scanned = 0
    for (; scanned < s.windowDays; scanned++, d = addDays(d, -1)) take(d)
    // Trop de jours exclus : on remonte jusqu'à retrouver windowDays jours utiles.
    if (useful.length < s.minUsefulDays) {
      for (; useful.length < s.windowDays && scanned < s.maxLookbackDays && h.firstSale && d >= h.firstSale; scanned++, d = addDays(d, -1)) take(d)
    }
  }

  if (!useful.length) return { daily: 0, usefulDays: 0, from, to, rupture, promo, capped: 0, mode: s.refPeriod ? 'référence' : 'glissant' }
  const mean = useful.reduce((a, b) => a + b, 0) / useful.length
  const cap = Math.max(s.spikeFactor * mean, s.spikeFloor)
  let capped = 0
  const total = useful.reduce((a, q) => { if (q > cap) { capped++; return a + cap } return a + q }, 0)
  return { daily: total / useful.length, usefulDays: useful.length, from, to, rupture, promo, capped, mode: s.refPeriod ? 'référence' : 'glissant' }
}

// Variante récente dont presque toutes les ventes tombent en promo : on garde ses
// ventes en promo, divisées par le rapport « ventes promo / ventes normales » des
// autres couleurs du même produit sur les mêmes jours.
export function recentEstimate(h: SalesHistory, vel: Velocity, siblings: { h: SalesHistory; daily: number }[], s: ReorderSettings, today: string): Velocity | null {
  if (vel.usefulDays >= s.minUsefulDays || !h.firstSale || h.firstSale < addDays(today, -2 * s.windowDays)) return null
  const days: string[] = []
  for (let d = h.firstSale; d < today; d = addDays(d, 1)) if (inPromo(d, s.promos) && !isRuptureDay(d, h)) days.push(d)
  if (!days.length) return null
  const promoSales = days.reduce((a, d) => a + (h.sales[d] ?? 0), 0)
  let sibPromo = 0, sibNormal = 0
  for (const sib of siblings) {
    if (sib.daily <= 0) continue
    for (const d of days) {
      if (isRuptureDay(d, sib.h)) continue
      sibPromo += sib.h.sales[d] ?? 0
      sibNormal += sib.daily
    }
  }
  if (sibPromo <= 0 || sibNormal <= 0) return null
  const ratio = sibPromo / sibNormal
  const daily = (vel.daily * vel.usefulDays + promoSales / ratio) / (vel.usefulDays + days.length)
  return { ...vel, daily, estimated: { ratio, promoDays: days.length, promoSales } }
}

// ─── Plan par variante ────────────────────────────────────────────────────────

export type OpenLine = { orderId: string; orderedOn: string; prodDoneOn: string; arrivalOn: string; remaining: number }

export type VariantStatus = 'order' | 'soon' | 'ordered' | 'ok' | 'snoozed' | 'idle'

export type VariantPlan = {
  inProduction: number
  inTransit: number
  manual: number
  position: number
  stockDays: number | null      // jours de stock physique restants
  positionDays: number | null   // jours couverts par la position
  ruptureOn: string | null      // date de rupture estimée (arrivées prévues comprises)
  orderBy: string | null        // date limite pour commander (position sous le seuil)
  lateBy: number                // > 0 : même en commandant aujourd'hui, ça arrivera après la rupture
  suggested: number
  status: VariantStatus
}

export function roundQty(q: number, rule?: ProductRule): number {
  if (q <= 0) return 0
  let n = Math.ceil(q)
  if (rule?.moq && rule.moq > 0) n = Math.max(n, rule.moq)
  if (rule?.pack && rule.pack > 1) n = Math.ceil(n / rule.pack) * rule.pack
  return n
}

export function ruptureDate(stock: number, daily: number, open: OpenLine[], today: string, horizon = 730): string | null {
  if (daily <= 0) return null
  const arrivals = new Map<number, number>()
  for (const l of open) {
    const t = Math.max(0, daysBetween(today, l.arrivalOn))
    arrivals.set(t, (arrivals.get(t) ?? 0) + l.remaining)
  }
  let level = stock
  for (let t = 0; t <= horizon; t++) {
    level += arrivals.get(t) ?? 0
    if (level <= 0) return addDays(today, t)
    level -= daily
  }
  return null
}

export function planVariant(p: {
  stock: number; daily: number; open: OpenLine[]; manual: number
  snoozedUntil: string | null; rule?: ProductRule; today: string
}, s: ReorderSettings): VariantPlan {
  const { stock, daily, open, manual, today } = p
  const inProduction = open.filter((l) => today < l.prodDoneOn).reduce((a, l) => a + l.remaining, 0)
  const inTransit    = open.filter((l) => today >= l.prodDoneOn).reduce((a, l) => a + l.remaining, 0)
  const position     = stock + inProduction + inTransit + manual
  const base = { inProduction, inTransit, manual, position }
  if (daily <= 0) {
    return { ...base, stockDays: null, positionDays: null, ruptureOn: null, orderBy: null, lateBy: 0, suggested: 0, status: 'idle' }
  }
  const stockDays    = Math.max(0, stock) / daily
  const positionDays = position / daily
  const ruptureOn    = ruptureDate(stock, daily, open, today)
  // Seuil du jour : délai réel d'une commande passée aujourd'hui (fermetures comprises) + sécurité.
  const trigger      = effLead(today, s) + s.safetyDays
  const coverEnd     = addDays(today, Math.floor(positionDays))
  const orderBy      = latestOrderFor(addDays(coverEnd, -s.safetyDays), s)
  const lateBy       = ruptureOn ? Math.max(0, daysBetween(latestOrderFor(ruptureOn, s), today)) : 0
  const suggested    = positionDays < trigger ? roundQty(daily * (trigger + s.orderCoverDays) - position, p.rule) : 0

  const status: VariantStatus =
    suggested > 0 ? (p.snoozedUntil && p.snoozedUntil > today ? 'snoozed' : 'order')
    : open.length ? 'ordered'
    : daysBetween(today, orderBy) <= s.soonDays ? 'soon'
    : 'ok'
  return { ...base, stockDays, positionDays, ruptureOn, orderBy, lateBy, suggested, status }
}

// ─── Réceptions ───────────────────────────────────────────────────────────────

export type Jump = { variantId: string; day: string; qty: number }

// Hausse nette du stock entre deux relevés consécutifs. La quantité constatée
// rajoute les ventes du jour (vendues entre la réception et le relevé).
export function stockJumps(variantId: string, h: SalesHistory, daily: number, since: string): Jump[] {
  const days = Object.keys(h.stock).sort()
  const out: Jump[] = []
  const min = Math.max(5, Math.ceil(2 * daily))
  for (let i = 1; i < days.length; i++) {
    const day = days[i]
    if (day < since) continue
    const qty = h.stock[day] - h.stock[days[i - 1]] + (h.sales[day] ?? 0)
    if (qty >= min) out.push({ variantId, day, qty })
  }
  return out
}

export type ReceiptProposal =
  | { kind: 'order'; variantId: string; day: string; qty: number; orderId: string; orderedOn: string; remaining: number }
  | { kind: 'unplanned'; variantId: string; day: string; qty: number }

export function receiptProposals(jumps: Jump[], openByVariant: Record<string, OpenLine[]>, dismissed: string[]): ReceiptProposal[] {
  const skip = new Set(dismissed)
  const out: ReceiptProposal[] = []
  for (const j of jumps) {
    if (skip.has(`${j.variantId}|${j.day}`)) continue
    const line = (openByVariant[j.variantId] ?? [])
      .filter((l) => l.orderedOn <= j.day && j.qty >= 0.2 * l.remaining)
      .sort((a, b) => a.orderedOn.localeCompare(b.orderedOn))[0]
    out.push(line
      ? { kind: 'order', variantId: j.variantId, day: j.day, qty: Math.min(j.qty, line.remaining), orderId: line.orderId, orderedOn: line.orderedOn, remaining: line.remaining }
      : { kind: 'unplanned', variantId: j.variantId, day: j.day, qty: j.qty })
  }
  return out
}

// ─── Indicateurs du haut de l'onglet ──────────────────────────────────────────

export type KpiInput = { h: SalesHistory; daily: number; price: number }

export function ruptureKpis(items: KpiInput[], today: string, earliestSnapshot: string | null) {
  const monthStart = today.slice(0, 8) + '01'
  let lastRupture: string | null = null
  let lost = 0, ruptureNow = 0
  for (const { h, daily, price } of items) {
    if (daily <= 0) continue
    if (h.stockNow <= 0) { ruptureNow++; lastRupture = today }
    for (let d = monthStart; d <= today; d = addDays(d, 1)) {
      if (!isRuptureDay(d, h)) continue
      lost += daily * price
      if (!lastRupture || d > lastRupture) lastRupture = d
    }
    for (const [d, s] of Object.entries(h.stock)) if (s <= 0 && (!lastRupture || d > lastRupture)) lastRupture = d
  }
  const daysWithoutRupture = lastRupture ? daysBetween(lastRupture, today) : earliestSnapshot ? daysBetween(earliestSnapshot, today) : null
  return { daysWithoutRupture, lostThisMonth: lost, ruptureNow }
}
