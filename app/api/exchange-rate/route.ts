import { NextRequest, NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

// Server-side proxy for frankfurter.app — avoids client-side CORS/network issues
// GET /api/exchange-rate?month=2026-03
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const month = searchParams.get('month') // YYYY-MM

  if (!month || !/^\d{4}-\d{2}$/.test(month)) {
    return NextResponse.json({ error: 'Invalid month param (expected YYYY-MM)' }, { status: 400 })
  }

  const date = `${month}-15`
  try {
    const res = await fetch(`https://api.frankfurter.app/${date}?from=USD&to=EUR`, {
      next: { revalidate: 86400 }, // cache 24h — historical rates don't change
    })
    if (!res.ok) throw new Error(`frankfurter ${res.status}`)
    const data = await res.json() as { date?: string; rates?: { EUR?: number } }
    return NextResponse.json({
      month,
      requested_date: date,
      actual_date:    data.date,
      eur_per_usd:    data.rates?.EUR ?? 0.92,
    })
  } catch {
    return NextResponse.json({
      month,
      requested_date: date,
      actual_date:    date,
      eur_per_usd:    0.92,
      fallback:       true,
    })
  }
}
