import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { fetchSheetCsv, parseAllMonths } from '@/lib/fulfillmentSheet'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

function getAdmin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  )
}

function cronAuthorized(req: NextRequest): boolean {
  if (req.headers.get('x-vercel-cron')) return true
  const secret = process.env.CRON_SECRET ?? ''
  const auth = req.headers.get('authorization') ?? ''
  if (secret && (auth === `Bearer ${secret}` || auth === secret)) return true
  if (secret && req.nextUrl.searchParams.get('key') === secret) return true
  return false
}

// Synchronise la feuille « Coût du transport » → fixed_costs(category='fulfillment')
// pour CHAQUE mois présent dans la feuille. Miroir complet : on remplace les lignes
// fulfillment du mois par les postes de la feuille (salaire livreur, leasing, dépôts,
// carburant, péages… tout le tableau). Déclenché par cron (auto) ou manuellement.
async function runSync(brand: string) {
  const admin = getAdmin()
  const { data: settings } = await admin
    .from('brand_settings').select('fulfillment_sheet_url').eq('brand', brand).single()
  const sheetUrl = settings?.fulfillment_sheet_url as string | null | undefined
  if (!sheetUrl) return { brand, skipped: 'pas d’URL de feuille', monthsSynced: 0 }

  const csv = await fetchSheetCsv(sheetUrl)
  const { year, months } = parseAllMonths(csv)
  if (!year) throw new Error("Année introuvable dans le titre de la feuille")

  const synced: { month: string; posts: number; total: number }[] = []
  for (const m of months) {
    const monthStr = `${year}-${String(m.month).padStart(2, '0')}-01`
    // Miroir : on efface le fulfillment mensuel existant puis on réinsère la feuille.
    await admin.from('fixed_costs').delete()
      .eq('brand', brand).eq('category', 'fulfillment').eq('month', monthStr)
    if (m.posts.length > 0) {
      await admin.from('fixed_costs').insert(
        m.posts.map(p => ({ brand, category: 'fulfillment', month: monthStr, label: p.label, amount: p.amount }))
      )
    }
    synced.push({ month: monthStr, posts: m.posts.length, total: m.total })
  }
  return { brand, year, monthsSynced: synced.length, synced }
}

export async function GET(req: NextRequest) { return handle(req) }
export async function POST(req: NextRequest) { return handle(req) }

async function handle(req: NextRequest) {
  if (!cronAuthorized(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  try {
    const brand = req.nextUrl.searchParams.get('brand') ?? 'bowa'
    const result = await runSync(brand)
    return NextResponse.json({ ok: true, ...result })
  } catch (err) {
    console.error('[margins/fulfillment-sync]', err)
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 })
  }
}
