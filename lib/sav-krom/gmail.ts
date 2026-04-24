// ─── Gmail client — Krom Water SAV ───────────────────────────────────────────
// Auth : OAuth2 avec refresh token long-lived (pas de serveur d'auth nécessaire).
//
// Variables d'environnement requises :
//   KROM_GMAIL_CLIENT_ID        — OAuth2 Client ID (Google Cloud Console)
//   KROM_GMAIL_CLIENT_SECRET    — OAuth2 Client Secret
//   KROM_GMAIL_REFRESH_TOKEN    — Refresh token (voir README ci-dessous)
//
// ─── Obtenir le refresh token ─────────────────────────────────────────────────
// 1. Google Cloud Console → Credentials → Create OAuth 2.0 Client ID (Desktop app)
// 2. Télécharger le JSON credentials
// 3. Lancer le script OAuth playground ou utiliser :
//    npx ts-node scripts/gmail-auth.ts
//    (voir lib/sav-krom/README-oauth.md pour le script complet)
// 4. Copier le refresh_token dans les env vars Vercel

import { google } from 'googleapis'

function getOAuth2Client() {
  const oauth2 = new google.auth.OAuth2(
    process.env.KROM_GMAIL_CLIENT_ID,
    process.env.KROM_GMAIL_CLIENT_SECRET,
  )
  oauth2.setCredentials({
    refresh_token: process.env.KROM_GMAIL_REFRESH_TOKEN,
  })
  return oauth2
}

function getGmail() {
  return google.gmail({ version: 'v1', auth: getOAuth2Client() })
}

// ─── Types ────────────────────────────────────────────────────────────────────

export interface GmailThread {
  thread_id:    string
  subject:      string
  sender_email: string
  sender_name:  string
  body:         string          // texte du dernier message du thread
  received_at:  string          // ISO date du dernier message
  message_count: number
  is_unread:    boolean
}

