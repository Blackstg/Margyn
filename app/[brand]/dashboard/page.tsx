'use client'

export const dynamic = 'force-dynamic'

import { Suspense } from 'react'
import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import { useSearchParams, useRouter, usePathname } from 'next/navigation'
import { createBrowserClient } from '@supabase/auth-helpers-nextjs'
import SnapshotBanner, { type SnapshotData } from '@/components/dashboard/SnapshotBanner'
import KpiGrid, { type KpiData, type SparklineData } from '@/components/dashboard/KpiGrid'
import { type SpendByPlatform } from '@/components/dashboard/SpendBreakdown'
import { type RoasPoint } from '@/components/dashboard/RoasChart'
import AdPanel from '@/components/dashboard/AdPanel'
import ProductsView, { type BestSeller, type InventoryItem } from '@/components/dashboard/ProductsView'
import StockValuationPanel, { type StockValuation, type StockValItem } from '@/components/dashboard/StockValuationPanel'
import AnnualChart, { type MonthPoint } from '@/components/dashboard/AnnualChart'
import AiInsights from '@/components/dashboard/AiInsights'
import { useBrand, type Brand } from '@/context/BrandContext'

// ─── Types ────────────────────────────────────────────────────────────────────

type Period = '7j' | '30j' | 'mois'

// ─── Supabase client ──────────────────────────────────────────────────────────

const supabase = createBrowserClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
)

// ─── Date helpers ─────────────────────────────────────────────────────────────

