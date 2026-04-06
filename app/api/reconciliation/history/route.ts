import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

function getAdmin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}

export async function GET(req: NextRequest) {
  const admin = getAdmin()

  const id = new URL(req.url).searchParams.get('id')

  if (id) {
    // Fetch single reconciliation with items
    const [reconRes, itemsRes] = await Promise.all([
      admin.from('stock_reconciliations').select('*').eq('id', id).single(),
      admin.from('stock_reconciliation_items').select('*').eq('reconciliation_id', id).order('product_title').order('variant_title'),
    ])
    return NextResponse.json({ reconciliation: reconRes.data, items: itemsRes.data ?? [] })
  }

  // List all reconciliations for moom
  const { data } = await admin
    .from('stock_reconciliations')
    .select('id, cutoff_date, submitted_by, submitted_at, status')
    .eq('brand', 'moom')
    .order('submitted_at', { ascending: false })
    .limit(20)

  return NextResponse.json({ reconciliations: data ?? [] })
}

export async function PATCH(req: NextRequest) {
  const { id, status } = await req.json()
  const admin = getAdmin()
  await admin.from('stock_reconciliations').update({ status }).eq('id', id)
  return NextResponse.json({ ok: true })
}
