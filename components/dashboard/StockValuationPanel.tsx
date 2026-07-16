'use client'

import { useState } from 'react'
import { Boxes, ChevronDown } from 'lucide-react'

export interface StockValItem {
  title:         string
  variant_title: string | null
  qty:           number
  cost:          number | null
  retail:        number | null
  blocked:       number   // qty × cost (0 si coût inconnu)
  image_url:     string | null
}

export interface StockValuation {
  totalCost:       number   // trésorerie immobilisée (coût d'achat)
  totalRetail:     number   // valeur de revente potentielle
  units:           number
  skusMissingCost: number   // variantes en stock sans prix d'achat renseigné
  items:           StockValItem[]
}

const fmtEur = (n: number) =>
  new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }).format(n)

export default function StockValuationPanel({ data, loading }: { data: StockValuation | null; loading: boolean }) {
  const [expanded, setExpanded] = useState(false)

  if (loading) {
    return <div className="bg-white rounded-[20px] shadow-[0_2px_16px_rgba(0,0,0,0.06)] h-[180px] animate-pulse" />
  }
  if (!data || data.units === 0) {
    return (
      <div className="bg-white rounded-[20px] shadow-[0_2px_16px_rgba(0,0,0,0.06)] p-6">
        <p className="text-sm text-[#9b9b93]">Aucun stock valorisable.</p>
      </div>
    )
  }

  const margin    = data.totalRetail - data.totalCost
  const marginPct = data.totalRetail > 0 ? (margin / data.totalRetail) * 100 : 0
  const rows = expanded ? data.items : data.items.slice(0, 8)

  return (
    <div className="bg-white rounded-[20px] shadow-[0_2px_16px_rgba(0,0,0,0.06)] overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-2 px-6 pt-5">
        <Boxes size={15} className="text-[#aeb0c9]" />
        <p className="text-[10px] font-semibold uppercase tracking-[0.1em] text-[#aeb0c9]">
          Trésorerie immobilisée en stock
        </p>
        <span className="text-[11px] text-[#9b9b93] ml-auto tabular-nums">{data.units.toLocaleString('fr-FR')} unités</span>
      </div>

      {/* 3 chiffres clés */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-px bg-[#f0f0ee] mt-4 border-y border-[#f0f0ee]">
        <div className="bg-white p-5">
          <p className="text-[11px] text-[#6b6b63] mb-1">Tréso bloquée (coût d&apos;achat)</p>
          <p className="text-2xl font-bold tabular-nums text-[#1a1a2e]">{fmtEur(data.totalCost)}</p>
        </div>
        <div className="bg-white p-5">
          <p className="text-[11px] text-[#6b6b63] mb-1">Valeur revente potentielle</p>
          <p className="text-2xl font-bold tabular-nums text-[#1a7f4b]">{fmtEur(data.totalRetail)}</p>
        </div>
        <div className="bg-white p-5">
          <p className="text-[11px] text-[#6b6b63] mb-1">Marge potentielle</p>
          <p className="text-2xl font-bold tabular-nums text-[#1a1a2e]">{fmtEur(margin)}</p>
          <p className="text-[11px] text-[#9b9b93] mt-0.5">{marginPct.toFixed(0)}% de la valeur</p>
        </div>
      </div>

      {data.skusMissingCost > 0 && (
        <p className="px-6 py-2 text-[11px] text-[#b45309] bg-[#fffbeb] border-b border-[#f0f0ee]">
          ⚠ {data.skusMissingCost} variante(s) en stock sans prix d&apos;achat renseigné — la tréso bloquée est sous-estimée.
        </p>
      )}

      {/* Détail par produit */}
      <div className="px-3 py-2">
        <table className="w-full text-xs">
          <thead>
            <tr className="text-[#9b9b93]">
              <th className="text-left font-medium py-1.5 pl-3">Produit</th>
              <th className="text-right font-medium py-1.5">Stock</th>
              <th className="text-right font-medium py-1.5">Coût u.</th>
              <th className="text-right font-medium py-1.5 pr-3">Tréso bloquée</th>
              <th className="text-right font-medium py-1.5 pr-3 hidden sm:table-cell">Revente pot.</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((it, i) => (
              <tr key={i} className="border-t border-[#f6f6f4]">
                <td className="py-1.5 pl-3">
                  <div className="flex items-center gap-2 min-w-0">
                    {it.image_url
                      // eslint-disable-next-line @next/next/no-img-element
                      ? <img src={it.image_url} alt="" className="w-7 h-7 rounded-md object-cover border border-[#eee] shrink-0" />
                      : <div className="w-7 h-7 rounded-md bg-[#f5f5f3] shrink-0" />}
                    <div className="min-w-0">
                      <div className="font-medium text-[#1a1a2e] truncate max-w-[180px]">{it.title}</div>
                      {it.variant_title && <div className="text-[10px] text-[#9b9b93] truncate max-w-[180px]">{it.variant_title}</div>}
                    </div>
                  </div>
                </td>
                <td className="text-right tabular-nums text-[#6b6b63]">{it.qty.toLocaleString('fr-FR')}</td>
                <td className="text-right tabular-nums text-[#6b6b63]">{it.cost != null ? fmtEur(it.cost) : '—'}</td>
                <td className="text-right tabular-nums font-semibold text-[#1a1a2e] pr-3">{it.cost != null ? fmtEur(it.blocked) : '—'}</td>
                <td className="text-right tabular-nums text-[#1a7f4b] pr-3 hidden sm:table-cell">{it.retail != null ? fmtEur(it.qty * it.retail) : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>

        {data.items.length > 8 && (
          <button
            onClick={() => setExpanded((e) => !e)}
            className="w-full mt-1 py-2 flex items-center justify-center gap-1 text-[11px] font-medium text-[#6b6b63] hover:text-[#1a1a2e]"
          >
            {expanded ? 'Voir moins' : `Voir les ${data.items.length} produits`}
            <ChevronDown size={13} className={`transition-transform ${expanded ? 'rotate-180' : ''}`} />
          </button>
        )}
      </div>
    </div>
  )
}
