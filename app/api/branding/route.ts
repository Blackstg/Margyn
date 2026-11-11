// Nom + logo des marques accessibles à l'utilisateur (menu latéral), depuis tenants.
import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@supabase/auth-helpers-nextjs'
import { createClient } from '@supabase/supabase-js'
import { effectiveBrands } from '@/lib/access'

export async function GET(req: NextRequest) {
  const sb = createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { cookies: { getAll() { return req.cookies.getAll() }, setAll() {} } })
  const { data: { user } } = await sb.auth.getUser().catch(() => ({ data: { user: null } }))
  if (!user) return NextResponse.json({}, { status: 401 })
  const brands = effectiveBrands(user.user_metadata?.role, user.user_metadata?.brands) as string[]
  const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { autoRefreshToken: false, persistSession: false } })
  const { data } = await db.from('tenants').select('slug, name, logo_url').in('slug', brands)
  return NextResponse.json(Object.fromEntries((data ?? []).map(t => [t.slug, { name: t.name, logo: t.logo_url }])),
    { headers: { 'Cache-Control': 'private, max-age=300' } })
}
