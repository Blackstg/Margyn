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
      link_data?: { child_attachments?: unknown[] }
      video_data?: { video_id?: string }
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
  // Cost per action type (purchase CPA)
  cost_per_action_type?: MetaAction[]
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
  accessToken: string,
  maxPages = 20
): Promise<T[]> {
  const results: T[] = []
  const init = new URL(`${META_BASE}/${path}`)
  for (const [k, v] of Object.entries(params)) init.searchParams.set(k, v)
  init.searchParams.set('access_token', accessToken)
  let url: string | null = init.toString()
  let page = 0
  while (url && page < maxPages) {
    const res = await fetch(url, { cache: 'no-store' })
    const data = await res.json() as {
      data?: T[]; error?: { message: string }; paging?: { next?: string }
    }
    if (!res.ok || data.error) throw new Error(`Meta API: ${data.error?.message ?? res.status}`)
    if (data.data) results.push(...data.data)
    url = data.paging?.next ?? null
    page++
  }
  return results
}

function detectFormat(ad: MetaAdRaw): 'image' | 'video' | 'carousel' {
  const spec = ad.creative?.object_story_spec
  if (spec?.link_data?.child_attachments && spec.link_data.child_attachments.length > 0) return 'carousel'
  if (ad.creative?.video_id || spec?.video_data?.video_id) return 'video'
  return 'image'
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

  // Séquentiel pour éviter le rate limiting Meta (parallel = 2 comptes en même temps)
  for (const store of stores) {
    try {
      // ── 1. Fetch ads avec creative minimal (object_story_spec réduit au strict nécessaire) ──
      const ads = await metaGetAll<MetaAdRaw>(
        `${store.adAccountId}/ads`,
        {
          fields: [
            'id', 'name', 'status',
            'adset_id', 'campaign_id',
            'creative{id,thumbnail_url,image_url,video_id,object_story_spec{video_data{video_id},link_data{child_attachments}}}',
          ].join(','),
          effective_status: JSON.stringify(['ACTIVE', 'PAUSED', 'ARCHIVED']),
          limit: '25',
        },
        store.accessToken,
        80  // 80 pages × 25 = 2000 ads max
      )

      if (ads.length === 0) {
        results[store.brand] = { ads: 0, stats: 0 }
        return
      }

      // ── 2. Fetch video source URLs + HD thumbnails from advideos (paginated) ──
      const videoSourceMap  = new Map<string, string>()  // video_id → mp4 url
      const videoPictureMap = new Map<string, string>()  // video_id → best thumbnail url
      const adVideos = await metaGetAll<{
        id: string
        source?: string
        picture?: string
        thumbnails?: { data: Array<{ uri: string; width: number; height: number }> }
      }>(
        `${store.adAccountId}/advideos`,
        { fields: 'id,source,picture,thumbnails{uri,width,height}', limit: '100' },
        store.accessToken
      )
      for (const v of adVideos) {
        if (v.source) videoSourceMap.set(v.id, v.source)
        // Pick highest-res thumbnail: prefer thumbnails[] (multiple sizes) over picture (single, often low-res)
        const bestThumb = v.thumbnails?.data?.length
          ? v.thumbnails.data.reduce((best, t) => (t.width * t.height > best.width * best.height ? t : best)).uri
          : v.picture
        if (bestThumb) videoPictureMap.set(v.id, bestThumb)
      }

      // ── 3. Upsert ad_creatives ───────────────────────────────────────────────
      const creativeRows = ads.map(ad => {
        const format = detectFormat(ad)
        // creative.video_id et spec.video_data.video_id sont deux IDs différents —
        // advideos est indexé par spec.video_data.video_id, donc on essaie les deux.
        const videoIdCreative = ad.creative?.video_id ?? null
        const videoIdSpec     = ad.creative?.object_story_spec?.video_data?.video_id ?? null
        const videoId         = videoIdCreative ?? videoIdSpec

        const lookupPicture = (id: string | null) => (id ? videoPictureMap.get(id) : undefined)
        const lookupSource  = (id: string | null) => (id ? videoSourceMap.get(id)  : undefined)

        // Cherche dans les deux IDs : spec d'abord (souvent dans advideos), puis creative
        const hdThumb  = lookupPicture(videoIdSpec) ?? lookupPicture(videoIdCreative)
        const videoUrl = lookupSource(videoIdSpec)  ?? lookupSource(videoIdCreative) ?? null

        // For images: image_url (HD). For videos: creative thumbnail_url first (~600px from Meta),
        // then advideos hdThumb as fallback (often 64px — avoid unless nothing else available)
        const thumb = format === 'video'
          ? (ad.creative?.thumbnail_url ?? hdThumb ?? null)
          : (ad.creative?.image_url ?? ad.creative?.thumbnail_url ?? null)
        return {
          meta_ad_id:        ad.id,
          meta_creative_id:  ad.creative?.id ?? null,
          meta_video_id:     videoId,
          ad_name:           ad.name,
          campaign_id:       ad.campaign_id,
          campaign_name:     null,
          adset_id:          ad.adset_id,
          adset_name:        null,
          brand:             store.brand,
          format,
          status:            ad.status.toLowerCase(),
          thumbnail_url:     thumb,
          video_url:         videoUrl,
          updated_at:        new Date().toISOString(),
          last_active_at:    ad.status === 'ACTIVE' ? new Date().toISOString() : undefined,
        }
      })

      const { error: upsertErr } = await supabase
        .from('ad_creatives')
        .upsert(creativeRows, { onConflict: 'meta_ad_id', ignoreDuplicates: false })
      if (upsertErr) throw new Error(`ad_creatives upsert: ${upsertErr.message}`)

      // ── 4. Resolve internal IDs — ALL ads for this brand (incl. deleted/archived)
      // so insights from paused/deleted ads aren't silently dropped
      const { data: dbCreatives, error: dbErr } = await supabase
        .from('ad_creatives')
        .select('id, meta_ad_id')
        .eq('brand', store.brand)
      if (dbErr) throw new Error(`fetch creatives: ${dbErr.message}`)
      const idMap = new Map((dbCreatives ?? []).map(c => [c.meta_ad_id, c.id as string]))

      // ── 5. Fetch ad-level insights (1 jour à la fois, paginé) ────────────────
      const insights: MetaInsightRaw[] = []
      const days = chunkDateRange(dateFrom, dateTo, 1)
      for (const day of days) {
        // Paginé avec limit=200 pour éviter "reduce the amount of data" sur les gros comptes
        let nextUrl: string | null = null
        const initUrl = new URL(`https://graph.facebook.com/v21.0/${store.adAccountId}/insights`)
        const params: Record<string, string> = {
          level: 'ad',
          fields: [
            'ad_id', 'ad_name',
            'spend', 'impressions', 'reach', 'clicks', 'ctr', 'cpm',
            'website_purchase_roas',
            'cost_per_action_type',
            'video_play_actions',
            'video_p75_watched_actions',
          ].join(','),
          time_range:  JSON.stringify({ since: day.from, until: day.to }),
          filtering: JSON.stringify([
            { field: 'spend', operator: 'GREATER_THAN', value: '0' },
          ]),
          action_attribution_windows: JSON.stringify(['7d_click', '1d_view']),
          limit: '200',
          access_token: store.accessToken,
        }
        for (const [k, v] of Object.entries(params)) initUrl.searchParams.set(k, v)
        nextUrl = initUrl.toString()
        let page = 0
        while (nextUrl && page < 20) {
          const res = await fetch(nextUrl, { cache: 'no-store' })
          const data = await res.json() as { data?: MetaInsightRaw[]; error?: { message: string }; paging?: { next?: string } }
          if (!res.ok || data.error) throw new Error(`Meta API (insights ${day.from} p${page}): ${data.error?.message ?? res.status}`)
          for (const row of data.data ?? []) {
            insights.push({ ...row, date_start: day.from })
          }
          nextUrl = data.paging?.next ?? null
          page++
        }
      }

      // ── 6. Build & upsert creative_stats ────────────────────────────────────
      const statsRows: Record<string, unknown>[] = []

      for (const row of insights) {
        const creativeId = idMap.get(row.ad_id)
        if (!creativeId) continue

        const spend       = parseFloat(row.spend       ?? '0')
        const impressions = parseInt(row.impressions   ?? '0')
        const video3s     = firstActionValue(row.video_play_actions)
        const vidP75      = firstActionValue(row.video_p75_watched_actions)
        const roas        = firstActionValue(row.website_purchase_roas)
        // CPA: extract purchase cost from cost_per_action_type
        const cpaPurchase = (row.cost_per_action_type ?? [])
          .find(a => a.action_type === 'omni_purchase' || a.action_type === 'purchase' || a.action_type === 'onsite_conversion.purchase')
        const cpa = cpaPurchase ? parseFloat(cpaPurchase.value) : null
        // purchase_value derived from ROAS × spend
        const purchaseValue = roas > 0 ? Math.round(roas * spend * 100) / 100 : 0

        statsRows.push({
          creative_id:     creativeId,
          date:            row.date_start,
          spend,
          impressions,
          reach:           parseInt(row.reach   ?? '0'),
          clicks:          parseInt(row.clicks  ?? '0'),
          ctr:             row.ctr ? parseFloat(row.ctr) / 100 : null,
          cpc:             row.cpc ? parseFloat(row.cpc) : null,
          cpm:             row.cpm ? parseFloat(row.cpm) : null,
          video_3s_plays:  video3s > 0 ? Math.round(video3s) : null,
          video_p75:       vidP75  > 0 ? Math.round(vidP75)  : null,
          roas:            roas > 0 ? Math.round(roas * 100) / 100 : null,
          purchase_value:  purchaseValue,
          cpa:             cpa != null && cpa > 0 ? Math.round(cpa * 100) / 100 : null,
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

      const videoAds = ads.filter(a => detectFormat(a) === 'video')
      const withUrl  = videoAds.filter(a => {
        const vs = a.creative?.object_story_spec?.video_data?.video_id ?? null
        const vc = a.creative?.video_id ?? null
        return videoSourceMap.has(vs ?? '') || videoSourceMap.has(vc ?? '')
      })
      console.log(`[${store.brand}] sync-creatives: ${ads.length} ads, ${statsRows.length} stat rows | advideos: ${adVideos.length} (sources: ${videoSourceMap.size}, thumbs: ${videoPictureMap.size}) | video ads: ${videoAds.length}, with_url: ${withUrl.length}`)

      results[store.brand] = { ads: ads.length, stats: statsRows.length }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      console.error(`[${store.brand}] sync-creatives error:`, msg)
      results[store.brand] = { error: msg }
    }
  }

  const hasErrors = Object.values(results).some(r => r.error)
  return NextResponse.json(
    { ok: !hasErrors, range: { from: dateFrom, to: dateTo }, results },
    { status: hasErrors ? 207 : 200, headers: { 'Cache-Control': 'no-store' } }
  )
}
