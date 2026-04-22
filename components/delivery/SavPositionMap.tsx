'use client'

import { useEffect, useRef } from 'react'
import type mapboxgl from 'mapbox-gl'

export interface SavStop {
  id: string
  address1: string
  city: string
  zip: string
  customer_name: string
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
      `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(address)}.json?access_token=${token}&country=fr&limit=1&types=address`
    )
    if (!res.ok) return null
    const data = await res.json()
    const c = data.features?.[0]?.center
    return c ?? null
  } catch { return null }
}

function makeTruckEl(): HTMLElement {
  const el = document.createElement('div')
  el.style.cssText = `
    width:36px;height:36px;border-radius:50%;
    background:#1a1a2e;border:3px solid white;
    box-shadow:0 2px 10px rgba(0,0,0,0.4);
    display:flex;align-items:center;justify-content:center;
    font-size:18px;
  `
  el.textContent = '🚛'
  return el
}

function makeStopDot(status: string): HTMLElement {
  const el = document.createElement('div')
  const color = status === 'delivered' ? '#22c55e' : status === 'failed' ? '#f97316' : '#d1d5db'
  el.style.cssText = `
    width:10px;height:10px;border-radius:50%;
    background:${color};border:2px solid white;
    box-shadow:0 1px 4px rgba(0,0,0,0.2);
  `
  return el
}

export default function SavPositionMap({ stops, height = 220 }: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef       = useRef<mapboxgl.Map | null>(null)
  const token = process.env.NEXT_PUBLIC_MAPBOX_TOKEN ?? ''

  // Last delivered stop = Khalid's approximate position
  const lastDelivered = [...stops]
    .filter(s => s.status === 'delivered' && s.delivered_at)
    .sort((a, b) => new Date(b.delivered_at!).getTime() - new Date(a.delivered_at!).getTime())[0]

  const positionKey = lastDelivered?.id ?? 'none'

  useEffect(() => {
    if (!containerRef.current || !token || !lastDelivered) return
    let cancelled = false

    async function init() {
      const mgl = (await import('mapbox-gl')).default

      // Geocode last delivered stop + 2 surrounding stops for context
      const nearby = stops.slice(Math.max(0, stops.indexOf(lastDelivered) - 1), stops.indexOf(lastDelivered) + 3)
      const geocoded = await Promise.all(
        nearby.map(s => geocodeAddress(`${s.address1}, ${s.city} ${s.zip}, France`, token))
      )
      if (cancelled) return

      const truckCoord = geocoded[nearby.indexOf(lastDelivered)]
      if (!truckCoord) return

      mgl.accessToken = token
      const map = new mgl.Map({
        container: containerRef.current!,
        style: 'mapbox://styles/mapbox/streets-v12',
        center: truckCoord,
        zoom: 12,
        attributionControl: false,
        interactive: false,
      })
      mapRef.current = map

      map.on('load', () => {
        if (cancelled) return

        // Other nearby stops — small dots
        nearby.forEach((s, i) => {
          const coord = geocoded[i]
          if (!coord || s.id === lastDelivered.id) return
          new mgl.Marker({ element: makeStopDot(s.status) })
            .setLngLat(coord)
            .addTo(map)
        })

        // Truck marker on last delivered
        new mgl.Marker({ element: makeTruckEl() })
          .setLngLat(truckCoord)
          .setPopup(
            new mgl.Popup({ offset: 20 }).setHTML(
              `<div style="font-size:12px"><strong>${lastDelivered.customer_name}</strong><br><span style="color:#555">${lastDelivered.city}</span></div>`
            )
          )
          .addTo(map)
      })
    }

    init().catch(console.error)
    return () => {
      cancelled = true
      mapRef.current?.remove()
      mapRef.current = null
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [positionKey])

  if (!lastDelivered) return null

  return (
    <div className="relative rounded-[12px] overflow-hidden mt-4" style={{ height }}>
      <div ref={containerRef} className="absolute inset-0" />
      <div className="absolute top-2 left-2 bg-white/90 rounded-[8px] px-2.5 py-1.5 text-xs font-medium text-[#1a1a2e] shadow-sm">
        🚛 Khalid · {lastDelivered.city}
      </div>
    </div>
  )
}
