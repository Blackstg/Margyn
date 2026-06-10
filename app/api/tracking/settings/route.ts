import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

function getAdmin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}

export async function GET(req: NextRequest) {
  const brand = req.nextUrl.searchParams.get('brand') ?? 'moom'
  const admin = getAdmin()
  const { data } = await admin.from('tracking_settings').select('*').eq('brand', brand).single()
  return NextResponse.json({ settings: data ?? null })
}

export async function PUT(req: NextRequest) {
  const brand = req.nextUrl.searchParams.get('brand') ?? 'moom'
  const body  = await req.json()
  const admin = getAdmin()
  const { error } = await admin.from('tracking_settings').upsert({
    ...body,
    brand,
    updated_at: new Date().toISOString(),
  })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
