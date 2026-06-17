// POST /api/sav-defects/close-batch  { brand, batch }
// Clôture en masse tous les dossiers d'un lot de production (jalon "clos").

import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase'

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  const body  = await req.json().catch(() => ({}))
  const brand = body.brand ?? 'moom'
  const batch = (body.batch ?? '').toString().trim()
  if (!batch) return NextResponse.json({ error: 'lot manquant' }, { status: 400 })

  const admin = createAdminClient()
  const { data, error } = await admin
    .from('defect_claims')
    .select('id, milestones')
    .eq('brand', brand)
    .eq('production_batch', batch)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const today = new Date().toISOString().slice(0, 10)
  let count = 0
  for (const r of data ?? []) {
    const m = (r.milestones ?? {}) as Record<string, string>
    if (m.clos) continue
    await admin.from('defect_claims')
      .update({ milestones: { ...m, clos: today }, received_at: m.recu || null, updated_at: new Date().toISOString() })
      .eq('id', r.id)
    count++
  }
  return NextResponse.json({ ok: true, count })
}
