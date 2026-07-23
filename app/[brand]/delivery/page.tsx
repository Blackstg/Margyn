'use client'

export const dynamic = 'force-dynamic'

import { useState, useEffect, useCallback, useRef, useMemo, Suspense } from 'react'
import nextDynamic from 'next/dynamic'
import { useRouter, useSearchParams } from 'next/navigation'
import { createBrowserClient } from '@supabase/auth-helpers-nextjs'
import { useBrand } from '@/context/BrandContext'
import { geoAddress, streetLine } from '@/lib/delivery/geo'
import { geocodeParts } from '@/lib/delivery/geocode'
import { ChevronDown, ChevronUp, ChevronLeft, ChevronRight, Trash2, Mail, Plus, X, MapPin, Package, Truck, Map as MapIcon, Search, Pencil, Check, MessageSquare, GripVertical, Printer, RefreshCw, Clock } from 'lucide-react'
import {
  DndContext, DragEndEvent, DragOverlay, DragStartEvent,
  PointerSensor, TouchSensor, closestCenter, useSensor, useSensors,
} from '@dnd-kit/core'
import {
  SortableContext, arrayMove, useSortable, verticalListSortingStrategy,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'

const TourMap            = nextDynamic(() => import('@/components/delivery/TourMap'),            { ssr: false })
const OrdersMap          = nextDynamic(() => import('@/components/delivery/OrdersMap'),          { ssr: false })
const SavPositionMap     = nextDynamic(() => import('@/components/delivery/SavPositionMap'),     { ssr: false })
const StatsView          = nextDynamic(() => import('@/components/delivery/StatsView'),          { ssr: false })
const ToursMap           = nextDynamic(() => import('@/components/delivery/ToursMap'),           { ssr: false })
const LivreurOverviewMap = nextDynamic(() => import('@/components/delivery/LivreurOverviewMap'), { ssr: false })

// ─── Types ────────────────────────────────────────────────────────────────────

type Zone = 'nord-est' | 'nord-ouest' | 'sud-est' | 'sud-ouest'
type TourStatus = 'draft' | 'planned' | 'in_progress' | 'completed' | 'cancelled'
type StopStatus = 'pending' | 'delivered' | 'failed' | 'partial'

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
  is_accessory_only?: boolean
  needs_replan?: boolean
  address1: string
  address2?: string
  city: string
  zip: string
  lat?: number | null
  lng?: number | null
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
  phone?: string | null
  address1: string
  address2?: string
  city: string
  zip: string
  lat?: number | null
  lng?: number | null
  zone: Zone
  sequence: number
  panel_count: number
  panel_details: PanelItem[]
  status: StopStatus
  email_sent_at: string | null
  delivered_at: string | null
  satisfaction_sent_at?: string | null
  comment?: string | null
  comment_at?: string | null
  sav_note?: string | null
  sav_note_at?: string | null
  signature_url?: string | null
  photo_url?: string | null
  partial_delivered?: { sku: string; title: string; qty_ordered: number; qty_delivered: number }[] | null
  client_availability?: 'confirmed' | 'unavailable' | null
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
  started_at?: string | null
  completed_at?: string | null
  total_km?: number | null
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function formatDate(dateStr: string): string {
  if (!dateStr) return ''
  const d = new Date(dateStr + 'T00:00:00')
  return d.toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric', month: 'short' })
}

function formatDuration(ms: number): string {
  if (ms <= 0) return '—'
  const totalMin = Math.round(ms / 60000)
  const days  = Math.floor(totalMin / (60 * 24))
  const hours = Math.floor((totalMin % (60 * 24)) / 60)
  const mins  = totalMin % 60
  const parts: string[] = []
  if (days  > 0) parts.push(`${days}j`)
  if (hours > 0) parts.push(`${hours}h`)
  if (mins  > 0 || parts.length === 0) parts.push(`${mins}min`)
  return parts.join(' ')
}

// Durée réelle d'une tournée. started_at→completed_at peut s'étaler sur plusieurs
// jours (tournée démarrée puis clôturée un autre jour) → aberrant. Au-delà de 14h
// on se rabat sur la fenêtre réelle des livraisons (1re → dernière livraison).
const MAX_TOUR_MS = 14 * 60 * 60 * 1000
function saneDurationMs(
  startedAt: string | null | undefined,
  completedAt: string | null | undefined,
  stops: { delivered_at?: string | null }[],
): number {
  const times = (stops ?? [])
    .map(s => s.delivered_at).filter(Boolean)
    .map(t => new Date(t as string).getTime())
    .sort((a, b) => a - b)
  const completedMs = completedAt ? new Date(completedAt).getTime() : (times[times.length - 1] ?? 0)
  const startMs     = startedAt   ? new Date(startedAt).getTime()   : (times[0] ?? completedMs)
  let d = completedMs - startMs
  if (d > MAX_TOUR_MS || d < 0) d = times.length >= 2 ? times[times.length - 1] - times[0] : 0
  return d
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

type DeliveryView = 'planificateur' | 'livreur' | 'sav' | 'stats'
const ALL_VIEWS: DeliveryView[] = ['planificateur', 'livreur', 'sav']

const TAB_LABELS: Record<DeliveryView, string> = {
  planificateur: 'Planificateur',
  livreur:       'Livreur',
  sav:           'SAV',
  stats:         'Stats',
}

function DeliveryPageInner() {
  const router = useRouter()
  const brand  = useBrand()
  const searchParams = useSearchParams()
  const [allowedViews, setAllowedViews] = useState<DeliveryView[] | null>(null)

  useEffect(() => {
    const supabase = createBrowserClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
    )
    supabase.auth.getUser().then(({ data }) => {
      const meta  = data.user?.user_metadata
      const views = meta?.delivery_views as string[] | undefined
      const base: DeliveryView[] = views
        ? views.filter((v): v is DeliveryView => ALL_VIEWS.includes(v as DeliveryView))
        : ALL_VIEWS
      // Stats tab is only shown to users who have planificateur access
      const withStats: DeliveryView[] = base.includes('planificateur')
        ? [...base, 'stats']
        : base
      setAllowedViews(withStats)
    })
  }, [])

  const rawView = searchParams.get('view')
  const activeTab: DeliveryView =
    rawView === 'livreur' || rawView === 'sav' || rawView === 'planificateur' || rawView === 'stats'
      ? rawView
      : 'planificateur'

  // Redirect to first allowed tab if current tab is not permitted
  useEffect(() => {
    if (!allowedViews) return
    if (!allowedViews.includes(activeTab)) {
      router.replace(`/${brand}/delivery?view=${allowedViews[0]}`)
    }
  }, [allowedViews, activeTab, router, brand])

  function setActiveTab(tab: DeliveryView) {
    router.replace(`/${brand}/delivery?view=${tab}`)
  }

  // Don't render until we know which views are allowed
  if (!allowedViews) return null

  const effectiveTab  = allowedViews.includes(activeTab) ? activeTab : allowedViews[0]
  const isLivreurOnly = allowedViews.length === 1 && allowedViews[0] === 'livreur'

  // Livreur-only users: truly full-screen native app, no admin chrome
  if (isLivreurOnly) {
    return (
      <div
        className="bg-[#f5f5f3]"
        style={{
          minHeight: '100svh',
          paddingTop:    'env(safe-area-inset-top)',
          paddingBottom: 'env(safe-area-inset-bottom)',
          paddingLeft:   'env(safe-area-inset-left)',
          paddingRight:  'env(safe-area-inset-right)',
        }}
      >
        <LivreurView />
      </div>
    )
  }

  // Stats is full-screen, no outer padding
  if (effectiveTab === 'stats') {
    return (
      <div className="md:pl-[88px] bg-[#f5f5f3] min-h-screen">
        <div className="flex items-center gap-2 px-4 pt-4 pb-0">
          {allowedViews.filter(v => v !== 'stats').map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className="px-3 py-1.5 rounded-[8px] text-sm text-[#6b6b63] hover:text-[#1a1a2e] hover:bg-white transition-all"
            >
              {TAB_LABELS[tab]}
            </button>
          ))}
          <button className="px-3 py-1.5 rounded-[8px] text-sm font-semibold bg-[#1a1a2e] text-white">
            Stats
          </button>
        </div>
        <StatsView />
      </div>
    )
  }

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
                {TAB_LABELS[tab]}
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
  const [laPosteFilter,  setLaPosteFilter]  = useState(false)
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
  const [editingDateTourId, setEditingDateTourId] = useState<string | null>(null)
  const [showHistory, setShowHistory] = useState(false)
  // Deferred orders
  const [deferredOrders, setDeferredOrders] = useState<Map<string, { deferred_until: string | null; note: string | null }>>(new Map())
  const [deferPopover, setDeferPopover] = useState<{ orderName: string; date: string; note: string } | null>(null)
  const [showDeferredSection, setShowDeferredSection] = useState(false)
  const [ordersViewMode, setOrdersViewMode] = useState<'list' | 'map'>('list')
  const [toursViewMode, setToursViewMode] = useState<'list' | 'map'>('list')
  const [syncingStopId, setSyncingStopId] = useState<string | null>(null)

  async function handleSyncStop(stopId: string) {
    setSyncingStopId(stopId)
    try {
      const r = await fetch(`/api/delivery/stops/${stopId}/sync-shopify`, { method: 'POST' })
      const data = await r.json()
      if (data.error) { alert(`Erreur sync : ${data.error}`); return }
      await fetchTours()
    } finally {
      setSyncingStopId(null)
    }
  }

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

  const fetchDeferredOrders = useCallback(async () => {
    try {
      const r = await fetch('/api/delivery/deferred-orders', { cache: 'no-store' })
      const data = await r.json() as { deferred?: { order_name: string; deferred_until: string | null; note: string | null }[] }
      const map = new Map<string, { deferred_until: string | null; note: string | null }>()
      for (const d of data.deferred ?? []) map.set(d.order_name, { deferred_until: d.deferred_until, note: d.note })
      setDeferredOrders(map)
    } catch (e) { console.error(e) }
  }, [])

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
      const r = await fetch('/api/delivery/tours', { cache: 'no-store' })
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
    fetchDeferredOrders()
  }, [fetchOrders, fetchTours, fetchDeferredOrders])

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
      if (deferredOrders.has(o.order_name)) return false  // hide deferred from main list
      if (zoneFilter !== 'all' && o.zone !== zoneFilter) return false
      if (preorderFilter && !o.is_preorder) return false
      if (laPosteFilter  && !o.is_accessory_only) return false
      if (search) {
        const q = search.toLowerCase()
        if (
          !o.order_name.toLowerCase().includes(q) &&
          !o.city.toLowerCase().includes(q) &&
          !(o.email ?? '').toLowerCase().includes(q) &&
          !(o.customer_name ?? '').toLowerCase().includes(q)
        ) return false
      }
      return true
    })
    .sort((a, b) => {
      if (!a.created_at) return 1
      if (!b.created_at) return -1
      return a.created_at.localeCompare(b.created_at)
    })

  const deferredOrdersList = shopifyOrders.filter((o) => deferredOrders.has(o.order_name))

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

  async function handleUpdateTourDate(tourId: string, planned_date: string) {
    setEditingDateTourId(null)
    await fetch(`/api/delivery/tours/${tourId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ planned_date: planned_date || null }),
    })
    await fetchTours()
  }

  async function handleDeferOrder(orderName: string, date: string, note: string) {
    setDeferPopover(null)
    await fetch('/api/delivery/deferred-orders', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ order_name: orderName, deferred_until: date || null, note: note || null }),
    })
    setDeferredOrders(prev => new Map(prev).set(orderName, { deferred_until: date || null, note: note || null }))
  }

  async function handleUndeferOrder(orderName: string) {
    await fetch('/api/delivery/deferred-orders', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ order_name: orderName }),
    })
    setDeferredOrders(prev => { const m = new Map(prev); m.delete(orderName); return m })
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

      // 1. Geocode all stop addresses (address2-aware, see geoAddress)
      const coords: ([number, number] | null)[] = await Promise.all(
        stops.map((s) => geocodeParts(s, token))
      )

      // Filter out stops that failed geocoding
      const validIndices = stops.map((_, i) => i).filter((i) => coords[i] !== null)
      if (validIndices.length < 2) return

      let optimizedIndices: number[]

      if (validIndices.length <= 11) {
        // 2a. Mapbox Optimization API (distances routières réelles). Le dépôt est
        // envoyé UNE seule fois (roundtrip=true revient au départ) → 11 arrêts + dépôt
        // = 12 = limite Mapbox. (Avant : dépôt envoyé 2× → 13 points > 12 → échec.)
        const waypointCoords = validIndices.map((i) => coords[i] as [number, number])
        const coordStr = [DEPOT_COORDS, ...waypointCoords]
          .map(([lng, lat]) => `${lng},${lat}`)
          .join(';')

        const optRes = await fetch(
          `https://api.mapbox.com/optimized-trips/v1/mapbox/driving/${coordStr}?roundtrip=true&source=first&access_token=${token}`
        )
        let mapboxOrder: number[] | null = null
        if (optRes.ok) {
          const optData = await optRes.json()
          // waypoints[] est parallèle aux coords d'entrée [dépôt, stop0, …]. Chaque
          // entrée a waypoint_index = position dans le trajet optimisé (0 = 1er).
          const allWps: { waypoint_index: number }[] = optData.waypoints ?? []
          const stopWps = allWps.slice(1) // enlève le dépôt (position 0)
          const sorted = stopWps
            .map((wp, inputPos) => ({ inputPos, tripPos: wp.waypoint_index }))
            .sort((a, b) => a.tripPos - b.tripPos)
          const order = sorted.map((x) => validIndices[x.inputPos])
          if (order.length === validIndices.length) mapboxOrder = order
        }
        // Repli robuste : nearest-neighbor + 2-opt (à vol d'oiseau) si Mapbox échoue.
        optimizedIndices = mapboxOrder ?? optimizeTSP(DEPOT_COORDS, validIndices, coords as ([number, number] | null)[])
      } else {
        // 2b. > 11 arrêts : nearest-neighbor + 2-opt (supprime les retours en arrière).
        optimizedIndices = optimizeTSP(DEPOT_COORDS, validIndices, coords as ([number, number] | null)[])
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
              <button
                onClick={() => setLaPosteFilter((v) => !v)}
                className={`px-3 py-1 rounded-full text-xs font-medium transition-all ${
                  laPosteFilter
                    ? 'bg-[#e0f2fe] text-[#0369a1] ring-1 ring-[#7dd3fc]'
                    : 'bg-[#f5f5f3] text-[#6b6b63] hover:bg-[#e8e8e4]'
                }`}
              >
                📦 La Poste
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
                  address2: o.address2,
                  city: o.city,
                  zip: o.zip,
                  lat: o.lat,
                  lng: o.lng,
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
                const accessoryOnly = filteredOrders.filter((o) => o.is_accessory_only)
                const tourOrders    = filteredOrders.filter((o) => !o.is_accessory_only)
                const normal        = tourOrders.filter((o) => !o.is_preorder)
                const preorders     = tourOrders
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
                          <div className="flex items-center gap-1.5 shrink-0">
                            <button
                              onClick={(e) => {
                                e.stopPropagation()
                                setDeferPopover({ orderName: order.order_name, date: '', note: '' })
                              }}
                              title="Planifier plus tard"
                              className="p-1 rounded-md text-[#9b9b93] hover:text-[#d97706] hover:bg-[#fff7ed] transition-colors"
                            >
                              <Clock size={14} />
                            </button>
                            <input
                              type="checkbox"
                              readOnly
                              checked={selected}
                              className="mt-1 accent-[#aeb0c9] cursor-pointer shrink-0"
                              onClick={(e) => e.stopPropagation()}
                            />
                          </div>
                        </div>
                        {order.panel_details?.length > 0 && (
                          <div className="mt-2 space-y-0.5">
                            {order.panel_details.map((item, i) => (
                              <div key={i} className="flex items-center gap-1.5 text-[10px]">
                                <span className="font-mono text-[#6b6b63] bg-[#f5f5f3] px-1.5 py-0.5 rounded shrink-0">{item.sku || '—'}</span>
                                <span className="text-[#6b6b63] truncate">{item.title}</span>
                                {item.variant_title && <span className="text-[#1a1a2e] font-medium shrink-0">· {item.variant_title}</span>}
                                <span className="font-semibold text-[#1a1a2e] shrink-0">×{item.qty}</span>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                  )
                }

                function renderAccessoryCard(order: ShopifyOrder) {
                  const daysWaiting = order.created_at
                    ? Math.floor((Date.now() - new Date(order.created_at).getTime()) / 86_400_000)
                    : null
                  return (
                    <div
                      key={order.order_name}
                      className="rounded-[12px] border border-[#e2e8f0] bg-[#f8fafc] overflow-hidden"
                    >
                      <div className="p-3">
                        <div className="flex items-start justify-between gap-2">
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-1.5 flex-wrap">
                              <span className="font-semibold text-sm text-[#1a1a2e]">{order.order_name}</span>
                              <span className="px-2 py-0.5 rounded-full text-xs font-semibold bg-[#e0f2fe] text-[#0369a1]">
                                📦 La Poste
                              </span>
                              {order.is_b2b && (
                                <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-[#dbeafe] text-[#1d4ed8]">B2B</span>
                              )}
                            </div>
                            <div className="text-xs text-[#6b6b63] mt-0.5">{order.customer_name} · {order.city} {order.zip}</div>
                            {order.created_at && (
                              <div className="text-[10px] text-[#9b9b93] mt-0.5">
                                {new Date(order.created_at).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' })}
                                {daysWaiting !== null && <span className="ml-1">({daysWaiting}j)</span>}
                              </div>
                            )}
                          </div>
                        </div>
                        {order.panel_details?.length > 0 && (
                          <div className="mt-2 space-y-0.5">
                            {order.panel_details.map((item, i) => (
                              <div key={i} className="flex items-center gap-1.5 text-[10px]">
                                <span className="font-mono text-[#6b6b63] bg-[#e2e8f0] px-1.5 py-0.5 rounded shrink-0">{item.sku || '—'}</span>
                                <span className="text-[#6b6b63] truncate">{item.title}</span>
                                {item.variant_title && <span className="text-[#1a1a2e] font-medium shrink-0">· {item.variant_title}</span>}
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
                    {accessoryOnly.length > 0 && (
                      <>
                        <div className="flex items-center gap-2 pt-2">
                          <div className="flex-1 h-px bg-[#cbd5e1]" />
                          <span className="text-[10px] font-semibold uppercase tracking-widest text-[#64748b] px-1">
                            Accessoires La Poste ({accessoryOnly.length})
                          </span>
                          <div className="flex-1 h-px bg-[#cbd5e1]" />
                        </div>
                        {accessoryOnly.map(renderAccessoryCard)}
                      </>
                    )}
                  </>
                )
              })()}
            </div>
            )}

            {/* Deferred orders section */}
            {deferredOrdersList.length > 0 && (
              <div className="mt-3">
                <button
                  onClick={() => setShowDeferredSection(v => !v)}
                  className="w-full flex items-center gap-2 px-1 py-1.5 text-left"
                >
                  <div className="flex-1 h-px bg-[#fde68a]" />
                  <span className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-widest text-[#b45309] px-1 whitespace-nowrap">
                    <Clock size={11} />
                    En attente ({deferredOrdersList.length})
                  </span>
                  <div className="flex-1 h-px bg-[#fde68a]" />
                  {showDeferredSection ? <ChevronUp size={12} className="text-[#b45309]" /> : <ChevronDown size={12} className="text-[#b45309]" />}
                </button>

                {showDeferredSection && (
                  <div className="space-y-2 mt-1">
                    {deferredOrdersList.map((order) => {
                      const info = deferredOrders.get(order.order_name)
                      return (
                        <div key={order.order_name} className="rounded-[12px] border border-[#fde68a] bg-[#fffbeb] overflow-hidden">
                          <div className="p-3">
                            <div className="flex items-start justify-between gap-2">
                              <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-1.5 flex-wrap">
                                  <span className="font-semibold text-sm text-[#1a1a2e]">{order.order_name}</span>
                                  <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-[#fef9c3] text-[#92400e]">
                                    <Clock size={9} className="inline mr-0.5" />
                                    {info?.deferred_until
                                      ? `Dispo le ${new Date(info.deferred_until).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' })}`
                                      : 'À planifier plus tard'}
                                  </span>
                                </div>
                                <div className="text-xs text-[#6b6b63] mt-0.5">{order.customer_name} · {order.city} {order.zip}</div>
                                {info?.note && <div className="text-[10px] text-[#92400e] mt-0.5 italic">{info.note}</div>}
                              </div>
                              <button
                                onClick={() => handleUndeferOrder(order.order_name)}
                                title="Remettre dans la liste"
                                className="p-1.5 rounded-md text-[#b45309] hover:bg-[#fde68a] transition-colors shrink-0 text-xs font-medium"
                              >
                                <X size={13} />
                              </button>
                            </div>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                )}
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
                {!showHistory && (
                  <button
                    onClick={() => setToursViewMode(m => m === 'list' ? 'map' : 'list')}
                    className={`flex items-center gap-1.5 px-3 py-1.5 rounded-[10px] text-xs font-medium transition-colors ${
                      toursViewMode === 'map'
                        ? 'bg-[#6366f1] text-white'
                        : 'bg-[#f5f5f3] text-[#6b6b63] hover:bg-[#e8e8e4]'
                    }`}
                  >
                    <MapPin size={12} />
                    {toursViewMode === 'map' ? 'Liste' : 'Carte'}
                  </button>
                )}
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

            {/* Tours map view */}
            {!showHistory && toursViewMode === 'map' && (
              <div className="mb-4">
                <ToursMap
                  tours={tours.filter(t => t.status !== 'completed' && t.status !== 'cancelled').map(t => ({
                    id:           t.id,
                    name:         t.name,
                    driver_name:  t.driver_name,
                    planned_date: t.planned_date,
                    status:       t.status,
                    stops:        t.stops.map(s => ({
                      id:            s.id,
                      order_name:    s.order_name,
                      customer_name: s.customer_name,
                      address1:      s.address1,
                      address2:      s.address2,
                      city:          s.city,
                      zip:           s.zip,
                      lat:           s.lat,
                      lng:           s.lng,
                      panel_count:   s.panel_count,
                      sequence:      s.sequence,
                      status:        s.status,
                    })),
                  }))}
                  height={480}
                />
              </div>
            )}

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
                        (s.email ?? '').toLowerCase().includes(q) ||
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
                            {editingDateTourId === tour.id ? (
                              <div className="mt-0.5" onClick={e => e.stopPropagation()}>
                                <input
                                  type="date"
                                  defaultValue={tour.planned_date ?? ''}
                                  autoFocus
                                  className="text-xs border border-[#d4d4c9] rounded-md px-1.5 py-0.5 bg-white text-[#1a1a2e] focus:outline-none focus:ring-1 focus:ring-[#1a1a2e]"
                                  onChange={e => handleUpdateTourDate(tour.id, e.target.value)}
                                  onBlur={e => handleUpdateTourDate(tour.id, e.target.value)}
                                  onKeyDown={e => { if (e.key === 'Escape') setEditingDateTourId(null) }}
                                />
                              </div>
                            ) : (
                              <div
                                className="flex items-center gap-1 mt-0.5 group/date cursor-pointer"
                                onClick={e => { e.stopPropagation(); setEditingDateTourId(tour.id) }}
                              >
                                <span className="text-xs text-[#6b6b63] capitalize">
                                  {tour.planned_date ? formatDate(tour.planned_date) : <span className="italic opacity-50">Aucune date</span>}
                                </span>
                                <Pencil size={10} className="text-[#6b6b63] opacity-0 group-hover/date:opacity-60 transition-opacity" />
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

                      {/* Tour performance stats (admin) */}
                      {isExpanded && tour.completed_at && (
                        <div className="mx-3 mb-2 rounded-[10px] bg-[#f8f7f5] border border-[#e8e8e4] px-4 py-3 grid grid-cols-4 gap-3 text-center">
                          {(() => {
                            const durationMs = saneDurationMs(tour.started_at, tour.completed_at, tour.stops)
                            const delivered = tour.stops.filter(s => s.status === 'delivered' || s.status === 'partial').length
                            const failed    = tour.stops.filter(s => s.status === 'failed').length
                            const panels    = tour.stops.filter(s => s.status === 'delivered' || s.status === 'partial').reduce((n, s) => n + s.panel_count, 0)
                            return (<>
                              <div>
                                <p className="text-sm font-bold text-[#1a1a2e]">{formatDuration(durationMs)}</p>
                                <p className="text-[10px] text-[#9b9b93] mt-0.5">Durée</p>
                              </div>
                              <div>
                                <p className="text-sm font-bold text-[#1a7f4b]">{delivered}<span className="text-[#c7293a]">/{failed > 0 ? `${failed}✗` : ''}</span></p>
                                <p className="text-[10px] text-[#9b9b93] mt-0.5">Livraisons</p>
                              </div>
                              <div>
                                <p className="text-sm font-bold text-[#1a1a2e]">{panels}</p>
                                <p className="text-[10px] text-[#9b9b93] mt-0.5">Panneaux</p>
                              </div>
                              <div>
                                <p className="text-sm font-bold text-[#1a1a2e]">{tour.total_km ?? '—'} km</p>
                                <p className="text-[10px] text-[#9b9b93] mt-0.5">Distance</p>
                              </div>
                            </>)
                          })()}
                        </div>
                      )}

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
                                      <div className="text-[#6b6b63]">{stop.customer_name} · {stop.zip} {stop.city}</div>
                                      {stop.panel_details?.length > 0 && (
                                        <div className="mt-1 text-[10px] text-[#6b6b63] space-y-0.5">
                                          {stop.panel_details.map((item, i) => (
                                            <div key={i} className="flex items-center gap-1">
                                              <span className="font-mono bg-white border border-[#e8e8e4] px-1 rounded text-[9px] shrink-0">{item.sku?.trim() || '—'}</span>
                                              <span className="truncate">{item.title}</span>
                                              {item.variant_title && <span className="shrink-0 font-medium text-[#1a1a2e]">· {item.variant_title}</span>}
                                              <span className="shrink-0 font-semibold text-[#1a1a2e]">×{item.qty}</span>
                                            </div>
                                          ))}
                                        </div>
                                      )}
                                    </div>
                                    <div className="flex items-center gap-1 shrink-0">
                                      <button
                                        onClick={() => handleSyncStop(stop.id)}
                                        disabled={syncingStopId === stop.id}
                                        title="Resync depuis Shopify"
                                        className="p-0.5 rounded text-[#6b6b63] hover:text-[#1d4ed8] disabled:opacity-40"
                                      >
                                        <RefreshCw size={13} className={syncingStopId === stop.id ? 'animate-spin' : ''} />
                                      </button>
                                      {stop.email_sent_at && (
                                        <Mail size={12} className="text-[#1a7f4b]" />
                                      )}
                                      {stop.client_availability === 'confirmed' && (
                                        <span title="Client confirmé" className="text-[10px] font-bold text-[#1a7f4b] bg-[#dcfce7] px-1.5 py-0.5 rounded-full leading-none">✓ Présent</span>
                                      )}
                                      {stop.client_availability === 'unavailable' && (
                                        <span title="Client indisponible" className="text-[10px] font-bold text-[#c2410c] bg-[#fff7ed] px-1.5 py-0.5 rounded-full leading-none border border-[#fed7aa]">⚠ Indispo</span>
                                      )}
                                      {stop.sav_note && (
                                        <div className="relative group/savnote">
                                          <span className="p-0.5 rounded text-[#d97706] cursor-default text-[11px]">📝</span>
                                          <div className="absolute right-0 bottom-full mb-1.5 w-56 bg-[#78350f] text-white text-[10px] rounded-[8px] p-2.5 hidden group-hover/savnote:block z-20 shadow-lg pointer-events-none">
                                            <p className="font-semibold text-[#fde68a] mb-1">Note SAV</p>
                                            <p className="leading-relaxed">{stop.sav_note}</p>
                                          </div>
                                        </div>
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

    {/* ── Modale reporter une commande ── */}
    {deferPopover && (
      <div
        className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm"
        onClick={() => setDeferPopover(null)}
      >
        <div
          className="bg-white rounded-[20px] shadow-2xl p-6 w-full max-w-sm mx-4"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="flex items-center gap-2 mb-4">
            <div className="w-8 h-8 rounded-full bg-[#fff7ed] flex items-center justify-center shrink-0">
              <Clock size={16} className="text-[#d97706]" />
            </div>
            <div>
              <div className="font-semibold text-[#1a1a2e] text-sm">Planifier plus tard</div>
              <div className="text-xs text-[#6b6b63]">{deferPopover.orderName}</div>
            </div>
          </div>

          <div className="space-y-3">
            <div>
              <label className="block text-xs font-medium text-[#6b6b63] mb-1">
                Client disponible à partir du <span className="font-normal">(optionnel)</span>
              </label>
              <input
                type="date"
                value={deferPopover.date}
                onChange={(e) => setDeferPopover(p => p ? { ...p, date: e.target.value } : p)}
                className="w-full px-3 py-2 text-sm border border-[#e8e8e4] rounded-[10px] outline-none focus:border-[#d97706] transition-colors"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-[#6b6b63] mb-1">
                Note <span className="font-normal">(optionnel)</span>
              </label>
              <textarea
                rows={2}
                placeholder="Ex: rappeler la semaine du 20, client en vacances..."
                value={deferPopover.note}
                onChange={(e) => setDeferPopover(p => p ? { ...p, note: e.target.value } : p)}
                className="w-full px-3 py-2 text-sm border border-[#e8e8e4] rounded-[10px] outline-none focus:border-[#d97706] transition-colors resize-none"
              />
            </div>
          </div>

          <div className="flex gap-2 mt-4">
            <button
              onClick={() => setDeferPopover(null)}
              className="flex-1 px-4 py-2 rounded-[10px] border border-[#e8e8e4] text-sm text-[#6b6b63] hover:bg-[#f5f5f3] transition-colors"
            >
              Annuler
            </button>
            <button
              onClick={() => handleDeferOrder(deferPopover.orderName, deferPopover.date, deferPopover.note)}
              className="flex-1 px-4 py-2 rounded-[10px] bg-[#d97706] text-white text-sm font-medium hover:bg-[#b45309] transition-colors"
            >
              Mettre en attente
            </button>
          </div>
        </div>
      </div>
    )}

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
                  const previewDateStart = notifModal.plannedDate
                    ? formatTourDateFr(notifModal.plannedDate)
                    : notifModal.tourName
                  const previewDateEnd = notifModal.plannedDate
                    ? (() => {
                        const end = new Date(notifModal.plannedDate + 'T00:00:00')
                        end.setDate(end.getDate() + 4)
                        return end.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
                      })()
                    : null
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
                        Notre livreur commencera sa tournée le <strong>{previewDateStart}</strong> et passera chez vous dans les prochains jours (entre le {previewDateStart}{previewDateEnd ? ` et le ${previewDateEnd}` : ''}).</p>
                        <p className="mb-3">La livraison s&apos;effectuera au pied du camion 🚛. Nous vous demandons donc de faire le nécessaire pour être accompagné(e) d&apos;une autre personne afin de récupérer les panneaux en toute sécurité 🔧.</p>
                        <p className="mb-3">Pour garantir une livraison en toute fluidité, notre livreur vous appellera très probablement au fil de sa tournée, en fonction de l&apos;ordre des livraisons, afin de vérifier votre disponibilité. Vous serez joint(e) depuis le numéro suivant : <strong>06 62 63 32 56</strong>.</p>
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

type LivreurScreen = 'home' | 'loading' | 'tour' | 'map' | 'nearby' | 'reorder' | 'celebration' | 'overview-map'

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
        stop.status === 'partial'   ? 'bg-[#d97706] text-white' :
        'bg-[#1a1a2e] text-white'
      }`}>
        {stop.status === 'delivered' ? '✓' : stop.status === 'failed' ? '✕' : stop.status === 'partial' ? '~' : index + 1}
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

// Amélioration 2-opt : part d'un ordre donné (dépôt → arrêts → dépôt) et inverse
// des segments tant que ça raccourcit le trajet total. Élimine les croisements et
// le fameux « aller loin puis revenir » du nearest-neighbor pur. Distances à vol
// d'oiseau (haversine) — pas besoin d'appels API, marche pour tout nombre d'arrêts.
function twoOptImprove(
  depot: [number, number],
  order: number[],
  coords: ([number, number] | null)[]
): number[] {
  const n = order.length
  if (n < 3) return order
  const pt = (idx: number) => coords[idx] as [number, number]
  const route = order.slice()
  let improved = true
  let guard = 0
  while (improved && guard++ < 200) {
    improved = false
    for (let i = 0; i < n - 1; i++) {
      const A = i === 0 ? depot : pt(route[i - 1])
      let ci = pt(route[i])
      for (let j = i + 1; j < n; j++) {
        const B = j === n - 1 ? depot : pt(route[j + 1])
        const cj = pt(route[j])
        // Gain = (arêtes retirées) − (arêtes ajoutées) en inversant le segment i..j
        const delta =
          haversineKm(A, cj) + haversineKm(ci, B) -
          haversineKm(A, ci) - haversineKm(cj, B)
        if (delta < -1e-6) {
          let lo = i, hi = j
          while (lo < hi) { const t = route[lo]; route[lo] = route[hi]; route[hi] = t; lo++; hi-- }
          improved = true
          ci = pt(route[i]) // route[i] a changé après l'inversion
        }
      }
    }
  }
  return route
}

// Trajet optimisé (dépôt → … → dépôt) : nearest-neighbor puis 2-opt.
function optimizeTSP(
  depot: [number, number],
  validIndices: number[],
  coords: ([number, number] | null)[]
): number[] {
  return twoOptImprove(depot, nearestNeighborTSP(depot, validIndices, coords), coords)
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

  // ── GPS tracking (auto au chargement + bandeau d'activation si refusé/iOS) ──
  const driverNameRef  = useRef<string>('')
  const geoIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const [geoNeedsEnable, setGeoNeedsEnable] = useState(false)

  const sendPos = useCallback(async (): Promise<boolean> => {
    if (!navigator?.geolocation || !driverNameRef.current) return false
    try {
      const pos = await new Promise<GeolocationPosition>((ok, err) =>
        navigator.geolocation.getCurrentPosition(ok, err, {
          enableHighAccuracy: true, timeout: 15_000, maximumAge: 60_000,
        })
      )
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const battery = await (navigator as any).getBattery?.().then((b: any) => Math.round(b.level * 100)).catch(() => null)
      await fetch('/api/delivery/location', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          driver_name: driverNameRef.current,
          lat:      pos.coords.latitude,
          lng:      pos.coords.longitude,
          accuracy: pos.coords.accuracy,
          battery,
        }),
      })
      return true
    } catch { return false }
  }, [])

  const startTracking = useCallback(() => {
    if (geoIntervalRef.current) return
    sendPos()
    geoIntervalRef.current = setInterval(() => sendPos(), 5 * 60 * 1000)
  }, [sendPos])

  // Appelé par le bandeau : le tap fournit le geste utilisateur (popup fiable, iOS inclus)
  const enableGeo = useCallback(async () => {
    const ok = await sendPos()
    if (ok) { setGeoNeedsEnable(false); startTracking() }
    else setGeoNeedsEnable(true)
  }, [sendPos, startTracking])

  useEffect(() => {
    if (!navigator?.geolocation) return
    const supabase = createBrowserClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
    )
    let cancelled = false
    supabase.auth.getUser().then(async ({ data }) => {
      if (cancelled) return
      const meta = data.user?.user_metadata
      driverNameRef.current = (meta?.full_name ?? meta?.name ?? data.user?.email ?? 'Inconnu') as string

      let state: PermissionState | 'unknown' = 'unknown'
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const p = await (navigator as any).permissions?.query({ name: 'geolocation' })
        if (p) {
          state = p.state
          p.onchange = () => {
            if (p.state === 'granted') { setGeoNeedsEnable(false); startTracking() }
            else setGeoNeedsEnable(true)
          }
        }
      } catch { /* Permissions API absente (ex. iOS) → on tentera directement */ }

      if (state === 'granted') {
        setGeoNeedsEnable(false)
        startTracking()
      } else if (state === 'denied') {
        setGeoNeedsEnable(true)
      } else {
        // 'prompt' ou inconnu → on déclenche automatiquement le popup natif ; s'il
        // n'est pas encore accordé (refus, ou iOS qui exige un tap), on montre le bandeau.
        setGeoNeedsEnable(true)
        const ok = await sendPos()
        if (ok && !cancelled) { setGeoNeedsEnable(false); startTracking() }
      }
    })
    return () => { cancelled = true; if (geoIntervalRef.current) { clearInterval(geoIntervalRef.current); geoIntervalRef.current = null } }
  }, [sendPos, startTracking])
  const [screen, setScreen] = useState<LivreurScreen>('home')
  const [stopIdx, setStopIdx] = useState(0)
  const [marking, setMarking] = useState(false)
  const [checkedItems, setCheckedItems] = useState<Set<string>>(new Set())
  const [etaMap, setEtaMap] = useState<Map<string, string>>(new Map())
  const [commentMode, setCommentMode] = useState<'none' | 'proof' | 'partial' | 'failed'>('none')
  const [pendingComment, setPendingComment] = useState('')
  const [selectedChip, setSelectedChip] = useState('')
  // Proof capture (signature + photo)
  const signatureCanvasRef = useRef<HTMLCanvasElement>(null)
  const sigDrawing = useRef(false)
  const [hasSignature, setHasSignature] = useState(false)
  const [proofPhoto, setProofPhoto] = useState<File | null>(null)
  const [proofPhotoPreview, setProofPhotoPreview] = useState<string | null>(null)
  const [uploadingProof, setUploadingProof] = useState(false)
  // Partial delivery
  const [partialQtys, setPartialQtys] = useState<Record<number, number>>({})
  const [partialNote, setPartialNote] = useState('')
  const [markingPartial, setMarkingPartial] = useState(false)
  const coordsCache = useRef<Map<string, [number, number]>>(new Map())
  const [navSheet, setNavSheet] = useState(false)
  const [stopListSheet, setStopListSheet] = useState(false)
  const [optimizedOrder, setOptimizedOrder] = useState<string[] | null>(null)
  const [optimizing, setOptimizing] = useState(false)
  const [optimizeError, setOptimizeError] = useState<string | null>(null)
  const [nearbyOrders, setNearbyOrders]   = useState<ShopifyOrder[]>([])
  const [nearbyLoading, setNearbyLoading] = useState(false)
  const [nearbyZoneFilter, setNearbyZoneFilter] = useState<string>('all')
  const [addingOrderName, setAddingOrderName]   = useState<string | null>(null)
  const [addedToTourNames, setAddedToTourNames] = useState<Set<string>>(new Set())
  // Complete tour
  const [confirmComplete, setConfirmComplete] = useState(false)
  const [completingTour, setCompletingTour]   = useState(false)
  // Celebration screen after tour completion
  const [celebrationStats, setCelebrationStats] = useState<{
    durationMs: number; delivered: number; failed: number; panels: number; totalKm: number
  } | null>(null)
  // Upcoming tour preview
  const [expandedUpcomingId, setExpandedUpcomingId] = useState<string | null>(null)

  async function handleCompleteTour() {
    if (!tour) return
    setCompletingTour(true)
    try {
      const completedAt = new Date().toISOString()

      // Distance réelle parcourue : route Mapbox (dépôt → arrêts en séquence → dépôt).
      const stopsInOrder = [...tour.stops].sort((a, b) => a.sequence - b.sequence)
      const orderedCoords = stopsInOrder
        .map(s => coordsCache.current.get(s.id))
        .filter((c): c is [number, number] => !!c)
      let totalKm = 0
      const token = process.env.NEXT_PUBLIC_MAPBOX_TOKEN ?? ''

      // 1) Distance routière réelle via l'API Directions (aller-retour dépôt)
      const wps: [number, number][] = [DEPOT_COORDS, ...orderedCoords, DEPOT_COORDS]
      if (token && orderedCoords.length >= 1 && wps.length <= 25) {
        try {
          const coordStr = wps.map(c => c.join(',')).join(';')
          const res = await fetch(`https://api.mapbox.com/directions/v5/mapbox/driving/${coordStr}?overview=false&access_token=${token}`)
          if (res.ok) {
            const data = await res.json()
            const meters = data.routes?.[0]?.distance
            if (typeof meters === 'number') totalKm = Math.round(meters / 1000)
          }
        } catch { /* repli ci-dessous */ }
      }

      // 2) Repli : haversine plafonné (API indispo ou > 25 waypoints)
      if (totalKm === 0 && orderedCoords.length >= 2) {
        const MAX_LEG_KM = 200
        let km = 0
        for (let i = 0; i < orderedCoords.length - 1; i++) {
          const a = orderedCoords[i], b = orderedCoords[i + 1]
          const R = 6371
          const dLat = (b[1] - a[1]) * Math.PI / 180
          const dLon = (b[0] - a[0]) * Math.PI / 180
          const h = Math.sin(dLat/2)**2 + Math.cos(a[1]*Math.PI/180) * Math.cos(b[1]*Math.PI/180) * Math.sin(dLon/2)**2
          km += Math.min(R * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1-h)), MAX_LEG_KM)
        }
        totalKm = Math.round(km)
      }

      const r = await fetch(`/api/delivery/tours/${tour.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'completed', completed_at: completedAt, total_km: totalKm }),
      })
      if (!r.ok) throw new Error(await r.text())

      // started_at est déjà dans l'état React (chargé au démarrage de la tournée).
      // Le PATCH retourne aussi le tour mis à jour — on le lit pour être sûr.
      const patchData = await r.json() as { tour?: { started_at?: string | null } }
      const startedAt = patchData.tour?.started_at ?? tour.started_at ?? null

      setConfirmComplete(false)

      // Compute stats for celebration screen
      const delivered = stopsInOrder.filter(s => s.status === 'delivered' || s.status === 'partial').length
      const failed    = stopsInOrder.filter(s => s.status === 'failed').length
      const panels    = stopsInOrder
        .filter(s => s.status === 'delivered' || s.status === 'partial')
        .reduce((sum, s) => sum + s.panel_count, 0)

      const durationMs = saneDurationMs(startedAt, completedAt, stopsInOrder)
      setCelebrationStats({ durationMs, delivered, failed, panels, totalKm })
      setScreen('celebration')

      // Rafraîchir la liste des tournées en arrière-plan
      fetchTours()
    } catch (e) {
      console.error(e)
    } finally {
      setCompletingTour(false)
    }
  }

  // Reorder screen state
  const [reorderStops, setReorderStops]     = useState<TourStop[]>([])
  const [reorderSaving, setReorderSaving]   = useState(false)
  const [reorderActiveId, setReorderActiveId] = useState<string | null>(null)
  const reorderSensors = useSensors(
    useSensor(PointerSensor),
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 8 } }),
  )

  const fetchTours = useCallback(async (returnCurrentId?: string): Promise<Tour | undefined> => {
    setLoading(true)
    try {
      const r = await fetch('/api/delivery/tours', { cache: 'no-store' })
      const data = await r.json()
      const today = new Date().toISOString().slice(0, 10)
      const all: Tour[] = (data.tours ?? []).filter((t: Tour) => t.status !== 'cancelled')
      setTours(all)
      let selected: Tour | undefined
      setSelectedTourId(prev => {
        const kept = prev && all.find((t) => t.id === prev) ? prev : (() => {
          const active = all.filter((t: Tour) => t.status !== 'completed')
          // 1. a tour already underway
          const inProgress = active.find((t: Tour) => t.status === 'in_progress')
          if (inProgress) return inProgress.id
          // 2. the current/overdue tour: most recent one due today or earlier and
          //    NOT finished. An unfinished tour must not disappear just because its
          //    planned date passed (what made Khalid "lose" his tour the next day).
          const dueNow = active
            .filter((t: Tour) => t.planned_date && t.planned_date <= today)
            .sort((a: Tour, b: Tour) => b.planned_date.localeCompare(a.planned_date))[0]
          if (dueNow) return dueNow.id
          // 3. otherwise the soonest upcoming tour
          const upcoming = active
            .filter((t: Tour) => t.planned_date && t.planned_date > today)
            .sort((a: Tour, b: Tour) => a.planned_date.localeCompare(b.planned_date))[0]
          return upcoming?.id ?? all[0]?.id ?? prev
        })()
        selected = all.find(t => t.id === (returnCurrentId ?? kept))
        return kept
      })
      return selected
    } catch (e) {
      console.error(e)
    } finally {
      setLoading(false)
    }
  }, [])

  const fetchNearbyOrders = useCallback(async () => {
    setNearbyLoading(true)
    try {
      const [ordersRes, deferredRes] = await Promise.all([
        fetch('/api/delivery/orders', { cache: 'no-store' }),
        fetch('/api/delivery/deferred-orders', { cache: 'no-store' }),
      ])
      const [ordersData, deferredData] = await Promise.all([
        ordersRes.json(),
        deferredRes.json(),
      ])
      const deferredSet = new Set<string>(
        (deferredData.deferred ?? []).map((d: { order_name: string }) => d.order_name)
      )
      const orders = (ordersData.orders ?? []).filter(
        (o: { order_name: string }) => !deferredSet.has(o.order_name)
      )
      setNearbyOrders(orders)
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
          const coord = await geocodeParts(stop, token)
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

  const sortedStops = optimizedOrder
    ? optimizedOrder.map(id => sortedStopsForETA.find(s => s.id === id)).filter(Boolean) as typeof sortedStopsForETA
    : sortedStopsForETA
  const deliveredCount = sortedStops.filter((s) => s.status === 'delivered').length

  // Reset comment state whenever the user navigates to a different stop
  useEffect(() => {
    setCommentMode('none')
    setPendingComment('')
    setSelectedChip('')
    clearSignature()
    setProofPhoto(null)
    setProofPhotoPreview(null)
    setPartialQtys({})
    setPartialNote('')
  }, [stopIdx]) // eslint-disable-line react-hooks/exhaustive-deps

  // Init canvas context style whenever proof mode opens
  useEffect(() => {
    if (commentMode !== 'proof') return
    const canvas = signatureCanvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.strokeStyle = '#1a1a2e'
    ctx.lineWidth   = 2.5
    ctx.lineCap     = 'round'
    ctx.lineJoin    = 'round'
  }, [commentMode])

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

  // ── Optimisation de tournée (nearest-neighbor depuis position GPS) ──────────
  async function optimizeTour() {
    setOptimizing(true)
    setOptimizeError(null)
    try {
      // 1. Position GPS actuelle
      const pos = await new Promise<GeolocationPosition>((ok, err) =>
        navigator.geolocation.getCurrentPosition(ok, err, { enableHighAccuracy: true, timeout: 12_000 })
      )
      const { latitude: driverLat, longitude: driverLng } = pos.coords

      // 2. S'assurer que les coords des arrêts sont en cache (géocodage si besoin)
      const token = process.env.NEXT_PUBLIC_MAPBOX_TOKEN ?? ''
      if (token) {
        await Promise.all(
          sortedStopsForETA.map(async (stop) => {
            if (coordsCache.current.has(stop.id)) return
            const coord = await geocodeParts(stop, token)
            if (coord) coordsCache.current.set(stop.id, coord)
          })
        )
      }

      // 3. Nearest-neighbor — arrêts livrés/échoués à la fin, dans leur ordre d'origine
      function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number) {
        const R = 6371
        const dLat = (lat2 - lat1) * Math.PI / 180
        const dLng = (lng2 - lng1) * Math.PI / 180
        const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLng / 2) ** 2
        return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
      }

      const done    = sortedStopsForETA.filter(s => s.status === 'delivered' || s.status === 'failed')
      const pending = sortedStopsForETA.filter(s => s.status !== 'delivered' && s.status !== 'failed')

      let curLat = driverLat
      let curLng = driverLng
      const ordered: typeof pending = []
      const remaining = [...pending]

      while (remaining.length > 0) {
        let nearestIdx = 0
        let minDist = Infinity
        for (let i = 0; i < remaining.length; i++) {
          const coord = coordsCache.current.get(remaining[i].id)
          if (!coord) continue
          const [lng, lat] = coord  // Mapbox: [lng, lat]
          const d = haversineKm(curLat, curLng, lat, lng)
          if (d < minDist) { minDist = d; nearestIdx = i }
        }
        const stop = remaining.splice(nearestIdx, 1)[0]
        ordered.push(stop)
        const coord = coordsCache.current.get(stop.id)
        if (coord) { curLng = coord[0]; curLat = coord[1] }
      }

      // Stops à livrer en premier, déjà livrés/échoués à la fin
      const newOrder = [...ordered, ...done].map(s => s.id)
      setOptimizedOrder(newOrder)
      setStopIdx(0)
      setStopListSheet(false)
    } catch (err) {
      const isGeoErr = typeof GeolocationPositionError !== 'undefined' && err instanceof GeolocationPositionError
      if (isGeoErr) {
        const msgs = [
          'Localisation refusée — autorise l\'accès dans les réglages du téléphone',
          'Position GPS indisponible',
          'GPS trop lent — réessaie à l\'extérieur',
        ]
        setOptimizeError(msgs[(err as GeolocationPositionError).code - 1] ?? 'Erreur GPS')
      } else {
        setOptimizeError('Impossible d\'obtenir ta position')
      }
    } finally {
      setOptimizing(false)
    }
  }

  // Full-tour Maps URL: depot → all pending stops in order
  const tourMapsUrl = (() => {
    const pending = sortedStops.filter((s) => s.status !== 'delivered' && s.status !== 'failed')
    if (pending.length === 0) return ''
    const waypoints = pending.map((s) => encodeURIComponent(geoAddress(s)))
    return `https://www.google.com/maps/dir/${encodeURIComponent(DEPOT)}/${waypoints.join('/')}`
  })()

  async function handleMarkDelivered(opts: {
    comment?: string
    signature_url?: string
    photo_url?: string
  } = {}) {
    if (!currentStop) return
    setMarking(true)
    await fetch(`/api/delivery/stops/${currentStop.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'delivered', ...opts }),
    })
    await fetchTours()
    setMarking(false)
    // Auto-advance
    setTours(latestTours => {
      const latestTour = latestTours.find(t => t.id === selectedTourId)
      if (!latestTour) return latestTours
      const fresh = [...latestTour.stops].sort((a, b) => a.sequence - b.sequence)
      const nextIdx = fresh.findIndex((s, i) => i > stopIdx && s.status !== 'delivered' && s.status !== 'failed')
      if (nextIdx !== -1) setStopIdx(nextIdx)
      return latestTours
    })
  }

  function clearSignature() {
    const canvas = signatureCanvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.clearRect(0, 0, canvas.width, canvas.height)
    setHasSignature(false)
  }

  function getSigPos(e: React.PointerEvent<HTMLCanvasElement>) {
    const canvas = e.currentTarget
    const rect   = canvas.getBoundingClientRect()
    return {
      x: (e.clientX - rect.left) * (canvas.width  / rect.width),
      y: (e.clientY - rect.top)  * (canvas.height / rect.height),
    }
  }

  function onSigPointerDown(e: React.PointerEvent<HTMLCanvasElement>) {
    e.currentTarget.setPointerCapture(e.pointerId)
    const ctx = signatureCanvasRef.current?.getContext('2d')
    if (!ctx) return
    const { x, y } = getSigPos(e)
    ctx.beginPath()
    ctx.moveTo(x, y)
    sigDrawing.current = true
    setHasSignature(true)
  }

  function onSigPointerMove(e: React.PointerEvent<HTMLCanvasElement>) {
    if (!sigDrawing.current) return
    const ctx = signatureCanvasRef.current?.getContext('2d')
    if (!ctx) return
    const { x, y } = getSigPos(e)
    ctx.lineTo(x, y)
    ctx.stroke()
  }

  function onSigPointerUp() { sigDrawing.current = false }

  async function handleConfirmDelivery() {
    if (!currentStop) return
    setUploadingProof(true)
    try {
      const form = new FormData()
      if (hasSignature && signatureCanvasRef.current) {
        const blob = await new Promise<Blob | null>(resolve =>
          signatureCanvasRef.current!.toBlob(resolve, 'image/png')
        )
        if (blob) form.append('signature', blob, 'signature.png')
      }
      if (proofPhoto) form.append('photo', proofPhoto, proofPhoto.name)

      let signatureUrl: string | undefined
      let photoUrl: string | undefined
      if (form.has('signature') || form.has('photo')) {
        const res  = await fetch(`/api/delivery/stops/${currentStop.id}/upload`, { method: 'POST', body: form })
        const data = await res.json()
        signatureUrl = data.signature_url
        photoUrl     = data.photo_url
      }

      await handleMarkDelivered({
        ...(pendingComment.trim() ? { comment: pendingComment.trim() } : {}),
        ...(signatureUrl ? { signature_url: signatureUrl } : {}),
        ...(photoUrl     ? { photo_url: photoUrl }         : {}),
      })

      // Reset proof state
      clearSignature()
      setProofPhoto(null)
      setProofPhotoPreview(null)
      setPendingComment('')
      setCommentMode('none')
    } finally {
      setUploadingProof(false)
    }
  }

  async function handleMarkPartial() {
    if (!currentStop) return
    setMarkingPartial(true)
    const items = currentStop.panel_details ?? []
    const partial_delivered = items.map((item, i) => ({
      sku:           item.sku,
      title:         item.title,
      qty_ordered:   item.qty,
      qty_delivered: partialQtys[i] ?? item.qty,
    }))
    await fetch(`/api/delivery/stops/${currentStop.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        status: 'partial',
        partial_delivered,
        ...(partialNote.trim() ? { comment: partialNote.trim() } : {}),
      }),
    })
    await fetchTours()
    setMarkingPartial(false)
    setCommentMode('none')
    setPartialQtys({})
    setPartialNote('')
    setTours(latestTours => {
      const latestTour = latestTours.find(t => t.id === selectedTourId)
      if (!latestTour) return latestTours
      const fresh = [...latestTour.stops].sort((a, b) => a.sequence - b.sequence)
      const nextIdx = fresh.findIndex((s, i) => i > stopIdx && s.status !== 'delivered' && s.status !== 'failed' && s.status !== 'partial')
      if (nextIdx !== -1) setStopIdx(nextIdx)
      return latestTours
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

  // ── Screen: celebration ──
  if (screen === 'celebration' && celebrationStats) {
    const { durationMs, delivered, failed, panels, totalKm } = celebrationStats
    return (
      <div className="w-full max-w-md mx-auto flex flex-col items-center gap-6 py-8 px-4">
        {/* Trophy */}
        <div className="text-7xl">🏆</div>
        <div className="text-center">
          <p className="text-2xl font-bold text-[#1a1a2e]">Tournée terminée !</p>
          <p className="text-sm text-[#9b9b93] mt-1">Bravo, voici le résumé de ta journée</p>
        </div>

        {/* Stats grid */}
        <div className="w-full grid grid-cols-2 gap-3">
          <div className="rounded-[18px] bg-[#1a1a2e] px-3 py-5 flex flex-col items-center gap-1 min-w-0">
            <p className="text-2xl font-bold text-[#4ade80] text-center leading-tight break-words max-w-full">{formatDuration(durationMs)}</p>
            <p className="text-[11px] text-white/50 uppercase tracking-wide">Durée</p>
          </div>
          <div className="rounded-[18px] bg-white border border-[#e8e8e4] px-3 py-5 flex flex-col items-center gap-1 min-w-0">
            <p className="text-2xl font-bold text-[#1a1a2e] text-center leading-tight break-words max-w-full">{totalKm} km</p>
            <p className="text-[11px] text-[#9b9b93] uppercase tracking-wide">Parcourus</p>
          </div>
          <div className="rounded-[18px] bg-white border border-[#e8e8e4] px-3 py-5 flex flex-col items-center gap-1 min-w-0">
            <div className="flex items-baseline gap-1.5">
              <p className="text-2xl font-bold text-[#1a1a2e]">{delivered}</p>
              {failed > 0 && <p className="text-sm font-semibold text-red-400">/ {failed} ✗</p>}
            </div>
            <p className="text-[11px] text-[#9b9b93] uppercase tracking-wide">Livraisons</p>
          </div>
          <div className="rounded-[18px] bg-white border border-[#e8e8e4] px-3 py-5 flex flex-col items-center gap-1 min-w-0">
            <p className="text-2xl font-bold text-[#1a1a2e]">{panels}</p>
            <p className="text-[11px] text-[#9b9b93] uppercase tracking-wide">Panneaux</p>
          </div>
        </div>

        <button
          onClick={() => { setCelebrationStats(null); setScreen('home') }}
          className="w-full py-4 rounded-[16px] bg-[#1a1a2e] text-white font-bold text-base active:bg-[#2d2d4a] transition-colors"
        >
          Retour à l&apos;accueil
        </button>
      </div>
    )
  }

  // ── Planned stops for overview map (all active tours) ─────────────────────
  const TOUR_COLORS = ['#6366f1','#0ea5e9','#10b981','#f59e0b','#ef4444','#8b5cf6','#ec4899','#14b8a6']
  const activeToursList = tours.filter(t => t.status !== 'completed' && t.status !== 'cancelled')
  const plannedStops = activeToursList.flatMap((t, ti) =>
    t.stops.map(s => ({
      id:            s.id,
      order_name:    s.order_name,
      customer_name: s.customer_name,
      address1:      s.address1,
      address2:      s.address2,
      city:          s.city,
      zip:           s.zip,
      lat:           s.lat,
      lng:           s.lng,
      panel_count:   s.panel_count,
      status:        s.status,
      tour_name:     t.name,
      tour_color:    TOUR_COLORS[ti % TOUR_COLORS.length],
    }))
  )

  // ── Screen: overview-map ──────────────────────────────────────────────────
  if (screen === 'overview-map') {
    return (
      <div className="w-full flex flex-col" style={{ height: '100dvh' }}>
        {/* Header */}
        <div className="flex items-center gap-3 px-4 pt-4 pb-3 shrink-0">
          <button
            onClick={() => setScreen('home')}
            className="w-10 h-10 rounded-full bg-[#f0f0ee] flex items-center justify-center active:bg-[#e8e8e4]"
          >
            <ChevronLeft size={20} className="text-[#1a1a2e]" />
          </button>
          <div className="flex-1">
            <h2 className="text-base font-bold text-[#1a1a2e]">Carte des commandes</h2>
            <p className="text-xs text-[#9b9b93]">
              {plannedStops.length} planifiée{plannedStops.length !== 1 ? 's' : ''} · {nearbyOrders.length} non planifiée{nearbyOrders.length !== 1 ? 's' : ''}
            </p>
          </div>
        </div>

        {/* Légende */}
        <div className="flex items-center gap-4 px-4 pb-3 flex-wrap shrink-0">
          <div className="flex items-center gap-1.5 text-xs text-[#6b6b63]">
            <span className="w-3 h-3 rounded-full bg-[#6366f1] inline-block" />
            Planifiée (en tournée)
          </div>
          <div className="flex items-center gap-1.5 text-xs text-[#6b6b63]">
            <span className="w-2.5 h-2.5 rounded-sm bg-[#f59e0b] inline-block rotate-45" />
            Non planifiée
          </div>
          <div className="flex items-center gap-1.5 text-xs text-[#6b6b63]">
            <span className="w-2.5 h-2.5 rounded-sm bg-[#a855f7] inline-block rotate-45" />
            Précommande
          </div>
        </div>

        {/* Carte */}
        <div className="flex-1 px-4 pb-6 min-h-0">
          <LivreurOverviewMap
            plannedStops={plannedStops}
            unplannedOrders={nearbyOrders.map(o => ({
              order_name:    o.order_name,
              customer_name: o.customer_name,
              address1:      o.address1,
              address2:      o.address2,
              city:          o.city,
              zip:           o.zip,
              lat:           o.lat,
              lng:           o.lng,
              panel_count:   o.panel_count,
              is_preorder:   o.is_preorder ?? false,
            }))}
          />
        </div>
      </div>
    )
  }

  // ── Screen: home ──
  if (screen === 'home') {
    // Only show active (non-completed, non-cancelled) tours to the driver
    const activeTours = activeToursList
    const upcomingTours = activeTours.filter(t => t.id !== selectedTourId)

    return (
      <div className="w-full space-y-4 px-4 py-4">

        {/* Bandeau d'activation de la position (si non accordée / iOS) */}
        {geoNeedsEnable && (
          <button
            onClick={enableGeo}
            className="w-full flex items-center gap-3 rounded-[16px] bg-[#6366f1] text-white px-4 py-3.5 text-left active:bg-[#4f46e5] transition-colors shadow-[0_4px_16px_rgba(99,102,241,0.35)]"
          >
            <MapPin size={22} className="shrink-0" />
            <div className="flex-1 min-w-0">
              <div className="text-sm font-bold">Activer ma position</div>
              <div className="text-[11px] text-white/80 leading-snug">Touche ici et autorise la localisation pour que l&apos;équipe suive la tournée.</div>
            </div>
            <span className="text-xl leading-none">→</span>
          </button>
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
              {tour.status === 'planned' && (
                <div className="flex items-center gap-2 mb-3">
                  <span className="text-white/40 text-xs font-bold uppercase tracking-widest">Prochaine tournée</span>
                </div>
              )}
              {tour.status === 'draft' && (
                <div className="flex items-center gap-2 mb-3">
                  <span className="text-[#fbbf24] text-xs font-bold uppercase tracking-widest">⏳ En cours de préparation</span>
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
              {tour.status === 'draft' && (
                <div className="w-full py-4 rounded-[16px] bg-[#fbbf24]/10 border border-[#fbbf24]/30 text-center">
                  <p className="text-[#fbbf24] text-sm font-semibold">Tournée en cours de préparation</p>
                  <p className="text-white/40 text-xs mt-1">Le planificateur finalise encore les arrêts</p>
                </div>
              )}
              <button
                onClick={() => setScreen('loading')}
                disabled={tour.status === 'draft'}
                className="w-full flex items-center justify-center gap-3 py-5 rounded-[16px] border border-white/25 text-white font-semibold text-lg active:bg-white/10 disabled:opacity-30 transition-colors"
              >
                <Package size={24} strokeWidth={1.8} />
                Préparer le camion
              </button>
              <button
                onClick={async () => {
                  const resumeIdx = sortedStops.findIndex(s => s.status !== 'delivered' && s.status !== 'failed')
                  setStopIdx(resumeIdx !== -1 ? resumeIdx : 0)
                  setScreen('tour')
                  // Passe la tournée en "en cours" si elle ne l'est pas déjà
                  if (tour && tour.status !== 'in_progress') {
                    await fetch(`/api/delivery/tours/${tour.id}`, {
                      method: 'PATCH',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({ status: 'in_progress', started_at: new Date().toISOString() }),
                    }).catch(() => {/* best-effort */})
                    fetchTours()
                  }
                }}
                disabled={sortedStops.length === 0 || tour.status === 'draft'}
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

              {/* Terminer la tournée */}
              {tour.status !== 'completed' && (
                confirmComplete ? (
                  <div className="rounded-[16px] bg-[#7f1d1d]/40 border border-red-400/30 p-4 space-y-3">
                    <p className="text-white text-sm font-semibold text-center">Terminer et archiver cette tournée ?</p>
                    <p className="text-white/60 text-xs text-center">Cette action est définitive. La tournée passera en statut &ldquo;Terminée&rdquo;.</p>
                    <div className="flex gap-2">
                      <button
                        onClick={() => setConfirmComplete(false)}
                        className="flex-1 py-3 rounded-[12px] border border-white/20 text-white/70 text-sm font-medium active:bg-white/10"
                      >
                        Annuler
                      </button>
                      <button
                        onClick={handleCompleteTour}
                        disabled={completingTour}
                        className="flex-1 py-3 rounded-[12px] bg-red-500 text-white text-sm font-bold disabled:opacity-50 active:bg-red-600"
                      >
                        {completingTour ? 'En cours...' : 'Confirmer'}
                      </button>
                    </div>
                  </div>
                ) : (
                  <button
                    onClick={() => setConfirmComplete(true)}
                    className="w-full flex items-center justify-center gap-3 py-4 rounded-[16px] bg-[#991b1b] text-white font-semibold text-base active:bg-[#7f1d1d] transition-colors"
                  >
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <polyline points="9 11 12 14 22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/>
                    </svg>
                    Terminer la tournée
                  </button>
                )
              )}
            </div>
          </div>
        ) : (
          <div className="w-full rounded-[20px] bg-white py-16 text-center text-base text-[#6b6b63]">
            Aucune tournée disponible
          </div>
        )}

        {/* Upcoming tours */}
        {upcomingTours.length > 0 && (
          <div className="space-y-2">
            <p className="text-xs font-semibold uppercase tracking-widest text-[#9b9b93] px-1">
              Prochaines tournées
            </p>
            {upcomingTours.map(t => {
              const tStops = [...t.stops].sort((a, b) => a.sequence - b.sequence)
              const isExpanded = expandedUpcomingId === t.id
              return (
                <div key={t.id} className="rounded-[18px] bg-white border border-[#e8e8e4] overflow-hidden">
                  {/* Header row */}
                  <button
                    onClick={() => setExpandedUpcomingId(isExpanded ? null : t.id)}
                    className="w-full flex items-center gap-4 px-5 py-4 active:bg-[#f5f5f3] transition-colors text-left"
                  >
                    <div className="w-10 h-10 rounded-full bg-[#f0efec] flex items-center justify-center shrink-0">
                      <Truck size={18} strokeWidth={1.8} className="text-[#6b6b63]" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <p className="text-sm font-bold text-[#1a1a2e] truncate">{t.name}</p>
                        {t.status === 'draft' && (
                          <span className="shrink-0 text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-[#fef3c7] text-[#92400e]">
                            Brouillon
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-[#9b9b93] mt-0.5 capitalize">
                        {t.planned_date ? formatDate(t.planned_date) : 'Sans date'}
                        {' · '}{tStops.length} arrêts · {t.total_panels} panneaux
                      </p>
                    </div>
                    {isExpanded
                      ? <ChevronUp size={16} className="text-[#d0cfc9] shrink-0" />
                      : <ChevronDown size={16} className="text-[#d0cfc9] shrink-0" />}
                  </button>

                  {/* Stops preview */}
                  {isExpanded && (
                    <div className="border-t border-[#f0efec]">
                      {tStops.length === 0
                        ? <p className="px-5 py-4 text-sm text-[#9b9b93]">Aucun arrêt planifié.</p>
                        : tStops.map((s, i) => (
                          <div
                            key={s.id}
                            className="flex items-start gap-3 px-5 py-3 border-b border-[#f0efec] last:border-0"
                          >
                            <span className="w-6 h-6 rounded-full bg-[#f0efec] flex items-center justify-center text-[10px] font-bold text-[#6b6b63] shrink-0 mt-0.5">
                              {i + 1}
                            </span>
                            <div className="flex-1 min-w-0">
                              <p className="text-sm font-semibold text-[#1a1a2e] truncate">{s.customer_name}</p>
                              <p className="text-xs text-[#9b9b93] truncate">{streetLine(s.address1, s.address2)}, {s.city}</p>
                            </div>
                            <div className="text-right shrink-0">
                              <p className="text-sm font-bold text-[#1a1a2e]">{s.panel_count}</p>
                              <p className="text-[10px] text-[#9b9b93]">pan.</p>
                            </div>
                          </div>
                        ))
                      }
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}

        {/* Overview map button */}
        <button
          onClick={() => setScreen('overview-map')}
          className="w-full flex items-center gap-4 px-5 py-4 rounded-[18px] bg-[#eff6ff] border border-[#bfdbfe] active:bg-[#dbeafe] transition-colors"
        >
          <span className="w-10 h-10 rounded-full bg-[#2563eb] flex items-center justify-center shrink-0">
            <MapIcon size={20} strokeWidth={1.8} className="text-white" />
          </span>
          <div className="flex-1 text-left min-w-0">
            <p className="text-sm font-bold text-[#1e3a8a]">Carte des commandes</p>
            <p className="text-xs text-[#1e3a8a]/60">
              {plannedStops.length} planifiée{plannedStops.length !== 1 ? 's' : ''} · {nearbyOrders.length} non planifiée{nearbyOrders.length !== 1 ? 's' : ''}
            </p>
          </div>
          <ChevronRight size={18} className="text-[#2563eb] shrink-0" />
        </button>

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
              address2:         order.address2 ?? '',
              city:             order.city,
              zip:              order.zip,
              zone:             order.zone,
              panel_count:      order.panel_count,
              panel_details:    order.panel_details,
              lat:              order.lat ?? null,
              lng:              order.lng ?? null,
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
            address2:         order.address2 ?? '',
            city:             order.city,
            zip:              order.zip,
            zone:             order.zone,
            panel_count:      order.panel_count,
            panel_details:    order.panel_details,
            lat:              order.lat ?? null,
            lng:              order.lng ?? null,
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
      <div className="w-full px-4 py-4 pb-8">
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
                        <p className="text-sm text-[#6b6b63] mt-0.5">{streetLine(order.address1, order.address2)}</p>
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
                            {item.variant_title && <span className="text-[#6b6b63] font-medium shrink-0">· {item.variant_title}</span>}
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
      <div className="w-full px-4 py-4 pb-10">
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
      <div className="w-full px-4 py-4 pb-28">
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

        {/* Validate button — fixed bottom (respecte la barre d'accueil iPhone) */}
        {allChecked && (
          <div className="fixed bottom-0 left-0 right-0 flex justify-center px-6 pt-3"
            style={{ paddingBottom: 'calc(1.25rem + env(safe-area-inset-bottom))' }}>
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
    ? `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(geoAddress(currentStop))}&travelmode=driving`
    : ''
  const navWazeUrl = currentStop
    ? `https://waze.com/ul?q=${encodeURIComponent(geoAddress(currentStop))}&navigate=yes`
    : ''

  return (
    <>
    {/* Stop list bottom sheet */}
    {stopListSheet && (
      <div
        className="fixed inset-0 z-50 bg-black/40"
        onClick={() => { setStopListSheet(false); setOptimizeError(null) }}
      >
        <div
          className="absolute bottom-0 left-0 right-0 bg-white rounded-t-[24px] shadow-[0_-8px_32px_rgba(0,0,0,0.15)]"
          style={{ maxHeight: '75svh', display: 'flex', flexDirection: 'column' }}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="px-4 pt-5 pb-3 shrink-0">
            <div className="w-10 h-1 bg-[#e8e8e4] rounded-full mx-auto mb-4" />
            <div className="flex items-center justify-between mb-3">
              <p className="text-sm font-bold text-[#1a1a2e]">Arrêts de la tournée</p>
              <span className="text-xs text-[#9b9b93]">{sortedStops.filter(s => s.status === 'delivered').length} / {sortedStops.length} livrés</span>
            </div>
            {/* Bouton optimisation */}
            <button
              onClick={optimizeTour}
              disabled={optimizing}
              className="w-full h-12 rounded-[14px] bg-[#1a7f4b] text-white flex items-center justify-center gap-2.5 font-semibold text-sm active:bg-[#15653c] disabled:opacity-60 transition-colors"
            >
              {optimizing ? (
                <>
                  <svg className="animate-spin" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg>
                  Calcul en cours…
                </>
              ) : (
                <>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/>
                  </svg>
                  {optimizedOrder ? 'Ré-optimiser depuis ici' : 'Optimiser depuis ma position'}
                </>
              )}
            </button>
            {optimizeError && (
              <div className="mt-2 px-3 py-2.5 rounded-[12px] bg-[#fef2f2] border border-[#fecaca] flex items-start gap-2">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#dc2626" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 mt-px"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
                <p className="text-xs text-[#b91c1c] leading-relaxed">{optimizeError}</p>
              </div>
            )}
            {optimizedOrder && (
              <button
                onClick={() => { setOptimizedOrder(null); setStopIdx(0) }}
                className="w-full mt-2 h-10 rounded-[12px] bg-[#f5f5f3] text-[#6b6b63] flex items-center justify-center gap-2 text-xs font-medium active:bg-[#e8e8e4]"
              >
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/></svg>
                Remettre l&apos;ordre original
              </button>
            )}
          </div>
          <div className="overflow-y-auto px-4 pb-10 flex-1">
            {sortedStops.map((stop, i) => (
              <button
                key={stop.id}
                onClick={() => { setStopIdx(i); setStopListSheet(false) }}
                className={`w-full flex items-center gap-3 px-4 py-3 rounded-[14px] mb-2 text-left active:opacity-70 transition-colors ${
                  i === stopIdx ? 'bg-[#1a1a2e] text-white' : 'bg-[#f5f5f3] text-[#1a1a2e]'
                }`}
              >
                <div className={`w-7 h-7 rounded-full flex items-center justify-center shrink-0 text-xs font-bold ${
                  stop.status === 'delivered' ? 'bg-[#4ade80] text-[#14532d]'
                  : stop.status === 'failed'  ? 'bg-[#f97316] text-white'
                  : stop.status === 'partial' ? 'bg-[#fbbf24] text-[#78350f]'
                  : i === stopIdx ? 'bg-white text-[#1a1a2e]'
                  : 'bg-[#e8e8e4] text-[#6b6b63]'
                }`}>
                  {i + 1}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="font-semibold text-sm truncate">{stop.customer_name}</div>
                  <div className={`text-xs truncate ${i === stopIdx ? 'text-white/60' : 'text-[#9b9b93]'}`}>{stop.city}</div>
                </div>
                {stop.status === 'delivered' && (
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#4ade80" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
                )}
                {stop.status === 'failed' && (
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#f97316" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                )}
              </button>
            ))}
          </div>
        </div>
      </div>
    )}

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
            {streetLine(currentStop?.address1, currentStop?.address2)}, {currentStop?.city}
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
    <div className="w-full flex flex-col px-4 py-4" style={{ minHeight: '100svh' }}>
      {/* Top bar: back · counter · liste · maps */}
      <div className="flex items-center gap-2 mb-4">
        {/* Retour */}
        <button
          onClick={() => setScreen('home')}
          className="w-11 h-11 rounded-full bg-white shadow-sm flex items-center justify-center shrink-0 active:bg-[#f5f5f3]"
        >
          <ChevronLeft size={22} />
        </button>

        {/* Compteur centré */}
        <div className="flex-1 text-center">
          <span className="text-base font-bold text-[#1a1a2e]">{stopIdx + 1}</span>
          <span className="text-base font-normal text-[#9b9b93]"> / {sortedStops.length}</span>
        </div>

        {/* Liste */}
        <button
          onClick={() => setStopListSheet(true)}
          className="w-11 h-11 rounded-full bg-[#1a1a2e] text-white flex items-center justify-center shrink-0 active:bg-[#2d2d4e]"
          aria-label="Liste des arrêts"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
            <line x1="8" y1="6" x2="21" y2="6"/>
            <line x1="8" y1="12" x2="21" y2="12"/>
            <line x1="8" y1="18" x2="21" y2="18"/>
            <line x1="3" y1="6" x2="3.01" y2="6"/>
            <line x1="3" y1="12" x2="3.01" y2="12"/>
            <line x1="3" y1="18" x2="3.01" y2="18"/>
          </svg>
        </button>

        {/* Maps — toujours visible même sans tourMapsUrl */}
        {tourMapsUrl ? (
          <a
            href={tourMapsUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="w-11 h-11 rounded-full bg-[#1a7f4b] text-white flex items-center justify-center shrink-0 active:bg-[#15653c]"
            aria-label="Voir la tournée sur Maps"
          >
            <MapPin size={18} />
          </a>
        ) : (
          <div className="w-11 h-11 shrink-0" />
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
                : s.status === 'failed'   ? 'bg-[#f97316]'
                : s.status === 'partial'  ? 'bg-[#fbbf24]'
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
            <div className="text-3xl font-bold text-[#1a1a2e] leading-tight mb-1">
              {currentStop.customer_name}
            </div>
            {currentStop.phone && (
              <a
                href={`tel:${currentStop.phone}`}
                className="inline-flex items-center gap-1.5 text-sm font-semibold text-[#6b21a8] mb-2 active:opacity-70"
              >
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07A19.5 19.5 0 0 1 4.69 12 19.79 19.79 0 0 1 1.61 3.44 2 2 0 0 1 3.58 1.25h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L7.91 8.81A16 16 0 0 0 16 16.91l1.27-.88a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 24 18.18v.74"/></svg>
                {currentStop.phone}
              </a>
            )}
            <div className="text-lg text-[#1a1a2e] mb-1">{streetLine(currentStop.address1, currentStop.address2)}</div>
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
                      {(item.sku?.trim() || item.variant_title) && (
                        <div className="font-mono text-xs text-[#6b6b63]">{item.sku?.trim() || item.variant_title}</div>
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

            {/* Note SAV — visible prominently for the driver */}
            {currentStop.sav_note && (
              <div className="mt-4 rounded-[16px] bg-[#fffbeb] border-2 border-[#fbbf24] px-4 py-3.5">
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-base">📝</span>
                  <span className="text-xs font-bold text-[#92400e] uppercase tracking-wide">Note SAV</span>
                </div>
                <p className="text-sm font-medium text-[#78350f] leading-snug">{currentStop.sav_note}</p>
              </div>
            )}
          </div>

          {/* Navigation arrows */}
          <div className="flex items-center gap-3 mt-6 mb-4">
            <button
              onClick={() => setStopIdx((i) => Math.max(0, i - 1))}
              disabled={stopIdx === 0}
              className="w-14 h-14 rounded-full border-2 border-[#e8e8e4] flex items-center justify-center shrink-0 text-[#1a1a2e] disabled:opacity-25 active:bg-[#f5f5f3] transition-colors"
            >
              <ChevronLeft size={26} />
            </button>
            <button
              onClick={() => setStopListSheet(true)}
              className="flex-1 h-14 rounded-[16px] bg-[#f5f5f3] flex items-center justify-center gap-2 text-[#1a1a2e] font-semibold text-base active:bg-[#e8e8e4] transition-colors"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/>
                <line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/>
              </svg>
              Liste
            </button>
            <button
              onClick={() => setStopIdx((i) => Math.min(sortedStops.length - 1, i + 1))}
              disabled={stopIdx === sortedStops.length - 1}
              className="w-14 h-14 rounded-full border-2 border-[#e8e8e4] flex items-center justify-center shrink-0 text-[#1a1a2e] disabled:opacity-25 active:bg-[#f5f5f3] transition-colors"
            >
              <ChevronRight size={26} />
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
              <button
                onClick={() => {
                  const seed: Record<number, number> = {}
                  const pd = currentStop.partial_delivered
                  if (pd) (currentStop.panel_details ?? []).forEach((item, i) => {
                    const m = pd.find(p => (p.sku && item.sku && p.sku === item.sku) || p.title === item.title)
                    if (m) seed[i] = m.qty_delivered
                  })
                  setPartialQtys(seed); setPartialNote(''); setCommentMode('partial')
                }}
                className="w-full py-2.5 rounded-[12px] border border-[#fed7aa] bg-white text-sm font-semibold text-[#92400e] active:bg-[#fff7ed] transition-colors"
              >
                ↩ Pas tout livré ? Corriger la quantité
              </button>
              {currentStop.comment && (
                <div className="rounded-[12px] bg-[#f0fdf4] border border-[#bbf7d0] px-3 py-2">
                  <p className="text-xs text-[#1a7f4b]">💬 {currentStop.comment}</p>
                </div>
              )}
              {(currentStop.signature_url || currentStop.photo_url) && (
                <div className="flex gap-2">
                  {currentStop.signature_url && (
                    <a href={currentStop.signature_url} target="_blank" rel="noreferrer" className="flex-1">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={currentStop.signature_url} alt="Signature" className="w-full h-16 object-contain rounded-[10px] border border-[#bbf7d0] bg-white" />
                    </a>
                  )}
                  {currentStop.photo_url && (
                    <a href={currentStop.photo_url} target="_blank" rel="noreferrer" className="flex-1">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={currentStop.photo_url} alt="Photo colis" className="w-full h-16 object-cover rounded-[10px] border border-[#bbf7d0]" />
                    </a>
                  )}
                </div>
              )}
            </>
          ) : currentStop.status === 'partial' ? (
            <>
              <div className="w-full py-4 rounded-[16px] bg-[#fef3c7] text-[#92400e] font-bold text-center text-base">
                ⚠ Livraison partielle — à replanifier
              </div>
              {currentStop.partial_delivered && (
                <div className="space-y-1">
                  {currentStop.partial_delivered.map((item, i) => (
                    <div key={i} className={`flex items-center gap-2 rounded-[10px] px-3 py-2 text-xs ${item.qty_delivered < item.qty_ordered ? 'bg-[#fff7ed] border border-[#fed7aa]' : 'bg-[#f5f5f3]'}`}>
                      <span className="flex-1 truncate text-[#1a1a2e]">{item.title}</span>
                      <span className={`font-semibold shrink-0 ${item.qty_delivered < item.qty_ordered ? 'text-[#c2680a]' : 'text-[#1a7f4b]'}`}>
                        {item.qty_delivered}/{item.qty_ordered}
                      </span>
                    </div>
                  ))}
                </div>
              )}
              <button
                onClick={() => {
                  const seed: Record<number, number> = {}
                  const pd = currentStop.partial_delivered
                  if (pd) (currentStop.panel_details ?? []).forEach((item, i) => {
                    const m = pd.find(p => (p.sku && item.sku && p.sku === item.sku) || p.title === item.title)
                    if (m) seed[i] = m.qty_delivered
                  })
                  setPartialQtys(seed); setPartialNote(''); setCommentMode('partial')
                }}
                className="w-full py-2.5 rounded-[12px] border border-[#fed7aa] bg-white text-sm font-semibold text-[#92400e] active:bg-[#fff7ed] transition-colors"
              >
                ↩ Corriger la quantité livrée
              </button>
              {currentStop.comment && (
                <div className="rounded-[12px] bg-[#fff7ed] border border-[#fed7aa] px-3 py-2">
                  <p className="text-xs text-[#c2680a]">💬 {currentStop.comment}</p>
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
          ) : commentMode === 'proof' ? (
            <div className="space-y-3">
              <p className="text-sm font-bold text-[#1a1a2e]">Preuve de livraison</p>

              {/* Signature */}
              <div>
                <div className="flex items-center justify-between mb-1">
                  <p className="text-xs font-semibold text-[#6b6b63] uppercase tracking-wide">Signature client</p>
                  {hasSignature && (
                    <button
                      onClick={clearSignature}
                      className="text-[10px] text-[#c2680a] font-medium px-2 py-0.5 rounded-full bg-[#fff7ed]"
                    >
                      Effacer
                    </button>
                  )}
                </div>
                <div className="rounded-[12px] border-2 border-dashed border-[#d1d5db] bg-white overflow-hidden">
                  <canvas
                    ref={signatureCanvasRef}
                    width={600}
                    height={180}
                    style={{ width: '100%', height: '120px', touchAction: 'none', display: 'block', cursor: 'crosshair' }}
                    onPointerDown={onSigPointerDown}
                    onPointerMove={onSigPointerMove}
                    onPointerUp={onSigPointerUp}
                    onPointerLeave={onSigPointerUp}
                  />
                </div>
                {!hasSignature && (
                  <p className="text-center text-[10px] text-[#9b9b93] mt-1">Faites signer le client dans le cadre ci-dessus</p>
                )}
              </div>

              {/* Photo */}
              <div>
                <p className="text-xs font-semibold text-[#6b6b63] uppercase tracking-wide mb-1">Photo du colis déposé</p>
                {proofPhotoPreview ? (
                  <div className="relative rounded-[12px] overflow-hidden">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={proofPhotoPreview} alt="Preuve" className="w-full max-h-40 object-cover" />
                    <button
                      onClick={() => { setProofPhoto(null); setProofPhotoPreview(null) }}
                      className="absolute top-2 right-2 bg-black/50 rounded-full p-1 text-white"
                    >
                      <X size={14} />
                    </button>
                  </div>
                ) : (
                  <label className="flex items-center justify-center gap-2 w-full py-4 rounded-[12px] border-2 border-dashed border-[#d1d5db] bg-white cursor-pointer active:bg-[#f9fafb]">
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-[#6b6b63]">
                      <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/>
                      <circle cx="12" cy="13" r="4"/>
                    </svg>
                    <span className="text-sm font-medium text-[#6b6b63]">Prendre une photo</span>
                    <input
                      type="file"
                      accept="image/*"
                      capture="environment"
                      className="hidden"
                      onChange={(e) => {
                        const file = e.target.files?.[0] ?? null
                        setProofPhoto(file)
                        if (file) setProofPhotoPreview(URL.createObjectURL(file))
                      }}
                    />
                  </label>
                )}
              </div>

              {/* Optional comment */}
              <textarea
                value={pendingComment}
                onChange={(e) => setPendingComment(e.target.value)}
                placeholder="Commentaire (optionnel)..."
                className="w-full px-3 py-2.5 text-sm border border-[#e8e8e4] rounded-[12px] outline-none focus:border-[#aeb0c9] resize-none"
                rows={2}
              />

              <div className="flex gap-2">
                <button
                  onClick={() => {
                    setCommentMode('none')
                    setPendingComment('')
                    clearSignature()
                    setProofPhoto(null)
                    setProofPhotoPreview(null)
                  }}
                  className="flex-1 py-3 rounded-[14px] border border-[#e8e8e4] bg-white text-sm font-medium text-[#6b6b63]"
                >
                  Annuler
                </button>
                <button
                  onClick={handleConfirmDelivery}
                  disabled={uploadingProof || marking}
                  className="flex-[2] py-3 rounded-[14px] bg-[#6b21a8] text-white font-bold text-sm disabled:opacity-60 active:bg-[#7c3aed] transition-colors"
                >
                  {uploadingProof ? 'Envoi...' : marking ? 'Enregistrement...' : 'Confirmer ✓'}
                </button>
              </div>
            </div>
          ) : commentMode === 'partial' ? (
            <div className="space-y-3">
              <p className="text-sm font-bold text-[#1a1a2e]">Livraison partielle — quantités livrées</p>
              <div className="space-y-2">
                {(currentStop.panel_details ?? []).map((item, i) => {
                  const delivered = partialQtys[i] ?? item.qty
                  const isShort   = delivered < item.qty
                  return (
                    <div key={i} className={`flex items-center gap-3 rounded-[12px] px-3 py-2.5 border ${isShort ? 'bg-[#fff7ed] border-[#fed7aa]' : 'bg-[#f5f5f3] border-transparent'}`}>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-[#1a1a2e] truncate">{item.title}</p>
                        {(item.sku || item.variant_title) && <p className="text-[10px] text-[#9b9b93] font-mono">{item.sku || item.variant_title}</p>}
                        {isShort && <p className="text-[10px] text-[#c2680a] font-semibold">Manque {item.qty - delivered}</p>}
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <button
                          onClick={() => setPartialQtys(q => ({ ...q, [i]: Math.max(0, (q[i] ?? item.qty) - 1) }))}
                          disabled={delivered <= 0}
                          className="w-8 h-8 rounded-full border border-[#e8e8e4] bg-white text-lg font-bold leading-none disabled:opacity-30 active:bg-[#f5f5f3] flex items-center justify-center"
                        >−</button>
                        <span className={`w-8 text-center text-base font-bold ${isShort ? 'text-[#c2680a]' : 'text-[#1a1a2e]'}`}>{delivered}</span>
                        <button
                          onClick={() => setPartialQtys(q => ({ ...q, [i]: Math.min(item.qty, (q[i] ?? item.qty) + 1) }))}
                          disabled={delivered >= item.qty}
                          className="w-8 h-8 rounded-full border border-[#e8e8e4] bg-white text-lg font-bold leading-none disabled:opacity-30 active:bg-[#f5f5f3] flex items-center justify-center"
                        >+</button>
                        <span className="text-xs text-[#9b9b93]">/{item.qty}</span>
                      </div>
                    </div>
                  )
                })}
              </div>
              <div className="flex flex-wrap gap-1.5">
                {['Article endommagé', 'Article manquant', 'Refus partiel', 'Autre'].map((chip) => (
                  <button
                    key={chip}
                    onClick={() => setPartialNote(chip)}
                    className={`px-3 py-1.5 rounded-full text-xs font-medium transition-all ${
                      partialNote === chip ? 'bg-[#c2680a] text-white' : 'bg-[#fff7ed] text-[#c2680a] border border-[#fed7aa]'
                    }`}
                  >{chip}</button>
                ))}
              </div>
              <textarea
                value={partialNote}
                onChange={(e) => setPartialNote(e.target.value)}
                placeholder="Précisez la situation..."
                className="w-full px-3 py-2.5 text-sm border border-[#e8e8e4] rounded-[12px] outline-none focus:border-[#aeb0c9] resize-none"
                rows={2}
              />
              <div className="flex gap-2">
                <button
                  onClick={() => { setCommentMode('none'); setPartialQtys({}); setPartialNote('') }}
                  className="flex-1 py-3 rounded-[14px] border border-[#e8e8e4] bg-white text-sm font-medium text-[#6b6b63]"
                >Annuler</button>
                <button
                  onClick={handleMarkPartial}
                  disabled={markingPartial || (currentStop.panel_details ?? []).every((item, i) => (partialQtys[i] ?? item.qty) === item.qty)}
                  className="flex-[2] py-3 rounded-[14px] bg-[#c2680a] text-white font-bold text-sm disabled:opacity-50 active:bg-[#b45309] transition-colors"
                >
                  {markingPartial ? 'Enregistrement...' : 'Confirmer livraison partielle'}
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
                onClick={() => setCommentMode('proof')}
                disabled={marking}
                className="w-full py-5 rounded-[16px] bg-[#6b21a8] text-white font-bold text-lg disabled:opacity-60 active:bg-[#7c3aed] transition-colors"
              >
                Marquer comme livré
              </button>
              <button
                onClick={() => {
                  const items = currentStop?.panel_details ?? []
                  setPartialQtys(Object.fromEntries(items.map((item, i) => [i, item.qty])))
                  setCommentMode('partial')
                }}
                disabled={marking || !currentStop?.panel_details?.length}
                className="w-full py-3 rounded-[16px] border border-[#fed7aa] bg-[#fff7ed] text-[#c2680a] font-semibold text-sm disabled:opacity-40 active:bg-[#fef3c7] transition-colors"
              >
                Livraison partielle
              </button>
              <button
                onClick={() => setCommentMode('failed')}
                disabled={marking}
                className="w-full py-3 rounded-[16px] border border-[#e8e8e4] bg-white text-[#6b6b63] font-semibold text-sm disabled:opacity-60 active:bg-[#f5f5f3] transition-colors"
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

// ─── StepperScroll — scrollable stepper with gradient fade + pending badge ────

function StepperScroll({ children, stops }: {
  children: React.ReactNode
  stops: { status: string }[]
}) {
  const scrollRef  = useRef<HTMLDivElement>(null)
  const [leftFade,  setLeftFade]  = useState(false)
  const [rightFade, setRightFade] = useState(false)

  const pendingCount = stops.filter(s => s.status !== 'delivered' && s.status !== 'failed' && s.status !== 'partial').length

  // Detect overflow on mount and whenever stops change
  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const update = () => {
      setLeftFade(el.scrollLeft > 8)
      setRightFade(el.scrollLeft < el.scrollWidth - el.clientWidth - 8)
    }
    update()
    // Auto-scroll to first pending stop (show context: at least one delivered stop before it)
    const firstPendingIdx = stops.findIndex(s => s.status !== 'delivered' && s.status !== 'failed' && s.status !== 'partial')
    if (firstPendingIdx > 1) {
      const stopWidth = el.scrollWidth / stops.length
      el.scrollTo({ left: Math.max(0, (firstPendingIdx - 1.5) * stopWidth), behavior: 'smooth' })
    }
  }, [stops]) // eslint-disable-line react-hooks/exhaustive-deps

  function onScroll() {
    const el = scrollRef.current
    if (!el) return
    setLeftFade(el.scrollLeft > 8)
    setRightFade(el.scrollLeft < el.scrollWidth - el.clientWidth - 8)
  }

  return (
    <div className="relative">
      {/* Left fade */}
      {leftFade && (
        <div className="absolute left-0 top-0 bottom-0 w-10 bg-gradient-to-r from-white to-transparent z-10 pointer-events-none" />
      )}
      {/* Right fade + pending badge */}
      {rightFade && (
        <div className="absolute right-0 top-0 bottom-0 w-16 bg-gradient-to-l from-white via-white/80 to-transparent z-30 pointer-events-none flex items-center justify-end pr-2 pb-6">
          {pendingCount > 0 && (
            <span className="flex items-center gap-0.5 bg-[#1a1a2e] text-white text-[9px] font-bold px-1.5 py-0.5 rounded-full shadow-sm whitespace-nowrap">
              {pendingCount} →
            </span>
          )}
        </div>
      )}
      <div ref={scrollRef} className="overflow-x-auto" onScroll={onScroll}
        style={{ scrollbarWidth: 'none' }}>
        {children}
      </div>
    </div>
  )
}

// ─── SAV View ─────────────────────────────────────────────────────────────────

type SavStatus = 'pending' | 'planned' | 'in_progress' | 'delivered' | 'partial'

// SAV-only info — never included in email templates
const DRIVER_PHONES: Record<string, string> = {
  'Khalid': '06 62 89 30 14',
}

interface SavStopSummary {
  city: string
  order_name: string
  status: StopStatus
  delivered_at: string | null
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
  address2?: string
  lat?: number | null
  lng?: number | null
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
  sav_note?: string | null
  signature_url?: string | null
  photo_url?: string | null
  partial_delivered?: { sku: string; title: string; qty_ordered: number; qty_delivered: number }[] | null
  sav_status: SavStatus
}

const SAV_STATUS_CONFIG: Record<SavStatus, { label: string; bg: string; text: string }> = {
  pending:     { label: 'En attente',        bg: '#f5f5f3', text: '#6b6b63' },
  planned:     { label: 'Planifiée',         bg: '#ede9fe', text: '#6d28d9' },
  in_progress: { label: 'En livraison',      bg: '#dbeafe', text: '#1d4ed8' },
  delivered:   { label: 'Livrée',            bg: '#d1fae5', text: '#1a7f4b' },
  partial:     { label: 'Partielle',         bg: '#fef3c7', text: '#92400e' },
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

/**
 * Returns a delivery window: tour start date → start + 4 calendar days.
 * e.g. mercredi 6 mai → dimanche 10 mai
 */
function getWeekRange(dateStr: string): { start: string; end: string } {
  const opts: Intl.DateTimeFormatOptions = { weekday: 'long', day: 'numeric', month: 'long' }
  const start = new Date(dateStr + 'T00:00:00')
  const end   = new Date(start)
  end.setDate(start.getDate() + 4)
  return {
    start: start.toLocaleDateString('fr-FR', opts),
    end:   end.toLocaleDateString('fr-FR', opts),
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
    case 'partial':
      return `Bonjour ${prenom},\n\nNotre livreur a pu déposer une partie de votre commande ${ref}. Les articles manquants seront reprogrammés dès que possible. Nous vous contacterons pour convenir d'une nouvelle date de livraison.\n\nToutes nos excuses pour la gêne occasionnée.\n\nCordialement,\nL'équipe Bowa`
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
    // Build summary in actual validation order:
    //   1. Delivered + failed stops sorted by delivered_at ASC when both have timestamps.
    //      If either stop is missing delivered_at (old failed stops), fall back to sequence
    //      so they are interleaved at their planned position rather than dumped at the end.
    //   2. Pending stops sorted by sequence (planned order for what's left)
    const doneStops = stops
      .filter((s: TourStop) => s.status === 'delivered' || s.status === 'failed')
      .sort((a: TourStop, b: TourStop) => {
        if (a.delivered_at && b.delivered_at) return a.delivered_at.localeCompare(b.delivered_at)
        // At least one is missing delivered_at → use sequence as positional proxy
        return a.sequence - b.sequence
      })
    const tourStopsSummary: SavStopSummary[] = [
      ...doneStops,
      ...stops
        .filter((s: TourStop) => s.status === 'pending')
        .sort((a: TourStop, b: TourStop) => a.sequence - b.sequence),
    ].map((s: TourStop) => ({
      city: s.city, order_name: s.order_name, status: s.status,
      delivered_at: s.delivered_at ?? null, sequence: s.sequence,
    }))

    for (const stop of stops) {
      let sav_status: SavStatus
      if (stop.status === 'delivered')        sav_status = 'delivered'
      else if (stop.status === 'partial')     sav_status = 'partial'
      else if (tour.status === 'in_progress') sav_status = 'in_progress'
      else                                    sav_status = 'planned'

      const stopsBefore = sortedStops.filter(
        (s: TourStop) => s.sequence < stop.sequence && s.status !== 'delivered'
      ).length

      result.push({
        id: stop.id, order_name: stop.order_name, customer_name: stop.customer_name,
        email: stop.email, city: stop.city, zip: stop.zip, zone: stop.zone,
        address1: stop.address1, address2: stop.address2, lat: stop.lat, lng: stop.lng, panel_count: stop.panel_count,
        panel_details: stop.panel_details ?? [],
        tour_name: tour.name, tour_status: tour.status,
        tour_planned_date: tour.planned_date, tour_zone: tour.zone ?? null,
        tour_total_stops: tourTotal, tour_delivered_stops: tourDelivered,
        stops_before: stopsBefore, tour_stops_summary: tourStopsSummary,
        driver_name: tour.driver_name ?? null,
        stop_status: stop.status, stop_sequence: stop.sequence,
        delivered_at: stop.delivered_at ?? null, comment: stop.comment ?? null,
        sav_note: stop.sav_note ?? null,
        signature_url: stop.signature_url ?? null,
        photo_url: stop.photo_url ?? null,
        partial_delivered: stop.partial_delivered ?? null,
        sav_status,
      })
    }
  }

  for (const order of ordersRaw) {
    result.push({
      id: `order-${order.order_name}`, order_name: order.order_name,
      customer_name: order.customer_name, email: order.email,
      city: order.city, zip: order.zip, zone: order.zone, address1: order.address1,
      address2: order.address2, lat: order.lat, lng: order.lng,
      panel_count: order.panel_count, panel_details: order.panel_details ?? [],
      tour_name: null, tour_status: null, tour_planned_date: null, tour_zone: null,
      tour_total_stops: 0, tour_delivered_stops: 0, stops_before: 0,
      tour_stops_summary: [], driver_name: null,
      stop_status: null, stop_sequence: 0, delivered_at: null, sav_status: 'pending',
    })
  }

  return result
}

// Corrige la quantité réellement livrée d'un arrêt (planif) → convertit en
// livraison partielle si tout n'a pas été livré, et le reliquat réapparaît
// automatiquement dans « à planifier ». Réutilise le champ partial_delivered.
function CorrectDeliveryModal({
  stopId, orderName, items, onClose, onDone,
}: {
  stopId: string
  orderName: string
  items: { sku: string; title: string; qty_ordered: number; qty_delivered: number }[]
  onClose: () => void
  onDone: () => void
}) {
  const [qtys, setQtys]   = useState<number[]>(items.map(it => Math.max(0, Math.min(it.qty_ordered, it.qty_delivered))))
  const [saving, setSaving] = useState(false)
  const anyShort = qtys.some((q, i) => q < items[i].qty_ordered)

  async function save() {
    setSaving(true)
    const partial_delivered = items.map((it, i) => ({
      sku: it.sku, title: it.title, qty_ordered: it.qty_ordered,
      qty_delivered: Math.max(0, Math.min(it.qty_ordered, qtys[i])),
    }))
    const fullyDelivered = partial_delivered.every(p => p.qty_delivered >= p.qty_ordered)
    try {
      await fetch(`/api/delivery/stops/${stopId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          status: fullyDelivered ? 'delivered' : 'partial',
          partial_delivered: fullyDelivered ? null : partial_delivered,
        }),
      })
      onDone()
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-[80] flex items-end sm:items-center justify-center bg-black/40 p-0 sm:p-4" onClick={onClose}>
      <div className="bg-white w-full sm:max-w-md rounded-t-[20px] sm:rounded-[20px] max-h-[88vh] overflow-y-auto p-5 space-y-4" onClick={e => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-base font-bold text-[#1a1a2e]">Quantité réellement livrée</h2>
            <p className="text-xs text-[#9b9b93] mt-0.5">{orderName} · le reliquat repart à planifier</p>
          </div>
          <button onClick={onClose} className="text-[#9b9b93] hover:text-[#1a1a2e]"><X size={18} /></button>
        </div>

        <div className="space-y-2">
          {items.map((it, i) => {
            const delivered = qtys[i]
            const isShort   = delivered < it.qty_ordered
            return (
              <div key={i} className={`flex items-center gap-3 rounded-[12px] px-3 py-2.5 border ${isShort ? 'bg-[#fff7ed] border-[#fed7aa]' : 'bg-[#f5f5f3] border-transparent'}`}>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-[#1a1a2e] truncate">{it.title}</p>
                  {it.sku && <p className="text-[10px] text-[#9b9b93] font-mono">{it.sku}</p>}
                  {isShort && <p className="text-[10px] text-[#c2680a] font-semibold">Reste {it.qty_ordered - delivered} à livrer</p>}
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <button
                    onClick={() => setQtys(q => q.map((v, j) => j === i ? Math.max(0, v - 1) : v))}
                    disabled={delivered <= 0}
                    className="w-8 h-8 rounded-full border border-[#e8e8e4] bg-white text-lg font-bold leading-none disabled:opacity-30 active:bg-[#f5f5f3] flex items-center justify-center"
                  >−</button>
                  <span className={`w-12 text-center text-base font-bold tabular-nums ${isShort ? 'text-[#c2680a]' : 'text-[#1a1a2e]'}`}>{delivered}<span className="text-[11px] text-[#9b9b93]">/{it.qty_ordered}</span></span>
                  <button
                    onClick={() => setQtys(q => q.map((v, j) => j === i ? Math.min(it.qty_ordered, v + 1) : v))}
                    disabled={delivered >= it.qty_ordered}
                    className="w-8 h-8 rounded-full border border-[#e8e8e4] bg-white text-lg font-bold leading-none disabled:opacity-30 active:bg-[#f5f5f3] flex items-center justify-center"
                  >+</button>
                </div>
              </div>
            )
          })}
        </div>

        <div className="flex gap-2 pt-1">
          <button onClick={onClose} className="flex-1 py-2.5 rounded-[12px] border border-[#e8e8e4] text-sm font-medium text-[#6b6b63]">Annuler</button>
          <button onClick={save} disabled={saving}
            className="flex-[2] py-2.5 rounded-[12px] bg-[#1a1a2e] text-white text-sm font-semibold disabled:opacity-50">
            {saving ? 'Enregistrement…' : anyShort ? 'Remettre le reste à planifier' : 'Marquer tout livré'}
          </button>
        </div>
      </div>
    </div>
  )
}

function SavView() {
  const [search, setSearch]     = useState('')
  const [entries, setEntries]   = useState<SavEntry[]>([])
  const [loading, setLoading]   = useState(true)
  const [selected, setSelected] = useState<SavEntry | null>(null)
  const [copied, setCopied]     = useState(false)
  const [correctingStop, setCorrectingStop] = useState<SavEntry | null>(null)

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
          fetch('/api/delivery/tours', { cache: 'no-store' }).then(r => r.json()),
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
        const toursData = await fetch('/api/delivery/tours', { cache: 'no-store' }).then(r => r.json())
        applyEntries(buildSavEntries(toursData.tours ?? [], cachedOrdersRef.current))
      } catch { /* silent */ } finally {
        refreshingRef.current = false
      }
    }, 10_000)
    return () => clearInterval(interval)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const [emailOpen, setEmailOpen] = useState(false)
  const [statusFilter, setStatusFilter] = useState<SavStatus | 'all'>('all')
  const [tourFilter, setTourFilter]     = useState<string>('all')
  const [notesOnly, setNotesOnly]       = useState(false)
  const [bellOpen, setBellOpen]         = useState(false)
  const [seenNotes, setSeenNotes]       = useState<Set<string>>(() => {
    if (typeof window === 'undefined') return new Set()
    try { return new Set<string>(JSON.parse(localStorage.getItem('bowa_sav_seen_notes') || '[]')) } catch { return new Set() }
  })
  const [editingNote, setEditingNote]   = useState(false)
  const [noteValue, setNoteValue]       = useState('')
  const [savingNote, setSavingNote]     = useState(false)
  const [noteError, setNoteError]       = useState<string | null>(null)

  async function handleSaveNote(stopId: string) {
    setSavingNote(true)
    setNoteError(null)
    try {
      const r = await fetch(`/api/delivery/stops/${stopId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sav_note: noteValue.trim() || null }),
      })
      const data = await r.json()
      if (!r.ok) {
        const err = data.error
        const msg = typeof err === 'string' ? err : err?.message ?? JSON.stringify(err) ?? `Erreur ${r.status}`
        throw new Error(msg)
      }
      const note = noteValue.trim() || null
      setEntries(prev => prev.map(e => e.id === stopId ? { ...e, sav_note: note } : e))
      setSelected(prev => prev?.id === stopId ? { ...prev, sav_note: note } : prev)
      setEditingNote(false)
    } catch (e) {
      setNoteError(e instanceof Error ? e.message : 'Erreur inconnue')
    } finally {
      setSavingNote(false)
    }
  }

  // Unique tours from entries, sorted by planned_date desc
  const availableTours = useMemo(() => {
    const seen = new Map<string, { name: string; date: string | null; status: string | null }>()
    for (const e of entries) {
      if (e.tour_name && !seen.has(e.tour_name)) {
        seen.set(e.tour_name, { name: e.tour_name, date: e.tour_planned_date, status: e.tour_status })
      }
    }
    return [...seen.values()].sort((a, b) => {
      if (!a.date && !b.date) return 0
      if (!a.date) return 1
      if (!b.date) return -1
      return b.date.localeCompare(a.date)
    })
  }, [entries])

  const filtered = entries.filter((e) => {
    if (notesOnly && !e.comment?.trim()) return false
    if (statusFilter !== 'all' && e.sav_status !== statusFilter) return false
    if (tourFilter === '') { if (e.tour_name) return false }
    else if (tourFilter !== 'all' && e.tour_name !== tourFilter) return false
    if (!search.trim()) return true
    const q = search.toLowerCase()
    return (
      e.order_name.toLowerCase().includes(q) ||
      e.customer_name.toLowerCase().includes(q) ||
      e.city.toLowerCase().includes(q) ||
      (e.email ?? '').toLowerCase().includes(q)
    )
  })

  // ── Notes livreur : alertes + notifications (non-lues persistées) ───────────
  const noteKey = (e: SavEntry) => `${e.id}::${(e.comment ?? '').trim()}`
  const notedEntries = entries
    .filter(e => e.comment?.trim())
    .sort((a, b) => (b.delivered_at ?? '').localeCompare(a.delivered_at ?? ''))
  const unseenNotes = notedEntries.filter(e => !seenNotes.has(noteKey(e)))
  function markNotesSeen(keys: string[]) {
    setSeenNotes(prev => {
      const next = new Set(prev)
      keys.forEach(k => next.add(k))
      try { localStorage.setItem('bowa_sav_seen_notes', JSON.stringify([...next])) } catch { /* ignore */ }
      return next
    })
  }

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
    setEditingNote(false)
    setNoteValue(entry.sav_note ?? '')
    if (entry.comment?.trim()) markNotesSeen([noteKey(entry)])  // ouvrir = lu
  }

  // Sur desktop, ouvrir la 1re commande par défaut pour ne pas laisser le panneau
  // de droite vide. (Sélection passive : ne marque PAS la note comme lue.)
  useEffect(() => {
    if (selected || loading || filtered.length === 0) return
    if (typeof window !== 'undefined' && !window.matchMedia('(min-width: 768px)').matches) return
    setSelected(filtered[0])
    setNoteValue(filtered[0].sav_note ?? '')
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, selected, filtered.length])

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
            // stops = [done sorted by delivered_at] + [pending sorted by sequence]
            // → current stop = first pending element (always at the boundary between done and pending)
            const isPending = (s: { status: string }) => s.status !== 'delivered' && s.status !== 'failed'
            const currentIdx = stops.findIndex(isPending)
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
                <StepperScroll stops={stops}>
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
                        const isFailed    = s.status === 'failed'
                        const isCurrent   = i === currentIdx && !isFailed && !isDelivered
                        return (
                          <div key={i} className="relative flex flex-col items-center flex-1 pt-0">
                            <div className="relative flex items-center justify-center">
                              <div
                                className={`relative z-10 w-8 h-8 rounded-full border-2 flex items-center justify-center transition-all duration-500 ${
                                  isDelivered
                                    ? 'bg-[#1a7f4b] border-[#1a7f4b]'
                                    : isFailed
                                    ? 'bg-[#f97316] border-[#f97316]'
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
                                {isFailed && (
                                  <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
                                    <path d="M2 2L8 8M8 2L2 8" stroke="white" strokeWidth="2" strokeLinecap="round"/>
                                  </svg>
                                )}
                              </div>
                            </div>
                            {/* City */}
                            <span className={`mt-2 text-[10px] font-semibold text-center leading-tight max-w-[68px] truncate ${
                              isDelivered ? 'text-[#1a7f4b]' : isFailed ? 'text-[#f97316]' : isCurrent ? 'text-[#1a1a2e]' : 'text-[#6b6b63]'
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
                </StepperScroll>

                {/* Carte itinéraire complet */}
                {(() => {
                  const tourStops = entries
                    .filter(e => e.tour_name === rep.tour_name && e.stop_status !== null)
                    .sort((a, b) => a.stop_sequence - b.stop_sequence)
                    .map(e => ({
                      id: e.id,
                      address1: e.address1,
                      address2: e.address2,
                      city: e.city,
                      zip: e.zip,
                      lat: e.lat,
                      lng: e.lng,
                      customer_name: e.customer_name,
                      order_name: e.order_name,
                      status: e.stop_status!,
                      delivered_at: e.delivered_at,
                    }))
                  if (tourStops.length === 0) return null
                  return <SavPositionMap stops={tourStops} height={340} />
                })()}

              </div>
            )
          })}
        </div>
      )}

    <div className="flex flex-col md:flex-row gap-4 items-start">
      {/* ── Left: search + list ── */}
      <div className={`flex-shrink-0 ${selected ? 'hidden md:block md:w-2/5' : 'w-full md:flex-1 md:max-w-xl'}`}>
        <div className="rounded-[20px] shadow-[0_2px_16px_rgba(0,0,0,0.06)] bg-white p-5">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-base font-semibold text-[#1a1a2e]">SAV — Suivi livraisons</h2>
            {/* Cloche de notifications — notes livreur non lues */}
            <div className="relative">
              <button
                onClick={() => setBellOpen(o => !o)}
                className="relative w-9 h-9 rounded-full bg-[#f5f5f3] hover:bg-[#ece9e4] flex items-center justify-center transition-colors"
                title="Notes des livreurs"
              >
                <span className="text-base">🔔</span>
                {unseenNotes.length > 0 && (
                  <span className="absolute -top-0.5 -right-0.5 min-w-[18px] h-[18px] px-1 rounded-full bg-[#ea580c] text-white text-[10px] font-bold flex items-center justify-center ring-2 ring-white">
                    {unseenNotes.length}
                  </span>
                )}
              </button>
              {bellOpen && (
                <>
                  <div className="fixed inset-0 z-30" onClick={() => setBellOpen(false)} />
                  <div className="absolute right-0 mt-2 w-80 max-h-[60vh] overflow-y-auto bg-white rounded-[14px] shadow-[0_8px_32px_rgba(0,0,0,0.18)] border border-[#eee] z-40">
                    <div className="flex items-center justify-between px-3.5 py-2.5 border-b border-[#f0f0ee] sticky top-0 bg-white">
                      <span className="text-xs font-semibold text-[#1a1a2e]">Notes des livreurs ({notedEntries.length})</span>
                      {unseenNotes.length > 0 && (
                        <button
                          onClick={() => markNotesSeen(notedEntries.map(noteKey))}
                          className="text-[11px] font-medium text-[#ea580c] hover:underline"
                        >
                          Tout marquer comme lu
                        </button>
                      )}
                    </div>
                    {notedEntries.length === 0 ? (
                      <p className="px-3.5 py-6 text-center text-xs text-[#9b9b93]">Aucune note de livreur</p>
                    ) : (
                      notedEntries.map(e => {
                        const unseen = !seenNotes.has(noteKey(e))
                        return (
                          <button
                            key={e.id}
                            onClick={() => { selectEntry(e); setBellOpen(false); setNotesOnly(false) }}
                            className={`w-full text-left px-3.5 py-2.5 border-b border-[#f5f5f3] hover:bg-[#fafaf8] transition-colors ${unseen ? 'bg-[#fff7ed]' : ''}`}
                          >
                            <div className="flex items-center gap-1.5">
                              {unseen && <span className="w-1.5 h-1.5 rounded-full bg-[#ea580c] shrink-0" />}
                              <span className="font-mono text-[11px] font-bold text-[#1a1a2e]">{e.order_name}</span>
                              <span className="text-[11px] text-[#6b6b63] truncate">· {e.customer_name}</span>
                            </div>
                            <p className="text-[11px] text-[#9a3412] leading-snug mt-0.5 line-clamp-2">💬 {e.comment}</p>
                            {e.tour_name && <p className="text-[10px] text-[#9b9b93] mt-0.5 truncate">{e.tour_name}</p>}
                          </button>
                        )
                      })
                    )}
                  </div>
                </>
              )}
            </div>
          </div>

          {/* Status chips */}
          <div className="flex flex-wrap gap-1.5 mb-3">
            {([
              { key: 'all',         label: 'Tous',        bg: '#f5f5f3', text: '#6b6b63', activeBg: '#1a1a2e', activeText: '#fff' },
              { key: 'pending',     label: 'En attente',  bg: '#f5f5f3', text: '#6b6b63', activeBg: '#6b6b63', activeText: '#fff' },
              { key: 'planned',     label: 'Planifiée',   bg: '#f5f5f3', text: '#6b6b63', activeBg: '#6d28d9', activeText: '#fff' },
              { key: 'in_progress', label: 'En cours',    bg: '#f5f5f3', text: '#6b6b63', activeBg: '#1d4ed8', activeText: '#fff' },
              { key: 'delivered',   label: 'Livrée',      bg: '#f5f5f3', text: '#6b6b63', activeBg: '#1a7f4b', activeText: '#fff' },
              { key: 'partial',     label: '⚠ Partielle', bg: '#f5f5f3', text: '#6b6b63', activeBg: '#92400e', activeText: '#fff' },
            ] as const).map(({ key, label, activeBg, activeText }) => {
              const count = key === 'all' ? entries.length : entries.filter(e => e.sav_status === key).length
              const active = statusFilter === key
              return (
                <button
                  key={key}
                  onClick={() => setStatusFilter(key)}
                  className="flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium transition-colors"
                  style={{ background: active ? activeBg : '#f0f0ee', color: active ? activeText : '#6b6b63' }}
                >
                  {label}
                  <span className="text-[10px] opacity-70">{count}</span>
                </button>
              )
            })}
            {/* Filtre dédié : commandes avec une note du livreur (visibles même tournée finie) */}
            <button
              onClick={() => setNotesOnly(v => !v)}
              className="flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold transition-colors"
              style={{ background: notesOnly ? '#ea580c' : '#ffedd5', color: notesOnly ? '#fff' : '#9a3412' }}
            >
              💬 Notes livreur
              <span className="text-[10px] opacity-80">{notedEntries.length}</span>
            </button>
          </div>

          {/* Tour select */}
          {availableTours.length > 0 && (
            <select
              value={tourFilter}
              onChange={(e) => setTourFilter(e.target.value)}
              className="w-full px-3 py-2 text-sm border border-[#e8e8e4] rounded-[10px] mb-3 outline-none focus:border-[#aeb0c9] bg-white text-[#1a1a2e]"
            >
              <option value="all">Toutes les tournées</option>
              {availableTours.map((t) => {
                const statusLabel = t.status === 'in_progress' ? ' 🟢 En cours' : t.status === 'planned' ? ' · Planifiée' : ''
                const dateLabel = t.date ? ` · ${new Date(t.date + 'T00:00:00').toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' })}` : ''
                return (
                  <option key={t.name} value={t.name}>
                    {t.name}{dateLabel}{statusLabel}
                  </option>
                )
              })}
              <option value="">— Sans tournée (en attente)</option>
            </select>
          )}

          {/* Search */}
          <input
            type="text"
            placeholder="Commande, client, ville, email..."
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
                const driverNote = entry.comment?.trim()
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
                        : driverNote
                          ? 'border-[#fdba74] bg-[#fff7ed] hover:bg-[#ffedd5]'
                          : 'border-[#f0f0ee] bg-[#fafaf8] hover:bg-[#f5f5f3]'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-1.5 mb-0.5">
                      <span className="font-mono text-xs font-bold text-[#1a1a2e]">{entry.order_name}</span>
                      <div className="flex items-center gap-1 flex-shrink-0">
                        {driverNote && (
                          <span title={driverNote} className="w-4 h-4 rounded-full bg-[#ea580c] text-white flex items-center justify-center text-[9px]">💬</span>
                        )}
                        {entry.photo_url && (
                          <span title="Photo du livreur" className="w-4 h-4 rounded-full bg-[#dbeafe] text-[#1d4ed8] flex items-center justify-center text-[9px]">📷</span>
                        )}
                        {entry.sav_note && (
                          <span title={entry.sav_note} className="w-4 h-4 rounded-full bg-[#fef3c7] text-[#d97706] flex items-center justify-center text-[9px]">📝</span>
                        )}
                        <span
                          className="px-1.5 py-0.5 rounded-full text-[10px] font-medium whitespace-nowrap"
                          style={{ backgroundColor: cfg.bg, color: cfg.text }}
                        >
                          {cfg.label}
                        </span>
                      </div>
                    </div>
                    <div className="text-xs text-[#6b6b63] truncate">{entry.customer_name} · {entry.city}</div>
                    {driverNote && (
                      <div className="mt-1 flex items-start gap-1 rounded-[8px] bg-[#ffedd5] px-2 py-1">
                        <span className="text-[10px] shrink-0 leading-snug">💬</span>
                        <span className="text-[11px] text-[#9a3412] leading-snug line-clamp-2">{driverNote}</span>
                      </div>
                    )}
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
                          <span className="font-mono text-[#9b9b93] mr-2">{p.sku || p.variant_title || '—'}</span>
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

              {/* ── Note du livreur (alerte SAV) ── */}
              {selected.comment?.trim() && (
                <div className="rounded-[12px] bg-[#fff7ed] border border-[#fdba74] px-3 py-2.5">
                  <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-[#c2680a] mb-1">💬 Note du livreur</p>
                  <p className="text-sm text-[#7c2d12] leading-snug whitespace-pre-wrap">{selected.comment}</p>
                  {selected.delivered_at && (
                    <p className="text-[10px] text-[#c2680a]/70 mt-1">{new Date(selected.delivered_at).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' })}</p>
                  )}
                </div>
              )}

              {/* ── Note SAV pour le livreur ── */}
              {selected.stop_status !== null && (
                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-[#9b9b93]">Note pour le livreur</p>
                    {!editingNote && (
                      <button
                        onClick={() => { setNoteValue(selected.sav_note ?? ''); setEditingNote(true) }}
                        className="flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-semibold bg-[#fef3c7] text-[#92400e] hover:bg-[#fde68a] transition-colors"
                      >
                        {selected.sav_note ? '✏️ Modifier' : '+ Ajouter une note'}
                      </button>
                    )}
                  </div>
                  {editingNote ? (
                    <div className="space-y-2">
                      <textarea
                        value={noteValue}
                        onChange={(e) => setNoteValue(e.target.value)}
                        placeholder="Ex : veut être livré uniquement le matin, code portail A1234..."
                        className="w-full px-3 py-2.5 text-sm border border-[#fcd34d] rounded-[12px] outline-none focus:border-[#f59e0b] resize-none bg-[#fffbeb]"
                        rows={3}
                        autoFocus
                      />
                      <div className="flex gap-2">
                        <button
                          onClick={() => { setEditingNote(false); setNoteError(null) }}
                          className="flex-1 py-2 rounded-[10px] border border-[#e8e8e4] text-xs font-medium text-[#6b6b63]"
                        >
                          Annuler
                        </button>
                        <button
                          onClick={() => handleSaveNote(selected.id)}
                          disabled={savingNote}
                          className="flex-1 py-2 rounded-[10px] bg-[#d97706] text-white text-xs font-semibold disabled:opacity-50"
                        >
                          {savingNote ? 'Enregistrement...' : 'Enregistrer'}
                        </button>
                      </div>
                      {noteError && (
                        <p className="text-xs text-[#dc2626] bg-[#fef2f2] border border-[#fecaca] rounded-[8px] px-2.5 py-1.5">{noteError}</p>
                      )}
                    </div>
                  ) : selected.sav_note ? (
                    <div className="rounded-[12px] bg-[#fffbeb] border border-[#fde68a] px-3 py-2.5">
                      <p className="text-sm text-[#92400e]">📝 {selected.sav_note}</p>
                    </div>
                  ) : (
                    <div className="rounded-[12px] bg-[#fafaf8] border border-dashed border-[#e8e8e4] px-3 py-2 text-center">
                      <p className="text-xs text-[#9b9b93]">Aucune note — cliquez sur &ldquo;+ Ajouter&rdquo;</p>
                    </div>
                  )}
                </div>
              )}

              {/* ── Remettre à planifier (corriger la qté livrée) ── */}
              {(selected.stop_status === 'delivered' || selected.stop_status === 'partial') && (selected.panel_details?.length ?? 0) > 0 && (
                <button
                  onClick={() => setCorrectingStop(selected)}
                  className="w-full py-2.5 rounded-[12px] border border-[#fed7aa] bg-[#fffbeb] text-sm font-semibold text-[#92400e] hover:bg-[#fef3c7] transition-colors"
                >
                  ↩ Pas tout livré ? Remettre le reste à planifier
                </button>
              )}

              {/* ── Livraison partielle ── */}
              {selected.sav_status === 'partial' && selected.partial_delivered && (
                <div>
                  <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-[#92400e] mb-1.5">⚠ Livraison partielle — articles à replanifier</p>
                  <div className="space-y-1">
                    {selected.partial_delivered.map((item, i) => {
                      const remaining = item.qty_ordered - item.qty_delivered
                      return (
                        <div key={i} className={`flex items-center gap-2 rounded-[10px] px-3 py-2 text-xs ${remaining > 0 ? 'bg-[#fef3c7] border border-[#fcd34d]' : 'bg-[#f0fdf4] border border-[#bbf7d0]'}`}>
                          <div className="flex-1 min-w-0">
                            <span className={`font-medium ${remaining > 0 ? 'text-[#92400e]' : 'text-[#1a7f4b]'}`}>{item.title}</span>
                            {item.sku && <span className="ml-1 font-mono text-[#9b9b93]">({item.sku})</span>}
                          </div>
                          <span className={`font-bold shrink-0 ${remaining > 0 ? 'text-[#c2680a]' : 'text-[#1a7f4b]'}`}>
                            {item.qty_delivered}/{item.qty_ordered} livré{item.qty_delivered > 1 ? 's' : ''}
                          </span>
                          {remaining > 0 && (
                            <span className="shrink-0 px-1.5 py-0.5 rounded-full bg-[#fed7aa] text-[#92400e] font-bold text-[10px]">
                              −{remaining}
                            </span>
                          )}
                        </div>
                      )
                    })}
                  </div>
                </div>
              )}

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

              {/* ── Preuve de livraison (signature + photo) ── */}
              {(selected.signature_url || selected.photo_url) && (
                <div>
                  <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-[#9b9b93] mb-1.5">Preuve de livraison</p>
                  <div className="flex gap-2">
                    {selected.signature_url && (
                      <a href={selected.signature_url} target="_blank" rel="noreferrer" className="flex-1 group">
                        <div className="rounded-[10px] border border-[#bbf7d0] bg-white overflow-hidden">
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img src={selected.signature_url} alt="Signature" className="w-full h-20 object-contain p-1 group-hover:opacity-80 transition-opacity" />
                          <p className="text-center text-[9px] text-[#6b6b63] pb-1">Signature</p>
                        </div>
                      </a>
                    )}
                    {selected.photo_url && (
                      <a href={selected.photo_url} target="_blank" rel="noreferrer" className="flex-1 group">
                        <div className="rounded-[10px] border border-[#bbf7d0] overflow-hidden">
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img src={selected.photo_url} alt="Photo colis" className="w-full h-20 object-cover group-hover:opacity-80 transition-opacity" />
                          <p className="text-center text-[9px] text-[#6b6b63] py-1">Photo colis</p>
                        </div>
                      </a>
                    )}
                  </div>
                </div>
              )}

              {/* ── Address ── */}
              <div className="flex items-start gap-2">
                <MapPin size={13} className="text-[#9b9b93] mt-0.5 flex-shrink-0" />
                <div>
                  <p className="text-xs text-[#1a1a2e]">{streetLine(selected.address1, selected.address2)}</p>
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

      {correctingStop && (
        <CorrectDeliveryModal
          stopId={correctingStop.id}
          orderName={correctingStop.order_name}
          items={
            correctingStop.partial_delivered && correctingStop.partial_delivered.length > 0
              ? correctingStop.partial_delivered.map(p => ({ sku: p.sku, title: p.title, qty_ordered: p.qty_ordered, qty_delivered: p.qty_delivered }))
              : (correctingStop.panel_details ?? []).map(p => ({ sku: p.sku, title: p.title, qty_ordered: p.qty, qty_delivered: p.qty }))
          }
          onClose={() => setCorrectingStop(null)}
          onDone={async () => {
            setCorrectingStop(null)
            try {
              const [toursData, ordersData] = await Promise.all([
                fetch('/api/delivery/tours', { cache: 'no-store' }).then(r => r.json()),
                fetch('/api/delivery/orders').then(r => r.json()),
              ])
              cachedOrdersRef.current = ordersData.orders ?? []
              applyEntries(buildSavEntries(toursData.tours ?? [], cachedOrdersRef.current))
            } catch (e) { console.error(e) }
          }}
        />
      )}
    </div>
    </div>
  )
}
