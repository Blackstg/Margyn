// ─── Résolveur d'intégrations par tenant (multi-tenant SaaS) ──────────────────
// Lit tenant_integrations en base : config (identifiants non-secrets) + secret
// (token chiffré). Stratégie NON-CASSANTE : si la base n'a pas la valeur (ou pas
// de clé de chiffrement), on renvoie null et l'appelant retombe sur l'env var
// actuelle. Ainsi Bowa/Moom/Krom continuent de marcher tant que les secrets ne
// sont pas migrés en base. SERVER-ONLY (service role) — ne pas importer côté client.
import { createClient } from '@supabase/supabase-js'
import crypto from 'crypto'

export type TenantIntegration = { config: Record<string, unknown>; secret: string | null }

function admin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  )
}

// Clé AES dérivée de TENANT_SECRETS_KEY (sha256 → 32 octets). Tant que la var
// n'est pas définie, le chiffrement/déchiffrement est inactif (→ fallback env).
function aesKey(): Buffer | null {
  const k = process.env.TENANT_SECRETS_KEY
  if (!k) return null
  return crypto.createHash('sha256').update(k).digest()
}

// Format stocké : base64(iv).base64(tag).base64(ciphertext)  (AES-256-GCM)
export function encryptSecret(plain: string): string | null {
  const key = aesKey()
  if (!key) return null
  const iv = crypto.randomBytes(12)
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv)
  const ct = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return [iv, tag, ct].map((b) => b.toString('base64')).join('.')
}

function decryptSecret(enc: string | null | undefined): string | null {
  const key = aesKey()
  if (!key || !enc) return null
  try {
    const [ivB, tagB, ctB] = enc.split('.')
    const iv = Buffer.from(ivB, 'base64'), tag = Buffer.from(tagB, 'base64'), ct = Buffer.from(ctB, 'base64')
    const d = crypto.createDecipheriv('aes-256-gcm', key, iv)
    d.setAuthTag(tag)
    return Buffer.concat([d.update(ct), d.final()]).toString('utf8')
  } catch {
    return null
  }
}

// Cache mémoire court (la config tenant change rarement) pour éviter un appel DB
// à chaque requête d'intégration.
const cache = new Map<string, { v: TenantIntegration | null; t: number }>()
const TTL_MS = 60_000

export async function getIntegration(tenant: string, type: string): Promise<TenantIntegration | null> {
  const k = `${tenant}:${type}`
  const hit = cache.get(k)
  if (hit && Date.now() - hit.t < TTL_MS) return hit.v

  let v: TenantIntegration | null = null
  try {
    const { data } = await admin()
      .from('tenant_integrations')
      .select('config, secret_enc, enabled')
      .eq('tenant_slug', tenant)
      .eq('type', type)
      .maybeSingle()
    if (data && data.enabled !== false) {
      v = { config: (data.config as Record<string, unknown>) ?? {}, secret: decryptSecret(data.secret_enc as string | null) }
    }
  } catch {
    v = null // DB indisponible → fallback env chez l'appelant
  }
  cache.set(k, { v, t: Date.now() })
  return v
}

// Helper pratique : lit une clé de config (string) avec fallback.
export function cfgStr(integ: TenantIntegration | null, key: string): string | undefined {
  const val = integ?.config?.[key]
  return typeof val === 'string' && val ? val : undefined
}

// Credentials Shopify d'un tenant : DB (config.shop + secret) sinon env
// SHOPIFY_<BRAND>_SHOP / SHOPIFY_<BRAND>_ACCESS_TOKEN. Partagé par toutes les
// routes Shopify (facture, sync, backfill…).
export async function shopifyCreds(tenant: string): Promise<{ shop?: string; token?: string }> {
  const integ = await getIntegration(tenant, 'shopify')
  const U = tenant.toUpperCase()
  return {
    shop:  cfgStr(integ, 'shop') ?? process.env[`SHOPIFY_${U}_SHOP`],
    token: integ?.secret         ?? process.env[`SHOPIFY_${U}_ACCESS_TOKEN`],
  }
}

// Meta Ads : token (secret) + ad_account (config). Fallback env META_<BRAND>_*.
export async function metaCreds(tenant: string): Promise<{ token?: string; adAccount?: string }> {
  const integ = await getIntegration(tenant, 'meta')
  const U = tenant.toUpperCase()
  return {
    token:     integ?.secret               ?? process.env[`META_${U}_ACCESS_TOKEN`],
    adAccount: cfgStr(integ, 'ad_account_id') ?? process.env[`META_${U}_AD_ACCOUNT_ID`],
  }
}

// Google Ads : seulement customer_id (identifiant, non-secret ; OAuth global en env).
export async function googleAdsCustomerId(tenant: string): Promise<string | undefined> {
  const integ = await getIntegration(tenant, 'google_ads')
  const U = tenant.toUpperCase()
  return cfgStr(integ, 'customer_id') ?? process.env[`GOOGLE_ADS_${U}_CUSTOMER_ID`]
}

// Pinterest : ad_account_id (config). Le token d'accès vit déjà dans api_tokens (OAuth).
export async function pinterestAdAccountId(tenant: string): Promise<string | undefined> {
  const integ = await getIntegration(tenant, 'pinterest')
  const U = tenant.toUpperCase()
  return cfgStr(integ, 'ad_account_id') ?? process.env[`PINTEREST_AD_ACCOUNT_ID_${U}`]
}

// Resend : adresse d'expéditeur du tenant (config `from` par défaut, ou une autre
// clé ex. `delivery_from`). Pas de secret (la clé API Resend reste globale).
export async function resendFrom(tenant: string, key = 'from'): Promise<string | undefined> {
  const integ = await getIntegration(tenant, 'resend')
  return cfgStr(integ, key)
}
