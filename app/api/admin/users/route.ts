import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@supabase/auth-helpers-nextjs'
import { createClient } from '@supabase/supabase-js'
import { cookies } from 'next/headers'
import { isOwner, BRANDS, FEATURES, type Brand, type FeatureKey } from '@/lib/access'

export const dynamic = 'force-dynamic'

function serviceClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  )
}

// Verify the caller is the authenticated owner (full-brand admin) via their cookie.
async function requireAdmin(): Promise<{ ok: true } | { ok: false; res: NextResponse }> {
  const store = await cookies()
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() { return store.getAll() },
        setAll() { /* read-only in a route handler */ },
      },
    }
  )
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { ok: false, res: NextResponse.json({ error: 'Non authentifié' }, { status: 401 }) }
  const m = user.user_metadata ?? {}
  if (!isOwner(m.role as string | undefined, m.brands as string[] | undefined)) {
    return { ok: false, res: NextResponse.json({ error: 'Accès réservé au propriétaire' }, { status: 403 }) }
  }
  return { ok: true }
}

const VALID_FEATURES = new Set(FEATURES.map(f => f.key))

export async function GET() {
  const guard = await requireAdmin()
  if (!guard.ok) return guard.res

  const admin = serviceClient()
  const { data, error } = await admin.auth.admin.listUsers({ perPage: 1000 })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const users = data.users
    .map(u => {
      const m = u.user_metadata ?? {}
      return {
        id:       u.id,
        email:    u.email ?? '',
        role:     (m.role as string | undefined) ?? 'admin',
        brands:   Array.isArray(m.brands)   ? (m.brands as string[])   : [],
        features: Array.isArray(m.features) ? (m.features as string[]) : null,
        owner:    isOwner(m.role as string | undefined, m.brands as string[] | undefined),
      }
    })
    .sort((a, b) => a.email.localeCompare(b.email))

  return NextResponse.json({ users })
}

export async function PATCH(req: NextRequest) {
  const guard = await requireAdmin()
  if (!guard.ok) return guard.res

  const body = await req.json().catch(() => null) as {
    id?: string; role?: string; brands?: string[]; features?: string[]
  } | null
  if (!body?.id) return NextResponse.json({ error: 'id requis' }, { status: 400 })

  const role = ['admin', 'sav', 'delivery', 'logistician'].includes(body.role ?? '')
    ? body.role!
    : 'sav'
  const brands   = (body.brands ?? []).filter((b): b is Brand => (BRANDS as string[]).includes(b))
  const features = (body.features ?? []).filter((f): f is FeatureKey => VALID_FEATURES.has(f as FeatureKey))

  const admin = serviceClient()
  const { data: cur, error: getErr } = await admin.auth.admin.getUserById(body.id)
  if (getErr || !cur.user) return NextResponse.json({ error: getErr?.message ?? 'Utilisateur introuvable' }, { status: 404 })

  // Protect the owner: their access can't be edited from the panel (anti-lockout)
  const cm = cur.user.user_metadata ?? {}
  if (isOwner(cm.role as string | undefined, cm.brands as string[] | undefined)) {
    return NextResponse.json({ error: 'Le propriétaire ne peut pas être modifié ici' }, { status: 403 })
  }

  const next = { ...(cur.user.user_metadata ?? {}), role, brands, features }
  const { error } = await admin.auth.admin.updateUserById(body.id, { user_metadata: next })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ ok: true, role, brands, features })
}
