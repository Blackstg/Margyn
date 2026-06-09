'use client'
export const dynamic = 'force-dynamic'

import { Suspense, useState, useEffect, useCallback, useMemo } from 'react'
import { useBrand } from '@/context/BrandContext'
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer,
} from 'recharts'
import {
  Grid3x3, List, X, ChevronRight, Copy, RefreshCw,
  Play, Image as ImageIcon, TrendingDown, AlertTriangle,
  ExternalLink, Sparkles,
} from 'lucide-react'
import AiInsights from '@/components/dashboard/AiInsights'

// ─── Types ────────────────────────────────────────────────────────────────────

type Period = '7j' | '30j' | '90j' | 'mois'
type Format = 'all' | 'image' | 'video' | 'carousel'
type StatusFilter = 'all' | 'active' | 'paused'
type SortKey = 'spend' | 'roas' | 'ctr' | 'hook_rate' | 'recent'
type ViewMode = 'grid' | 'table'

interface AdCreative {
  id: string
  meta_ad_id: string
  meta_creative_id: string | null
  meta_video_id: string | null
  ad_name: string
  campaign_name: string
  adset_name: string
  brand: string
  format: 'image' | 'video' | 'carousel'
  status: string
  thumbnail_url: string | null
  video_url: string | null
  primary_text: string | null
  headline: string | null
  description: string | null
  cta_type: string | null
  landing_url: string | null
  first_seen_at: string
  last_active_at: string | null
}

interface CreativeStat {
  creative_id: string
  date: string
  spend: number
  impressions: number
  reach: number
  clicks: number
  ctr: number | null
  cpc: number | null
  cpm: number | null
  video_3s_plays: number | null
  video_p25: number | null
  video_p75: number | null
  purchases: number
  purchase_value: number
  roas: number | null
  cpa: number | null
}

interface CreativeAgg {
  creative: AdCreative
  spend: number
  impressions: number
  clicks: number
  purchases: number
  purchase_value: number
  ctr: number | null
  cpm: number | null
  roas: number | null
  cpa: number | null
  hook_rate: number | null  // %
  hold_rate: number | null  // %
  sparkline: number[]       // 14 derniers jours ROAS
  fatigue: boolean          // CTR baisé >20% sur 7j vs 7j précédents
  dailyStats: { date: string; spend: number; roas: number | null; ctr: number | null }[]
}

// ─── Date helpers ─────────────────────────────────────────────────────────────

