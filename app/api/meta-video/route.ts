import { NextRequest, NextResponse } from 'next/server'
export const dynamic = 'force-dynamic'

const TOKENS: Record<string, string | undefined> = {
  bowa: process.env.META_BOWA_ACCESS_TOKEN,
  moom: process.env.META_MOOM_ACCESS_TOKEN,
  krom: process.env.META_KROM_ACCESS_TOKEN,
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const videoId = searchParams.get('video_id')
  const brand   = searchParams.get('brand') ?? 'bowa'

  if (!videoId) return NextResponse.json({ error: 'Missing video_id' }, { status: 400 })

  const token = TOKENS[brand]
  if (!token) return NextResponse.json({ error: 'No token for brand' }, { status: 400 })

  try {
    const res = await fetch(
      `https://graph.facebook.com/v21.0/${videoId}?fields=source&access_token=${token}`,
      { cache: 'no-store' }
    )
    const data = await res.json() as { source?: string; error?: { message: string } }

    if (!res.ok || data.error) {
      return NextResponse.json({ error: data.error?.message ?? 'Meta API error' }, { status: 502 })
    }

    if (!data.source) {
      return NextResponse.json({ error: 'No video source available' }, { status: 404 })
    }

    return NextResponse.json({ url: data.source }, {
      headers: { 'Cache-Control': 'private, max-age=300' }
    })
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 })
  }
}
