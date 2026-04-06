import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

export const maxDuration = 60
import {
  fetchMetaCampaigns,
  fetchMetaInsights,
  normalizeMetaStats,
  aggregateMetaAdSpends,
  type MetaAdsConfig,
} from '@/lib/meta'

// ─── Store configs ────────────────────────────────────────────────────────────

const STORES: MetaAdsConfig[] = [
  {
    adAccountId: process.env.META_BOWA_AD_ACCOUNT_ID!,
    accessToken: process.env.META_BOWA_ACCESS_TOKEN!,
    brand: 'bowa',
  },
  {
    adAccountId: process.env.META_MOOM_AD_ACCOUNT_ID!,
    accessToken: process.env.META_MOOM_ACCESS_TOKEN!,
    brand: 'moom',
  },
  {
    adAccountId: process.env.META_KROM_AD_ACCOUNT_ID!,
    accessToken: process.env.META_KROM_ACCESS_TOKEN!,
    brand: 'krom',
  },
]

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}

function isAuthorized(req: NextRequest): boolean {
  const header = req.headers.get('authorization') ?? ''
  const token = header.startsWith('Bearer ') ? header.slice(7) : header
  return token === process.env.CRON_SECRET
}

function fmtDate(d: Date): string {
  return d.toISOString().slice(0, 10)
}

// ─── Cron entry-point (GET) ───────────────────────────────────────────────────

// Vercel cron jobs send GET requests — sync the last 48 h (yesterday + today)
export async function GET(req: NextRequest) {
  const today     = new Date()
  const twoDaysAgo = new Date(today)
  twoDaysAgo.setDate(twoDaysAgo.getDate() - 1)          // yesterday → today window

  const url = new URL(req.url)
  url.searchParams.set('from', fmtDate(twoDaysAgo))
  url.searchParams.set('to',   fmtDate(today))

  return POST(new NextRequest(url, { headers: req.headers }))
}

// ─── Handler ──────────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { searchParams } = new URL(req.url)
  const yesterday = new Date()
  yesterday.setDate(yesterday.getDate() - 1)

  const dateFrom = searchParams.get('from') ?? searchParams.get('date') ?? fmtDate(yesterday)
  const dateTo = searchParams.get('to') ?? searchParams.get('date') ?? fmtDate(yesterday)
  const brandFilter = searchParams.get('brand') // optional: 'bowa' | 'moom'

  const stores = brandFilter
    ? STORES.filter((s) => s.brand === brandFilter)
    : STORES

  const supabase = getSupabase()
  const results: Record<string, {
    campaigns?: number
    campaign_stats?: number
    ad_spends?: number
    error?: string
  }> = {}

  await Promise.all(stores.map(async (store) => {
    try {
      // ── 1. Campaigns ──────────────────────────────────────────────────────
      const campaigns = await fetchMetaCampaigns(store)

      if (campaigns.length > 0) {
        const { error } = await supabase
          .from('campaigns')
          .upsert(
            campaigns.map((c) => ({
              external_id: `meta_${c.externalId}`,
              platform: 'meta',
              brand: store.brand,
              name: c.name,
              status: c.status,
              daily_budget: c.dailyBudget,
            })),
            { onConflict: 'external_id' }
          )
        if (error) throw new Error(`campaigns: ${error.message}`)
      }

      // ── 2. Campaign stats ─────────────────────────────────────────────────
      const rawStats = await fetchMetaInsights(store, dateFrom, dateTo)
      const normalizedStats = normalizeMetaStats(rawStats)

      let campaignStatsCount = 0
      if (normalizedStats.length > 0) {
        // Resolve campaign UUIDs from external_ids
        const extIds = [...new Set(normalizedStats.map((s) => `meta_${s.external_id}`))]
        const { data: dbCampaigns } = await supabase
          .from('campaigns')
          .select('id, external_id')
          .in('external_id', extIds)

        const idMap = new Map((dbCampaigns ?? []).map((c) => [c.external_id, c.id as string]))

        const statsRows = normalizedStats
          .map((s) => {
            const campaignId = idMap.get(`meta_${s.external_id}`)
            if (!campaignId) return null
            return {
              campaign_id: campaignId,
              date: s.date,
              spend: s.spend,
              impressions: s.impressions,
              clicks: s.clicks,
              conversions: s.conversions,
              revenue: s.revenue,
              cpa: s.cpa,
              cpm: s.cpm,
              ctr: s.ctr,
              roas: s.roas,
            }
          })
          .filter((r): r is NonNullable<typeof r> => r !== null)

        if (statsRows.length > 0) {
          const campaignIds = Array.from(new Set(statsRows.map((r) => r.campaign_id)))
          const dates = Array.from(new Set(statsRows.map((r) => r.date))).sort()

          const { error: delError } = await supabase
            .from('campaign_stats')
            .delete()
            .in('campaign_id', campaignIds)
            .gte('date', dates[0])
            .lte('date', dates[dates.length - 1])
          if (delError) throw new Error(`campaign_stats delete: ${delError.message}`)

          const { error: insError } = await supabase
            .from('campaign_stats')
            .insert(statsRows)
          if (insError) throw new Error(`campaign_stats insert: ${insError.message}`)
          campaignStatsCount = statsRows.length
        }
      }

      // ── 3. Ad spends (daily aggregate) ────────────────────────────────────
      const adSpends = aggregateMetaAdSpends(rawStats, store.brand)
      let adSpendsCount = 0

      if (adSpends.length > 0) {
        const { error } = await supabase
          .from('ad_spends')
          .upsert(adSpends, { onConflict: 'date,platform,brand' })
        if (error) throw new Error(`ad_spends: ${error.message}`)
        adSpendsCount = adSpends.length
      }

      console.log(
        `[${store.brand}] Meta sync OK:` +
        ` ${campaigns.length} campaigns, ${campaignStatsCount} stats, ${adSpendsCount} spends`
      )

      results[store.brand] = {
        campaigns: campaigns.length,
        campaign_stats: campaignStatsCount,
        ad_spends: adSpendsCount,
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      console.error(`[${store.brand}] Meta sync error: ${msg}`)
      results[store.brand] = { error: msg }
    }
  }))

  const hasErrors = Object.values(results).some((r) => r.error)
  return NextResponse.json(
    { ok: !hasErrors, range: { from: dateFrom, to: dateTo }, results },
    { status: hasErrors ? 207 : 200 }
  )
}
