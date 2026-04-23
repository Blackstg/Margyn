// ─── Zendesk client — Mōom SAV ───────────────────────────────────────────────
// Env vars: ZENDESK_SUBDOMAIN, ZENDESK_EMAIL, ZENDESK_API_TOKEN

function base() {
  return `https://${process.env.ZENDESK_SUBDOMAIN}.zendesk.com/api/v2`
}

function authHeaders(): Record<string, string> {
  const creds = Buffer.from(
    `${process.env.ZENDESK_EMAIL}/token:${process.env.ZENDESK_API_TOKEN}`
  ).toString('base64')
  return {
    Authorization:  `Basic ${creds}`,
    'Content-Type': 'application/json',
  }
}

export interface ZendeskTicket {
  id:           number
  subject:      string
  description:  string
  status:       string
  tags:         string[]
  requester_id: number
  created_at:   string
}

interface ZendeskComment {
  id:        number
  author_id: number
  body:      string
  public:    boolean
  created_at: string
}

// Returns all new/open/pending tickets, excluding vip and litige
export async function getNewTickets(): Promise<ZendeskTicket[]> {
  // Zendesk: listing the same field twice = OR; tags filter done in code
  // "pending" is included — agents sometimes set tickets to pending while awaiting info
  const query = encodeURIComponent('type:ticket status:new status:open status:pending')
  const res = await fetchWithRetry(
    `${base()}/search.json?query=${query}&sort_by=created_at&sort_order=asc`,
    { headers: authHeaders(), cache: 'no-store' },
    3,
    1000,
  )
  if (!res.ok) throw new Error(`[Zendesk] getNewTickets ${res.status}: ${await res.text()}`)

  const data = await res.json() as { results?: ZendeskTicket[] }
  return (data.results ?? []).filter(
    (t) => !t.tags.includes('vip') && !t.tags.includes('litige')
  )
}

// Fetches the requester's email from their user ID
export async function getRequesterEmail(requesterId: number): Promise<string> {
  const res = await fetchWithRetry(
    `${base()}/users/${requesterId}.json`,
    { headers: authHeaders(), cache: 'no-store' },
    3,
    1000,
  )
  if (!res.ok) throw new Error(`[Zendesk] getRequester ${res.status}`)
  const data = await res.json() as { user: { email: string } }
  return data.user.email
}

// Posts a public reply and sets the ticket status.
// When solving, includes the required "Motif de contact" field (20652537824913)
// to satisfy Zendesk's resolution validation.
// uploads: optional list of Zendesk upload tokens to attach to the comment.
export async function postReply(
  ticketId: number,
  body:     string,
  solved:   boolean,
  uploads:  string[] = [],
): Promise<void> {
  const comment: Record<string, unknown> = { body, public: true }
  if (uploads.length > 0) comment.uploads = uploads

  const ticket: Record<string, unknown> = {
    status:  solved ? 'solved' : 'open',
    comment,
  }
  if (solved) {
    ticket.custom_fields = [{ id: 20652537824913, value: 'autres' }]
  }
  const res = await fetch(`${base()}/tickets/${ticketId}.json`, {
    method:  'PUT',
    headers: authHeaders(),
    body: JSON.stringify({ ticket }),
  })
  if (!res.ok) throw new Error(`[Zendesk] postReply ${res.status}: ${await res.text()}`)
}

// Adds one or more tags to a ticket (fire-and-forget safe)
export async function tagTicket(ticketId: number, tags: string[]): Promise<void> {
  const getRes = await fetch(
    `${base()}/tickets/${ticketId}.json`,
    { headers: authHeaders(), cache: 'no-store' }
  )
  if (!getRes.ok) throw new Error(`[Zendesk] tagTicket read ${getRes.status}`)
  const { ticket } = await getRes.json() as { ticket: ZendeskTicket }

  const res = await fetch(`${base()}/tickets/${ticketId}.json`, {
    method:  'PUT',
    headers: authHeaders(),
    body: JSON.stringify({
      ticket: {
        tags: [...new Set([...ticket.tags, ...tags])],
      },
    }),
  })
  if (!res.ok) throw new Error(`[Zendesk] tagTicket write ${res.status}: ${await res.text()}`)
}