function fmt(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`
}

function getRange(period: Period): { from: string; to: string } {
  const today = new Date(); today.setHours(0,0,0,0)
  const to = new Date(today); to.setDate(to.getDate()-1)
  let from: Date
  if (period === '7j')   { from = new Date(to); from.setDate(from.getDate()-6) }
  else if (period === '30j') { from = new Date(to); from.setDate(from.getDate()-29) }
  else if (period === '90j') { from = new Date(to); from.setDate(from.getDate()-89) }
  else { from = new Date(today.getFullYear(), today.getMonth(), 1) }
  return { from: fmt(from), to: fmt(to) }
}

// ─── Formatting ───────────────────────────────────────────────────────────────

function fmtEur(n: number) {
  return new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }).format(n)
}
function fmtPct(n: number | null) { return n != null ? `${(n*100).toFixed(1)}%` : '—' }
function fmtRoas(n: number | null) { return n != null ? `${n.toFixed(2)}x` : '—' }
function fmtNum(n: number) { return n.toLocaleString('fr-FR') }
function fmtK(n: number) {
  if (n >= 1_000_000) return `${(n/1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n/1_000).toFixed(0)}k`
  return String(n)
}

// ─── Aggregation ──────────────────────────────────────────────────────────────

function aggregateStats(
  creatives: AdCreative[],
  stats: CreativeStat[],
): CreativeAgg[] {
  const statsByCreative = new Map<string, CreativeStat[]>()
  for (const s of stats) {
    const arr = statsByCreative.get(s.creative_id) ?? []
    arr.push(s)
    statsByCreative.set(s.creative_id, arr)
  }

  return creatives.map(creative => {
    const rows = (statsByCreative.get(creative.id) ?? []).sort((a,b) => a.date.localeCompare(b.date))

    const totalSpend  = rows.reduce((s,r) => s + (r.spend        ?? 0), 0)
    const totalImpr   = rows.reduce((s,r) => s + (r.impressions  ?? 0), 0)
    const totalClicks = rows.reduce((s,r) => s + (r.clicks       ?? 0), 0)
    const totalV3s    = rows.reduce((s,r) => s + (r.video_3s_plays ?? 0), 0)
    const totalV75    = rows.reduce((s,r) => s + (r.video_p75      ?? 0), 0)

    const ctr  = totalImpr  > 0 ? totalClicks / totalImpr : null
    const cpm  = totalImpr  > 0 ? (totalSpend / totalImpr) * 1000 : null

    // ROAS & CPA : spend-weighted average from stored daily values
    const roasRows = rows.filter(r => (r.roas ?? 0) > 0)
    const roasSpend = roasRows.reduce((s,r) => s + r.spend, 0)
    const roas = roasSpend > 0
      ? Math.round(roasRows.reduce((s,r) => s + (r.roas ?? 0) * r.spend, 0) / roasSpend * 100) / 100
      : null

    const cpaRows  = rows.filter(r => (r.cpa ?? 0) > 0)
    const cpaSpend = cpaRows.reduce((s,r) => s + r.spend, 0)
    const cpa = cpaSpend > 0
      ? Math.round(cpaRows.reduce((s,r) => s + (r.cpa ?? 0) * r.spend, 0) / cpaSpend * 100) / 100
      : null

    // hook_rate = 3s plays / impressions
    const hookRaw  = totalImpr > 0 && totalV3s > 0 ? (totalV3s / totalImpr) * 100 : null
    // hold_rate = p75 / 3s plays
    const holdRaw  = totalV3s > 0 && totalV75 > 0 ? (totalV75 / totalV3s) * 100 : null

    // Sparkline — last 14 days of ROAS (daily)
    const last14 = rows.slice(-14).map(r => r.roas ?? 0)

    // Fatigue detection: CTR baissé >20% sur 7 derniers jours vs 7 précédents
    const sorted = [...rows]
    const last7  = sorted.slice(-7)
    const prev7  = sorted.slice(-14, -7)
    let fatigue  = false
    if (last7.length >= 3 && prev7.length >= 3) {
      const ctrLast = last7.reduce((s,r)=>s+(r.ctr??0),0) / last7.length
      const ctrPrev = prev7.reduce((s,r)=>s+(r.ctr??0),0) / prev7.length
      if (ctrPrev > 0 && ctrLast < ctrPrev * 0.8) fatigue = true
    }

    const dailyStats = rows.map(r => ({
      date:  r.date,
      spend: r.spend ?? 0,
      roas:  r.roas,
      ctr:   r.ctr,
    }))

    return {
      creative,
      spend:        Math.round(totalSpend * 100) / 100,
      impressions:  totalImpr,
      clicks:       totalClicks,
      purchases:    0,
      purchase_value: 0,
      ctr:          ctr != null ? Math.round(ctr * 10000) / 10000 : null,
      cpm:          cpm != null ? Math.round(cpm * 100) / 100 : null,
      roas,
      cpa:          cpa != null ? Math.round(cpa * 100) / 100 : null,
      hook_rate:    hookRaw != null ? Math.round(hookRaw * 10) / 10 : null,
      hold_rate:    holdRaw != null ? Math.round(holdRaw * 10) / 10 : null,
      sparkline:    last14,
      fatigue,
      dailyStats,
    } satisfies CreativeAgg
  })
}

// ─── Sparkline ────────────────────────────────────────────────────────────────

function MiniSparkline({ data, good }: { data: number[]; good: boolean }) {
  if (data.length < 2) return <div className="h-8" />
  const min = Math.min(...data); const max = Math.max(...data)
  const range = max - min || 1
  const W = 80; const H = 28
  const pts = data.map((v,i) =>
    `${(i/(data.length-1))*W},${H-2-((v-min)/range)*(H-6)}`
  ).join(' ')
  return (
    <svg width={W} height={H} className="shrink-0 opacity-70">
      <polyline points={pts} fill="none"
        stroke={good ? '#4ade80' : '#f87171'}
        strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

// ─── ROAS color ───────────────────────────────────────────────────────────────

function roasColor(roas: number | null) {
  if (roas == null) return 'text-[#9b9b93]'
  if (roas >= 3)   return 'text-[#16a34a]'
  if (roas >= 1.5) return 'text-[#b45309]'
  return 'text-[#dc2626]'
}

// ─── Format badge ─────────────────────────────────────────────────────────────

function FormatBadge({ format }: { format: string }) {
  const map: Record<string, { icon: string; label: string; cls: string }> = {
    video:    { icon: '🎥', label: 'Vidéo',    cls: 'bg-[#dbeafe] text-[#1d4ed8]' },
    carousel: { icon: '🔄', label: 'Carrousel', cls: 'bg-[#fef3c7] text-[#92400e]' },
    image:    { icon: '📷', label: 'Image',    cls: 'bg-[#f0fdf4] text-[#15803d]' },
  }
  const { icon, label, cls } = map[format] ?? map.image
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold ${cls}`}>
      {icon} {label}
    </span>
  )
}

// ─── Status badge ─────────────────────────────────────────────────────────────

function StatusBadge({ status, fatigue }: { status: string; fatigue: boolean }) {
  if (fatigue) return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-[#fef2f2] text-[#dc2626]">
      <TrendingDown size={10} /> Fatigue
    </span>
  )
  if (status === 'active') return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-[#dcfce7] text-[#15803d]">
      Active
    </span>
  )
  return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-[#f4f4f2] text-[#6b6b63]">
      Pause
    </span>
  )
}

// ─── Creative Card (grid) ─────────────────────────────────────────────────────

