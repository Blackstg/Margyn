import { createServerClient } from '@supabase/auth-helpers-nextjs'
import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import {
  BRANDS, BRAND_LOCK as BRAND_LOCKED, FEATURES,
  effectiveFeatures, effectiveBrands, homePath, isOwner,
  type Brand, type FeatureKey,
} from '@/lib/access'

const VALID_BRANDS = BRANDS

// All pages that live under /[brand]/ (features + the admin-only pages)
const ALL_BRAND_PAGES = [
  'settings', 'users',
  ...FEATURES.map(f => f.key),
]

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl

  // ── Skip: API routes, public pages ────────────────────────────────────────
  if (
    pathname.startsWith('/api/') ||
    pathname === '/tracking' ||
    pathname.startsWith('/tracking/') ||
    pathname.startsWith('/rapport-defauts/') ||
    pathname.startsWith('/facture/') ||
    pathname === '/install'
  ) {
    return NextResponse.next()
  }

  const isLoginPage = pathname === '/login'

  let response = NextResponse.next({ request: { headers: req.headers } })

  // Cookies de session (ré)écrits par Supabase quand le token est rafraîchi. On les
  // MÉMORISE pour les réappliquer sur TOUTE réponse — y compris les redirections —
  // sinon un refresh survenu pendant une requête qui redirige perd le nouveau token
  // (l'ancien refresh token est déjà consommé) → déconnexion de tous les users.
  let sessionCookies: { name: string; value: string; options?: Record<string, unknown> }[] = []

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() { return req.cookies.getAll() },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => req.cookies.set(name, value))
          sessionCookies = cookiesToSet
          response = NextResponse.next({ request: req })
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options)
          )
        },
      },
    }
  )

  // Redirection qui CONSERVE les cookies de session rafraîchis (essentiel : sans ça,
  // toute redirection après un refresh de token déconnecte l'utilisateur).
  const redirect = (url: URL) => {
    const r = NextResponse.redirect(url)
    for (const { name, value, options } of sessionCookies) r.cookies.set(name, value, options)
    return r
  }

  // Résilience panne Auth Supabase : getUser() appelle le service auth (réseau).
  // Si ce service est lent/HS, on ne veut PAS faire tomber tout le site en 504.
  // → timeout court, puis repli sur la session cookie (locale, sans réseau) pour
  //   que les utilisateurs déjà connectés continuent de travailler pendant la panne.
  const withTimeout = <T>(p: Promise<T>, ms: number): Promise<T> =>
    Promise.race([p, new Promise<T>((_, reject) => setTimeout(() => reject(new Error('auth timeout')), ms))])

  // Lecture du cookie de session Supabase SANS aucun appel réseau. Sert de repli
  // quand le service Auth est HS : tant que le token local n'est pas expiré, on
  // garde l'utilisateur connecté (rôle/marques lus dans le JWT) au lieu de le
  // rediriger vers /login. Best-effort (pas de vérif de signature) : acceptable
  // en mode dégradé pour un outil interne — la sécurité réelle reste côté RLS/API.
  type LocalUser = Awaited<ReturnType<typeof supabase.auth.getUser>>['data']['user']
  const readLocalSession = (): { user: LocalUser; exp: number } | null => {
    const ref = (process.env.NEXT_PUBLIC_SUPABASE_URL || '').match(/^https:\/\/([^.]+)\./)?.[1]
    if (!ref) return null
    const base = `sb-${ref}-auth-token`
    const all = req.cookies.getAll()
    let raw = all.find(c => c.name === base)?.value ?? ''
    if (!raw) {
      raw = all
        .filter(c => c.name.startsWith(base + '.'))
        .sort((a, b) => Number(a.name.split('.').pop()) - Number(b.name.split('.').pop()))
        .map(c => c.value)
        .join('')
    }
    if (!raw) return null
    try {
      if (raw.startsWith('base64-')) raw = Buffer.from(raw.slice(7), 'base64').toString('utf8')
      const sess = JSON.parse(raw)
      let exp: number = sess.expires_at ?? 0
      if (!exp && sess.access_token) {
        const payload = JSON.parse(Buffer.from(sess.access_token.split('.')[1], 'base64').toString('utf8'))
        exp = payload.exp ?? 0
      }
      return sess.user ? { user: sess.user as LocalUser, exp } : null
    } catch { return null }
  }

  let user: Awaited<ReturnType<typeof supabase.auth.getUser>>['data']['user'] = null
  try {
    const { data } = await withTimeout(supabase.auth.getUser(), 3000)
    user = data.user
  } catch {
    // Panne Auth : on ne rappelle PAS le réseau (getSession rafraîchit et re-timeout).
    // On fait confiance au cookie local tant que le token n'est pas expiré.
    const local = readLocalSession()
    user = local && local.exp * 1000 > Date.now() ? local.user : null
  }

  // ── Not authenticated ──────────────────────────────────────────────────────
  if (!user) {
    if (!isLoginPage) return redirect(new URL('/login', req.url))
    return response
  }

  const role   = (user.user_metadata?.role   as string | undefined) ?? 'admin'
  const brands = user.user_metadata?.brands  as string[] | undefined
  const defaultBrand: Brand = (brands?.find(b => VALID_BRANDS.includes(b as Brand)) as Brand) ?? 'bowa'

  // ── Logistician: reconciliation only ──────────────────────────────────────
  if (role === 'logistician') {
    if (!pathname.startsWith('/reconciliation')) {
      return redirect(new URL('/reconciliation', req.url))
    }
    return response
  }

  // ── Authenticated on login page → redirect to home ────────────────────────
  if (isLoginPage) {
    return redirect(new URL(`/${defaultBrand}/dashboard`, req.url))
  }

  // ── Root → default brand dashboard ────────────────────────────────────────
  if (pathname === '/') {
    return redirect(new URL(`/${defaultBrand}/dashboard`, req.url))
  }

  // ── Reconciliation (stays without brand prefix) ───────────────────────────
  if (pathname.startsWith('/reconciliation')) {
    return response
  }

  // ── Legacy paths (without brand prefix) → redirect to brand-prefixed URL ──
  const legacyPage = ALL_BRAND_PAGES.find(page =>
    pathname === `/${page}` || pathname.startsWith(`/${page}/`)
  )
  if (legacyPage) {
    const targetBrand = BRAND_LOCKED[legacyPage] ?? defaultBrand
    const effectiveBrand: Brand = (!brands || brands.includes(targetBrand)) ? targetBrand : defaultBrand
    const rest = pathname.slice(legacyPage.length + 1)
    return redirect(new URL(`/${effectiveBrand}/${legacyPage}${rest ? '/' + rest : ''}`, req.url))
  }

  // ── Brand-prefixed routes: /[brand]/... ───────────────────────────────────
  const urlBrandSegment = pathname.split('/')[1]
  const urlBrand = VALID_BRANDS.includes(urlBrandSegment as Brand) ? urlBrandSegment as Brand : null

  if (!urlBrand) {
    // Completely unknown path → redirect to default dashboard
    return redirect(new URL(`/${defaultBrand}/dashboard`, req.url))
  }

  const pageSeg = pathname.split('/')[2] ?? ''

  // ── Role: delivery → only /bowa/delivery (full-screen driver app) ─────────
  if (role === 'delivery') {
    if (urlBrand !== 'bowa' || pageSeg !== 'delivery') {
      return redirect(new URL(`/bowa/delivery`, req.url))
    }
    return response
  }

  const feats      = effectiveFeatures(role, user.user_metadata?.features as string[] | undefined)
  const userBrands = effectiveBrands(role, brands)
  const home       = homePath(feats, userBrands, defaultBrand)

  // ── Access management (Accès) is owner-only ───────────────────────────────
  if (pageSeg === 'users' && !isOwner(role, brands)) {
    return redirect(new URL(home, req.url))
  }

  // ── Feature gate: restricted roles only reach their allowed sections ──────
  if (feats !== 'all' && !feats.includes(pageSeg as FeatureKey)) {
    return redirect(new URL(home, req.url))
  }

  // ── Brand access: the URL brand MUST be one the user has — applies to ALL
  //    users including admins (per-brand data is confidential) ──────────────
  if (!userBrands.includes(urlBrand)) {
    return redirect(new URL(home, req.url))
  }

  // ── Brand-locked page on wrong brand → redirect to the correct brand ──────
  if (pageSeg && BRAND_LOCKED[pageSeg] && BRAND_LOCKED[pageSeg] !== urlBrand) {
    const correctBrand = BRAND_LOCKED[pageSeg]
    if (userBrands.includes(correctBrand)) {
      return redirect(new URL(`/${correctBrand}/${pageSeg}`, req.url))
    }
    return redirect(new URL(home, req.url))
  }

  return response
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|icon.png|apple-icon.png|manifest.webmanifest|robots.txt|sitemap.xml|fonts).*)'],
}
