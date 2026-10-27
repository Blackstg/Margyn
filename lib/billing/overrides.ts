// Contact de facturation modifié à la main (ex. client qui veut la facture au nom de sa société
// alors que la commande Shopify n'est plus modifiable). Stocké en JSON dans le bucket app-config,
// fusionné par-dessus billing_address de Shopify partout où la facture est rendue.
import { createAdminClient } from '@/lib/supabase'

const BUCKET = 'app-config'

export const BILLING_FIELDS = ['company', 'name', 'vat_number', 'address1', 'address2', 'zip', 'city', 'country'] as const
export type BillingField = typeof BILLING_FIELDS[number]
export type BillingOverride = Partial<Record<BillingField, string>> & { updated_at?: string; updated_by?: string }

function path(brand: string, orderId: string | number) {
  return `billing/overrides/${brand}/${String(orderId).replace(/\D/g, '')}.json`
}

export async function loadBillingOverride(brand: string, orderId: string | number): Promise<BillingOverride | null> {
  const { data, error } = await createAdminClient().storage.from(BUCKET).download(path(brand, orderId))
  if (error || !data) return null
  try { return JSON.parse(await data.text()) as BillingOverride } catch { return null }
}

export async function saveBillingOverride(brand: string, orderId: string | number, input: Record<string, unknown>, by: string) {
  const clean: BillingOverride = {}
  for (const k of BILLING_FIELDS) {
    const v = input[k]
    if (typeof v === 'string') clean[k] = v.trim().slice(0, 200)
  }
  clean.updated_at = new Date().toISOString()
  clean.updated_by = by
  const admin = createAdminClient()
  const body = JSON.stringify(clean)
  let { error } = await admin.storage.from(BUCKET).upload(path(brand, orderId), body, { upsert: true, contentType: 'application/json' })
  if (error && /not found/i.test(error.message)) {
    await admin.storage.createBucket(BUCKET, { public: false })
    ;({ error } = await admin.storage.from(BUCKET).upload(path(brand, orderId), body, { upsert: true, contentType: 'application/json' }))
  }
  if (error) throw new Error(error.message)
  return clean
}

export async function deleteBillingOverride(brand: string, orderId: string | number) {
  await createAdminClient().storage.from(BUCKET).remove([path(brand, orderId)])
}

// Remplace le contact Shopify par la version modifiée (les champs vides effacent la valeur Shopify).
export function applyBillingOverride<T extends { id?: number | string; billing_address?: Record<string, unknown> | null }>(
  order: T, ov: BillingOverride | null,
): T & { billing_override?: BillingOverride | null } {
  if (!ov) return order
  const addr: Record<string, unknown> = { ...(order.billing_address ?? {}) }
  for (const k of BILLING_FIELDS) if (k in ov) addr[k] = ov[k] || undefined
  return { ...order, billing_address: addr, billing_override: ov }
}
