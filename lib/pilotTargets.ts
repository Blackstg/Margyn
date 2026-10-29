// Cibles de la page Pilote (% du CA HT net), modifiables par marque. Stockées en JSON dans
// le bucket app-config. Par défaut : repères d'un e-commerce de produits lourds livrés
// (livraison plus chère que du colis), qui laissent ~10 % de bénéfice avec ~16 % de fixes.
import type { SupabaseClient } from '@supabase/supabase-js'

const BUCKET = 'app-config'
const path = (brand: string) => `pilot/${brand}/targets.json`

export type PilotTargets = { profit: number; products: number; delivery: number; ads: number; fees: number }
export const TARGET_KEYS = ['profit', 'products', 'delivery', 'ads', 'fees'] as const

export const DEFAULT_TARGETS: PilotTargets = { profit: 10, products: 30, delivery: 22, ads: 20, fees: 2 }

export function cleanTargets(raw: unknown): PilotTargets {
  const src = (raw ?? {}) as Record<string, unknown>
  const out = { ...DEFAULT_TARGETS }
  for (const k of TARGET_KEYS) {
    const n = Number(src[k])
    if (Number.isFinite(n) && n >= 0 && n <= 100) out[k] = Math.round(n * 10) / 10
  }
  return out
}

export async function loadTargets(sb: SupabaseClient, brand: string): Promise<PilotTargets> {
  const { data, error } = await sb.storage.from(BUCKET).download(path(brand))
  if (error || !data) return { ...DEFAULT_TARGETS }
  try { return cleanTargets(JSON.parse(await data.text())) } catch { return { ...DEFAULT_TARGETS } }
}

export async function saveTargets(sb: SupabaseClient, brand: string, t: PilotTargets) {
  const body = JSON.stringify(t)
  let { error } = await sb.storage.from(BUCKET).upload(path(brand), body, { upsert: true, contentType: 'application/json' })
  if (error && /not found/i.test(error.message)) {
    await sb.storage.createBucket(BUCKET, { public: false })
    ;({ error } = await sb.storage.from(BUCKET).upload(path(brand), body, { upsert: true, contentType: 'application/json' }))
  }
  if (error) throw new Error(error.message)
}
