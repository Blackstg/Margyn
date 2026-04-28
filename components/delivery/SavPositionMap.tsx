'use client'

import { useEffect, useRef } from 'react'
import type mapboxgl from 'mapbox-gl'

export interface SavStop {
  id: string
  address1: string
  city: string
  zip: string
  customer_name: string
  order_name?: string
  status: 'pending' | 'delivered' | 'failed'
  delivered_at: string | null
}

interface Props {
  stops: SavStop[]
  height?: number
}

async function geocodeAddress(address: string, token: string): Promise<[number, number] | null> {
  try {
    const res = await fetch(
      `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(address)}.json` +
      `?access_token=${token}&country=fr&limit=1&types=address`,
      { cache: 'no-store' }
    )
    if (!res.ok) return null
    const data = await res.json()
    const c = data.features?.[0]?.center
    return c ?? null
  } catch { return null }
}

function makeStopMarker(index: number, status: 'pending' | 'delivered' | 'failed'): HTMLElement {
  const el = document.createElement('div')
  const isDelivered = status === 'delivered'
  const isFailed    = status === 'failed'

  const bg     = isDelivered ? '#1a7f4b' : isFailed ? '#f97316' : '#1a1a2e'
  const border = isDelivered ? '#bbf7d0' : isFailed ? '#fed7aa' : '#aeb0c9'
  const size   = isDelivered ? 28 : 32

  el.style.cssText = `
    width:${size}px;height:${size}px;border-radius:50%;
    background:${bg};border:2.5px solid ${border};
    box-shadow:0 2px 8px rgba(0,0,0,0.25);
    display:flex;align-items:center;justify-content:center;
    font-size:11px;font-weight:700;color:white;
    font-family:system-ui,sans-serif;
    cursor:pointer;
    transition:transform 0.15s;
  `
  el.textContent = isDelivered ? '✓' : isFailed ? '✕' : String(index + 1)
  el.addEventListener('mouseenter', () => { el.style.transform = 'scale(1.15)' })
  el.addEventListener('mouseleave', () => { el.style.transform = 'scale(1)' })
  return el
}

function makeTruckMarker(): HTMLElement {
  const el = document.createElement('div')
  el.style.cssText = `
    width:40px;height:40px;border-radius:50%;
    background:#1d4ed8;border:3px solid white;
    box-shadow:0 3px 12px rgba(29,78,216,0.4);
    display:flex;align-items:center;justify-content:center;
    font-size:20px;z-index:10;
  `
  el.textContent = '🚛'
  return el
}