export interface GmailMessage {
  message_id:   string
  thread_id:    string
  body:         string
  sender_email: string
  sender_name:  string
  received_at:  string
  is_client:    boolean         // true si expéditeur ≠ hello@krom-water.com
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function headerVal(headers: Array<{ name?: string | null; value?: string | null }>, name: string): string {
  return headers.find(h => h.name?.toLowerCase() === name.toLowerCase())?.value ?? ''
}

function parseEmailAddress(raw: string): { name: string; email: string } {
  const match = raw.match(/^(.*?)\s*<([^>]+)>$/)
  if (match) return { name: match[1].trim().replace(/^"|"$/g, ''), email: match[2].toLowerCase() }
  return { name: '', email: raw.toLowerCase().trim() }
}

function decodeBody(data?: string): string {
  if (!data) return ''
  // Gmail base64url → UTF-8
  const base64 = data.replace(/-/g, '+').replace(/_/g, '/')
  try {
    return Buffer.from(base64, 'base64').toString('utf-8')
  } catch {
    return ''
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function extractTextFromPayload(payload: any): string {
  if (!payload) return ''

  // Plain text part — preferred
  if (payload.mimeType === 'text/plain' && payload.body?.data) {
    return decodeBody(payload.body.data)
  }

  // Multipart: recurse into parts, prefer text/plain
  if (payload.parts) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const plain = payload.parts.find((p: any) => p.mimeType === 'text/plain')
    if (plain) return extractTextFromPayload(plain)

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const html = payload.parts.find((p: any) => p.mimeType === 'text/html')
    if (html) {
      // Strip basic HTML tags for a readable preview
      const raw = extractTextFromPayload(html)
      return raw.replace(/<[^>]+>/g, ' ').replace(/\s{2,}/g, '\n').trim()
    }

    // Recurse into all parts
    for (const part of payload.parts) {
      const text = extractTextFromPayload(part)
      if (text) return text
    }
  }

  return decodeBody(payload.body?.data ?? undefined)
}

// Remove quoted reply lines (lines starting with ">") and Gmail's "On ... wrote:" headers
function stripQuotedReply(text: string): string {
  return text
    .split('\n')
    .filter(line => !line.startsWith('>') && !/^On .+wrote:$/.test(line.trim()))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

// ─── List unread threads ──────────────────────────────────────────────────────
// Returns threads with unread messages in the inbox, newest first.
// Excludes threads that match 'sent' label (our own outgoing).

export async function getUnreadThreads(): Promise<GmailThread[]> {
  const gmail = getGmail()

  // List all inbox threads (not archived) — processed filtering is done via DB
  const listRes = await gmail.users.threads.list({
    userId: 'me',
    q: 'in:inbox',
    maxResults: 50,
  })

  const threads = listRes.data.threads ?? []
  if (threads.length === 0) return []

  // Fetch each thread in parallel (max 8 concurrent)
  const BATCH = 8
  const results: GmailThread[] = []

  for (let i = 0; i < threads.length; i += BATCH) {
    const batch = threads.slice(i, i + BATCH)
    const fetched = await Promise.allSettled(
      batch.map(t => fetchThread(t.id!))
    )
    for (const r of fetched) {
      if (r.status === 'fulfilled' && r.value) results.push(r.value)
    }
  }

  // Sort newest first
  results.sort((a, b) => new Date(b.received_at).getTime() - new Date(a.received_at).getTime())
  return results
}

async function fetchThread(threadId: string): Promise<GmailThread | null> {
  const gmail = getGmail()
  const res = await gmail.users.threads.get({
    userId: 'me',
    id: threadId,
    format: 'full',
  })

  const messages = res.data.messages ?? []
  if (messages.length === 0) return null

  // Last message in thread
  const last = messages[messages.length - 1]
  const headers = last.payload?.headers ?? []

  const subject      = headerVal(headers, 'Subject') || '(sans objet)'
  const fromRaw      = headerVal(headers, 'From')
  const { name: senderName, email: senderEmail } = parseEmailAddress(fromRaw)
  const dateStr      = headerVal(headers, 'Date')
  const received_at  = dateStr ? new Date(dateStr).toISOString() : new Date().toISOString()
  const body         = stripQuotedReply(extractTextFromPayload(last.payload ?? {}))

  const labelIds = last.labelIds ?? []
  const is_unread = labelIds.includes('UNREAD')

  return {
    thread_id:     threadId,
    subject:       subject.replace(/^(Re:\s*)+/i, '').trim(),
    sender_email:  senderEmail,
    sender_name:   senderName,
    body,
    received_at,
    message_count: messages.length,
    is_unread,
  }
}

// ─── Get full thread messages ─────────────────────────────────────────────────

export async function getThreadMessages(threadId: string): Promise<GmailMessage[]> {
  const gmail = getGmail()
  const res = await gmail.users.threads.get({
    userId: 'me',
    id: threadId,
    format: 'full',
  })

  const KROM_EMAIL = 'hello@krom-water.com'
  return (res.data.messages ?? []).map(msg => {
    const headers    = msg.payload?.headers ?? []
    const fromRaw    = headerVal(headers, 'From')
    const { name, email } = parseEmailAddress(fromRaw)
    const dateStr    = headerVal(headers, 'Date')
    const body       = stripQuotedReply(extractTextFromPayload(msg.payload ?? {}))
    return {
      message_id:   msg.id ?? '',
      thread_id:    threadId,
      body,
      sender_email: email,
      sender_name:  name,
      received_at:  dateStr ? new Date(dateStr).toISOString() : new Date().toISOString(),
      is_client:    email !== KROM_EMAIL,
    }
  })
}

// ─── Send reply in thread ─────────────────────────────────────────────────────
// Sends a reply in the same Gmail thread, preserving the conversation.

export async function sendReply(
  threadId:    string,
  toEmail:     string,
  subject:     string,
  body:        string,
): Promise<void> {
  const gmail = getGmail()

  // Build RFC 2822 message
  const replySubject = subject.startsWith('Re:') ? subject : `Re: ${subject}`
  const raw = [
    `From: Krom Water <hello@krom-water.com>`,
    `To: ${toEmail}`,
    `Subject: ${replySubject}`,
    `Content-Type: text/plain; charset=utf-8`,
    `MIME-Version: 1.0`,
    '',
    body,
  ].join('\r\n')

  const encoded = Buffer.from(raw).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')

  await gmail.users.messages.send({
    userId: 'me',
    requestBody: {
      raw:      encoded,
      threadId: threadId,
    },
  })
}

// ─── Mark thread as read ──────────────────────────────────────────────────────

export async function markThreadRead(threadId: string): Promise<void> {
  const gmail = getGmail()
  await gmail.users.threads.modify({
    userId: 'me',
    id:     threadId,
    requestBody: { removeLabelIds: ['UNREAD'] },
  })
}

// ─── Archive thread (remove from inbox) ──────────────────────────────────────

export async function archiveThread(threadId: string): Promise<void> {
  const gmail = getGmail()
  await gmail.users.threads.modify({
    userId: 'me',
    id:     threadId,
    requestBody: { removeLabelIds: ['INBOX', 'UNREAD'] },
  })
}
