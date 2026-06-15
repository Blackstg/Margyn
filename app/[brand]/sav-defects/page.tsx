'use client'

export const dynamic = 'force-dynamic'

import { useState, useEffect, useCallback, useRef } from 'react'
import { Plus, AlertTriangle, Clock, PackageX, X, Image as ImageIcon, Search, FileText, Truck, RotateCcw } from 'lucide-react'

// ─── Types ──────────────────────────────────────────────────────────────────

interface Claim {
  id: string
  brand: string
  claim_type: string
  reported_at: string
  sku: string | null
  product_name: string | null
  shopify_order_id: string | null
  shopify_variant_id: string | null
  received_sku: string | null
  received_product_name: string | null
  quantity: number
  defect_description: string | null
  photo_url: string | null
  return_label_url: string | null
  status: string
  supplier_claim_ref: string | null
  reship_tracking_ref: string | null
  return_tracking_ref: string | null
  claim_sent_at: string | null
  received_at: string | null
  return_received_at: string | null
  charged_amount: number
  notes: string | null
}

interface Stats {
  month: string
  awaiting: { count: number; oldest_days: number }
  wronglyBilled: { total_amount: number; lines: { claim_id: string; order_name: string; amount: number; isFW: boolean }[] }
  topSkus: { sku: string; product_name: string | null; total_qty: number }[]
}

interface LineItem { variant_id: string | null; product_name: string; variant_title: string | null; sku: string | null; image_url: string | null; quantity: number }
interface Variant { shopify_variant_id: string; product_title: string; variant_title: string | null; image_url: string | null; sku_fr: string | null; sku_cn: string | null }

// ─── Statuts & types ──────────────────────────────────────────────────────────

const STATUS_OPTS = [
  'signale', 'reclamation_envoyee', 'repro_confirmee', 'etiquette_envoyee', 'retour_recu', 'reexpedie', 'recu', 'clos', 'litige',
] as const

const STATUS_LABEL: Record<string, string> = {
  signale:             'Signalé',
  reclamation_envoyee: 'Réclamation envoyée',
  repro_confirmee:     'Repro confirmée',
  etiquette_envoyee:   'Étiquette envoyée',
  retour_recu:         'Retour reçu',
  reexpedie:           'Réexpédié',
  recu:                'Reçu',
  clos:                'Clos',
  litige:              'Litige',
}

const STATUS_COLOR: Record<string, [string, string]> = {
  signale:             ['#F8F8F7', '#6b6b63'],
  reclamation_envoyee: ['#eef2ff', '#4f46e5'],
  repro_confirmee:     ['#fffbeb', '#92650a'],
  etiquette_envoyee:   ['#eef2ff', '#4f46e5'],
  retour_recu:         ['#eef6ff', '#1d4ed8'],
  reexpedie:           ['#eef6ff', '#1d4ed8'],
  recu:                ['#f0faf5', '#1a7f4b'],
  clos:                ['#f0f0ee', '#6b6b63'],
  litige:              ['#fff1f1', '#c7293a'],
}

const TYPE_LABEL: Record<string, string> = { defaut_fournisseur: 'Défaut', erreur_envoi: 'Erreur envoi' }
const TYPE_COLOR: Record<string, [string, string]> = {
  defaut_fournisseur: ['#fffbeb', '#92650a'],
  erreur_envoi:       ['#eef6ff', '#1d4ed8'],
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const fmtEur = (n: number) =>
  new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }).format(n)

function fmtDate(s: string | null): string {
  if (!s) return '—'
  return new Date(s + 'T00:00:00').toLocaleDateString('fr-FR', { day: '2-digit', month: 'short' })
}

function daysSince(s: string | null): number | null {
  if (!s) return null
  return Math.max(0, Math.floor((Date.now() - new Date(s + 'T00:00:00').getTime()) / 86400000))
}

