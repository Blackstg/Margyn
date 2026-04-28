'use client'

import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import { createBrowserClient } from '@supabase/auth-helpers-nextjs'
import {
  RefreshCw, Send, Archive, Inbox, CheckCheck,
  ChevronDown, ChevronUp, Mail, Settings, X, Trash2,
} from 'lucide-react'

// ─── Types ────────────────────────────────────────────────────────────────────

type KromCategory =
  | 'suivi_livraison' | 'retour_remboursement' | 'produit_defectueux'
  | 'modification_commande' | 'question_produit' | 'partenariat'
  | 'question_technique' | 'autre'

type ReplyAction = 'auto_reply' | 'escalate'

interface DecisionOption {
  key:   string
  emoji: string
  label: string
}

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
  needs_decision?:    boolean
  decision_options?:  DecisionOption[]
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

// ─── Rules panel ─────────────────────────────────────────────────────────────

function RulesPanel({ onClose }: { onClose: () => void }) {
  const [rules, setRules]     = useState<string[]>([])
  const [loading, setLoading] = useState(true)
  const [newRule, setNewRule] = useState('')
  const [saving, setSaving]   = useState(false)
  const [error, setError]     = useState<string | null>(null)

  useEffect(() => {
    fetch('/api/sav-krom/rules')
      .then(r => r.json()).then((d: { rules?: string[] }) => setRules(d.rules ?? []))
      .catch(() => setError('Erreur de chargement'))
      .finally(() => setLoading(false))
  }, [])

  async function addRule() {
    const rule = newRule.trim(); if (!rule) return
    setSaving(true); setError(null)
    try {
      const res = await fetch('/api/sav-krom/rules', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ rule }) })
      const d = await res.json() as { rules?: string[]; error?: string }
      if (!res.ok) throw new Error(d.error ?? `HTTP ${res.status}`)
      setRules(d.rules ?? []); setNewRule('')
    } catch (e) { setError(e instanceof Error ? e.message : 'Erreur') }
    finally { setSaving(false) }
  }

  async function deleteRule(index: number) {
    setError(null)
    try {
      const res = await fetch('/api/sav-krom/rules', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ index }) })
      const d = await res.json() as { rules?: string[]; error?: string }
      if (!res.ok) throw new Error(d.error ?? `HTTP ${res.status}`)
      setRules(d.rules ?? [])
    } catch (e) { setError(e instanceof Error ? e.message : 'Erreur') }
  }

  return (
    <div className="absolute inset-0 z-20 bg-white flex flex-col">
      <div className="flex items-center justify-between px-8 py-5 border-b border-[#e8e8e4] shrink-0">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-[0.1em] text-[#aeb0c9]">SAV Krom Water</p>
          <h2 className="text-base font-semibold text-[#1a1a2e] mt-0.5">Instructions &amp; règles</h2>
        </div>
        <button onClick={onClose} className="w-8 h-8 rounded-lg flex items-center justify-center text-[#6b6b63] hover:bg-[#f8f7f5] transition-colors">
          <X size={16} strokeWidth={1.8} />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-8 py-6 max-w-2xl space-y-6">
        <p className="text-xs text-[#9b9b93] leading-relaxed">
          Ces règles sont injectées dans chaque prompt de génération de réponse. Claude les respecte impérativement avant toute autre instruction.
        </p>

        {error && <p className="text-xs text-[#c7293a] bg-[#fce8ea] rounded-xl px-3 py-2">{error}</p>}

        <div className="space-y-2">
          {loading && <><div className="h-10 bg-[#f3f3f1] rounded-xl animate-pulse" /><div className="h-10 bg-[#f3f3f1] rounded-xl animate-pulse" /></>}
          {!loading && rules.length === 0 && <p className="text-xs text-[#9b9b93] py-4 text-center">Aucune règle définie.</p>}
          {!loading && rules.map((rule, i) => (
            <div key={i} className="flex items-start gap-3 bg-[#f8f7f5] rounded-xl px-4 py-3 group">
              <span className="text-[10px] font-bold text-[#aeb0c9] mt-0.5 w-4 text-right shrink-0">{i + 1}</span>
              <p className="text-sm text-[#1a1a2e] leading-relaxed flex-1">{rule}</p>
              <button onClick={() => deleteRule(i)} className="shrink-0 text-[#c7293a] opacity-0 group-hover:opacity-100 transition-opacity hover:bg-[#fce8ea] rounded-lg p-1">
                <Trash2 size={13} strokeWidth={1.8} />
              </button>
            </div>
          ))}
        </div>

        <div className="space-y-3 pt-2 border-t border-[#f0f0ee]">
          <p className="text-[10px] font-semibold uppercase tracking-[0.1em] text-[#aeb0c9] pt-1">Ajouter une règle</p>
          <textarea
            value={newRule} onChange={e => setNewRule(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) addRule() }}
            placeholder="Ex : Toujours mentionner que les cartouches durent 3 mois ou 150L."
            rows={3}
            className="w-full text-sm text-[#1a1a2e] bg-[#f8f7f5] rounded-xl px-4 py-3 leading-relaxed resize-none border border-transparent focus:border-[#aeb0c9] focus:outline-none transition-colors font-[inherit]"
          />
          <button
            onClick={addRule} disabled={saving || !newRule.trim()}
            className="px-4 py-2 rounded-xl bg-[#1a1a2e] text-white text-xs font-semibold hover:bg-[#2a2a4e] transition-colors disabled:opacity-40"
          >
            {saving ? 'Ajout…' : 'Ajouter'}
          </button>
        </div>
      </div>
    </div>
  )
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

