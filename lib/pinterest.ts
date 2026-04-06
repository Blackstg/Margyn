const PINTEREST_BASE = 'https://api.pinterest.com/v5'

// ─── Config ───────────────────────────────────────────────────────────────────

export interface PinterestConfig {
  adAccountId: string
  accessToken: string
  brand: string
}

// ─── Raw API types ────────────────────────────────────────────────────────────

interface PinterestCampaignRaw {
  id: string
  name: string
  status: string
}

interface PinterestAnalyticsRow {
  DATE: string
  CAMPAIGN_ID: string
  SPEND_IN_MICRO_DOLLAR: number
  PAID_IMPRESSION: number
  CLICKTHROUGH_1: number
  TOTAL_CHECKOUT: number
  TOTAL_CHECKOUT_VALUE_IN_MICRO_DOLLAR: number
  TOTAL_WEB_CHECKOUT: number
  TOTAL_WEB_CHECKOUT_VALUE_IN_MICRO_DOLLAR: number
}

interface PinterestAccountRow {
  DATE: string
  AD_ACCOUNT_ID: string
  SPEND_IN_MICRO_DOLLAR: number
  PAID_IMPRESSION?: number
  CLICKTHROUGH_1?: number
  TOTAL_CHECKOUT?: number
  TOTAL_CHECKOUT_VALUE_IN_MICRO_DOLLAR?: number
  TOTAL_WEB_CHECKOUT?: number
  TOTAL_WEB_CHECKOUT_VALUE_IN_MICRO_DOLLAR?: number
}

// ─── Exported types ───────────────────────────────────────────────────────────

export interface RawPinterestCampaign {
  externalId: string
  name: string
  status: string
}

export interface RawPinterestStat {
  externalId: string
  date: string
  spend: number
  impressions: number
  clicks: number
  conversions: number
  revenue: number
}

export interface NormalizedPinterestStat {
  external_id: string
  date: string
  spend: number
  impressions: number
  clicks: number
  conversions: number
  revenue: number
  cpa: number | null
  roas: number | null
}

export interface NormalizedPinterestAdSpend {
  date: string
  platform: 'pinterest'
  brand: string
  spend: number
  impressions: number
  clicks: number
  conversions: number
  revenue: number
}

// ─── Pagination helper ────────────────────────────────────────────────────────

async function pinterestGet<T>(
  path: string,
  params: Record<string, string | string[]>,
  accessToken: string
): Promise<T[]> {
  const results: T[] = []
  const url = new URL(`${PINTEREST_BASE}/${path}`)

  for (const [k, v] of Object.entries(params)) {
    if (Array.isArray(v)) {
      for (const item of v) url.searchParams.append(k, item)
    } else {
      url.searchParams.set(k, v)
    }
  }

  let cursor: string | null = null

  do {
    const fetchUrl = new URL(url.toString())
    if (cursor) fetchUrl.searchParams.set('bookmark', cursor)

    const res = await fetch(fetchUrl.toString(), {
      headers: { Authorization: `Bearer ${accessToken}` },
      cache: 'no-store',
    })
    const data = await res.json() as {
      items?: T[]
      bookmark?: string | null
      code?: number
      message?: string
    }

    if (!res.ok) {
      throw new Error(`Pinterest API ${res.status}: ${data.message ?? JSON.stringify(data)}`)
    }

    if (data.items) results.push(...data.items)
    cursor = data.bookmark ?? null
  } while (cursor)

  return results
}

// ─── fetchCampaigns — ALL statuses ────────────────────────────────────────────

export async function fetchPinterestCampaigns(
  config: PinterestConfig
): Promise<RawPinterestCampaign[]> {
  // Fetch all statuses so campaign_stats covers every campaign that could have spend
  const rows = await pinterestGet<PinterestCampaignRaw>(
    `ad_accounts/${config.adAccountId}/campaigns`,
    { page_size: '250' },
    config.accessToken
  )

  return rows.map((r) => ({
    externalId: r.id,
    name: r.name,
    status: r.status.toLowerCase(),
  }))
}

// ─── fetchPinterestAccountSpend — account-level daily analytics ───────────────
// Uses /ad_accounts/{id}/analytics which aggregates ALL campaigns regardless of
// status, giving the correct spend total (campaign endpoint misses many campaigns).

export async function fetchPinterestAccountSpend(
  config: PinterestConfig,
  dateFrom: string,
  dateTo: string
): Promise<NormalizedPinterestAdSpend[]> {
  const url = new URL(`${PINTEREST_BASE}/ad_accounts/${config.adAccountId}/analytics`)
  url.searchParams.set('start_date', dateFrom)
  url.searchParams.set('end_date', dateTo)
  url.searchParams.set('granularity', 'DAY')
  for (const col of [
    'SPEND_IN_MICRO_DOLLAR',
    'PAID_IMPRESSION',
    'CLICKTHROUGH_1',
    'TOTAL_CHECKOUT',
    'TOTAL_CHECKOUT_VALUE_IN_MICRO_DOLLAR',
    'TOTAL_WEB_CHECKOUT',
    'TOTAL_WEB_CHECKOUT_VALUE_IN_MICRO_DOLLAR',
  ]) url.searchParams.append('columns', col)

  const res = await fetch(url.toString(), {
    headers: { Authorization: `Bearer ${config.accessToken}` },
    cache: 'no-store',
  })
  if (!res.ok) {
    const err = await res.text()
    throw new Error(`Pinterest account analytics ${res.status}: ${err}`)
  }

  const rows = await res.json() as PinterestAccountRow[]

  return rows
    .filter(r => r.DATE && (r.SPEND_IN_MICRO_DOLLAR ?? 0) > 0)
    .map(r => ({
      date:        r.DATE,
      platform:    'pinterest' as const,
      brand:       config.brand,
      spend:       round((r.SPEND_IN_MICRO_DOLLAR ?? 0) / 1_000_000),
      impressions: r.PAID_IMPRESSION ?? 0,
      clicks:      r.CLICKTHROUGH_1 ?? 0,
      // Combine web + app checkouts
      conversions: Math.round((r.TOTAL_WEB_CHECKOUT ?? 0) + (r.TOTAL_CHECKOUT ?? 0)),
      revenue:     round(((r.TOTAL_WEB_CHECKOUT_VALUE_IN_MICRO_DOLLAR ?? 0) + (r.TOTAL_CHECKOUT_VALUE_IN_MICRO_DOLLAR ?? 0)) / 1_000_000),
    }))
}

