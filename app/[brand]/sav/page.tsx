'use client'

import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import { createBrowserClient } from '@supabase/auth-helpers-nextjs'
import {
  RefreshCw, Send, ArrowUpRight, Archive, Package, ExternalLink,
  Inbox, CheckCheck, ChevronDown, ChevronUp,
  Settings, Trash2, Plus, X, Download, RotateCcw, Paperclip, ArrowRight,
} from 'lucide-react'

// ─── Types ────────────────────────────────────────────────────────────────────

type TicketCategory =
  | 'suivi_livraison' | 'retour_remboursement' | 'produit_defectueux'
  | 'modification_commande' | 'question_produit' | 'partenariat' | 'autre'

type ReplyAction = 'auto_reply' | 'escalate'

interface DecisionOption {
  key:   string
  emoji: string
  label: string
}

interface OrderProduct { name: string; quantity: number; price: string }

interface MoomOrder {
  order_number: string; status_fr: string; financial_status_fr: string
  carrier: string | null; tracking_number: string | null; tracking_url: string | null
  estimated_delivery: string | null; products: OrderProduct[]; created_at: string
}

interface FileAttachment {
  id: number; file_name: string; content_url: string; content_type: string; size: number
}

interface CommentItem {
  id: number; body: string; author_type: 'client' | 'agent'; created_at: string
  attachments: FileAttachment[]
}

// Minimal ticket from the fast list endpoint (no AI data)
interface RawTicket {
  ticket_id:    number
  subject:      string
  description:  string
  created_at:   string
  updated_at:   string
  status:       'new' | 'open' | 'pending'
  requester_id: number
  is_reopened?: boolean
}

