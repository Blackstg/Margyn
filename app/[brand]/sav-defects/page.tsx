'use client'

export const dynamic = 'force-dynamic'

import { useState, useEffect, useCallback, useRef } from 'react'
import { Plus, AlertTriangle, Clock, PackageX, X, Image as ImageIcon, Search, FileText, Truck, RotateCcw, Trash2, Check, Layers, Printer, CheckCircle2, Maximize2 } from 'lucide-react'

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
  product_image_url: string | null
  return_label_url: string | null
  status: string
  milestones: Record<string, string> | null
  production_batch: string | null
  validated_by: string | null
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

// ─── Jalons & types ──────────────────────────────────────────────────────────

// Cumulative milestones (a case can have several). Key → label.
const MILESTONES_BY_TYPE: Record<string, { key: string; label: string }[]> = {
  defaut_fournisseur: [
    { key: 'reclamation_envoyee', label: 'Claim sent' },
    { key: 'repro_confirmee',     label: 'Defect confirmed' },
    { key: 'reexpedie',           label: 'Reshipped' },
    { key: 'recu',                label: 'Received' },
  ],
  erreur_envoi: [
    { key: 'etiquette_envoyee', label: 'Return label' },
    { key: 'retour_recu',       label: 'Return received' },
    { key: 'reexpedie',         label: 'Reshipped' },
    { key: 'recu',              label: 'Received' },
  ],
}
const VALIDATORS = ['Hao', 'Lily', 'Forrest', 'Other'] as const

const ALL_STEP_LABELS: Record<string, string> = {
  reclamation_envoyee: 'Claim sent', repro_confirmee: 'Defect confirmed',
  etiquette_envoyee: 'Return label', retour_recu: 'Return received',
  reexpedie: 'Reshipped', recu: 'Received', clos: 'Closed', litige: 'Dispute',
}

const TYPE_LABEL: Record<string, string> = { defaut_fournisseur: 'Defect', erreur_envoi: 'Shipping error' }
const TYPE_COLOR: Record<string, [string, string]> = {
  defaut_fournisseur: ['#fffbeb', '#92650a'],
  erreur_envoi:       ['#eef6ff', '#1d4ed8'],
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const fmtEur = (n: number) =>
  new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }).format(n)

function fmtDate(s: string | null): string {
  if (!s) return '—'
  return new Date(s + 'T00:00:00').toLocaleDateString('en-GB', { day: '2-digit', month: 'short' })
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
    opts.push({ value: ym, label: d.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' }) })
    d.setMonth(d.getMonth() - 1)
  }
  return opts
}

function variantLabel(v: Variant): string {
  const sku = v.sku_fr ?? v.sku_cn ?? ''
  return `${v.product_title}${v.variant_title ? ' · ' + v.variant_title : ''}${sku ? ` (${sku})` : ''}`
}

function milestonesSummary(m: Record<string, string> | null): string {
  if (!m) return '—'
  const keys = Object.keys(m)
  if (!keys.length) return 'Reported'
  return keys.map(k => `${ALL_STEP_LABELS[k] ?? k} (${fmtDate(m[k])})`).join(', ')
}

const esc = (s: unknown) => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!))

