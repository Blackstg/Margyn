import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { createServerClient } from '@supabase/auth-helpers-nextjs'
import { loadValidity, validityKey } from '@/lib/fixedCostValidity'
import { effectiveBrands } from '@/lib/access'

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
  // Salaires & loyers : réservé aux comptes qui ont accès à la marque.
  const sb = createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { cookies: { getAll() { return req.cookies.getAll() }, setAll() {} } })
  const { data: { user } } = await sb.auth.getUser().catch(() => ({ data: { user: null } }))
  if (!user || !(effectiveBrands(user.user_metadata?.role, user.user_metadata?.brands) as string[]).includes(brand)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { data, error } = await getAdmin()
    .from('fixed_costs')
    .select('amount, category, month, label')
    .eq('brand', brand)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  // Période de validité des lignes récurrentes (from/to 'YYYY-MM'), cf. lib/fixedCostValidity
  const validity = await loadValidity(getAdmin(), brand)
  return NextResponse.json((data ?? []).map(r => r.month === '1900-01-01' ? { ...r, ...validity[validityKey(r.category, r.label)] } : r))
}
