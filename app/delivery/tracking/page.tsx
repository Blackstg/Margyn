'use client'

import { useEffect, useRef, useState } from 'react'
import { MapPin, Wifi, WifiOff, Battery, Clock } from 'lucide-react'

const DRIVER_NAME  = 'Khalid'
const INTERVAL_MS  = 5 * 60 * 1000   // toutes les 5 minutes

interface Status {
  lastSync:   string | null
  accuracy:   number | null
  battery:    number | null
  error:      string | null
  syncing:    boolean
  totalSyncs: number
}

export default function TrackingPage() {
  const [status, setStatus] = useState<Status>({
    lastSync: null, accuracy: null, battery: null,
    error: null, syncing: false, totalSyncs: 0,
  })
  const [active, setActive] = useState(false)
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const wakeLockRef = useRef<WakeLockSentinel | null>(null)

  async function getBattery(): Promise<number | null> {
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const nav = navigator as any
      if (nav.getBattery) {
        const b = await nav.getBattery()
        return Math.round(b.level * 100)
      }
    } catch {}
    return null
  }

  async function sendPosition() {
    setStatus(s => ({ ...s, syncing: true, error: null }))
    try {
      const pos = await new Promise<GeolocationPosition>((resolve, reject) =>
        navigator.geolocation.getCurrentPosition(resolve, reject, {
          enableHighAccuracy: true,
          timeout: 15_000,
          maximumAge: 30_000,
        })
      )
      const battery = await getBattery()
      const res = await fetch('/api/delivery/location', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          driver_name: DRIVER_NAME,
          lat:         pos.coords.latitude,
          lng:         pos.coords.longitude,
          accuracy:    pos.coords.accuracy,
          battery,
        }),
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      setStatus(s => ({
        ...s,
        syncing:    false,
        lastSync:   new Date().toLocaleTimeString('fr-FR'),
        accuracy:   Math.round(pos.coords.accuracy),
        battery,
        totalSyncs: s.totalSyncs + 1,
      }))
    } catch (err) {
      const msg = err instanceof GeolocationPositionError
        ? ['Permission refusée', 'Position indisponible', 'Délai expiré'][err.code - 1] ?? 'Erreur GPS'
        : String(err)
      setStatus(s => ({ ...s, syncing: false, error: msg }))
    }
  }

  async function startTracking() {
    if (!navigator.geolocation) {
      setStatus(s => ({ ...s, error: 'GPS non supporté par ce navigateur' }))
      return
    }
    // Wake lock pour garder l'écran allumé
    try {
      wakeLockRef.current = await navigator.wakeLock?.request('screen')
    } catch {}

    setActive(true)
    await sendPosition()
    intervalRef.current = setInterval(sendPosition, INTERVAL_MS)
  }

  function stopTracking() {
    if (intervalRef.current) clearInterval(intervalRef.current)
    wakeLockRef.current?.release()
    setActive(false)
  }

  useEffect(() => () => {
    if (intervalRef.current) clearInterval(intervalRef.current)
    wakeLockRef.current?.release()
  }, [])

  const nextSyncIn = status.lastSync
    ? `dans ${Math.round(INTERVAL_MS / 60_000)} min`
    : '—'

  return (
    <div className="min-h-screen bg-[#1a1a2e] flex flex-col items-center justify-center p-6 text-white">
      <div className="w-full max-w-sm space-y-6">

        {/* Header */}
        <div className="text-center">
          <div className="w-16 h-16 rounded-full bg-[#6366f1]/20 flex items-center justify-center mx-auto mb-3">
            <MapPin size={28} className="text-[#6366f1]" />
          </div>
          <h1 className="text-xl font-bold">Suivi GPS</h1>
          <p className="text-sm text-white/50 mt-1">{DRIVER_NAME} · Margyn</p>
        </div>

        {/* Statut */}
        <div className="bg-white/5 rounded-2xl p-5 space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-sm text-white/60">Statut</span>
            <div className="flex items-center gap-2">
              {active
                ? <><div className="w-2 h-2 rounded-full bg-green-400 animate-pulse" /><span className="text-sm text-green-400 font-medium">Actif</span></>
                : <><div className="w-2 h-2 rounded-full bg-white/30" /><span className="text-sm text-white/40">Inactif</span></>
              }
            </div>
          </div>

          <div className="flex items-center justify-between">
            <span className="text-sm text-white/60 flex items-center gap-1.5"><Clock size={13} />Dernier envoi</span>
            <span className="text-sm font-mono">{status.lastSync ?? '—'}</span>
          </div>

          <div className="flex items-center justify-between">
            <span className="text-sm text-white/60">Prochain envoi</span>
            <span className="text-sm">{active ? nextSyncIn : '—'}</span>
          </div>

          {status.accuracy != null && (
            <div className="flex items-center justify-between">
              <span className="text-sm text-white/60 flex items-center gap-1.5"><Wifi size={13} />Précision GPS</span>
              <span className={`text-sm font-medium ${status.accuracy < 20 ? 'text-green-400' : status.accuracy < 60 ? 'text-yellow-400' : 'text-red-400'}`}>
                ±{status.accuracy}m
              </span>
            </div>
          )}

          {status.battery != null && (
            <div className="flex items-center justify-between">
              <span className="text-sm text-white/60 flex items-center gap-1.5"><Battery size={13} />Batterie</span>
              <span className={`text-sm font-medium ${status.battery > 20 ? 'text-green-400' : 'text-red-400'}`}>
                {status.battery}%
              </span>
            </div>
          )}

          {status.totalSyncs > 0 && (
            <div className="flex items-center justify-between">
              <span className="text-sm text-white/60">Positions envoyées</span>
              <span className="text-sm">{status.totalSyncs}</span>
            </div>
          )}
        </div>

        {/* Erreur */}
        {status.error && (
          <div className="bg-red-500/20 border border-red-500/40 rounded-xl p-4 flex items-start gap-2">
            <WifiOff size={16} className="text-red-400 shrink-0 mt-0.5" />
            <p className="text-sm text-red-300">{status.error}</p>
          </div>
        )}

        {/* Bouton */}
        <button
          onClick={active ? stopTracking : startTracking}
          disabled={status.syncing}
          className={`w-full py-4 rounded-2xl font-bold text-base transition-all ${
            active
              ? 'bg-red-500/20 text-red-400 border border-red-500/40 hover:bg-red-500/30'
              : 'bg-[#6366f1] text-white hover:bg-[#4f52d3] shadow-lg shadow-[#6366f1]/30'
          } disabled:opacity-50`}
        >
          {status.syncing ? 'Envoi en cours…' : active ? 'Arrêter le suivi' : 'Démarrer le suivi'}
        </button>

        <p className="text-center text-xs text-white/30">
          Garde cette page ouverte · Position envoyée toutes les 5 min
        </p>
      </div>
    </div>
  )
}
