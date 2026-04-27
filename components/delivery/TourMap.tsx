'use client'

import { useEffect, useRef, useState } from 'react'
import { ChevronLeft, CheckCircle2 } from 'lucide-react'
import type mapboxgl from 'mapbox-gl'

interface PanelItem {
  title: string
  qty: number
  sku?: string | null
  variant_title?: string | null
}

interface MapStop {
  id: string
  order_name: string
  customer_name: string
  address1: string
  city: string
  zip: string
  sequence: number
  status: 'pending' | 'delivered' | 'failed'
  panel_details?: PanelItem[]
}

// Dépôt Bourges — Saint-Germain-du-Puy
const DEPOT_COORDS: [number, number] = [2.4524, 47.0873]
const DEPOT_LABEL = 'Dépôt Bourges'

async function geocodeAddress(address: string, token: string): Promise<[number, number] | null> {
  try {
    const res = await fetch(
      `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(address)}.json?access_token=${token}&country=fr&limit=1&types=address`
    )
    if (!res.ok) return null
    const data = await res.json()
    const center = data.features?.[0]?.center
    return center ? (center as [number, number]) : null
  } catch {
    return null
  }
}

function stopColor(status: string) {
  if (status === 'delivered') return '#22c55e'
  if (status === 'failed')    return '#f97316'
  return '#3b82f6'
}

function makeStopMarkerEl(label: string, color: string): HTMLElement {
  const el = document.createElement('div')
  el.style.cssText = `
    width:30px;height:30px;border-radius:50%;
    background:${color};border:2.5px solid white;
    box-shadow:0 2px 8px rgba(0,0,0,0.35);
    display:flex;align-items:center;justify-content:center;
    font-size:12px;font-weight:700;color:white;
    cursor:pointer;
  `
  el.textContent = label
  return el
}

function makeDepotMarkerEl(): HTMLElement {
  const el = document.createElement('div')
  el.style.cssText = `
    width:34px;height:34px;border-radius:8px;
    background:#1a1a2e;border:2.5px solid white;
    box-shadow:0 2px 8px rgba(0,0,0,0.4);
    display:flex;align-items:center;justify-content:center;
    font-size:16px;cursor:default;
  `
  el.textContent = '🏭'
  return el
}

interface TourMapProps {
  stops: MapStop[]
  onBack: () => void
  precomputedCoords?: Map<string, [number, number]>
  etaMap?: Map<string, string>
  onMarkDelivered?: (stopId: string) => Promise<void>
  onRemoveStop?: (stopId: string) => Promise<void>
}

