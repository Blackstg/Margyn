// ─── SAV Orchestrator — Krom Water ───────────────────────────────────────────
// Gmail-based, semi-auto mode (classify + draft, human validates before send).

import { getUnreadThreads, getThreadMessages, sendReply, markThreadRead, archiveThread, GmailMessage } from './gmail'
import { classifyEmail, generateReply } from './classifier'
import type { KromCategory, ReplyAction } from './classifier'
import { createAdminClient } from '@/lib/supabase'

// ─── Types ────────────────────────────────────────────────────────────────────

export interface RawEmailThread {
  thread_id:    string
  subject:      string
  sender_email: string
  sender_name:  string
  body:         string
  received_at:  string
  message_count: number
}

export interface ProcessedThread {
  thread_id:          string
  subject:            string
  sender_email:       string
  sender_name:        string
  body:               string
  received_at:        string
  message_count:      number
  category:           KromCategory
  action:             ReplyAction
  confidence:         number
  reason:             string
  draft_reply:        string
  solved:             boolean
  situation_detectee: string
  messages:           GmailMessage[]
}

// ─── Processed threads tracking ──────────────────────────────────────────────

async function getProcessedMap(): Promise<Map<string, string>> {
  try {
    const sb = createAdminClient()
    const { data, error } = await sb
      .from('sav_krom_processed')
      .select('thread_id, processed_at')
    if (error) return new Map()
    const map = new Map<string, string>()
    for (const r of (data as { thread_id: string; processed_at: string | null }[])) {
      map.set(r.thread_id, r.processed_at ?? new Date().toISOString())
    }
    return map
  } catch {
    return new Map()
  }
}

export async function markThreadProcessed(
  threadId: string,
  action:   'sent' | 'archived',
): Promise<void> {
  try {
    const sb = createAdminClient()
    await sb.from('sav_krom_processed').upsert(
      { thread_id: threadId, action, processed_at: new Date().toISOString() },
      { onConflict: 'thread_id' }
    )
  } catch (err) {
    console.error('[SAV-Krom] markThreadProcessed error:', err)
  }
}

// ─── Raw thread list (fast, no AI) ───────────────────────────────────────────

export async function getRawThreadList(): Promise<RawEmailThread[]> {
  const [threads, processedMap] = await Promise.all([getUnreadThreads(), getProcessedMap()])

  // Re-show a thread if it received a new message after our last action
  // (client replied to our response — needs attention again)
  const fresh = threads.filter(t => {
    const processedAt = processedMap.get(t.thread_id)
    if (!processedAt) return true
    return new Date(t.received_at) > new Date(processedAt)
  })

  console.log(
    `[SAV-Krom] getRawThreadList: ${threads.length} Gmail, ${processedMap.size} traités, ${fresh.length} à afficher`
  )

  return fresh.map(t => ({
    thread_id:     t.thread_id,
    subject:       t.subject,
    sender_email:  t.sender_email,
    sender_name:   t.sender_name,
    body:          t.body,
    received_at:   t.received_at,
    message_count: t.message_count,
  }))
}

// ─── Process one thread (classify + generate draft) ───────────────────────────

export async function processOneThread(
  threadId:    string,
  subject:     string,
  body:        string,
  senderEmail: string,
  senderName:  string,
  receivedAt:  string,
  messageCount: number,
): Promise<ProcessedThread> {
  // Fetch full thread messages for context
  const messages = await getThreadMessages(threadId).catch(() => [])
  console.log(`[SAV-Krom] processOneThread ${threadId} — ${messages.length} message(s)`)

  // Last client message body for classification
  const lastClientBody = (() => {
    const clientMsgs = messages.filter(m => m.is_client)
    return clientMsgs[clientMsgs.length - 1]?.body ?? body
  })()

  // Classify first, then generate reply with the correct category
  const classification = await classifyEmail(subject, lastClientBody)
  const finalReply     = await generateReply(subject, body, classification.category, senderEmail, messages)

  return {
    thread_id:          threadId,
    subject,
    sender_email:       senderEmail,
    sender_name:        senderName,
    body,
    received_at:        receivedAt,
    message_count:      messageCount,
    category:           classification.category,
    action:             classification.action,
    confidence:         classification.confidence,
    reason:             classification.reason,
    draft_reply:        finalReply.body,
    solved:             finalReply.solved,
    situation_detectee: finalReply.situation_detectee,
    messages,
  }
}

// ─── Send validated reply ─────────────────────────────────────────────────────

export async function sendValidatedReply(
  threadId:    string,
  toEmail:     string,
  subject:     string,
  replyBody:   string,
): Promise<void> {
  await sendReply(threadId, toEmail, subject, replyBody)
  await markThreadRead(threadId)
}

// ─── Log action ───────────────────────────────────────────────────────────────

export async function logKromAction(payload: {
  thread_id:         string
  action:            'sent' | 'archived'
  was_modified?:     boolean | null
  category?:         string | null
  confidence?:       number | null
  time_to_action_ms?: number | null
}): Promise<void> {
  try {
    const sb = createAdminClient()
    await sb.from('sav_krom_actions').insert(payload)
  } catch (err) {
    console.warn('[SAV-Krom] logKromAction error:', err)
  }
}

export { archiveThread, markThreadRead }
