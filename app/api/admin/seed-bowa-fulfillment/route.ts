import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

function getAdmin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  )
}

// Seed Bowa fulfillment costs (sentinel row 1900-01-01, category='fulfillment')
// Call with: POST /api/admin/seed-bowa-fulfillment?secret=<SETUP_SECRET>
// Optionally pass JSON body: { khalid: 5000, enzo: 0, essence: 0 }
export async function POST(req: NextRequest) {
  const secret = req.nextUrl.searchParams.get('secret')
  if (!secret || secret !== process.env.SETUP_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  let body: { khalid?: number; enzo?: number; essence?: number } = {}
  try { body = await req.json() } catch { /* default values */ }

  const khalid  = body.khalid  ?? 5000
  const enzo    = body.enzo    ?? 0
  const essence = body.essence ?? 0

  const admin = getAdmin()
  const SENTINEL = '1900-01-01'

  // Delete existing fulfillment entries for bowa
  const { error: delError } = await admin
    .from('fixed_costs')
    .delete()
    .eq('month', SENTINEL)
    .eq('brand', 'bowa')
    .eq('category', 'fulfillment')

  if (delError) {
    return NextResponse.json({ error: delError.message }, { status: 500 })
  }

  // Insert new entries (only non-zero amounts)
  const entries = [
    { label: 'Khalid (livraison)', amount: khalid  },
    { label: 'Enzo (livraison)',   amount: enzo    },
    { label: 'Essence',           amount: essence },
  ].filter((e) => e.amount > 0)

  if (entries.length > 0) {
    const { error: insError } = await admin.from('fixed_costs').insert(
      entries.map((e) => ({
        month:    SENTINEL,
        brand:    'bowa',
        category: 'fulfillment',
        label:    e.label,
        amount:   e.amount,
      }))
    )
    if (insError) {
      return NextResponse.json({ error: insError.message }, { status: 500 })
    }
  }

  return NextResponse.json({ ok: true, inserted: entries })
}
