// Audit quotidien du suivi client Krom / Moom : pour chaque colis en cours, on
// calcule ce que la page /tracking/[brand] montre au client (même API, même logique)
// et on le compare au suivi YunExpress réel de 17Track. Les écarts sont envoyés par
// mail à TRACKING_AUDIT_EMAIL (si définie) → on corrige avant que le client ne voie.
import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase'
import { shopifyCreds } from '@/lib/tenant/integrations'
import { getTrackInfo, normalize, CARRIER, type Track17Result } from '@/lib/track17'
import { auditTracking, type AuditIssue } from '@/lib/tracking/audit'
import type { TrackingResult } from '@/lib/tracking/display'
import { POST as trackingPOST } from '@/app/api/tracking/[brand]/route'

export const maxDuration = 300
export const dynamic = 'force-dynamic'

const BRANDS = ['krom', 'moom'] as const
const LOOKBACK_DAYS = 40

function isAuthorized(req: NextRequest): boolean {
  const h = req.headers.get('authorization') ?? ''
  const t = h.startsWith('Bearer ') ? h.slice(7) : h
  return (!!process.env.CRON_SECRET && t === process.env.CRON_SECRET) || req.headers.get('x-vercel-cron') === '1'
}

type Order = { id: number; name: string; email: string | null; fulfillments: { tracking_number: string | null; tracking_numbers?: string[] | null }[] }

async function shippedOrders(brand: string): Promise<Order[]> {
  const c = await shopifyCreds(brand)
  if (!c.shop || !c.token) return []
  const since = new Date(Date.now() - LOOKBACK_DAYS * 86400_000).toISOString()
  const out: Order[] = []
  let url: string | null = `https://${c.shop}/admin/api/2024-10/orders.json?status=any&fulfillment_status=shipped&limit=250&created_at_min=${since}&fields=id,name,email,fulfillments`
  for (let i = 0; url && i < 20; i++) {
    const res: Response = await fetch(url, { headers: { 'X-Shopify-Access-Token': c.token }, cache: 'no-store' })
    if (!res.ok) break
    const j = await res.json() as { orders: Order[] }
    out.push(...j.orders)
    const next: string | undefined = (res.headers.get('link') ?? '').match(/<([^>]+)>;\s*rel="next"/)?.[1]
    url = next ?? null
  }
  return out
}

const trackingOf = (o: Order) => {
  const f = o.fulfillments?.[o.fulfillments.length - 1]
  const nums = f?.tracking_numbers
  return (nums && nums.length ? nums[nums.length - 1] : f?.tracking_number) ?? null
}

// Suivi de référence (17Track), par lots de 40 : YunExpress d'abord (le plus précis),
// sinon détection automatique (ex. Colissimo direct sur Moom, numéros 6A…).
async function truthFor(numbers: string[]): Promise<Map<string, Track17Result>> {
  const map = new Map<string, Track17Result>()
  const query = async (nums: string[], carrier?: number) => {
    for (let i = 0; i < nums.length; i += 40) {
      try {
        const j = await getTrackInfo(nums.slice(i, i + 40).map(number => (carrier ? { number, carrier } : { number })))
        for (const acc of j?.data?.accepted ?? []) {
          const r = normalize(acc)
          if (r && r.events.length) map.set(acc.number, r)
        }
      } catch { /* lot ignoré */ }
    }
  }
  await query(numbers, CARRIER.YUNEXPRESS)
  await query(numbers.filter(n => !map.has(n)))
  return map
}

async function pool<T, R>(items: T[], n: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length)
  let k = 0
  await Promise.all(Array.from({ length: n }, async () => {
    while (k < items.length) { const i = k++; out[i] = await fn(items[i]) }
  }))
  return out
}

export async function GET(req: NextRequest) {
  if (!isAuthorized(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const admin = createAdminClient()
  const report: { brand: string; order: string; tracking: string; issues: AuditIssue[] }[] = []
  let checked = 0, compared = 0

  for (const brand of BRANDS) {
    const orders = (await shippedOrders(brand)).filter(o => o.email && trackingOf(o))
    // Colis déjà livrés depuis plus de 3 jours : plus rien à surveiller.
    const nums = orders.map(trackingOf) as string[]
    const { data: rows } = await admin.from('carrier_tracking').select('tracking_number, delivered, updated_at').in('tracking_number', nums)
    const done = new Set((rows ?? []).filter(r => r.delivered && Date.now() - new Date(r.updated_at).getTime() > 3 * 86400_000).map(r => r.tracking_number))
    const todo = orders.filter(o => !done.has(trackingOf(o)!))
    const truth = await truthFor(todo.map(o => trackingOf(o)!))

    await pool(todo, 2, async (o) => {
      try {
        const res = await trackingPOST(
          new NextRequest(`https://steero.io/api/tracking/${brand}`, { method: 'POST', body: JSON.stringify({ email: o.email, order_name: o.name }) }),
          { params: { brand } },
        )
        if (!res.ok) return
        const page = await res.json() as TrackingResult
        checked++
        const ref = truth.get(trackingOf(o)!) ?? null
        if (ref) compared++
        const issues = auditTracking(page, ref)
        if (issues.length) report.push({ brand, order: o.name, tracking: trackingOf(o)!, issues })
      } catch { /* commande ignorée */ }
    })
  }

  const to = process.env.TRACKING_AUDIT_EMAIL
  if (report.length && to && process.env.RESEND_API_KEY && req.nextUrl.searchParams.get('mail') !== '0') {
    const rows = report.map(r => `<tr><td style="padding:4px 8px">${r.brand}</td><td style="padding:4px 8px"><b>${r.order}</b><br><span style="color:#888">${r.tracking}</span></td><td style="padding:4px 8px">${r.issues.map(i => `<b>${i.kind}</b> : ${i.detail.replace(/</g, '&lt;')}`).join('<br>')}</td></tr>`).join('')
    await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: 'Steero <notifications@notifications.bowa-concept.com>',
        to: [to],
        subject: `Suivi client : ${report.length} colis à vérifier (${checked} contrôlés)`,
        html: `<p>Écarts entre la page de suivi client et le suivi YunExpress (17Track). ${checked} colis contrôlés, dont ${compared} comparés à 17Track.</p><table style="border-collapse:collapse;font:13px sans-serif">${rows}</table>`,
      }),
    }).catch(() => null)
  }

  return NextResponse.json({ checked, compared, flagged: report.length, report })
}
