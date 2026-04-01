const META_API_VERSION = 'v21.0'
const META_BASE = `https://graph.facebook.com/${META_API_VERSION}`

// ─── Config ───────────────────────────────────────────────────────────────────

export interface MetaAdsConfig {
  adAccountId: string  // e.g. 'act_123456'
  accessToken: string
  brand: string
}

// ─── Raw API types ────────────────────────────────────────────────────────────

interface MetaCampaignRaw {
  id: string
  name: string
  status: string
  daily_budget?: string
}

interface MetaAction {
  action_type: string
  value: string
}

interface MetaInsightRow {
  campaign_id: string
  campaign_name: string
  date_start: string
  spend: string
  impressions: string
  clicks: string
  cpm?: string
  ctr?: string
  actions?: MetaAction[]
  action_values?: MetaAction[]
}

// ─── Exported types ───────────────────────────────────────────────────────────

export interface RawMetaCampaign {
  externalId: string
  name: string
  status: string
  dailyBudget: number | null
}

export interface RawMetaStat {
  externalId: string
  name: string
  date: string
  spend: number
  impressions: number
  clicks: number
  conversions: number
  revenue: number
  cpm: number
  ctr: number
}

export interface NormalizedMetaStat {
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

export interface NormalizedMetaAdSpend {
  date: string
  platform: 'meta'
  brand: string
  spend: number
  impressions: number
  clicks: number
  conversions: number
  revenue: number
}

// ─── Pagination helper ────────────────────────────────────────────────────────

async function metaGetAll<T>(
  path: string,
  params: Record<string, string>,
  accessToken: string
): Promise<T[]> {
  const results: T[] = []
  const init = new URL(`${META_BASE}/${path}`)
  for (const [k, v] of Object.entries(params)) init.searchParams.set(k, v)
  init.searchParams.set('access_token', accessToken)

  let url: string | null = init.toString()

  while (url) {
    const res = await fetch(url, { cache: 'no-store' })
    const data = await res.json() as {
      data?: T[]
      error?: { message: string; code: number }
      paging?: { next?: string }
    }

    if (!res.ok || data.error) {
      throw new Error(`Meta API ${res.status}: ${data.error?.message ?? JSON.stringify(data)}`)
    }

    if (data.data) results.push(...data.data)
    url = data.paging?.next ?? null
  }

  return results
}

// ─── Purchase action types ────────────────────────────────────────────────────

const PURCHASE_TYPES = new Set([
  'offsite_conversion.fb_pixel_purchase',
  'onsite_conversion.purchase',
  'purchase',
  'omni_purchase',
])

function sumPurchaseActions(actions: MetaAction[] = []): number {
  return actions
    .filter((a) => PURCHASE_TYPES.has(a.action_type))
    .reduce((s, a) => s + parseFloat(a.value ?? '0'), 0)
}

// ─── fetchCampaigns ───────────────────────────────────────────────────────────

export async function fetchMetaCampaigns(
  config: MetaAdsConfig
): Promise<RawMetaCampaign[]> {
  const rows = await metaGetAll<MetaCampaignRaw>(
    `${config.adAccountId}/campaigns`,
    {
      fields: 'id,name,status,daily_budget',
      filtering: JSON.stringify([
        { field: 'effective_status', operator: 'IN', value: ['ACTIVE', 'PAUSED'] },
      ]),
      limit: '200',
    },
    config.accessToken
  )

  return rows.map((r) => ({
    externalId: r.id,
    name: r.name,
    status: r.status.toLowerCase(),
    dailyBudget: r.daily_budget != null ? parseInt(r.daily_budget) / 100 : null,
  }))
}

// ─── fetchCampaignInsights ────────────────────────────────────────────────────

export async function fetchMetaInsights(
  config: MetaAdsConfig,
  dateFrom: string,
  dateTo: string
): Promise<RawMetaStat[]> {
  const rows = await metaGetAll<MetaInsightRow>(
    `${config.adAccountId}/insights`,
    {
      level: 'campaign',
      fields: 'campaign_id,campaign_name,spend,impressions,clicks,cpm,ctr,actions,action_values',
      time_range: JSON.stringify({ since: dateFrom, until: dateTo }),
      time_increment: '1',
      action_attribution_windows: JSON.stringify(['7d_click', '1d_view']),
      limit: '500',
    },
    config.accessToken
  )

  console.log(`[${config.brand}] Meta raw rows: ${rows.length} for ${dateFrom}→${dateTo}`)

  return rows.map((r) => ({
    externalId: r.campaign_id,
    name: r.campaign_name,
    date: r.date_start,
    spend: parseFloat(r.spend ?? '0'),
    impressions: parseInt(r.impressions ?? '0'),
    clicks: parseInt(r.clicks ?? '0'),
    conversions: sumPurchaseActions(r.actions),
    revenue: sumPurchaseActions(r.action_values),
    cpm: parseFloat(r.cpm ?? '0'),
    ctr: parseFloat(r.ctr ?? '0') / 100, // Meta returns CTR as percentage
  }))
}

// ─── normalizeCampaignStats ───────────────────────────────────────────────────

export function normalizeMetaStats(stats: RawMetaStat[]): NormalizedMetaStat[] {
  return stats.map((s) => {
    const cpa = s.conversions > 0 ? round(s.spend / s.conversions) : null
    const roas = s.spend > 0 ? round(s.revenue / s.spend) : null
    const cpm = s.impressions > 0 ? round(s.cpm) : null
    const ctr = s.impressions > 0 ? round(s.ctr, 4) : null

    return {
      external_id: s.externalId,
      date: s.date,
      spend: round(s.spend),
      impressions: s.impressions,
      clicks: s.clicks,
      conversions: Math.round(s.conversions),
      revenue: round(s.revenue),
      cpa,
      cpm,
      ctr,
      roas,
    }
  })
}

// ─── aggregateAdSpends ────────────────────────────────────────────────────────

export function aggregateMetaAdSpends(
  stats: RawMetaStat[],
  brand: string
): NormalizedMetaAdSpend[] {
  const byDate = new Map<string, {
    spend: number; impressions: number; clicks: number
    conversions: number; revenue: number
  }>()

  for (const s of stats) {
    const prev = byDate.get(s.date) ?? {
      spend: 0, impressions: 0, clicks: 0, conversions: 0, revenue: 0,
    }
    byDate.set(s.date, {
      spend: prev.spend + s.spend,
      impressions: prev.impressions + s.impressions,
      clicks: prev.clicks + s.clicks,
      conversions: prev.conversions + s.conversions,
      revenue: prev.revenue + s.revenue,
    })
  }

  return Array.from(byDate.entries()).map(([date, d]) => ({
    date,
    platform: 'meta' as const,
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
