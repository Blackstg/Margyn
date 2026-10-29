// Rattrapage des remboursements / annulations tardifs.
// La synchro Shopify ne relit que J-2 → J : une commande remboursée ou annulée
// plus tard restait comptée comme vendue dans daily_snapshots (ex. Bowa #10863,
// #10876, #11004 en octobre 2026). Ici : on liste les commandes MODIFIÉES ces
// derniers jours qui ont un remboursement ou une annulation, et on resynchronise
// les jours où elles ont été passées.
// GET (cron) ou POST ?days=3&brand=bowa — protégé par CRON_SECRET.
import { NextRequest, NextResponse } from 'next/server'
import { shopifyCreds } from '@/lib/tenant/integrations'

export const maxDuration = 300
export const dynamic = 'force-dynamic'

const BRANDS = ['bowa', 'moom', 'krom']
const MAX_DATES = 25

function isAuthorized(req: NextRequest): boolean {
  const header = req.headers.get('authorization') ?? ''
  const token = header.startsWith('Bearer ') ? header.slice(7) : header
  return token === process.env.CRON_SECRET
}

const parisDate = (iso: string) => new Date(iso).toLocaleDateString('sv-SE', { timeZone: 'Europe/Paris' })

type O = { id: number; created_at: string; cancelled_at: string | null; refunds?: { created_at: string }[] }

async function datesToResync(brand: string, sinceIso: string, before: string): Promise<string[]> {
  const c = await shopifyCreds(brand)
  if (!c.shop || !c.token) return []
  const dates = new Set<string>()
  let url: string | null = `https://${c.shop}/admin/api/2024-01/orders.json?status=any&limit=250` +
    `&updated_at_min=${encodeURIComponent(sinceIso)}&fields=id,created_at,cancelled_at,refunds`
  while (url) {
    const res: Response = await fetch(url, { headers: { 'X-Shopify-Access-Token': c.token }, cache: 'no-store' })
    if (!res.ok) throw new Error(`Shopify ${brand} ${res.status}`)
    const { orders } = await res.json() as { orders: O[] }
    for (const o of orders) {
      const changed = (o.cancelled_at && o.cancelled_at >= sinceIso) || (o.refunds ?? []).some(r => r.created_at >= sinceIso)
      const day = parisDate(o.created_at)
      if (changed && day < before) dates.add(day)
    }
    const m = /<([^>]+)>;\s*rel="next"/.exec(res.headers.get('link') ?? '')
    url = m ? m[1] : null
  }
  return [...dates].sort().reverse().slice(0, MAX_DATES)
}

export async function GET(req: NextRequest) { return POST(req) }

export async function POST(req: NextRequest) {
  if (!isAuthorized(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const sp = req.nextUrl.searchParams
  const days = Math.min(30, Math.max(1, Number(sp.get('days') ?? 3)))
  const brands = sp.get('brand') ? [sp.get('brand')!] : BRANDS
  const since = new Date(Date.now() - days * 86_400_000).toISOString()
  // Jours déjà couverts par la synchro normale (J-2 → J) : inutile de les refaire.
  const before = parisDate(new Date(Date.now() - 2 * 86_400_000).toISOString())
  const proto = req.headers.get('x-forwarded-proto') ?? 'http'
  const base = `${proto}://${req.headers.get('host') ?? 'localhost:3000'}`
  const headers = { Authorization: `Bearer ${process.env.CRON_SECRET ?? ''}` }

  const results: Record<string, { dates: string[]; errors: string[] }> = {}
  for (const brand of brands) {
    const r = { dates: [] as string[], errors: [] as string[] }
    results[brand] = r
    try {
      r.dates = await datesToResync(brand, since, before)
      for (const d of r.dates) {
        const res = await fetch(`${base}/api/shopify/sync?date=${d}&brand=${brand}`, { method: 'POST', headers })
        if (!res.ok) r.errors.push(`${d}: ${res.status}`)
      }
    } catch (e) {
      r.errors.push(String(e))
    }
  }
  return NextResponse.json({ ok: true, since, results })
}
