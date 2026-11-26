// Réappro autonome.
//   GET  ?brand=moom → données du calcul (variantes, ventes, relevés, commandes, réglages)
//   POST ?brand=moom { action, … } →
//     create_order  { orderedOn, source, lines: [{ variantId, qty, receivedQty? }], note? }
//     update_order  { orderId, prodDoneOn?, arrivalOn?, note? }   (décaler une date)
//     receive       { orderId, items: [{ variantId, qty }], close?, jump? }
//     cancel_order  { orderId }
//     snooze        { variantId } / unsnooze { variantId }       (« Pas maintenant »)
//     dismiss_jump  { jump: 'variantId|jour' }                    (hausse de stock ignorée)
//     settings      { patch }
import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@supabase/auth-helpers-nextjs'
import { effectiveBrands } from '@/lib/access'
import { createAdminClient } from '@/lib/supabase'
import { addDays, type ReorderSettings } from '@/lib/reorder/plan'
import { createOrder, loadReorderInputs, loadSettings, receive, saveSettings, type NewOrder } from '@/lib/reorder/data'
import { parisDay } from '@/lib/reorder/snapshots'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

async function allowed(req: NextRequest, brand: string): Promise<boolean> {
  try {
    const sb = createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      { cookies: { getAll() { return req.cookies.getAll() }, setAll() {} } })
    const { data: { user } } = await sb.auth.getUser()
    return !!user && (effectiveBrands(user.user_metadata?.role, user.user_metadata?.brands) as string[]).includes(brand)
  } catch { return false }
}

const isDay = (s: unknown): s is string => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s)

export async function GET(req: NextRequest) {
  const brand = req.nextUrl.searchParams.get('brand') ?? ''
  if (!(await allowed(req, brand))) return NextResponse.json({ error: 'Non autorisé' }, { status: 403 })
  try {
    return NextResponse.json(await loadReorderInputs(createAdminClient(), brand))
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 })
  }
}

// Seuls ces réglages sont modifiables depuis la page.
const SETTING_KEYS: (keyof ReorderSettings)[] = ['fabDays', 'transitDays', 'safetyDays', 'orderCoverDays', 'refPeriod', 'promos', 'products', 'recipients']

export async function POST(req: NextRequest) {
  const brand = req.nextUrl.searchParams.get('brand') ?? ''
  if (!(await allowed(req, brand))) return NextResponse.json({ error: 'Non autorisé' }, { status: 403 })
  const db = createAdminClient()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const b = await req.json().catch(() => ({})) as Record<string, any>
  try {
    switch (b.action) {
      case 'create_order': {
        const o: NewOrder = { orderedOn: isDay(b.orderedOn) ? b.orderedOn : parisDay(), source: b.source ?? 'validated', note: b.note ?? null, lines: Array.isArray(b.lines) ? b.lines : [] }
        if (!['validated', 'declared', 'after_the_fact'].includes(o.source)) throw new Error('source invalide')
        return NextResponse.json({ ok: true, id: await createOrder(db, brand, o) })
      }
      case 'update_order': {
        const patch: Record<string, unknown> = { updated_at: new Date().toISOString() }
        if (isDay(b.prodDoneOn)) patch.prod_done_on = b.prodDoneOn
        if (isDay(b.arrivalOn))  patch.arrival_on   = b.arrivalOn
        if (typeof b.note === 'string') patch.note = b.note
        const { error } = await db.from('purchase_orders').update(patch).eq('brand', brand).eq('id', b.orderId)
        if (error) throw new Error(error.message)
        return NextResponse.json({ ok: true })
      }
      case 'receive': {
        const r = await receive(db, brand, String(b.orderId), Array.isArray(b.items) ? b.items : [], !!b.close)
        if (typeof b.jump === 'string') await dismissJump(db, brand, b.jump)
        return NextResponse.json({ ok: true, ...r })
      }
      case 'cancel_order': {
        const { error } = await db.from('purchase_orders').update({ status: 'cancelled', updated_at: new Date().toISOString() }).eq('brand', brand).eq('id', b.orderId)
        if (error) throw new Error(error.message)
        return NextResponse.json({ ok: true })
      }
      case 'snooze': {
        const s = await loadSettings(db, brand)
        const until = addDays(parisDay(), s.snoozeDays)
        const { error } = await db.from('reorder_snoozes').upsert({ brand, shopify_variant_id: String(b.variantId), until }, { onConflict: 'brand,shopify_variant_id' })
        if (error) throw new Error(error.message)
        return NextResponse.json({ ok: true, until })
      }
      case 'unsnooze': {
        await db.from('reorder_snoozes').delete().eq('brand', brand).eq('shopify_variant_id', String(b.variantId))
        return NextResponse.json({ ok: true })
      }
      case 'dismiss_jump': {
        await dismissJump(db, brand, String(b.jump))
        return NextResponse.json({ ok: true })
      }
      case 'settings': {
        const patch = Object.fromEntries(Object.entries(b.patch ?? {}).filter(([k]) => SETTING_KEYS.includes(k as keyof ReorderSettings))) as Partial<ReorderSettings>
        return NextResponse.json({ ok: true, settings: await saveSettings(db, brand, patch) })
      }
      default:
        return NextResponse.json({ error: 'action inconnue' }, { status: 400 })
    }
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 })
  }
}

async function dismissJump(db: ReturnType<typeof createAdminClient>, brand: string, key: string) {
  const s = await loadSettings(db, brand)
  if (!s.dismissedJumps.includes(key)) await saveSettings(db, brand, { dismissedJumps: [...s.dismissedJumps, key].slice(-500) })
}
