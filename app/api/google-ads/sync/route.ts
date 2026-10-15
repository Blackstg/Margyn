import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

export const maxDuration = 60
import {
  getGoogleAccessToken,
  fetchCampaigns,
  fetchCampaignStats,
  normalizeCampaignStats,
  aggregateAdSpends,
  type GoogleAdsConfig,
} from '@/lib/google-ads'
import { googleAdsCustomerId } from '@/lib/tenant/integrations'

// ─── Store configs ────────────────────────────────────────────────────────────

const BRANDS = ['bowa', 'moom']

// customer_id depuis tenant_integrations (DB-first + fallback env). OAuth global en env.
async function buildStores(brands: string[]): Promise<GoogleAdsConfig[]> {
  const list = await Promise.all(brands.map(async (brand) => {
    const customerId = await googleAdsCustomerId(brand)
    return customerId ? { customerId, brand } as GoogleAdsConfig : null
  }))
  return list.filter((s): s is GoogleAdsConfig => s !== null)
}

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

// Vercel cron jobs send GET requests.
// On RE-TIRE une fenêtre glissante de 30 jours (pas seulement hier) : les
// conversions Google sont rattachées à la date du CLIC et mûrissent pendant
// des jours/semaines après coup (un clic du 1er qui convertit le 5 vient
// gonfler la valeur du 1er). Comme l'upsert est onConflict (date,platform,brand),
// chaque passage écrase l'ancien snapshot par la valeur mûrie → le ROAS Steero
// converge vers celui de l'UI Google au lieu de rester figé sous-évalué.
export async function GET(req: NextRequest) {
  const today    = new Date()
  const backfill = new Date(today)
  backfill.setDate(backfill.getDate() - 30)

  const url = new URL(req.url)
  url.searchParams.set('from', fmtDate(backfill))
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

  const stores = await buildStores(brandFilter ? [brandFilter] : BRANDS)

  // Get access token once — shared across both stores
  let accessToken: string
  try {
    accessToken = await getGoogleAccessToken()
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: `Auth failed: ${err instanceof Error ? err.message : String(err)}` },
      { status: 500 }
    )
  }

  const supabase = getSupabase()
  const results: Record<string, {
    campaigns?: number
    campaign_stats?: number
    ad_spends?: number
    error?: string
  }> = {}

  for (const store of stores) {
    try {
      // ── 1. Campaigns ──────────────────────────────────────────────────────
      const campaigns = await fetchCampaigns(store, accessToken)

      if (campaigns.length > 0) {
        const { error } = await supabase
          .from('campaigns')
          .upsert(
            campaigns.map((c) => ({
              external_id: `google_${c.externalId}`,
              platform: 'google',
              brand: store.brand,
              name: c.name,
              status: c.status,
              daily_budget: c.dailyBudgetMicros != null
                ? c.dailyBudgetMicros / 1_000_000
                : null,
            })),
            { onConflict: 'external_id' }
          )
        if (error) throw new Error(`campaigns: ${error.message}`)
      }

      // ── 2. Campaign stats ─────────────────────────────────────────────────
      const rawStats = await fetchCampaignStats(store, accessToken, dateFrom, dateTo)
      const normalizedStats = normalizeCampaignStats(rawStats)

      let campaignStatsCount = 0
      if (normalizedStats.length > 0) {
        // Resolve campaign UUIDs from external_ids
        const extIds = [...new Set(normalizedStats.map((s) => `google_${s.external_id}`))]
        const { data: dbCampaigns } = await supabase
          .from('campaigns')
          .select('id, external_id')
          .in('external_id', extIds)

        const idMap = new Map((dbCampaigns ?? []).map((c) => [c.external_id, c.id as string]))

        const statsRows = normalizedStats
          .map((s) => {
            const campaignId = idMap.get(`google_${s.external_id}`)
            if (!campaignId) return null
            return {
              campaign_id: campaignId,
              date: s.date,
              spend: s.spend,
              impressions: s.impressions,
              clicks: s.clicks,
              conversions: Math.round(s.conversions),
              revenue: s.revenue,
              cpa: s.cpa,
              cpm: s.cpm,
              ctr: s.ctr,
              roas: s.roas,
            }
          })
          .filter((r): r is NonNullable<typeof r> => r !== null)

        if (statsRows.length > 0) {
          // Collect unique (campaign_id, date) pairs for this batch
          const campaignIds = [...new Set(statsRows.map((r) => r.campaign_id))]
          const dates = [...new Set(statsRows.map((r) => r.date))]

          // Delete existing rows for this period to allow clean re-insert
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
      const adSpends = aggregateAdSpends(rawStats, store.brand)
      let adSpendsCount = 0

      if (adSpends.length > 0) {
        const { error } = await supabase
          .from('ad_spends')
          .upsert(adSpends, { onConflict: 'date,platform,brand' })
        if (error) throw new Error(`ad_spends: ${error.message}`)
        adSpendsCount = adSpends.length
      }

      console.log(
        `[${store.brand}] Google Ads sync OK:` +
        ` ${campaigns.length} campaigns, ${campaignStatsCount} stats, ${adSpendsCount} spends`
      )

      results[store.brand] = {
        campaigns: campaigns.length,
        campaign_stats: campaignStatsCount,
        ad_spends: adSpendsCount,
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      console.error(`[${store.brand}] Google Ads sync error: ${msg}`)
      results[store.brand] = { error: msg }
    }
  }

  const hasErrors = Object.values(results).some((r) => r.error)
  return NextResponse.json(
    { ok: !hasErrors, range: { from: dateFrom, to: dateTo }, results },
    { status: hasErrors ? 207 : 200 }
  )
}
