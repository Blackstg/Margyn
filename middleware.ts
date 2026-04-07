import { createServerClient } from '@supabase/auth-helpers-nextjs'
import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl

  // Skip middleware entirely for API routes — they handle their own auth
  if (pathname.startsWith('/api/')) {
    return NextResponse.next()
  }

  const isLoginPage = pathname === '/login'

  let response = NextResponse.next({ request: { headers: req.headers } })

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return req.cookies.getAll()
        },
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

  const { data: { session } } = await supabase.auth.getSession()

  if (!session) {
    if (!isLoginPage) return NextResponse.redirect(new URL('/login', req.url))
    return response
  }

  const role   = (session.user.user_metadata?.role   as string | undefined)   ?? 'admin'
  // brands: undefined means full access (backwards compat for accounts set up before this check)
  const brands = (session.user.user_metadata?.brands as string[] | undefined)

  // Logistician: restricted to /reconciliation only
  if (role === 'logistician') {
    if (!pathname.startsWith('/reconciliation')) {
      return NextResponse.redirect(new URL('/reconciliation', req.url))
    }
    return response
  }

  // Brand-specific route protection
  // Add new entries here as more brand-specific pages are created
  const BRAND_ROUTES: Record<string, string> = {
    '/reconciliation-stock': 'moom',
    '/factures-logisticien': 'moom',
    '/produits':             'moom',
  }
  const requiredBrand = Object.entries(BRAND_ROUTES).find(([path]) =>
    pathname === path || pathname.startsWith(path + '/')
  )?.[1]

  if (requiredBrand && brands && !brands.includes(requiredBrand)) {
    return NextResponse.redirect(new URL('/dashboard?error=unauthorized', req.url))
  }

  // Admin: redirect away from login
  if (isLoginPage) {
    return NextResponse.redirect(new URL('/dashboard', req.url))
  }

  return response
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|fonts).*)'],
}