function fmt(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

function getYesterday(): string {
  // « Hier » en heure de Paris (les snapshots sont datés en heure de Paris),
  // indépendamment du fuseau de l'appareil — sinon décalage d'un jour possible.
  const parisNow = new Date(new Date().toLocaleString('en-US', { timeZone: 'Europe/Paris' }))
  parisNow.setDate(parisNow.getDate() - 1)
  return fmt(parisNow)
}

function getMonthRange(ym: string): { from: string; to: string; prevFrom: string; prevTo: string; days: number } {
  const [y, m] = ym.split('-').map(Number)
  const from = new Date(y, m - 1, 1)
  const to = new Date(y, m, 0) // last day of month
  const days = to.getDate()
  const prevTo = new Date(y, m - 1, 0)
  const prevFrom = new Date(y, m - 2, 1)
  return { from: fmt(from), to: fmt(to), prevFrom: fmt(prevFrom), prevTo: fmt(prevTo), days }
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
  gifting_count?: number | null
  gifting_cogs?: number | null
}

type SnapshotAgg = Omit<KpiData, 'marketing' | 'op_expenses' | 'net_profit' | 'transaction_fees' | 'app_charges'>

function sumSnapshots(rows: SnapshotRow[]): SnapshotAgg {
  const agg = rows.reduce<SnapshotAgg>(
    (acc, r) => ({
      total_sales:   acc.total_sales   + (r.total_sales      ?? 0),
      gross_profit:  0, // computed below
      order_count:   acc.order_count   + (r.order_count      ?? 0),
      cogs:          acc.cogs          + (r.cogs             ?? 0),
      fulfillment:   acc.fulfillment   + (r.fulfillment_cost ?? 0),
      returns:       acc.returns       + (r.returns          ?? 0),
      gifting_count: (acc.gifting_count ?? 0) + (r.gifting_count ?? 0),
      gifting_cogs:  (acc.gifting_cogs  ?? 0) + (r.gifting_cogs  ?? 0),
    }),
    { total_sales: 0, gross_profit: 0, order_count: 0, cogs: 0, fulfillment: 0, returns: 0, gifting_count: 0, gifting_cogs: 0 }
  )
  agg.gross_profit = agg.total_sales - agg.cogs
  return agg
}

// ─── Fetchers ─────────────────────────────────────────────────────────────────

// Début de la sous-traitance livraison Bowa (Terence) : au-delà, le coût de
// livraison vient de la facture calculée (/api/delivery/subcontract).
const BOWA_SUBCONTRACT_START = '2026-10-01'

async function fetchSnapshotData(brand: Brand, date: string): Promise<SnapshotData | null> {
  const brands = brandFilter(brand)

  // Fetch campaigns for this brand to aggregate campaign_stats spend
  const { data: campaignMeta } = await supabase
    .from('campaigns').select('id').eq('brand', brand)
  const campaignIds = (campaignMeta ?? []).map((c) => c.id)

  // Previous month for Bowa CPO fulfillment estimate
  const dateObj    = new Date(date)
  const prevMonthStart = new Date(dateObj.getFullYear(), dateObj.getMonth() - 1, 1)
  const prevMonthEnd   = new Date(dateObj.getFullYear(), dateObj.getMonth(), 0)
  const fmtD = (d: Date) => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`
  const prevMonthStr = `${prevMonthStart.getFullYear()}-${String(prevMonthStart.getMonth()+1).padStart(2,'0')}-01`

  const [snapshotsRes, spendRes, campaignStatsRes, fixedCostsRaw, , sampleTodayRes, samplePrevRes] = await Promise.all([
    supabase.from('daily_snapshots').select('total_sales, order_count, gross_profit, cogs, fulfillment_cost')
      .eq('date', date).in('brand', brands),
    supabase.from('ad_spends').select('spend').eq('date', date).in('brand', brands),
    campaignIds.length > 0
      ? supabase.from('campaign_stats').select('spend').eq('date', date).in('campaign_id', campaignIds)
      : Promise.resolve({ data: [] }),
    brand === 'bowa'
      ? fetch(`/api/fixed-costs?brand=bowa`).then(r => r.json()).catch(() => [])
      : Promise.resolve([]),
    Promise.resolve({ data: [] }), // unused slot — panel orders computed via product_sales below
    // Distinct panel order_ids for today (orders with ≥1 non-échantillon product)
    brand === 'bowa'
      ? supabase.from('product_sales').select('order_id')
          .eq('date', date).eq('brand', 'bowa').not('product_title', 'ilike', '%chantillon%')
      : Promise.resolve({ data: [] }),
    // Distinct panel order_ids for previous month
    brand === 'bowa'
      ? supabase.from('product_sales').select('order_id')
          .gte('date', fmtD(prevMonthStart)).lte('date', fmtD(prevMonthEnd))
          .eq('brand', 'bowa').not('product_title', 'ilike', '%chantillon%')
      : Promise.resolve({ data: [] }),
  ])

  const snap = (snapshotsRes.data ?? []).reduce(
    (acc, r) => ({
      total_sales:      acc.total_sales      + (r.total_sales      ?? 0),
      order_count:      acc.order_count      + (r.order_count      ?? 0),
      cogs:             acc.cogs             + (r.cogs             ?? 0),
      fulfillment_cost: acc.fulfillment_cost + (r.fulfillment_cost ?? 0),
      gross_profit: 0,
    }),
    { total_sales: 0, order_count: 0, gross_profit: 0, cogs: 0, fulfillment_cost: 0 }
  )

  // TVA correction for Bowa
  snap.gross_profit = brand === 'bowa'
    ? Math.round(snap.total_sales * (5 / 6)) - snap.cogs
    : snap.total_sales - snap.cogs

  // Bowa fulfillment: CPO from previous month × non-sample orders today
  if (brand === 'bowa') {
    type FC = { amount?: number | null; category?: string | null; month?: string | null }
    const allFC: FC[] = Array.isArray(fixedCostsRaw) ? fixedCostsRaw : []
    const sentinelFulfillment = allFC
      .filter(r => r.month === '1900-01-01' && r.category === 'fulfillment')
      .reduce((s, r) => s + (r.amount ?? 0), 0)
    const prevMonthlyFulfillment = allFC
      .filter(r => r.month === prevMonthStr && r.category === 'fulfillment')
      .reduce((s, r) => s + (r.amount ?? 0), 0)
    const prevTotalFulfillment = sentinelFulfillment + prevMonthlyFulfillment

    // Count distinct order_ids with at least 1 panel product (non-échantillon)
    type OrderIdRow = { order_id: string | null }
    const todayRows = ((sampleTodayRes as { data: OrderIdRow[] | null }).data ?? []) as OrderIdRow[]
    const prevRows  = ((samplePrevRes  as { data: OrderIdRow[] | null }).data ?? []) as OrderIdRow[]
    const todayPanelOrders = new Set(todayRows.map(r => r.order_id).filter(Boolean)).size
    const prevPanelOrders  = new Set(prevRows.map(r => r.order_id).filter(Boolean)).size

    if (date >= BOWA_SUBCONTRACT_START) {
      // Sous-traitance : prix moyen réel d'une livraison Terence sur les 30 derniers jours
      const d30 = fmtD(new Date(dateObj.getTime() - 30 * 86_400_000))
      const sub = await fetch(`/api/delivery/subcontract?brand=bowa&from=${d30 < BOWA_SUBCONTRACT_START ? BOWA_SUBCONTRACT_START : d30}&to=${date}`)
        .then(r => r.json() as Promise<{ summary?: { perOrder: number | null } }>).catch(() => null)
      const perDelivery = sub?.summary?.perOrder
      if (perDelivery) snap.fulfillment_cost = Math.round(perDelivery * todayPanelOrders)
    } else if (prevPanelOrders > 0 && prevTotalFulfillment > 0) {
      snap.fulfillment_cost = Math.round((prevTotalFulfillment / prevPanelOrders) * todayPanelOrders)
    }
  }

  // Use campaign_stats as source of truth for spend (more granular than ad_spends)
  const spendFromCampaigns = ((campaignStatsRes as { data: { spend?: number | null }[] | null }).data ?? [])
    .reduce((s, r) => s + (r.spend ?? 0), 0)
  const spendFromAdSpends = (spendRes.data ?? []).reduce(
    (s: number, r: { spend?: number | null }) => s + (r.spend ?? 0), 0
  )
  const spend = Math.max(spendFromCampaigns, spendFromAdSpends)

  if (snap.total_sales === 0 && spend === 0) return null

  return { ...snap, spend }
}

// ─── Mōom fulfillment from logistician invoices ───────────────────────────────

type InvoiceRowLite = { total_price?: number | null }

async function getEurRate(periodMonth: string): Promise<number> {
  try {
    // Server-side proxy — rate fetched at 1st of following month
    const res = await fetch(`/api/exchange-rate?month=${periodMonth}`)
    if (!res.ok) return 0.92
    const d = await res.json() as { eur_per_usd?: number }
    return d.eur_per_usd ?? 0.92
  } catch {
    return 0.92
  }
}

async function fetchMoomFulfillment(
  from: string,
  to: string,
  orderCount: number,
): Promise<{ fulfillment: number; note?: string }> {
  // Rapprochement PRÉCIS par n° de commande : on attribue aux commandes VENDUES
  // sur la période leur coût réel facturé (retrouvé par n° dans n'importe quelle
  // facture), au lieu de diviser un total facturé par le nb de ventes du mois
  // (le mois facturé ≠ le mois vendu → coût/livraison faussé).
  try {
    const r = await fetch(`/api/margins/fulfillment?brand=moom&from=${from}&to=${to}`)
    if (r.ok) {
      const d = await r.json() as { fulfillment?: number; matched?: number; orders?: number; note?: string }
      // On l'utilise dès qu'il y a des ventes : même sans facture rapprochée, le
      // repli est le coût réel moyen/commande de la dernière facture (pas un tarif figé).
      if (typeof d.fulfillment === 'number' && d.fulfillment >= 0 && (d.orders ?? 0) > 0) {
        return { fulfillment: d.fulfillment, note: d.note }
      }
    }
  } catch { /* repli sur l'estimation ci-dessous */ }

  const periodMonth = from.slice(0, 7)

  const prevMonthStr = (ym: string) => {
    const [y, m] = ym.split('-').map(Number)
    return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`
  }

  const sumTotal = (rows: InvoiceRowLite[]) =>
    rows.reduce((s, r) => s + (r.total_price ?? 0), 0)

  // Direct sum only for a complete calendar month (from = 1st, to = last day)
  const [y, mo] = periodMonth.split('-').map(Number)
  const lastDay = new Date(y, mo, 0).getDate()
  const isFullMonth = from === `${periodMonth}-01` && to === `${periodMonth}-${String(lastDay).padStart(2, '0')}`

  if (isFullMonth) {
    const { data: cur } = await supabase
      .from('logistician_invoice_summaries')
      .select('invoice_rows')
      .eq('brand', 'moom')
      .eq('month', periodMonth)
      .maybeSingle()

    const curRows = (cur as { invoice_rows?: InvoiceRowLite[] | null } | null)?.invoice_rows
    if (curRows?.length) {
      const totalUsd = sumTotal(curRows)
      const rate     = await getEurRate(periodMonth)
      return { fulfillment: Math.round(totalUsd * rate) }
    }
  }

  // All other periods (7j, 30j, partial months, or full month without invoice):
  // cost-per-order from the most recent invoice month

  // Use previous month's cost-per-order as estimate
  const prevMonth = prevMonthStr(periodMonth)

  const [prevInvoiceRes, prevSnapshotRes] = await Promise.all([
    supabase
      .from('logistician_invoice_summaries')
      .select('invoice_rows')
      .eq('brand', 'moom')
      .eq('month', prevMonth)
      .maybeSingle(),
    supabase
      .from('daily_snapshots')
      .select('order_count')
      .gte('date', `${prevMonth}-01`)
      .lte('date', `${prevMonth}-31`)
      .eq('brand', 'moom'),
  ])

  const prevRows = (prevInvoiceRes.data as { invoice_rows?: InvoiceRowLite[] | null } | null)?.invoice_rows
  if (prevRows?.length) {
    const totalUsd      = sumTotal(prevRows)
    const rate          = await getEurRate(prevMonth)
    const prevOrderCount = ((prevSnapshotRes.data ?? []) as { order_count?: number | null }[])
      .reduce((s, r) => s + (r.order_count ?? 0), 0) || prevRows.length
    const cpOrder       = (totalUsd * rate) / prevOrderCount
    const [py, pm]      = prevMonth.split('-').map(Number)
    const label         = new Date(py, pm - 1, 15).toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' })
    return {
      fulfillment: Math.round(cpOrder * orderCount),
      note: `Estimé — basé sur ${label}`,
    }
  }

  return { fulfillment: -1 } // signal: fall back to flat rate
}

