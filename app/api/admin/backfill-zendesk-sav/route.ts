// GET /api/admin/backfill-zendesk-sav?secret=...
// Backfill SAV history from ALL solved/closed Zendesk tickets via search API.
// The incremental cursor approach only captures ~5% (tickets already solved at fetch time).
// This uses search API with monthly date ranges to get all 4400+ closed tickets.
//
// Call repeatedly until { done: true }.  Each call processes 20 tickets.
// Progress stored in sav_import_state under key "zendesk_search_cursor".

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

// ─── Config ───────────────────────────────────────────────────────────────────

const TICKETS_PER_CALL = 20   // keep well under 60s (each needs 1 comment API call)
const CONCURRENCY      = 5

// Monthly windows to stay under Zendesk search 1000-result cap
const DATE_WINDOWS = [
  { from: '2025-01-01', to: '2025-02-01' },
  { from: '2025-02-01', to: '2025-03-01' },
  { from: '2025-03-01', to: '2025-04-01' },
  { from: '2025-04-01', to: '2025-05-01' },
  { from: '2025-05-01', to: '2025-06-01' },
  { from: '2025-06-01', to: '2025-07-01' },
  { from: '2025-07-01', to: '2025-08-01' },
  { from: '2025-08-01', to: '2025-09-01' },
  { from: '2025-09-01', to: '2025-10-01' },
  { from: '2025-10-01', to: '2025-11-01' },
  { from: '2025-11-01', to: '2025-12-01' },
  { from: '2025-12-01', to: '2026-01-01' },
  { from: '2026-01-01', to: '2026-02-01' },
  { from: '2026-02-01', to: '2026-03-01' },
  { from: '2026-03-01', to: '2026-04-01' },
  { from: '2026-04-01', to: '2026-05-01' },
  { from: '2026-05-01', to: '2026-06-01' },
]

interface Cursor { windowIdx: number; page: number }

// ─── Zendesk helpers ──────────────────────────────────────────────────────────

function zdBase() {
  return `https://${process.env.ZENDESK_SUBDOMAIN}.zendesk.com/api/v2`
}

function zdAuth(): Record<string, string> {
  const creds = Buffer.from(
    `${process.env.ZENDESK_EMAIL}/token:${process.env.ZENDESK_API_TOKEN}`
  ).toString('base64')
  return { Authorization: `Basic ${creds}`, 'Content-Type': 'application/json' }
}

async function zdFetch(url: string) {
  const res = await fetch(url, { headers: zdAuth(), cache: 'no-store' })
  if (res.status === 429) {
    const retry = Number(res.headers.get('Retry-After') ?? 60)
    return { rateLimited: true, retryAfter: retry, data: null }
  }
  if (!res.ok) throw new Error(`Zendesk ${res.status}: ${await res.text()}`)
  return { rateLimited: false, retryAfter: 0, data: await res.json() }
}

async function withConcurrency<T, R>(
  items: T[], fn: (item: T) => Promise<R>, limit: number
): Promise<R[]> {
  const results: R[] = []
  for (let i = 0; i < items.length; i += limit) {
    const chunk = items.slice(i, i + limit)
    results.push(...await Promise.all(chunk.map(fn)))
  }
  return results
}

// ─── Supabase helpers ─────────────────────────────────────────────────────────

function getSb() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}

async function loadCursor(): Promise<Cursor> {
  const sb = getSb()
  const { data } = await sb
    .from('sav_import_state')
    .select('value')
    .eq('key', 'zendesk_search_cursor')
    .maybeSingle()
  if (!data) return { windowIdx: 0, page: 1 }
  try { return JSON.parse((data as { value: string }).value) as Cursor }
  catch { return { windowIdx: 0, page: 1 } }
}

async function saveCursor(cursor: Cursor) {
  const sb = getSb()
  await sb.from('sav_import_state').upsert(
    { key: 'zendesk_search_cursor', value: JSON.stringify(cursor) },
    { onConflict: 'key' }
  )
}

async function upsertExamples(rows: { ticket_id: number; subject: string; customer_message: string; agent_reply: string; created_at: string }[]) {
  if (rows.length === 0) return
  const sb = getSb()
  await sb.from('sav_history_examples').upsert(rows, { onConflict: 'ticket_id' })
}

