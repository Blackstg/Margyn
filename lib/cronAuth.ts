// Routes techniques (crons, scripts ponctuels /api/admin/*) : réservées au porteur
// de CRON_SECRET (en-tête Authorization: Bearer …).
import type { NextRequest } from 'next/server'
import crypto from 'crypto'

export function isCron(req: Request | NextRequest): boolean {
  const secret = process.env.CRON_SECRET
  const header = req.headers.get('authorization') ?? ''
  const token  = header.startsWith('Bearer ') ? header.slice(7) : header
  return !!secret && token.length === secret.length && crypto.timingSafeEqual(Buffer.from(token), Buffer.from(secret))
}
