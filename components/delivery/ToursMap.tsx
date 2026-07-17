'use client'

import { useEffect, useRef, useState } from 'react'
import type mapboxgl from 'mapbox-gl'
import { geocodeParts } from '@/lib/delivery/geocode'

// ── Types ────────────────────────────────────────────────────────────────────

export interface TourMapStop {
  id:            string
  order_name:    string
  customer_name: string
  address1:      string
  address2?:     string
  city:          string
  zip:           string
  panel_count:   number
  sequence:      number
  status:        string
}

export interface TourMapTour {
  id:          string
  name:        string
  driver_name: string
  planned_date: string
  status:      string
  stops:       TourMapStop[]
}

interface Props {
  tours:  TourMapTour[]
  height?: number
}

// ── Palette ──────────────────────────────────────────────────────────────────

const PALETTE = [
  '#6366f1', // indigo
  '#0ea5e9', // sky
  '#10b981', // emerald
  '#f59e0b', // amber
  '#ef4444', // red
  '#8b5cf6', // violet
  '#14b8a6', // teal
  '#f97316', // orange
  '#ec4899', // pink
  '#84cc16', // lime
]

function tourColor(idx: number): string {
  return PALETTE[idx % PALETTE.length]
}

// ── Geocoding ────────────────────────────────────────────────────────────────

// Module-level cache: survives re-renders, cleared on page reload
const geocodeCache = new Map<string, [number, number] | null>()

// Géocodage robuste partagé (rue+ville+CP → rue+CP sans ville → centroïde, avec
// types=address pour ne pas matcher un POI/village homonyme). Cache module-level.
async function geocode(
  stop: { address1: string; address2?: string; city: string; zip: string },
  token: string
): Promise<[number, number] | null> {
  const key = `${stop.address1 ?? ''}|${stop.city ?? ''}|${stop.zip ?? ''}`
  const cached = geocodeCache.get(key)
  if (cached !== undefined) return cached
  const coord = await geocodeParts(stop, token)
  geocodeCache.set(key, coord)
  return coord
}

// ── Marker element ───────────────────────────────────────────────────────────

function makeMarkerEl(color: string, seq: number, status: string): HTMLElement {
  const el = document.createElement('div')
  const isDone = status === 'delivered' || status === 'partial' || status === 'failed'
  const opacity = isDone ? 0.45 : 1
  el.style.cssText = `
    width: 28px;
    height: 28px;
    border-radius: 50%;
    background: ${color};
    border: 2.5px solid white;
    box-shadow: 0 2px 8px rgba(0,0,0,0.25);
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 11px;
    font-weight: 700;
    color: white;
    font-family: system-ui, sans-serif;
    cursor: pointer;
    opacity: ${opacity};
    transition: transform 0.1s;
  `
  el.textContent = String(seq)
  return el
}

// Marqueur pour PLUSIEURS commandes à la même adresse : pastille allongée « 3·4 ».
function makeMultiMarkerEl(label: string, color: string): HTMLElement {
  const el = document.createElement('div')
  el.style.cssText = `
    min-width: 28px;
    height: 28px;
    padding: 0 8px;
    border-radius: 14px;
    background: ${color};
    border: 2.5px solid white;
    box-shadow: 0 2px 8px rgba(0,0,0,0.3);
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 11px;
    font-weight: 700;
    color: white;
    font-family: system-ui, sans-serif;
    cursor: pointer;
    white-space: nowrap;
  `
  el.textContent = label
  return el
}

// ── Component ─────────────────────────────────────────────────────────────────

const FRANCE_CENTER: [number, number] = [2.35, 46.8]

