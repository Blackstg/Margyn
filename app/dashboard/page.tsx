'use client'

export const dynamic = 'force-dynamic'

import { Suspense } from 'react'
import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import { useSearchParams, useRouter, usePathname } from 'next/navigation'
import { createClient } from '@supabase/supabase-js'
import SnapshotBanner, { type SnapshotData } from '@/components/dashboard/SnapshotBanner'
import KpiGrid, { type KpiData, type SparklineData } from '@/components/dashboard/KpiGrid'
import { type SpendByPlatform } from '@/components/dashboard/SpendBreakdown'
import { type RoasPoint } from '@/components/dashboard/RoasChart'
import AdPanel from '@/components/dashboard/AdPanel'
import ProductsView, { type BestSeller, type InventoryItem } from '@/components/dashboard/ProductsView'
import AnnualChart, { type MonthPoint } from '@/components/dashboard/AnnualChart'
import AiInsights from '@/components/dashboard/AiInsights'

// ─── Types ────────────────────────────────────────────────────────────────────

type Brand = 'bowa' | 'moom'
type Period = '7j' | '30j' | 'mois'

// ─── Supabase client ──────────────────────────────────────────────────────────

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
)

// ─── Date helpers ─────────────────────────────────────────────────────────────

function fmt(d: Date): string {
  return d.toISOString().slice(0, 10)
}

function getYesterday(): string {
  const d = new Date()
  d.setDate(d.getDate() - 1)
  return fmt(d)
}

function getRange(period: Period): { from: string; to: string; prevFrom: string; prevTo: string; days: number } {
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const to = new Date(today)
  to.setDate(to.getDate() - 1)

  let from: Date
  if (period === '7j') {
    from = new Date(to); from.setDate(from.getDate() - 6)
  } else if (period === '30j') {
    from = new Date(to); from.setDate(from.getDate() - 29)
  } else {
    from = new Date(today.getFullYear(), today.getMonth(), 1)
  }

  const days = Math.round((to.getTime() - from.getTime()) / 86_400_000) + 1
  const prevTo = new Date(from); prevTo.setDate(prevTo.getDate() - 1)
  const prevFrom = new Date(prevTo); prevFrom.setDate(prevFrom.getDate() - days + 1)

  return { from: fmt(from), to: fmt(to), prevFrom: fmt(prevFrom), prevTo: fmt(prevTo), days }
}

function brandFilter(brand: Brand): string[] {
  return [brand]
}

// ─── Data helpers ─────────────────────────────────────────────────────────────

interface SnapshotRow {
  total_sales?: number | null
  gross_profit?: number | null
  order_count?: number | null
  cogs?: number | null
  fulfillment_cost?: number | null
  returns?: number | null
}

type SnapshotAgg = Omit<KpiData, 'marketing' | 'op_expenses' | 'net_profit' | 'transaction_fees' | 'app_charges'>

function sumSnapshots(rows: SnapshotRow[]): SnapshotAgg {
  return rows.reduce<SnapshotAgg>(
    (acc, r) => ({
      total_sales:  acc.total_sales  + (r.total_sales      ?? 0),
      gross_profit: acc.gross_profit + (r.gross_profit     ?? 0),
      order_count:  acc.order_count  + (r.order_count      ?? 0),
      cogs:         acc.cogs         + (r.cogs             ?? 0),
      fulfillment:  acc.fulfillment  + (r.fulfillment_cost ?? 0),
      returns:      acc.returns      + (r.returns          ?? 0),
    }),
    { total_sales: 0, gross_profit: 0, order_count: 0, cogs: 0, fulfillment: 0, returns: 0 }
  )
}

// ─── Fetchers ─────────────────────────────────────────────────────────────────

