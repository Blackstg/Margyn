'use client'

import { useEffect, useRef, useState } from 'react'
import type mapboxgl from 'mapbox-gl'
import { geocodeParts } from '@/lib/delivery/geocode'

export interface PlannedStop {
  id:            string
  order_name:    string
  customer_name: string
  address1:      string
  address2?:     string
  city:          string
  zip:           string
  panel_count:   number
  status:        string
  tour_name:     string
  tour_color:    string  // hex
}

export interface UnplannedOrder {
  order_name:    string
  customer_name: string
  address1:      string
  address2?:     string
  city:          string
  zip:           string
  panel_count:   number
  is_preorder:   boolean
}

interface Props {
  plannedStops:    PlannedStop[]
  unplannedOrders: UnplannedOrder[]
  height?:         number
}

const FRANCE_CENTER: [number, number] = [2.3522, 46.8]

function makeDot(color: string, size: number, border = 'white'): HTMLElement {
  const el = document.createElement('div')
  el.style.cssText = `
    width:${size}px; height:${size}px;
    border-radius:50%;
    background:${color};
    border:2px solid ${border};
    box-shadow:0 2px 6px rgba(0,0,0,0.25);
    cursor:pointer;
    flex-shrink:0;
  `
  return el
}

export default function LivreurOverviewMap({ plannedStops, unplannedOrders, height }: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef       = useRef<mapboxgl.Map | null>(null)
  const markersRef   = useRef<mapboxgl.Marker[]>([])
  const cacheRef     = useRef<Map<string, [number, number]>>(new Map())
  const [geocoding, setGeocoding] = useState(true)
  const [showPlanned, setShowPlanned]     = useState(true)
  const [showUnplanned, setShowUnplanned] = useState(true)

  const token = process.env.NEXT_PUBLIC_MAPBOX_TOKEN ?? ''

  const plannedKey   = plannedStops.map(s => s.id).join(',')
  const unplannedKey = unplannedOrders.map(o => o.order_name).join(',')

  useEffect(() => {
    if (!containerRef.current || !token) return
    let cancelled = false

    async function init() {
      const mgl = (await import('mapbox-gl')).default
      mgl.accessToken = token

      // Cleanup previous
      markersRef.current.forEach(m => m.remove())
      markersRef.current = []
      if (mapRef.current) { mapRef.current.remove(); mapRef.current = null }

      const map = new mgl.Map({
        container: containerRef.current!,
        style:     'mapbox://styles/mapbox/streets-v12',
        center:    FRANCE_CENTER,
        zoom:      5,
        attributionControl: false,
      })
      mapRef.current = map

      await new Promise<void>(res => map.once('load', () => res()))
      if (cancelled) return

      // Geocode everything in parallel (address2-aware, see geoAddress)
      const allAddresses = [
        ...plannedStops.map(s => ({ key: `stop:${s.id}`, parts: s })),
        ...unplannedOrders.map(o => ({ key: `order:${o.order_name}`, parts: o })),
      ]

      await Promise.all(allAddresses.map(async ({ key, parts }) => {
        if (cacheRef.current.has(key)) return
        const coord = await geocodeParts(parts, token)
        if (coord) cacheRef.current.set(key, coord)
      }))
      if (cancelled) return
      setGeocoding(false)

      const bounds = new mgl.LngLatBounds()
      let hasCoords = false

      // Planned stops
      if (showPlanned) {
        for (const s of plannedStops) {
          const coord = cacheRef.current.get(`stop:${s.id}`)
          if (!coord) continue
          hasCoords = true
          bounds.extend(coord)

          const isDelivered = s.status === 'delivered' || s.status === 'partial'
          const el = makeDot(
            isDelivered ? '#9ca3af' : s.tour_color,
            isDelivered ? 12 : 16,
            'white'
          )

          const popup = new mgl.Popup({ offset: 12, closeButton: false }).setHTML(`
            <div style="font-size:12px;line-height:1.6">
              <div style="font-weight:700;color:#1a1a2e">${s.customer_name}</div>
              <div style="font-family:ui-monospace,monospace;color:#888;font-size:11px">${s.order_name}</div>
              <div style="color:#6b6b63">${s.city}</div>
              <div style="color:${s.tour_color};font-weight:600;font-size:11px">${s.tour_name}</div>
              <div style="color:#1a1a2e;font-weight:600">${s.panel_count} panneau${s.panel_count !== 1 ? 'x' : ''}</div>
              ${isDelivered ? '<div style="color:#6b7280;font-size:10px">✓ Livré</div>' : ''}
            </div>
          `)

          const marker = new mgl.Marker({ element: el })
            .setLngLat(coord)
            .setPopup(popup)
            .addTo(map)

          el.addEventListener('mouseenter', () => popup.addTo(map))
          el.addEventListener('mouseleave', () => popup.remove())
          markersRef.current.push(marker)
        }
      }

      // Unplanned orders
      if (showUnplanned) {
        for (const o of unplannedOrders) {
          const coord = cacheRef.current.get(`order:${o.order_name}`)
          if (!coord) continue
          hasCoords = true
          bounds.extend(coord)

          const el = makeDot(o.is_preorder ? '#a855f7' : '#f59e0b', 14, 'white')
          // Diamond shape for unplanned
          el.style.borderRadius = '4px'
          el.style.transform = 'rotate(45deg)'

          const popup = new mgl.Popup({ offset: 12, closeButton: false }).setHTML(`
            <div style="font-size:12px;line-height:1.6">
              <div style="font-weight:700;color:#1a1a2e">${o.customer_name}</div>
              <div style="font-family:ui-monospace,monospace;color:#888;font-size:11px">${o.order_name}</div>
              <div style="color:#6b6b63">${o.city}</div>
              <div style="color:#f59e0b;font-weight:600;font-size:11px">${o.is_preorder ? 'Précommande' : 'Non planifiée'}</div>
              <div style="color:#1a1a2e;font-weight:600">${o.panel_count} panneau${o.panel_count !== 1 ? 'x' : ''}</div>
            </div>
          `)

          const marker = new mgl.Marker({ element: el })
            .setLngLat(coord)
            .setPopup(popup)
            .addTo(map)

          el.addEventListener('mouseenter', () => popup.addTo(map))
          el.addEventListener('mouseleave', () => popup.remove())
          markersRef.current.push(marker)
        }
      }

      if (hasCoords) {
        map.fitBounds(bounds, { padding: 60, maxZoom: 9, duration: 800 })
      }
    }

    init().catch(console.error)
    return () => {
      cancelled = true
      markersRef.current.forEach(m => m.remove())
      markersRef.current = []
      mapRef.current?.remove()
      mapRef.current = null
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [plannedKey, unplannedKey, showPlanned, showUnplanned, token])

  return (
    <div className="relative rounded-[16px] overflow-hidden border border-[#e8e8e4]" style={{ height: height ?? '100%' }}>
      <div ref={containerRef} className="absolute inset-0" />

      {/* Filtres */}
      <div className="absolute top-3 left-3 right-3 flex gap-2 z-10">
        <button
          onClick={() => setShowPlanned(v => !v)}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold shadow transition-colors ${
            showPlanned
              ? 'bg-[#1a1a2e] text-white'
              : 'bg-white/90 text-[#9b9b93]'
          }`}
        >
          <span className="w-2.5 h-2.5 rounded-full bg-[#6366f1] inline-block" />
          Planifiées ({plannedStops.length})
        </button>
        <button
          onClick={() => setShowUnplanned(v => !v)}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold shadow transition-colors ${
            showUnplanned
              ? 'bg-[#1a1a2e] text-white'
              : 'bg-white/90 text-[#9b9b93]'
          }`}
        >
          <span className="w-2 h-2 rounded-sm bg-[#f59e0b] inline-block rotate-45" />
          Non planifiées ({unplannedOrders.length})
        </button>
      </div>

      {geocoding && (
        <div className="absolute inset-0 flex items-center justify-center bg-white/70 pointer-events-none">
          <span className="text-sm text-[#6b6b63]">Localisation en cours…</span>
        </div>
      )}
    </div>
  )
}
