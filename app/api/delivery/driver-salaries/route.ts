import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { normalizeDriverName } from '@/lib/delivery/driver'

export const dynamic = 'force-dynamic'

function getAdmin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}

// GET ?brand=bowa → liste des salaires mensuels par chauffeur.
export async function GET(req: NextRequest) {
  const brand = req.nextUrl.searchParams.get('brand') ?? 'bowa'
  try {
    const admin = getAdmin()
    const { data, error } = await admin
      .from('driver_salaries')
      .select('driver_name, monthly_salary')
      .eq('brand', brand)
    if (error) throw error
    return NextResponse.json({ salaries: data ?? [] })
  } catch (err) {
    // Table pas encore déployée → on renvoie une liste vide (feature inactive).
    console.error('[driver-salaries GET]', err)
    return NextResponse.json({ salaries: [] })
  }
}

// POST { brand, driver_name, monthly_salary } → upsert du salaire d'un chauffeur.
export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const brand = String(body?.brand ?? 'bowa')
    const driver_name = normalizeDriverName(String(body?.driver_name ?? '').trim())
    const monthly_salary = Number(body?.monthly_salary) || 0
    if (!driver_name) return NextResponse.json({ error: 'driver_name requis' }, { status: 400 })

    const admin = getAdmin()
    const { data, error } = await admin
      .from('driver_salaries')
      .upsert({ brand, driver_name, monthly_salary, updated_at: new Date().toISOString() }, { onConflict: 'brand,driver_name' })
      .select()
      .single()
    if (error) throw error
    return NextResponse.json({ salary: data })
  } catch (err) {
    console.error('[driver-salaries POST]', err)
    const msg = err instanceof Error ? err.message : JSON.stringify(err)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