async function fetchSnapshotData(brand: Brand, date: string): Promise<SnapshotData | null> {
  const brands = brandFilter(brand)

  // Fetch campaigns for this brand to aggregate campaign_stats spend
  const { data: campaignMeta } = await supabase
    .from('campaigns').select('id').eq('brand', brand)
  const campaignIds = (campaignMeta ?? []).map((c) => c.id)

  const [snapshotsRes, spendRes, campaignStatsRes] = await Promise.all([
    supabase.from('daily_snapshots').select('total_sales, order_count, gross_profit, cogs')
      .eq('date', date).in('brand', brands),
    supabase.from('ad_spends').select('spend').eq('date', date).in('brand', brands),
    campaignIds.length > 0
      ? supabase.from('campaign_stats').select('spend').eq('date', date).in('campaign_id', campaignIds)
      : Promise.resolve({ data: [] }),
  ])

  const snap = (snapshotsRes.data ?? []).reduce(
    (acc, r) => ({
      total_sales:  acc.total_sales  + (r.total_sales  ?? 0),
      order_count:  acc.order_count  + (r.order_count  ?? 0),
      gross_profit: acc.gross_profit + (r.gross_profit ?? 0),
      cogs:         acc.cogs         + (r.cogs         ?? 0),
    }),
    { total_sales: 0, order_count: 0, gross_profit: 0, cogs: 0 }
  )

  // Use campaign_stats as source of truth for spend (more granular than ad_spends)
  const spendFromCampaigns = ((campaignStatsRes as { data: { spend?: number | null }[] | null }).data ?? [])
    .reduce((s, r) => s + (r.spend ?? 0), 0)
  const spendFromAdSpends = (spendRes.data ?? []).reduce(
    (s: number, r: { spend?: number | null }) => s + (r.spend ?? 0), 0
  )
  const spend = Math.max(spendFromCampaigns, spendFromAdSpends)

  // Return null only if there's truly nothing — no sales AND no spend
  if (snap.total_sales === 0 && spend === 0) return null

  return { ...snap, spend }
}

async function fetchKpiData(brand: Brand, from: string, to: string, days: number): Promise<KpiData> {
  const brands = brandFilter(brand)
  const suppQuery = brand === 'bowa'
    ? supabase.from('supplementary_revenue').select('source, amount, month')
        .gte('month', from.slice(0, 7) + '-01')
        .lte('month', new Date().toISOString().slice(0, 7) + '-01')
        .eq('brand', 'bowa')
    : Promise.resolve({ data: [] })

  const [snapshotsRes, marketingRes, fixedCostsRes, settingsRes, suppRes] = await Promise.all([
    supabase.from('daily_snapshots').select('total_sales, gross_profit, order_count, cogs, fulfillment_cost, returns')
      .gte('date', from).lte('date', to).in('brand', brands),
    supabase.from('ad_spends').select('spend')
      .gte('date', from).lte('date', to).in('brand', brands),
    supabase.from('fixed_costs').select('amount, month, category')
      .gte('month', from.slice(0, 7) + '-01')
      .lte('month', new Date().toISOString().slice(0, 7) + '-01')  // always include current month
      .eq('brand', brand),
    supabase.from('brand_settings').select('shipping_cost_per_order, transaction_fee_rate').eq('brand', brand).single(),
    suppQuery,
  ])

  const snaps = sumSnapshots(snapshotsRes.data ?? [])
  const marketing = (marketingRes.data ?? []).reduce(
    (s: number, r: { spend?: number | null }) => s + (r.spend ?? 0), 0
  )

  // Group fixed costs by month + category, then prorate
  type FixedRow = { amount?: number | null; month: string; category?: string | null }
  const byMonthApp = new Map<string, number>()
  const byMonthOther = new Map<string, number>()
  for (const r of (fixedCostsRes.data ?? []) as FixedRow[]) {
    const month = r.month.slice(0, 7)
    const amount = r.amount ?? 0
    if (r.category === 'app') {
      byMonthApp.set(month, (byMonthApp.get(month) ?? 0) + amount)
    } else {
      byMonthOther.set(month, (byMonthOther.get(month) ?? 0) + amount)
    }
  }
  const avgOf = (map: Map<string, number>) => {
    const vals = Array.from(map.values())
    return vals.length > 0 ? vals.reduce((a, b) => a + b, 0) / vals.length : 0
  }
  const app_charges  = Math.round(avgOf(byMonthApp)   * (days / 30.44))
  const op_expenses  = Math.round(avgOf(byMonthOther)  * (days / 30.44))

  const settingsData = (settingsRes.data as { shipping_cost_per_order?: number; transaction_fee_rate?: number } | null)
  const shippingRate       = settingsData?.shipping_cost_per_order ?? 17
  const transactionFeeRate = settingsData?.transaction_fee_rate    ?? 0.017
  const fulfillment        = Math.round(shippingRate * snaps.order_count)
  const transaction_fees   = Math.round(snaps.total_sales * transactionFeeRate)

  // Supplementary revenue (Bowa only) — prorate same as fixed costs
  type SuppRow = { source: string; amount?: number | null; month: string }
  const bySourceByMonth = new Map<string, Map<string, number>>()
  for (const r of ((suppRes as { data: SuppRow[] | null }).data ?? []) as SuppRow[]) {
    const month = r.month.slice(0, 7)
    const src = r.source
    if (!bySourceByMonth.has(src)) bySourceByMonth.set(src, new Map())
    const srcMap = bySourceByMonth.get(src)!
    srcMap.set(month, (srcMap.get(month) ?? 0) + (r.amount ?? 0))
  }
  const supplementary_breakdown = Array.from(bySourceByMonth.entries()).map(([source, monthMap]) => ({
    source,
    amount: Math.round(avgOf(monthMap) * (days / 30.44)),
  })).filter(i => i.amount > 0)
  const supplementary_ca = supplementary_breakdown.reduce((s, i) => s + i.amount, 0)

  return {
    ...snaps, fulfillment, marketing, op_expenses, app_charges, transaction_fees, net_profit: null,
    ...(brand === 'bowa' && supplementary_ca > 0 ? { supplementary_ca, supplementary_breakdown } : {}),
  }
}

