'use client'

export const dynamic = 'force-dynamic'

import { useState, useEffect, useCallback, useRef, Suspense } from 'react'
import nextDynamic from 'next/dynamic'
import { useRouter, useSearchParams } from 'next/navigation'
import { createBrowserClient } from '@supabase/auth-helpers-nextjs'
import { ChevronDown, ChevronUp, ChevronLeft, ChevronRight, Trash2, Mail, Plus, X, MapPin, Package, Truck, Map as MapIcon, Search, Pencil, Check, MessageSquare, GripVertical, Printer } from 'lucide-react'
import {
  DndContext, DragEndEvent, DragOverlay, DragStartEvent,
  PointerSensor, TouchSensor, closestCenter, useSensor, useSensors,
} from '@dnd-kit/core'
import {
  SortableContext, arrayMove, useSortable, verticalListSortingStrategy,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'

const TourMap        = nextDynamic(() => import('@/components/delivery/TourMap'),        { ssr: false })
const OrdersMap      = nextDynamic(() => import('@/components/delivery/OrdersMap'),      { ssr: false })
const SavPositionMap = nextDynamic(() => import('@/components/delivery/SavPositionMap'), { ssr: false })

// ─── Types ────────────────────────────────────────────────────────────────────

type Zone = 'nord-est' | 'nord-ouest' | 'sud-est' | 'sud-ouest'
type TourStatus = 'draft' | 'planned' | 'in_progress' | 'completed' | 'cancelled'
type StopStatus = 'pending' | 'delivered' | 'failed'

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

interface PanelItem { sku: string; variant_title?: string; title: string; qty: number }

interface ShopifyOrder {
  order_name: string
  shopify_order_id: string
  customer_name: string
  email: string
  created_at: string | null
  is_preorder: boolean
  preorder_ready?: boolean
  is_b2b?: boolean
  is_leroy?: boolean
  needs_replan?: boolean
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
  shopify_order_id?: string
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
  comment?: string | null
  comment_at?: string | null
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

type DeliveryView = 'planificateur' | 'livreur' | 'sav'
const ALL_VIEWS: DeliveryView[] = ['planificateur', 'livreur', 'sav']

function DeliveryPageInner() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [allowedViews, setAllowedViews] = useState<DeliveryView[] | null>(null)

  useEffect(() => {
    const supabase = createBrowserClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
    )
    supabase.auth.getUser().then(({ data }) => {
      const meta = data.user?.user_metadata
      const views = meta?.delivery_views as string[] | undefined
      setAllowedViews(
        views ? views.filter((v): v is DeliveryView => ALL_VIEWS.includes(v as DeliveryView)) : ALL_VIEWS
      )
    })
  }, [])

  const rawView = searchParams.get('view')
  const activeTab: DeliveryView =
    rawView === 'livreur' || rawView === 'sav' || rawView === 'planificateur'
      ? rawView
      : 'planificateur'

  // Redirect to first allowed tab if current tab is not permitted
  useEffect(() => {
    if (!allowedViews) return
    if (!allowedViews.includes(activeTab)) {
      router.replace(`/delivery?view=${allowedViews[0]}`)
    }
  }, [allowedViews, activeTab, router])

  function setActiveTab(tab: DeliveryView) {
    router.replace(`/delivery?view=${tab}`)
  }

  // Don't render until we know which views are allowed
  if (!allowedViews) return null

  const effectiveTab = allowedViews.includes(activeTab) ? activeTab : allowedViews[0]

  return (
    <div className="px-3 md:pl-[88px] py-4 md:p-6 bg-[#f5f5f3] min-h-screen">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 mb-4 md:mb-6">
        <div className="flex items-center gap-2.5">
          <Truck size={20} color="#1a1a2e" strokeWidth={1.8} />
          <h1 className="text-xl md:text-2xl font-bold text-[#1a1a2e]">Delivery</h1>
        </div>
        {allowedViews.length > 1 && (
          <div className="flex gap-1 bg-white rounded-[14px] p-1 shadow-[0_2px_8px_rgba(0,0,0,0.06)] w-full sm:w-auto">
            {allowedViews.map((tab) => (
              <button
                key={tab}
                onClick={() => setActiveTab(tab)}
                className={`flex-1 sm:flex-none px-3 md:px-4 py-2 rounded-[10px] text-sm font-medium transition-all text-center ${
                  effectiveTab === tab
                    ? 'bg-[#1a1a2e] text-white'
                    : 'text-[#6b6b63] hover:text-[#1a1a2e]'
                }`}
              >
                {tab === 'planificateur' ? 'Planificateur' : tab === 'livreur' ? 'Livreur' : 'SAV'}
              </button>
            ))}
          </div>
        )}
      </div>

      {effectiveTab === 'planificateur' && <PlanificateurView />}
      {effectiveTab === 'livreur' && <LivreurView />}
      {effectiveTab === 'sav' && <SavView />}
    </div>
  )
}

// ─── Planificateur View ───────────────────────────────────────────────────────

