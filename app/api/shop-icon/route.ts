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

const GQL_QUERY = `{ shop { brand { logo { image { url } } } } }`

export async function GET(req: NextRequest) {
  const brand = req.nextUrl.searchParams.get('brand') ?? ''
  const conf  = BRANDS[brand]
  if (!conf?.shop || !conf?.token) return NextResponse.json({ url: null })

  // 1. Try GraphQL brand logo (Admin → Settings → General → Brand logo)
  try {
    const gql = await fetch(`https://${conf.shop}/admin/api/2024-01/graphql.json`, {
      method: 'POST',
      headers: {
        'X-Shopify-Access-Token': conf.token,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ query: GQL_QUERY }),
    })
    if (gql.ok) {
      const { data } = await gql.json()
      const url = data?.shop?.brand?.logo?.image?.url ?? null
      if (url) {
        return NextResponse.json(
          { url },
          { headers: { 'Cache-Control': 'public, max-age=3600' } }
        )
      }
    }
  } catch { /* fall through */ }

  // 2. Fallback: REST shop.json logo.src
  try {
    const rest = await fetch(`https://${conf.shop}/admin/api/2024-01/shop.json`, {
      headers: { 'X-Shopify-Access-Token': conf.token },
    })
    if (rest.ok) {
      const { shop } = await rest.json()
      const url = shop?.logo?.src ?? null
      if (url) {
        return NextResponse.json(
          { url },
          { headers: { 'Cache-Control': 'public, max-age=3600' } }
        )
      }
    }
  } catch { /* fall through */ }

  return NextResponse.json({ url: null })
}