async function fetchSpendBreakdown(brand: Brand, from: string, to: string): Promise<SpendByPlatform[]> {
  const { data } = await supabase
    .from('ad_spends').select('platform, spend, revenue, impressions, clicks, conversions')
    .gte('date', from).lte('date', to).in('brand', brandFilter(brand)).limit(5000)

  const byPlatform = new Map<string, SpendByPlatform>()
  for (const r of data ?? []) {
    const prev = byPlatform.get(r.platform) ?? { platform: r.platform, spend: 0, revenue: 0, impressions: 0, clicks: 0, conversions: 0 }
    byPlatform.set(r.platform, {
      platform:    r.platform,
      spend:       prev.spend       + (r.spend       ?? 0),
      revenue:     prev.revenue     + (r.revenue     ?? 0),
      impressions: prev.impressions + (r.impressions  ?? 0),
      clicks:      prev.clicks      + (r.clicks       ?? 0),
      conversions: prev.conversions + (r.conversions  ?? 0),
    })
  }
  return Array.from(byPlatform.values()).sort((a, b) => b.spend - a.spend)
}


async function fetchRoasData(
  brand: Brand,
  from: string,
  to: string
): Promise<{ points: RoasPoint[]; activePlatforms: string[] }> {
  const { data } = await supabase
    .from('ad_spends')
    .select('date, platform, spend, revenue')
    .gte('date', from)
    .lte('date', to)
    .in('brand', brandFilter(brand))
    .gt('spend', 0)

  const byDate = new Map<string, Map<string, number>>()
  const activePlatformsSet = new Set<string>()

  for (const r of data ?? []) {
    if (!r.spend || r.spend <= 0) continue
    const roas = Math.round(((r.revenue ?? 0) / r.spend) * 100) / 100
    if (!byDate.has(r.date)) byDate.set(r.date, new Map())
    byDate.get(r.date)!.set(r.platform, roas)
    activePlatformsSet.add(r.platform)
  }

  const activePlatforms = Array.from(activePlatformsSet)
  const points: RoasPoint[] = []
  const d = new Date(from)
  const end = new Date(to)
  while (d <= end) {
    const dateStr = fmt(d)
    const label = d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' }).replace('.', '')
    const platformMap = byDate.get(dateStr)
    const point: RoasPoint = { date: dateStr, label }
    for (const platform of activePlatforms) {
      point[platform] = platformMap?.get(platform) ?? null
    }
    points.push(point)
    d.setDate(d.getDate() + 1)
  }

  return { points, activePlatforms }
}

