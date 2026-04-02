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

export async function GET(req: NextRequest) {
  const brand = req.nextUrl.searchParams.get('brand') ?? ''
  const conf  = BRANDS[brand]
  if (!conf?.shop || !conf?.token) return NextResponse.json({ url: null })

  try {
    const res  = await fetch(`https://${conf.shop}/admin/api/2024-01/shop.json`, {
      headers: { 'X-Shopify-Access-Token': conf.token },
      next: { revalidate: 3600 },
    })
    if (!res.ok) return NextResponse.json({ url: null })
    const data = await res.json()
    const logo = data?.shop?.logo?.src ?? null
    return NextResponse.json(
      { url: logo },
      { headers: { 'Cache-Control': 'public, max-age=3600' } }
    )
  } catch {
    return NextResponse.json({ url: null })
  }
}
