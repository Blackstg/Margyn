// ─── Onboarding d'une marque ──────────────────────────────────────────────────
// Checklist « Démarrage » : chaque étape est déduite des données réelles (jeton
// Shopify, logo, comptes pub, coûts) — rien à cocher à la main sauf « passer ».
// Les étapes passées vivent dans tenant_integrations type 'onboarding'
// (config.skipped). SERVER-ONLY.
import { createClient } from '@supabase/supabase-js'
import { BRANDS, effectiveBrands } from '@/lib/access'
import { cfgStr, getIntegration, googleAdsCustomerId, metaCreds, saveIntegration, shopifyCreds } from '@/lib/tenant/integrations'
import { fetchCustomerName } from '@/lib/google-ads'

export type StepKey = 'shopify' | 'identity' | 'meta' | 'google' | 'products' | 'shipping' | 'team'

export interface OnboardingStep {
  key: StepKey
  done: boolean
  skipped: boolean
  detail: Record<string, unknown>
}

// Produit sans coût qui pèse dans les ventes (mission Coûts → lien vers sa fiche Shopify).
export interface MissingCost { productId: string; title: string; image: string | null; revenue: number }

// Aperçu « ton Steero » : les vrais chiffres des 30 derniers jours, débloqués étape par étape.
export interface OnboardingPreview {
  sales30: number; orders30: number; cogs30: number
  metaSpend30: number; googleSpend30: number
}

export interface OnboardingStatus {
  brand: string
  name: string
  logoUrl: string | null
  steps: OnboardingStep[]
  doneCount: number
  total: number
  preview: OnboardingPreview
  missingCosts: MissingCost[]
}

const db = () => createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { autoRefreshToken: false, persistSession: false } })

// PostgREST plafonne à 1 000 lignes par requête : on pagine.
async function allRows<T>(page: (from: number, to: number) => PromiseLike<{ data: T[] | null }>, max = 50_000): Promise<T[]> {
  const out: T[] = []
  for (let from = 0; from < max; from += 1000) {
    const { data } = await page(from, from + 999)
    out.push(...(data ?? []))
    if (!data || data.length < 1000) break
  }
  return out
}

export async function skippedSteps(brand: string): Promise<StepKey[]> {
  const integ = await getIntegration(brand, 'onboarding')
  const s = integ?.config?.skipped
  return Array.isArray(s) ? (s as StepKey[]) : []
}

export async function setSkipped(brand: string, step: StepKey, skip: boolean) {
  const cur = new Set(await skippedSteps(brand))
  if (skip) cur.add(step); else cur.delete(step)
  return saveIntegration(brand, 'onboarding', { skipped: Array.from(cur) })
}

