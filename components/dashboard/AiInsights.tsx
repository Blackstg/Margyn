'use client'

import { useState, useCallback } from 'react'

export interface AiRecommendation {
  icon: string
  text: string
  link: string | null
}

interface Props {
  type: 'dashboard' | 'campaigns' | 'reapprovisionnement'
  brand: string
  context: string | null   // null = not ready yet, triggers load when it becomes truthy
  className?: string
}

export default function AiInsights({ type, brand, context, className = '' }: Props) {
  const [recs, setRecs]         = useState<AiRecommendation[] | null>(null)
  const [loading, setLoading]   = useState(false)
  const [error, setError]       = useState(false)
  const [freshAt, setFreshAt]   = useState<Date | null>(null)
  const [triggered, setTriggered] = useState(false)

  const load = useCallback(async (ctx: string) => {
    setLoading(true)
    setError(false)
    try {
      const res = await fetch('/api/ai', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ context: ctx, type, brand }),
      })
      if (!res.ok) throw new Error(`status ${res.status}`)
      const data = await res.json() as { recommendations?: AiRecommendation[] }
      setRecs(data.recommendations ?? [])
      setFreshAt(new Date())
    } catch {
      setError(true)
    } finally {
      setLoading(false)
    }
  }, [type, brand])

  function handleAnalyze() {
    if (!context) return
    setTriggered(true)
    load(context)
  }

  const freshLabel = freshAt
    ? freshAt.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })
    : null

  return (
    <div className={`rounded-2xl overflow-hidden ${className}`} style={{ background: 'linear-gradient(135deg, #1a1a2e 0%, #2d2d4e 100%)' }}>
      {/* Header */}
      <div className="flex items-center justify-between px-5 pt-4 pb-3">
        <div className="flex items-center gap-2">
          <span className="text-base">✨</span>
          <span className="text-sm font-semibold text-white">Steero AI</span>
        </div>
        <div className="flex items-center gap-3">
          {freshLabel && !loading && (
            <span className="text-[10px] text-white/40">Mis à jour {freshLabel}</span>
          )}
          {triggered && (
            <button
              onClick={() => context && load(context)}
              disabled={loading || !context}
              className="flex items-center gap-1.5 px-3 py-1 rounded-lg text-xs font-medium text-white/70 hover:text-white hover:bg-white/10 transition-all disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <svg
                className={`w-3 h-3 ${loading ? 'animate-spin' : ''}`}
                fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
              >
                <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h5M20 20v-5h-5M4 9a9 9 0 0114.1-3.1M20 15a9 9 0 01-14.1 3.1" />
              </svg>
              Actualiser
            </button>
          )}
        </div>
      </div>

      {/* Divider */}
      <div className="h-px bg-white/8 mx-5" />

      {/* Body */}
      <div className="px-5 py-4 min-h-[80px]">
        {!triggered && (
          <div className="flex items-center justify-center py-2">
            <button
              onClick={handleAnalyze}
              disabled={!context}
              className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold text-white bg-white/10 hover:bg-white/20 transition-all disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <span>✨</span>
              Analyser
            </button>
          </div>
        )}

        {triggered && loading && (
          <div className="flex items-center gap-3 py-2">
            <div className="flex gap-1">
              <span className="w-1.5 h-1.5 rounded-full bg-[#aeb0c9] animate-bounce" style={{ animationDelay: '0ms' }} />
              <span className="w-1.5 h-1.5 rounded-full bg-[#aeb0c9] animate-bounce" style={{ animationDelay: '150ms' }} />
              <span className="w-1.5 h-1.5 rounded-full bg-[#aeb0c9] animate-bounce" style={{ animationDelay: '300ms' }} />
            </div>
            <span className="text-xs text-white/40">Analyse en cours…</span>
          </div>
        )}

        {triggered && !loading && error && (
          <p className="text-xs text-white/40 py-2">Impossible de charger les recommandations.</p>
        )}

        {triggered && !loading && !error && recs && recs.length === 0 && (
          <p className="text-xs text-white/50 py-2">Aucune recommandation disponible pour le moment.</p>
        )}

        {triggered && !loading && !error && recs && recs.length > 0 && (
          <ul className="space-y-3">
            {recs.map((rec, i) => (
              <li key={i}>
                {rec.link ? (
                  <a href={rec.link} className="flex items-start gap-3 group cursor-pointer">
                    <RecItem rec={rec} linked />
                  </a>
                ) : (
                  <div className="flex items-start gap-3">
                    <RecItem rec={rec} linked={false} />
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}

function RecItem({ rec, linked }: { rec: AiRecommendation; linked: boolean }) {
  return (
    <>
      <span className="text-base leading-none mt-0.5 shrink-0">{rec.icon}</span>
      <span className={`text-sm text-white/80 leading-snug ${linked ? 'group-hover:text-white transition-colors' : ''}`}>
        {rec.text}
        {linked && (
          <svg className="inline-block ml-1 w-3 h-3 opacity-40 group-hover:opacity-70 transition-opacity" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M13 7l5 5m0 0l-5 5m5-5H6" />
          </svg>
        )}
      </span>
    </>
  )
}
