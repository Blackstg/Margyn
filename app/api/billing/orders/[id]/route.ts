import { NextRequest, NextResponse } from 'next/server'

const SHOPIFY: Record<string, { shop: string; token: string }> = {
  bowa: { shop: process.env.SHOPIFY_BOWA_SHOP!, token: process.env.SHOPIFY_BOWA_ACCESS_TOKEN! },
  moom: { shop: process.env.SHOPIFY_MOOM_SHOP!, token: process.env.SHOPIFY_MOOM_ACCESS_TOKEN! },
  krom: { shop: process.env.SHOPIFY_KROM_SHOP!, token: process.env.SHOPIFY_KROM_ACCESS_TOKEN! },
}

export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const brand = req.nextUrl.searchParams.get('brand') ?? 'bowa'
  const { id } = params

  const creds = SHOPIFY[brand]
  if (!creds?.shop || !creds?.token) {
    return NextResponse.json({ error: 'Brand non configurée' }, { status: 400 })
  }

  const fields = 'id,name,created_at,customer,total_price,subtotal_price,total_tax,total_discounts,financial_status,billing_address,currency,line_items,gateway,payment_gateway_names'

  try {
    const res = await fetch(
      `https://${creds.shop}/admin/api/2024-01/orders/${id}.json?fields=${fields}`,
      {
        headers: { 'X-Shopify-Access-Token': creds.token },
        next: { revalidate: 0 },
      }
    )
    if (!res.ok) return NextResponse.json({ error: `Shopify ${res.status}` }, { status: res.status })
    const { order } = await res.json()
    return NextResponse.json({ order })
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 })
  }
}
