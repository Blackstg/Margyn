'use client'

import { useEffect, useRef, useState } from 'react'
import { ChevronLeft } from 'lucide-react'
import type mapboxgl from 'mapbox-gl'

interface MapStop {
  id: string
  order_name: string
  customer_name: string
  address1: string
  city: string
  zip: string
  sequence: number
  status: 'pending' | 'delivered' | 'failed'
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
}

export default function TourMap({ stops, onBack, precomputedCoords, etaMap }: TourMapProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<mapboxgl.Map | null>(null)
  const [phase, setPhase] = useState<'geocoding' | 'routing' | 'ready' | 'error'>('geocoding')

  const sortedStops = [...stops].sort((a, b) => a.sequence - b.sequence)
  const token = process.env.NEXT_PUBLIC_MAPBOX_TOKEN ?? ''

  useEffect(() => {
    if (!containerRef.current || !token) { setPhase('error'); return }
    let cancelled = false

    async function init() {
      // Dynamic import to avoid SSR issues
      const mgl = (await import('mapbox-gl')).default
      // CSS must be imported once — guard with a flag on window
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

          const color =
            stop.status === 'delivered' ? '#22c55e'
            : stop.status === 'failed'    ? '#f97316'
            : '#3b82f6'

          const el = makeStopMarkerEl(String(i + 1), color)
          const eta = etaMap?.get(stop.id)
          new mgl.Marker({ element: el })
            .setLngLat(coord)
            .setPopup(
              new mgl.Popup({ offset: 18 }).setHTML(
                `<div style="font-size:13px;line-height:1.5">
                  <strong>${stop.customer_name}</strong><br>
                  <span style="color:#555">${stop.address1}, ${stop.city}</span>${eta
                    ? `<br><span style="color:#1a7f4b;font-weight:600">⏱ ${stop.status === 'delivered' ? 'Livré à' : 'Arrivée'} : ${eta}</span>`
                    : ''}
                </div>`
              )
            )
            .addTo(map)
        })

        // Route line via Directions API (max 25 waypoints)
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

  const phaseLabel =
    phase === 'geocoding' ? 'Localisation des arrêts…'
    : phase === 'routing'  ? 'Calcul de l\'itinéraire…'
    : ''

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
    </div>
  )
}