async function fetchBestSellers(brand: Brand, from: string, to: string): Promise<BestSeller[]> {
  const [salesRes, productsRes] = await Promise.all([
    supabase
      .from('product_sales')
      .select('product_title, quantity, revenue')
      .eq('brand', brand)
      .gte('date', from)
      .lte('date', to)
      .limit(10000),
    supabase
      .from('products')
      .select('title, image_url')
      .eq('brand', brand),
  ])

  const imageByTitle = new Map<string, string | null>()
  for (const p of productsRes.data ?? []) imageByTitle.set(p.title, p.image_url ?? null)

  const byTitle = new Map<string, { quantity: number; revenue: number }>()
  for (const r of salesRes.data ?? []) {
    const prev = byTitle.get(r.product_title) ?? { quantity: 0, revenue: 0 }
    byTitle.set(r.product_title, {
      quantity: prev.quantity + (r.quantity ?? 0),
      revenue:  prev.revenue  + (r.revenue  ?? 0),
    })
  }

  const totalRevenue = Array.from(byTitle.values()).reduce((s, v) => s + v.revenue, 0)

  return Array.from(byTitle.entries())
    .map(([title, v]) => ({
      title,
      quantity: v.quantity,
      revenue: Math.round(v.revenue * 100) / 100,
      revenuePct: totalRevenue > 0 ? (v.revenue / totalRevenue) * 100 : 0,
      image_url: imageByTitle.get(title) ?? null,
    }))
    .sort((a, b) => b.quantity - a.quantity)
    .slice(0, 6)
}

async function fetchInventory(brand: Brand): Promise<InventoryItem[]> {
  const { data } = await supabase
    .from('products')
    .select('title, stock_quantity, sell_price, stock_alert_threshold, image_url')
    .eq('brand', brand)
    .order('stock_quantity', { ascending: true })

  return (data ?? []) as InventoryItem[]
}

async function fetchSparklines(brand: Brand, from: string, to: string): Promise<SparklineData> {
  const { data } = await supabase
    .from('daily_snapshots')
    .select('date, total_sales, gross_profit')
    .gte('date', from).lte('date', to)
    .in('brand', brandFilter(brand))
    .order('date', { ascending: true })

  const byDate = new Map<string, { sales: number; gross: number }>()
  for (const r of data ?? []) {
    const prev = byDate.get(r.date) ?? { sales: 0, gross: 0 }
    byDate.set(r.date, {
      sales: prev.sales + (r.total_sales  ?? 0),
      gross: prev.gross + (r.gross_profit ?? 0),
    })
  }

  const sales: number[] = []
  const gross: number[] = []
  const d = new Date(from + 'T00:00:00')
  const end = new Date(to + 'T00:00:00')
  while (d <= end) {
    const key = d.toISOString().slice(0, 10)
    const v   = byDate.get(key) ?? { sales: 0, gross: 0 }
    const tva = brand === 'bowa' ? Math.round(v.sales / 6) : 0
    sales.push(v.sales - tva)
    gross.push(v.gross - tva)
    d.setDate(d.getDate() + 1)
  }
  return { sales, gross }
}

