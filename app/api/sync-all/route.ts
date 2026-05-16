import { NextRequest, NextResponse } from 'next/server'

export const maxDuration = 300
export const dynamic = 'force-dynamic'

function fmtDate(d: Date) {
  return d.toISOString().slice(0, 10)
}

// Vercel cron entry-point (GET) — syncs last 3 days for all platforms.
// 3 days covers Meta attribution delay (up to 48h for 7d-click window).
export async function GET(req: NextRequest) {
  const today = new Date()
  const from  = new Date(today)
  from.setDate(from.getDate() - 2)  // J-2 → today

  const url = new URL(req.url)
  url.searchParams.set('from', fmtDate(from))
  url.searchParams.set('to',   fmtDate(today))

  return POST(new NextRequest(url, { headers: req.headers }))
}

// Called by the dashboard when data is stale — triggers all 4 syncs in parallel.
// Accepts optional ?brand=bowa|moom to scope the sync to one brand.
export async function POST(req: NextRequest) {
  const proto   = req.headers.get('x-forwarded-proto') ?? 'http'
  const host    = req.headers.get('host') ?? 'localhost:3000'
  const base    = `${proto}://${host}`
  const secret  = process.env.CRON_SECRET ?? ''
  const brand   = new URL(req.url).searchParams.get('brand') ?? ''

  const today = new Date()
  const from  = new Date(today)
  from.setDate(from.getDate() - 2)  // J-2 → today (covers Meta 48h attribution delay)

  const dateParams  = `from=${fmtDate(from)}&to=${fmtDate(today)}`
  const brandParam  = brand ? `&brand=${brand}` : ''
  const params      = `${dateParams}${brandParam}`
  const headers     = { Authorization: `Bearer ${secret}` }

  const [meta, shopify, google, pinterest] = await Promise.allSettled([
    fetch(`${base}/api/meta/sync?${params}`,       { method: 'POST', headers }),
    fetch(`${base}/api/shopify/sync?${params}`,    { method: 'POST', headers }),
    fetch(`${base}/api/google-ads/sync?${params}`, { method: 'POST', headers }),
    fetch(`${base}/api/pinterest/sync?${params}`,  { method: 'POST', headers }),
  ])

  const parse = async (r: PromiseSettledResult<Response>) => {
    if (r.status === 'rejected') return { ok: false, error: String(r.reason) }
    try {
      const body = await r.value.json()
      return { ok: r.value.ok, ...body }
    } catch {
      return { ok: r.value.ok }
    }
  }

  const results = {
    meta:      await parse(meta),
    shopify:   await parse(shopify),
    google:    await parse(google),
    pinterest: await parse(pinterest),
  }

  const ok = results.meta.ok && results.shopify.ok && results.google.ok && results.pinterest.ok
  return NextResponse.json(
    { ok, results },
    { status: ok ? 200 : 207, headers: { 'Cache-Control': 'no-store, no-cache' } }
  )
}
