// Acceptation d'une invitation (page publique /join/<jeton>).
import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@supabase/auth-helpers-nextjs'
import { acceptInvite } from '@/lib/team'

export async function POST(req: NextRequest) {
  const { token, password } = await req.json().catch(() => ({})) as { token?: string; password?: string }
  const sb = createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { cookies: { getAll() { return req.cookies.getAll() }, setAll() {} } })
  const { data: { user } } = await sb.auth.getUser().catch(() => ({ data: { user: null } }))
  const r = await acceptInvite(String(token ?? ''), password ?? null, user?.email ?? null)
  return NextResponse.json(r, { status: r.error ? 400 : 200 })
}