export async function onboardingStatus(brand: string): Promise<OnboardingStatus> {
  const sb = db()
  const since = new Date(Date.now() - 30 * 864e5).toISOString().slice(0, 10)
  const [skipped, shop, meta, googleId, tenantRes, settingsRes, firstRes, variantsRes, usersRes, snapsRes, adsRes] = await Promise.all([
    skippedSteps(brand),
    shopifyCreds(brand),
    metaCreds(brand),
    googleAdsCustomerId(brand),
    sb.from('tenants').select('name, logo_url').eq('slug', brand).maybeSingle(),
    sb.from('brand_settings').select('shipping_cost_per_order, transaction_fee_rate').eq('brand', brand).maybeSingle(),
    sb.from('daily_snapshots').select('date').eq('brand', brand).order('date').limit(1),
    allRows<{ shopify_variant_id: string | number; shopify_product_id: string | number | null; product_title: string; variant_title: string | null; image_url: string | null; cost_price: number | null; product_status: string | null }>(
      (a, b) => sb.from('product_variants').select('shopify_variant_id, shopify_product_id, product_title, variant_title, image_url, cost_price, product_status').eq('brand', brand).range(a, b)),
    sb.auth.admin.listUsers({ perPage: 1000 }),
    sb.from('daily_snapshots').select('total_sales, order_count, cogs').eq('brand', brand).gte('date', since),
    sb.from('ad_spends').select('platform, spend').eq('brand', brand).gte('date', since),
  ])
  const since90 = new Date(Date.now() - 90 * 864e5).toISOString().slice(0, 10)
  const sales = await allRows<{ variant_id: string | number | null; revenue: number | null }>(
    (a, b) => sb.from('product_sales').select('variant_id, revenue').eq('brand', brand).gte('date', since90).range(a, b))

  // Couverture pondérée par les ventes 90 j : avec 1 500 références, seuls les
  // produits qui se vendent comptent vraiment pour la marge.
  const live = variantsRes.filter(v => (v.product_status ?? 'active') === 'active')
  const byVariant = new Map(variantsRes.map(v => [String(v.shopify_variant_id), v]))
  const hasCost = (v?: { cost_price: number | null }) => v?.cost_price != null && Number(v.cost_price) > 0
  const revByVariant = new Map<string, number>()
  for (const r of sales) if (r.variant_id != null) revByVariant.set(String(r.variant_id), (revByVariant.get(String(r.variant_id)) ?? 0) + Number(r.revenue ?? 0))
  const totalRev = Array.from(revByVariant.values()).reduce((a, b) => a + b, 0)
  const coveredRev = Array.from(revByVariant.entries()).filter(([id]) => hasCost(byVariant.get(id))).reduce((a, [, r]) => a + r, 0)
  const variants = live.length
  const costed   = live.filter(hasCost).length
  const coverage = totalRev > 0 ? coveredRev / totalRev : variants > 0 ? costed / variants : 0
  const missingByProduct = new Map<string, MissingCost>()
  for (const [id, rev] of Array.from(revByVariant.entries())) {
    const v = byVariant.get(id)
    if (!v || hasCost(v) || v.shopify_product_id == null) continue
    const k = String(v.shopify_product_id)
    const cur = missingByProduct.get(k) ?? { productId: k, title: v.product_title, image: v.image_url, revenue: 0 }
    cur.revenue += rev
    missingByProduct.set(k, cur)
  }
  const missingCosts = Array.from(missingByProduct.values()).filter(m => m.revenue >= 1).sort((a, b) => b.revenue - a.revenue).slice(0, 8)
    .map(m => ({ ...m, revenue: Math.round(m.revenue) }))
  const shipping = Number(settingsRes.data?.shipping_cost_per_order ?? 0)
  const feeRate  = settingsRes.data?.transaction_fee_rate != null ? Number(settingsRes.data.transaction_fee_rate) : null
  const team = (usersRes.data?.users ?? []).filter(u => {
    const m = u.user_metadata ?? {}
    return Array.isArray(m.brands) && (effectiveBrands(m.role, m.brands) as string[]).includes(brand)
  }).length
  const name = tenantRes.data?.name ?? brand
  const logoUrl = tenantRes.data?.logo_url ?? null

  const sum = <T,>(rows: T[] | null, f: (r: T) => number) => (rows ?? []).reduce((a, r) => a + (f(r) || 0), 0)
  const preview: OnboardingPreview = {
    sales30:  Math.round(sum(snapsRes.data, r => Number(r.total_sales))),
    orders30: sum(snapsRes.data, r => Number(r.order_count)),
    cogs30:   Math.round(sum(snapsRes.data, r => Number(r.cogs))),
    metaSpend30:   Math.round(sum((adsRes.data ?? []).filter(a => a.platform === 'meta'), r => Number(r.spend))),
    googleSpend30: Math.round(sum((adsRes.data ?? []).filter(a => a.platform === 'google'), r => Number(r.spend))),
  }

  const step = (key: StepKey, done: boolean, detail: Record<string, unknown>): OnboardingStep =>
    ({ key, done: done || skipped.includes(key), skipped: !done && skipped.includes(key), detail })

  const steps = [
    step('shopify', !!shop.token, { shop: shop.shop ?? null, firstDate: firstRes.data?.[0]?.date ?? null, variants }),
    step('identity', !!logoUrl, { name, logoUrl }),
    step('meta', !!(meta.token && meta.adAccount), { adAccount: meta.adAccount ?? null }),
    step('google', !!googleId, { customerId: googleId ?? null }),
    step('products', variants > 0 && coverage >= 0.9, { variants, costed, coverage: Math.round(coverage * 100), shopHandle: shop.shop?.replace(/\.myshopify\.com$/, '') ?? null, missingCount: missingByProduct.size }),
    step('shipping', shipping > 0, { shipping, feeRate }),
    step('team', team > 0, { members: team }),
  ]
  const doneCount = steps.filter(s => s.done).length
  return { brand, name, logoUrl, steps, doneCount, total: steps.length, preview, missingCosts }
}

