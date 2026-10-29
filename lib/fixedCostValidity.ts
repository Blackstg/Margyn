// Période de validité des charges fixes récurrentes (lignes « sentinelle » 1900-01-01 de
// fixed_costs). Sans période, une ligne s'appliquait à TOUS les mois, passés compris :
// retirer une personne partie faussait l'historique. Ici, chaque ligne peut avoir
// un mois de début et/ou de fin (inclus). Stocké en JSON dans le bucket app-config,
// clé = `${category}:${label}` (un renommage dans Paramètres repart sans période).
import type { SupabaseClient } from '@supabase/supabase-js'

const BUCKET = 'app-config'
const path = (brand: string) => `fixed-costs/${brand}/validity.json`

export type Validity = Record<string, { from?: string; to?: string }>   // mois 'YYYY-MM'

export const validityKey = (category: string, label: string) => `${category}:${label.trim()}`

export async function loadValidity(sb: SupabaseClient, brand: string): Promise<Validity> {
  const { data, error } = await sb.storage.from(BUCKET).download(path(brand))
  if (error || !data) return {}
  try { return JSON.parse(await data.text()) as Validity } catch { return {} }
}

export async function saveValidity(sb: SupabaseClient, brand: string, v: Validity) {
  const body = JSON.stringify(v)
  let { error } = await sb.storage.from(BUCKET).upload(path(brand), body, { upsert: true, contentType: 'application/json' })
  if (error && /not found/i.test(error.message)) {
    await sb.storage.createBucket(BUCKET, { public: false })
    ;({ error } = await sb.storage.from(BUCKET).upload(path(brand), body, { upsert: true, contentType: 'application/json' }))
  }
  if (error) throw new Error(error.message)
}

// La ligne compte-t-elle pour ce mois ('YYYY-MM') ?
export function activeIn(v: Validity, category: string, label: string, month: string): boolean {
  const p = v[validityKey(category, label)]
  if (!p) return true
  if (p.from && month < p.from) return false
  if (p.to && month > p.to) return false
  return true
}