// Builds a printable view (1 row / case) and triggers print → "Save as PDF"
function exportPdf(groups: [string, Claim[]][], monthLabel: string) {
  const rows = groups.map(([batch, list]) => {
    const head = `<tr><td colspan="8" class="lot">Batch: ${esc(batch)} — ${list.length} case(s)</td></tr>`
    const body = list.map(c => `<tr>
      <td>${esc(TYPE_LABEL[c.claim_type] ?? c.claim_type)}</td>
      <td>${esc(c.shopify_order_id ?? '—')}<br><span class="muted">${esc(fmtDate(c.reported_at))}</span></td>
      <td>${c.product_image_url ? `<img src="${esc(c.product_image_url)}">` : ''}</td>
      <td><b>${esc(c.sku ?? '—')}</b> ×${c.quantity}<br>${esc(c.product_name ?? '')}${c.claim_type === 'erreur_envoi' ? `<br><span class="red">received: ${esc(c.received_product_name ?? c.received_sku ?? '—')}</span>` : ''}${c.defect_description ? `<br><span class="muted">${esc(c.defect_description)}</span>` : ''}</td>
      <td>${esc(milestonesSummary(c.milestones))}${c.validated_by ? `<br><span class="muted">validated: ${esc(c.validated_by)}</span>` : ''}</td>
      <td>${esc(c.reship_tracking_ref ?? '—')}${c.return_tracking_ref ? `<br>return ${esc(c.return_tracking_ref)}` : ''}</td>
      <td>${c.charged_amount > 0 ? esc(fmtEur(c.charged_amount)) : '—'}</td>
      <td>${c.photo_url ? `<img src="${esc(c.photo_url)}">` : ''}</td>
    </tr>`).join('')
    return head + body
  }).join('')

  const html = `<!doctype html><html><head><meta charset="utf-8"><title>After-sales Mōom — ${esc(monthLabel)}</title>
  <style>
    *{font-family:-apple-system,Segoe UI,Roboto,sans-serif;box-sizing:border-box}
    body{margin:24px;color:#1a1a18}
    h1{font-size:18px;margin:0 0 2px} .sub{color:#6b6b63;font-size:12px;margin:0 0 16px}
    table{width:100%;border-collapse:collapse;font-size:11px}
    th{text-align:left;background:#f5f5f3;padding:6px 8px;font-size:9px;text-transform:uppercase;letter-spacing:.05em;color:#6b6b63}
    td{padding:6px 8px;border-bottom:1px solid #eee;vertical-align:top}
    td.lot{background:#eef2ff;font-weight:700;color:#1a1a2e;font-size:11px}
    img{width:38px;height:38px;object-fit:cover;border-radius:6px;border:1px solid #e8e8e4}
    .muted{color:#9b9b93} .red{color:#c7293a} .muted,.red{font-size:10px}
    @media print{body{margin:12mm}}
  </style></head><body>
  <h1>After-sales / Defects &amp; shipping errors — Mōom</h1>
  <p class="sub">Exported on ${esc(fmtDate(new Date().toISOString().slice(0, 10)))} · period ${esc(monthLabel)}</p>
  <table><thead><tr>
    <th>Type</th><th>Order</th><th>Img</th><th>Item</th><th>Milestones</th><th>Tracking</th><th>Billed</th><th>Photo</th>
  </tr></thead><tbody>${rows}</tbody></table>
  <script>window.onload=function(){setTimeout(function(){window.print()},300)}</script>
  </body></html>`

  const win = window.open('', '_blank')
  if (!win) { alert('Please allow pop-ups to export the PDF.'); return }
  win.document.write(html)
  win.document.close()
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
  const [lightbox, setLightbox] = useState<string | null>(null)

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

  function setMilestone(c: Claim, key: string, date: string | null) {
    const m = { ...(c.milestones ?? {}) }
    if (date) m[key] = date
    else delete m[key]
    patchClaim(c.id, { milestones: m })
  }

  async function deleteClaim(c: Claim) {
    const label = c.product_name || c.sku || c.shopify_order_id || 'this case'
    if (!confirm(`Permanently delete ${label}?`)) return
    setClaims(cs => cs.filter(x => x.id !== c.id))
    await fetch(`/api/sav-defects?id=${c.id}`, { method: 'DELETE' })
    loadStats()
  }

  async function closeBatch(batch: string, n: number) {
    if (!confirm(`Close batch "${batch}"? The ${n} case(s) will be marked Closed.`)) return
    await fetch('/api/sav-defects/close-batch', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ brand: BRAND, batch }),
    })
    reload()
  }

  const billedClaimIds = new Set(stats?.wronglyBilled.lines.map(l => l.claim_id) ?? [])
  const visible = claims.filter(c => typeFilter === 'all' || c.claim_type === typeFilter)

  // Regroupe par lot de production ; "Sans lot" en dernier
  const groups: [string, Claim[]][] = (() => {
    const map = new Map<string, Claim[]>()
    for (const c of visible) {
      const k = c.production_batch?.trim() || '—'
      if (!map.has(k)) map.set(k, [])
      map.get(k)!.push(c)
    }
    return [...map.entries()].sort((a, b) => {
      if (a[0] === '—') return 1
      if (b[0] === '—') return -1
      return b[0].localeCompare(a[0])
    })
  })()

  return (
    <div className="min-h-screen bg-[#f8f7f5] pl-[72px]">
      <div className="max-w-6xl mx-auto px-6 py-8 space-y-6">

        {/* Header */}
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-[0.1em] text-[#aeb0c9] mb-1">Mōom</p>
            <h1 className="text-xl font-bold text-[#1a1a2e]">After-sales / Defects &amp; shipping errors</h1>
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
              onClick={() => exportPdf(groups, monthOptions().find(o => o.value === month)?.label ?? month)}
              disabled={visible.length === 0}
              className="flex items-center gap-2 px-3 py-2 rounded-xl bg-white border border-[#e8e8e4] text-[#1a1a2e] text-xs font-semibold hover:bg-[#f8f8f7] disabled:opacity-40 transition-colors"
            >
              <Printer size={14} /> Export PDF
            </button>
            <button
              onClick={() => setShowForm(true)}
              className="flex items-center gap-2 px-4 py-2 rounded-xl bg-[#1a1a2e] text-white text-xs font-semibold hover:bg-[#2a2a3e] transition-colors"
            >
              <Plus size={14} /> New case
            </button>
          </div>
        </div>

        {/* 3 cartes */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <Card title="Awaiting receipt" icon={<Clock size={14} className="text-[#aeb0c9]" />}
            value={stats ? String(stats.awaiting.count) : '—'}
            sub={stats && stats.awaiting.count > 0 ? `oldest: ${stats.awaiting.oldest_days} d` : 'no open case'} />
          <Card title="After-sales shipments wrongly billed" icon={<AlertTriangle size={14} className="text-[#c7293a]" />}
            value={stats ? fmtEur(stats.wronglyBilled.total_amount) : '—'}
            sub={stats ? `${stats.wronglyBilled.lines.length} line(s) to dispute` : ''}
            danger={!!stats && stats.wronglyBilled.total_amount > 0} />
          <div className="bg-white rounded-[20px] shadow-[0_2px_16px_rgba(0,0,0,0.06)] p-5">
            <div className="flex items-center gap-1.5 mb-3">
              <PackageX size={14} className="text-[#aeb0c9]" />
              <p className="text-[10px] font-semibold text-[#6b6b63] uppercase tracking-[0.1em]">Defect rate by SKU</p>
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
            ) : <p className="text-xs text-[#9b9b93]">No defects this month.</p>}
          </div>
        </div>

        {/* Table */}
        <div className="bg-white rounded-[20px] shadow-[0_2px_16px_rgba(0,0,0,0.06)] overflow-hidden">
          <div className="flex items-center justify-between px-6 py-4 border-b border-[#f0f0ee]">
            <p className="text-[10px] font-semibold text-[#6b6b63] uppercase tracking-[0.1em]">Cases ({visible.length})</p>
            <div className="inline-flex items-center bg-[#F8F8F7] rounded-lg p-0.5 gap-0.5">
              {([['all', 'All'], ['defaut_fournisseur', 'Defects'], ['erreur_envoi', 'Shipping errors']] as const).map(([k, lbl]) => (
                <button key={k} onClick={() => setTypeFilter(k)}
                  className={`px-3 py-1.5 rounded-md text-xs font-medium transition-all ${typeFilter === k ? 'bg-white text-[#1a1a18] shadow-sm' : 'text-[#6b6b63] hover:text-[#1a1a18]'}`}>
                  {lbl}
                </button>
              ))}
            </div>
          </div>
          {loading ? (
            <div className="p-10 text-center text-sm text-[#9b9b93]">Loading…</div>
          ) : visible.length === 0 ? (
            <div className="p-10 text-center text-sm text-[#9b9b93]">No cases. Click "New case".</div>
          ) : (
            <div>
              {groups.map(([batch, list]) => {
                const hasBatch = batch !== '—'
                const openCount = list.filter(x => { const mm = x.milestones ?? {}; return !mm.recu && !mm.clos }).length
                return (
                  <div key={batch}>
                    {/* En-tête de lot */}
                    <div className="flex items-center gap-2 px-6 py-2.5 bg-[#fafafa] border-b border-[#f0f0ee]">
                      <Layers size={13} className="text-[#aeb0c9]" />
                      <span className="text-xs font-semibold text-[#1a1a2e]">{hasBatch ? `Batch ${batch}` : 'No batch'}</span>
                      <span className="text-[10px] text-[#9b9b93]">· {list.length} case(s){openCount > 0 ? ` · ${openCount} pending` : ' · all handled ✓'}</span>
                      {hasBatch && openCount > 0 && (
                        <button onClick={() => closeBatch(batch, openCount)}
                          className="ml-auto inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-[11px] font-semibold text-[#1a7f4b] hover:bg-[#1a7f4b]/10 transition-colors">
                          <CheckCircle2 size={12} /> Close batch
                        </button>
                      )}
                    </div>

                    <div className="divide-y divide-[#f0f0ee]">
                      {list.map(c => {
                        const m = c.milestones ?? {}
                        const open = !m.recu && !m.clos
                        const days = open ? daysSince(c.claim_sent_at ?? c.reported_at) : null
                        const overdue = days !== null && days > 30
                        const isErr = c.claim_type === 'erreur_envoi'
                        const today = new Date().toISOString().slice(0, 10)
                        const steps = MILESTONES_BY_TYPE[c.claim_type] ?? MILESTONES_BY_TYPE.defaut_fournisseur
                        const done = steps.filter(s => m[s.key]).length
                        return (
                          <div key={c.id} className={`px-5 py-3 grid grid-cols-[auto_minmax(0,1fr)] gap-3 ${overdue ? 'bg-[#fff5f5]' : 'hover:bg-[#fafafa]'} ${m.clos ? 'opacity-60' : ''} transition-colors`}>

                            {/* Col 1 : visuels (produit + photo défaut) */}
                            <div className="flex gap-1.5">
                              {c.product_image_url ? (
                                <img src={c.product_image_url} alt="" className="w-12 h-12 rounded-lg object-cover border border-[#e8e8e4]" />
                              ) : <div className="w-12 h-12 rounded-lg bg-[#f5f5f3]" />}
                              {c.photo_url && (
                                <button onClick={() => setLightbox(c.photo_url)} title="Defect photo — click to enlarge"
                                  className="relative group w-12 h-12 rounded-lg overflow-hidden border-2 border-[#c7293a]/30">
                                  <img src={c.photo_url} alt="defect" className="w-full h-full object-cover" />
                                  <span className="absolute inset-0 bg-black/0 group-hover:bg-black/30 flex items-center justify-center transition-colors">
                                    <Maximize2 size={13} className="text-white opacity-0 group-hover:opacity-100" />
                                  </span>
                                </button>
                              )}
                            </div>

                            {/* Col 2 : contenu */}
                            <div className="min-w-0">

                              {/* Header */}
                              <div className="flex items-center gap-2 flex-wrap">
                                <span className="inline-flex items-center px-2 py-0.5 rounded-md text-[10px] font-semibold"
                                  style={{ background: TYPE_COLOR[c.claim_type]?.[0] ?? '#F8F8F7', color: TYPE_COLOR[c.claim_type]?.[1] ?? '#6b6b63' }}>
                                  {TYPE_LABEL[c.claim_type] ?? c.claim_type}
                                </span>
                                {c.shopify_order_id && <span className="text-xs font-semibold text-[#1a1a18]">{c.shopify_order_id}</span>}
                                <span className="text-xs text-[#9b9b93]">{fmtDate(c.reported_at)}</span>
                                {days !== null && (
                                  <span className={`text-xs tabular-nums font-semibold ${overdue ? 'text-[#c7293a]' : 'text-[#9b9b93]'}`}>· ouvert {days} j</span>
                                )}
                                <div className="ml-auto flex items-center gap-1.5">
                                  {c.charged_amount > 0 && <span className="text-xs tabular-nums text-[#6b6b63]">{fmtEur(c.charged_amount)}</span>}
                                  {billedClaimIds.has(c.id) && (
                                    <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-[#c7293a]"><AlertTriangle size={10} /> billed</span>
                                  )}
                                  <div className={`inline-flex items-center gap-1 rounded-md pl-1.5 pr-0.5 py-0.5 ${c.validated_by ? 'bg-[#f0faf5]' : 'bg-[#f5f5f3]'}`}>
                                    {c.validated_by && <CheckCircle2 size={12} className="text-[#1a7f4b]" />}
                                    <select value={c.validated_by ?? ''} onChange={e => patchClaim(c.id, { validated_by: e.target.value || null })}
                                      title="Validated by (reproduction + reshipment)"
                                      className={`bg-transparent text-[11px] font-medium border-0 outline-none cursor-pointer ${c.validated_by ? 'text-[#1a7f4b]' : 'text-[#9b9b93]'}`}>
                                      <option value="">Validated by…</option>
                                      {VALIDATORS.map(n => <option key={n} value={n}>{n}</option>)}
                                    </select>
                                  </div>
                                  <button onClick={() => deleteClaim(c)} title="Delete case"
                                    className="text-[#cfcfc8] hover:text-[#c7293a] transition-colors"><Trash2 size={14} /></button>
                                </div>
                              </div>

                              {/* Article */}
                              <div className="text-sm mt-1 leading-snug">
                                <span className="font-semibold text-[#1a1a18]">{c.sku ?? '—'}</span>
                                <span className="text-[#9b9b93]"> ·×{c.quantity}</span>
                                {c.product_name && <span className="text-[#6b6b63]"> — {c.product_name}</span>}
                                {isErr && <span className="text-[#c7293a]"> · wrongly received: {c.received_product_name ?? c.received_sku ?? '—'}</span>}
                              </div>
                              {(c.defect_description || c.supplier_claim_ref) && (
                                <div className="text-[11px] text-[#9b9b93] mt-0.5 truncate">
                                  {c.defect_description && <span className="italic">“{c.defect_description}”</span>}
                                  {c.defect_description && c.supplier_claim_ref && <span> · </span>}
                                  {c.supplier_claim_ref && <span>Claim ref. {c.supplier_claim_ref}</span>}
                                </div>
                              )}

                              {/* Bande : progression + jalons · | · suivi + lot */}
                              <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1.5 mt-2">
                                <div className="flex items-center gap-1.5">
                                  <div className="w-12 h-1 rounded-full bg-[#f0f0ee] overflow-hidden">
                                    <div className="h-full bg-[#1a7f4b] transition-all" style={{ width: `${(done / steps.length) * 100}%` }} />
                                  </div>
                                  <span className="text-[10px] font-semibold text-[#9b9b93] tabular-nums">{done}/{steps.length}</span>
                                </div>
                                {steps.map(step => {
                                  const date = m[step.key]
                                  return date ? (
                                    <span key={step.key} className="inline-flex items-center gap-1 pl-2 pr-1 py-0.5 rounded-md text-[11px] font-medium bg-[#f0faf5] text-[#1a7f4b]">
                                      <Check size={11} /> {step.label}
                                      <input type="date" value={date} onChange={e => setMilestone(c, step.key, e.target.value || today)}
                                        className="bg-transparent text-[10px] w-[78px] outline-none cursor-pointer text-[#1a7f4b]" />
                                      <button onClick={() => setMilestone(c, step.key, null)} className="hover:text-[#c7293a]" title="Remove milestone"><X size={11} /></button>
                                    </span>
                                  ) : (
                                    <button key={step.key} onClick={() => setMilestone(c, step.key, today)}
                                      className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-medium border border-dashed border-[#d8d8d2] text-[#9b9b93] hover:border-[#aeb0c9] hover:text-[#6b6b63] transition-colors">
                                      <Plus size={10} /> {step.label}
                                    </button>
                                  )
                                })}

                                <span className="w-px h-4 bg-[#e8e8e4]" />

                                <InlineField icon={<Truck size={12} className="text-[#aeb0c9]" />} label="Tracking" compact
                                  value={c.reship_tracking_ref} onSave={v => patchClaim(c.id, { reship_tracking_ref: v })} />
                                <InlineField icon={<RotateCcw size={12} className="text-[#aeb0c9]" />} label="Return" compact
                                  value={c.return_tracking_ref} onSave={v => patchClaim(c.id, { return_tracking_ref: v })} />
                                {c.return_label_url && (
                                  <a href={c.return_label_url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-[11px] text-[#4f46e5] hover:underline">
                                    <FileText size={11} /> label
                                  </a>
                                )}
                                <InlineField icon={<Layers size={12} className="text-[#aeb0c9]" />} label="Batch" compact
                                  value={c.production_batch} onSave={v => patchClaim(c.id, { production_batch: v })} />
                              </div>
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </div>

      {showForm && <NewClaimForm brand={BRAND} onClose={() => setShowForm(false)} onCreated={() => { setShowForm(false); reload() }} />}

      {lightbox && (
        <div className="fixed inset-0 z-[60] bg-black/80 flex items-center justify-center p-6" onClick={() => setLightbox(null)}>
          <img src={lightbox} alt="defect" className="max-w-full max-h-full rounded-lg shadow-2xl" />
          <button className="absolute top-4 right-4 text-white/70 hover:text-white"><X size={28} /></button>
        </div>
      )}
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

function InlineField({ icon, label, value, onSave, compact }: { icon: React.ReactNode; label: string; value: string | null; onSave: (v: string | null) => void; compact?: boolean }) {
  return (
    <label className="inline-flex items-center gap-1 text-xs">
      {icon}
      <span className="text-[10px] uppercase tracking-wide text-[#9b9b93]">{label}</span>
      <input defaultValue={value ?? ''} placeholder="—"
        onBlur={e => { if (e.target.value !== (value ?? '')) onSave(e.target.value || null) }}
        className={`${compact ? 'w-20' : 'w-28'} rounded-md px-2 py-0.5 bg-[#f8f8f7] focus:bg-white focus:ring-1 focus:ring-[#aeb0c9] outline-none`} />
    </label>
  )
}

function NewClaimForm({ brand, onClose, onCreated }: { brand: string; onClose: () => void; onCreated: () => void }) {
  const [type, setType] = useState<'defaut_fournisseur' | 'erreur_envoi'>('defaut_fournisseur')
  const [form, setForm] = useState({
    reported_at: new Date().toISOString().slice(0, 10),
    quantity: '1', defect_description: '',
    sku: '', product_name: '', shopify_order_id: '', shopify_variant_id: '',
    received_sku: '', received_product_name: '', reship_tracking_ref: '', return_tracking_ref: '',
    production_batch: '',
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
      setError('Please fill in the order and the wrongly received item.'); return
    }
    if (type === 'defaut_fournisseur' && !form.sku.trim() && !form.defect_description.trim()) {
      setError('Please provide at least a SKU or a description.'); return
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
          <h2 className="text-base font-bold text-[#1a1a18]">New case</h2>
          <button onClick={onClose} className="text-[#9b9b93] hover:text-[#1a1a18]"><X size={18} /></button>
        </div>

        {/* Type toggle */}
        <div className="inline-flex w-full bg-[#F8F8F7] rounded-xl p-0.5 gap-0.5">
          {([['defaut_fournisseur', 'Supplier defect'], ['erreur_envoi', 'Shipping error']] as const).map(([k, lbl]) => (
            <button key={k} onClick={() => setType(k)}
              className={`flex-1 px-3 py-2 rounded-lg text-xs font-semibold transition-all ${type === k ? 'bg-white text-[#1a1a18] shadow-sm' : 'text-[#6b6b63]'}`}>
              {lbl}
            </button>
          ))}
        </div>

        {/* Lookup commande */}
        <Field label={type === 'erreur_envoi' ? 'Order no. (required)' : 'Order no. (optional)'}>
          <div className="flex gap-2">
            <input value={orderInput} onChange={e => setOrderInput(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); lookupOrder() } }}
              className={input} placeholder="#1234" />
            <button type="button" onClick={lookupOrder} disabled={lookingUp}
              className="flex items-center gap-1.5 px-3 rounded-xl bg-[#1a1a2e] text-white text-xs font-semibold hover:bg-[#2a2a3e] disabled:opacity-50 shrink-0">
              <Search size={13} /> {lookingUp ? '…' : 'Search'}
            </button>
          </div>
        </Field>

        {lookupErr && <p className="text-xs text-[#c7293a]">{lookupErr}</p>}

        {/* Articles de la commande */}
        {lineItems && lineItems.length > 0 && (
          <div className="space-y-1.5">
            <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-[#9b9b93]">
              {type === 'erreur_envoi' ? 'Ordered item (correct, to reship)' : 'Select the affected item'}
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
          <p className="text-xs text-[#9b9b93]">No item found for this order.</p>
        )}

        {/* Article reçu à tort (erreur d'envoi) */}
        {type === 'erreur_envoi' && (
          <Field label="Wrongly received item (catalogue)">
            <select value={variants.find(v => (v.sku_fr ?? v.sku_cn) === form.received_sku)?.shopify_variant_id ?? ''}
              onChange={e => selectReceived(e.target.value)} className={input}>
              <option value="">— Select —</option>
              {variants.map(v => <option key={v.shopify_variant_id} value={v.shopify_variant_id}>{variantLabel(v)}</option>)}
            </select>
          </Field>
        )}

        <div className="grid grid-cols-2 gap-3">
          <Field label="Report date">
            <input type="date" value={form.reported_at} onChange={e => upd('reported_at', e.target.value)} className={input} />
          </Field>
          <Field label="Quantity">
            <input type="number" min={1} value={form.quantity} onChange={e => upd('quantity', e.target.value)} className={input} />
          </Field>

          <div className="col-span-2">
            <Field label="Production batch (supplier PO ref.)">
              <input value={form.production_batch} onChange={e => upd('production_batch', e.target.value)} className={input} placeholder="e.g. PO-2026-07" />
            </Field>
          </div>

          {type === 'defaut_fournisseur' && (
            <div className="col-span-2">
              <Field label="SKU (if no order)">
                <input value={form.sku} onChange={e => upd('sku', e.target.value)} className={input} placeholder="MOOM-XXX" />
              </Field>
            </div>
          )}

          {type === 'defaut_fournisseur' && (
            <div className="col-span-2">
              <Field label="Defect description">
                <textarea value={form.defect_description} onChange={e => upd('defect_description', e.target.value)} rows={3} className={input} />
              </Field>
            </div>
          )}

          <Field label="Return tracking no.">
            <input value={form.return_tracking_ref} onChange={e => upd('return_tracking_ref', e.target.value)} className={input} />
          </Field>
          <Field label="Tracking (new shipment)">
            <input value={form.reship_tracking_ref} onChange={e => upd('reship_tracking_ref', e.target.value)} className={input} />
          </Field>
        </div>

        {/* Uploads */}
        <div className="grid grid-cols-2 gap-3">
          <Field label="Photo">
            <input ref={photoRef} type="file" accept="image/*" onChange={e => setPhoto(e.target.files?.[0] ?? null)} className="hidden" />
            <button type="button" onClick={() => photoRef.current?.click()} className="flex items-center gap-2 px-3 py-2 rounded-xl border border-[#e8e8e4] text-sm text-[#6b6b63] hover:bg-[#f8f8f7] w-full">
              <ImageIcon size={15} /> <span className="truncate">{photo ? photo.name : 'Photo'}</span>
            </button>
          </Field>
          <Field label="Return label">
            <input ref={labelRef} type="file" accept="image/*,application/pdf" onChange={e => setLabel(e.target.files?.[0] ?? null)} className="hidden" />
            <button type="button" onClick={() => labelRef.current?.click()} className="flex items-center gap-2 px-3 py-2 rounded-xl border border-[#e8e8e4] text-sm text-[#6b6b63] hover:bg-[#f8f8f7] w-full">
              <FileText size={15} /> <span className="truncate">{label ? label.name : 'Label'}</span>
            </button>
          </Field>
        </div>

        {error && <p className="text-xs text-[#c7293a]">{error}</p>}

        <div className="flex justify-end gap-2 pt-1">
          <button onClick={onClose} className="px-4 py-2 rounded-xl text-sm text-[#6b6b63] hover:bg-[#f8f8f7]">Cancel</button>
          <button onClick={submit} disabled={saving} className="px-4 py-2 rounded-xl bg-[#1a1a2e] text-white text-sm font-semibold hover:bg-[#2a2a3e] disabled:opacity-50">
            {saving ? 'Saving…' : 'Create case'}
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
