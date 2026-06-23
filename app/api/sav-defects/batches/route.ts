import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@supabase/auth-helpers-nextjs'
import { createClient } from '@supabase/supabase-js'
import { cookies } from 'next/headers'
import { isAdminRole } from '@/lib/access'

export const dynamic = 'force-dynamic'

function serviceClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  )
}

async function getRole(): Promise<string> {
  const store = await cookies()
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { cookies: { getAll() { return store.getAll() }, setAll() {} } }
  )
  const { data: { user } } = await supabase.auth.getUser()
  return (user?.user_metadata?.role as string | undefined) ?? 'admin'
}

interface BatchRow { id: string; brand: string; number: number; label: string; po_ref: string | null; created_at: string; closed_at: string | null }

// GET ?brand=moom → { batches, active }
export async function GET(req: NextRequest) {
  const brand = req.nextUrl.searchParams.get('brand') ?? 'moom'
  const admin = serviceClient()
  const { data, error } = await admin
    .from('defect_batches')
    .select('*')
    .eq('brand', brand)
    .order('number', { ascending: false })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const batches = (data ?? []) as BatchRow[]
  // Active = the open batch (closed_at null) with the highest number, else the latest
  const active = batches.find(b => !b.closed_at) ?? batches[0] ?? null
  return NextResponse.json({ batches, active })
}

// POST { brand } → close current open batch, start the next one (admins only)
export async function POST(req: NextRequest) {
  if (!isAdminRole(await getRole())) {
    return NextResponse.json({ error: 'Réservé aux admins' }, { status: 403 })
  }
  const body = await req.json().catch(() => ({})) as { brand?: string }
  const brand = body.brand ?? 'moom'
  const admin = serviceClient()

  const { data: rows } = await admin
    .from('defect_batches').select('*').eq('brand', brand).order('number', { ascending: false })
  const list = (rows ?? []) as BatchRow[]
  const nextNumber = (list[0]?.number ?? 0) + 1
  const label = `Lot ${String(nextNumber).padStart(2, '0')}`

  // Close any currently-open batch
  await admin.from('defect_batches').update({ closed_at: new Date().toISOString() })
    .eq('brand', brand).is('closed_at', null)

  const { data: created, error } = await admin
    .from('defect_batches').insert({ brand, number: nextNumber, label }).select().single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ active: created })
}
