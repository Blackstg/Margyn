import { useState } from 'react'
import { PlatformIcon } from '@/components/ui/PlatformIcon'

export interface CampaignAgg {
  id: string
  platform: string
  brand: string
  name: string
  status: string
  spend: number
  revenue: number
  impressions: number
  clicks: number
  conversions: number
  roas: number | null
  cpa: number | null
}

interface Props {
  data: CampaignAgg[]
  loading: boolean
}

const PLATFORM_LABELS: Record<string, string> = {
  meta:      'Meta',
  google:    'Google',
  tiktok:    'TikTok',
  pinterest: 'Pinterest',
}

const fmtEur = (n: number) =>
  new Intl.NumberFormat('fr-FR', {
    style: 'currency',
    currency: 'EUR',
    maximumFractionDigits: 0,
  }).format(n)

function RoasCell({ roas }: { roas: number | null }) {
  if (roas == null) return <span className="text-[#6b6b63] text-xs">—</span>
  const [bg, text] =
    roas >= 3   ? ['#f0faf5', '#1a7f4b'] :
    roas >= 1.5 ? ['#fffbeb', '#b45309'] :
                  ['#fff1f1', '#c7293a']
  return (
    <span
      className="inline-flex items-center px-2 py-0.5 rounded-md text-xs font-semibold tabular-nums"
      style={{ background: bg, color: text }}
    >
      {roas.toFixed(2)}x
    </span>
  )
}

function StatusBadge({ status }: { status: string }) {
  const [bg, text] =
    status === 'active'  ? ['#f0faf5', '#1a7f4b'] :
    status === 'paused'  ? ['#F8F8F7', '#6b6b63'] :
                           ['#F8F8F7', '#6b6b63']
  return (
    <span
      className="inline-flex items-center px-2 py-0.5 rounded-md text-xs font-medium capitalize"
      style={{ background: bg, color: text }}
    >
      {status}
    </span>
  )
}

export default function CampaignsTable({ data, loading }: Props) {
  const [platformFilter, setPlatformFilter] = useState<string>('all')

  const platforms = Array.from(new Set(data.map((d) => d.platform))).sort()

  const filtered = data
    .filter((d) => platformFilter === 'all' || d.platform === platformFilter)
    .sort((a, b) => (b.roas ?? -1) - (a.roas ?? -1))

  return (
    <div className="bg-white rounded-[20px] shadow-[0_2px_16px_rgba(0,0,0,0.06)] overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-[#f0f0ee]">
        <p className="text-[10px] font-semibold text-[#6b6b63] uppercase tracking-[0.1em]">
          Campagnes actives
        </p>
        {/* Platform filter */}
        <div className="inline-flex items-center bg-[#F8F8F7] rounded-lg p-0.5 gap-0.5">
          <button
            onClick={() => setPlatformFilter('all')}
            className={`px-3 py-1.5 rounded-md text-xs font-medium transition-all ${
              platformFilter === 'all'
                ? 'bg-white text-[#1a1a18] shadow-sm'
                : 'text-[#6b6b63] hover:text-[#1a1a18]'
            }`}
          >
            Toutes
          </button>
          {platforms.map((p) => (
            <button
              key={p}
              onClick={() => setPlatformFilter(p)}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-all ${
                platformFilter === p
                  ? 'bg-white text-[#1a1a18] shadow-sm'
                  : 'text-[#6b6b63] hover:text-[#1a1a18]'
              }`}
            >
              <PlatformIcon platform={p} size={14} />
              {PLATFORM_LABELS[p] ?? p}
            </button>
          ))}
        </div>
      </div>

      {/* Table */}
      {loading ? (
        <div className="px-6 py-5 space-y-4">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="flex items-center gap-4">
              <div className="h-4 flex-1 bg-[#f0f0ee] rounded-full animate-pulse" />
              <div className="h-4 w-14 bg-[#f0f0ee] rounded-full animate-pulse" />
              <div className="h-4 w-16 bg-[#f0f0ee] rounded-full animate-pulse" />
              <div className="h-4 w-12 bg-[#f0f0ee] rounded-full animate-pulse" />
            </div>
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <div className="px-6 py-10 text-center">
          <p className="text-sm text-[#6b6b63]">Aucune campagne sur la période</p>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-[#f0f0ee]">
                {[
                  { label: 'Campagne',    cls: 'pl-6 pr-4' },
                  { label: 'Plateforme',  cls: 'px-4' },
                  { label: 'Spend',       cls: 'px-4 text-right' },
                  { label: 'CA généré',   cls: 'px-4 text-right' },
                  { label: 'ROAS',        cls: 'px-4 text-right' },
                  { label: 'CPA',         cls: 'px-4 text-right' },
                  { label: 'Statut',      cls: 'px-4 pr-6' },
                ].map(({ label, cls }) => (
                  <th
                    key={label}
                    className={`py-3 font-medium text-[#6b6b63] whitespace-nowrap ${cls}`}
                  >
                    {label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map((c, idx) => (
                <tr
                  key={c.id}
                  className={`transition-colors hover:bg-[#F8F8F7] ${
                    idx !== filtered.length - 1 ? 'border-b border-[#f0f0ee]' : ''
                  }`}
                >
                  {/* Campaign name */}
                  <td className="pl-6 pr-4 py-3.5 max-w-[200px]">
                    <span
                      className="block truncate font-medium text-[#1a1a18]"
                      title={c.name}
                    >
                      {c.name}
                    </span>
                    <span className="text-[#6b6b63] capitalize text-[11px]">{c.brand}</span>
                  </td>
                  {/* Platform */}
                  <td className="px-4 py-3.5 whitespace-nowrap">
                    <div className="flex items-center gap-2">
                      <PlatformIcon platform={c.platform} size={18} />
                      <span className="text-[#6b6b63]">{PLATFORM_LABELS[c.platform] ?? c.platform}</span>
                    </div>
                  </td>
                  {/* Spend */}
                  <td className="px-4 py-3.5 text-right whitespace-nowrap font-medium text-[#1a1a18] tabular-nums">
                    {fmtEur(c.spend)}
                  </td>
                  {/* Revenue */}
                  <td className="px-4 py-3.5 text-right whitespace-nowrap tabular-nums text-[#1a1a18]">
                    {c.revenue > 0 ? fmtEur(c.revenue) : '—'}
                  </td>
                  {/* ROAS */}
                  <td className="px-4 py-3.5 text-right whitespace-nowrap">
                    <RoasCell roas={c.roas} />
                  </td>
                  {/* CPA */}
                  <td className="px-4 py-3.5 text-right whitespace-nowrap tabular-nums text-[#6b6b63]">
                    {c.cpa != null ? fmtEur(c.cpa) : '—'}
                  </td>
                  {/* Status */}
                  <td className="px-4 pr-6 py-3.5 whitespace-nowrap">
                    <StatusBadge status={c.status} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
