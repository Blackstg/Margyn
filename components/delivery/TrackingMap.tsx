'use client'

import { useEffect, useRef } from 'react'
import type mapboxgl from 'mapbox-gl'

interface Props {
  address: string  // full address string to geocode
}

async function geocodeAddress(address: string, token: string): Promise<[number, number] | null> {
  try {
    const res = await fetch(
      `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(address)}.json?access_token=${token}&country=fr&limit=1&types=address,place`,
      { cache: 'no-store' }
    )
    if (!res.ok) return null
    const data = await res.json() as { features?: { center: [number, number] }[] }
    return data.features?.[0]?.center ?? null
  } catch {
    return null
  }
}

export default function TrackingMap({ address }: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef       = useRef<mapboxgl.Map | null>(null)
  const token        = process.env.NEXT_PUBLIC_MAPBOX_TOKEN ?? ''

  useEffect(() => {
    if (!containerRef.current || !token || !address) return

    let mounted = true

    async function init() {
      const coord = await geocodeAddress(address, token)
      if (!mounted || !containerRef.current) return

      const mgl = (await import('mapbox-gl')).default
      if (!mounted || !containerRef.current || mapRef.current) return

      mgl.accessToken = token

      const map = new mgl.Map({
        container: containerRef.current,
        style:     'mapbox://styles/mapbox/streets-v12',
        center:    coord ?? [2.3488, 48.8534],
        zoom:      coord ? 13 : 5,
      })
      mapRef.current = map

      if (coord) {
        new mgl.Marker({ color: '#1a1a2e' })
          .setLngLat(coord)
          .addTo(map)
      }
    }

    init()

    return () => {
      mounted = false
      mapRef.current?.remove()
      mapRef.current = null
    }
  }, [address, token])

  return (
    <div
      ref={containerRef}
      className="w-full h-full rounded-[16px] overflow-hidden"
      style={{ minHeight: 220 }}
    />
  )
}
