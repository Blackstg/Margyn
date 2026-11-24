// GET  /api/avis/[brand]/responses?days=90 — réponses à l'enquête d'avis (page Avis clients).
// PATCH { id, handled } — marque un retour négatif comme traité / à traiter.
import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@supabase/auth-helpers-nextjs'
import { createAdminClient } from '@/lib/supabase'
import { effectiveBrands } from '@/lib/access'
import { isReviewBrand } from '@/lib/reviews'

export const dynamic = 'force-dynamic'

async function caller(req: NextRequest, brand: string): Promise<string | null> {
  try {
    const sb = createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      { cookies: { getAll() { return req.cookies.getAll() }, setAll() {} } })
    const { data: { user } } = await sb.auth.getUser()
    if (!user || !(effectiveBrands(user.user_metadata?.role, user.user_metadata?.brands) as string[]).includes(brand)) return null
    return (user.user_metadata?.full_name as string | undefined) || user.email || 'équipe'
  } catch { return null }
}

export type ReviewRow = {
  id: string; created_at: string; updated_at: string; source: string | null
  order_name: string | null; customer_name: string | null; customer_email: string | null
  rating: number; categories: string[]; comment: string | null
  contact_requested: boolean; contact_phone: string | null; contact_email: string | null
  trustpilot_clicked: boolean; completed: boolean; handled_at: string | null; handled_by: string | null
}

export async function GET(req: NextRequest, { params }: { params: { brand: string } }) {
  const { brand } = params
  if (!isReviewBrand(brand)) return NextResponse.json({ error: 'Marque inconnue' }, { status: 404 })
  if (!(await caller(req, brand))) return NextResponse.json({ error: 'Non autorisé' }, { status: 403 })
  const days = Math.min(Math.max(Number(req.nextUrl.searchParams.get('days')) || 90, 1), 3650)
  const since = new Date(Date.now() - days * 86400_000).toISOString()
  const { data, error } = await createAdminClient().from('review_responses')
    .select('id, created_at, updated_at, source, order_name, customer_name, customer_email, rating, categories, comment, contact_requested, contact_phone, contact_email, trustpilot_clicked, completed, handled_at, handled_by')
    .eq('brand', brand).gte('created_at', since).order('created_at', { ascending: false }).limit(2000)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ responses: data as ReviewRow[] }, { headers: { 'Cache-Control': 'no-store' } })
}

export async function PATCH(req: NextRequest, { params }: { params: { brand: string } }) {
  const { brand } = params
  if (!isReviewBrand(brand)) return NextResponse.json({ error: 'Marque inconnue' }, { status: 404 })
  const who = await caller(req, brand)
  if (!who) return NextResponse.json({ error: 'Non autorisé' }, { status: 403 })
  const { id, handled } = await req.json().catch(() => ({})) as { id?: string; handled?: boolean }
  if (!id) return NextResponse.json({ error: 'id manquant' }, { status: 400 })
  const { error } = await createAdminClient().from('review_responses')
    .update(handled ? { handled_at: new Date().toISOString(), handled_by: who } : { handled_at: null, handled_by: null })
    .eq('id', id).eq('brand', brand)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
