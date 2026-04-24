'use client'

import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import { createBrowserClient } from '@supabase/auth-helpers-nextjs'
import {
  RefreshCw, Send, Archive, Inbox, CheckCheck,
  ChevronDown, ChevronUp, Mail,
} from 'lucide-react'

// ─── Types ────────────────────────────────────────────────────────────────────

type KromCategory =
  | 'suivi_livraison' | 'retour_remboursement' | 'produit_defectueux'
  | 'modification_commande' | 'question_produit' | 'partenariat'
  | 'question_technique' | 'autre'

type ReplyAction = 'auto_reply' | 'escalate'

interface GmailAttachment {
  attachment_id: string
  message_id:    string
  filename:      string
  mime_type:     string
  size:          number
}

interface GmailMessage {
  message_id:   string
  thread_id:    string
  body:         string
  sender_email: string
  sender_name:  string
  received_at:  string
  is_client:    boolean
  attachments:  GmailAttachment[]
}

interface RawThread {
  thread_id:     string
  subject:       string
  sender_email:  string
  sender_name:   string
  body:          string
  received_at:   string
  message_count: number
}

interface ProcessedThread extends RawThread {
  category:           KromCategory
  action:             ReplyAction
  confidence:         number
  reason:             string
  draft_reply:        string
  solved:             boolean
  situation_detectee: string
  messages:           GmailMessage[]
}

// ─── Constants ────────────────────────────────────────────────────────────────

const CAT_LABELS: Record<KromCategory, string> = {
  suivi_livraison:       'Suivi livraison',
  retour_remboursement:  'Retour / Remb.',
  produit_defectueux:    'Produit défect.',
  modification_commande: 'Modif. commande',
  question_produit:      'Question produit',
  partenariat:           'Partenariat',
  question_technique:    'Question technique',
  autre:                 'Autre',
}

const CAT_COLORS: Record<KromCategory, { bg: string; text: string }> = {
  suivi_livraison:       { bg: '#e0f0ff', text: '#1565c0' },
  retour_remboursement:  { bg: '#fff3e0', text: '#e65100' },
  produit_defectueux:    { bg: '#fce8ea', text: '#c7293a' },
  modification_commande: { bg: '#ede7f6', text: '#4527a0' },
  question_produit:      { bg: '#e0f7fa', text: '#00695c' },
  partenariat:           { bg: '#fdf4ff', text: '#7e22ce' },
  question_technique:    { bg: '#e8f5e9', text: '#1b5e20' },
  autre:                 { bg: '#f3f3f1', text: '#6b6b63' },
}

function catBadge(cat: KromCategory) {
  const { bg, text } = CAT_COLORS[cat]
  return (
    <span className="inline-flex px-2 py-0.5 rounded-full text-[10px] font-semibold shrink-0" style={{ backgroundColor: bg, color: text }}>
      {CAT_LABELS[cat]}
    </span>
  )
}

function fmtTime(iso: string) {
  const d = new Date(iso), now = new Date()
  const sameDay = d.toDateString() === now.toDateString()
  return sameDay
    ? d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })
    : d.toLocaleDateString('fr-FR', { day: '2-digit', month: 'short' })
}

// ─── Thread row (left column) ─────────────────────────────────────────────────

function ThreadRow({ raw, processed, selected, isProcessing, doneAction, onClick }: {
  raw:         RawThread
  processed?:  ProcessedThread
  selected:    boolean
  isProcessing?: boolean
  doneAction?: string
  onClick:     () => void
}) {
  return (
    <button
      onClick={onClick}
      className={`w-full text-left px-4 py-3 border-b border-[#f0efec] transition-colors ${
        selected ? 'bg-[#eeedf0]' : 'hover:bg-[#f5f4f2]'
      }`}
    >
      <div className="flex items-start justify-between gap-2">
        <p className="text-[11px] font-semibold text-[#1a1a2e] truncate leading-snug">
          {raw.sender_name || raw.sender_email.split('@')[0]}
        </p>
        <span className="text-[10px] text-[#aeb0c9] shrink-0 mt-0.5">{fmtTime(raw.received_at)}</span>
      </div>
      <p className="text-[10px] text-[#6b6b63] truncate mt-0.5">{raw.subject}</p>
      {isProcessing && (
        <span className="inline-flex items-center gap-1 text-[10px] text-[#aeb0c9] mt-1">
          <RefreshCw size={10} className="animate-spin" /> Analyse…
        </span>
      )}
      {processed && !isProcessing && (
        <div className="mt-1.5 flex items-center gap-1.5 flex-wrap">
          {catBadge(processed.category)}
          {doneAction === 'sent' && (
            <span className="text-[10px] text-[#1a7f4b] font-semibold">✓ Envoyé</span>
          )}
          {doneAction === 'archived' && (
            <span className="text-[10px] text-[#9b9b93] font-semibold">Archivé</span>
          )}
        </div>
      )}
    </button>
  )
}