function ReplyPanel({ thread, draft, onDraftChange, onSent, onArchive, onRegenerate }: {
  thread:         ProcessedThread
  draft:          string
  onDraftChange:  (v: string) => void
  onSent:         (wasModified: boolean) => void
  onArchive:      () => void
  onRegenerate:   () => void
}) {
  const [sending, setSending]             = useState(false)
  const [archiving, setArchiving]         = useState(false)
  const [deciding, setDeciding]           = useState(false)
  const [improving, setImproving]         = useState(false)
  const [previousDraft, setPreviousDraft] = useState<string | null>(null)
  const [error, setError]                 = useState<string | null>(null)
  const [showReason, setShowReason]       = useState(false)
  const startTime = useRef(Date.now())

  const showDecisionPanel = thread.needs_decision && !draft

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

  async function decide(option: DecisionOption) {
    setDeciding(true); setError(null)
    try {
      const res = await fetch('/api/sav-krom/decide', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          thread_id:      thread.thread_id,
          subject:        thread.subject,
          body:           thread.body,
          category:       thread.category,
          sender_email:   thread.sender_email,
          decision_key:   option.key,
          decision_label: option.label,
        }),
      })
      const d = await res.json() as { body?: string; solved?: boolean; error?: string }
      if (!res.ok) throw new Error(d.error ?? `HTTP ${res.status}`)
      if (d.body) onDraftChange(d.body)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erreur inconnue')
    } finally { setDeciding(false) }
  }

  async function improve() {
    if (!draft.trim()) return
    setImproving(true); setError(null)
    setPreviousDraft(draft)
    try {
      const res = await fetch('/api/sav-krom/improve', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ current_draft: draft }),
      })
      const d = await res.json() as { body?: string; error?: string }
      if (!res.ok) throw new Error(d.error ?? `HTTP ${res.status}`)
      if (d.body) onDraftChange(d.body)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erreur inconnue')
      setPreviousDraft(null)
    } finally { setImproving(false) }
  }

  function undoImprove() {
    if (previousDraft !== null) { onDraftChange(previousDraft); setPreviousDraft(null) }
  }

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Header */}
      <div className="px-5 py-4 border-b border-[#e8e8e4] shrink-0 space-y-2">
        <div className="flex items-center justify-between gap-2">
          <p className="text-[10px] font-semibold uppercase tracking-[0.1em] text-[#aeb0c9]">Réponse Claude</p>
          <div className="flex items-center gap-2">
            <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${
              thread.confidence >= 0.85 ? 'bg-[#dcf5e7] text-[#1a7f4b]'
              : thread.confidence >= 0.6  ? 'bg-[#fef3c7] text-[#b45309]'
              : 'bg-[#fce8ea] text-[#c7293a]'
            }`}>
              {Math.round(thread.confidence * 100)}% confiance
            </span>
            <button
              onClick={onRegenerate}
              disabled={sending || archiving || deciding}
              title="Regénérer la réponse"
              className="w-6 h-6 rounded-lg flex items-center justify-center text-[#9b9b93] hover:text-[#1a1a2e] hover:bg-[#eeede9] transition-colors disabled:opacity-40"
            >
              <RefreshCw size={12} strokeWidth={1.8} />
            </button>
          </div>
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

      {/* Decision panel OR Textarea */}
      <div className="flex-1 overflow-hidden px-5 py-4 flex flex-col gap-3">
        {showDecisionPanel ? (
          <div className="flex flex-col gap-2 h-full justify-center">
            <p className="text-[11px] text-[#6b6b63] text-center font-medium mb-1">
              Quelle décision prenez-vous ?
            </p>
            {deciding ? (
              <div className="flex items-center justify-center gap-2 py-6">
                <RefreshCw size={14} className="animate-spin text-[#9b9b93]" />
                <span className="text-xs text-[#9b9b93]">Rédaction en cours…</span>
              </div>
            ) : (
              (thread.decision_options ?? []).map(opt => (
                <button
                  key={opt.key}
                  onClick={() => decide(opt)}
                  className="flex items-center gap-2.5 px-4 py-3 rounded-xl border border-[#e8e8e4] bg-white hover:bg-[#f0efec] hover:border-[#aeb0c9] text-[12px] font-medium text-[#1a1a2e] transition-colors text-left"
                >
                  <span className="text-base leading-none">{opt.emoji}</span>
                  {opt.label}
                </button>
              ))
            )}
          </div>
        ) : (
          <textarea
            value={draft}
            onChange={e => { onDraftChange(e.target.value); setPreviousDraft(null) }}
            className="w-full flex-1 text-xs text-[#1a1a2e] bg-[#f8f7f5] rounded-xl px-3 py-3 leading-relaxed resize-none border border-transparent focus:border-[#aeb0c9] focus:outline-none transition-colors font-[inherit]"
            style={{ minHeight: 0 }}
          />
        )}
      </div>

      {/* Footer */}
      <div className="px-5 pb-5 shrink-0 space-y-3">
        {error && <p className="text-[11px] text-[#c7293a] bg-[#fce8ea] rounded-lg px-3 py-2">{error}</p>}

        {/* Améliorer — toolbar row */}
        {!showDecisionPanel && draft.trim() && (
          <div className="flex items-center gap-2">
            <button
              onClick={improve}
              disabled={improving || sending || archiving || deciding}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-[#e0d4f7] bg-[#faf5ff] text-[11px] font-medium text-[#7c3aed] hover:bg-[#f3e8ff] hover:border-[#c4b5fd] transition-colors disabled:opacity-40"
            >
              {improving
                ? <RefreshCw size={11} strokeWidth={1.8} className="animate-spin" />
                : <span className="text-[12px] leading-none">✨</span>}
              {improving ? 'Amélioration…' : 'Améliorer'}
            </button>
            {previousDraft !== null && !improving && (
              <button
                onClick={undoImprove}
                className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-[#e0deda] bg-white text-[11px] font-medium text-[#9b9b93] hover:bg-[#f0efec] hover:text-[#6b6b63] transition-colors"
              >
                ↩ Annuler
              </button>
            )}
          </div>
        )}

        <button
          onClick={send} disabled={sending || archiving || deciding}
          className="w-full flex items-center justify-center gap-1.5 py-2.5 rounded-xl bg-[#1a1a2e] text-white text-xs font-semibold hover:bg-[#2a2a4e] transition-colors disabled:opacity-50"
        >
          {sending ? <RefreshCw size={13} className="animate-spin" /> : <Send size={13} strokeWidth={1.8} />}
          {sending ? 'Envoi…' : 'Envoyer par email'}
        </button>
        <button
          onClick={doArchive} disabled={sending || archiving || deciding}
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
        ) : [...messages].reverse().map((msg, i) => {
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
  const [showRules, setShowRules]       = useState(false)
  const [search, setSearch]             = useState('')
  const [catFilter, setCatFilter]       = useState<KromCategory | 'all'>('all')
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

  const searchLow = search.toLowerCase().trim()

  function matchesSearch(t: RawThread): boolean {
    if (!searchLow) return true
    return (
      t.subject.toLowerCase().includes(searchLow) ||
      t.sender_email.toLowerCase().includes(searchLow) ||
      t.sender_name.toLowerCase().includes(searchLow)
    )
  }

  function matchesCat(t: RawThread): boolean {
    if (catFilter === 'all') return true
    return processedCache[t.thread_id]?.category === catFilter
  }

  const pending  = threads.filter(t => !doneStatuses[t.thread_id] && matchesSearch(t) && matchesCat(t))
  const done     = threads.filter(t =>  doneStatuses[t.thread_id] && matchesSearch(t) && matchesCat(t))
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
            <div className="flex items-center gap-1">
              <button
                onClick={() => setShowRules(true)}
                className="h-7 px-2 rounded-lg flex items-center gap-1 text-[#6b6b63] hover:bg-[#eeede9] transition-colors text-[10px] font-medium"
                title="Règles Claude"
              >
                <Settings size={12} strokeWidth={1.8} /> Règles
              </button>
              <button
                onClick={load} disabled={listLoading}
                className="w-7 h-7 rounded-lg flex items-center justify-center text-[#6b6b63] hover:bg-[#eeede9] transition-colors disabled:opacity-40"
                title="Actualiser"
              >
                <RefreshCw size={13} strokeWidth={1.8} className={listLoading ? 'animate-spin' : ''} />
              </button>
            </div>
          </div>

          {/* Search */}
          <div className="relative mb-2">
            <input
              type="text"
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Rechercher…"
              className="w-full text-[11px] bg-[#f0efec] rounded-lg px-3 py-1.5 pr-7 text-[#1a1a2e] placeholder-[#aeb0c9] border border-transparent focus:border-[#aeb0c9] focus:outline-none transition-colors"
            />
            {search && (
              <button
                onClick={() => setSearch('')}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-[#aeb0c9] hover:text-[#6b6b63]"
              >
                <X size={11} strokeWidth={2} />
              </button>
            )}
          </div>

          {/* Category chips */}
          <div className="flex flex-wrap gap-1 mb-2">
            <button
              onClick={() => setCatFilter('all')}
              className={`px-2 py-0.5 rounded-full text-[10px] font-semibold transition-colors ${
                catFilter === 'all' ? 'bg-[#1a1a2e] text-white' : 'bg-[#eeede9] text-[#6b6b63] hover:bg-[#e0deda]'
              }`}
            >
              Tous
            </button>
            {(Object.keys(CAT_LABELS) as KromCategory[]).map(cat => {
              const { bg, text } = CAT_COLORS[cat]
              const isActive = catFilter === cat
              return (
                <button
                  key={cat}
                  onClick={() => setCatFilter(isActive ? 'all' : cat)}
                  className="px-2 py-0.5 rounded-full text-[10px] font-semibold transition-colors"
                  style={isActive
                    ? { backgroundColor: text, color: '#fff' }
                    : { backgroundColor: bg, color: text }
                  }
                >
                  {CAT_LABELS[cat]}
                </button>
              )
            })}
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
            onRegenerate={() => {
              const raw = threads.find(t => t.thread_id === selected.thread_id)
              if (!raw) return
              // Vider draft + cache pour forcer la mise à jour
              setDrafts(prev => { const n = { ...prev }; delete n[raw.thread_id]; return n })
              setProcessedCache(prev => { const n = { ...prev }; delete n[raw.thread_id]; return n })
              fetchingRef.current.delete(raw.thread_id)
              processThread(raw)
            }}
          />
        ) : null}
      </div>

      {/* Rules overlay */}
      {showRules && <RulesPanel onClose={() => setShowRules(false)} />}
    </div>
  )
}