async function fetchAnnualData(brand: Brand, year: number): Promise<MonthPoint[]> {
  const from = `${year}-01-01`
  const to   = `${year}-12-31`
  const brands = brandFilter(brand)

  const [snapshotsRes, marketingRes, fixedCostsRes, settingsRes] = await Promise.all([
    supabase.from('daily_snapshots')
      .select('date, total_sales, gross_profit, order_count')
      .gte('date', from).lte('date', to).in('brand', brands),
    supabase.from('ad_spends')
      .select('date, spend')
      .gte('date', from).lte('date', to).in('brand', brands),
    supabase.from('fixed_costs')
      .select('month, amount, category')
      .gte('month', `${year}-01-01`).lte('month', `${year}-12-01`)
      .eq('brand', brand),
    supabase.from('brand_settings')
      .select('shipping_cost_per_order, transaction_fee_rate')
      .eq('brand', brand).single(),
  ])

  type MonthAgg = { ca: number; gross_profit: number; order_count: number; marketing: number }
  const byMonth = new Map<number, MonthAgg>()

  for (const r of snapshotsRes.data ?? []) {
    const m = new Date(r.date + 'T00:00:00').getMonth() + 1
    const prev = byMonth.get(m) ?? { ca: 0, gross_profit: 0, order_count: 0, marketing: 0 }
    byMonth.set(m, {
      ...prev,
      ca:           prev.ca           + (r.total_sales  ?? 0),
      gross_profit: prev.gross_profit + (r.gross_profit ?? 0),
      order_count:  prev.order_count  + (r.order_count  ?? 0),
    })
  }
  for (const r of marketingRes.data ?? []) {
    const m = new Date(r.date + 'T00:00:00').getMonth() + 1
    const prev = byMonth.get(m) ?? { ca: 0, gross_profit: 0, order_count: 0, marketing: 0 }
    byMonth.set(m, { ...prev, marketing: prev.marketing + (r.spend ?? 0) })
  }

  type FixedRow = { month: string; amount?: number | null; category?: string | null }
  const fixedByMonth = new Map<number, { app: number; other: number }>()
  for (const r of (fixedCostsRes.data ?? []) as FixedRow[]) {
    const m = new Date(r.month + 'T00:00:00').getMonth() + 1
    const prev = fixedByMonth.get(m) ?? { app: 0, other: 0 }
    const amount = r.amount ?? 0
    fixedByMonth.set(m, r.category === 'app'
      ? { ...prev, app: prev.app + amount }
      : { ...prev, other: prev.other + amount })
  }

  const settingsData = (settingsRes.data as { shipping_cost_per_order?: number; transaction_fee_rate?: number } | null)
  const shippingRate = settingsData?.shipping_cost_per_order ?? 17
  const feeRate      = settingsData?.transaction_fee_rate    ?? 0.017

  const today = new Date()
  const currentYear  = today.getFullYear()
  const currentMonth = today.getMonth() + 1

  const LABELS = ['Jan', 'Fév', 'Mar', 'Avr', 'Mai', 'Jun', 'Jul', 'Aoû', 'Sep', 'Oct', 'Nov', 'Déc']

  return Array.from({ length: 12 }, (_, i) => {
    const month = i + 1
    const d     = byMonth.get(month) ?? { ca: 0, gross_profit: 0, order_count: 0, marketing: 0 }
    const fixed = fixedByMonth.get(month) ?? { app: 0, other: 0 }

    // Bowa: total_sales is TTC → convert to HT (× 5/6)
    const tva          = brand === 'bowa' ? Math.round(d.ca / 6) : 0
    const caHT         = d.ca - tva
    const grossProfitHT = d.gross_profit - tva

    const fulfillment      = Math.round(shippingRate * d.order_count)
    const transaction_fees = Math.round(caHT * feeRate)
    const net_margin = grossProfitHT - d.marketing - fulfillment - transaction_fees - fixed.app - fixed.other
    const isFuture = year > currentYear || (year === currentYear && month > currentMonth)
    return { month, label: LABELS[i], ca: caHT, net_margin: Math.round(net_margin), isFuture, ca_prev: 0, net_margin_prev: 0 }
  })
}

