import { NextRequest, NextResponse } from 'next/server'
export const dynamic = 'force-dynamic'

const META_BASE = 'https://graph.facebook.com/v21.0'

export async function GET(req: NextRequest) {
  const token    = process.env.META_BOWA_ACCESS_TOKEN!
  const account  = process.env.META_BOWA_AD_ACCOUNT_ID!

  const steps: Record<string, unknown> = {}

  // Step 1: count ads (minimal fields)
  try {
    const r = await fetch(
      `${META_BASE}/${account}/ads?fields=id,name,status&effective_status=["ACTIVE","PAUSED"]&limit=10&access_token=${token}`,
      { cache: 'no-store' }
    )
    const d = await r.json()
    steps.ads_sample = { ok: r.ok, count: d.data?.length, error: d.error?.message }
  } catch (e) { steps.ads_sample = { error: String(e) } }

  // Step 2: insights — minimal fields, 3 days, no time_increment
  try {
    const params = new URLSearchParams({
      level: 'ad',
      fields: 'ad_id,spend,impressions',
      time_range: JSON.stringify({ since: '2026-05-07', until: '2026-05-09' }),
      access_token: token,
      limit: '50',
    })
    const r = await fetch(`${META_BASE}/${account}/insights?${params}`, { cache: 'no-store' })
    const d = await r.json()
    steps.insights_minimal = { ok: r.ok, count: d.data?.length, error: d.error?.message }
  } catch (e) { steps.insights_minimal = { error: String(e) } }

  // Step 3: insights with time_increment=1
  try {
    const params = new URLSearchParams({
      level: 'ad',
      fields: 'ad_id,spend,impressions,website_purchase_roas',
      time_range: JSON.stringify({ since: '2026-05-07', until: '2026-05-09' }),
      time_increment: '1',
      access_token: token,
      limit: '50',
    })
    const r = await fetch(`${META_BASE}/${account}/insights?${params}`, { cache: 'no-store' })
    const d = await r.json()
    steps.insights_daily = { ok: r.ok, count: d.data?.length, error: d.error?.message }
  } catch (e) { steps.insights_daily = { error: String(e) } }

  // Step 4: insights with filtering spend>0
  try {
    const params = new URLSearchParams({
      level: 'ad',
      fields: 'ad_id,spend,impressions',
      time_range: JSON.stringify({ since: '2026-05-07', until: '2026-05-09' }),
      time_increment: '1',
      filtering: JSON.stringify([{ field: 'spend', operator: 'GREATER_THAN', value: '0' }]),
      access_token: token,
      limit: '50',
    })
    const r = await fetch(`${META_BASE}/${account}/insights?${params}`, { cache: 'no-store' })
    const d = await r.json()
    steps.insights_filtered = { ok: r.ok, count: d.data?.length, error: d.error?.message }
  } catch (e) { steps.insights_filtered = { error: String(e) } }

  return NextResponse.json(steps, { headers: { 'Cache-Control': 'no-store' } })
}
