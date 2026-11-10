// ─── App Shopify Steero : installation OAuth + vérifications ──────────────────
// Deux sortes d'app peuvent connecter une boutique :
//   · l'app publique Steero (SHOPIFY_CLIENT_ID / SHOPIFY_CLIENT_SECRET, config dans
//     shopify.app.toml) — la cible pour toutes les marques ;
//   · une app custom propre à une marque (tenant_integrations 'shopify_app'),
//     tant que l'app publique n'est pas validée par Shopify.
// Le jeton obtenu est toujours rangé chiffré (saveShopifyToken), jamais affiché.
// SERVER-ONLY.
import crypto from 'crypto'
import type { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@supabase/auth-helpers-nextjs'
import { createClient } from '@supabase/supabase-js'
import { effectiveBrands, isAdminRole } from '@/lib/access'
import { cfgStr, getIntegration, tenantForShop } from '@/lib/tenant/integrations'

export const SCOPES  = 'read_orders,read_products,read_inventory'
export const SHOP_RE = /^[a-z0-9][a-z0-9-]*\.myshopify\.com$/
export const CALLBACK_PATH = '/api/shopify/oauth/callback'

export type AppCreds = { clientId: string; secret: string; kind: 'public' | 'custom' }

export function publicApp(): AppCreds | null {
  const clientId = (process.env.SHOPIFY_CLIENT_ID ?? '').trim()
  const secret   = (process.env.SHOPIFY_CLIENT_SECRET ?? '').trim()
  return clientId && secret ? { clientId, secret, kind: 'public' } : null
}

export async function customApp(tenant: string): Promise<AppCreds | null> {
  const integ = await getIntegration(tenant, 'shopify_app')
  const clientId = cfgStr(integ, 'client_id')
  return clientId && integ?.secret ? { clientId, secret: integ.secret, kind: 'custom' } : null
}

// Apps candidates pour une boutique : l'app custom de sa marque d'abord, puis la publique.
export async function appsForShop(shop: string, tenant?: string | null): Promise<AppCreds[]> {
  const t = tenant ?? await tenantForShop(shop)
  const custom = t ? await customApp(t) : null
  return [custom, publicApp()].filter((a): a is AppCreds => !!a)
}

function safeEqualHex(a: string, b: string) {
  return a.length === b.length && crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b))
}

// HMAC des paramètres d'URL envoyés par Shopify (installation, retour OAuth).
export function validQueryHmac(params: URLSearchParams, secret: string): boolean {
  const hmac = params.get('hmac')
  if (!hmac) return false
  const message = Array.from(params.entries())
    .filter(([k]) => k !== 'hmac' && k !== 'signature')
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}=${v}`)
    .join('&')
  return safeEqualHex(crypto.createHmac('sha256', secret).update(message).digest('hex'), hmac)
}

// HMAC d'un webhook (corps brut, en-tête X-Shopify-Hmac-Sha256 en base64).
export function validWebhookHmac(raw: string, header: string | null, secret: string): boolean {
  if (!header) return false
  const digest = crypto.createHmac('sha256', secret).update(raw, 'utf8').digest('base64')
  return digest.length === header.length && crypto.timingSafeEqual(Buffer.from(digest), Buffer.from(header))
}

// Redirige vers l'écran d'autorisation Shopify, avec state + marque visée en cookies.
export function authorizeRedirect(res: NextResponse, origin: string, shop: string, app: AppCreds, brand: string | null) {
  const state = crypto.randomBytes(16).toString('hex')
  const url = `https://${shop}/admin/oauth/authorize?` + new URLSearchParams({
    client_id: app.clientId, scope: SCOPES, redirect_uri: `${origin}${CALLBACK_PATH}`, state,
  })
  res.headers.set('Location', url)
  const opts = { httpOnly: true, secure: true, sameSite: 'lax' as const, maxAge: 600, path: '/' }
  res.cookies.set('shopify_oauth_state', state, opts)
  res.cookies.set('shopify_oauth_brand', `${brand ?? ''}|${shop}`, opts)
  return res
}

export async function exchangeCode(shop: string, app: AppCreds, code: string): Promise<{ token?: string; scope?: string }> {
  const r = await fetch(`https://${shop}/admin/oauth/access_token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ client_id: app.clientId, client_secret: app.secret, code }),
  })
  const p = await r.json().catch(() => ({})) as { access_token?: string; scope?: string }
  return { token: p.access_token, scope: p.scope }
}

// Boutique inconnue qui installe l'app : marque « en attente » (slug = nom myshopify),
// activée ensuite depuis Steero.
export async function ensurePendingTenant(shop: string): Promise<string> {
  const slug = shop.replace(/\.myshopify\.com$/, '').replace(/[^a-z0-9-]/g, '-')
  const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { autoRefreshToken: false, persistSession: false } })
  await db.from('tenants').upsert({ slug, name: slug, status: 'pending', plan: 'trial' }, { onConflict: 'slug', ignoreDuplicates: true })
  return slug
}

// ─── Session admin dans une route /api (hors middleware) ──────────────────────
type CookieToSet = { name: string; value: string; options?: Record<string, unknown> }

// Lit la session ET la renouvelle si le jeton d'accès a expiré : les cookies
// rafraîchis sont à réécrire sur la réponse (withCookies).
export async function adminSession(req: NextRequest, brand: string): Promise<{ user: boolean; admin: boolean; refreshed: CookieToSet[] }> {
  const refreshed: CookieToSet[] = []
  try {
    const sb = createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
      cookies: { getAll() { return req.cookies.getAll() }, setAll(list: CookieToSet[]) { refreshed.push(...list) } },
    })
    const { data: { user } } = await sb.auth.getUser()
    const m = user?.user_metadata ?? {}
    return { user: !!user, admin: !!user && isAdminRole(m.role) && (effectiveBrands(m.role, m.brands) as string[]).includes(brand), refreshed }
  } catch { return { user: false, admin: false, refreshed } }
}

export function withCookies<T extends NextResponse>(res: T, list: CookieToSet[]): T {
  list.forEach(({ name, value, options }) => res.cookies.set(name, value, options))
  return res
}

export function htmlPage(title: string, body: string, status = 200) {
  return new Response(
    `<!DOCTYPE html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title>
    <style>body{font-family:'Helvetica Neue',sans-serif;background:#faf9f8;color:#1a1a2e;padding:48px;max-width:640px}
    h2{font-size:20px}p{color:#6b6b63;font-size:14px;line-height:1.5}a{color:#1a1a2e}</style></head><body>${body}</body></html>`,
    { status, headers: { 'Content-Type': 'text/html; charset=utf-8' } },
  )
}
