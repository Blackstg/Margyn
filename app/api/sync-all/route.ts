import { NextRequest, NextResponse } from 'next/server'

export const maxDuration = 300

function fmtDate(d: Date) {
  return d.toISOString().slice(0, 10)
}

// Called by the dashboard when data is stale — triggers all 3 syncs in parallel.
// Accepts optional ?brand=bowa|moom to scope the sync to one brand.
export async function POST(req: NextRequest) {
  const proto   = req.headers.get('x-forwarded-proto') ?? 'http'
  const host    = req.headers.get('host') ?? 'localhost:3000'
  const base    = `${proto}://${host}`
  const secret  = process.env.CRON_SECRET ?? ''
  const brand   = new URL(req.url).searchParams.get('brand') ?? ''

  const today     = new Date()
  const yesterday = new Date(today)
  yesterday.setDate(yesterday.getDate() - 1)

  const dateParams  = `from=${fmtDate(yesterday)}&to=${fmtDate(today)}`
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
  return NextResponse.json({ ok, results }, { status: ok ? 200 : 207 })
}
