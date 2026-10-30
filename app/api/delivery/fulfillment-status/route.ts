// GET /api/delivery/fulfillment-status?days=30 — onglet « Traitement Shopify »
// (calcul dans lib/delivery/fulfillmentStatus.ts)
import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@supabase/auth-helpers-nextjs'
import { cookies } from 'next/headers'
import { fulfillmentStatus } from '@/lib/delivery/fulfillmentStatus'

export const dynamic = 'force-dynamic'
export const fetchCache = 'force-no-store'
export const maxDuration = 60

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

export async function GET(req: NextRequest) {
  if (!(await signedIn())) return NextResponse.json({ error: 'Non connecté' }, { status: 401 })
  const days = Math.min(120, Math.max(7, Number(req.nextUrl.searchParams.get('days') ?? 30)))
  try {
    return NextResponse.json(await fulfillmentStatus(days))
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 })
  }
}
