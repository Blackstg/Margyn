// GET /api/admin/test-order-search?email=X&message=Y
// Teste la recherche de commande avec fallback par numéro

import { NextRequest, NextResponse } from 'next/server'
import { getMostRecentOrder } from '@/lib/sav/shopify'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const email   = req.nextUrl.searchParams.get('email') ?? ''
  const message = req.nextUrl.searchParams.get('message') ?? ''

  try {
    const order = await getMostRecentOrder(email, message)
    return NextResponse.json({ ok: true, order })
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    )
  }
}
