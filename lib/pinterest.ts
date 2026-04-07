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

interface PinterestAccountRow {
  DATE: string
  AD_ACCOUNT_ID: string
  SPEND_IN_MICRO_DOLLAR: number
  PAID_IMPRESSION?: number
  CLICKTHROUGH_1?: number
}

// ─── Exported types ───────────────────────────────────────────────────────────

export interface RawPinterestCampaign {
  externalId: string
  name: string
  status: string
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

// ─── Reports API — async submit → poll → download ─────────────────────────────
// The Analytics API silently drops all non-spend columns for this account.
// The Reports API returns actual conversion data.

interface PinterestReportRow {
  CAMPAIGN_ID: number
  DATE?: string
  SPEND_IN_MICRO_DOLLAR?: number
  PAID_IMPRESSION?: number
  CLICKTHROUGH_1?: number
  TOTAL_WEB_CHECKOUT?: number
  TOTAL_WEB_CHECKOUT_VALUE_IN_MICRO_DOLLAR?: number
  CHECKOUT_ROAS?: number
}

async function submitAndFetchReport(
  config: PinterestConfig,
  dateFrom: string,
  dateTo: string,
  granularity: 'DAY' | 'TOTAL'
): Promise<PinterestReportRow[]> {
  // 1. Submit async report
  const submitRes = await fetch(
    `${PINTEREST_BASE}/ad_accounts/${config.adAccountId}/reports`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${config.accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        start_date: dateFrom,
        end_date: dateTo,
        level: 'CAMPAIGN',
        report_format: 'JSON',
        granularity,
        // Use 30-day attribution to better match Pinterest Ads Manager defaults
        click_window_days: 30,
        engagement_window_days: 30,
        view_window_days: 30,
        columns: [
          'CAMPAIGN_ID',
          'SPEND_IN_MICRO_DOLLAR',
          'PAID_IMPRESSION',
          'CLICKTHROUGH_1',
          'TOTAL_WEB_CHECKOUT',
          'TOTAL_WEB_CHECKOUT_VALUE_IN_MICRO_DOLLAR',
          'CHECKOUT_ROAS',
        ],
      }),
      cache: 'no-store',
    }
  )

  if (!submitRes.ok) {
    const err = await submitRes.text()
    throw new Error(`Pinterest report submit ${submitRes.status}: ${err}`)
  }

  const { token } = await submitRes.json() as { token: string; report_status: string }

  // 2. Poll until FINISHED (max ~60s: 15 × 4s)
  let downloadUrl: string | null = null
  for (let attempt = 0; attempt < 15; attempt++) {
    await new Promise((r) => setTimeout(r, 4000))
    const pollRes = await fetch(
      `${PINTEREST_BASE}/ad_accounts/${config.adAccountId}/reports?token=${encodeURIComponent(token)}`,
      {
        headers: { Authorization: `Bearer ${config.accessToken}` },
        cache: 'no-store',
      }
    )
    const poll = await pollRes.json() as { report_status: string; url?: string }
    if (poll.report_status === 'FINISHED') { downloadUrl = poll.url ?? null; break }
    if (poll.report_status === 'FAILED') throw new Error('Pinterest report generation failed')
  }

  if (!downloadUrl) throw new Error('Pinterest report timed out after 60s')

  // 3. Download from S3 and flatten { campaign_id: [rows] } → flat array
  const s3Res = await fetch(downloadUrl, { cache: 'no-store' })
  const nested = await s3Res.json() as Record<string, PinterestReportRow[]>
  return Object.values(nested).flat()
}

// ─── fetchPinterestInsights — campaign-level daily stats ──────────────────────

export async function fetchPinterestInsights(
  config: PinterestConfig,
  _campaignIds: string[], // kept for compat — Reports API returns all campaigns
  dateFrom: string,
  dateTo: string
): Promise<NormalizedPinterestStat[]> {
  const rows = await submitAndFetchReport(config, dateFrom, dateTo, 'DAY')

  return rows
    .filter((r) => r.CAMPAIGN_ID && r.DATE && (r.SPEND_IN_MICRO_DOLLAR ?? 0) > 0)
    .map((r) => {
      const spend       = round((r.SPEND_IN_MICRO_DOLLAR ?? 0) / 1_000_000)
      const revenue     = round((r.TOTAL_WEB_CHECKOUT_VALUE_IN_MICRO_DOLLAR ?? 0) / 1_000_000)
      const conversions = Math.round(r.TOTAL_WEB_CHECKOUT ?? 0)
      return {
        external_id: String(r.CAMPAIGN_ID),
        date:        r.DATE!,
        spend,
        impressions: r.PAID_IMPRESSION ?? 0,
        clicks:      r.CLICKTHROUGH_1  ?? 0,
        conversions,
        revenue,
        cpa:  conversions > 0 ? round(spend / conversions) : null,
        roas: spend > 0 && revenue > 0 ? round(revenue / spend) : null,
      }
    })
}

// ─── fetchPinterestAccountSpend — account-level daily spend ──────────────────
// Uses /ad_accounts/{id}/analytics which reliably returns SPEND_IN_MICRO_DOLLAR.
// Impressions and clicks are also fetched here (account level is reliable for those).
// Conversions and revenue are aggregated from the Reports API data passed in.

export async function fetchPinterestAccountSpend(
  config: PinterestConfig,
  dateFrom: string,
  dateTo: string,
  campaignStats?: NormalizedPinterestStat[]
): Promise<NormalizedPinterestAdSpend[]> {
  // Account-level analytics for spend (most reliable total)
  const url = new URL(`${PINTEREST_BASE}/ad_accounts/${config.adAccountId}/analytics`)
  url.searchParams.set('start_date', dateFrom)
  url.searchParams.set('end_date', dateTo)
  url.searchParams.set('granularity', 'DAY')
  for (const col of ['SPEND_IN_MICRO_DOLLAR', 'PAID_IMPRESSION', 'CLICKTHROUGH_1']) {
    url.searchParams.append('columns', col)
  }

  const res = await fetch(url.toString(), {
    headers: { Authorization: `Bearer ${config.accessToken}` },
    cache: 'no-store',
  })
  if (!res.ok) {
    const err = await res.text()
    throw new Error(`Pinterest account analytics ${res.status}: ${err}`)
  }

  const accountRows = await res.json() as PinterestAccountRow[]

  // If campaignStats provided, aggregate conversions+revenue from there per date
  const convByDate = new Map<string, { conversions: number; revenue: number }>()
  if (campaignStats) {
    for (const s of campaignStats) {
      const prev = convByDate.get(s.date) ?? { conversions: 0, revenue: 0 }
      convByDate.set(s.date, {
        conversions: prev.conversions + s.conversions,
        revenue:     round(prev.revenue + s.revenue),
      })
    }
  }

  return accountRows
    .filter((r) => r.DATE && (r.SPEND_IN_MICRO_DOLLAR ?? 0) > 0)
    .map((r) => {
      const agg = convByDate.get(r.DATE) ?? { conversions: 0, revenue: 0 }
      return {
        date:        r.DATE,
        platform:    'pinterest' as const,
        brand:       config.brand,
        spend:       round((r.SPEND_IN_MICRO_DOLLAR ?? 0) / 1_000_000),
        impressions: r.PAID_IMPRESSION ?? 0,
        clicks:      r.CLICKTHROUGH_1  ?? 0,
        conversions: agg.conversions,
        revenue:     agg.revenue,
      }
    })
}

// ─── Utils ────────────────────────────────────────────────────────────────────

function round(n: number, decimals = 2): number {
  return Math.round(n * 10 ** decimals) / 10 ** decimals
}
