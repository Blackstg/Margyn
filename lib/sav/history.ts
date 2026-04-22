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

export async function importHistory(): Promise<{ count: number }> {
  const examples = await exportSolvedTickets()
  saveHistory(examples)
  return { count: examples.length }
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
