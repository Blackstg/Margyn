import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { normalizeDriverName } from '@/lib/delivery/driver'

export const dynamic = 'force-dynamic'
export const fetchCache = 'force-no-store'   // toujours relire les comptes (nouveaux chauffeurs)

function getAdmin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  )
}

// Canonical list of drivers for the "Chauffeur" dropdown.
// Sourced from two places so nobody is missing:
//   1. accounts with role="delivery" scoped to Bowa (their full_name)
//   2. driver names already used on existing tours (auto-discovers drivers
//      like "Enzo" who may not have an account yet)
// Names are normalized + de-duplicated case-insensitively so "enzo"/"ENZO"
// collapse to a single "Enzo".
export async function GET() {
  try {
    const admin = getAdmin()
    const names = new Set<string>()

    // 1. delivery-role accounts
    const { data: userData, error: userErr } = await admin.auth.admin.listUsers({ perPage: 1000 })
    if (userErr) throw userErr
    for (const u of userData.users) {
      const m = u.user_metadata ?? {}
      const role = m.role as string | undefined
      const brands = Array.isArray(m.brands) ? (m.brands as string[]) : []
      if (role === 'delivery' && brands.includes('bowa')) {
        const display = (m.full_name as string | undefined) ?? (m.name as string | undefined) ?? ''
        const n = normalizeDriverName(display)
        if (n) names.add(n)
      }
    }

    // 2. driver names already used on tours
    const { data: tours, error: tourErr } = await admin
      .from('delivery_tours')
      .select('driver_name')
      .eq('brand', 'bowa')
    if (tourErr) throw tourErr
    for (const t of tours ?? []) {
      // Une tournée à deux est stockée « Chauffeur1 & Chauffeur2 » → on ajoute chacun
      // séparément dans le menu (pas le combo).
      for (const part of String(t.driver_name ?? '').split(/\s*[&,]\s*/)) {
        const n = normalizeDriverName(part)
        if (n) names.add(n)
      }
    }

    const drivers = [...names].sort((a, b) => a.localeCompare(b, 'fr-FR'))
    return NextResponse.json({ drivers })
  } catch (err) {
    console.error('[delivery/drivers GET]', err)
    return NextResponse.json({ drivers: [], error: String(err) }, { status: 500 })
  }
}