export default function TourMap({ stops, onBack, precomputedCoords, onMarkDelivered, onRemoveStop }: TourMapProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef       = useRef<mapboxgl.Map | null>(null)
  const markerElsRef = useRef<Record<string, HTMLElement>>({})

  const [phase, setPhase]               = useState<'geocoding' | 'routing' | 'ready' | 'error'>('geocoding')
  const [selectedStop, setSelectedStop] = useState<MapStop | null>(null)
  const [marking, setMarking]           = useState(false)
  const [removing, setRemoving]         = useState(false)
  const [confirmRemove, setConfirmRemove] = useState(false)
  const [localStatuses, setLocalStatuses] = useState<Record<string, string>>(() =>
    Object.fromEntries(stops.map(s => [s.id, s.status]))
  )
  const [, setRemovedIds] = useState<Set<string>>(new Set())

  const sortedStops = [...stops].sort((a, b) => a.sequence - b.sequence)
  const token = process.env.NEXT_PUBLIC_MAPBOX_TOKEN ?? ''

  useEffect(() => {
    if (!containerRef.current || !token) { setPhase('error'); return }
    let cancelled = false

    async function init() {
      const mgl = (await import('mapbox-gl')).default
      if (cancelled) return

      // Use precomputed coords when available, geocode the rest
      const geocoded: ([number, number] | null)[] = await Promise.all(
        sortedStops.map(async (s) => {
          if (precomputedCoords?.has(s.id)) return precomputedCoords.get(s.id)!
          return geocodeAddress(`${s.address1}, ${s.city} ${s.zip}, France`, token)
        })
      )
      if (cancelled) return

      setPhase('routing')

      mgl.accessToken = token
      const map = new mgl.Map({
        container: containerRef.current!,
        style: 'mapbox://styles/mapbox/streets-v12',
        center: DEPOT_COORDS,
        zoom: 7,
        attributionControl: false,
      })
      mapRef.current = map

      map.on('load', async () => {
        if (cancelled) return

        // Depot marker
        new mgl.Marker({ element: makeDepotMarkerEl() })
          .setLngLat(DEPOT_COORDS)
          .setPopup(new mgl.Popup({ offset: 18 }).setText(DEPOT_LABEL))
          .addTo(map)

        // Stop markers
        const routeWaypoints: [number, number][] = [DEPOT_COORDS]
        sortedStops.forEach((stop, i) => {
          const coord = geocoded[i]
          if (!coord) return
          routeWaypoints.push(coord)

          const el = makeStopMarkerEl(String(i + 1), stopColor(stop.status))
          markerElsRef.current[stop.id] = el

          // Click opens bottom sheet (no Mapbox popup)
          el.addEventListener('click', () => {
            setSelectedStop(stop)
          })

          new mgl.Marker({ element: el })
            .setLngLat(coord)
            .addTo(map)
        })

        // Route line via Directions API
        const capped = routeWaypoints.slice(0, 25)
        if (capped.length >= 2) {
          try {
            const coordStr = capped.map((c) => c.join(',')).join(';')
            const dirRes = await fetch(
              `https://api.mapbox.com/directions/v5/mapbox/driving/${coordStr}?geometries=geojson&overview=full&access_token=${token}`
            )
            if (dirRes.ok && !cancelled) {
              const dirData = await dirRes.json()
              const geometry = dirData.routes?.[0]?.geometry
              if (geometry) {
                map.addSource('route', {
                  type: 'geojson',
                  data: { type: 'Feature', properties: {}, geometry },
                })
                map.addLayer({
                  id: 'route-casing',
                  type: 'line',
                  source: 'route',
                  paint: { 'line-color': '#ffffff', 'line-width': 7, 'line-opacity': 0.9 },
                })
                map.addLayer({
                  id: 'route',
                  type: 'line',
                  source: 'route',
                  paint: { 'line-color': '#1a7f4b', 'line-width': 4.5, 'line-opacity': 0.95 },
                })
              }
            }
          } catch { /* route draw is best-effort */ }
        }

        // Fit map to all points
        const allCoords = [DEPOT_COORDS, ...(geocoded.filter(Boolean) as [number, number][])]
        if (allCoords.length > 1) {
          const bounds = allCoords.reduce(
            (b, c) => b.extend(c),
            new mgl.LngLatBounds(allCoords[0], allCoords[0])
          )
          map.fitBounds(bounds, { padding: { top: 60, bottom: 60, left: 40, right: 40 }, maxZoom: 12 })
        }

        if (!cancelled) setPhase('ready')
      })
    }

    init().catch(() => { if (!cancelled) setPhase('error') })

    return () => {
      cancelled = true
      mapRef.current?.remove()
      mapRef.current = null
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])   // run once on mount

  async function handleMarkDelivered() {
    if (!selectedStop || !onMarkDelivered) return
    setMarking(true)
    try {
      await onMarkDelivered(selectedStop.id)
      const el = markerElsRef.current[selectedStop.id]
      if (el) el.style.background = '#22c55e'
      setLocalStatuses(prev => ({ ...prev, [selectedStop.id]: 'delivered' }))
      setSelectedStop(null)
    } finally {
      setMarking(false)
    }
  }

  async function handleRemoveStop() {
    if (!selectedStop || !onRemoveStop) return
    setRemoving(true)
    try {
      await onRemoveStop(selectedStop.id)
      // Hide the marker immediately without reloading the map
      const el = markerElsRef.current[selectedStop.id]
      if (el) el.style.display = 'none'
      setRemovedIds(prev => new Set([...prev, selectedStop.id]))
      setSelectedStop(null)
      setConfirmRemove(false)
    } finally {
      setRemoving(false)
    }
  }

  const phaseLabel =
    phase === 'geocoding' ? 'Localisation des arrêts…'
    : phase === 'routing'  ? 'Calcul de l\'itinéraire…'
    : ''

  const currentStatus = selectedStop ? (localStatuses[selectedStop.id] ?? selectedStop.status) : null
  const products = (selectedStop?.panel_details ?? []).filter(p => p.qty > 0)

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-white">
      {/* Top bar */}
      <div className="flex items-center gap-3 px-4 py-3 bg-white shadow-sm z-10 shrink-0">
        <button
          onClick={onBack}
          className="w-10 h-10 rounded-full bg-[#f5f5f3] flex items-center justify-center"
        >
          <ChevronLeft size={20} />
        </button>
        <span className="text-base font-bold text-[#1a1a2e]">Itinéraire</span>
        {phaseLabel && (
          <span className="ml-auto text-xs text-[#6b6b63]">{phaseLabel}</span>
        )}
      </div>

      {/* Legend */}
      {phase === 'ready' && (
        <div className="flex items-center gap-3 px-4 py-2 bg-white border-b border-[#f0f0f0] text-xs text-[#6b6b63] shrink-0">
          <span className="flex items-center gap-1"><span className="w-3 h-3 rounded-full bg-[#3b82f6] inline-block" />À livrer</span>
          <span className="flex items-center gap-1"><span className="w-3 h-3 rounded-full bg-[#22c55e] inline-block" />Livré</span>
          <span className="flex items-center gap-1"><span className="w-3 h-3 rounded-full bg-[#f97316] inline-block" />Non livré</span>
        </div>
      )}

      {/* Map container */}
      <div ref={containerRef} className="flex-1" />

      {/* Loading overlay */}
      {phase !== 'ready' && phase !== 'error' && (
        <div className="absolute inset-0 flex items-center justify-center bg-white/70 pointer-events-none">
          <div className="text-sm text-[#6b6b63]">{phaseLabel}</div>
        </div>
      )}

      {phase === 'error' && (
        <div className="absolute inset-0 flex items-center justify-center bg-white">
          <div className="text-center space-y-2">
            <p className="text-sm text-red-500 font-medium">Impossible de charger la carte</p>
            <p className="text-xs text-[#6b6b63]">Vérifie la variable NEXT_PUBLIC_MAPBOX_TOKEN</p>
          </div>
        </div>
      )}

      {/* Bottom sheet — stop detail */}
      {selectedStop && (
        <>
          {/* Backdrop */}
          <div
            className="absolute inset-0 z-20 bg-black/20"
            onClick={() => { setSelectedStop(null); setConfirmRemove(false) }}
          />
          {/* Sheet */}
          <div className="absolute bottom-0 left-0 right-0 z-30 bg-white rounded-t-[24px] shadow-[0_-4px_32px_rgba(0,0,0,0.18)] px-5 pt-4 pb-8">
            {/* Handle */}
            <div className="w-10 h-1 bg-[#e0e0e0] rounded-full mx-auto mb-4" />

            {/* Header */}
            <div className="flex items-start justify-between gap-3 mb-4">
              <div>
                <div className="flex items-center gap-2">
                  <span className="font-mono text-xs bg-[#f5f5f3] px-2 py-0.5 rounded text-[#6b6b63]">
                    {selectedStop.order_name}
                  </span>
                  {currentStatus === 'delivered' && (
                    <span className="flex items-center gap-1 text-xs font-semibold text-[#1a7f4b]">
                      <CheckCircle2 size={13} /> Livré
                    </span>
                  )}
                </div>
                <p className="text-lg font-bold text-[#1a1a2e] mt-1">{selectedStop.customer_name}</p>
                <p className="text-sm text-[#6b6b63]">{selectedStop.address1}, {selectedStop.city} {selectedStop.zip}</p>
              </div>
              <button
                onClick={() => { setSelectedStop(null); setConfirmRemove(false) }}
                className="w-8 h-8 rounded-full bg-[#f5f5f3] flex items-center justify-center shrink-0 mt-1 text-[#6b6b63]"
              >
                ✕
              </button>
            </div>

            {/* Products */}
            {products.length > 0 && (
              <div className="mb-4 space-y-1.5">
                {products.map((p, i) => (
                  <div key={i} className="flex items-center gap-3 bg-[#f8f7f5] rounded-[10px] px-3 py-2">
                    <span className="w-7 h-7 rounded-lg bg-[#1a1a2e] text-white flex items-center justify-center font-bold text-sm shrink-0">
                      {p.qty}
                    </span>
                    <div className="min-w-0">
                      {(p.sku?.trim() || p.variant_title) && (
                        <p className="font-mono text-[10px] text-[#9b9b93] truncate">{p.sku?.trim() || p.variant_title}</p>
                      )}
                      <p className="text-sm font-medium text-[#1a1a2e] truncate">{p.title}</p>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* Primary action */}
            {currentStatus !== 'delivered' ? (
              <button
                onClick={handleMarkDelivered}
                disabled={marking || removing || !onMarkDelivered}
                className="w-full flex items-center justify-center gap-2 py-4 rounded-[16px] bg-[#1a7f4b] text-white font-bold text-base disabled:opacity-50 active:bg-[#15703f] transition-colors"
              >
                {marking ? <span className="animate-spin text-lg">⏳</span> : <CheckCircle2 size={20} />}
                {marking ? 'Enregistrement…' : 'Marquer comme livré'}
              </button>
            ) : (
              <div className="w-full flex items-center justify-center gap-2 py-4 rounded-[16px] bg-[#f0fdf4] text-[#1a7f4b] font-bold text-base">
                <CheckCircle2 size={20} />
                Déjà livré
              </div>
            )}

            {/* Secondary action — remove from tour */}
            {onRemoveStop && !confirmRemove && (
              <button
                onClick={() => setConfirmRemove(true)}
                disabled={marking || removing}
                className="w-full flex items-center justify-center gap-2 py-3 mt-2 rounded-[14px] border border-[#fcd5d5] bg-[#fff5f5] text-[#c7293a] text-sm font-semibold disabled:opacity-40 active:bg-[#ffe8e8] transition-colors"
              >
                Retirer de la tournée
              </button>
            )}

            {/* Confirmation step */}
            {confirmRemove && (
              <div className="mt-2 rounded-[14px] border border-[#fcd5d5] bg-[#fff5f5] p-4 space-y-3">
                <p className="text-sm font-semibold text-[#c7293a] text-center">
                  Retirer cette commande de la tournée ?
                </p>
                <p className="text-xs text-[#6b6b63] text-center">
                  Elle repassera dans les commandes à planifier.
                </p>
                <div className="flex gap-2">
                  <button
                    onClick={() => setConfirmRemove(false)}
                    disabled={removing}
                    className="flex-1 py-3 rounded-[12px] border border-[#e0deda] bg-white text-sm font-semibold text-[#6b6b63] disabled:opacity-40"
                  >
                    Annuler
                  </button>
                  <button
                    onClick={handleRemoveStop}
                    disabled={removing}
                    className="flex-1 py-3 rounded-[12px] bg-[#c7293a] text-white text-sm font-bold disabled:opacity-50"
                  >
                    {removing ? '…' : 'Confirmer'}
                  </button>
                </div>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  )
}
