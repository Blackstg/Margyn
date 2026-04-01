'use client'

export const dynamic = 'force-dynamic'

import { Suspense } from 'react'
import { useState, useEffect, useCallback, useMemo } from 'react'
import { useSearchParams, useRouter, usePathname } from 'next/navigation'
import { createClient } from '@supabase/supabase-js'
import CampaignsTable, { type CampaignAgg } from '@/components/dashboard/CampaignsTable'
import AiInsights from '@/components/dashboard/AiInsights'

// ─── Supabase ─────────────────────────────────────────────────────────────────

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
)

// ─── Types ────────────────────────────────────────────────────────────────────

type Brand  = 'bowa' | 'moom'
type Period = '7j' | '30j' | 'mois'

// ─── Date helpers ─────────────────────────────────────────────────────────────

function fmt(d: Date): string { return d.toISOString().slice(0, 10) }

function getRange(period: Period): { from: string; to: string } {
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
  return { from: fmt(from), to: fmt(to) }
}

// ─── Fetcher ──────────────────────────────────────────────────────────────────

async function fetchCampaignData(brand: Brand, from: string, to: string): Promise<CampaignAgg[]> {
  const { data: campaignMeta } = await supabase
    .from('campaigns').select('id, platform, brand, name, status').eq('brand', brand)

  if (!campaignMeta || campaignMeta.length === 0) return []

  const ids = campaignMeta.map((c) => c.id)
  const { data: stats } = await supabase
    .from('campaign_stats').select('campaign_id, spend, revenue, impressions, clicks, conversions')
    .gte('date', from).lte('date', to).in('campaign_id', ids).limit(10000)

  const metaById = new Map(campaignMeta.map((c) => [c.id, c]))
  const aggById = new Map<string, Omit<CampaignAgg, 'roas' | 'cpa'>>()

  for (const s of stats ?? []) {
    const meta = metaById.get(s.campaign_id)
    if (!meta) continue
    const prev = aggById.get(s.campaign_id) ?? {
      id: s.campaign_id, platform: meta.platform, brand: meta.brand,
      name: meta.name, status: meta.status,
      spend: 0, revenue: 0, impressions: 0, clicks: 0, conversions: 0,
    }
    aggById.set(s.campaign_id, {
      ...prev,
      spend:       prev.spend       + (s.spend       ?? 0),
      revenue:     prev.revenue     + (s.revenue     ?? 0),
      impressions: prev.impressions + (s.impressions  ?? 0),
      clicks:      prev.clicks      + (s.clicks       ?? 0),
      conversions: prev.conversions + (s.conversions  ?? 0),
    })
  }

  return Array.from(aggById.values())
    .filter((c) => c.spend > 0)
    .map((c) => ({
      ...c,
      roas: c.spend > 0 ? c.revenue / c.spend : null,
      cpa:  c.conversions > 0 ? c.spend / c.conversions : null,
    }))
    .sort((a, b) => (b.roas ?? -1) - (a.roas ?? -1))
}

// ─── Page wrapper ─────────────────────────────────────────────────────────────

export default function Page() {
  return (
    <Suspense>
      <CampaignsPage />
    </Suspense>
  )
}

// ─── CampaignsPage ────────────────────────────────────────────────────────────

function CampaignsPage() {
  const router      = useRouter()
  const pathname    = usePathname()
  const searchParams = useSearchParams()

  function urlToBrand(b: string | null): Brand {
    return b === 'moom' ? 'moom' : 'bowa'
  }
  function urlToPeriod(p: string | null): Period {
    if (p === '30d')   return '30j'
    if (p === 'month') return 'mois'
    return '7j'
  }

  const [brand, setBrandState]   = useState<Brand>(() => urlToBrand(searchParams.get('brand')))
  const [period, setPeriodState] = useState<Period>(() => urlToPeriod(searchParams.get('period')))
  const [campaigns, setCampaigns] = useState<CampaignAgg[]>([])
  const [loading, setLoading]    = useState(true)

  const aiContext = useMemo(() => {
    if (loading || campaigns.length === 0) return null
    const sorted = [...campaigns].sort((a, b) => (b.spend ?? 0) - (a.spend ?? 0)).slice(0, 10)
    const lines = sorted.map((c) =>
      `${c.name} (${c.platform}) — dépense: ${c.spend.toFixed(0)}€, ROAS: ${c.roas?.toFixed(2) ?? 'N/A'}, conversions: ${c.conversions}, statut: ${c.status}`
    ).join('\n')
    const totalSpend = campaigns.reduce((s, c) => s + c.spend, 0)
    const totalConv  = campaigns.reduce((s, c) => s + c.conversions, 0)
    const avgRoas    = totalSpend > 0 ? (campaigns.reduce((s, c) => s + c.revenue, 0) / totalSpend).toFixed(2) : 'N/A'
    return `Marque: ${brand} | Période: ${period}\nTotal dépense: ${totalSpend.toFixed(0)}€ | ROAS moyen: ${avgRoas} | Conversions totales: ${totalConv}\n\nCampagnes:\n${lines}`
  }, [campaigns, loading, brand, period])

  function setBrand(b: Brand) {
    setBrandState(b)
    const params = new URLSearchParams()
    params.set('brand', b)
    params.set('period', period === '30j' ? '30d' : period === 'mois' ? 'month' : '7d')
    router.replace(`${pathname}?${params.toString()}`)
  }

  function setPeriod(p: Period) {
    setPeriodState(p)
    const params = new URLSearchParams()
    params.set('brand', brand)
    params.set('period', p === '30j' ? '30d' : p === 'mois' ? 'month' : '7d')
    router.replace(`${pathname}?${params.toString()}`)
  }

  const load = useCallback(async () => {
    setLoading(true)
    const { from, to } = getRange(period)
    const data = await fetchCampaignData(brand, from, to)
    setCampaigns(data)
    setLoading(false)
  }, [brand, period])

  useEffect(() => { load() }, [load])

  const brandTabs: { id: Brand; label: string }[] = [
    { id: 'bowa', label: 'Bowa' },
    { id: 'moom', label: 'Mōom' },
  ]

  const periodTabs: { id: Period; label: string }[] = [
    { id: '7j',   label: '7 j'     },
    { id: '30j',  label: '30 j'    },
    { id: 'mois', label: 'Ce mois' },
  ]

  return (
    <div className="min-h-screen bg-[#faf9f8]">
      <main className="max-w-7xl mx-auto px-6 py-8 space-y-5">

        {/* Header */}
        <div>
          <h1 className="text-xl font-bold text-[#1a1a18] tracking-tight">Campagnes</h1>
          <p className="text-sm text-[#6b6b63] mt-1">Performance par campagne publicitaire</p>
        </div>

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

        {/* AI Insights */}
        <AiInsights type="campaigns" brand={brand} context={aiContext} />

        {/* Table */}
        <CampaignsTable data={campaigns} loading={loading} />

      </main>
    </div>
  )
}