function monthOptions(): { value: string; label: string }[] {
  const opts: { value: string; label: string }[] = []
  const d = new Date()
  for (let i = 0; i < 12; i++) {
    const ym = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
    opts.push({ value: ym, label: d.toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' }) })
    d.setMonth(d.getMonth() - 1)
  }
  return opts
}

function variantLabel(v: Variant): string {
  const sku = v.sku_fr ?? v.sku_cn ?? ''
  return `${v.product_title}${v.variant_title ? ' · ' + v.variant_title : ''}${sku ? ` (${sku})` : ''}`
}

// ─── Page ──────────────────────────────────────────────────────────────────────

export default function SavDefectsPage() {
  const BRAND = 'moom'
  const [claims, setClaims] = useState<Claim[]>([])
  const [stats, setStats]   = useState<Stats | null>(null)
  const [loading, setLoading] = useState(true)
  const [month, setMonth]   = useState(() => monthOptions()[0].value)
  const [typeFilter, setTypeFilter] = useState<'all' | 'defaut_fournisseur' | 'erreur_envoi'>('all')
  const [showForm, setShowForm] = useState(false)

  const loadClaims = useCallback(async () => {
    const res = await fetch(`/api/sav-defects?brand=${BRAND}`)
    const data = await res.json()
    setClaims(data.claims ?? [])
  }, [])

  const loadStats = useCallback(async () => {
    const res = await fetch(`/api/sav-defects/stats?brand=${BRAND}&month=${month}`)
    const data = await res.json()
    setStats(data)
  }, [month])

  const reload = useCallback(() => {
    setLoading(true)
    Promise.all([loadClaims(), loadStats()]).finally(() => setLoading(false))
  }, [loadClaims, loadStats])

  useEffect(() => { reload() }, [reload])

  async function patchClaim(id: string, patch: Partial<Claim>) {
    setClaims(cs => cs.map(c => (c.id === id ? { ...c, ...patch } : c)))
    await fetch('/api/sav-defects', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, ...patch }),
    })
    loadStats()
  }

  const billedClaimIds = new Set(stats?.wronglyBilled.lines.map(l => l.claim_id) ?? [])
  const visible = claims.filter(c => typeFilter === 'all' || c.claim_type === typeFilter)

  return (
    <div className="min-h-screen bg-[#f8f7f5] pl-[72px]">
      <div className="max-w-6xl mx-auto px-6 py-8 space-y-6">

        {/* Header */}
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-[0.1em] text-[#aeb0c9] mb-1">Mōom</p>
            <h1 className="text-xl font-bold text-[#1a1a2e]">SAV / Défauts &amp; erreurs d&apos;envoi</h1>
          </div>
          <div className="flex items-center gap-2">
            <select
              value={month}
              onChange={e => setMonth(e.target.value)}
              className="px-3 py-2 rounded-xl bg-white border border-[#e8e8e4] text-xs font-medium text-[#1a1a2e] capitalize cursor-pointer"
            >
              {monthOptions().map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
            <button
              onClick={() => setShowForm(true)}
              className="flex items-center gap-2 px-4 py-2 rounded-xl bg-[#1a1a2e] text-white text-xs font-semibold hover:bg-[#2a2a3e] transition-colors"
            >
              <Plus size={14} /> Nouveau dossier
            </button>
          </div>
        </div>

        {/* 3 cartes */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <Card title="En attente de réception" icon={<Clock size={14} className="text-[#aeb0c9]" />}
            value={stats ? String(stats.awaiting.count) : '—'}
            sub={stats && stats.awaiting.count > 0 ? `plus ancien : ${stats.awaiting.oldest_days} j` : 'aucun dossier ouvert'} />
          <Card title="Envois SAV facturés à tort" icon={<AlertTriangle size={14} className="text-[#c7293a]" />}
            value={stats ? fmtEur(stats.wronglyBilled.total_amount) : '—'}
            sub={stats ? `${stats.wronglyBilled.lines.length} ligne(s) à contester` : ''}
            danger={!!stats && stats.wronglyBilled.total_amount > 0} />
          <div className="bg-white rounded-[20px] shadow-[0_2px_16px_rgba(0,0,0,0.06)] p-5">
            <div className="flex items-center gap-1.5 mb-3">
              <PackageX size={14} className="text-[#aeb0c9]" />
              <p className="text-[10px] font-semibold text-[#6b6b63] uppercase tracking-[0.1em]">Taux de défaut par SKU</p>
            </div>
            {stats && stats.topSkus.length > 0 ? (
              <div className="space-y-1.5">
                {stats.topSkus.map(s => (
                  <div key={s.sku} className="flex items-center justify-between text-xs">
                    <span className="font-medium text-[#1a1a2e] truncate mr-2" title={s.product_name ?? s.sku}>{s.sku}</span>
                    <span className="tabular-nums font-semibold text-[#6b6b63] shrink-0">{s.total_qty}</span>
                  </div>
                ))}
              </div>
            ) : <p className="text-xs text-[#9b9b93]">Aucun défaut ce mois.</p>}
          </div>
        </div>

        {/* Table */}
        <div className="bg-white rounded-[20px] shadow-[0_2px_16px_rgba(0,0,0,0.06)] overflow-hidden">
          <div className="flex items-center justify-between px-6 py-4 border-b border-[#f0f0ee]">
            <p className="text-[10px] font-semibold text-[#6b6b63] uppercase tracking-[0.1em]">Dossiers ({visible.length})</p>
            <div className="inline-flex items-center bg-[#F8F8F7] rounded-lg p-0.5 gap-0.5">
              {([['all', 'Tous'], ['defaut_fournisseur', 'Défauts'], ['erreur_envoi', 'Erreurs envoi']] as const).map(([k, lbl]) => (
                <button key={k} onClick={() => setTypeFilter(k)}
                  className={`px-3 py-1.5 rounded-md text-xs font-medium transition-all ${typeFilter === k ? 'bg-white text-[#1a1a18] shadow-sm' : 'text-[#6b6b63] hover:text-[#1a1a18]'}`}>
                  {lbl}
                </button>
              ))}
            </div>
          </div>
          {loading ? (
            <div className="p-10 text-center text-sm text-[#9b9b93]">Chargement…</div>
          ) : visible.length === 0 ? (
            <div className="p-10 text-center text-sm text-[#9b9b93]">Aucun dossier. Cliquez sur « Nouveau dossier ».</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-left text-[#9b9b93] border-b border-[#f0f0ee]">
                    <Th>Type</Th><Th>Signalé</Th><Th>Article</Th><Th>Qté</Th><Th>Statut</Th>
                    <Th>Jours</Th><Th>Réexpédition</Th><Th>Retour</Th><Th>Reçu le</Th><Th>Facturé</Th><Th>Pièce</Th>
                  </tr>
                </thead>
                <tbody>
                  {visible.map(c => {
                    const open = c.status !== 'recu' && c.status !== 'clos'
                    const days = open ? daysSince(c.claim_sent_at ?? c.reported_at) : null
                    const overdue = days !== null && days > 30
                    const isErr = c.claim_type === 'erreur_envoi'
                    return (
                      <tr key={c.id} className={`border-b border-[#f5f5f3] last:border-0 ${overdue ? 'bg-[#fff5f5]' : 'hover:bg-[#fafafa]'}`}>
                        <Td>
                          <span className="inline-flex items-center px-2 py-0.5 rounded-md text-[10px] font-semibold"
                            style={{ background: TYPE_COLOR[c.claim_type]?.[0] ?? '#F8F8F7', color: TYPE_COLOR[c.claim_type]?.[1] ?? '#6b6b63' }}>
                            {TYPE_LABEL[c.claim_type] ?? c.claim_type}
                          </span>
                        </Td>
                        <Td className="whitespace-nowrap text-[#6b6b63]">
                          {fmtDate(c.reported_at)}
                          {c.shopify_order_id && <div className="text-[10px] text-[#aeb0c9]">{c.shopify_order_id}</div>}
                        </Td>
                        <Td>
                          <div className="font-medium text-[#1a1a18]">{c.sku ?? '—'}</div>
                          {c.product_name && <div className="text-[#9b9b93] truncate max-w-[200px]">{c.product_name}</div>}
                          {isErr && (
                            <div className="text-[10px] text-[#c7293a] mt-0.5">
                              reçu à tort : {c.received_product_name ?? c.received_sku ?? '—'}
                            </div>
                          )}
                          {billedClaimIds.has(c.id) && (
                            <span className="inline-flex items-center gap-1 mt-0.5 text-[10px] font-semibold text-[#c7293a]">
                              <AlertTriangle size={10} /> facturé
                            </span>
                          )}
                        </Td>
                        <Td className="tabular-nums">{c.quantity}</Td>
                        <Td>
                          <select value={c.status} onChange={e => patchClaim(c.id, { status: e.target.value })}
                            className="rounded-md px-2 py-1 text-xs font-medium border-0 cursor-pointer"
                            style={{ background: STATUS_COLOR[c.status]?.[0] ?? '#F8F8F7', color: STATUS_COLOR[c.status]?.[1] ?? '#6b6b63' }}>
                            {STATUS_OPTS.map(s => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
                          </select>
                        </Td>
                        <Td>
                          {days !== null ? (
                            <span className={`tabular-nums font-semibold ${overdue ? 'text-[#c7293a]' : 'text-[#6b6b63]'}`}>{days} j</span>
                          ) : <span className="text-[#cfcfc8]">—</span>}
                        </Td>
                        <Td>
                          <div className="flex items-center gap-1 text-[#aeb0c9]"><Truck size={11} />
                            <input defaultValue={c.reship_tracking_ref ?? ''} placeholder="—"
                              onBlur={e => { if (e.target.value !== (c.reship_tracking_ref ?? '')) patchClaim(c.id, { reship_tracking_ref: e.target.value || null }) }}
                              className="w-24 rounded-md px-2 py-1 bg-[#f8f8f7] focus:bg-white focus:ring-1 focus:ring-[#aeb0c9] outline-none" />
                          </div>
                        </Td>
                        <Td>
                          {isErr ? (
                            <div className="space-y-1">
                              <div className="flex items-center gap-1 text-[#aeb0c9]"><RotateCcw size={11} />
                                <input defaultValue={c.return_tracking_ref ?? ''} placeholder="—"
                                  onBlur={e => { if (e.target.value !== (c.return_tracking_ref ?? '')) patchClaim(c.id, { return_tracking_ref: e.target.value || null }) }}
                                  className="w-24 rounded-md px-2 py-1 bg-[#f8f8f7] focus:bg-white focus:ring-1 focus:ring-[#aeb0c9] outline-none" />
                              </div>
                              {c.return_label_url && (
                                <a href={c.return_label_url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-[10px] text-[#4f46e5] hover:underline">
                                  <FileText size={10} /> étiquette
                                </a>
                              )}
                            </div>
                          ) : <span className="text-[#cfcfc8]">—</span>}
                        </Td>
                        <Td>
                          <input type="date" defaultValue={c.received_at ?? ''}
                            onBlur={e => { if (e.target.value !== (c.received_at ?? '')) patchClaim(c.id, { received_at: e.target.value || null }) }}
                            className="rounded-md px-2 py-1 bg-[#f8f8f7] focus:bg-white focus:ring-1 focus:ring-[#aeb0c9] outline-none" />
                        </Td>
                        <Td className="tabular-nums text-[#6b6b63]">{c.charged_amount > 0 ? fmtEur(c.charged_amount) : '—'}</Td>
                        <Td>
                          {c.photo_url ? (
                            <a href={c.photo_url} target="_blank" rel="noreferrer">
                              <img src={c.photo_url} alt="" className="w-9 h-9 rounded-lg object-cover border border-[#e8e8e4]" />
                            </a>
                          ) : <span className="text-[#cfcfc8]">—</span>}
                        </Td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {showForm && <NewClaimForm brand={BRAND} onClose={() => setShowForm(false)} onCreated={() => { setShowForm(false); reload() }} />}
    </div>
  )
}

// ─── Sous-composants ────────────────────────────────────────────────────────

function Card({ title, icon, value, sub, danger }: { title: string; icon: React.ReactNode; value: string; sub?: string; danger?: boolean }) {
  return (
    <div className="bg-white rounded-[20px] shadow-[0_2px_16px_rgba(0,0,0,0.06)] p-5">
      <div className="flex items-center gap-1.5 mb-3">{icon}
        <p className="text-[10px] font-semibold text-[#6b6b63] uppercase tracking-[0.1em]">{title}</p>
      </div>
      <p className={`text-2xl font-bold tabular-nums ${danger ? 'text-[#c7293a]' : 'text-[#1a1a18]'}`}>{value}</p>
      {sub && <p className="text-xs text-[#9b9b93] mt-1">{sub}</p>}
    </div>
  )
}

function Th({ children }: { children: React.ReactNode }) {
  return <th className="px-4 py-2.5 font-semibold uppercase tracking-[0.08em] text-[10px]">{children}</th>
}
function Td({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return <td className={`px-4 py-3 align-top ${className}`}>{children}</td>
}

function NewClaimForm({ brand, onClose, onCreated }: { brand: string; onClose: () => void; onCreated: () => void }) {
  const [type, setType] = useState<'defaut_fournisseur' | 'erreur_envoi'>('defaut_fournisseur')
  const [form, setForm] = useState({
    reported_at: new Date().toISOString().slice(0, 10),
    quantity: '1', defect_description: '',
    sku: '', product_name: '', shopify_order_id: '', shopify_variant_id: '',
    received_sku: '', received_product_name: '', reship_tracking_ref: '', return_tracking_ref: '',
  })
  const [orderInput, setOrderInput] = useState('')
  const [lineItems, setLineItems]   = useState<LineItem[] | null>(null)
  const [lookupErr, setLookupErr]   = useState('')
  const [lookingUp, setLookingUp]   = useState(false)
  const [variants, setVariants]     = useState<Variant[]>([])
  const [photo, setPhoto] = useState<File | null>(null)
  const [label, setLabel] = useState<File | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const photoRef = useRef<HTMLInputElement>(null)
  const labelRef = useRef<HTMLInputElement>(null)

  function upd(k: string, v: string) { setForm(f => ({ ...f, [k]: v })) }

  // Charge le catalogue (article reçu à tort) en mode erreur d'envoi
  useEffect(() => {
    if (type === 'erreur_envoi' && variants.length === 0) {
      fetch('/api/produits').then(r => r.json()).then(d => setVariants(d.variants ?? [])).catch(() => {})
    }
  }, [type, variants.length])

  async function lookupOrder() {
    if (!orderInput.trim()) return
    setLookingUp(true); setLookupErr(''); setLineItems(null)
    try {
      const res = await fetch(`/api/sav-defects/order-lookup?brand=${brand}&order=${encodeURIComponent(orderInput.trim())}`)
      const data = await res.json()
      if (!res.ok) { setLookupErr(data.error ?? 'Erreur'); setLineItems([]) }
      else {
        setLineItems(data.line_items ?? [])
        upd('shopify_order_id', data.order_name ?? `#${orderInput.replace(/[^0-9]/g, '')}`)
      }
    } catch (e) { setLookupErr(String(e)); setLineItems([]) }
    setLookingUp(false)
  }

  function selectLineItem(li: LineItem) {
    setForm(f => ({
      ...f,
      sku: li.sku ?? '',
      product_name: [li.product_name, li.variant_title].filter(Boolean).join(' · '),
      shopify_variant_id: li.variant_id ?? '',
      quantity: String(li.quantity || 1),
    }))
  }

  function selectReceived(variantId: string) {
    const v = variants.find(x => x.shopify_variant_id === variantId)
    if (!v) { setForm(f => ({ ...f, received_sku: '', received_product_name: '' })); return }
    setForm(f => ({
      ...f,
      received_sku: v.sku_fr ?? v.sku_cn ?? '',
      received_product_name: [v.product_title, v.variant_title].filter(Boolean).join(' · '),
    }))
  }

  async function submit() {
    if (type === 'erreur_envoi' && (!form.shopify_order_id || !form.received_sku)) {
      setError('Renseignez la commande et l\'article reçu à tort.'); return
    }
    if (type === 'defaut_fournisseur' && !form.sku.trim() && !form.defect_description.trim()) {
      setError('Renseignez au moins un SKU ou une description.'); return
    }
    setSaving(true); setError('')
    try {
      const res = await fetch('/api/sav-defects', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...form, brand, claim_type: type }),
      })
      const data = await res.json()
      if (!res.ok) { setError(data.error ?? 'Erreur'); setSaving(false); return }
      const id = data.claim?.id
      if (id && photo) { const fd = new FormData(); fd.append('photo', photo); await fetch(`/api/sav-defects/${id}/upload`, { method: 'POST', body: fd }) }
      if (id && label) { const fd = new FormData(); fd.append('return_label', label); await fetch(`/api/sav-defects/${id}/upload`, { method: 'POST', body: fd }) }
      onCreated()
    } catch (e) { setError(String(e)); setSaving(false) }
  }

  const input = 'w-full px-3 py-2 rounded-xl bg-[#f8f8f7] border border-[#e8e8e4] text-sm outline-none focus:bg-white focus:ring-1 focus:ring-[#aeb0c9]'

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4" onClick={onClose}>
      <div className="bg-white rounded-[20px] shadow-xl w-full max-w-lg max-h-[90vh] overflow-y-auto p-6 space-y-4" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <h2 className="text-base font-bold text-[#1a1a18]">Nouveau dossier</h2>
          <button onClick={onClose} className="text-[#9b9b93] hover:text-[#1a1a18]"><X size={18} /></button>
        </div>

        {/* Type toggle */}
        <div className="inline-flex w-full bg-[#F8F8F7] rounded-xl p-0.5 gap-0.5">
          {([['defaut_fournisseur', 'Défaut fournisseur'], ['erreur_envoi', "Erreur d'envoi"]] as const).map(([k, lbl]) => (
            <button key={k} onClick={() => setType(k)}
              className={`flex-1 px-3 py-2 rounded-lg text-xs font-semibold transition-all ${type === k ? 'bg-white text-[#1a1a18] shadow-sm' : 'text-[#6b6b63]'}`}>
              {lbl}
            </button>
          ))}
        </div>

        {/* Lookup commande */}
        <Field label={type === 'erreur_envoi' ? 'N° commande (obligatoire)' : 'N° commande (optionnel)'}>
          <div className="flex gap-2">
            <input value={orderInput} onChange={e => setOrderInput(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); lookupOrder() } }}
              className={input} placeholder="#1234" />
            <button type="button" onClick={lookupOrder} disabled={lookingUp}
              className="flex items-center gap-1.5 px-3 rounded-xl bg-[#1a1a2e] text-white text-xs font-semibold hover:bg-[#2a2a3e] disabled:opacity-50 shrink-0">
              <Search size={13} /> {lookingUp ? '…' : 'Chercher'}
            </button>
          </div>
        </Field>

        {lookupErr && <p className="text-xs text-[#c7293a]">{lookupErr}</p>}

        {/* Articles de la commande */}
        {lineItems && lineItems.length > 0 && (
          <div className="space-y-1.5">
            <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-[#9b9b93]">
              {type === 'erreur_envoi' ? 'Article commandé (correct, à réexpédier)' : 'Sélectionnez l\'article concerné'}
            </p>
            <div className="space-y-1 max-h-44 overflow-y-auto">
              {lineItems.map((li, i) => {
                const selected = form.shopify_variant_id && form.shopify_variant_id === li.variant_id
                return (
                  <button key={i} type="button" onClick={() => selectLineItem(li)}
                    className={`w-full flex items-center gap-3 p-2 rounded-xl border text-left transition-all ${selected ? 'border-[#1a1a2e] bg-[#f8f8ff]' : 'border-[#e8e8e4] hover:bg-[#f8f8f7]'}`}>
                    {li.image_url
                      ? <img src={li.image_url} alt="" className="w-10 h-10 rounded-lg object-cover border border-[#e8e8e4] shrink-0" />
                      : <div className="w-10 h-10 rounded-lg bg-[#f0f0ee] shrink-0" />}
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-medium text-[#1a1a18] truncate">{li.product_name}</div>
                      <div className="text-xs text-[#9b9b93]">{[li.variant_title, li.sku].filter(Boolean).join(' · ') || '—'} · ×{li.quantity}</div>
                    </div>
                  </button>
                )
              })}
            </div>
          </div>
        )}
        {lineItems && lineItems.length === 0 && !lookupErr && (
          <p className="text-xs text-[#9b9b93]">Aucun article trouvé pour cette commande.</p>
        )}

        {/* Article reçu à tort (erreur d'envoi) */}
        {type === 'erreur_envoi' && (
          <Field label="Article reçu à tort (catalogue)">
            <select value={variants.find(v => (v.sku_fr ?? v.sku_cn) === form.received_sku)?.shopify_variant_id ?? ''}
              onChange={e => selectReceived(e.target.value)} className={input}>
              <option value="">— Sélectionner —</option>
              {variants.map(v => <option key={v.shopify_variant_id} value={v.shopify_variant_id}>{variantLabel(v)}</option>)}
            </select>
          </Field>
        )}

        <div className="grid grid-cols-2 gap-3">
          <Field label="Date signalement">
            <input type="date" value={form.reported_at} onChange={e => upd('reported_at', e.target.value)} className={input} />
          </Field>
          <Field label="Quantité">
            <input type="number" min={1} value={form.quantity} onChange={e => upd('quantity', e.target.value)} className={input} />
          </Field>

          {type === 'defaut_fournisseur' && (
            <div className="col-span-2">
              <Field label="SKU (si pas de commande)">
                <input value={form.sku} onChange={e => upd('sku', e.target.value)} className={input} placeholder="MOOM-XXX" />
              </Field>
            </div>
          )}

          {type === 'defaut_fournisseur' && (
            <div className="col-span-2">
              <Field label="Description du défaut">
                <textarea value={form.defect_description} onChange={e => upd('defect_description', e.target.value)} rows={3} className={input} />
              </Field>
            </div>
          )}

          {type === 'erreur_envoi' && (
            <>
              <Field label="N° suivi retour">
                <input value={form.return_tracking_ref} onChange={e => upd('return_tracking_ref', e.target.value)} className={input} />
              </Field>
              <Field label="N° réexpédition">
                <input value={form.reship_tracking_ref} onChange={e => upd('reship_tracking_ref', e.target.value)} className={input} />
              </Field>
            </>
          )}
        </div>

        {/* Uploads */}
        <div className="grid grid-cols-2 gap-3">
          <Field label="Photo">
            <input ref={photoRef} type="file" accept="image/*" onChange={e => setPhoto(e.target.files?.[0] ?? null)} className="hidden" />
            <button type="button" onClick={() => photoRef.current?.click()} className="flex items-center gap-2 px-3 py-2 rounded-xl border border-[#e8e8e4] text-sm text-[#6b6b63] hover:bg-[#f8f8f7] w-full">
              <ImageIcon size={15} /> <span className="truncate">{photo ? photo.name : 'Photo'}</span>
            </button>
          </Field>
          {type === 'erreur_envoi' && (
            <Field label="Étiquette de retour">
              <input ref={labelRef} type="file" accept="image/*,application/pdf" onChange={e => setLabel(e.target.files?.[0] ?? null)} className="hidden" />
              <button type="button" onClick={() => labelRef.current?.click()} className="flex items-center gap-2 px-3 py-2 rounded-xl border border-[#e8e8e4] text-sm text-[#6b6b63] hover:bg-[#f8f8f7] w-full">
                <FileText size={15} /> <span className="truncate">{label ? label.name : 'Étiquette'}</span>
              </button>
            </Field>
          )}
        </div>

        {error && <p className="text-xs text-[#c7293a]">{error}</p>}

        <div className="flex justify-end gap-2 pt-1">
          <button onClick={onClose} className="px-4 py-2 rounded-xl text-sm text-[#6b6b63] hover:bg-[#f8f8f7]">Annuler</button>
          <button onClick={submit} disabled={saving} className="px-4 py-2 rounded-xl bg-[#1a1a2e] text-white text-sm font-semibold hover:bg-[#2a2a3e] disabled:opacity-50">
            {saving ? 'Enregistrement…' : 'Créer le dossier'}
          </button>
        </div>
      </div>
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="block text-[10px] font-semibold uppercase tracking-[0.08em] text-[#9b9b93] mb-1">{label}</span>
      {children}
    </label>
  )
}