// ─── fetchCampaignAnalytics — campaign-level stats (for campaign_stats table) ─

export async function fetchPinterestInsights(
  config: PinterestConfig,
  campaignIds: string[],
  dateFrom: string,
  dateTo: string
): Promise<RawPinterestStat[]> {
  if (campaignIds.length === 0) return []

  // Pinterest analytics endpoint — batch in groups of 25 to avoid query string limits
  const BATCH = 25
  const allRows: RawPinterestStat[] = []

  for (let i = 0; i < campaignIds.length; i += BATCH) {
    const batch = campaignIds.slice(i, i + BATCH)

    const url = new URL(`${PINTEREST_BASE}/ad_accounts/${config.adAccountId}/campaigns/analytics`)
    url.searchParams.set('start_date', dateFrom)
    url.searchParams.set('end_date', dateTo)
    url.searchParams.set('granularity', 'DAY')
    for (const id of batch) url.searchParams.append('campaign_ids', id)
    for (const col of [
      'SPEND_IN_MICRO_DOLLAR',
      'PAID_IMPRESSION',
      'CLICKTHROUGH_1',
      'TOTAL_CHECKOUT',
      'TOTAL_CHECKOUT_VALUE_IN_MICRO_DOLLAR',
      'TOTAL_WEB_CHECKOUT',
      'TOTAL_WEB_CHECKOUT_VALUE_IN_MICRO_DOLLAR',
    ]) url.searchParams.append('columns', col)

    const res = await fetch(url.toString(), {
      headers: { Authorization: `Bearer ${config.accessToken}` },
      cache: 'no-store',
    })

    if (!res.ok) {
      const err = await res.text()
      throw new Error(`Pinterest analytics ${res.status}: ${err}`)
    }

    const rows = await res.json() as PinterestAnalyticsRow[]

    for (const r of rows) {
      allRows.push({
        externalId:  r.CAMPAIGN_ID,
        date:        r.DATE,
        spend:       (r.SPEND_IN_MICRO_DOLLAR ?? 0) / 1_000_000,
        impressions: r.PAID_IMPRESSION ?? 0,
        clicks:      r.CLICKTHROUGH_1 ?? 0,
        conversions: (r.TOTAL_WEB_CHECKOUT ?? 0) + (r.TOTAL_CHECKOUT ?? 0),
        revenue:     ((r.TOTAL_WEB_CHECKOUT_VALUE_IN_MICRO_DOLLAR ?? 0) + (r.TOTAL_CHECKOUT_VALUE_IN_MICRO_DOLLAR ?? 0)) / 1_000_000,
      })
    }
  }

  console.log(`[${config.brand}] Pinterest campaign rows: ${allRows.length} for ${dateFrom}→${dateTo}`)
  return allRows
}

// ─── normalizeCampaignStats ───────────────────────────────────────────────────

export function normalizePinterestStats(stats: RawPinterestStat[]): NormalizedPinterestStat[] {
  return stats.map((s) => ({
    external_id: s.externalId,
    date: s.date,
    spend: round(s.spend),
    impressions: s.impressions,
    clicks: s.clicks,
    conversions: Math.round(s.conversions),
    revenue: round(s.revenue),
    cpa: s.conversions > 0 ? round(s.spend / s.conversions) : null,
    roas: s.spend > 0 ? round(s.revenue / s.spend) : null,
  }))
}

// ─── aggregatePinterestAdSpends — kept for backward compat ────────────────────
// (no longer used for ad_spends — replaced by fetchPinterestAccountSpend)

export function aggregatePinterestAdSpends(
  stats: RawPinterestStat[],
  brand: string
): NormalizedPinterestAdSpend[] {
  const byDate = new Map<string, {
    spend: number; impressions: number; clicks: number
    conversions: number; revenue: number
  }>()

  for (const s of stats) {
    const prev = byDate.get(s.date) ?? {
      spend: 0, impressions: 0, clicks: 0, conversions: 0, revenue: 0,
    }
    byDate.set(s.date, {
      spend:       prev.spend       + s.spend,
      impressions: prev.impressions + s.impressions,
      clicks:      prev.clicks      + s.clicks,
      conversions: prev.conversions + s.conversions,
      revenue:     prev.revenue     + s.revenue,
    })
  }

  return Array.from(byDate.entries()).map(([date, d]) => ({
    date,
    platform: 'pinterest' as const,
    brand,
    spend:       round(d.spend),
    impressions: d.impressions,
    clicks:      d.clicks,
    conversions: Math.round(d.conversions),
    revenue:     round(d.revenue),
  }))
}

// ─── Utils ────────────────────────────────────────────────────────────────────

function round(n: number, decimals = 2): number {
  return Math.round(n * 10 ** decimals) / 10 ** decimals
}