// ─── KPI fetcher ──────────────────────────────────────────────────────────────

async function fetchKpiData(brand: Brand, from: string, to: string, days: number): Promise<KpiData> {
  const brands = brandFilter(brand)
  const suppQuery = supabase.from('supplementary_revenue').select('source, amount, fees, month')
    .gte('month', from.slice(0, 7) + '-01')
    .lte('month', to.slice(0, 7) + '-01')
    .eq('brand', brand)

  const [snapshotsRes, marketingRes, fixedCostsRaw, settingsRes, suppRes] = await Promise.all([
    supabase.from('daily_snapshots').select('total_sales, gross_profit, order_count, cogs, fulfillment_cost, returns')
      .gte('date', from).lte('date', to).in('brand', brands),
    supabase.from('ad_spends').select('spend')
      .gte('date', from).lte('date', to).in('brand', brands),
    // Use API route (service role) to bypass RLS on monthly rows
    fetch(`/api/fixed-costs?brand=${brand}`).then(r => r.json()).catch(() => []),
    supabase.from('brand_settings').select('shipping_cost_per_order, transaction_fee_rate').eq('brand', brand).single(),
    suppQuery,
  ])

  const snaps = sumSnapshots(snapshotsRes.data ?? [])
  const marketing = (marketingRes.data ?? []).reduce(
    (s: number, r: { spend?: number | null }) => s + (r.spend ?? 0), 0
  )

  // Fixed costs: separate sentinel (recurring) from monthly fulfillment extras
  type FixedRow = { amount?: number | null; category?: string | null; month?: string | null; label?: string | null; from?: string; to?: string }
  const fromMonth = from.slice(0, 7) + '-01'
  const toMonth   = to.slice(0, 7)   + '-01'
  const allFixedCosts: FixedRow[] = Array.isArray(fixedCostsRaw) ? fixedCostsRaw : []
  let totalFixedApp = 0, totalFixedTeam = 0, totalFixedInfra = 0
  let sentinelFulfillment = 0
  const sentinelFulfillmentRows: { label: string; amount: number }[] = []
  const monthlyFulfillmentRows:  { label: string; amount: number }[] = []
  for (const r of allFixedCosts) {
    const amount = r.amount ?? 0
    const isSentinel = r.month === '1900-01-01'
    // Charge récurrente hors de sa période de validité (ex. salarié parti) → ignorée
    if (isSentinel && ((r.from && r.from > toMonth.slice(0, 7)) || (r.to && r.to < fromMonth.slice(0, 7)))) continue
    const isInPeriod = r.month != null && r.month >= fromMonth && r.month <= toMonth

    if (isSentinel) {
      if (r.category === 'app')              totalFixedApp  += amount
      else if (r.category === 'fulfillment') {
        sentinelFulfillment += amount
        sentinelFulfillmentRows.push({ label: r.label ?? 'Fixe', amount })
      }
      else if (r.category === 'team')        totalFixedTeam += amount
      else                                   totalFixedInfra += amount
    } else if (isInPeriod && r.category === 'fulfillment') {
      monthlyFulfillmentRows.push({ label: r.label ?? 'Variable', amount })
    }
    // Monthly non-fulfillment rows are ignored here (handled separately as variable costs)
  }

  // For a full calendar month (from = 1st, days = full month), use 100% of sentinel costs.
  // For partial periods (7j, 30j, MTD), prorate by days/30.44.
  const [fy, fm] = from.split('-').map(Number)
  const daysInFromMonth = new Date(fy, fm, 0).getDate()
  const isFullCalendarMonth = from.endsWith('-01') && days === daysInFromMonth && fromMonth === toMonth
  const sentinelRatio = isFullCalendarMonth ? 1 : days / 30.44

  const app_charges   = Math.round(totalFixedApp   * sentinelRatio)
  const salaires      = Math.round(totalFixedTeam  * sentinelRatio)
  const charges_infra = Math.round(totalFixedInfra * sentinelRatio)
  const op_expenses   = salaires + charges_infra

  const settingsData = (settingsRes.data as { shipping_cost_per_order?: number; transaction_fee_rate?: number } | null)
  const shippingRateRaw    = settingsData?.shipping_cost_per_order
  const shippingRate       = shippingRateRaw ?? 17
  const transactionFeeRate = settingsData?.transaction_fee_rate ?? 0.017
  const transaction_fees   = Math.round(snaps.total_sales * transactionFeeRate)

  // Build fulfillment breakdown for tooltip (sentinel prorated, monthly at face value)
  const monthlyFulfillment = monthlyFulfillmentRows.reduce((s, r) => s + r.amount, 0)
  const fulfillment_breakdown: { label: string; amount: number }[] = [
    ...sentinelFulfillmentRows.map(r => ({ label: r.label, amount: Math.round(r.amount * sentinelRatio) })),
    ...monthlyFulfillmentRows,
  ]

  // For Bowa: fulfillment is "unconfigured" only if no fulfillment fixed costs AND no per-order rate
  let fulfillment_configured = brand !== 'bowa' || sentinelFulfillment > 0 || monthlyFulfillment > 0 || shippingRateRaw != null

  let fulfillment      = Math.round(shippingRate * snaps.order_count)
  let fulfillment_note: string | undefined
  let fulfillment_breakdown_final = fulfillment_breakdown

  if (brand === 'bowa' && to >= BOWA_SUBCONTRACT_START) {
    // Depuis la sous-traitance (Terence) : coût RÉEL = facture Terence des livraisons
    // de la période (grille, onglet « Facture Terence ») + ce qui reste de la feuille
    // transport interne, proratisé au nombre de jours de la période couverts par
    // chaque mois. Les lignes « Terence » de la feuille sont ignorées (déjà comptées).
    const fmtEurSimple = (n: number) => new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }).format(n)
    const subFrom = from < BOWA_SUBCONTRACT_START ? BOWA_SUBCONTRACT_START : from
    type SubRes = { summary?: { orders: number; totalHT: number; revenueHT: number; deliveryPctOfRevenue: number | null; lossLines: number; marginAfterDelivery: number } }
    // Livraison des commandes PASSÉES sur la période (réel si livrée, même plus tard ;
    // estimé sinon) — même règle que la page Pilote. La facture Terence du mois
    // (livraisons faites dans la période) reste affichée en info.
    type CohortRes = { actual: number; estimated: number; total: number; delivered: number; pending: number; internal: number }
    const [sub, cohort] = await Promise.all([
      fetch(`/api/delivery/subcontract?brand=bowa&from=${subFrom}&to=${to}`).then(r => r.json() as Promise<SubRes>).catch(() => null),
      fetch(`/api/pilot?brand=bowa&from=${from}&to=${to}`).then(r => r.ok ? r.json() as Promise<CohortRes> : null).catch(() => null),
    ])
    const subTotal = cohort?.total ?? sub?.summary?.totalHT ?? 0

    const dayMs = 86_400_000
    const pFrom = new Date(from + 'T00:00:00Z').getTime(), pTo = new Date(to + 'T00:00:00Z').getTime()
    const internalRows: { label: string; amount: number }[] = sentinelFulfillmentRows
      .map(r => ({ label: r.label, amount: Math.round(r.amount * sentinelRatio) }))
    for (const r of allFixedCosts) {
      if (r.category !== 'fulfillment' || !r.month || r.month === '1900-01-01' || /terence/i.test(r.label ?? '')) continue
      const mStart = new Date(r.month.slice(0, 7) + '-01T00:00:00Z')
      const mEnd = new Date(Date.UTC(mStart.getUTCFullYear(), mStart.getUTCMonth() + 1, 0))
      const overlap = (Math.min(pTo, mEnd.getTime()) - Math.max(pFrom, mStart.getTime())) / dayMs + 1
      if (overlap <= 0) continue
      const amount = Math.round((r.amount ?? 0) * overlap / mEnd.getUTCDate())
      if (amount > 0) internalRows.push({ label: r.label ?? 'Transport interne', amount })
    }
    const internal = internalRows.reduce((acc, r) => acc + r.amount, 0)

    fulfillment = subTotal + internal
    fulfillment_configured = true
    fulfillment_breakdown_final = [
      ...(cohort
        ? [{ label: `Terence · cmd de la période (${cohort.delivered} livrées${cohort.pending ? ` + ${cohort.pending} à livrer, estimé ${fmtEurSimple(cohort.estimated)}` : ''})`, amount: subTotal }]
        : sub?.summary ? [{ label: `Terence (${sub.summary.orders} livr.)`, amount: subTotal }] : []),
      ...internalRows,
    ]
    const sm = sub?.summary
    if (sm && sm.orders > 0) {
      fulfillment_note = [
        `${fmtEurSimple(Math.round(sm.totalHT / sm.orders))}/livraison`,
        `facture Terence période ${fmtEurSimple(sm.totalHT)}`,
        sm.deliveryPctOfRevenue != null ? `${sm.deliveryPctOfRevenue} % du CA livré` : '',
        sm.lossLines > 0 ? `${sm.lossLines} cmd à perte` : '',
      ].filter(Boolean).join(' · ')
    } else if (!sub) {
      fulfillment_note = 'Facture Terence indisponible'
    }
  } else if (brand === 'bowa' && (sentinelFulfillment > 0 || monthlyFulfillment > 0)) {
    const fmtDate = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
    const fmtEurSimple = (n: number) => new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }).format(n)
    type ORow = { order_id: string | null; quantity?: number | null }

    if (isFullCalendarMonth) {
      // Mois complet : coût réel (sentinel + mensuel), CPO = coût réel / commandes panneaux du mois
      const actualFulfillment = sentinelFulfillment + monthlyFulfillment
      fulfillment = actualFulfillment
      const curPanelRes = await supabase.from('product_sales').select('order_id, quantity')
        .gte('date', from).lte('date', to)
        .eq('brand', 'bowa').not('product_title', 'ilike', '%chantillon%')
      const curRows = (curPanelRes.data ?? []) as ORow[]
      const curPanelOrders = new Set(curRows.map(r => r.order_id).filter(Boolean)).size
      const curPanelUnits  = curRows.reduce((s, r) => s + (r.quantity ?? 0), 0)
      if (curPanelOrders > 0) {
        const cpoLine = `${fmtEurSimple(Math.round(actualFulfillment / curPanelOrders))}/cmd`
        const pppLine = curPanelUnits > 0 ? `${fmtEurSimple(Math.round(actualFulfillment / curPanelUnits))}/panneau` : ''
        fulfillment_note = [cpoLine, pppLine].filter(Boolean).join(' · ')
      }
    } else {
      // Période partielle (7j/30j) : CPO mois précédent × commandes panneaux de la période
      const prevMonthStart = new Date(fy, fm - 2, 1)
      const prevMonthEnd   = new Date(fy, fm - 1, 0)
      const prevMonthStr   = `${prevMonthStart.getFullYear()}-${String(prevMonthStart.getMonth() + 1).padStart(2, '0')}-01`

      const prevMonthlyFulfillment = allFixedCosts
        .filter(r => r.month === prevMonthStr && r.category === 'fulfillment')
        .reduce((s, r) => s + (r.amount ?? 0), 0)
      const prevTotalFulfillment = sentinelFulfillment + prevMonthlyFulfillment

      const [prevPanelRes, curPanelRes] = await Promise.all([
        supabase.from('product_sales').select('order_id')
          .gte('date', fmtDate(prevMonthStart)).lte('date', fmtDate(prevMonthEnd))
          .eq('brand', 'bowa').not('product_title', 'ilike', '%chantillon%'),
        supabase.from('product_sales').select('order_id, quantity')
          .gte('date', from).lte('date', to)
          .eq('brand', 'bowa').not('product_title', 'ilike', '%chantillon%'),
      ])

      const prevPanelOrders = new Set(((prevPanelRes.data ?? []) as ORow[]).map(r => r.order_id).filter(Boolean)).size
      const curRows         = (curPanelRes.data ?? []) as ORow[]
      const curPanelOrders  = new Set(curRows.map(r => r.order_id).filter(Boolean)).size
      const curPanelUnits   = curRows.reduce((s, r) => s + (r.quantity ?? 0), 0)

      if (prevPanelOrders > 0 && prevTotalFulfillment > 0) {
        const cpo = prevTotalFulfillment / prevPanelOrders
        fulfillment = Math.round(cpo * curPanelOrders)
        const cpoLine = `${fmtEurSimple(Math.round(cpo))}/cmd (mois précédent)`
        const pppLine = curPanelUnits > 0 ? `${fmtEurSimple(Math.round(fulfillment / curPanelUnits))}/panneau` : ''
        fulfillment_note = [cpoLine, pppLine].filter(Boolean).join(' · ')
        fulfillment_breakdown_final = []
      } else {
        fulfillment = Math.round(sentinelFulfillment * sentinelRatio) + monthlyFulfillment
      }
    }
  } else if (brand === 'moom') {
    const mf = await fetchMoomFulfillment(from, to, snaps.order_count)
    if (mf.fulfillment >= 0) {
      fulfillment      = mf.fulfillment
      fulfillment_note = mf.note
    }
  }

  // Revenus hors Shopify (Bowa : B2B/Leroy… · Moom/Krom : ventes privées type Choose,
  // à 0 sur Shopify → on saisit le CA réel + les fees de la plateforme). Le CA s'ajoute
  // au total ; les fees sont un coût déduit du net (à la place du marketing).
  type SuppRow = { source: string; amount?: number | null; fees?: number | null; month: string }
  const bySource = new Map<string, { amount: number; fees: number }>()
  for (const r of ((suppRes as { data: SuppRow[] | null }).data ?? []) as SuppRow[]) {
    const cur = bySource.get(r.source) ?? { amount: 0, fees: 0 }
    cur.amount += r.amount ?? 0
    cur.fees   += r.fees ?? 0
    bySource.set(r.source, cur)
  }
  const supplementary_breakdown = Array.from(bySource.entries())
    .map(([source, v]) => ({ source, amount: Math.round(v.amount), fees: Math.round(v.fees) }))
    .filter(i => i.amount > 0 || i.fees > 0)
  const supplementary_ca   = supplementary_breakdown.reduce((s, i) => s + i.amount, 0)
  const supplementary_fees = supplementary_breakdown.reduce((s, i) => s + i.fees, 0)

  // TVA correction for Bowa: Shopify revenue is TTC, COGS are HT.
  // Gross profit must be computed on HT basis: (CA TTC + Supp CA) × 5/6 − COGS.
  // Autres marques : on ajoute le CA des ventes privées à la marge brute.
  const gross_profit = brand === 'bowa'
    ? Math.round((snaps.total_sales + supplementary_ca) * (5 / 6)) - snaps.cogs
    : snaps.gross_profit + supplementary_ca

  // Gifting columns — fetched separately, gracefully degrade if columns don't exist yet
  let gifting_count = 0
  let gifting_cogs  = 0
  try {
    const { data: giftingRows, error: giftingError } = await supabase
      .from('daily_snapshots')
      .select('gifting_count, gifting_cogs')
      .gte('date', from).lte('date', to).in('brand', brands)
    if (!giftingError && giftingRows) {
      for (const r of giftingRows as { gifting_count?: number | null; gifting_cogs?: number | null }[]) {
        gifting_count += r.gifting_count ?? 0
        gifting_cogs  += r.gifting_cogs  ?? 0
      }
    }
  } catch { /* columns not yet migrated — default to 0 */ }

  return {
    ...snaps, gross_profit, fulfillment, marketing, op_expenses, app_charges, transaction_fees, net_profit: null,
    salaires, charges_infra,
    gifting_count, gifting_cogs, fulfillment_note, fulfillment_configured,
    ...(fulfillment_breakdown_final.length > 0 ? { fulfillment_breakdown: fulfillment_breakdown_final } : {}),
    ...((supplementary_ca > 0 || supplementary_fees > 0) ? { supplementary_ca, supplementary_fees, supplementary_breakdown } : {}),
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
  const [salesRes, productsRes, variantsRes] = await Promise.all([
    supabase
      .from('product_sales')
      .select('product_title, quantity, revenue, shopify_product_id')
      .eq('brand', brand)
      .gte('date', from)
      .lte('date', to)
      .limit(10000),
    supabase
      .from('products')
      .select('shopify_id, title, image_url, cost_price, sell_price')
      .eq('brand', brand),
    supabase
      .from('product_variants')
      .select('shopify_product_id, product_title, cost_price, sell_price')
      .eq('brand', brand)
      .not('cost_price', 'is', null),
  ])

  // Variant aggregates keyed by shopify_product_id AND by product_title (double fallback)
  type Agg = { costSum: number; sellSum: number; count: number }
  const varByPid   = new Map<string, Agg>()
  const varByTitle = new Map<string, Agg>()
  for (const v of variantsRes.data ?? []) {
    const add = (map: Map<string, Agg>, key: string) => {
      const prev = map.get(key) ?? { costSum: 0, sellSum: 0, count: 0 }
      map.set(key, { costSum: prev.costSum + (v.cost_price ?? 0), sellSum: prev.sellSum + (v.sell_price ?? 0), count: prev.count + 1 })
    }
    if (v.shopify_product_id) add(varByPid,   v.shopify_product_id)
    if (v.product_title)      add(varByTitle, v.product_title)
  }
  const avgCost  = (a: Agg) => a.costSum / a.count
  const avgSell  = (a: Agg) => a.sellSum / a.count

  // Primary lookup by shopify_id, with variant fallback when cost_price is null
  const imageById = new Map<string, string | null>()
  const costById  = new Map<string, number | null>()
  const sellById  = new Map<string, number | null>()
  for (const p of productsRes.data ?? []) {
    if (!p.shopify_id) continue
    const va = varByPid.get(p.shopify_id)
    imageById.set(p.shopify_id, p.image_url ?? null)
    costById.set(p.shopify_id,  p.cost_price  ?? (va ? avgCost(va) : null))
    sellById.set(p.shopify_id,  p.sell_price  ?? (va ? avgSell(va) : null))
  }
  // Also cover products absent from products table but present in product_variants
  for (const [pid, va] of varByPid.entries()) {
    if (!costById.has(pid)) {
      costById.set(pid, avgCost(va))
      sellById.set(pid, avgSell(va))
    }
  }

  // Aggregate sales by title, tracking shopify_product_id
  const byTitle = new Map<string, { quantity: number; revenue: number; shopify_product_id: string | null }>()
  for (const r of salesRes.data ?? []) {
    const prev = byTitle.get(r.product_title) ?? { quantity: 0, revenue: 0, shopify_product_id: r.shopify_product_id ?? null }
    byTitle.set(r.product_title, {
      quantity:           prev.quantity + (r.quantity ?? 0),
      revenue:            prev.revenue  + (r.revenue  ?? 0),
      shopify_product_id: prev.shopify_product_id ?? r.shopify_product_id ?? null,
    })
  }

  const totalRevenue = Array.from(byTitle.values()).reduce((s, v) => s + v.revenue, 0)

  return Array.from(byTitle.entries())
    .map(([title, v]) => {
      const pid = v.shopify_product_id
      // 1. By shopify_product_id  2. By title via variants  3. null
      const vt = varByTitle.get(title)
      return {
        title,
        quantity:   v.quantity,
        revenue:    Math.round(v.revenue * 100) / 100,
        revenuePct: totalRevenue > 0 ? (v.revenue / totalRevenue) * 100 : 0,
        image_url:  pid ? (imageById.get(pid) ?? null) : null,
        cost_price: pid ? (costById.get(pid)  ?? (vt ? avgCost(vt) : null)) : (vt ? avgCost(vt) : null),
        sell_price: pid ? (sellById.get(pid)  ?? (vt ? avgSell(vt) : null)) : (vt ? avgSell(vt) : null),
      }
    })
    .sort((a, b) => b.quantity - a.quantity)
    .slice(0, 6)
}

