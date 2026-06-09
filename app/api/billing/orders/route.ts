import { NextRequest, NextResponse } from 'next/server'

const SHOPIFY: Record<string, { shop: string; token: string }> = {
  bowa: { shop: process.env.SHOPIFY_BOWA_SHOP!, token: process.env.SHOPIFY_BOWA_ACCESS_TOKEN! },
  moom: { shop: process.env.SHOPIFY_MOOM_SHOP!, token: process.env.SHOPIFY_MOOM_ACCESS_TOKEN! },
  krom: { shop: process.env.SHOPIFY_KROM_SHOP!, token: process.env.SHOPIFY_KROM_ACCESS_TOKEN! },
}

export async function GET(req: NextRequest) {
  const brand  = req.nextUrl.searchParams.get('brand') ?? 'bowa'
  const search = req.nextUrl.searchParams.get('search') ?? ''
  const limit  = Math.min(parseInt(req.nextUrl.searchParams.get('limit') ?? '50'), 100)

  const creds = SHOPIFY[brand]
  if (!creds?.shop || !creds?.token) {
    return NextResponse.json({ error: 'Brand non configurée' }, { status: 400 })
  }

  const fields = 'id,name,created_at,customer,total_price,subtotal_price,total_tax,financial_status,billing_address,currency'

  let url: string
  if (search.trim()) {
    url = `https://${creds.shop}/admin/api/2024-01/orders.json?name=${encodeURIComponent(search.trim())}&status=any&fields=${fields}`
  } else {
    url = `https://${creds.shop}/admin/api/2024-01/orders.json?status=any&limit=${limit}&fields=${fields}`
  }

  try {
    const res = await fetch(url, {
      headers: { 'X-Shopify-Access-Token': creds.token },
      next: { revalidate: 0 },
    })
    if (!res.ok) return NextResponse.json({ error: `Shopify ${res.status}` }, { status: res.status })
    const { orders } = await res.json()
    return NextResponse.json({ orders: orders ?? [] })
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 })
  }
}
