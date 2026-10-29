// PUT /api/pilot/fixed?brand=bowa — remplace les charges récurrentes (salaires, crédits/compta,
// applis) et leur période de validité. Body : { rows: [{ category, label, amount, from?, to? }] }
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { createServerClient } from '@supabase/auth-helpers-nextjs'
import { cookies } from 'next/headers'
import { loadValidity, saveValidity, validityKey } from '@/lib/fixedCostValidity'

export const dynamic = 'force-dynamic'

const SENTINEL = '1900-01-01'
const CATEGORIES = ['team', 'infra', 'app']
const MONTH = /^\d{4}-\d{2}$/

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
  const body = await req.json().catch(() => null) as { rows?: { category?: string; label?: string; amount?: number; from?: string; to?: string }[] } | null
  if (!Array.isArray(body?.rows)) return NextResponse.json({ error: 'rows requis' }, { status: 400 })

  const rows = body!.rows
    .filter(r => CATEGORIES.includes(String(r.category)) && String(r.label ?? '').trim() && Number(r.amount) > 0)
    .map(r => ({
      category: String(r.category), label: String(r.label).trim().slice(0, 120), amount: Math.round(Number(r.amount) * 100) / 100,
      from: MONTH.test(String(r.from ?? '')) ? r.from : undefined,
      to: MONTH.test(String(r.to ?? '')) ? r.to : undefined,
    }))

  const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } })
  const { error: delErr } = await sb.from('fixed_costs').delete().eq('brand', brand).eq('month', SENTINEL).in('category', CATEGORIES)
  if (delErr) return NextResponse.json({ error: delErr.message }, { status: 500 })
  if (rows.length) {
    const { error } = await sb.from('fixed_costs').insert(rows.map(r => ({ brand, month: SENTINEL, category: r.category, label: r.label, amount: r.amount })))
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  }
  // Périodes : on garde celles des autres catégories (ex. fulfillment), on remplace celles-ci
  const validity = await loadValidity(sb, brand)
  for (const k of Object.keys(validity)) if (CATEGORIES.includes(k.split(':')[0])) delete validity[k]
  for (const r of rows) if (r.from || r.to) validity[validityKey(r.category, r.label)] = { ...(r.from ? { from: r.from } : {}), ...(r.to ? { to: r.to } : {}) }
  await saveValidity(sb, brand, validity)
  return NextResponse.json({ ok: true, saved: rows.length })
}
