// GET /api/creatives?brand=moom&from=2026-04-15&to=2026-05-14
// Retourne toutes les ad_creatives + creative_stats pour la période donnée.
// Utilise la service_role key (pas de limite de 1000 lignes comme l'anon key navigateur).

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

export const dynamic = 'force-dynamic'

function getAdmin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}

const PAGE = 1000  // lignes par page

async function fetchAll<T>(
  table: string,
  query: (sb: ReturnType<typeof getAdmin>, from: number, to: number) => Promise<{ data: T[] | null; error: unknown }>,
  admin: ReturnType<typeof getAdmin>
): Promise<T[]> {
  const result: T[] = []
  let from = 0
  while (true) {
    const to = from + PAGE - 1
    const { data, error } = await query(admin, from, to)
    if (error) throw error
    if (!data || data.length === 0) break
    result.push(...data)
    if (data.length < PAGE) break
    from += PAGE
  }
  return result
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const brand  = searchParams.get('brand') ?? 'bowa'
  const from   = searchParams.get('from')  ?? ''
  const to     = searchParams.get('to')    ?? ''

  if (!from || !to) {
    return NextResponse.json({ error: 'from and to required' }, { status: 400 })
  }

  try {
    const admin = getAdmin()

    // 1. Toutes les ad_creatives pour cette brand (paginé, pas de limite)
    const creatives = await fetchAll(
      'ad_creatives',
      (sb, f, t) => sb.from('ad_creatives')
        .select('*')
        .in('brand', brand === 'all' ? ['bowa', 'moom', 'krom'] : [brand])
        .order('first_seen_at', { ascending: false })
        .range(f, t) as unknown as Promise<{ data: unknown[] | null; error: unknown }>,
      admin
    )

    // 2. creative_stats pour ces IDs et la période (paginé par 1000)
    const ids = (creatives as Record<string, unknown>[]).map(c => c.id as string)
    const CHUNK = 500
    const stats: unknown[] = []

    for (let i = 0; i < ids.length; i += CHUNK) {
      const chunk = ids.slice(i, i + CHUNK)
      const chunkStats = await fetchAll(
        'creative_stats',
        (sb, f, t) => sb.from('creative_stats')
          .select('*')
          .in('creative_id', chunk)
          .gte('date', from)
          .lte('date', to)
          .range(f, t) as unknown as Promise<{ data: unknown[] | null; error: unknown }>,
        admin
      )
      stats.push(...chunkStats)
    }

    return NextResponse.json({ creatives, stats }, {
      headers: { 'Cache-Control': 'no-store' },
    })
  } catch (err) {
    console.error('[api/creatives]', err)
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
