// Proxy authentifié des pièces jointes Zendesk (certains comptes exigent l'auth →
// l'affichage direct <img src> échoue). GET ?url=<content_url>&brand=<moom|bowa>
import { NextRequest, NextResponse } from 'next/server'
import { savBrandFromRequest } from '@/lib/sav/brand'
import { fetchZendeskAttachment } from '@/lib/sav/zendesk'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const url = req.nextUrl.searchParams.get('url')
  if (!url) return NextResponse.json({ error: 'url requise' }, { status: 400 })
  const brand = savBrandFromRequest(req)

  const res = await fetchZendeskAttachment(brand, url).catch(() => null)
  if (!res || !res.ok) {
    return NextResponse.json({ error: 'attachment indisponible' }, { status: 502 })
  }
  const contentType = res.headers.get('content-type') ?? 'application/octet-stream'
  const buf = await res.arrayBuffer()
  return new NextResponse(buf, {
    status: 200,
    headers: {
      'Content-Type': contentType,
      'Cache-Control': 'private, max-age=3600',
    },
  })
}
