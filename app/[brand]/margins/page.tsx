'use client'

export const dynamic = 'force-dynamic'

import { useState, useEffect, useCallback, useMemo, Fragment } from 'react'
import { useUrlState } from '@/lib/useUrlState'
import { useSearchParams, useRouter, usePathname } from 'next/navigation'
import { createBrowserClient } from '@supabase/auth-helpers-nextjs'
import { ChevronRight, Percent, AlertTriangle } from 'lucide-react'
import { shippingKey } from '@/lib/shipping/model'
import { aloneOutcome, addOutcomes, takeaways, type ProductEconomics } from '@/lib/margins/packRules'
import ProductOutcome, { SEGMENTS } from '@/components/margins/ProductOutcome'
import PackGrid from '@/components/margins/PackGrid'
import TakeawayCards from '@/components/margins/TakeawayCards'
import TypicalBasketCards from '@/components/margins/TypicalBasketCards'

const supabase = createBrowserClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
)

type Period = '7j' | '30j' | 'mois'

function fmt(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

// Fenêtre glissante finissant HIER (aujourd'hui incomplet), comme le dashboard.
function getRange(period: Period): { from: string; to: string } {
  const today = new Date(); today.setHours(0, 0, 0, 0)
  const to = new Date(today); to.setDate(to.getDate() - 1)
  let from: Date
  if (period === '7j')       { from = new Date(to); from.setDate(from.getDate() - 6) }
  else if (period === '30j') { from = new Date(to); from.setDate(from.getDate() - 29) }
  else                       { from = new Date(today.getFullYear(), today.getMonth(), 1) }
  return { from: fmt(from), to: fmt(to) }
}

// Mois précis (ex. juin clôturé) : du 1er au dernier jour (plafonné à hier).
function monthRange(ym: string): { from: string; to: string } {
  const [y, m] = ym.split('-').map(Number)
  const first = new Date(y, m - 1, 1)
  const last  = new Date(y, m, 0)
  const yst   = new Date(); yst.setHours(0, 0, 0, 0); yst.setDate(yst.getDate() - 1)
  return { from: fmt(first), to: fmt(last < yst ? last : yst) }
}

function monthOptions(): { value: string; label: string }[] {
  const opts: { value: string; label: string }[] = []
  const d = new Date()
  for (let i = 0; i < 12; i++) {
    opts.push({ value: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`, label: d.toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' }) })
    d.setMonth(d.getMonth() - 1)
  }
  return opts
}

const eur = (n: number) => new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }).format(n)
const eur2 = (n: number) => new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR', minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n)
const pct = (m: number, rev: number) => (rev > 0 ? (m / rev) * 100 : 0)

interface Sale { product_title: string; shopify_product_id: string | null; variant_id: string | null; variant_title: string | null; quantity: number; revenue: number; order_id: string | null }
// Ligne vendue PAYANTE (les articles offerts à 0 € sont exclus : leur coût est déjà
// compris dans celui de l'article principal, ex. attaches poussette avec le sac).
interface Line { orderId: string; pKey: string; title: string; vKey: string; variantTitle: string; qty: number; revenue: number; cost: number | null }
// shipping = livraison NETTE du port payé par le client ; forecast = contient des coûts prévus.
interface VariantRow { key: string; variant_title: string; quantity: number; revenue: number; cost: number; shipping: number; missing: boolean; forecast?: boolean }
interface ProductRow { key: string; title: string; quantity: number; revenue: number; cost: number; shipping: number; margin: number; missing: boolean; forecast?: boolean; variants: VariantRow[] }

type SortKey = 'margin' | 'pct' | 'revenue'
type ShipMode = 'prorata' | 'marginal'
// Coût de livraison d'une commande (API, même calcul que le tableau de bord) :
// réel facturé ou prévu selon le contenu du colis, + port payé par le client.
type OrderShip = { cost: number; source: 'réel' | 'grille' | 'produit' | 'taille' | 'moyenne'; port: number }
type ModelSummary = {
  window: { from: string; to: string }; orders: number; base: number; intlExtra: number; minOrders: number
  products: { key: string; title: string; coef: number; orders: number; used: boolean }[]
  bySize: { size: number; avg: number; orders: number }[]
}
type TypicalBasket = { label: string; predicted: number; real: number | null; realOrders: number; frequent?: number }
const isForecast = (o: OrderShip | undefined) => !!o && o.source !== 'réel'
const shortTitle = (t: string) => t.split('™')[0].trim()

// Pastille « réel » / « estimé » à côté d'un montant de livraison.
function ShipBadge({ share, tip }: { share: number; tip?: string }) {
  if (share <= 0) return <span className="ml-1.5 inline-block align-middle rounded-full px-1.5 py-px text-[9px] font-semibold bg-[#e6f4ec] text-[#1a7f4b] not-italic">réel</span>
  return (
    <span title={tip} className="ml-1.5 inline-block align-middle rounded-full px-1.5 py-px text-[9px] font-semibold bg-[#fff3cd] text-[#92400e] not-italic cursor-help">
      {share >= 0.995 ? 'estimé' : `${Math.round(share * 100)} % estimé`}
    </span>
  )
}

// Répartit la livraison de chaque commande sur ses lignes.
//  - prorata  : au prorata du CA de chaque ligne ;
//  - marginal : l'article principal (prix unitaire le plus élevé) porte la livraison,
//    chaque article en plus ne porte que `extra` €. Le total reste le coût réel de la
//    commande : l'article principal porte ce qui reste une fois les extras déduits.
function shippingByLine(lines: Line[], shipFor: (orderId: string) => number, mode: ShipMode, extraFor: (title: string) => number): number[] {
  const out = new Array<number>(lines.length).fill(0)
  const byOrder = new Map<string, number[]>()
  lines.forEach((l, i) => {
    if (!l.orderId) return
    const a = byOrder.get(l.orderId) ?? []
    a.push(i); byOrder.set(l.orderId, a)
  })
  for (const [oid, idx] of byOrder) {
    const S = shipFor(oid)   // net du port payé par le client (peut être négatif)
    if (!S) continue
    if (mode === 'prorata') {
      const tot = idx.reduce((s, i) => s + lines[i].revenue, 0)
      for (const i of idx) out[i] = tot > 0 ? S * (lines[i].revenue / tot) : 0
      continue
    }
    let main = idx[0]
    for (const i of idx) if (lines[i].revenue / lines[i].qty > lines[main].revenue / lines[main].qty) main = i
    // Chaque article en plus porte son supplément ; l'article principal porte le reste.
    let extras = 0
    for (const i of idx) {
      out[i] = extraFor(lines[i].title) * (i === main ? lines[i].qty - 1 : lines[i].qty)
      extras += out[i]
    }
    out[main] += S - extras
  }
  return out
}

function Toggle<T extends string>({ value, options, onChange, title }: { value: T; options: [T, string][]; onChange: (v: T) => void; title?: string }) {
  return (
    <div className="inline-flex items-center bg-[#f5f5f3] rounded-lg p-0.5 gap-0.5" title={title}>
      {options.map(([v, lbl]) => (
        <button key={v} onClick={() => onChange(v)}
          className={`px-2 py-0.5 rounded-md text-[10px] font-semibold ${value === v ? 'bg-white text-[#1a1a2e] shadow-sm' : 'text-[#6b6b63]'}`}>{lbl}</button>
      ))}
    </div>
  )
}

export default function MarginsPage({ params }: { params: { brand: string } }) {
  const { brand } = params
  // La sélection période/mois vit dans l'URL (?period=…|?month=YYYY-MM) : elle
  // survit au refresh nativement (pas de localStorage) et donne un lien partageable.
  const searchParams = useSearchParams()
  const router = useRouter()
  const pathname = usePathname()
  const [period, setPeriod]   = useState<Period>(() => {
    const p = searchParams.get('period')
    return p === '7j' || p === '30j' || p === 'mois' ? p : 'mois'
  })
  const [month, setMonth]     = useState<string>(() => searchParams.get('month') ?? '')  // '' = période glissante · sinon 'YYYY-MM'
  const [lines, setLines]     = useState<Line[]>([])
  const [freeOnlyOrders, setFreeOnlyOrders] = useState<string[]>([])  // commandes sans aucun article payant
  const [freeItems, setFreeItems] = useState(0)
  const [shipByOrder, setShipByOrder] = useState<Record<string, OrderShip> | null>(null)
  const [shipNote, setShipNote] = useState<string | null>(null)
  const [model, setModel] = useState<ModelSummary | null>(null)
  const [typical, setTypical] = useState<TypicalBasket[]>([])
  const [detail, setDetail] = useUrlState<'simple' | 'detail'>('colonnes', 'simple')
  const [showThin, setShowThin] = useState(false)
  const [showFigures, setShowFigures] = useState(false)   // tableaux détaillés (Par commande)
  // Prix catalogue, coût d'achat et image par produit (clé d'expédition = nom).
  const [catalog, setCatalog] = useState<Record<string, { title: string; price: number; purchase: number; image: string | null }>>({})
  const [loading, setLoading] = useState(true)
  const [sort, setSort]       = useState<SortKey>('margin')
  const [tab, setTab]         = useUrlState<'produits' | 'commandes'>('tab', 'produits')
  const [view, setView]       = useUrlState<'total' | 'unit'>('view', 'unit')  // 'unit' = prix par article
  const [shipMode, setShipMode] = useUrlState<ShipMode>('livraison', 'prorata')
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [shipPerOrder, setShipPerOrder] = useState(0)
  const [extraItem, setExtraItem] = useState(0)
  const [feeRate, setFeeRate] = useState(0.017)
  const [basis, setBasis] = useUrlState<'contribution' | 'loaded'>('basis', 'contribution')
  // Charges hors produit/livraison (pub + frais fixes + frais transaction), au niveau période.
  const [overhead, setOverhead] = useState<{ marketing: number; fixed: number; fees: number; total: number } | null>(null)
  const [partial, setPartial] = useState(false)  // période non clôturée (mois courant / fenêtre glissante)

  // Reflète la sélection dans l'URL (un mois précis a priorité sur la période), sans
  // perdre les autres paramètres (onglet, vue…).
  useEffect(() => {
    const qs = new URLSearchParams(window.location.search)
    qs.delete('month'); qs.delete('period')
    if (month) qs.set('month', month)
    else qs.set('period', period)
    const next = qs.toString()
    if (next !== window.location.search.replace(/^\?/, '')) router.replace(`${pathname}?${next}`, { scroll: false })
  }, [period, month, pathname, router, searchParams])

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const { from, to } = month ? monthRange(month) : getRange(period)

      // IMPORTANT : PostgREST plafonne les réponses à 1000 lignes (max-rows), donc
      // `.limit(50000)` ne suffit PAS — il faut paginer, sinon le CA est sous-compté
      // (ex. Moom ~1600 lignes/mois → seules 1000 remontaient). Tri stable obligatoire.
      const fetchAllSales = async (): Promise<Sale[]> => {
        const cols = 'product_title, shopify_product_id, variant_id, variant_title, quantity, revenue, order_id'
        const PAGE = 1000
        const all: Sale[] = []
        for (let offset = 0; ; offset += PAGE) {
          const { data, error } = await supabase.from('product_sales').select(cols)
            .eq('brand', brand).gte('date', from).lte('date', to)
            .order('order_id', { ascending: true, nullsFirst: false })
            .order('variant_id', { ascending: true, nullsFirst: false })
            .order('product_title', { ascending: true })
            .range(offset, offset + PAGE - 1)
          if (error || !data || data.length === 0) break
          all.push(...(data as Sale[]))
          if (data.length < PAGE) break
        }
        return all
      }

      const [salesData, variantsRes, productsRes, settingsRes, spendRes, fixedCostsRaw] = await Promise.all([
        fetchAllSales(),
        supabase.from('product_variants')
          .select('shopify_variant_id, shopify_product_id, cost_price, product_title, sell_price, image_url, product_status').eq('brand', brand),
        supabase.from('products')
          .select('shopify_id, cost_price').eq('brand', brand),
        supabase.from('brand_settings').select('shipping_cost_per_order, transaction_fee_rate, extra_item_cost').eq('brand', brand).maybeSingle(),
        supabase.from('ad_spends').select('spend').eq('brand', brand).gte('date', from).lte('date', to),
        fetch(`/api/fixed-costs?brand=${brand}`).then(r => r.json()).catch(() => []),
      ])
      const flat = Number(settingsRes.data?.shipping_cost_per_order ?? 0)
      setShipPerOrder(flat)
      setExtraItem(Number(settingsRes.data?.extra_item_cost ?? 0))
      const rate = settingsRes.data?.transaction_fee_rate ?? 0.017
      setFeeRate(rate)

      // Coût : variante → produit → moyenne variantes du produit
      const costByVariant = new Map<string, number>()
      const costByProduct = new Map<string, number>()
      const prodVarCosts  = new Map<string, number[]>()
      for (const v of variantsRes.data ?? []) {
        if (v.cost_price != null) {
          costByVariant.set(String(v.shopify_variant_id), v.cost_price)
          if (v.shopify_product_id) {
            const a = prodVarCosts.get(String(v.shopify_product_id)) ?? []
            a.push(v.cost_price); prodVarCosts.set(String(v.shopify_product_id), a)
          }
        }
      }
      for (const p of productsRes.data ?? []) if (p.cost_price != null) costByProduct.set(String(p.shopify_id), p.cost_price)

      // Catalogue par produit : moyenne des variantes actives (prix catalogue, achat).
      type V = { product_title: string | null; sell_price: number | null; cost_price: number | null; image_url: string | null; product_status: string | null }
      const cat: Record<string, { title: string; prices: number[]; costs: number[]; image: string | null }> = {}
      for (const v of (variantsRes.data ?? []) as V[]) {
        if (!v.product_title || v.product_status !== 'active') continue
        const k = shippingKey(v.product_title)
        const c = cat[k] ??= { title: v.product_title.split('™')[0].trim(), prices: [], costs: [], image: null }
        if (v.sell_price) c.prices.push(Number(v.sell_price))
        if (v.cost_price != null) c.costs.push(Number(v.cost_price))
        if (!c.image && v.image_url) c.image = v.image_url
      }
      const mean = (a: number[]) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0)
      setCatalog(Object.fromEntries(Object.entries(cat).filter(([, c]) => c.prices.length && c.costs.length)
        .map(([k, c]) => [k, { title: c.title, price: mean(c.prices), purchase: mean(c.costs), image: c.image }])))
      const costByProductAvg = new Map<string, number>()
      for (const [k, a] of prodVarCosts) costByProductAvg.set(k, a.reduce((s, x) => s + x, 0) / a.length)

      const unitCost = (s: Sale): number | null => {
        const byV = s.variant_id ? costByVariant.get(String(s.variant_id)) : undefined
        if (byV != null) return byV
        const pid = s.shopify_product_id ? String(s.shopify_product_id) : ''
        return costByProduct.get(pid) ?? costByProductAvg.get(pid) ?? null
      }

      // Lignes payantes uniquement ; les articles offerts (0 €) ne comptent ni comme
      // article ni comme coût.
      const out: Line[] = []
      const paidOrders = new Set<string>(), allOrders = new Set<string>()
      let free = 0
      for (const s of salesData) {
        if (!s.product_title) continue
        const oid = s.order_id ? String(s.order_id) : ''
        if (oid) allOrders.add(oid)
        if (!((s.revenue || 0) > 0) || !(s.quantity > 0)) { free += s.quantity || 0; continue }
        if (oid) paidOrders.add(oid)
        const c = unitCost(s)
        out.push({
          orderId: oid,
          pKey: s.shopify_product_id ? `p${s.shopify_product_id}` : `t${s.product_title}`, title: s.product_title,
          vKey: s.variant_id ? `v${s.variant_id}` : `vt${s.variant_title ?? ''}`, variantTitle: s.variant_title || '—',
          qty: s.quantity, revenue: s.revenue || 0, cost: c == null ? null : c * s.quantity,
        })
      }
      setFreeItems(free)
      setFreeOnlyOrders(Array.from(allOrders).filter(o => !paidOrders.has(o)))

      // Coût de livraison par commande + port payé (Moom, Krom) : même calcul que le
      // tableau de bord. Autres marques : tarif moyen paramétré, sans port.
      let byOrder: Record<string, OrderShip> | null = null
      let note: string | null = null, summary: ModelSummary | null = null
      if (brand === 'moom' || brand === 'krom') {
        try {
          const ship = await fetch(`/api/margins/shipping?brand=${brand}&from=${from}&to=${to}`).then(r => r.json()) as
            { byOrder?: Record<string, OrderShip>; note?: string | null; model?: ModelSummary | null; typical?: TypicalBasket[] }
          if (ship?.byOrder) { byOrder = ship.byOrder; note = ship.note ?? null; summary = ship.model ?? null; setTypical(ship.typical ?? []) }
        } catch { /* garde l'estimation */ }
      }
      setShipByOrder(byOrder)
      setShipNote(note)
      setModel(summary)

      // ── Charges hors produit/livraison, au niveau période ────────────────────
      // Publicité (ad_spends) + frais fixes récurrents (salaires, infra, app) prorata
      // des jours + frais de transaction (% du CA). La livraison est déjà comptée
      // plus haut → on EXCLUT le fulfillment des frais fixes (pas de double compte).
      const periodRevenue = out.reduce((s, r) => s + r.revenue, 0)
      const marketing = (spendRes.data ?? []).reduce((s: number, r: { spend?: number | null }) => s + (r.spend ?? 0), 0)

      type FixedRow = { amount?: number | null; category?: string | null; month?: string | null }
      const fixedRows: FixedRow[] = Array.isArray(fixedCostsRaw) ? fixedCostsRaw : []
      let fixedApp = 0, fixedTeam = 0, fixedInfra = 0
      for (const r of fixedRows) {
        if (r.month !== '1900-01-01') continue          // seules les lignes récurrentes (sentinelle)
        const amount = r.amount ?? 0
        if (r.category === 'app') fixedApp += amount
        else if (r.category === 'fulfillment') { /* déjà dans la livraison */ }
        else if (r.category === 'team') fixedTeam += amount
        else fixedInfra += amount
      }
      const [fy, fm, fd] = from.split('-').map(Number)
      const [ty, tm, td] = to.split('-').map(Number)
      const days = Math.round((Date.UTC(ty, tm - 1, td) - Date.UTC(fy, fm - 1, fd)) / 86400000) + 1
      const daysInFromMonth = new Date(fy, fm, 0).getDate()
      const isFullMonth = fd === 1 && days === daysInFromMonth && fy === ty && fm === tm
      const ratio = isFullMonth ? 1 : days / 30.44
      setPartial(!isFullMonth)  // pub non « mûrie » + charges au prorata → net à interpréter avec prudence
      const fixed = Math.round((fixedTeam + fixedInfra + fixedApp) * ratio)
      const fees = Math.round(periodRevenue * rate)

      setOverhead({ marketing: Math.round(marketing), fixed, fees, total: Math.round(marketing) + fixed + fees })
      setLines(out)
    } finally { setLoading(false) }
  }, [brand, period, month])

  useEffect(() => { load() }, [load])

  const costFor = useCallback((oid: string) => (shipByOrder?.[oid]?.cost ?? shipPerOrder), [shipByOrder, shipPerOrder])
  const portFor = useCallback((oid: string) => shipByOrder?.[oid]?.port ?? 0, [shipByOrder])
  const netFor  = useCallback((oid: string) => costFor(oid) - portFor(oid), [costFor, portFor])
  // Vue marginale : supplément par produit appris sur les factures ; réglage manuel
  // (Paramètres) pour les produits que le modèle ne connaît pas assez.
  const extraFor = useCallback((title: string) => {
    const k = shippingKey(title)
    const p = model?.products.find(x => x.key === k)
    return p && p.used ? Math.max(0, p.coef) : extraItem
  }, [model, extraItem])

  // Agrégation produit → variante, livraison répartie selon la vue choisie.
  const rows = useMemo<ProductRow[]>(() => {
    const ship = shippingByLine(lines, netFor, shipMode, extraFor)
    const prodMap = new Map<string, ProductRow & { varMap: Map<string, VariantRow> }>()
    lines.forEach((l, i) => {
      let p = prodMap.get(l.pKey)
      if (!p) { p = { key: l.pKey, title: l.title, quantity: 0, revenue: 0, cost: 0, shipping: 0, margin: 0, missing: false, variants: [], varMap: new Map() }; prodMap.set(l.pKey, p) }
      let v = p.varMap.get(l.vKey)
      if (!v) { v = { key: l.vKey, variant_title: l.variantTitle, quantity: 0, revenue: 0, cost: 0, shipping: 0, missing: false }; p.varMap.set(l.vKey, v) }
      const fc = isForecast(shipByOrder?.[l.orderId])
      for (const r of [p, v]) {
        r.quantity += l.qty; r.revenue += l.revenue; r.shipping += ship[i]
        if (fc) r.forecast = true
        if (l.cost != null) r.cost += l.cost; else r.missing = true
      }
    })
    const net = (r: { revenue: number; cost: number; shipping: number }) => r.revenue - r.cost - r.shipping
    return Array.from(prodMap.values()).map(p => ({
      key: p.key, title: p.title, quantity: p.quantity, revenue: p.revenue, cost: p.cost, shipping: p.shipping,
      margin: net(p), missing: p.missing, forecast: p.forecast,
      variants: Array.from(p.varMap.values()).sort((a, b) => net(b) - net(a)),
    }))
  }, [lines, netFor, shipMode, extraFor, shipByOrder])

  // ── Vue par commande : CA, achat, livraison (1 coût par commande), frais ──────
  const orderStats = useMemo(() => {
    const orders = new Map<string, { revenue: number; cost: number; items: number }>()
    for (const l of lines) {
      if (!l.orderId) continue
      const o = orders.get(l.orderId) ?? { revenue: 0, cost: 0, items: 0 }
      o.revenue += l.revenue; o.cost += l.cost ?? 0; o.items += l.qty
      orders.set(l.orderId, o)
    }
    for (const oid of freeOnlyOrders) if (!orders.has(oid)) orders.set(oid, { revenue: 0, cost: 0, items: 0 })
    const n = orders.size
    const pubPer = n > 0 && overhead ? overhead.marketing / n : 0
    const fixedPer = n > 0 && overhead ? overhead.fixed / n : 0
    type Bucket = { key: string; label: string; count: number; revenue: number; cost: number; ship: number; port: number; fees: number; forecast: number }
    const mk = (key: string, label: string): Bucket => ({ key, label, count: 0, revenue: 0, cost: 0, ship: 0, port: 0, fees: 0, forecast: 0 })
    const buckets = [mk('0', 'Articles offerts seuls'), mk('1', '1 article'), mk('2', '2 articles'), mk('3', '3 articles'), mk('4', '4 articles et plus')]
    const all = mk('all', 'Toutes les commandes')
    for (const [oid, o] of orders) {
      const b = buckets[Math.min(o.items, 4)]
      const ship = costFor(oid), port = portFor(oid), fees = o.revenue * feeRate, fc = isForecast(shipByOrder?.[oid]) ? 1 : 0
      for (const t of [b, all]) { t.count++; t.revenue += o.revenue; t.cost += o.cost; t.ship += ship; t.port += port; t.fees += fees; t.forecast += fc }
    }
    return { buckets: buckets.filter(b => b.key !== '0' || b.count > 0), all, n, pubPer, fixedPer }
  }, [lines, freeOnlyOrders, overhead, costFor, portFor, feeRate, shipByOrder])

  const totals = useMemo(() => {
    const revenue  = rows.reduce((s, r) => s + r.revenue, 0)
    const cost     = rows.reduce((s, r) => s + r.cost, 0)
    const shipping = orderStats.all.ship   // coût logisticien, toutes les commandes (même total que le tableau de bord)
    const port     = orderStats.all.port   // port payé par les clients
    const missing  = rows.filter(r => r.missing).length
    return { revenue, cost, shipping, port, margin: revenue - cost - shipping + port, missing }
  }, [rows, orderStats])

  // Charges (pub + frais fixes + transaction) réparties sur chaque ligne au prorata du CA.
  const ovhFor = useCallback((rev: number) => (
    basis === 'loaded' && overhead && totals.revenue > 0 ? overhead.total * (rev / totals.revenue) : 0
  ), [basis, overhead, totals.revenue])
  // Marge effective selon la base : contribution, ou « chargée » (nette de pub+frais).
  const effMargin = useCallback((r: { revenue: number; cost: number; shipping: number }) => (
    r.revenue - r.cost - r.shipping - ovhFor(r.revenue)
  ), [ovhFor])

  const sorted = useMemo(() => {
    const arr = [...rows]
    if (sort === 'margin')  arr.sort((a, b) => effMargin(b) - effMargin(a))
    if (sort === 'pct')     arr.sort((a, b) => pct(effMargin(b), b.revenue) - pct(effMargin(a), a.revenue))
    if (sort === 'revenue') arr.sort((a, b) => b.revenue - a.revenue)
    return arr
  }, [rows, sort, effMargin])

  // En mode « Par unité », on divise les totaux par la quantité vendue (2 décimales
  // pour la précision prix) ; en « Totaux », montants arrondis.
  const show  = (total: number, qty: number) => (view === 'unit' && qty > 0 ? total / qty : total)
  const money = (x: number) => new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR', maximumFractionDigits: view === 'unit' ? 2 : 0 }).format(x)

  function toggle(k: string) {
    setExpanded(prev => { const n = new Set(prev); if (n.has(k)) n.delete(k); else n.add(k); return n })
  }

  // ── Ce qu'il reste par produit (vendu seul / ajouté dans un colis) ─────────────
  const economics = useMemo(() => {
    if (!model) return { rows: [], thin: [] as string[], ctx: null }
    const sold: Record<string, number> = {}
    for (const l of lines) { const k = shippingKey(l.title); sold[k] = (sold[k] ?? 0) + l.qty }
    const single = orderStats.buckets.find(b => b.key === '1')
    const ctx = { pubPerOrder: orderStats.pubPer, feeRate, portAlone: single && single.count ? single.port / single.count : 0 }
    const rows: { p: ProductEconomics; alone: ReturnType<typeof aloneOutcome>; add: ReturnType<typeof addOutcomes> }[] = []
    const thin: string[] = []
    for (const m of model.products) {
      const c = catalog[m.key]
      if (!c) continue
      if (!m.used) { if (sold[m.key]) thin.push(c.title); continue }
      const p: ProductEconomics = { key: m.key, title: c.title, image: c.image, price: c.price, purchase: c.purchase, sendAlone: model.base + m.coef, addCost: Math.max(0, m.coef), sold: sold[m.key] ?? 0 }
      rows.push({ p, alone: aloneOutcome(p, ctx), add: addOutcomes(p) })
    }
    return { rows, thin, ctx }
  }, [model, catalog, lines, orderStats, feeRate])
  const takeawayItems = useMemo(() => takeaways(economics.rows, orderStats.buckets.filter(b => b.key !== '0').map(b => {
    const per = (x: number) => (b.count ? x / b.count : 0)
    return { items: Number(b.key), label: b.label, count: b.count, afterPub: per(b.revenue - b.cost - b.ship + b.port - b.fees) - orderStats.pubPer }
  })), [economics.rows, orderStats])
  const monthsLabel = model
    ? `${new Date(model.window.from).toLocaleDateString('fr-FR', { month: 'long' })} à ${new Date(model.window.to).toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' })}`
    : ''

  const shipSource = shipNote
    ? `${shipNote}.`
    : shipPerOrder > 0
      ? `Livraison estimée à ${eur(shipPerOrder)} / commande (paramétré).`
      : 'Aucun coût de livraison par commande paramétré pour cette marque (ex. Bowa = livraison en propre).'
  const forecastShare = orderStats.n > 0 ? orderStats.all.forecast / orderStats.n : 0
  const forecastTip = forecastShare > 0 ? `${Math.round(forecastShare * 100)} % des commandes ne sont pas encore facturées par le logisticien : leur coût est estimé d'après les factures des ventes de ${monthsLabel}` : undefined
  const hasShipData = !!shipByOrder
  const freeNote = freeItems > 0 ? ` ${freeItems.toLocaleString('fr-FR')} article(s) offert(s) à 0 € exclus (ni article, ni coût).` : ''


  return (
    <div className="min-h-screen bg-[#f8f7f5] pl-[72px]">
      <div className="max-w-5xl mx-auto px-6 py-8 space-y-6">

        {/* Header */}
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2">
              <Percent size={18} className="text-[#aeb0c9]" />
              <h1 className="text-xl font-bold text-[#1a1a2e]">Marges</h1>
            </div>
            <div className="inline-flex items-center bg-white rounded-xl p-0.5 gap-0.5 border border-[#e8e8e4]">
              {([['produits', 'Par produit'], ['commandes', 'Par commande']] as ['produits' | 'commandes', string][]).map(([t, lbl]) => (
                <button key={t} onClick={() => setTab(t)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${tab === t ? 'bg-[#1a1a2e] text-white' : 'text-[#6b6b63] hover:text-[#1a1a2e]'}`}>{lbl}</button>
              ))}
            </div>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <div className="inline-flex items-center bg-white rounded-xl p-0.5 gap-0.5 border border-[#e8e8e4]">
              {(['7j', '30j', 'mois'] as Period[]).map(p => (
                <button key={p} onClick={() => { setMonth(''); setPeriod(p) }}
                  className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${!month && period === p ? 'bg-[#1a1a2e] text-white' : 'text-[#6b6b63] hover:text-[#1a1a2e]'}`}>
                  {p === '7j' ? '7 jours' : p === '30j' ? '30 jours' : 'Ce mois'}
                </button>
              ))}
            </div>
            <select
              value={month}
              onChange={e => setMonth(e.target.value)}
              className={`px-3 py-2 rounded-xl bg-white border text-xs font-medium capitalize cursor-pointer ${month ? 'border-[#1a1a2e] text-[#1a1a2e]' : 'border-[#e8e8e4] text-[#6b6b63]'}`}
            >
              <option value="">Mois précis…</option>
              {monthOptions().map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </div>
        </div>

        {/* À retenir (Par commande) */}
        {tab === 'commandes' && !loading && takeawayItems.length > 0 && <TakeawayCards items={takeawayItems} />}

        {/* Totaux */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {[
            { label: 'Chiffre d\'affaires', value: eur(totals.revenue), sub: '', color: '#1a1a2e' },
            { label: 'Coût produits (COGS)', value: eur(totals.cost), sub: '', color: '#6b6b63' },
            { label: 'Livraison', value: eur(totals.shipping), sub: orderStats.n > 0 ? `${eur2(totals.shipping / orderStats.n)} / commande${totals.port > 0 ? ` · port payé ${eur(totals.port)}` : ''}` : '', color: '#6b6b63', badge: hasShipData },
            { label: 'Marge nette', value: eur(totals.margin), sub: `${pct(totals.margin, totals.revenue).toFixed(0)} % du CA`, color: '#1a7f4b' },
          ].map(c => (
            <div key={c.label} className="bg-white rounded-[16px] shadow-[0_2px_16px_rgba(0,0,0,0.06)] p-4">
              <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-[#9b9b93]">{c.label}</p>
              <p className="text-xl font-bold tabular-nums mt-1" style={{ color: c.color }}>{c.value}{'badge' in c && c.badge && <ShipBadge share={forecastShare} tip={forecastTip} />}</p>
              {c.sub && <p className="text-[11px] text-[#9b9b93] mt-0.5">{c.sub}</p>}
            </div>
          ))}
        </div>

        <p className="text-[11px] text-[#9b9b93]">
          Marge nette = CA − coût d&apos;achat − livraison + port payé par les clients. {shipSource}{freeNote}
        </p>

        {/* Résultat net de la période (précis — après pub & frais fixes) */}
        {overhead && (() => {
          const ca = totals.revenue
          const net = ca - totals.cost - totals.shipping + totals.port - overhead.total
          const lines: { label: string; value: number; sign: '−' | '+' | '' }[] = [
            { label: 'Chiffre d\'affaires', value: ca, sign: '' },
            { label: 'Port payé par les clients', value: totals.port, sign: '+' },
            { label: 'Coût produits', value: totals.cost, sign: '−' },
            { label: 'Livraison (logisticien)', value: totals.shipping, sign: '−' },
            { label: 'Publicité', value: overhead.marketing, sign: '−' },
            { label: 'Frais fixes (salaires, infra, app)', value: overhead.fixed, sign: '−' },
            { label: 'Frais de transaction', value: overhead.fees, sign: '−' },
          ]
          return (
            <div className="bg-white rounded-[20px] shadow-[0_2px_16px_rgba(0,0,0,0.06)] p-5">
              <div className="flex items-baseline justify-between mb-3">
                <p className="text-[10px] font-semibold text-[#6b6b63] uppercase tracking-[0.1em]">Résultat net de la période</p>
                <p className="text-[10px] text-[#9b9b93]">après pub &amp; frais fixes</p>
              </div>
              <div className="divide-y divide-[#f4f4f2]">
                {lines.filter(l => l.value !== 0 || l.sign === '').map(l => (
                  <div key={l.label} className="flex items-center justify-between py-1.5 text-xs">
                    <span className={l.sign ? 'text-[#6b6b63]' : 'text-[#1a1a2e] font-medium'}>{l.label}</span>
                    <span className="tabular-nums" style={{ color: l.sign === '−' ? '#9b9b93' : l.sign === '+' ? '#1a7f4b' : '#1a1a2e' }}>
                      {l.label.startsWith('Livraison') && hasShipData && <ShipBadge share={forecastShare} tip={forecastTip} />}{' '}{l.sign}{eur(l.value)}</span>
                  </div>
                ))}
                <div className="flex items-center justify-between pt-2.5 mt-1">
                  <span className="text-sm font-bold text-[#1a1a2e]">Résultat net</span>
                  <span className="text-lg font-bold tabular-nums" style={{ color: net >= 0 ? '#1a7f4b' : '#c7293a' }}>
                    {eur(net)} <span className="text-[11px] font-medium text-[#9b9b93]">· {pct(net, ca).toFixed(0)} % du CA</span>
                  </span>
                </div>
              </div>
              {partial && (
                <div className="flex items-start gap-2 rounded-xl bg-[#fffbeb] border border-[#fcd34d] px-3 py-2 text-[11px] text-[#92400e] mt-3">
                  <AlertTriangle size={13} className="shrink-0 mt-0.5" /> <span>
                    Période <b>non clôturée</b> : la pub dépensée continue de générer des ventes après (attribution ~30&nbsp;j), donc le CA de la période est incomplet et ce résultat est <b>pessimiste</b>. Pour un vrai net, choisis un <b>mois clôturé</b> dans «&nbsp;Mois précis…&nbsp;».
                  </span>
                </div>
              )}
              <p className="text-[11px] text-[#9b9b93] mt-3">
                Précis au niveau de la période. Pub et frais fixes ne sont pas rattachés à un produit ; dans le tableau, la vue «&nbsp;Chargée&nbsp;» les répartit au prorata du CA (estimation).
              </p>
            </div>
          )
        })()}

        {totals.missing > 0 && (
          <div className="flex items-center gap-2 rounded-xl bg-[#fffbeb] border border-[#fcd34d] px-3 py-2 text-[11px] text-[#92400e]">
            <AlertTriangle size={13} /> {totals.missing} produit(s) sans prix d&apos;achat complet — leur marge est surestimée. Complète les coûts dans Réappro/Produits pour fiabiliser.
          </div>
        )}

        {tab === 'commandes' ? (
          <>
          {/* ── Vendu seul : où part le prix de vente ─────────────────────────── */}
          {economics.rows.length > 0 && economics.ctx && (
            <section className="space-y-3">
              <div className="flex items-end justify-between gap-3 flex-wrap">
                <div>
                  <h2 className="text-sm font-semibold text-[#1a1a2e]">Vendu seul : ce qu&apos;il reste par commande</h2>
                  <p className="text-[11px] text-[#9b9b93] mt-0.5">Prix de vente moins l&apos;achat, l&apos;envoi, la pub ({eur2(economics.ctx.pubPerOrder)} par commande sur la période) et les frais de paiement.</p>
                </div>
                <div className="flex items-center gap-3 flex-wrap text-[10px] text-[#6b6b63]">
                  {SEGMENTS.map(sg => <span key={sg.key} className="inline-flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-sm" style={{ background: sg.color }} />{sg.label}</span>)}
                  <span className="inline-flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-sm bg-[#1a7f4b]" />Ce qu&apos;il reste</span>
                  <ShipBadge share={forecastShare} tip={forecastTip} />
                </div>
              </div>
              <div className="grid gap-3 grid-cols-1 lg:grid-cols-2">
                {[...economics.rows].sort((a, b) => a.alone.left - b.alone.left).map(r => (
                  <ProductOutcome key={r.p.key} p={r.p} o={r.alone} estimateTip={forecastTip} />
                ))}
              </div>
              {economics.thin.length > 0 && (
                <p className="text-[11px] text-[#9b9b93]">Pas assez de commandes pour estimer : {economics.thin.join(', ')}.</p>
              )}
            </section>
          )}

          {/* ── Pack : ce qu'il reste quand le produit est ajouté ─────────────── */}
          {economics.rows.length > 0 && (
            <div className="bg-white rounded-[20px] shadow-[0_2px_16px_rgba(0,0,0,0.06)] overflow-hidden pb-2">
              <div className="px-5 py-3 border-b border-[#f0f0ee] mb-1">
                <p className="text-sm font-semibold text-[#1a1a2e]">Ce produit a-t-il sa place dans le pack ?</p>
                <p className="text-[11px] text-[#9b9b93] mt-0.5">Ce qu&apos;il reste quand il est ajouté à une commande qui part déjà (pas de pub : elle est payée par le premier article). Survole une case pour le détail.</p>
              </div>
              <PackGrid rows={[...economics.rows].sort((a, b) => a.add[a.add.length - 1].left - b.add[b.add.length - 1].left)} />
            </div>
          )}

          {/* ── Colis types ───────────────────────────────────────────────────── */}
          {typical.length > 0 && (
            <section className="space-y-3">
              <div>
                <h2 className="text-sm font-semibold text-[#1a1a2e]">Colis types</h2>
                <p className="text-[11px] text-[#9b9b93] mt-0.5">Coût d&apos;envoi estimé en France, comparé au réel des commandes identiques déjà facturées.</p>
              </div>
              <TypicalBasketCards items={typical} />
            </section>
          )}

          <button onClick={() => setShowFigures(v => !v)}
            className="w-full flex items-center justify-center gap-1.5 py-2.5 rounded-xl border border-[#e8e8e4] bg-white text-xs font-semibold text-[#6b6b63] hover:text-[#1a1a2e]">
            <ChevronRight size={13} className={`transition-transform ${showFigures ? 'rotate-90' : ''}`} />
            {showFigures ? 'Masquer le détail des chiffres' : 'Voir le détail des chiffres'}
          </button>

          {showFigures && (
          /* ── Par commande, selon la taille du panier ───────────────────────── */
          <div className="bg-white rounded-[20px] shadow-[0_2px_16px_rgba(0,0,0,0.06)] overflow-hidden">
            <div className="flex items-center justify-between gap-3 flex-wrap px-5 py-3 border-b border-[#f0f0ee]">
              <div className="flex items-center gap-2">
                <p className="text-[10px] font-semibold text-[#6b6b63] uppercase tracking-[0.1em]">Par taille de panier ({orderStats.n.toLocaleString('fr-FR')} commandes)</p>
                <Toggle value={detail} onChange={setDetail} options={[['simple', 'Essentiel'], ['detail', 'Détail']]} />
                {overhead && <Toggle value={basis} onChange={setBasis} options={[['contribution', 'Avant frais fixes'], ['loaded', 'Après frais fixes']]} />}
              </div>
              <p className="text-[10px] text-[#9b9b93]">Montants moyens par commande</p>
            </div>
            {loading ? (
              <div className="p-10 text-center text-sm text-[#9b9b93]">Chargement…</div>
            ) : orderStats.n === 0 ? (
              <div className="p-10 text-center text-sm text-[#9b9b93]">Aucune commande sur la période.</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="text-[#9b9b93] border-b border-[#f0f0ee]">
                      <th className="text-left font-medium py-2 pl-4">Panier</th>
                      <th className="text-right font-medium py-2">Commandes</th>
                      {detail === 'detail' && <th className="text-right font-medium py-2">Part</th>}
                      <th className="text-right font-medium py-2">Panier moyen</th>
                      {detail === 'detail' && <th className="text-right font-medium py-2">Achat</th>}
                      <th className="text-right font-medium py-2">Livraison</th>
                      {detail === 'detail' && <th className="text-right font-medium py-2">Port payé</th>}
                      {detail === 'detail' && <th className="text-right font-medium py-2">Frais</th>}
                      {detail === 'detail' && <th className="text-right font-medium py-2">Contribution</th>}
                      {detail === 'detail' && <th className="text-right font-medium py-2">Pub</th>}
                      <th className={`text-right font-medium py-2 ${basis === 'loaded' ? '' : 'pr-4'}`}>Profit après pub</th>
                      {basis === 'loaded' && detail === 'detail' && <th className="text-right font-medium py-2">Frais fixes</th>}
                      {basis === 'loaded' && <th className="text-right font-medium py-2 pr-4">Après frais fixes</th>}
                    </tr>
                  </thead>
                  <tbody>
                    {[...orderStats.buckets, orderStats.all].map(b => {
                      const per = (x: number) => (b.count > 0 ? x / b.count : 0)
                      const contrib = per(b.revenue - b.cost - b.ship + b.port - b.fees)
                      const afterPub = contrib - orderStats.pubPer
                      const loaded = afterPub - orderStats.fixedPer
                      const isAll = b.key === 'all'
                      const color = (x: number) => (x >= 0 ? '#1a7f4b' : '#c7293a')
                      const fcShare = b.count > 0 ? b.forecast / b.count : 0
                      const fcTip = b.forecast > 0 ? `${b.forecast} commande${b.forecast > 1 ? 's' : ''} sur ${b.count} pas encore facturée${b.forecast > 1 ? 's' : ''} : coût estimé d'après les produits du colis` : undefined
                      return (
                        <tr key={b.key} className={`border-b border-[#f6f6f4] ${isAll ? 'bg-[#fafaf9] font-semibold' : ''}`}>
                          <td className="py-2.5 pl-4 text-[#1a1a2e] font-medium whitespace-nowrap">{b.label}</td>
                          <td className="text-right tabular-nums text-[#6b6b63]">{b.count.toLocaleString('fr-FR')}{detail === 'simple' && <span className="text-[10px] text-[#9b9b93] ml-1">({pct(b.count, orderStats.n).toFixed(0)} %)</span>}</td>
                          {detail === 'detail' && <td className="text-right tabular-nums text-[#9b9b93]">{pct(b.count, orderStats.n).toFixed(0)} %</td>}
                          <td className="text-right tabular-nums text-[#1a1a2e]">{eur2(per(b.revenue))}</td>
                          {detail === 'detail' && <td className="text-right tabular-nums text-[#9b9b93]">{eur2(per(b.cost))}</td>}
                          <td className="text-right tabular-nums text-[#6b6b63] whitespace-nowrap">{eur2(per(b.ship))}{hasShipData && <ShipBadge share={fcShare} tip={fcTip} />}</td>
                          {detail === 'detail' && <td className="text-right tabular-nums text-[#1a7f4b]">{b.port > 0 ? `+${eur2(per(b.port))}` : '—'}</td>}
                          {detail === 'detail' && <td className="text-right tabular-nums text-[#9b9b93]">{eur2(per(b.fees))}</td>}
                          {detail === 'detail' && <td className="text-right tabular-nums font-semibold" style={{ color: color(contrib) }}>
                            {eur2(contrib)} <span className="text-[10px] font-medium text-[#9b9b93]">{pct(contrib, per(b.revenue)).toFixed(0)} %</span>
                          </td>}
                          {detail === 'detail' && <td className="text-right tabular-nums text-[#9b9b93]">{eur2(orderStats.pubPer)}</td>}
                          <td className={`text-right tabular-nums font-semibold ${basis === 'loaded' ? '' : 'pr-4'}`} style={{ color: color(afterPub) }}>{eur2(afterPub)}</td>
                          {basis === 'loaded' && detail === 'detail' && <td className="text-right tabular-nums text-[#9b9b93]">{eur2(orderStats.fixedPer)}</td>}
                          {basis === 'loaded' && <td className="text-right tabular-nums font-semibold pr-4" style={{ color: color(loaded) }}>{eur2(loaded)}</td>}
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}
            <p className="text-[11px] text-[#9b9b93] px-5 py-3 border-t border-[#f0f0ee]">
              Taille du panier = articles payants (une ligne en quantité 2 compte pour 2 ; articles offerts à 0 € exclus). Profit après pub = CA − achat − livraison (un seul coût par commande) + port payé par le client − frais de transaction ({(feeRate * 100).toLocaleString('fr-FR')} % du CA). Pub et frais fixes = dépense de la période ÷ nombre de commandes, le même montant pour chaque commande.
            </p>
          </div>
          )}
          </>
        ) : (
        /* Tableau produits */
        <div className="bg-white rounded-[20px] shadow-[0_2px_16px_rgba(0,0,0,0.06)] overflow-hidden">
          <div className="flex items-center justify-between gap-3 flex-wrap px-5 py-3 border-b border-[#f0f0ee]">
            <div className="flex items-center gap-2 flex-wrap">
              <p className="text-[10px] font-semibold text-[#6b6b63] uppercase tracking-[0.1em]">Produits ({rows.length})</p>
              <Toggle value={view} onChange={setView} options={[['unit', 'Par unité'], ['total', 'Totaux']]} />
              {overhead && <Toggle value={basis} onChange={setBasis} options={[['contribution', 'Contribution'], ['loaded', 'Chargée']]}
                title="Contribution = CA − achat − livraison · Chargée = en plus, pub + frais fixes répartis au prorata du CA" />}
              <Toggle value={shipMode} onChange={setShipMode} options={[['prorata', 'Livr. au prorata'], ['marginal', 'Marginale']]}
                title="Au prorata : la livraison de la commande est répartie selon le CA de chaque article · Marginale : l'article principal (le plus cher) porte la livraison, chaque article en plus seulement son supplément" />
            </div>
            <div className="inline-flex items-center gap-1 text-[10px]">
              <span className="text-[#9b9b93] mr-1">Trier :</span>
              {([['margin', 'Marge €'], ['pct', 'Marge %'], ['revenue', 'CA']] as [SortKey, string][]).map(([k, lbl]) => (
                <button key={k} onClick={() => setSort(k)}
                  className={`px-2 py-0.5 rounded-md font-semibold ${sort === k ? 'bg-[#1a1a2e] text-white' : 'text-[#6b6b63] hover:bg-[#f0f0ee]'}`}>{lbl}</button>
              ))}
            </div>
          </div>
          {shipMode === 'marginal' && (
            <p className="text-[11px] text-[#6b6b63] px-5 py-2 bg-[#fafaf9] border-b border-[#f0f0ee]">
              Vue marginale : l&apos;article le plus cher de chaque commande porte la livraison ; chaque article en plus ne coûte que {model ? 'son coût d’ajout dans un colis (onglet Par commande)' : eur2(extraItem)}{model ? `, ou ${eur2(extraItem)} pour un produit sans assez de commandes pour estimer (Paramètres › Livraison)` : ' (réglable dans Paramètres › Livraison)'}. Le total de livraison ne change pas.
            </p>
          )}

          {loading ? (
            <div className="p-10 text-center text-sm text-[#9b9b93]">Chargement…</div>
          ) : rows.length === 0 ? (
            <div className="p-10 text-center text-sm text-[#9b9b93]">Aucune vente sur la période.</div>
          ) : (
            <table className="w-full text-xs">
              <thead>
                <tr className="text-[#9b9b93] border-b border-[#f0f0ee]">
                  <th className="text-left font-medium py-2 pl-4">Produit</th>
                  <th className="text-right font-medium py-2">Qté</th>
                  <th className="text-right font-medium py-2">{view === 'unit' ? 'Prix vente u.' : 'CA'}</th>
                  <th className="text-right font-medium py-2">{view === 'unit' ? 'Achat u.' : 'Coût'}</th>
                  <th className="text-right font-medium py-2" title="Livraison nette du port payé par le client">{view === 'unit' ? 'Livr. nette u.' : 'Livr. nette'}</th>
                  {basis === 'loaded' && <th className="text-right font-medium py-2">{view === 'unit' ? 'Pub+frais u.' : 'Pub+frais'}</th>}
                  <th className="text-right font-medium py-2">{view === 'unit' ? 'Marge u.' : basis === 'loaded' ? 'Marge chargée' : 'Marge nette'}</th>
                  <th className="text-right font-medium py-2 pr-4">%</th>
                </tr>
              </thead>
              <tbody>
                {sorted.map(p => {
                  const open = expanded.has(p.key)
                  const p_ovh = ovhFor(p.revenue)
                  const p_margin = p.margin - p_ovh
                  const p_pct = pct(p_margin, p.revenue)
                  return (
                    <Fragment key={p.key}>
                      <tr onClick={() => p.variants.length > 1 && toggle(p.key)}
                        className={`border-b border-[#f6f6f4] ${p.variants.length > 1 ? 'cursor-pointer hover:bg-[#fafafa]' : ''}`}>
                        <td className="py-2.5 pl-4">
                          <div className="flex items-center gap-1.5">
                            {p.variants.length > 1
                              ? <ChevronRight size={13} className={`text-[#aeb0c9] transition-transform ${open ? 'rotate-90' : ''}`} />
                              : <span className="w-[13px]" />}
                            <span className="font-medium text-[#1a1a2e] truncate max-w-[240px]">{p.title}</span>
                            {p.missing && <AlertTriangle size={11} className="text-[#b45309] shrink-0" />}
                          </div>
                        </td>
                        <td className="text-right tabular-nums text-[#6b6b63]">{p.quantity.toLocaleString('fr-FR')}</td>
                        <td className="text-right tabular-nums text-[#1a1a2e]">{money(show(p.revenue, p.quantity))}</td>
                        <td className="text-right tabular-nums text-[#9b9b93]">{money(show(p.cost, p.quantity))}</td>
                        <td className="text-right tabular-nums text-[#9b9b93] whitespace-nowrap">{p.shipping !== 0 ? money(show(p.shipping, p.quantity)) : '—'}</td>
                        {basis === 'loaded' && <td className="text-right tabular-nums text-[#9b9b93]">{p_ovh > 0 ? money(show(p_ovh, p.quantity)) : '—'}</td>}
                        <td className="text-right tabular-nums font-semibold" style={{ color: p_margin >= 0 ? '#1a7f4b' : '#c7293a' }}>{money(show(p_margin, p.quantity))}</td>
                        <td className="text-right tabular-nums font-semibold pr-4" style={{ color: p_pct >= 50 ? '#1a7f4b' : p_pct >= 25 ? '#b45309' : '#c7293a' }}>{p_pct.toFixed(0)}%</td>
                      </tr>
                      {open && p.variants.map(v => {
                        const v_ovh = ovhFor(v.revenue)
                        const v_net = v.revenue - v.cost - v.shipping - v_ovh
                        const v_pct = pct(v_net, v.revenue)
                        return (
                          <tr key={p.key + v.key} className="border-b border-[#f6f6f4] bg-[#fbfbfa]">
                            <td className="py-1.5 pl-11 text-[#6b6b63] truncate max-w-[240px]">{v.variant_title}{v.missing && <AlertTriangle size={10} className="inline ml-1 text-[#b45309]" />}</td>
                            <td className="text-right tabular-nums text-[#9b9b93]">{v.quantity.toLocaleString('fr-FR')}</td>
                            <td className="text-right tabular-nums text-[#6b6b63]">{money(show(v.revenue, v.quantity))}</td>
                            <td className="text-right tabular-nums text-[#b0b0a8]">{money(show(v.cost, v.quantity))}</td>
                            <td className="text-right tabular-nums text-[#b0b0a8]">{v.shipping !== 0 ? money(show(v.shipping, v.quantity)) : '—'}</td>
                            {basis === 'loaded' && <td className="text-right tabular-nums text-[#b0b0a8]">{v_ovh > 0 ? money(show(v_ovh, v.quantity)) : '—'}</td>}
                            <td className="text-right tabular-nums" style={{ color: v_net >= 0 ? '#1a7f4b' : '#c7293a' }}>{money(show(v_net, v.quantity))}</td>
                            <td className="text-right tabular-nums pr-4 text-[#9b9b93]">{v_pct.toFixed(0)}%</td>
                          </tr>
                        )
                      })}
                    </Fragment>
                  )
                })}
              </tbody>
            </table>
          )}
        </div>
        )}

        {/* ── Coût de livraison par produit (onglet Par commande) ────────────── */}
        {tab === 'commandes' && showFigures && model && (() => {
          const reliable = model.products.filter(p => p.used)
          const thin = model.products.filter(p => !p.used)
          const alone = [...reliable].sort((a, b) => (a.coef) - (b.coef))
          const card = 'bg-white rounded-[20px] shadow-[0_2px_16px_rgba(0,0,0,0.06)] overflow-hidden'
          const head = (title: string, sub: string) => (
            <div className="px-5 py-3 border-b border-[#f0f0ee]">
              <p className="text-sm font-semibold text-[#1a1a2e]">{title}</p>
              <p className="text-[11px] text-[#9b9b93] mt-0.5">{sub}</p>
            </div>
          )
          return (
            <>
              <div className="grid gap-4 md:grid-cols-2">
                <div className={card}>
                  {head('Coût d’envoi d’un produit seul', 'Colis envoyé en France avec ce seul produit (attaches offertes comprises).')}
                  <table className="w-full text-xs">
                    <tbody>
                      {alone.map(p => (
                        <tr key={p.key} className="border-b border-[#f6f6f4]">
                          <td className="py-2 pl-5 text-[#1a1a2e]">{shortTitle(p.title)}</td>
                          <td className="text-right tabular-nums text-[10px] text-[#9b9b93]" title="Commandes facturées qui ont servi au calcul">{p.orders} cmd</td>
                          <td className="text-right tabular-nums font-semibold text-[#1a1a2e] pr-5">{eur2(model.base + p.coef)}</td>
                        </tr>
                      ))}
                      {thin.length > 0 && (
                        <>
                          <tr className="border-b border-[#f6f6f4] cursor-pointer hover:bg-[#fafafa]" onClick={() => setShowThin(v => !v)}>
                            <td colSpan={3} className="py-2 pl-5 text-[#9b9b93]">
                              <ChevronRight size={12} className={`inline mr-1 transition-transform ${showThin ? 'rotate-90' : ''}`} />
                              Pas assez de commandes pour estimer ({thin.length} produit{thin.length > 1 ? 's' : ''})
                            </td>
                          </tr>
                          {showThin && thin.map(p => (
                            <tr key={p.key} className="border-b border-[#f6f6f4] bg-[#fbfbfa]">
                              <td className="py-1.5 pl-9 text-[#6b6b63]">{shortTitle(p.title)}</td>
                              <td className="text-right tabular-nums text-[10px] text-[#9b9b93]">{p.orders} cmd</td>
                              <td className="text-right text-[10px] text-[#9b9b93] pr-5">estimation moins précise</td>
                            </tr>
                          ))}
                        </>
                      )}
                    </tbody>
                  </table>
                </div>
                <div className={card}>
                  {head('Coût d’ajout dans un colis', 'Ce que coûte un produit ajouté à une commande qui part déjà.')}
                  <table className="w-full text-xs">
                    <tbody>
                      {alone.map(p => (
                        <tr key={p.key} className="border-b border-[#f6f6f4]">
                          <td className="py-2 pl-5 text-[#1a1a2e]">{shortTitle(p.title)}</td>
                          <td className="text-right tabular-nums font-semibold text-[#1a1a2e] pr-5">+ {eur2(Math.max(0, p.coef))}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  <p className="px-5 py-2.5 text-[11px] text-[#9b9b93]">
                    Un colis coûte {eur2(model.base)} de départ{model.intlExtra > 0 ? ` (${eur2(model.base + model.intlExtra)} hors France)` : ''}, plus le coût d&apos;ajout de chaque produit.
                  </p>
                </div>
              </div>

              {typical.length > 0 && (
                <div className={card}>
                  {head('Colis types', 'Coût de livraison estimé en France, et coût réel moyen des commandes identiques déjà facturées.')}
                  <div className="overflow-x-auto">
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="text-[#9b9b93] border-b border-[#f0f0ee]">
                          <th className="text-left font-medium py-2 pl-5">Colis</th>
                          <th className="text-right font-medium py-2">Estimé</th>
                          <th className="text-right font-medium py-2 pr-5">Réel constaté</th>
                        </tr>
                      </thead>
                      <tbody>
                        {typical.map(t => (
                          <tr key={t.label} className="border-b border-[#f6f6f4]">
                            <td className="py-2 pl-5 text-[#1a1a2e]">
                              {t.label}
                              {t.frequent != null && <span className="text-[10px] text-[#9b9b93] ml-1.5">{t.frequent} commandes sur la période</span>}
                            </td>
                            <td className="text-right tabular-nums font-semibold text-[#1a1a2e]">{eur2(t.predicted)}</td>
                            <td className="text-right tabular-nums pr-5">
                              {t.real != null
                                ? <span className="text-[#6b6b63]">{eur2(t.real)} <span className="text-[10px] text-[#9b9b93]">({t.realOrders} cmd)</span></span>
                                : <span className="text-[10px] text-[#9b9b93]">aucune commande identique</span>}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
              <p className="text-[11px] text-[#9b9b93]">
                Ces coûts sont calculés à partir de {model.orders.toLocaleString('fr-FR')} commandes facturées par le logisticien (ventes du {new Date(model.window.from).toLocaleDateString('fr-FR')} au {new Date(model.window.to).toLocaleDateString('fr-FR')}). Ils servent à estimer les commandes pas encore facturées ; leur fiabilité est vérifiée chaque mois dans Coûts logisticien › Livraison estimée.
              </p>
            </>
          )
        })()}
      </div>
    </div>
  )
}
