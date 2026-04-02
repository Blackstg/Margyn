import { NextRequest, NextResponse } from 'next/server'

const CLIENT_ID     = process.env.SHOPIFY_CLIENT_ID!
const CLIENT_SECRET = process.env.SHOPIFY_CLIENT_SECRET!

export async function POST(req: NextRequest) {
  const { shop, id_token } = await req.json()

  if (!shop || !id_token) {
    return NextResponse.json({ error: 'Missing shop or id_token' }, { status: 400 })
  }

  const res = await fetch(`https://${shop}/admin/oauth/access_token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_id:            CLIENT_ID,
      client_secret:        CLIENT_SECRET,
      grant_type:           'urn:ietf:params:oauth:grant-type:token-exchange',
      subject_token:        id_token,
      subject_token_type:   'urn:ietf:params:oauth:token-type:id_token',
      requested_token_type: 'urn:shopify:params:oauth:token-type:offline-access-token',
    }),
  })

  const data = await res.json()
  return NextResponse.json(data)
}
