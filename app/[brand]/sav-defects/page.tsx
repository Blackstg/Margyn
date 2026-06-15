'use client'

export const dynamic = 'force-dynamic'

import { useState, useEffect, useCallback, useRef } from 'react'
import { Plus, AlertTriangle, Clock, PackageX, X, Image as ImageIcon } from 'lucide-react'

// ─── Types ──────────────────────────────────────────────────────────────────

interface Claim {
  id: string
  brand: string
  reported_at: string
  sku: string | null
  product_name: string | null
  shopify_order_id: string | null
  quantity: number
  defect_description: string | null
  photo_url: string | null
  status: string
  supplier_claim_ref: string | null
  reship_tracking_ref: string | null
  claim_sent_at: string | null
  received_at: string | null
  charged_amount: number
  notes: string | null
}

interface Stats {
  month: string
  awaiting: { count: number; oldest_days: number }
  wronglyBilled: { total_amount: number; lines: { claim_id: string; order_name: string; amount: number; isFW: boolean }[] }
  topSkus: { sku: string; product_name: string | null; total_qty: number }[]
}

// ─── Statuts ──────────────────────────────────────────────────────────────────

const STATUS_OPTS = [
  'signale', 'reclamation_envoyee', 'repro_confirmee', 'reexpedie', 'recu', 'clos', 'litige',
] as const

const STATUS_LABEL: Record<string, string> = {
  signale:             'Signalé',
  reclamation_envoyee: 'Réclamation envoyée',
  repro_confirmee:     'Repro confirmée',
  reexpedie:           'Réexpédié',
  recu:                'Reçu',
  clos:                'Clos',
  litige:              'Litige',
}

