import React from 'react'
import { TrendingUp, ShoppingBag, DollarSign, Package, Megaphone, Zap } from 'lucide-react'

export interface SnapshotData {
  total_sales: number
  order_count: number
  gross_profit: number
  cogs: number
  spend: number
}

interface Props {
  data: SnapshotData | null
  date: string
  loading: boolean
  syncDone?: boolean
}

const fmt = (n: number) =>
  new Intl.NumberFormat('fr-FR', {
    style: 'currency',
    currency: 'EUR',
    maximumFractionDigits: 0,
  }).format(n)

const items = (d: SnapshotData) => {
  const roas = d.spend > 0 ? d.total_sales / d.spend : null
  return [
    {
      icon: DollarSign,
      label: 'Ventes',
      value: fmt(d.total_sales),
      sub: `Marge brute ${d.total_sales > 0 ? ((d.gross_profit / d.total_sales) * 100).toFixed(1) : 0}%`,
    },
    {
      icon: TrendingUp,
      label: 'Profit brut',
      value: fmt(d.gross_profit),
      sub: 'Avant charges fixes',
    },
    {
      icon: ShoppingBag,
      label: 'Commandes',
      value: d.order_count.toLocaleString('fr-FR'),
      sub: d.order_count > 0 ? `Panier moy. ${fmt(d.total_sales / d.order_count)}` : '—',
    },
    {
      icon: Package,
      label: 'COGS',
      value: fmt(d.cogs),
      sub: d.total_sales > 0 ? `${((d.cogs / d.total_sales) * 100).toFixed(1)}% du CA` : '—',
    },
    {
      icon: Megaphone,
      label: 'Pub',
      value: fmt(d.spend),
      sub: d.total_sales > 0
        ? `${((d.spend / d.total_sales) * 100).toFixed(1)}% du CA`
        : '—',
    },
    {
      icon: Zap,
      label: 'ROAS',
      value: roas != null ? `${roas.toFixed(2)}x` : '—',
      sub: roas != null
        ? roas >= 3 ? 'Excellent' : roas >= 1.5 ? 'Correct' : 'Faible'
        : 'Pas de spend',
    },
  ]
}

export default function SnapshotBanner({ data, date, loading, syncDone = false }: Props) {
  const label = (() => {
    const d = new Date(date)
    return d.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' })
  })()

  return (
    <div className="bg-white rounded-[20px] shadow-[0_2px_16px_rgba(0,0,0,0.06)] p-6">
      <div className="flex items-center justify-between mb-6">
        <div>
          <p className="text-[10px] font-semibold text-[#6b6b63] uppercase tracking-[0.1em]">
            Hier
          </p>
          <p className="text-sm font-medium text-[#1a1a18] capitalize mt-0.5">{label}</p>
        </div>
        {!loading && !data && syncDone && (
          <span className="text-xs text-[#6b6b63] bg-[#F8F8F7] px-3 py-1 rounded-full">
            Aucune donnée
          </span>
        )}
        {!loading && data && data.order_count === 0 && (
          <span className="text-xs text-[#6b6b63] bg-[#F8F8F7] px-3 py-1 rounded-full">
            Journée sans commande
          </span>
        )}
      </div>

      <div className="grid grid-cols-2 gap-6 sm:grid-cols-3 lg:grid-cols-6">
        {loading
          ? Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="space-y-2">
                <div className="h-3 w-16 bg-[#f0f0ee] rounded-full animate-pulse" />
                <div className="h-7 w-24 bg-[#f0f0ee] rounded-full animate-pulse" />
                <div className="h-3 w-20 bg-[#f0f0ee] rounded-full animate-pulse" />
              </div>
            ))
          : data
          ? items(data).map(({ icon: Icon, label, value, sub }: { icon: React.ElementType; label: string; value: string; sub: string }) => (
              <div key={label} className="space-y-1">
                <div className="flex items-center gap-1.5 text-[#6b6b63]">
                  <Icon size={13} strokeWidth={1.8} />
                  <span className="text-xs font-medium">{label}</span>
                </div>
                <p className="text-xl sm:text-2xl font-semibold text-[#1a1a18] tracking-tight">
                  {value}
                </p>
                <p className="text-xs text-[#6b6b63]">{sub}</p>
              </div>
            ))
          : null}
      </div>
    </div>
  )
}
