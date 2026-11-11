import { NextRequest, NextResponse } from 'next/server'
import { hasBrandAccess } from '@/lib/brandAccess'
import { shopifyCreds } from '@/lib/tenant/integrations'
import { INVOICE_FIELDS, attachPayments } from '@/lib/billing/shopifyInvoiceOrder'
import { createServerClient } from '@supabase/auth-helpers-nextjs'
import { cookies } from 'next/headers'
import { loadBillingOverride, saveBillingOverride, deleteBillingOverride, applyBillingOverride } from '@/lib/billing/overrides'

import { BRANDS } from '@/lib/access'
const SHOPIFY = Object.fromEntries(BRANDS.map(b => [b, true])) as Record<string, boolean>

export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const brand = req.nextUrl.searchParams.get('brand') ?? 'bowa'
  if (!(await hasBrandAccess(req, brand))) return NextResponse.json({ error: 'Non autorisé' }, { status: 401 })
  const { id } = params

  const c = await shopifyCreds(brand)
  if (!c.shop || !c.token) return NextResponse.json({ error: 'Brand non configurée' }, { status: 400 })
  const creds = { shop: c.shop, token: c.token }
  const fields = INVOICE_FIELDS

  try {
    const res = await fetch(
      `https://${creds.shop}/admin/api/2024-01/orders/${id}.json?fields=${fields}`,
      {
        headers: { 'X-Shopify-Access-Token': creds.token },
        next: { revalidate: 0 },
      }
    )
    if (!res.ok) return NextResponse.json({ error: `Shopify ${res.status}` }, { status: res.status })
    const { order: raw } = await res.json()
    const order = await attachPayments(creds.shop, creds.token, raw)
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
  if (!(await hasBrandAccess(req, brand))) return NextResponse.json({ error: 'Non autorisé' }, { status: 401 })
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
  if (!(await hasBrandAccess(req, brand))) return NextResponse.json({ error: 'Non autorisé' }, { status: 401 })
  await deleteBillingOverride(brand, params.id)
  return NextResponse.json({ ok: true })
}
