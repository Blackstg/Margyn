'use client'

// Réappro : calcul glissant par variante (lib/reorder), bon de commande qui
// enregistre la commande, suivi des commandes en cours et réceptions détectées.
import { useState, useEffect, useMemo, useRef, useCallback } from 'react'
import { Download, Search, Package, ChevronDown, ClipboardList, X, GripVertical, Plus, Check, Settings2, AlertTriangle, ListPlus, Copy, Clock, PencilLine } from 'lucide-react'
import AiInsights from '@/components/dashboard/AiInsights'
import { useBrand } from '@/context/BrandContext'
import { computeReorder, type ReorderInputs, type ReorderRow } from '@/lib/reorder/compute'
import { addDays, daysBetween, leadDays, targetDays, triggerDays, type ReorderSettings, type VariantStatus } from '@/lib/reorder/plan'
import ReorderKpis from '@/components/reorder/ReorderKpis'
import ReceiptPrompts from '@/components/reorder/ReceiptPrompts'
import OrdersInProgress from '@/components/reorder/OrdersInProgress'
import ReorderSettingsPanel from '@/components/reorder/ReorderSettingsPanel'
import StockGauge from '@/components/reorder/StockGauge'
import { CARD, RED, ORANGE, dec, fmtDay, int, plural } from '@/components/reorder/format'
import { downloadCSV, poCSV, printPO, supplierMessage, type PoLine } from '@/components/reorder/po'

const BRAND_LABELS: Record<string, string> = { bowa: 'Bowa', moom: 'Mōom Paris', krom: 'Krom', yone: 'Yone' }

// Réglages modifiables depuis la page (les autres restent ceux du serveur).
const EDITABLE: (keyof ReorderSettings)[] = ['fabDays', 'transitDays', 'safetyDays', 'orderCoverDays', 'refPeriod', 'promos', 'products', 'recipients']
const pick = (s: ReorderSettings) => JSON.stringify(EDITABLE.map((k) => s[k]))

const GROUPS: { key: string; title: string; statuses: VariantStatus[]; hint?: string }[] = [
  { key: 'order',   title: 'À commander',              statuses: ['order'] },
  { key: 'soon',    title: 'Bientôt',                  statuses: ['soon'],    hint: 'date limite dans moins de 3 semaines' },
  { key: 'ordered', title: 'En commande',              statuses: ['ordered'], hint: 'couvertes par une commande en cours' },
  { key: 'snoozed', title: 'Pas maintenant',           statuses: ['snoozed'], hint: 'plus de relance pendant 14 jours' },
  { key: 'ok',      title: 'Ça va',                    statuses: ['ok', 'idle'] },
]

interface CartItem { id: string; qty: number }

