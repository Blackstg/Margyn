// PUT /api/pilot/targets?brand=bowa — enregistre les cibles du Pilote (% du CA HT net).
// Body : { profit, products, delivery, ads, fees }
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { createServerClient } from '@supabase/auth-helpers-nextjs'
import { cookies } from 'next/headers'
import { cleanTargets, saveTargets } from '@/lib/pilotTargets'

export const dynamic = 'force-dynamic'

async function signedIn(): Promise<boolean> {
  try {
    const store = await cookies()
    const sb = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      { cookies: { getAll() { return store.getAll() }, setAll() {} } },
    )
    const { data: { user } } = await sb.auth.getUser()
    return !!user
  } catch { return false }
}

export async function PUT(req: NextRequest) {
  const brand = req.nextUrl.searchParams.get('brand') ?? 'bowa'
  if (!(await signedIn())) return NextResponse.json({ error: 'Non connecté' }, { status: 401 })
  const body = await req.json().catch(() => null)
  if (!body || typeof body !== 'object') return NextResponse.json({ error: 'cibles requises' }, { status: 400 })
  const targets = cleanTargets(body)
  const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } })
  try { await saveTargets(sb, brand, targets) }
  catch (e) { return NextResponse.json({ error: String(e) }, { status: 500 }) }
  return NextResponse.json({ ok: true, targets })
}
