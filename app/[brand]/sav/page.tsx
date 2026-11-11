'use client'

import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import { createBrowserClient } from '@supabase/auth-helpers-nextjs'
import {
  RefreshCw, Send, ArrowUpRight, Archive, ExternalLink,
  Inbox, CheckCheck, ChevronDown, ChevronUp, Search,
  Settings, Trash2, Plus, X, Download, RotateCcw, Paperclip, ArrowRight, Forward,
  Clock, ChevronLeft, ChevronRight, UserPlus, Tag, Check, Mail, Copy, Sparkles, MoreHorizontal, PenSquare, Wand2,
} from 'lucide-react'
import { useUrlState } from '@/lib/useUrlState'
import { signatureFirstName } from '@/lib/sav/signature'

// ─── Marque courante (Moom ou Bowa) ─────────────────────────────────────────
// Le SAV est partagé entre Moom et Bowa (chacun son Zendesk). La marque est
// déduite de l'URL, et TOUS les appels /api/sav/* la passent en ?brand=.
function savBrand(): 'moom' | 'bowa' {
  if (typeof window === 'undefined') return 'moom'
  return window.location.pathname.split('/').filter(Boolean)[0] === 'bowa' ? 'bowa' : 'moom'
}
function savFetch(input: string, init?: RequestInit): Promise<Response> {
  const url = input + (input.includes('?') ? '&' : '?') + 'brand=' + savBrand()
  return fetch(url, init)
}
// Parse JSON de façon robuste : si le serveur renvoie une page d'erreur (HTML/texte,
// ex. 500/504 transitoire), on lève une erreur claire au lieu du cryptique
// « Unexpected token … is not valid JSON » qui cassait tout le SAV.
async function savJson<T = unknown>(res: Response, label = 'Le serveur'): Promise<T> {
  const text = await res.text()
  try {
    return JSON.parse(text) as T
  } catch {
    throw new Error(`${label} a renvoyé une réponse invalide (HTTP ${res.status}). Réessaie dans un instant.`)
  }
}
// Libellé de marque affiché dans l'en-tête du SAV.
function savBrandLabel(): string {
  return savBrand() === 'bowa' ? 'Bowa' : 'Mōom Paris'
}

// Degré de modification entre le brouillon IA et le texte envoyé (0 = identique,
// 1 = entièrement réécrit). Levenshtein normalisé, borné en longueur pour rester
// rapide. Sert à distinguer « une retouche » d'une « réécriture complète ».
function modificationRatio(aiDraft: string, sent: string): number {
  const a = (aiDraft || '').trim(), b = (sent || '').trim()
  if (a === b) return 0
  if (!a || !b) return 1
  const CAP = 4000
  const x = a.length > CAP ? a.slice(0, CAP) : a
  const y = b.length > CAP ? b.slice(0, CAP) : b
  const n = y.length
  let prev = Array.from({ length: n + 1 }, (_, j) => j)
  for (let i = 1; i <= x.length; i++) {
    const cur = [i]
    for (let j = 1; j <= n; j++) {
      const cost = x[i - 1] === y[j - 1] ? 0 : 1
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost)
    }
    prev = cur
  }
  return Math.min(1, prev[n] / Math.max(x.length, y.length))
}

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
  author_name?: string
  attachments: FileAttachment[]
}

// Minimal ticket from the fast list endpoint (no AI data)
interface RawTicket {
  requester_name?:  string
  requester_email?: string
  ticket_id:    number
  subject:      string
  description:  string
  created_at:   string
  updated_at:   string
  status:       'new' | 'open' | 'pending'
  requester_id: number
  is_reopened?: boolean
}

// Résultat de recherche Zendesk (tous statuts, y compris résolus)
interface SearchResult {
  ticket_id:       number
  subject:         string
  description:     string
  status:          string
  requester_id:    number
  requester_email?: string
  created_at:      string
  updated_at:      string
}
const STATUS_FR: Record<string, string> = {
  new: 'Nouveau', open: 'Ouvert', pending: 'En attente', hold: 'En pause', solved: 'Résolu', closed: 'Fermé',
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

// ─── Balises manuelles (identification rapide du souci) ─────────────────────────
// L'agent pose une balise sur un ticket pour voir d'un coup d'œil de quoi il s'agit.
const TICKET_TAGS: { key: string; label: string; bg: string; text: string }[] = [
  { key: 'en_attente',          label: 'En attente',          bg: '#f0efec', text: '#6b6b63' },
  { key: 'retour_expediteur',   label: 'Retour expéditeur',   bg: '#fef3c7', text: '#b45309' },
  { key: 'colis_perdu',         label: 'Colis perdu',         bg: '#fee2e2', text: '#c7293a' },
  { key: 'renvoi',              label: 'Renvoi à faire',      bg: '#e0f0ff', text: '#1565c0' },
  { key: 'remboursement',       label: 'Remboursement',       bg: '#fff3e0', text: '#e65100' },
  { key: 'litige_transporteur', label: 'Litige transporteur', bg: '#ede7f6', text: '#4527a0' },
  { key: 'attente_client',      label: 'Attente réponse client', bg: '#e0f7fa', text: '#00695c' },
  { key: 'resolu',              label: 'Réglé',               bg: '#e7f6ec', text: '#1a7f4b' },
]
const TAG_BY_KEY: Record<string, { label: string; bg: string; text: string }> =
  Object.fromEntries(TICKET_TAGS.map(t => [t.key, t]))

function fmtTime(iso: string) {
  const d = new Date(iso), now = new Date()
  const sameDay = d.toDateString() === now.toDateString()
  return sameDay
    ? d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })
    : d.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' })
}

// ─── Attribution des tickets (qui répond) ──────────────────────────────────────

// Agents par marque (chaque marque a ses propres agents SAV).
const ASSIGNEES_BY_BRAND: Record<'moom' | 'bowa', readonly string[]> = {
  moom: ['Satiana', 'Lary'],
  bowa: ['Léa', 'Lary', 'Satiana'],
}
function savAssignees(): readonly string[] {
  return ASSIGNEES_BY_BRAND[savBrand()]
}
const ASSIGNEE_COLORS: Record<string, [string, string]> = {
  Satiana: ['#ede9fe', '#6d28d9'],
  Lary:    ['#dbeafe', '#1d4ed8'],
  Léa:     ['#fce7f3', '#be185d'],
}

// ─── Personnes (avatars, noms) ──────────────────────────────────────────────────

// « marine-besson » / « marine.besson@… » → « Marine Besson ». Un vrai nom saisi
// (avec espace) est gardé tel quel.
function prettyName(name?: string | null, email?: string | null): string {
  const raw = (name ?? '').trim()
  if (raw && !raw.includes('@') && /\s/.test(raw)) return raw
  const base = raw && !raw.includes('@') ? raw : (email ?? '').split('@')[0]
  if (!base) return 'Client'
  return base.split(/[._\-+]+/).filter(Boolean).map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ')
}

function initials(name: string): string {
  const parts = name.split(/\s+/).filter(Boolean)
  return ((parts[0]?.[0] ?? '') + (parts.length > 1 ? parts[parts.length - 1][0] : parts[0]?.[1] ?? '')).toUpperCase()
}

const AVATAR_TONES: [string, string][] = [
  ['#fde2e4', '#c0264b'], ['#e0ecff', '#1d4ed8'], ['#e6f4ea', '#1a7f4b'],
  ['#fff1db', '#b45309'], ['#efe6ff', '#6d28d9'], ['#dff5f3', '#0f766e'],
]
function toneFor(key: string): [string, string] {
  let h = 0
  for (const ch of key) h = (h * 31 + ch.charCodeAt(0)) >>> 0
  return AVATAR_TONES[h % AVATAR_TONES.length]
}

function Avatar({ name, size = 28, tone, solid }: { name: string; size?: number; tone?: [string, string]; solid?: boolean }) {
  const [bg, fg] = tone ?? ASSIGNEE_COLORS[name] ?? toneFor(name)
  return (
    <span
      className="inline-flex items-center justify-center rounded-full font-semibold shrink-0 select-none"
      style={{ width: size, height: size, fontSize: Math.round(size * 0.38), background: solid ? fg : bg, color: solid ? '#fff' : fg }}
      aria-hidden
    >
      {initials(name)}
    </span>
  )
}

// « 42 min », « 3 h », « 2 j »
function ago(iso: string): string {
  const m = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000))
  if (m < 60) return `${m} min`
  const h = Math.round(m / 60)
  return h < 24 ? `${h} h` : `${Math.round(h / 24)} j`
}

function oneLine(text: string): string {
  return (text ?? '').replace(/\s+/g, ' ').trim()
}

function TicketRow({ raw, processed, selected, doneAction, isProcessing, onClick, assignee, tags, handoffFrom, agents, menuOpen, onOpenMenu, onAssignPick, compact }: {
  raw: RawTicket
  processed?: ProcessedTicket
  selected: boolean
  doneAction?: 'sent' | 'escalated' | 'archived'
  isProcessing?: boolean
  onClick: () => void
  assignee?: string
  tags?: string[]
  handoffFrom?: string
  agents?: readonly string[]
  menuOpen?: boolean
  onOpenMenu?: () => void
  onAssignPick?: (name: string | null) => void
  compact?: boolean   // « En attente client » : sujet + date + dernière action
}) {
  const name   = prettyName(raw.requester_name, raw.requester_email ?? processed?.customer_email)
  const unread = raw.is_reopened || raw.status === 'new'
  const waitMin = (Date.now() - new Date(raw.updated_at ?? raw.created_at).getTime()) / 60000
  const urgent = !compact && !doneAction && waitMin > 120
  const stop = (e: React.MouseEvent) => { e.preventDefault(); e.stopPropagation() }
  const muted = selected ? 'text-white/75' : 'text-[#6e6e73]'
  const chip = 'inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium shrink-0'

  const assigneeBadge = (
    <span
      role={onOpenMenu ? 'button' : undefined}
      tabIndex={onOpenMenu ? 0 : undefined}
      onClick={onOpenMenu ? (e) => { stop(e); onOpenMenu() } : undefined}
      title={assignee ? `Attribué à ${assignee}${onOpenMenu ? ' — changer' : ''}` : onOpenMenu ? 'Attribuer' : 'Non attribué'}
      className="shrink-0 rounded-full"
      style={selected ? { boxShadow: '0 0 0 2px rgba(255,255,255,.9)' } : undefined}
    >
      {assignee
        ? <Avatar name={assignee} size={22} />
        : <span className={`inline-flex items-center justify-center w-[22px] h-[22px] rounded-full border border-dashed text-[11px] ${selected ? 'border-white/60 text-white/80' : 'border-[#c7c7cc] text-[#8e8e93]'}`}>–</span>}
    </span>
  )

  return (
    <button
      onClick={onClick}
      className={`relative w-full text-left px-3 py-2.5 rounded-xl transition-colors ${
        selected ? 'bg-[#0a66f5] text-white' : raw.is_reopened ? 'bg-[#fff8e6] hover:bg-[#fff1cc]' : compact ? 'hover:bg-white' : 'hover:bg-[#ececef]'
      }`}
    >
      {compact ? (
        <>
          <div className="flex items-center gap-2">
            <span className={`text-[13px] truncate flex-1 ${selected ? 'text-white' : 'text-[#48484a]'}`}>{raw.subject || '(sans objet)'}</span>
            <span className={`text-[11px] shrink-0 ${muted}`}>{fmtTime(raw.created_at)}</span>
          </div>
          <div className="flex items-center gap-2 mt-0.5">
            <span className={`text-[12px] truncate flex-1 ${muted}`}>
              {[
                processed && !processed.is_phishing && processed.category !== 'autre' ? CAT_LABELS[processed.category] : null,
                ...(tags ?? []).map(t => TAG_BY_KEY[t]?.label).filter(Boolean),
                `relancé il y a ${ago(raw.updated_at ?? raw.created_at)}`,
              ].filter(Boolean).join(' · ')}
            </span>
            {assigneeBadge}
          </div>
        </>
      ) : (
        <>
          <div className="flex items-center gap-1.5">
            <span className={`w-2 h-2 rounded-full shrink-0 ${unread ? (selected ? 'bg-white' : 'bg-[#0a66f5]') : 'bg-transparent'}`} />
            <span className={`text-[13px] font-semibold truncate flex-1 ${selected ? 'text-white' : 'text-[#1d1d1f]'}`}>{name}</span>
            <span className={`text-[11px] shrink-0 ${muted}`}>{fmtTime(raw.updated_at ?? raw.created_at)}</span>
          </div>
          <p className={`text-[13px] font-medium truncate mt-0.5 pl-3.5 ${selected ? 'text-white' : 'text-[#1d1d1f]'}`}>{raw.subject || '(sans objet)'}</p>
          <p className={`text-[12px] leading-snug mt-0.5 pl-3.5 line-clamp-2 ${muted}`}>{oneLine(raw.description)}</p>
          <div className="flex items-center gap-1.5 mt-2 pl-3.5">
            <div className="flex items-center gap-1.5 flex-1 min-w-0 overflow-hidden">
              {!doneAction && (
                <span className={chip} style={selected ? { background: 'rgba(255,255,255,.2)', color: '#fff' } : urgent ? { background: '#fde8e8', color: '#c81e1e' } : { background: '#ececef', color: '#48484a' }}>
                  <Clock size={10} strokeWidth={2} /> {ago(raw.updated_at ?? raw.created_at)}
                </span>
              )}
              {raw.is_reopened && (
                <span className={chip} style={selected ? { background: 'rgba(255,255,255,.2)', color: '#fff' } : { background: '#fdecc8', color: '#a15c07' }}>Nouvelle réponse</span>
              )}
              {handoffFrom && (
                <span className={chip} style={selected ? { background: 'rgba(255,255,255,.2)', color: '#fff' } : { background: '#efe6ff', color: '#6d28d9' }}>de {handoffFrom}</span>
              )}
              {processed?.is_phishing && (
                <span className={chip} style={{ background: '#fde8e8', color: '#c81e1e' }}>Phishing</span>
              )}
              {processed && !processed.is_phishing && (
                <span className={chip} style={selected ? { background: 'rgba(255,255,255,.2)', color: '#fff' } : { background: CAT_COLORS[processed.category].bg, color: CAT_COLORS[processed.category].text }}>
                  {CAT_LABELS[processed.category]}
                </span>
              )}
              {(tags ?? []).map(t => TAG_BY_KEY[t] && (
                <span key={t} className={chip} style={selected ? { background: 'rgba(255,255,255,.2)', color: '#fff' } : { background: TAG_BY_KEY[t].bg, color: TAG_BY_KEY[t].text }}>{TAG_BY_KEY[t].label}</span>
              ))}
              {doneAction && (
                <span className={`${chip} ${selected ? 'text-white' : doneAction === 'escalated' ? 'text-[#b45309]' : 'text-[#1a7f4b]'}`}>
                  {doneAction === 'sent' ? <><CheckCheck size={11} /> Envoyé</> : doneAction === 'escalated' ? <><ArrowUpRight size={11} /> Escaladé</> : <><Archive size={11} /> Résolu</>}
                </span>
              )}
              {!processed && isProcessing && (
                <RefreshCw size={11} strokeWidth={1.8} className={`animate-spin shrink-0 ${selected ? 'text-white/60' : 'text-[#8e8e93]'}`} />
              )}
            </div>
            {assigneeBadge}
          </div>
        </>
      )}

      {/* Menu d'affectation rapide (depuis la liste) */}
      {menuOpen && agents && onAssignPick && (
        <span className="absolute right-2 top-full -mt-2 z-30 flex flex-col min-w-[150px] rounded-xl border border-[#e5e5ea] bg-white shadow-lg overflow-hidden py-1 text-[#1d1d1f]">
          <span className="px-3 py-1 text-[11px] text-[#8e8e93]">Attribuer à</span>
          {agents.map(a => (
            <span
              key={a}
              role="button"
              tabIndex={0}
              onClick={(e) => { stop(e); onAssignPick(a) }}
              className="flex items-center gap-2 px-3 py-1.5 text-[13px] hover:bg-[#f2f2f7]"
            >
              <Avatar name={a} size={18} /> {a}{assignee === a ? ' ✓' : ''}
            </span>
          ))}
          <span
            role="button"
            tabIndex={0}
            onClick={(e) => { stop(e); onAssignPick(null) }}
            className="px-3 py-1.5 text-[13px] text-[#8e8e93] hover:bg-[#f2f2f7] border-t border-[#f2f2f7]"
          >
            Retirer l&apos;attribution
          </span>
        </span>
      )}
    </button>
  )
}