export default function ToursMap({ tours, height = 480 }: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef       = useRef<mapboxgl.Map | null>(null)
  const markersRef   = useRef<mapboxgl.Marker[]>([])
  const [status, setStatus] = useState<'loading' | 'ready' | 'empty'>('loading')

  // Build a stable key from the tours content
  const toursKey = tours.map(t => `${t.id}:${t.stops.map(s => s.id).join(',')}`).join('|')

  useEffect(() => {
    if (!containerRef.current) return
    const token = process.env.NEXT_PUBLIC_MAPBOX_TOKEN ?? ''
    if (!token) return

    let cancelled = false
    setStatus('loading')

    // Clear previous markers
    markersRef.current.forEach(m => m.remove())
    markersRef.current = []

    async function init() {
      const mgl = (await import('mapbox-gl')).default
      mgl.accessToken = token

      // Re-use existing map if possible, else create
      if (!mapRef.current) {
        mapRef.current = new mgl.Map({
          container: containerRef.current!,
          style: 'mapbox://styles/mapbox/streets-v12',
          center: FRANCE_CENTER,
          zoom: 5,
          attributionControl: false,
        })
        await new Promise<void>(resolve => mapRef.current!.once('load', () => resolve()))
      }

      if (cancelled) return

      const map = mapRef.current!
      const bounds = new mgl.LngLatBounds()
      let hasAny = false

      // Geocode all stops in parallel across all tours
      const activeTours = tours.filter(t => t.status !== 'completed' && t.status !== 'cancelled')

      // 1. Geocode all stops in parallel
      type StopWithMeta = {
        stop: TourMapStop
        tour: TourMapTour
        tourIdx: number
        coord: [number, number]
      }

      const allResults: StopWithMeta[] = []

      await Promise.all(
        activeTours.flatMap((tour, tourIdx) =>
          tour.stops.map(async (stop) => {
            if (cancelled) return
            const coord = await geocode(stop, token)
            if (!coord || cancelled) return
            allResults.push({ stop, tour, tourIdx, coord })
          })
        )
      )

      if (cancelled) return

      // 2. Regroupe par adresse (coord arrondie ~11 m) : plusieurs commandes au même
      // endroit → UN seul marqueur listant tout (impossible à distinguer sinon).
      const coordKey = ([lng, lat]: [number, number]) =>
        `${lat.toFixed(4)},${lng.toFixed(4)}`

      const groups = new Map<string, StopWithMeta[]>()
      for (const r of allResults) {
        const k = coordKey(r.coord)
        if (!groups.has(k)) groups.set(k, [])
        groups.get(k)!.push(r)
      }

      const esc = (s: string) => s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!))

      // 3. Un marqueur par adresse
      for (const group of groups.values()) {
        const base = group[0]
        hasAny = true
        bounds.extend(base.coord)

        if (group.length === 1) {
          const { stop, tour, tourIdx } = base
          const color = tourColor(tourIdx)
          const el = makeMarkerEl(color, stop.sequence, stop.status)
          const popup = new mgl.Popup({ offset: 14, closeButton: false, maxWidth: '240px' }).setHTML(`
            <div style="font-size:12px;line-height:1.6;font-family:system-ui,sans-serif">
              <div style="font-weight:700;color:#1a1a2e">${esc(stop.customer_name || stop.order_name)}</div>
              <div style="font-family:ui-monospace,monospace;color:#888;font-size:11px">${esc(stop.order_name)}</div>
              <div style="color:#6b6b63">${stop.address1 ? esc(stop.address1) + ', ' : ''}${esc(stop.city)} ${esc(stop.zip)}</div>
              <div style="margin-top:4px;display:flex;align-items:center;gap:6px">
                <span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:${color};flex-shrink:0"></span>
                <span style="color:#1a1a2e;font-weight:600">${esc(tour.name)}</span>
              </div>
              <div style="color:#6b6b63;font-size:11px">${esc(tour.driver_name)} · ${stop.panel_count} panneau${stop.panel_count !== 1 ? 'x' : ''}</div>
            </div>
          `)
          const marker = new mgl.Marker({ element: el }).setLngLat(base.coord).setPopup(popup).addTo(map)
          el.addEventListener('mouseenter', () => popup.addTo(map))
          el.addEventListener('mouseleave', () => popup.remove())
          markersRef.current.push(marker)
        } else {
          // Plusieurs commandes à la même adresse → pastille « 3·4 » + liste au clic
          const sorted = [...group].sort((a, b) => a.stop.sequence - b.stop.sequence)
          const sameTour = sorted.every(r => r.tourIdx === sorted[0].tourIdx)
          const color = sameTour ? tourColor(sorted[0].tourIdx) : '#1a1a2e'
          const label = sorted.map(r => r.stop.sequence).join('·')
          const el = makeMultiMarkerEl(label, color)
          const rows = sorted.map(r => `
            <div style="display:flex;align-items:center;gap:7px;padding:5px 0;border-top:1px solid #f0f0ee">
              <span style="flex-shrink:0;width:18px;height:18px;border-radius:50%;background:${tourColor(r.tourIdx)};color:#fff;font-size:10px;font-weight:700;display:flex;align-items:center;justify-content:center">${r.stop.sequence}</span>
              <div style="min-width:0">
                <div style="font-weight:600;color:#1a1a2e">${esc(r.stop.customer_name || r.stop.order_name)} <span style="font-family:ui-monospace,monospace;color:#888;font-weight:400">${esc(r.stop.order_name)}</span></div>
                <div style="color:#6b6b63;font-size:11px">${esc(r.tour.name)} · ${r.stop.panel_count} panneau${r.stop.panel_count !== 1 ? 'x' : ''}</div>
              </div>
            </div>`).join('')
          const popup = new mgl.Popup({ offset: 14, closeButton: true, maxWidth: '280px' }).setHTML(`
            <div style="font-size:12px;line-height:1.5;font-family:system-ui,sans-serif">
              <div style="font-weight:700;color:#1a1a2e">${group.length} commandes — même adresse</div>
              <div style="color:#6b6b63">${base.stop.address1 ? esc(base.stop.address1) + ', ' : ''}${esc(base.stop.city)} ${esc(base.stop.zip)}</div>
              ${rows}
            </div>
          `)
          const marker = new mgl.Marker({ element: el }).setLngLat(base.coord).setPopup(popup).addTo(map)
          el.addEventListener('mouseenter', () => popup.addTo(map))
          markersRef.current.push(marker)
        }
      }

      if (cancelled) return

      if (hasAny) {
        map.fitBounds(bounds, { padding: 60, maxZoom: 12, duration: 800 })
        setStatus('ready')
      } else {
        setStatus('empty')
      }
    }

    init().catch(console.error)

    return () => {
      cancelled = true
      markersRef.current.forEach(m => m.remove())
      markersRef.current = []
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [toursKey])

  // Cleanup map on unmount
  useEffect(() => {
    return () => {
      markersRef.current.forEach(m => m.remove())
      mapRef.current?.remove()
      mapRef.current = null
    }
  }, [])

  const activeTours = tours.filter(t => t.status !== 'completed' && t.status !== 'cancelled')

  return (
    <div className="relative rounded-[14px] overflow-hidden" style={{ height }}>
      <div ref={containerRef} className="absolute inset-0" />

      {/* Loading overlay */}
      {status === 'loading' && (
        <div className="absolute inset-0 flex items-center justify-center bg-white/70 pointer-events-none">
          <span className="text-sm text-[#6b6b63]">Localisation des stops…</span>
        </div>
      )}

      {/* Empty state */}
      {status === 'empty' && (
        <div className="absolute inset-0 flex items-center justify-center bg-white/80 pointer-events-none">
          <span className="text-sm text-[#6b6b63]">Aucun stop à afficher</span>
        </div>
      )}

      {/* Legend */}
      {status === 'ready' && activeTours.length > 0 && (
        <div
          className="absolute top-3 right-3 bg-white rounded-[10px] shadow-md px-3 py-2 space-y-1.5 max-h-56 overflow-y-auto"
          style={{ minWidth: 140, maxWidth: 220 }}
        >
          {activeTours.map((tour, i) => (
            <div key={tour.id} className="flex items-center gap-2">
              <div className="w-3 h-3 rounded-full shrink-0" style={{ background: tourColor(i) }} />
              <div className="min-w-0">
                <p className="text-[11px] font-semibold text-[#1a1a2e] truncate leading-tight">{tour.name}</p>
                <p className="text-[10px] text-[#9b9b93] leading-tight">{tour.stops.length} stops</p>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
