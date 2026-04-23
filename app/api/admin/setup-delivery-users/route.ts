import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

function getAdmin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  )
}

// Protect with a one-time secret: call with ?secret=SETUP_SECRET env var
export async function POST(req: NextRequest) {
  const secret = req.nextUrl.searchParams.get('secret')
  if (!secret || secret !== process.env.SETUP_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const admin = getAdmin()
  const results: Record<string, unknown> = {}

  const { data: list, error: listErr } = await admin.auth.admin.listUsers({ perPage: 1000 })
  if (listErr) {
    return NextResponse.json({ error: listErr.message }, { status: 500 })
  }

  const findUser = (email: string) => list.users.find((u) => u.email === email)

  // ── 1. khalid@bowa-concept.com → Livreur only ────────────────────────────
  {
    const user = findUser('khalid@bowa-concept.com')
    if (!user) {
      results['khalid@bowa-concept.com'] = { status: 'error', message: 'User not found' }
    } else {
      const { error } = await admin.auth.admin.updateUserById(user.id, {
        user_metadata: {
          ...user.user_metadata,
          role: 'delivery',
          brands: ['bowa'],
          delivery_views: ['livreur'],
        },
      })
      results['khalid@bowa-concept.com'] = error
        ? { status: 'error', message: error.message }
        : { status: 'updated', id: user.id }
    }
  }

  // ── 2. lea@bowa-concept.com → accès complet (toutes brands) ──────────────
  {
    const user = findUser('lea@bowa-concept.com')
    if (!user) {
      results['lea@bowa-concept.com'] = { status: 'error', message: 'User not found' }
    } else {
      const existingBrands = (user.user_metadata?.brands as string[] | undefined) ?? []
      const brands = Array.from(new Set([...existingBrands, 'bowa']))
      const { error } = await admin.auth.admin.updateUserById(user.id, {
        user_metadata: {
          ...user.user_metadata,
          brands,
        },
      })
      results['lea@bowa-concept.com'] = error
        ? { status: 'error', message: error.message }
        : { status: 'updated', id: user.id, brands }
    }
  }

  // ── 3. nicolas → accès complet (toutes brands) ───────────────────────────
  {
    // Try common variants
    const nicolas = list.users.find(
      (u) => u.email?.toLowerCase().includes('nicolas') && u.email?.endsWith('@bowa-concept.com')
    )
    if (!nicolas) {
      results['nicolas@bowa-concept.com'] = { status: 'error', message: 'User not found — adjust email if different' }
    } else {
      const existingBrands = (nicolas.user_metadata?.brands as string[] | undefined) ?? []
      const brands = Array.from(new Set([...existingBrands, 'bowa']))
      const { error } = await admin.auth.admin.updateUserById(nicolas.id, {
        user_metadata: {
          ...nicolas.user_metadata,
          brands,
        },
      })
      results[nicolas.email!] = error
        ? { status: 'error', message: error.message }
        : { status: 'updated', id: nicolas.id, brands }
    }
  }

  // ── 4. hello@bowa-concept.com → SAV uniquement ───────────────────────────
  {
    const email = 'hello@bowa-concept.com'
    let user = findUser(email)

    // Create the user if they don't exist yet
    if (!user) {
      const { data: created, error: createErr } = await admin.auth.admin.createUser({
        email,
        email_confirm: true,
        user_metadata: { role: 'sav' },
      })
      if (createErr) {
        results[email] = { status: 'error', message: `createUser: ${createErr.message}` }
      } else {
        user = created.user
        results[email] = { status: 'created', id: created.user.id }
      }
    }

    if (user) {
      const { error } = await admin.auth.admin.updateUserById(user.id, {
        user_metadata: { ...user.user_metadata, role: 'sav' },
      })
      if (error) {
        results[email] = { status: 'error', message: `updateUser: ${error.message}` }
      } else {
        results[email] = { ...(results[email] as object ?? {}), status: results[email] ? results[email] : 'updated', role: 'sav' }
      }

      // Send a password reset link so the user can set their password
      const { error: inviteErr } = await admin.auth.admin.generateLink({
        type: 'recovery',
        email,
      })
      if (inviteErr) {
        console.warn(`[setup] generateLink for ${email}:`, inviteErr.message)
      }
    }
  }

  return NextResponse.json({ results })
}
