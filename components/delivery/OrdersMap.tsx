'use client'

import { useEffect, useRef, useState } from 'react'
import type mapboxgl from 'mapbox-gl'

type Zone = 'nord-est' | 'nord-ouest' | 'sud-est' | 'sud-ouest'

const ZONE_FILL: Record<Zone, string> = {
  'nord-est':   '#1d4ed8',
  'nord-ouest': '#15803d',
  'sud-est':    '#c2680a',
  'sud-ouest':  '#7c3aed',
}

export interface MapOrder {
  order_name: string
  customer_name: string
  address1: string
  city: string
  zip: string
  zone: Zone
  panel_count: number
}

interface Props {
  orders: MapOrder[]
  selectedOrders: Set<string>
  onToggle: (orderName: string) => void
  height?: number
}

function makeOrderMarker(zone: Zone, selected: boolean): HTMLElement {
  const el = document.createElement('div')
  const color = ZONE_FILL[zone]
  el.style.cssText = `
    width:${selected ? 26 : 18}px;
    height:${selected ? 26 : 18}px;
    border-radius:50%;
    background:${color};
    border:${selected ? '3px solid white' : '2px solid rgba(255,255,255,0.7)'};
    box-shadow:0 2px 6px rgba(0,0,0,0.3);
    cursor:pointer;
    transition:all 0.15s;
  `
  return el
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

// France center
const FRANCE_CENTER: [number, number] = [2.3522, 46.8]

export default function OrdersMap({ orders, selectedOrders, onToggle, height = 420 }: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef       = useRef<mapboxgl.Map | null>(null)
  const markersRef   = useRef<Map<string, { marker: mapboxgl.Marker; el: HTMLElement; zone: Zone }>>(new Map())
  const coordsCache  = useRef<Map<string, [number, number]>>(new Map())
  const [geocoding, setGeocoding] = useState(true)

  const token = process.env.NEXT_PUBLIC_MAPBOX_TOKEN ?? ''

  // Init map once
  useEffect(() => {
    if (!containerRef.current || !token) return
    let cancelled = false

    async function init() {
      const mgl = (await import('mapbox-gl')).default

      mgl.accessToken = token
      const map = new mgl.Map({
        container: containerRef.current!,
        style: 'mapbox://styles/mapbox/streets-v12',
        center: FRANCE_CENTER,
        zoom: 5,
        attributionControl: false,
      })
      mapRef.current = map

      map.on('load', async () => {
        if (cancelled) return

        // Geocode all orders in parallel
        await Promise.all(
          orders.map(async (o) => {
            if (coordsCache.current.has(o.order_name)) return
            const coord = await geocodeAddress(`${o.address1}, ${o.city} ${o.zip}, France`, token)
            if (coord) coordsCache.current.set(o.order_name, coord)
          })
        )
        if (cancelled) return
        setGeocoding(false)

        // Add markers
        const bounds = new mgl.LngLatBounds()
        let hasCoords = false

        for (const order of orders) {
          const coord = coordsCache.current.get(order.order_name)
          if (!coord) continue
          hasCoords = true
          bounds.extend(coord)

          const isSelected = selectedOrders.has(order.order_name)
          const el = makeOrderMarker(order.zone, isSelected)

          const marker = new mgl.Marker({ element: el })
            .setLngLat(coord)
            .setPopup(
              new mgl.Popup({ offset: 12, closeButton: false }).setHTML(
                `<div style="font-size:13px;line-height:1.5">
                  <strong>${order.customer_name}</strong><br>
                  <span style="color:#555">${order.city}</span><br>
                  <span style="color:#1a7f4b;font-weight:600">${order.panel_count} panneau${order.panel_count !== 1 ? 'x' : ''}</span>
                </div>`
              )
            )
            .addTo(map)

          el.addEventListener('click', (e) => {
            e.stopPropagation()
            onToggle(order.order_name)
          })
          el.addEventListener('mouseenter', () => marker.getPopup()?.addTo(map))
          el.addEventListener('mouseleave', () => marker.getPopup()?.remove())

          markersRef.current.set(order.order_name, { marker, el, zone: order.zone })
        }

        if (hasCoords) {
          map.fitBounds(bounds, { padding: 50, maxZoom: 10, duration: 800 })
        }
      })
    }

    init().catch(console.error)
    return () => {
      cancelled = true
      markersRef.current.forEach(({ marker }) => marker.remove())
      markersRef.current.clear()
      mapRef.current?.remove()
      mapRef.current = null
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orders.map(o => o.order_name).join(',')])  // re-init if order list changes

  // Update marker styles when selection changes (no map re-init)
  useEffect(() => {
    markersRef.current.forEach(({ el, zone }, orderName) => {
      const isSelected = selectedOrders.has(orderName)
      const color = ZONE_FILL[zone]
      el.style.width  = isSelected ? '26px' : '18px'
      el.style.height = isSelected ? '26px' : '18px'
      el.style.background = color
      el.style.border = isSelected ? '3px solid white' : '2px solid rgba(255,255,255,0.7)'
    })
  }, [selectedOrders])

  return (
    <div className="relative rounded-[14px] overflow-hidden" style={{ height }}>
      <div ref={containerRef} className="absolute inset-0" />
      {geocoding && (
        <div className="absolute inset-0 flex items-center justify-center bg-white/60 pointer-events-none">
          <span className="text-sm text-[#6b6b63]">Localisation des commandes…</span>
        </div>
      )}
    </div>
  )
}
