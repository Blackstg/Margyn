'use client'

import { useState, useEffect, useRef } from 'react'
import { CloudOff } from 'lucide-react'

interface SyncStatus {
  marketing: {
    meta:      string | null
    google:    string | null
    pinterest: string | null
  }
  shopify: {
    orders_sync: string | null
    last_order:  { name: string; created_at: string } | null
  }
}

function hoursAgo(ts: string | null): number | null {
  if (!ts) return null
  return (Date.now() - new Date(ts).getTime()) / 3_600_000
}

function formatAgo(ts: string | null): string {
  const h = hoursAgo(ts)
  if (h === null) return '—'
  if (h < 1)   return 'à l\'instant'
  if (h < 48)  return `il y a ${Math.floor(h)}h`
  return `il y a ${Math.floor(h / 24)}j`
}

function statusColor(h: number | null): string {
  if (h === null)  return '#9b9b93'   // grey — no data
  if (h < 26)      return '#1a7f4b'   // green
  if (h < 48)      return '#b45309'   // orange
  return '#c7293a'                    // red
}

function Dot({ h }: { h: number | null }) {
  return (
    <span
      className="inline-block w-2 h-2 rounded-full shrink-0"
      style={{ backgroundColor: statusColor(h) }}
    />
  )
}

function worstHours(values: (number | null)[]): number | null {
  const nums = values.filter((v): v is number => v !== null)
  return nums.length ? Math.max(...nums) : null
}

export default function DataFreshness() {
  const [status, setStatus]   = useState<SyncStatus | null>(null)
  const [open, setOpen]       = useState(false)
  const [loading, setLoading] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  // Close on outside click
  useEffect(() => {
    function handler(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  async function load() {
    if (loading) return
    setLoading(true)
    try {
      const d = await fetch('/api/sync-status').then(r => r.json()) as SyncStatus
      setStatus(d)
    } catch { /* ignore */ } finally {
      setLoading(false)
    }
  }

  function toggle() {
    if (!open && !status) load()
    setOpen(v => !v)
  }

  const allHours = status ? [
    hoursAgo(status.marketing.meta),
    hoursAgo(status.marketing.google),
    hoursAgo(status.marketing.pinterest),
    // Use last live Shopify order date for icon color — not the analytics batch job
    hoursAgo(status.shopify.last_order?.created_at ?? null),
  ] : []

  const worst  = worstHours(allHours)
  const dotBg  = statusColor(worst)

  return (
    <div ref={ref} className="relative">
      {/* Trigger icon */}
      <button
        onClick={toggle}
        className="group relative w-11 h-11 rounded-xl flex items-center justify-center text-white/35 hover:text-[#c9c6e8] hover:bg-[#aeb0c9]/12 transition-all cursor-pointer"
        aria-label="Fraîcheur des données"
      >
        <CloudOff size={20} strokeWidth={1.8} />
        {/* Status dot */}
        <span
          className="absolute top-2 right-2 w-2 h-2 rounded-full ring-2 ring-[#1a1a2e]"
          style={{ backgroundColor: dotBg }}
        />
        <span className="pointer-events-none absolute left-full ml-3 px-2.5 py-1.5 bg-[#1a1a2e] border border-white/10 text-white text-xs font-medium rounded-lg opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap shadow-lg z-50">
          Fraîcheur des données
        </span>
      </button>

      {/* Dropdown */}
      {open && (
        <div className="absolute left-full bottom-0 ml-3 w-72 bg-white rounded-2xl shadow-[0_8px_32px_rgba(0,0,0,0.14)] border border-[#f0f0ee] z-50 overflow-hidden">
          <div className="px-4 py-3 border-b border-[#f0f0ee]">
            <p className="text-[11px] font-semibold uppercase tracking-[0.1em] text-[#6b6b63]">
              Fraîcheur des données
            </p>
          </div>

          {loading || !status ? (
            <div className="px-4 py-6 flex items-center justify-center">
              <p className="text-xs text-[#9b9b93]">{loading ? 'Chargement…' : '—'}</p>
            </div>
          ) : (
            <>
              {/* Marketing */}
              <div className="px-4 pt-3 pb-2">
                <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-[#9b9b93] mb-2">
                  Marketing
                </p>
                <div className="space-y-2">
                  {([
                    { label: 'Meta',      ts: status.marketing.meta      },
                    { label: 'Google Ads', ts: status.marketing.google    },
                    { label: 'Pinterest', ts: status.marketing.pinterest  },
                  ] as const).map(({ label, ts }) => {
                    const h = hoursAgo(ts)
                    return (
                      <div key={label} className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-2">
                          <Dot h={h} />
                          <span className="text-xs text-[#1a1a2e]">{label}</span>
                        </div>
                        <span className="text-xs text-[#9b9b93]">{formatAgo(ts)}</span>
                      </div>
                    )
                  })}
                </div>
              </div>

              <div className="mx-4 my-1 h-px bg-[#f0f0ee]" />

              {/* Shop Data */}
              <div className="px-4 pt-2 pb-3">
                <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-[#9b9b93] mb-2">
                  Shop Data
                </p>
                <div className="space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <Dot h={hoursAgo(status.shopify.orders_sync)} />
                      <span className="text-xs text-[#1a1a2e]">Sync analytics</span>
                    </div>
                    <span className="text-xs text-[#9b9b93]">{formatAgo(status.shopify.orders_sync)}</span>
                  </div>

                  {status.shopify.last_order && (() => {
                    const h = hoursAgo(status.shopify.last_order.created_at)
                    return (
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-2">
                          <Dot h={h} />
                          <span className="text-xs text-[#1a1a2e]">
                            Dernière commande{' '}
                            <span className="font-mono font-semibold">{status.shopify.last_order.name}</span>
                          </span>
                        </div>
                        <span className="text-xs text-[#9b9b93] shrink-0">{formatAgo(status.shopify.last_order.created_at)}</span>
                      </div>
                    )
                  })()}
                </div>
              </div>

              {/* Refresh */}
              <div className="px-4 py-2 border-t border-[#f0f0ee]">
                <button
                  onClick={load}
                  className="text-[11px] text-[#6b6b63] hover:text-[#1a1a2e] transition-colors"
                >
                  Actualiser
                </button>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  )
}
