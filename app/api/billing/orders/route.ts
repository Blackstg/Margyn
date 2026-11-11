import { NextRequest, NextResponse } from 'next/server'
import { hasBrandAccess } from '@/lib/brandAccess'
import { shopifyCreds } from '@/lib/tenant/integrations'


export async function GET(req: NextRequest) {
  const brand  = req.nextUrl.searchParams.get('brand') ?? 'bowa'
  if (!(await hasBrandAccess(req, brand))) return NextResponse.json({ error: 'Non autorisé' }, { status: 401 })
  const search = req.nextUrl.searchParams.get('search') ?? ''
  const limit  = Math.min(parseInt(req.nextUrl.searchParams.get('limit') ?? '50'), 100)

  const c = await shopifyCreds(brand)
  if (!c.shop || !c.token) return NextResponse.json({ error: 'Brand non configurée' }, { status: 400 })
  const creds = { shop: c.shop, token: c.token }

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
