'use client'

export interface BestSeller {
  title: string
  quantity: number
  revenue: number
  revenuePct: number
  image_url?: string | null
}

export interface InventoryItem {
  title: string
  stock_quantity: number
  sell_price: number | null
  stock_alert_threshold: number
  image_url?: string | null
  coverage_days?: number | null
}

interface Props {
  bestSellers: BestSeller[]
  inventory: InventoryItem[]
  loading: boolean
  stockThreshold: number
}

const fmtEur = (n: number) =>
  n.toLocaleString('fr-FR', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 })

// ─── ProductThumb ─────────────────────────────────────────────────────────────

function ProductThumb({ src, title }: { src?: string | null; title: string }) {
  const initial = title.trim()[0]?.toUpperCase() ?? '?'
  if (src) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img src={src} alt={title} className="w-10 h-10 rounded-lg object-cover bg-[#f5f0f2] shrink-0" />
    )
  }
  return (
    <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-[#e5c8d2] to-[#c4b4d4] flex items-center justify-center shrink-0">
      <span className="text-sm font-bold text-white/80 select-none">{initial}</span>
    </div>
  )
}

// ─── Skeleton row ─────────────────────────────────────────────────────────────

function SkeletonRow() {
  return (
    <div className="flex items-center gap-3 py-2.5">
      <div className="w-10 h-10 rounded-lg bg-[#f5f0f2] animate-pulse shrink-0" />
      <div className="flex-1 space-y-1.5">
        <div className="h-2.5 w-2/3 bg-[#f5f0f2] rounded animate-pulse" />
        <div className="h-2 w-1/3 bg-[#f5f0f2] rounded animate-pulse" />
      </div>
      <div className="h-3 w-12 bg-[#f5f0f2] rounded animate-pulse" />
    </div>
  )
}

// ─── ProductsView ─────────────────────────────────────────────────────────────

export default function ProductsView({ bestSellers, inventory, loading, stockThreshold }: Props) {
  const criticalItems = inventory
    .filter((item) => item.stock_quantity <= stockThreshold * 2)
    .slice(0, 8)

  const criticalCount = inventory.filter((item) => item.stock_quantity <= stockThreshold).length

  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
      {/* ── Meilleures ventes ──────────────────────────────────────────────── */}
      <div className="bg-white rounded-[20px] shadow-[0_2px_16px_rgba(0,0,0,0.06)] p-5">
        <p className="text-[10px] font-semibold uppercase tracking-[0.1em] text-[#aeb0c9] mb-4">
          Meilleures ventes
        </p>

        {loading ? (
          <div className="divide-y divide-[#f5f0f2]">
            {Array.from({ length: 6 }).map((_, i) => <SkeletonRow key={i} />)}
          </div>
        ) : bestSellers.length === 0 ? (
          <p className="text-sm text-[#9b9b93] py-6 text-center">Aucune donnée — lancez un sync Shopify</p>
        ) : (
          <div className="divide-y divide-[#f5f0f2]">
            {bestSellers.map((item, idx) => (
              <div key={item.title} className="flex items-center gap-3 py-2.5">
                {/* Rank */}
                <span className="w-4 text-[10px] font-semibold text-[#9b9b93] text-right shrink-0">
                  {idx + 1}
                </span>
                {/* Image */}
                <ProductThumb src={item.image_url} title={item.title} />
                {/* Name */}
                <p className="flex-1 min-w-0 text-xs font-medium text-[#1a1a2e] truncate">
                  {item.title}
                </p>
                {/* Stats */}
                <div className="text-right shrink-0 space-y-1">
                  <p className="text-xs font-bold text-[#1a1a2e]">{fmtEur(item.revenue)}</p>
                  <div className="flex items-center justify-end gap-1.5">
                    <p className="text-[10px] text-[#9b9b93]">{item.quantity} cmd</p>
                    {item.revenuePct > 0 && (
                      <span className={`px-1.5 py-0.5 rounded-full text-[10px] font-semibold ${
                        item.revenuePct >= 20
                          ? 'bg-[#f0faf4] text-[#1a7f4b]'
                          : item.revenuePct >= 10
                          ? 'bg-[#f0f0ff] text-[#6366f1]'
                          : 'bg-[#f5f5f3] text-[#6b6b63]'
                      }`}>
                        {item.revenuePct.toFixed(1)}%
                      </span>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ── Stock critique ─────────────────────────────────────────────────── */}
      <div className="bg-white rounded-[20px] shadow-[0_2px_16px_rgba(0,0,0,0.06)] p-5">
        <div className="flex items-center gap-2 mb-4">
          <p className="text-[10px] font-semibold uppercase tracking-[0.1em] text-[#aeb0c9]">
            Stock critique
          </p>
          {criticalCount > 0 && (
            <span className="px-1.5 py-0.5 rounded-full text-[10px] font-semibold bg-[#fde8ea] text-[#c7293a]">
              {criticalCount}
            </span>
          )}
        </div>

        {loading ? (
          <div className="divide-y divide-[#f5f0f2]">
            {Array.from({ length: 6 }).map((_, i) => <SkeletonRow key={i} />)}
          </div>
        ) : criticalItems.length === 0 ? (
          <p className="text-sm text-[#1a7f4b] font-medium py-6 text-center">Tous les stocks sont OK</p>
        ) : (
          <div className="divide-y divide-[#f5f0f2]">
            {criticalItems.map((item) => {
              const isCritical = item.stock_quantity <= stockThreshold
              const stockColor = item.stock_quantity <= 0
                ? 'text-[#c7293a]'
                : isCritical
                  ? 'text-[#c7293a]'
                  : 'text-amber-600'

              return (
                <div key={item.title} className="flex items-center gap-3 py-2.5">
                  <ProductThumb src={item.image_url} title={item.title} />
                  <p className="flex-1 min-w-0 text-xs font-medium text-[#1a1a2e] truncate">
                    {item.title}
                  </p>
                  <div className="text-right shrink-0 space-y-1">
                    <p className={`text-sm font-bold tabular-nums ${stockColor}`}>
                      {item.stock_quantity}
                    </p>
                    <div className="flex items-center justify-end gap-1.5">
                      <p className="text-[10px] text-[#9b9b93]">unités</p>
                      {item.coverage_days != null && (
                        <span className={`px-1.5 py-0.5 rounded-full text-[10px] font-semibold ${
                          item.coverage_days <= 7
                            ? 'bg-[#fde8ea] text-[#c7293a]'
                            : item.coverage_days <= 14
                            ? 'bg-[#fffbeb] text-[#d97706]'
                            : 'bg-[#f0faf4] text-[#1a7f4b]'
                        }`}>
                          {Math.round(item.coverage_days)}j
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