// ─── Center column ────────────────────────────────────────────────────────────

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
    savFetch(`/api/sav/customer-history?email=${encodeURIComponent(email)}&exclude=${currentTicketId}`)
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
      const r = await savFetch(`/api/sav/customer-history?email=${encodeURIComponent(email)}&comments=1&ticket_id=${id}`)
      const d = await r.json() as { comments?: PastComment[] }
      setComments(prev => ({ ...prev, [id]: d.comments ?? [] }))
    } catch { /* ignore */ }
    finally { setLoadingCom(null) }
  }

  const statusColor = (s: string) =>
    s === 'open' ? 'text-blue-500' : s === 'solved' || s === 'closed' ? 'text-[#1a7f4b]' : 'text-[#9b9b93]'

  return (
    <div className="pt-3">
      <button
        onClick={() => setOpen(v => !v)}
        className="flex items-center gap-2 w-full text-left"
      >
        <h3 className="text-[14px] font-semibold text-[#1d1d1f] flex-1">Échanges précédents</h3>
        {open
          ? <ChevronUp size={14} className="text-[#8e8e93]" />
          : <ChevronDown size={14} className="text-[#8e8e93]" />}
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

function ConversationThread({ ticket, refreshKey, customerName }: { ticket: ProcessedTicket; refreshKey: number; customerName: string }) {
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

    savFetch(url, { cache: 'no-store', signal: controller.signal })
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
      <p className="rounded-2xl border border-[#e5e5ea] bg-white px-5 py-4 text-[14px] text-[#1d1d1f] leading-[1.6] whitespace-pre-wrap">
        {ticket.description ?? '—'}
      </p>
    )
  }

  return (
    <div className="space-y-4">
      {[...comments].reverse().map((c, i) => {
        const isAgent  = c.author_type === 'agent'
        const d        = new Date(c.created_at)
        const sameDay  = d.toDateString() === new Date().toDateString()
        const dateStr  = sameDay
          ? d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })
          : d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' }) + ' · ' +
            d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })
        const author   = isAgent ? (c.author_name?.trim() || `Équipe ${savBrandLabel()}`) : customerName
        const subline  = isAgent ? `Service client ${savBrandLabel()}` : ticket.customer_email

        const attachments = c.attachments ?? []

        // Zipchat transcript — render as chat bubbles
        const zipchatMessages = c.body ? parseZipchatTranscript(c.body) : null
        if (zipchatMessages && zipchatMessages.length >= 2) {
          return (
            <div key={c.id ?? i} className="rounded-2xl border border-[#e5e5ea] bg-white overflow-hidden">
              <div className="flex items-center gap-2 px-5 py-3 border-b border-[#f2f2f7]">
                <span className="text-[13px] font-semibold text-[#1d1d1f]">Conversation chat</span>
                <span className="text-[12px] text-[#8e8e93] ml-auto">{dateStr}</span>
              </div>
              <div className="px-5 py-4 space-y-2">
                {zipchatMessages.map((bubble, bi) => (
                  <div key={bi} className={`flex ${bubble.role === 'customer' ? 'justify-end' : 'justify-start'}`}>
                    <div className={`max-w-[80%] px-3 py-2 rounded-2xl text-[13px] leading-relaxed ${
                      bubble.role === 'customer' ? 'bg-[#f2f2f7] text-[#1d1d1f]' : 'bg-[#0a66f5] text-white'
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
          <div key={c.id ?? i} className={`flex ${isAgent ? 'justify-end' : 'justify-start'}`}>
          <article
            className={`w-[88%] rounded-2xl border px-5 py-4 ${isAgent ? 'bg-[#eaf2ff] border-[#d4e4ff] rounded-tr-md' : 'bg-white border-[#e5e5ea] rounded-tl-md'}`}
          >
            <header className={`flex items-start gap-3 mb-3 ${isAgent ? 'flex-row-reverse text-right' : ''}`}>
              <Avatar name={author} size={34} tone={isAgent ? ['#cfe0ff', '#0a58d0'] : undefined} />
              <div className="min-w-0 flex-1">
                <p className="text-[14px] font-semibold text-[#1d1d1f] leading-tight truncate">{author}</p>
                <p className="text-[12px] text-[#8e8e93] truncate">{subline}</p>
              </div>
              <time className="text-[12px] text-[#8e8e93] shrink-0" dateTime={c.created_at}>{dateStr}</time>
            </header>

            {c.body && (
              <p className={`text-[14px] leading-[1.6] text-[#1d1d1f] whitespace-pre-wrap break-words ${isAgent ? 'pr-[46px]' : 'pl-[46px]'}`}>{c.body.replace(/\n{3,}/g, '\n\n').trim()}</p>
            )}
            {attachments.length > 0 && (
              <div className={`flex flex-wrap gap-2 ${isAgent ? 'pr-[46px] justify-end' : 'pl-[46px]'} ${c.body ? 'mt-3' : ''}`}>
                {attachments.map(a => {
                  const isImage = a.content_type.startsWith('image/')
                  const isPdf   = a.content_type === 'application/pdf'
                  const sizeKb  = Math.round(a.size / 1024)
                  // Proxy authentifié : certains Zendesk (Bowa) exigent l'auth pour
                  // afficher les pièces jointes → on passe par notre serveur.
                  const proxied = `/api/sav/attachment?brand=${savBrand()}&url=${encodeURIComponent(a.content_url)}`
                  return isImage ? (
                    <a key={a.id} href={proxied} target="_blank" rel="noopener noreferrer" title={a.file_name}>
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={proxied} alt={a.file_name} className="max-h-40 rounded-xl object-contain border border-[#e5e5ea] hover:opacity-90 transition-opacity" />
                    </a>
                  ) : (
                    <a
                      key={a.id}
                      href={proxied}
                      target="_blank"
                      rel="noopener noreferrer"
                      download={a.file_name}
                      className="inline-flex items-center gap-2 px-3 py-2 rounded-xl bg-white border border-[#e5e5ea] hover:bg-[#f2f2f7] transition-colors"
                    >
                      <span className="text-base leading-none">{isPdf ? '📄' : '📎'}</span>
                      <span className="min-w-0">
                        <span className="block text-[12px] font-medium text-[#1d1d1f] truncate max-w-[220px]">{a.file_name}</span>
                        {sizeKb > 0 && <span className="block text-[11px] text-[#8e8e93]">{sizeKb} Ko</span>}
                      </span>
                    </a>
                  )
                })}
              </div>
            )}
          </article>
          </div>
        )
      })}
    </div>
  )
}

// ── Preuve de livraison (Bowa) ────────────────────────────────────────────────
// Remonte, dans le SAV, la livraison correspondant au client (date+heure signée
// par le livreur + signature + photo) pour traiter les plaintes.
type DeliveryStopProof = {
  order_name: string | null; customer_name: string | null; delivered_at: string | null
  status: string | null; signature_url: string | null; photo_url: string | null
  address1: string | null; zip: string | null; city: string | null; comment: string | null
}
const DELIVERY_STATUS: Record<string, { label: string; cls: string }> = {
  delivered: { label: 'Livré ✓',        cls: 'bg-[#dcf5e7] text-[#1a7f4b]' },
  partial:   { label: 'Partiel',        cls: 'bg-[#fef3c7] text-[#b45309]' },
  failed:    { label: 'Échec livraison', cls: 'bg-[#fce8ea] text-[#c7293a]' },
}
// Livraisons Bowa d'un client, par email et/ou n° de commande
function useDeliveryProof(email: string, order?: string | null) {
  const [stops, setStops] = useState<DeliveryStopProof[] | null>(null)
  useEffect(() => {
    if (savBrand() !== 'bowa' || (!email && !order)) { setStops(null); return }
    let cancelled = false
    const qs = new URLSearchParams()
    if (email) qs.set('email', email)
    if (order) qs.set('order', order)
    fetch(`/api/sav/delivery-proof?${qs}`, { cache: 'no-store' })
      .then(r => r.json())
      .then(d => { if (!cancelled) setStops(d.stops ?? []) })
      .catch(() => { if (!cancelled) setStops([]) })
    return () => { cancelled = true }
  }, [email, order])
  return stops
}

// « Reçue et signée le 29 octobre 2026 à 13:59 » (heure de Paris)
function receivedLine(s: DeliveryStopProof): string | null {
  if (!s.delivered_at) return null
  const d = new Date(s.delivered_at)
  const day = d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Europe/Paris' })
  const time = d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Paris' })
  const what = s.status === 'failed' ? 'Échec de livraison le'
    : s.status === 'partial' ? (s.signature_url ? 'Reçue en partie et signée le' : 'Reçue en partie le')
    : s.status === 'delivered' ? (s.signature_url ? 'Reçue et signée le' : 'Livrée (sans signature) le')
    : null
  return what ? `${what} ${day} à ${time}` : null
}

// Ligne compacte sous une commande : date et heure de réception / signature
function OrderReceivedLine({ order }: { order: string }) {
  const stops = useDeliveryProof('', order)
  const s = stops?.find(x => x.status === 'delivered' || x.status === 'partial') ?? stops?.[0]
  const line = s ? receivedLine(s) : null
  if (!line) return null
  return <p className={`text-[10px] font-medium mt-0.5 ${s!.status === 'failed' ? 'text-[#c7293a]' : 'text-[#1a7f4b]'}`}>✍️ {line}</p>
}

