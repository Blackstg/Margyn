// Productions en cours (page Réappro) — persistées côté serveur pour être
// partagées entre appareils/utilisateurs et intégrées à la valorisation du stock.
//   GET  ?brand=moom            → { map: { [shopify_variant_id]: qty } }
//   PUT  { brand, shopify_variant_id, qty }   → upsert (qty>0) / delete (qty<=0)
//   POST { brand, map }         → remplace tout le lot (migration localStorage → serveur)

import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@supabase/auth-helpers-nextjs'
import { createClient } from '@supabase/supabase-js'
import { cookies } from 'next/headers'

export const dynamic = 'force-dynamic'

function admin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  )
}

async function requireUser() {
  const store = await cookies()
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { cookies: { getAll() { return store.getAll() }, setAll() {} } }
  )
  const { data: { user } } = await supabase.auth.getUser()
  return user
}

export async function GET(req: NextRequest) {
  if (!await requireUser()) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 })
  const brand = req.nextUrl.searchParams.get('brand') ?? ''
  if (!brand) return NextResponse.json({ error: 'brand requis' }, { status: 400 })

  const { data, error } = await admin()
    .from('reorder_production')
    .select('shopify_variant_id, qty')
    .eq('brand', brand)
  if (error) return NextResponse.json({ error: error.message, map: {} }, { status: 500 })

  const map: Record<string, number> = {}
  for (const r of data ?? []) if ((r.qty ?? 0) > 0) map[r.shopify_variant_id] = r.qty
  return NextResponse.json({ map })
}

export async function PUT(req: NextRequest) {
  if (!await requireUser()) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 })
  const body = await req.json().catch(() => ({})) as { brand?: string; shopify_variant_id?: string; qty?: number }
  const brand = body.brand ?? ''
  const vid   = body.shopify_variant_id ?? ''
  const qty   = Math.max(0, Math.floor(Number(body.qty) || 0))
  if (!brand || !vid) return NextResponse.json({ error: 'brand + shopify_variant_id requis' }, { status: 400 })

  const db = admin()
  if (qty > 0) {
    const { error } = await db.from('reorder_production')
      .upsert({ brand, shopify_variant_id: vid, qty, updated_at: new Date().toISOString() }, { onConflict: 'brand,shopify_variant_id' })
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  } else {
    const { error } = await db.from('reorder_production').delete().eq('brand', brand).eq('shopify_variant_id', vid)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  }
  return NextResponse.json({ ok: true })
}

// Remplace tout le lot d'une marque (utilisé une fois pour migrer le localStorage existant)
export async function POST(req: NextRequest) {
  if (!await requireUser()) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 })
  const body = await req.json().catch(() => ({})) as { brand?: string; map?: Record<string, number> }
  const brand = body.brand ?? ''
  const map   = body.map ?? {}
  if (!brand) return NextResponse.json({ error: 'brand requis' }, { status: 400 })

  const rows = Object.entries(map)
    .map(([shopify_variant_id, qty]) => ({ brand, shopify_variant_id, qty: Math.max(0, Math.floor(Number(qty) || 0)), updated_at: new Date().toISOString() }))
    .filter(r => r.qty > 0)
  if (rows.length === 0) return NextResponse.json({ ok: true, count: 0 })

  const { error } = await admin()
    .from('reorder_production')
    .upsert(rows, { onConflict: 'brand,shopify_variant_id' })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true, count: rows.length })
}
