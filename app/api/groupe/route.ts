// GET /api/groupe?year=2026 — CA, marge brute et pub par marque et par mois, pour
// l'année demandée et la précédente. Réservé au propriétaire (lib/owner.ts).
// Mêmes règles que le dashboard de chaque marque : CA = ventes Shopify + ventes
// privées ; marge brute Bowa calculée HT (CA TTC × 5/6 − COGS), sinon CA − COGS.
import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@supabase/auth-helpers-nextjs'
import { createAdminClient } from '@/lib/supabase'
import { isOwner } from '@/lib/owner'
import { BRANDS, type Brand } from '@/lib/access'

export const dynamic = 'force-dynamic'

export type GroupeMonth = { ca: number; gross: number; ads: number; orders: number }
export type GroupeData = {
  year: number
  today: string                                   // AAAA-MM-JJ (Paris)
  brands: Brand[]
  months: Record<Brand, GroupeMonth[]>            // 12 mois de l'année demandée
  prev: Record<Brand, GroupeMonth[]>              // 12 mois de l'année précédente
  prevMtd: Record<Brand, GroupeMonth>             // mois en cours de l'an dernier, jusqu'au même jour
}

async function ownerEmail(req: NextRequest): Promise<string | null> {
  try {
    const sb = createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
      cookies: { getAll() { return req.cookies.getAll() }, setAll() { /* rafraîchi par le middleware */ } },
    })
    const { data: { user } } = await sb.auth.getUser()
    return user?.email ?? null
  } catch { return null }
}

// PostgREST plafonne à 1000 lignes → pagination.
async function fetchAll<T>(q: (from: number, to: number) => PromiseLike<{ data: T[] | null }>): Promise<T[]> {
  const out: T[] = []
  for (let i = 0; i < 50; i++) {
    const { data } = await q(i * 1000, i * 1000 + 999)
    out.push(...(data ?? []))
    if (!data || data.length < 1000) break
  }
  return out
}

const empty = (): GroupeMonth => ({ ca: 0, gross: 0, ads: 0, orders: 0 })

export async function GET(req: NextRequest) {
  if (!isOwner(await ownerEmail(req))) return NextResponse.json({ error: 'Accès réservé' }, { status: 403 })

  const today = new Date().toLocaleDateString('fr-CA', { timeZone: 'Europe/Paris' })
  const year = Number(req.nextUrl.searchParams.get('year')) || Number(today.slice(0, 4))
  const from = `${year - 1}-01-01`, to = `${year}-12-31`
  const admin = createAdminClient()

  type Snap = { brand: string; date: string; total_sales: number | null; cogs: number | null; order_count: number | null }
  type Ad   = { brand: string; date: string; spend: number | null }
  type Supp = { brand: string; month: string; amount: number | null }
  const [snaps, ads, supp] = await Promise.all([
    fetchAll<Snap>((a, b) => admin.from('daily_snapshots').select('brand, date, total_sales, cogs, order_count').gte('date', from).lte('date', to).order('date').range(a, b)),
    fetchAll<Ad>((a, b) => admin.from('ad_spends').select('brand, date, spend').gte('date', from).lte('date', to).order('date').range(a, b)),
    fetchAll<Supp>((a, b) => admin.from('supplementary_revenue').select('brand, month, amount').gte('month', from).lte('month', to).range(a, b)),
  ])

  // Agrégats bruts par marque × année × mois (sales, cogs) avant la règle de marge
  type Raw = { sales: number; cogs: number; supp: number; ads: number; orders: number }
  const raw = (): Raw => ({ sales: 0, cogs: 0, supp: 0, ads: 0, orders: 0 })
  const grid = new Map<string, Raw>()                      // `${brand}|${yyyy}|${m}`
  const mtd  = new Map<string, Raw>()                      // brand → an dernier, mois courant ≤ jour
  const cell = (m: Map<string, Raw>, k: string) => { let r = m.get(k); if (!r) { r = raw(); m.set(k, r) } return r }
  const curMonth = Number(today.slice(5, 7)), curDay = Number(today.slice(8, 10))
  const isPrevMtd = (date: string) => Number(date.slice(0, 4)) === year - 1 && Number(date.slice(5, 7)) === curMonth && Number(date.slice(8, 10)) <= curDay

  for (const s of snaps) {
    const c = cell(grid, `${s.brand}|${s.date.slice(0, 4)}|${Number(s.date.slice(5, 7))}`)
    c.sales += s.total_sales ?? 0; c.cogs += s.cogs ?? 0; c.orders += s.order_count ?? 0
    if (isPrevMtd(s.date)) { const p = cell(mtd, s.brand); p.sales += s.total_sales ?? 0; p.cogs += s.cogs ?? 0; p.orders += s.order_count ?? 0 }
  }
  for (const a of ads) {
    cell(grid, `${a.brand}|${a.date.slice(0, 4)}|${Number(a.date.slice(5, 7))}`).ads += a.spend ?? 0
    if (isPrevMtd(a.date)) cell(mtd, a.brand).ads += a.spend ?? 0
  }
  // Ventes privées : montant mensuel, compté en entier dans son mois
  for (const v of supp) cell(grid, `${v.brand}|${v.month.slice(0, 4)}|${Number(v.month.slice(5, 7))}`).supp += v.amount ?? 0

  const finalize = (brand: Brand, r: Raw | undefined): GroupeMonth => {
    if (!r) return empty()
    const ca = r.sales + r.supp
    const gross = brand === 'bowa' ? ca * (5 / 6) - r.cogs : r.sales - r.cogs + r.supp
    return { ca: Math.round(ca), gross: Math.round(gross), ads: Math.round(r.ads), orders: r.orders }
  }
  const yearOf = (brand: Brand, y: number) => Array.from({ length: 12 }, (_, i) => finalize(brand, grid.get(`${brand}|${y}|${i + 1}`)))

  const brands = BRANDS.filter(b => [year, year - 1].some(y => yearOf(b, y).some(m => m.ca > 0)))
  const data: GroupeData = {
    year, today, brands,
    months:  Object.fromEntries(brands.map(b => [b, yearOf(b, year)])) as GroupeData['months'],
    prev:    Object.fromEntries(brands.map(b => [b, yearOf(b, year - 1)])) as GroupeData['prev'],
    prevMtd: Object.fromEntries(brands.map(b => [b, finalize(b, mtd.get(b))])) as GroupeData['prevMtd'],
  }
  return NextResponse.json(data)
}
