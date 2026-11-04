// Actions de l'usine depuis sa page (lien secret, sans compte) :
//   POST { action: 'ready', key, qty }        → son stock prêt pour nous, par modèle
//   POST { action: 'ship', date, lines }      → « I shipped » : compté en route jusqu'à réception
//   POST { action: 'unship', id }             → annule une déclaration récente (erreur de saisie)
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { computeForecast, loadConfig, saveConfig, tokenMatches } from '@/lib/supplierForecast'
import { BRANDS } from '@/lib/access'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

const qtyOf = (v: unknown) => Math.min(100_000, Math.max(0, Math.round(Number(v) || 0)))

export async function POST(req: NextRequest, { params }: { params: { token: string } }) {
  const token = decodeURIComponent(params.token ?? '')
  const brand = token.split('-')[0]
  if (!(BRANDS as string[]).includes(brand)) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { autoRefreshToken: false, persistSession: false } })
  const config = await loadConfig(db, brand)
  if (!config || !tokenMatches(config.token, token)) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const body = await req.json().catch(() => ({})) as { action?: string; key?: string; qty?: number; date?: string; lines?: Record<string, number>; id?: string }
  const f = config.factory
  const now = new Date()

  if (body.action === 'ready') {
    const forecast = await computeForecast(db, brand, config, now)
    if (!body.key || !forecast.items.some(i => i.key === body.key)) return NextResponse.json({ error: 'Unknown item' }, { status: 400 })
    f.ready[body.key] = qtyOf(body.qty)
    f.readyAt[body.key] = now.toISOString()
  } else if (body.action === 'ship') {
    const forecast = await computeForecast(db, brand, config, now)
    const known = new Set(forecast.items.map(i => i.key))
    const lines = Object.fromEntries(Object.entries(body.lines ?? {}).filter(([k]) => known.has(k)).map(([k, v]) => [k, qtyOf(v)]).filter(([, v]) => (v as number) > 0))
    if (!Object.keys(lines).length) return NextResponse.json({ error: 'No quantity' }, { status: 400 })
    const date = body.date && /^\d{4}-\d{2}-\d{2}$/.test(body.date) ? body.date : forecast.today
    f.shipments.unshift({
      id: Math.random().toString(36).slice(2, 10), date, lines, createdAt: now.toISOString(),
      stockAt: Object.fromEntries(forecast.items.filter(i => lines[i.key]).map(i => [i.key, i.stock])),
    })
    // Ce qui part n'est plus « prêt » à l'usine
    for (const [k, q] of Object.entries(lines)) if (f.ready[k] != null) { f.ready[k] = Math.max(0, f.ready[k] - (q as number)); f.readyAt[k] = now.toISOString() }
    f.shipments = f.shipments.slice(0, 100)
  } else if (body.action === 'unship') {
    const sh = f.shipments.find(x => x.id === body.id)
    if (!sh || now.getTime() - new Date(sh.createdAt).getTime() > 7 * 86400_000) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    for (const [k, q] of Object.entries(sh.lines)) if (f.ready[k] != null) f.ready[k] += q
    f.shipments = f.shipments.filter(x => x.id !== body.id)
  } else {
    return NextResponse.json({ error: 'Unknown action' }, { status: 400 })
  }
  await saveConfig(db, brand, config)
  return NextResponse.json({ ok: true })
}
