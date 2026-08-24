// ─── SAV History — Supabase-backed, persistent ────────────────────────────────
// Stocke les exemples Q/A dans la table `sav_history_examples` (Supabase).
// Remplace l'ancienne approche filesystem/tmp qui perdait les données au cold start.

import { createAdminClient } from '@/lib/supabase'
import { exportSolvedTickets, ZendeskRateLimitError } from './zendesk'
import { embedOne, embedBatch, cosine, embeddingProvider } from './embeddings'

export interface HistoryExample {
  ticket_id:        number
  subject:          string
  customer_message: string
  agent_reply:      string
  created_at:       string
  category?:        string | null
  embedding?:       number[] | null
}

// ─── Supabase read/write ──────────────────────────────────────────────────────

// Charge les exemples. `withEmbedding` récupère aussi le vecteur (plus lourd) pour
// la recherche sémantique. Repli sur les colonnes de base si la migration
// embedding/category n'a pas encore été appliquée.
export async function loadHistory(withEmbedding = false): Promise<HistoryExample[]> {
  try {
    const sb = createAdminClient()
    const cols = withEmbedding
      ? 'ticket_id, subject, customer_message, agent_reply, created_at, embedding'
      : 'ticket_id, subject, customer_message, agent_reply, created_at'
    const { data, error } = await sb
      .from('sav_history_examples')
      .select(cols)
      .order('created_at', { ascending: true })
    if (error) {
      // colonnes embedding/category absentes → repli base
      if (withEmbedding) return loadHistory(false)
      console.warn('[SAV] loadHistory error:', error.message); return []
    }
    return (data ?? []) as unknown as HistoryExample[]
  } catch (e) {
    console.warn('[SAV] loadHistory exception:', e)
    return []
  }
}

// Embarque (embedding) les exemples qui n'en ont pas encore. Renvoie le nombre traité.
// Idempotent : à rappeler jusqu'à ce que remaining = 0.
export async function embedMissingExamples(limit = 200): Promise<{ embedded: number; remaining: number }> {
  if (!embeddingProvider()) return { embedded: 0, remaining: 0 }
  const sb = createAdminClient()
  const { data, error } = await sb
    .from('sav_history_examples')
    .select('ticket_id, subject, customer_message')
    .is('embedding', null)
    .limit(limit)
  if (error) { console.warn('[SAV] embedMissingExamples select:', error.message); return { embedded: 0, remaining: 0 } }
  const rows = (data ?? []) as { ticket_id: number; subject: string; customer_message: string }[]
  if (rows.length === 0) return { embedded: 0, remaining: 0 }

  let embedded = 0
  // Lots de 96 (limite API confortable)
  for (let i = 0; i < rows.length; i += 96) {
    const batch = rows.slice(i, i + 96)
    const texts = batch.map(r => `${r.subject}\n\n${r.customer_message}`.trim())
    const res = await embedBatch(texts)
    if (!res) break
    for (let j = 0; j < batch.length; j++) {
      await sb.from('sav_history_examples')
        .update({ embedding: res.vectors[j] })
        .eq('ticket_id', batch[j].ticket_id)
      embedded++
    }
  }
  const { count } = await sb.from('sav_history_examples').select('ticket_id', { count: 'exact', head: true }).is('embedding', null)
  return { embedded, remaining: count ?? 0 }
}

async function saveHistoryBatch(examples: HistoryExample[]): Promise<void> {
  if (examples.length === 0) return
  try {
    const sb = createAdminClient()
    const { error } = await sb
      .from('sav_history_examples')
      .upsert(examples, { onConflict: 'ticket_id' })
    if (error) console.warn('[SAV] saveHistoryBatch error:', error.message)
  } catch (e) {
    console.warn('[SAV] saveHistoryBatch exception:', e)
  }
}

// ─── Cursor storage ───────────────────────────────────────────────────────────

async function loadCursor(): Promise<string | null> {
  try {
    const sb = createAdminClient()
    const { data } = await sb
      .from('sav_import_state')
      .select('value')
      .eq('key', 'zendesk_cursor')
      .maybeSingle()
    return (data as { value: string } | null)?.value ?? null
  } catch { return null }
}

async function saveCursor(cursor: string | null): Promise<void> {
  try {
    const sb = createAdminClient()
    if (cursor === null) {
      await sb.from('sav_import_state').delete().eq('key', 'zendesk_cursor')
    } else {
      await sb.from('sav_import_state').upsert({ key: 'zendesk_cursor', value: cursor }, { onConflict: 'key' })
    }
  } catch (e) { console.warn('[SAV] saveCursor error:', e) }
}

// ─── Incremental import ───────────────────────────────────────────────────────

