import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

function getAdmin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}

export async function GET() {
  const admin = getAdmin()
  const { data } = await admin
    .from('product_variants')
    .select('shopify_variant_id, product_title, variant_title, image_url, sku_fr, sku_cn, warehouse, product_status')
    .eq('brand', 'moom')
    .order('product_title')
    .order('variant_title')
  return NextResponse.json({ variants: data ?? [] })
}

export async function PATCH(req: NextRequest) {
  const body = await req.json()
  const { shopify_variant_id, sku_fr, sku_cn, warehouse } = body
  if (!shopify_variant_id) {
    return NextResponse.json({ error: 'Missing shopify_variant_id' }, { status: 400 })
  }
  const admin = getAdmin()
  const { error } = await admin
    .from('product_variants')
    .update({ sku_fr: sku_fr ?? null, sku_cn: sku_cn ?? null, warehouse: warehouse ?? null })
    .eq('shopify_variant_id', shopify_variant_id)
    .eq('brand', 'moom')
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
