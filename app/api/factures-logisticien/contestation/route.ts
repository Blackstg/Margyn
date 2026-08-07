import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

export const maxDuration = 300

const MOOM_SHOP  = process.env.SHOPIFY_MOOM_SHOP!
const MOOM_TOKEN = process.env.SHOPIFY_MOOM_ACCESS_TOKEN!

function getAdmin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  )
}

// ── Zones (douane) ───────────────────────────────────────────────────────────
const EU_NONFR = new Set([
  'BE','DE','NL','ES','IT','PT','AT','LU','IE','DK','SE','FI','PL','CZ','HU',
  'RO','BG','HR','SK','SI','EE','LV','LT','GR','CY','MT',
])
const DOM = new Set(['RE','GP','MQ','GF','YT'])
type Zone = 'FR' | 'UE' | 'CH' | 'DOM' | 'X'
function zoneOf(cc: string): Zone {
  if (cc === 'FR') return 'FR'
  if (cc === 'CH') return 'CH'
  if (EU_NONFR.has(cc)) return 'UE'
  if (DOM.has(cc)) return 'DOM'
  return 'X'
}
function sizeKey(items: number): 1 | 2 | 4 {
  return items <= 1 ? 1 : items <= 3 ? 2 : 4
}
const median = (a: number[]) => {
  if (!a.length) return 0
  const s = [...a].sort((x, y) => x - y)
  const m = Math.floor(s.length / 2)
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}

interface ShopOrder { name: string; weight_g: number; items: number; cc: string; cust_ship_eur: number }

// Bulk fetch a month of Moom orders with everything we need to audit shipping.
async function fetchMonthShopify(month: string): Promise<Record<string, ShopOrder>> {
  const [y, m] = month.split('-')
  const from = `${y}-${m.padStart(2, '0')}-01T00:00:00Z`
  const to   = new Date(parseInt(y), parseInt(m), 1).toISOString().slice(0, 10) + 'T00:00:00Z'
  const fields = 'name,total_weight,line_items,shipping_address,shipping_lines'

  const out: Record<string, ShopOrder> = {}
  let pageInfo: string | null = null
  let first = true
  do {
    let url: string
    if (first) {
      url = `https://${MOOM_SHOP}/admin/api/2024-01/orders.json?${new URLSearchParams({ status: 'any', created_at_min: from, created_at_max: to, limit: '250', fields })}`
      first = false
    } else {
      url = `https://${MOOM_SHOP}/admin/api/2024-01/orders.json?limit=250&fields=${fields}&page_info=${pageInfo}`
    }
    const res = await fetch(url, { headers: { 'X-Shopify-Access-Token': MOOM_TOKEN } })
    if (!res.ok) break
    const { orders } = await res.json() as {
      orders: Array<{
        name: string; total_weight?: number
        line_items?: Array<{ quantity?: number }>
        shipping_address?: { country_code?: string } | null
        shipping_lines?: Array<{ price?: string }>
      }>
    }
    for (const o of (orders ?? [])) {
      out[o.name] = {
        name:          o.name,
        weight_g:      o.total_weight ?? 0,
        items:         (o.line_items ?? []).reduce((s, li) => s + (li.quantity ?? 1), 0),
        cc:            o.shipping_address?.country_code ?? '',
        cust_ship_eur: (o.shipping_lines ?? []).reduce((s, x) => s + parseFloat(x.price ?? '0'), 0),
      }
    }
    const link = res.headers.get('Link') ?? ''
    const next = link.match(/<[^>]+[?&]page_info=([^&>]+)[^>]*>;\s*rel="next"/)
    pageInfo = next ? next[1] : null
  } while (pageInfo)
  return out
}

interface JoinedRow {
  order: string; ship: number; serv: number; total: number
  weight_g: number; items: number; cc: string; zone: Zone; cust_ship_usd: number
}

