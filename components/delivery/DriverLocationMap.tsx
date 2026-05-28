'use client'

import { useEffect, useRef, useState, useCallback } from 'react'
import type mapboxgl from 'mapbox-gl'
import { RefreshCw, Battery, MapPin, Clock } from 'lucide-react'

interface Position {
  id:           string
  lat:          number
  lng:          number
  accuracy:     number | null
  battery_level: number | null
  recorded_at:  string
}

interface Props {
  driverName: string
}

const REFRESH_MS = 30_000  // auto-refresh toutes les 30s

function fmtTime(iso: string) {
  return new Date(iso).toLocaleTimeString('fr-FR', {
    timeZone: 'Europe/Paris',
    hour: '2-digit', minute: '2-digit',
  })
}

function fmtRelative(iso: string) {
  const diffMs = Date.now() - new Date(iso).getTime()
  const mins = Math.floor(diffMs / 60_000)
  if (mins < 1)  return "à l'instant"
  if (mins < 60) return `il y a ${mins} min`
  const hrs = Math.floor(mins / 60)
  return `il y a ${hrs}h${String(mins % 60).padStart(2, '0')}`
}

export default function DriverLocationMap({ driverName }: Props) {
  const mapContainer = useRef<HTMLDivElement>(null)
  const mapRef       = useRef<mapboxgl.Map | null>(null)
  const markerRef    = useRef<mapboxgl.Marker | null>(null)
  const trailRef     = useRef<mapboxgl.GeoJSONSource | null>(null)

  const [positions, setPositions]   = useState<Position[]>([])
  const [loading, setLoading]       = useState(false)
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null)
  const [mapReady, setMapReady]     = useState(false)

  // ── Fetch positions ──────────────────────────────────────────────────────────
  const fetchPositions = useCallback(async () => {
    setLoading(true)
    try {
      const since = new Date(Date.now() - 24 * 3600_000).toISOString()
      const res   = await fetch(`/api/delivery/location?driver=${encodeURIComponent(driverName)}&since=${since}`)
      const json  = await res.json()
      setPositions(json.positions ?? [])
      setLastRefresh(new Date())
    } catch (e) {
      console.error(e)
    } finally {
      setLoading(false)
    }
  }, [driverName])

  // ── Init map ─────────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!mapContainer.current || mapRef.current) return
    const token = process.env.NEXT_PUBLIC_MAPBOX_TOKEN ?? ''
    if (!token) return

    import('mapbox-gl').then(({ default: mapboxgl }) => {
      import('mapbox-gl/dist/mapbox-gl.css')
      mapboxgl.accessToken = token

      const map = new mapboxgl.Map({
        container: mapContainer.current!,
        style:     'mapbox://styles/mapbox/dark-v11',
        center:    [2.3488, 48.8534],  // Paris par défaut
        zoom:      10,
      })
      mapRef.current = map

      map.once('load', () => {
        // Ligne de trajet
        map.addSource('trail', {
          type: 'geojson',
          data: { type: 'FeatureCollection', features: [] },
        })
        map.addLayer({
          id:     'trail-line',
          type:   'line',
          source: 'trail',
          paint: {
            'line-color':   '#6366f1',
            'line-width':   3,
            'line-opacity': 0.7,
          },
        })
        // Points horaires
        map.addSource('hourly', {
          type: 'geojson',
          data: { type: 'FeatureCollection', features: [] },
        })
        map.addLayer({
          id:     'hourly-dots',
          type:   'circle',
          source: 'hourly',
          paint: {
            'circle-radius': 5,
            'circle-color':  '#a5b4fc',
            'circle-stroke-width': 2,
            'circle-stroke-color': '#fff',
          },
        })

        trailRef.current = map.getSource('trail') as mapboxgl.GeoJSONSource
        setMapReady(true)
        fetchPositions()
      })
    })

    return () => {
      mapRef.current?.remove()
      mapRef.current = null
    }
  }, [fetchPositions])

  // ── Update map when positions change ────────────────────────────────────────
  useEffect(() => {
    if (!mapReady || !mapRef.current || positions.length === 0) return
    const map = mapRef.current

    const coords = positions.map(p => [p.lng, p.lat] as [number, number])
    const latest = positions[positions.length - 1]

    // Trajet complet
    ;(map.getSource('trail') as mapboxgl.GeoJSONSource)?.setData({
      type: 'FeatureCollection',
      features: [{
        type: 'Feature',
        properties: {},
        geometry: { type: 'LineString', coordinates: coords },
      }],
    })

    // Points toutes les heures
    const hourlyPositions: Position[] = []
    let lastHour = -1
    for (const p of positions) {
      const h = new Date(p.recorded_at).getHours()
      if (h !== lastHour) { hourlyPositions.push(p); lastHour = h }
    }
    ;(map.getSource('hourly') as mapboxgl.GeoJSONSource)?.setData({
      type: 'FeatureCollection',
      features: hourlyPositions.map(p => ({
        type:       'Feature',
        properties: { time: fmtTime(p.recorded_at) },
        geometry:   { type: 'Point', coordinates: [p.lng, p.lat] },
      })),
    })

    // Marqueur position actuelle
    const el = document.createElement('div')
    el.style.cssText = `
      width:20px;height:20px;
      background:#6366f1;
      border:3px solid white;
      border-radius:50%;
      box-shadow:0 0 0 4px rgba(99,102,241,0.3);
    `
    if (markerRef.current) markerRef.current.remove()
    import('mapbox-gl').then(({ default: mapboxgl }) => {
      markerRef.current = new mapboxgl.Marker({ element: el })
        .setLngLat([latest.lng, latest.lat])
        .setPopup(new mapboxgl.Popup({ offset: 16 }).setHTML(
          `<div style="font-size:12px;font-weight:600">${driverName}</div>
           <div style="font-size:11px;color:#666">${fmtTime(latest.recorded_at)}</div>
           ${latest.accuracy ? `<div style="font-size:11px;color:#888">±${Math.round(latest.accuracy)}m</div>` : ''}`
        ))
        .addTo(map)
    })

    // Centrer sur la dernière position
    map.flyTo({ center: [latest.lng, latest.lat], zoom: 13, duration: 800 })
  }, [positions, mapReady, driverName])

  // ── Auto-refresh ─────────────────────────────────────────────────────────────
  useEffect(() => {
    const id = setInterval(fetchPositions, REFRESH_MS)
    return () => clearInterval(id)
  }, [fetchPositions])

  const latest = positions[positions.length - 1]

  return (
    <div className="space-y-3">
      {/* Barre de statut */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-3 flex-wrap">
          {latest ? (
            <>
              <div className="flex items-center gap-1.5 bg-[#dcfce7] text-[#15803d] px-2.5 py-1 rounded-full">
                <div className="w-2 h-2 rounded-full bg-[#15803d] animate-pulse" />
                <span className="text-[11px] font-semibold">{fmtRelative(latest.recorded_at)}</span>
              </div>
              <span className="text-xs text-[#9b9b93] flex items-center gap-1">
                <Clock size={11} />{fmtTime(latest.recorded_at)}
              </span>
              {latest.accuracy != null && (
                <span className="text-xs text-[#9b9b93] flex items-center gap-1">
                  <MapPin size={11} />±{Math.round(latest.accuracy)}m
                </span>
              )}
              {latest.battery_level != null && (
                <span className={`text-xs flex items-center gap-1 ${latest.battery_level > 20 ? 'text-[#9b9b93]' : 'text-[#b91c1c]'}`}>
                  <Battery size={11} />{latest.battery_level}%
                </span>
              )}
            </>
          ) : (
            <span className="text-xs text-[#9b9b93]">Aucune position aujourd&apos;hui</span>
          )}
        </div>

        <div className="flex items-center gap-2">
          {lastRefresh && (
            <span className="text-[10px] text-[#9b9b93]">
              Actualisé à {lastRefresh.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}
            </span>
          )}
          <button
            onClick={fetchPositions}
            disabled={loading}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#f8f7f5] hover:bg-[#efefed] text-[11px] font-medium text-[#1a1a2e] transition-colors disabled:opacity-50"
          >
            <RefreshCw size={11} className={loading ? 'animate-spin' : ''} />
            Actualiser
          </button>
        </div>
      </div>

      {/* Carte */}
      <div
        ref={mapContainer}
        className="w-full rounded-[14px] overflow-hidden border border-[#e8e8e4]"
        style={{ height: 420 }}
      />

      {/* Légende */}
      <div className="flex items-center gap-4 flex-wrap text-[10px] text-[#9b9b93]">
        <div className="flex items-center gap-1.5">
          <div className="w-3 h-3 rounded-full bg-[#6366f1] border-2 border-white shadow" />
          Position actuelle
        </div>
        <div className="flex items-center gap-1.5">
          <div className="w-3 h-3 rounded-full bg-[#a5b4fc] border-2 border-white" />
          Snapshot horaire
        </div>
        <div className="flex items-center gap-1.5">
          <div className="h-0.5 w-6 bg-[#6366f1] rounded" style={{ opacity: 0.7 }} />
          Trajet du jour
        </div>
        <span className="ml-auto">{positions.length} positions · 24h · refresh auto 30s</span>
      </div>
    </div>
  )
}
