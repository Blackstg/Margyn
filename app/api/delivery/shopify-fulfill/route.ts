// Rattrapage : marque « traitées » dans Shopify les commandes livrées (Steero) qui ne
// le sont pas encore (coupure réseau au moment du « livré », livraisons d'avant
// l'automatisation…). GET (cron) ou POST ?days=45&dry=1 — protégé par CRON_SECRET.
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { fulfillOrder, notFulfilledIds, type FulfillResult, type FulfillStop } from '@/lib/delivery/shopifyFulfill'

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
    .select('shopify_order_id')
    .in('status', ['delivered', 'partial'])
    .gte('delivered_at', since)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const recent = (data ?? []) as FulfillStop[]
  const todo = [...await notFulfilledIds([...new Set(recent.map(s => String(s.shopify_order_id ?? '')).filter(Boolean))])]
  // Toutes les livraisons de ces commandes (même anciennes), calcul par commande
  const { data: all, error: e2 } = todo.length
    ? await sb.from('delivery_stops').select('order_name, shopify_order_id, status, panel_details, partial_delivered').in('shopify_order_id', todo)
    : { data: [], error: null }
  if (e2) return NextResponse.json({ error: e2.message }, { status: 500 })
  const results: FulfillResult[] = []
  for (const id of todo) {
    results.push(await fulfillOrder(((all ?? []) as FulfillStop[]).filter(s => String(s.shopify_order_id) === id), { dryRun }))
  }
  return NextResponse.json({
    dryRun, days, checked: todo.length,
    fulfilled: results.filter(r => r.fulfilled.length).length,
    errors: results.filter(r => r.error).length,
    results,
  })
}

export const GET = run
export const POST = run