async function fetchExclusions(brand: Brand): Promise<string[]> {
  const { data } = await supabase
    .from('product_exclusions')
    .select('product_title')
    .eq('brand', brand)
  return (data ?? []).map((r) => r.product_title)
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function Page() {
  return (
    <Suspense>
      <DashboardPage />
    </Suspense>
  )
}

function DashboardPage() {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()

  // URL ↔ internal period mapping
  function urlToPeriod(p: string | null): Period {
    if (p === '30d')   return '30j'
    if (p === 'month') return 'mois'
    return '7j'
  }
  function periodToUrl(p: Period): string {
    if (p === '30j')  return '30d'
    if (p === 'mois') return 'month'
    return '7d'
  }

  const [brand, setBrandState] = useState<Brand>(() => {
    const b = searchParams.get('brand')
    return b === 'moom' ? 'moom' : 'bowa'
  })
  const [period, setPeriodState] = useState<Period>(() =>
    urlToPeriod(searchParams.get('period'))
  )

  function setBrand(b: Brand) {
    setBrandState(b)
    const params = new URLSearchParams()
    params.set('brand', b)
    params.set('period', periodToUrl(period))
    router.replace(`${pathname}?${params.toString()}`)
  }

  function setPeriod(p: Period) {
    setPeriodState(p)
    const params = new URLSearchParams()
    params.set('brand', brand)
    params.set('period', periodToUrl(p))
    router.replace(`${pathname}?${params.toString()}`)
  }

  const [snapshot, setSnapshot]                   = useState<SnapshotData | null>(null)
  const [current, setCurrent]                     = useState<KpiData | null>(null)
  const [previous, setPrevious]                   = useState<KpiData | null>(null)
  const [spendBreakdown, setSpendBreakdown]       = useState<SpendByPlatform[]>([])
  const [roasData, setRoasData]                   = useState<RoasPoint[]>([])
  const [roasActivePlatforms, setRoasActivePlatforms] = useState<string[]>([])
  const [bestSellers, setBestSellers]             = useState<BestSeller[]>([])
  const [inventory, setInventory]                 = useState<InventoryItem[]>([])
  const [exclusions, setExclusions]               = useState<string[]>([])
  const [stockThreshold, setStockThreshold]       = useState(20)
  const [loading, setLoading]                     = useState(true)
  const [sparklines, setSparklines]               = useState<SparklineData>({ sales: [], gross: [] })
  const [syncing, setSyncing]                     = useState(false)
  const [syncDone, setSyncDone]                   = useState(false)
  const syncAttempted                             = useRef<Set<string>>(new Set())
  const [annualData, setAnnualData]               = useState<MonthPoint[]>([])
  const [annualLoading, setAnnualLoading]         = useState(true)

  const yesterday = getYesterday()

  const load = useCallback(async () => {
    setLoading(true)
    const { from, to, prevFrom, prevTo, days } = getRange(period)
    const [snap, curr, prev, breakdown, roas, sellers, inv, excl, sparks] = await Promise.all([
      fetchSnapshotData(brand, yesterday),
      fetchKpiData(brand, from, to, days),
      fetchKpiData(brand, prevFrom, prevTo, days),
      fetchSpendBreakdown(brand, from, to),
      fetchRoasData(brand, from, to),
      fetchBestSellers(brand, from, to),
      fetchInventory(brand),
      fetchExclusions(brand),
      fetchSparklines(brand, from, to),
    ])
    setSnapshot(snap)
    setCurrent(curr)
    setPrevious(prev)
    setSpendBreakdown(breakdown)
    setRoasData(roas.points)
    setRoasActivePlatforms(roas.activePlatforms)
    setBestSellers(sellers)
    setInventory(inv)
    setExclusions(excl)
    setSparklines(sparks)
    setLoading(false)
  }, [brand, period, yesterday])

  useEffect(() => { load() }, [load])

  // Auto-sync once when yesterday's snapshot is missing — 1 attempt per brand+date
  useEffect(() => {
    if (loading || snapshot !== null) return
    const key = `${brand}-${yesterday}`
    if (syncAttempted.current.has(key)) { setSyncDone(true); return }
    syncAttempted.current.add(key)
    setSyncing(true)
    setSyncDone(false)
    fetch(`/api/sync-all?brand=${brand}`, { method: 'POST' })
      .catch(() => {})
      .finally(() => { setSyncing(false); setSyncDone(true); load() })
  }, [loading, snapshot, brand, yesterday, load])

  // Reset syncDone when brand/period changes
  useEffect(() => { setSyncDone(false) }, [brand, period])

  useEffect(() => {
    setAnnualLoading(true)
    const currentYear = new Date().getFullYear()
    Promise.all([
      fetchAnnualData(brand, currentYear),
      fetchAnnualData(brand, currentYear - 1),
    ]).then(([curr, prev]) => {
      const merged = curr.map((m, i) => ({
        ...m,
        ca_prev:         prev[i].ca,
        net_margin_prev: prev[i].net_margin,
      }))
      setAnnualData(merged)
      setAnnualLoading(false)
    })
  }, [brand])

  useEffect(() => {
    try {
      const raw = localStorage.getItem('steero_config')
      if (raw) {
        const config = JSON.parse(raw)
        if (typeof config.stockThreshold === 'number') {
          setStockThreshold(config.stockThreshold)
        }
      }
    } catch {
      // ignore
    }
  }, [])

  const brandTabs: { id: Brand; label: string }[] = [
    { id: 'bowa', label: 'Bowa' },
    { id: 'moom', label: 'Mōom' },
  ]

  const periodTabs: { id: Period; label: string }[] = [
    { id: '7j',   label: '7 j'    },
    { id: '30j',  label: '30 j'   },
    { id: 'mois', label: 'Ce mois' },
  ]

  const periodLabel = { '7j': '7 derniers jours', '30j': '30 derniers jours', mois: 'Ce mois' }[period]
  const chartLabel  = { '7j': '7 jours', '30j': '30 jours', mois: 'Ce mois' }[period]

  const aiContext = useMemo(() => {
    if (!current || loading) return null
    const totalSpend = spendBreakdown.reduce((s, p) => s + p.spend, 0)
    const totalRevenue = spendBreakdown.reduce((s, p) => s + p.revenue, 0)
    const roas = totalSpend > 0 ? (totalRevenue / totalSpend).toFixed(2) : 'N/A'
    const topSellers = bestSellers.slice(0, 5).map((b) => `${b.title} (${b.quantity} ventes, ${b.revenue.toFixed(0)}€)`).join(', ')
    const lowStock = inventory.filter((i) => i.stock_quantity < 20 && !exclusions.includes(i.title)).slice(0, 5).map((i) => `${i.title} (stock: ${i.stock_quantity})`).join(', ')
    const platformSummary = spendBreakdown.map((p) => `${p.platform}: ${p.spend.toFixed(0)}€ dépensés, ROAS ${p.spend > 0 ? (p.revenue / p.spend).toFixed(2) : '0'}`).join(' | ')
    return `Marque: ${brand} | Période: ${periodLabel}
CA: ${current.total_sales.toFixed(0)}€ | Commandes: ${current.order_count} | Marge brute: ${current.gross_profit.toFixed(0)}€
Dépense pub totale: ${totalSpend.toFixed(0)}€ | ROAS global: ${roas}
Plateformes: ${platformSummary || 'Aucune'}
Top produits: ${topSellers || 'Aucun'}
Stock faible (<20 unités): ${lowStock || 'Aucun'}`
  }, [current, loading, spendBreakdown, bestSellers, inventory, exclusions, brand, periodLabel])

  return (
    <div className="min-h-screen bg-[#faf9f8]">
      <main className="max-w-7xl mx-auto px-4 sm:px-6 py-5 sm:py-8 space-y-4 sm:space-y-5">
        {/* Sync indicator */}
        {syncing && (
          <div className="flex items-center gap-2 text-xs text-[#6b6b63]">
            <svg className="animate-spin h-3.5 w-3.5 text-[#aeb0c9]" viewBox="0 0 24 24" fill="none">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
            </svg>
            Synchronisation des données…
          </div>
        )}

        {/* Filters */}
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="inline-flex items-center bg-white shadow-[0_2px_16px_rgba(0,0,0,0.06)] rounded-xl p-1 gap-0.5">
            {brandTabs.map((tab) => (
              <button
                key={tab.id}
                onClick={() => setBrand(tab.id)}
                className={`px-5 py-1.5 rounded-lg text-sm font-semibold transition-all ${
                  brand === tab.id ? 'bg-[#1a1a2e] text-white' : 'text-[#6b6b63] hover:text-[#1a1a2e]'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>
          <div className="inline-flex items-center bg-white shadow-[0_2px_16px_rgba(0,0,0,0.06)] rounded-xl p-1 gap-0.5">
            {periodTabs.map((tab) => (
              <button
                key={tab.id}
                onClick={() => setPeriod(tab.id)}
                className={`px-4 py-1.5 rounded-lg text-sm font-medium transition-all ${
                  period === tab.id ? 'bg-[#1a1a2e] text-white' : 'text-[#6b6b63] hover:text-[#1a1a2e]'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>
        </div>

        {/* Yesterday snapshot */}
        <SnapshotBanner data={snapshot} date={yesterday} loading={loading} syncDone={syncDone} />

        {/* KPI grid */}
        <section className="space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-[#1a1a18]">{periodLabel}</h2>
            <span className="text-xs text-[#6b6b63]">vs période précédente</span>
          </div>
          <KpiGrid current={current} previous={previous} loading={loading} brand={brand} sparklines={sparklines} />
        </section>

        {/* Ad spend + ROAS */}
        <AdPanel
          spendData={spendBreakdown}
          roasData={roasData}
          activePlatforms={roasActivePlatforms}
          loading={loading}
          periodLabel={chartLabel}
        />

        {/* Products */}
        <section className="space-y-3">
          <h2 className="text-sm font-semibold text-[#1a1a2e]">Produits</h2>
          <ProductsView
            bestSellers={bestSellers.filter((b) => !exclusions.includes(b.title))}
            inventory={inventory.filter((i) => !exclusions.includes(i.title))}
            loading={loading}
            stockThreshold={stockThreshold}
          />
        </section>

        {/* AI Insights */}
        <AiInsights type="dashboard" brand={brand} context={aiContext} />

        {/* Annual view */}
        <AnnualChart data={annualData} loading={annualLoading} />
      </main>
    </div>
  )
}
