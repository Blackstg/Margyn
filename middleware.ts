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
    pathname === '/install'
  ) {
    return NextResponse.next()
  }

  const isLoginPage = pathname === '/login'

  let response = NextResponse.next({ request: { headers: req.headers } })

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() { return req.cookies.getAll() },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => req.cookies.set(name, value))
          response = NextResponse.next({ request: req })
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options)
          )
        },
      },
    }
  )

  const { data: { user } } = await supabase.auth.getUser()

  // ── Not authenticated ──────────────────────────────────────────────────────
  if (!user) {
    if (!isLoginPage) return NextResponse.redirect(new URL('/login', req.url))
    return response
  }

  const role   = (user.user_metadata?.role   as string | undefined) ?? 'admin'
  const brands = user.user_metadata?.brands  as string[] | undefined
  const defaultBrand: Brand = (brands?.find(b => VALID_BRANDS.includes(b as Brand)) as Brand) ?? 'bowa'

  // ── Logistician: reconciliation only ──────────────────────────────────────
  if (role === 'logistician') {
    if (!pathname.startsWith('/reconciliation')) {
      return NextResponse.redirect(new URL('/reconciliation', req.url))
    }
    return response
  }

  // ── Authenticated on login page → redirect to home ────────────────────────
  if (isLoginPage) {
    return NextResponse.redirect(new URL(`/${defaultBrand}/dashboard`, req.url))
  }

  // ── Root → default brand dashboard ────────────────────────────────────────
  if (pathname === '/') {
    return NextResponse.redirect(new URL(`/${defaultBrand}/dashboard`, req.url))
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
    return NextResponse.redirect(new URL(`/${effectiveBrand}/${legacyPage}${rest ? '/' + rest : ''}`, req.url))
  }

  // ── Brand-prefixed routes: /[brand]/... ───────────────────────────────────
  const urlBrandSegment = pathname.split('/')[1]
  const urlBrand = VALID_BRANDS.includes(urlBrandSegment as Brand) ? urlBrandSegment as Brand : null

  if (!urlBrand) {
    // Completely unknown path → redirect to default dashboard
    return NextResponse.redirect(new URL(`/${defaultBrand}/dashboard`, req.url))
  }

  const pageSeg = pathname.split('/')[2] ?? ''

  // ── Role: delivery → only /bowa/delivery (full-screen driver app) ─────────
  if (role === 'delivery') {
    if (urlBrand !== 'bowa' || pageSeg !== 'delivery') {
      return NextResponse.redirect(new URL(`/bowa/delivery`, req.url))
    }
    return response
  }

  const feats      = effectiveFeatures(role, user.user_metadata?.features as string[] | undefined)
  const userBrands = effectiveBrands(role, brands)
  const home       = homePath(feats, userBrands, defaultBrand)

  // ── Access management (Accès) is owner-only ───────────────────────────────
  if (pageSeg === 'users' && !isOwner(role, brands)) {
    return NextResponse.redirect(new URL(home, req.url))
  }

  // ── Feature gate: restricted roles only reach their allowed sections ──────
  if (feats !== 'all' && !feats.includes(pageSeg as FeatureKey)) {
    return NextResponse.redirect(new URL(home, req.url))
  }

  // ── Brand access: the URL brand MUST be one the user has — applies to ALL
  //    users including admins (per-brand data is confidential) ──────────────
  if (!userBrands.includes(urlBrand)) {
    return NextResponse.redirect(new URL(home, req.url))
  }

  // ── Brand-locked page on wrong brand → redirect to the correct brand ──────
  if (pageSeg && BRAND_LOCKED[pageSeg] && BRAND_LOCKED[pageSeg] !== urlBrand) {
    const correctBrand = BRAND_LOCKED[pageSeg]
    if (userBrands.includes(correctBrand)) {
      return NextResponse.redirect(new URL(`/${correctBrand}/${pageSeg}`, req.url))
    }
    return NextResponse.redirect(new URL(home, req.url))
  }

  return response
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|icon.png|apple-icon.png|manifest.webmanifest|robots.txt|sitemap.xml|fonts).*)'],
}