// Productions en cours (persistées côté serveur, page Réappro).
async function fetchInProduction(brand: Brand): Promise<Record<string, number>> {
  try {
    const r = await fetch(`/api/reorder/production?brand=${brand}`, { cache: 'no-store' })
    if (!r.ok) return {}
    const { map } = await r.json() as { map?: Record<string, number> }
    return map ?? {}
  } catch { return {} }
}

async function fetchInventory(brand: Brand, inProd: Record<string, number> = {}): Promise<InventoryItem[]> {
  const velocityFrom = new Date()
  velocityFrom.setDate(velocityFrom.getDate() - 30)
  const velocityFromStr = fmt(velocityFrom)

  const [variantsRes, salesRes] = await Promise.all([
    supabase
      .from('product_variants')
      .select('shopify_variant_id, product_title, variant_title, stock_quantity, image_url')
      .eq('brand', brand)
      .order('stock_quantity', { ascending: true }),
    supabase
      .from('product_sales')
      .select('variant_id, quantity')
      .eq('brand', brand)
      .gte('date', velocityFromStr)
      .not('variant_id', 'is', null)
      .neq('variant_id', ''),
  ])

  const sold30 = new Map<string, number>()
  for (const r of salesRes.data ?? []) {
    if (r.variant_id) {
      sold30.set(r.variant_id, (sold30.get(r.variant_id) ?? 0) + (r.quantity ?? 0))
    }
  }

  return (variantsRes.data ?? []).map((v) => {
    const totalSold = sold30.get(v.shopify_variant_id) ?? 0
    const dailyVelocity = totalSold / 30
    const qty_in_production = inProd[v.shopify_variant_id] ?? 0
    // Couverture calculée sur le stock effectif (réel + commande en cours)
    const coverage_days = dailyVelocity > 0 ? (v.stock_quantity + qty_in_production) / dailyVelocity : null
    return {
      title: v.product_title,
      variant_title: v.variant_title ?? null,
      stock_quantity: v.stock_quantity,
      sell_price: null,
      stock_alert_threshold: 0,
      image_url: v.image_url,
      coverage_days,
      qty_in_production,
      shopify_variant_id: v.shopify_variant_id,
    } as InventoryItem
  })
}