function CreativeCard({ agg, onClick }: { agg: CreativeAgg; onClick: () => void }) {
  const { creative, spend, impressions, ctr, cpm, roas, cpa, hook_rate, sparkline, fatigue } = agg
  const isWinner = (roas ?? 0) >= 3 && spend >= 200
  const roasGood = (roas ?? 0) >= 1.5

  return (
    <div
      onClick={onClick}
      className="group relative bg-white rounded-[20px] shadow-[0_2px_16px_rgba(0,0,0,0.06)] overflow-hidden cursor-pointer hover:shadow-[0_4px_24px_rgba(0,0,0,0.1)] hover:-translate-y-0.5 transition-all duration-200"
    >
      {/* Thumbnail */}
      <div className="relative aspect-[4/3] bg-[#1a1a2e] overflow-hidden">
        {creative.format === 'video' && creative.video_url ? (
          <video
            src={creative.video_url}
            preload="metadata"
            muted
            playsInline
            className="w-full h-full object-cover"
          />
        ) : creative.format === 'video' && !creative.video_url ? (
          /* Vidéo sans source dispo (permissions Meta limitées) — placeholder propre */
          <div className="w-full h-full flex flex-col items-center justify-center bg-gradient-to-br from-[#1a1a2e] to-[#2d2d4e]">
            {creative.thumbnail_url && (
              <img
                src={creative.thumbnail_url}
                alt=""
                className="absolute inset-0 w-full h-full object-cover opacity-30 blur-sm scale-110"
                loading="lazy"
              />
            )}
          </div>
        ) : creative.thumbnail_url ? (
          <img
            src={creative.thumbnail_url}
            alt={creative.ad_name}
            className="w-full h-full object-cover"
            loading="lazy"
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center">
            <ImageIcon size={32} className="text-[#555]" />
          </div>
        )}
        {creative.format === 'video' && (
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="w-10 h-10 rounded-full bg-black/40 flex items-center justify-center">
              <Play size={18} className="text-white ml-0.5" />
            </div>
          </div>
        )}
        {/* Badges */}
        <div className="absolute top-2 left-2">
          <FormatBadge format={creative.format} />
        </div>
        <div className="absolute top-2 right-2 flex flex-col items-end gap-1">
          {isWinner && (
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-[#fbbf24] text-[#78350f]">
              🏆 Winner
            </span>
          )}
          <StatusBadge status={creative.status} fatigue={fatigue} />
        </div>
      </div>

      {/* Content */}
      <div className="p-4 space-y-3">
        <p className="text-[11px] font-semibold text-[#1a1a2e] line-clamp-2 leading-tight">
          {creative.ad_name}
        </p>

        {/* KPIs 2×3 */}
        <div className="grid grid-cols-3 gap-2">
          <div>
            <p className="text-[9px] text-[#9b9b93] uppercase tracking-wide">Spend</p>
            <p className="text-[12px] font-bold text-[#1a1a2e]">{fmtEur(spend)}</p>
          </div>
          <div>
            <p className="text-[9px] text-[#9b9b93] uppercase tracking-wide">ROAS</p>
            <p className={`text-[12px] font-bold ${roasColor(roas)}`}>{fmtRoas(roas)}</p>
          </div>
          <div>
            <p className="text-[9px] text-[#9b9b93] uppercase tracking-wide">CTR</p>
            <p className="text-[12px] font-bold text-[#1a1a2e]">{fmtPct(ctr)}</p>
          </div>
          <div>
            <p className="text-[9px] text-[#9b9b93] uppercase tracking-wide">CPM</p>
            <p className="text-[12px] font-bold text-[#1a1a2e]">{cpm != null ? `${fmtNum(Math.round(cpm))}€` : '—'}</p>
          </div>
          {creative.format === 'video' && hook_rate != null ? (
            <div>
              <p className="text-[9px] text-[#9b9b93] uppercase tracking-wide">Hook</p>
              <p className="text-[12px] font-bold text-[#1a1a2e]">{hook_rate.toFixed(1)}%</p>
            </div>
          ) : (
            <div>
              <p className="text-[9px] text-[#9b9b93] uppercase tracking-wide">Impr.</p>
              <p className="text-[12px] font-bold text-[#1a1a2e]">{fmtK(impressions)}</p>
            </div>
          )}
          <div>
            <p className="text-[9px] text-[#9b9b93] uppercase tracking-wide">CPA</p>
            <p className="text-[12px] font-bold text-[#1a1a2e]">{cpa != null ? `${Math.round(cpa)}€` : '—'}</p>
          </div>
        </div>

        {/* Sparkline */}
        <div className="flex items-end justify-between gap-2 pt-1 border-t border-[#f4f4f2]">
          <p className="text-[9px] text-[#9b9b93]">ROAS 14j</p>
          <MiniSparkline data={sparkline} good={roasGood} />
        </div>
      </div>
    </div>
  )
}

// ─── Table row ────────────────────────────────────────────────────────────────

function CreativeTableRow({ agg, onClick }: { agg: CreativeAgg; onClick: () => void }) {
  const { creative, spend, impressions, ctr, cpm, roas, cpa, hook_rate, fatigue } = agg
  return (
    <tr
      onClick={onClick}
      className="hover:bg-[#faf9f8] cursor-pointer border-b border-[#f4f4f2] transition-colors"
    >
      <td className="px-4 py-3">
        <div className="flex items-center gap-3">
          <div className="w-12 h-9 rounded-lg bg-[#f4f4f2] overflow-hidden shrink-0">
            {creative.thumbnail_url
              ? <img src={creative.thumbnail_url} alt="" className="w-full h-full object-cover" />
              : <div className="w-full h-full flex items-center justify-center"><ImageIcon size={14} className="text-[#d0d0cc]" /></div>
            }
          </div>
          <p className="text-xs font-medium text-[#1a1a2e] line-clamp-2 max-w-[200px]">{creative.ad_name}</p>
        </div>
      </td>
      <td className="px-4 py-3"><FormatBadge format={creative.format} /></td>
      <td className="px-4 py-3 text-xs font-semibold text-[#1a1a2e]">{fmtEur(spend)}</td>
      <td className="px-4 py-3 text-xs text-[#6b6b63]">{fmtK(impressions)}</td>
      <td className="px-4 py-3 text-xs text-[#6b6b63]">{fmtPct(ctr)}</td>
      <td className="px-4 py-3 text-xs text-[#6b6b63]">{cpm != null ? `${Math.round(cpm)}€` : '—'}</td>
      <td className="px-4 py-3 text-xs text-[#6b6b63]">
        {hook_rate != null ? `${hook_rate.toFixed(1)}%` : '—'}
      </td>
      <td className={`px-4 py-3 text-xs font-bold ${roasColor(roas)}`}>{fmtRoas(roas)}</td>
      <td className="px-4 py-3 text-xs text-[#6b6b63]">{cpa != null ? `${Math.round(cpa)}€` : '—'}</td>
      <td className="px-4 py-3">
        <StatusBadge status={creative.status} fatigue={fatigue} />
      </td>
    </tr>
  )
}

// ─── AI Creative Suggestions ──────────────────────────────────────────────────

interface AiSuggestions {
  analysis: string
  angles: string[]
  hooks: string[]
  primary_texts: string[]
  headlines: string[]
}

function AiCreativeSuggestions({ agg }: { agg: CreativeAgg }) {
  const [data, setData]       = useState<AiSuggestions | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError]     = useState(false)

  const load = useCallback(async () => {
    setLoading(true); setError(false)
    try {
      const res = await fetch('/api/ai/creative', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          format:       agg.creative.format,
          headline:     agg.creative.headline,
          primary_text: agg.creative.primary_text,
          brand:        agg.creative.brand,
          spend:        agg.spend,
          impressions:  agg.impressions,
          ctr:          agg.ctr,
          roas:         agg.roas,
          hook_rate:    agg.hook_rate,
          cpa:          agg.cpa,
        }),
      })
      if (!res.ok) throw new Error()
      setData(await res.json())
    } catch { setError(true) }
    finally { setLoading(false) }
  }, [agg])

  function CopyBtn({ text }: { text: string }) {
    const [copied, setCopied] = useState(false)
    return (
      <button
        onClick={() => { navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 1500) }}
        className="shrink-0 p-1.5 rounded-lg text-[#6b6b63] hover:bg-[#f4f4f2] hover:text-[#1a1a2e] transition-colors"
        title="Copier"
      >
        {copied ? <span className="text-[10px] text-[#16a34a] font-semibold">✓</span> : <Copy size={12} />}
      </button>
    )
  }

  function SuggestionList({ items, label }: { items: string[]; label: string }) {
    return (
      <div className="space-y-1.5">
        <p className="text-[10px] font-semibold uppercase tracking-wide text-[#9b9b93]">{label}</p>
        {items.map((item, i) => (
          <div key={i} className="flex items-start gap-2 bg-[#faf9f8] rounded-xl px-3 py-2.5">
            <p className="text-xs text-[#1a1a2e] flex-1 leading-relaxed">{item}</p>
            <CopyBtn text={item} />
          </div>
        ))}
      </div>
    )
  }

  if (!data && !loading) {
    return (
      <div
        className="rounded-2xl overflow-hidden"
        style={{ background: 'linear-gradient(135deg, #1a1a2e 0%, #2d2d4e 100%)' }}
      >
        <div className="px-5 py-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Sparkles size={16} className="text-white/60" />
            <span className="text-sm font-semibold text-white">Variantes IA</span>
          </div>
          <button
            onClick={load}
            className="flex items-center gap-2 px-4 py-1.5 rounded-xl bg-white/15 text-white text-xs font-semibold hover:bg-white/25 transition-colors"
          >
            <Sparkles size={12} /> Analyser
          </button>
        </div>
        <p className="px-5 pb-4 text-xs text-white/40">
          Angles alternatifs, hooks et variantes de copy générés par Claude
        </p>
      </div>
    )
  }

  return (
    <div className="space-y-3">
      <div
        className="rounded-2xl overflow-hidden"
        style={{ background: 'linear-gradient(135deg, #1a1a2e 0%, #2d2d4e 100%)' }}
      >
        <div className="px-5 py-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Sparkles size={16} className="text-white/60" />
            <span className="text-sm font-semibold text-white">Variantes IA</span>
          </div>
          <button
            onClick={load}
            disabled={loading}
            className="flex items-center gap-2 px-3 py-1 rounded-xl text-white/70 text-xs font-medium hover:text-white hover:bg-white/10 transition-colors disabled:opacity-40"
          >
            <RefreshCw size={12} className={loading ? 'animate-spin' : ''} /> Régénérer
          </button>
        </div>
        {loading && <div className="px-5 pb-4 text-xs text-white/50">Analyse en cours…</div>}
        {error   && <div className="px-5 pb-4 text-xs text-red-400">Erreur — réessaie</div>}
        {data && (
          <div className="px-5 pb-5">
            <p className="text-xs text-white/70 leading-relaxed italic">{data.analysis}</p>
          </div>
        )}
      </div>

      {data && (
        <div className="space-y-4">
          <SuggestionList items={data.angles}        label="3 angles à tester" />
          <SuggestionList items={data.hooks}         label="3 hooks (3 premières secondes)" />
          <SuggestionList items={data.primary_texts} label="3 variantes primary text" />
          <SuggestionList items={data.headlines}     label="3 variantes headline" />
        </div>
      )}
    </div>
  )
}

