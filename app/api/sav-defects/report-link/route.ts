import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@supabase/auth-helpers-nextjs'
import { cookies } from 'next/headers'
import { reportToken } from '@/lib/sav/report-token'

export const dynamic = 'force-dynamic'

// Génère le lien public partageable du rapport fournisseur. Réservé aux utilisateurs
// connectés (sinon n'importe qui obtiendrait le token signé).
export async function GET(req: NextRequest) {
  const store = await cookies()
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { cookies: { getAll() { return store.getAll() }, setAll() {} } }
  )
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 })

  const brand = req.nextUrl.searchParams.get('brand') ?? 'moom'
  const url = `${req.nextUrl.origin}/rapport-defauts/${brand}?t=${reportToken(brand)}`
  return NextResponse.json({ url })
}