// Valorisation du stock : trésorerie immobilisée (coût d'achat) + valeur de revente
// potentielle, par marque. Stock négatif (survente) clampé à 0. Fallback prix produit
// quand la variante n'a pas de cost/sell renseigné.
async function fetchStockValuation(brand: Brand, inProd: Record<string, number> = {}): Promise<StockValuation> {
  const [variantsRes, productsRes] = await Promise.all([
    supabase.from('product_variants')
      .select('shopify_variant_id, shopify_product_id, product_title, variant_title, stock_quantity, cost_price, sell_price, image_url, updated_at')
      .eq('brand', brand),
    supabase.from('products')
      .select('shopify_id, cost_price, sell_price')
      .eq('brand', brand),
  ])
  const prodCost = new Map<string, number | null>()
  const prodSell = new Map<string, number | null>()
  for (const p of productsRes.data ?? []) {
    if (!p.shopify_id) continue
    prodCost.set(p.shopify_id, p.cost_price ?? null)
    prodSell.set(p.shopify_id, p.sell_price ?? null)
  }

  let totalCost = 0, totalRetail = 0, units = 0, skusMissingCost = 0
  let prodUnits = 0, prodCostTotal = 0, prodRetail = 0
  let updatedAt: string | null = null
  const items: StockValItem[] = []
  for (const v of variantsRes.data ?? []) {
    if (v.updated_at && (!updatedAt || v.updated_at > updatedAt)) updatedAt = v.updated_at
    const qty     = Math.max(0, v.stock_quantity ?? 0)
    const qtyProd = Math.max(0, inProd[v.shopify_variant_id] ?? 0)
    if (qty === 0 && qtyProd === 0) continue
    const pid    = v.shopify_product_id ?? ''
    const cost   = v.cost_price ?? (pid ? prodCost.get(pid) ?? null : null)
    const retail = v.sell_price ?? (pid ? prodSell.get(pid) ?? null : null)
    const blocked = cost != null ? qty * cost : 0
    if (cost == null && qty > 0) skusMissingCost++
    totalCost   += blocked
    totalRetail += retail != null ? qty * retail : 0
    units       += qty
    prodUnits      += qtyProd
    prodCostTotal  += cost   != null ? qtyProd * cost   : 0
    prodRetail     += retail != null ? qtyProd * retail : 0
    items.push({
      title: v.product_title, variant_title: v.variant_title ?? null,
      qty, qty_prod: qtyProd, cost, retail, blocked, image_url: v.image_url ?? null,
    })
  }
  items.sort((a, b) => (b.blocked + (b.qty_prod * (b.cost ?? 0))) - (a.blocked + (a.qty_prod * (a.cost ?? 0))))
  return { totalCost, totalRetail, units, skusMissingCost, items, prodUnits, prodCost: prodCostTotal, prodRetail, updatedAt }
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
    const key = fmt(d)
    const v   = byDate.get(key) ?? { sales: 0, gross: 0 }
    sales.push(v.sales)
    gross.push(v.gross)
    d.setDate(d.getDate() + 1)
  }
  return { sales, gross }
}

