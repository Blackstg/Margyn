import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const month = searchParams.get('month') ?? '2026-03' // e.g. 2026-03

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )

  // 1. Fetch invoice rows
  const { data, error } = await supabase
    .from('logistician_invoice_summaries')
    .select('invoice_rows, normal_count, fw_count, normal_total, fw_total')
    .eq('brand', 'moom')
    .eq('month', month)
    .maybeSingle()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (!data)  return NextResponse.json({ error: `No invoice found for ${month}` }, { status: 404 })

  type Row = { order_name?: string; shipping_price?: number; service_price?: number; total_price?: number; isFW?: boolean }
  const rows = (data.invoice_rows ?? []) as Row[]

  const normalRows = rows.filter(r => !r.isFW)
  const fwRows     = rows.filter(r => r.isFW)

  const totalShippingUsd  = rows.reduce((s, r) => s + (r.shipping_price ?? 0), 0)
  const totalServiceUsd   = rows.reduce((s, r) => s + (r.service_price  ?? 0), 0)
  const totalShippingUsd2 = rows.reduce((s, r) => s + (r.total_price    ?? 0), 0)
  const normalShippingUsd = normalRows.reduce((s, r) => s + (r.total_price ?? 0), 0)
  const fwShippingUsd     = fwRows.reduce((s, r) => s + (r.total_price   ?? 0), 0)

  // 2. Fetch EUR rate from frankfurter.app
  // Rate = 1st of the following month
  const [ry, rm] = month.split('-').map(Number)
  const rateDate = rm === 12
    ? `${ry + 1}-01-01`
    : `${ry}-${String(rm + 1).padStart(2, '0')}-01`
  let eurRate = 0.92
  let rateSource = 'fallback (0.92)'
  let rateActualDate = rateDate
  try {
    const rateRes = await fetch(`https://api.frankfurter.app/${rateDate}?from=USD&to=EUR`)
    const rateData = await rateRes.json() as { date?: string; rates?: { EUR?: number } }
    eurRate = rateData.rates?.EUR ?? 0.92
    rateActualDate = rateData.date ?? rateDate
    rateSource = `frankfurter.app (requested ${rateDate}, returned ${rateActualDate})`
  } catch {
    rateSource = 'fallback — API unreachable'
  }

  // 3. Direct sum using total_price (shipping + service fees)
  const directTotalEur = totalShippingUsd2 * eurRate

  return NextResponse.json({
    month,
    invoice: {
      total_rows:         rows.length,
      normal_rows:        normalRows.length,
      fw_rows:            fwRows.length,
      shipping_price_usd: +totalShippingUsd.toFixed(2),
      service_price_usd:  +totalServiceUsd.toFixed(2),
      total_price_usd:    +totalShippingUsd2.toFixed(2),
      normal_usd:         +normalShippingUsd.toFixed(2),
      fw_usd:             +fwShippingUsd.toFixed(2),
    },
    rate: {
      requested_date:   rateDate,
      actual_date:      rateActualDate,
      eur_per_usd:      eurRate,
      source:           rateSource,
    },
    calculation: {
      method:          'sum(total_price) × eur_rate',
      direct_total_eur: +directTotalEur.toFixed(2),
    },
  })
}
