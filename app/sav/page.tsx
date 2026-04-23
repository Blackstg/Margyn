'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import {
  RefreshCw, Send, ArrowUpRight, Archive, Package, ExternalLink,
  Inbox, CheckCheck, ChevronDown, ChevronUp,
  Settings, Trash2, Plus, X, Download, RotateCcw,
} from 'lucide-react'

// ─── Types ────────────────────────────────────────────────────────────────────

type TicketCategory =
  | 'suivi_livraison' | 'retour_remboursement' | 'produit_defectueux'
  | 'modification_commande' | 'question_produit' | 'partenariat' | 'autre'

type ReplyAction = 'auto_reply' | 'escalate'

interface OrderProduct { name: string; quantity: number; price: string }

interface MoomOrder {
  order_number: string; status_fr: string; financial_status_fr: string
  carrier: string | null; tracking_number: string | null; tracking_url: string | null
  estimated_delivery: string | null; products: OrderProduct[]; created_at: string
}

interface CommentItem {
  id: number; body: string; author_type: 'client' | 'agent'; created_at: string
}

// Minimal ticket from the fast list endpoint (no AI data)
interface RawTicket {
  ticket_id:    number
  subject:      string
  description:  string
  created_at:   string
  status:       'new' | 'open' | 'pending'
  requester_id: number
}

// Full ticket after AI processing
interface ProcessedTicket extends RawTicket {
  customer_email: string; category: TicketCategory
  action: ReplyAction; confidence: number; reason: string
  order: MoomOrder | null; draft_reply: string; solved: boolean
  partnership_email_sent?: boolean
  is_phishing?: boolean
  phishing_signals?: string[]
}

// ─── Constants ────────────────────────────────────────────────────────────────

const CAT_LABELS: Record<TicketCategory, string> = {
  suivi_livraison: 'Suivi livraison', retour_remboursement: 'Retour / Remb.',
  produit_defectueux: 'Produit défect.', modification_commande: 'Modif. commande',
  question_produit: 'Question produit', partenariat: 'Partenariat', autre: 'Autre',
}
const CAT_COLORS: Record<TicketCategory, { bg: string; text: string }> = {
  suivi_livraison:       { bg: '#e0f0ff', text: '#1565c0' },
  retour_remboursement:  { bg: '#fff3e0', text: '#e65100' },
  produit_defectueux:    { bg: '#fce8ea', text: '#c7293a' },
  modification_commande: { bg: '#ede7f6', text: '#4527a0' },
  question_produit:      { bg: '#e0f7fa', text: '#00695c' },
  partenariat:           { bg: '#fdf4ff', text: '#7e22ce' },
  autre:                 { bg: '#f3f3f1', text: '#6b6b63' },
}

function catBadge(category: TicketCategory) {
  const { bg, text } = CAT_COLORS[category]
  return (
    <span className="inline-flex px-2 py-0.5 rounded-full text-[10px] font-semibold shrink-0" style={{ backgroundColor: bg, color: text }}>
      {CAT_LABELS[category]}
    </span>
  )
}

function fmtTime(iso: string) {
  const d = new Date(iso), now = new Date()
  const sameDay = d.toDateString() === now.toDateString()
  return sameDay
    ? d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })
    : d.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' })
}

// ─── Left column ──────────────────────────────────────────────────────────────

function TicketRow({ raw, processed, selected, doneAction, isProcessing, onClick }: {
  raw: RawTicket
  processed?: ProcessedTicket
  selected: boolean
  doneAction?: 'sent' | 'escalated' | 'archived'
  isProcessing?: boolean
  onClick: () => void
}) {
  const email     = processed?.customer_email ?? `#${raw.requester_id}`
  const isPending = raw.status === 'pending'

  return (
    <button
      onClick={onClick}
      className={`w-full text-left px-4 py-3 border-b border-[#eeede9] transition-colors ${
        selected ? 'bg-[#1a1a2e]' : 'hover:bg-[#f0efec]'
      }`}
    >
      <div className="flex items-center justify-between gap-2 mb-1">
        <span className={`text-[11px] font-semibold truncate flex-1 ${selected ? 'text-white' : 'text-[#1a1a2e]'}`}>
          {raw.subject}
        </span>
        <span className={`text-[10px] shrink-0 ${selected ? 'text-white/50' : 'text-[#9b9b93]'}`}>
          {fmtTime(raw.created_at ?? new Date().toISOString())}
        </span>
      </div>
      <div className="flex items-center gap-2">
        <span className={`text-[10px] truncate flex-1 ${selected ? 'text-white/60' : 'text-[#6b6b63]'}`}>
          {email}
        </span>
        {doneAction === 'sent' && (
          <span className={`inline-flex items-center gap-1 text-[10px] font-semibold shrink-0 ${selected ? 'text-white/60' : 'text-[#1a7f4b]'}`}>
            <CheckCheck size={10} /> Envoyé
          </span>
        )}
        {doneAction === 'escalated' && (
          <span className={`inline-flex items-center gap-1 text-[10px] font-semibold shrink-0 ${selected ? 'text-white/60' : 'text-[#b45309]'}`}>
            <ArrowUpRight size={10} /> Escaladé
          </span>
        )}
        {doneAction === 'archived' && (
          <span className={`inline-flex items-center gap-1 text-[10px] font-semibold shrink-0 ${selected ? 'text-white/60' : 'text-[#6b6b63]'}`}>
            <Archive size={10} /> Archivé
          </span>
        )}
        {!doneAction && isPending && (
          <span className={`inline-flex items-center gap-1 text-[10px] font-semibold shrink-0`}
            style={selected ? { color: 'rgba(255,255,255,.6)' } : { backgroundColor: '#f0efec', color: '#6b6b63', padding: '1px 6px', borderRadius: 99 }}>
            En attente
          </span>
        )}
        {processed?.is_phishing && (
          <span className="inline-flex items-center gap-1 text-[10px] font-bold shrink-0 bg-[#fee2e2] text-[#c7293a] px-1.5 py-0.5 rounded-full">
            🎣 Phishing
          </span>
        )}
        {!doneAction && !isPending && processed && !processed.is_phishing && catBadge(processed.category)}
        {!doneAction && !isPending && !processed && isProcessing && (
          <RefreshCw size={10} strokeWidth={1.8} className={`animate-spin shrink-0 ${selected ? 'text-white/40' : 'text-[#aeb0c9]'}`} />
        )}
      </div>
    </button>
  )
}

