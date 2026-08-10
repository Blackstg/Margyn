// ─── Zendesk client — multi-marque ───────────────────────────────────────────
// Moom : ZENDESK_SUBDOMAIN / ZENDESK_EMAIL / ZENDESK_API_TOKEN
// Bowa : ZENDESK_BOWA_SUBDOMAIN / ZENDESK_BOWA_EMAIL / ZENDESK_BOWA_API_TOKEN
// `brand` = dernier paramètre optionnel (défaut 'moom') → Moom inchangé, Bowa
// passe la marque. Chaque marque tape SON compte Zendesk (confidentialité).
export type SavBrand = 'moom' | 'bowa'

interface ZdConfig {
  subdomain: string
  email:     string
  token:     string
  resolutionField: { id: number; value: string } | null // champ obligatoire au solve (null = aucun)
}

function zdConfig(brand: SavBrand): ZdConfig {
  if (brand === 'bowa') {
    return {
      subdomain: process.env.ZENDESK_BOWA_SUBDOMAIN ?? '',
      email:     process.env.ZENDESK_BOWA_EMAIL ?? '',
      token:     process.env.ZENDESK_BOWA_API_TOKEN ?? '',
      resolutionField: null, // le Zendesk Bowa n'a aucun champ obligatoire au solve
    }
  }
  return {
    subdomain: process.env.ZENDESK_SUBDOMAIN ?? '',
    email:     process.env.ZENDESK_EMAIL ?? '',
    token:     process.env.ZENDESK_API_TOKEN ?? '',
    resolutionField: { id: 20652537824913, value: 'autres' }, // « Motif de contact » Moom
  }
}

function base(brand: SavBrand) {
  return `https://${zdConfig(brand).subdomain}.zendesk.com/api/v2`
}

function authHeaders(brand: SavBrand): Record<string, string> {
  const c = zdConfig(brand)
  const creds = Buffer.from(`${c.email}/token:${c.token}`).toString('base64')
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
  updated_at:   string   // dernière mise à jour du ticket (réponse client = updated_at avance)
}

interface ZendeskAttachment {
  id:           number
  file_name:    string
  content_url:  string   // URL directe Zendesk (authentifiée via token dans l'URL)
  content_type: string
  size:         number
}

interface ZendeskComment {
  id:          number
  author_id:   number
  body:        string
  html_body?:  string
  public:      boolean
  created_at:  string
  attachments: ZendeskAttachment[]
}

// Returns all new/open/pending tickets, excluding vip and litige
export async function getNewTickets(brand: SavBrand = 'moom'): Promise<ZendeskTicket[]> {
  // Zendesk: listing the same field twice = OR; tags filter done in code
  // "pending" is included — agents sometimes set tickets to pending while awaiting info
  const query = encodeURIComponent('type:ticket status:new status:open status:pending')
  const res = await fetchWithRetry(
    `${base(brand)}/search.json?query=${query}&sort_by=created_at&sort_order=asc`,
    { headers: authHeaders(brand), cache: 'no-store' },
    3,
    1000,
  )
  if (!res.ok) throw new Error(`[Zendesk] getNewTickets ${res.status}: ${await res.text()}`)

  const data = await res.json() as { results?: ZendeskTicket[] }
  return (data.results ?? []).filter(
    (t) => !t.tags.includes('vip') && !t.tags.includes('litige')
  )
}

