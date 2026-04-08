'use client'

export const dynamic = 'force-dynamic'

import { useState, useEffect, useCallback } from 'react'
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
  'nord-est':   { bg: '#dbeafe', text: '#1d4ed8' },
  'nord-ouest': { bg: '#dcfce7', text: '#15803d' },
  'sud-est':    { bg: '#ffedd5', text: '#c2410c' },
  'sud-ouest':  { bg: '#fee2e2', text: '#b91c1c' },
}

interface PanelItem { sku: string; title: string; qty: number }

interface ShopifyOrder {
  order_name: string
  shopify_order_id: string
  customer_name: string
  email: string
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


function getWeekNumber(dateStr: string): number {
  const d = new Date(dateStr + 'T00:00:00')
  const startOfYear = new Date(d.getFullYear(), 0, 1)
  const diff = d.getTime() - startOfYear.getTime()
  return Math.ceil((diff / 86400000 + startOfYear.getDay() + 1) / 7)
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
  const [expandedOrder, setExpandedOrder] = useState<Set<string>>(new Set())
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

  const filteredOrders = shopifyOrders.filter((o) => {
    if (zoneFilter !== 'all' && o.zone !== zoneFilter) return false
    if (search) {
      const q = search.toLowerCase()
      if (!o.order_name.toLowerCase().includes(q) && !o.city.toLowerCase().includes(q)) return false
    }
    return true
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

  function toggleOrderExpand(orderName: string) {
    setExpandedOrder((prev) => {
      const next = new Set(prev)
      if (next.has(orderName)) next.delete(orderName)
      else next.add(orderName)
      return next
    })
  }

  return (
    <div className="relative pb-24">
      <div className="grid grid-cols-2 gap-5">
        {/* Left: Orders */}
        <div>
          <div className="rounded-[20px] shadow-[0_2px_16px_rgba(0,0,0,0.06)] bg-white p-5">
            <h2 className="text-base font-semibold text-[#1a1a2e] mb-4">
              Commandes à planifier
              {!loadingOrders && (
                <span className="ml-2 text-sm font-normal text-[#6b6b63]">({filteredOrders.length})</span>
              )}
            </h2>

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
              ) : (
                filteredOrders.map((order) => {
                  const selected = selectedOrders.has(order.order_name)
                  const orderExpanded = expandedOrder.has(order.order_name)
                  return (
                    <div
                      key={order.order_name}
                      className={`rounded-[12px] border transition-all overflow-hidden ${
                        selected
                          ? 'border-2 border-[#aeb0c9] bg-[#f0f0fa]'
                          : 'border border-[#e8e8e4]'
                      }`}
                    >
                      <div
                        className="p-3 flex items-start justify-between gap-2 cursor-pointer"
                        onClick={() => toggleOrder(order.order_name)}
                      >
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
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
                          </div>
                          <div className="text-xs text-[#6b6b63] mt-0.5">{order.customer_name}</div>
                          <div className="text-xs text-[#6b6b63]">{order.city} {order.zip}</div>
                        </div>
                        <div className="flex items-center gap-1.5 shrink-0 mt-0.5">
                          <button
                            onClick={(e) => { e.stopPropagation(); toggleOrderExpand(order.order_name) }}
                            className="p-0.5 rounded text-[#6b6b63] hover:text-[#1a1a2e]"
                          >
                            {orderExpanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                          </button>
                          <input
                            type="checkbox"
                            readOnly
                            checked={selected}
                            className="accent-[#aeb0c9] cursor-pointer"
                          />
                        </div>
                      </div>
                      {orderExpanded && order.panel_details?.length > 0 && (
                        <div className="border-t border-[#e8e8e4] bg-white px-3 py-2 space-y-1.5">
                          {order.panel_details.map((item, i) => (
                            <div key={i} className="flex items-start gap-2 text-xs">
                              <span className="shrink-0 font-mono text-[#6b6b63] bg-[#f5f5f3] px-1.5 py-0.5 rounded text-[10px]">{item.sku || '—'}</span>
                              <span className="flex-1 text-[#1a1a2e]">{item.title}</span>
                              <span className="shrink-0 font-semibold text-[#1a1a2e]">×{item.qty}</span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )
                })
              )}
            </div>
          </div>
        </div>

        {/* Right: Tours */}
        <div>
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

interface FlatStop extends TourStop {
  tour_name: string
  tour_status: TourStatus
  tour_planned_date: string
}

function SavView() {
  const [search, setSearch] = useState('')
  const [allStops, setAllStops] = useState<FlatStop[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function load() {
      setLoading(true)
      try {
        const r = await fetch('/api/delivery/tours')
        const data = await r.json()
        const flat: FlatStop[] = []
        for (const tour of data.tours ?? []) {
          for (const stop of tour.stops ?? []) {
            flat.push({
              ...stop,
              tour_name: tour.name,
              tour_status: tour.status,
              tour_planned_date: tour.planned_date,
            })
          }
        }
        setAllStops(flat)
      } catch (e) {
        console.error(e)
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [])

  const filtered = allStops.filter((s) => {
    if (!search) return true
    const q = search.toLowerCase()
    return (
      s.order_name.toLowerCase().includes(q) ||
      (s.customer_name ?? '').toLowerCase().includes(q)
    )
  })

  function getStatusBadge(stop: FlatStop) {
    if (stop.status === 'delivered') {
      return { label: 'Livrée', color: 'bg-[#d1fae5] text-[#1a7f4b]' }
    }
    if (stop.tour_status === 'in_progress') {
      return { label: 'En cours de livraison', color: 'bg-blue-100 text-blue-700' }
    }
    if (stop.tour_status === 'planned' || stop.tour_status === 'draft') {
      const week = stop.tour_planned_date ? getWeekNumber(stop.tour_planned_date) : '?'
      return { label: `Planifiée sem. ${week}`, color: 'bg-purple-100 text-purple-700' }
    }
    return { label: 'En attente de planification', color: 'bg-gray-100 text-gray-500' }
  }

  return (
    <div className="rounded-[20px] shadow-[0_2px_16px_rgba(0,0,0,0.06)] bg-white p-5">
      <h2 className="text-base font-semibold text-[#1a1a2e] mb-4">SAV — Suivi livraisons</h2>

      <input
        type="text"
        placeholder="Rechercher (commande, client...)"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        className="w-full max-w-sm px-3 py-2 text-sm border border-[#e8e8e4] rounded-[10px] mb-4 outline-none focus:border-[#aeb0c9]"
      />

      {loading ? (
        <div className="text-center py-8 text-sm text-[#6b6b63]">Chargement...</div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-8 text-sm text-[#6b6b63]">Aucun résultat</div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-[#6b6b63] border-b border-[#e8e8e4]">
                <th className="pb-3 font-medium pr-4">Commande</th>
                <th className="pb-3 font-medium pr-4">Client</th>
                <th className="pb-3 font-medium pr-4">Ville</th>
                <th className="pb-3 font-medium pr-4">Statut</th>
                <th className="pb-3 font-medium pr-4">Tournée</th>
                <th className="pb-3 font-medium">Date planifiée</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((stop) => {
                const badge = getStatusBadge(stop)
                return (
                  <tr key={stop.id} className="border-b border-[#f5f5f3] last:border-0 hover:bg-[#f9f9f7]">
                    <td className="py-3 pr-4 font-medium text-[#1a1a2e]">{stop.order_name}</td>
                    <td className="py-3 pr-4 text-[#6b6b63]">{stop.customer_name}</td>
                    <td className="py-3 pr-4 text-[#6b6b63]">{stop.city}</td>
                    <td className="py-3 pr-4">
                      <span className={`px-2.5 py-1 rounded-full text-xs font-medium whitespace-nowrap ${badge.color}`}>
                        {badge.label}
                      </span>
                    </td>
                    <td className="py-3 pr-4 text-[#6b6b63]">{stop.tour_name}</td>
                    <td className="py-3 text-[#6b6b63]">
                      {stop.tour_planned_date ? formatDate(stop.tour_planned_date) : '—'}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
