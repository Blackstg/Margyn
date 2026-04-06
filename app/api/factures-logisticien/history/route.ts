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
    .from('logistician_invoice_summaries')
    .select('*')
    .eq('brand', 'moom')
    .order('month', { ascending: true })
  return NextResponse.json({ summaries: data ?? [] })
}

export async function POST(req: NextRequest) {
  const body = await req.json()
  const admin = getAdmin()
  await admin
    .from('logistician_invoice_summaries')
    .upsert({ ...body, brand: 'moom' }, { onConflict: 'month,brand' })
  return NextResponse.json({ ok: true })
}
