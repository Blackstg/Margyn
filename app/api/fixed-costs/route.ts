import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

function getAdmin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  )
}

export async function GET(req: NextRequest) {
  const brand = req.nextUrl.searchParams.get('brand')
  if (!brand) return NextResponse.json({ error: 'Missing brand' }, { status: 400 })

  const { data, error } = await getAdmin()
    .from('fixed_costs')
    .select('amount, category, month, label')
    .eq('brand', brand)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data ?? [])
}
