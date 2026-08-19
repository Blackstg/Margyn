// Import d'un CSV de vente privée (Choose) pour Mōom.
// POST { csv: string } → { months: [{ month, ca, reverse, cogs, cogs_matched, cogs_total, orders, products, unmatched:[{product, qty}] }] }
//   ca      = CA TTC retail (VENTES TOTALES Choose)
//   reverse = ce que Choose reverse à Mōom (colonne « Prix Achat HT » ≈ Total facturé) = CA − commission Choose
//   cogs    = coût produit Mōom estimé depuis Shopify (best-effort, par SKU puis token de nom)
import { NextRequest, NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

const SHOP  = process.env.SHOPIFY_MOOM_SHOP!
const TOKEN = process.env.SHOPIFY_MOOM_ACCESS_TOKEN!

const num = (s: string | undefined) => {
  const v = (s ?? '').trim().replace(/ /g, '').replace(/\s/g, '').replace(',', '.')
  const n = parseFloat(v)
  return isNaN(n) ? 0 : n
}

// Normalise un titre pour comparer Choose ↔ Shopify : minuscules, sans accents, sans
// ™ ni espaces ni ponctuation. Ainsi « Mum Explorer » == « MumExplorer ».
function norm(t: string): string {
  return (t || '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '') // enlève les accents
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '')                        // enlève espaces/™/ponctuation
}

// Tokens produits Mōom (déjà normalisés). Le plus spécifique gagne.
const PRODUCT_TOKENS = [
  'mumexplorer', 'mumessential', 'mummoot', 'matexplorer', 'toteessential',
  'kitexplorer', 'wrapexplorer', 'caryexplorer', 'walkexplorer', 'pouchexplorer',
  'fluffyexplorer', 'pochexplorer',
]

// Token distinctif d'un nom de produit (marche que le nom ait un espace ou non).
function nameToken(t: string): string | null {
  const n = norm(t)
  for (const tok of PRODUCT_TOKENS) if (n.includes(tok)) return tok
  // Repli : un mot « …explorer » collé (ex. autre variante non listée).
  const m = n.match(/([a-z]{3,}explorer)/)
  return m ? m[1] : null
}

interface ShopVariant { sku?: string | null; inventory_item_id: number }
interface ShopProduct { title: string; variants: ShopVariant[] }

async function shopify(path: string) {
  const res = await fetch(`https://${SHOP}/admin/api/2024-01/${path}`, {
    headers: { 'X-Shopify-Access-Token': TOKEN }, cache: 'no-store',
  })
  if (!res.ok) throw new Error(`Shopify ${res.status}`)
  return res.json()
}

// Cartes SKU→coût et token→coûts, depuis les produits + inventory_items Shopify.
async function buildCostMaps(): Promise<{ skuCost: Map<string, number>; tokenCost: Map<string, number[]> }> {
  const skuCost = new Map<string, number>()
  const tokenCost = new Map<string, number[]>()
  const iidMeta = new Map<number, { title: string; sku: string }>()

  // 1) produits (pagination simple)
  let pageInfo: string | null = null
  let first = true
  do {
    const p: string = first
      ? `products.json?limit=250&fields=id,title,variants`
      : `products.json?limit=250&fields=id,title,variants&page_info=${pageInfo}`
    first = false
    const res = await fetch(`https://${SHOP}/admin/api/2024-01/${p}`, { headers: { 'X-Shopify-Access-Token': TOKEN }, cache: 'no-store' })
    if (!res.ok) break
    const data = await res.json() as { products: ShopProduct[] }
    for (const prod of data.products ?? []) {
      for (const v of prod.variants ?? []) {
        iidMeta.set(v.inventory_item_id, { title: prod.title, sku: (v.sku ?? '').trim() })
      }
    }
    const link = res.headers.get('Link') ?? ''
    const m = link.match(/<[^>]+[?&]page_info=([^&>]+)[^>]*>;\s*rel="next"/)
    pageInfo = m ? m[1] : null
  } while (pageInfo)

  // 2) coûts (inventory_items, batches de 50)
  const iids = [...iidMeta.keys()]
  for (let i = 0; i < iids.length; i += 50) {
    const batch = iids.slice(i, i + 50)
    const data = await shopify(`inventory_items.json?ids=${batch.join(',')}&limit=250`) as { inventory_items?: { id: number; cost?: string | null }[] }
    for (const it of data.inventory_items ?? []) {
      if (it.cost == null || it.cost === '') continue
      const cost = parseFloat(it.cost)
      const meta = iidMeta.get(it.id)
      if (!meta) continue
      if (meta.sku) skuCost.set(meta.sku, cost)
      const tk = nameToken(meta.title)
      if (tk) { const arr = tokenCost.get(tk) ?? []; arr.push(cost); tokenCost.set(tk, arr) }
    }
  }
  return { skuCost, tokenCost }
}

// Parseur CSV minimal (séparateur ;) — pas de guillemets multi-lignes dans ce flux.
function parseCsv(text: string): Record<string, string>[] {
  const lines = text.split(/\r?\n/).filter(l => l.trim() !== '')
  if (lines.length < 2) return []
  const headers = lines[0].split(';').map(h => h.trim())
  return lines.slice(1).map(line => {
    const cells = line.split(';')
    const row: Record<string, string> = {}
    headers.forEach((h, i) => { row[h] = (cells[i] ?? '').trim() })
    return row
  })
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({})) as { csv?: string }
  if (!body.csv) return NextResponse.json({ error: 'csv manquant' }, { status: 400 })

  let skuCost = new Map<string, number>(), tokenCost = new Map<string, number[]>()
  try { ({ skuCost, tokenCost } = await buildCostMaps()) } catch { /* pas de COGS → 0, editable */ }

  const rows = parseCsv(body.csv).filter(r => (r['Produit'] ?? '').trim() && r['Référence'] !== 'Total :')

  type Agg = { ca: number; reverse: number; cogs: number; matched: number; total: number; orders: Set<string>; products: number; unmatched: Map<string, number> }
  const byMonth = new Map<string, Agg>()

  for (const r of rows) {
    const d = (r['Commandé le'] ?? '').trim() // dd/mm/yyyy
    const month = d.length >= 10 ? `${d.slice(6, 10)}-${d.slice(3, 5)}-01` : 'inconnu'
    const a = byMonth.get(month) ?? { ca: 0, reverse: 0, cogs: 0, matched: 0, total: 0, orders: new Set(), products: 0, unmatched: new Map() }

    const qty = num(r['Quantité']) || 1
    a.ca      += num(r['Prix (TTC €)']) - num(r['Remboursement (TTC €)'])
    a.reverse += num(r['Prix Achat (HT €)'])
    a.products += qty
    if (r['Référence']) a.orders.add(r['Référence'])
    a.total += 1

    // COGS : SKU exact d'abord, sinon token de nom (moyenne des variantes)
    const sku = (r['SKU'] ?? '').trim()
    let cost: number | null = null
    if (sku && skuCost.has(sku)) cost = skuCost.get(sku)!
    if (cost == null) {
      const tk = nameToken(r['Produit'] ?? '')
      if (tk && tokenCost.has(tk)) { const arr = tokenCost.get(tk)!; cost = arr.reduce((s, v) => s + v, 0) / arr.length }
    }
    if (cost != null) { a.cogs += cost * qty; a.matched += 1 }
    else a.unmatched.set(r['Produit'], (a.unmatched.get(r['Produit']) ?? 0) + qty)

    byMonth.set(month, a)
  }

  const months = [...byMonth.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([month, a]) => ({
    month,
    ca:            Math.round(a.ca * 100) / 100,
    reverse:       Math.round(a.reverse * 100) / 100,
    commission:    Math.round((a.ca - a.reverse) * 100) / 100,
    cogs:          Math.round(a.cogs * 100) / 100,
    cogs_matched:  a.matched,
    cogs_total:    a.total,
    orders:        a.orders.size,
    products:      a.products,
    unmatched:     [...a.unmatched.entries()].map(([product, qty]) => ({ product, qty })),
  }))

  return NextResponse.json({ months })
}
