// Debug endpoint — retourne les données brutes Pinterest pour diagnostiquer le ROAS
// GET /api/pinterest/debug?brand=bowa&from=2026-05-01&to=2026-05-08
// Protégé par CRON_SECRET

import { NextRequest, NextResponse } from 'next/server'
import { checkAndRefreshToken } from '@/lib/pinterest-auth'

const PINTEREST_BASE = 'https://api.pinterest.com/v5'

const STORE_IDS: Record<string, string> = {
  bowa: process.env.PINTEREST_AD_ACCOUNT_ID_BOWA!,
  moom: process.env.PINTEREST_AD_ACCOUNT_ID_MOOM!,
}

export const maxDuration = 120

export async function GET(req: NextRequest) {
  const auth = req.headers.get('authorization') ?? ''
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : auth
  if (token !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { searchParams } = new URL(req.url)
  const brand    = searchParams.get('brand') ?? 'bowa'
  const dateFrom = searchParams.get('from') ?? '2026-05-01'
  const dateTo   = searchParams.get('to')   ?? '2026-05-08'

  const adAccountId = STORE_IDS[brand]
  if (!adAccountId) return NextResponse.json({ error: `Unknown brand: ${brand}` }, { status: 400 })

  const accessToken = await checkAndRefreshToken(brand)

  // 1. Submit report
  const submitRes = await fetch(`${PINTEREST_BASE}/ad_accounts/${adAccountId}/reports`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      start_date: dateFrom,
      end_date:   dateTo,
      level:      'CAMPAIGN',
      report_format: 'JSON',
      granularity: 'TOTAL',
      click_window_days:      30,
      engagement_window_days: 30,
      view_window_days:       30,
      columns: [
        'CAMPAIGN_ID',
        'CAMPAIGN_NAME',
        'SPEND_IN_MICRO_DOLLAR',
        'PAID_IMPRESSION',
        'CLICKTHROUGH_1',
        // Web only
        'TOTAL_WEB_CHECKOUT',
        'TOTAL_WEB_CHECKOUT_VALUE_IN_MICRO_DOLLAR',
        // All sources (web + offline + inapp)
        'TOTAL_CHECKOUT',
        'TOTAL_CHECKOUT_VALUE_IN_MICRO_DOLLAR',
        // ROAS columns
        'CHECKOUT_ROAS',
        'WEB_CHECKOUT_ROAS',
        // Aggregate conversions
        'TOTAL_CONVERSIONS',
        'TOTAL_CONVERSIONS_VALUE_IN_MICRO_DOLLAR',
      ],
    }),
    cache: 'no-store',
  })

  if (!submitRes.ok) {
    const err = await submitRes.text()
    return NextResponse.json({ error: `submit failed ${submitRes.status}: ${err}` }, { status: 500 })
  }

  const { token: reportToken } = await submitRes.json() as { token: string }

  // 2. Poll
  let downloadUrl: string | null = null
  for (let i = 0; i < 15; i++) {
    await new Promise(r => setTimeout(r, 4000))
    const pollRes = await fetch(
      `${PINTEREST_BASE}/ad_accounts/${adAccountId}/reports?token=${encodeURIComponent(reportToken)}`,
      { headers: { Authorization: `Bearer ${accessToken}` }, cache: 'no-store' }
    )
    const poll = await pollRes.json() as { report_status: string; url?: string }
    if (poll.report_status === 'FINISHED') { downloadUrl = poll.url ?? null; break }
    if (poll.report_status === 'FAILED') return NextResponse.json({ error: 'report FAILED' }, { status: 500 })
  }

  if (!downloadUrl) return NextResponse.json({ error: 'timeout' }, { status: 500 })

  // 3. Download
  const s3Res = await fetch(downloadUrl, { cache: 'no-store' })
  const nested = await s3Res.json() as Record<string, unknown[]>
  const rows = Object.values(nested).flat()

  // 4. Human-readable summary
  const summary = rows.map((r: unknown) => {
    const row = r as Record<string, unknown>
    const spend = Number(row['SPEND_IN_MICRO_DOLLAR'] ?? 0) / 1_000_000
    return {
      campaign:                   row['CAMPAIGN_NAME'],
      spend_eur:                  spend.toFixed(2),
      // Web checkout
      web_checkout_qty:           row['TOTAL_WEB_CHECKOUT'],
      web_checkout_revenue:       (Number(row['TOTAL_WEB_CHECKOUT_VALUE_IN_MICRO_DOLLAR'] ?? 0) / 1_000_000).toFixed(2),
      // All-source checkout
      total_checkout_qty:         row['TOTAL_CHECKOUT'],
      total_checkout_revenue:     (Number(row['TOTAL_CHECKOUT_VALUE_IN_MICRO_DOLLAR'] ?? 0) / 1_000_000).toFixed(2),
      // ROAS (native Pinterest calculation)
      checkout_roas:              row['CHECKOUT_ROAS'],
      web_checkout_roas:          row['WEB_CHECKOUT_ROAS'],
      // Aggregate conversions
      total_conversions:          row['TOTAL_CONVERSIONS'],
      total_conversions_value:    (Number(row['TOTAL_CONVERSIONS_VALUE_IN_MICRO_DOLLAR'] ?? 0) / 1_000_000).toFixed(2),
    }
  })

  return NextResponse.json({ brand, dateFrom, dateTo, rows_count: rows.length, summary, raw: rows })
}
