// POST  /api/cron/sync-creatives  — manual trigger (from admin)
// GET   /api/cron/sync-creatives  — Vercel cron (auto 2×/day)
//
// Syncs Meta ad-level creative data + daily insights into:
//   • ad_creatives  — creative metadata
//   • creative_stats — daily stats

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

export const maxDuration = 300
export const dynamic = 'force-dynamic'

const META_BASE = 'https://graph.facebook.com/v21.0'

// ─── Store configs ─────────────────────────────────────────────────────────────

interface StoreConfig {
  adAccountId: string
  accessToken: string
  brand: string
}

const STORES: StoreConfig[] = [
  {
    adAccountId: process.env.META_BOWA_AD_ACCOUNT_ID!,
    accessToken:  process.env.META_BOWA_ACCESS_TOKEN!,
    brand:        'bowa',
  },
  {
    adAccountId: process.env.META_MOOM_AD_ACCOUNT_ID!,
    accessToken:  process.env.META_MOOM_ACCESS_TOKEN!,
    brand:        'moom',
  },
]

// ─── Meta raw types ────────────────────────────────────────────────────────────

interface MetaAction { action_type: string; value: string }

interface MetaAdRaw {
  id: string
  name: string
  status: string
  adset_id: string
  campaign_id: string
  campaign?: { name: string }
  adset?:    { name: string }
  creative?: {
    id: string
    thumbnail_url?: string
    image_url?: string
    video_id?: string
    object_story_spec?: {
      link_data?: {
        message?: string
        name?: string
        description?: string
        call_to_action?: { type: string; value?: { link?: string } }
        child_attachments?: unknown[]
        link?: string
      }
      video_data?: {
        message?: string
        title?: string
        call_to_action?: { type: string; value?: { link?: string } }
        video_id?: string
        link_description?: string
      }
    }
  }
}

interface MetaInsightRaw {
  ad_id: string
  ad_name: string
  date_start: string
  spend: string
  impressions: string
  reach: string
  clicks: string
  ctr?: string
  cpc?: string
  cpm?: string
  // Direct ROAS field (much smaller than action_values)
  website_purchase_roas?: MetaAction[]
  // Video metrics (2 fields only)
  video_play_actions?: MetaAction[]
  video_p75_watched_actions?: MetaAction[]
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}

function isAuthorized(req: NextRequest): boolean {
  const h = req.headers.get('authorization') ?? ''
  const t = h.startsWith('Bearer ') ? h.slice(7) : h
  return t === process.env.CRON_SECRET
}

function fmtDate(d: Date) { return d.toISOString().slice(0, 10) }

function firstActionValue(actions: MetaAction[] = []): number {
  return parseFloat(actions?.[0]?.value ?? '0')
}

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
      data?: T[]; error?: { message: string }; paging?: { next?: string }
    }
    if (!res.ok || data.error) throw new Error(`Meta API: ${data.error?.message ?? res.status}`)
    if (data.data) results.push(...data.data)
    url = data.paging?.next ?? null
  }
  return results
}

function detectFormat(ad: MetaAdRaw): 'image' | 'video' | 'carousel' {
  const spec = ad.creative?.object_story_spec
  if (spec?.link_data?.child_attachments && spec.link_data.child_attachments.length > 0) return 'carousel'
  if (ad.creative?.video_id || spec?.video_data?.video_id) return 'video'
  return 'image'
}

function extractCopy(ad: MetaAdRaw) {
  const spec = ad.creative?.object_story_spec
  const linkData  = spec?.link_data
  const videoData = spec?.video_data
  return {
    primary_text: linkData?.message || videoData?.message || '',
    headline:     linkData?.name    || videoData?.title    || '',
    description:  linkData?.description || videoData?.link_description || '',
    cta_type:     linkData?.call_to_action?.type || videoData?.call_to_action?.type || '',
    landing_url:  linkData?.link || linkData?.call_to_action?.value?.link
                  || videoData?.call_to_action?.value?.link || '',
  }
}