// Adds the "escalade-humain" tag silently — no public reply
export async function escalateTicket(ticketId: number): Promise<void> {
  const getRes = await fetch(
    `${base()}/tickets/${ticketId}.json`,
    { headers: authHeaders(), cache: 'no-store' }
  )
  if (!getRes.ok) throw new Error(`[Zendesk] escalate read ${getRes.status}`)
  const { ticket } = await getRes.json() as { ticket: ZendeskTicket }

  const res = await fetch(`${base()}/tickets/${ticketId}.json`, {
    method:  'PUT',
    headers: authHeaders(),
    body: JSON.stringify({
      ticket: {
        tags: [...new Set([...ticket.tags, 'escalade-humain'])],
      },
    }),
  })
  if (!res.ok) throw new Error(`[Zendesk] escalate write ${res.status}: ${await res.text()}`)
}

// Closes a ticket as solved without posting any public comment.
// Sets the required "Motif de contact" field to "autres" (field 20652537824913)
// to satisfy Zendesk's validation, and adds the "steero-archive" tag.
export async function archiveTicket(ticketId: number): Promise<void> {
  const res = await fetch(`${base()}/tickets/${ticketId}.json`, {
    method:  'PUT',
    headers: authHeaders(),
    body: JSON.stringify({
      ticket: {
        status: 'solved',
        custom_fields: [{ id: 20652537824913, value: 'autres' }],
        tags_to_add: ['steero-archive'],
      },
    }),
  })
  if (!res.ok) throw new Error(`[Zendesk] archiveTicket ${res.status}: ${await res.text()}`)
}

// ─── Conversation thread ──────────────────────────────────────────────────────

export interface CommentItem {
  id:          number
  body:        string
  author_type: 'client' | 'agent'
  created_at:  string
}

// Returns all public comments for a ticket, labelled client vs agent.
export async function getTicketComments(
  ticketId:    number,
  requesterId: number,
): Promise<CommentItem[]> {
  const url = `${base()}/tickets/${ticketId}/comments.json`
  console.log(`[Zendesk] getTicketComments — fetching #${ticketId} (requesterId=${requesterId})`)

  // Use fetchWithRetry so 429s are handled with a minimum 1s delay
  const res = await fetchWithRetry(url, { headers: authHeaders(), cache: 'no-store' }, 3, 1000)

  if (!res.ok) {
    const body = await res.text().catch(() => '(unreadable)')
    console.error(`[Zendesk] getTicketComments #${ticketId} — HTTP ${res.status}: ${body}`)
    throw new Error(`[Zendesk] getTicketComments ${res.status}: ${body}`)
  }

  const data = await res.json() as { comments?: ZendeskComment[] }
  const all = data.comments ?? []
  const publicComments = all.filter(c => c.public)

  console.log(
    `[Zendesk] getTicketComments #${ticketId} — ${all.length} total, ${publicComments.length} public`
  )

  if (publicComments.length === 0) {
    console.warn(`[Zendesk] getTicketComments #${ticketId} — 0 public comments (raw payload keys: ${Object.keys(data).join(', ')})`)
  }

  // If we have a valid requesterId, use it to distinguish client vs agent.
  // Otherwise, fall back: the first public comment is from the client,
  // subsequent ones alternate but we mark them all as agent (better than nothing).
  if (requesterId) {
    return publicComments.map(c => ({
      id:          c.id,
      body:        c.body,
      author_type: c.author_id === requesterId ? 'client' : 'agent',
      created_at:  c.created_at,
    }))
  }

  // Heuristic fallback: first comment = client, rest = agent
  return publicComments.map((c, i) => ({
    id:          c.id,
    body:        c.body,
    author_type: (i === 0 ? 'client' : 'agent') as 'client' | 'agent',
    created_at:  c.created_at,
  }))
}

// ─── History export ───────────────────────────────────────────────────────────

export interface SolvedTicketData {
  ticket_id:        number
  subject:          string
  customer_message: string
  agent_reply:      string
  created_at:       string
}