function PlanificateurView() {
  const [shopifyOrders, setShopifyOrders] = useState<ShopifyOrder[]>([])
  const [tours, setTours] = useState<Tour[]>([])
  const [selectedOrders, setSelectedOrders] = useState<Set<string>>(new Set())
  const [zoneFilter, setZoneFilter] = useState<'all' | Zone>('all')
  const [preorderFilter, setPreorderFilter] = useState(false)
  const [search, setSearch] = useState('')
  const [showNewTour, setShowNewTour] = useState(false)
  const [newTourForm, setNewTourForm] = useState({ name: '', zone: 'mixte', driver_name: '', planned_date: '' })
  const [loadingOrders, setLoadingOrders] = useState(true)
  const [loadingTours, setLoadingTours] = useState(true)
  const [targetTourId, setTargetTourId] = useState('')
  const [tourDropdownOpen, setTourDropdownOpen] = useState(false)
  const tourDropdownRef = useRef<HTMLDivElement>(null)
  const [expandedTours, setExpandedTours] = useState<Set<string>>(new Set())
  const [savingTour, setSavingTour] = useState(false)
  const [addingStops, setAddingStops] = useState(false)
  const [optimizingTourId, setOptimizingTourId] = useState<string | null>(null)
  const [tourSearch, setTourSearch] = useState('')
  const [renamingTourId, setRenamingTourId] = useState<string | null>(null)
  const [renameValue, setRenameValue] = useState('')
  const [showHistory, setShowHistory] = useState(false)
  const [ordersViewMode, setOrdersViewMode] = useState<'list' | 'map'>('list')

  // Notifier les clients modal
  type NotifStop = { id: string; customer_name: string; email: string; email_sent_at: string | null }
  const [notifModal, setNotifModal] = useState<{ tourId: string; tourName: string; plannedDate: string; stops: NotifStop[] } | null>(null)
  const [notifSending, setNotifSending] = useState(false)
  const [notifResult, setNotifResult] = useState<{ sent: number; errors: number } | null>(null)
  const [notifTab, setNotifTab] = useState<'destinataires' | 'apercu'>('destinataires')

  function formatTourDateFr(dateStr: string): string {
    if (!dateStr) return ''
    const d = new Date(dateStr + 'T00:00:00')
    return d.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
  }

  async function openNotifModal(tourId: string, tourName: string, plannedDate: string) {
    const r = await fetch(`/api/delivery/tours/${tourId}/emails`)
    const data = await r.json()
    setNotifResult(null)
    setNotifTab('destinataires')
    setNotifModal({ tourId, tourName, plannedDate, stops: data.stops ?? [] })
  }

  async function sendNotifEmails(force = false) {
    if (!notifModal) return
    setNotifSending(true)
    try {
      const r = await fetch(`/api/delivery/tours/${notifModal.tourId}/emails`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ force }),
      })
      const data = await r.json()
      setNotifResult(data)
      await fetchTours()
      // Refresh modal stops so badge updates
      const r2 = await fetch(`/api/delivery/tours/${notifModal.tourId}/emails`)
      const data2 = await r2.json()
      setNotifModal((prev) => prev ? { ...prev, stops: data2.stops ?? [] } : null)
    } finally {
      setNotifSending(false)
    }
  }

  const fetchOrders = useCallback(async () => {
    setLoadingOrders(true)
    try {
      const r = await fetch('/api/delivery/orders', { cache: 'no-store' })
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

  useEffect(() => {
    if (!tourDropdownOpen) return
    function handleClickOutside(e: MouseEvent) {
      if (tourDropdownRef.current && !tourDropdownRef.current.contains(e.target as Node)) {
        setTourDropdownOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [tourDropdownOpen])

  const filteredOrders = shopifyOrders
    .filter((o) => {
      if (zoneFilter !== 'all' && o.zone !== zoneFilter) return false
      if (preorderFilter && !o.is_preorder) return false
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

  // Panels per zone across all unfiltered orders (for the zone badges)
  const panelsByZone = (['nord-est', 'nord-ouest', 'sud-est', 'sud-ouest'] as Zone[]).reduce<Record<Zone, number>>(
    (acc, z) => {
      acc[z] = shopifyOrders.filter((o) => o.zone === z).reduce((sum, o) => sum + (o.panel_count ?? 0), 0)
      return acc
    },
    {} as Record<Zone, number>
  )

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
      const res = await fetch(`/api/delivery/tours/${targetTourId}/stops`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ stops }),
      })
      if (res.ok) {
        setShopifyOrders((prev) => prev.filter((o) => !selectedOrders.has(o.order_name)))
      }
      setSelectedOrders(new Set())
      await fetchTours()
    } finally {
      setAddingStops(false)
    }
  }

  async function handleDeleteStop(stopId: string) {
    // Find stop data before deleting so we can restore the order to the list
    const stop = tours.flatMap((t) => t.stops).find((s) => s.id === stopId)

    const res = await fetch(`/api/delivery/stops/${stopId}`, { method: 'DELETE' })
    if (!res.ok) return

    // Optimistic: immediately restore the order to "Commandes à planifier"
    if (stop) {
      setShopifyOrders((prev) => {
        if (prev.some((o) => o.order_name === stop.order_name)) return prev
        return [...prev, {
          order_name:       stop.order_name,
          shopify_order_id: stop.shopify_order_id ?? '',
          customer_name:    stop.customer_name,
          email:            stop.email,
          created_at:       null,
          is_preorder:      false,
          preorder_ready:   false,
          needs_replan:     false,
          address1:         stop.address1,
          city:             stop.city,
          zip:              stop.zip,
          zone:             stop.zone,
          panel_count:      stop.panel_count,
          panel_details:    stop.panel_details,
        }]
      })
    }

    await fetchTours()
    // Background sync to confirm server state (doesn't override optimistic if server is slow)
    fetchOrders()
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

  async function handleRenameTour(tourId: string) {
    const name = renameValue.trim()
    if (!name) { setRenamingTourId(null); return }
    await fetch(`/api/delivery/tours/${tourId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
    })
    setRenamingTourId(null)
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

  async function handleOptimizeRoute(tourId: string) {
    const tour = tours.find((t) => t.id === tourId)
    if (!tour || tour.stops.length < 2) return
    setOptimizingTourId(tourId)
    try {
      const token = process.env.NEXT_PUBLIC_MAPBOX_TOKEN ?? ''
      const stops = [...tour.stops].sort((a, b) => a.sequence - b.sequence)

      // 1. Geocode all stop addresses
      const coords: ([number, number] | null)[] = await Promise.all(
        stops.map((s) => geocodeForMap(`${s.address1}, ${s.city} ${s.zip}, France`, token))
      )

      // Filter out stops that failed geocoding
      const validIndices = stops.map((_, i) => i).filter((i) => coords[i] !== null)
      if (validIndices.length < 2) return

      let optimizedIndices: number[]

      if (validIndices.length <= 11) {
        // 2a. Mapbox Optimization API (TSP, depot + up to 11 waypoints = 12 total)
        const depotCoord = DEPOT_COORDS
        const waypointCoords = validIndices.map((i) => coords[i] as [number, number])
        const coordStr = [depotCoord, ...waypointCoords, depotCoord]
          .map(([lng, lat]) => `${lng},${lat}`)
          .join(';')

        const optRes = await fetch(
          `https://api.mapbox.com/optimized-trips/v1/mapbox/driving/${coordStr}?roundtrip=true&source=first&destination=last&access_token=${token}`
        )
        if (optRes.ok) {
          const optData = await optRes.json()
          // Mapbox response: waypoints[] is parallel to input coords (depot, stop0, stop1..., depot)
          // Each entry has waypoint_index = position in the optimized trip (0 = first visit)
          const allWps: { waypoint_index: number }[] = optData.waypoints ?? []
          // Skip depot (index 0 and last) — take only the stop waypoints
          const stopWps = allWps.slice(1, validIndices.length + 1)
          // Sort by waypoint_index to get optimized visit order; inputPos maps to validIndices[inputPos]
          const sorted = stopWps
            .map((wp, inputPos) => ({ inputPos, tripPos: wp.waypoint_index }))
            .sort((a, b) => a.tripPos - b.tripPos)
          optimizedIndices = sorted.map((x) => validIndices[x.inputPos])
        } else {
          // Fallback to nearest-neighbor
          optimizedIndices = nearestNeighborTSP(DEPOT_COORDS, validIndices, coords as ([number, number] | null)[])
        }
      } else {
        // 2b. Nearest-neighbor heuristic for >11 stops
        optimizedIndices = nearestNeighborTSP(DEPOT_COORDS, validIndices, coords as ([number, number] | null)[])
      }

      // 3. Assign new sequences to all stops (keep non-geocoded stops at end in original order)
      const nonValidIndices = stops.map((_, i) => i).filter((i) => coords[i] === null)
      const finalOrder = [...optimizedIndices, ...nonValidIndices]

      await Promise.all(
        finalOrder.map((stopIdx, newSeq) =>
          fetch(`/api/delivery/stops/${stops[stopIdx].id}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ sequence: newSeq + 1 }),
          })
        )
      )

      await fetchTours()
    } catch (e) {
      console.error('Route optimization failed', e)
    } finally {
      setOptimizingTourId(null)
    }
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
    // Group by SKU first, fall back to title+variant_title if no SKU
    const map = new Map<string, { ref: string; title: string; variant_title: string; qty: number; orders: string[] }>()
    for (const stop of stops) {
      for (const item of stop.panel_details ?? []) {
        const ref = item.sku?.trim() || ''
        const vt  = item.variant_title?.trim() || ''
        const key = ref || (item.title + '::' + vt)
        const existing = map.get(key)
        if (existing) {
          existing.qty += item.qty
          if (!existing.orders.includes(stop.order_name)) existing.orders.push(stop.order_name)
        } else {
          map.set(key, { ref, title: item.title, variant_title: vt, qty: item.qty, orders: [stop.order_name] })
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
    <>
    <div className="relative pb-24">
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 lg:gap-5">
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
              <div className="flex items-center gap-2">
                {targetTourId && ordersViewMode === 'list' && (
                  <button
                    onClick={handleAutoSuggest}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-[10px] bg-[#f0f0fa] text-[#4338ca] text-xs font-medium hover:bg-[#e0e0fa] transition-colors"
                  >
                    ✨ Suggestion
                  </button>
                )}
                <button
                  onClick={() => setOrdersViewMode(m => m === 'list' ? 'map' : 'list')}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-[10px] text-xs font-medium transition-colors ${
                    ordersViewMode === 'map'
                      ? 'bg-[#1a1a2e] text-white'
                      : 'bg-[#f5f5f3] text-[#6b6b63] hover:bg-[#e8e8e4]'
                  }`}
                >
                  <MapPin size={12} />
                  {ordersViewMode === 'map' ? 'Liste' : 'Carte'}
                </button>
              </div>
            </div>

            {/* Zone + preorder filters */}
            <div className="flex flex-wrap gap-1.5 mb-3">
              {(['all', 'nord-est', 'nord-ouest', 'sud-est', 'sud-ouest'] as const).map((z) => {
                const count = z !== 'all' ? (panelsByZone[z] ?? 0) : null
                const color = z !== 'all' ? ZONE_COLOR[z] : null
                return (
                  <button
                    key={z}
                    onClick={() => setZoneFilter(z)}
                    className={`flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium transition-all ${
                      zoneFilter === z
                        ? 'bg-[#1a1a2e] text-white'
                        : 'bg-[#f5f5f3] text-[#6b6b63] hover:bg-[#e8e8e4]'
                    }`}
                  >
                    {z === 'all' ? 'Toutes' : ZONE_LABEL[z]}
                    {count !== null && count > 0 && (
                      <span
                        className="inline-flex items-center justify-center rounded-full text-white font-bold leading-none"
                        style={{
                          background: zoneFilter === z ? 'rgba(255,255,255,0.25)' : color!.text,
                          minWidth: '16px',
                          height: '16px',
                          fontSize: '10px',
                          padding: '0 4px',
                        }}
                      >
                        {count}
                      </span>
                    )}
                  </button>
                )
              })}
              <button
                onClick={() => setPreorderFilter((v) => !v)}
                className={`px-3 py-1 rounded-full text-xs font-medium transition-all ${
                  preorderFilter
                    ? 'bg-[#fef9c3] text-[#92400e] ring-1 ring-[#fbbf24]'
                    : 'bg-[#f5f5f3] text-[#6b6b63] hover:bg-[#e8e8e4]'
                }`}
              >
                Précommandes
              </button>
            </div>

            {/* Search */}
            <input
              type="text"
              placeholder="Rechercher (commande, ville...)"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full px-3 py-2 text-sm border border-[#e8e8e4] rounded-[10px] mb-3 outline-none focus:border-[#aeb0c9] transition-colors"
            />

            {/* Orders — liste ou carte */}
            {ordersViewMode === 'map' ? (
              <OrdersMap
                orders={filteredOrders.map(o => ({
                  order_name: o.order_name,
                  customer_name: o.customer_name,
                  address1: o.address1,
                  city: o.city,
                  zip: o.zip,
                  zone: o.zone as 'nord-est' | 'nord-ouest' | 'sud-est' | 'sud-ouest',
                  panel_count: o.panel_count,
                }))}
                selectedOrders={selectedOrders}
                onToggle={toggleOrder}
                height={420}
              />
            ) : (
            <div className="space-y-2 max-h-80 lg:max-h-[calc(100vh-320px)] overflow-y-auto pr-1">
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
                              {order.is_b2b && (
                                <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-[#dbeafe] text-[#1d4ed8]">
                                  B2B
                                </span>
                              )}
                              {order.is_leroy && (
                                <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-[#dcfce7] text-[#15803d]">
                                  Leroy
                                </span>
                              )}
                              {order.needs_replan && (
                                <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-[#fee2e2] text-[#b91c1c] font-semibold">
                                  ⚠ À replanifier
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
                            <div className="text-xs text-[#6b6b63] mt-0.5">{order.customer_name} · {order.city} {order.zip}</div>
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
            )}
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
                      background: t.total_panels >= 80 ? '#1a7f4b' : t.total_panels >= 50 ? '#d97706' : '#c7293a',
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
                  <span className={t.total_panels + selectedPanels < 50 ? 'text-[#c7293a] font-semibold' : t.total_panels + selectedPanels >= 80 ? 'text-[#1a7f4b] font-semibold' : ''}>
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
            <div className="flex items-center justify-between mb-4 gap-2 flex-wrap">
              <h2 className="text-base font-semibold text-[#1a1a2e]">
                {showHistory ? 'Historique' : 'Tournées'}
                {!loadingTours && (() => {
                  const activeTours = tours.filter(t => t.status !== 'completed' && t.status !== 'cancelled')
                  const historyTours = tours.filter(t => t.status === 'completed' || t.status === 'cancelled')
                  const count = showHistory ? historyTours.length : activeTours.length
                  return <span className="ml-2 text-sm font-normal text-[#6b6b63]">({count})</span>
                })()}
              </h2>
              <div className="flex items-center gap-1.5">
                <button
                  onClick={() => setShowHistory(v => !v)}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-[10px] text-xs font-medium transition-colors ${
                    showHistory
                      ? 'bg-[#1a1a2e] text-white'
                      : 'bg-[#f5f5f3] text-[#6b6b63] hover:bg-[#e8e8e4]'
                  }`}
                >
                  Historique
                </button>
                {!showHistory && (
                  <button
                    onClick={() => setShowNewTour(true)}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-[10px] bg-[#1a1a2e] text-white text-xs font-medium hover:bg-[#2a2a4e] transition-colors"
                  >
                    <Plus size={14} />
                    Nouvelle tournée
                  </button>
                )}
              </div>
            </div>

            {/* Tour search */}
            <div className="relative mb-3">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#6b6b63] pointer-events-none" />
              <input
                type="text"
                placeholder="Rechercher une commande, client, ville…"
                value={tourSearch}
                onChange={(e) => setTourSearch(e.target.value)}
                className="w-full pl-8 pr-3 py-2 text-sm border border-[#e8e8e4] rounded-[10px] outline-none focus:border-[#aeb0c9] bg-white"
              />
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
            {(() => {
              const activeTours  = tours.filter(t => t.status !== 'completed' && t.status !== 'cancelled')
              const historyTours = tours.filter(t => t.status === 'completed' || t.status === 'cancelled')
              const displayTours = showHistory ? historyTours : activeTours
              return (
            <div className="space-y-3 max-h-[calc(100vh-300px)] overflow-y-auto pr-1">
              {loadingTours ? (
                <div className="text-center py-8 text-sm text-[#6b6b63]">Chargement...</div>
              ) : displayTours.length === 0 ? (
                <div className="text-center py-8 text-sm text-[#6b6b63]">
                  {showHistory ? 'Aucune tournée dans l\'historique' : 'Aucune tournée en cours'}
                </div>
              ) : (
                displayTours.map((tour) => {
                  const isTarget = targetTourId === tour.id
                  const isExpanded = expandedTours.has(tour.id)
                  const sortedStops = [...tour.stops].sort((a, b) => a.sequence - b.sequence)
                  const q = tourSearch.trim().toLowerCase()
                  const filteredStops = q
                    ? sortedStops.filter((s) =>
                        s.order_name.toLowerCase().includes(q) ||
                        s.customer_name.toLowerCase().includes(q) ||
                        s.city.toLowerCase().includes(q) ||
                        (s.zip ?? '').includes(q)
                      )
                    : sortedStops

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
                              {renamingTourId === tour.id ? (
                                <>
                                  <input
                                    autoFocus
                                    value={renameValue}
                                    onChange={(e) => setRenameValue(e.target.value)}
                                    onKeyDown={(e) => {
                                      if (e.key === 'Enter') handleRenameTour(tour.id)
                                      if (e.key === 'Escape') setRenamingTourId(null)
                                    }}
                                    onClick={(e) => e.stopPropagation()}
                                    className="font-semibold text-sm text-[#1a1a2e] border-b border-[#aeb0c9] bg-transparent outline-none min-w-0 flex-1"
                                  />
                                  <button
                                    onClick={(e) => { e.stopPropagation(); handleRenameTour(tour.id) }}
                                    className="p-1 rounded-md bg-[#1a1a2e] text-white shrink-0"
                                  >
                                    <Check size={12} />
                                  </button>
                                  <button
                                    onClick={(e) => { e.stopPropagation(); setRenamingTourId(null) }}
                                    className="p-1 rounded-md text-[#6b6b63] hover:bg-[#f5f5f3] shrink-0"
                                  >
                                    <X size={12} />
                                  </button>
                                </>
                              ) : (
                                <>
                                  <span className="font-semibold text-sm text-[#1a1a2e]">{tour.name}</span>
                                  <button
                                    onClick={(e) => {
                                      e.stopPropagation()
                                      setRenamingTourId(tour.id)
                                      setRenameValue(tour.name)
                                    }}
                                    className="p-1 rounded-md text-[#6b6b63] hover:bg-[#f5f5f3] shrink-0 opacity-50 hover:opacity-100"
                                  >
                                    <Pencil size={12} />
                                  </button>
                                </>
                              )}
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
                                background: tour.total_panels >= 80 ? '#1a7f4b' : tour.total_panels >= 50 ? '#d97706' : '#c7293a',
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
                            {tour.stops.some((s) => s.email) && (() => {
                              const stopsWithEmail = tour.stops.filter((s) => s.email)
                              const allNotified = stopsWithEmail.length > 0 && stopsWithEmail.every((s) => s.email_sent_at)
                              const notifDate = allNotified
                                ? stopsWithEmail
                                    .map((s) => s.email_sent_at!)
                                    .sort()
                                    .at(0)!
                                : null
                              return allNotified ? (
                                <button
                                  onClick={(e) => { e.stopPropagation(); openNotifModal(tour.id, tour.name, tour.planned_date ?? '') }}
                                  className="flex items-center gap-1 px-3 py-1 text-xs rounded-[8px] bg-[#f0fdf4] text-[#1a7f4b] border border-[#bbf7d0] hover:bg-[#dcfce7] transition-colors"
                                >
                                  <Mail size={12} />
                                  Clients notifiés ✓ · {new Date(notifDate!).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' })}
                                </button>
                              ) : (
                                <button
                                  onClick={(e) => { e.stopPropagation(); openNotifModal(tour.id, tour.name, tour.planned_date ?? '') }}
                                  className="flex items-center gap-1 px-3 py-1 text-xs rounded-[8px] bg-[#1a1a2e] text-white hover:bg-[#2a2a4e] transition-colors"
                                >
                                  <Mail size={12} />
                                  Notifier les clients
                                </button>
                              )
                            })()}
                            {tour.stops.length >= 2 && (
                              <button
                                onClick={(e) => { e.stopPropagation(); handleOptimizeRoute(tour.id) }}
                                disabled={optimizingTourId === tour.id}
                                className="flex items-center gap-1 px-3 py-1 text-xs rounded-[8px] bg-[#eff6ff] text-[#1d4ed8] hover:bg-[#dbeafe] disabled:opacity-50"
                              >
                                {optimizingTourId === tour.id ? (
                                  <>
                                    <svg className="animate-spin h-3 w-3" viewBox="0 0 24 24" fill="none">
                                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
                                    </svg>
                                    Optimisation…
                                  </>
                                ) : (
                                  <>
                                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                      <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
                                    </svg>
                                    Optimiser le trajet
                                  </>
                                )}
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
                          ) : filteredStops.length === 0 ? (
                            <div className="text-xs text-[#6b6b63] text-center py-3">Aucun résultat</div>
                          ) : (
                            <div className="space-y-1.5">
                              {filteredStops.map((stop) => {
                                const realIdx = sortedStops.findIndex((s) => s.id === stop.id)
                                return (
                                <div
                                  key={stop.id}
                                  className="rounded-[8px] bg-[#f5f5f3] text-xs"
                                >
                                  <div className="flex items-start gap-2 p-2">
                                    <span className="w-5 h-5 rounded-full bg-[#1a1a2e] text-white flex items-center justify-center text-[10px] font-bold shrink-0 mt-0.5">
                                      {realIdx + 1}
                                    </span>
                                    <div className="flex-1 min-w-0">
                                      <div className="font-medium text-[#1a1a2e]">{stop.order_name}</div>
                                      <div className="text-[#6b6b63]">{stop.customer_name} · {stop.city}</div>
                                      {stop.panel_details?.length > 0 && (
                                        <div className="mt-1 text-[10px] text-[#6b6b63] space-y-0.5">
                                          {stop.panel_details.map((item, i) => (
                                            <div key={i} className="flex items-center gap-1">
                                              <span className="font-mono bg-white border border-[#e8e8e4] px-1 rounded text-[9px] shrink-0">{item.sku?.trim() || '—'}</span>
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
                                      {stop.comment && (
                                        <div className="relative group/comment">
                                          <span className="p-0.5 rounded text-[#6d28d9] cursor-default">
                                            <MessageSquare size={12} />
                                          </span>
                                          <div className="absolute right-0 bottom-full mb-1.5 w-52 bg-[#1a1a2e] text-white text-[10px] rounded-[8px] p-2.5 hidden group-hover/comment:block z-20 shadow-lg pointer-events-none">
                                            <p className="leading-relaxed">{stop.comment}</p>
                                            {stop.comment_at && (
                                              <p className="text-white/50 mt-1">
                                                {new Date(stop.comment_at).toLocaleString('fr-FR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
                                              </p>
                                            )}
                                          </div>
                                        </div>
                                      )}
                                      <button
                                        onClick={() => handleMoveStop(tour.id, stop.id, 'up')}
                                        disabled={realIdx === 0}
                                        className="p-0.5 rounded text-[#6b6b63] hover:text-[#1a1a2e] disabled:opacity-30"
                                      >
                                        <ChevronUp size={14} />
                                      </button>
                                      <button
                                        onClick={() => handleMoveStop(tour.id, stop.id, 'down')}
                                        disabled={realIdx === sortedStops.length - 1}
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
                                )
                              })}
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
                                          {(item.ref || item.variant_title) && (
                                            <span className="font-mono text-[10px] text-[#6b6b63] bg-white border border-[#e8e8e4] px-1.5 py-0.5 rounded mr-1.5">{item.ref || item.variant_title}</span>
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
            ) })()}
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
            <div ref={tourDropdownRef} className="relative">
              <button
                type="button"
                onClick={() => setTourDropdownOpen((v) => !v)}
                className="flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-[10px] bg-white/10 border border-white/20 text-white outline-none min-w-[160px] text-left"
              >
                <span className="flex-1 truncate">
                  {targetTourId
                    ? (() => {
                        const t = tours.find((t) => t.id === targetTourId)
                        return t ? `${t.name}${t.planned_date ? ` · ${formatDate(t.planned_date)}` : ''}` : 'Choisir une tournée'
                      })()
                    : 'Choisir une tournée'}
                </span>
                {tourDropdownOpen ? <ChevronUp size={14} className="shrink-0" /> : <ChevronDown size={14} className="shrink-0" />}
              </button>
              {tourDropdownOpen && (
                <div className="absolute bottom-full mb-1 left-0 min-w-full bg-[#1a1a2e] border border-white/20 rounded-[10px] shadow-[0_-4px_20px_rgba(0,0,0,0.4)] overflow-hidden z-50">
                  <button
                    type="button"
                    onClick={() => { setTargetTourId(''); setTourDropdownOpen(false) }}
                    className={`w-full text-left px-3 py-2 text-sm hover:bg-white/10 ${!targetTourId ? 'text-white/40' : 'text-white/60'}`}
                  >
                    Choisir une tournée
                  </button>
                  {tours.filter(t => t.status !== 'completed' && t.status !== 'cancelled').map((t) => (
                    <button
                      key={t.id}
                      type="button"
                      onClick={() => { setTargetTourId(t.id); setTourDropdownOpen(false) }}
                      className={`w-full text-left px-3 py-2 text-sm hover:bg-white/10 whitespace-nowrap ${targetTourId === t.id ? 'text-white font-medium' : 'text-white/80'}`}
                    >
                      {t.name}{t.planned_date ? ` · ${formatDate(t.planned_date)}` : ''}
                    </button>
                  ))}
                </div>
              )}
            </div>
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

    {/* ── Modale Notifier les clients ── */}
    {notifModal && (() => {
      const stopsWithEmail = notifModal.stops.filter((s) => s.email)
      const stopsWithoutEmail = notifModal.stops.filter((s) => !s.email)
      const alreadyNotified = stopsWithEmail.filter((s) => s.email_sent_at)
      const pendingNotif = stopsWithEmail.filter((s) => !s.email_sent_at)
      const allAlreadyNotified = pendingNotif.length === 0 && alreadyNotified.length > 0
      const notifDate = alreadyNotified.length > 0
        ? alreadyNotified.map((s) => s.email_sent_at!).sort().at(0)!
        : null

      return (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm"
          onClick={() => { if (!notifSending) setNotifModal(null) }}
        >
          <div
            className="bg-white rounded-[20px] shadow-2xl w-full max-w-md mx-4 overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div className="flex items-center justify-between px-5 py-4 border-b border-[#ebebeb]">
              <div>
                <h3 className="font-bold text-[#1a1a2e]">Notifier les clients</h3>
                <p className="text-xs text-[#6b6b63] mt-0.5">{notifModal.tourName}</p>
              </div>
              {!notifSending && !notifResult && (
                <button onClick={() => setNotifModal(null)} className="text-[#6b6b63] hover:text-[#1a1a2e]">
                  <X size={18} />
                </button>
              )}
            </div>

            {/* Tabs — seulement avant envoi */}
            {!notifResult && (
              <div className="flex border-b border-[#ebebeb]">
                {(['destinataires', 'apercu'] as const).map((tab) => (
                  <button
                    key={tab}
                    onClick={() => setNotifTab(tab)}
                    className={`flex-1 py-2.5 text-xs font-semibold transition-colors ${
                      notifTab === tab
                        ? 'text-[#1a1a2e] border-b-2 border-[#1a1a2e]'
                        : 'text-[#6b6b63] hover:text-[#1a1a2e]'
                    }`}
                  >
                    {tab === 'destinataires' ? 'Destinataires' : 'Aperçu email'}
                  </button>
                ))}
              </div>
            )}

            {/* Body */}
            <div className={`${notifTab === 'apercu' && !notifResult ? 'p-0' : 'px-5 py-4'} max-h-[65vh] overflow-y-auto`}>
              {notifResult ? (
                <div className="px-5 py-4 text-center py-4 space-y-2">
                  <div className="text-3xl">{notifResult.errors === 0 ? '✅' : '⚠️'}</div>
                  <p className="font-semibold text-[#1a1a2e]">
                    {notifResult.sent} email{notifResult.sent !== 1 ? 's' : ''} envoyé{notifResult.sent !== 1 ? 's' : ''}
                  </p>
                  {notifResult.errors > 0 && (
                    <p className="text-xs text-[#c7293a]">{notifResult.errors} erreur{notifResult.errors !== 1 ? 's' : ''}</p>
                  )}
                </div>
              ) : notifTab === 'apercu' ? (
                /* ── Aperçu email ── */
                (() => {
                  const previewFirst = (notifModal.stops[0]?.customer_name ?? 'Prénom').split(' ')[0]
                  const previewDate = formatTourDateFr(notifModal.plannedDate) || notifModal.tourName
                  return (
                    <div className="bg-[#f5f5f3]">
                      {/* Faux header email */}
                      <div className="px-4 pt-4 pb-3 border-b border-[#e8e8e4] bg-white text-xs space-y-1">
                        <div className="flex gap-2">
                          <span className="text-[#6b6b63] w-12 shrink-0">De :</span>
                          <span className="font-medium text-[#1a1a2e]">Léa – Bowa Concept &lt;lea@bowa-concept.com&gt;</span>
                        </div>
                        <div className="flex gap-2">
                          <span className="text-[#6b6b63] w-12 shrink-0">À :</span>
                          <span className="text-[#1a1a2e]">{notifModal.stops[0]?.email || 'client@exemple.com'}</span>
                        </div>
                        <div className="flex gap-2">
                          <span className="text-[#6b6b63] w-12 shrink-0">Objet :</span>
                          <span className="font-semibold text-[#1a1a2e]">BOWA CONCEPT : LIVRAISON</span>
                        </div>
                      </div>
                      {/* Corps du mail */}
                      <div className="bg-white mx-3 my-3 rounded-[12px] px-5 py-5 text-sm text-[#1a1a2e] leading-relaxed shadow-sm">
                        <p className="mb-3">Bonjour <strong>{previewFirst}</strong>,</p>
                        <p className="mb-3">Bonne nouvelle ! 🎉 Votre commande sera livrée cette semaine.<br/>
                        Notre livreur commencera sa tournée le <strong>{previewDate}</strong> et passera chez vous dans les prochains jours.</p>
                        <p className="mb-3">La livraison s&apos;effectuera au pied du camion 🚛. Nous vous demandons donc de faire le nécessaire pour être accompagné(e) d&apos;une autre personne afin de récupérer les panneaux en toute sécurité 🔧.</p>
                        <p className="mb-3">Pour garantir une livraison en toute fluidité, notre livreur vous appellera très probablement au fil de sa tournée, en fonction de l&apos;ordre des livraisons, afin de vérifier votre disponibilité. Vous serez joint(e) depuis le numéro suivant : <strong>06 02 40 15 86</strong>.</p>
                        <p className="mb-3">Si vous êtes indisponible, merci de nous en informer par retour de mail, afin que nous puissions reprogrammer votre livraison.</p>
                        <p className="mb-4">Nous nous réjouissons de finaliser votre livraison très prochainement ☀️.</p>
                        <p className="text-[#6b6b63] text-xs border-t border-[#f0f0f0] pt-3">
                          Cordialement,<br/>
                          <strong className="text-[#1a1a2e]">Léa</strong><br/>
                          Service client
                        </p>
                      </div>
                      <p className="text-center text-[10px] text-[#a0a099] pb-3">Aperçu — le prénom sera personnalisé pour chaque client</p>
                    </div>
                  )
                })()
              ) : (
                <>
                  {allAlreadyNotified && notifDate && (
                    <div className="mb-4 rounded-[10px] bg-[#fffbeb] border border-[#fde68a] px-4 py-3 text-sm text-[#92400e]">
                      <p className="font-semibold mb-1">⚠️ Clients déjà notifiés</p>
                      <p>Ces clients ont déjà reçu un email le {new Date(notifDate).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' })}.</p>
                      <p className="mt-1 text-xs">Confirmer pour renvoyer un email à tous.</p>
                    </div>
                  )}
                  {!allAlreadyNotified && alreadyNotified.length > 0 && (
                    <div className="mb-4 rounded-[10px] bg-[#eff6ff] border border-[#bfdbfe] px-4 py-3 text-xs text-[#1e40af]">
                      {alreadyNotified.length} client{alreadyNotified.length !== 1 ? 's' : ''} déjà notifié{alreadyNotified.length !== 1 ? 's' : ''} — seuls les {pendingNotif.length} restants recevront l&apos;email.
                    </div>
                  )}

                  {pendingNotif.length > 0 && (
                    <>
                      <p className="text-xs font-semibold text-[#6b6b63] uppercase tracking-wide mb-2">
                        {pendingNotif.length} email{pendingNotif.length !== 1 ? 's' : ''} à envoyer
                      </p>
                      <div className="space-y-1.5 mb-4">
                        {pendingNotif.map((s) => (
                          <div key={s.id} className="flex items-center gap-2 text-sm">
                            <span className="w-5 h-5 rounded-full bg-[#1a1a2e] text-white flex items-center justify-center shrink-0">
                              <Mail size={10} />
                            </span>
                            <span className="font-medium text-[#1a1a2e] truncate">{s.customer_name}</span>
                            <span className="text-[#6b6b63] text-xs truncate">{s.email}</span>
                          </div>
                        ))}
                      </div>
                    </>
                  )}

                  {alreadyNotified.length > 0 && (
                    <div className="space-y-1 mb-4">
                      {alreadyNotified.map((s) => (
                        <div key={s.id} className="flex items-center gap-2 text-sm opacity-50">
                          <span className="w-5 h-5 rounded-full bg-[#1a7f4b] text-white flex items-center justify-center shrink-0">
                            <Check size={10} />
                          </span>
                          <span className="font-medium text-[#1a1a2e] truncate">{s.customer_name}</span>
                          <span className="text-[#6b6b63] text-xs">déjà notifié</span>
                        </div>
                      ))}
                    </div>
                  )}

                  {stopsWithoutEmail.length > 0 && (
                    <p className="text-xs text-[#6b6b63]">
                      {stopsWithoutEmail.length} client{stopsWithoutEmail.length !== 1 ? 's' : ''} sans email (ignoré{stopsWithoutEmail.length !== 1 ? 's' : ''})
                    </p>
                  )}
                </>
              )}
            </div>

            {/* Footer */}
            <div className="px-5 py-4 border-t border-[#ebebeb] flex gap-2 justify-end">
              {notifResult ? (
                <button
                  onClick={() => setNotifModal(null)}
                  className="px-4 py-2 rounded-[10px] bg-[#1a1a2e] text-white text-sm font-medium"
                >
                  Fermer
                </button>
              ) : (
                <>
                  <button
                    onClick={() => setNotifModal(null)}
                    disabled={notifSending}
                    className="px-4 py-2 rounded-[10px] text-sm text-[#6b6b63] hover:text-[#1a1a2e] disabled:opacity-40"
                  >
                    Annuler
                  </button>
                  {allAlreadyNotified ? (
                    <button
                      onClick={() => sendNotifEmails(true)}
                      disabled={notifSending}
                      className="flex items-center gap-1.5 px-4 py-2 rounded-[10px] bg-[#c2680a] text-white text-sm font-medium disabled:opacity-40"
                    >
                      {notifSending ? (
                        <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24" fill="none">
                          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z"/>
                        </svg>
                      ) : <Mail size={14} />}
                      Renvoyer quand même
                    </button>
                  ) : pendingNotif.length > 0 ? (
                    <button
                      onClick={() => sendNotifEmails(false)}
                      disabled={notifSending}
                      className="flex items-center gap-1.5 px-4 py-2 rounded-[10px] bg-[#1a1a2e] text-white text-sm font-medium disabled:opacity-40"
                    >
                      {notifSending ? (
                        <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24" fill="none">
                          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z"/>
                        </svg>
                      ) : <Mail size={14} />}
                      Envoyer {pendingNotif.length} email{pendingNotif.length !== 1 ? 's' : ''}
                    </button>
                  ) : (
                    <button
                      onClick={() => setNotifModal(null)}
                      className="px-4 py-2 rounded-[10px] bg-[#1a1a2e] text-white text-sm font-medium"
                    >
                      OK
                    </button>
                  )}
                </>
              )}
            </div>
          </div>
        </div>
      )
    })()}
    </>
  )
}

// ─── Livreur View ─────────────────────────────────────────────────────────────

type LivreurScreen = 'home' | 'loading' | 'tour' | 'map' | 'nearby' | 'reorder'

// ─── Drag-and-drop stop item ──────────────────────────────────────────────────

function SortableStopItem({ stop, index }: { stop: TourStop; index: number }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: stop.id })

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    position: 'relative',
    zIndex: isDragging ? 50 : 'auto',
  }

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`flex items-center gap-3 rounded-[16px] bg-white px-4 py-4 border transition-all ${
        isDragging
          ? 'opacity-0 border-[#e8e8e4]'
          : 'opacity-100 shadow-[0_2px_8px_rgba(0,0,0,0.06)] border-transparent'
      }`}
    >
      {/* Drag handle */}
      <button
        className="touch-none shrink-0 p-1 -ml-1 text-[#c0c0ba] cursor-grab active:cursor-grabbing"
        {...attributes}
        {...listeners}
        aria-label="Déplacer"
      >
        <GripVertical size={20} />
      </button>

      {/* Sequence badge */}
      <span className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold shrink-0 ${
        stop.status === 'delivered' ? 'bg-[#1a7f4b] text-white' :
        stop.status === 'failed'    ? 'bg-[#f97316] text-white' :
        'bg-[#1a1a2e] text-white'
      }`}>
        {stop.status === 'delivered' ? '✓' : stop.status === 'failed' ? '✕' : index + 1}
      </span>

      {/* Info */}
      <div className="flex-1 min-w-0">
        <p className="font-semibold text-sm text-[#1a1a2e] truncate">{stop.customer_name}</p>
        <p className="text-xs text-[#6b6b63] truncate">{stop.city} {stop.zip}</p>
        {stop.panel_count > 0 && (
          <p className="text-[10px] text-[#9b9b93] mt-0.5">{stop.panel_count} panneau{stop.panel_count !== 1 ? 'x' : ''}</p>
        )}
      </div>

      <span className="font-mono text-[10px] text-[#9b9b93] shrink-0">{stop.order_name}</span>
    </div>
  )
}

const DEPOT = 'Rue Lamartine, Zone Industrielle des Distraits, 18390 Saint-Germain-du-Puy, France'
const DEPOT_COORDS: [number, number] = [2.4524, 47.0873]  // Saint-Germain-du-Puy
const SERVICE_SECONDS = 10 * 60  // 10 min par arrêt pour déchargement

function fmtETA(date: Date): string {
  const h = date.getHours().toString().padStart(2, '0')
  const m = date.getMinutes().toString().padStart(2, '0')
  return `${h}h${m}`
}

function haversineKm(a: [number, number], b: [number, number]): number {
  const [lng1, lat1] = a
  const [lng2, lat2] = b
  const R = 6371
  const dLat = ((lat2 - lat1) * Math.PI) / 180
  const dLng = ((lng2 - lng1) * Math.PI) / 180
  const sin1 = Math.sin(dLat / 2)
  const sin2 = Math.sin(dLng / 2)
  const aVal = sin1 * sin1 + Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * sin2 * sin2
  return R * 2 * Math.atan2(Math.sqrt(aVal), Math.sqrt(1 - aVal))
}

// Returns indices into the `validIndices` slice, sorted by nearest-neighbor from depot
function nearestNeighborTSP(
  depot: [number, number],
  validIndices: number[],
  coords: ([number, number] | null)[]
): number[] {
  const remaining = new Set(validIndices)
  const result: number[] = []
  let current = depot
  while (remaining.size > 0) {
    let best: number | null = null
    let bestDist = Infinity
    for (const idx of remaining) {
      const c = coords[idx]
      if (!c) continue
      const d = haversineKm(current, c)
      if (d < bestDist) { bestDist = d; best = idx }
    }
    if (best === null) break
    result.push(best)
    current = coords[best] as [number, number]
    remaining.delete(best)
  }
  return result
}

async function geocodeForMap(address: string, token: string): Promise<[number, number] | null> {
  try {
    const res = await fetch(
      `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(address)}.json?access_token=${token}&country=fr&limit=1&types=address`
    )
    if (!res.ok) return null
    const data = await res.json()
    const c = data.features?.[0]?.center
    return c ? (c as [number, number]) : null
  } catch { return null }
}

async function buildETAMap(
  sortedStops: TourStop[],
  coordsCache: Map<string, [number, number]>,
  token: string
): Promise<Map<string, string>> {
  const result = new Map<string, string>()

  // Delivered stops → affiche l'heure réelle
  for (const s of sortedStops) {
    if (s.status === 'delivered' && s.delivered_at) {
      result.set(s.id, fmtETA(new Date(s.delivered_at)))
    }
  }

  const pending = sortedStops.filter((s) => s.status === 'pending')
  if (pending.length === 0) return result

  // Point de départ : dernier arrêt livré (coord + heure réelle), sinon dépôt maintenant
  const lastDelivered = [...sortedStops].reverse().find((s) => s.status === 'delivered')
  let depCoord: [number, number] = DEPOT_COORDS
  let depTime = Date.now()
  if (lastDelivered) {
    const c = coordsCache.get(lastDelivered.id)
    if (c) depCoord = c
    if (lastDelivered.delivered_at) depTime = new Date(lastDelivered.delivered_at).getTime()
  }

  // Waypoints : départ + arrêts pending qui ont des coords
  const withCoords = pending
    .map((s) => ({ s, coord: coordsCache.get(s.id) }))
    .filter((x): x is { s: TourStop; coord: [number, number] } => !!x.coord)
  if (withCoords.length === 0) return result

  const wps: [number, number][] = [depCoord, ...withCoords.map((x) => x.coord)]
  const capped = wps.slice(0, 25)

  try {
    const coordStr = capped.map((c) => c.join(',')).join(';')
    const res = await fetch(
      `https://api.mapbox.com/directions/v5/mapbox/driving/${coordStr}?overview=false&access_token=${token}`
    )
    if (!res.ok) return result
    const data = await res.json()
    const legs: { duration: number }[] = data.routes?.[0]?.legs ?? []

    let t = depTime
    for (let i = 0; i < withCoords.length && i < legs.length; i++) {
      t += legs[i].duration * 1000
      result.set(withCoords[i].s.id, fmtETA(new Date(t)))
      t += SERVICE_SECONDS * 1000
    }
  } catch { /* best-effort */ }

  return result
}

function LivreurView() {
  const [tours, setTours] = useState<Tour[]>([])
  const [selectedTourId, setSelectedTourId] = useState('')
  const [loading, setLoading] = useState(true)
  const [screen, setScreen] = useState<LivreurScreen>('home')
  const [stopIdx, setStopIdx] = useState(0)
  const [marking, setMarking] = useState(false)
  const [checkedItems, setCheckedItems] = useState<Set<string>>(new Set())
  const [etaMap, setEtaMap] = useState<Map<string, string>>(new Map())
  const [commentMode, setCommentMode] = useState<'none' | 'delivered' | 'failed'>('none')
  const [pendingComment, setPendingComment] = useState('')
  const [selectedChip, setSelectedChip] = useState('')
  const coordsCache = useRef<Map<string, [number, number]>>(new Map())
  const [navSheet, setNavSheet] = useState(false)
  const [nearbyOrders, setNearbyOrders]   = useState<ShopifyOrder[]>([])
  const [nearbyLoading, setNearbyLoading] = useState(false)
  const [nearbyZoneFilter, setNearbyZoneFilter] = useState<string>('all')
  const [addingOrderName, setAddingOrderName]   = useState<string | null>(null)
  const [addedToTourNames, setAddedToTourNames] = useState<Set<string>>(new Set())
  // Reorder screen state
  const [reorderStops, setReorderStops]     = useState<TourStop[]>([])
  const [reorderSaving, setReorderSaving]   = useState(false)
  const [reorderActiveId, setReorderActiveId] = useState<string | null>(null)
  const reorderSensors = useSensors(
    useSensor(PointerSensor),
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 8 } }),
  )

  const fetchTours = useCallback(async () => {
    setLoading(true)
    try {
      const r = await fetch('/api/delivery/tours')
      const data = await r.json()
      const today = new Date().toISOString().slice(0, 10)
      const all: Tour[] = (data.tours ?? []).filter((t: Tour) => t.status !== 'cancelled')
      setTours(all)
      // Keep the current selection if it still exists in the refreshed list.
      // Only auto-select when there is genuinely no selection yet (first load)
      // or the previously selected tour disappeared (e.g. deleted).
      setSelectedTourId(prev => {
        if (prev && all.find((t) => t.id === prev)) return prev   // stay on current tour
        // Priority: in_progress → today → closest upcoming → first
        const inProgress = all.find((t: Tour) => t.status === 'in_progress')
        if (inProgress) return inProgress.id
        const todayTour = all.find((t: Tour) => t.planned_date === today)
        if (todayTour) return todayTour.id
        const upcoming = [...all]
          .filter((t: Tour) => t.planned_date && t.planned_date >= today)
          .sort((a: Tour, b: Tour) => a.planned_date.localeCompare(b.planned_date))[0]
        return upcoming?.id ?? all[0]?.id ?? prev
      })
    } catch (e) {
      console.error(e)
    } finally {
      setLoading(false)
    }
  }, [])

  const fetchNearbyOrders = useCallback(async () => {
    setNearbyLoading(true)
    try {
      const r = await fetch('/api/delivery/orders', { cache: 'no-store' })
      const data = await r.json()
      setNearbyOrders(data.orders ?? [])
    } catch { /* best-effort — nearby feature is optional */ } finally {
      setNearbyLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchTours()
    fetchNearbyOrders()
  }, [fetchTours, fetchNearbyOrders])

  const tour = tours.find((t) => t.id === selectedTourId)
  const sortedStopsForETA = tour ? [...tour.stops].sort((a, b) => a.sequence - b.sequence) : []

  // Signature qui change à chaque livraison/échec pour déclencher le recalcul
  const stopsSignature = sortedStopsForETA
    .map((s) => `${s.id}:${s.status}:${s.delivered_at ?? ''}`)
    .join('|')

  useEffect(() => {
    const token = process.env.NEXT_PUBLIC_MAPBOX_TOKEN ?? ''
    if (!token || sortedStopsForETA.length === 0) return
    let cancelled = false

    async function run() {
      // Géocode les arrêts manquants
      await Promise.all(
        sortedStopsForETA.map(async (stop) => {
          if (coordsCache.current.has(stop.id)) return
          const coord = await geocodeForMap(
            `${stop.address1}, ${stop.city} ${stop.zip}, France`,
            token
          )
          if (coord) coordsCache.current.set(stop.id, coord)
        })
      )
      if (cancelled) return
      const etas = await buildETAMap(sortedStopsForETA, coordsCache.current, token)
      if (!cancelled) setEtaMap(etas)
    }

    run()
    return () => { cancelled = true }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stopsSignature])

  const sortedStops = sortedStopsForETA  // alias — même tableau
  const deliveredCount = sortedStops.filter((s) => s.status === 'delivered').length

  // Reset comment state whenever the user navigates to a different stop
  useEffect(() => {
    setCommentMode('none')
    setPendingComment('')
    setSelectedChip('')
  }, [stopIdx])

  // Loading order: stops in REVERSE delivery order (last stop loaded first = goes deepest in truck)
  // Each stop shows its own items so the driver knows what to load for each destination
  const loadingStops = tour
    ? [...sortedStops].reverse().map((stop) => ({
        stop,
        items: (stop.panel_details ?? []).filter((p) => p.qty > 0),
      })).filter((s) => s.items.length > 0)
    : []
  const totalLoadingItems = loadingStops.reduce((sum, s) => sum + s.items.length, 0)


  const currentStop = sortedStops[stopIdx]

  // Full-tour Maps URL: depot → all pending stops in order
  const tourMapsUrl = (() => {
    const pending = sortedStops.filter((s) => s.status !== 'delivered' && s.status !== 'failed')
    if (pending.length === 0) return ''
    const waypoints = pending.map((s) => encodeURIComponent(`${s.address1}, ${s.city} ${s.zip}, France`))
    return `https://www.google.com/maps/dir/${encodeURIComponent(DEPOT)}/${waypoints.join('/')}`
  })()

  async function handleMarkDelivered(comment?: string) {
    if (!currentStop) return
    setMarking(true)
    await fetch(`/api/delivery/stops/${currentStop.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'delivered', ...(comment ? { comment } : {}) }),
    })
    await fetchTours()
    setMarking(false)
    // Auto-advance: use functional updater so we read the freshly-set tours state
    setTours(latestTours => {
      const latestTour = latestTours.find(t => t.id === selectedTourId)
      if (!latestTour) return latestTours
      const fresh = [...latestTour.stops].sort((a, b) => a.sequence - b.sequence)
      const nextIdx = fresh.findIndex((s, i) => i > stopIdx && s.status !== 'delivered' && s.status !== 'failed')
      if (nextIdx !== -1) setStopIdx(nextIdx)
      return latestTours  // no mutation
    })
  }

  async function handleMarkFailed(comment: string) {
    if (!currentStop) return
    setMarking(true)
    await fetch(`/api/delivery/stops/${currentStop.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'failed', comment }),
    })
    await fetchTours()
    setMarking(false)
    // Auto-advance: use functional updater so we read the freshly-set tours state
    setTours(latestTours => {
      const latestTour = latestTours.find(t => t.id === selectedTourId)
      if (!latestTour) return latestTours
      const fresh = [...latestTour.stops].sort((a, b) => a.sequence - b.sequence)
      const nextIdx = fresh.findIndex((s, i) => i > stopIdx && s.status !== 'delivered' && s.status !== 'failed')
      if (nextIdx !== -1) setStopIdx(nextIdx)
      return latestTours  // no mutation
    })
  }

  if (loading) {
    return <div className="text-center py-16 text-sm text-[#6b6b63]">Chargement...</div>
  }

  // ── Screen: home ──
  if (screen === 'home') {
    return (
      <div className="w-full space-y-4">
        {/* Tour selector */}
        {tours.length > 1 && (
          <div>
            <p className="text-xs font-semibold uppercase tracking-widest text-[#6b6b63] mb-2 px-1">Ma tournée</p>
            <select
              value={selectedTourId}
              onChange={(e) => setSelectedTourId(e.target.value)}
              className="w-full px-4 py-4 text-base font-medium border border-[#e8e8e4] rounded-[14px] outline-none bg-white"
            >
              {tours.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.status === 'in_progress' ? '🟢 ' : t.status === 'completed' ? '✓ ' : ''}
                  {t.name} — {t.planned_date ? formatDate(t.planned_date) : 'sans date'}
                </option>
              ))}
            </select>
          </div>
        )}

        {tour ? (
          <div className="w-full rounded-[20px] bg-[#1a1a2e] overflow-hidden">
            {/* Header */}
            <div className="px-6 pt-8 pb-6 text-white">
              {tour.status === 'in_progress' && (
                <div className="flex items-center gap-2 mb-3">
                  <span className="relative flex h-2.5 w-2.5">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-[#4ade80] opacity-75" />
                    <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-[#4ade80]" />
                  </span>
                  <span className="text-[#4ade80] text-xs font-bold uppercase tracking-widest">Tournée en cours</span>
                </div>
              )}
              <div className="text-2xl font-bold leading-tight">{tour.name}</div>
              {tour.planned_date && (
                <div className="text-white/50 text-base mt-1 capitalize">{formatDate(tour.planned_date)}</div>
              )}
            </div>

            {/* Stats — 3 equal columns, full width */}
            <div className="grid grid-cols-3 border-t border-white/10">
              <div className="text-center py-6 border-r border-white/10">
                <div className="text-5xl font-bold text-white">{sortedStops.length}</div>
                <div className="text-white/50 text-sm mt-2 uppercase tracking-wide">Arrêts</div>
              </div>
              <div className="text-center py-6 border-r border-white/10">
                <div className="text-5xl font-bold text-white">{tour.total_panels}</div>
                <div className="text-white/50 text-sm mt-2 uppercase tracking-wide">Panneaux</div>
              </div>
              <div className="text-center py-6">
                <div className={`text-5xl font-bold ${deliveredCount > 0 ? 'text-[#4ade80]' : 'text-white/30'}`}>
                  {deliveredCount}
                </div>
                <div className="text-white/50 text-sm mt-2 uppercase tracking-wide">Livrés</div>
              </div>
            </div>

            {/* Progress bar with inline percentage */}
            {sortedStops.length > 0 && (
              <div className="px-6 pb-2">
                <div className="relative w-full h-6 bg-white/15 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-[#4ade80] rounded-full transition-all"
                    style={{ width: `${(deliveredCount / sortedStops.length) * 100}%` }}
                  />
                  <span className="absolute inset-0 flex items-center justify-center text-xs font-semibold text-white mix-blend-difference">
                    {Math.round((deliveredCount / sortedStops.length) * 100)}%
                  </span>
                </div>
              </div>
            )}

            {/* Actions */}
            <div className="px-6 pt-4 pb-6 space-y-3">
              <button
                onClick={() => setScreen('loading')}
                className="w-full flex items-center justify-center gap-3 py-5 rounded-[16px] border border-white/25 text-white font-semibold text-lg active:bg-white/10 transition-colors"
              >
                <Package size={24} strokeWidth={1.8} />
                Préparer le camion
              </button>
              <button
                onClick={() => {
                  const resumeIdx = sortedStops.findIndex(s => s.status !== 'delivered' && s.status !== 'failed')
                  setStopIdx(resumeIdx !== -1 ? resumeIdx : 0)
                  setScreen('tour')
                }}
                disabled={sortedStops.length === 0}
                className="w-full flex items-center justify-center gap-3 py-5 rounded-[16px] bg-[#4ade80] text-[#1a1a2e] font-bold text-lg disabled:opacity-30 active:bg-[#22c55e] transition-colors"
              >
                <Truck size={24} strokeWidth={1.8} />
                {deliveredCount > 0 ? 'Continuer la tournée' : 'Démarrer la tournée'}
              </button>
              <button
                onClick={() => setScreen('map')}
                disabled={sortedStops.length === 0}
                className="w-full flex items-center justify-center gap-3 py-4 rounded-[16px] border border-white/25 text-white font-semibold text-base disabled:opacity-30 active:bg-white/10 transition-colors"
              >
                <MapIcon size={20} strokeWidth={1.8} />
                Voir l&apos;itinéraire
              </button>
              <button
                onClick={() => { setReorderStops([...sortedStops]); setScreen('reorder') }}
                disabled={sortedStops.length < 2}
                className="w-full flex items-center justify-center gap-3 py-4 rounded-[16px] border border-white/25 text-white font-semibold text-base disabled:opacity-30 active:bg-white/10 transition-colors"
              >
                <GripVertical size={20} strokeWidth={1.8} />
                Réordonner les arrêts
              </button>
            </div>
          </div>
        ) : (
          <div className="w-full rounded-[20px] bg-white py-16 text-center text-base text-[#6b6b63]">
            Aucune tournée disponible
          </div>
        )}

        {/* Nearby orders button */}
        <button
          onClick={() => setScreen('nearby')}
          className="w-full flex items-center gap-4 px-5 py-4 rounded-[18px] bg-[#fffbeb] border border-[#fde68a] active:bg-[#fef3c7] transition-colors"
        >
          <span className="w-10 h-10 rounded-full bg-[#f59e0b] flex items-center justify-center text-white font-bold text-xl shrink-0">+</span>
          <div className="flex-1 text-left min-w-0">
            <p className="text-sm font-bold text-[#92400e]">Commandes non planifiées</p>
            <p className="text-xs text-[#92400e]/70">
              {nearbyLoading
                ? 'Chargement...'
                : nearbyOrders.length > 0
                  ? `${nearbyOrders.length} commande${nearbyOrders.length > 1 ? 's' : ''} disponible${nearbyOrders.length > 1 ? 's' : ''}`
                  : 'Aucune commande en attente'}
            </p>
          </div>
          <ChevronRight size={18} className="text-[#f59e0b] shrink-0" />
        </button>
      </div>
    )
  }

  // ── Screen: map ──
  if (screen === 'map') {
    return (
      <TourMap
        stops={sortedStops}
        onBack={() => setScreen('home')}
        precomputedCoords={coordsCache.current}
        etaMap={etaMap}
        nearbyOrders={nearbyOrders}
        tourId={selectedTourId}
        onAddToTour={async (order) => {
          if (!selectedTourId) return
          await fetch(`/api/delivery/tours/${selectedTourId}/stops`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ stops: [{
              order_name:       order.order_name,
              shopify_order_id: order.shopify_order_id,
              customer_name:    order.customer_name,
              email:            order.email,
              address1:         order.address1,
              address2:         '',
              city:             order.city,
              zip:              order.zip,
              zone:             order.zone,
              panel_count:      order.panel_count,
              panel_details:    order.panel_details,
            }] }),
          })
          await fetchTours()
          // Refresh nearby orders so added order disappears
          fetchNearbyOrders()
        }}
        onMarkDelivered={async (stopId, comment) => {
          await fetch(`/api/delivery/stops/${stopId}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ status: 'delivered', ...(comment ? { comment } : {}) }),
          })
          await fetchTours()
        }}
        onMarkFailed={async (stopId, comment) => {
          await fetch(`/api/delivery/stops/${stopId}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ status: 'failed', comment }),
          })
          await fetchTours()
        }}
        onRemoveStop={async (stopId) => {
          await fetch(`/api/delivery/stops/${stopId}`, { method: 'DELETE' })
          await fetchTours()
        }}
      />
    )
  }

  // ── Screen: nearby (unplanned orders) ──
  if (screen === 'nearby') {
    const ZONES = ['all', 'nord-est', 'nord-ouest', 'sud-est', 'sud-ouest'] as const
    const filteredNearby = nearbyOrders.filter(
      o => nearbyZoneFilter === 'all' || o.zone === nearbyZoneFilter
    )

    async function handleAddToTour(order: ShopifyOrder) {
      if (!selectedTourId) return
      setAddingOrderName(order.order_name)
      try {
        await fetch(`/api/delivery/tours/${selectedTourId}/stops`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ stops: [{
            order_name:       order.order_name,
            shopify_order_id: order.shopify_order_id,
            customer_name:    order.customer_name,
            email:            order.email,
            address1:         order.address1,
            address2:         '',
            city:             order.city,
            zip:              order.zip,
            zone:             order.zone,
            panel_count:      order.panel_count,
            panel_details:    order.panel_details,
          }] }),
        })
        setAddedToTourNames(prev => new Set([...prev, order.order_name]))
        await fetchTours()
        fetchNearbyOrders()
      } finally {
        setAddingOrderName(null)
      }
    }

    return (
      <div className="w-full pb-8">
        {/* Header */}
        <div className="flex items-center gap-3 mb-4">
          <button
            onClick={() => setScreen('home')}
            className="w-10 h-10 rounded-full bg-white shadow flex items-center justify-center shrink-0"
          >
            <ChevronLeft size={20} />
          </button>
          <div className="flex-1 min-w-0">
            <h2 className="text-lg font-bold text-[#1a1a2e]">Commandes non planifiées</h2>
            {tour && (
              <p className="text-xs text-[#6b6b63]">Tournée : <span className="font-medium text-[#1a1a2e]">{tour.name}</span></p>
            )}
          </div>
          {nearbyLoading && <span className="text-xs text-[#9b9b93]">Actualisation...</span>}
        </div>

        {/* Zone filter */}
        <div className="flex gap-2 overflow-x-auto pb-1 mb-4">
          {ZONES.map((z) => (
            <button
              key={z}
              onClick={() => setNearbyZoneFilter(z)}
              className={`shrink-0 px-3 py-1.5 rounded-full text-xs font-semibold transition-all ${
                nearbyZoneFilter === z
                  ? 'bg-[#f59e0b] text-white'
                  : 'bg-white text-[#92400e] border border-[#fcd34d]'
              }`}
            >
              {z === 'all' ? 'Toutes zones' : ZONE_LABEL[z as Zone]}
            </button>
          ))}
        </div>

        {/* Count */}
        <p className="text-xs text-[#6b6b63] mb-3 px-1">
          {nearbyLoading
            ? 'Chargement...'
            : `${filteredNearby.length} commande${filteredNearby.length !== 1 ? 's' : ''}`}
        </p>

        {/* List */}
        {nearbyLoading && nearbyOrders.length === 0 ? (
          <div className="text-center py-16 text-sm text-[#6b6b63]">Chargement des commandes...</div>
        ) : filteredNearby.length === 0 ? (
          <div className="text-center py-16 text-sm text-[#6b6b63]">Aucune commande dans cette zone</div>
        ) : (
          <div className="space-y-3">
            {filteredNearby.map((order) => {
              const isAdded   = addedToTourNames.has(order.order_name)
              const isAdding  = addingOrderName === order.order_name
              const zc        = ZONE_COLOR[order.zone] ?? { bg: '#f5f5f3', text: '#6b6b63' }
              return (
                <div key={order.order_name} className={`rounded-[16px] bg-white shadow-[0_2px_12px_rgba(0,0,0,0.06)] overflow-hidden transition-all ${isAdded ? 'opacity-60' : ''}`}>
                  {/* Card header */}
                  <div className="px-4 pt-4 pb-3">
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap mb-1">
                          <span className="font-mono text-xs font-bold text-[#1a1a2e] bg-[#f5f5f3] px-2 py-0.5 rounded-[6px]">
                            {order.order_name}
                          </span>
                          <span
                            className="px-2 py-0.5 rounded-full text-[10px] font-semibold"
                            style={{ background: zc.bg, color: zc.text }}
                          >
                            {ZONE_LABEL[order.zone as Zone] ?? order.zone}
                          </span>
                          <span className="px-2 py-0.5 rounded-full bg-[#f5f5f3] text-[#6b6b63] text-[10px]">
                            {order.panel_count} panneau{order.panel_count !== 1 ? 'x' : ''}
                          </span>
                        </div>
                        <p className="text-base font-bold text-[#1a1a2e] leading-tight">{order.customer_name}</p>
                        <p className="text-sm text-[#6b6b63] mt-0.5">{order.address1}</p>
                        <p className="text-sm text-[#6b6b63]">{order.city} {order.zip}</p>
                      </div>
                    </div>

                    {/* Products */}
                    {order.panel_details?.length > 0 && (
                      <div className="mt-3 space-y-1">
                        {order.panel_details.map((item, i) => (
                          <div key={i} className="flex items-center gap-2 text-xs">
                            <span className="w-6 h-6 rounded-lg bg-[#f59e0b] text-white flex items-center justify-center font-bold text-[10px] shrink-0">
                              {item.qty}
                            </span>
                            {item.sku?.trim() && (
                              <span className="font-mono text-[#9b9b93] bg-[#f5f5f3] px-1.5 py-0.5 rounded shrink-0">{item.sku}</span>
                            )}
                            <span className="text-[#1a1a2e] truncate">{item.title}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* Action */}
                  <div className="px-4 pb-4">
                    {!tour ? (
                      <div className="w-full py-3 rounded-[12px] bg-[#f5f5f3] text-[#9b9b93] text-sm font-medium text-center">
                        Aucune tournée sélectionnée
                      </div>
                    ) : isAdded ? (
                      <div className="w-full py-3 rounded-[12px] bg-[#d1fae5] text-[#1a7f4b] text-sm font-bold text-center">
                        ✓ Ajoutée à {tour.name}
                      </div>
                    ) : (
                      <button
                        onClick={() => handleAddToTour(order)}
                        disabled={isAdding || !!addingOrderName}
                        className="w-full py-4 rounded-[12px] bg-[#f59e0b] text-white font-bold text-base disabled:opacity-60 active:bg-[#d97706] transition-colors"
                      >
                        {isAdding ? 'Ajout en cours...' : '+ Ajouter à ma tournée'}
                      </button>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>
    )
  }

  // ── Screen: reorder ──
  if (screen === 'reorder') {
    const activeStop = reorderActiveId ? reorderStops.find(s => s.id === reorderActiveId) ?? null : null

    async function handleDragEnd(event: DragEndEvent) {
      setReorderActiveId(null)
      const { active, over } = event
      if (!over || active.id === over.id) return

      const oldIdx = reorderStops.findIndex(s => s.id === active.id)
      const newIdx = reorderStops.findIndex(s => s.id === over.id)
      const newOrder = arrayMove(reorderStops, oldIdx, newIdx)
      setReorderStops(newOrder)

      setReorderSaving(true)
      try {
        await Promise.all(
          newOrder.map((stop, i) =>
            fetch(`/api/delivery/stops/${stop.id}`, {
              method: 'PATCH',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ sequence: i }),
            })
          )
        )
        fetchTours()
      } finally {
        setReorderSaving(false)
      }
    }

    return (
      <div className="w-full pb-10">
        {/* Header */}
        <div className="flex items-center gap-3 mb-5">
          <button
            onClick={() => setScreen('home')}
            className="w-10 h-10 rounded-full bg-white shadow flex items-center justify-center shrink-0"
          >
            <ChevronLeft size={20} />
          </button>
          <div className="flex-1 min-w-0">
            <h2 className="text-lg font-bold text-[#1a1a2e]">Réordonner les arrêts</h2>
            <p className="text-xs text-[#6b6b63]">Glisser ⠿ pour déplacer un arrêt</p>
          </div>
          {reorderSaving && (
            <span className="text-xs text-[#6b6b63] animate-pulse">Sauvegarde…</span>
          )}
          {!reorderSaving && (
            <span className="text-xs text-[#1a7f4b] font-medium">✓ Synchronisé</span>
          )}
        </div>

        {/* Sortable list */}
        <DndContext
          sensors={reorderSensors}
          collisionDetection={closestCenter}
          onDragStart={(e: DragStartEvent) => setReorderActiveId(String(e.active.id))}
          onDragEnd={handleDragEnd}
          onDragCancel={() => setReorderActiveId(null)}
        >
          <SortableContext items={reorderStops.map(s => s.id)} strategy={verticalListSortingStrategy}>
            <div className="space-y-2">
              {reorderStops.map((stop, i) => (
                <SortableStopItem key={stop.id} stop={stop} index={i} />
              ))}
            </div>
          </SortableContext>

          {/* Overlay: renders the dragging item at cursor */}
          <DragOverlay dropAnimation={{ duration: 180, easing: 'ease' }}>
            {activeStop && (
              <div className="flex items-center gap-3 rounded-[16px] bg-white shadow-[0_12px_40px_rgba(0,0,0,0.18)] px-4 py-4 border border-[#e8e8e4] scale-[1.03]">
                <span className="shrink-0 p-1 text-[#1a1a2e]">
                  <GripVertical size={20} />
                </span>
                <span className="w-7 h-7 rounded-full bg-[#1a1a2e] text-white flex items-center justify-center text-xs font-bold shrink-0">
                  {reorderStops.findIndex(s => s.id === activeStop.id) + 1}
                </span>
                <div className="flex-1 min-w-0">
                  <p className="font-semibold text-sm text-[#1a1a2e] truncate">{activeStop.customer_name}</p>
                  <p className="text-xs text-[#6b6b63] truncate">{activeStop.city} {activeStop.zip}</p>
                </div>
                <span className="font-mono text-[10px] text-[#9b9b93] shrink-0">{activeStop.order_name}</span>
              </div>
            )}
          </DragOverlay>
        </DndContext>
      </div>
    )
  }

  // ── Screen: loading list ──
  if (screen === 'loading') {
    const allChecked = totalLoadingItems > 0 && checkedItems.size >= totalLoadingItems

    function toggleItem(key: string) {
      setCheckedItems((prev) => {
        const next = new Set(prev)
        if (next.has(key)) next.delete(key)
        else next.add(key)
        return next
      })
    }

    return (
      <div className="w-full pb-28">
        <div className="flex items-center gap-3 mb-2">
          <button
            onClick={() => setScreen('home')}
            className="w-10 h-10 rounded-full bg-white shadow flex items-center justify-center"
          >
            <ChevronLeft size={20} />
          </button>
          <h2 className="text-lg font-bold text-[#1a1a2e]">Chargement camion</h2>
          <span className="ml-auto text-sm text-[#6b6b63]">{checkedItems.size} / {totalLoadingItems}</span>
        </div>
        <p className="text-xs text-[#6b6b63] mb-4 pl-1">Charger du dernier arrêt au premier — le premier arrêt doit être accessible en premier.</p>

        {/* Récapitulatif produits */}
        {loadingStops.length > 0 && (() => {
          const summaryMap = new Map<string, { sku: string; title: string; variant_title: string; qty: number }>()
          for (const { items } of loadingStops) {
            for (const item of items) {
              const key = item.sku?.trim() || item.title
              const existing = summaryMap.get(key)
              if (existing) existing.qty += item.qty
              else summaryMap.set(key, { sku: item.sku?.trim() ?? '', title: item.title, variant_title: item.variant_title ?? '', qty: item.qty })
            }
          }
          const summary = [...summaryMap.values()].sort((a, b) => b.qty - a.qty)
          const totalQty = summary.reduce((s, r) => s + r.qty, 0)
          return (
            <div className="print-summary rounded-[16px] bg-white shadow-[0_2px_12px_rgba(0,0,0,0.06)] overflow-hidden mb-5 print:shadow-none">
              <div className="flex items-center justify-between px-4 py-3 bg-[#f8f8f6] border-b border-[#ebebeb]">
                <span className="text-sm font-bold text-[#1a1a2e]">Récapitulatif produits</span>
                <button
                  onClick={() => window.print()}
                  className="flex items-center gap-1.5 text-xs font-medium text-[#6b6b63] hover:text-[#1a1a2e] transition-colors"
                >
                  <Printer size={14} />
                  Imprimer
                </button>
              </div>
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-[#ebebeb]">
                    <th className="text-left px-4 py-2 text-xs font-semibold text-[#6b6b63] uppercase tracking-wide w-24">Réf.</th>
                    <th className="text-left px-4 py-2 text-xs font-semibold text-[#6b6b63] uppercase tracking-wide">Produit</th>
                    <th className="text-right px-4 py-2 text-xs font-semibold text-[#6b6b63] uppercase tracking-wide w-16">Qté</th>
                  </tr>
                </thead>
                <tbody>
                  {summary.map((row, i) => (
                    <tr key={i} className="border-b border-[#f0f0f0] last:border-0">
                      <td className="px-4 py-2.5 font-mono text-xs text-[#6b6b63]">{row.sku || '—'}</td>
                      <td className="px-4 py-2.5 text-[#1a1a2e]">
                        {row.title}
                        {row.variant_title && <span className="text-xs text-[#6b6b63] ml-1">· {row.variant_title}</span>}
                      </td>
                      <td className="px-4 py-2.5 text-right font-bold text-[#1a1a2e]">{row.qty}</td>
                    </tr>
                  ))}
                  <tr className="bg-[#f8f8f6]">
                    <td className="px-4 py-2.5 font-bold text-[#1a1a2e]" colSpan={2}>TOTAL</td>
                    <td className="px-4 py-2.5 text-right font-bold text-[#1a1a2e] text-base">{totalQty}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          )
        })()}

        {loadingStops.length === 0 ? (
          <div className="rounded-[20px] bg-white shadow-[0_4px_24px_rgba(0,0,0,0.08)] p-8 text-center text-sm text-[#6b6b63]">Aucun produit</div>
        ) : (
          <div className="space-y-3">
            {loadingStops.map(({ stop, items }, stopI) => {
              const totalStops = sortedStops.length
              const deliveryIdx = totalStops - stopI  // position in delivery order (last = 1st loaded)
              const stopAllChecked = items.every((item) => {
                const key = stop.id + '::' + (item.sku?.trim() || item.title)
                return checkedItems.has(key)
              })
              return (
                <div key={stop.id} className="rounded-[16px] bg-white shadow-[0_2px_12px_rgba(0,0,0,0.06)] overflow-hidden">
                  {/* Stop header */}
                  <div className={`flex items-center gap-3 px-4 py-3 ${stopAllChecked ? 'bg-[#f0fdf4]' : 'bg-[#f8f8f6]'}`}>
                    <span className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold shrink-0 ${
                      stopAllChecked ? 'bg-[#1a7f4b] text-white' : 'bg-[#1a1a2e] text-white'
                    }`}>
                      {deliveryIdx}
                    </span>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5 min-w-0">
                        <span className="font-semibold text-sm text-[#1a1a2e] truncate">{stop.customer_name}</span>
                        <span className="font-mono text-xs text-[#6b6b63] shrink-0">{stop.order_name}</span>
                      </div>
                      <div className="text-xs text-[#6b6b63]">{stop.city} {stop.zip}</div>
                    </div>
                    {stopI === 0 && (
                      <span className="text-[10px] font-semibold uppercase tracking-wide text-[#c2680a] bg-[#fff7ed] px-2 py-0.5 rounded-full shrink-0">Charger en 1er</span>
                    )}
                  </div>
                  {/* Items */}
                  <div className="divide-y divide-[#f0f0f0]">
                    {items.map((item, i) => {
                      const key = stop.id + '::' + (item.sku?.trim() || item.title)
                      const checked = checkedItems.has(key)
                      return (
                        <div
                          key={i}
                          onClick={() => toggleItem(key)}
                          className={`flex items-center gap-4 px-4 py-3 cursor-pointer transition-colors ${
                            checked ? 'bg-[#f0fdf4]' : 'bg-white active:bg-[#f5f5f3]'
                          }`}
                        >
                          <div className={`shrink-0 w-6 h-6 rounded-full border-2 flex items-center justify-center transition-all ${
                            checked ? 'bg-[#1a7f4b] border-[#1a7f4b]' : 'border-[#d1d5db]'
                          }`}>
                            {checked && (
                              <svg width="12" height="12" viewBox="0 0 14 14" fill="none">
                                <path d="M2.5 7L5.5 10L11.5 4" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                              </svg>
                            )}
                          </div>
                          <div className={`flex-1 min-w-0 ${checked ? 'opacity-50' : ''}`}>
                            {(item.sku?.trim() || item.variant_title) && (
                              <div className={`font-mono text-xs text-[#6b6b63] mb-0.5 ${checked ? 'line-through' : ''}`}>
                                {item.sku?.trim() || item.variant_title}
                              </div>
                            )}
                            <div className={`font-medium text-sm leading-tight ${checked ? 'line-through text-[#6b6b63]' : 'text-[#1a1a2e]'}`}>
                              {item.title}
                            </div>
                          </div>
                          <div className={`shrink-0 w-12 h-12 rounded-[12px] flex items-center justify-center font-bold text-xl transition-all ${
                            checked ? 'bg-[#1a7f4b] text-white' : 'bg-[#1a1a2e] text-white'
                          }`}>
                            {item.qty}
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

        {/* Validate button — fixed bottom */}
        {allChecked && (
          <div className="fixed bottom-6 left-0 right-0 flex justify-center px-6">
            <button
              onClick={() => {
                const resumeIdx = sortedStops.findIndex(s => s.status !== 'delivered' && s.status !== 'failed')
                setStopIdx(resumeIdx !== -1 ? resumeIdx : 0)
                setScreen('tour')
              }}
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
      <div className="w-full text-center space-y-4 py-12">
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

  const navMapsUrl = currentStop
    ? `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(`${currentStop.address1}, ${currentStop.city} ${currentStop.zip}, France`)}&travelmode=driving`
    : ''
  const navWazeUrl = currentStop
    ? `https://waze.com/ul?q=${encodeURIComponent(`${currentStop.address1}, ${currentStop.city}, France`)}&navigate=yes`
    : ''

  return (
    <>
    {/* Nav bottom sheet */}
    {navSheet && (
      <div
        className="fixed inset-0 z-50 bg-black/40"
        onClick={() => setNavSheet(false)}
      >
        <div
          className="absolute bottom-0 left-0 right-0 bg-white rounded-t-[24px] px-6 pt-5 pb-10 shadow-[0_-8px_32px_rgba(0,0,0,0.15)]"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="w-10 h-1 bg-[#e8e8e4] rounded-full mx-auto mb-5" />
          <p className="text-sm font-semibold text-[#1a1a2e] mb-1">Naviguer vers</p>
          <p className="text-sm text-[#6b6b63] mb-5">
            {currentStop?.address1}, {currentStop?.city}
          </p>
          <div className="grid grid-cols-2 gap-3">
            <a
              href={navMapsUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="flex flex-col items-center gap-2 py-4 rounded-[16px] bg-[#f5f5f3] active:bg-[#e8e8e4] transition-colors"
              onClick={() => setNavSheet(false)}
            >
              <svg width="32" height="32" viewBox="0 0 48 48" fill="none">
                <rect width="48" height="48" rx="12" fill="#4285F4"/>
                <path d="M24 12C18.48 12 14 16.48 14 22c0 7.5 10 20 10 20s10-12.5 10-20c0-5.52-4.48-10-10-10zm0 13.5c-1.93 0-3.5-1.57-3.5-3.5s1.57-3.5 3.5-3.5 3.5 1.57 3.5 3.5-1.57 3.5-3.5 3.5z" fill="white"/>
              </svg>
              <span className="text-sm font-semibold text-[#1a1a2e]">Google Maps</span>
            </a>
            <a
              href={navWazeUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="flex flex-col items-center gap-2 py-4 rounded-[16px] bg-[#f5f5f3] active:bg-[#e8e8e4] transition-colors"
              onClick={() => setNavSheet(false)}
            >
              <svg width="32" height="32" viewBox="0 0 48 48" fill="none">
                <rect width="48" height="48" rx="12" fill="#05C8F7"/>
                <ellipse cx="24" cy="22" rx="12" ry="11" fill="white"/>
                <circle cx="19" cy="25" r="2" fill="#1a1a2e"/>
                <circle cx="29" cy="25" r="2" fill="#1a1a2e"/>
                <path d="M20 29c1.1 1.2 6.9 1.2 8 0" stroke="#1a1a2e" strokeWidth="1.5" strokeLinecap="round"/>
                <circle cx="30" cy="34" r="2.5" fill="white" stroke="#1a1a2e" strokeWidth="1.5"/>
                <circle cx="20" cy="34" r="2.5" fill="white" stroke="#1a1a2e" strokeWidth="1.5"/>
              </svg>
              <span className="text-sm font-semibold text-[#1a1a2e]">Waze</span>
            </a>
          </div>
        </div>
      </div>
    )}
    <div className="w-full flex flex-col" style={{ minHeight: 'calc(100vh - 110px)' }}>
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
        {tourMapsUrl && (
          <a
            href={tourMapsUrl}
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
                i === stopIdx ? 'bg-[#1a1a2e]'
                : s.status === 'delivered' ? 'bg-[#4ade80]'
                : s.status === 'failed' ? 'bg-[#f97316]'
                : 'bg-[#e8e8e4]'
              }`}
            />
          ))}
        </div>

        <div className="flex-1 px-6 py-6 flex flex-col">
          {/* Client + address */}
          <div className="flex-1">
            <div className="flex items-center gap-2 mb-1">
              <span className="font-mono text-sm font-semibold text-[#1a1a2e] bg-[#f5f5f3] px-2 py-0.5 rounded-[6px]">{currentStop.order_name}</span>
            </div>
            <div className="text-3xl font-bold text-[#1a1a2e] leading-tight mb-3">
              {currentStop.customer_name}
            </div>
            <div className="text-lg text-[#1a1a2e] mb-1">{currentStop.address1}</div>
            <div className="text-lg text-[#6b6b63]">{currentStop.city} {currentStop.zip}</div>
            {etaMap.get(currentStop.id) && (
              <div className="mt-2 inline-flex items-center gap-1.5 text-sm font-medium text-[#1a7f4b]">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/></svg>
                Arrivée estimée : {etaMap.get(currentStop.id)}
              </div>
            )}
            <button
              onClick={() => setNavSheet(true)}
              className="mt-3 flex items-center gap-2 px-4 py-2.5 rounded-[12px] bg-[#1a1a2e] text-white text-sm font-semibold active:bg-[#2d2d4e] transition-colors"
            >
              <MapPin size={15} />
              M&apos;y rendre
            </button>

            {/* Products */}
            {currentStop.panel_details?.length > 0 && (
              <div className="mt-6 space-y-2">
                <div className="text-xs font-semibold text-[#6b6b63] uppercase tracking-wide">À déposer</div>
                {currentStop.panel_details.map((item, i) => (
                  <div key={i} className="flex items-center gap-3 bg-[#f5f5f3] rounded-[12px] px-4 py-3">
                    <div className="flex-1 min-w-0">
                      {item.sku?.trim() && (
                        <div className="font-mono text-xs text-[#6b6b63]">{item.sku.trim()}</div>
                      )}
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
        <div className="px-5 pb-5 space-y-2">
          {currentStop.status === 'delivered' ? (
            <>
              <div className="w-full py-4 rounded-[16px] bg-[#d1fae5] text-[#1a7f4b] font-bold text-center text-lg">
                Livré ✓
                {currentStop.delivered_at && (
                  <span className="ml-2 text-sm font-normal opacity-70">
                    {new Date(currentStop.delivered_at).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}
                  </span>
                )}
              </div>
              {currentStop.comment && (
                <div className="rounded-[12px] bg-[#f0fdf4] border border-[#bbf7d0] px-3 py-2">
                  <p className="text-xs text-[#1a7f4b]">💬 {currentStop.comment}</p>
                </div>
              )}
            </>
          ) : currentStop.status === 'failed' ? (
            <>
              <div className="w-full py-4 rounded-[16px] bg-[#fff7ed] text-[#c2680a] font-bold text-center text-lg">
                Non livré — à replanifier
              </div>
              {currentStop.comment && (
                <div className="rounded-[12px] bg-[#fff7ed] border border-[#fed7aa] px-3 py-2">
                  <p className="text-xs text-[#c2680a]">💬 {currentStop.comment}</p>
                </div>
              )}
            </>
          ) : commentMode === 'delivered' ? (
            <div className="space-y-2">
              <p className="text-sm font-semibold text-[#1a1a2e]">Commentaire <span className="text-[#9b9b93] font-normal">(optionnel)</span></p>
              <textarea
                value={pendingComment}
                onChange={(e) => setPendingComment(e.target.value)}
                placeholder="Tout s'est bien passé..."
                className="w-full px-3 py-2.5 text-sm border border-[#e8e8e4] rounded-[12px] outline-none focus:border-[#aeb0c9] resize-none"
                rows={2}
                autoFocus
              />
              <div className="flex gap-2">
                <button
                  onClick={() => { setCommentMode('none'); setPendingComment('') }}
                  className="flex-1 py-3 rounded-[14px] border border-[#e8e8e4] bg-white text-sm font-medium text-[#6b6b63]"
                >
                  Annuler
                </button>
                <button
                  onClick={() => {
                    handleMarkDelivered(pendingComment.trim() || undefined)
                    setCommentMode('none')
                    setPendingComment('')
                  }}
                  disabled={marking}
                  className="flex-[2] py-3 rounded-[14px] bg-[#6b21a8] text-white font-bold text-sm disabled:opacity-60 active:bg-[#7c3aed] transition-colors"
                >
                  {marking ? 'Enregistrement...' : 'Confirmer ✓'}
                </button>
              </div>
            </div>
          ) : commentMode === 'failed' ? (
            <div className="space-y-2">
              <p className="text-sm font-semibold text-[#1a1a2e]">Raison <span className="text-[#c7293a]">*</span></p>
              <div className="flex flex-wrap gap-1.5">
                {['Client absent', 'Refus de livraison', 'Adresse introuvable', 'Mauvais article', 'Autre'].map((chip) => (
                  <button
                    key={chip}
                    onClick={() => { setSelectedChip(chip); setPendingComment(chip) }}
                    className={`px-3 py-1.5 rounded-full text-xs font-medium transition-all ${
                      selectedChip === chip
                        ? 'bg-[#c2680a] text-white'
                        : 'bg-[#fff7ed] text-[#c2680a] border border-[#fed7aa]'
                    }`}
                  >
                    {chip}
                  </button>
                ))}
              </div>
              <textarea
                value={pendingComment}
                onChange={(e) => { setPendingComment(e.target.value); setSelectedChip('') }}
                placeholder="Précisez la situation..."
                className="w-full px-3 py-2.5 text-sm border border-[#e8e8e4] rounded-[12px] outline-none focus:border-[#aeb0c9] resize-none"
                rows={2}
              />
              <div className="flex gap-2">
                <button
                  onClick={() => { setCommentMode('none'); setPendingComment(''); setSelectedChip('') }}
                  className="flex-1 py-3 rounded-[14px] border border-[#e8e8e4] bg-white text-sm font-medium text-[#6b6b63]"
                >
                  Annuler
                </button>
                <button
                  onClick={() => {
                    if (!pendingComment.trim()) return
                    handleMarkFailed(pendingComment.trim())
                    setCommentMode('none')
                    setPendingComment('')
                    setSelectedChip('')
                  }}
                  disabled={!pendingComment.trim() || marking}
                  className="flex-[2] py-3 rounded-[14px] bg-[#c2680a] text-white font-bold text-sm disabled:opacity-50 active:bg-[#b45309] transition-colors"
                >
                  {marking ? 'Enregistrement...' : 'Confirmer'}
                </button>
              </div>
            </div>
          ) : (
            <>
              <button
                onClick={() => setCommentMode('delivered')}
                disabled={marking}
                className="w-full py-5 rounded-[16px] bg-[#6b21a8] text-white font-bold text-lg disabled:opacity-60 active:bg-[#7c3aed] transition-colors"
              >
                Marquer comme livré
              </button>
              <button
                onClick={() => setCommentMode('failed')}
                disabled={marking}
                className="w-full py-3 rounded-[16px] border border-[#e8e8e4] bg-white text-[#c2680a] font-semibold text-sm disabled:opacity-60 active:bg-[#fff7ed] transition-colors"
              >
                Non livré — reporter
              </button>
            </>
          )}
        </div>
      </div>
    </div>
    </>
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
  delivered_at: string | null
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
  comment?: string | null
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
    // Build summary in actual delivery order: delivered (by delivered_at ASC) then remaining (by sequence)
    const tourStopsSummary: SavStopSummary[] = [
      ...stops
        .filter((s: TourStop) => s.status === 'delivered')
        .sort((a: TourStop, b: TourStop) =>
          (a.delivered_at ?? '').localeCompare(b.delivered_at ?? '')),
      ...stops
        .filter((s: TourStop) => s.status !== 'delivered')
        .sort((a: TourStop, b: TourStop) => a.sequence - b.sequence),
    ].map((s: TourStop) => ({
      city: s.city, order_name: s.order_name, status: s.status, delivered_at: s.delivered_at ?? null,
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
        delivered_at: stop.delivered_at ?? null, comment: stop.comment ?? null, sav_status,
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
            const stops      = rep.tour_stops_summary
            const total      = rep.tour_total_stops
            const done       = rep.tour_delivered_stops
            const pct        = total > 0 ? Math.round((done / total) * 100) : 0
            const currentIdx = stops.findIndex(s => s.status !== 'delivered')
            const weekNum = rep.tour_planned_date ? getISOWeekNum(rep.tour_planned_date) : null

            // Progress line width: from left edge to midpoint between last delivered and next stop
            const lineWidth = done > 0 && total > 0
              ? `${done / total * 100}%`
              : '0%'

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

                      {/* Pulsing dot at the tip of the green bar (driver position) */}
                      {done > 0 && done < total && (
                        <div
                          className="absolute top-[16px] z-20 -translate-y-1/2 -translate-x-1/2 transition-[left] duration-700 ease-in-out"
                          style={{ left: lineWidth }}
                        >
                          <div className="relative flex items-center justify-center">
                            <div className="absolute w-4 h-4 rounded-full bg-[#1a7f4b] animate-ping opacity-40" />
                            <div className="w-2.5 h-2.5 rounded-full bg-[#1a7f4b]" />
                          </div>
                        </div>
                      )}

                      {/* Stop circles */}
                      {stops.map((s, i) => {
                        const isDelivered = s.status === 'delivered'
                        const isCurrent   = i === currentIdx
                        return (
                          <div key={i} className="relative flex flex-col items-center flex-1 pt-0">
                            <div className="relative flex items-center justify-center">
                              <div
                                className={`relative z-10 w-8 h-8 rounded-full border-2 flex items-center justify-center transition-all duration-500 ${
                                  isDelivered
                                    ? 'bg-[#1a7f4b] border-[#1a7f4b]'
                                    : isCurrent
                                    ? 'bg-[#4b5563] border-[#4b5563]'
                                    : 'bg-white border-[#d1d5db]'
                                }`}
                              >
                                {isDelivered && (
                                  <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                                    <path d="M2 6L5 9L10 3" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                                  </svg>
                                )}
                              </div>
                            </div>
                            {/* City */}
                            <span className={`mt-2 text-[10px] font-semibold text-center leading-tight max-w-[68px] truncate ${
                              isDelivered ? 'text-[#1a7f4b]' : isCurrent ? 'text-[#1a1a2e]' : 'text-[#6b6b63]'
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

                {/* Mini-carte position Khalid */}
                {(() => {
                  const tourStops = entries
                    .filter(e => e.tour_name === rep.tour_name && e.stop_status !== null)
                    .sort((a, b) => a.stop_sequence - b.stop_sequence)
                    .map(e => ({
                      id: e.id,
                      address1: e.address1,
                      city: e.city,
                      zip: e.zip,
                      customer_name: e.customer_name,
                      status: e.stop_status!,
                      delivered_at: e.delivered_at,
                    }))
                  const hasDelivered = tourStops.some(s => s.status === 'delivered')
                  if (!hasDelivered) return null
                  return <SavPositionMap stops={tourStops} />
                })()}

              </div>
            )
          })}
        </div>
      )}

    <div className="flex flex-col md:flex-row gap-4 items-start">
      {/* ── Left: search + list ── */}
      <div className={`flex-shrink-0 ${selected ? 'hidden md:block md:w-[300px]' : 'w-full md:flex-1 md:max-w-xl'}`}>
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
            <div className="space-y-1.5 max-h-80 md:max-h-[calc(100vh-260px)] overflow-y-auto pr-0.5">
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
          <div className="w-full md:flex-1 min-w-0 rounded-[20px] shadow-[0_2px_16px_rgba(0,0,0,0.06)] bg-white overflow-hidden">
            {/* ── Header ── */}
            <div className="px-5 pt-5 pb-4 border-b border-[#f0f0ee]">
              {/* Mobile back button */}
              <button
                className="md:hidden flex items-center gap-1 text-xs text-[#6b6b63] mb-3"
                onClick={() => setSelected(null)}
              >
                <ChevronLeft size={14} />
                Retour aux résultats
              </button>
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

              {/* ── Commentaire livreur ── */}
              {selected.comment && (
                <div>
                  <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-[#9b9b93] mb-1.5">Note du livreur</p>
                  <div className={`rounded-[12px] border px-3 py-2.5 ${
                    selected.stop_status === 'failed'
                      ? 'bg-[#fff7ed] border-[#fed7aa]'
                      : 'bg-[#f0fdf4] border-[#bbf7d0]'
                  }`}>
                    <p className={`text-xs ${selected.stop_status === 'failed' ? 'text-[#c2680a]' : 'text-[#1a7f4b]'}`}>
                      💬 {selected.comment}
                    </p>
                  </div>
                </div>
              )}

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
