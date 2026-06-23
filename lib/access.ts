// ─── Access model (single source of truth) ──────────────────────────────────
// A user's permissions live in Supabase auth `user_metadata`:
//   role:     'admin' | 'sav' | 'delivery' | 'logistician'
//   brands:   Brand[]      — which brands they can access
//   features: FeatureKey[] — which sections they can access (staff/sav only)
//
// Admins see everything. delivery & logistician keep dedicated UX. Everyone
// else is gated by `features` (with a role-based fallback when not set yet).
// Both the Sidebar (client) and the middleware (edge) import this module so the
// rules never diverge.

export type Brand = 'bowa' | 'moom' | 'krom'
export const BRANDS: Brand[] = ['bowa', 'moom', 'krom']
export const BRAND_LABELS: Record<Brand, string> = {
  bowa: 'Bowa',
  moom: 'Mōom Paris',
  krom: 'Krom Water',
}

export type FeatureKey =
  | 'dashboard' | 'campaigns' | 'creatives'
  | 'reorder' | 'billing' | 'delivery' | 'stock' | 'invoices' | 'products'
  | 'sav' | 'sav-defects' | 'sav-krom'

export interface Feature {
  key:       FeatureKey
  label:     string
  section:   string
  brandLock: Brand | null  // null = available on every brand
}

export const FEATURES: Feature[] = [
  { key: 'dashboard',   label: 'Dashboard',  section: 'Analyse',    brandLock: null   },
  { key: 'campaigns',   label: 'Campagnes',  section: 'Analyse',    brandLock: null   },
  { key: 'creatives',   label: 'Créatives',  section: 'Analyse',    brandLock: null   },
  { key: 'reorder',     label: 'Réappro',    section: 'Opérations', brandLock: null   },
  { key: 'billing',     label: 'Facturation',section: 'Opérations', brandLock: null   },
  { key: 'delivery',    label: 'Delivery',   section: 'Opérations', brandLock: 'bowa' },
  { key: 'stock',       label: 'Stock',      section: 'Opérations', brandLock: 'moom' },
  { key: 'invoices',    label: 'Factures',   section: 'Opérations', brandLock: 'moom' },
  { key: 'products',    label: 'Produits',   section: 'Opérations', brandLock: 'moom' },
  { key: 'sav',         label: 'SAV Mōom',   section: 'Support',    brandLock: 'moom' },
  { key: 'sav-defects', label: 'Défauts',    section: 'Support',    brandLock: 'moom' },
  { key: 'sav-krom',    label: 'SAV Krom',   section: 'Support',    brandLock: 'krom' },
]

export const BRAND_LOCK: Record<string, Brand> = Object.fromEntries(
  FEATURES.filter(f => f.brandLock).map(f => [f.key, f.brandLock as Brand])
)

export function isAdminRole(role?: string | null): boolean {
  return !role || role === 'admin'
}

// Fallback feature sets for users created before per-user `features` existed.
const ROLE_DEFAULT_FEATURES: Record<string, FeatureKey[]> = {
  sav:      ['billing', 'delivery', 'sav', 'sav-defects', 'sav-krom'],
  delivery: ['delivery'],
}

// 'all' means unrestricted (admin). Otherwise the explicit list of allowed keys.
export function effectiveFeatures(
  role?: string | null,
  features?: string[] | null,
): FeatureKey[] | 'all' {
  if (isAdminRole(role)) return 'all'
  if (Array.isArray(features)) return features as FeatureKey[]
  return ROLE_DEFAULT_FEATURES[role ?? ''] ?? []
}

// Brands a user may use. ALWAYS scoped to their explicit `brands` list — being an
// admin grants feature access, NOT cross-brand access (confidential per-brand data).
// Only an UNSET brands list means full access, and only for an admin (the owner).
export function effectiveBrands(role?: string | null, brands?: string[] | null): Brand[] {
  if (brands == null) return isAdminRole(role) ? BRANDS : []
  return brands.filter((b): b is Brand => (BRANDS as string[]).includes(b))
}

// Owner = admin with access to every brand (or unrestricted brands). Only the
// owner manages user access. A brand-scoped admin (e.g. Bowa-only) is NOT an owner.
export function isOwner(role?: string | null, brands?: string[] | null): boolean {
  if (!isAdminRole(role)) return false
  if (brands == null) return true
  return BRANDS.every(b => brands.includes(b))
}

// First landing page a restricted user can actually reach (for redirects).
export function homePath(feats: FeatureKey[] | 'all', brands: Brand[], defaultBrand: Brand): string {
  if (feats === 'all') return `/${defaultBrand}/dashboard`
  for (const f of feats) {
    const lock = BRAND_LOCK[f]
    if (!lock) return `/${defaultBrand}/${f}`
    if (brands.includes(lock)) return `/${lock}/${f}`
  }
  return `/${defaultBrand}/dashboard`
}
