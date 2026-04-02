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
  roasTarget?: number
}

const fmt = (n: number) =>
  new Intl.NumberFormat('fr-FR', {
    style: 'currency',
    currency: 'EUR',
    maximumFractionDigits: 0,
  }).format(n)

interface Item {
  icon: React.ElementType
  label: string
  value: string
  sub: string
  valueColor?: string
  subColor?: string
}

function items(d: SnapshotData, roasTarget: number): Item[] {
  const roas = d.spend > 0 ? d.total_sales / d.spend : null
  const roasGood = roas != null ? roas >= roasTarget : null

  return [
    {
      icon: DollarSign,
      label: 'Ventes',
      value: fmt(d.total_sales),
      sub: `Marge ${d.total_sales > 0 ? ((d.gross_profit / d.total_sales) * 100).toFixed(1) : 0}%`,
    },
    {
      icon: TrendingUp,
      label: 'Profit brut',
      value: fmt(d.gross_profit),
      sub: 'Avant charges fixes',
      valueColor: d.gross_profit > 0 ? 'text-[#1a7f4b]' : d.gross_profit < 0 ? 'text-[#c7293a]' : undefined,
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
      sub: d.total_sales > 0 ? `${((d.spend / d.total_sales) * 100).toFixed(1)}% du CA` : '—',
    },
    {
      icon: Zap,
      label: 'ROAS',
      value: roas != null ? `${roas.toFixed(2)}x` : '—',
      sub: roas != null
        ? roas >= roasTarget ? 'Excellent' : roas >= 1.5 ? 'Correct' : 'Faible'
        : 'Pas de spend',
      valueColor: roasGood === true ? 'text-[#1a7f4b]' : roasGood === false ? 'text-[#c7293a]' : undefined,
      subColor:   roasGood === true ? 'text-[#1a7f4b]' : roasGood === false ? 'text-[#c7293a]' : undefined,
    },
  ]
}

export default function SnapshotBanner({ data, date, loading, syncDone = false, roasTarget = 3 }: Props) {
  const label = (() => {
    const d = new Date(date)
    return d.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' })
  })()

  return (
    <div className="bg-white rounded-[20px] shadow-[0_2px_16px_rgba(0,0,0,0.06)] p-6">
      <div className="flex items-center justify-between mb-5">
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

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        {loading
          ? Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="rounded-xl bg-[#f5f5f3] p-3 space-y-2">
                <div className="h-3 w-16 bg-[#e8e8e4] rounded-full animate-pulse" />
                <div className="h-7 w-24 bg-[#e8e8e4] rounded-full animate-pulse" />
                <div className="h-3 w-20 bg-[#e8e8e4] rounded-full animate-pulse" />
              </div>
            ))
          : data
          ? items(data, roasTarget).map(({ icon: Icon, label, value, sub, valueColor, subColor }) => (
              <div key={label} className="rounded-xl p-3 space-y-1 bg-[#faf9f8]">
                <div className="flex items-center gap-1.5 text-[#9b9b93]">
                  <Icon size={13} strokeWidth={1.8} />
                  <span className="text-xs font-medium text-[#6b6b63]">{label}</span>
                </div>
                <p className={`text-xl sm:text-2xl font-semibold tracking-tight ${valueColor ?? 'text-[#1a1a18]'}`}>
                  {value}
                </p>
                <p className={`text-xs ${subColor ?? 'text-[#9b9b93]'}`}>{sub}</p>
              </div>
            ))
          : null}
      </div>
    </div>
  )
}
