import { PlatformIcon } from '@/components/ui/PlatformIcon'

export interface SpendByPlatform {
  platform: string
  spend: number
  revenue: number
  impressions: number
  clicks: number
  conversions: number
}

interface Props {
  data: SpendByPlatform[]
  loading: boolean
}

const PLATFORM_LABELS: Record<string, string> = {
  meta:      'Meta',
  google:    'Google Ads',
  tiktok:    'TikTok',
  pinterest: 'Pinterest',
}

// Bar accent colors per platform
const PLATFORM_ACCENT: Record<string, string> = {
  meta:      '#1877F2',
  google:    '#4285F4',
  tiktok:    '#010101',
  pinterest: '#E60023',
}

const fmtEur = (n: number) =>
  new Intl.NumberFormat('fr-FR', {
    style: 'currency',
    currency: 'EUR',
    maximumFractionDigits: 0,
  }).format(n)


export default function SpendBreakdown({ data, loading }: Props) {
  const totalSpend = data.reduce((s, d) => s + d.spend, 0)
  const active = data.filter((d) => d.spend > 0)

  return (
    <div className="bg-white rounded-[20px] shadow-[0_2px_16px_rgba(0,0,0,0.06)] p-6">
      <div className="flex items-center justify-between mb-6">
        <p className="text-[10px] font-semibold text-[#6b6b63] uppercase tracking-[0.1em]">
          Répartition spend
        </p>
        {!loading && totalSpend > 0 && (
          <span className="text-xs font-medium text-[#1a1a18]">
            Total {fmtEur(totalSpend)}
          </span>
        )}
      </div>

      {loading ? (
        <div className="space-y-5">
          {Array.from({ length: 2 }).map((_, i) => (
            <div key={i} className="space-y-2">
              <div className="flex items-center gap-2">
                <div className="w-6 h-6 bg-[#f0f0ee] rounded animate-pulse" />
                <div className="h-3 w-20 bg-[#f0f0ee] rounded-full animate-pulse" />
              </div>
              <div className="h-1.5 w-full bg-[#f0f0ee] rounded-full animate-pulse" />
            </div>
          ))}
        </div>
      ) : active.length === 0 ? (
        <p className="text-xs text-[#6b6b63]">Aucun spend sur la période</p>
      ) : (
        <div className="space-y-5">
          {active.map((d) => {
            const label  = PLATFORM_LABELS[d.platform] ?? d.platform
            const accent = PLATFORM_ACCENT[d.platform] ?? '#6b6b63'
            const pct    = totalSpend > 0 ? (d.spend / totalSpend) * 100 : 0
            const roas   = d.spend > 0 ? d.revenue / d.spend : null

            return (
              <div key={d.platform} className="space-y-2">
                {/* Row */}
                <div className="flex items-center justify-between gap-4">
                  {/* Left: icon + name */}
                  <div className="flex items-center gap-2.5 min-w-0">
                    <PlatformIcon platform={d.platform} size={22} />
                    <span className="text-sm font-medium text-[#1a1a18] truncate">{label}</span>
                  </div>
                  {/* Right: stats */}
                  <div className="flex items-center gap-4 flex-shrink-0">
                    <span className="text-xs text-[#6b6b63] tabular-nums w-8 text-right">
                      {pct.toFixed(0)}%
                    </span>
                    <span className="text-sm font-semibold text-[#1a1a18] tabular-nums w-16 text-right">
                      {fmtEur(d.spend)}
                    </span>
                    <span className="text-xs tabular-nums w-24 text-right font-medium" style={{
                      color: roas == null ? '#9b9b93'
                           : roas >= 3   ? '#1a7f4b'
                           : roas >= 1.5 ? '#b45309'
                           :               '#c7293a'
                    }}>
                      {roas != null ? `ROAS : ${roas.toFixed(2)}x` : 'ROAS : —'}
                    </span>
                    <span className="text-xs text-[#6b6b63] tabular-nums w-20 text-right hidden sm:block">
                      {d.clicks.toLocaleString('fr-FR')} clics
                    </span>
                  </div>
                </div>
                {/* Bar */}
                <div className="h-1.5 w-full bg-[#F8F8F7] rounded-full overflow-hidden">
                  <div
                    className="h-full rounded-full transition-all duration-700 ease-out"
                    style={{ width: `${pct}%`, backgroundColor: accent }}
                  />
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