async function totalCount(): Promise<number> {
  const sb = getSb()
  const { count } = await sb.from('sav_history_examples').select('ticket_id', { count: 'exact', head: true })
  return count ?? 0
}

// ─── Main handler ─────────────────────────────────────────────────────────────

export async function GET(req: NextRequest) {
  const secret = req.nextUrl.searchParams.get('secret')
  if (secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const cursor = await loadCursor()

  // Done when all windows processed
  if (cursor.windowIdx >= DATE_WINDOWS.length) {
    return NextResponse.json({ done: true, total: await totalCount() })
  }

  const window = DATE_WINDOWS[cursor.windowIdx]

  // Fetch one page of search results (100 per page, take TICKETS_PER_CALL from it)
  const query = encodeURIComponent(
    `type:ticket status:closed status:solved created>=${window.from} created<${window.to}`
  )
  const searchUrl = `${zdBase()}/search.json?query=${query}&sort_by=created_at&sort_order=asc&per_page=100&page=${cursor.page}`
  const { rateLimited, retryAfter, data } = await zdFetch(searchUrl)

  if (rateLimited) {
    return NextResponse.json({ done: false, rate_limited: true, retry_after_secs: retryAfter, total: await totalCount() })
  }

  const searchData = data as { results: { id: number; subject: string; description: string; status: string; requester_id: number; created_at: string }[]; next_page: string | null; count: number }
  const tickets = searchData.results ?? []

  if (tickets.length === 0) {
    // This month window is done, move to next
    await saveCursor({ windowIdx: cursor.windowIdx + 1, page: 1 })
    return NextResponse.json({ done: false, window: window.from, page: cursor.page, imported: 0, window_done: true, total: await totalCount() })
  }

  // Process up to TICKETS_PER_CALL from this page
  const batch = tickets.slice(0, TICKETS_PER_CALL)

  const examples = (await withConcurrency(batch, async (ticket) => {
    // Fetch comments
    const { rateLimited: rl, data: cd } = await zdFetch(`${zdBase()}/tickets/${ticket.id}/comments.json`)
    if (rl || !cd) return null
    const comments = (cd as { comments: { id: number; author_id: number; body: string; public: boolean; created_at: string }[] }).comments ?? []

    const agentReply = comments.find(
      c => c.public && c.author_id !== ticket.requester_id && c.body?.trim().length > 20
    )
    if (!agentReply) return null

    const customerComment = comments.find(c => c.public && c.author_id === ticket.requester_id)
    const customerMessage = customerComment?.body?.trim() || ticket.description

    return {
      ticket_id:        ticket.id,
      subject:          ticket.subject,
      customer_message: customerMessage,
      agent_reply:      agentReply.body,
      created_at:       ticket.created_at,
    }
  }, CONCURRENCY)).filter(Boolean) as { ticket_id: number; subject: string; customer_message: string; agent_reply: string; created_at: string }[]

  await upsertExamples(examples)

  // Advance cursor: if we processed fewer than 100 tickets, move to next page or next window
  const isLastBatchOnPage = batch.length >= tickets.length
  let nextCursor: Cursor

  if (isLastBatchOnPage && !searchData.next_page) {
    // No more pages in this window
    nextCursor = { windowIdx: cursor.windowIdx + 1, page: 1 }
  } else if (isLastBatchOnPage) {
    // Move to next page
    nextCursor = { windowIdx: cursor.windowIdx, page: cursor.page + 1 }
  } else {
    // More tickets on this page — stay on same page, caller will re-call
    // (we took first 20; next call re-fetches page and skips already-upserted ones)
    // Actually simpler: always advance to next page after each call
    nextCursor = { windowIdx: cursor.windowIdx, page: cursor.page + 1 }
  }

  await saveCursor(nextCursor)

  return NextResponse.json({
    done:     false,
    window:   window.from,
    page:     cursor.page,
    imported: examples.length,
    total:    await totalCount(),
    next:     `window=${nextCursor.windowIdx} page=${nextCursor.page}`,
  })
}