// Full ticket after AI processing
interface ProcessedTicket extends RawTicket {
  customer_email: string; category: TicketCategory
  action: ReplyAction; confidence: number; reason: string
  order: MoomOrder | null; draft_reply: string; solved: boolean
  situation_detectee?: string
  partnership_email_sent?: boolean
  is_phishing?: boolean
  phishing_signals?: string[]
  needs_decision?:   boolean
  decision_options?: DecisionOption[]
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

// ─── Attribution des tickets (qui répond) ──────────────────────────────────────

const ASSIGNEES = ['Satiana', 'Todi'] as const
const ASSIGNEE_COLORS: Record<string, [string, string]> = {
  Satiana: ['#ede9fe', '#6d28d9'],
  Todi:    ['#dcfce7', '#15803d'],
}

function AssigneePill({ name, selected }: { name: string; selected?: boolean }) {
  const [bg, fg] = ASSIGNEE_COLORS[name] ?? ['#f0f0ee', '#6b6b63']
  return (
    <span
      className="inline-flex items-center px-1.5 py-0.5 rounded-full text-[9px] font-bold shrink-0"
      style={selected ? { background: 'rgba(255,255,255,0.18)', color: '#fff' } : { background: bg, color: fg }}
      title={`Attribué à ${name}`}
    >
      {name}
    </span>
  )
}

// Barre d'attribution au-dessus du détail d'un ticket — « Qui répond ? »
function AssignBar({ ticketId, assignee, onAssign }: {
  ticketId: number
  assignee?: string
  onAssign: (ticketId: number, assignee: string | null) => void
}) {
  const options: { val: string | null; label: string; color: string }[] = [
    { val: null, label: 'Non attribué', color: '#9b9b93' },
    ...ASSIGNEES.map(a => ({ val: a as string | null, label: a, color: ASSIGNEE_COLORS[a]?.[1] ?? '#6b6b63' })),
  ]
  return (
    <div className="shrink-0 flex items-center gap-3 px-6 py-2.5 border-b border-[#eeede9] bg-[#faf9f7] flex-wrap">
      <span className="text-[11px] font-bold uppercase tracking-[0.1em] text-[#9b9b93]">Qui répond ?</span>
      <div className="flex items-center gap-1.5">
        {options.map(opt => {
          const active = (assignee ?? null) === opt.val
          return (
            <button
              key={opt.label}
              onClick={() => onAssign(ticketId, opt.val)}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold border transition-colors"
              style={active
                ? { background: opt.color, color: '#fff', borderColor: opt.color }
                : { background: '#fff', color: '#6b6b63', borderColor: '#e8e8e4' }}
            >
              <span className="text-[13px] leading-none" style={{ opacity: active ? 1 : 0 }}>✓</span>
              {opt.label}
            </button>
          )
        })}
      </div>
    </div>
  )
}

// ─── Left column ──────────────────────────────────────────────────────────────

function TicketRow({ raw, processed, selected, doneAction, isProcessing, onClick, assignee }: {
  raw: RawTicket
  processed?: ProcessedTicket
  selected: boolean
  doneAction?: 'sent' | 'escalated' | 'archived'
  isProcessing?: boolean
  onClick: () => void
  assignee?: string
}) {
  const email     = processed?.customer_email ?? `#${raw.requester_id}`
  const isPending = raw.status === 'pending'
  // Barre latérale : couleur de l'agent si attribué, orange sinon (= à attribuer)
  const accent    = assignee ? (ASSIGNEE_COLORS[assignee]?.[1] ?? '#6b6b63') : '#f59e0b'

  return (
    <button
      onClick={onClick}
      style={{ borderLeft: `4px solid ${accent}` }}
      className={`w-full text-left pl-3 pr-4 py-3 border-b border-[#eeede9] transition-colors ${
        raw.is_reopened ? 'bg-[#fffbeb]' : selected ? 'bg-[#1a1a2e]' : !assignee ? 'bg-[#fffaf3] hover:bg-[#fff4e6]' : 'hover:bg-[#f0efec]'
      }`}
    >
      <div className="flex items-center justify-between gap-2 mb-1">
        <span className={`text-[11px] font-semibold truncate flex-1 ${selected ? 'text-white' : 'text-[#1a1a2e]'}`}>
          {raw.subject}
        </span>
        <span className={`text-[10px] shrink-0 ${selected ? 'text-white/50' : 'text-[#9b9b93]'}`}>
          {fmtTime(raw.updated_at ?? raw.created_at ?? new Date().toISOString())}
        </span>
      </div>
      <div className="flex items-center gap-2">
        <span className={`text-[10px] truncate flex-1 ${selected ? 'text-white/60' : 'text-[#6b6b63]'}`}>
          {email}
        </span>
        {assignee
          ? <AssigneePill name={assignee} selected={selected} />
          : <span
              className="inline-flex items-center px-1.5 py-0.5 rounded-full text-[9px] font-bold shrink-0"
              style={selected ? { background: 'rgba(255,255,255,0.18)', color: '#fff' } : { background: '#fef3c7', color: '#b45309' }}
            >
              À attribuer
            </span>}
        {raw.is_reopened && (
          <span className="inline-flex items-center gap-1 text-[10px] font-bold shrink-0 bg-[#fef3c7] text-[#b45309] px-1.5 py-0.5 rounded-full border border-[#fcd34d]">
            💬 Nouveau message
          </span>
        )}
        {!raw.is_reopened && doneAction === 'sent' && (
          <span className={`inline-flex items-center gap-1 text-[10px] font-semibold shrink-0 ${selected ? 'text-white/60' : 'text-[#1a7f4b]'}`}>
            <CheckCheck size={10} /> Envoyé
          </span>
        )}
        {!raw.is_reopened && doneAction === 'escalated' && (
          <span className={`inline-flex items-center gap-1 text-[10px] font-semibold shrink-0 ${selected ? 'text-white/60' : 'text-[#b45309]'}`}>
            <ArrowUpRight size={10} /> Escaladé
          </span>
        )}
        {!raw.is_reopened && doneAction === 'archived' && (
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

// ─── Customer history ─────────────────────────────────────────────────────────

interface PastTicket {
  id: number; subject: string; status: string; created_at: string; updated_at: string
}
interface PastComment {
  id: number; body: string; author_type: 'client' | 'agent'; created_at: string; attachments: unknown[]
}

function CustomerHistory({ email, currentTicketId }: { email: string; currentTicketId: number }) {
  const [open, setOpen]             = useState(false)
  const [tickets, setTickets]       = useState<PastTicket[]>([])
  const [loading, setLoading]       = useState(false)
  const [expanded, setExpanded]     = useState<number | null>(null)
  const [comments, setComments]     = useState<Record<number, PastComment[]>>({})
  const [loadingCom, setLoadingCom] = useState<number | null>(null)

  useEffect(() => {
    if (!open || tickets.length > 0) return
    setLoading(true)
    fetch(`/api/sav/customer-history?email=${encodeURIComponent(email)}&exclude=${currentTicketId}`)
      .then(r => r.json())
      .then((d: { tickets?: PastTicket[] }) => setTickets(d.tickets ?? []))
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [open, email, currentTicketId, tickets.length])

  async function expandTicket(id: number) {
    if (expanded === id) { setExpanded(null); return }
    setExpanded(id)
    if (comments[id]) return
    setLoadingCom(id)
    try {
      const r = await fetch(`/api/sav/customer-history?email=${encodeURIComponent(email)}&comments=1&ticket_id=${id}`)
      const d = await r.json() as { comments?: PastComment[] }
      setComments(prev => ({ ...prev, [id]: d.comments ?? [] }))
    } catch { /* ignore */ }
    finally { setLoadingCom(null) }
  }

  const statusColor = (s: string) =>
    s === 'open' ? 'text-blue-500' : s === 'solved' || s === 'closed' ? 'text-[#1a7f4b]' : 'text-[#9b9b93]'

  return (
    <div className="border-t border-[#e8e8e4] pt-4">
      <button
        onClick={() => setOpen(v => !v)}
        className="flex items-center gap-2 w-full text-left group"
      >
        <p className="text-[10px] font-semibold uppercase tracking-[0.1em] text-[#aeb0c9] group-hover:text-[#6b6b63] transition-colors flex-1">
          Historique cliente
        </p>
        {open
          ? <ChevronUp size={12} className="text-[#aeb0c9]" />
          : <ChevronDown size={12} className="text-[#aeb0c9]" />}
      </button>

      {open && (
        <div className="mt-3 space-y-2">
          {loading && <p className="text-[11px] text-[#9b9b93]">Chargement…</p>}
          {!loading && tickets.length === 0 && (
            <p className="text-[11px] text-[#9b9b93]">Aucun échange précédent avec cette cliente.</p>
          )}
          {tickets.map(t => (
            <div key={t.id} className="rounded-xl border border-[#e8e8e4] overflow-hidden">
              <button
                onClick={() => expandTicket(t.id)}
                className="w-full flex items-start gap-2 px-3 py-2.5 text-left hover:bg-[#f8f7f5] transition-colors"
              >
                <div className="flex-1 min-w-0">
                  <p className="text-[11px] font-medium text-[#1a1a2e] truncate">{t.subject}</p>
                  <p className="text-[10px] text-[#9b9b93] mt-0.5">
                    <span className={`font-semibold ${statusColor(t.status)}`}>{t.status}</span>
                    {' · '}{new Date(t.created_at).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' })}
                  </p>
                </div>
                {loadingCom === t.id
                  ? <RefreshCw size={11} className="animate-spin text-[#aeb0c9] shrink-0 mt-0.5" />
                  : expanded === t.id
                    ? <ChevronUp size={11} className="text-[#aeb0c9] shrink-0 mt-0.5" />
                    : <ChevronDown size={11} className="text-[#aeb0c9] shrink-0 mt-0.5" />}
              </button>

              {expanded === t.id && comments[t.id] && (
                <div className="border-t border-[#e8e8e4] bg-[#f8f7f5] px-3 py-2.5 space-y-2 max-h-60 overflow-y-auto">
                  {comments[t.id].length === 0
                    ? <p className="text-[11px] text-[#9b9b93]">Aucun commentaire public.</p>
                    : comments[t.id].map(c => (
                      <div key={c.id} className={`flex gap-2 ${c.author_type === 'agent' ? 'flex-row-reverse' : ''}`}>
                        <div className={`px-2.5 py-1.5 rounded-lg text-[11px] leading-relaxed max-w-[85%] whitespace-pre-wrap ${
                          c.author_type === 'client'
                            ? 'bg-white border border-[#e8e8e4] text-[#1a1a2e]'
                            : 'bg-[#1a1a2e] text-white'
                        }`}>
                          {c.body.slice(0, 400)}{c.body.length > 400 ? '…' : ''}
                        </div>
                      </div>
                    ))
                  }
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ─── Zipchat transcript parser ────────────────────────────────────────────────
// Zipchat sends chat sessions to Zendesk as a plain-text transcript where each
// line is prefixed with the speaker name (e.g. "Visiteur: ..." / "Zipchat: ...").
// We detect that pattern and re-render as chat bubbles.

interface ZipchatLine { role: 'customer' | 'agent'; text: string }

const ZIPCHAT_CUSTOMER_RE = /^(Visiteur|Visitor|Client|Customer|User)\s*:\s*/i
const ZIPCHAT_EITHER_RE   = /^(Visiteur|Visitor|Client|Customer|User|Zipchat|Bot|Agent|Assistant|IA|Steero|Moom|Mōom)\s*:\s*/i

function parseZipchatTranscript(body: string): ZipchatLine[] | null {
  const lines = body.split('\n').map(l => l.trim()).filter(Boolean)
  const matchingLines = lines.filter(l => ZIPCHAT_EITHER_RE.test(l))
  // Require at least 2 speaker-labelled lines AND ≥40% of non-empty lines matching
  // to avoid false positives on tickets that happen to contain a ":" on one line.
  if (matchingLines.length < 2 || matchingLines.length / lines.length < 0.4) return null
  return matchingLines
    .map(line => ({
      role: ZIPCHAT_CUSTOMER_RE.test(line) ? ('customer' as const) : ('agent' as const),
      text: line.replace(ZIPCHAT_EITHER_RE, '').trim(),
    }))
    .filter(m => m.text.length > 0)
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

        const attachments = c.attachments ?? []

        // Zipchat transcript — render as chat bubbles
        const zipchatMessages = c.body ? parseZipchatTranscript(c.body) : null
        if (zipchatMessages && zipchatMessages.length >= 2) {
          return (
            <div key={c.id ?? i} className="rounded-xl border border-[#e8e8e4] overflow-hidden">
              <div className="flex items-center gap-2 px-4 py-2 bg-[#f5f4f2] border-b border-[#e8e8e4]">
                <span className="text-[10px] font-bold uppercase tracking-[0.08em] text-[#6b6b63]">💬 Conversation Zipchat</span>
                <span className="text-[10px] text-[#aeb0c9]">· {dateStr}</span>
              </div>
              <div className="px-4 py-3 space-y-2 bg-white">
                {zipchatMessages.map((bubble, bi) => (
                  <div key={bi} className={`flex ${bubble.role === 'customer' ? 'justify-end' : 'justify-start'}`}>
                    <div className={`max-w-[80%] px-3 py-2 rounded-2xl text-xs leading-relaxed ${
                      bubble.role === 'customer'
                        ? 'bg-[#f0f0f0] text-[#1a1a2e]'
                        : 'bg-[#3c81f5] text-white'
                    }`}>
                      {bubble.text}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )
        }

        return (
          <div key={c.id ?? i} className={`flex flex-col gap-1 ${isAgent ? 'items-start' : 'items-end'}`}>
            <span className="text-[10px] text-[#aeb0c9] px-1">{isAgent ? 'Agent' : 'Client'} · {dateStr}</span>
            <div className={`max-w-[82%] px-3.5 py-2.5 rounded-2xl text-xs leading-relaxed ${
              isAgent
                ? 'bg-[#eeeeff] text-[#1a1a2e] rounded-tl-sm'
                : 'bg-[#1a1a2e] text-white rounded-tr-sm'
            }`}>
              {c.body && (
                <p className="whitespace-pre-wrap break-words">{c.body}</p>
              )}
              {attachments.length > 0 && (
                <div className={`flex flex-col gap-2 ${c.body ? 'mt-2.5' : ''}`}>
                  {attachments.map(a => {
                    const isImage = a.content_type.startsWith('image/')
                    const isPdf   = a.content_type === 'application/pdf'
                    const sizeKb  = Math.round(a.size / 1024)
                    return (
                      <div key={a.id}>
                        {isImage ? (
                          <a href={a.content_url} target="_blank" rel="noopener noreferrer" title={a.file_name}>
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img
                              src={a.content_url}
                              alt={a.file_name}
                              className="max-w-full max-h-48 rounded-lg object-contain border border-[#e8e8e4] cursor-pointer hover:opacity-90 transition-opacity"
                            />
                            <p className="text-[10px] text-[#9b9b93] mt-1">{a.file_name} · {sizeKb} Ko</p>
                          </a>
                        ) : (
                          <a
                            href={a.content_url}
                            target="_blank"
                            rel="noopener noreferrer"
                            download={a.file_name}
                            className="inline-flex items-center gap-2 px-3 py-2 rounded-lg bg-white/20 border border-white/30 hover:bg-white/30 transition-colors group"
                          >
                            <span className="text-base leading-none">
                              {isPdf ? '📄' : '📎'}
                            </span>
                            <div className="min-w-0">
                              <p className="text-[11px] font-medium truncate">
                                {a.file_name}
                              </p>
                              <p className="text-[10px] opacity-70">{sizeKb} Ko</p>
                            </div>
                            <ExternalLink size={11} strokeWidth={1.8} className="opacity-50 shrink-0 ml-1" />
                          </a>
                        )}
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
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

        {/* Customer history */}
        <CustomerHistory email={ticket.customer_email} currentTicketId={ticket.ticket_id} />
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

interface AttachmentState {
  filename: string
  token:    string
}

function ReplyPanel({ ticket, draft, solved, onDraftChange, onSolvedChange, onSent, onArchive }: {
  ticket: ProcessedTicket
  draft: string; solved: boolean
  onDraftChange: (v: string) => void
  onSolvedChange: (v: boolean) => void
  onSent: (action: ReplyAction, wasModified?: boolean) => void
  onArchive: () => void
}) {
  const [sending, setSending]             = useState(false)
  const [archiving, setArchiving]         = useState(false)
  const [regenerating, setRegenerating]   = useState(false)
  const [deciding, setDeciding]           = useState(false)
  const [customDecision, setCustomDecision] = useState('')
  const [improving, setImproving]         = useState(false)
  const [previousDraft, setPreviousDraft] = useState<string | null>(null)
  const [error, setError]                 = useState<string | null>(null)
  const [showReason, setShowReason]       = useState(false)
  const [attachments, setAttachments]     = useState<AttachmentState[]>([])
  const [uploading, setUploading]         = useState(false)
  const fileInputRef                      = useRef<HTMLInputElement>(null)

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? [])
    if (files.length === 0) return
    e.target.value = ''

    setUploading(true); setError(null)
    try {
      const uploaded = await Promise.all(files.map(async file => {
        const form = new FormData()
        form.append('file', file)
        const res = await fetch('/api/sav/upload', { method: 'POST', body: form })
        const d   = await res.json() as { token?: string; filename?: string; error?: string }
        if (!res.ok) throw new Error(d.error ?? `HTTP ${res.status}`)
        return { filename: d.filename ?? file.name, token: d.token! }
      }))
      setAttachments(prev => [...prev, ...uploaded])
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur upload')
    } finally { setUploading(false) }
  }

  function removeAttachment(token: string) {
    setAttachments(prev => prev.filter(a => a.token !== token))
  }

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
      const uploads = attachments.map(a => a.token)
      const res = await fetch('/api/sav/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ticket_id: ticket.ticket_id, reply_body: draft, solved, action, category: ticket.category, uploads }),
      })
      if (!res.ok) { const d = await res.json(); throw new Error(d.error ?? `HTTP ${res.status}`) }
      const wasModified = draft.trim() !== ticket.draft_reply.trim()
      setAttachments([])
      onSent(action, wasModified)
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

  async function decide(option: DecisionOption) {
    setDeciding(true); setError(null)
    try {
      const res = await fetch('/api/sav/decide', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          subject:        ticket.subject,
          description:    ticket.description,
          category:       ticket.category,
          order:          ticket.order,
          customer_email: ticket.customer_email,
          decision_key:   option.key,
          decision_label: option.label,
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
    } finally { setDeciding(false) }
  }

  async function improve() {
    if (!draft.trim()) return
    setImproving(true); setError(null)
    setPreviousDraft(draft)
    try {
      const res = await fetch('/api/sav/improve', {
        method: 'POST',
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
    if (previousDraft !== null) {
      onDraftChange(previousDraft)
      setPreviousDraft(null)
    }
  }

  const showDecisionPanel = ticket.needs_decision && !draft

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

        {/* Situation détectée — ce que Claude a compris du dernier message */}
        {ticket.situation_detectee && (
          <div className="flex gap-2 items-start px-3 py-2 rounded-lg bg-[#f0f4ff] border border-[#c7d2fe]">
            <span className="text-[10px] shrink-0 mt-px">🎯</span>
            <p className="text-[11px] text-[#3730a3] leading-snug font-medium">
              {ticket.situation_detectee}
            </p>
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
            {ticket.reason}
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
              <>
                {(ticket.decision_options ?? []).map(opt => (
                  <button
                    key={opt.key}
                    onClick={() => decide(opt)}
                    className="flex items-center gap-2.5 px-4 py-3 rounded-xl border border-[#e8e8e4] bg-white hover:bg-[#f0efec] hover:border-[#aeb0c9] text-[12px] font-medium text-[#1a1a2e] transition-colors text-left"
                  >
                    <span className="text-base leading-none">{opt.emoji}</span>
                    {opt.label}
                  </button>
                ))}

                {/* Custom decision */}
                <div className="mt-1 flex gap-2">
                  <input
                    type="text"
                    value={customDecision}
                    onChange={e => setCustomDecision(e.target.value)}
                    onKeyDown={e => {
                      if (e.key === 'Enter' && customDecision.trim()) {
                        decide({ key: 'custom', label: customDecision.trim(), emoji: '✏️' })
                        setCustomDecision('')
                      }
                    }}
                    placeholder="Autre décision… (Entrée pour valider)"
                    className="flex-1 px-3 py-2.5 rounded-xl border border-[#e8e8e4] bg-white text-[12px] text-[#1a1a2e] placeholder-[#9b9b93] focus:outline-none focus:border-[#aeb0c9]"
                  />
                  <button
                    disabled={!customDecision.trim()}
                    onClick={() => {
                      decide({ key: 'custom', label: customDecision.trim(), emoji: '✏️' })
                      setCustomDecision('')
                    }}
                    className="px-3 py-2 rounded-xl border border-[#e8e8e4] bg-white hover:bg-[#f0efec] disabled:opacity-30 text-[#1a1a2e] transition-colors"
                  >
                    <ArrowRight size={14} />
                  </button>
                </div>
              </>
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
        {error && (
          <p className="text-[11px] text-[#c7293a] bg-[#fce8ea] rounded-lg px-3 py-2">{error}</p>
        )}

        {/* Attachment + Améliorer — toolbar row */}
        <input
          ref={fileInputRef}
          type="file"
          multiple
          className="hidden"
          onChange={handleFileChange}
          accept=".pdf,.jpg,.jpeg,.png,.gif,.webp,.zip,.doc,.docx,.xls,.xlsx"
        />

        {/* Attached files chips */}
        {attachments.length > 0 && (
          <div className="flex flex-col gap-1.5">
            {attachments.map(att => (
              <div key={att.token} className="flex items-center gap-2 px-3 py-2 rounded-lg bg-[#f0efec] border border-[#e0deda]">
                <Paperclip size={12} strokeWidth={1.8} className="text-[#6b6b63] shrink-0" />
                <span className="text-[11px] text-[#1a1a2e] truncate flex-1 font-medium">{att.filename}</span>
                <button onClick={() => removeAttachment(att.token)} className="shrink-0 text-[#9b9b93] hover:text-[#c7293a] transition-colors">
                  <X size={13} strokeWidth={2} />
                </button>
              </div>
            ))}
          </div>
        )}

        {/* Action buttons row */}
        <div className="flex items-center gap-2">
          {/* Joindre un fichier */}
          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={uploading || sending || archiving}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-[#e0deda] bg-white text-[11px] font-medium text-[#6b6b63] hover:bg-[#f0efec] hover:border-[#c8c6c0] transition-colors disabled:opacity-40"
          >
            {uploading
              ? <RefreshCw size={11} strokeWidth={1.8} className="animate-spin" />
              : <Paperclip size={11} strokeWidth={1.8} />}
            {uploading ? 'Upload…' : 'Joindre'}
          </button>

          {/* Améliorer ma réponse */}
          {!showDecisionPanel && draft.trim() && (
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
          )}

          {/* Undo amélioration */}
          {previousDraft !== null && !improving && (
            <button
              onClick={undoImprove}
              className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-[#e0deda] bg-white text-[11px] font-medium text-[#9b9b93] hover:bg-[#f0efec] hover:text-[#6b6b63] transition-colors"
            >
              ↩ Annuler
            </button>
          )}
        </div>

        {/* Bon de retour — auto-attach indicator */}
        {ticket.category === 'retour_remboursement' && (
          <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-[#e8f4fd] border border-[#bfdbfe]">
            <span className="text-[11px]">📎</span>
            <p className="text-[11px] text-[#1e40af] font-medium leading-snug">
              Bon de retour joint automatiquement
            </p>
          </div>
        )}

        {/* Colissimo reminder — shown when draft mentions exchange or credit note */}
        {ticket.category === 'retour_remboursement' && /échange|echange|avoir/i.test(draft) && (
          <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-[#fff7ed] border border-[#fed7aa]">
            <span className="text-[11px]">⚠️</span>
            <p className="text-[11px] text-[#c2410c] font-medium leading-snug">
              Pensez à joindre l&apos;étiquette Colissimo
            </p>
          </div>
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

// ─── Qualité SAV — left placeholder (the tab content is QualiteDashboard) ────

function QualitePanel() {
  return (
    <div className="flex flex-col items-center justify-center h-full gap-2 p-4 text-center">
      <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-[#aeb0c9]">Admin</p>
      <p className="text-xs text-[#9b9b93]">Métriques dans le panneau central</p>
    </div>
  )
}

// ─── Qualité SAV — main dashboard ────────────────────────────────────────────

interface DailyEntry { date: string; sessions: number; tickets: number }

interface QualiteMetrics {
  total: number; sent: number; escalated: number; archived: number
  pct_sent: number; pct_escalated: number; pct_archived: number
  avg_time_ms:       number | null
  modification_rate: number | null
  sessions_count:    number
  visits_per_day:    number
  avg_session_ms:    number | null
  total_session_ms:  number | null
  active_hours:      Record<number, number>
  active_weekdays:   Record<number, number>  // 1=Lun…7=Dim
  daily_timeline:    DailyEntry[]
  distinct_users:    string[]
  by_category: Record<string, { total: number; sent: number; escalated: number }>
}

const CAT_LABELS_FR: Record<string, string> = {
  suivi_livraison: 'Suivi livraison', retour_remboursement: 'Retour / Remb.',
  produit_defectueux: 'Produit défect.', modification_commande: 'Modif. commande',
  question_produit: 'Question produit', partenariat: 'Partenariat', autre: 'Autre',
}

function fmtMs(ms: number) {
  if (ms < 60_000) return `${Math.round(ms / 1000)}s`
  if (ms < 3_600_000) return `${Math.round(ms / 60_000)}min`
  const h = Math.floor(ms / 3_600_000)
  const m = Math.round((ms % 3_600_000) / 60_000)
  return m > 0 ? `${h}h${m}min` : `${h}h`
}

function GaugeBar({ value, color }: { value: number; color: string }) {
  return (
    <div className="w-full h-2 bg-[#f0efec] rounded-full overflow-hidden">
      <div
        className="h-full rounded-full transition-all duration-700"
        style={{ width: `${Math.min(100, value)}%`, backgroundColor: color }}
      />
    </div>
  )
}

function QualiteDashboard() {
  const [metrics, setMetrics]       = useState<QualiteMetrics | null>(null)
  const [loading, setLoading]       = useState(true)
  const [error, setError]           = useState<string | null>(null)
  const [days, setDays]             = useState(7)
  const [selectedUser, setSelectedUser] = useState<string>('')  // '' = tous

  useEffect(() => {
    setLoading(true); setError(null)
    const params = new URLSearchParams({ days: String(days) })
    if (selectedUser) params.set('user_email', selectedUser)
    fetch(`/api/sav/actions?${params}`)
      .then(r => r.json())
      .then(d => {
        if (d.error) throw new Error(d.error)
        setMetrics(d.metrics)
      })
      .catch(e => setError(e instanceof Error ? e.message : 'Erreur'))
      .finally(() => setLoading(false))
  }, [days, selectedUser])

  return (
    <div className="flex flex-col h-full overflow-y-auto px-8 py-6 gap-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-[#aeb0c9]">Admin · SAV Mōom</p>
          <h2 className="text-base font-bold text-[#1a1a2e] mt-0.5">Qualité SAV</h2>
        </div>
        <div className="flex flex-col items-end gap-2">
          {/* Filtre période */}
          <div className="flex gap-1.5">
            {[7, 30].map(d => (
              <button
                key={d}
                onClick={() => setDays(d)}
                className={`px-3 py-1.5 rounded-lg text-[11px] font-semibold transition-colors ${
                  days === d
                    ? 'bg-[#1a1a2e] text-white'
                    : 'bg-[#f3f3f1] text-[#6b6b63] hover:bg-[#eeede9]'
                }`}
              >
                {d}j
              </button>
            ))}
          </div>
          {/* Filtre utilisateur — affiché dès que plusieurs emails détectés */}
          {metrics && metrics.distinct_users.length > 0 && (
            <div className="flex flex-wrap gap-1 justify-end">
              <button
                onClick={() => setSelectedUser('')}
                className={`px-2.5 py-1 rounded-lg text-[10px] font-semibold transition-colors ${
                  selectedUser === ''
                    ? 'bg-[#1a1a2e] text-white'
                    : 'bg-[#f3f3f1] text-[#6b6b63] hover:bg-[#eeede9]'
                }`}
              >
                Tous
              </button>
              {metrics.distinct_users.map(email => {
                const short = email.split('@')[0]
                return (
                  <button
                    key={email}
                    onClick={() => setSelectedUser(email)}
                    title={email}
                    className={`px-2.5 py-1 rounded-lg text-[10px] font-semibold transition-colors ${
                      selectedUser === email
                        ? 'bg-[#6366f1] text-white'
                        : 'bg-[#f3f3f1] text-[#6b6b63] hover:bg-[#eeede9]'
                    }`}
                  >
                    {short}
                  </button>
                )
              })}
            </div>
          )}
        </div>
      </div>

      {loading && (
        <div className="space-y-3">
          {[1,2,3].map(i => <div key={i} className="h-16 bg-[#f3f3f1] rounded-2xl animate-pulse" />)}
        </div>
      )}

      {error && (
        <div className="rounded-xl bg-[#fce8ea] border border-[#fecaca] px-4 py-3 text-xs text-[#c7293a]">
          {error.includes('does not exist') || error.includes('relation')
            ? "La table sav_actions n'existe pas encore. Créez-la dans Supabase : CREATE TABLE sav_actions (id uuid DEFAULT gen_random_uuid() PRIMARY KEY, ticket_id integer NOT NULL, action text NOT NULL, was_modified boolean, category text, confidence numeric, time_to_action_ms integer, created_at timestamptz DEFAULT now() NOT NULL);"
            : error}
        </div>
      )}

      {!loading && !error && metrics && (
        <>
          {metrics.total === 0 ? (
            <div className="flex flex-col items-center justify-center gap-3 py-16 text-center">
              <p className="text-3xl">📊</p>
              <p className="text-sm font-semibold text-[#1a1a2e]">Pas encore de données</p>
              <p className="text-xs text-[#9b9b93] max-w-xs">Les métriques s&apos;accumuleront au fur et à mesure que l&apos;équipe traite des tickets.</p>
            </div>
          ) : (
            <>
              {/* KPI grid — 6 cards, 2 colonnes */}
              <div className="grid grid-cols-2 gap-3">
                {/* Ligne 1 — tickets */}
                <div className="rounded-2xl bg-[#f8f7f5] border border-[#e8e8e4] px-5 py-4">
                  <p className="text-[10px] font-semibold uppercase tracking-[0.1em] text-[#aeb0c9]">Tickets traités</p>
                  <p className="text-3xl font-bold text-[#1a1a2e] mt-1">{metrics.total}</p>
                  <p className="text-[10px] text-[#9b9b93] mt-0.5">sur {days} jours</p>
                </div>

                <div className="rounded-2xl bg-[#f8f7f5] border border-[#e8e8e4] px-5 py-4">
                  <p className="text-[10px] font-semibold uppercase tracking-[0.1em] text-[#aeb0c9]">Tps moyen / ticket</p>
                  <p className="text-3xl font-bold text-[#1a1a2e] mt-1">
                    {metrics.avg_time_ms !== null ? fmtMs(metrics.avg_time_ms) : '—'}
                  </p>
                  <p className="text-[10px] text-[#9b9b93] mt-0.5">de la sélection à l&apos;envoi</p>
                </div>

                {/* Ligne 2 — temps dans Steero */}
                <div className="col-span-2 rounded-2xl bg-[#1a1a2e] px-5 py-4">
                  <p className="text-[10px] font-semibold uppercase tracking-[0.1em] text-white/40">Temps total dans Steero</p>
                  <p className="text-3xl font-bold text-white mt-1">
                    {metrics.total_session_ms !== null ? fmtMs(metrics.total_session_ms) : '—'}
                  </p>
                  <p className="text-[10px] text-white/40 mt-0.5">
                    {metrics.sessions_count} session{metrics.sessions_count > 1 ? 's' : ''} · moy.{' '}
                    {metrics.avg_session_ms !== null ? fmtMs(metrics.avg_session_ms) : '?'} par visite
                  </p>
                </div>

                {/* Ligne 3 — brouillons & visites */}
                <div className="rounded-2xl bg-[#f8f7f5] border border-[#e8e8e4] px-5 py-4">
                  <p className="text-[10px] font-semibold uppercase tracking-[0.1em] text-[#aeb0c9]">Brouillons modifiés</p>
                  <p className="text-3xl font-bold text-[#1a1a2e] mt-1">
                    {metrics.modification_rate !== null ? `${metrics.modification_rate}%` : '—'}
                  </p>
                  <p className="text-[10px] text-[#9b9b93] mt-0.5">des réponses envoyées retouchées</p>
                </div>

                <div className="rounded-2xl bg-[#f8f7f5] border border-[#e8e8e4] px-5 py-4">
                  <p className="text-[10px] font-semibold uppercase tracking-[0.1em] text-[#aeb0c9]">Ouvertures / jour</p>
                  <p className="text-3xl font-bold text-[#1a1a2e] mt-1">
                    {metrics.sessions_count > 0 ? metrics.visits_per_day : '—'}
                  </p>
                  <p className="text-[10px] text-[#9b9b93] mt-0.5">{metrics.sessions_count} ouvertures sur {days}j</p>
                </div>
              </div>

              {/* Heures d'activité — heure Paris */}
              {Object.keys(metrics.active_hours).length > 0 && (() => {
                const BAR_H = 52
                const max   = Math.max(...Object.values(metrics.active_hours), 1)
                const peak  = Object.entries(metrics.active_hours).reduce((a, b) => b[1] > a[1] ? b : a)
                // Couleur : intensité → dégradé violet clair → indigo foncé
                function hourColor(count: number) {
                  if (count === 0) return '#ede9fe'
                  const r = count / max
                  if (r < 0.35) return '#a5b4fc'  // indigo-300
                  if (r < 0.7)  return '#6366f1'  // indigo-500
                  return '#4338ca'                 // indigo-700
                }
                return (
                  <div className="rounded-2xl bg-[#f5f3ff] border border-[#e0e7ff] px-5 py-5">
                    <div className="flex items-center justify-between mb-3">
                      <p className="text-[10px] font-semibold uppercase tracking-[0.1em] text-[#6366f1]">Heures d&apos;activité</p>
                      <span className="text-[9px] text-[#a5b4fc]">heure Paris · pic : {peak[0]}h ({peak[1]} sess.)</span>
                    </div>
                    {/* Compteurs au-dessus des barres actives */}
                    <div className="flex gap-px mb-1" style={{ height: 12 }}>
                      {Array.from({ length: 24 }, (_, h) => {
                        const count = metrics.active_hours[h] ?? 0
                        return (
                          <div key={h} className="flex-1 flex justify-center items-center">
                            {count > 0 && (
                              <span className="text-[7px] font-bold tabular-nums" style={{ color: hourColor(count) }}>
                                {count}
                              </span>
                            )}
                          </div>
                        )
                      })}
                    </div>
                    {/* Barres */}
                    <div className="flex items-end gap-px" style={{ height: BAR_H }}>
                      {Array.from({ length: 24 }, (_, h) => {
                        const count = metrics.active_hours[h] ?? 0
                        const barH  = count > 0 ? Math.max(Math.round((count / max) * BAR_H), 4) : 2
                        return (
                          <div
                            key={h}
                            className="flex-1 rounded-sm transition-all"
                            style={{ height: barH, backgroundColor: hourColor(count) }}
                            title={`${h}h : ${count} session${count > 1 ? 's' : ''}`}
                          />
                        )
                      })}
                    </div>
                    {/* Labels heures */}
                    <div className="flex gap-px mt-1.5">
                      {Array.from({ length: 24 }, (_, h) => (
                        <div key={h} className="flex-1 flex justify-center">
                          {h % 6 === 0 && <span className="text-[7px] text-[#a5b4fc] tabular-nums">{h}h</span>}
                        </div>
                      ))}
                    </div>
                  </div>
                )
              })()}

              {/* Jours de la semaine */}
              {(() => {
                const DAY_LABELS = ['', 'Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim']
                const DAY_FULL   = ['', 'Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi', 'Dimanche']
                const BAR_H = 64
                const max   = Math.max(...Object.values(metrics.active_weekdays), 1)
                const hasDays = Object.keys(metrics.active_weekdays).length > 0
                const peak  = hasDays
                  ? Object.entries(metrics.active_weekdays).reduce((a, b) => b[1] > a[1] ? b : a)
                  : null
                // Couleur : semaine = vert émeraude, WE = gris bleu
                function dayColor(d: number, count: number) {
                  if (count === 0) return '#e2e8f0'
                  if (d >= 6) return '#94a3b8'      // slate-400 pour WE
                  const r = count / max
                  if (r < 0.35) return '#6ee7b7'    // emerald-300
                  if (r < 0.7)  return '#10b981'    // emerald-500
                  return '#059669'                   // emerald-600
                }
                return (
                  <div className="rounded-2xl bg-[#f0fdf4] border border-[#d1fae5] px-5 py-5">
                    <div className="flex items-center justify-between mb-1">
                      <p className="text-[10px] font-semibold uppercase tracking-[0.1em] text-[#10b981]">Jours de la semaine</p>
                      {peak && <span className="text-[9px] text-[#6ee7b7]">pic : {DAY_FULL[Number(peak[0])]}</span>}
                    </div>
                    {/* Compteur + label au-dessus de chaque barre */}
                    <div className="flex gap-2 mb-2">
                      {[1, 2, 3, 4, 5, 6, 7].map(d => {
                        const count = metrics.active_weekdays[d] ?? 0
                        return (
                          <div key={d} className="flex-1 flex flex-col items-center gap-0.5">
                            <span className="text-[10px] font-bold tabular-nums" style={{ color: count > 0 ? dayColor(d, count) : '#cbd5e1' }}>
                              {count > 0 ? count : '—'}
                            </span>
                            <span className="text-[8px]" style={{ color: count > 0 ? (d >= 6 ? '#94a3b8' : '#34d399') : '#cbd5e1' }}>
                              sess.
                            </span>
                          </div>
                        )
                      })}
                    </div>
                    {/* Barres */}
                    <div className="flex items-end gap-2" style={{ height: BAR_H }}>
                      {[1, 2, 3, 4, 5, 6, 7].map(d => {
                        const count = metrics.active_weekdays[d] ?? 0
                        const barH  = count > 0 ? Math.max(Math.round((count / max) * BAR_H), 6) : 3
                        return (
                          <div
                            key={d}
                            className="flex-1 rounded-lg transition-all"
                            style={{ height: barH, backgroundColor: dayColor(d, count) }}
                            title={`${DAY_LABELS[d]} : ${count} session${count > 1 ? 's' : ''}`}
                          />
                        )
                      })}
                    </div>
                    {/* Labels jours */}
                    <div className="flex gap-2 mt-2">
                      {[1, 2, 3, 4, 5, 6, 7].map(d => {
                        const count = metrics.active_weekdays[d] ?? 0
                        return (
                          <div key={d} className="flex-1 flex justify-center">
                            <span className="text-[9px] font-semibold" style={{ color: count > 0 ? (d >= 6 ? '#94a3b8' : '#059669') : '#cbd5e1' }}>
                              {DAY_LABELS[d]}
                            </span>
                          </div>
                        )
                      })}
                    </div>
                  </div>
                )
              })()}

              {/* Timeline journalière */}
              {metrics.daily_timeline.length > 0 && (() => {
                const maxTickets = Math.max(...metrics.daily_timeline.map(e => e.tickets), 1)
                return (
                  <div className="rounded-2xl bg-[#fafaf9] border border-[#e8e8e4] px-5 py-5">
                    <p className="text-[10px] font-semibold uppercase tracking-[0.1em] text-[#aeb0c9] mb-3">Activité par jour</p>
                    <div className="space-y-2.5">
                      {metrics.daily_timeline.map(entry => {
                        const d   = new Date(entry.date + 'T12:00:00')
                        const label = d.toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric', month: 'short' })
                        const isWE = d.getDay() === 0 || d.getDay() === 6
                        const pct  = Math.round((entry.tickets / maxTickets) * 100)
                        const active = entry.sessions > 0
                        return (
                          <div key={entry.date} className="flex items-center gap-3">
                            <span className={`text-[10px] w-20 shrink-0 capitalize font-medium ${isWE ? 'text-[#94a3b8]' : active ? 'text-[#1a1a2e]' : 'text-[#aeb0c9]'}`}>
                              {label}
                            </span>
                            <div className="flex-1 h-2.5 bg-[#e8e8e4] rounded-full overflow-hidden">
                              {entry.tickets > 0 && (
                                <div
                                  className="h-full rounded-full transition-all"
                                  style={{
                                    width: `${pct}%`,
                                    backgroundColor: isWE ? '#94a3b8' : '#6366f1',
                                  }}
                                />
                              )}
                            </div>
                            <div className="flex items-center gap-2 shrink-0">
                              <span className={`text-[10px] font-bold w-16 text-right tabular-nums ${entry.tickets > 0 ? (isWE ? 'text-[#94a3b8]' : 'text-[#6366f1]') : 'text-[#d0cfc9]'}`}>
                                {entry.tickets > 0 ? `${entry.tickets} ticket${entry.tickets > 1 ? 's' : ''}` : '—'}
                              </span>
                              <span className="text-[9px] text-[#aeb0c9] w-14 tabular-nums">
                                {active ? `${entry.sessions} sess.` : 'absent'}
                              </span>
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  </div>
                )
              })()}

              {/* Action breakdown */}
              <div className="rounded-2xl bg-[#f8f7f5] border border-[#e8e8e4] px-5 py-5">
                <p className="text-[10px] font-semibold uppercase tracking-[0.1em] text-[#aeb0c9] mb-4">Répartition des actions</p>
                <div className="space-y-3">
                  {[
                    { label: 'Envoyés', pct: metrics.pct_sent,      count: metrics.sent,      color: '#1a7f4b' },
                    { label: 'Escaladés', pct: metrics.pct_escalated, count: metrics.escalated, color: '#b45309' },
                    { label: 'Archivés', pct: metrics.pct_archived,  count: metrics.archived,  color: '#6b6b63' },
                  ].map(({ label, pct, count, color }) => (
                    <div key={label}>
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-xs text-[#1a1a2e] font-medium">{label}</span>
                        <span className="text-xs text-[#6b6b63]">{pct}% <span className="text-[#aeb0c9]">({count})</span></span>
                      </div>
                      <GaugeBar value={pct} color={color} />
                    </div>
                  ))}
                </div>
              </div>

              {/* Category breakdown */}
              {Object.keys(metrics.by_category).length > 0 && (
                <div className="rounded-2xl bg-[#f8f7f5] border border-[#e8e8e4] px-5 py-5">
                  <p className="text-[10px] font-semibold uppercase tracking-[0.1em] text-[#aeb0c9] mb-4">Par catégorie</p>
                  <div className="space-y-2">
                    {Object.entries(metrics.by_category)
                      .sort((a, b) => b[1].total - a[1].total)
                      .map(([cat, stats]) => (
                        <div key={cat} className="flex items-center justify-between text-xs">
                          <span className="text-[#1a1a2e] font-medium">{CAT_LABELS_FR[cat] ?? cat}</span>
                          <div className="flex items-center gap-3 text-[#9b9b93]">
                            <span>{stats.total} tickets</span>
                            <span className="text-[#1a7f4b]">{stats.sent} envoyés</span>
                            {stats.escalated > 0 && <span className="text-[#b45309]">{stats.escalated} escaladés</span>}
                          </div>
                        </div>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}
        </>
      )}
    </div>
  )
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function SavPage() {
  const [rawTickets, setRawTickets]         = useState<RawTicket[]>([])
  const [assignments, setAssignments]       = useState<Record<number, string>>({})
  const [myEmail, setMyEmail]               = useState('')
  const [myName, setMyName]                 = useState('')
  const [assigneeFilter, setAssigneeFilter] = useState<string>('')  // '' = tous · 'unassigned' · nom d'agent
  const filterInit                          = useRef(false)
  const [processedCache, setProcessedCache] = useState<Record<number, ProcessedTicket>>({})
  const [selectedId, setSelectedId]         = useState<number | null>(null)
  const [processingId, setProcessingId]     = useState<number | null>(null)
  const [listLoading, setListLoading]       = useState(true)
  const [doneStatuses, setDoneStatuses]     = useState<Record<number, { action: 'sent' | 'escalated' | 'archived'; doneAt: string }>>({})
  const [drafts, setDrafts]                 = useState<Record<number, string>>({})
  const [solvedMap, setSolvedMap]           = useState<Record<number, boolean>>({})
  const [tab, setTab]                       = useState<'pending' | 'done' | 'qualite'>('pending')
  const [showRules, setShowRules]           = useState(false)
  const [importing, setImporting]           = useState(false)
  const [importMsg, setImportMsg]           = useState<string | null>(null)
  const [commentRefreshKey, setCommentRefreshKey] = useState(0)
  const [role, setRole]                     = useState<string | null>(null)
  // New message modal
  const [showNewMsg, setShowNewMsg]         = useState(false)
  const [newMsgTo, setNewMsgTo]             = useState('')
  const [newMsgSubject, setNewMsgSubject]   = useState('')
  const [newMsgBody, setNewMsgBody]         = useState('')
  const [newMsgSending, setNewMsgSending]   = useState(false)
  const [newMsgError, setNewMsgError]       = useState<string | null>(null)
  const [newMsgSent, setNewMsgSent]         = useState(false)
  // Tracks when each ticket was first selected (for time-to-action metric)
  const ticketStartTimes = useRef<Record<number, number>>({})
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const supabase = useMemo(() => createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  ), [])
  const firstLoad  = useRef(true)
  // Tracks in-flight process requests to avoid duplicate fetches
  const fetchingRef = useRef<Set<number>>(new Set())

  // ── Auth + session tracking ───────────────────────────────────────────────
  // On récupère l'email de l'utilisateur AVANT de loguer session_start,
  // pour pouvoir distinguer Satiana de l'admin dans les métriques.
  // L'email est stocké dans le champ `category` des events de session.
  useEffect(() => {
    let visibleSince  = Date.now()
    let accumulatedMs = 0
    let sent          = false
    let userEmail     = ''   // rempli dès que getUser() répond

    supabase.auth.getUser().then(({ data }) => {
      const r = (data.user?.user_metadata?.role as string | undefined) ?? 'admin'
      setRole(r)
      userEmail = data.user?.email ?? ''
      setMyEmail(userEmail)
      const meta = data.user?.user_metadata ?? {}
      const name = (meta.full_name ?? meta.name ?? '') as string
      setMyName(name)
      // Au 1er chargement, si l'utilisateur EST un agent SAV (Satiana/Todi), on
      // ouvre par défaut sur « ses » tickets. L'admin voit tout.
      if (!filterInit.current) {
        filterInit.current = true
        if ((ASSIGNEES as readonly string[]).includes(name)) setAssigneeFilter(name)
      }

      fetch('/api/sav/actions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'session_start', ticket_id: 0, category: userEmail }),
      }).catch(() => {})
    })

    function activeMs() {
      return accumulatedMs + (document.hidden ? 0 : Date.now() - visibleSince)
    }
    function handleVisibility() {
      if (document.hidden) { accumulatedMs += Date.now() - visibleSince }
      else                 { visibleSince = Date.now() }
    }
    function sendEnd() {
      if (sent) return
      sent = true
      const duration = activeMs()
      if (duration < 5_000) return
      navigator.sendBeacon('/api/sav/actions', new Blob(
        [JSON.stringify({ action: 'session_end', ticket_id: 0, time_to_action_ms: duration, category: userEmail })],
        { type: 'application/json' }
      ))
    }

    document.addEventListener('visibilitychange', handleVisibility)
    window.addEventListener('pagehide', sendEnd)
    window.addEventListener('beforeunload', sendEnd)
    return () => {
      document.removeEventListener('visibilitychange', handleVisibility)
      window.removeEventListener('pagehide', sendEnd)
      window.removeEventListener('beforeunload', sendEnd)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

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

      // If a ticket marked "done" in this session has is_reopened=true (client replied
      // after our action), pull it back to "En attente" automatically.
      setDoneStatuses(prev => {
        const next = { ...prev }
        let changed = false
        for (const t of data.tickets ?? []) {
          if (next[t.ticket_id] && t.is_reopened) {
            delete next[t.ticket_id]
            changed = true
          }
        }
        return changed ? next : prev
      })

      if (firstLoad.current) {
        firstLoad.current = false
        // Auto-select first actionable (non-pending) ticket
        const actionable = data.tickets.filter(t => t.status !== 'pending')
        const [first, ...rest] = actionable
        if (first) {
          setSelectedId(first.ticket_id)
          setCommentRefreshKey(n => n + 1)
          processTicket(first)
          // Pre-warm next 2 tickets in background so they're ready when user navigates
          rest.slice(0, 2).forEach(t => processTicket(t))
        }
      }
    } finally { setListLoading(false) }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => { load() }, [load])

  // ── Attributions des tickets (qui répond : Satiana / Todi) ────────────────
  useEffect(() => {
    fetch('/api/sav/assign')
      .then(r => r.json())
      .then(d => setAssignments(d.assignments ?? {}))
      .catch(() => {})
  }, [])

  async function assignTicket(ticketId: number, assignee: string | null) {
    setAssignments(prev => {
      const next = { ...prev }
      if (assignee) next[ticketId] = assignee
      else delete next[ticketId]
      return next
    })
    try {
      await fetch('/api/sav/assign', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ticket_id: ticketId, assignee, updated_by: myEmail }),
      })
    } catch { /* optimiste — l'UI reste à jour */ }
  }

  // ── Ticket click ──────────────────────────────────────────────────────────
  function handleTicketClick(raw: RawTicket) {
    setSelectedId(raw.ticket_id)
    setCommentRefreshKey(n => n + 1)
    // Record first-view time for time-to-action metric
    if (!ticketStartTimes.current[raw.ticket_id]) {
      ticketStartTimes.current[raw.ticket_id] = Date.now()
    }
    if (!processedCache[raw.ticket_id]) processTicket(raw)
  }

  // ── Action handlers ───────────────────────────────────────────────────────
  function advanceSelection(excludeId: number, doneAfter: Record<number, { action: string; doneAt: string }>) {
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

  function logAction(ticketId: number, action: 'sent' | 'escalated' | 'archived', wasModified?: boolean | null) {
    const processed = processedCache[ticketId]
    const startTime = ticketStartTimes.current[ticketId]
    const time_to_action_ms = startTime ? Date.now() - startTime : null
    fetch('/api/sav/actions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ticket_id:         ticketId,
        action,
        was_modified:      wasModified ?? null,
        category:          processed?.category ?? null,
        confidence:        processed?.confidence ?? null,
        time_to_action_ms,
      }),
    }).catch(err => console.warn('[SAV] logAction error:', err))
  }

  function handleSent(action: ReplyAction, wasModified?: boolean) {
    if (selectedId === null) return
    const status: 'escalated' | 'sent' = action === 'escalate' ? 'escalated' : 'sent'
    logAction(selectedId, status, action === 'escalate' ? null : (wasModified ?? null))
    const doneAfter = { ...doneStatuses, [selectedId]: { action: status, doneAt: new Date().toISOString() } }
    setDoneStatuses(doneAfter)
    advanceSelection(selectedId, doneAfter)
  }

  function handleArchive() {
    if (selectedId === null) return
    logAction(selectedId, 'archived', null)
    const doneAfter = { ...doneStatuses, [selectedId]: { action: 'archived' as const, doneAt: new Date().toISOString() } }
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
  // Filtre par personne assignée (« mes tickets »)
  const matchesAssignee = (t: RawTicket) => {
    if (!assigneeFilter) return true
    if (assigneeFilter === 'unassigned') return !assignments[t.ticket_id]
    return assignments[t.ticket_id] === assigneeFilter
  }
  const filteredTickets = rawTickets.filter(matchesAssignee)
  const allPending    = filteredTickets.filter(t => !doneStatuses[t.ticket_id])
  const donelist      = filteredTickets.filter(t =>  doneStatuses[t.ticket_id])
  // Actionable = new or open; waitingClient = pending (awaiting client reply)
  const actionable    = allPending.filter(t => t.status !== 'pending')
  const waitingClient = allPending.filter(t => t.status === 'pending')

  const selectedProcessed = selectedId != null ? (processedCache[selectedId] ?? null) : null
  const isProcessing      = processingId === selectedId && selectedId !== null

  return (
    <div className="h-screen overflow-hidden flex relative">

      {/* Rules overlay */}
      {showRules && <RulesPanel onClose={() => setShowRules(false)} />}

      {/* New message modal */}
      {showNewMsg && (
        <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-sm">
          <div className="bg-white rounded-2xl shadow-xl w-[520px] max-w-[95vw] flex flex-col">
            {/* Header */}
            <div className="flex items-center justify-between px-5 py-4 border-b border-[#e8e8e4]">
              <p className="text-sm font-bold text-[#1a1a2e]">Nouveau message</p>
              <button onClick={() => setShowNewMsg(false)} className="text-[#9b9b93] hover:text-[#1a1a2e] transition-colors">
                <X size={16} />
              </button>
            </div>

            {newMsgSent ? (
              <div className="px-5 py-10 flex flex-col items-center gap-3 text-center">
                <div className="w-10 h-10 rounded-full bg-[#e8f5e9] flex items-center justify-center text-[#1a7f4b] text-lg">✓</div>
                <p className="text-sm font-semibold text-[#1a1a2e]">Message envoyé !</p>
                <p className="text-[12px] text-[#6b6b63]">La cliente recevra un email et pourra répondre directement.</p>
                <button
                  onClick={() => { setShowNewMsg(false); setNewMsgTo(''); setNewMsgSubject(''); setNewMsgBody('') }}
                  className="mt-2 px-4 py-2 rounded-xl bg-[#1a1a2e] text-white text-[12px] font-semibold hover:bg-[#2d2d4a] transition-colors"
                >
                  Fermer
                </button>
              </div>
            ) : (
              <div className="px-5 py-4 flex flex-col gap-3">
                {newMsgError && (
                  <p className="text-[11px] text-red-500 bg-red-50 rounded-lg px-3 py-2">{newMsgError}</p>
                )}
                <div className="flex flex-col gap-1">
                  <label className="text-[10px] font-semibold text-[#9b9b93] uppercase tracking-wide">Email cliente</label>
                  <input
                    type="email"
                    value={newMsgTo}
                    onChange={e => setNewMsgTo(e.target.value)}
                    placeholder="cliente@example.com"
                    className="px-3 py-2.5 rounded-xl border border-[#e8e8e4] bg-white text-[12px] text-[#1a1a2e] placeholder-[#9b9b93] focus:outline-none focus:border-[#aeb0c9]"
                  />
                </div>
                <div className="flex flex-col gap-1">
                  <label className="text-[10px] font-semibold text-[#9b9b93] uppercase tracking-wide">Sujet</label>
                  <input
                    type="text"
                    value={newMsgSubject}
                    onChange={e => setNewMsgSubject(e.target.value)}
                    placeholder="Objet du message…"
                    className="px-3 py-2.5 rounded-xl border border-[#e8e8e4] bg-white text-[12px] text-[#1a1a2e] placeholder-[#9b9b93] focus:outline-none focus:border-[#aeb0c9]"
                  />
                </div>
                <div className="flex flex-col gap-1">
                  <label className="text-[10px] font-semibold text-[#9b9b93] uppercase tracking-wide">Message</label>
                  <textarea
                    value={newMsgBody}
                    onChange={e => setNewMsgBody(e.target.value)}
                    placeholder="Bonjour,&#10;&#10;…"
                    rows={7}
                    className="px-3 py-2.5 rounded-xl border border-[#e8e8e4] bg-white text-[12px] text-[#1a1a2e] placeholder-[#9b9b93] focus:outline-none focus:border-[#aeb0c9] resize-none leading-relaxed"
                  />
                </div>
                <div className="flex justify-end gap-2 pt-1 pb-1">
                  <button
                    onClick={() => setShowNewMsg(false)}
                    className="px-4 py-2 rounded-xl border border-[#e8e8e4] text-[12px] text-[#6b6b63] hover:bg-[#f0efec] transition-colors"
                  >
                    Annuler
                  </button>
                  <button
                    disabled={!newMsgTo.trim() || !newMsgSubject.trim() || !newMsgBody.trim() || newMsgSending}
                    onClick={async () => {
                      setNewMsgSending(true)
                      setNewMsgError(null)
                      try {
                        const res = await fetch('/api/sav/new-message', {
                          method: 'POST',
                          headers: { 'Content-Type': 'application/json' },
                          body: JSON.stringify({ to_email: newMsgTo, subject: newMsgSubject, body: newMsgBody }),
                        })
                        const data = await res.json() as { ticket_id?: number; error?: string }
                        if (!res.ok) throw new Error(data.error ?? 'Erreur inconnue')
                        setNewMsgSent(true)
                        load()
                      } catch (err) {
                        setNewMsgError(err instanceof Error ? err.message : 'Erreur inconnue')
                      } finally {
                        setNewMsgSending(false)
                      }
                    }}
                    className="px-4 py-2 rounded-xl bg-[#1a1a2e] text-white text-[12px] font-semibold hover:bg-[#2d2d4a] transition-colors disabled:opacity-40 flex items-center gap-2"
                  >
                    {newMsgSending
                      ? <><RefreshCw size={12} className="animate-spin" /> Envoi…</>
                      : <><Send size={12} strokeWidth={1.8} /> Envoyer</>
                    }
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── LEFT — ticket list ── */}
      <div className="w-[280px] shrink-0 flex flex-col border-r border-[#e8e8e4] bg-[#f8f7f5] overflow-hidden">

        {/* Left header */}
        <div className="px-4 pt-4 border-b border-[#eeede9] shrink-0">
          <div className="flex items-center justify-between mb-3">
            <div>
              <p className="text-[9px] font-semibold uppercase tracking-[0.12em] text-[#aeb0c9]">Mōom Paris</p>
              <p className="text-sm font-bold text-[#1a1a2e] mt-0.5">SAV</p>
            </div>
            <div className="flex items-center gap-1">
              <button
                onClick={() => { setShowNewMsg(true); setNewMsgSent(false); setNewMsgError(null) }}
                className="h-7 px-2.5 rounded-lg flex items-center gap-1.5 text-[11px] font-semibold text-white bg-[#1a1a2e] hover:bg-[#2d2d4a] transition-colors"
                title="Nouveau message"
              >
                <Plus size={12} strokeWidth={2.5} />
                Nouveau
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
            {role === 'admin' && (
              <button
                onClick={() => setTab('qualite')}
                className={`flex-1 flex items-center justify-center gap-1.5 py-2 text-[11px] font-semibold border-b-2 transition-colors ${
                  tab === 'qualite'
                    ? 'border-[#7e22ce] text-[#7e22ce]'
                    : 'border-transparent text-[#9b9b93] hover:text-[#6b6b63]'
                }`}
              >
                Qualité
              </button>
            )}
          </div>

          {/* Filtre par personne — « mes tickets » */}
          {tab !== 'qualite' && (
            <div className="flex items-center gap-1 pb-2 pt-2 overflow-x-auto">
              {([['', 'Tous'], ...ASSIGNEES.map(a => [a, a] as [string, string]), ['unassigned', 'Non attribué']] as [string, string][]).map(([val, label]) => {
                const active = assigneeFilter === val
                const isMine = !!val && val === myName
                return (
                  <button
                    key={val || 'all'}
                    onClick={() => setAssigneeFilter(val)}
                    className={`shrink-0 px-2.5 py-1 rounded-full text-[10px] font-semibold border transition-colors ${
                      active ? 'bg-[#1a1a2e] text-white border-[#1a1a2e]' : 'bg-white text-[#6b6b63] border-[#e8e8e4] hover:bg-[#f0efec]'
                    }`}
                  >
                    {label}{isMine ? ' (moi)' : ''}
                  </button>
                )
              })}
            </div>
          )}
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
                  assignee={assignments[t.ticket_id]}
                  processed={processedCache[t.ticket_id]}
                  selected={t.ticket_id === selectedId}
                  isProcessing={processingId === t.ticket_id}
                  doneAction={doneStatuses[t.ticket_id]?.action}
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
                        assignee={assignments[t.ticket_id]}
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
                  assignee={assignments[t.ticket_id]}
                  processed={processedCache[t.ticket_id]}
                  selected={t.ticket_id === selectedId}
                  doneAction={doneStatuses[t.ticket_id]?.action}
                  onClick={() => handleTicketClick(t)}
                />
              ))}
            </>
          )}

          {/* Qualité tab (admin only) */}
          {tab === 'qualite' && role === 'admin' && (
            <QualitePanel />
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

      {/* ── CENTER — ticket detail or qualite dashboard ── */}
      <div className="flex-1 flex flex-col overflow-hidden border-r border-[#e8e8e4] bg-white">
        {tab === 'qualite' && role === 'admin'
          ? <QualiteDashboard />
          : selectedId === null
            ? <CenterEmpty />
            : isProcessing && !selectedProcessed
              ? <CenterSkeleton />
              : selectedProcessed
                ? <>
                    <AssignBar ticketId={selectedProcessed.ticket_id} assignee={assignments[selectedProcessed.ticket_id]} onAssign={assignTicket} />
                    <TicketDetail ticket={selectedProcessed} refreshKey={commentRefreshKey} />
                  </>
                : <CenterEmpty />
        }
      </div>

      {/* ── RIGHT — reply panel or follow-up panel ── */}
      <div className="w-[380px] shrink-0 flex flex-col overflow-hidden bg-[#fafaf9]">
        {tab === 'qualite' ? null
        : selectedId === null ? (
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
