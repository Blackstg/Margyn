import { NextRequest, NextResponse } from 'next/server'

const BRANDS: Record<string, { shop: string; token: string }> = {
  bowa: {
    shop:  process.env.SHOPIFY_BOWA_SHOP!,
    token: process.env.SHOPIFY_BOWA_ACCESS_TOKEN!,
  },
  moom: {
    shop:  process.env.SHOPIFY_MOOM_SHOP!,
    token: process.env.SHOPIFY_MOOM_ACCESS_TOKEN!,
  },
}

const GQL_QUERY = `{
  shop {
    brand {
      logo { image { url } }
      squareLogo { image { url } }
    }
  }
}`

async function tryGraphql(shop: string, token: string): Promise<string | null> {
  try {
    const res = await fetch(`https://${shop}/admin/api/2024-01/graphql.json`, {
      method: 'POST',
      headers: { 'X-Shopify-Access-Token': token, 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: GQL_QUERY }),
    })
    if (!res.ok) return null
    const { data } = await res.json()
    return data?.shop?.brand?.squareLogo?.image?.url
      ?? data?.shop?.brand?.logo?.image?.url
      ?? null
  } catch { return null }
}

async function tryStorefront(shop: string): Promise<string | null> {
  try {
    const res = await fetch(`https://${shop}`, {
      headers: { 'User-Agent': 'Mozilla/5.0' },
      signal: AbortSignal.timeout(5000),
    })
    if (!res.ok) return null
    const html = await res.text()

    // 1. og:image
    const og = html.match(/<meta[^>]+property="og:image"[^>]+content="([^"]+)"/)
      ?? html.match(/<meta[^>]+content="([^"]+)"[^>]+property="og:image"/)
    if (og?.[1]) return og[1]

    // 2. <img class="...logo..."> src
    const logo = html.match(/<img[^>]+class="[^"]*logo[^"]*"[^>]+src="([^"]+)"/)
      ?? html.match(/<img[^>]+src="([^"]+)"[^>]+class="[^"]*logo[^"]*"/)
    if (logo?.[1]) return logo[1].startsWith('//') ? `https:${logo[1]}` : logo[1]

    return null
  } catch { return null }
}

export async function GET(req: NextRequest) {
  const brand = req.nextUrl.searchParams.get('brand') ?? ''
  const conf  = BRANDS[brand]
  if (!conf?.shop || !conf?.token) return NextResponse.json({ url: null })

  const url = await tryGraphql(conf.shop, conf.token)
    ?? await tryStorefront(conf.shop)

  const safeUrl = url ? url.replace(/^http:\/\//, 'https://') : null
  return NextResponse.json(
    { url: safeUrl },
    { headers: { 'Cache-Control': 'public, max-age=3600' } }
  )
}