async function fetchAnnualData(brand: Brand, year: number): Promise<MonthPoint[]> {
  const from = `${year}-01-01`
  const to   = `${year}-12-31`
  const brands = brandFilter(brand)

  const [snapshotsRes, marketingRes, fixedCostsRaw, settingsRes] = await Promise.all([
    supabase.from('daily_snapshots')
      .select('date, total_sales, gross_profit, order_count')
      .gte('date', from).lte('date', to).in('brand', brands),
    supabase.from('ad_spends')
      .select('date, spend')
      .gte('date', from).lte('date', to).in('brand', brands),
    // Use API route (service role) to bypass RLS on monthly rows
    fetch(`/api/fixed-costs?brand=${brand}`).then(r => r.json()).catch(() => []),
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

  // Fixed costs: all rows from API (bypass RLS), split sentinel vs monthly in JS
  type FixedRow = { amount?: number | null; category?: string | null; month?: string | null; from?: string; to?: string }
  const allFixedCosts: FixedRow[] = Array.isArray(fixedCostsRaw) ? fixedCostsRaw : []
  let fixedApp = 0, fixedOther = 0, fixedFulfillmentSentinel = 0
  // Lignes récurrentes datées (from/to) : appliquées mois par mois ci-dessous
  const datedSentinel = allFixedCosts.filter(r => r.month === '1900-01-01' && (r.from || r.to))
  const monthlyFulfillmentByMonth = new Map<number, number>()
  for (const r of allFixedCosts) {
    const amount = r.amount ?? 0
    if (r.month === '1900-01-01') {
      if (r.from || r.to) continue
      if (r.category === 'app')              fixedApp += amount
      else if (r.category === 'fulfillment') fixedFulfillmentSentinel += amount
      else                                   fixedOther += amount
    } else if (r.category === 'fulfillment' && r.month) {
      const m = new Date(r.month + 'T00:00:00').getMonth() + 1
      monthlyFulfillmentByMonth.set(m, (monthlyFulfillmentByMonth.get(m) ?? 0) + amount)
    }
  }

  const fixedTemplate = { app: fixedApp, other: fixedOther, fulfillmentSentinel: fixedFulfillmentSentinel }

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
    const ym = `${year}-${String(month).padStart(2, '0')}`
    const fixed = { ...fixedTemplate }
    for (const r of datedSentinel) {
      if ((r.from && ym < r.from) || (r.to && ym > r.to)) continue
      if (r.category === 'app') fixed.app += r.amount ?? 0
      else if (r.category === 'fulfillment') fixed.fulfillmentSentinel += r.amount ?? 0
      else fixed.other += r.amount ?? 0
    }

    // Bowa: total_sales is TTC. On garde le HT pour les CALCULS de marge (fees,
    // marge nette), mais le CA AFFICHÉ dans le graph reste TTC — comme le KPI du
    // haut — pour ne pas dérouter (sinon 70k TTC en haut ≠ 58k HT dans le graph).
    const tva          = brand === 'bowa' ? Math.round(d.ca / 6) : 0
    const caHT         = d.ca - tva
    const grossProfitHT = d.gross_profit - tva

    // For Bowa: sentinel fulfillment + monthly variable fulfillment; otherwise per-order rate
    const monthlyFulfillmentExtra = monthlyFulfillmentByMonth.get(month) ?? 0
    const totalFulfillment = fixed.fulfillmentSentinel + monthlyFulfillmentExtra
    const fulfillment = brand === 'bowa' && totalFulfillment > 0
      ? totalFulfillment
      : Math.round(shippingRate * d.order_count)
    const transaction_fees = Math.round(caHT * feeRate)
    const net_margin = grossProfitHT - d.marketing - fulfillment - transaction_fees - fixed.app - fixed.other
    const isFuture = year > currentYear || (year === currentYear && month > currentMonth)
    return { month, label: LABELS[i], ca: d.ca, net_margin: Math.round(net_margin), isFuture, ca_prev: 0, net_margin_prev: 0 }
  })
}

