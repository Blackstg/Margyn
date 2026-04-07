'use client'

export const dynamic = 'force-dynamic'

import { useState, useEffect, useCallback } from 'react'
import { ChevronDown, ChevronUp, Trash2, Mail, Plus, X, MapPin, Package, Truck } from 'lucide-react'

// ─── Types ────────────────────────────────────────────────────────────────────

type Zone = 'nord-est' | 'nord-ouest' | 'sud-est' | 'sud-ouest'
type TourStatus = 'draft' | 'planned' | 'in_progress' | 'completed'
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

function todayString(): string {
  const d = new Date()
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
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
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function DeliveryPage() {
  const [activeTab, setActiveTab] = useState<'planificateur' | 'livreur' | 'sav'>('planificateur')

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
  const [sendingEmails, setSendingEmails] = useState<string | null>(null)

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
      await fetch('/api/delivery/tours', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newTourForm),
      })
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

  async function handleSendEmails(tourId: string) {
    setSendingEmails(tourId)
    try {
      const r = await fetch(`/api/delivery/tours/${tourId}/emails`, { method: 'POST' })
      const data = await r.json()
      alert(`Emails envoyés: ${data.sent}, Erreurs: ${data.errors}`)
      await fetchTours()
    } finally {
      setSendingEmails(null)
    }
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
                  return (
                    <div
                      key={order.order_name}
                      onClick={() => toggleOrder(order.order_name)}
                      className={`relative p-3 rounded-[12px] border cursor-pointer transition-all ${
                        selected
                          ? 'border-2 border-[#aeb0c9] bg-[#f0f0fa]'
                          : 'border border-[#e8e8e4] hover:border-[#aeb0c9]/50'
                      }`}
                    >
                      <div className="flex items-start justify-between gap-2">
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
                        <input
                          type="checkbox"
                          readOnly
                          checked={selected}
                          className="mt-1 accent-[#aeb0c9] cursor-pointer"
                        />
                      </div>
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
                  const pendingEmails = tour.stops.filter((s) => !s.email_sent_at && s.email).length
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
                            {pendingEmails > 0 && (
                              <button
                                onClick={(e) => { e.stopPropagation(); handleSendEmails(tour.id) }}
                                disabled={sendingEmails === tour.id}
                                className="flex items-center gap-1 px-3 py-1 text-xs rounded-[8px] bg-[#1a1a2e] text-white disabled:opacity-50"
                              >
                                <Mail size={12} />
                                {sendingEmails === tour.id ? 'Envoi...' : `Emails (${pendingEmails})`}
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
                                  className="flex items-center gap-2 p-2 rounded-[8px] bg-[#f5f5f3] text-xs"
                                >
                                  <span className="w-5 h-5 rounded-full bg-[#1a1a2e] text-white flex items-center justify-center text-[10px] font-bold shrink-0">
                                    {idx + 1}
                                  </span>
                                  <div className="flex-1 min-w-0">
                                    <div className="font-medium text-[#1a1a2e]">{stop.order_name}</div>
                                    <div className="text-[#6b6b63] truncate">{stop.customer_name} · {stop.city}</div>
                                  </div>
                                  {stop.email_sent_at && (
                                    <Mail size={12} className="text-[#1a7f4b] shrink-0" />
                                  )}
                                  <div className="flex items-center gap-1 shrink-0">
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
                              ))}
                            </div>
                          )}
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

