// Grille tarifaire du logisticien (poids × pays) pour la prévision de livraison.
//   GET  ?brand=moom → { grid: { importedAt, rows, prepPerOrder } | null, missingWeights, products }
//   POST ?brand=moom { rows: [{ country, maxKg, price }] } → enregistre la grille (€)
// Dès qu'elle est importée, les commandes pas encore facturées dont tous les produits
// ont un poids (Produits) sont estimées à la grille ; les autres gardent le calcul appris.
import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@supabase/auth-helpers-nextjs'
import { effectiveBrands } from '@/lib/access'
import { gridStatus, saveGrid } from '@/lib/shippingCost'

export const dynamic = 'force-dynamic'
export const maxDuration = 120

async function allowed(req: NextRequest, brand: string): Promise<boolean> {
  try {
    const sb = createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      { cookies: { getAll() { return req.cookies.getAll() }, setAll() {} } })
    const { data: { user } } = await sb.auth.getUser()
    return !!user && (effectiveBrands(user.user_metadata?.role, user.user_metadata?.brands) as string[]).includes(brand)
  } catch { return false }
}

export async function GET(req: NextRequest) {
  const brand = req.nextUrl.searchParams.get('brand') ?? ''
  if (!(await allowed(req, brand))) return NextResponse.json({ error: 'Non autorisé' }, { status: 403 })
  return NextResponse.json(await gridStatus(brand))
}

export async function POST(req: NextRequest) {
  const brand = req.nextUrl.searchParams.get('brand') ?? ''
  if (!(await allowed(req, brand))) return NextResponse.json({ error: 'Non autorisé' }, { status: 403 })
  const body = await req.json().catch(() => null) as { rows?: { country?: unknown; maxKg?: unknown; price?: unknown }[] } | null
  const rows = (body?.rows ?? [])
    .map(r => ({ country: String(r.country ?? '').trim().toUpperCase() || '*', maxKg: Number(r.maxKg), price: Number(r.price) }))
    .filter(r => /^([A-Z]{2}|\*)$/.test(r.country) && r.maxKg > 0 && r.price >= 0)
  if (!rows.length) return NextResponse.json({ error: 'Aucune ligne valide (pays, poids max en kg, prix en €)' }, { status: 400 })
  const grid = await saveGrid(brand, rows)
  return NextResponse.json({ ok: true, rows: grid.rows.length, importedAt: grid.importedAt })
}
