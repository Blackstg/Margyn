import { NextRequest, NextResponse } from 'next/server'
export const dynamic = 'force-dynamic'

const TOKENS: Record<string, string | undefined> = {
  bowa: process.env.META_BOWA_ACCESS_TOKEN,
  moom: process.env.META_MOOM_ACCESS_TOKEN,
  krom: process.env.META_KROM_ACCESS_TOKEN,
}

const AD_ACCOUNTS: Record<string, string | undefined> = {
  bowa: process.env.META_BOWA_AD_ACCOUNT_ID,
  moom: process.env.META_MOOM_AD_ACCOUNT_ID,
  krom: process.env.META_KROM_AD_ACCOUNT_ID,
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const videoId = searchParams.get('video_id')
  const brand   = searchParams.get('brand') ?? 'bowa'

  if (!videoId) return NextResponse.json({ error: 'Missing video_id' }, { status: 400 })

  const token     = TOKENS[brand]
  const adAccount = AD_ACCOUNTS[brand]
  if (!token || !adAccount) return NextResponse.json({ error: 'No config for brand' }, { status: 400 })

  try {
    // Query via advideos — direct video object endpoint requires broader permissions
    const url = new URL(`https://graph.facebook.com/v21.0/${adAccount}/advideos`)
    url.searchParams.set('fields', 'id,source')
    url.searchParams.set('filtering', JSON.stringify([{ field: 'id', operator: 'EQUAL', value: videoId }]))
    url.searchParams.set('limit', '1')
    url.searchParams.set('access_token', token)

    const res  = await fetch(url.toString(), { cache: 'no-store' })
    const data = await res.json() as { data?: { id: string; source?: string }[]; error?: { message: string } }

    if (!res.ok || data.error) {
      return NextResponse.json({ error: data.error?.message ?? 'Meta API error' }, { status: 502 })
    }

    const source = data.data?.[0]?.source
    if (!source) {
      return NextResponse.json({ error: 'No video source available' }, { status: 404 })
    }

    return NextResponse.json({ url: source }, {
      headers: { 'Cache-Control': 'private, max-age=300' }
    })
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 })
  }
}