// ─── Center column ────────────────────────────────────────────────────────────

function OrderBlock({ order }: { order: MoomOrder }) {
  return (
    <div className="bg-[#f8f7f5] rounded-xl p-4 space-y-3">
      <p className="text-[10px] font-semibold uppercase tracking-[0.1em] text-[#aeb0c9] flex items-center gap-1.5">
        <Package size={11} strokeWidth={1.8} /> Commande Shopify
      </p>
      <div className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-1.5 text-xs">
        <span className="text-[#6b6b63]">Numéro</span>
        <span className="font-medium text-[#1a1a2e]">{order.order_number}</span>
        <span className="text-[#6b6b63]">Statut</span>
        <span className="font-medium text-[#1a1a2e]">{order.status_fr}</span>
        <span className="text-[#6b6b63]">Paiement</span>
        <span className="font-medium text-[#1a1a2e]">{order.financial_status_fr}</span>
        {order.carrier && <>
          <span className="text-[#6b6b63]">Transporteur</span>
          <span className="font-medium text-[#1a1a2e]">{order.carrier}</span>
        </>}
        {order.tracking_number && <>
          <span className="text-[#6b6b63]">Suivi</span>
          <span className="font-medium text-[#1a1a2e] flex items-center gap-1">
            {order.tracking_number}
            {order.tracking_url && (
              <a href={order.tracking_url} target="_blank" rel="noopener noreferrer" className="text-[#1565c0]">
                <ExternalLink size={10} />
              </a>
            )}
          </span>
        </>}
        {order.estimated_delivery && <>
          <span className="text-[#6b6b63]">Livraison est.</span>
          <span className="font-medium text-[#1a1a2e]">{order.estimated_delivery}</span>
        </>}
      </div>
      {order.products.length > 0 && (
        <div className="border-t border-[#eeede9] pt-2 space-y-1">
          {order.products.map((p, i) => (
            <div key={i} className="flex justify-between text-xs text-[#6b6b63]">
              <span>{p.quantity}× {p.name}</span>
              <span>{p.price} €</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function ConversationThread({ ticket, refreshKey }: { ticket: ProcessedTicket; refreshKey: number }) {
  const [comments, setComments]     = useState<CommentItem[]>([])
  const [loadingCom, setLoadingCom] = useState(true)

  useEffect(() => {
    // AbortController cancels any in-flight request when the effect re-runs
    // (ticket switch or refreshKey change), preventing stale data from landing.
    const controller = new AbortController()

    setLoadingCom(true)
    setComments([])

    const url = `/api/sav/comments?ticket_id=${ticket.ticket_id}&requester_id=${ticket.requester_id ?? 0}`
    console.log(`[SAV] ConversationThread — fetching #${ticket.ticket_id} (refreshKey=${refreshKey})`)

    fetch(url, { cache: 'no-store', signal: controller.signal })
      .then(r => r.json())
      .then((d: { comments?: CommentItem[]; error?: string }) => {
        if (d.error) console.warn('[SAV] comments API error:', d.error)
        const list = d.comments ?? []
        console.log(`[SAV] ConversationThread — #${ticket.ticket_id}: ${list.length} commentaire(s) reçu(s)`)
        setComments(list)
      })
      .catch((err) => {
        if ((err as Error).name === 'AbortError') return  // request was superseded — ignore
        console.error('[SAV] comments fetch failed:', err)
        setComments([])
      })
      .finally(() => setLoadingCom(false))

    return () => controller.abort()
  // refreshKey is intentionally included so re-selecting the same ticket forces a reload
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ticket.ticket_id, ticket.requester_id, refreshKey])

  if (loadingCom) {
    return (
      <div className="space-y-3 py-2">
        {[1, 2, 3].map(i => (
          <div key={i} className="space-y-1.5">
            <div className="h-2.5 w-24 bg-[#e8e8e4] rounded-full animate-pulse" />
            <div className="h-14 bg-[#f3f3f1] rounded-xl animate-pulse" />
          </div>
        ))}
      </div>
    )
  }

  if (comments.length === 0) {
    return (
      <p className="text-sm text-[#1a1a2e] leading-relaxed whitespace-pre-wrap">
        {ticket.description ?? '—'}
      </p>
    )
  }

  return (
    <div className="space-y-3">
      {[...comments].reverse().map((c, i) => {
        const isAgent  = c.author_type === 'agent'
        const d        = new Date(c.created_at)
        const now      = new Date()
        const sameDay  = d.toDateString() === now.toDateString()
        const dateStr  = sameDay
          ? d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })
          : d.toLocaleDateString('fr-FR', { day: '2-digit', month: 'short' }) + ' ' +
            d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })

        return (
          <div key={c.id ?? i} className={`rounded-xl px-4 py-3 border-l-[3px] ${
            isAgent
              ? 'bg-[#f0f4ff] border-[#aeb0c9]'
              : 'bg-[#f8f7f5] border-[#e0cfc9]'
          }`}>
            <div className="flex items-center justify-between gap-2 mb-1.5">
              <span className={`text-[10px] font-bold uppercase tracking-[0.08em] ${
                isAgent ? 'text-[#4527a0]' : 'text-[#b45309]'
              }`}>
                {isAgent ? 'Agent' : 'Client'}
              </span>
              <span className="text-[10px] text-[#aeb0c9]">{dateStr}</span>
            </div>
            <p className="text-xs text-[#1a1a2e] leading-relaxed whitespace-pre-wrap break-words">
              {c.body}
            </p>
          </div>
        )
      })}
    </div>
  )
}

function TicketDetail({ ticket, refreshKey }: { ticket: ProcessedTicket; refreshKey: number }) {
  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Detail header */}
      <div className="px-6 py-4 border-b border-[#e8e8e4] shrink-0">
        <p className="text-[10px] font-semibold uppercase tracking-[0.1em] text-[#aeb0c9] mb-1">
          #{ticket.ticket_id}
        </p>
        <h2 className="text-base font-semibold text-[#1a1a2e] leading-snug mb-2">{ticket.subject}</h2>
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-xs text-[#6b6b63]">{ticket.customer_email}</span>
          <span className="text-[#d0cfc9]">·</span>
          {ticket.is_phishing
            ? <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-[#fee2e2] text-[#c7293a]">🎣 Phishing</span>
            : catBadge(ticket.category)
          }
          {ticket.action === 'auto_reply'
            ? <span className="inline-flex px-2 py-0.5 rounded-full text-[10px] font-semibold bg-[#dcf5e7] text-[#1a7f4b]">Réponse auto</span>
            : <span className="inline-flex px-2 py-0.5 rounded-full text-[10px] font-semibold bg-[#fef3c7] text-[#b45309]">À escalader</span>
          }
          {ticket.partnership_email_sent === true && (
            <span className="inline-flex px-2 py-0.5 rounded-full text-[10px] font-semibold bg-[#fdf4ff] text-[#7e22ce]">✉ Transmis à Pauline</span>
          )}
          {ticket.partnership_email_sent === false && (
            <span className="inline-flex px-2 py-0.5 rounded-full text-[10px] font-semibold bg-[#fce8ea] text-[#c7293a]">⚠ Email partenariat échoué</span>
          )}
        </div>
      </div>

      {/* Scrollable body */}
      <div className="flex-1 overflow-y-auto px-6 py-5 space-y-5">

        {/* Phishing warning */}
        {ticket.is_phishing && (
          <div className="rounded-xl bg-[#fef2f2] border border-[#fecaca] px-4 py-3 flex gap-3">
            <span className="text-xl shrink-0">🎣</span>
            <div>
              <p className="text-sm font-bold text-[#c7293a] mb-0.5">Tentative de phishing détectée</p>
              <p className="text-xs font-semibold text-[#c7293a] mb-1">⚠ Ne pas cliquer sur les liens de ce message</p>
              {ticket.phishing_signals && ticket.phishing_signals.length > 0 && (
                <ul className="text-xs text-[#7f1d1d] space-y-0.5 list-disc list-inside">
                  {ticket.phishing_signals.map((s, i) => <li key={i}>{s}</li>)}
                </ul>
              )}
            </div>
          </div>
        )}

        {/* Conversation thread */}
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-[0.1em] text-[#aeb0c9] mb-3">
            Conversation
          </p>
          <ConversationThread ticket={ticket} refreshKey={refreshKey} />
        </div>

        {/* Order */}
        {ticket.order && (
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-[0.1em] text-[#aeb0c9] mb-3">
              Commande associée
            </p>
            <OrderBlock order={ticket.order} />
          </div>
        )}
      </div>
    </div>
  )
}

function CenterEmpty() {
  return (
    <div className="flex flex-col items-center justify-center h-full text-center gap-3">
      <Inbox size={32} strokeWidth={1.2} className="text-[#d0cfc9]" />
      <p className="text-sm font-medium text-[#9b9b93]">Sélectionne un ticket</p>
    </div>
  )
}

function CenterSkeleton() {
  return (
    <div className="flex flex-col h-full overflow-hidden">
      <div className="px-6 py-4 border-b border-[#e8e8e4] shrink-0 space-y-2">
        <div className="h-2.5 w-12 bg-[#e8e8e4] rounded-full animate-pulse" />
        <div className="h-4 w-2/3 bg-[#e8e8e4] rounded-full animate-pulse" />
        <div className="flex gap-2 pt-0.5">
          <div className="h-3 w-28 bg-[#e8e8e4] rounded-full animate-pulse" />
          <div className="h-3 w-16 bg-[#e8e8e4] rounded-full animate-pulse" />
        </div>
      </div>
      <div className="flex-1 px-6 py-5 space-y-5">
        {[1, 2, 3].map(i => (
          <div key={i} className="space-y-2">
            <div className="h-2 w-20 bg-[#e8e8e4] rounded-full animate-pulse" />
            <div className="h-16 bg-[#f3f3f1] rounded-xl animate-pulse" />
          </div>
        ))}
      </div>
    </div>
  )
}

function RightPanelSkeleton() {
  return (
    <div className="flex flex-col h-full overflow-hidden">
      <div className="px-5 py-4 border-b border-[#e8e8e4] shrink-0 space-y-2">
        <div className="flex items-center justify-between">
          <div className="h-2.5 w-24 bg-[#e8e8e4] rounded-full animate-pulse" />
          <div className="h-5 w-20 bg-[#e8e8e4] rounded-full animate-pulse" />
        </div>
      </div>
      <div className="flex-1 px-5 py-4">
        <div className="h-full bg-[#f3f3f1] rounded-xl animate-pulse" />
      </div>
      <div className="px-5 pb-5 space-y-2 shrink-0">
        <div className="h-10 bg-[#e8e8e4] rounded-xl animate-pulse" />
        <div className="h-9 bg-[#f0efec] rounded-xl animate-pulse" />
      </div>
    </div>
  )
}

// ─── Right column — reply panel ───────────────────────────────────────────────

function ReplyPanel({ ticket, draft, solved, onDraftChange, onSolvedChange, onSent, onArchive }: {
  ticket: ProcessedTicket
  draft: string; solved: boolean
  onDraftChange: (v: string) => void
  onSolvedChange: (v: boolean) => void
  onSent: (action: ReplyAction) => void
  onArchive: () => void
}) {
  const [sending, setSending]         = useState(false)
  const [archiving, setArchiving]     = useState(false)
  const [regenerating, setRegenerating] = useState(false)
  const [error, setError]             = useState<string | null>(null)
  const [showReason, setShowReason]   = useState(false)

  async function regenerate() {
    setRegenerating(true); setError(null)
    try {
      const res = await fetch('/api/sav/regenerate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          subject:        ticket.subject,
          description:    ticket.description,
          category:       ticket.category,
          order:          ticket.order,
          customer_email: ticket.customer_email,
          ticket_id:      ticket.ticket_id,
          requester_id:   ticket.requester_id ?? 0,
        }),
      })
      const d = await res.json() as { body?: string; solved?: boolean; error?: string }
      if (!res.ok) throw new Error(d.error ?? `HTTP ${res.status}`)
      if (d.body) onDraftChange(d.body)
      if (d.solved !== undefined) onSolvedChange(d.solved)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erreur inconnue')
    } finally { setRegenerating(false) }
  }

  async function send(action: ReplyAction) {
    setSending(true); setError(null)
    try {
      const res = await fetch('/api/sav/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ticket_id: ticket.ticket_id, reply_body: draft, solved, action }),
      })
      if (!res.ok) { const d = await res.json(); throw new Error(d.error ?? `HTTP ${res.status}`) }
      onSent(action)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erreur inconnue')
    } finally { setSending(false) }
  }

  async function archive() {
    setArchiving(true); setError(null)
    try {
      const res = await fetch('/api/sav/archive', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ticket_id: ticket.ticket_id }),
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
          <p className="text-[10px] font-semibold uppercase tracking-[0.1em] text-[#aeb0c9]">
            Réponse Claude
          </p>
          <div className="flex items-center gap-1.5">
            <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${
              ticket.confidence >= 0.85 ? 'bg-[#dcf5e7] text-[#1a7f4b]'
              : ticket.confidence >= 0.6  ? 'bg-[#fef3c7] text-[#b45309]'
              : 'bg-[#fce8ea] text-[#c7293a]'
            }`}>
              {Math.round(ticket.confidence * 100)}% confiance
            </span>
            <button
              onClick={regenerate}
              disabled={regenerating || sending || archiving}
              title="Régénérer la réponse"
              className="w-6 h-6 flex items-center justify-center rounded-md text-[#9b9b93] hover:text-[#1a1a2e] hover:bg-[#f0efec] transition-colors disabled:opacity-40"
            >
              <RotateCcw size={12} strokeWidth={1.8} className={regenerating ? 'animate-spin' : ''} />
            </button>
          </div>
        </div>
        <button
          onClick={() => setShowReason(v => !v)}
          className="flex items-center gap-1 text-[10px] text-[#9b9b93] hover:text-[#6b6b63] transition-colors"
        >
          {showReason ? <ChevronUp size={11} /> : <ChevronDown size={11} />}
          Justification
        </button>
        {showReason && (
          <p className="text-[11px] text-[#6b6b63] bg-[#f8f7f5] rounded-lg px-3 py-2 leading-relaxed">
            {ticket.reason}
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
        {error && (
          <p className="text-[11px] text-[#c7293a] bg-[#fce8ea] rounded-lg px-3 py-2">{error}</p>
        )}
        <label className="flex items-center gap-2 text-xs text-[#6b6b63] cursor-pointer">
          <input
            type="checkbox" checked={solved} onChange={e => onSolvedChange(e.target.checked)}
            className="accent-[#1a7f4b] w-3.5 h-3.5"
          />
          Marquer comme résolu
        </label>
        <div className="flex gap-2">
          <button
            onClick={() => send('auto_reply')} disabled={sending || archiving || regenerating}
            className="flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-xl bg-[#1a1a2e] text-white text-xs font-semibold hover:bg-[#2a2a4e] transition-colors disabled:opacity-50"
          >
            {sending ? <RefreshCw size={13} className="animate-spin" /> : <Send size={13} strokeWidth={1.8} />}
            Envoyer
          </button>
          <button
            onClick={() => send('escalate')} disabled={sending || archiving || regenerating}
            className="flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-xl border border-[#e8e8e4] text-[#6b6b63] text-xs font-semibold hover:bg-[#f0efec] transition-colors disabled:opacity-50"
          >
            <ArrowUpRight size={13} strokeWidth={1.8} />
            Escalader
          </button>
        </div>
        <button
          onClick={archive} disabled={sending || archiving || regenerating}
          className="w-full flex items-center justify-center gap-1.5 py-2 rounded-xl border border-[#e8e8e4] text-[#9b9b93] text-xs font-medium hover:bg-[#f8f7f5] hover:text-[#6b6b63] transition-colors disabled:opacity-50"
        >
          {archiving ? <RefreshCw size={12} className="animate-spin" /> : <Archive size={12} strokeWidth={1.8} />}
          {archiving ? 'Archivage…' : 'Archiver sans répondre'}
        </button>
      </div>
    </div>
  )
}

// ─── Follow-up panel (pending tickets) ───────────────────────────────────────

function FollowUpPanel({ ticket, onSent }: {
  ticket:  ProcessedTicket
  onSent:  (action: ReplyAction) => void
}) {
  const [body, setBody]       = useState('')
  const [sending, setSending] = useState(false)
  const [archiving, setArchiving] = useState(false)
  const [error, setError]     = useState<string | null>(null)

  async function send() {
    if (!body.trim()) return
    setSending(true); setError(null)
    try {
      const res = await fetch('/api/sav/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ticket_id: ticket.ticket_id, reply_body: body, solved: false, action: 'auto_reply' }),
      })
      if (!res.ok) { const d = await res.json(); throw new Error(d.error ?? `HTTP ${res.status}`) }
      onSent('auto_reply')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erreur inconnue')
    } finally { setSending(false) }
  }

  async function archive() {
    setArchiving(true); setError(null)
    try {
      const res = await fetch('/api/sav/archive', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ticket_id: ticket.ticket_id }),
      })
      if (!res.ok) { const d = await res.json(); throw new Error(d.error ?? `HTTP ${res.status}`) }
      onSent('auto_reply')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erreur inconnue')
    } finally { setArchiving(false) }
  }

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Header */}
      <div className="px-5 py-4 border-b border-[#e8e8e4] shrink-0 space-y-1">
        <div className="flex items-center gap-2">
          <span className="inline-flex px-2 py-0.5 rounded-full text-[10px] font-semibold bg-[#f0efec] text-[#6b6b63]">
            En attente client
          </span>
        </div>
        <p className="text-[11px] text-[#9b9b93] leading-relaxed">
          Ce ticket est en attente de réponse du client. Relance optionnelle ci-dessous.
        </p>
      </div>

      {/* Textarea */}
      <div className="flex-1 overflow-hidden px-5 py-4">
        <textarea
          value={body}
          onChange={e => setBody(e.target.value)}
          placeholder="Bonjour, nous revenons vers vous suite à votre demande. Avez-vous des nouvelles ?"
          className="w-full h-full text-xs text-[#1a1a2e] bg-[#f8f7f5] rounded-xl px-3 py-3 leading-relaxed resize-none border border-transparent focus:border-[#aeb0c9] focus:outline-none transition-colors font-[inherit] placeholder:text-[#c9c9c9]"
        />
      </div>

      {/* Footer */}
      <div className="px-5 pb-5 shrink-0 space-y-3">
        {error && (
          <p className="text-[11px] text-[#c7293a] bg-[#fce8ea] rounded-lg px-3 py-2">{error}</p>
        )}
        <button
          onClick={send} disabled={sending || archiving || !body.trim()}
          className="w-full flex items-center justify-center gap-1.5 py-2.5 rounded-xl bg-[#1a1a2e] text-white text-xs font-semibold hover:bg-[#2a2a4e] transition-colors disabled:opacity-50"
        >
          {sending ? <RefreshCw size={13} className="animate-spin" /> : <Send size={13} strokeWidth={1.8} />}
          {sending ? 'Envoi…' : 'Relancer le client'}
        </button>
        <button
          onClick={archive} disabled={sending || archiving}
          className="w-full flex items-center justify-center gap-1.5 py-2 rounded-xl border border-[#e8e8e4] text-[#9b9b93] text-xs font-medium hover:bg-[#f8f7f5] hover:text-[#6b6b63] transition-colors disabled:opacity-50"
        >
          {archiving ? <RefreshCw size={12} className="animate-spin" /> : <Archive size={12} strokeWidth={1.8} />}
          {archiving ? 'Archivage…' : 'Archiver sans répondre'}
        </button>
      </div>
    </div>
  )
}

// ─── Rules panel (full-width overlay) ────────────────────────────────────────

function RulesPanel({ onClose }: { onClose: () => void }) {
  const [rules, setRules]     = useState<string[]>([])
  const [loading, setLoading] = useState(true)
  const [newRule, setNewRule] = useState('')
  const [saving, setSaving]   = useState(false)
  const [error, setError]     = useState<string | null>(null)

  useEffect(() => {
    fetch('/api/sav/rules')
      .then(r => r.json()).then((d: { rules?: string[] }) => setRules(d.rules ?? []))
      .catch(() => setError('Erreur de chargement'))
      .finally(() => setLoading(false))
  }, [])

  async function addRule() {
    const rule = newRule.trim(); if (!rule) return
    setSaving(true); setError(null)
    try {
      const res = await fetch('/api/sav/rules', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ rule }) })
      const d = await res.json() as { rules?: string[]; error?: string }
      if (!res.ok) throw new Error(d.error ?? `HTTP ${res.status}`)
      setRules(d.rules ?? []); setNewRule('')
    } catch (e) { setError(e instanceof Error ? e.message : 'Erreur') }
    finally { setSaving(false) }
  }

  async function deleteRule(index: number) {
    setError(null)
    try {
      const res = await fetch('/api/sav/rules', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ index }) })
      const d = await res.json() as { rules?: string[]; error?: string }
      if (!res.ok) throw new Error(d.error ?? `HTTP ${res.status}`)
      setRules(d.rules ?? [])

    } catch (e) { setError(e instanceof Error ? e.message : 'Erreur') }
  }

  return (
    <div className="absolute inset-0 z-20 bg-white flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between px-8 py-5 border-b border-[#e8e8e4] shrink-0">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-[0.1em] text-[#aeb0c9]">SAV Mōom</p>
          <h2 className="text-base font-semibold text-[#1a1a2e] mt-0.5">Instructions & règles</h2>
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
            placeholder="Ex : Toujours proposer un bon de réduction de 10% en cas de retard de livraison."
            rows={3}
            className="w-full text-sm text-[#1a1a2e] bg-[#f8f7f5] rounded-xl px-4 py-3 leading-relaxed resize-none border border-transparent focus:border-[#aeb0c9] focus:outline-none transition-colors font-[inherit] placeholder:text-[#c9c9c9]"
          />
          <button
            onClick={addRule} disabled={saving || !newRule.trim()}
            className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-[#1a1a2e] text-white text-xs font-semibold hover:bg-[#2a2a4e] transition-colors disabled:opacity-40"
          >
            {saving ? <RefreshCw size={13} className="animate-spin" /> : <Plus size={13} strokeWidth={2} />}
            Ajouter
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function SavPage() {
  const [rawTickets, setRawTickets]         = useState<RawTicket[]>([])
  const [processedCache, setProcessedCache] = useState<Record<number, ProcessedTicket>>({})
  const [selectedId, setSelectedId]         = useState<number | null>(null)
  const [processingId, setProcessingId]     = useState<number | null>(null)
  const [listLoading, setListLoading]       = useState(true)
  const [doneStatuses, setDoneStatuses]     = useState<Record<number, 'sent' | 'escalated' | 'archived'>>({})
  const [drafts, setDrafts]                 = useState<Record<number, string>>({})
  const [solvedMap, setSolvedMap]           = useState<Record<number, boolean>>({})
  const [tab, setTab]                       = useState<'pending' | 'done'>('pending')
  const [showRules, setShowRules]           = useState(false)
  const [importing, setImporting]           = useState(false)
  const [importMsg, setImportMsg]           = useState<string | null>(null)
  const [commentRefreshKey, setCommentRefreshKey] = useState(0)
  const firstLoad  = useRef(true)
  // Tracks in-flight process requests to avoid duplicate fetches
  const fetchingRef = useRef<Set<number>>(new Set())

  // ── On-demand AI processing for a single ticket ───────────────────────────
  async function processTicket(raw: RawTicket) {
    if (fetchingRef.current.has(raw.ticket_id)) return
    fetchingRef.current.add(raw.ticket_id)
    setProcessingId(raw.ticket_id)
    try {
      const res = await fetch('/api/sav/process', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ticket_id:    raw.ticket_id,
          subject:      raw.subject,
          description:  raw.description,
          created_at:   raw.created_at,
          requester_id: raw.requester_id,
          status:       raw.status,
        }),
      })
      const ticket = await res.json() as ProcessedTicket & { error?: string }
      if (!res.ok) { console.error('[SAV] /api/sav/process failed:', ticket.error); return }
      setProcessedCache(prev => ({ ...prev, [raw.ticket_id]: ticket }))
      setDrafts(prev => { if (raw.ticket_id in prev) return prev; return { ...prev, [raw.ticket_id]: ticket.draft_reply } })
      setSolvedMap(prev => { if (raw.ticket_id in prev) return prev; return { ...prev, [raw.ticket_id]: ticket.solved } })
    } catch (err) {
      console.error('[SAV] processTicket error:', err)
    } finally {
      fetchingRef.current.delete(raw.ticket_id)
      setProcessingId(prev => prev === raw.ticket_id ? null : prev)
    }
  }

  // ── Fast list load (no AI) ────────────────────────────────────────────────
  const load = useCallback(async () => {
    setListLoading(true)
    try {
      const res  = await fetch('/api/sav/tickets')
      const data = await res.json() as { tickets?: RawTicket[]; error?: string }

      if (!res.ok || !Array.isArray(data.tickets)) {
        console.error('[SAV] /api/sav/tickets failed:', res.status, data.error ?? '(no error field)')
        return
      }

      setRawTickets(data.tickets)

      if (firstLoad.current) {
        firstLoad.current = false
        // Auto-select first actionable (non-pending) ticket
        const first = data.tickets.find(t => t.status !== 'pending')
        if (first) {
          setSelectedId(first.ticket_id)
          setCommentRefreshKey(n => n + 1)
          processTicket(first)
        }
      }
    } finally { setListLoading(false) }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => { load() }, [load])

  // ── Ticket click ──────────────────────────────────────────────────────────
  function handleTicketClick(raw: RawTicket) {
    setSelectedId(raw.ticket_id)
    setCommentRefreshKey(n => n + 1)
    if (!processedCache[raw.ticket_id]) processTicket(raw)
  }

  // ── Action handlers ───────────────────────────────────────────────────────
  function advanceSelection(excludeId: number, doneAfter: Record<number, string>) {
    const remaining = rawTickets.filter(
      t => !doneAfter[t.ticket_id] && t.ticket_id !== excludeId && t.status !== 'pending'
    )
    const nextRaw = remaining[0] ?? null
    setSelectedId(nextRaw?.ticket_id ?? null)
    if (nextRaw) {
      setCommentRefreshKey(n => n + 1)
      if (!processedCache[nextRaw.ticket_id]) processTicket(nextRaw)
    }
  }

  function handleSent(action: ReplyAction) {
    if (selectedId === null) return
    const status: 'escalated' | 'sent' = action === 'escalate' ? 'escalated' : 'sent'
    const doneAfter = { ...doneStatuses, [selectedId]: status }
    setDoneStatuses(doneAfter)
    advanceSelection(selectedId, doneAfter)
  }

  function handleArchive() {
    if (selectedId === null) return
    const doneAfter = { ...doneStatuses, [selectedId]: 'archived' as const }
    setDoneStatuses(doneAfter)
    advanceSelection(selectedId, doneAfter)
  }

  async function handleImport() {
    setImporting(true); setImportMsg(null)
    try {
      const res = await fetch('/api/sav/import-history', { method: 'POST' })
      const d   = await res.json() as { count?: number; error?: string }
      if (!res.ok) throw new Error(d.error ?? `HTTP ${res.status}`)
      setImportMsg(`✓ ${d.count} exemples importés`)
    } catch (e) {
      setImportMsg(`Erreur : ${e instanceof Error ? e.message : 'inconnue'}`)
    } finally { setImporting(false) }
  }

  // ── Derived state ─────────────────────────────────────────────────────────
  const allPending    = rawTickets.filter(t => !doneStatuses[t.ticket_id])
  const donelist      = rawTickets.filter(t =>  doneStatuses[t.ticket_id])
  // Actionable = new or open; waitingClient = pending (awaiting client reply)
  const actionable    = allPending.filter(t => t.status !== 'pending')
  const waitingClient = allPending.filter(t => t.status === 'pending')

  const selectedProcessed = selectedId != null ? (processedCache[selectedId] ?? null) : null
  const isProcessing      = processingId === selectedId && selectedId !== null

  return (
    <div className="h-screen overflow-hidden flex relative">

      {/* Rules overlay */}
      {showRules && <RulesPanel onClose={() => setShowRules(false)} />}

      {/* ── LEFT — ticket list ── */}
      <div className="w-[280px] shrink-0 flex flex-col border-r border-[#e8e8e4] bg-[#f8f7f5] overflow-hidden">

        {/* Left header */}
        <div className="px-4 pt-4 border-b border-[#eeede9] shrink-0">
          <div className="flex items-center justify-between mb-3">
            <div>
              <p className="text-[9px] font-semibold uppercase tracking-[0.12em] text-[#aeb0c9]">Mōom Paris</p>
              <p className="text-sm font-bold text-[#1a1a2e] mt-0.5">SAV</p>
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
                tab === 'pending'
                  ? 'border-[#1a1a2e] text-[#1a1a2e]'
                  : 'border-transparent text-[#9b9b93] hover:text-[#6b6b63]'
              }`}
            >
              En attente
              {!listLoading && (
                <span className={`inline-flex items-center justify-center min-w-[16px] h-4 px-1 rounded-full text-[9px] font-bold ${
                  allPending.length > 0 ? 'bg-[#c7293a] text-white' : 'bg-[#e0e0da] text-[#9b9b93]'
                }`}>
                  {allPending.length}
                </span>
              )}
            </button>
            <button
              onClick={() => setTab('done')}
              className={`flex-1 flex items-center justify-center gap-1.5 py-2 text-[11px] font-semibold border-b-2 transition-colors ${
                tab === 'done'
                  ? 'border-[#1a1a2e] text-[#1a1a2e]'
                  : 'border-transparent text-[#9b9b93] hover:text-[#6b6b63]'
              }`}
            >
              Traités
              {donelist.length > 0 && (
                <span className="inline-flex items-center justify-center min-w-[16px] h-4 px-1 rounded-full text-[9px] font-bold bg-[#e0e0da] text-[#6b6b63]">
                  {donelist.length}
                </span>
              )}
            </button>
          </div>
        </div>

        {/* Ticket list */}
        <div className="flex-1 overflow-y-auto">
          {listLoading && (
            <div className="p-4 space-y-3">
              {[1,2,3,4].map(i => (
                <div key={i} className="space-y-1.5">
                  <div className="h-3 w-3/4 bg-[#e8e8e4] rounded-full animate-pulse" />
                  <div className="h-2.5 w-1/2 bg-[#e8e8e4] rounded-full animate-pulse" />
                </div>
              ))}
            </div>
          )}

          {/* En attente tab */}
          {!listLoading && tab === 'pending' && (
            <>
              {actionable.length === 0 && waitingClient.length === 0 && (
                <div className="flex flex-col items-center justify-center h-full gap-2 text-center p-4">
                  <CheckCheck size={24} strokeWidth={1.4} className="text-[#1a7f4b]" />
                  <p className="text-xs text-[#9b9b93]">File vide</p>
                </div>
              )}
              {actionable.map(t => (
                <TicketRow
                  key={t.ticket_id}
                  raw={t}
                  processed={processedCache[t.ticket_id]}
                  selected={t.ticket_id === selectedId}
                  isProcessing={processingId === t.ticket_id}
                  doneAction={doneStatuses[t.ticket_id]}
                  onClick={() => handleTicketClick(t)}
                />
              ))}
              {waitingClient.length > 0 && (
                <>
                  {/* Visual separator for "En attente client" section */}
                  <div className="flex items-center gap-2 px-4 py-2 mt-1">
                    <div className="flex-1 h-px bg-[#e8e8e4]" />
                    <span className="text-[9px] font-semibold uppercase tracking-[0.12em] text-[#aeb0c9] shrink-0 whitespace-nowrap">
                      En attente client
                    </span>
                    <div className="flex-1 h-px bg-[#e8e8e4]" />
                  </div>
                  <div className="opacity-60">
                    {waitingClient.map(t => (
                      <TicketRow
                        key={t.ticket_id}
                        raw={t}
                        processed={processedCache[t.ticket_id]}
                        selected={t.ticket_id === selectedId}
                        isProcessing={processingId === t.ticket_id}
                        onClick={() => handleTicketClick(t)}
                      />
                    ))}
                  </div>
                </>
              )}
            </>
          )}

          {/* Traités tab */}
          {!listLoading && tab === 'done' && (
            <>
              {donelist.length === 0 && (
                <div className="flex flex-col items-center justify-center h-full gap-2 text-center p-4">
                  <Inbox size={24} strokeWidth={1.4} className="text-[#d0cfc9]" />
                  <p className="text-xs text-[#9b9b93]">Aucun ticket traité</p>
                </div>
              )}
              {donelist.map(t => (
                <TicketRow
                  key={t.ticket_id}
                  raw={t}
                  processed={processedCache[t.ticket_id]}
                  selected={t.ticket_id === selectedId}
                  doneAction={doneStatuses[t.ticket_id]}
                  onClick={() => handleTicketClick(t)}
                />
              ))}
            </>
          )}
        </div>

        {/* Left footer — tools */}
        <div className="px-3 py-3 border-t border-[#eeede9] flex gap-1.5 shrink-0">
          <button
            onClick={() => setShowRules(true)}
            className="flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded-lg text-[10px] font-semibold text-[#6b6b63] hover:bg-[#eeede9] transition-colors"
          >
            <Settings size={12} strokeWidth={1.8} /> Règles
          </button>
          <button
            onClick={handleImport} disabled={importing}
            title={importMsg ?? 'Importer les tickets résolus comme exemples pour Claude'}
            className={`flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded-lg text-[10px] font-semibold transition-colors ${
              importMsg?.startsWith('✓') ? 'bg-[#dcf5e7] text-[#1a7f4b]'
              : importMsg ? 'bg-[#fce8ea] text-[#c7293a]'
              : 'text-[#6b6b63] hover:bg-[#eeede9]'
            }`}
          >
            {importing ? <RefreshCw size={12} className="animate-spin" /> : <Download size={12} strokeWidth={1.8} />}
            {importing ? 'Import…' : importMsg?.startsWith('✓') ? importMsg : 'Historique'}
          </button>
        </div>
      </div>

      {/* ── CENTER — ticket detail ── */}
      <div className="flex-1 flex flex-col overflow-hidden border-r border-[#e8e8e4] bg-white">
        {selectedId === null
          ? <CenterEmpty />
          : isProcessing && !selectedProcessed
            ? <CenterSkeleton />
            : selectedProcessed
              ? <TicketDetail ticket={selectedProcessed} refreshKey={commentRefreshKey} />
              : <CenterEmpty />
        }
      </div>

      {/* ── RIGHT — reply panel or follow-up panel ── */}
      <div className="w-[380px] shrink-0 flex flex-col overflow-hidden bg-[#fafaf9]">
        {selectedId === null ? (
          <div className="flex items-center justify-center h-full">
            <p className="text-xs text-[#9b9b93]">Aucun ticket sélectionné</p>
          </div>
        ) : isProcessing && !selectedProcessed ? (
          <RightPanelSkeleton />
        ) : selectedProcessed ? (
          selectedProcessed.status === 'pending' ? (
            <FollowUpPanel ticket={selectedProcessed} onSent={handleSent} />
          ) : (
            <ReplyPanel
              ticket={selectedProcessed}
              draft={drafts[selectedProcessed.ticket_id] ?? ''}
              solved={solvedMap[selectedProcessed.ticket_id] ?? false}
              onDraftChange={v => setDrafts(prev => ({ ...prev, [selectedProcessed.ticket_id]: v }))}
              onSolvedChange={v => setSolvedMap(prev => ({ ...prev, [selectedProcessed.ticket_id]: v }))}
              onSent={handleSent}
              onArchive={handleArchive}
            />
          )
        ) : null}
      </div>
    </div>
  )
}