export async function importHistoryBatch(batchSize = 10): Promise<{
  imported:           number
  total:              number
  done:               boolean
  rate_limited?:      boolean
  retry_after_secs?:  number
  oldest:             string | null
  newest:             string | null
}> {
  const cursor = await loadCursor()

  let newExamples: Awaited<ReturnType<typeof exportSolvedTickets>>['examples'] = []
  let nextCursor: string | null = cursor

  try {
    const result = await exportSolvedTickets(batchSize, cursor)
    newExamples = result.examples
    nextCursor  = result.nextCursor

    await saveHistoryBatch(newExamples)
    await saveCursor(nextCursor)
    // Embarque les nouveaux exemples pour la recherche sémantique (best-effort).
    try { await embedMissingExamples(newExamples.length || 20) } catch { /* non bloquant */ }
  } catch (err) {
    if (err instanceof ZendeskRateLimitError) {
      // Rate limited — cursor unchanged, next cron call will retry
      console.warn(`[SAV] importHistoryBatch: rate limited, retry after ${err.retryAfterSeconds}s`)
      const sb = createAdminClient()
      const { count } = await sb.from('sav_history_examples').select('ticket_id', { count: 'exact', head: true })
      return { imported: 0, total: count ?? 0, done: false, rate_limited: true, retry_after_secs: err.retryAfterSeconds, oldest: null, newest: null }
    }
    throw err
  }

  const sb = createAdminClient()
  const { count } = await sb
    .from('sav_history_examples')
    .select('ticket_id', { count: 'exact', head: true })

  const dates = newExamples.map(e => e.created_at).filter(Boolean).sort()
  return {
    imported: newExamples.length,
    total:    count ?? 0,
    done:     nextCursor === null,
    oldest:   dates[0] ?? null,
    newest:   dates[dates.length - 1] ?? null,
  }
}

// ─── Keyword similarity ───────────────────────────────────────────────────────

const STOP_WORDS = new Set([
  'le', 'la', 'les', 'de', 'du', 'des', 'un', 'une', 'et', 'en',
  'je', 'il', 'elle', 'nous', 'vous', 'ils', 'elles', 'que', 'qui',
  'est', 'sont', 'mon', 'ma', 'mes', 'votre', 'vos', 'pas', 'ne',
  'sur', 'pour', 'par', 'avec', 'dans', 'au', 'aux', 'ou', 'si',
  'mais', 'donc', 'car', 'ni', 'the', 'and', 'for', 'this', 'that',
])

function tokenize(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^\w\s]/g, ' ')
      .split(/\s+/)
      .filter(w => w.length > 3 && !STOP_WORDS.has(w))
  )
}

function jaccardScore(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0
  let intersection = 0
  for (const w of a) if (b.has(w)) intersection++
  return intersection / (a.size + b.size - intersection)
}

function jaccardRank(examples: HistoryExample[], subject: string, customerMessage: string, k: number): HistoryExample[] {
  const qSubject = tokenize(subject)
  const qMessage = tokenize(customerMessage)
  return examples
    .map(ex => ({
      ex,
      score:
        jaccardScore(qSubject, tokenize(ex.subject))          * 1.0 +
        jaccardScore(qMessage, tokenize(ex.customer_message)) * 0.4,
    }))
    .filter(({ score }) => score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, k)
    .map(({ ex }) => ex)
}

/**
 * Retourne les k exemples historiques les plus similaires à subject + message.
 * 1) Recherche SÉMANTIQUE (embeddings + cosinus) si une clé d'embedding est
 *    configurée et que les exemples ont un vecteur — priorise les exemples de la
 *    MÊME catégorie. 2) Repli sur la similarité Jaccard (mots-clés) sinon.
 */
export async function findSimilarExamples(
  subject:         string,
  customerMessage: string,
  k = 5,
  category?:       string | null,
): Promise<HistoryExample[]> {
  // ── Voie sémantique ──
  if (embeddingProvider()) {
    try {
      const [examples, q] = await Promise.all([
        loadHistory(true),
        embedOne(`${subject}\n\n${customerMessage}`.trim()),
      ])
      const withVec = examples.filter(e => Array.isArray(e.embedding) && e.embedding!.length > 0)
      if (q && withVec.length > 0) {
        const scored = withVec
          .map(ex => ({
            ex,
            // Bonus si même catégorie que le ticket courant.
            score: cosine(q.vector, ex.embedding as number[]) + (category && ex.category === category ? 0.05 : 0),
          }))
          .sort((a, b) => b.score - a.score)
          // Garde les résultats vraiment pertinents (cosinus > 0.3).
          .filter(({ score }) => score > 0.3)
          .slice(0, k)
          .map(({ ex }) => ex)
        if (scored.length > 0) return scored
      }
      // sinon on retombe sur Jaccard avec les exemples déjà chargés
      if (examples.length > 0) return jaccardRank(examples, subject, customerMessage, k)
    } catch (e) {
      console.warn('[SAV] findSimilarExamples semantic failed, fallback Jaccard:', e)
    }
  }

  // ── Repli Jaccard ──
  const examples = await loadHistory()
  if (examples.length === 0) return []
  return jaccardRank(examples, subject, customerMessage, k)
}
