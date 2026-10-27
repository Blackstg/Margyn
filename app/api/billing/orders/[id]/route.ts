import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@supabase/auth-helpers-nextjs'
import { cookies } from 'next/headers'
import { loadBillingOverride, saveBillingOverride, deleteBillingOverride, applyBillingOverride } from '@/lib/billing/overrides'

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

  const fields = 'id,name,created_at,customer,total_price,subtotal_price,total_tax,total_discounts,financial_status,billing_address,currency,line_items,gateway,payment_gateway_names,refunds'

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
    const override = await loadBillingOverride(brand, id)
    return NextResponse.json({ order: applyBillingOverride(order, override), shopify_billing: order.billing_address ?? null })
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 })
  }
}


// Seuls les utilisateurs connectés peuvent modifier le contact de facturation.
async function currentUserEmail(): Promise<string | null> {
  try {
    const store = await cookies()
    const sb = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      { cookies: { getAll() { return store.getAll() }, setAll() {} } },
    )
    const { data: { user } } = await sb.auth.getUser()
    return user?.email ?? null
  } catch { return null }
}

// PUT : enregistre le contact de facturation modifié (body = champs billing).
export async function PUT(req: NextRequest, { params }: { params: { id: string } }) {
  const brand = req.nextUrl.searchParams.get('brand') ?? 'bowa'
  if (!SHOPIFY[brand]) return NextResponse.json({ error: 'Brand non configurée' }, { status: 400 })
  const email = await currentUserEmail()
  if (!email) return NextResponse.json({ error: 'Non connecté' }, { status: 401 })
  const body = await req.json().catch(() => ({}))
  try {
    const override = await saveBillingOverride(brand, params.id, body ?? {}, email)
    return NextResponse.json({ ok: true, override })
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 })
  }
}

// DELETE : revient au contact Shopify d'origine.
export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  const brand = req.nextUrl.searchParams.get('brand') ?? 'bowa'
  if (!SHOPIFY[brand]) return NextResponse.json({ error: 'Brand non configurée' }, { status: 400 })
  if (!(await currentUserEmail())) return NextResponse.json({ error: 'Non connecté' }, { status: 401 })
  await deleteBillingOverride(brand, params.id)
  return NextResponse.json({ ok: true })
}