function Thumb({ src, alt }: { src: string | null; alt: string }) {
  return src
    // eslint-disable-next-line @next/next/no-img-element
    ? <img src={src} alt={alt} className="w-10 h-10 rounded-lg object-cover bg-[#f5f0f2] shrink-0" />
    : <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-[#e5c8d2] to-[#c4b4d4] flex items-center justify-center shrink-0"><Package size={13} className="text-white/70" /></div>
}

export default function ReapproPage() {
  const brand = useBrand()
  const brandLabel = BRAND_LABELS[brand] ?? brand

  // ── Données ───────────────────────────────────────────────────────────────
  const [inputs, setInputs] = useState<ReorderInputs | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [draft, setDraft] = useState<ReorderSettings | null>(null)
  const [saving, setSaving] = useState(false)
  const [toast, setToast] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      const r = await fetch(`/api/reorder?brand=${brand}`, { cache: 'no-store' })
      const j = await r.json()
      if (!r.ok) { setError(j.error ?? 'Chargement impossible'); return }
      setError(null)
      setInputs(j as ReorderInputs)
      setDraft((d) => d ?? (j as ReorderInputs).settings)
    } catch { setError('Chargement impossible') }
  }, [brand])

  useEffect(() => { setInputs(null); setDraft(null); load() }, [load])
  useEffect(() => { if (!toast) return; const t = setTimeout(() => setToast(null), 3500); return () => clearTimeout(t) }, [toast])

  const act = useCallback(async (body: Record<string, unknown>): Promise<boolean> => {
    const r = await fetch(`/api/reorder?brand=${brand}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
    const j = await r.json().catch(() => ({}))
    if (!r.ok) { setToast(j.error ?? 'Action impossible'); return false }
    await load()
    return true
  }, [brand, load])

  async function saveSettings() {
    if (!draft) return
    setSaving(true)
    const patch = Object.fromEntries(EDITABLE.map((k) => [k, draft[k]]))
    const ok = await act({ action: 'settings', patch })
    setSaving(false)
    if (ok) setToast('Réglages enregistrés')
  }

  // ── Calcul ────────────────────────────────────────────────────────────────
  const computed = useMemo(() => (inputs && draft
    ? computeReorder(inputs, { ...draft, dismissedJumps: inputs.settings.dismissedJumps })
    : null), [inputs, draft])
  const rows = useMemo(() => computed?.rows ?? [], [computed])
  const rowMap = useMemo(() => new Map(rows.map((r) => [r.id, r])), [rows])
  const today = inputs?.today ?? ''
  const s = draft
  const dirty = !!(inputs && draft && pick(inputs.settings) !== pick(draft))

  const [search, setSearch] = useState('')
  const [showSettings, setShowSettings] = useState(false)
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>({ order: true, soon: true, ordered: true, snoozed: false, ok: false })
  const [expanded, setExpanded] = useState<string | null>(null)

  const sorted = useMemo(() => {
    const q = search.trim().toLowerCase()
    return rows
      .filter((r) => !q || r.title.toLowerCase().includes(q) || (r.variantTitle ?? '').toLowerCase().includes(q) || (r.sku ?? '').toLowerCase().includes(q))
      .sort((a, b) => (b.plan.lateBy - a.plan.lateBy)
        || (a.plan.positionDays ?? 1e9) - (b.plan.positionDays ?? 1e9)
        || a.title.localeCompare(b.title) || (a.variantTitle ?? '').localeCompare(b.variantTitle ?? ''))
  }, [rows, search])

  const urgent = rows.filter((r) => r.plan.status === 'order' && r.plan.lateBy > 0)
  const toOrder = rows.filter((r) => r.plan.status === 'order')
  const products = useMemo(() => {
    const m = new Map<string, string>()
    for (const r of rows) m.set(r.productId, r.title)
    return Array.from(m, ([id, title]) => ({ id, title })).sort((a, b) => a.title.localeCompare(b.title))
  }, [rows])

  // ── Bon de commande ──────────────────────────────────────────────────────
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [cartItems, setCartItems] = useState<CartItem[]>([])
  const [message, setMessage] = useState<string | null>(null)
  const [validating, setValidating] = useState(false)
  const cartSet = useMemo(() => new Set(cartItems.map((c) => c.id)), [cartItems])

  function addToCart(r: ReorderRow) {
    if (cartSet.has(r.id)) return
    setCartItems((prev) => [...prev, { id: r.id, qty: r.plan.suggested > 0 ? r.plan.suggested : 1 }])
    setSidebarOpen(true)
  }
  function addAll() {
    setCartItems((prev) => {
      const have = new Set(prev.map((c) => c.id))
      return [...prev, ...toOrder.filter((r) => !have.has(r.id)).map((r) => ({ id: r.id, qty: r.plan.suggested }))]
    })
    setSidebarOpen(true)
  }
  const removeFromCart = (id: string) => setCartItems((prev) => prev.filter((c) => c.id !== id))
  const setCartQty = (id: string, qty: number) => setCartItems((prev) => prev.map((c) => (c.id === id ? { ...c, qty: Math.max(0, qty) } : c)))

  const dragIndex = useRef<number | null>(null)
  const [dragOver, setDragOver] = useState<number | null>(null)
  function handleDrop(i: number) {
    const from = dragIndex.current
    if (from !== null && from !== i) setCartItems((prev) => { const next = [...prev]; const [it] = next.splice(from, 1); next.splice(i, 0, it); return next })
    dragIndex.current = null
    setDragOver(null)
  }

  const poLines: (PoLine & { id: string; cost: number })[] = cartItems.filter((c) => c.qty > 0).flatMap((c) => {
    const r = rowMap.get(c.id)
    return r ? [{ id: c.id, title: r.title, variantTitle: r.variantTitle, sku: r.sku, image: r.image, qty: c.qty, cost: r.cost }] : []
  })
  const cartUnits = poLines.reduce((a, l) => a + l.qty, 0)
  const cartCost = poLines.reduce((a, l) => a + l.qty * l.cost, 0)
  const cartByProduct = useMemo(() => {
    const qty = new Map<string, number>(), n = new Map<string, number>()
    for (const c of cartItems) {
      const r = rowMap.get(c.id)
      if (!r) continue
      qty.set(r.title, (qty.get(r.title) ?? 0) + c.qty)
      n.set(r.title, (n.get(r.title) ?? 0) + 1)
    }
    return Array.from(qty).filter(([t]) => (n.get(t) ?? 0) > 1).sort((a, b) => b[1] - a[1])
  }, [cartItems, rowMap])

  async function validate() {
    if (!s || !poLines.length) return
    setValidating(true)
    const win = window.open('', '_blank', 'width=900,height=700')   // ouverte au clic, sinon bloquée
    const ok = await act({ action: 'create_order', source: 'validated', orderedOn: today, lines: poLines.map((l) => ({ variantId: l.id, qty: l.qty })) })
    setValidating(false)
    if (!ok) { win?.close(); return }
    printPO(poLines, brandLabel, today, addDays(today, leadDays(s)), win)
    poCSV(poLines, brand, today)
    setMessage(supplierMessage(poLines, brandLabel, today, addDays(today, s.fabDays)))
    setCartItems([])
    setSidebarOpen(false)
  }

  // ── Actions par ligne ─────────────────────────────────────────────────────
  const [declare, setDeclare] = useState<{ on: string; qty: number }>({ on: '', qty: 0 })
  const [manualEdit, setManualEdit] = useState<number>(0)
  function toggleRow(r: ReorderRow) {
    if (expanded === r.id) { setExpanded(null); return }
    setExpanded(r.id)
    setDeclare({ on: today, qty: r.plan.suggested || 1 })
    setManualEdit(r.plan.manual)
  }
  async function saveManual(id: string, qty: number) {
    const res = await fetch('/api/reorder/production', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ brand, shopify_variant_id: id, qty }) })
    if (!res.ok) { setToast('Enregistrement impossible'); return }
    await load()
    setToast('Saisie manuelle enregistrée')
  }

  function exportTable() {
    downloadCSV(`reappro-${brand}-${today}.csv`,
      ['Produit', 'Variant', 'SKU', 'Stock', 'En prod.', 'En transport', 'Ventes/jour', 'Jours de stock', 'Rupture le', 'Commander avant', 'Qté conseillée', 'Statut'],
      sorted.map((r) => [r.title, r.variantTitle ?? '', r.sku ?? '', r.stock, r.plan.inProduction + r.plan.manual, r.plan.inTransit,
        dec(r.velocity.daily, 2), r.plan.stockDays == null ? '' : Math.round(r.plan.stockDays), fmtDay(r.plan.ruptureOn, true), fmtDay(r.plan.orderBy, true),
        r.plan.suggested || '', GROUPS.find((g) => g.statuses.includes(r.plan.status))?.title ?? '']))
  }

  const aiContext = useMemo(() => {
    if (!rows.length) return null
    const lines = toOrder.slice(0, 10).map((r) => `${r.title}${r.variantTitle ? ` — ${r.variantTitle}` : ''}: stock ${r.stock}, ${dec(r.velocity.daily, 2)}/j, rupture ${fmtDay(r.plan.ruptureOn, true)}, commander ${r.plan.suggested}`)
    return `Marque: ${brandLabel} | Réapprovisionnement\n${toOrder.length} variantes à commander, ${urgent.length} en retard sur la date limite\n\n${lines.join('\n') || 'Aucune'}`
  }, [rows.length, toOrder, urgent.length, brandLabel])

  // ── Rendu ─────────────────────────────────────────────────────────────────
  if (error) return <div className="max-w-7xl mx-auto px-4 sm:px-6 py-8"><p className={`${CARD} p-4 text-sm text-[#c7293a]`}>{error}</p></div>
  if (!inputs || !s || !computed) {
    return (
      <div className="max-w-7xl mx-auto px-4 sm:px-6 py-8 space-y-4">
        <div className="grid gap-3 grid-cols-1 sm:grid-cols-3">{[0, 1, 2].map((i) => <div key={i} className={`${CARD} h-28 animate-pulse`} />)}</div>
        <div className={`${CARD} h-96 animate-pulse`} />
      </div>
    )
  }

  const lead = leadDays(s), trigger = triggerDays(s), target = targetDays(s)
  const openOrders = inputs.orders.filter((o) => o.status === 'open').length

  return (
    <div className="min-h-screen bg-[#faf9f8]">
      <main className="max-w-7xl mx-auto px-4 sm:px-6 py-5 sm:py-8 space-y-5">

        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <h1 className="text-xl font-bold text-[#1a1a2e]">Commandes</h1>
            <p className="text-sm text-[#6b6b63] mt-0.5">
              {brandLabel} : {s.refPeriod ? `ventes du ${fmtDay(s.refPeriod.from, true)} au ${fmtDay(s.refPeriod.to, true)}` : `ventes des ${s.windowDays} derniers jours, hors ruptures et promos`}.
              On commande sous {trigger} jours de stock, pour remonter à {target} jours.
            </p>
          </div>
          <div className="flex items-center gap-2 shrink-0 flex-wrap">
            <button onClick={() => setShowSettings((v) => !v)} className={`flex items-center gap-1.5 px-3 py-2 border rounded-xl text-sm transition-colors ${showSettings ? 'border-[#aeb0c9] text-[#1a1a2e] bg-white' : 'border-[#e8e4e0] text-[#6b6b63] hover:border-[#aeb0c9]'}`}>
              <Settings2 size={14} />Réglages{dirty && <span className="w-1.5 h-1.5 rounded-full bg-[#b45309]" />}
            </button>
            <button onClick={exportTable} className="flex items-center gap-1.5 px-3 py-2 border border-[#e8e4e0] rounded-xl text-sm text-[#6b6b63] hover:border-[#aeb0c9]"><Download size={14} />CSV</button>
            <button onClick={() => setSidebarOpen(true)} className="relative flex items-center gap-2 px-4 py-2 bg-[#1a1a2e] text-white text-sm font-medium rounded-xl hover:bg-[#2d2d4e] transition-colors">
              <ClipboardList size={15} />Bon de commande
              {cartItems.length > 0 && <span className="absolute -top-1.5 -right-1.5 min-w-[20px] h-5 px-1 rounded-full bg-[#c7293a] text-white text-[10px] font-bold flex items-center justify-center">{cartItems.length}</span>}
            </button>
          </div>
        </div>

        <ReorderKpis kpis={computed.kpis} openOrders={openOrders} />

        {urgent.length > 0 && (
          <div className="rounded-[16px] border border-[#f5c6cc] bg-[#fce8ea] px-4 py-3 flex items-start gap-3">
            <AlertTriangle size={16} className="text-[#c7293a] shrink-0 mt-0.5" />
            <div className="text-sm">
              <p className="font-bold text-[#c7293a]">
                URGENT : date limite dépassée pour {urgent.length} {plural(urgent.length, 'variante', 'variantes')} (jusqu’à {int(Math.max(...urgent.map((r) => r.plan.lateBy)))} jours)
              </p>
              <p className="text-xs text-[#9b2c3a] mt-0.5">
                Même commandées aujourd’hui, elles arriveront après la rupture : {urgent.slice(0, 4).map((r) => `${r.title.replace(/™.*$/, '')}${r.variantTitle ? ` ${r.variantTitle}` : ''}`).join(', ')}{urgent.length > 4 ? '…' : ''}.
              </p>
            </div>
          </div>
        )}

        {showSettings && (
          <ReorderSettingsPanel s={s} set={(p) => setDraft({ ...s, ...p })} products={products} dirty={dirty} saving={saving} onSave={saveSettings} />
        )}

        <ReceiptPrompts proposals={computed.proposals} rows={rowMap} lead={lead} act={act} />

        <OrdersInProgress orders={inputs.orders} today={today} act={act} />

        {/* ── Variantes ─────────────────────────────────────────────────── */}
        <section className="space-y-3">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <h2 className="text-sm font-bold text-[#1a1a2e]">Variantes</h2>
            <div className="flex items-center gap-2 flex-wrap">
              <div className="relative">
                <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[#9b9b93]" />
                <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Rechercher"
                  className="pl-7 pr-3 py-1.5 text-xs border border-[#e8e4e0] rounded-lg bg-white w-48 focus:outline-none focus:border-[#aeb0c9]" />
              </div>
              <button onClick={addAll} disabled={!toOrder.length}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-[#1a1a2e] text-white disabled:opacity-40">
                <ListPlus size={13} />Tout ajouter ({toOrder.length})
              </button>
            </div>
          </div>

          {GROUPS.map((g) => {
            const list = sorted.filter((r) => g.statuses.includes(r.plan.status))
            if (!list.length) return null
            const open = openGroups[g.key]
            return (
              <div key={g.key} className={`${CARD} overflow-hidden`}>
                <button onClick={() => setOpenGroups((o) => ({ ...o, [g.key]: !o[g.key] }))}
                  className="w-full flex items-center gap-2 px-4 py-3 text-left hover:bg-[#faf9f8]">
                  <ChevronDown size={14} className={`text-[#9b9b93] transition-transform ${open ? '' : '-rotate-90'}`} />
                  <span className="text-sm font-semibold text-[#1a1a2e]">{g.title}</span>
                  <span className="text-xs text-[#9b9b93]">{list.length} {plural(list.length, 'variante', 'variantes')}{g.hint ? `, ${g.hint}` : ''}</span>
                </button>
                {open && (
                  <div className="overflow-x-auto border-t border-[#f0f0ee]">
                    <table className="w-full text-sm min-w-[980px]">
                      <thead>
                        <tr className="text-[10px] text-[#9b9b93] text-left">
                          {['Produit', 'Stock', 'En prod.', 'Ventes / jour', 'Jours restants', 'Rupture le', 'Commander avant', 'Qté conseillée', ''].map((h) => (
                            <th key={h} className="font-semibold px-3 py-2 whitespace-nowrap">{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {list.map((r) => {
                          const p = r.plan
                          const isOpen = expanded === r.id
                          const pastDeadline = p.orderBy != null && p.orderBy < today
                          return [
                            <tr key={r.id} className={`border-t border-[#f5f5f3] ${isOpen ? 'bg-[#faf9f8]' : 'hover:bg-[#fcfbfa]'}`}>
                              <td className="px-3 py-2.5">
                                <button onClick={() => toggleRow(r)} className="flex items-center gap-3 text-left">
                                  <Thumb src={r.image} alt={r.title} />
                                  <span className="min-w-0">
                                    <span className="block text-xs font-semibold text-[#1a1a2e] max-w-[220px] truncate">{r.title}</span>
                                    <span className="block text-[11px] text-[#6b6b63] truncate">{r.variantTitle ?? '—'}</span>
                                  </span>
                                </button>
                              </td>
                              <td className={`px-3 py-2.5 tabular-nums text-xs font-semibold ${r.stock <= 0 ? 'text-[#c7293a]' : 'text-[#1a1a2e]'}`}>{int(r.stock)}</td>
                              <td className="px-3 py-2.5 tabular-nums text-xs" title={`En production : ${p.inProduction}, en transport : ${p.inTransit}${p.manual ? `, saisi à la main : ${p.manual}` : ''}`}>
                                {p.inProduction + p.inTransit + p.manual > 0
                                  ? <span className="text-[#1a1a2e] font-semibold">{int(p.inProduction + p.inTransit + p.manual)}{p.manual > 0 && <span className="font-normal text-[#9b9b93]"> dont {int(p.manual)} saisi</span>}</span>
                                  : <span className="text-[#c0c0b8]">—</span>}
                              </td>
                              <td className="px-3 py-2.5 tabular-nums text-xs text-[#1a1a2e]">{r.velocity.daily > 0 ? dec(r.velocity.daily, 2) : '—'}</td>
                              <td className="px-3 py-2.5"><StockGauge stockDays={p.stockDays} positionDays={p.positionDays} lead={lead} trigger={trigger} target={target} /></td>
                              <td className="px-3 py-2.5 tabular-nums text-xs whitespace-nowrap" style={{ color: p.ruptureOn && daysBetween(today, p.ruptureOn) <= lead ? RED : undefined }}>
                                {p.ruptureOn ? (p.ruptureOn <= today ? 'en rupture' : fmtDay(p.ruptureOn, true)) : '—'}
                              </td>
                              <td className="px-3 py-2.5 tabular-nums text-xs whitespace-nowrap" style={{ color: pastDeadline ? (p.lateBy > 0 ? RED : ORANGE) : undefined }}>
                                {p.orderBy ? (pastDeadline ? 'maintenant' : fmtDay(p.orderBy, true)) : '—'}
                              </td>
                              <td className="px-3 py-2.5 tabular-nums text-sm font-bold text-[#1a1a2e]">{p.suggested > 0 ? int(p.suggested) : <span className="text-xs font-normal text-[#c0c0b8]">—</span>}</td>
                              <td className="px-3 py-2.5">
                                <div className="flex items-center justify-end gap-1.5">
                                  {(p.status === 'order' || p.status === 'snoozed') && (
                                    cartSet.has(r.id)
                                      ? <span className="inline-flex items-center gap-1 px-2 py-1 text-[11px] text-[#1a7f4b] font-semibold"><Check size={12} />Ajouté</span>
                                      : <button onClick={() => addToCart(r)} className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] font-semibold border border-[#e8e4e0] text-[#1a1a2e] hover:border-[#aeb0c9]"><Plus size={12} />Commander</button>
                                  )}
                                  {p.status === 'order' && (
                                    <button onClick={() => act({ action: 'snooze', variantId: r.id }).then((ok) => ok && setToast('Plus de relance pendant 14 jours'))}
                                      className="px-2 py-1 rounded-lg text-[11px] text-[#6b6b63] hover:bg-[#f5f5f3]" title="Plus de relance pendant 14 jours">Pas maintenant</button>
                                  )}
                                  {p.status === 'snoozed' && (
                                    <button onClick={() => act({ action: 'unsnooze', variantId: r.id })} className="px-2 py-1 rounded-lg text-[11px] text-[#6b6b63] hover:bg-[#f5f5f3]">Relancer</button>
                                  )}
                                  <button onClick={() => toggleRow(r)} className="px-2 py-1 rounded-lg text-[11px] text-[#6b6b63] hover:bg-[#f5f5f3]">{p.status === 'order' ? 'Déjà commandé' : 'Détail'}</button>
                                </div>
                              </td>
                            </tr>,
                            isOpen && (
                              <tr key={`${r.id}-x`} className="bg-[#faf9f8]">
                                <td colSpan={9} className="px-4 pb-4 pt-1">
                                  <div className="grid gap-3 grid-cols-1 md:grid-cols-3 text-xs">
                                    <div className="bg-white rounded-xl p-3 space-y-1">
                                      <p className="font-semibold text-[#1a1a2e]">Ventes par jour : {dec(r.velocity.daily, 2)}</p>
                                      <p className="text-[#6b6b63]">
                                        Sur {r.velocity.usefulDays} jours utiles, du {fmtDay(r.velocity.from, true)} au {fmtDay(r.velocity.to, true)}
                                        {r.velocity.mode === 'référence' ? ' (période de référence)' : ''}.
                                      </p>
                                      <p className="text-[#9b9b93]">
                                        Exclus : {r.velocity.rupture} {plural(r.velocity.rupture, 'jour', 'jours')} de rupture, {r.velocity.promo} de promo
                                        {r.velocity.capped ? `, ${r.velocity.capped} ${plural(r.velocity.capped, 'pic plafonné', 'pics plafonnés')}` : ''}.
                                      </p>
                                      {r.sku && <p className="text-[#aeb0c9] font-mono text-[10px]">{r.sku}</p>}
                                    </div>
                                    <div className="bg-white rounded-xl p-3 space-y-2">
                                      <p className="font-semibold text-[#1a1a2e] flex items-center gap-1.5"><Clock size={12} />Déjà commandé</p>
                                      <div className="flex items-end gap-2 flex-wrap">
                                        <label className="text-[11px] text-[#6b6b63]">Le
                                          <input type="date" value={declare.on} onChange={(e) => setDeclare((d) => ({ ...d, on: e.target.value }))} className="block mt-1 border border-[#e8e4e0] rounded-lg px-2 py-1 bg-white" />
                                        </label>
                                        <label className="text-[11px] text-[#6b6b63]">Quantité
                                          <input type="number" min={1} value={declare.qty} onChange={(e) => setDeclare((d) => ({ ...d, qty: Math.max(0, parseInt(e.target.value) || 0) }))} className="block mt-1 w-20 border border-[#e8e4e0] rounded-lg px-2 py-1 bg-white tabular-nums" />
                                        </label>
                                        <button disabled={declare.qty <= 0 || !declare.on}
                                          onClick={() => act({ action: 'create_order', source: 'declared', orderedOn: declare.on, lines: [{ variantId: r.id, qty: declare.qty }] }).then((ok) => { if (ok) { setExpanded(null); setToast('Commande enregistrée') } })}
                                          className="px-3 py-1.5 rounded-lg text-xs font-medium bg-[#1a1a2e] text-white disabled:opacity-40">Enregistrer</button>
                                      </div>
                                      <p className="text-[10px] text-[#9b9b93]">Dates de production et d’arrivée calculées depuis ce jour, décalables ensuite.</p>
                                    </div>
                                    <div className="bg-white rounded-xl p-3 space-y-2">
                                      <p className="font-semibold text-[#1a1a2e] flex items-center gap-1.5"><PencilLine size={12} />En prod. saisi à la main</p>
                                      <div className="flex items-end gap-2">
                                        <input type="number" min={0} value={manualEdit} onChange={(e) => setManualEdit(Math.max(0, parseInt(e.target.value) || 0))} className="w-20 border border-[#e8e4e0] rounded-lg px-2 py-1 bg-white tabular-nums" aria-label="En prod. saisi à la main" />
                                        <button onClick={() => saveManual(r.id, manualEdit)} className="px-3 py-1.5 rounded-lg text-xs font-medium border border-[#e8e4e0] text-[#1a1a2e] hover:border-[#aeb0c9]">Enregistrer</button>
                                      </div>
                                      <p className="text-[10px] text-[#9b9b93]">En secours seulement : les commandes validées remplissent « En prod. » toutes seules.</p>
                                    </div>
                                  </div>
                                </td>
                              </tr>
                            ),
                          ]
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            )
          })}
        </section>

        <AiInsights type="reapprovisionnement" brand={brand} context={aiContext} />
      </main>

      {/* ── Panneau Bon de commande ──────────────────────────────────────── */}
      <div className={`fixed inset-0 z-50 ${sidebarOpen ? 'pointer-events-auto' : 'pointer-events-none'}`}>
        <div className={`absolute inset-0 bg-black/30 backdrop-blur-[2px] transition-opacity duration-300 ${sidebarOpen ? 'opacity-100' : 'opacity-0'}`} onClick={() => setSidebarOpen(false)} />
        <div className={`absolute right-0 top-0 h-full w-full max-w-[460px] bg-[#faf9f8] shadow-2xl flex flex-col transition-transform duration-300 ease-out ${sidebarOpen ? 'translate-x-0' : 'translate-x-full'}`}>
          <div className="flex items-center justify-between px-6 py-5 border-b border-[#f0f0ee] shrink-0">
            <div>
              <h2 className="text-sm font-bold text-[#1a1a2e]">Bon de commande</h2>
              <p className="text-[11px] text-[#6b6b63] mt-0.5">{brandLabel}, arrivée prévue le {fmtDay(addDays(today, lead), true)}</p>
            </div>
            <button onClick={() => setSidebarOpen(false)} className="p-2 rounded-lg hover:bg-[#f5f0f2]" aria-label="Fermer"><X size={16} className="text-[#6b6b63]" /></button>
          </div>

          <div className="flex-1 overflow-y-auto py-2">
            {cartItems.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-full gap-3 text-center px-8">
                <div className="w-12 h-12 rounded-2xl bg-[#f5f0f2] flex items-center justify-center"><ClipboardList size={22} className="text-[#aeb0c9]" /></div>
                <p className="text-sm font-medium text-[#1a1a2e]">Aucun article</p>
                <p className="text-xs text-[#9b9b93]">« Tout ajouter » met d’un coup toutes les lignes conseillées ; « + Commander » ajoute une ligne.</p>
                {toOrder.length > 0 && <button onClick={addAll} className="mt-1 px-3 py-1.5 rounded-lg text-xs font-semibold bg-[#1a1a2e] text-white">Tout ajouter ({toOrder.length})</button>}
              </div>
            ) : (
              <ul className="divide-y divide-[#f5f0f2]">
                {cartItems.map((item, i) => {
                  const r = rowMap.get(item.id)
                  if (!r) return null
                  return (
                    <li key={item.id} draggable
                      onDragStart={() => { dragIndex.current = i }}
                      onDragOver={(e) => { e.preventDefault(); setDragOver(i) }}
                      onDrop={() => handleDrop(i)}
                      onDragEnd={() => { dragIndex.current = null; setDragOver(null) }}
                      className={`flex items-center gap-3 px-5 py-3.5 transition-colors ${dragOver === i ? 'bg-[#f0eef8] border-t-2 border-[#aeb0c9]' : 'hover:bg-[#faf9f8]'}`}>
                      <GripVertical size={14} className="text-[#d0ccc8] shrink-0 cursor-grab" />
                      <Thumb src={r.image} alt={r.title} />
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-semibold text-[#1a1a2e] truncate">{r.title}</p>
                        {r.variantTitle && <p className="text-[10px] text-[#6b6b63] truncate mt-0.5">{r.variantTitle}</p>}
                        <p className="text-[10px] text-[#9b9b93] truncate mt-0.5">conseillé : {r.plan.suggested ? int(r.plan.suggested) : '—'}{r.sku ? `, ${r.sku}` : ''}</p>
                      </div>
                      <input type="number" min={0} value={item.qty} onChange={(e) => setCartQty(item.id, parseInt(e.target.value) || 0)}
                        className="w-16 text-sm font-bold text-center border border-[#e8e4e0] rounded-lg px-2 py-1.5 text-[#1a1a2e] focus:outline-none focus:border-[#aeb0c9] bg-white tabular-nums shrink-0" aria-label={`Quantité ${r.title}`} />
                      <button onClick={() => removeFromCart(item.id)} className="p-1.5 rounded-lg hover:bg-[#fce8ea] text-[#9b9b93] hover:text-[#c7293a] shrink-0" aria-label="Retirer"><X size={13} /></button>
                    </li>
                  )
                })}
              </ul>
            )}
          </div>

          <div className="border-t border-[#f0f0ee] px-6 py-5 space-y-4 shrink-0 bg-white">
            {cartByProduct.length > 0 && (
              <div className="space-y-1.5">
                <p className="text-[11px] font-semibold text-[#9b9b93]">Par produit</p>
                {cartByProduct.map(([title, qty]) => (
                  <div key={title} className="flex items-center justify-between">
                    <span className="text-xs text-[#6b6b63] truncate">{title.length > 28 ? title.slice(0, 26) + '…' : title}</span>
                    <span className="text-xs font-semibold text-[#1a1a2e] tabular-nums shrink-0 ml-2">{int(qty)} u.</span>
                  </div>
                ))}
                <div className="h-px bg-[#f0f0ee] mt-2" />
              </div>
            )}
            <div className="flex items-center justify-between text-sm">
              <span className="text-[#6b6b63]">{cartItems.length} {plural(cartItems.length, 'référence', 'références')}, {int(cartUnits)} unités</span>
              <span className="font-bold text-[#1a1a2e]">{cartCost.toLocaleString('fr-FR', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 })}</span>
            </div>
            <button onClick={validate} disabled={!poLines.length || validating}
              className="w-full flex items-center justify-center gap-2 px-4 py-2.5 bg-[#1a1a2e] text-white rounded-xl text-sm font-semibold hover:bg-[#2d2d4e] disabled:opacity-40">
              <Check size={14} />{validating ? 'Enregistrement…' : 'Valider la commande'}
            </button>
            <p className="text-[10px] text-[#9b9b93] text-center">Enregistre la commande, exporte le PDF et le CSV, et prépare le message pour le fournisseur.</p>
          </div>
        </div>
      </div>

      {/* ── Message fournisseur ──────────────────────────────────────────── */}
      {message && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/30" onClick={() => setMessage(null)} />
          <div className={`${CARD} relative w-full max-w-lg p-5 space-y-3`}>
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-bold text-[#1a1a2e]">Commande enregistrée. Message pour le fournisseur</h2>
              <button onClick={() => setMessage(null)} className="p-1.5 rounded-lg hover:bg-[#f5f0f2]" aria-label="Fermer"><X size={14} /></button>
            </div>
            <textarea readOnly value={message} rows={12} className="w-full text-xs border border-[#e8e4e0] rounded-xl p-3 bg-[#faf9f8] font-sans" />
            <button onClick={() => navigator.clipboard.writeText(message).then(() => setToast('Message copié'), () => setToast('Copie impossible : sélectionne le texte'))}
              className="w-full flex items-center justify-center gap-2 px-4 py-2.5 bg-[#1a1a2e] text-white rounded-xl text-sm font-semibold"><Copy size={14} />Copier le message</button>
          </div>
        </div>
      )}

      {toast && (
        <div role="status" className="fixed bottom-6 left-1/2 -translate-x-1/2 z-[60] px-4 py-2.5 rounded-xl bg-[#1a1a2e] text-white text-xs shadow-lg" style={{ marginBottom: 'env(safe-area-inset-bottom, 0px)' }}>{toast}</div>
      )}
    </div>
  )
}