// ─── VideoPlayer ──────────────────────────────────────────────────────────────

function VideoPlayer({ videoUrl, thumbnail }: { videoUrl: string; thumbnail: string | null }) {
  const [playing, setPlaying] = useState(false)

  if (playing) {
    return (
      <video
        src={videoUrl}
        controls
        autoPlay
        className="w-full h-full object-contain bg-black"
      />
    )
  }

  return (
    <div className="relative w-full h-full">
      {thumbnail && (
        <img src={thumbnail} alt="" className="w-full h-full object-cover" />
      )}
      <div className="absolute inset-0 flex items-center justify-center">
        <button
          onClick={() => setPlaying(true)}
          className="w-14 h-14 rounded-full bg-white/90 hover:bg-white flex items-center justify-center shadow-lg transition-all hover:scale-105"
        >
          <Play size={22} className="text-[#1a1a2e] ml-0.5" />
        </button>
      </div>
    </div>
  )
}

// ─── Drawer ───────────────────────────────────────────────────────────────────

function CreativeDrawer({ agg, onClose }: { agg: CreativeAgg; onClose: () => void }) {
  const { creative, spend, impressions, clicks, ctr, cpm, roas, cpa, hook_rate, hold_rate, dailyStats, fatigue } = agg

  // Chart data
  const chartData = dailyStats.slice(-30).map(d => ({
    date:  d.date.slice(5),
    roas:  d.roas,
    spend: d.spend,
    ctr:   d.ctr != null ? Math.round(d.ctr * 10000) / 100 : null,
  }))

  return (
    <div className="fixed inset-0 z-50 flex">
      {/* Backdrop */}
      <div className="flex-1 bg-black/30 backdrop-blur-sm" onClick={onClose} />

      {/* Panel */}
      <div className="w-full max-w-[520px] bg-white flex flex-col overflow-y-auto shadow-2xl">
        {/* Header */}
        <div className="sticky top-0 z-10 bg-white border-b border-[#f4f4f2] px-5 py-4 flex items-center gap-3">
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-[#f4f4f2] transition-colors">
            <X size={18} className="text-[#6b6b63]" />
          </button>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-bold text-[#1a1a2e] truncate">{creative.ad_name}</p>
            <p className="text-[11px] text-[#9b9b93] truncate">{creative.campaign_name} · {creative.adset_name}</p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <FormatBadge format={creative.format} />
            <StatusBadge status={creative.status} fatigue={fatigue} />
          </div>
        </div>

        <div className="p-5 space-y-5">
          {/* Preview */}
          <div className={`rounded-2xl overflow-hidden bg-[#1a1a2e] relative ${creative.format === 'video' ? 'aspect-[9/16] max-h-[480px]' : 'aspect-[4/3]'}`}>
            {creative.format === 'video' && creative.video_url ? (
              <VideoPlayer videoUrl={creative.video_url} thumbnail={creative.thumbnail_url} />
            ) : creative.format === 'video' && !creative.video_url ? (
              <div className="w-full h-full flex flex-col items-center justify-center bg-gradient-to-br from-[#1a1a2e] to-[#2d2d4e]">
                {creative.thumbnail_url && (
                  <img src={creative.thumbnail_url} alt="" className="absolute inset-0 w-full h-full object-cover opacity-25 blur-md scale-110" />
                )}
                <div className="relative z-10 flex flex-col items-center gap-3">
                  <div className="w-16 h-16 rounded-full bg-white/10 flex items-center justify-center">
                    <Play size={28} className="text-white ml-1" />
                  </div>
                  <p className="text-[11px] text-white/40">Aperçu non disponible</p>
                </div>
              </div>
            ) : creative.thumbnail_url ? (
              <img src={creative.thumbnail_url} alt="" className="w-full h-full object-contain" />
            ) : (
              <div className="w-full h-full flex items-center justify-center">
                <ImageIcon size={48} className="text-[#555]" />
              </div>
            )}
          </div>

          {/* Copy */}
          {(creative.primary_text || creative.headline) && (
            <div className="rounded-2xl bg-[#faf9f8] p-4 space-y-3">
              {creative.headline && (
                <div>
                  <p className="text-[10px] font-semibold uppercase tracking-wide text-[#9b9b93] mb-1">Headline</p>
                  <p className="text-sm font-semibold text-[#1a1a2e]">{creative.headline}</p>
                </div>
              )}
              {creative.primary_text && (
                <div>
                  <p className="text-[10px] font-semibold uppercase tracking-wide text-[#9b9b93] mb-1">Primary text</p>
                  <p className="text-xs text-[#4b4b43] leading-relaxed">{creative.primary_text}</p>
                </div>
              )}
              {creative.description && (
                <div>
                  <p className="text-[10px] font-semibold uppercase tracking-wide text-[#9b9b93] mb-1">Description</p>
                  <p className="text-xs text-[#6b6b63]">{creative.description}</p>
                </div>
              )}
              <div className="flex items-center gap-3 pt-1">
                {creative.cta_type && (
                  <span className="px-2 py-1 rounded-lg bg-[#1a1a2e] text-white text-[10px] font-semibold">{creative.cta_type}</span>
                )}
                {creative.landing_url && (
                  <a
                    href={creative.landing_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-1 text-[10px] text-[#6b6b63] hover:text-[#1a1a2e] transition-colors"
                  >
                    <ExternalLink size={10} /> {new URL(creative.landing_url.startsWith('http') ? creative.landing_url : `https://${creative.landing_url}`).hostname}
                  </a>
                )}
              </div>
            </div>
          )}

          {/* Fatigue alert */}
          {fatigue && (
            <div className="flex items-start gap-3 rounded-2xl bg-[#fef2f2] border border-[#fecaca] p-4">
              <AlertTriangle size={16} className="text-[#dc2626] shrink-0 mt-0.5" />
              <div>
                <p className="text-xs font-semibold text-[#dc2626]">Fatigue détectée</p>
                <p className="text-[11px] text-[#ef4444] mt-0.5">Le CTR a baissé de plus de 20% sur les 7 derniers jours vs les 7 précédents. Envisager un refresh créatif.</p>
              </div>
            </div>
          )}

          {/* KPIs détaillés */}
          <div className="grid grid-cols-3 gap-3">
            {[
              { label: 'Spend',        v: fmtEur(spend) },
              { label: 'ROAS',         v: fmtRoas(roas),      cls: roasColor(roas) },
              { label: 'CTR',          v: fmtPct(ctr) },
              { label: 'CPM',          v: cpm != null ? `${Math.round(cpm)}€` : '—' },
              { label: 'CPA',          v: cpa != null ? `${Math.round(cpa)}€` : '—' },
              { label: 'Impressions',  v: fmtK(impressions) },
              { label: 'Clics',        v: fmtK(clicks) },
              ...(hook_rate != null ? [{ label: 'Hook rate', v: `${hook_rate.toFixed(1)}%` }] : []),
              ...(hold_rate != null ? [{ label: 'Hold rate', v: `${hold_rate.toFixed(1)}%` }] : []),
            ].map(({ label, v, cls }) => (
              <div key={label} className="rounded-[14px] bg-[#faf9f8] px-3 py-2.5">
                <p className="text-[10px] text-[#9b9b93] uppercase tracking-wide">{label}</p>
                <p className={`text-sm font-bold text-[#1a1a2e] mt-0.5 ${cls ?? ''}`}>{v}</p>
              </div>
            ))}
          </div>

          {/* Chart ROAS + Spend */}
          {chartData.length > 1 && (
            <div className="space-y-2">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-[#9b9b93]">Évolution</p>
              <div className="rounded-2xl bg-[#faf9f8] p-4">
                <ResponsiveContainer width="100%" height={140}>
                  <LineChart data={chartData} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#ece9e4" vertical={false} />
                    <XAxis dataKey="date" tick={{ fontSize: 10 }} axisLine={false} tickLine={false} interval="preserveStartEnd" />
                    <YAxis tick={{ fontSize: 10 }} width={28} tickFormatter={v => `${v}x`} />
                    <Tooltip
                      content={({ active, payload, label }) => active && payload?.length ? (
                        <div className="bg-white border border-[#e8e8e4] rounded-xl shadow-lg px-3 py-2 text-xs">
                          <p className="font-semibold text-[#1a1a2e] mb-1">{label}</p>
                          {payload.map(p => (
                            <p key={p.dataKey as string} style={{ color: p.stroke as string }}>
                              {p.dataKey === 'roas' ? 'ROAS' : 'Spend'}: {p.dataKey === 'roas' ? `${(p.value as number).toFixed(2)}x` : `${Math.round(p.value as number)}€`}
                            </p>
                          ))}
                        </div>
                      ) : null}
                    />
                    <Line dataKey="roas"  stroke="#6366f1" strokeWidth={2} dot={false} connectNulls name="ROAS" />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </div>
          )}

          {/* Daily table */}
          {dailyStats.length > 0 && (
            <details className="group">
              <summary className="text-[11px] font-semibold uppercase tracking-wide text-[#9b9b93] cursor-pointer list-none flex items-center gap-1.5">
                <ChevronRight size={12} className="group-open:rotate-90 transition-transform" />
                Performance par jour
              </summary>
              <div className="mt-2 rounded-2xl overflow-hidden border border-[#f4f4f2]">
                <table className="w-full text-xs">
                  <thead className="bg-[#faf9f8]">
                    <tr>
                      <th className="px-3 py-2 text-left text-[#9b9b93] font-medium">Date</th>
                      <th className="px-3 py-2 text-right text-[#9b9b93] font-medium">Spend</th>
                      <th className="px-3 py-2 text-right text-[#9b9b93] font-medium">ROAS</th>
                      <th className="px-3 py-2 text-right text-[#9b9b93] font-medium">CTR</th>
                    </tr>
                  </thead>
                  <tbody>
                    {[...dailyStats].reverse().slice(0, 30).map(d => (
                      <tr key={d.date} className="border-t border-[#f4f4f2]">
                        <td className="px-3 py-1.5 text-[#6b6b63]">{d.date}</td>
                        <td className="px-3 py-1.5 text-right text-[#1a1a2e] font-medium">{d.spend > 0 ? `${Math.round(d.spend)}€` : '—'}</td>
                        <td className={`px-3 py-1.5 text-right font-bold ${roasColor(d.roas)}`}>{fmtRoas(d.roas)}</td>
                        <td className="px-3 py-1.5 text-right text-[#6b6b63]">{fmtPct(d.ctr)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </details>
          )}

          {/* AI suggestions */}
          <AiCreativeSuggestions agg={agg} />
        </div>
      </div>
    </div>
  )
}

// ─── KPI Cards ────────────────────────────────────────────────────────────────

function KpiCard({ label, value, loading }: { label: string; value: string; loading: boolean }) {
  return (
    <div className="bg-white rounded-[18px] shadow-[0_2px_16px_rgba(0,0,0,0.06)] px-5 py-4">
      <p className="text-[10px] font-semibold uppercase tracking-[0.1em] text-[#6b6b63]">{label}</p>
      {loading
        ? <div className="h-7 w-24 rounded-full bg-[#f0f0ee] animate-pulse mt-1.5" />
        : <p className="text-[1.5rem] font-bold text-[#1a1a2e] tracking-tight leading-none mt-1.5">{value}</p>
      }
    </div>
  )
}

// ─── Main page ────────────────────────────────────────────────────────────────

function CreativesPage() {
  const brand = useBrand()
  const [period, setPeriod] = useState<Period>('30j')
  const [format, setFormat] = useState<Format>('all')
  const [statusF, setStatusF] = useState<StatusFilter>('all')
  const [sort, setSort]     = useState<SortKey>('spend')
  const [view, setView]     = useState<ViewMode>('grid')
  const [search, setSearch] = useState('')

  const [creatives, setCreatives] = useState<AdCreative[]>([])
  const [stats, setStats]         = useState<CreativeStat[]>([])
  const [loading, setLoading]     = useState(true)

  const [drawer, setDrawer] = useState<CreativeAgg | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)


  const load = useCallback(async () => {
    setLoading(true)
    setLoadError(null)
    try {
      const { from, to } = getRange(period)
      const res = await fetch(`/api/creatives?brand=${brand}&from=${from}&to=${to}`, { cache: 'no-store' })
      if (!res.ok) { setLoadError(`Erreur ${res.status}`); return }
      const data = await res.json() as { creatives?: AdCreative[]; stats?: CreativeStat[]; error?: string }
      if (data.error) { setLoadError(data.error); return }
      setCreatives(data.creatives ?? [])
      setStats(data.stats ?? [])
    } catch (e) {
      setLoadError(String(e))
    } finally {
      setLoading(false)
    }
  }, [brand, period])

  useEffect(() => { load() }, [load])

  // Aggregate
  const allAggs = useMemo(
    () => aggregateStats(creatives, stats),
    [creatives, stats]
  )

  // Filter
  const filtered = useMemo(() => {
    let list = allAggs.filter(a => a.spend > 0)
    if (format !== 'all') list = list.filter(a => a.creative.format === format)
    if (statusF === 'active') list = list.filter(a => a.creative.status === 'active')
    if (statusF === 'paused') list = list.filter(a => a.creative.status !== 'active')
    if (search.trim()) {
      const q = search.toLowerCase()
      list = list.filter(a =>
        a.creative.ad_name.toLowerCase().includes(q) ||
        (a.creative.headline ?? '').toLowerCase().includes(q) ||
        (a.creative.primary_text ?? '').toLowerCase().includes(q)
      )
    }
    // Sort
    list.sort((a, b) => {
      switch (sort) {
        case 'spend':     return b.spend       - a.spend
        case 'roas':      return (b.roas  ?? -1) - (a.roas  ?? -1)
        case 'ctr':       return (b.ctr   ?? -1) - (a.ctr   ?? -1)
        case 'hook_rate': return (b.hook_rate ?? -1) - (a.hook_rate ?? -1)
        case 'recent':    return (b.creative.first_seen_at ?? '').localeCompare(a.creative.first_seen_at ?? '')
        default:          return 0
      }
    })
    return list
  }, [allAggs, format, statusF, search, sort])

  // KPIs
  const kpis = useMemo(() => {
    const withSpend = allAggs.filter(a => a.spend > 0)
    const totalSpend   = withSpend.reduce((s, a) => s + a.spend, 0)
    const activeCount  = withSpend.filter(a => a.creative.status === 'active').length
    const weightedRoas = totalSpend > 0
      ? withSpend.reduce((s, a) => s + (a.roas ?? 0) * a.spend, 0) / totalSpend
      : null
    const avgCtr = withSpend.length > 0
      ? withSpend.reduce((s,a) => s + (a.ctr ?? 0), 0) / withSpend.length
      : null
    const videoAggs = withSpend.filter(a => a.creative.format === 'video' && a.hook_rate != null)
    const avgHook = videoAggs.length > 0
      ? videoAggs.reduce((s,a) => s + (a.hook_rate ?? 0), 0) / videoAggs.length
      : null
    return { totalSpend, activeCount, weightedRoas, avgCtr, avgHook }
  }, [allAggs])

  // AI context
  const aiContext = useMemo(() => {
    if (loading || filtered.length === 0) return null
    const top5 = [...filtered].sort((a,b) => b.spend - a.spend).slice(0,5)
    return [
      `Marque: ${brand} | Période: ${period} | Créas analysées: ${filtered.length}`,
      `Total spend: ${fmtEur(kpis.totalSpend)} | ROAS moyen: ${fmtRoas(kpis.weightedRoas)} | CTR moyen: ${fmtPct(kpis.avgCtr)}`,
      `Hook rate moyen (vidéo): ${kpis.avgHook != null ? `${kpis.avgHook.toFixed(1)}%` : 'N/A'}`,
      '',
      'Top 5 créas:',
      ...top5.map(a =>
        `- ${a.creative.ad_name} | Format: ${a.creative.format} | Spend: ${fmtEur(a.spend)} | ROAS: ${fmtRoas(a.roas)} | CTR: ${fmtPct(a.ctr)}${a.hook_rate != null ? ` | Hook: ${a.hook_rate.toFixed(1)}%` : ''}${a.fatigue ? ' ⚠ FATIGUE' : ''}`
      ),
      '',
      `Formats: image=${allAggs.filter(a=>a.creative.format==='image'&&a.spend>0).length} vidéo=${allAggs.filter(a=>a.creative.format==='video'&&a.spend>0).length} carousel=${allAggs.filter(a=>a.creative.format==='carousel'&&a.spend>0).length}`,
      `Créas en fatigue: ${allAggs.filter(a=>a.fatigue).length}`,
    ].join('\n')
  }, [loading, filtered, kpis, brand, period, allAggs])

  const periodTabs: { id: Period; label: string }[] = [
    { id: '7j',   label: '7 j'    },
    { id: '30j',  label: '30 j'   },
    { id: '90j',  label: '90 j'   },
    { id: 'mois', label: 'Ce mois'},
  ]

  return (
    <div className="min-h-screen bg-[#faf9f8]">
      <main className="max-w-7xl mx-auto px-6 py-8 space-y-5">

        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center gap-4 justify-between">
          <div>
            <h1 className="text-xl font-bold text-[#1a1a2e] tracking-tight">Créatives</h1>
            <p className="text-sm text-[#6b6b63] mt-0.5">Analyse des publicités Meta — Facebook &amp; Instagram</p>
          </div>

          {/* Period tabs */}
          <div className="inline-flex items-center bg-white shadow-[0_2px_16px_rgba(0,0,0,0.06)] rounded-xl p-1 gap-0.5">
            {periodTabs.map(t => (
              <button
                key={t.id}
                onClick={() => setPeriod(t.id)}
                className={`px-4 py-1.5 rounded-lg text-sm font-medium transition-all ${
                  period === t.id ? 'bg-[#1a1a2e] text-white' : 'text-[#6b6b63] hover:text-[#1a1a2e]'
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>
        </div>

        {/* KPIs */}
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
          <KpiCard label="Spend total"     value={loading ? '…' : fmtEur(kpis.totalSpend)} loading={loading} />
          <KpiCard label="Créas actives"   value={loading ? '…' : String(kpis.activeCount)} loading={loading} />
          <KpiCard label="ROAS moyen"      value={loading ? '…' : fmtRoas(kpis.weightedRoas)} loading={loading} />
          <KpiCard label="CTR moyen"       value={loading ? '…' : fmtPct(kpis.avgCtr)} loading={loading} />
          <KpiCard label="Hook rate vidéo" value={loading ? '…' : (kpis.avgHook != null ? `${kpis.avgHook.toFixed(1)}%` : '—')} loading={loading} />
        </div>

        {/* AI Insights */}
        <AiInsights type="creatives" brand={brand} context={aiContext} />

        {/* Filters */}
        <div className="flex flex-wrap gap-2 items-center">

          {/* Search */}
          <input
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Rechercher une créa…"
            className="px-3 py-1.5 text-sm bg-white border border-[#e8e8e4] rounded-xl outline-none focus:border-[#aeb0c9] transition-colors w-44"
          />

          {/* Format */}
          <div className="inline-flex items-center bg-white border border-[#e8e8e4] rounded-xl p-0.5">
            {(['all','image','video','carousel'] as Format[]).map(f => (
              <button
                key={f}
                onClick={() => setFormat(f)}
                className={`px-3 py-1 rounded-lg text-xs font-medium transition-all ${
                  format === f ? 'bg-[#1a1a2e] text-white' : 'text-[#6b6b63] hover:text-[#1a1a2e]'
                }`}
              >
                {f === 'all' ? 'Tous' : f === 'image' ? '📷' : f === 'video' ? '🎥' : '🔄'}
              </button>
            ))}
          </div>

          {/* Status */}
          <div className="inline-flex items-center bg-white border border-[#e8e8e4] rounded-xl p-0.5">
            {([['all','Toutes'],['active','Actives'],['paused','Pausées']] as [StatusFilter, string][]).map(([v, l]) => (
              <button
                key={v}
                onClick={() => setStatusF(v)}
                className={`px-3 py-1 rounded-lg text-xs font-medium transition-all ${
                  statusF === v ? 'bg-[#1a1a2e] text-white' : 'text-[#6b6b63] hover:text-[#1a1a2e]'
                }`}
              >
                {l}
              </button>
            ))}
          </div>

          {/* Sort */}
          <select
            value={sort}
            onChange={e => setSort(e.target.value as SortKey)}
            className="px-3 py-1.5 text-xs bg-white border border-[#e8e8e4] rounded-xl outline-none text-[#6b6b63] cursor-pointer"
          >
            <option value="spend">Spend ↓</option>
            <option value="roas">ROAS ↓</option>
            <option value="ctr">CTR ↓</option>
            <option value="hook_rate">Hook rate ↓</option>
            <option value="recent">Plus récentes</option>
          </select>

          {/* View toggle */}
          <div className="ml-auto inline-flex items-center bg-white border border-[#e8e8e4] rounded-xl p-0.5">
            <button
              onClick={() => setView('grid')}
              className={`p-1.5 rounded-lg transition-colors ${view==='grid' ? 'bg-[#1a1a2e] text-white' : 'text-[#6b6b63]'}`}
            >
              <Grid3x3 size={14} />
            </button>
            <button
              onClick={() => setView('table')}
              className={`p-1.5 rounded-lg transition-colors ${view==='table' ? 'bg-[#1a1a2e] text-white' : 'text-[#6b6b63]'}`}
            >
              <List size={14} />
            </button>
          </div>
        </div>

        {/* Count */}
        {!loading && (
          <p className="text-xs text-[#9b9b93]">
            {filtered.length} créative{filtered.length !== 1 ? 's' : ''} avec dépense sur la période
          </p>
        )}

        {/* Loading skeleton */}
        {loading && (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
            {Array.from({length: 8}).map((_,i) => (
              <div key={i} className="bg-white rounded-[20px] overflow-hidden shadow-[0_2px_12px_rgba(0,0,0,0.06)]">
                <div className="aspect-[4/3] bg-[#f0f0ee] animate-pulse" />
                <div className="p-4 space-y-2">
                  <div className="h-3 bg-[#f0f0ee] rounded animate-pulse" />
                  <div className="h-3 w-2/3 bg-[#f0f0ee] rounded animate-pulse" />
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Error */}
        {loadError && (
          <div className="py-8 text-center">
            <p className="text-xs text-red-500 font-mono bg-red-50 rounded-xl px-4 py-3 inline-block text-left max-w-xl">{loadError}</p>
          </div>
        )}

        {/* Empty */}
        {!loading && !loadError && filtered.length === 0 && (
          <div className="py-16 text-center space-y-2">
            <p className="text-4xl">🎨</p>
            <p className="text-sm font-medium text-[#1a1a2e]">Aucune créative trouvée</p>
            <p className="text-xs text-[#9b9b93]">Lance une synchronisation ou ajuste les filtres</p>
          </div>
        )}

        {/* Grid */}
        {!loading && filtered.length > 0 && view === 'grid' && (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
            {filtered.map(agg => (
              <CreativeCard
                key={agg.creative.id}
                agg={agg}
                onClick={() => setDrawer(agg)}
              />
            ))}
          </div>
        )}

        {/* Table */}
        {!loading && filtered.length > 0 && view === 'table' && (
          <div className="bg-white rounded-[20px] shadow-[0_2px_16px_rgba(0,0,0,0.06)] overflow-hidden">
            <table className="w-full">
              <thead className="border-b border-[#f4f4f2] bg-[#faf9f8]">
                <tr>
                  {['Créative','Format','Spend','Impr.','CTR','CPM','Hook rate','ROAS','CPA','Statut'].map(h => (
                    <th key={h} className="px-4 py-3 text-left text-[10px] font-semibold uppercase tracking-[0.08em] text-[#9b9b93]">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filtered.map(agg => (
                  <CreativeTableRow key={agg.creative.id} agg={agg} onClick={() => setDrawer(agg)} />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </main>

      {/* Drawer */}
      {drawer && (
        <CreativeDrawer
          agg={drawer}
          onClose={() => setDrawer(null)}
        />
      )}
    </div>
  )
}

export default function Page() {
  return (
    <Suspense>
      <CreativesPage />
    </Suspense>
  )
}
