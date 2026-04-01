export interface GoogleAdsConfig {
  customerId: string
  brand: string
}

// ─── Raw API types ────────────────────────────────────────────────────────────

interface GaqlRow {
  campaign?: {
    id?: string
    name?: string
    status?: string
    resourceName?: string
  }
  campaignBudget?: {
    amountMicros?: string
  }
  metrics?: {
    costMicros?: string
    impressions?: string
    clicks?: string
    conversions?: number
    conversionsValue?: number
    costPerConversion?: string
  }
  segments?: {
    date?: string
  }
}

export interface RawCampaign {
  externalId: string
  name: string
  status: string
  dailyBudgetMicros: number | null
}

export interface RawCampaignStat {
  externalId: string
  date: string
  spendMicros: number
  impressions: number
  clicks: number
  conversions: number
  conversionsValue: number
}

export interface NormalizedCampaignStat {
  external_id: string
  date: string
  spend: number
  impressions: number
  clicks: number
  conversions: number
  revenue: number
  cpa: number | null
  cpm: number | null
  ctr: number | null
  roas: number | null
}

export interface NormalizedAdSpend {
  date: string
  platform: 'google'
  brand: string
  spend: number
  impressions: number
  clicks: number
  conversions: number
  revenue: number
}

// ─── Auth ─────────────────────────────────────────────────────────────────────

export async function getGoogleAccessToken(): Promise<string> {
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      client_id: process.env.GOOGLE_ADS_CLIENT_ID!,
      client_secret: process.env.GOOGLE_ADS_CLIENT_SECRET!,
      refresh_token: process.env.GOOGLE_ADS_REFRESH_TOKEN!,
    }),
  })
  if (!res.ok) {
    const body = await res.text()
    throw new Error(`Google token refresh failed: ${body}`)
  }
  const { access_token } = await res.json() as { access_token: string }
  return access_token
}

// ─── GAQL query with pagination ───────────────────────────────────────────────

async function gaqlSearch(
  accessToken: string,
  customerId: string,
  query: string
): Promise<GaqlRow[]> {
  // login-customer-id = MCC manager account (required for sub-account access
  // and mandatory in Explorer/test mode developer tokens)
  const loginCustomerId = process.env.GOOGLE_ADS_MCC_ID ?? customerId

  const rows: GaqlRow[] = []
  let pageToken: string | undefined

  do {
    const body: Record<string, string> = { query }
    if (pageToken) body.pageToken = pageToken

    const res = await fetch(
      `https://googleads.googleapis.com/v20/customers/${customerId}/googleAds:search`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'developer-token': process.env.GOOGLE_ADS_DEVELOPER_TOKEN!,
          'login-customer-id': loginCustomerId,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
        cache: 'no-store',
      }
    )

    if (!res.ok) {
      const err = await res.text()
      throw new Error(`Google Ads API ${res.status}: ${err}`)
    }

    const data = await res.json() as { results?: GaqlRow[]; nextPageToken?: string }
    if (data.results) rows.push(...data.results)
    pageToken = data.nextPageToken
  } while (pageToken)

  return rows
}

// ─── fetchCampaigns ───────────────────────────────────────────────────────────

export async function fetchCampaigns(
  config: GoogleAdsConfig,
  accessToken: string
): Promise<RawCampaign[]> {
  const rows = await gaqlSearch(
    accessToken,
    config.customerId,
    `SELECT campaign.id, campaign.name, campaign.status, campaign_budget.amount_micros
     FROM campaign
     WHERE campaign.status != 'REMOVED'`
  )

  return rows.map((r) => ({
    externalId: r.campaign?.id ?? '',
    name: r.campaign?.name ?? '',
    status: (r.campaign?.status ?? '').toLowerCase().replace('_', ' '),
    dailyBudgetMicros: r.campaignBudget?.amountMicros != null
      ? parseInt(r.campaignBudget.amountMicros)
      : null,
  }))
}

// ─── fetchCampaignStats ───────────────────────────────────────────────────────

export async function fetchCampaignStats(
  config: GoogleAdsConfig,
  accessToken: string,
  dateFrom: string,
  dateTo: string
): Promise<RawCampaignStat[]> {
  const rows = await gaqlSearch(
    accessToken,
    config.customerId,
    `SELECT
       campaign.id,
       segments.date,
       metrics.cost_micros,
       metrics.impressions,
       metrics.clicks,
       metrics.conversions,
       metrics.conversions_value,
       metrics.cost_per_conversion
     FROM campaign
     WHERE segments.date BETWEEN '${dateFrom}' AND '${dateTo}'
       AND campaign.status != 'REMOVED'
     ORDER BY segments.date`
  )

  console.log(`[${config.brand}] Google Ads raw rows: ${rows.length} for ${dateFrom}→${dateTo}`)

  return rows.map((r) => ({
    externalId: r.campaign?.id ?? '',
    date: r.segments?.date ?? '',
    spendMicros: parseInt(r.metrics?.costMicros ?? '0'),
    impressions: parseInt(r.metrics?.impressions ?? '0'),
    clicks: parseInt(r.metrics?.clicks ?? '0'),
    conversions: r.metrics?.conversions ?? 0,
    conversionsValue: r.metrics?.conversionsValue ?? 0,
  }))
}

// ─── normalizeCampaignStats ───────────────────────────────────────────────────

export function normalizeCampaignStats(
  stats: RawCampaignStat[]
): NormalizedCampaignStat[] {
  return stats.map((s) => {
    const spend = round(s.spendMicros / 1_000_000)
    const cpa = s.conversions > 0 ? round(spend / s.conversions) : null
    const cpm = s.impressions > 0 ? round((spend / s.impressions) * 1000) : null
    const ctr = s.impressions > 0 ? round(s.clicks / s.impressions, 4) : null
    const roas = spend > 0 ? round(s.conversionsValue / spend) : null

    return {
      external_id: s.externalId,
      date: s.date,
      spend,
      impressions: s.impressions,
      clicks: s.clicks,
      conversions: s.conversions,
      revenue: round(s.conversionsValue),
      cpa,
      cpm,
      ctr,
      roas,
    }
  })
}

// ─── aggregateAdSpends ────────────────────────────────────────────────────────

export function aggregateAdSpends(
  stats: RawCampaignStat[],
  brand: string
): NormalizedAdSpend[] {
  const byDate = new Map<string, {
    spend: number; impressions: number; clicks: number
    conversions: number; revenue: number
  }>()

  for (const s of stats) {
    const prev = byDate.get(s.date) ?? {
      spend: 0, impressions: 0, clicks: 0, conversions: 0, revenue: 0,
    }
    byDate.set(s.date, {
      spend: prev.spend + s.spendMicros / 1_000_000,
      impressions: prev.impressions + s.impressions,
      clicks: prev.clicks + s.clicks,
      conversions: prev.conversions + s.conversions,
      revenue: prev.revenue + s.conversionsValue,
    })
  }

  return Array.from(byDate.entries()).map(([date, d]) => ({
    date,
    platform: 'google' as const,
    brand,
    spend: round(d.spend),
    impressions: d.impressions,
    clicks: d.clicks,
    conversions: Math.round(d.conversions),
    revenue: round(d.revenue),
  }))
}

// ─── Utils ────────────────────────────────────────────────────────────────────

function round(n: number, decimals = 2): number {
  return Math.round(n * 10 ** decimals) / 10 ** decimals
}