export default function SavPositionMap({ stops, height = 320 }: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef       = useRef<mapboxgl.Map | null>(null)
  const token = process.env.NEXT_PUBLIC_MAPBOX_TOKEN ?? ''

  // Stable key: re-init only when the set of stop IDs + their statuses changes
  const stopsKey = stops.map(s => `${s.id}:${s.status}`).join('|')

  // Last delivered = truck position
  const lastDelivered = [...stops]
    .filter(s => s.status === 'delivered' && s.delivered_at)
    .sort((a, b) => new Date(b.delivered_at!).getTime() - new Date(a.delivered_at!).getTime())[0]

  useEffect(() => {
    if (!containerRef.current || !token || stops.length === 0) return
    let cancelled = false

    async function init() {
      const mgl = (await import('mapbox-gl')).default

      // Geocode all stops in parallel
      const coords = await Promise.all(
        stops.map(s => geocodeAddress(`${s.address1}, ${s.city} ${s.zip}, France`, token))
      )
      if (cancelled) return

      // Filter valid coords and build valid stop pairs
      const validPairs: { stop: SavStop; coord: [number, number]; idx: number }[] = []
      stops.forEach((s, i) => {
        if (coords[i]) validPairs.push({ stop: s, coord: coords[i]!, idx: i })
      })
      if (validPairs.length === 0) return

      // Compute bounds
      const lngs = validPairs.map(p => p.coord[0])
      const lats = validPairs.map(p => p.coord[1])
      const bounds: [[number, number], [number, number]] = [
        [Math.min(...lngs) - 0.01, Math.min(...lats) - 0.01],
        [Math.max(...lngs) + 0.01, Math.max(...lats) + 0.01],
      ]

      mgl.accessToken = token

      // Destroy previous map if any
      mapRef.current?.remove()
      mapRef.current = null

      const map = new mgl.Map({
        container: containerRef.current!,
        style: 'mapbox://styles/mapbox/streets-v12',
        bounds,
        fitBoundsOptions: { padding: 48, maxZoom: 14 },
        attributionControl: false,
        interactive: true,   // zoom + pan enabled
      })
      mapRef.current = map

      map.addControl(new mgl.NavigationControl({ showCompass: false }), 'top-right')

      map.on('load', () => {
        if (cancelled) return

        // ── Route line (dashed for pending, solid for delivered) ──────────────
        const deliveredCoords = validPairs
          .filter(p => p.stop.status === 'delivered')
          .map(p => p.coord)
        const pendingCoords = validPairs
          .filter(p => p.stop.status !== 'delivered')
          .map(p => p.coord)

        // Delivered segments — solid green
        if (deliveredCoords.length >= 2) {
          map.addSource('route-delivered', {
            type: 'geojson',
            data: { type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: deliveredCoords } },
          })
          map.addLayer({
            id: 'route-delivered',
            type: 'line',
            source: 'route-delivered',
            layout: { 'line-join': 'round', 'line-cap': 'round' },
            paint: { 'line-color': '#1a7f4b', 'line-width': 3, 'line-opacity': 0.6 },
          })
        }

        // Pending segments — dashed gray
        const allPendingLine = [
          ...(lastDelivered ? [validPairs.find(p => p.stop.id === lastDelivered.id)?.coord].filter(Boolean) as [number,number][] : []),
          ...pendingCoords,
        ]
        if (allPendingLine.length >= 2) {
          map.addSource('route-pending', {
            type: 'geojson',
            data: { type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: allPendingLine } },
          })
          map.addLayer({
            id: 'route-pending',
            type: 'line',
            source: 'route-pending',
            layout: { 'line-join': 'round', 'line-cap': 'round' },
            paint: { 'line-color': '#9ca3af', 'line-width': 2, 'line-opacity': 0.5, 'line-dasharray': [3, 3] },
          })
        }

        // ── Stop markers ──────────────────────────────────────────────────────
        validPairs.forEach(({ stop, coord, idx }) => {
          const el = makeStopMarker(idx, stop.status)
          const popup = new mgl.Popup({ offset: 20, closeButton: false })
            .setHTML(
              `<div style="font-size:12px;line-height:1.4;">
                <strong>${stop.customer_name}</strong><br>
                <span style="color:#555">${stop.address1}, ${stop.city}</span>
                ${stop.order_name ? `<br><span style="color:#888;font-size:11px">${stop.order_name}</span>` : ''}
                ${stop.status === 'delivered' && stop.delivered_at
                  ? `<br><span style="color:#1a7f4b;font-size:11px">✓ Livré ${new Date(stop.delivered_at).toLocaleString('fr-FR', { hour: '2-digit', minute: '2-digit' })}</span>`
                  : stop.status === 'failed'
                  ? `<br><span style="color:#f97316;font-size:11px">✕ Échec livraison</span>`
                  : `<br><span style="color:#6b6b63;font-size:11px">Arrêt ${idx + 1} — en attente</span>`
                }
              </div>`
            )
          new mgl.Marker({ element: el })
            .setLngLat(coord)
            .setPopup(popup)
            .addTo(map)
        })

        // ── Truck marker on last delivered position ───────────────────────────
        if (lastDelivered) {
          const truckCoord = validPairs.find(p => p.stop.id === lastDelivered.id)?.coord
          if (truckCoord) {
            new mgl.Marker({ element: makeTruckMarker() })
              .setLngLat(truckCoord)
              .addTo(map)
          }
        }
      })
    }

    init().catch(console.error)
    return () => {
      cancelled = true
      mapRef.current?.remove()
      mapRef.current = null
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stopsKey])

  if (stops.length === 0) return null

  const deliveredCount = stops.filter(s => s.status === 'delivered').length
  const pendingCount   = stops.filter(s => s.status === 'pending').length

  return (
    <div className="relative rounded-[14px] overflow-hidden mt-4 border border-[#e8e8e4]" style={{ height }}>
      <div ref={containerRef} className="absolute inset-0" />

      {/* Legend */}
      <div className="absolute bottom-2 left-2 flex flex-col gap-1 pointer-events-none">
        <div className="flex items-center gap-3 bg-white/90 backdrop-blur-sm rounded-[8px] px-2.5 py-1.5 shadow-sm text-xs">
          {lastDelivered && (
            <span className="text-[#1d4ed8] font-semibold">🚛 {lastDelivered.city}</span>
          )}
          <span className="text-[#1a7f4b]">✓ {deliveredCount} livré{deliveredCount !== 1 ? 's' : ''}</span>
          {pendingCount > 0 && (
            <span className="text-[#6b6b63]">{pendingCount} restant{pendingCount !== 1 ? 's' : ''}</span>
          )}
        </div>
      </div>
    </div>
  )
}