// Recherche libre de tickets (n'importe quel statut, y compris résolus) — pour
// retrouver un ticket par n° de commande, email, sujet ou n° de ticket.
export async function searchTickets(q: string, brand: SavBrand = 'moom'): Promise<ZendeskTicket[]> {
  const raw = q.trim()
  if (!raw) return []
  // N° de ticket exact (#12345 ou 12345) → lecture directe.
  const idMatch = raw.match(/^#?(\d{3,})$/)
  if (idMatch) {
    const res = await fetchWithRetry(
      `${base(brand)}/tickets/${idMatch[1]}.json`,
      { headers: authHeaders(brand), cache: 'no-store' }, 2, 1000,
    ).catch(() => null)
    if (res && res.ok) {
      const { ticket } = await res.json() as { ticket?: ZendeskTicket }
      if (ticket) return [ticket]
    }
    // sinon on retombe sur la recherche plein texte
  }
  const query = encodeURIComponent(`type:ticket ${raw}`)
  const res = await fetchWithRetry(
    `${base(brand)}/search.json?query=${query}&sort_by=updated_at&sort_order=desc&per_page=25`,
    { headers: authHeaders(brand), cache: 'no-store' }, 3, 1000,
  )
  if (!res.ok) throw new Error(`[Zendesk] searchTickets ${res.status}: ${await res.text()}`)
  const data = await res.json() as { results?: ZendeskTicket[] }
  return (data.results ?? []).filter(t => t.id)
}

export interface CustomerTicketSummary {
  id:          number
  subject:     string
  status:      string
  created_at:  string
  updated_at:  string
}

// Returns all solved/closed tickets from a given email, sorted newest first.
// Used to show the full conversation history with a customer across all tickets.
export async function getCustomerTickets(
  email:          string,
  excludeTicketId?: number,
  brand: SavBrand = 'moom',
): Promise<CustomerTicketSummary[]> {
  const query = encodeURIComponent(`type:ticket requester:${email}`)
  const res = await fetchWithRetry(
    `${base(brand)}/search.json?query=${query}&sort_by=created_at&sort_order=desc&per_page=20`,
    { headers: authHeaders(brand), cache: 'no-store' },
    3, 1000,
  )
  if (!res.ok) throw new Error(`[Zendesk] getCustomerTickets ${res.status}: ${await res.text()}`)
  const data = await res.json() as { results?: ZendeskTicket[] }
  return (data.results ?? [])
    .filter(t => t.id !== excludeTicketId)
    .map(t => ({
      id:         t.id,
      subject:    t.subject,
      status:     t.status,
      created_at: t.created_at,
      updated_at: t.updated_at,
    }))
}

// Fetches the requester's email from their user ID
export async function getRequesterEmail(requesterId: number, brand: SavBrand = 'moom'): Promise<string> {
  const res = await fetchWithRetry(
    `${base(brand)}/users/${requesterId}.json`,
    { headers: authHeaders(brand), cache: 'no-store' },
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
// Creates a new outbound ticket — sends an email to a customer who has no existing ticket.
// Returns the created ticket ID.
export async function createOutboundTicket(
  toEmail:      string,
  subject:      string,
  body:         string,
  customerName?: string,
  brand: SavBrand = 'moom',
): Promise<number> {
  // Zendesk requires requester.name (min 1 char) — fall back to the email prefix
  const requesterName = customerName?.trim() || toEmail.split('@')[0]
  const rf = zdConfig(brand).resolutionField

  const res = await fetchWithRetry(
    `${base(brand)}/tickets.json`,
    {
      method:  'POST',
      headers: authHeaders(brand),
      body: JSON.stringify({
        ticket: {
          subject,
          requester: { email: toEmail, name: requesterName },
          comment:   { body, public: true },
          status:    'open',
          ...(rf ? { custom_fields: [{ id: rf.id, value: rf.value }] } : {}),
        },
      }),
    },
    4, 1000,
  )
  if (!res.ok) throw new Error(`[Zendesk] createOutboundTicket ${res.status}: ${await res.text()}`)
  const data = await res.json() as { ticket: { id: number } }
  return data.ticket.id
}

export async function postReply(
  ticketId: number,
  body:     string,
  solved:   boolean,
  uploads:  string[] = [],
  brand: SavBrand = 'moom',
): Promise<void> {
  const comment: Record<string, unknown> = { body, public: true }
  if (uploads.length > 0) comment.uploads = uploads

  const ticket: Record<string, unknown> = {
    status:  solved ? 'solved' : 'open',
    comment,
  }
  const rf = zdConfig(brand).resolutionField
  if (solved && rf) {
    ticket.custom_fields = [{ id: rf.id, value: rf.value }]
  }
  const res = await fetchWithRetry(
    `${base(brand)}/tickets/${ticketId}.json`,
    { method: 'PUT', headers: authHeaders(brand), body: JSON.stringify({ ticket }) },
    4,
    1000,
  )
  if (!res.ok) throw new Error(`[Zendesk] postReply ${res.status}: ${await res.text()}`)
}

// Adds an INTERNAL (private) note to a ticket — invisible to the customer.
// Utilisé pour tracer un transfert de mail vers un tiers.
export async function addInternalNote(ticketId: number, body: string, brand: SavBrand = 'moom'): Promise<void> {
  const res = await fetchWithRetry(
    `${base(brand)}/tickets/${ticketId}.json`,
    { method: 'PUT', headers: authHeaders(brand), body: JSON.stringify({ ticket: { comment: { body, public: false } } }) },
    3,
    1000,
  )
  if (!res.ok) throw new Error(`[Zendesk] addInternalNote ${res.status}: ${await res.text()}`)
}

// Adds one or more tags to a ticket (fire-and-forget safe)
export async function tagTicket(ticketId: number, tags: string[], brand: SavBrand = 'moom'): Promise<void> {
  const getRes = await fetchWithRetry(
    `${base(brand)}/tickets/${ticketId}.json`,
    { headers: authHeaders(brand), cache: 'no-store' },
    3, 1000,
  )
  if (!getRes.ok) throw new Error(`[Zendesk] tagTicket read ${getRes.status}`)
  const { ticket } = await getRes.json() as { ticket: ZendeskTicket }

  const res = await fetchWithRetry(
    `${base(brand)}/tickets/${ticketId}.json`,
    { method: 'PUT', headers: authHeaders(brand), body: JSON.stringify({ ticket: { tags: [...new Set([...ticket.tags, ...tags])] } }) },
    3, 1000,
  )
  if (!res.ok) throw new Error(`[Zendesk] tagTicket write ${res.status}: ${await res.text()}`)
}

// Adds the "escalade-humain" tag silently — no public reply
export async function escalateTicket(ticketId: number, brand: SavBrand = 'moom'): Promise<void> {
  const getRes = await fetchWithRetry(
    `${base(brand)}/tickets/${ticketId}.json`,
    { headers: authHeaders(brand), cache: 'no-store' },
    3, 1000,
  )
  if (!getRes.ok) throw new Error(`[Zendesk] escalate read ${getRes.status}`)
  const { ticket } = await getRes.json() as { ticket: ZendeskTicket }

  const res = await fetchWithRetry(
    `${base(brand)}/tickets/${ticketId}.json`,
    { method: 'PUT', headers: authHeaders(brand), body: JSON.stringify({ ticket: { tags: [...new Set([...ticket.tags, 'escalade-humain'])] } }) },
    3, 1000,
  )
  if (!res.ok) throw new Error(`[Zendesk] escalate write ${res.status}: ${await res.text()}`)
}

// Closes a ticket as solved without posting any public comment.
// Sets the required "Motif de contact" field to "autres" (field 20652537824913)
// to satisfy Zendesk's validation, and adds the "steero-archive" tag.
export async function archiveTicket(ticketId: number, brand: SavBrand = 'moom'): Promise<void> {
  const rf = zdConfig(brand).resolutionField
  const res = await fetchWithRetry(
    `${base(brand)}/tickets/${ticketId}.json`,
    {
      method: 'PUT',
      headers: authHeaders(brand),
      body: JSON.stringify({
        ticket: {
          status: 'solved',
          ...(rf ? { custom_fields: [{ id: rf.id, value: rf.value }] } : {}),
          tags_to_add: ['steero-archive'],
        },
      }),
    },
    4, 1000,
  )
  if (!res.ok) throw new Error(`[Zendesk] archiveTicket ${res.status}: ${await res.text()}`)
}

// ─── Conversation thread ──────────────────────────────────────────────────────

export interface ZendeskFileAttachment {
  id:           number
  file_name:    string
  content_url:  string
  content_type: string
  size:         number
}

export interface CommentItem {
  id:          number
  body:        string
  author_type: 'client' | 'agent'
  created_at:  string
  attachments: ZendeskFileAttachment[]
}

// Returns all public comments for a ticket, labelled client vs agent.
export async function getTicketComments(
  ticketId:    number,
  requesterId: number,
  brand: SavBrand = 'moom',
): Promise<CommentItem[]> {
  const url = `${base(brand)}/tickets/${ticketId}/comments.json`
  console.log(`[Zendesk] getTicketComments — fetching #${ticketId} (requesterId=${requesterId})`)

  // Use fetchWithRetry so 429s are handled with a minimum 1s delay
  const res = await fetchWithRetry(url, { headers: authHeaders(brand), cache: 'no-store' }, 3, 1000)

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
  const mapAttachments = (c: ZendeskComment): ZendeskFileAttachment[] => {
    const out: ZendeskFileAttachment[] = (c.attachments ?? []).map(a => ({
      id:           a.id,
      file_name:    a.file_name,
      content_url:  a.content_url,
      content_type: a.content_type,
      size:         a.size,
    }))
    // Images INLINE (photos envoyées par le client dans le corps du mail) : elles ne
    // figurent PAS dans attachments[] mais dans html_body sous forme d'URL Zendesk
    // /attachments/token/…. On les récupère pour les afficher comme pièces jointes.
    const seen = new Set(out.map(a => a.content_url))
    const html = c.html_body ?? ''
    const md   = c.body ?? ''
    const urls = new Set<string>()
    for (const m of html.matchAll(/<img[^>]+src="([^"]+)"/gi)) urls.add(m[1])
    for (const m of md.matchAll(/!\[[^\]]*\]\(([^)\s]+)/g)) urls.add(m[1])
    let idx = 0
    for (let u of urls) {
      u = u.replace(/&amp;/g, '&').replace(/[)\s]+$/, '')
      // On ne garde que les vraies pièces jointes Zendesk (pas les logos de signature CDN).
      if (!/\/attachments\/token\//.test(u)) continue
      if (seen.has(u)) continue
      seen.add(u)
      const nameMatch = u.match(/[?&]name=([^&]+)/)
      const fileName = nameMatch ? decodeURIComponent(nameMatch[1]) : `image-${++idx}.jpg`
      out.push({
        id:           c.id * 1000 + idx++,
        file_name:    fileName,
        content_url:  u,
        content_type: /\.(png|gif|webp)/i.test(fileName) ? `image/${fileName.split('.').pop()!.toLowerCase()}` : 'image/jpeg',
        size:         0,
      })
    }
    return out
  }

  if (requesterId) {
    return publicComments.map(c => ({
      id:          c.id,
      body:        c.body,
      author_type: c.author_id === requesterId ? 'client' : 'agent',
      created_at:  c.created_at,
      attachments: mapAttachments(c),
    }))
  }

  // Heuristic fallback: first comment = client, rest = agent
  return publicComments.map((c, i) => ({
    id:          c.id,
    body:        c.body,
    author_type: (i === 0 ? 'client' : 'agent') as 'client' | 'agent',
    created_at:  c.created_at,
    attachments: mapAttachments(c),
  }))
}

// ─── Previous ticket context ─────────────────────────────────────────────────
// When a client references a previous ticket (#XXXXX), fetch its subject and
// public comments so Claude can understand the full history before replying.

export async function fetchTicketContext(ticketId: number, brand: SavBrand = 'moom'): Promise<string | null> {
  // 1. Fetch ticket metadata
  const ticketRes = await fetch(
    `${base(brand)}/tickets/${ticketId}.json`,
    { headers: authHeaders(brand), cache: 'no-store' }
  ).catch(() => null)

  if (!ticketRes || !ticketRes.ok) {
    console.warn(`[Zendesk] fetchTicketContext #${ticketId} — ticket introuvable (${ticketRes?.status ?? 'network error'})`)
    return null
  }

  const { ticket } = await ticketRes.json() as { ticket: ZendeskTicket }

  // 2. Fetch public comments
  const commentsRes = await fetchWithRetry(
    `${base(brand)}/tickets/${ticketId}/comments.json`,
    { headers: authHeaders(brand), cache: 'no-store' },
    2,
    1000,
  ).catch(() => null)

  const publicComments: Array<{ author_id: number; body: string; created_at: string }> = []
  if (commentsRes?.ok) {
    const data = await commentsRes.json() as { comments?: ZendeskComment[] }
    publicComments.push(...(data.comments ?? []).filter(c => c.public))
  }

  // 3. Format as a readable context block
  const lines: string[] = [
    `Ticket #${ticketId} — "${ticket.subject}" (statut : ${ticket.status})`,
  ]

  if (publicComments.length > 0) {
    lines.push('Historique :')
    for (const c of publicComments) {
      const isRequester = c.author_id === ticket.requester_id
      const role = isRequester ? 'Client' : 'Agent'
      const date = new Date(c.created_at).toLocaleDateString('fr-FR', {
        day: 'numeric', month: 'short', year: 'numeric',
      })
      lines.push(`[${role} — ${date}] ${c.body.slice(0, 800).trim()}`)
    }
  } else {
    lines.push(`Description : ${ticket.description.slice(0, 800).trim()}`)
  }

  return lines.join('\n')
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
// Runs fn on all items in parallel batches of `concurrency` to respect rate limits.
async function withConcurrency<T, R>(
  items: T[],
  fn: (item: T) => Promise<R | null>,
  concurrency = 5
): Promise<R[]> {
  const results: R[] = []
  for (let i = 0; i < items.length; i += concurrency) {
    const batch = items.slice(i, i + concurrency)
    const settled = await Promise.allSettled(batch.map(fn))
    for (const r of settled) {
      if (r.status === 'fulfilled' && r.value !== null) results.push(r.value)
    }
    // Brief pause between batches to respect Zendesk rate limit (100 req/min)
    if (i + concurrency < items.length) await sleep(300)
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

// Same as fetchWithRetry but throws a special error on 429 instead of waiting.
// Used by the import cron so Vercel functions don't timeout waiting for rate limits.
export class ZendeskRateLimitError extends Error {
  retryAfterSeconds: number
  constructor(retryAfterSeconds = 60) {
    super('ZENDESK_RATE_LIMITED')
    this.retryAfterSeconds = retryAfterSeconds
  }
}

async function fetchNoWait429(url: string, opts: RequestInit): Promise<Response> {
  const res = await fetch(url, opts)
  if (res.status === 429) {
    const retryAfter = Number(res.headers.get('Retry-After') ?? 60)
    throw new ZendeskRateLimitError(retryAfter)
  }
  return res
}

async function fetchComments(ticketId: number, brand: SavBrand = 'moom'): Promise<ZendeskComment[]> {
  const res = await fetchNoWait429(
    `${base(brand)}/tickets/${ticketId}/comments.json`,
    { headers: authHeaders(brand), cache: 'no-store' }
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
  maxTickets = 25,
  resumeUrl?: string | null,
  brand: SavBrand = 'moom',
): Promise<{ examples: SolvedTicketData[]; nextCursor: string | null }> {
  // maxPages = how many Zendesk pages to fetch per call (each page ~100 tickets)
  // We take ALL solved tickets from each page — never skip any.
  const maxPages = maxTickets  // parameter is reused as page count
  let url: string | null = resumeUrl ??
    `${base(brand)}/incremental/tickets/cursor.json?start_time=1735689600&per_page=100`
  let nextCursor: string | null = null
  const allTickets: ZendeskTicket[] = []
  let pagesRead = 0

  // 1. Fetch up to maxPages pages, collect ALL solved/closed tickets from each
  while (url && pagesRead < maxPages) {
    const res = await fetchNoWait429(url, { headers: authHeaders(brand), cache: 'no-store' })
    if (!res.ok) throw new Error(`[Zendesk] exportSolvedTickets ${res.status}: ${await res.text()}`)
    const data = await res.json() as {
      tickets: ZendeskTicket[]
      after_cursor: string | null
      after_url: string | null
      end_of_stream: boolean
    }
    // Take ALL solved/closed from this page — no artificial limit
    const solved = (data.tickets ?? []).filter(t => t.status === 'solved' || t.status === 'closed')
    allTickets.push(...solved)
    nextCursor = data.end_of_stream ? null : (data.after_url ?? null)
    pagesRead++
    if (data.end_of_stream) break
    url = data.after_url ?? null
  }

  console.log(`[Zendesk] ${allTickets.length} tickets — récupération des commentaires…`)

  // 2. Fetch first agent comment for each ticket
  const examples = await withConcurrency(
    allTickets,
    async (ticket): Promise<SolvedTicketData | null> => {
      console.log(`  → #${ticket.id} ${ticket.subject.slice(0, 50)}`)
      const comments = await fetchComments(ticket.id, brand)

      const agentReply = comments.find(
        c => c.public && c.author_id !== ticket.requester_id && c.body?.trim().length > 20
      )
      if (!agentReply?.body?.trim()) return null

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

  return { examples, nextCursor }
}
