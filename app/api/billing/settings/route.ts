import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

function admin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  )
}

export async function GET(req: NextRequest) {
  const brand = req.nextUrl.searchParams.get('brand')
  if (!brand) return NextResponse.json({ error: 'brand required' }, { status: 400 })

  const { data, error } = await admin()
    .from('invoice_settings')
    .select('*')
    .eq('brand', brand)
    .maybeSingle()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ settings: data })
}

export async function PUT(req: NextRequest) {
  const brand = req.nextUrl.searchParams.get('brand')
  if (!brand) return NextResponse.json({ error: 'brand required' }, { status: 400 })

  const body = await req.json().catch(() => ({}))

  const { error } = await admin()
    .from('invoice_settings')
    .upsert({ ...body, brand, updated_at: new Date().toISOString() }, { onConflict: 'brand' })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
