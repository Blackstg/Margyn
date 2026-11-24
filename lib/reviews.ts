// Enquête de satisfaction avant Trustpilot (/avis/[brand]). SERVER-ONLY.
// Lien personnel : /avis/<brand>/<id commande Shopify>-<token commande Shopify>.
// Le token (32 hex, propre à chaque commande, présent dans les événements Klaviyo
// en `event.extra.token`) prouve que le lien vient bien du mail : pas de donnée
// personnelle dans l'URL et impossible de deviner le lien d'une autre commande.
import { shopifyCreds } from '@/lib/tenant/integrations'
import { createAdminClient } from '@/lib/supabase'
import { BRAND_LABELS, type Brand } from '@/lib/access'

export const REVIEW_BRANDS = ['moom', 'krom', 'bowa'] as const
export type ReviewBrand = typeof REVIEW_BRANDS[number]
export const isReviewBrand = (b: string): b is ReviewBrand => (REVIEW_BRANDS as readonly string[]).includes(b)

// Domaine Trustpilot = domaine de la boutique. Couleurs reprises des mails de chaque marque.
export const REVIEW_CONFIG: Record<ReviewBrand, { domain: string; bg: string; ink: string; soft: string }> = {
  moom: { domain: 'moom-paris.co',    bg: '#F5F1EE', ink: '#0E0E0E', soft: '#E7E0DB' },
  krom: { domain: 'krom-water.com',   bg: '#F2F4F6', ink: '#0F1720', soft: '#E1E6EB' },
  bowa: { domain: 'bowa-concept.com', bg: '#F1EBE7', ink: '#1A1A2E', soft: '#E4DAD3' },
}

export const trustpilotUrl = (brand: ReviewBrand) => `https://fr.trustpilot.com/evaluate/${REVIEW_CONFIG[brand].domain}`
export const reviewLink = (brand: ReviewBrand, orderId: string | number, token: string) =>
  `https://www.steero.io/avis/${brand}/${orderId}-${token}`

export type ReviewOrder = { orderId: string; orderName: string; firstName: string; lastName: string; email: string | null }

const REF_RE = /^(\d{6,20})-([a-f0-9]{32})$/

// Vérifie un lien personnel auprès de Shopify. null si le lien est invalide.
export async function verifyReviewRef(brand: ReviewBrand, ref: string): Promise<ReviewOrder | null> {
  const m = REF_RE.exec(ref)
  if (!m) return null
  const c = await shopifyCreds(brand)
  if (!c.shop || !c.token) return null
  try {
    const res = await fetch(`https://${c.shop}/admin/api/2024-10/orders/${m[1]}.json?fields=id,name,token,email,customer,shipping_address,billing_address`, {
      headers: { 'X-Shopify-Access-Token': c.token }, cache: 'no-store',
    })
    if (!res.ok) return null
    const { order } = await res.json() as { order: { id: number; name: string; token: string; email: string | null; customer?: { first_name?: string; last_name?: string }; shipping_address?: { first_name?: string; last_name?: string }; billing_address?: { first_name?: string; last_name?: string } } }
    if (!order || order.token !== m[2]) return null
    const who = order.customer?.first_name ? order.customer : order.shipping_address ?? order.billing_address
    return { orderId: String(order.id), orderName: order.name, firstName: who?.first_name?.trim() ?? '', lastName: who?.last_name?.trim() ?? '', email: order.email }
  } catch { return null }
}

// Token d'une commande (pour construire le lien dans nos propres mails, ex. livraison Bowa).
export async function orderToken(brand: ReviewBrand, orderId: string | number): Promise<string | null> {
  const c = await shopifyCreds(brand)
  if (!c.shop || !c.token) return null
  try {
    const res = await fetch(`https://${c.shop}/admin/api/2024-10/orders/${orderId}.json?fields=token`, { headers: { 'X-Shopify-Access-Token': c.token }, cache: 'no-store' })
    if (!res.ok) return null
    return ((await res.json()) as { order?: { token?: string } }).order?.token ?? null
  } catch { return null }
}

export type ReviewBranding = { name: string; logo: string | null; site: string; bg: string; ink: string; soft: string; trustpilot: string }

export async function reviewBranding(brand: ReviewBrand): Promise<ReviewBranding> {
  const { data } = await createAdminClient().from('invoice_settings').select('logo_url').eq('brand', brand).maybeSingle()
  const cfg = REVIEW_CONFIG[brand]
  return { name: BRAND_LABELS[brand as Brand], logo: data?.logo_url ?? null, site: `https://${cfg.domain}`, bg: cfg.bg, ink: cfg.ink, soft: cfg.soft, trustpilot: trustpilotUrl(brand) }
}
