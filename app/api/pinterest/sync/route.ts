import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

// Reports API polling can take up to ~60s per brand; allow headroom for 2 brands in parallel
export const maxDuration = 300

import {
  fetchPinterestCampaigns,
  fetchPinterestInsights,
  fetchPinterestAccountSpend,
  type PinterestConfig,
} from '@/lib/pinterest'
import { checkAndRefreshToken } from '@/lib/pinterest-auth'

// ─── Store configs (no access token — fetched at runtime from Supabase) ───────

const STORES: Omit<PinterestConfig, 'accessToken'>[] = [
  { adAccountId: process.env.PINTEREST_AD_ACCOUNT_ID_BOWA!, brand: 'bowa' },
  { adAccountId: process.env.PINTEREST_AD_ACCOUNT_ID_MOOM!, brand: 'moom' },
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

export async function GET(req: NextRequest) {
  const today     = new Date()
  const yesterday = new Date(today)
  yesterday.setDate(yesterday.getDate() - 1)

  const url = new URL(req.url)
  url.searchParams.set('from', fmtDate(yesterday))
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
  const dateTo   = searchParams.get('to')   ?? searchParams.get('date') ?? fmtDate(yesterday)
  const brandFilter = searchParams.get('brand')

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
      // ── 0. Token — check expiry and refresh if < 5 days remaining ─────────
      const accessToken = await checkAndRefreshToken(store.brand)
      const storeWithToken: PinterestConfig = { ...store, accessToken }

      // ── 1. Campaigns ──────────────────────────────────────────────────────
      const campaigns = await fetchPinterestCampaigns(storeWithToken)

      if (campaigns.length > 0) {
        const { error } = await supabase
          .from('campaigns')
          .upsert(
            campaigns.map((c) => ({
              external_id: `pinterest_${c.externalId}`,
              platform: 'pinterest',
              brand: store.brand,
              name: c.name,
              status: c.status,
              daily_budget: null,
            })),
            { onConflict: 'external_id' }
          )
        if (error) throw new Error(`campaigns: ${error.message}`)
      }

      // ── 2. Campaign stats — Reports API (returns real conversion data) ─────
      const campaignIds = campaigns.map((c) => c.externalId)
      const normalizedStats = await fetchPinterestInsights(storeWithToken, campaignIds, dateFrom, dateTo)

      let campaignStatsCount = 0
      if (normalizedStats.length > 0) {
        const extIds = [...new Set(normalizedStats.map((s) => `pinterest_${s.external_id}`))]
        const { data: dbCampaigns } = await supabase
          .from('campaigns')
          .select('id, external_id')
          .in('external_id', extIds)

        const idMap = new Map((dbCampaigns ?? []).map((c) => [c.external_id, c.id as string]))

        const statsRows = normalizedStats
          .map((s) => {
            const campaignId = idMap.get(`pinterest_${s.external_id}`)
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
              cpm: null,
              ctr: null,
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

      // ── 3. Ad spends — account-level spend + aggregated conversions ───────
      const adSpends = await fetchPinterestAccountSpend(storeWithToken, dateFrom, dateTo, normalizedStats)
      let adSpendsCount = 0

      if (adSpends.length > 0) {
        const { error } = await supabase
          .from('ad_spends')
          .upsert(adSpends, { onConflict: 'date,platform,brand' })
        if (error) throw new Error(`ad_spends: ${error.message}`)
        adSpendsCount = adSpends.length
      }

      console.log(
        `[${store.brand}] Pinterest sync OK:` +
        ` ${campaigns.length} campaigns, ${campaignStatsCount} stats, ${adSpendsCount} spends`
      )

      results[store.brand] = {
        campaigns: campaigns.length,
        campaign_stats: campaignStatsCount,
        ad_spends: adSpendsCount,
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      console.error(`[${store.brand}] Pinterest sync error: ${msg}`)
      results[store.brand] = { error: msg }
    }
  }))

  const hasErrors = Object.values(results).some((r) => r.error)
  return NextResponse.json(
    { ok: !hasErrors, range: { from: dateFrom, to: dateTo }, results },
    { status: hasErrors ? 207 : 200 }
  )
}