const STATUS_COLOR: Record<string, [string, string]> = {
  signale:             ['#F8F8F7', '#6b6b63'],
  reclamation_envoyee: ['#eef2ff', '#4f46e5'],
  repro_confirmee:     ['#fffbeb', '#92650a'],
  reexpedie:           ['#eef6ff', '#1d4ed8'],
  recu:                ['#f0faf5', '#1a7f4b'],
  clos:                ['#f0f0ee', '#6b6b63'],
  litige:              ['#fff1f1', '#c7293a'],
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

// ─── Page ──────────────────────────────────────────────────────────────────────

export default function SavDefectsPage() {
  const BRAND = 'moom'
  const [claims, setClaims] = useState<Claim[]>([])
  const [stats, setStats]   = useState<Stats | null>(null)
  const [loading, setLoading] = useState(true)
  const [month, setMonth]   = useState(() => monthOptions()[0].value)
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

  useEffect(() => {
    setLoading(true)
    Promise.all([loadClaims(), loadStats()]).finally(() => setLoading(false))
  }, [loadClaims, loadStats])

  // Édition inline → PATCH + maj optimiste
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

  return (
    <div className="min-h-screen bg-[#f8f7f5] pl-[72px]">
      <div className="max-w-6xl mx-auto px-6 py-8 space-y-6">

        {/* Header */}
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-[0.1em] text-[#aeb0c9] mb-1">Mōom</p>
            <h1 className="text-xl font-bold text-[#1a1a2e]">SAV / Défauts fournisseur</h1>
          </div>
          <div className="flex items-center gap-2">
            <select
              value={month}
              onChange={e => setMonth(e.target.value)}
              className="px-3 py-2 rounded-xl bg-white border border-[#e8e8e4] text-xs font-medium text-[#1a1a2e] capitalize cursor-pointer"
            >
              {monthOptions().map(o => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
            <button
              onClick={() => setShowForm(true)}
              className="flex items-center gap-2 px-4 py-2 rounded-xl bg-[#1a1a2e] text-white text-xs font-semibold hover:bg-[#2a2a3e] transition-colors"
            >
              <Plus size={14} /> Nouveau défaut
            </button>
          </div>
        </div>

        {/* 3 cartes */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <Card
            title="En attente de réception"
            icon={<Clock size={14} className="text-[#aeb0c9]" />}
            value={stats ? String(stats.awaiting.count) : '—'}
            sub={stats && stats.awaiting.count > 0 ? `plus ancien : ${stats.awaiting.oldest_days} j` : 'aucun dossier ouvert'}
          />
          <Card
            title="Envois SAV facturés à tort"
            icon={<AlertTriangle size={14} className="text-[#c7293a]" />}
            value={stats ? fmtEur(stats.wronglyBilled.total_amount) : '—'}
            sub={stats ? `${stats.wronglyBilled.lines.length} ligne(s) à contester` : ''}
            danger={!!stats && stats.wronglyBilled.total_amount > 0}
          />
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
            ) : (
              <p className="text-xs text-[#9b9b93]">Aucun défaut ce mois.</p>
            )}
          </div>
        </div>

        {/* Table */}
        <div className="bg-white rounded-[20px] shadow-[0_2px_16px_rgba(0,0,0,0.06)] overflow-hidden">
          <div className="px-6 py-4 border-b border-[#f0f0ee]">
            <p className="text-[10px] font-semibold text-[#6b6b63] uppercase tracking-[0.1em]">
              Dossiers ({claims.length})
            </p>
          </div>
          {loading ? (
            <div className="p-10 text-center text-sm text-[#9b9b93]">Chargement…</div>
          ) : claims.length === 0 ? (
            <div className="p-10 text-center text-sm text-[#9b9b93]">Aucun dossier. Cliquez sur « Nouveau défaut ».</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-left text-[#9b9b93] border-b border-[#f0f0ee]">
                    <Th>Signalé</Th><Th>SKU / Produit</Th><Th>Qté</Th><Th>Statut</Th>
                    <Th>Jours</Th><Th>N° réexpédition</Th><Th>Reçu le</Th><Th>Facturé</Th><Th>Photo</Th>
                  </tr>
                </thead>
                <tbody>
                  {claims.map(c => {
                    const open = c.status !== 'recu' && c.status !== 'clos'
                    const days = open ? daysSince(c.claim_sent_at ?? c.reported_at) : null
                    const overdue = days !== null && days > 30
                    return (
                      <tr key={c.id} className={`border-b border-[#f5f5f3] last:border-0 ${overdue ? 'bg-[#fff5f5]' : 'hover:bg-[#fafafa]'}`}>
                        <Td className="whitespace-nowrap text-[#6b6b63]">{fmtDate(c.reported_at)}</Td>
                        <Td>
                          <div className="font-medium text-[#1a1a2e]">{c.sku ?? '—'}</div>
                          {c.product_name && <div className="text-[#9b9b93] truncate max-w-[180px]">{c.product_name}</div>}
                          {billedClaimIds.has(c.id) && (
                            <span className="inline-flex items-center gap-1 mt-0.5 text-[10px] font-semibold text-[#c7293a]">
                              <AlertTriangle size={10} /> facturé
                            </span>
                          )}
                        </Td>
                        <Td className="tabular-nums">{c.quantity}</Td>
                        <Td>
                          <select
                            value={c.status}
                            onChange={e => patchClaim(c.id, { status: e.target.value })}
                            className="rounded-md px-2 py-1 text-xs font-medium border-0 cursor-pointer"
                            style={{ background: STATUS_COLOR[c.status][0], color: STATUS_COLOR[c.status][1] }}
                          >
                            {STATUS_OPTS.map(s => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
                          </select>
                        </Td>
                        <Td>
                          {days !== null ? (
                            <span className={`tabular-nums font-semibold ${overdue ? 'text-[#c7293a]' : 'text-[#6b6b63]'}`}>
                              {days} j
                            </span>
                          ) : <span className="text-[#cfcfc8]">—</span>}
                        </Td>
                        <Td>
                          <input
                            defaultValue={c.reship_tracking_ref ?? ''}
                            placeholder="—"
                            onBlur={e => { if (e.target.value !== (c.reship_tracking_ref ?? '')) patchClaim(c.id, { reship_tracking_ref: e.target.value || null }) }}
                            className="w-28 rounded-md px-2 py-1 bg-[#f8f8f7] focus:bg-white focus:ring-1 focus:ring-[#aeb0c9] outline-none"
                          />
                        </Td>
                        <Td>
                          <input
                            type="date"
                            defaultValue={c.received_at ?? ''}
                            onBlur={e => { if (e.target.value !== (c.received_at ?? '')) patchClaim(c.id, { received_at: e.target.value || null }) }}
                            className="rounded-md px-2 py-1 bg-[#f8f8f7] focus:bg-white focus:ring-1 focus:ring-[#aeb0c9] outline-none"
                          />
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

      {showForm && (
        <NewDefectForm
          brand={BRAND}
          onClose={() => setShowForm(false)}
          onCreated={() => { setShowForm(false); setLoading(true); Promise.all([loadClaims(), loadStats()]).finally(() => setLoading(false)) }}
        />
      )}
    </div>
  )
}

// ─── Sous-composants ────────────────────────────────────────────────────────

function Card({ title, icon, value, sub, danger }: { title: string; icon: React.ReactNode; value: string; sub?: string; danger?: boolean }) {
  return (
    <div className="bg-white rounded-[20px] shadow-[0_2px_16px_rgba(0,0,0,0.06)] p-5">
      <div className="flex items-center gap-1.5 mb-3">
        {icon}
        <p className="text-[10px] font-semibold text-[#6b6b63] uppercase tracking-[0.1em]">{title}</p>
      </div>
      <p className={`text-2xl font-bold tabular-nums ${danger ? 'text-[#c7293a]' : 'text-[#1a1a2e]'}`}>{value}</p>
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

function NewDefectForm({ brand, onClose, onCreated }: { brand: string; onClose: () => void; onCreated: () => void }) {
  const [form, setForm] = useState({
    reported_at: new Date().toISOString().slice(0, 10),
    sku: '', product_name: '', shopify_order_id: '', quantity: '1', defect_description: '',
  })
  const [file, setFile] = useState<File | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const fileRef = useRef<HTMLInputElement>(null)

  function upd(k: string, v: string) { setForm(f => ({ ...f, [k]: v })) }

  async function submit() {
    if (!form.sku.trim() && !form.defect_description.trim()) {
      setError('Renseignez au moins un SKU ou une description.')
      return
    }
    setSaving(true); setError('')
    try {
      const res = await fetch('/api/sav-defects', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...form, brand }),
      })
      const data = await res.json()
      if (!res.ok) { setError(data.error ?? 'Erreur'); setSaving(false); return }
      if (file && data.claim?.id) {
        const fd = new FormData()
        fd.append('photo', file)
        await fetch(`/api/sav-defects/${data.claim.id}/upload`, { method: 'POST', body: fd })
      }
      onCreated()
    } catch (e) {
      setError(String(e)); setSaving(false)
    }
  }

  const input = 'w-full px-3 py-2 rounded-xl bg-[#f8f8f7] border border-[#e8e8e4] text-sm outline-none focus:bg-white focus:ring-1 focus:ring-[#aeb0c9]'

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4" onClick={onClose}>
      <div className="bg-white rounded-[20px] shadow-xl w-full max-w-lg p-6 space-y-4" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <h2 className="text-base font-bold text-[#1a1a2e]">Nouveau défaut</h2>
          <button onClick={onClose} className="text-[#9b9b93] hover:text-[#1a1a2e]"><X size={18} /></button>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <Field label="Date signalement">
            <input type="date" value={form.reported_at} onChange={e => upd('reported_at', e.target.value)} className={input} />
          </Field>
          <Field label="Quantité">
            <input type="number" min={1} value={form.quantity} onChange={e => upd('quantity', e.target.value)} className={input} />
          </Field>
          <Field label="SKU">
            <input value={form.sku} onChange={e => upd('sku', e.target.value)} className={input} placeholder="MOOM-XXX" />
          </Field>
          <Field label="N° commande Shopify">
            <input value={form.shopify_order_id} onChange={e => upd('shopify_order_id', e.target.value)} className={input} placeholder="#1234" />
          </Field>
          <div className="col-span-2">
            <Field label="Produit">
              <input value={form.product_name} onChange={e => upd('product_name', e.target.value)} className={input} />
            </Field>
          </div>
          <div className="col-span-2">
            <Field label="Description du défaut">
              <textarea value={form.defect_description} onChange={e => upd('defect_description', e.target.value)} rows={3} className={input} />
            </Field>
          </div>
          <div className="col-span-2">
            <Field label="Photo">
              <input ref={fileRef} type="file" accept="image/*" onChange={e => setFile(e.target.files?.[0] ?? null)} className="hidden" />
              <button type="button" onClick={() => fileRef.current?.click()} className="flex items-center gap-2 px-3 py-2 rounded-xl border border-[#e8e8e4] text-sm text-[#6b6b63] hover:bg-[#f8f8f7] w-full">
                <ImageIcon size={15} /> {file ? file.name : 'Ajouter une photo'}
              </button>
            </Field>
          </div>
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
