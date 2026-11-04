// Page usine (interne /[brand]/supplier). Calcul : lib/supplierForecast.ts
//   GET  ?brand=krom                  → prévision + lien de partage (admin)
//   PUT  { brand, ...réglages }       → enregistre les réglages (admin)
//   POST { brand, action: 'rotate' }  → nouveau lien secret, l'ancien ne marche plus (admin)
import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@supabase/auth-helpers-nextjs'
import { createClient } from '@supabase/supabase-js'
import { cookies } from 'next/headers'
import { effectiveBrands, isAdminRole } from '@/lib/access'
import { computeForecast, loadOrInitConfig, newToken, saveConfig, type SupplierConfig } from '@/lib/supplierForecast'

export const dynamic = 'force-dynamic'
export const fetchCache = 'force-no-store'
export const maxDuration = 60

const admin = () => createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { autoRefreshToken: false, persistSession: false } })

async function access(brand: string): Promise<{ ok: boolean; admin: boolean }> {
  try {
    const store = await cookies()
    const sb = createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      { cookies: { getAll() { return store.getAll() }, setAll() {} } })
    const { data: { user } } = await sb.auth.getUser()
    if (!user) return { ok: false, admin: false }
    const m = user.user_metadata ?? {}
    const ok = (effectiveBrands(m.role, m.brands) as string[]).includes(brand)
    return { ok, admin: ok && isAdminRole(m.role) }
  } catch { return { ok: false, admin: false } }
}

const shareUrl = (req: NextRequest, token: string) => `${req.nextUrl.origin}/factory/${token}`

export async function GET(req: NextRequest) {
  const brand = req.nextUrl.searchParams.get('brand') ?? ''
  const a = await access(brand)
  if (!a.ok) return NextResponse.json({ error: 'Accès refusé' }, { status: 403 })
  try {
    const db = admin()
    const config = await loadOrInitConfig(db, brand)
    const forecast = await computeForecast(db, brand, config)
    return NextResponse.json({ forecast, canEdit: a.admin, shareUrl: a.admin ? shareUrl(req, config.token) : null })
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 })
  }
}

const num = (v: unknown, min: number, max: number, dflt: number) => {
  const n = Number(v)
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : dflt
}

export async function PUT(req: NextRequest) {
  const body = await req.json().catch(() => ({})) as Partial<SupplierConfig> & { brand?: string }
  const brand = body.brand ?? ''
  if (!(await access(brand)).admin) return NextResponse.json({ error: 'Réservé aux comptes admin' }, { status: 403 })
  const db = admin()
  const c = await loadOrInitConfig(db, brand)
  const next: SupplierConfig = {
    ...c,
    factoryName: typeof body.factoryName === 'string' ? body.factoryName.slice(0, 80) : c.factoryName,
    lang: body.lang === 'zh' || body.lang === 'fr' || body.lang === 'en' ? body.lang : c.lang,
    productionDays: Math.round(num(body.productionDays, 1, 120, c.productionDays)),
    transitDays: Math.round(num(body.transitDays, 0, 120, c.transitDays)),
    horizonMonths: num(body.horizonMonths, 0.5, 6, c.horizonMonths),
    safetyDays: Math.round(num(body.safetyDays, 0, 90, c.safetyDays)),
    showStock: typeof body.showStock === 'boolean' ? body.showStock : c.showStock,
    note: typeof body.note === 'string' ? body.note.slice(0, 2000) : c.note,
    seasonality: body.seasonality && typeof body.seasonality === 'object'
      ? Object.fromEntries(Object.entries(body.seasonality).filter(([k]) => /^(0[1-9]|1[0-2])$/.test(k)).map(([k, v]) => [k, num(v, 0, 10, 1)]))
      : c.seasonality,
    items: body.items && typeof body.items === 'object'
      ? Object.fromEntries(Object.entries(body.items).map(([k, v]) => [k.slice(0, 120), {
          include: !!v.include,
          name: v.name?.slice(0, 120) || undefined, nameZh: v.nameZh?.slice(0, 120) || undefined, sku: v.sku?.slice(0, 60) || undefined,
          pack: Math.round(num(v.pack, 1, 10000, 1)),
        }]))
      : c.items,
  }
  await saveConfig(db, brand, next)
  return NextResponse.json({ ok: true })
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({})) as { brand?: string; action?: string }
  const brand = body.brand ?? ''
  if (!(await access(brand)).admin) return NextResponse.json({ error: 'Réservé aux comptes admin' }, { status: 403 })
  if (body.action !== 'rotate') return NextResponse.json({ error: 'action inconnue' }, { status: 400 })
  const db = admin()
  const c = await loadOrInitConfig(db, brand)
  c.token = newToken(brand)
  await saveConfig(db, brand, c)
  return NextResponse.json({ ok: true, shareUrl: shareUrl(req, c.token) })
}
