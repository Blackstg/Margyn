// Rattrapage : marque « traitées » dans Shopify les commandes livrées (Steero) qui ne
// le sont pas encore (coupure réseau au moment du « livré », livraisons d'avant
// l'automatisation…). GET (cron) ou POST ?days=45&dry=1 — protégé par CRON_SECRET.
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { fulfillStop, notFulfilledIds, type FulfillResult, type FulfillStop } from '@/lib/delivery/shopifyFulfill'

export const maxDuration = 300
export const dynamic = 'force-dynamic'

function isAuthorized(req: NextRequest): boolean {
  const header = req.headers.get('authorization') ?? ''
  const token = header.startsWith('Bearer ') ? header.slice(7) : header
  return token === process.env.CRON_SECRET
}

async function run(req: NextRequest) {
  if (!isAuthorized(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const days = Math.min(120, Math.max(1, Number(req.nextUrl.searchParams.get('days') ?? 45)))
  const dryRun = req.nextUrl.searchParams.get('dry') === '1'
  const since = new Date(Date.now() - days * 86400_000).toISOString()

  const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } })
  const { data, error } = await sb.from('delivery_stops')
    .select('order_name, shopify_order_id, status, panel_details, partial_delivered, delivered_at')
    .in('status', ['delivered', 'partial'])
    .gte('delivered_at', since)
    .order('delivered_at')
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const stops = (data ?? []) as (FulfillStop & { delivered_at: string })[]
  const todo = await notFulfilledIds([...new Set(stops.map(s => String(s.shopify_order_id ?? '')).filter(Boolean))])
  const results: FulfillResult[] = []
  for (const s of stops) {
    if (!todo.has(String(s.shopify_order_id ?? ''))) continue
    results.push(await fulfillStop(s, { dryRun }))
  }
  return NextResponse.json({
    dryRun, days, checked: stops.length,
    fulfilled: results.filter(r => r.fulfilled.length).length,
    errors: results.filter(r => r.error).length,
    results,
  })
}

export const GET = run
export const POST = run
