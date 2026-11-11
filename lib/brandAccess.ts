// Garde des routes API internes : session Supabase (cookies) ayant accès à la marque.
import type { NextRequest } from 'next/server'
import { createServerClient } from '@supabase/auth-helpers-nextjs'
import { effectiveBrands } from '@/lib/access'

export async function hasBrandAccess(req: NextRequest, brand: string): Promise<boolean> {
  try {
    const sb = createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      { cookies: { getAll() { return req.cookies.getAll() }, setAll() {} } })
    const { data: { user } } = await sb.auth.getUser()
    return !!user && (effectiveBrands(user.user_metadata?.role, user.user_metadata?.brands) as string[]).includes(brand)
  } catch { return false }
}