export async function GET(req: NextRequest) {
  const month = req.nextUrl.searchParams.get('month')
  if (!month) return NextResponse.json({ error: 'month requis' }, { status: 400 })
  // 1 USD = usdEur EUR  → EUR→USD = /usdEur. Défaut 0.92 (non stocké par commande).
  const usdEur = parseFloat(req.nextUrl.searchParams.get('rate') ?? '0.92') || 0.92
  const EUR_TO_USD = 1 / usdEur

  const admin = getAdmin()
  const { data: summary } = await admin
    .from('logistician_invoice_summaries')
    .select('invoice_rows')
    .eq('brand', 'moom').eq('month', month).single()

  const rawRows = (summary?.invoice_rows ?? []) as Array<{ order_name: string; shipping_price: number; service_price: number; total_price: number; isFW?: boolean }>
  if (!rawRows.length) return NextResponse.json({ error: 'Aucune facture stockée pour ce mois' }, { status: 404 })

  // Aggregate billed per order (non-FW), summing multi-line orders.
  const billed: Record<string, { ship: number; serv: number; total: number }> = {}
  for (const r of rawRows) {
    if (r.isFW) continue
    const b = billed[r.order_name] ?? { ship: 0, serv: 0, total: 0 }
    b.ship  += Number(r.shipping_price) || 0
    b.serv  += Number(r.service_price)  || 0
    b.total += Number(r.total_price)    || 0
    billed[r.order_name] = b
  }

  const shop = await fetchMonthShopify(month)

  // Join
  const data: JoinedRow[] = []
  let noMatch = 0, noWeight = 0
  for (const [order, b] of Object.entries(billed)) {
    const s = shop[order]
    if (!s) { noMatch++; continue }
    if (!s.weight_g) noWeight++
    data.push({
      order, ...b, weight_g: s.weight_g, items: s.items, cc: s.cc,
      zone: zoneOf(s.cc), cust_ship_usd: (s.cust_ship_eur || 0) * EUR_TO_USD,
    })
  }

  // ── Régression shipping ~ poids (kg) ────────────────────────────────────────
  const wt = data.filter(d => d.weight_g > 0 && d.ship > 0)
  const xs = wt.map(d => d.weight_g / 1000), ys = wt.map(d => d.ship)
  const n = xs.length
  const mx = xs.reduce((s, v) => s + v, 0) / (n || 1)
  const my = ys.reduce((s, v) => s + v, 0) / (n || 1)
  const sxx = xs.reduce((s, v) => s + (v - mx) ** 2, 0)
  const sxy = xs.reduce((s, v, i) => s + (v - mx) * (ys[i] - my), 0)
  const slope = sxx ? sxy / sxx : 0
  const intercept = my - slope * mx
  const ssTot = ys.reduce((s, v) => s + (v - my) ** 2, 0)
  const ssRes = ys.reduce((s, v, i) => s + (v - (intercept + slope * xs[i])) ** 2, 0)
  const r2 = ssTot ? 1 - ssRes / ssTot : 0
  const perKg = wt.map(d => d.ship / (d.weight_g / 1000)).sort((a, b) => a - b)
  const regression = {
    n, intercept, slope, r2,
    perKgMedian: median(perKg),
    perKgMin: perKg[0] ?? 0,
    perKgMax: perKg[perKg.length - 1] ?? 0,
  }
  const weightModel = (kg: number) => intercept + slope * kg

  // ── Segments (zone × taille) ────────────────────────────────────────────────
  const segMap: Record<string, JoinedRow[]> = {}
  for (const d of data) {
    if (d.zone === 'X') continue
    ;(segMap[`${d.zone}|${sizeKey(d.items)}`] ??= []).push(d)
  }
  const sizeLabel = { 1: 'petit (1 art.)', 2: 'moyen (2-3)', 4: 'gros (4+)' } as const
  const segments = Object.entries(segMap)
    .filter(([, g]) => g.length >= 3)
    .map(([k, g]) => {
      const [zone, sz] = k.split('|')
      return {
        zone, size: sizeLabel[Number(sz) as 1 | 2 | 4], n: g.length,
        ship:   median(g.map(d => d.ship)),
        serv:   median(g.map(d => d.serv)),
        total:  median(g.map(d => d.total)),
        client: median(g.map(d => d.cust_ship_usd)),
        loss:   median(g.map(d => d.total - d.cust_ship_usd)),
        weight: median(g.filter(d => d.weight_g > 0).map(d => d.weight_g)),
      }
    })
    .sort((a, b) => a.zone.localeCompare(b.zone) || a.n - b.n)
  const segShip: Record<string, number> = {}
  for (const s of segments) segShip[`${s.zone}|${sizeKey(s.size === 'petit (1 art.)' ? 1 : s.size === 'moyen (2-3)' ? 3 : 4)}`] = s.ship

  // ── Contestation par commande (recalcul sur TOUTES les commandes) ────────────
  const segMedianShip = (zone: Zone, items: number) => segShip[`${zone}|${sizeKey(items)}`] ?? median(data.filter(d => d.zone === zone).map(d => d.ship))
  const contest: Array<{ order: string; zone: Zone; cc: string; type: 'shipping' | 'service'; items: number; kg: number; billed: number; fair: number; delta: number }> = []
  for (const d of data) {
    if (d.zone === 'X') continue
    const kg = d.weight_g / 1000
    // Shipping
    const fairShip = Math.max(segMedianShip(d.zone, d.items), kg > 0 ? weightModel(kg) : 0)
    const dShip = d.ship - fairShip
    if (dShip >= 8) contest.push({ order: d.order, zone: d.zone, cc: d.cc, type: 'shipping', items: d.items, kg, billed: d.ship, fair: fairShip, delta: dShip })
    // Service (juste = min 4$, ou modèle articles 1 + 0.47/art.)
    const fairServ = Math.min(4, 1 + 0.47 * d.items)
    const dServ = d.serv - fairServ
    if (dServ >= 3) contest.push({ order: d.order, zone: d.zone, cc: d.cc, type: 'service', items: d.items, kg, billed: d.serv, fair: fairServ, delta: dServ })
  }
  contest.sort((a, b) => b.delta - a.delta)
  const strong = contest.filter(c => c.zone !== 'CH')
  const ch     = contest.filter(c => c.zone === 'CH')
  const sum = (arr: typeof contest) => arr.reduce((s, c) => s + Math.max(0, c.delta), 0)

  // ── Marge par zone ──────────────────────────────────────────────────────────
  const margin = (['FR', 'UE', 'CH'] as Zone[]).map(z => {
    const g = data.filter(d => d.zone === z)
    return {
      zone: z, n: g.length,
      clientMed: median(g.map(d => d.cust_ship_usd)),
      costMed:   median(g.map(d => d.total)),
      absorbed:  median(g.map(d => d.total)) - median(g.map(d => d.cust_ship_usd)),
    }
  })
  const frFree = data.filter(d => d.zone === 'FR' && d.cust_ship_usd === 0).length
  const frTot  = data.filter(d => d.zone === 'FR').length

  return NextResponse.json({
    month,
    usdEur,
    counts: { orders: data.length, noMatch, noWeight, weightCoverage: data.length ? 1 - noWeight / data.length : 0 },
    regression,
    serviceCorr: {
      r2Weight: (() => {
        const g = data.filter(d => d.serv > 0 && d.weight_g > 0)
        if (g.length < 5) return null
        const X = g.map(d => d.weight_g / 1000), Y = g.map(d => d.serv)
        const MX = X.reduce((s, v) => s + v, 0) / X.length, MY = Y.reduce((s, v) => s + v, 0) / Y.length
        const SXX = X.reduce((s, v) => s + (v - MX) ** 2, 0)
        const SXY = X.reduce((s, v, i) => s + (v - MX) * (Y[i] - MY), 0)
        const B1 = SXX ? SXY / SXX : 0, B0 = MY - B1 * MX
        const T = Y.reduce((s, v) => s + (v - MY) ** 2, 0)
        const R = Y.reduce((s, v, i) => s + (v - (B0 + B1 * X[i])) ** 2, 0)
        return T ? 1 - R / T : 0
      })(),
    },
    segments,
    contest: { strong, ch, strongTotal: sum(strong), chTotal: sum(ch) },
    margin, frFree, frTot,
  })
}
