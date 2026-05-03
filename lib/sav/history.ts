// ─── SAV History — load, save, similarity search ─────────────────────────────

import fs   from 'fs'
import path from 'path'
import { exportSolvedTickets } from './zendesk'

export interface HistoryExample {
  ticket_id:        number
  subject:          string
  customer_message: string
  agent_reply:      string
  created_at:       string
}

const FILE_PATH = path.join(process.cwd(), 'lib/sav/history.json')
const TMP_PATH  = '/tmp/sav-history.json'

export function loadHistory(): HistoryExample[] {
  for (const p of [TMP_PATH, FILE_PATH]) {
    try {
      const data = JSON.parse(fs.readFileSync(p, 'utf-8')) as { examples: HistoryExample[] }
      if (Array.isArray(data.examples)) return data.examples
    } catch { /* try next */ }
  }
  return []
}

function saveHistory(examples: HistoryExample[]) {
  const json = JSON.stringify({ examples }, null, 2)
  // In local dev, write back to the lib file so it's git-trackable
  try {
    fs.writeFileSync(FILE_PATH, json, 'utf-8')
  } catch {
    // On Vercel (read-only FS), fall back to /tmp — persists in warm instance
    fs.writeFileSync(TMP_PATH, json, 'utf-8')
  }
}

// ─── Cursor storage ───────────────────────────────────────────────────────────
// Stores the Zendesk next_page URL so incremental imports can resume.

import { createAdminClient } from '@/lib/supabase'

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
// Each call imports up to `batchSize` tickets from where the last call left off.
// Returns { done: true } when all solved tickets have been imported.

export async function importHistoryBatch(batchSize = 25): Promise<{
  imported: number
  total: number
  done: boolean
  oldest: string | null
  newest: string | null
}> {
  const cursor = await loadCursor()
  const { examples: newExamples, nextCursor } = await exportSolvedTickets(batchSize, cursor)

  // Merge with existing — deduplicate by ticket_id
  const existing = loadHistory()
  const existingIds = new Set(existing.map(e => e.ticket_id))
  const merged = [...existing, ...newExamples.filter(e => !existingIds.has(e.ticket_id))]
  saveHistory(merged)
  await saveCursor(nextCursor)

  const dates = merged.map(e => e.created_at).filter(Boolean).sort()
  return {
    imported: newExamples.length,
    total:    merged.length,
    done:     nextCursor === null,
    oldest:   dates[0] ?? null,
    newest:   dates[dates.length - 1] ?? null,
  }
}

export async function importHistory(limit = 50): Promise<{ count: number; oldest: string | null; newest: string | null }> {
  const { examples, nextCursor } = await exportSolvedTickets(limit, null)
  saveHistory(examples)
  await saveCursor(nextCursor)
  const dates = examples.map(e => e.created_at).filter(Boolean).sort()
  return {
    count:  examples.length,
    oldest: dates[0]            ?? null,
    newest: dates[dates.length - 1] ?? null,
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
      .replace(/[\u0300-\u036f]/g, '')   // strip accents for matching
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
 * Returns the k most similar historical examples to the given subject + message.
 * Uses Jaccard similarity on subject tokens (weight 1.0) +
 * customer_message tokens (weight 0.4).
 * Only returns examples with score > 0.
 */
export function findSimilarExamples(
  subject:         string,
  customerMessage: string,
  k = 5
): HistoryExample[] {
  const examples = loadHistory()
  if (examples.length === 0) return []

  const qSubject  = tokenize(subject)
  const qMessage  = tokenize(customerMessage)

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
