'use client'

export const dynamic = 'force-dynamic'

import { useState, useEffect, useCallback, useRef, Suspense } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { ChevronDown, ChevronUp, ChevronLeft, ChevronRight, Trash2, Mail, Plus, X, MapPin, Package, Truck } from 'lucide-react'

// ─── Types ────────────────────────────────────────────────────────────────────

type Zone = 'nord-est' | 'nord-ouest' | 'sud-est' | 'sud-ouest'
type TourStatus = 'draft' | 'planned' | 'in_progress' | 'completed' | 'cancelled'
type StopStatus = 'pending' | 'delivered'

const ZONE_LABEL: Record<Zone, string> = {
  'nord-est':   'Nord-Est',
  'nord-ouest': 'Nord-Ouest',
  'sud-est':    'Sud-Est',
  'sud-ouest':  'Sud-Ouest',
}
const ZONE_COLOR: Record<Zone, { bg: string; text: string }> = {
  'nord-est':   { bg: '#dbeafe', text: '#1d4ed8' },  // bleu
  'nord-ouest': { bg: '#dcfce7', text: '#15803d' },  // vert
  'sud-est':    { bg: '#fff7ed', text: '#c2680a' },  // orange
  'sud-ouest':  { bg: '#f3e8ff', text: '#7c3aed' },  // violet
}

interface PanelItem { sku: string; title: string; qty: number }

interface ShopifyOrder {
  order_name: string
  shopify_order_id: string
  customer_name: string
  email: string
  created_at: string | null
  is_preorder: boolean
  preorder_ready?: boolean
  address1: string
  city: string
  zip: string
  zone: Zone
  panel_count: number
  panel_details: PanelItem[]
}

interface TourStop {
  id: string
  order_name: string
  customer_name: string
  email: string
  address1: string
  city: string
  zip: string
  zone: Zone
  sequence: number
  panel_count: number
  panel_details: PanelItem[]
  status: StopStatus
  email_sent_at: string | null
  delivered_at: string | null
}

interface Tour {
  id: string
  name: string
  zone: string
  driver_name: string
  planned_date: string
  status: TourStatus
  stops: TourStop[]
  total_panels: number
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function formatDate(dateStr: string): string {
  if (!dateStr) return ''
  const d = new Date(dateStr + 'T00:00:00')
  return d.toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric', month: 'short' })
}



const TOUR_STATUS_LABELS: Record<TourStatus, { label: string; color: string }> = {
  draft:       { label: 'Brouillon',   color: 'bg-gray-100 text-gray-600' },
  planned:     { label: 'Planifiée',   color: 'bg-blue-100 text-blue-700' },
  in_progress: { label: 'En cours',    color: 'bg-yellow-100 text-yellow-700' },
  completed:   { label: 'Terminée',    color: 'bg-green-100 text-[#1a7f4b]' },
  cancelled:   { label: 'Annulée',     color: 'bg-red-100 text-red-600' },
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function DeliveryPage() {
  return (
    <Suspense>
      <DeliveryPageInner />
    </Suspense>
  )
}

function DeliveryPageInner() {
  const router = useRouter()
  const searchParams = useSearchParams()

  const rawView = searchParams.get('view')
  const activeTab: 'planificateur' | 'livreur' | 'sav' =
    rawView === 'livreur' || rawView === 'sav' ? rawView : 'planificateur'

  function setActiveTab(tab: 'planificateur' | 'livreur' | 'sav') {
    router.replace(`/delivery?view=${tab}`)
  }

  return (
    <div className="pl-[88px] p-6 bg-[#f5f5f3] min-h-screen">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <Truck size={24} color="#1a1a2e" strokeWidth={1.8} />
          <h1 className="text-2xl font-bold text-[#1a1a2e]">Delivery</h1>
        </div>
        <div className="flex gap-1 bg-white rounded-[14px] p-1 shadow-[0_2px_8px_rgba(0,0,0,0.06)]">
          {(['planificateur', 'livreur', 'sav'] as const).map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`px-4 py-1.5 rounded-[10px] text-sm font-medium transition-all capitalize ${
                activeTab === tab
                  ? 'bg-[#1a1a2e] text-white'
                  : 'text-[#6b6b63] hover:text-[#1a1a2e]'
              }`}
            >
              {tab === 'planificateur' ? 'Planificateur' : tab === 'livreur' ? 'Livreur' : 'SAV'}
            </button>
          ))}
        </div>
      </div>

      {activeTab === 'planificateur' && <PlanificateurView />}
      {activeTab === 'livreur' && <LivreurView />}
      {activeTab === 'sav' && <SavView />}
    </div>
  )
}

// ─── Planificateur View ───────────────────────────────────────────────────────