function LivreurView() {
  const [selectedDate, setSelectedDate] = useState(todayString())
  const [tours, setTours] = useState<Tour[]>([])
  const [selectedTourId, setSelectedTourId] = useState('')
  const [loadingList, setLoadingList] = useState(true)

  const fetchTours = useCallback(async () => {
    setLoadingList(true)
    try {
      const r = await fetch('/api/delivery/tours')
      const data = await r.json()
      const filtered = (data.tours ?? []).filter(
        (t: Tour) => t.planned_date === selectedDate
      )
      setTours(filtered)
      if (filtered.length > 0 && !filtered.find((t: Tour) => t.id === selectedTourId)) {
        setSelectedTourId(filtered[0].id)
      }
    } catch (e) {
      console.error(e)
    } finally {
      setLoadingList(false)
    }
  }, [selectedDate, selectedTourId])

  useEffect(() => {
    fetchTours()
  }, [fetchTours])

  const tour = tours.find((t) => t.id === selectedTourId)
  const sortedStops = tour ? [...tour.stops].sort((a, b) => a.sequence - b.sequence) : []

  // Aggregate panel_details by SKU for truck loading list
  const loadingAgg: Record<string, { title: string; qty: number }> = {}
  if (tour) {
    for (const stop of tour.stops) {
      for (const item of stop.panel_details) {
        if (!loadingAgg[item.sku]) {
          loadingAgg[item.sku] = { title: item.title, qty: 0 }
        }
        loadingAgg[item.sku].qty += item.qty
      }
    }
  }

  async function handleMarkDelivered(stopId: string) {
    await fetch(`/api/delivery/stops/${stopId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'delivered' }),
    })
    await fetchTours()
  }

  const mapsUrl = sortedStops.length > 0
    ? `https://www.google.com/maps/dir/${sortedStops
        .map((s) => encodeURIComponent(`${s.address1} ${s.city} ${s.zip}`))
        .join('/')}`
    : ''

  return (
    <div className="max-w-2xl mx-auto space-y-4">
      {/* Date picker */}
      <div className="rounded-[20px] shadow-[0_2px_16px_rgba(0,0,0,0.06)] bg-white p-5">
        <div className="flex items-center gap-4">
          <label className="text-sm font-medium text-[#1a1a2e]">Date :</label>
          <input
            type="date"
            value={selectedDate}
            onChange={(e) => {
              setSelectedDate(e.target.value)
              setSelectedTourId('')
            }}
            className="px-3 py-2 text-sm border border-[#e8e8e4] rounded-[10px] outline-none focus:border-[#aeb0c9]"
          />
        </div>
      </div>

      {loadingList ? (
        <div className="text-center py-8 text-sm text-[#6b6b63]">Chargement...</div>
      ) : tours.length === 0 ? (
        <div className="rounded-[20px] shadow-[0_2px_16px_rgba(0,0,0,0.06)] bg-white p-8 text-center text-sm text-[#6b6b63]">
          Aucune tournée pour cette date
        </div>
      ) : (
        <>
          {/* Tour selector if multiple */}
          {tours.length > 1 && (
            <div className="flex gap-2">
              {tours.map((t) => (
                <button
                  key={t.id}
                  onClick={() => setSelectedTourId(t.id)}
                  className={`px-4 py-2 rounded-[12px] text-sm font-medium transition-all ${
                    selectedTourId === t.id
                      ? 'bg-[#1a1a2e] text-white'
                      : 'bg-white text-[#6b6b63] shadow-[0_2px_8px_rgba(0,0,0,0.06)]'
                  }`}
                >
                  {t.name}
                </button>
              ))}
            </div>
          )}

          {tour && (
            <>
              {/* Tour info + Maps button */}
              <div className="rounded-[20px] shadow-[0_2px_16px_rgba(0,0,0,0.06)] bg-white p-5 flex items-center justify-between">
                <div>
                  <div className="font-semibold text-[#1a1a2e]">{tour.name}</div>
                  <div className="text-sm text-[#6b6b63]">
                    {tour.driver_name && <span>{tour.driver_name} · </span>}
                    {tour.total_panels} panneau{tour.total_panels !== 1 ? 'x' : ''}
                    {' · '}{sortedStops.length} arrêt{sortedStops.length !== 1 ? 's' : ''}
                  </div>
                </div>
                {mapsUrl && (
                  <a
                    href={mapsUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-2 px-4 py-2 rounded-[12px] bg-[#1a7f4b] text-white text-sm font-medium"
                  >
                    <MapPin size={16} />
                    Google Maps
                  </a>
                )}
              </div>

              {/* Loading list */}
              <div className="rounded-[20px] shadow-[0_2px_16px_rgba(0,0,0,0.06)] bg-white p-5">
                <div className="flex items-center gap-2 mb-4">
                  <Package size={18} color="#1a1a2e" strokeWidth={1.8} />
                  <h3 className="font-semibold text-[#1a1a2e]">Chargement camion</h3>
                </div>
                {Object.keys(loadingAgg).length === 0 ? (
                  <div className="text-sm text-[#6b6b63]">Aucun article</div>
                ) : (
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-left text-xs text-[#6b6b63] border-b border-[#e8e8e4]">
                        <th className="pb-2 font-medium">Réf</th>
                        <th className="pb-2 font-medium">Produit</th>
                        <th className="pb-2 font-medium text-right">Quantité totale</th>
                      </tr>
                    </thead>
                    <tbody>
                      {Object.entries(loadingAgg).map(([sku, item]) => (
                        <tr key={sku} className="border-b border-[#f5f5f3] last:border-0">
                          <td className="py-2 font-mono text-xs text-[#6b6b63]">{sku || '—'}</td>
                          <td className="py-2 font-medium text-[#1a1a2e]">{item.title}</td>
                          <td className="py-2 text-right font-bold text-[#1a1a2e] text-base">{item.qty}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>

              {/* Stops */}
              <div className="rounded-[20px] shadow-[0_2px_16px_rgba(0,0,0,0.06)] bg-white p-5">
                <h3 className="font-semibold text-[#1a1a2e] mb-4">Arrêts</h3>
                <div className="space-y-3">
                  {sortedStops.map((stop, idx) => (
                    <div
                      key={stop.id}
                      className={`flex items-center gap-3 p-3 rounded-[12px] border ${
                        stop.status === 'delivered'
                          ? 'border-[#d1fae5] bg-[#f0fdf4]'
                          : 'border-[#e8e8e4] bg-white'
                      }`}
                    >
                      <span className="w-8 h-8 rounded-full bg-[#1a1a2e] text-white flex items-center justify-center text-sm font-bold shrink-0">
                        {idx + 1}
                      </span>
                      <div className="flex-1 min-w-0">
                        <div className="font-semibold text-[#1a1a2e] text-sm">{stop.customer_name}</div>
                        <div className="text-xs text-[#6b6b63]">{stop.address1}, {stop.city} {stop.zip}</div>
                        <div className="text-xs text-[#6b6b63]">
                          {stop.panel_count} panneau{stop.panel_count !== 1 ? 'x' : ''}
                        </div>
                      </div>
                      <div className="shrink-0">
                        {stop.status === 'delivered' ? (
                          <div className="text-right">
                            <span className="px-3 py-1.5 rounded-[8px] bg-[#d1fae5] text-[#1a7f4b] text-xs font-medium">
                              Livré ✓
                            </span>
                            {stop.delivered_at && (
                              <div className="text-[10px] text-[#6b6b63] mt-1">
                                {new Date(stop.delivered_at).toLocaleTimeString('fr-FR', {
                                  hour: '2-digit',
                                  minute: '2-digit',
                                })}
                              </div>
                            )}
                          </div>
                        ) : (
                          <button
                            onClick={() => handleMarkDelivered(stop.id)}
                            className="px-3 py-1.5 rounded-[8px] bg-[#1a7f4b] text-white text-xs font-medium"
                          >
                            Livré ✓
                          </button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </>
          )}
        </>
      )}
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