async function fetchExclusions(brand: Brand): Promise<string[]> {
  const { data } = await supabase
    .from('product_exclusions')
    .select('product_title')
    .eq('brand', brand)
  return (data ?? []).map((r) => r.product_title)
}

// ─── Cache & préférence (stale-while-revalidate, à la React Query) ──────────────
// On garde en mémoire la dernière réponse par (marque, période) : au retour sur
// le dashboard on réaffiche instantanément, puis on rafraîchit en arrière-plan.
type DashSnapshot = {
  snapshot: SnapshotData | null; current: KpiData | null; previous: KpiData | null
  spendBreakdown: SpendByPlatform[]; roas: { points: RoasPoint[]; activePlatforms: string[] }
  bestSellers: BestSeller[]; inventory: InventoryItem[]; exclusions: string[]
  sparklines: SparklineData; stockVal: StockValuation | null
}
const dashCache = new Map<string, DashSnapshot>()
const dashKey = (brand: Brand, period: Period, month: string | null) =>
  `${brand}|${month ?? period}`

// Dernière période/mois choisie par marque — survit à la navigation entre onglets.
function loadDashPref(brand: Brand): { period?: Period; month?: string | null } {
  if (typeof window === 'undefined') return {}
  try {
    const raw = window.localStorage.getItem(`steero:dash:${brand}`)
    return raw ? JSON.parse(raw) : {}
  } catch { return {} }
}
function saveDashPref(brand: Brand, period: Period, month: string | null) {
  if (typeof window === 'undefined') return
  try { window.localStorage.setItem(`steero:dash:${brand}`, JSON.stringify({ period, month })) } catch { /* quota */ }
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

  const brand                  = useBrand()
  // État initial = URL si présente (lien partageable prioritaire), sinon dernière
  // préférence mémorisée, sinon 7j. Lu dès l'init (composant rendu côté client via
  // useSearchParams+Suspense) → on démarre direct sur la bonne période, sans flash 7j.
  const [period, setPeriodState] = useState<Period>(() => {
    if (searchParams.get('period')) return urlToPeriod(searchParams.get('period'))
    if (searchParams.get('month')) return '7j'
    return loadDashPref(brand).period ?? '7j'
  })
  const [selectedMonth, setSelectedMonthState] = useState<string | null>(() => {
    const m = searchParams.get('month')
    if (m && /^\d{4}-\d{2}$/.test(m)) return m
    if (searchParams.get('period')) return null
    return loadDashPref(brand).month ?? null
  })

  function buildParams(b: Brand, p: Period, m: string | null) {
    const params = new URLSearchParams()
    params.set('brand', b)
    if (m) {
      params.set('month', m)
    } else {
      params.set('period', periodToUrl(p))
    }
    return params
  }

  function setPeriod(p: Period) {
    setPeriodState(p)
    setSelectedMonthState(null)
    saveDashPref(brand, p, null)
    router.replace(`${pathname}?${buildParams(brand, p, null).toString()}`)
  }

  function setMonth(m: string | null) {
    setSelectedMonthState(m)
    saveDashPref(brand, period, m)
    router.replace(`${pathname}?${buildParams(brand, period, m).toString()}`)
  }

  // L'état démarre déjà sur la bonne période (init depuis localStorage). Ici on
  // se contente de refléter ce choix dans l'URL si elle était vide, pour garder
  // des liens cohérents — sans relancer de chargement (load ne dépend pas de l'URL).
  const urlSynced = useRef(false)
  useEffect(() => {
    if (urlSynced.current) return
    urlSynced.current = true
    if (searchParams.get('period') || searchParams.get('month')) return
    if (period === '7j' && !selectedMonth) return
    router.replace(`${pathname}?${buildParams(brand, period, selectedMonth).toString()}`)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

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
  const [stockVal, setStockVal]                   = useState<StockValuation | null>(null)
  const [refreshingStock, setRefreshingStock]     = useState(false)
  const yesterday = getYesterday()

  const applyData = useCallback((d: DashSnapshot) => {
    setSnapshot(d.snapshot)
    setCurrent(d.current)
    setPrevious(d.previous)
    setSpendBreakdown(d.spendBreakdown)
    setRoasData(d.roas.points)
    setRoasActivePlatforms(d.roas.activePlatforms)
    setBestSellers(d.bestSellers)
    setInventory(d.inventory)
    setExclusions(d.exclusions)
    setSparklines(d.sparklines)
    setStockVal(d.stockVal)
  }, [])

  const load = useCallback(async () => {
    // Stale-while-revalidate : si on a déjà les données de cette (marque, période)
    // en cache, on les réaffiche tout de suite (pas de spinner) et on rafraîchit
    // en arrière-plan. Sinon, premier chargement → spinner.
    const key = dashKey(brand, period, selectedMonth)
    const cached = dashCache.get(key)
    if (cached) { applyData(cached); setLoading(false) }
    else setLoading(true)

    const { from, to, prevFrom, prevTo, days } = selectedMonth
      ? getMonthRange(selectedMonth)
      : getRange(period)
    const inProd = await fetchInProduction(brand)
    const [snap, curr, prev, breakdown, roas, sellers, inv, excl, sparks, stock] = await Promise.all([
      fetchSnapshotData(brand, yesterday),
      fetchKpiData(brand, from, to, days),
      fetchKpiData(brand, prevFrom, prevTo, days),
      fetchSpendBreakdown(brand, from, to),
      fetchRoasData(brand, from, to),
      fetchBestSellers(brand, from, to),
      fetchInventory(brand, inProd),
      fetchExclusions(brand),
      fetchSparklines(brand, from, to),
      fetchStockValuation(brand, inProd),
    ])
    const data: DashSnapshot = {
      snapshot: snap, current: curr, previous: prev, spendBreakdown: breakdown,
      roas, bestSellers: sellers, inventory: inv, exclusions: excl,
      sparklines: sparks, stockVal: stock,
    }
    dashCache.set(key, data)
    applyData(data)
    setLoading(false)
  }, [brand, period, selectedMonth, yesterday, applyData])

  // Rafraîchir le stock à la demande : relance la synchro Shopify puis recharge.
  const refreshStock = useCallback(async () => {
    setRefreshingStock(true)
    try {
      await fetch(`/api/sync-all?brand=${brand}`, { method: 'POST' })
    } catch { /* on recharge quand même */ }
    await load()
    setRefreshingStock(false)
  }, [brand, load])

  useEffect(() => { load() }, [load])

  // Reload data when a manual sync completes (fired by DataFreshness "Sync maintenant")
  useEffect(() => {
    function onSyncDone() { load() }
    window.addEventListener('steero:sync-done', onSyncDone)
    return () => window.removeEventListener('steero:sync-done', onSyncDone)
  }, [load])

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

  // Reset syncDone when brand/period/month changes
  useEffect(() => { setSyncDone(false) }, [brand, period, selectedMonth])

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

  const periodTabs: { id: Period; label: string }[] = [
    { id: '7j',   label: '7 j'    },
    { id: '30j',  label: '30 j'   },
    { id: 'mois', label: 'Ce mois' },
  ]

  const monthOptions: { value: string; label: string }[] = (() => {
    const opts = []
    const d = new Date()
    for (let i = 1; i <= 12; i++) {
      d.setDate(1)
      d.setMonth(d.getMonth() - 1)
      const ym = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
      opts.push({
        value: ym,
        label: d.toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' }),
      })
    }
    return opts
  })()

  const periodLabel = selectedMonth
    ? new Date(selectedMonth + '-01').toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' })
    : { '7j': '7 derniers jours', '30j': '30 derniers jours', mois: 'Ce mois' }[period]
  const chartLabel = selectedMonth
    ? new Date(selectedMonth + '-01').toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' })
    : { '7j': '7 jours', '30j': '30 jours', mois: 'Ce mois' }[period]

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

  const unauthorizedError = searchParams.get('error') === 'unauthorized'

  return (
    <div className="min-h-screen bg-[#faf9f8]">
      <main className="max-w-[90rem] mx-auto px-4 sm:px-6 py-5 sm:py-8 space-y-4 sm:space-y-5">
        {/* Unauthorized brand access */}
        {unauthorizedError && (
          <div className="flex items-center justify-between gap-3 px-4 py-3 bg-[#fce8ea] border border-[#f5c2c7] rounded-xl">
            <p className="text-sm font-medium text-[#c7293a]">
              Accès non autorisé — cette page n&apos;est pas disponible pour votre compte.
            </p>
            <button
              onClick={() => router.replace('/dashboard')}
              className="text-[#c7293a] hover:text-[#a01f2e] text-sm font-semibold shrink-0"
            >
              Fermer
            </button>
          </div>
        )}

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
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-end">
          <div className="flex items-center gap-2">
            <div className="inline-flex items-center bg-white shadow-[0_2px_16px_rgba(0,0,0,0.06)] rounded-xl p-1 gap-0.5">
              {periodTabs.map((tab) => (
                <button
                  key={tab.id}
                  onClick={() => setPeriod(tab.id)}
                  className={`px-4 py-1.5 rounded-lg text-sm font-medium transition-all ${
                    !selectedMonth && period === tab.id ? 'bg-[#1a1a2e] text-white' : 'text-[#6b6b63] hover:text-[#1a1a2e]'
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>
            <select
              value={selectedMonth ?? ''}
              onChange={(e) => {
                if (e.target.value) setMonth(e.target.value)
                else setPeriod(period)
              }}
              className={`h-9 px-3 rounded-xl text-sm font-medium border-0 shadow-[0_2px_16px_rgba(0,0,0,0.06)] bg-white appearance-none cursor-pointer transition-all outline-none ${
                selectedMonth ? 'text-[#1a1a2e] font-semibold' : 'text-[#6b6b63]'
              }`}
            >
              <option value="">Mois…</option>
              {monthOptions.map((opt) => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>
          </div>
        </div>

        {/* Two-column layout: main content + AI sidebar */}
        <div className="grid grid-cols-1 xl:grid-cols-[1fr_280px] gap-5 items-start">
          {/* Main content column */}
          <div className="space-y-4 sm:space-y-5 min-w-0">
            {/* Yesterday snapshot */}
            <SnapshotBanner data={snapshot} date={yesterday} loading={loading} brand={brand} syncDone={syncDone} />

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
              maturing={!selectedMonth}
            />

            {/* Stock valuation — trésorerie immobilisée par marque */}
            <StockValuationPanel data={stockVal} loading={loading} />

            {/* Products */}
            <section className="space-y-3">
              <h2 className="text-sm font-semibold text-[#1a1a2e]">Produits</h2>
              <ProductsView
                bestSellers={bestSellers.filter((b) => !exclusions.includes(b.title) && !b.title.includes(' + '))}
                inventory={inventory.filter((i) => !exclusions.includes(i.title) && !i.title.includes(' + '))}
                loading={loading}
                stockThreshold={stockThreshold}
              />
            </section>

            {/* Annual view */}
            <AnnualChart
              data={annualData}
              loading={annualLoading}
              stockValue={stockVal?.totalCost ?? null}
              stockLoading={loading}
              stockSyncedAt={stockVal?.updatedAt ?? null}
              onRefreshStock={refreshStock}
              stockRefreshing={refreshingStock}
            />
          </div>

          {/* Sticky AI sidebar */}
          <div className="xl:sticky xl:top-5">
            <AiInsights type="dashboard" brand={brand} context={aiContext} />
          </div>
        </div>
      </main>
    </div>
  )
}
