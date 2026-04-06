import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

function getAdmin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}

function normalize(s: string): string {
  return s
    .toLowerCase()
    .replace(/™|®/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

export async function POST(req: NextRequest) {
  const { rows } = await req.json() as {
    rows: Array<{ name: string; sku_fr: string; sku_cn: string; warehouse: string }>
  }

  const admin = getAdmin()
  const { data: variants } = await admin
    .from('product_variants')
    .select('shopify_variant_id, product_title, variant_title')
    .eq('brand', 'moom')

  if (!variants) return NextResponse.json({ error: 'Failed to fetch variants' }, { status: 500 })

  const updates: Array<{
    shopify_variant_id: string
    sku_fr: string | null
    sku_cn: string | null
    warehouse: string | null
  }> = []
  const unmatched: string[] = []

  for (const row of rows) {
    const csvNorm = normalize(row.name)

    let best: typeof variants[0] | null = null
    let bestScore = 0

    for (const v of variants) {
      const pt = normalize(v.product_title)
      const vt = v.variant_title ? normalize(v.variant_title) : null

      if (!csvNorm.includes(pt)) continue

      let score = 2
      if (vt) {
        if (csvNorm.includes(vt)) score += 3
        else continue // variant must match if it exists
      }

      if (score > bestScore) {
        bestScore = score
        best = v
      }
    }

    if (best) {
      updates.push({
        shopify_variant_id: best.shopify_variant_id,
        sku_fr:    row.sku_fr    || null,
        sku_cn:    row.sku_cn    || null,
        warehouse: row.warehouse || null,
      })
    } else {
      unmatched.push(row.name)
    }
  }

  for (const upd of updates) {
    await admin
      .from('product_variants')
      .update({ sku_fr: upd.sku_fr, sku_cn: upd.sku_cn, warehouse: upd.warehouse })
      .eq('shopify_variant_id', upd.shopify_variant_id)
  }

  return NextResponse.json({ matched: updates.length, unmatched })
}