// ─── GET — Vercel cron (7 derniers jours, tourne 2×/jour) ─────────────────────

export async function GET(req: NextRequest) {
  const today = new Date()
  const from  = new Date(today); from.setDate(from.getDate() - 7)

  const url = new URL(req.url)
  url.searchParams.set('from', fmtDate(from))
  url.searchParams.set('to',   fmtDate(today))

  return POST(new NextRequest(url, { headers: req.headers }))
}

// ─── Chunk a date range into 30-day segments ────────────────────────────────

function chunkDateRange(from: string, to: string, chunkDays = 28): Array<{ from: string; to: string }> {
  const chunks: Array<{ from: string; to: string }> = []
  let cursor = new Date(from)
  const end  = new Date(to)
  while (cursor <= end) {
    const chunkEnd = new Date(cursor)
    chunkEnd.setDate(chunkEnd.getDate() + chunkDays - 1)
    chunks.push({ from: fmtDate(cursor), to: fmtDate(chunkEnd > end ? end : chunkEnd) })
    cursor = new Date(chunkEnd)
    cursor.setDate(cursor.getDate() + 1)
  }
  return chunks
}

// ─── POST — manual or cron ─────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { searchParams } = new URL(req.url)
  const today     = new Date()
  const yesterday = new Date(today); yesterday.setDate(yesterday.getDate() - 1)
  const dateFrom  = searchParams.get('from') ?? fmtDate(yesterday)
  const dateTo    = searchParams.get('to')   ?? fmtDate(today)
  const brandFilter = searchParams.get('brand')

  const stores = brandFilter ? STORES.filter(s => s.brand === brandFilter) : STORES
  const supabase = getSupabase()
  const results: Record<string, { ads?: number; stats?: number; error?: string }> = {}

  await Promise.all(stores.map(async (store) => {
    try {
      // ── 1. Fetch ads with creative details (ACTIVE + PAUSED uniquement) ────────
      const ads = await metaGetAll<MetaAdRaw>(
        `${store.adAccountId}/ads`,
        {
          fields: [
            'id', 'name', 'status',
            'adset_id', 'adset{name}',
            'campaign_id', 'campaign{name}',
            'creative{id,thumbnail_url,image_url,video_id,object_story_spec}',
          ].join(','),
          effective_status: JSON.stringify(['ACTIVE', 'PAUSED']),
          limit: '500',
        },
        store.accessToken
      )

      if (ads.length === 0) {
        results[store.brand] = { ads: 0, stats: 0 }
        return
      }

      // ── 2. Upsert ad_creatives ───────────────────────────────────────────────
      const creativeRows = ads.map(ad => {
        const copy = extractCopy(ad)
        const format = detectFormat(ad)
        const thumb = ad.creative?.thumbnail_url || ad.creative?.image_url || null
        return {
          meta_ad_id:        ad.id,
          meta_creative_id:  ad.creative?.id ?? null,
          ad_name:           ad.name,
          campaign_id:       ad.campaign_id,
          campaign_name:     ad.campaign?.name ?? null,
          adset_id:          ad.adset_id,
          adset_name:        ad.adset?.name ?? null,
          brand:             store.brand,
          format,
          status:            ad.status.toLowerCase(),
          thumbnail_url:     thumb,
          video_url:         null, // enriched separately if needed
          primary_text:      copy.primary_text,
          headline:          copy.headline,
          description:       copy.description,
          cta_type:          copy.cta_type,
          landing_url:       copy.landing_url,
          updated_at:        new Date().toISOString(),
          last_active_at:    ad.status === 'ACTIVE' ? new Date().toISOString() : undefined,
        }
      })

      const { error: upsertErr } = await supabase
        .from('ad_creatives')
        .upsert(creativeRows, { onConflict: 'meta_ad_id', ignoreDuplicates: false })
      if (upsertErr) throw new Error(`ad_creatives upsert: ${upsertErr.message}`)

      // ── 3. Resolve internal IDs ──────────────────────────────────────────────
      const metaAdIds = ads.map(a => a.id)
      const { data: dbCreatives, error: dbErr } = await supabase
        .from('ad_creatives')
        .select('id, meta_ad_id')
        .in('meta_ad_id', metaAdIds)
      if (dbErr) throw new Error(`fetch creatives: ${dbErr.message}`)
      const idMap = new Map((dbCreatives ?? []).map(c => [c.meta_ad_id, c.id as string]))

      // ── 4. Fetch ad-level insights (chunked par 7j, spend>0 uniquement) ─────────
      const chunks = chunkDateRange(dateFrom, dateTo, 7)
      const insights: MetaInsightRaw[] = []
      for (const chunk of chunks) {
        const chunkData = await metaGetAll<MetaInsightRaw>(
          `${store.adAccountId}/insights`,
          {
            level: 'ad',
            fields: [
              'ad_id', 'ad_name',
              'spend', 'impressions', 'reach', 'clicks', 'ctr', 'cpm',
              'website_purchase_roas',
              'video_play_actions',
              'video_p75_watched_actions',
            ].join(','),
            time_range:  JSON.stringify({ since: chunk.from, until: chunk.to }),
            time_increment: '1',
            filtering: JSON.stringify([
              { field: 'spend', operator: 'GREATER_THAN', value: '0' },
            ]),
            action_attribution_windows: JSON.stringify(['7d_click', '1d_view']),
            limit: '500',
          },
          store.accessToken
        )
        insights.push(...chunkData)
      }

      // ── 5. Build & upsert creative_stats ────────────────────────────────────
      const statsRows: Record<string, unknown>[] = []

      for (const row of insights) {
        const creativeId = idMap.get(row.ad_id)
        if (!creativeId) continue

        const spend       = parseFloat(row.spend       ?? '0')
        const impressions = parseInt(row.impressions   ?? '0')
        const video3s     = firstActionValue(row.video_play_actions)
        const vidP75      = firstActionValue(row.video_p75_watched_actions)
        const roas        = firstActionValue(row.website_purchase_roas)

        statsRows.push({
          creative_id:    creativeId,
          date:           row.date_start,
          spend,
          impressions,
          reach:          parseInt(row.reach   ?? '0'),
          clicks:         parseInt(row.clicks  ?? '0'),
          ctr:            row.ctr ? parseFloat(row.ctr) / 100 : null,
          cpc:            row.cpc ? parseFloat(row.cpc) : null,
          cpm:            row.cpm ? parseFloat(row.cpm) : null,
          video_3s_plays: video3s > 0 ? Math.round(video3s) : null,
          video_p75:      vidP75  > 0 ? Math.round(vidP75)  : null,
          roas:           roas > 0 ? Math.round(roas * 100) / 100 : null,
        })
      }

      // Atomic replace: delete then insert for the date range and these creatives
      if (statsRows.length > 0) {
        const creativeIds = [...new Set(statsRows.map(r => r.creative_id as string))]
        await supabase
          .from('creative_stats')
          .delete()
          .in('creative_id', creativeIds)
          .gte('date', dateFrom)
          .lte('date', dateTo)

        const CHUNK = 500
        for (let i = 0; i < statsRows.length; i += CHUNK) {
          const { error: insErr } = await supabase
            .from('creative_stats')
            .insert(statsRows.slice(i, i + CHUNK))
          if (insErr) throw new Error(`creative_stats insert: ${insErr.message}`)
        }
      }

      console.log(`[${store.brand}] sync-creatives: ${ads.length} ads, ${statsRows.length} stat rows`)
      results[store.brand] = { ads: ads.length, stats: statsRows.length }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      console.error(`[${store.brand}] sync-creatives error:`, msg)
      results[store.brand] = { error: msg }
    }
  }))

  const hasErrors = Object.values(results).some(r => r.error)
  return NextResponse.json(
    { ok: !hasErrors, range: { from: dateFrom, to: dateTo }, results },
    { status: hasErrors ? 207 : 200, headers: { 'Cache-Control': 'no-store' } }
  )
}
