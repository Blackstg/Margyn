import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@supabase/auth-helpers-nextjs'
import { createClient } from '@supabase/supabase-js'
import { cookies } from 'next/headers'

export const maxDuration = 30

function getAdmin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}

interface SubmitItem {
  shopify_variant_id: string
  product_title: string
  variant_title: string | null
  image_url: string | null
  logistician_qty: number
}

export async function POST(req: NextRequest) {
  // Auth check
  const cookieStore = await cookies()
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() { return cookieStore.getAll() },
        setAll() {},
      },
    }
  )
  const { data: { session } } = await supabase.auth.getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { cutoff_date, last_order_number, items }: { cutoff_date: string; last_order_number: string | null; items: SubmitItem[] } = await req.json()
  if (!cutoff_date || !items?.length) {
    return NextResponse.json({ error: 'Données manquantes' }, { status: 400 })
  }

  const admin = getAdmin()
  const today = new Date().toISOString().slice(0, 10)

  // ── Calculate Shopify theoretical stock at cutoff for each variant ────────
  // stock_at_cutoff = current_stock + qty sold between cutoff+1 and today
  const variantIds = items.map((i) => i.shopify_variant_id)

  const [variantsRes, salesRes] = await Promise.all([
    admin
      .from('product_variants')
      .select('shopify_variant_id, stock_quantity, cost_price')
      .in('shopify_variant_id', variantIds),
    admin
      .from('product_sales')
      .select('variant_id, quantity')
      .gt('date', cutoff_date)
      .lte('date', today)
      .eq('brand', 'moom'),
  ])

  const currentStock = new Map<string, number>()
  const costPrice    = new Map<string, number>()
  for (const v of variantsRes.data ?? []) {
    currentStock.set(v.shopify_variant_id, v.stock_quantity ?? 0)
    costPrice.set(v.shopify_variant_id, v.cost_price ?? 0)
  }

  // Sum sold quantities since cutoff
  const soldSince = new Map<string, number>()
  for (const s of salesRes.data ?? []) {
    if (!s.variant_id) continue
    soldSince.set(s.variant_id, (soldSince.get(s.variant_id) ?? 0) + (s.quantity ?? 0))
  }

  // ── Save reconciliation session ───────────────────────────────────────────
  const { data: recon, error: reconErr } = await admin
    .from('stock_reconciliations')
    .insert({
      brand:             'moom',
      cutoff_date,
      last_order_number: last_order_number ?? null,
      submitted_by:      session.user.email ?? session.user.id,
      status:            'pending',
    })
    .select('id')
    .single()

  if (reconErr || !recon) {
    return NextResponse.json({ error: reconErr?.message ?? 'Insert failed' }, { status: 500 })
  }

  // ── Save items with computed shopify_qty_at_cutoff ────────────────────────
  const rows = items.map((item) => {
    const cur  = currentStock.get(item.shopify_variant_id) ?? 0
    const sold = soldSince.get(item.shopify_variant_id) ?? 0
    return {
      reconciliation_id:  recon.id,
      shopify_variant_id: item.shopify_variant_id,
      product_title:      item.product_title,
      variant_title:      item.variant_title,
      image_url:          item.image_url,
      logistician_qty:    item.logistician_qty,
      shopify_qty_at_cutoff: cur + sold,
      cost_price:         costPrice.get(item.shopify_variant_id) ?? 0,
    }
  })

  const { error: itemsErr } = await admin
    .from('stock_reconciliation_items')
    .insert(rows)

  if (itemsErr) {
    return NextResponse.json({ error: itemsErr.message }, { status: 500 })
  }

  return NextResponse.json({ ok: true, reconciliation_id: recon.id })
}
