// Prévision du coût de livraison d'une commande pas encore facturée par le
// logisticien, apprise sur les commandes déjà facturées (pur, sans I/O : testé
// dans model.test.ts).
//
//  - Niveau 2 (cible) : coût = base par colis + supplément hors France + supplément
//    par produit présent dans le colis (régression sur les commandes facturées ;
//    les articles offerts à 0 € ont leur propre coefficient, car ils pèsent dans le
//    colis). Utilisé seulement si TOUS les produits du colis ont ≥ minOrders
//    commandes facturées.
//  - Niveau 1 (repli) : coût moyen réel par taille de panier (1, 2, 3, 4+ articles
//    payants), France / hors France si l'échantillon suffit.

export type Zone = 'FR' | 'X'

// ── Contenu du colis ─────────────────────────────────────────────────────────
// Clé d'expédition d'un produit : son nom (deux fiches Shopify du même produit, ou sa
// version offerte, coûtent pareil à expédier).
export const shippingKey = (title: string) => title.trim().toLowerCase().replace(/\s+/g, ' ')
const ATTACH_RE = /^strap\s+([^™\s]+)/i
export const isAttachment = (title: string) => ATTACH_RE.test(title.trim())

// Produits d'un colis → { clé: quantité }. Les attaches offertes qui accompagnent
// leur produit (« Strap MumExplorer™ … » avec « MumExplorer™ … ») sont fusionnées
// dans ce produit : un seul coût « sac + attaches ». Une attache sans son produit
// reste à part.
export function basketProducts(lines: { title: string; qty: number; free: boolean }[]): Record<string, number> {
  const out: Record<string, number> = {}
  const names = lines.filter(l => !isAttachment(l.title)).map(l => l.title.trim().toLowerCase())
  for (const l of lines) {
    if (!(l.qty > 0)) continue
    const parent = l.title.trim().match(ATTACH_RE)?.[1]?.toLowerCase()
    if (l.free && parent && names.some(n => n.startsWith(parent + '™') || n.startsWith(parent + ' '))) continue
    const k = shippingKey(l.title)
    out[k] = (out[k] ?? 0) + l.qty
  }
  return out
}

// ── Grille tarifaire du logisticien (poids × pays) ───────────────────────────
// Une fois importée ET les poids renseignés pour tous les produits du colis, la
// prévision se fait à la grille ; sinon, calcul appris sur les factures.
export type ShippingGrid = {
  importedAt: string
  rows: { country: string; maxKg: number; price: number }[]   // country = code ISO ou '*' (tous pays)
  prepPerOrder: number                                       // préparation moyenne par colis (€)
}

export function gridPrice(grid: ShippingGrid, country: string, kg: number): number | null {
  for (const c of [country.toUpperCase(), '*']) {
    const rows = grid.rows.filter(r => r.country.toUpperCase() === c).sort((a, b) => a.maxKg - b.maxKg)
    const hit = rows.find(r => kg <= r.maxKg)
    if (hit) return hit.price
    if (rows.length) return null   // trop lourd pour la grille de ce pays
  }
  return null
}

// Coût à la grille, ou null si un produit du colis n'a pas de poids.
export function gridCost(grid: ShippingGrid | null, country: string, products: Record<string, number>, weights: Record<string, number>): number | null {
  if (!grid || !grid.rows.length) return null
  let g = 0
  for (const [k, q] of Object.entries(products)) {
    const w = weights[k]
    if (!(w > 0)) return null
    g += w * q
  }
  const price = gridPrice(grid, country, g / 1000)
  return price == null ? null : price + grid.prepPerOrder
}

export type OrderFeatures = {
  zone: Zone
  paidItems: number                  // articles payants (taille du panier)
  products: Record<string, number>   // clé produit → quantité (offerts inclus, clé « …:offert »)
}

export type ProductCoef = { coef: number; orders: number }

export type ShippingModel = {
  base: number
  intlExtra: number
  products: Record<string, ProductCoef>   // tous les produits vus (coef 0 si < minOrders)
  bySize: Record<string, { avg: number; orders: number }>  // '1FR', '1X', '1' …
  minOrders: number
  orders: number                          // commandes facturées ayant servi
}

export type Prediction = { cost: number; method: 'produit' | 'taille' }

export const sizeOf = (paidItems: number) => Math.min(Math.max(paidItems, 1), 4)
export const SIZE_LABEL: Record<number, string> = { 1: '1 article', 2: '2 articles', 3: '3 articles', 4: '4 articles et plus' }

const MIN_ZONE_SAMPLE = 20
const RIDGE = 1   // légère régularisation : produits souvent achetés ensemble (sac + attaches)

// Résout A·x = b (Gauss avec pivot partiel). A est carrée et (grâce au ridge) inversible.
function solve(A: number[][], b: number[]): number[] {
  const n = b.length
  const M = A.map((row, i) => [...row, b[i]])
  for (let i = 0; i < n; i++) {
    let p = i
    for (let r = i + 1; r < n; r++) if (Math.abs(M[r][i]) > Math.abs(M[p][i])) p = r
    ;[M[i], M[p]] = [M[p], M[i]]
    if (Math.abs(M[i][i]) < 1e-12) continue
    for (let r = 0; r < n; r++) {
      if (r === i) continue
      const f = M[r][i] / M[i][i]
      if (f) for (let c = i; c <= n; c++) M[r][c] -= f * M[i][c]
    }
  }
  return M.map((row, i) => (Math.abs(row[i]) < 1e-12 ? 0 : row[n] / row[i]))
}