// ─── Actions ──────────────────────────────────────────────────────────────────

// Nom de la boutique (API admin) + logo : l'icône du site (favicon / apple-touch-icon),
// servie par le CDN Shopify en haute définition. L'API admin n'expose pas le logo.
export async function importShopifyBranding(brand: string): Promise<{ name?: string; logoUrl?: string; error?: string }> {
  const { shop, token } = await shopifyCreds(brand)
  if (!shop || !token) return { error: 'Shopify non connecté' }
  const r = await fetch(`https://${shop}/admin/api/2025-10/graphql.json`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Shopify-Access-Token': token },
    body: JSON.stringify({ query: '{ shop { name primaryDomain { url } } }' }),
  })
  const j = await r.json().catch(() => ({})) as { data?: { shop?: { name?: string; primaryDomain?: { url?: string } } } }
  const s = j.data?.shop
  if (!s?.name) return { error: 'Lecture Shopify impossible' }

  let logoUrl: string | undefined
  try {
    const site = s.primaryDomain?.url ?? `https://${shop}`
    const html = await (await fetch(site, { headers: { 'User-Agent': 'Mozilla/5.0 Steero' }, cache: 'no-store' })).text()
    const links = Array.from(html.matchAll(/<link[^>]+rel=["']([^"']*icon[^"']*)["'][^>]*>/gi)).map(m => m[0])
    const pick = links.find(l => /apple-touch-icon/i.test(l)) ?? links.find(l => /rel=["'](shortcut )?icon["']/i.test(l))
    const href = pick?.match(/href=["']([^"']+)["']/i)?.[1]
    if (href) {
      const abs = new URL(href.replace(/&amp;/g, '&'), site)
      if (abs.pathname.startsWith('/cdn/shop/') || abs.hostname.endsWith('shopify.com')) {
        abs.searchParams.set('width', '256'); abs.searchParams.set('height', '256'); abs.searchParams.delete('crop')
      }
      logoUrl = abs.toString()
    }
  } catch {}

  await db().from('tenants').update({ name: s.name, ...(logoUrl ? { logo_url: logoUrl } : {}) }).eq('slug', brand)
  return { name: s.name, logoUrl, ...(logoUrl ? {} : { error: 'Pas d’icône trouvée sur le site — envoie le logo ici' }) }
}

export async function saveIdentity(brand: string, name: string, logoUrl: string | null) {
  const { error } = await db().from('tenants').update({ name, logo_url: logoUrl }).eq('slug', brand)
  return error?.message ?? null
}

// Logo envoyé depuis l'onboarding → bucket public brand-assets.
export async function uploadLogo(brand: string, file: File): Promise<{ url?: string; error?: string }> {
  if (!/^image\/(png|jpe?g|webp|svg\+xml)$/.test(file.type) || file.size > 2_000_000) return { error: 'Image PNG/JPG/WebP/SVG de 2 Mo max' }
  const sb = db()
  await sb.storage.createBucket('brand-assets', { public: true }).catch(() => {})
  const ext = file.type.split('/')[1].replace('svg+xml', 'svg').replace('jpeg', 'jpg')
  const path = `${brand}/logo-${Date.now()}.${ext}`
  const { error } = await sb.storage.from('brand-assets').upload(path, Buffer.from(await file.arrayBuffer()), { contentType: file.type })
  if (error) return { error: error.message }
  const url = sb.storage.from('brand-assets').getPublicUrl(path).data.publicUrl
  await sb.from('tenants').update({ logo_url: url }).eq('slug', brand)
  return { url }
}

// Meta : on cherche, parmi les accès Meta déjà branchés sur Steero, celui qui voit
// ce compte pub, puis on le range (chiffré) pour la marque. Le jeton ne sort jamais du serveur.
export async function connectMeta(brand: string, raw: string): Promise<{ name?: string; error?: string }> {
  const id = raw.replace(/\D/g, '')
  if (id.length < 6) return { error: 'ID de compte pub invalide (act_…)' }
  const tokens = new Set<string>()
  for (const b of BRANDS) { const t = (await metaCreds(b)).token; if (t) tokens.add(t) }
  for (const token of Array.from(tokens)) {
    const r = await fetch(`https://graph.facebook.com/v21.0/act_${id}?fields=name,currency,account_status&access_token=${encodeURIComponent(token)}`, { cache: 'no-store' })
    if (!r.ok) continue
    const a = await r.json() as { name?: string; currency?: string }
    const err = await saveIntegration(brand, 'meta', { ad_account_id: `act_${id}` }, token)
    return err ? { error: err } : { name: `${a.name ?? id}${a.currency ? ` · ${a.currency}` : ''}` }
  }
  return { error: 'Aucun accès Meta de Steero ne voit ce compte : ajoute-le au Business Manager (partenaire) puis réessaie' }
}

// Google Ads : le compte doit être rattaché au MCC de Steero.
export async function connectGoogle(brand: string, raw: string): Promise<{ name?: string; error?: string }> {
  const id = raw.replace(/\D/g, '')
  if (id.length !== 10) return { error: 'ID client Google Ads : 10 chiffres (123-456-7890)' }
  try {
    const c = await fetchCustomerName(id)
    const err = await saveIntegration(brand, 'google_ads', { customer_id: id })
    return err ? { error: err } : { name: `${c.name}${c.currency ? ` · ${c.currency}` : ''}` }
  } catch {
    return { error: 'Compte inaccessible : accepte l’invitation du compte gestionnaire Steero dans Google Ads, puis réessaie' }
  }
}

// « Vérifier » : relit produits + coûts Shopify maintenant (synchro de la marque) ;
// si de nouveaux coûts arrivent, recalcule les marges passées.
export async function refreshCostsFromShopify(origin: string, brand: string): Promise<{ before: number; after: number; error?: string }> {
  const count = async () => (await db().from('product_variants').select('shopify_variant_id', { count: 'exact', head: true })
    .eq('brand', brand).gt('cost_price', 0)).count ?? 0
  const before = await count()
  const r = await fetch(`${origin}/api/shopify/sync?brand=${brand}`, { headers: { authorization: `Bearer ${process.env.CRON_SECRET}` }, cache: 'no-store' })
  if (!r.ok) return { before, after: before, error: `Synchro Shopify impossible (${r.status})` }
  const after = await count()
  if (after > before) {
    const { data } = await db().from('daily_snapshots').select('date').eq('brand', brand).order('date').limit(1)
    if (data?.[0]?.date) await backfillHistory(origin, brand, data[0].date)
  }
  return { before, after }
}

export async function saveCosts(brand: string, shipping: number, feeRatePct: number | null) {
  const row: Record<string, unknown> = { brand, shipping_cost_per_order: shipping }
  if (feeRatePct != null) row.transaction_fee_rate = feeRatePct / 100
  const { error } = await db().from('brand_settings').upsert(row, { onConflict: 'brand' })
  return error?.message ?? null
}

// Import de l'historique Shopify (mois par mois) via la route de backfill existante.
export async function backfillHistory(origin: string, brand: string, from: string) {
  const r = await fetch(`${origin}/api/admin/backfill-history?brand=${brand}&from=${from}`, {
    headers: { authorization: `Bearer ${process.env.CRON_SECRET}` }, cache: 'no-store',
  })
  const j = await r.json().catch(() => ({})) as { total_snapshots?: number; total_product_sales?: number; error?: string }
  return r.ok ? { days: j.total_snapshots ?? 0 } : { error: j.error ?? `Erreur ${r.status}` }
}

export { cfgStr }
