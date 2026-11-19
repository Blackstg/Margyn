// Audit quotidien du suivi client Krom / Moom : pour chaque colis en cours, on
// applique la logique d'affichage de /tracking/[brand] aux données 17Track du jour
// et on le compare au suivi YunExpress réel de 17Track. Les écarts sont envoyés par
// mail à TRACKING_AUDIT_EMAIL (si définie) → on corrige avant que le client ne voie.
import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase'
import { shopifyCreds } from '@/lib/tenant/integrations'
import { getTrackInfo, normalize, mergeResults, CARRIER, type Track17Result } from '@/lib/track17'
import { auditTracking, type AuditIssue } from '@/lib/tracking/audit'
import type { TrackingResult } from '@/lib/tracking/display'
import { POST as trackingPOST } from '@/app/api/tracking/[brand]/route'

export const maxDuration = 300
export const dynamic = 'force-dynamic'

const BRANDS = ['krom', 'moom'] as const
const LOOKBACK_DAYS = 40
const SAMPLE_PER_BRAND = 8

function isAuthorized(req: NextRequest): boolean {
  const h = req.headers.get('authorization') ?? ''
  const t = h.startsWith('Bearer ') ? h.slice(7) : h
  return (!!process.env.CRON_SECRET && t === process.env.CRON_SECRET) || req.headers.get('x-vercel-cron') === '1'
}

type Order = { id: number; name: string; email: string | null; created_at: string; shipping_address: { city?: string } | null; fulfillments: { tracking_number: string | null; tracking_numbers?: string[] | null }[] }

async function shippedOrders(brand: string): Promise<Order[]> {
  const c = await shopifyCreds(brand)
  if (!c.shop || !c.token) return []
  const since = new Date(Date.now() - LOOKBACK_DAYS * 86400_000).toISOString()
  const out: Order[] = []
  let url: string | null = `https://${c.shop}/admin/api/2024-10/orders.json?status=any&fulfillment_status=shipped&limit=250&created_at_min=${since}&fields=id,name,email,created_at,shipping_address,fulfillments`
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

export async function GET(req: NextRequest) {
  if (!isAuthorized(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const admin = createAdminClient()
  const report: { brand: string; order: string; tracking: string; issues: AuditIssue[] }[] = []
  let checked = 0, compared = 0, sampled = 0

  for (const brand of BRANDS) {
    const orders = (await shippedOrders(brand)).filter(o => o.email && trackingOf(o))
    // Colis déjà livrés depuis plus de 3 jours : plus rien à surveiller.
    const nums = orders.map(trackingOf) as string[]
    const { data: rows } = await admin.from('carrier_tracking').select('tracking_number, delivered, updated_at, status, step, carrier, eta_from, eta_to, events').in('tracking_number', nums)
    const done = new Set((rows ?? []).filter(r => r.delivered && Date.now() - new Date(r.updated_at).getTime() > 3 * 86400_000).map(r => r.tracking_number))
    const todo = orders.filter(o => !done.has(trackingOf(o)!))
    const truth = await truthFor(todo.map(o => trackingOf(o)!))

    // 1) TOUS les colis : la logique d'affichage de la page appliquée aux données
    //    les plus fraîches (cache + 17Track du jour, fusionnés comme le fait l'API).
    const rowBy = new Map((rows ?? []).map(r => [r.tracking_number, r]))
    for (const o of todo) {
      const tn = trackingOf(o)!
      const ref = truth.get(tn) ?? null
      const row = rowBy.get(tn)
      const prior: Track17Result | null = row?.events?.length ? {
        status: row.status ?? 'NotFound', step: row.step ?? 2, delivered: !!row.delivered,
        carrier_name: row.carrier ?? null, eta_from: row.eta_from ?? null, eta_to: row.eta_to ?? null, events: row.events,
      } : null
      const merged = mergeResults([ref, prior].filter(Boolean) as Track17Result[])
      if (!merged?.events.length) continue
      checked++
      if (ref) compared++
      const page: TrackingResult = {
        order_name: o.name, created_at: o.created_at, customer_name: '', products: [],
        address: o.shipping_address?.city ? { address1: '', address2: '', city: o.shipping_address.city, zip: '' } : null,
        tracking_number: tn, tracking_events: merged.events, step: merged.step, has_carrier_data: true,
        carrier_eta: { from: merged.eta_from, to: merged.eta_to }, carrier_name: merged.carrier_name,
      }
      const issues = auditTracking(page, ref)
      if (issues.length) report.push({ brand, order: o.name, tracking: tn, issues })
    }

    // 2) Échantillon passé par la VRAIE API de la page (cache, fusion GOFO…) :
    //    vérifie que le client voit bien le dernier scan (pas de cache figé).
    const sample = todo.filter(o => truth.has(trackingOf(o)!)).sort(() => Math.random() - 0.5).slice(0, SAMPLE_PER_BRAND)
    for (const o of sample) {
      try {
        const res = await trackingPOST(
          new NextRequest(`https://steero.io/api/tracking/${brand}`, { method: 'POST', body: JSON.stringify({ email: o.email, order_name: o.name }) }),
          { params: { brand } },
        )
        if (!res.ok) continue
        const page = await res.json() as TrackingResult
        sampled++
        const issues = auditTracking(page, truth.get(trackingOf(o)!) ?? null).filter(i => i.kind === 'retard' || i.kind === 'livré non affiché')
        if (issues.length) report.push({ brand, order: o.name, tracking: trackingOf(o)!, issues: issues.map(i => ({ ...i, kind: `page client : ${i.kind}` })) })
      } catch { /* commande ignorée */ }
      await new Promise(r => setTimeout(r, 1000))
    }
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
        html: `<p>Écarts entre la page de suivi client et le suivi YunExpress (17Track). ${checked} colis contrôlés, dont ${compared} comparés à 17Track ; ${sampled} vérifiés via la page client.</p><table style="border-collapse:collapse;font:13px sans-serif">${rows}</table>`,
      }),
    }).catch(() => null)
  }

  return NextResponse.json({ checked, compared, sampled, flagged: report.length, report })
}