export function trainModel(samples: { features: OrderFeatures; cost: number }[], minOrders = 30, ridge = RIDGE): ShippingModel {
  const data = samples.filter(s => s.cost > 0)   // avoirs / remboursements logisticien exclus
  const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0)

  // Niveau 1
  const bySize: ShippingModel['bySize'] = {}
  for (const s of [1, 2, 3, 4]) {
    const all = data.filter(d => sizeOf(d.features.paidItems) === s)
    bySize[String(s)] = { avg: avg(all.map(d => d.cost)), orders: all.length }
    for (const z of ['FR', 'X'] as Zone[]) {
      const zs = all.filter(d => d.features.zone === z)
      bySize[`${s}${z}`] = { avg: avg(zs.map(d => d.cost)), orders: zs.length }
    }
  }

  // Niveau 2 : régression (ridge) sur les produits assez fréquents
  const counts: Record<string, number> = {}
  for (const d of data) for (const p of Object.keys(d.features.products)) counts[p] = (counts[p] ?? 0) + 1
  const feats = Object.keys(counts).filter(p => counts[p] >= minOrders).sort()
  const k = 2 + feats.length
  const row = (f: OrderFeatures) => [1, f.zone === 'X' ? 1 : 0, ...feats.map(p => f.products[p] ?? 0)]
  const A = Array.from({ length: k }, () => new Array<number>(k).fill(0))
  const b = new Array<number>(k).fill(0)
  for (const d of data) {
    const x = row(d.features)
    for (let i = 0; i < k; i++) {
      b[i] += x[i] * d.cost
      for (let j = 0; j < k; j++) A[i][j] += x[i] * x[j]
    }
  }
  for (let i = 1; i < k; i++) A[i][i] += ridge
  const beta = data.length ? solve(A, b) : new Array<number>(k).fill(0)

  const products: Record<string, ProductCoef> = {}
  for (const p of Object.keys(counts)) products[p] = { coef: 0, orders: counts[p] }
  feats.forEach((p, i) => { products[p].coef = beta[i + 2] })

  return { base: beta[0], intlExtra: beta[1], products, bySize, minOrders, orders: data.length }
}

export function levelOne(model: ShippingModel, f: OrderFeatures): number {
  const s = sizeOf(f.paidItems)
  const z = model.bySize[`${s}${f.zone}`]
  if (z && z.orders >= MIN_ZONE_SAMPLE) return z.avg
  return model.bySize[String(s)]?.avg ?? 0
}

export function predict(model: ShippingModel, f: OrderFeatures): Prediction {
  const keys = Object.keys(f.products)
  const covered = keys.length > 0 && keys.every(p => (model.products[p]?.orders ?? 0) >= model.minOrders)
  if (!covered) return { cost: levelOne(model, f), method: 'taille' }
  let cost = model.base + (f.zone === 'X' ? model.intlExtra : 0)
  for (const p of keys) cost += model.products[p].coef * f.products[p]
  // Garde-fou : une combinaison extrême ne doit pas donner un coût absurde.
  if (!(cost > 0)) return { cost: levelOne(model, f), method: 'taille' }
  return { cost, method: 'produit' }
}

// Coût d'un article EN PLUS dans un colis (vue « Marginale ») : supplément du
// produit si le modèle le connaît assez, sinon `fallback` (réglage manuel).
export function extraItemCost(model: ShippingModel | null, productKey: string, fallback: number): number {
  const p = model?.products[productKey]
  if (!model || !p || p.orders < model.minOrders) return fallback
  return Math.max(0, p.coef)
}

// Coût retenu pour une commande : la facture si elle existe, sinon la grille (si
// importée et poids complets), sinon le calcul appris, sinon la moyenne.
export function orderCost(real: number | undefined, model: ShippingModel | null, f: OrderFeatures | null, fallback: number, grid: number | null = null):
  { cost: number; source: 'réel' | 'grille' | 'produit' | 'taille' | 'moyenne' } {
  if (real != null) return { cost: real, source: 'réel' }
  if (grid != null) return { cost: grid, source: 'grille' }
  if (model && f && model.orders > 0) { const p = predict(model, f); return { cost: p.cost, source: p.method } }
  return { cost: fallback, source: 'moyenne' }
}

// Contrôle qualité : prévision « à l'aveugle » vs facture, par taille de panier.
export function backtest(model: ShippingModel, test: { features: OrderFeatures; cost: number }[]) {
  const rows = [1, 2, 3, 4].map(s => ({ size: s, orders: 0, real: 0, predicted: 0 }))
  for (const t of test) {
    const r = rows[sizeOf(t.features.paidItems) - 1]
    r.orders++; r.real += t.cost; r.predicted += predict(model, t.features).cost
  }
  const total = rows.reduce((a, r) => ({ orders: a.orders + r.orders, real: a.real + r.real, predicted: a.predicted + r.predicted }), { orders: 0, real: 0, predicted: 0 })
  const err = (x: { real: number; predicted: number }) => (x.real > 0 ? (x.predicted - x.real) / x.real : null)
  return { bySize: rows.map(r => ({ ...r, errorPct: err(r) })), total: { ...total, errorPct: err(total) } }
}