// ─── Right panel — reply panel ────────────────────────────────────────────────

function ReplyPanel({ thread, draft, onDraftChange, onSent, onArchive }: {
  thread:         ProcessedThread
  draft:          string
  onDraftChange:  (v: string) => void
  onSent:         (wasModified: boolean) => void
  onArchive:      () => void
}) {
  const [sending, setSending]       = useState(false)
  const [archiving, setArchiving]   = useState(false)
  const [error, setError]           = useState<string | null>(null)
  const [showReason, setShowReason] = useState(false)
  const startTime = useRef(Date.now())

  async function send() {
    setSending(true); setError(null)
    const wasModified = draft.trim() !== thread.draft_reply.trim()
    try {
      const res = await fetch('/api/sav-krom/send', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          thread_id:         thread.thread_id,
          to_email:          thread.sender_email,
          subject:           thread.subject,
          reply_body:        draft,
          was_modified:      wasModified,
          category:          thread.category,
          confidence:        thread.confidence,
          time_to_action_ms: Date.now() - startTime.current,
        }),
      })
      if (!res.ok) { const d = await res.json(); throw new Error(d.error ?? `HTTP ${res.status}`) }
      onSent(wasModified)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erreur inconnue')
    } finally { setSending(false) }
  }

  async function doArchive() {
    setArchiving(true); setError(null)
    try {
      const res = await fetch('/api/sav-krom/archive', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          thread_id:         thread.thread_id,
          category:          thread.category,
          confidence:        thread.confidence,
          time_to_action_ms: Date.now() - startTime.current,
        }),
      })
      if (!res.ok) { const d = await res.json(); throw new Error(d.error ?? `HTTP ${res.status}`) }
      onArchive()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erreur inconnue')
    } finally { setArchiving(false) }
  }

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Header */}
      <div className="px-5 py-4 border-b border-[#e8e8e4] shrink-0 space-y-2">
        <div className="flex items-center justify-between gap-2">
          <p className="text-[10px] font-semibold uppercase tracking-[0.1em] text-[#aeb0c9]">Réponse Claude</p>
          <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${
            thread.confidence >= 0.85 ? 'bg-[#dcf5e7] text-[#1a7f4b]'
            : thread.confidence >= 0.6  ? 'bg-[#fef3c7] text-[#b45309]'
            : 'bg-[#fce8ea] text-[#c7293a]'
          }`}>
            {Math.round(thread.confidence * 100)}% confiance
          </span>
        </div>

        {/* Situation détectée */}
        {thread.situation_detectee && (
          <div className="flex gap-2 items-start px-3 py-2 rounded-lg bg-[#f0f4ff] border border-[#c7d2fe]">
            <span className="text-[10px] shrink-0 mt-px">🎯</span>
            <p className="text-[11px] text-[#3730a3] leading-snug font-medium">{thread.situation_detectee}</p>
          </div>
        )}

        <button
          onClick={() => setShowReason(v => !v)}
          className="flex items-center gap-1 text-[10px] text-[#9b9b93] hover:text-[#6b6b63] transition-colors"
        >
          {showReason ? <ChevronUp size={11} /> : <ChevronDown size={11} />}
          Justification
        </button>
        {showReason && (
          <p className="text-[11px] text-[#6b6b63] bg-[#f8f7f5] rounded-lg px-3 py-2 leading-relaxed">
            {thread.reason}
          </p>
        )}
      </div>

      {/* Textarea */}
      <div className="flex-1 overflow-hidden px-5 py-4">
        <textarea
          value={draft}
          onChange={e => onDraftChange(e.target.value)}
          className="w-full h-full text-xs text-[#1a1a2e] bg-[#f8f7f5] rounded-xl px-3 py-3 leading-relaxed resize-none border border-transparent focus:border-[#aeb0c9] focus:outline-none transition-colors font-[inherit]"
        />
      </div>

      {/* Footer */}
      <div className="px-5 pb-5 shrink-0 space-y-3">
        {error && <p className="text-[11px] text-[#c7293a] bg-[#fce8ea] rounded-lg px-3 py-2">{error}</p>}
        <button
          onClick={send} disabled={sending || archiving}
          className="w-full flex items-center justify-center gap-1.5 py-2.5 rounded-xl bg-[#1a1a2e] text-white text-xs font-semibold hover:bg-[#2a2a4e] transition-colors disabled:opacity-50"
        >
          {sending ? <RefreshCw size={13} className="animate-spin" /> : <Send size={13} strokeWidth={1.8} />}
          {sending ? 'Envoi…' : 'Envoyer par email'}
        </button>
        <button
          onClick={doArchive} disabled={sending || archiving}
          className="w-full flex items-center justify-center gap-1.5 py-2 rounded-xl border border-[#e8e8e4] text-[#9b9b93] text-xs font-medium hover:bg-[#f8f7f5] hover:text-[#6b6b63] transition-colors disabled:opacity-50"
        >
          {archiving ? <RefreshCw size={12} className="animate-spin" /> : <Archive size={12} strokeWidth={1.8} />}
          {archiving ? 'Archivage…' : 'Archiver sans répondre'}
        </button>
      </div>
    </div>
  )
}

// ─── Attachment renderer ──────────────────────────────────────────────────────

function AttachmentBadge({ att }: { att: GmailAttachment }) {
  const url = `/api/sav-krom/attachment?message_id=${encodeURIComponent(att.message_id)}&attachment_id=${encodeURIComponent(att.attachment_id)}&mime_type=${encodeURIComponent(att.mime_type)}`
  const isImage = att.mime_type.startsWith('image/')

  if (isImage) {
    return (
      <a href={url} target="_blank" rel="noopener noreferrer" className="block mt-2">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={url} alt={att.filename} className="max-w-full max-h-64 rounded-lg border border-[#e8e8e4] object-contain" />
      </a>
    )
  }

  return (
    <a
      href={url} target="_blank" rel="noopener noreferrer" download={att.filename}
      className="inline-flex items-center gap-1.5 mt-2 px-3 py-1.5 rounded-lg border border-[#e8e8e4] bg-white text-[11px] text-[#1a1a2e] font-medium hover:bg-[#f8f7f5] transition-colors"
    >
      📎 {att.filename}
      {att.size > 0 && <span className="text-[#aeb0c9]">({Math.round(att.size / 1024)} Ko)</span>}
    </a>
  )
}

// ─── Center — thread detail ───────────────────────────────────────────────────

function ThreadDetail({ thread }: { thread: ProcessedThread }) {
  const messages = thread.messages ?? []

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <div className="px-6 py-4 border-b border-[#e8e8e4] shrink-0">
        <div className="flex items-center gap-2 mb-1">
          <Mail size={12} strokeWidth={1.8} className="text-[#aeb0c9]" />
          <p className="text-[10px] font-semibold uppercase tracking-[0.1em] text-[#aeb0c9]">Gmail · Krom Water</p>
        </div>
        <h2 className="text-base font-semibold text-[#1a1a2e] leading-snug mb-2">{thread.subject}</h2>
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-xs text-[#6b6b63]">{thread.sender_email}</span>
          <span className="text-[#d0cfc9]">·</span>
          {catBadge(thread.category)}
          {thread.action === 'auto_reply'
            ? <span className="inline-flex px-2 py-0.5 rounded-full text-[10px] font-semibold bg-[#dcf5e7] text-[#1a7f4b]">Réponse auto</span>
            : <span className="inline-flex px-2 py-0.5 rounded-full text-[10px] font-semibold bg-[#fef3c7] text-[#b45309]">À escalader</span>
          }
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-6 py-5 space-y-3">
        {messages.length === 0 ? (
          <div className="rounded-xl px-4 py-3 border-l-[3px] bg-[#f8f7f5] border-[#e0cfc9]">
            <p className="text-xs text-[#1a1a2e] leading-relaxed whitespace-pre-wrap break-words">{thread.body}</p>
          </div>
        ) : messages.map((msg, i) => {
          const isClient = msg.is_client
          return (
            <div
              key={msg.message_id || i}
              className={`rounded-xl px-4 py-3 border-l-[3px] ${
                isClient
                  ? 'bg-[#f8f7f5] border-[#e0cfc9]'
                  : 'bg-[#f0f4ff] border-[#c7d2fe]'
              }`}
            >
              <div className="flex items-center justify-between gap-2 mb-1.5">
                <span className={`text-[10px] font-bold uppercase tracking-[0.08em] ${isClient ? 'text-[#b45309]' : 'text-[#3730a3]'}`}>
                  {isClient ? (msg.sender_name || msg.sender_email.split('@')[0]) : 'Krom Water'}
                </span>
                <span className="text-[10px] text-[#aeb0c9]">{fmtTime(msg.received_at)}</span>
              </div>
              <p className="text-xs text-[#1a1a2e] leading-relaxed whitespace-pre-wrap break-words">{msg.body}</p>
              {msg.attachments?.map(att => (
                <AttachmentBadge key={att.attachment_id} att={att} />
              ))}
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function SavKromPage() {
  const [mounted, setMounted] = useState(false)
  useEffect(() => setMounted(true), [])

  const [threads, setThreads]           = useState<RawThread[]>([])
  const [processedCache, setProcessedCache] = useState<Record<string, ProcessedThread>>({})
  const [selectedId, setSelectedId]     = useState<string | null>(null)
  const [processingId, setProcessingId] = useState<string | null>(null)
  const [listLoading, setListLoading]   = useState(true)
  const [doneStatuses, setDoneStatuses] = useState<Record<string, 'sent' | 'archived'>>({})
  const [drafts, setDrafts]             = useState<Record<string, string>>({})
  const [tab, setTab]                   = useState<'pending' | 'done'>('pending')
  const fetchingRef = useRef<Set<string>>(new Set())
  const ticketStartTimes = useRef<Record<string, number>>({})

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const supabase = useMemo(() => createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  ), [])

  // ── Load thread list ────────────────────────────────────────────────────
  const load = useCallback(async () => {
    setListLoading(true)
    try {
      const res  = await fetch('/api/sav-krom/emails')
      const data = await res.json() as { threads?: RawThread[]; error?: string }
      if (!res.ok || !Array.isArray(data.threads)) {
        console.error('[SAV-Krom] emails API error:', data.error)
        return
      }
      setThreads(data.threads)
      // Auto-select first thread on first load
      if (data.threads.length > 0 && selectedId === null) {
        const first = data.threads[0]
        setSelectedId(first.thread_id)
        processThread(first)
      }
    } finally { setListLoading(false) }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => { load() }, [load])

  // ── Access control — redirect if not allowed ────────────────────────────
  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      const brands = data.user?.user_metadata?.brands as string[] | undefined
      // If brands is set and doesn't include 'krom', redirect to dashboard
      if (brands && !brands.includes('krom')) {
        window.location.href = '/dashboard?error=unauthorized'
      }
    })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ── Process one thread (AI) ─────────────────────────────────────────────
  async function processThread(raw: RawThread) {
    if (fetchingRef.current.has(raw.thread_id)) return
    fetchingRef.current.add(raw.thread_id)
    setProcessingId(raw.thread_id)
    try {
      const res = await fetch('/api/sav-krom/process', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(raw),
      })
      const thread = await res.json() as ProcessedThread & { error?: string }
      if (!res.ok) { console.error('[SAV-Krom] process error:', thread.error); return }
      setProcessedCache(prev => ({ ...prev, [raw.thread_id]: thread }))
      setDrafts(prev => {
        if (raw.thread_id in prev) return prev
        return { ...prev, [raw.thread_id]: thread.draft_reply }
      })
    } catch (err) {
      console.error('[SAV-Krom] processThread error:', err)
    } finally {
      fetchingRef.current.delete(raw.thread_id)
      setProcessingId(prev => prev === raw.thread_id ? null : prev)
    }
  }

  function handleThreadClick(raw: RawThread) {
    setSelectedId(raw.thread_id)
    if (!ticketStartTimes.current[raw.thread_id]) {
      ticketStartTimes.current[raw.thread_id] = Date.now()
    }
    if (!processedCache[raw.thread_id]) processThread(raw)
  }

  function advanceSelection(excludeId: string, doneAfter: Record<string, string>) {
    const remaining = threads.filter(t => !doneAfter[t.thread_id] && t.thread_id !== excludeId)
    setSelectedId(remaining[0]?.thread_id ?? null)
    if (remaining[0]) processThread(remaining[0])
  }

  function handleSent(wasModified: boolean) {
    if (!selectedId) return
    void wasModified
    const doneAfter = { ...doneStatuses, [selectedId]: 'sent' as const }
    setDoneStatuses(doneAfter)
    advanceSelection(selectedId, doneAfter)
  }

  function handleArchive() {
    if (!selectedId) return
    const doneAfter = { ...doneStatuses, [selectedId]: 'archived' as const }
    setDoneStatuses(doneAfter)
    advanceSelection(selectedId, doneAfter)
  }

  const pending  = threads.filter(t => !doneStatuses[t.thread_id])
  const done     = threads.filter(t =>  doneStatuses[t.thread_id])
  const selected = selectedId ? (processedCache[selectedId] ?? null) : null
  const isProcessing = processingId === selectedId && selectedId !== null

  if (!mounted) return null

  return (
    <div className="h-screen overflow-hidden flex relative">

      {/* ── LEFT — thread list ── */}
      <div className="w-[280px] shrink-0 flex flex-col border-r border-[#e8e8e4] bg-[#f8f7f5] overflow-hidden">
        <div className="px-4 pt-4 border-b border-[#eeede9] shrink-0">
          <div className="flex items-center justify-between mb-3">
            <div>
              <p className="text-[9px] font-semibold uppercase tracking-[0.12em] text-[#aeb0c9]">Krom Water</p>
              <div className="flex items-center gap-1.5 mt-0.5">
                <p className="text-sm font-bold text-[#1a1a2e]">SAV</p>
                <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-[#e8f5e9] text-[#1b5e20] text-[9px] font-semibold">
                  <Mail size={9} strokeWidth={2} /> Gmail
                </span>
              </div>
            </div>
            <button
              onClick={load} disabled={listLoading}
              className="w-7 h-7 rounded-lg flex items-center justify-center text-[#6b6b63] hover:bg-[#eeede9] transition-colors disabled:opacity-40"
              title="Actualiser"
            >
              <RefreshCw size={13} strokeWidth={1.8} className={listLoading ? 'animate-spin' : ''} />
            </button>
          </div>

          {/* Tabs */}
          <div className="flex">
            <button
              onClick={() => setTab('pending')}
              className={`flex-1 flex items-center justify-center gap-1.5 py-2 text-[11px] font-semibold border-b-2 transition-colors ${
                tab === 'pending' ? 'border-[#1a1a2e] text-[#1a1a2e]' : 'border-transparent text-[#9b9b93] hover:text-[#6b6b63]'
              }`}
            >
              En attente
              {!listLoading && (
                <span className={`inline-flex items-center justify-center min-w-[16px] h-4 px-1 rounded-full text-[9px] font-bold ${
                  pending.length > 0 ? 'bg-[#c7293a] text-white' : 'bg-[#e0e0da] text-[#9b9b93]'
                }`}>
                  {pending.length}
                </span>
              )}
            </button>
            <button
              onClick={() => setTab('done')}
              className={`flex-1 flex items-center justify-center gap-1.5 py-2 text-[11px] font-semibold border-b-2 transition-colors ${
                tab === 'done' ? 'border-[#1a1a2e] text-[#1a1a2e]' : 'border-transparent text-[#9b9b93] hover:text-[#6b6b63]'
              }`}
            >
              Traités
              {done.length > 0 && (
                <span className="inline-flex items-center justify-center min-w-[16px] h-4 px-1 rounded-full text-[9px] font-bold bg-[#e0e0da] text-[#6b6b63]">
                  {done.length}
                </span>
              )}
            </button>
          </div>
        </div>

        {/* Thread list */}
        <div className="flex-1 overflow-y-auto">
          {listLoading && (
            <div className="p-4 space-y-3">
              {[1,2,3].map(i => (
                <div key={i} className="space-y-1.5">
                  <div className="h-3 w-3/4 bg-[#e8e8e4] rounded-full animate-pulse" />
                  <div className="h-2.5 w-1/2 bg-[#e8e8e4] rounded-full animate-pulse" />
                </div>
              ))}
            </div>
          )}

          {!listLoading && tab === 'pending' && (
            <>
              {pending.length === 0 && (
                <div className="flex flex-col items-center justify-center h-full gap-2 p-4 text-center">
                  <CheckCheck size={24} strokeWidth={1.4} className="text-[#1a7f4b]" />
                  <p className="text-xs text-[#9b9b93]">Boîte vide</p>
                </div>
              )}
              {pending.map(t => (
                <ThreadRow
                  key={t.thread_id}
                  raw={t}
                  processed={processedCache[t.thread_id]}
                  selected={t.thread_id === selectedId}
                  isProcessing={processingId === t.thread_id}
                  doneAction={doneStatuses[t.thread_id]}
                  onClick={() => handleThreadClick(t)}
                />
              ))}
            </>
          )}

          {!listLoading && tab === 'done' && (
            <>
              {done.length === 0 && (
                <div className="flex flex-col items-center justify-center h-full gap-2 p-4 text-center">
                  <Inbox size={24} strokeWidth={1.4} className="text-[#d0cfc9]" />
                  <p className="text-xs text-[#9b9b93]">Aucun email traité</p>
                </div>
              )}
              {done.map(t => (
                <ThreadRow
                  key={t.thread_id}
                  raw={t}
                  processed={processedCache[t.thread_id]}
                  selected={t.thread_id === selectedId}
                  doneAction={doneStatuses[t.thread_id]}
                  onClick={() => handleThreadClick(t)}
                />
              ))}
            </>
          )}
        </div>
      </div>

      {/* ── CENTER — thread detail ── */}
      <div className="flex-1 flex flex-col overflow-hidden border-r border-[#e8e8e4] bg-white">
        {!selectedId ? (
          <div className="flex flex-col items-center justify-center h-full gap-3 text-center p-6">
            <Mail size={28} strokeWidth={1.4} className="text-[#d0cfc9]" />
            <p className="text-sm text-[#9b9b93]">Sélectionnez un email</p>
          </div>
        ) : isProcessing && !selected ? (
          <div className="flex items-center justify-center h-full gap-2 text-[#aeb0c9]">
            <RefreshCw size={16} className="animate-spin" />
            <span className="text-sm">Analyse en cours…</span>
          </div>
        ) : selected ? (
          <ThreadDetail thread={selected} />
        ) : null}
      </div>

      {/* ── RIGHT — reply panel ── */}
      <div className="w-[380px] shrink-0 flex flex-col overflow-hidden bg-[#fafaf9]">
        {!selectedId ? (
          <div className="flex items-center justify-center h-full">
            <p className="text-xs text-[#9b9b93]">Aucun email sélectionné</p>
          </div>
        ) : isProcessing && !selected ? (
          <div className="flex items-center justify-center h-full">
            <RefreshCw size={14} className="animate-spin text-[#aeb0c9]" />
          </div>
        ) : selected ? (
          <ReplyPanel
            thread={selected}
            draft={drafts[selected.thread_id] ?? ''}
            onDraftChange={v => setDrafts(prev => ({ ...prev, [selected.thread_id]: v }))}
            onSent={handleSent}
            onArchive={handleArchive}
          />
        ) : null}
      </div>
    </div>
  )
}