function PlanificateurView() {
  const [shopifyOrders, setShopifyOrders] = useState<ShopifyOrder[]>([])
  const [tours, setTours] = useState<Tour[]>([])
  const [selectedOrders, setSelectedOrders] = useState<Set<string>>(new Set())
  const [zoneFilter, setZoneFilter] = useState<'all' | Zone>('all')
  const [search, setSearch] = useState('')
  const [showNewTour, setShowNewTour] = useState(false)
  const [newTourForm, setNewTourForm] = useState({ name: '', zone: 'mixte', driver_name: '', planned_date: '' })
  const [loadingOrders, setLoadingOrders] = useState(true)
  const [loadingTours, setLoadingTours] = useState(true)
  const [targetTourId, setTargetTourId] = useState('')
  const [expandedTours, setExpandedTours] = useState<Set<string>>(new Set())
  const [savingTour, setSavingTour] = useState(false)
  const [addingStops, setAddingStops] = useState(false)

  const fetchOrders = useCallback(async () => {
    setLoadingOrders(true)
    try {
      const r = await fetch('/api/delivery/orders')
      const data = await r.json()
      setShopifyOrders(data.orders ?? [])
    } catch (e) {
      console.error(e)
    } finally {
      setLoadingOrders(false)
    }
  }, [])

  const fetchTours = useCallback(async () => {
    setLoadingTours(true)
    try {
      const r = await fetch('/api/delivery/tours')
      const data = await r.json()
      const sorted = (data.tours ?? []).sort((a: Tour, b: Tour) => {
        if (!a.planned_date) return 1
        if (!b.planned_date) return -1
        return a.planned_date.localeCompare(b.planned_date)
      })
      setTours(sorted)
    } catch (e) {
      console.error(e)
    } finally {
      setLoadingTours(false)
    }
  }, [])

  useEffect(() => {
    fetchOrders()
    fetchTours()
  }, [fetchOrders, fetchTours])

  const filteredOrders = shopifyOrders
    .filter((o) => {
      if (zoneFilter !== 'all' && o.zone !== zoneFilter) return false
      if (search) {
        const q = search.toLowerCase()
        if (!o.order_name.toLowerCase().includes(q) && !o.city.toLowerCase().includes(q)) return false
      }
      return true
    })
    .sort((a, b) => {
      if (!a.created_at) return 1
      if (!b.created_at) return -1
      return a.created_at.localeCompare(b.created_at)
    })

  function toggleOrder(orderName: string) {
    setSelectedOrders((prev) => {
      const next = new Set(prev)
      if (next.has(orderName)) next.delete(orderName)
      else next.add(orderName)
      return next
    })
  }

  async function handleCreateTour() {
    if (!newTourForm.name) return
    setSavingTour(true)
    try {
      const res = await fetch('/api/delivery/tours', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newTourForm),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        const msg = typeof err.error === 'string' ? err.error : JSON.stringify(err.error ?? err)
        alert(`Erreur création tournée: ${msg}`)
        return
      }
      setShowNewTour(false)
      setNewTourForm({ name: '', zone: 'mixte', driver_name: '', planned_date: '' })
      await fetchTours()
    } finally {
      setSavingTour(false)
    }
  }

  async function handleAddStops() {
    if (!targetTourId || selectedOrders.size === 0) return
    setAddingStops(true)
    try {
      const stops = shopifyOrders.filter((o) => selectedOrders.has(o.order_name))
      await fetch(`/api/delivery/tours/${targetTourId}/stops`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ stops }),
      })
      setSelectedOrders(new Set())
      await fetchOrders()
      await fetchTours()
    } finally {
      setAddingStops(false)
    }
  }

  async function handleDeleteStop(stopId: string) {
    await fetch(`/api/delivery/stops/${stopId}`, { method: 'DELETE' })
    await fetchTours()
    await fetchOrders()
  }

  async function handleMoveStop(tourId: string, stopId: string, direction: 'up' | 'down') {
    const tour = tours.find((t) => t.id === tourId)
    if (!tour) return
    const sorted = [...tour.stops].sort((a, b) => a.sequence - b.sequence)
    const idx = sorted.findIndex((s) => s.id === stopId)
    if (idx === -1) return
    const swapIdx = direction === 'up' ? idx - 1 : idx + 1
    if (swapIdx < 0 || swapIdx >= sorted.length) return

    await Promise.all([
      fetch(`/api/delivery/stops/${sorted[idx].id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sequence: sorted[swapIdx].sequence }),
      }),
      fetch(`/api/delivery/stops/${sorted[swapIdx].id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sequence: sorted[idx].sequence }),
      }),
    ])
    await fetchTours()
  }

  async function handleUpdateTourStatus(tourId: string, status: TourStatus) {
    await fetch(`/api/delivery/tours/${tourId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status }),
    })
    await fetchTours()
  }

  async function handleDeleteTour(tourId: string) {
    if (!confirm('Supprimer cette tournée ?')) return
    await fetch(`/api/delivery/tours/${tourId}`, { method: 'DELETE' })
    await fetchTours()
    await fetchOrders()
  }

  function toggleExpand(tourId: string) {
    setExpandedTours((prev) => {
      const next = new Set(prev)
      if (next.has(tourId)) next.delete(tourId)
      else next.add(tourId)
      return next
    })
  }

  function buildLoadingList(stops: TourStop[]) {
    // Group by SKU first, fall back to title if no SKU
    const map = new Map<string, { sku: string; title: string; qty: number; orders: string[] }>()
    for (const stop of stops) {
      for (const item of stop.panel_details ?? []) {
        const key = item.sku?.trim() || item.title
        const existing = map.get(key)
        if (existing) {
          existing.qty += item.qty
          if (!existing.orders.includes(stop.order_name)) existing.orders.push(stop.order_name)
        } else {
          map.set(key, { sku: item.sku?.trim() ?? '', title: item.title, qty: item.qty, orders: [stop.order_name] })
        }
      }
    }
    return [...map.values()].sort((a, b) => b.qty - a.qty)
  }

  function handleAutoSuggest() {
    const targetTour = tours.find((t) => t.id === targetTourId)
    const currentPanels = targetTour ? targetTour.total_panels : 0
    const remaining = 100 - currentPanels
    if (remaining <= 0) return

    // Filter to zone of target tour (if set and not mixte), sort oldest first
    const zone = targetTour?.zone && targetTour.zone !== 'mixte' ? targetTour.zone : null
    const candidates = filteredOrders
      .filter((o) => !selectedOrders.has(o.order_name))
      .filter((o) => !zone || o.zone === zone)
      .slice()
      .sort((a, b) => {
        if (!a.created_at) return 1
        if (!b.created_at) return -1
        return a.created_at.localeCompare(b.created_at)
      })

    const newSelected = new Set(selectedOrders)
    let filled = [...newSelected].reduce((sum, name) => {
      const o = shopifyOrders.find((x) => x.order_name === name)
      return sum + (o?.panel_count ?? 0)
    }, 0)

    for (const order of candidates) {
      if (filled + order.panel_count > remaining) continue
      newSelected.add(order.order_name)
      filled += order.panel_count
      if (filled >= remaining) break
    }
    setSelectedOrders(newSelected)
  }

  return (
    <div className="relative pb-24">
      <div className="grid grid-cols-2 gap-5">
        {/* Left: Orders */}
        <div>
          <div className="rounded-[20px] shadow-[0_2px_16px_rgba(0,0,0,0.06)] bg-white p-5">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-base font-semibold text-[#1a1a2e]">
                Commandes à planifier
                {!loadingOrders && (
                  <span className="ml-2 text-sm font-normal text-[#6b6b63]">({filteredOrders.length})</span>
                )}
              </h2>
              {targetTourId && (
                <button
                  onClick={handleAutoSuggest}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-[10px] bg-[#f0f0fa] text-[#4338ca] text-xs font-medium hover:bg-[#e0e0fa] transition-colors"
                >
                  ✨ Suggestion
                </button>
              )}
            </div>

            {/* Zone filter */}
            <div className="flex gap-2 mb-3">
              {(['all', 'nord-est', 'nord-ouest', 'sud-est', 'sud-ouest'] as const).map((z) => (
                <button
                  key={z}
                  onClick={() => setZoneFilter(z)}
                  className={`px-3 py-1 rounded-full text-xs font-medium transition-all ${
                    zoneFilter === z
                      ? 'bg-[#1a1a2e] text-white'
                      : 'bg-[#f5f5f3] text-[#6b6b63] hover:bg-[#e8e8e4]'
                  }`}
                >
                  {z === 'all' ? 'Toutes' : ZONE_LABEL[z]}
                </button>
              ))}
            </div>

            {/* Search */}
            <input
              type="text"
              placeholder="Rechercher (commande, ville...)"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full px-3 py-2 text-sm border border-[#e8e8e4] rounded-[10px] mb-3 outline-none focus:border-[#aeb0c9] transition-colors"
            />

            {/* Orders list */}
            <div className="space-y-2 max-h-[calc(100vh-320px)] overflow-y-auto pr-1">
              {loadingOrders ? (
                <div className="text-center py-8 text-sm text-[#6b6b63]">Chargement...</div>
              ) : filteredOrders.length === 0 ? (
                <div className="text-center py-8 text-sm text-[#6b6b63]">Aucune commande</div>
              ) : (() => {
                const normal    = filteredOrders.filter((o) => !o.is_preorder)
                const preorders = filteredOrders
                  .filter((o) => o.is_preorder)
                  .sort((a, b) => (b.preorder_ready ? 1 : 0) - (a.preorder_ready ? 1 : 0))

                function renderCard(order: ShopifyOrder) {
                  const selected = selectedOrders.has(order.order_name)
                  const daysWaiting = order.created_at
                    ? Math.floor((Date.now() - new Date(order.created_at).getTime()) / 86_400_000)
                    : null
                  const isOrange = daysWaiting !== null && daysWaiting >= 14 && daysWaiting < 21
                  const isRed    = daysWaiting !== null && daysWaiting >= 21
                  const isUrgent = isOrange || isRed
                  return (
                    <div
                      key={order.order_name}
                      onClick={() => toggleOrder(order.order_name)}
                      className={`rounded-[12px] border transition-all overflow-hidden cursor-pointer ${
                        selected ? 'border-2 border-[#aeb0c9] bg-[#f0f0fa]' : 'border border-[#e8e8e4]'
                      }`}
                    >
                      <div className="p-3">
                        <div className="flex items-start justify-between gap-2">
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-1.5 flex-wrap">
                              <span className="font-semibold text-sm text-[#1a1a2e]">{order.order_name}</span>
                              <span
                                className="px-2 py-0.5 rounded-full text-xs font-medium"
                                style={order.zone in ZONE_COLOR ? {
                                  background: ZONE_COLOR[order.zone as Zone].bg,
                                  color:      ZONE_COLOR[order.zone as Zone].text,
                                } : {}}
                              >
                                {order.zone in ZONE_LABEL ? ZONE_LABEL[order.zone as Zone] : order.zone}
                              </span>
                              <span className="px-2 py-0.5 rounded-full bg-[#f5f5f3] text-[#6b6b63] text-xs">
                                {order.panel_count} panneau{order.panel_count !== 1 ? 'x' : ''}
                              </span>
                              {order.is_preorder && (
                                <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${order.preorder_ready ? 'bg-[#dcfce7] text-[#15803d]' : 'bg-[#fef9c3] text-[#92400e]'}`}>
                                  {order.preorder_ready ? 'Précommande prête à livrer' : 'Précommande'}
                                </span>
                              )}
                              {isUrgent && (
                                <span
                                  className="px-2 py-0.5 rounded-full text-xs font-medium"
                                  style={isRed
                                    ? { background: '#fee2e2', color: '#b91c1c' }
                                    : { background: '#fff7ed', color: '#c2680a' }}
                                >
                                  En attente depuis {daysWaiting}j
                                </span>
                              )}
                            </div>
                            <div className="text-xs text-[#6b6b63] mt-0.5">{order.customer_name} · {order.city}</div>
                            {order.created_at && (
                              <div className="text-[10px] text-[#9b9b93] mt-0.5">
                                {new Date(order.created_at).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' })}
                                {daysWaiting !== null && !isUrgent && <span className="ml-1">({daysWaiting}j)</span>}
                              </div>
                            )}
                          </div>
                          <input
                            type="checkbox"
                            readOnly
                            checked={selected}
                            className="mt-1 accent-[#aeb0c9] cursor-pointer shrink-0"
                            onClick={(e) => e.stopPropagation()}
                          />
                        </div>
                        {order.panel_details?.length > 0 && (
                          <div className="mt-2 space-y-0.5">
                            {order.panel_details.map((item, i) => (
                              <div key={i} className="flex items-center gap-1.5 text-[10px]">
                                <span className="font-mono text-[#6b6b63] bg-[#f5f5f3] px-1.5 py-0.5 rounded shrink-0">{item.sku || '—'}</span>
                                <span className="text-[#6b6b63] truncate">{item.title}</span>
                                <span className="font-semibold text-[#1a1a2e] shrink-0">×{item.qty}</span>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                  )
                }

                return (
                  <>
                    {normal.map(renderCard)}
                    {preorders.length > 0 && (
                      <>
                        <div className="flex items-center gap-2 pt-2">
                          <div className="flex-1 h-px bg-[#e8e8e4]" />
                          <span className="text-[10px] font-semibold uppercase tracking-widest text-[#9b9b93] px-1">
                            Précommandes ({preorders.length})
                          </span>
                          <div className="flex-1 h-px bg-[#e8e8e4]" />
                        </div>
                        {preorders.map(renderCard)}
                      </>
                    )}
                  </>
                )
              })()}
            </div>
          </div>
        </div>

        {/* Right: Tours */}
        <div className="space-y-3">
          {/* Panel capacity bar for selected tour */}
          {(() => {
            const t = tours.find((t) => t.id === targetTourId)
            if (!t) return null
            const pct = Math.min((t.total_panels / 100) * 100, 100)
            const selectedPanels = [...selectedOrders].reduce((sum, name) => {
              const o = shopifyOrders.find((x) => x.order_name === name)
              return sum + (o?.panel_count ?? 0)
            }, 0)
            const projected = Math.min(((t.total_panels + selectedPanels) / 100) * 100, 100)
            return (
              <div className="rounded-[20px] shadow-[0_2px_16px_rgba(0,0,0,0.06)] bg-white p-5">
                <div className="flex items-end justify-between mb-3">
                  <div>
                    <div className="text-xs text-[#6b6b63] mb-0.5">{t.name}</div>
                    <div className="text-3xl font-bold text-[#1a1a2e]">
                      {t.total_panels}
                      {selectedPanels > 0 && (
                        <span className="text-lg font-medium text-[#4338ca] ml-1.5">+{selectedPanels}</span>
                      )}
                      <span className="text-base font-normal text-[#6b6b63] ml-1">/ 100 panneaux</span>
                    </div>
                  </div>
                  <div className="text-sm text-[#6b6b63]">{t.stops.length} arrêt{t.stops.length !== 1 ? 's' : ''}</div>
                </div>
                <div className="relative w-full h-4 bg-[#f5f5f3] rounded-full overflow-hidden">
                  <div
                    className="absolute top-0 left-0 h-full rounded-full transition-all"
                    style={{
                      width: `${pct}%`,
                      background: t.total_panels > 90 ? '#c7293a' : '#1a7f4b',
                    }}
                  />
                  {selectedPanels > 0 && (
                    <div
                      className="absolute top-0 h-full rounded-full bg-[#4338ca]/40 transition-all"
                      style={{ left: `${pct}%`, width: `${Math.min(projected - pct, 100 - pct)}%` }}
                    />
                  )}
                </div>
                <div className="flex justify-between text-[10px] text-[#9b9b93] mt-1">
                  <span>0</span>
                  <span className={t.total_panels + selectedPanels > 90 ? 'text-[#c7293a] font-semibold' : ''}>
                    {100 - t.total_panels - selectedPanels > 0
                      ? `${100 - t.total_panels - selectedPanels} places restantes`
                      : 'Tournée pleine'}
                  </span>
                  <span>100</span>
                </div>
              </div>
            )
          })()}

          <div className="rounded-[20px] shadow-[0_2px_16px_rgba(0,0,0,0.06)] bg-white p-5">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-base font-semibold text-[#1a1a2e]">
                Tournées
                {!loadingTours && (
                  <span className="ml-2 text-sm font-normal text-[#6b6b63]">({tours.length})</span>
                )}
              </h2>
              <button
                onClick={() => setShowNewTour(true)}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-[10px] bg-[#1a1a2e] text-white text-xs font-medium hover:bg-[#2a2a4e] transition-colors"
              >
                <Plus size={14} />
                Nouvelle tournée
              </button>
            </div>

            {/* New tour form */}
            {showNewTour && (
              <div className="mb-4 p-4 rounded-[12px] bg-[#f5f5f3] border border-[#e8e8e4]">
                <div className="flex items-center justify-between mb-3">
                  <span className="text-sm font-medium text-[#1a1a2e]">Nouvelle tournée</span>
                  <button onClick={() => setShowNewTour(false)} className="text-[#6b6b63] hover:text-[#1a1a2e]">
                    <X size={16} />
                  </button>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <input
                    type="text"
                    placeholder="Nom de la tournée *"
                    value={newTourForm.name}
                    onChange={(e) => setNewTourForm((f) => ({ ...f, name: e.target.value }))}
                    className="col-span-2 px-3 py-2 text-sm border border-[#e8e8e4] rounded-[10px] outline-none focus:border-[#aeb0c9] bg-white"
                  />
                  <input
                    type="date"
                    value={newTourForm.planned_date}
                    onChange={(e) => setNewTourForm((f) => ({ ...f, planned_date: e.target.value }))}
                    className="px-3 py-2 text-sm border border-[#e8e8e4] rounded-[10px] outline-none focus:border-[#aeb0c9] bg-white"
                  />
                  <select
                    value={newTourForm.zone}
                    onChange={(e) => setNewTourForm((f) => ({ ...f, zone: e.target.value }))}
                    className="px-3 py-2 text-sm border border-[#e8e8e4] rounded-[10px] outline-none focus:border-[#aeb0c9] bg-white"
                  >
                    <option value="mixte">Mixte</option>
                    <option value="nord-est">Nord-Est</option>
                    <option value="nord-ouest">Nord-Ouest</option>
                    <option value="sud-est">Sud-Est</option>
                    <option value="sud-ouest">Sud-Ouest</option>
                  </select>
                  <input
                    type="text"
                    placeholder="Chauffeur"
                    value={newTourForm.driver_name}
                    onChange={(e) => setNewTourForm((f) => ({ ...f, driver_name: e.target.value }))}
                    className="col-span-2 px-3 py-2 text-sm border border-[#e8e8e4] rounded-[10px] outline-none focus:border-[#aeb0c9] bg-white"
                  />
                </div>
                <div className="flex gap-2 mt-3">
                  <button
                    onClick={handleCreateTour}
                    disabled={savingTour || !newTourForm.name}
                    className="px-4 py-1.5 rounded-[10px] bg-[#1a1a2e] text-white text-sm font-medium disabled:opacity-50"
                  >
                    {savingTour ? 'Création...' : 'Créer'}
                  </button>
                  <button
                    onClick={() => setShowNewTour(false)}
                    className="px-4 py-1.5 rounded-[10px] bg-white border border-[#e8e8e4] text-sm text-[#6b6b63]"
                  >
                    Annuler
                  </button>
                </div>
              </div>
            )}

            {/* Tours list */}
            <div className="space-y-3 max-h-[calc(100vh-300px)] overflow-y-auto pr-1">
              {loadingTours ? (
                <div className="text-center py-8 text-sm text-[#6b6b63]">Chargement...</div>
              ) : tours.length === 0 ? (
                <div className="text-center py-8 text-sm text-[#6b6b63]">Aucune tournée</div>
              ) : (
                tours.map((tour) => {
                  const isTarget = targetTourId === tour.id
                  const isExpanded = expandedTours.has(tour.id)
                  const sortedStops = [...tour.stops].sort((a, b) => a.sequence - b.sequence)

                  const panelPct = Math.min((tour.total_panels / 100) * 100, 100)
                  const statusInfo = TOUR_STATUS_LABELS[tour.status] ?? TOUR_STATUS_LABELS.draft

                  return (
                    <div
                      key={tour.id}
                      className={`rounded-[12px] border transition-all ${
                        isTarget
                          ? 'border-2 border-[#aeb0c9] bg-[#f0f0fa]'
                          : 'border border-[#e8e8e4] bg-white'
                      }`}
                    >
                      <div
                        className="p-3 cursor-pointer"
                        onClick={() => setTargetTourId(isTarget ? '' : tour.id)}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="font-semibold text-sm text-[#1a1a2e]">{tour.name}</span>
                              <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${statusInfo.color}`}>
                                {statusInfo.label}
                              </span>
                              {tour.zone !== 'mixte' && tour.zone in ZONE_COLOR && (
                                <span
                                  className="px-2 py-0.5 rounded-full text-xs font-medium"
                                  style={{
                                    background: ZONE_COLOR[tour.zone as Zone].bg,
                                    color:      ZONE_COLOR[tour.zone as Zone].text,
                                  }}
                                >
                                  {ZONE_LABEL[tour.zone as Zone]}
                                </span>
                              )}
                            </div>
                            {tour.planned_date && (
                              <div className="text-xs text-[#6b6b63] mt-0.5 capitalize">
                                {formatDate(tour.planned_date)}
                              </div>
                            )}
                            {tour.driver_name && (
                              <div className="text-xs text-[#6b6b63]">{tour.driver_name}</div>
                            )}
                          </div>
                          <div className="flex items-center gap-1">
                            <button
                              onClick={(e) => { e.stopPropagation(); toggleExpand(tour.id) }}
                              className="p-1 rounded-lg text-[#6b6b63] hover:bg-[#f5f5f3]"
                            >
                              {isExpanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                            </button>
                          </div>
                        </div>

                        {/* Panel bar */}
                        <div className="mt-2">
                          <div className="flex items-center justify-between text-xs text-[#6b6b63] mb-1">
                            <span>{tour.total_panels} / 100 panneaux</span>
                            <span>{tour.stops.length} arrêt{tour.stops.length !== 1 ? 's' : ''}</span>
                          </div>
                          <div className="w-full h-1.5 bg-[#f5f5f3] rounded-full overflow-hidden">
                            <div
                              className="h-full rounded-full transition-all"
                              style={{
                                width: `${panelPct}%`,
                                background: tour.total_panels > 90 ? '#c7293a' : '#1a7f4b',
                              }}
                            />
                          </div>
                        </div>
                      </div>

                      {/* Expanded stops + actions */}
                      {isExpanded && (
                        <div className="border-t border-[#e8e8e4] p-3">
                          {/* Actions */}
                          <div className="flex flex-wrap gap-2 mb-3">
                            <select
                              value={tour.status}
                              onChange={(e) => handleUpdateTourStatus(tour.id, e.target.value as TourStatus)}
                              className="px-2 py-1 text-xs border border-[#e8e8e4] rounded-[8px] bg-white outline-none"
                              onClick={(e) => e.stopPropagation()}
                            >
                              <option value="draft">Brouillon</option>
                              <option value="planned">Planifiée</option>
                              <option value="in_progress">En cours</option>
                              <option value="completed">Terminée</option>
                            </select>
                            {tour.stops.some((s) => s.email) && (
                              <button
                                onClick={(e) => {
                                  e.stopPropagation()
                                  const emails = tour.stops
                                    .map((s) => s.email)
                                    .filter(Boolean)
                                    .join(', ')
                                  navigator.clipboard.writeText(emails)
                                }}
                                className="flex items-center gap-1 px-3 py-1 text-xs rounded-[8px] bg-[#1a1a2e] text-white hover:bg-[#2a2a4e] transition-colors"
                              >
                                <Mail size={12} />
                                Copier les emails
                              </button>
                            )}
                            <button
                              onClick={(e) => { e.stopPropagation(); handleDeleteTour(tour.id) }}
                              className="flex items-center gap-1 px-3 py-1 text-xs rounded-[8px] bg-[#fef2f2] text-[#c7293a] hover:bg-[#fee2e2]"
                            >
                              <Trash2 size={12} />
                              Supprimer
                            </button>
                          </div>

                          {/* Stops list */}
                          {sortedStops.length === 0 ? (
                            <div className="text-xs text-[#6b6b63] text-center py-3">Aucun arrêt</div>
                          ) : (
                            <div className="space-y-1.5">
                              {sortedStops.map((stop, idx) => (
                                <div
                                  key={stop.id}
                                  className="rounded-[8px] bg-[#f5f5f3] text-xs"
                                >
                                  <div className="flex items-start gap-2 p-2">
                                    <span className="w-5 h-5 rounded-full bg-[#1a1a2e] text-white flex items-center justify-center text-[10px] font-bold shrink-0 mt-0.5">
                                      {idx + 1}
                                    </span>
                                    <div className="flex-1 min-w-0">
                                      <div className="font-medium text-[#1a1a2e]">{stop.order_name}</div>
                                      <div className="text-[#6b6b63]">{stop.customer_name} · {stop.city}</div>
                                      {stop.panel_details?.length > 0 && (
                                        <div className="mt-1 text-[10px] text-[#6b6b63] space-y-0.5">
                                          {stop.panel_details.map((item, i) => (
                                            <div key={i} className="flex items-center gap-1">
                                              <span className="font-mono bg-white border border-[#e8e8e4] px-1 rounded text-[9px] shrink-0">{item.sku || '—'}</span>
                                              <span className="truncate">{item.title}</span>
                                              <span className="shrink-0 font-semibold text-[#1a1a2e]">×{item.qty}</span>
                                            </div>
                                          ))}
                                        </div>
                                      )}
                                    </div>
                                    <div className="flex items-center gap-1 shrink-0">
                                      {stop.email_sent_at && (
                                        <Mail size={12} className="text-[#1a7f4b]" />
                                      )}
                                      <button
                                        onClick={() => handleMoveStop(tour.id, stop.id, 'up')}
                                        disabled={idx === 0}
                                        className="p-0.5 rounded text-[#6b6b63] hover:text-[#1a1a2e] disabled:opacity-30"
                                      >
                                        <ChevronUp size={14} />
                                      </button>
                                      <button
                                        onClick={() => handleMoveStop(tour.id, stop.id, 'down')}
                                        disabled={idx === sortedStops.length - 1}
                                        className="p-0.5 rounded text-[#6b6b63] hover:text-[#1a1a2e] disabled:opacity-30"
                                      >
                                        <ChevronDown size={14} />
                                      </button>
                                      <button
                                        onClick={() => handleDeleteStop(stop.id)}
                                        className="p-0.5 rounded text-[#c7293a] hover:bg-[#fee2e2]"
                                      >
                                        <Trash2 size={14} />
                                      </button>
                                    </div>
                                  </div>
                                </div>
                              ))}
                            </div>
                          )}

                          {/* Liste de chargement */}
                          {sortedStops.length > 0 && (() => {
                            const loadingList = buildLoadingList(tour.stops)
                            if (loadingList.length === 0) return null
                            return (
                              <div className="mt-4 pt-3 border-t border-[#e8e8e4]">
                                <div className="flex items-center gap-1.5 mb-2">
                                  <Package size={13} className="text-[#6b6b63]" />
                                  <span className="text-xs font-semibold text-[#1a1a2e]">Liste de chargement</span>
                                </div>
                                <div className="space-y-1.5">
                                  {loadingList.map((item, i) => (
                                    <div key={i} className="rounded-[8px] bg-[#f5f5f3] px-3 py-2">
                                      <div className="flex items-start justify-between gap-2">
                                        <div className="flex-1 min-w-0">
                                          {item.sku && (
                                            <span className="font-mono text-[10px] text-[#6b6b63] bg-white border border-[#e8e8e4] px-1.5 py-0.5 rounded mr-1.5">{item.sku}</span>
                                          )}
                                          <span className="text-xs text-[#1a1a2e] font-medium">{item.title}</span>
                                        </div>
                                        <span className="text-xs font-bold text-[#1a1a2e] shrink-0 ml-2">{item.qty} u.</span>
                                      </div>
                                      <div className="text-[10px] text-[#6b6b63] mt-0.5 truncate">
                                        {item.orders.join(', ')}
                                      </div>
                                    </div>
                                  ))}
                                </div>
                              </div>
                            )
                          })()}
                        </div>
                      )}
                    </div>
                  )
                })
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Sticky bottom bar */}
      {selectedOrders.size > 0 && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 bg-[#1a1a2e] text-white rounded-[16px] px-5 py-3 shadow-[0_8px_32px_rgba(0,0,0,0.2)] flex items-center gap-4 z-50">
          <span className="text-sm font-medium">
            {selectedOrders.size} commande{selectedOrders.size !== 1 ? 's' : ''} sélectionnée{selectedOrders.size !== 1 ? 's' : ''}
          </span>
          <div className="flex items-center gap-2">
            <span className="text-sm text-white/60">Ajouter à :</span>
            <select
              value={targetTourId}
              onChange={(e) => setTargetTourId(e.target.value)}
              className="px-3 py-1.5 text-sm rounded-[10px] bg-white/10 border border-white/20 text-white outline-none"
            >
              <option value="">Choisir une tournée</option>
              {tours.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name} {t.planned_date ? `· ${formatDate(t.planned_date)}` : ''}
                </option>
              ))}
            </select>
          </div>
          <button
            onClick={handleAddStops}
            disabled={!targetTourId || addingStops}
            className="px-4 py-1.5 rounded-[10px] bg-[#aeb0c9] text-[#1a1a2e] text-sm font-semibold disabled:opacity-40"
          >
            {addingStops ? 'Ajout...' : 'Ajouter'}
          </button>
          <button
            onClick={() => setSelectedOrders(new Set())}
            className="text-white/50 hover:text-white"
          >
            <X size={16} />
          </button>
        </div>
      )}
    </div>
  )
}

// ─── Livreur View ─────────────────────────────────────────────────────────────

type LivreurScreen = 'home' | 'loading' | 'tour'

const DEPOT = 'Rue Lamartine, Zone Industrielle des Distraits, 18390 Saint-Germain-du-Puy, France'

function LivreurView() {
  const [tours, setTours] = useState<Tour[]>([])
  const [selectedTourId, setSelectedTourId] = useState('')
  const [loading, setLoading] = useState(true)
  const [screen, setScreen] = useState<LivreurScreen>('home')
  const [stopIdx, setStopIdx] = useState(0)
  const [marking, setMarking] = useState(false)
  const [checkedItems, setCheckedItems] = useState<Set<string>>(new Set())

  const fetchTours = useCallback(async () => {
    setLoading(true)
    try {
      const r = await fetch('/api/delivery/tours')
      const data = await r.json()
      const today = new Date().toISOString().slice(0, 10)
      const all: Tour[] = (data.tours ?? []).filter((t: Tour) => t.status !== 'cancelled')
      setTours(all)
      // Auto-select today's tour, fallback to first
      const todayTour = all.find((t: Tour) => t.planned_date === today) ?? all[0]
      if (todayTour && !selectedTourId) setSelectedTourId(todayTour.id)
    } catch (e) {
      console.error(e)
    } finally {
      setLoading(false)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => { fetchTours() }, [fetchTours])

  const tour = tours.find((t) => t.id === selectedTourId)
  const sortedStops = tour ? [...tour.stops].sort((a, b) => a.sequence - b.sequence) : []
  const deliveredCount = sortedStops.filter((s) => s.status === 'delivered').length

  // Build loading list by SKU
  const loadingAgg: Map<string, { sku: string; title: string; qty: number }> = new Map()
  if (tour) {
    for (const stop of tour.stops) {
      for (const item of stop.panel_details ?? []) {
        const key = item.sku?.trim() || item.title
        const existing = loadingAgg.get(key)
        if (existing) existing.qty += item.qty
        else loadingAgg.set(key, { sku: item.sku?.trim() ?? '', title: item.title, qty: item.qty })
      }
    }
  }
  const loadingList = [...loadingAgg.values()].sort((a, b) => b.qty - a.qty)


  const currentStop = sortedStops[stopIdx]
  const stopMapsUrl = currentStop
    ? `https://www.google.com/maps/dir/${encodeURIComponent(DEPOT)}/${encodeURIComponent(`${currentStop.address1}, ${currentStop.city} ${currentStop.zip}, France`)}`
    : ''

  async function handleMarkDelivered() {
    if (!currentStop) return
    setMarking(true)
    await fetch(`/api/delivery/stops/${currentStop.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'delivered' }),
    })
    await fetchTours()
    setMarking(false)
    // Auto-advance to next undelivered stop
    const nextIdx = sortedStops.findIndex((s, i) => i > stopIdx && s.status !== 'delivered')
    if (nextIdx !== -1) setStopIdx(nextIdx)
  }

  if (loading) {
    return <div className="text-center py-16 text-sm text-[#6b6b63]">Chargement...</div>
  }

  // ── Screen: home ──
  if (screen === 'home') {
    return (
      <div className="max-w-md mx-auto space-y-4 px-2">
        {/* Tour selector if multiple */}
        {tours.length > 1 && (
          <select
            value={selectedTourId}
            onChange={(e) => setSelectedTourId(e.target.value)}
            className="w-full px-4 py-3 text-sm border border-[#e8e8e4] rounded-[14px] outline-none bg-white"
          >
            {tours.map((t) => (
              <option key={t.id} value={t.id}>{t.name} — {t.planned_date ? formatDate(t.planned_date) : 'sans date'}</option>
            ))}
          </select>
        )}

        {tour ? (
          <div className="rounded-[24px] shadow-[0_4px_24px_rgba(0,0,0,0.08)] bg-white overflow-hidden">
            {/* Tour header */}
            <div className="bg-[#1a1a2e] px-6 py-8 text-white text-center">
              <div className="text-xl font-bold mb-1">{tour.name}</div>
              {tour.planned_date && (
                <div className="text-white/60 text-sm capitalize">{formatDate(tour.planned_date)}</div>
              )}
              <div className="flex items-center justify-center gap-6 mt-5">
                <div className="text-center">
                  <div className="text-3xl font-bold">{sortedStops.length}</div>
                  <div className="text-white/60 text-xs mt-0.5">arrêts</div>
                </div>
                <div className="w-px h-10 bg-white/20" />
                <div className="text-center">
                  <div className="text-3xl font-bold">{tour.total_panels}</div>
                  <div className="text-white/60 text-xs mt-0.5">panneaux</div>
                </div>
                {deliveredCount > 0 && (
                  <>
                    <div className="w-px h-10 bg-white/20" />
                    <div className="text-center">
                      <div className="text-3xl font-bold text-[#4ade80]">{deliveredCount}</div>
                      <div className="text-white/60 text-xs mt-0.5">livrés</div>
                    </div>
                  </>
                )}
              </div>
              {sortedStops.length > 0 && (
                <div className="mt-4 w-full h-1.5 bg-white/20 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-[#4ade80] rounded-full transition-all"
                    style={{ width: `${(deliveredCount / sortedStops.length) * 100}%` }}
                  />
                </div>
              )}
            </div>

            {/* Actions */}
            <div className="p-5 space-y-3">
              <button
                onClick={() => setScreen('loading')}
                className="w-full flex items-center justify-center gap-3 py-4 rounded-[16px] bg-[#f5f5f3] text-[#1a1a2e] font-semibold text-base active:bg-[#e8e8e4] transition-colors"
              >
                <Package size={22} strokeWidth={1.8} />
                Préparer le camion
              </button>
              <button
                onClick={() => { setStopIdx(0); setScreen('tour') }}
                disabled={sortedStops.length === 0}
                className="w-full flex items-center justify-center gap-3 py-4 rounded-[16px] bg-[#1a1a2e] text-white font-semibold text-base disabled:opacity-40 active:bg-[#2a2a4e] transition-colors"
              >
                <Truck size={22} strokeWidth={1.8} />
                Démarrer la tournée
              </button>
            </div>
          </div>
        ) : (
          <div className="rounded-[20px] bg-white p-12 text-center text-sm text-[#6b6b63]">
            Aucune tournée disponible
          </div>
        )}
      </div>
    )
  }

  // ── Screen: loading list ──
  if (screen === 'loading') {
    const allChecked = loadingList.length > 0 && loadingList.every((item) => checkedItems.has(item.sku || item.title))

    function toggleItem(key: string) {
      setCheckedItems((prev) => {
        const next = new Set(prev)
        if (next.has(key)) next.delete(key)
        else next.add(key)
        return next
      })
    }

    return (
      <div className="max-w-md mx-auto px-2 pb-28">
        <div className="flex items-center gap-3 mb-5">
          <button
            onClick={() => setScreen('home')}
            className="w-10 h-10 rounded-full bg-white shadow flex items-center justify-center"
          >
            <ChevronLeft size={20} />
          </button>
          <h2 className="text-lg font-bold text-[#1a1a2e]">Chargement camion</h2>
          <span className="ml-auto text-sm text-[#6b6b63]">{checkedItems.size} / {loadingList.length}</span>
        </div>
        <div className="rounded-[20px] bg-white shadow-[0_4px_24px_rgba(0,0,0,0.08)] overflow-hidden">
          {loadingList.length === 0 ? (
            <div className="p-8 text-center text-sm text-[#6b6b63]">Aucun produit</div>
          ) : (
            <div className="divide-y divide-[#f0f0f0]">
              {loadingList.map((item, i) => {
                const key = item.sku || item.title
                const checked = checkedItems.has(key)
                return (
                  <div
                    key={i}
                    onClick={() => toggleItem(key)}
                    className={`flex items-center gap-4 px-5 py-4 cursor-pointer transition-colors ${
                      checked ? 'bg-[#f0fdf4]' : 'bg-white active:bg-[#f5f5f3]'
                    }`}
                  >
                    {/* Checkbox */}
                    <div className={`shrink-0 w-7 h-7 rounded-full border-2 flex items-center justify-center transition-all ${
                      checked ? 'bg-[#1a7f4b] border-[#1a7f4b]' : 'border-[#d1d5db]'
                    }`}>
                      {checked && (
                        <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                          <path d="M2.5 7L5.5 10L11.5 4" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                        </svg>
                      )}
                    </div>
                    <div className={`flex-1 min-w-0 transition-all ${checked ? 'opacity-50' : ''}`}>
                      {item.sku && (
                        <div className={`font-mono text-xs text-[#6b6b63] mb-0.5 ${checked ? 'line-through' : ''}`}>{item.sku}</div>
                      )}
                      <div className={`font-semibold text-base leading-tight ${checked ? 'line-through text-[#6b6b63]' : 'text-[#1a1a2e]'}`}>
                        {item.title}
                      </div>
                    </div>
                    <div className={`shrink-0 w-14 h-14 rounded-[14px] flex items-center justify-center font-bold text-2xl transition-all ${
                      checked ? 'bg-[#1a7f4b] text-white' : 'bg-[#1a1a2e] text-white'
                    }`}>
                      {item.qty}
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>

        {/* Validate button — fixed bottom */}
        {allChecked && (
          <div className="fixed bottom-6 left-0 right-0 flex justify-center px-6">
            <button
              onClick={() => { setStopIdx(0); setScreen('tour') }}
              className="w-full max-w-md py-5 rounded-[16px] bg-[#1a7f4b] text-white font-bold text-lg shadow-[0_8px_32px_rgba(26,127,75,0.35)]"
            >
              Camion chargé ✓
            </button>
          </div>
        )}
      </div>
    )
  }

  // ── Screen: tour (stop-by-stop) ──
  if (!currentStop) {
    return (
      <div className="max-w-md mx-auto px-2 text-center space-y-4 py-12">
        <div className="text-5xl">🎉</div>
        <div className="text-xl font-bold text-[#1a1a2e]">Tournée terminée !</div>
        <div className="text-sm text-[#6b6b63]">{deliveredCount} arrêt{deliveredCount !== 1 ? 's' : ''} livrés</div>
        <button
          onClick={() => setScreen('home')}
          className="px-6 py-3 rounded-[14px] bg-[#1a1a2e] text-white font-medium"
        >
          Retour à l&apos;accueil
        </button>
      </div>
    )
  }

  return (
    <div className="max-w-md mx-auto px-2 flex flex-col" style={{ minHeight: 'calc(100vh - 140px)' }}>
      {/* Top bar: back + Maps */}
      <div className="flex items-center justify-between mb-4">
        <button
          onClick={() => setScreen('home')}
          className="w-10 h-10 rounded-full bg-white shadow flex items-center justify-center"
        >
          <ChevronLeft size={20} />
        </button>
        <div className="text-sm font-medium text-[#6b6b63]">
          {stopIdx + 1} / {sortedStops.length}
        </div>
        {stopMapsUrl && (
          <a
            href={stopMapsUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1.5 px-3 py-2 rounded-[12px] bg-[#1a7f4b] text-white text-sm font-medium"
          >
            <MapPin size={15} />
            Maps
          </a>
        )}
      </div>

      {/* Stop card */}
      <div className={`flex-1 rounded-[24px] shadow-[0_4px_24px_rgba(0,0,0,0.08)] overflow-hidden flex flex-col ${
        currentStop.status === 'delivered' ? 'bg-[#f0fdf4]' : 'bg-white'
      }`}>
        {/* Progress dots */}
        <div className="flex gap-1 px-5 pt-4">
          {sortedStops.map((s, i) => (
            <div
              key={s.id}
              onClick={() => setStopIdx(i)}
              className={`h-1 flex-1 rounded-full cursor-pointer transition-all ${
                i === stopIdx ? 'bg-[#1a1a2e]' : s.status === 'delivered' ? 'bg-[#4ade80]' : 'bg-[#e8e8e4]'
              }`}
            />
          ))}
        </div>

        <div className="flex-1 px-6 py-6 flex flex-col">
          {/* Client + address */}
          <div className="flex-1">
            <div className="text-[#6b6b63] text-sm mb-1">{currentStop.order_name}</div>
            <div className="text-3xl font-bold text-[#1a1a2e] leading-tight mb-3">
              {currentStop.customer_name}
            </div>
            <div className="text-lg text-[#1a1a2e] mb-1">{currentStop.address1}</div>
            <div className="text-lg text-[#6b6b63]">{currentStop.city} {currentStop.zip}</div>

            {/* Products */}
            {currentStop.panel_details?.length > 0 && (
              <div className="mt-6 space-y-2">
                <div className="text-xs font-semibold text-[#6b6b63] uppercase tracking-wide">À déposer</div>
                {currentStop.panel_details.map((item, i) => (
                  <div key={i} className="flex items-center gap-3 bg-[#f5f5f3] rounded-[12px] px-4 py-3">
                    <div className="flex-1 min-w-0">
                      {item.sku && <div className="font-mono text-xs text-[#6b6b63]">{item.sku}</div>}
                      <div className="font-medium text-[#1a1a2e] text-sm leading-tight">{item.title}</div>
                    </div>
                    <div className="w-10 h-10 rounded-[10px] bg-[#1a1a2e] text-white flex items-center justify-center font-bold text-lg shrink-0">
                      {item.qty}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Navigation arrows */}
          <div className="flex items-center gap-3 mt-6 mb-4">
            <button
              onClick={() => setStopIdx((i) => Math.max(0, i - 1))}
              disabled={stopIdx === 0}
              className="flex-1 flex items-center justify-center gap-2 py-3 rounded-[14px] border border-[#e8e8e4] text-[#6b6b63] disabled:opacity-30 active:bg-[#f5f5f3]"
            >
              <ChevronLeft size={20} />
              Précédent
            </button>
            <button
              onClick={() => setStopIdx((i) => Math.min(sortedStops.length - 1, i + 1))}
              disabled={stopIdx === sortedStops.length - 1}
              className="flex-1 flex items-center justify-center gap-2 py-3 rounded-[14px] border border-[#e8e8e4] text-[#6b6b63] disabled:opacity-30 active:bg-[#f5f5f3]"
            >
              Suivant
              <ChevronRight size={20} />
            </button>
          </div>
        </div>

        {/* Delivery button — full width, pinned to bottom */}
        <div className="px-5 pb-5">
          {currentStop.status === 'delivered' ? (
            <div className="w-full py-4 rounded-[16px] bg-[#d1fae5] text-[#1a7f4b] font-bold text-center text-lg">
              Livré ✓
              {currentStop.delivered_at && (
                <span className="ml-2 text-sm font-normal opacity-70">
                  {new Date(currentStop.delivered_at).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}
                </span>
              )}
            </div>
          ) : (
            <button
              onClick={handleMarkDelivered}
              disabled={marking}
              className="w-full py-5 rounded-[16px] bg-[#6b21a8] text-white font-bold text-lg disabled:opacity-60 active:bg-[#7c3aed] transition-colors"
            >
              {marking ? 'Enregistrement...' : 'Marquer comme livré'}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

// ─── SAV View ─────────────────────────────────────────────────────────────────

type SavStatus = 'pending' | 'planned' | 'in_progress' | 'delivered'

// SAV-only info — never included in email templates
const DRIVER_PHONES: Record<string, string> = {
  'Khalid': '06 62 89 30 14',
}

interface SavStopSummary {
  city: string
  order_name: string
  status: StopStatus
  sequence: number
}

interface SavEntry {
  id: string
  order_name: string
  customer_name: string
  email: string
  city: string
  zip: string
  zone: Zone
  address1: string
  panel_count: number
  panel_details: PanelItem[]
  tour_name: string | null
  tour_status: TourStatus | null
  tour_planned_date: string | null
  tour_zone: string | null
  tour_total_stops: number
  tour_delivered_stops: number
  stops_before: number
  tour_stops_summary: SavStopSummary[]
  driver_name: string | null
  stop_status: StopStatus | null
  stop_sequence: number
  delivered_at: string | null
  sav_status: SavStatus
}

const SAV_STATUS_CONFIG: Record<SavStatus, { label: string; bg: string; text: string }> = {
  pending:     { label: 'En attente',        bg: '#f5f5f3', text: '#6b6b63' },
  planned:     { label: 'Planifiée',         bg: '#ede9fe', text: '#6d28d9' },
  in_progress: { label: 'En livraison',      bg: '#dbeafe', text: '#1d4ed8' },
  delivered:   { label: 'Livrée',            bg: '#d1fae5', text: '#1a7f4b' },
}

const TIMELINE_STEPS: { label: string; statuses: SavStatus[] }[] = [
  { label: 'Commande reçue', statuses: ['pending', 'planned', 'in_progress', 'delivered'] },
  { label: 'Planifiée',      statuses: ['planned', 'in_progress', 'delivered'] },
  { label: 'En livraison',   statuses: ['in_progress', 'delivered'] },
  { label: 'Livrée',         statuses: ['delivered'] },
]

function getISOWeekNum(dateStr: string): number {
  const d = new Date(dateStr + 'T00:00:00')
  const utc = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()))
  utc.setUTCDate(utc.getUTCDate() + 4 - (utc.getUTCDay() || 7))
  const yearStart = new Date(Date.UTC(utc.getUTCFullYear(), 0, 1))
  return Math.ceil((((utc.getTime() - yearStart.getTime()) / 86400000) + 1) / 7)
}

function getWeekRange(dateStr: string): { start: string; end: string } {
  const d = new Date(dateStr + 'T00:00:00')
  const day = d.getDay()
  const diffToMonday = day === 0 ? -6 : 1 - day
  const monday = new Date(d)
  monday.setDate(d.getDate() + diffToMonday)
  const friday = new Date(monday)
  friday.setDate(monday.getDate() + 4)
  const opts: Intl.DateTimeFormatOptions = { weekday: 'long', day: 'numeric', month: 'long' }
  return {
    start: monday.toLocaleDateString('fr-FR', opts),
    end:   friday.toLocaleDateString('fr-FR', opts),
  }
}

function buildSavEmail(entry: SavEntry): string {
  const prenom = entry.customer_name.split(' ')[0] || entry.customer_name
  const ref = entry.order_name
  switch (entry.sav_status) {
    case 'pending':
      return `Bonjour ${prenom},\n\nJe reviens vers vous concernant votre commande ${ref}. Votre commande est bien enregistrée et sera intégrée à notre prochaine tournée de livraison dans votre région. Nous vous tiendrons informé(e) dès qu'une date sera confirmée.\n\nCordialement,\nL'équipe Bowa`
    case 'planned': {
      const range = entry.tour_planned_date ? getWeekRange(entry.tour_planned_date) : null
      const rangeStr = range ? ` Notre livreur sera dans votre secteur entre le ${range.start} et le ${range.end}.` : ''
      return `Bonjour ${prenom},\n\nBonne nouvelle ! Je vois que votre commande ${ref} est d'ores et déjà programmée.${rangeStr} Notre livreur vous contactera par téléphone avant de passer. Merci de votre patience.\n\nCordialement,\nL'équipe Bowa`
    }
    case 'in_progress':
      return `Bonjour ${prenom},\n\nJe vois que notre livreur est actuellement en tournée dans votre région. Votre commande ${ref} devrait vous être livrée très prochainement. Il vous contactera par téléphone avant de passer.\n\nCordialement,\nL'équipe Bowa`
    case 'delivered': {
      const dateStr = entry.delivered_at
        ? new Date(entry.delivered_at).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' })
        : '?'
      return `Bonjour ${prenom},\n\nVotre commande ${ref} a bien été livrée le ${dateStr}. Nous espérons que vous êtes satisfait(e) de votre achat. N'hésitez pas à nous contacter pour toute question.\n\nCordialement,\nL'équipe Bowa`
    }
  }
}

// Pure helper — builds SavEntry[] from raw API responses
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function buildSavEntries(toursRaw: any[], ordersRaw: ShopifyOrder[]): SavEntry[] {
  const result: SavEntry[] = []

  for (const tour of toursRaw) {
    if (tour.status === 'cancelled') continue
    const stops: TourStop[] = tour.stops ?? []
    const tourTotal    = stops.length
    const tourDelivered = stops.filter((s: TourStop) => s.status === 'delivered').length
    const sortedStops  = [...stops].sort((a: TourStop, b: TourStop) => a.sequence - b.sequence)
    const tourStopsSummary: SavStopSummary[] = sortedStops.map((s: TourStop) => ({
      city: s.city, order_name: s.order_name, status: s.status, sequence: s.sequence,
    }))

    for (const stop of stops) {
      let sav_status: SavStatus
      if (stop.status === 'delivered')        sav_status = 'delivered'
      else if (tour.status === 'in_progress') sav_status = 'in_progress'
      else                                    sav_status = 'planned'

      const stopsBefore = sortedStops.filter(
        (s: TourStop) => s.sequence < stop.sequence && s.status !== 'delivered'
      ).length

      result.push({
        id: stop.id, order_name: stop.order_name, customer_name: stop.customer_name,
        email: stop.email, city: stop.city, zip: stop.zip, zone: stop.zone,
        address1: stop.address1, panel_count: stop.panel_count,
        panel_details: stop.panel_details ?? [],
        tour_name: tour.name, tour_status: tour.status,
        tour_planned_date: tour.planned_date, tour_zone: tour.zone ?? null,
        tour_total_stops: tourTotal, tour_delivered_stops: tourDelivered,
        stops_before: stopsBefore, tour_stops_summary: tourStopsSummary,
        driver_name: tour.driver_name ?? null,
        stop_status: stop.status, stop_sequence: stop.sequence,
        delivered_at: stop.delivered_at ?? null, sav_status,
      })
    }
  }

  for (const order of ordersRaw) {
    result.push({
      id: `order-${order.order_name}`, order_name: order.order_name,
      customer_name: order.customer_name, email: order.email,
      city: order.city, zip: order.zip, zone: order.zone, address1: order.address1,
      panel_count: order.panel_count, panel_details: order.panel_details ?? [],
      tour_name: null, tour_status: null, tour_planned_date: null, tour_zone: null,
      tour_total_stops: 0, tour_delivered_stops: 0, stops_before: 0,
      tour_stops_summary: [], driver_name: null,
      stop_status: null, stop_sequence: 0, delivered_at: null, sav_status: 'pending',
    })
  }

  return result
}

function SavView() {
  const [search, setSearch]     = useState('')
  const [entries, setEntries]   = useState<SavEntry[]>([])
  const [loading, setLoading]   = useState(true)
  const [selected, setSelected] = useState<SavEntry | null>(null)
  const [copied, setCopied]     = useState(false)

  // Refs for polling — avoid stale closures
  const cachedOrdersRef = useRef<ShopifyOrder[]>([])
  const entriesRef      = useRef<SavEntry[]>([])
  const refreshingRef   = useRef(false)

  function applyEntries(newEntries: SavEntry[]) {
    entriesRef.current = newEntries
    setEntries(newEntries)
    setSelected(prev => prev ? newEntries.find(e => e.id === prev.id) ?? prev : prev)
  }

  useEffect(() => {
    async function load() {
      setLoading(true)
      try {
        const [toursData, ordersData] = await Promise.all([
          fetch('/api/delivery/tours').then(r => r.json()),
          fetch('/api/delivery/orders').then(r => r.json()),
        ])
        cachedOrdersRef.current = ordersData.orders ?? []
        applyEntries(buildSavEntries(toursData.tours ?? [], cachedOrdersRef.current))
      } catch (e) {
        console.error(e)
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [])

  // Real-time polling — refresh every 10s when any in_progress tour exists
  useEffect(() => {
    const interval = setInterval(async () => {
      const hasInProgress = entriesRef.current.some(e => e.sav_status === 'in_progress')
      if (!hasInProgress) return
      if (refreshingRef.current) return
      refreshingRef.current = true
      try {
        const toursData = await fetch('/api/delivery/tours').then(r => r.json())
        applyEntries(buildSavEntries(toursData.tours ?? [], cachedOrdersRef.current))
      } catch { /* silent */ } finally {
        refreshingRef.current = false
      }
    }, 10_000)
    return () => clearInterval(interval)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const [emailOpen, setEmailOpen] = useState(false)

  const filtered = entries.filter((e) => {
    if (!search.trim()) return true
    const q = search.toLowerCase()
    return (
      e.order_name.toLowerCase().includes(q) ||
      e.customer_name.toLowerCase().includes(q) ||
      e.city.toLowerCase().includes(q)
    )
  })

  function handleCopy() {
    if (!selected) return
    navigator.clipboard.writeText(buildSavEmail(selected))
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  function selectEntry(entry: SavEntry) {
    setSelected(entry)
    setCopied(false)
    setEmailOpen(false)
  }

  // Build live tour widgets from entries (updated by polling)
  const liveToursMap = new Map<string, SavEntry>()
  for (const e of entries) {
    if (e.sav_status === 'in_progress' && e.tour_name && !liveToursMap.has(e.tour_name)) {
      liveToursMap.set(e.tour_name, e)
    }
  }
  const liveTours = [...liveToursMap.values()]

  return (
    <div className="space-y-4">

      {/* ── Live delivery widget ── */}
      {liveTours.length > 0 && (
        <div className="space-y-3">
          {liveTours.map((rep) => {
            const stops  = rep.tour_stops_summary
            const total  = rep.tour_total_stops
            const done   = rep.tour_delivered_stops
            const pct    = total > 0 ? Math.round((done / total) * 100) : 0
            const currentSeq = stops.find(s => s.status !== 'delivered')?.sequence ?? -1
            const weekNum = rep.tour_planned_date ? getISOWeekNum(rep.tour_planned_date) : null

            // Progress line width: from left edge to center of last delivered stop
            const lineWidth = done > 0 && total > 0
              ? `${(2 * done - 1) / (2 * total) * 100}%`
              : '0%'
            // Truck x: midpoint between last delivered and current
            const truckLeft = total > 0 ? `calc(${done / total * 100}% - 12px)` : '0px'

            return (
              <div key={rep.tour_name} className="rounded-[20px] bg-white shadow-[0_2px_16px_rgba(0,0,0,0.07)] border border-[#ebebeb] px-5 pt-5 pb-6">

                {/* Header */}
                <div className="flex items-center justify-between mb-5">
                  <div className="flex items-center gap-2.5">
                    <span className="w-2.5 h-2.5 rounded-full bg-[#1a7f4b] animate-pulse flex-shrink-0" />
                    <div>
                      <p className="text-base font-bold text-[#1a1a2e] leading-snug">
                        {rep.driver_name ?? 'Livreur'} · {rep.tour_name}
                        {weekNum && <span className="font-normal text-[#6b6b63]"> · Semaine {weekNum}</span>}
                      </p>
                      <p className="text-xs text-[#9b9b93]">Tournée en cours</p>
                    </div>
                  </div>
                  <div className="text-right flex-shrink-0 ml-4">
                    <p className="text-xl font-extrabold text-[#1a1a2e] leading-none">{pct}%</p>
                    <p className="text-xs text-[#6b6b63] mt-0.5">{done}/{total} arrêts livrés</p>
                  </div>
                </div>

                {/* Stepper */}
                <div className="overflow-x-auto">
                  <div className="relative" style={{ minWidth: `${Math.max(stops.length * 72, 300)}px` }}>

                    {/* Flex row for stops (defines the coordinate space) */}
                    <div className="relative flex items-start">

                      {/* Grey base line (centered on circles at top-[16px]) */}
                      <div className="absolute left-0 right-0 h-[2px] bg-[#e8e8e4] top-[16px]" />

                      {/* Green progress line */}
                      <div
                        className="absolute left-0 h-[2px] bg-[#1a7f4b] top-[16px] transition-[width] duration-700 ease-in-out"
                        style={{ width: lineWidth }}
                      />

                      {/* Truck 🚚 — moves between last delivered and current stop */}
                      {done > 0 && done < total && (
                        <div
                          className="absolute top-0 z-30 transition-[left] duration-700 ease-in-out pointer-events-none select-none"
                          style={{ left: truckLeft }}
                        >
                          <span className="text-base leading-none">🚚</span>
                        </div>
                      )}

                      {/* Stop circles */}
                      {stops.map((s, i) => {
                        const isDelivered = s.status === 'delivered'
                        const isCurrent   = !isDelivered && s.sequence === currentSeq
                        return (
                          <div key={i} className="relative flex flex-col items-center flex-1 pt-0">
                            {/* Pulsing ring around current stop (border animates, fill stays green) */}
                            <div className="relative flex items-center justify-center">
                              {isCurrent && (
                                <div className="absolute w-10 h-10 rounded-full border-2 border-[#1a7f4b] animate-ping opacity-30" />
                              )}
                              <div
                                className={`relative z-10 w-8 h-8 rounded-full border-2 flex items-center justify-center transition-all duration-500 ${
                                  isDelivered || isCurrent
                                    ? 'bg-[#1a7f4b] border-[#1a7f4b]'
                                    : 'bg-white border-[#d1d5db]'
                                }`}
                              >
                                {(isDelivered || isCurrent) && (
                                  <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                                    <path d="M2 6L5 9L10 3" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                                  </svg>
                                )}
                              </div>
                            </div>
                            {/* City */}
                            <span className={`mt-2 text-[10px] font-semibold text-center leading-tight max-w-[68px] truncate ${
                              isDelivered || isCurrent ? 'text-[#1a7f4b]' : 'text-[#6b6b63]'
                            }`}>
                              {s.city}
                            </span>
                            {/* Order ref */}
                            <span className="text-[8px] text-[#bdbdb7] text-center truncate max-w-[68px]">
                              {s.order_name}
                            </span>
                          </div>
                        )
                      })}
                    </div>
                  </div>
                </div>

              </div>
            )
          })}
        </div>
      )}

    <div className="flex gap-4 items-start">
      {/* ── Left: search + list ── */}
      <div className={`flex-shrink-0 ${selected ? 'w-[300px]' : 'flex-1 max-w-xl'}`}>
        <div className="rounded-[20px] shadow-[0_2px_16px_rgba(0,0,0,0.06)] bg-white p-5">
          <h2 className="text-base font-semibold text-[#1a1a2e] mb-3">SAV — Suivi livraisons</h2>
          <input
            type="text"
            placeholder="Commande, client, ville..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full px-3 py-2 text-sm border border-[#e8e8e4] rounded-[10px] mb-3 outline-none focus:border-[#aeb0c9]"
          />
          {loading ? (
            <div className="text-center py-8 text-sm text-[#6b6b63]">Chargement...</div>
          ) : filtered.length === 0 ? (
            <div className="text-center py-8 text-sm text-[#6b6b63]">
              {search.trim() ? 'Aucun résultat' : 'Aucune commande'}
            </div>
          ) : (
            <div className="space-y-1.5 max-h-[calc(100vh-260px)] overflow-y-auto pr-0.5">
              {filtered.map((entry) => {
                const cfg = SAV_STATUS_CONFIG[entry.sav_status]
                const isSelected = selected?.id === entry.id
                const weekInfo = entry.tour_planned_date
                  ? getWeekRange(entry.tour_planned_date).start
                  : null
                return (
                  <button
                    key={entry.id}
                    onClick={() => selectEntry(entry)}
                    className={`w-full text-left px-3.5 py-2.5 rounded-[12px] border transition-all ${
                      isSelected
                        ? 'border-[#aeb0c9] bg-[#f0f0fb]'
                        : 'border-[#f0f0ee] bg-[#fafaf8] hover:bg-[#f5f5f3]'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-1.5 mb-0.5">
                      <span className="font-mono text-xs font-bold text-[#1a1a2e]">{entry.order_name}</span>
                      <span
                        className="px-1.5 py-0.5 rounded-full text-[10px] font-medium whitespace-nowrap flex-shrink-0"
                        style={{ backgroundColor: cfg.bg, color: cfg.text }}
                      >
                        {cfg.label}
                      </span>
                    </div>
                    <div className="text-xs text-[#6b6b63] truncate">{entry.customer_name} · {entry.city}</div>
                    {entry.tour_name && (
                      <div className="text-[10px] text-[#9b9b93] mt-0.5 truncate">
                        {entry.tour_name}{weekInfo ? ` · ${weekInfo}` : ''}
                      </div>
                    )}
                  </button>
                )
              })}
            </div>
          )}
        </div>
      </div>

      {/* ── Right: detail panel ── */}
      {selected && (() => {
        const zc = ZONE_COLOR[selected.zone] ?? { bg: '#f5f5f3', text: '#6b6b63' }
        const emailText = buildSavEmail(selected)
        const driverPhone = selected.driver_name ? DRIVER_PHONES[selected.driver_name] : undefined

        // Timeline
        const stepIndex = ['pending', 'planned', 'in_progress', 'delivered'].indexOf(selected.sav_status)

        // Driver progress (in_progress)
        const pct = selected.tour_total_stops > 0
          ? Math.round((selected.tour_delivered_stops / selected.tour_total_stops) * 100)
          : 0
        const deliveredCities = [...new Set(
          selected.tour_stops_summary.filter(s => s.status === 'delivered').map(s => s.city)
        )]
        const remainingCities = [...new Set(
          selected.tour_stops_summary.filter(s => s.status !== 'delivered').map(s => s.city)
        )]

        // Week range for planned
        const range = selected.tour_planned_date ? getWeekRange(selected.tour_planned_date) : null

        return (
          <div className="flex-1 min-w-0 rounded-[20px] shadow-[0_2px_16px_rgba(0,0,0,0.06)] bg-white overflow-hidden">
            {/* ── Header ── */}
            <div className="px-5 pt-5 pb-4 border-b border-[#f0f0ee]">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-mono text-base font-bold text-[#1a1a2e]">{selected.order_name}</span>
                    <span
                      className="px-2.5 py-0.5 rounded-full text-xs font-semibold"
                      style={{ backgroundColor: SAV_STATUS_CONFIG[selected.sav_status].bg, color: SAV_STATUS_CONFIG[selected.sav_status].text }}
                    >
                      {SAV_STATUS_CONFIG[selected.sav_status].label}
                    </span>
                    <span
                      className="px-2 py-0.5 rounded-full text-[10px] font-medium"
                      style={{ backgroundColor: zc.bg, color: zc.text }}
                    >
                      {ZONE_LABEL[selected.zone]}
                    </span>
                  </div>
                  <p className="text-sm font-medium text-[#1a1a2e] mt-1">{selected.customer_name}</p>
                  {selected.email && <p className="text-xs text-[#9b9b93]">{selected.email}</p>}
                </div>
                <button onClick={() => setSelected(null)} className="text-[#9b9b93] hover:text-[#1a1a2e] transition-colors mt-0.5 flex-shrink-0">
                  <X size={16} />
                </button>
              </div>
            </div>

            <div className="px-5 py-4 space-y-4 overflow-y-auto max-h-[calc(100vh-200px)]">

              {/* ── Timeline ── */}
              <div className="flex items-center gap-0">
                {TIMELINE_STEPS.map((step, i) => {
                  const done    = stepIndex >= i
                  const current = stepIndex === i
                  return (
                    <div key={i} className="flex items-center flex-1 last:flex-none">
                      <div className="flex flex-col items-center gap-1 min-w-0">
                        <div
                          className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0 ${
                            done
                              ? 'bg-[#1a7f4b] text-white'
                              : current
                              ? 'bg-[#1d4ed8] text-white'
                              : 'bg-[#f0f0ee] text-[#9b9b93]'
                          }`}
                        >
                          {done ? '✓' : i + 1}
                        </div>
                        <span className={`text-[9px] font-medium text-center leading-tight max-w-[60px] ${done ? 'text-[#1a7f4b]' : current ? 'text-[#1d4ed8]' : 'text-[#9b9b93]'}`}>
                          {step.label}
                        </span>
                      </div>
                      {i < TIMELINE_STEPS.length - 1 && (
                        <div className={`flex-1 h-0.5 mx-1 mb-4 rounded-full ${stepIndex > i ? 'bg-[#1a7f4b]' : 'bg-[#e8e8e4]'}`} />
                      )}
                    </div>
                  )
                })}
              </div>

              {/* ── Tour block ── */}
              {selected.tour_name && (
                <div className={`rounded-[14px] p-4 ${selected.sav_status === 'in_progress' ? 'bg-[#f0f4ff]' : 'bg-[#faf5ff]'}`}>
                  <div className="flex items-start justify-between gap-2 mb-2">
                    <div>
                      <p className="text-sm font-bold text-[#1a1a2e]">{selected.tour_name}</p>
                      {selected.tour_zone && (
                        <p className="text-xs text-[#6b6b63]">{selected.tour_zone}</p>
                      )}
                    </div>
                    {driverPhone && (
                      <div className="text-right">
                        <p className="text-[10px] text-[#9b9b93]">SAV uniquement</p>
                        <p className="text-xs font-semibold text-[#1a1a2e]">📞 {driverPhone}</p>
                      </div>
                    )}
                  </div>
                  {range && (
                    <p className="text-sm font-medium text-[#1a1a2e]">
                      {range.start} → {range.end}
                    </p>
                  )}
                  {selected.driver_name && (
                    <p className="text-xs text-[#6b6b63] mt-1">Livreur · <span className="font-medium text-[#1a1a2e]">{selected.driver_name}</span></p>
                  )}
                </div>
              )}

              {/* ── Driver progress ── */}
              {(selected.sav_status === 'planned' || selected.sav_status === 'in_progress') && selected.tour_total_stops > 0 && (() => {
                if (selected.sav_status === 'planned') {
                  return (
                    <div className="rounded-[14px] bg-[#faf5ff] border border-[#e9d5ff] p-4 space-y-1.5">
                      {range && (
                        <p className="text-sm font-semibold text-[#1a1a2e]">
                          Livraison prévue entre le {range.start} et le {range.end}
                        </p>
                      )}
                      {selected.stops_before > 0 && (
                        <p className="text-xs text-[#6b6b63]">
                          {selected.stops_before} livraison{selected.stops_before > 1 ? 's' : ''} prévues avant la sienne
                        </p>
                      )}
                      {remainingCities.length > 0 && (
                        <p className="text-xs text-[#6b6b63]">Villes : <span className="text-[#1a1a2e]">{remainingCities.join(', ')}</span></p>
                      )}
                    </div>
                  )
                }
                // in_progress — always show progress bar (even at 0 delivered)
                return (
                  <div className="rounded-[14px] bg-[#f0f4ff] p-4 space-y-3">
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-bold text-[#1a1a2e]">
                        {selected.driver_name ?? 'Livreur'} · {selected.tour_delivered_stops} arrêt{selected.tour_delivered_stops !== 1 ? 's' : ''} livré{selected.tour_delivered_stops !== 1 ? 's' : ''} sur {selected.tour_total_stops}
                      </span>
                      <span className="text-lg font-extrabold text-[#1d4ed8]">{pct}%</span>
                    </div>
                    <div className="h-3 rounded-full bg-[#dbeafe] overflow-hidden">
                      <div
                        className="h-full rounded-full bg-[#1d4ed8] transition-all duration-500"
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                    {deliveredCities.length > 0 && (
                      <div className="text-xs">
                        <span className="text-[#1a7f4b] font-medium">✓ Déjà livrés : </span>
                        <span className="text-[#6b6b63]">{deliveredCities.join(', ')}</span>
                      </div>
                    )}
                    {remainingCities.length > 0 && (
                      <div className="text-xs">
                        <span className="text-[#1d4ed8] font-medium">→ Restant : </span>
                        <span className="text-[#6b6b63]">{remainingCities.join(', ')}</span>
                      </div>
                    )}
                  </div>
                )
              })()}

              {/* ── Products ── */}
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-[#9b9b93] mb-2">Produits commandés</p>
                {selected.panel_details.length > 0 ? (
                  <div className="rounded-[12px] border border-[#f0f0ee] overflow-hidden">
                    {selected.panel_details.map((p, i) => (
                      <div key={i} className={`flex items-center justify-between px-3 py-2 text-xs ${i > 0 ? 'border-t border-[#f5f5f3]' : ''}`}>
                        <div className="min-w-0">
                          <span className="font-mono text-[#9b9b93] mr-2">{p.sku || '—'}</span>
                          <span className="text-[#1a1a2e] truncate">{p.title}</span>
                        </div>
                        <span className="font-semibold text-[#1a1a2e] ml-4 flex-shrink-0">×{p.qty}</span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-xs text-[#9b9b93]">—</p>
                )}
              </div>

              {/* ── Address ── */}
              <div className="flex items-start gap-2">
                <MapPin size={13} className="text-[#9b9b93] mt-0.5 flex-shrink-0" />
                <div>
                  <p className="text-xs text-[#1a1a2e]">{selected.address1}</p>
                  <p className="text-xs text-[#6b6b63]">{selected.zip} {selected.city}</p>
                </div>
              </div>

              {/* ── Email (collapsible) ── */}
              <div className="border-t border-[#f0f0ee] pt-3">
                <button
                  onClick={() => setEmailOpen(v => !v)}
                  className="w-full flex items-center justify-between text-xs font-semibold text-[#1a1a2e] hover:text-[#6d28d9] transition-colors"
                >
                  <span>✉️ Envoyer un email au client</span>
                  <span className="text-[#9b9b93]">{emailOpen ? '▲' : '▼'}</span>
                </button>
                {emailOpen && (
                  <div className="mt-3 space-y-2">
                    <pre className="whitespace-pre-wrap text-xs text-[#1a1a2e] bg-[#fafaf8] border border-[#f0f0ee] rounded-[10px] p-3 leading-relaxed font-sans">
                      {emailText}
                    </pre>
                    <button
                      onClick={handleCopy}
                      className={`w-full py-2 rounded-[10px] text-xs font-semibold transition-all ${
                        copied ? 'bg-[#d1fae5] text-[#1a7f4b]' : 'bg-[#1a1a2e] text-white hover:bg-[#2d2d4a]'
                      }`}
                    >
                      {copied ? 'Copié !' : 'Copier l\'email'}
                    </button>
                  </div>
                )}
              </div>

            </div>
          </div>
        )
      })()}
    </div>
    </div>
  )
}
