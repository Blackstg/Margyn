// ─── SAV History — Supabase-backed, persistent ────────────────────────────────
// Stocke les exemples Q/A dans la table `sav_history_examples` (Supabase).
// Remplace l'ancienne approche filesystem/tmp qui perdait les données au cold start.

import { createAdminClient } from '@/lib/supabase'
import { exportSolvedTickets, ZendeskRateLimitError } from './zendesk'

export interface HistoryExample {
  ticket_id:        number
  subject:          string
  customer_message: string
  agent_reply:      string
  created_at:       string
}

// ─── Supabase read/write ──────────────────────────────────────────────────────

export async function loadHistory(): Promise<HistoryExample[]> {
  try {
    const sb = createAdminClient()
    const { data, error } = await sb
      .from('sav_history_examples')
      .select('ticket_id, subject, customer_message, agent_reply, created_at')
      .order('created_at', { ascending: true })
    if (error) { console.warn('[SAV] loadHistory error:', error.message); return [] }
    return (data ?? []) as HistoryExample[]
  } catch (e) {
    console.warn('[SAV] loadHistory exception:', e)
    return []
  }
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

/**
 * Retourne les k exemples historiques les plus similaires à subject + message.
 * Utilise la similarité Jaccard sur les tokens.
 */
export async function findSimilarExamples(
  subject:         string,
  customerMessage: string,
  k = 5
): Promise<HistoryExample[]> {
  const examples = await loadHistory()
  if (examples.length === 0) return []

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
