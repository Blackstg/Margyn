// Backfill des embeddings de l'historique SAV (recherche sémantique).
// GET/POST : embarque un lot d'exemples sans vecteur. À rappeler jusqu'à remaining=0.
// Un cron le déclenche aussi périodiquement pour rattraper les nouveaux imports.
import { NextRequest, NextResponse } from 'next/server'
import { embedMissingExamples } from '@/lib/sav/history'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

function authorized(req: NextRequest): boolean {
  if (!process.env.CRON_SECRET) return true
  const h = req.headers.get('authorization') ?? ''
  const t = h.startsWith('Bearer ') ? h.slice(7) : h
  return t === process.env.CRON_SECRET || req.headers.get('x-vercel-cron') === '1'
}

async function handle(req: NextRequest) {
  if (!authorized(req)) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  try {
    // Boucle jusqu'à tout embarquer (ou ~4 min de budget), pour un backfill en 1 appel.
    const deadline = Date.now() + 4 * 60_000
    let embedded = 0, remaining = 0, rounds = 0
    do {
      const res = await embedMissingExamples(200)
      embedded += res.embedded
      remaining = res.remaining
      rounds++
      if (res.embedded === 0) break
    } while (remaining > 0 && Date.now() < deadline && rounds < 50)
    return NextResponse.json({ ok: true, embedded, remaining, rounds })
  } catch (err) {
    console.error('[sav/embed-history]', err)
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}

export const GET  = handle
export const POST = handle