// Processes items one by one with a fixed pause between each.
// Zendesk trial plans allow ~10 req/min → 7s between requests is safe.
async function withConcurrency<T, R>(
  items: T[],
  fn: (item: T) => Promise<R | null>,
  pauseMs = 7000
): Promise<R[]> {
  const results: R[] = []
  for (let i = 0; i < items.length; i++) {
    try {
      const val = await fn(items[i])
      if (val !== null) results.push(val)
    } catch { /* skip failed items */ }
    if (i < items.length - 1) await sleep(pauseMs)
  }
  return results
}

function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

// Fetch with automatic retry on 429 (respects Retry-After header).
// minWaitMs: floor on the wait duration regardless of Retry-After (default 1s).
async function fetchWithRetry(
  url: string,
  opts: RequestInit,
  maxRetries = 4,
  minWaitMs  = 1000,
): Promise<Response> {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const res = await fetch(url, opts)
    if (res.status !== 429) return res
    const retryAfter = Number(res.headers.get('Retry-After') ?? 60)
    const wait = Math.max(minWaitMs, Math.min(retryAfter, 120) * 1000)
    console.warn(`[Zendesk] 429 — waiting ${wait / 1000}s (attempt ${attempt + 1}/${maxRetries})`)
    await sleep(wait)
  }
  throw new Error('[Zendesk] Too many retries after repeated 429')
}

async function fetchComments(ticketId: number): Promise<ZendeskComment[]> {
  const res = await fetchWithRetry(
    `${base()}/tickets/${ticketId}/comments.json`,
    { headers: authHeaders(), cache: 'no-store' }
  )
  if (!res.ok) return []
  const data = await res.json() as { comments: ZendeskComment[] }
  return data.comments ?? []
}

/**
 * Exports all solved tickets with their last public agent reply.
 * Paginates via Zendesk next_page until exhausted.
 * Fetches comments in parallel batches of 5 to avoid rate limits.
 */
export async function exportSolvedTickets(
  maxTickets = 200
): Promise<SolvedTicketData[]> {
  const allTickets: ZendeskTicket[] = []
  // Sort ascending = oldest first. Old tickets are real SAV exchanges;
  // the newest ones are skewed toward spam / collaboration requests.
  let url: string | null =
    `${base()}/tickets.json?status=solved&per_page=100&sort_by=created_at&sort_order=asc`

  // 1. Collect solved tickets — cap at maxTickets, 2s between pages
  while (url && allTickets.length < maxTickets) {
    const res = await fetchWithRetry(url, { headers: authHeaders(), cache: 'no-store' })
    if (!res.ok) throw new Error(`[Zendesk] exportSolvedTickets ${res.status}: ${await res.text()}`)
    const data = await res.json() as { tickets: ZendeskTicket[]; next_page: string | null }
    allTickets.push(...data.tickets)
    if (allTickets.length >= maxTickets) break
    url = data.next_page
    if (url) await sleep(2000)
  }
  allTickets.splice(maxTickets)

  console.log(`[Zendesk] ${allTickets.length} tickets résolus — récupération des commentaires (~7s/ticket, ~${Math.round(allTickets.length * 7 / 60)} min)…`)

  // 2. Fetch FIRST agent comment for each ticket, one by one.
  //    We use the first agent reply (not the last) because the last tends to be
  //    a short "Merci pour votre retour" — the first reply is the substantive response.
  const examples = await withConcurrency(
    allTickets,
    async (ticket): Promise<SolvedTicketData | null> => {
      console.log(`  → #${ticket.id} ${ticket.subject.slice(0, 50)}`)
      const comments = await fetchComments(ticket.id)

      // First public comment from someone other than the requester = first agent reply
      const agentReply = comments.find(
        c => c.public && c.author_id !== ticket.requester_id && c.body?.trim().length > 20
      )

      if (!agentReply?.body?.trim()) return null

      // Customer message: first public comment from the requester (richer than description for email tickets)
      const customerComment = comments.find(c => c.public && c.author_id === ticket.requester_id)
      const customerMessage = customerComment?.body?.trim() || ticket.description

      return {
        ticket_id:        ticket.id,
        subject:          ticket.subject,
        customer_message: customerMessage,
        agent_reply:      agentReply.body,
        created_at:       ticket.created_at,
      }
    }
  )

  return examples
}