function BowaDeliveryProof({ email, order }: { email: string; order?: string | null }) {
  const stops = useDeliveryProof(email, order)

  if (savBrand() !== 'bowa' || !stops || stops.length === 0) return null

  return (
    <div>
      <p className="text-[10px] font-semibold uppercase tracking-[0.1em] text-[#aeb0c9] mb-3">Livraison (preuve)</p>
      <div className="space-y-3">
        {stops.map((s, i) => {
          const st = DELIVERY_STATUS[s.status ?? ''] ?? { label: s.status ?? 'En attente', cls: 'bg-[#eeede9] text-[#6b6b63]' }
          return (
            <div key={i} className="rounded-xl border border-[#e8e8e4] bg-white px-4 py-3">
              <div className="flex items-center gap-2 flex-wrap mb-1.5">
                <span className={`inline-flex px-2 py-0.5 rounded-full text-[10px] font-semibold ${st.cls}`}>{st.label}</span>
                {s.order_name && <span className="font-mono text-xs text-[#6b6b63]">{s.order_name}</span>}
              </div>
              {receivedLine(s) && <p className="text-sm font-medium text-[#1a1a2e]">✍️ {receivedLine(s)}</p>}
              {(s.address1 || s.city) && <p className="text-xs text-[#6b6b63] mt-0.5">{[s.address1, s.zip, s.city].filter(Boolean).join(' · ')}</p>}
              {s.comment && <p className="text-xs text-[#8a6d1f] mt-1">🗒 {s.comment}</p>}
              {(s.signature_url || s.photo_url) && (
                <div className="flex gap-3 mt-2 flex-wrap">
                  {s.signature_url && (
                    <a href={s.signature_url} target="_blank" rel="noreferrer">
                      <span className="block text-[10px] text-[#9b9b93] mb-1">Signature</span>
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={s.signature_url} alt="Signature" className="h-20 rounded-lg border border-[#e8e8e4] bg-white object-contain" />
                    </a>
                  )}
                  {s.photo_url && (
                    <a href={s.photo_url} target="_blank" rel="noreferrer">
                      <span className="block text-[10px] text-[#9b9b93] mb-1">Photo</span>
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={s.photo_url} alt="Photo livraison" className="h-20 rounded-lg border border-[#e8e8e4] object-cover" />
                    </a>
                  )}
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

const PILL = 'inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[12px] font-medium'

function TicketDetail({ ticket, refreshKey, customerName, assignee, tags }: {
  ticket: ProcessedTicket; refreshKey: number; customerName: string; assignee?: string; tags: string[]
}) {
  const statusPill = ticket.status === 'pending'
    ? <span className={PILL} style={{ background: '#ececef', color: '#48484a' }}>En attente client</span>
    : <span className={PILL} style={{ background: '#e0ecff', color: '#0a58d0' }}><span className="w-1.5 h-1.5 rounded-full bg-current" />{ticket.status === 'new' ? 'Nouveau' : 'Ouvert'}</span>
  return (
    <div className="max-w-[760px] mx-auto px-8 pt-6 pb-8">
      <h1 className="text-[24px] font-semibold text-[#1d1d1f] leading-tight tracking-[-0.01em]">{ticket.subject || '(sans objet)'}</h1>
      <div className="flex items-center gap-1.5 flex-wrap mt-3">
        {statusPill}
        {ticket.is_phishing
          ? <span className={PILL} style={{ background: '#fde8e8', color: '#c81e1e' }}>Phishing</span>
          : <span className={PILL} style={{ background: CAT_COLORS[ticket.category].bg, color: CAT_COLORS[ticket.category].text }}>{CAT_LABELS[ticket.category]}</span>}
        {ticket.action === 'escalate' && <span className={PILL} style={{ background: '#fff1db', color: '#b45309' }}>À escalader</span>}
        {tags.map(t => TAG_BY_KEY[t] && (
          <span key={t} className={PILL} style={{ background: TAG_BY_KEY[t].bg, color: TAG_BY_KEY[t].text }}>{TAG_BY_KEY[t].label}</span>
        ))}
        {ticket.partnership_email_sent === true && <span className={PILL} style={{ background: '#fdf4ff', color: '#7e22ce' }}>Transmis à Pauline</span>}
        {ticket.partnership_email_sent === false && <span className={PILL} style={{ background: '#fde8e8', color: '#c81e1e' }}>Email partenariat échoué</span>}
        {assignee
          ? <span className={`${PILL} pl-1 border border-[#e5e5ea] bg-white text-[#1d1d1f]`}><Avatar name={assignee} size={20} /> {assignee}</span>
          : <span className={`${PILL} border border-dashed border-[#c7c7cc] text-[#8e8e93]`}>Non attribué</span>}
      </div>

      {ticket.is_phishing && (
        <div className="mt-5 rounded-2xl bg-[#fef2f2] border border-[#fecaca] px-5 py-4">
          <p className="text-[14px] font-semibold text-[#c81e1e]">Tentative de phishing : ne clique sur aucun lien de ce message.</p>
          {ticket.phishing_signals && ticket.phishing_signals.length > 0 && (
            <ul className="text-[13px] text-[#7f1d1d] mt-1.5 space-y-0.5 list-disc list-inside">
              {ticket.phishing_signals.map((s, i) => <li key={i}>{s}</li>)}
            </ul>
          )}
        </div>
      )}

      <div className="mt-6">
        <ConversationThread ticket={ticket} refreshKey={refreshKey} customerName={customerName} />
      </div>

      <CustomerSection ticket={ticket} customerName={customerName} />
    </div>
  )
}

// Étapes de la commande (Shopify) : Payée → Préparation → Expédiée → Livrée.
function orderStep(order: MoomOrder): number {
  const f = order.status_fr.toLowerCase()
  if (/livr/.test(f)) return 3
  if (/expédi/.test(f)) return 2
  if (/paiement|annul/.test(order.financial_status_fr.toLowerCase())) return -1
  return 1
}

function OrderCard({ order }: { order: MoomOrder }) {
  const step = orderStep(order)
  const steps = ['Payée', 'Préparation', 'Expédiée', 'Livrée']
  const row = (label: string, value: React.ReactNode) => (
    <div className="flex items-baseline justify-between gap-3 py-1.5 text-[13px]">
      <span className="text-[#8e8e93] shrink-0">{label}</span>
      <span className="text-[#1d1d1f] font-medium text-right min-w-0 truncate">{value}</span>
    </div>
  )
  return (
    <section className="rounded-2xl bg-white border border-[#e5e5ea] p-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-[14px] font-semibold text-[#1d1d1f]">Commande {order.order_number?.startsWith('#') ? order.order_number : `#${order.order_number}`}</h3>
        <span className="text-[12px] text-[#8e8e93]">{new Date(order.created_at).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' })}</span>
      </div>
      {step >= 0 && (
        <ol className="grid grid-cols-4 mb-3" aria-label="Avancement de la commande">
          {steps.map((label, i) => (
            <li key={label} className="relative flex flex-col items-center gap-1.5">
              {i > 0 && <span className={`absolute top-[5px] right-1/2 w-full h-[2px] ${i <= step ? 'bg-[#34c759]' : 'bg-[#e5e5ea]'}`} />}
              <span className={`relative w-3 h-3 rounded-full ${i < step ? 'bg-[#34c759]' : i === step ? 'bg-white border-2 border-[#34c759]' : 'bg-[#e5e5ea]'}`} />
              <span className={`text-[11px] ${i === step ? 'font-semibold text-[#1d1d1f]' : 'text-[#8e8e93]'}`}>{label}</span>
            </li>
          ))}
        </ol>
      )}
      <div className="divide-y divide-[#f2f2f7]">
        {row('Paiement', order.financial_status_fr)}
        {row('Statut', order.status_fr)}
        {order.carrier && row('Transporteur', order.carrier)}
        {order.tracking_number && row('Suivi', order.tracking_url
          ? <a href={order.tracking_url} target="_blank" rel="noopener noreferrer" className="text-[#0a66f5] inline-flex items-center gap-1">{order.tracking_number}<ExternalLink size={11} /></a>
          : order.tracking_number)}
        {order.estimated_delivery && row('Livraison prévue', order.estimated_delivery)}
      </div>
      {order.order_number && <OrderReceivedLine order={order.order_number} />}
      {order.products.length > 0 && (
        <ul className="mt-2 pt-2 border-t border-[#f2f2f7] space-y-1">
          {order.products.map((p, i) => (
            <li key={i} className="flex justify-between gap-3 text-[13px]">
              <span className="text-[#1d1d1f] min-w-0"><span className="text-[#8e8e93]">{p.quantity}×</span> {p.name}</span>
              <span className="text-[#48484a] shrink-0 tabular-nums">{Number(p.price).toFixed(2).replace('.', ',')} €</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

// Ce que Claude a compris (en tête de la colonne de réponse).
function ClaudeSummary({ ticket }: { ticket: ProcessedTicket }) {
  const [showReason, setShowReason] = useState(false)
  useEffect(() => { setShowReason(false) }, [ticket.ticket_id])
  if (!ticket.situation_detectee && !ticket.reason) return null
  const pct = Math.round(ticket.confidence * 100)
  const confColor = ticket.confidence >= 0.85 ? '#1a7f4b' : ticket.confidence >= 0.6 ? '#b45309' : '#c81e1e'
  return (
    <section className="shrink-0 rounded-2xl bg-white border border-[#e5e5ea] p-3.5 max-h-[30vh] overflow-y-auto">
      <div className="flex items-center justify-between mb-1.5">
        <h3 className="text-[13px] font-semibold text-[#1d1d1f] flex items-center gap-1.5"><Sparkles size={13} className="text-[#7c3aed]" /> Claude a compris</h3>
        <span className="text-[12px] font-medium" style={{ color: confColor }}>Confiance {pct} %</span>
      </div>
      <p className="text-[13px] leading-relaxed text-[#1d1d1f]">{ticket.situation_detectee || ticket.reason}</p>
      {ticket.situation_detectee && ticket.reason && (
        <>
          <button onClick={() => setShowReason(v => !v)} className="mt-1.5 text-[12px] text-[#0a66f5] inline-flex items-center gap-0.5">
            {showReason ? 'Masquer' : 'Pourquoi cette réponse'} {showReason ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
          </button>
          {showReason && <p className="mt-1 text-[12px] leading-relaxed text-[#48484a]">{ticket.reason}</p>}
        </>
      )}
    </section>
  )
}

// Sous la conversation : le client, la commande, la preuve de livraison, l'historique.
function CustomerSection({ ticket, customerName }: { ticket: ProcessedTicket; customerName: string }) {
  const [copied, setCopied] = useState(false)
  useEffect(() => { setCopied(false) }, [ticket.ticket_id])
  return (
    <div className="mt-8 pt-6 border-t border-[#e5e5ea]">
      <h2 className="text-[15px] font-semibold text-[#1d1d1f] mb-3">Client et commande</h2>
      <div className="grid gap-3 md:grid-cols-2 items-start">
        <div className="space-y-3">
          <section className="rounded-2xl bg-white border border-[#e5e5ea] p-4 flex items-center gap-3">
            <Avatar name={customerName} size={44} solid tone={toneFor(customerName)} />
            <div className="min-w-0 flex-1">
              <p className="text-[15px] font-semibold text-[#1d1d1f] truncate">{customerName}</p>
              <p className="text-[12px] text-[#8e8e93] truncate">{ticket.customer_email}</p>
            </div>
            <a href={`mailto:${ticket.customer_email}`} title="Écrire un e-mail" className="w-8 h-8 rounded-full bg-[#f2f2f7] flex items-center justify-center text-[#0a66f5] hover:bg-[#e8e8ed]">
              <Mail size={14} strokeWidth={1.8} />
            </a>
            <button
              onClick={() => { navigator.clipboard?.writeText(ticket.customer_email).then(() => setCopied(true)).catch(() => {}) }}
              title="Copier l'adresse e-mail"
              className="w-8 h-8 rounded-full bg-[#f2f2f7] flex items-center justify-center text-[#0a66f5] hover:bg-[#e8e8ed]"
            >
              {copied ? <Check size={14} strokeWidth={2} /> : <Copy size={14} strokeWidth={1.8} />}
            </button>
          </section>
          <section className="rounded-2xl bg-white border border-[#e5e5ea] px-4 pb-3">
            <CustomerHistory email={ticket.customer_email} currentTicketId={ticket.ticket_id} />
          </section>
          <BowaDeliveryProof email={ticket.customer_email} order={ticket.order?.order_number} />
        </div>
        {ticket.order
          ? <OrderCard order={ticket.order} />
          : <section className="rounded-2xl border border-dashed border-[#d1d1d6] p-4 text-[13px] text-[#8e8e93]">Aucune commande Shopify trouvée pour ce client.</section>}
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

function ReplyPanel({ ticket, draft, solved, onDraftChange, onSolvedChange, onSent, onArchive, onStartAnswer }: {
  ticket: ProcessedTicket
  draft: string; solved: boolean
  onDraftChange: (v: string) => void
  onSolvedChange: (v: boolean) => void
  onSent: (action: ReplyAction, wasModified?: boolean) => void
  onArchive: () => void
  onStartAnswer?: () => void
}) {
  const [sending, setSending]             = useState(false)
  const [archiving, setArchiving]         = useState(false)
  const [regenerating, setRegenerating]   = useState(false)
  const [deciding, setDeciding]           = useState(false)
  const [customDecision, setCustomDecision] = useState('')
  const [improving, setImproving]         = useState(false)
  const [previousDraft, setPreviousDraft] = useState<string | null>(null)
  const [error, setError]                 = useState<string | null>(null)
  const [attachments, setAttachments]     = useState<AttachmentState[]>([])
  const [uploading, setUploading]         = useState(false)
  const fileInputRef                      = useRef<HTMLInputElement>(null)
  // Chrono « ouverture du ticket → envoi » : réinitialisé à chaque ticket
  // sélectionné. Sert à alimenter time_to_action_ms (temps moyen par ticket),
  // qui était toujours null car le client ne l'envoyait jamais.
  const openedAtRef                       = useRef<number>(Date.now())
  useEffect(() => { openedAtRef.current = Date.now() }, [ticket.ticket_id])
  const [showForward, setShowForward]     = useState(false)
  const [showMore, setShowMore]           = useState(false)
  const [forwardTo, setForwardTo]         = useState('')
  const [forwardNote, setForwardNote]     = useState('')
  const [forwarding, setForwarding]       = useState(false)
  const [forwardOk, setForwardOk]         = useState(false)

  async function forwardTicket() {
    const to = forwardTo.trim()
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(to)) { setError('Adresse e-mail invalide'); return }
    setForwarding(true); setError(null)
    try {
      const res = await savFetch('/api/sav/forward', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ticket_id:      ticket.ticket_id,
          requester_id:   ticket.requester_id,
          to,
          note:           forwardNote.trim(),
          customer_email: ticket.customer_email,
          subject:        ticket.subject,
        }),
      })
      const d = await res.json()
      if (!res.ok) throw new Error(d.error ?? `HTTP ${res.status}`)
      setForwardOk(true)
      setForwardNote('')
      setTimeout(() => { setShowForward(false); setForwardOk(false); setForwardTo('') }, 1500)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Transfert impossible')
    } finally { setForwarding(false) }
  }

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? [])
    if (files.length === 0) return
    e.target.value = ''

    setUploading(true); setError(null)
    try {
      const uploaded = await Promise.all(files.map(async file => {
        const form = new FormData()
        form.append('file', file)
        const res = await savFetch('/api/sav/upload', { method: 'POST', body: form })
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
      const res = await savFetch('/api/sav/regenerate', {
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
      const d = await savJson<{ body?: string; solved?: boolean; error?: string }>(res, 'La régénération')
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
      const wasModified = draft.trim() !== ticket.draft_reply.trim()
      const modRatio = modificationRatio(ticket.draft_reply, draft)
      const res = await savFetch('/api/sav/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        // was_modified est transmis pour que le LOG serveur (attribution fiable) l'enregistre.
        body: JSON.stringify({ ticket_id: ticket.ticket_id, reply_body: draft, solved, action, category: ticket.category, uploads, was_modified: wasModified, modification_ratio: modRatio, time_to_action_ms: Math.max(0, Date.now() - openedAtRef.current) }),
      })
      if (!res.ok) { const d = await savJson<{ error?: string }>(res, 'L\'envoi'); throw new Error(d.error ?? `HTTP ${res.status}`) }
      setAttachments([])
      onSent(action, wasModified)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erreur inconnue')
    } finally { setSending(false) }
  }

  async function archive() {
    setArchiving(true); setError(null)
    try {
      const res = await savFetch('/api/sav/archive', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ticket_id: ticket.ticket_id, category: ticket.category }),
      })
      if (!res.ok) { const d = await savJson<{ error?: string }>(res); throw new Error(d.error ?? `HTTP ${res.status}`) }
      onArchive()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erreur inconnue')
    } finally { setArchiving(false) }
  }

  async function decide(option: DecisionOption) {
    setDeciding(true); setError(null)
    try {
      const res = await savFetch('/api/sav/decide', {
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
      const d = await savJson<{ body?: string; solved?: boolean; error?: string }>(res, 'La décision')
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
      const res = await savFetch('/api/sav/improve', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ current_draft: draft }),
      })
      const d = await savJson<{ body?: string; error?: string }>(res, 'L’amélioration')
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
    <div className="flex-1 min-h-0 flex flex-col rounded-2xl bg-white border border-[#e5e5ea]">
      {/* En-tête du composeur */}
      <div className="px-4 pt-3 pb-2 shrink-0">
        <div className="flex items-center gap-2">
          <h3 className="text-[14px] font-semibold text-[#1d1d1f]">Réponse</h3>
          <span className="ml-auto inline-flex items-center gap-1 text-[12px] text-[#7c3aed]">
            <Sparkles size={13} /> Rédigée par Claude
          </span>
        </div>
        <p className="text-[12px] text-[#8e8e93] truncate mt-0.5">À : <span className="text-[#48484a]">{ticket.customer_email}</span></p>
      </div>

      {/* Décision OU texte */}
      <div className="px-4 flex-1 min-h-0 flex flex-col border-t border-[#f2f2f7] pt-2">
        {showDecisionPanel ? (
          <div className="py-2 space-y-2 overflow-y-auto">
            <p className="text-[13px] text-[#48484a]">Quelle décision prends-tu ? Claude rédige ensuite la réponse.</p>
            {deciding ? (
              <div className="flex items-center gap-2 py-4 text-[13px] text-[#8e8e93]">
                <RefreshCw size={14} className="animate-spin" /> Rédaction en cours…
              </div>
            ) : (
              <>
                <div className="flex flex-wrap gap-2">
                  {(ticket.decision_options ?? []).map(opt => (
                    <button
                      key={opt.key}
                      onClick={() => decide(opt)}
                      className="inline-flex items-center gap-2 px-3 py-2 rounded-xl border border-[#e5e5ea] bg-white hover:bg-[#f2f2f7] text-[13px] font-medium text-[#1d1d1f] transition-colors"
                    >
                      <span className="leading-none">{opt.emoji}</span>
                      {opt.label}
                    </button>
                  ))}
                </div>
                <div className="flex gap-2">
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
                    className="flex-1 px-3 py-2 rounded-xl border border-[#e5e5ea] bg-white text-[13px] text-[#1d1d1f] placeholder-[#8e8e93] focus:outline-none focus:border-[#0a66f5]"
                  />
                  <button
                    disabled={!customDecision.trim()}
                    onClick={() => {
                      decide({ key: 'custom', label: customDecision.trim(), emoji: '✏️' })
                      setCustomDecision('')
                    }}
                    className="px-3 py-2 rounded-xl border border-[#e5e5ea] bg-white hover:bg-[#f2f2f7] disabled:opacity-30 text-[#1d1d1f] transition-colors"
                    aria-label="Valider la décision"
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
            onFocus={() => onStartAnswer?.()}
            onChange={e => { onStartAnswer?.(); onDraftChange(e.target.value); setPreviousDraft(null) }}
            aria-label="Réponse"
            className="w-full flex-1 min-h-[160px] text-[14px] leading-[1.6] text-[#1d1d1f] bg-transparent resize-none focus:outline-none font-[inherit] py-1"
          />
        )}
      </div>

      {/* Pièces jointes + rappels */}
      {(attachments.length > 0 || ticket.category === 'retour_remboursement' || error) && (
        <div className="px-4 pb-2 flex flex-wrap gap-2">
          {error && <p className="w-full text-[12px] text-[#c81e1e] bg-[#fde8e8] rounded-lg px-3 py-2">{error}</p>}
          {attachments.map(att => (
            <span key={att.token} className="inline-flex items-center gap-1.5 pl-2.5 pr-1.5 py-1 rounded-lg bg-[#f2f2f7] text-[12px] text-[#1d1d1f]">
              <Paperclip size={12} className="text-[#8e8e93]" />
              <span className="truncate max-w-[180px]">{att.filename}</span>
              <button onClick={() => removeAttachment(att.token)} className="text-[#8e8e93] hover:text-[#c81e1e]" aria-label={`Retirer ${att.filename}`}><X size={13} /></button>
            </span>
          ))}
          {ticket.category === 'retour_remboursement' && (
            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-[#e0ecff] text-[12px] text-[#0a58d0]">📎 Bon de retour joint automatiquement</span>
          )}
          {ticket.category === 'retour_remboursement' && /échange|echange|avoir/i.test(draft) && (
            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-[#fff1db] text-[12px] text-[#b45309]">Pense à joindre l&apos;étiquette Colissimo</span>
          )}
        </div>
      )}

      {/* Transfert à un tiers */}
      {showForward && (
        <div className="mx-4 mb-2 rounded-xl border border-[#e5e5ea] bg-[#f9f9fb] p-3 space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-[13px] font-semibold text-[#1d1d1f]">Transférer le ticket</span>
            <button onClick={() => { setShowForward(false); setForwardOk(false) }} className="text-[#8e8e93] hover:text-[#1d1d1f]" aria-label="Fermer"><X size={14} /></button>
          </div>
          <input
            type="email" value={forwardTo} onChange={e => setForwardTo(e.target.value)}
            placeholder="email@destinataire.com"
            className="w-full px-3 py-2 rounded-lg border border-[#e5e5ea] bg-white text-[13px] text-[#1d1d1f] outline-none focus:border-[#0a66f5]"
          />
          <textarea
            value={forwardNote} onChange={e => setForwardNote(e.target.value)} rows={2}
            placeholder="Message pour le destinataire (optionnel)"
            className="w-full px-3 py-2 rounded-lg border border-[#e5e5ea] bg-white text-[13px] text-[#1d1d1f] outline-none focus:border-[#0a66f5] resize-none"
          />
          <div className="flex items-center gap-3">
            <p className="text-[12px] text-[#8e8e93] leading-snug flex-1">La conversation est jointe. Le destinataire peut répondre directement au client.</p>
            <button
              onClick={forwardTicket} disabled={forwarding || forwardOk}
              className="shrink-0 inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-[#1d1d1f] text-white text-[13px] font-medium disabled:opacity-50"
            >
              {forwardOk ? <CheckCheck size={13} /> : forwarding ? <RefreshCw size={13} className="animate-spin" /> : <Forward size={13} />}
              {forwardOk ? 'Transféré' : forwarding ? 'Envoi…' : 'Transférer'}
            </button>
          </div>
        </div>
      )}

      {/* Barre d'outils */}
      <input
        ref={fileInputRef}
        type="file"
        multiple
        className="hidden"
        onChange={handleFileChange}
        accept=".pdf,.jpg,.jpeg,.png,.gif,.webp,.zip,.doc,.docx,.xls,.xlsx"
      />
      <div className="shrink-0 flex items-center gap-1 px-2 pt-1 border-t border-[#f2f2f7] flex-wrap">
        <button
          onClick={() => fileInputRef.current?.click()}
          disabled={uploading || sending || archiving}
          title="Joindre un fichier"
          className="w-9 h-9 rounded-lg flex items-center justify-center text-[#48484a] hover:bg-[#f2f2f7] disabled:opacity-40"
        >
          {uploading ? <RefreshCw size={16} className="animate-spin" /> : <Paperclip size={16} strokeWidth={1.8} />}
        </button>
        <button
          onClick={regenerate}
          disabled={regenerating || sending || archiving}
          title="Faire réécrire la réponse par Claude"
          className="h-9 px-2.5 rounded-lg inline-flex items-center gap-1.5 text-[13px] text-[#7c3aed] hover:bg-[#f5f0ff] disabled:opacity-40"
        >
          <RotateCcw size={14} className={regenerating ? 'animate-spin' : ''} /> {regenerating ? 'Réécriture…' : 'Réécrire'}
        </button>
        {!showDecisionPanel && draft.trim() && (
          <button
            onClick={improve}
            disabled={improving || sending || archiving || deciding}
            title="Corriger et améliorer ce que tu as écrit"
            className="h-9 px-2.5 rounded-lg inline-flex items-center gap-1.5 text-[13px] text-[#7c3aed] hover:bg-[#f5f0ff] disabled:opacity-40"
          >
            {improving ? <RefreshCw size={14} className="animate-spin" /> : <Wand2 size={14} />} {improving ? 'Amélioration…' : 'Améliorer'}
          </button>
        )}
        {previousDraft !== null && !improving && (
          <button onClick={undoImprove} className="h-9 px-2.5 rounded-lg text-[13px] text-[#8e8e93] hover:bg-[#f2f2f7]">Annuler</button>
        )}
      </div>
      <div className="shrink-0 flex items-center gap-2 px-3 pb-3 pt-1">
        <div className="flex-1 flex items-center gap-2">
          <label className="flex items-center gap-1.5 text-[13px] text-[#48484a] cursor-pointer select-none">
            <input type="checkbox" checked={solved} onChange={e => onSolvedChange(e.target.checked)} className="accent-[#0a66f5] w-3.5 h-3.5" />
            Résolu après envoi
          </label>
        </div>
        <div className="flex items-center gap-1.5">
          <div className="relative">
            <button
              onClick={() => setShowMore(v => !v)}
              disabled={sending || archiving || regenerating}
              title="Autres actions"
              aria-expanded={showMore}
              className="w-9 h-9 rounded-full flex items-center justify-center text-[#48484a] hover:bg-[#f2f2f7] disabled:opacity-40"
            >
              <MoreHorizontal size={18} />
            </button>
            {showMore && (
              <>
                <div className="fixed inset-0 z-30" onClick={() => setShowMore(false)} />
                <div className="absolute right-0 bottom-full mb-2 z-40 w-[230px] rounded-xl border border-[#e5e5ea] bg-white shadow-lg py-1 text-[13px] text-[#1d1d1f]">
                  <button onClick={() => { setShowMore(false); send('escalate') }} className="w-full flex items-center gap-2 px-3 py-2 hover:bg-[#f2f2f7] text-left">
                    <ArrowUpRight size={14} className="text-[#b45309]" /> Escalader
                  </button>
                  <button onClick={() => { setShowMore(false); setShowForward(true) }} className="w-full flex items-center gap-2 px-3 py-2 hover:bg-[#f2f2f7] text-left">
                    <Forward size={14} className="text-[#48484a]" /> Transférer à quelqu&apos;un
                  </button>
                  <button onClick={() => { setShowMore(false); archive() }} className="w-full flex items-center gap-2 px-3 py-2 hover:bg-[#f2f2f7] text-left">
                    <Archive size={14} className="text-[#48484a]" /> Clore sans répondre
                  </button>
                </div>
              </>
            )}
          </div>
          <button
            onClick={() => send('auto_reply')} disabled={sending || archiving || regenerating || showDecisionPanel}
            className="h-9 pl-4 pr-3 rounded-full bg-[#0a66f5] text-white text-[13px] font-semibold inline-flex items-center gap-1.5 hover:bg-[#0858d6] disabled:opacity-50"
          >
            {sending ? <RefreshCw size={14} className="animate-spin" /> : null}
            {sending ? 'Envoi…' : archiving ? 'Clôture…' : 'Envoyer'}
            {!sending && <Send size={13} strokeWidth={2} />}
          </button>
        </div>
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
  const [attachments, setAttachments] = useState<AttachmentState[]>([])
  const [uploading, setUploading]     = useState(false)
  const fileInputRef                  = useRef<HTMLInputElement>(null)

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? [])
    if (files.length === 0) return
    e.target.value = ''
    setUploading(true); setError(null)
    try {
      const uploaded = await Promise.all(files.map(async file => {
        const form = new FormData()
        form.append('file', file)
        const res = await savFetch('/api/sav/upload', { method: 'POST', body: form })
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

  async function send() {
    if (!body.trim()) return
    setSending(true); setError(null)
    try {
      const res = await savFetch('/api/sav/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ticket_id: ticket.ticket_id, reply_body: body, solved: false, action: 'auto_reply', uploads: attachments.map(a => a.token), category: ticket.category }),
      })
      if (!res.ok) { const d = await savJson<{ error?: string }>(res); throw new Error(d.error ?? `HTTP ${res.status}`) }
      onSent('auto_reply')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erreur inconnue')
    } finally { setSending(false) }
  }

  async function archive() {
    setArchiving(true); setError(null)
    try {
      const res = await savFetch('/api/sav/archive', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ticket_id: ticket.ticket_id, category: ticket.category }),
      })
      if (!res.ok) { const d = await savJson<{ error?: string }>(res); throw new Error(d.error ?? `HTTP ${res.status}`) }
      onSent('auto_reply')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erreur inconnue')
    } finally { setArchiving(false) }
  }

  return (
    <div className="flex-1 min-h-0 flex flex-col rounded-2xl bg-white border border-[#e5e5ea]">
      <div className="px-4 pt-3 pb-2 shrink-0">
        <h3 className="text-[14px] font-semibold text-[#1d1d1f]">Relance (facultative)</h3>
        <p className="text-[12px] text-[#8e8e93] mt-0.5">On attend la réponse du client. Rien à faire, sauf si tu veux le relancer.</p>
        <p className="text-[12px] text-[#8e8e93] truncate mt-0.5">À : <span className="text-[#48484a]">{ticket.customer_email}</span></p>
      </div>
      <div className="px-4 flex-1 min-h-0 flex flex-col border-t border-[#f2f2f7] pt-2">
        <textarea
          value={body}
          onChange={e => setBody(e.target.value)}
          aria-label="Message de relance"
          placeholder="Bonjour, nous revenons vers vous suite à votre demande. Avez-vous des nouvelles ?"
          className="w-full flex-1 min-h-[140px] text-[14px] leading-[1.6] text-[#1d1d1f] bg-transparent resize-none focus:outline-none font-[inherit] py-1 placeholder:text-[#aeaeb2]"
        />
      </div>
      {(attachments.length > 0 || error) && (
        <div className="px-4 pb-2 flex flex-wrap gap-2">
          {error && <p className="w-full text-[12px] text-[#c81e1e] bg-[#fde8e8] rounded-lg px-3 py-2">{error}</p>}
          {attachments.map(att => (
            <span key={att.token} className="inline-flex items-center gap-1.5 pl-2.5 pr-1.5 py-1 rounded-lg bg-[#f2f2f7] text-[12px] text-[#1d1d1f]">
              <Paperclip size={12} className="text-[#8e8e93]" />
              <span className="truncate max-w-[180px]">{att.filename}</span>
              <button onClick={() => removeAttachment(att.token)} className="text-[#8e8e93] hover:text-[#c81e1e]" aria-label={`Retirer ${att.filename}`}><X size={13} /></button>
            </span>
          ))}
        </div>
      )}
      <input
        ref={fileInputRef}
        type="file"
        multiple
        className="hidden"
        onChange={handleFileChange}
        accept=".pdf,.jpg,.jpeg,.png,.gif,.webp,.zip,.doc,.docx,.xls,.xlsx"
      />
      <div className="flex items-center gap-1 px-2 pb-2 pt-1 border-t border-[#f2f2f7]">
        <button
          onClick={() => fileInputRef.current?.click()}
          disabled={uploading || sending || archiving}
          title="Joindre un fichier (facture…)"
          className="w-9 h-9 rounded-lg flex items-center justify-center text-[#48484a] hover:bg-[#f2f2f7] disabled:opacity-40"
        >
          {uploading ? <RefreshCw size={16} className="animate-spin" /> : <Paperclip size={16} strokeWidth={1.8} />}
        </button>
        <div className="ml-auto flex items-center gap-2">
          <button
            onClick={archive} disabled={sending || archiving}
            className="h-9 px-3 rounded-full text-[13px] text-[#48484a] hover:bg-[#f2f2f7] disabled:opacity-50 inline-flex items-center gap-1.5"
          >
            {archiving ? <RefreshCw size={13} className="animate-spin" /> : <Archive size={13} />}
            {archiving ? 'Clôture…' : 'Clore sans répondre'}
          </button>
          <button
            onClick={send} disabled={sending || archiving || uploading || !body.trim()}
            className="h-9 pl-4 pr-3 rounded-full bg-[#0a66f5] text-white text-[13px] font-semibold inline-flex items-center gap-1.5 hover:bg-[#0858d6] disabled:opacity-50"
          >
            {sending ? <RefreshCw size={14} className="animate-spin" /> : null}
            {sending ? 'Envoi…' : 'Relancer'}
            {!sending && <Send size={13} strokeWidth={2} />}
          </button>
        </div>
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
    savFetch('/api/sav/rules')
      .then(r => r.json()).then((d: { rules?: string[] }) => setRules(d.rules ?? []))
      .catch(() => setError('Erreur de chargement'))
      .finally(() => setLoading(false))
  }, [])

  async function addRule() {
    const rule = newRule.trim(); if (!rule) return
    setSaving(true); setError(null)
    try {
      const res = await savFetch('/api/sav/rules', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ rule }) })
      const d = await res.json() as { rules?: string[]; error?: string }
      if (!res.ok) throw new Error(d.error ?? `HTTP ${res.status}`)
      setRules(d.rules ?? []); setNewRule('')
    } catch (e) { setError(e instanceof Error ? e.message : 'Erreur') }
    finally { setSaving(false) }
  }

  async function deleteRule(index: number) {
    setError(null)
    try {
      const res = await savFetch('/api/sav/rules', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ index }) })
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
          <p className="text-[10px] font-semibold uppercase tracking-[0.1em] text-[#aeb0c9]">SAV {savBrandLabel()}</p>
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
  tickets_morning:   number
  tickets_afternoon: number
  avg_time_ms:       number | null
  modification_rate: number | null
  avg_modification_ratio: number | null
  modification_breakdown: { measured: number; identical: number; minor: number; moderate: number; rewrite: number } | null
  sessions_count:    number
  visits_per_day:    number
  avg_session_ms:    number | null
  total_session_ms:  number | null
  active_ms:         number   // temps de travail reconstitué (heartbeats)
  active_hours:      Record<number, number>
  active_weekdays:   Record<number, number>  // 1=Lun…7=Dim
  daily_timeline:    DailyEntry[]
  distinct_users:    string[]
  user_names:        Record<string, string>  // email → prénom
  by_agent:          { email: string; name: string; active_ms: number; tickets: number; sessions: number; sent: number; escalated: number; archived: number; avg_time_ms: number | null }[]
  by_category: Record<string, { total: number; sent: number; escalated: number; avg_modification_ratio: number | null; measured: number }>
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
  // 'today' | 'day' (journée précise) | 7 | 30
  const [period, setPeriod]         = useState<'today' | 'day' | 7 | 30>('today')
  const [dayValue, setDayValue]     = useState<string>('')       // 'YYYY-MM-DD' quand period==='day'
  const [selectedUser, setSelectedUser] = useState<string>('')  // '' = tous
  const isDay      = period === 'day' && /^\d{4}-\d{2}-\d{2}$/.test(dayValue)
  const singleDay  = period === 'today' || isDay   // vue « une journée » (matin/AM pertinent)
  const days       = typeof period === 'number' ? period : 1
  // date Paris décalée de n jours (n=-1 → hier)
  const parisDay = (n: number) => {
    const d = new Date(); d.setDate(d.getDate() + n)
    return d.toLocaleDateString('en-CA', { timeZone: 'Europe/Paris' })
  }

  useEffect(() => {
    setLoading(true); setError(null)
    const params =
      period === 'today' ? new URLSearchParams({ range: 'today' })
      : isDay            ? new URLSearchParams({ day: dayValue })
      :                    new URLSearchParams({ days: String(period) })
    if (selectedUser) params.set('user_email', selectedUser)
    savFetch(`/api/sav/actions?${params}`)
      .then(r => r.json())
      .then(d => {
        if (d.error) throw new Error(d.error)
        setMetrics(d.metrics)
      })
      .catch(e => setError(e instanceof Error ? e.message : 'Erreur'))
      .finally(() => setLoading(false))
  }, [period, dayValue, isDay, selectedUser])

  return (
    <div className="flex flex-col h-full overflow-y-auto px-8 py-6 gap-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-[#aeb0c9]">Admin · SAV {savBrand() === 'bowa' ? 'Bowa' : 'Mōom'}</p>
          <h2 className="text-base font-bold text-[#1a1a2e] mt-0.5">Qualité SAV</h2>
        </div>
        <div className="flex flex-col items-end gap-2">
          {/* Filtre période */}
          <div className="flex items-center gap-1.5">
            {([['today', "Aujourd'hui"], [7, '7j'], [30, '30j']] as const).map(([val, label]) => (
              <button
                key={val}
                onClick={() => { setSelectedUser(''); setPeriod(val) }}
                className={`px-3 py-1.5 rounded-lg text-[11px] font-semibold transition-colors ${
                  period === val
                    ? 'bg-[#1a1a2e] text-white'
                    : 'bg-[#f3f3f1] text-[#6b6b63] hover:bg-[#eeede9]'
                }`}
              >
                {label}
              </button>
            ))}
            {/* Hier */}
            <button
              onClick={() => { setSelectedUser(''); setDayValue(parisDay(-1)); setPeriod('day') }}
              className={`px-3 py-1.5 rounded-lg text-[11px] font-semibold transition-colors ${
                isDay && dayValue === parisDay(-1)
                  ? 'bg-[#1a1a2e] text-white'
                  : 'bg-[#f3f3f1] text-[#6b6b63] hover:bg-[#eeede9]'
              }`}
            >
              Hier
            </button>
            {/* Jour précis */}
            <input
              type="date"
              max={parisDay(0)}
              value={period === 'day' ? dayValue : ''}
              onChange={e => { if (e.target.value) { setSelectedUser(''); setDayValue(e.target.value); setPeriod('day') } }}
              className={`px-2 py-1.5 rounded-lg text-[11px] font-semibold border outline-none transition-colors ${
                isDay
                  ? 'bg-[#1a1a2e] text-white border-[#1a1a2e]'
                  : 'bg-[#f3f3f1] text-[#6b6b63] border-transparent hover:bg-[#eeede9]'
              }`}
              title="Choisir une journée précise"
            />
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
                const short = metrics.user_names[email] ?? email.split('@')[0]
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
          {/* ── Temps de travail PAR AGENT (vue claire, tous les agents) ── */}
          {metrics.by_agent && metrics.by_agent.length > 0 && (
            <div className="rounded-2xl bg-white border border-[#e8e8e4] overflow-hidden">
              <div className="px-5 py-3 border-b border-[#f0efec] flex items-center justify-between">
                <p className="text-[11px] font-semibold uppercase tracking-[0.1em] text-[#6b6b63]">Temps de travail par agent</p>
                <span className="text-[10px] text-[#9b9b93]">{isDay ? 'ce jour' : period === 'today' ? "aujourd'hui" : `${days} j`}</span>
              </div>
              <div className="divide-y divide-[#f5f5f3]">
                {metrics.by_agent.map(a => (
                  <button
                    key={a.email}
                    onClick={() => setSelectedUser(selectedUser === a.email ? '' : a.email)}
                    className={`w-full flex items-center gap-3 px-5 py-3 text-left transition-colors ${selectedUser === a.email ? 'bg-[#f5f3ff]' : 'hover:bg-[#faf9f8]'}`}
                  >
                    <span className="w-7 h-7 rounded-full bg-[#eef2ff] text-[#4338ca] text-[11px] font-bold flex items-center justify-center shrink-0">
                      {a.name.charAt(0).toUpperCase()}
                    </span>
                    <span className="flex-1 min-w-0">
                      <span className="text-sm font-semibold text-[#1a1a2e]">{a.name}</span>
                    </span>
                    <span className="text-right">
                      <span className="block text-base font-bold text-[#1a1a2e] tabular-nums">{a.active_ms > 0 ? fmtMs(a.active_ms) : '—'}</span>
                      <span className="block text-[10px] text-[#9b9b93]">
                        {a.tickets} ticket{a.tickets !== 1 ? 's' : ''}
                        {a.tickets > 0 && (
                          <> (
                            {[
                              a.sent > 0 ? `${a.sent} répondu${a.sent !== 1 ? 's' : ''}` : null,
                              a.escalated > 0 ? `${a.escalated} escaladé${a.escalated !== 1 ? 's' : ''}` : null,
                              a.archived > 0 ? `${a.archived} archivé${a.archived !== 1 ? 's' : ''}` : null,
                            ].filter(Boolean).join(' · ')}
                          )</>
                        )}
                        {' '}· {a.sessions} ouverture{a.sessions !== 1 ? 's' : ''}
                        {a.avg_time_ms !== null && <> · ~{fmtMs(a.avg_time_ms)}/ticket</>}
                      </span>
                    </span>
                  </button>
                ))}
              </div>
              <div className="px-5 py-2 bg-[#faf9f8] text-[10px] text-[#9b9b93]">
                Temps actif réel (basé sur l&apos;activité dans le SAV). Clique un agent pour filtrer le détail ci-dessous.
              </div>
            </div>
          )}

          {/* ── Récap en tête : temps de travail + tickets (matin/après-midi) ── */}
          {(metrics.total > 0 || metrics.sessions_count > 0) && (() => {
            const who   = selectedUser ? (metrics.user_names[selectedUser] ?? selectedUser.split('@')[0]) : "l'équipe"
            const dayLabel = isDay
              ? new Date(dayValue + 'T12:00:00').toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' })
              : ''
            const quand = period === 'today' ? "aujourd'hui" : isDay ? `le ${dayLabel}` : `sur ${days} jours`
            return (
              <div className="grid grid-cols-2 gap-3">
                <div className="rounded-2xl bg-[#1a1a2e] px-5 py-4">
                  <p className="text-[10px] font-semibold uppercase tracking-[0.1em] text-white/40">Temps de travail · {who}</p>
                  <p className="text-3xl font-bold text-white mt-1">
                    {/* Uniquement le temps ACTIF reconstitué par battements (fiable).
                        L'ancien cumul de sessions se chevauchait → chiffres faux. */}
                    {metrics.active_ms > 0 ? fmtMs(metrics.active_ms) : '—'}
                  </p>
                  <p className="text-[10px] text-white/40 mt-0.5">
                    {metrics.active_ms > 0
                      ? <>temps actif dans le SAV · {quand}</>
                      : <>se calcule pendant l&apos;activité · {metrics.sessions_count} ouverture{metrics.sessions_count > 1 ? 's' : ''}</>}
                  </p>
                </div>
                <div className="rounded-2xl bg-[#f5f3ff] border border-[#e0e7ff] px-5 py-4">
                  <p className="text-[10px] font-semibold uppercase tracking-[0.1em] text-[#6366f1]">Tickets traités · {who}</p>
                  <p className="text-3xl font-bold text-[#1a1a2e] mt-1">{metrics.total}</p>
                  <p className="text-[10px] text-[#6b6b63] mt-0.5">
                    <b className="text-[#4338ca]">{metrics.tickets_morning}</b> le matin ·{' '}
                    <b className="text-[#4338ca]">{metrics.tickets_afternoon}</b> l&apos;après-midi
                  </p>
                </div>
              </div>
            )
          })()}

          {metrics.total === 0 && metrics.sessions_count === 0 ? (
            <div className="flex flex-col items-center justify-center gap-3 py-16 text-center">
              <p className="text-3xl">📊</p>
              {selectedUser ? (
                <>
                  <p className="text-sm font-semibold text-[#1a1a2e]">
                    Aucune activité pour {metrics.user_names[selectedUser] ?? selectedUser.split('@')[0]} sur cette période
                  </p>
                  <p className="text-xs text-[#9b9b93] max-w-xs">Cet agent n&apos;a ni traité de ticket ni ouvert le SAV sur la période sélectionnée.</p>
                  <button
                    onClick={() => setSelectedUser('')}
                    className="mt-1 px-3 py-1.5 rounded-lg text-[11px] font-semibold bg-[#1a1a2e] text-white"
                  >
                    Voir toute l&apos;équipe
                  </button>
                </>
              ) : (
                <>
                  <p className="text-sm font-semibold text-[#1a1a2e]">Pas encore de données</p>
                  <p className="text-xs text-[#9b9b93] max-w-xs">Les métriques s&apos;accumuleront au fur et à mesure que l&apos;équipe traite des tickets.</p>
                </>
              )}
            </div>
          ) : metrics.total === 0 ? (
            <div className="rounded-2xl bg-[#fafaf9] border border-[#e8e8e4] px-5 py-6 text-center">
              <p className="text-sm font-semibold text-[#1a1a2e]">Présent·e, mais aucun ticket traité {singleDay ? 'ce jour-là' : 'sur la période'}</p>
              <p className="text-xs text-[#9b9b93] mt-1">Le temps de travail ci-dessus est comptabilisé, mais aucun envoi/escalade/archivage n&apos;a été enregistré.</p>
            </div>
          ) : (
            <>
              {/* KPI grid — 6 cards, 2 colonnes */}
              <div className="grid grid-cols-2 gap-3">
                {/* Ligne 1 — tickets */}
                <div className="rounded-2xl bg-[#f8f7f5] border border-[#e8e8e4] px-5 py-4">
                  <p className="text-[10px] font-semibold uppercase tracking-[0.1em] text-[#aeb0c9]">Tps moyen / ticket</p>
                  <p className="text-3xl font-bold text-[#1a1a2e] mt-1">
                    {metrics.avg_time_ms !== null ? fmtMs(metrics.avg_time_ms) : '—'}
                  </p>
                  <p className="text-[10px] text-[#9b9b93] mt-0.5">de la sélection à l&apos;envoi</p>
                </div>

                <div className="rounded-2xl bg-[#f8f7f5] border border-[#e8e8e4] px-5 py-4">
                  <p className="text-[10px] font-semibold uppercase tracking-[0.1em] text-[#aeb0c9]">Durée moyenne / visite</p>
                  <p className="text-3xl font-bold text-[#1a1a2e] mt-1">
                    {metrics.avg_session_ms !== null ? fmtMs(metrics.avg_session_ms) : '—'}
                  </p>
                  <p className="text-[10px] text-[#9b9b93] mt-0.5">par ouverture de l&apos;app</p>
                </div>

                {/* Ligne 2 — ampleur de modification des brouillons IA */}
                <div className="rounded-2xl bg-[#f8f7f5] border border-[#e8e8e4] px-5 py-4">
                  <p className="text-[10px] font-semibold uppercase tracking-[0.1em] text-[#aeb0c9]">Modification des brouillons IA</p>
                  <p className="text-3xl font-bold text-[#1a1a2e] mt-1">
                    {metrics.avg_modification_ratio !== null ? `${metrics.avg_modification_ratio}%` : '—'}
                  </p>
                  <p className="text-[10px] text-[#9b9b93] mt-0.5">
                    {metrics.avg_modification_ratio !== null
                      ? 'du texte changé en moyenne'
                      : (metrics.modification_rate !== null ? `${metrics.modification_rate}% retouchés (ampleur en cours de mesure)` : '—')}
                  </p>
                  {metrics.modification_breakdown && (() => {
                    const b = metrics.modification_breakdown
                    const p = (n: number) => b.measured > 0 ? Math.round((n / b.measured) * 100) : 0
                    return (
                      <div className="mt-2 space-y-0.5 text-[10px] text-[#6b6b63] leading-snug">
                        <div>🟢 Quasi tel quel : <b>{p(b.identical + b.minor)}%</b> <span className="text-[#9b9b93]">(retouche ≤15%)</span></div>
                        <div>🟡 Modéré : <b>{p(b.moderate)}%</b> <span className="text-[#9b9b93]">(15–40%)</span></div>
                        <div>🔴 Réécriture : <b>{p(b.rewrite)}%</b> <span className="text-[#9b9b93]">(&gt;40%)</span></div>
                        <div className="text-[#9b9b93] pt-0.5">sur {b.measured} envoi{b.measured !== 1 ? 's' : ''} mesuré{b.measured !== 1 ? 's' : ''}</div>
                      </div>
                    )
                  })()}
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
                            {stats.avg_modification_ratio !== null && (() => {
                              const r = stats.avg_modification_ratio
                              const cls = r <= 15 ? 'bg-[#f0fdf4] text-[#1a7f4b]' : r <= 40 ? 'bg-[#fff7ed] text-[#b45309]' : 'bg-[#fef2f2] text-[#c7293a]'
                              return <span className={`px-1.5 py-0.5 rounded-full font-semibold ${cls}`} title={`Ampleur moyenne de modification du brouillon IA (sur ${stats.measured} envoi${stats.measured !== 1 ? 's' : ''} mesuré${stats.measured !== 1 ? 's' : ''})`}>✎ {r}% modifié</span>
                            })()}
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
  const [assignMeta, setAssignMeta]         = useState<Record<number, { by: string | null; at: string | null }>>({})
  const [assignMenuTicket, setAssignMenuTicket] = useState<number | null>(null)
  const [ticketTags, setTicketTags]         = useState<Record<number, string[]>>({})
  const [myEmail, setMyEmail]               = useState('')
  const [myName, setMyName]                 = useState('')
  const [assigneeFilter, setAssigneeFilter] = useState<string>('')  // '' = tous · 'unassigned' · nom d'agent
  const [search, setSearch]         = useState('')
  const [zdResults, setZdResults]   = useState<SearchResult[] | null>(null)
  const [zdOrder, setZdOrder]       = useState<MoomOrder | null>(null)
  const [zdSearching, setZdSearching] = useState(false)
  const [zdError, setZdError]       = useState<string | null>(null)
  const filterInit                          = useRef(false)
  const [processedCache, setProcessedCache] = useState<Record<number, ProcessedTicket>>({})
  const [selectedId, setSelectedId]         = useState<number | null>(null)
  const [processingId, setProcessingId]     = useState<number | null>(null)
  const [listLoading, setListLoading]       = useState(true)
  const [doneStatuses, setDoneStatuses]     = useState<Record<number, { action: 'sent' | 'escalated' | 'archived'; doneAt: string }>>({})
  const [drafts, setDrafts]                 = useState<Record<number, string>>({})
  const [solvedMap, setSolvedMap]           = useState<Record<number, boolean>>({})
  const [tab, setTab]                       = useUrlState<'pending' | 'done' | 'qualite'>('tab', 'pending')
  const [showRules, setShowRules]           = useState(false)
  const [toolMenu, setToolMenu]             = useState<'assign' | 'tags' | null>(null)
  const [showWaiting, setShowWaiting]       = useState(false)
  const [resolving, setResolving]           = useState(false)
  const [resolveError, setResolveError]     = useState<string | null>(null)
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
      // Au 1er chargement, si l'utilisateur EST un agent SAV (Satiana/Lary), on
      // ouvre par défaut sur « ses » tickets. L'admin voit tout.
      if (!filterInit.current) {
        filterInit.current = true
        if (savAssignees().includes(name)) setAssigneeFilter(name)
      }

      savFetch('/api/sav/actions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'session_start', ticket_id: 0, category: userEmail, user_email: userEmail }),
      }).catch(() => {})
      sendHeartbeat()   // 1er battement immédiat (compte la minute d'ouverture)
    })

    // ── Temps de travail « en direct » via heartbeats ─────────────────────────
    // Problème : si l'onglet reste ouvert en permanence, session_end ne part
    // jamais → temps de travail = 0. Solution : on envoie un battement toutes
    // les 60 s TANT QUE l'agent est actif (onglet au 1er plan + interaction
    // récente). Le serveur reconstitue le temps réel en additionnant les écarts
    // entre battements consécutifs (les pauses = pas de battement = exclues).
    const HB_INTERVAL_MS = 120_000      // 1 battement / 2 min (volume maîtrisé)
    const IDLE_LIMIT_MS  = 5 * 60_000   // sans interaction depuis 5 min → inactif
    let lastActivity     = Date.now()
    function markActivity() { lastActivity = Date.now() }
    function sendHeartbeat() {
      if (!userEmail) return
      if (document.hidden) return
      if (Date.now() - lastActivity > IDLE_LIMIT_MS) return
      savFetch('/api/sav/actions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'heartbeat', ticket_id: 0, category: userEmail, user_email: userEmail }),
      }).catch(() => {})
    }
    const hbTimer = setInterval(sendHeartbeat, HB_INTERVAL_MS)

    function activeMs() {
      return accumulatedMs + (document.hidden ? 0 : Date.now() - visibleSince)
    }
    function handleVisibility() {
      if (document.hidden) { accumulatedMs += Date.now() - visibleSince }
      else                 { visibleSince = Date.now(); markActivity() }
    }
    function sendEnd() {
      if (sent) return
      sent = true
      const duration = activeMs()
      if (duration < 5_000) return
      navigator.sendBeacon('/api/sav/actions', new Blob(
        [JSON.stringify({ action: 'session_end', ticket_id: 0, time_to_action_ms: duration, category: userEmail, user_email: userEmail })],
        { type: 'application/json' }
      ))
    }

    const ACTIVITY_EVENTS = ['pointerdown', 'keydown', 'mousemove', 'scroll', 'wheel', 'touchstart']
    ACTIVITY_EVENTS.forEach(e => window.addEventListener(e, markActivity, { passive: true }))
    document.addEventListener('visibilitychange', handleVisibility)
    window.addEventListener('pagehide', sendEnd)
    window.addEventListener('beforeunload', sendEnd)
    return () => {
      clearInterval(hbTimer)
      ACTIVITY_EVENTS.forEach(e => window.removeEventListener(e, markActivity))
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
      const res = await savFetch('/api/sav/process', {
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
      const ticket = await savJson<ProcessedTicket & { error?: string }>(res, 'La génération de réponse')
      if (!res.ok) { console.error('[SAV] /api/sav/process failed:', ticket.error); return }
      // Signature par agent : le brouillon contient le marqueur {{PRÉNOM}} (ex. intro
      // « Je suis {{PRÉNOM}} »). On le remplace par le prénom de l'agent connecté, des
      // DEUX côtés (brouillon éditable ET baseline draft_reply pour l'ampleur de modif)
      // en mutant draft_reply avant de le stocker → la métrique reste cohérente.
      const myFirst = signatureFirstName(myName, savBrand())
      if (myFirst && ticket.draft_reply) {
        ticket.draft_reply = ticket.draft_reply.replace(/\{\{\s*PR[ÉE]NOM\s*\}\}/gi, myFirst)
      }
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
  const load = useCallback(async (silent = false) => {
    if (!silent) setListLoading(true)
    try {
      const res  = await savFetch('/api/sav/tickets')
      const data = await savJson<{ tickets?: RawTicket[]; error?: string }>(res, 'La liste des tickets')

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
    } finally { if (!silent) setListLoading(false) }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => { load() }, [load])

  // ── Rafraîchissement auto de la liste ─────────────────────────────────────
  // La page reste souvent ouverte toute la journée (suivi du temps par heartbeat).
  // Sans ça, les tickets reçus après l'ouverture n'apparaissent qu'au rechargement
  // manuel. On re-fetch en silence toutes les 60 s + au retour sur l'onglet.
  useEffect(() => {
    const tick = () => { if (!document.hidden) load(true) }
    const id = setInterval(tick, 60_000)
    window.addEventListener('focus', tick)
    document.addEventListener('visibilitychange', tick)
    return () => {
      clearInterval(id)
      window.removeEventListener('focus', tick)
      document.removeEventListener('visibilitychange', tick)
    }
  }, [load])

  // ── Attributions des tickets (qui répond : agents SAV) ────────────────
  // Rafraîchi au montage PUIS toutes les 15 s : une réservation (quand un agent
  // commence à répondre) ou un transfert manuel se propage vite à l'autre écran,
  // au lieu de rester figé au chargement (source des blocages « fantômes »).
  useEffect(() => {
    let alive = true
    const refresh = () => savFetch('/api/sav/assign')
      .then(r => r.json())
      .then(d => { if (alive) { setAssignments(d.assignments ?? {}); setAssignMeta(d.meta ?? {}) } })
      .catch(() => {})
    refresh()
    const id = setInterval(refresh, 15_000)
    return () => { alive = false; clearInterval(id) }
  }, [])

  // ── Balises manuelles des tickets ──────────────────────────────────────
  useEffect(() => {
    savFetch('/api/sav/tags')
      .then(r => r.json())
      .then(d => setTicketTags(d.tags ?? {}))
      .catch(() => {})
  }, [])

  async function toggleTag(ticketId: number, tag: string) {
    const current = ticketTags[ticketId] ?? []
    const on = !current.includes(tag)
    setTicketTags(prev => {
      const cur = prev[ticketId] ?? []
      const nextTags = on ? [...cur, tag] : cur.filter(t => t !== tag)
      const next = { ...prev }
      if (nextTags.length) next[ticketId] = nextTags
      else delete next[ticketId]
      return next
    })
    try {
      await savFetch('/api/sav/tags', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ticket_id: ticketId, tag, on }),
      })
    } catch { /* optimiste */ }
  }

  // Nom de la collègue qui m'a affecté ce ticket (si c'est bien à MOI et par une AUTRE).
  function handoffFrom(ticketId: number): string | undefined {
    const a = assignments[ticketId]
    const by = assignMeta[ticketId]?.by
    // Affiché seulement si c'est à MOI, par une AUTRE, et qu'on a un prénom (pas un email legacy).
    if (a && a === myName && by && !by.includes('@') && by !== myName) return by
    return undefined
  }

  async function assignTicket(ticketId: number, assignee: string | null) {
    setAssignments(prev => {
      const next = { ...prev }
      if (assignee) next[ticketId] = assignee
      else delete next[ticketId]
      return next
    })
    // Trace : qui affecte (nom) et quand.
    setAssignMeta(prev => ({ ...prev, [ticketId]: { by: myName || myEmail, at: new Date().toISOString() } }))
    setAssignMenuTicket(null)
    try {
      await savFetch('/api/sav/assign', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ticket_id: ticketId, assignee, updated_by: myName || myEmail }),
      })
    } catch { /* optimiste — l'UI reste à jour */ }
  }

  // Revendication quand on COMMENCE À RÉPONDRE (focus dans la zone de réponse) :
  // insert-si-absent, ne vole JAMAIS un ticket déjà pris. Lire un ticket ne réserve
  // plus rien → on ne bloque plus un collègue juste en l'ouvrant. Le vrai verrou
  // anti-double reste côté serveur à l'envoi.
  async function claimForAnswer(ticketId: number) {
    if (!savAssignees().includes(myName)) return // admin/non-agent : pas d'auto-claim
    if (assignments[ticketId]) return                              // déjà attribué
    setAssignments(prev => ({ ...prev, [ticketId]: myName }))      // optimiste
    try {
      const r = await savFetch('/api/sav/assign', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ticket_id: ticketId, assignee: myName, updated_by: myEmail, claim: true }),
      })
      const d = await r.json() as { assignee?: string }
      if (d.assignee) setAssignments(prev => ({ ...prev, [ticketId]: d.assignee! })) // se cale sur le détenteur réel
    } catch { /* optimiste */ }
  }

  // Recherche dans TOUT Zendesk (y compris tickets résolus) pour retrouver un ticket
  // absent de la file — évite d'aller sur Zendesk.
  async function runZendeskSearch() {
    const q = search.trim()
    if (q.length < 2) { setZdResults(null); setZdOrder(null); return }
    setZdSearching(true); setZdError(null)
    try {
      const r = await savFetch(`/api/sav/search?q=${encodeURIComponent(q)}`)
      const d = await savJson<{ tickets?: SearchResult[]; order?: MoomOrder | null; error?: string }>(r, 'La recherche')
      if (d.error) setZdError(d.error)
      setZdResults(d.tickets ?? [])
      setZdOrder(d.order ?? null)
    } catch { setZdError('Recherche impossible') } finally { setZdSearching(false) }
  }

  // Ouvre un ticket trouvé par recherche : on l'injecte dans la liste puis on le traite.
  function openSearchedTicket(r: SearchResult) {
    const raw: RawTicket = {
      ticket_id: r.ticket_id, subject: r.subject, description: r.description,
      created_at: r.created_at, updated_at: r.updated_at, requester_id: r.requester_id,
      status: (r.status === 'new' || r.status === 'pending') ? r.status : 'open',
    }
    setRawTickets(prev => prev.some(t => t.ticket_id === raw.ticket_id) ? prev : [raw, ...prev])
    setZdResults(null); setZdOrder(null); setSearch('')
    handleTicketClick(raw)
  }

  // ── Ticket click ──────────────────────────────────────────────────────────
  function handleTicketClick(raw: RawTicket) {
    setSelectedId(raw.ticket_id)
    setCommentRefreshKey(n => n + 1)
    // Record first-view time for time-to-action metric
    if (!ticketStartTimes.current[raw.ticket_id]) {
      ticketStartTimes.current[raw.ticket_id] = Date.now()
    }
    // Plus d'auto-réservation à la simple OUVERTURE : lire un ticket ne le verrouille
    // plus pour les collègues. On réserve seulement quand on COMMENCE à répondre
    // (focus dans la zone de réponse → claimForAnswer). Le vrai verrou anti-double
    // reste côté serveur à l'envoi.
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

  // NB : le log de l'action (sent/escalated/archived) pour les métriques Qualité
  // est désormais fait CÔTÉ SERVEUR dans /api/sav/send et /api/sav/archive
  // (attribution fiable via l'agent authentifié). Le navigateur ne logue plus
  // (des envois n'étaient pas comptés quand le POST client échouait).
  function handleSent(action: ReplyAction) {
    if (selectedId === null) return
    const status: 'escalated' | 'sent' = action === 'escalate' ? 'escalated' : 'sent'
    const doneAfter = { ...doneStatuses, [selectedId]: { action: status, doneAt: new Date().toISOString() } }
    setDoneStatuses(doneAfter)
    advanceSelection(selectedId, doneAfter)
  }

  function handleArchive() {
    if (selectedId === null) return
    const doneAfter = { ...doneStatuses, [selectedId]: { action: 'archived' as const, doneAt: new Date().toISOString() } }
    setDoneStatuses(doneAfter)
    advanceSelection(selectedId, doneAfter)
  }

  async function handleImport() {
    setImporting(true); setImportMsg(null)
    try {
      const res = await savFetch('/api/sav/import-history', { method: 'POST' })
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
  // Recherche instantanée dans la file affichée (n° ticket, sujet, description,
  // + email/n° commande une fois le ticket traité).
  const matchesSearch = (t: RawTicket) => {
    const q = search.trim().toLowerCase()
    if (!q) return true
    const p = processedCache[t.ticket_id]
    const hay = [String(t.ticket_id), t.subject, t.description, p?.customer_email, p?.order?.order_number]
      .filter(Boolean).join(' ').toLowerCase()
    return hay.includes(q)
  }
  const filteredTickets = rawTickets.filter(matchesAssignee).filter(matchesSearch)
  const allPending    = filteredTickets.filter(t => !doneStatuses[t.ticket_id])
  const donelist      = filteredTickets.filter(t =>  doneStatuses[t.ticket_id])
  // Actionable = new or open; waitingClient = pending (awaiting client reply)
  const actionable    = allPending.filter(t => t.status !== 'pending')
  const waitingClient = allPending.filter(t => t.status === 'pending')

  const selectedProcessed = selectedId != null ? (processedCache[selectedId] ?? null) : null
  const isProcessing      = processingId === selectedId && selectedId !== null
  const selectedRaw       = selectedId != null ? rawTickets.find(t => t.ticket_id === selectedId) : undefined
  const selectedName      = prettyName(selectedRaw?.requester_name, selectedRaw?.requester_email ?? selectedProcessed?.customer_email)
  const selectedAssignee  = selectedId != null ? assignments[selectedId] : undefined

  // Précédent / suivant dans la liste affichée
  const navList   = tab === 'done' ? donelist : [...actionable, ...waitingClient]
  const navIndex  = navList.findIndex(t => t.ticket_id === selectedId)
  const prevTicket = navIndex > 0 ? navList[navIndex - 1] : undefined
  const nextTicket = navIndex >= 0 && navIndex < navList.length - 1 ? navList[navIndex + 1] : undefined
  function stepTicket(dir: -1 | 1) {
    const t = dir < 0 ? prevTicket : nextTicket
    if (t) handleTicketClick(t)
  }

  // « Résoudre » : clôt le ticket dans Zendesk sans réponse publique.
  async function resolveSelected() {
    if (!selectedProcessed) return
    setResolving(true); setResolveError(null)
    try {
      const res = await savFetch('/api/sav/archive', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ticket_id: selectedProcessed.ticket_id, category: selectedProcessed.category }),
      })
      if (!res.ok) { const d = await savJson<{ error?: string }>(res); throw new Error(d.error ?? `HTTP ${res.status}`) }
      handleArchive()
    } catch (e) {
      setResolveError(e instanceof Error ? e.message : 'Erreur inconnue')
    } finally { setResolving(false) }
  }

  return (
    <div className="h-screen overflow-hidden flex relative">

      {/* Fermeture du menu d'affectation rapide au clic extérieur */}
      {assignMenuTicket !== null && (
        <div className="fixed inset-0 z-20" onClick={() => setAssignMenuTicket(null)} />
      )}

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
                        const res = await savFetch('/api/sav/new-message', {
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
      <div className="w-[320px] shrink-0 flex flex-col border-r border-[#e5e5ea] bg-[#f5f5f7] overflow-hidden">

        <div className="px-4 pt-5 pb-2 shrink-0 space-y-3">
          <div className="flex items-start justify-between">
            <div>
              <h1 className="text-[22px] font-bold text-[#1d1d1f] leading-none tracking-[-0.01em]">SAV</h1>
              <p className="text-[12px] text-[#8e8e93] mt-1.5">
                {listLoading ? 'Chargement…' : `${actionable.length} à traiter · ${waitingClient.length} en attente du client`}
              </p>
            </div>
            <div className="flex items-center gap-0.5">
              <button
                onClick={() => load()} disabled={listLoading}
                className="w-8 h-8 rounded-lg flex items-center justify-center text-[#0a66f5] hover:bg-[#e8e8ed] disabled:opacity-40"
                title="Actualiser"
              >
                <RefreshCw size={16} strokeWidth={1.8} className={listLoading ? 'animate-spin' : ''} />
              </button>
              <button
                onClick={() => { setShowNewMsg(true); setNewMsgSent(false); setNewMsgError(null) }}
                className="w-8 h-8 rounded-lg flex items-center justify-center text-[#0a66f5] hover:bg-[#e8e8ed]"
                title="Nouveau message à un client"
              >
                <PenSquare size={17} strokeWidth={1.8} />
              </button>
            </div>
          </div>

          {/* Recherche — file en cours (instantané) + tout Zendesk (Entrée) */}
          {tab !== 'qualite' && (
            <div>
              <div className="relative">
                <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[#8e8e93]" />
                <input
                  value={search}
                  onChange={e => { setSearch(e.target.value); if (!e.target.value.trim()) { setZdResults(null); setZdOrder(null); setZdError(null) } }}
                  onKeyDown={e => { if (e.key === 'Enter') runZendeskSearch() }}
                  placeholder="Rechercher (Entrée : tout Zendesk)"
                  aria-label="Rechercher un ticket, un e-mail ou une commande"
                  className="w-full pl-8 pr-8 py-2 rounded-xl bg-[#e8e8ed] text-[13px] text-[#1d1d1f] placeholder-[#8e8e93] focus:outline-none focus:ring-2 focus:ring-[#0a66f5]/40"
                />
                {search && (
                  <button onClick={() => { setSearch(''); setZdResults(null); setZdOrder(null); setZdError(null) }}
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-[#8e8e93] hover:text-[#1d1d1f]" aria-label="Effacer"><X size={14} /></button>
                )}
              </div>
              {search.trim().length >= 2 && !zdResults && !zdOrder && (
                <button onClick={runZendeskSearch} disabled={zdSearching} className="mt-1.5 text-[12px] text-[#0a66f5] disabled:opacity-50">
                  {zdSearching ? 'Recherche dans Zendesk…' : 'Chercher aussi dans tout Zendesk (résolus compris)'}
                </button>
              )}
              {(zdResults || zdOrder) && (
                <div className="mt-2 border border-[#e5e5ea] rounded-xl overflow-hidden bg-white">
                  <div className="px-3 py-2 text-[12px] font-medium text-[#48484a] flex items-center justify-between border-b border-[#f2f2f7]">
                    <span>Résultats Zendesk{zdResults?.length ? ` · ${zdResults.length}` : ''}</span>
                    <button onClick={() => { setZdResults(null); setZdOrder(null) }} className="text-[#8e8e93] hover:text-[#1d1d1f]" aria-label="Fermer"><X size={13} /></button>
                  </div>
                  {zdError && <p className="px-3 py-2 text-[12px] text-[#c81e1e]">{zdError}</p>}
                  {zdOrder && (
                    <div className="px-3 py-2 border-b border-[#f2f2f7] bg-[#f9f9fb]">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-[13px] font-semibold text-[#1d1d1f]">Commande {zdOrder.order_number?.startsWith('#') ? zdOrder.order_number : `#${zdOrder.order_number}`}</span>
                        <span className="text-[11px] text-[#8e8e93] shrink-0">{zdOrder.status_fr}</span>
                      </div>
                      <div className="text-[12px] text-[#8e8e93] mt-0.5">
                        {zdOrder.created_at ? new Date(zdOrder.created_at).toLocaleDateString('fr-FR') : ''}
                        {zdOrder.financial_status_fr ? ` · ${zdOrder.financial_status_fr}` : ''}
                        {zdOrder.carrier ? ` · ${zdOrder.carrier}` : ''}
                      </div>
                      {zdOrder.order_number && <OrderReceivedLine order={zdOrder.order_number} />}
                      {zdOrder.tracking_url && (
                        <a href={zdOrder.tracking_url} target="_blank" rel="noopener noreferrer" className="text-[12px] text-[#0a66f5]">Suivi{zdOrder.tracking_number ? ` : ${zdOrder.tracking_number}` : ''}</a>
                      )}
                      {(zdOrder.products?.length ?? 0) > 0 && (
                        <p className="text-[12px] text-[#8e8e93] mt-0.5 truncate">{zdOrder.products.map(p => `${p.quantity}× ${p.name}`).join(', ')}</p>
                      )}
                    </div>
                  )}
                  {!zdError && (zdResults?.length ?? 0) === 0 && !zdOrder && <p className="px-3 py-2 text-[12px] text-[#8e8e93]">Aucun ticket trouvé.</p>}
                  {!zdError && (zdResults?.length ?? 0) === 0 && zdOrder && <p className="px-3 py-2 text-[12px] text-[#8e8e93]">Commande trouvée, mais aucun ticket SAV pour ce client.</p>}
                  <div className="max-h-64 overflow-y-auto">
                    {(zdResults ?? []).map(r => (
                      <button key={r.ticket_id} onClick={() => openSearchedTicket(r)}
                        className="w-full text-left px-3 py-2 border-t border-[#f2f2f7] first:border-t-0 hover:bg-[#f9f9fb]">
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-[13px] font-medium text-[#1d1d1f] truncate">{r.subject || '(sans objet)'}</span>
                          <span className="text-[11px] text-[#8e8e93] shrink-0">#{r.ticket_id}</span>
                        </div>
                        <div className="flex items-center gap-2 text-[12px] text-[#8e8e93] mt-0.5">
                          <span className="truncate flex-1">{r.requester_email || '—'}</span>
                          <span className="shrink-0">{STATUS_FR[r.status] ?? r.status}</span>
                        </div>
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Vue : file / traités / qualité */}
          <div className="flex items-center gap-4 text-[13px]">
            {([['pending', 'File'], ['done', `Traités${donelist.length ? ` (${donelist.length})` : ''}`], ...(role === 'admin' ? [['qualite', 'Qualité']] : [])] as [typeof tab, string][]).map(([k, label]) => (
              <button
                key={k}
                onClick={() => setTab(k)}
                className={`pb-1 border-b-2 transition-colors ${tab === k ? 'border-[#1d1d1f] text-[#1d1d1f] font-semibold' : 'border-transparent text-[#8e8e93] hover:text-[#48484a]'}`}
              >
                {label}
              </button>
            ))}
          </div>

          {/* Filtre par personne — segmenté */}
          {tab !== 'qualite' && (
            <div className="flex rounded-lg bg-[#e8e8ed] p-0.5 text-[12px] font-medium overflow-x-auto">
              {([
                ['', 'Tous'],
                ...(savAssignees().includes(myName) ? [[myName, 'Moi']] : []),
                ['unassigned', 'Non attribués'],
                ...savAssignees().filter(a => a !== myName).map(a => [a, a]),
              ] as [string, string][]).map(([val, label]) => (
                <button
                  key={val || 'all'}
                  onClick={() => setAssigneeFilter(val)}
                  className={`flex-1 shrink-0 px-2 py-1 rounded-md whitespace-nowrap transition-colors ${assigneeFilter === val ? 'bg-white text-[#1d1d1f] shadow-sm' : 'text-[#48484a] hover:text-[#1d1d1f]'}`}
                >
                  {label}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Ticket list */}
        <div className="flex-1 overflow-y-auto px-2 pb-3">
          {listLoading && (
            <div className="p-2 space-y-4">
              {[1,2,3,4].map(i => (
                <div key={i} className="space-y-1.5">
                  <div className="h-3 w-3/4 bg-[#e5e5ea] rounded-full animate-pulse" />
                  <div className="h-2.5 w-1/2 bg-[#e5e5ea] rounded-full animate-pulse" />
                </div>
              ))}
            </div>
          )}

          {!listLoading && tab === 'pending' && (
            <>
              {actionable.length === 0 && waitingClient.length === 0 && (
                <div className="flex flex-col items-center justify-center h-full gap-2 text-center p-4">
                  <CheckCheck size={24} strokeWidth={1.4} className="text-[#34c759]" />
                  <p className="text-[13px] text-[#8e8e93]">Rien à traiter.</p>
                </div>
              )}
              {actionable.length > 0 && <h2 className="px-2 pt-2 pb-1 text-[12px] font-semibold text-[#8e8e93]">À traiter</h2>}
              {actionable.map(t => (
                <TicketRow
                  key={t.ticket_id}
                  raw={t}
                  assignee={assignments[t.ticket_id]}
                  tags={ticketTags[t.ticket_id]}
                  handoffFrom={handoffFrom(t.ticket_id)}
                  agents={savAssignees()}
                  menuOpen={assignMenuTicket === t.ticket_id}
                  onOpenMenu={() => setAssignMenuTicket(id => id === t.ticket_id ? null : t.ticket_id)}
                  onAssignPick={(name) => assignTicket(t.ticket_id, name)}
                  processed={processedCache[t.ticket_id]}
                  selected={t.ticket_id === selectedId}
                  isProcessing={processingId === t.ticket_id}
                  doneAction={doneStatuses[t.ticket_id]?.action}
                  onClick={() => handleTicketClick(t)}
                />
              ))}
              {waitingClient.length > 0 && (
                <div className="mt-4 rounded-xl bg-[#ebebf0] p-1">
                  <button
                    onClick={() => setShowWaiting(v => !v)}
                    aria-expanded={showWaiting || waitingClient.some(t => t.ticket_id === selectedId)}
                    className="w-full flex items-center gap-2 px-2 py-2 text-left"
                  >
                    <Clock size={14} className="text-[#8e8e93] shrink-0" />
                    <span className="flex-1 min-w-0">
                      <span className="block text-[13px] font-semibold text-[#48484a]">En attente du client · {waitingClient.length}</span>
                      <span className="block text-[11px] text-[#8e8e93]">Rien à faire : ils reviennent ici quand le client répond.</span>
                    </span>
                    {showWaiting || waitingClient.some(t => t.ticket_id === selectedId) ? <ChevronUp size={14} className="text-[#8e8e93]" /> : <ChevronDown size={14} className="text-[#8e8e93]" />}
                  </button>
                  {(showWaiting || waitingClient.some(t => t.ticket_id === selectedId)) && waitingClient.map(t => (
                    <TicketRow
                      key={t.ticket_id}
                      compact
                      raw={t}
                      assignee={assignments[t.ticket_id]}
                      tags={ticketTags[t.ticket_id]}
                      processed={processedCache[t.ticket_id]}
                      selected={t.ticket_id === selectedId}
                      isProcessing={processingId === t.ticket_id}
                      onClick={() => handleTicketClick(t)}
                    />
                  ))}
                </div>
              )}
            </>
          )}

          {!listLoading && tab === 'done' && (
            <>
              {donelist.length === 0 && (
                <div className="flex flex-col items-center justify-center h-full gap-2 text-center p-4">
                  <Inbox size={24} strokeWidth={1.4} className="text-[#c7c7cc]" />
                  <p className="text-[13px] text-[#8e8e93]">Aucun ticket traité pendant cette session.</p>
                </div>
              )}
              {donelist.map(t => (
                <TicketRow
                  key={t.ticket_id}
                  raw={t}
                  assignee={assignments[t.ticket_id]}
                  tags={ticketTags[t.ticket_id]}
                  processed={processedCache[t.ticket_id]}
                  selected={t.ticket_id === selectedId}
                  doneAction={doneStatuses[t.ticket_id]?.action}
                  onClick={() => handleTicketClick(t)}
                />
              ))}
            </>
          )}

          {tab === 'qualite' && role === 'admin' && <QualitePanel />}
        </div>

        {/* Outils */}
        <div className="px-3 py-2 border-t border-[#e5e5ea] flex gap-1 shrink-0">
          <button
            onClick={() => setShowRules(true)}
            className="flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded-lg text-[12px] text-[#48484a] hover:bg-[#e8e8ed]"
          >
            <Settings size={13} strokeWidth={1.8} /> Règles
          </button>
          <button
            onClick={handleImport} disabled={importing}
            title={importMsg ?? 'Importer les tickets résolus comme exemples pour Claude'}
            className={`flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded-lg text-[12px] ${
              importMsg?.startsWith('✓') ? 'bg-[#e6f4ea] text-[#1a7f4b]'
              : importMsg ? 'bg-[#fde8e8] text-[#c81e1e]'
              : 'text-[#48484a] hover:bg-[#e8e8ed]'
            }`}
          >
            {importing ? <RefreshCw size={13} className="animate-spin" /> : <Download size={13} strokeWidth={1.8} />}
            {importing ? 'Import…' : importMsg?.startsWith('✓') ? importMsg : 'Historique'}
          </button>
        </div>
      </div>

      {/* ── CENTER — conversation + réponse ── */}
      <div className="flex-1 min-w-0 flex flex-col overflow-hidden bg-[#fbfbfd]">
        {tab === 'qualite' && role === 'admin'
          ? <QualiteDashboard />
          : selectedId === null
            ? <CenterEmpty />
            : isProcessing && !selectedProcessed
              ? <CenterSkeleton />
              : selectedProcessed
                ? <>
                    {/* Barre d'outils du ticket */}
                    <div className="h-14 shrink-0 flex items-center gap-1 px-4 border-b border-[#e5e5ea] bg-white/90 backdrop-blur">
                      <button onClick={() => stepTicket(-1)} disabled={!prevTicket} title="Ticket précédent" className="w-8 h-8 rounded-lg flex items-center justify-center text-[#48484a] hover:bg-[#f2f2f7] disabled:opacity-30"><ChevronLeft size={18} /></button>
                      <button onClick={() => stepTicket(1)} disabled={!nextTicket} title="Ticket suivant" className="w-8 h-8 rounded-lg flex items-center justify-center text-[#48484a] hover:bg-[#f2f2f7] disabled:opacity-30"><ChevronRight size={18} /></button>
                      <span className="ml-2 text-[13px] text-[#8e8e93]">Ticket #{selectedProcessed.ticket_id}</span>

                      <div className="ml-auto flex items-center gap-1">
                        {/* Attribuer */}
                        <div className="relative">
                          <button onClick={() => setToolMenu(m => m === 'assign' ? null : 'assign')} title="Attribuer" aria-expanded={toolMenu === 'assign'}
                            className="h-8 px-2 rounded-lg inline-flex items-center gap-1.5 text-[13px] text-[#48484a] hover:bg-[#f2f2f7]">
                            {selectedAssignee ? <Avatar name={selectedAssignee} size={20} /> : <UserPlus size={17} strokeWidth={1.8} />}
                            <span className="hidden xl:inline">{selectedAssignee ?? 'Attribuer'}</span>
                          </button>
                          {toolMenu === 'assign' && (
                            <>
                              <div className="fixed inset-0 z-30" onClick={() => setToolMenu(null)} />
                              <div className="absolute right-0 top-full mt-1 z-40 w-[200px] rounded-xl border border-[#e5e5ea] bg-white shadow-lg py-1 text-[13px]">
                                {savAssignees().map(a => (
                                  <button key={a} onClick={() => { assignTicket(selectedProcessed.ticket_id, a); setToolMenu(null) }} className="w-full flex items-center gap-2 px-3 py-2 hover:bg-[#f2f2f7] text-left">
                                    <Avatar name={a} size={20} /> <span className="flex-1">{a}{a === myName ? ' (moi)' : ''}</span>
                                    {selectedAssignee === a && <Check size={14} className="text-[#0a66f5]" />}
                                  </button>
                                ))}
                                <button onClick={() => { assignTicket(selectedProcessed.ticket_id, null); setToolMenu(null) }} className="w-full px-3 py-2 hover:bg-[#f2f2f7] text-left text-[#8e8e93] border-t border-[#f2f2f7]">Retirer l&apos;attribution</button>
                                {selectedAssignee && assignMeta[selectedProcessed.ticket_id]?.by && !assignMeta[selectedProcessed.ticket_id]!.by!.includes('@') && (
                                  <p className="px-3 pt-1 pb-1.5 text-[11px] text-[#8e8e93]">Attribué par {assignMeta[selectedProcessed.ticket_id]!.by}{assignMeta[selectedProcessed.ticket_id]?.at ? ` · ${fmtTime(assignMeta[selectedProcessed.ticket_id]!.at!)}` : ''}</p>
                                )}
                              </div>
                            </>
                          )}
                        </div>
                        {/* Balises */}
                        <div className="relative">
                          <button onClick={() => setToolMenu(m => m === 'tags' ? null : 'tags')} title="Balises" aria-expanded={toolMenu === 'tags'}
                            className="w-8 h-8 rounded-lg flex items-center justify-center text-[#48484a] hover:bg-[#f2f2f7] relative">
                            <Tag size={16} strokeWidth={1.8} />
                            {(ticketTags[selectedProcessed.ticket_id]?.length ?? 0) > 0 && <span className="absolute top-1 right-1 w-2 h-2 rounded-full bg-[#0a66f5]" />}
                          </button>
                          {toolMenu === 'tags' && (
                            <>
                              <div className="fixed inset-0 z-30" onClick={() => setToolMenu(null)} />
                              <div className="absolute right-0 top-full mt-1 z-40 w-[230px] rounded-xl border border-[#e5e5ea] bg-white shadow-lg py-1 text-[13px]">
                                {TICKET_TAGS.map(t => {
                                  const on = (ticketTags[selectedProcessed.ticket_id] ?? []).includes(t.key)
                                  return (
                                    <button key={t.key} onClick={() => toggleTag(selectedProcessed.ticket_id, t.key)} className="w-full flex items-center gap-2 px-3 py-2 hover:bg-[#f2f2f7] text-left">
                                      <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: t.text }} />
                                      <span className="flex-1">{t.label}</span>
                                      {on && <Check size={14} className="text-[#0a66f5]" />}
                                    </button>
                                  )
                                })}
                              </div>
                            </>
                          )}
                        </div>
                        <button
                          onClick={resolveSelected} disabled={resolving}
                          title="Clore le ticket sans envoyer de réponse"
                          className="ml-2 h-8 pl-3 pr-3.5 rounded-full bg-[#1d1d1f] text-white text-[13px] font-semibold inline-flex items-center gap-1.5 hover:bg-black disabled:opacity-50"
                        >
                          {resolving ? <RefreshCw size={13} className="animate-spin" /> : <Check size={14} strokeWidth={2.5} />} Résoudre
                        </button>
                      </div>
                    </div>
                    {resolveError && <p className="shrink-0 px-6 py-2 text-[12px] text-[#c81e1e] bg-[#fde8e8]">{resolveError}</p>}
                    {selectedAssignee && myName && selectedAssignee !== myName && (
                      <p className="shrink-0 px-6 py-2 text-[13px] text-[#a15c07] bg-[#fff8e6] border-b border-[#fdecc8]">
                        Ce ticket est pris en charge par <b>{selectedAssignee}</b>. L&apos;envoi d&apos;une réponse sera bloqué pour éviter un doublon ; réattribue-le d&apos;abord si besoin.
                      </p>
                    )}

                    <div className="flex-1 overflow-y-auto">
                      <TicketDetail
                        ticket={selectedProcessed}
                        refreshKey={commentRefreshKey}
                        customerName={selectedName}
                        assignee={selectedAssignee}
                        tags={ticketTags[selectedProcessed.ticket_id] ?? []}
                      />
                    </div>

                  </>
                : <CenterEmpty />
        }
      </div>

      {/* ── RIGHT — la cliente, Claude, la commande ── */}
      {tab !== 'qualite' && (
        <div className="w-[400px] shrink-0 flex flex-col overflow-hidden border-l border-[#e5e5ea] bg-[#f5f5f7]">
          {selectedId === null ? (
            <div className="flex items-center justify-center h-full">
              <p className="text-[13px] text-[#8e8e93]">Aucun ticket sélectionné</p>
            </div>
          ) : isProcessing && !selectedProcessed ? (
            <RightPanelSkeleton />
          ) : selectedProcessed ? (
            <div className="flex-1 min-h-0 flex flex-col gap-3 p-3">
              <ClaudeSummary ticket={selectedProcessed} />
              {selectedProcessed.status === 'pending' ? (
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
                  onStartAnswer={() => claimForAnswer(selectedProcessed.ticket_id)}
                />
              )}
            </div>
          ) : null}
        </div>
      )}
    </div>
  )
}
