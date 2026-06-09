'use client'

import { useState, useEffect, useCallback } from 'react'
import { ChevronLeft, Download, CheckCheck, Clock, TrendingDown } from 'lucide-react'

interface Reconciliation {
  id: string
  cutoff_date: string
  submitted_by: string
  submitted_at: string
  status: 'pending' | 'reviewed'
}

interface ReconciliationItem {
  id: string
  shopify_variant_id: string
  product_title: string
  variant_title: string | null
  image_url: string | null
  logistician_qty: number
  shopify_qty_at_cutoff: number
  cost_price: number
}

const fmtDate = (d: string) =>
  new Date(d + 'T00:00:00').toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' })

const fmtEur = (n: number) =>
  new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }).format(n)

function EcartBadge({ ecart }: { ecart: number }) {
  const abs = Math.abs(ecart)
  const color = abs > 10 ? '#c7293a' : abs >= 5 ? '#b45309' : '#1a7f4b'
  const bg    = abs > 10 ? '#fce8ea'  : abs >= 5 ? '#fef3c7'  : '#dcf5e7'
  if (ecart === 0) return <span className="text-[11px] font-medium text-[#9b9b93]">—</span>
  return (
    <span className="inline-flex px-2 py-0.5 rounded-full text-[11px] font-semibold" style={{ color, backgroundColor: bg }}>
      {ecart > 0 ? '+' : ''}{ecart}
    </span>
  )
}

function AnalyseSection({ items, history }: { items: ReconciliationItem[]; history: { id: string; items: ReconciliationItem[]; cutoff_date: string }[] }) {
  const withEcart = items.filter((i) => Math.abs(i.logistician_qty - i.shopify_qty_at_cutoff) > 0)
  const critical  = items.filter((i) => Math.abs(i.logistician_qty - i.shopify_qty_at_cutoff) > 10)

  // Variants with recurring gaps across reconciliations
  const variantEcartHistory = new Map<string, number[]>()
  for (const h of history) {
    for (const hItem of h.items) {
      const e = hItem.logistician_qty - hItem.shopify_qty_at_cutoff
      if (!variantEcartHistory.has(hItem.shopify_variant_id)) variantEcartHistory.set(hItem.shopify_variant_id, [])
      variantEcartHistory.get(hItem.shopify_variant_id)!.push(e)
    }
  }
  const recurring = Array.from(variantEcartHistory.entries())
    .filter(([, ecarts]) => ecarts.length >= 2 && ecarts.every((e) => Math.abs(e) > 5))
    .map(([vid]) => items.find((i) => i.shopify_variant_id === vid))
    .filter(Boolean) as ReconciliationItem[]

  if (withEcart.length === 0) return (
    <div className="bg-[#dcf5e7] rounded-[16px] p-5">
      <p className="text-sm font-semibold text-[#1a7f4b]">Stock conforme</p>
      <p className="text-xs text-[#1a7f4b]/80 mt-1">Aucun écart détecté sur cette réconciliation.</p>
    </div>
  )

  return (
    <div className="bg-white rounded-[16px] shadow-[0_2px_12px_rgba(0,0,0,0.06)] p-5 space-y-4">
      <p className="text-[10px] font-semibold uppercase tracking-[0.1em] text-[#aeb0c9]">Analyse Steero AI</p>

      <div className="grid grid-cols-3 gap-3">
        <div className="bg-[#f8f7f5] rounded-xl p-3 text-center">
          <p className="text-lg font-bold text-[#1a1a2e]">{withEcart.length}</p>
          <p className="text-[10px] text-[#6b6b63]">variants avec écart</p>
        </div>
        <div className="bg-[#fce8ea] rounded-xl p-3 text-center">
          <p className="text-lg font-bold text-[#c7293a]">{critical.length}</p>
          <p className="text-[10px] text-[#c7293a]">écarts critiques (&gt;10)</p>
        </div>
        <div className="bg-[#f8f7f5] rounded-xl p-3 text-center">
          <p className="text-lg font-bold text-[#1a1a2e]">
            {fmtEur(withEcart.reduce((s, i) => s + Math.abs(i.logistician_qty - i.shopify_qty_at_cutoff) * i.cost_price, 0))}
          </p>
          <p className="text-[10px] text-[#6b6b63]">valeur totale d&apos;écart</p>
        </div>
      </div>

      {critical.length > 0 && (
        <div>
          <p className="text-xs font-semibold text-[#1a1a2e] mb-2">Écarts critiques (&gt;10 unités)</p>
          <div className="space-y-1.5">
            {critical.map((i) => {
              const e = i.logistician_qty - i.shopify_qty_at_cutoff
              return (
                <div key={i.shopify_variant_id} className="flex items-center justify-between text-xs bg-[#fce8ea]/50 rounded-lg px-3 py-2">
                  <span className="text-[#1a1a2e]">{i.product_title}{i.variant_title ? ` – ${i.variant_title}` : ''}</span>
                  <span className="font-semibold text-[#c7293a]">{e > 0 ? '+' : ''}{e}</span>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {recurring.length > 0 && (
        <div>
          <p className="text-xs font-semibold text-[#1a1a2e] mb-2">Refs avec écarts récurrents</p>
          <div className="space-y-1.5">
            {recurring.map((i) => (
              <div key={i.shopify_variant_id} className="flex items-center gap-2 text-xs bg-[#fef3c7]/50 rounded-lg px-3 py-2">
                <TrendingDown size={12} className="text-[#b45309] shrink-0" />
                <span className="text-[#1a1a2e]">{i.product_title}{i.variant_title ? ` – ${i.variant_title}` : ''}</span>
                <span className="text-[#b45309] ml-auto">Écart persistant</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

export default function ReconciliationStockPage() {
  const [reconciliations, setReconciliations] = useState<Reconciliation[]>([])
  const [selected, setSelected]               = useState<Reconciliation | null>(null)
  const [items, setItems]                     = useState<ReconciliationItem[]>([])
  const [historyItems, setHistoryItems]       = useState<{ id: string; items: ReconciliationItem[]; cutoff_date: string }[]>([])
  const [loading, setLoading]                 = useState(true)
  const [detailLoading, setDetailLoading]     = useState(false)

  useEffect(() => {
    fetch('/api/reconciliation/history')
      .then((r) => r.json())
      .then(({ reconciliations: list }) => {
        setReconciliations(list ?? [])
        setLoading(false)
      })
  }, [])

  const loadDetail = useCallback(async (recon: Reconciliation) => {  // eslint-disable-line
    setDetailLoading(true)
    setSelected(recon)
    const res  = await fetch(`/api/reconciliation/history?id=${recon.id}`)
    const data = await res.json()
    setItems(data.items ?? [])

    // Mark as reviewed
    if (recon.status === 'pending') {
      await fetch('/api/reconciliation/history', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: recon.id, status: 'reviewed' }),
      })
      setReconciliations((prev) => prev.map((r) => r.id === recon.id ? { ...r, status: 'reviewed' } : r))
    }

    // Load history items for AI analysis (last 5 reconciliations)
    const othersData = await Promise.all(
      reconciliations.slice(0, 5).filter((r) => r.id !== recon.id).map(async (r) => {
        const d = await fetch(`/api/reconciliation/history?id=${r.id}`).then((x) => x.json())
        return { id: r.id, cutoff_date: r.cutoff_date, items: d.items ?? [] }
      })
    )
    setHistoryItems(othersData)
    setDetailLoading(false)
  }, [reconciliations])

  function handlePrint() {
    window.print()
  }

  const pendingCount = reconciliations.filter((r) => r.status === 'pending').length

  // ── Detail view ────────────────────────────────────────────────────────────
  if (selected) {
    const totalEcartVal = items.reduce((s, i) => {
      const e = i.logistician_qty - i.shopify_qty_at_cutoff
      return s + Math.abs(e) * i.cost_price
    }, 0)

    return (
      <div className="min-h-screen bg-[#f8f7f5]">
        <div className="max-w-5xl mx-auto px-4 py-8 space-y-5">

          {/* Back + header */}
          <div className="print:hidden flex items-center gap-3">
            <button onClick={() => setSelected(null)} className="flex items-center gap-1.5 text-sm text-[#6b6b63] hover:text-[#1a1a2e]">
              <ChevronLeft size={16} /> Retour
            </button>
          </div>

          <div className="flex items-start justify-between print:mb-6">
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-[0.1em] text-[#aeb0c9] print:text-black">Réconciliation stock Mōom</p>
              <h1 className="text-xl font-bold text-[#1a1a2e] mt-0.5">Stock arrêté au {fmtDate(selected.cutoff_date)}</h1>
              <p className="text-xs text-[#9b9b93] mt-1">
                Soumis par {selected.submitted_by} le {new Date(selected.submitted_at).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' })}
              </p>
            </div>
            <button
              onClick={handlePrint}
              className="print:hidden flex items-center gap-2 px-4 py-2 bg-[#1a1a2e] text-white text-sm font-medium rounded-xl hover:bg-[#2a2a3e] transition-colors"
            >
              <Download size={15} /> Export PDF
            </button>
          </div>

          {/* Summary */}
          <div className="grid grid-cols-3 gap-3 print:gap-4">
            {[
              { label: 'Variants analysés', value: items.length.toString() },
              { label: 'Avec écart', value: items.filter((i) => i.logistician_qty !== i.shopify_qty_at_cutoff).length.toString() },
              { label: 'Valeur écart total', value: fmtEur(totalEcartVal) },
            ].map(({ label, value }) => (
              <div key={label} className="bg-white rounded-[16px] shadow-[0_2px_12px_rgba(0,0,0,0.06)] p-4 print:border print:border-gray-200 print:shadow-none">
                <p className="text-[10px] font-semibold uppercase tracking-[0.1em] text-[#aeb0c9]">{label}</p>
                <p className="text-xl font-bold text-[#1a1a2e] mt-1">{value}</p>
              </div>
            ))}
          </div>

          {/* Comparison table */}
          <div className="bg-white rounded-[16px] shadow-[0_2px_12px_rgba(0,0,0,0.06)] overflow-hidden print:shadow-none print:border print:border-gray-200">
            <div className="px-5 py-3.5 border-b border-[#f0f0ee]">
              <p className="text-[10px] font-semibold uppercase tracking-[0.1em] text-[#aeb0c9]">Tableau comparatif</p>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-[#f0f0ee] text-[10px] font-semibold uppercase tracking-[0.08em] text-[#9b9b93]">
                    <th className="px-5 py-3 text-left">Variant</th>
                    <th className="px-4 py-3 text-right">Logisticien</th>
                    <th className="px-4 py-3 text-right">Shopify théorique</th>
                    <th className="px-4 py-3 text-right">Écart</th>
                    <th className="px-4 py-3 text-right">Valeur écart</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#f8f8f7]">
                  {detailLoading
                    ? Array.from({ length: 5 }).map((_, i) => (
                        <tr key={i}>
                          <td className="px-5 py-3" colSpan={5}>
                            <div className="h-4 bg-[#f0f0ee] rounded animate-pulse" />
                          </td>
                        </tr>
                      ))
                    : items.map((item) => {
                        const ecart    = item.logistician_qty - item.shopify_qty_at_cutoff
                        const ecartVal = Math.abs(ecart) * item.cost_price
                        return (
                          <tr key={item.shopify_variant_id} className="hover:bg-[#fafaf8]">
                            <td className="px-5 py-3">
                              <div className="flex items-center gap-3">
                                {item.image_url ? (
                                  <img src={item.image_url} alt="" className="w-9 h-9 rounded-lg object-cover shrink-0 bg-[#f5f5f3]" />
                                ) : (
                                  <div className="w-9 h-9 rounded-lg bg-[#f5f5f3] shrink-0" />
                                )}
                                <div className="min-w-0">
                                  <p className="font-medium text-[#1a1a2e] truncate">{item.product_title}</p>
                                  {item.variant_title && <p className="text-[11px] text-[#9b9b93]">{item.variant_title}</p>}
                                </div>
                              </div>
                            </td>
                            <td className="px-4 py-3 text-right font-semibold text-[#1a1a2e] tabular-nums">{item.logistician_qty}</td>
                            <td className="px-4 py-3 text-right text-[#6b6b63] tabular-nums">{item.shopify_qty_at_cutoff}</td>
                            <td className="px-4 py-3 text-right">
                              <div className="flex justify-end">
                                <EcartBadge ecart={ecart} />
                              </div>
                            </td>
                            <td className="px-4 py-3 text-right text-[#6b6b63] tabular-nums text-xs">
                              {ecartVal > 0 ? fmtEur(ecartVal) : '—'}
                            </td>
                          </tr>
                        )
                      })
                  }
                </tbody>
              </table>
            </div>
          </div>

          {/* AI Analysis */}
          {!detailLoading && <AnalyseSection items={items} history={historyItems} />}

        </div>

        {/* Print styles */}
        <style jsx global>{`
          @media print {
            @page { margin: 2cm; }
            body { background: white !important; }
            .print\\:hidden { display: none !important; }
          }
        `}</style>
      </div>
    )
  }

  // ── List view ──────────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-[#f8f7f5]">
      <div className="max-w-3xl mx-auto px-4 py-8 space-y-5">

        <div>
          <p className="text-[10px] font-semibold uppercase tracking-[0.1em] text-[#aeb0c9]">Mōom</p>
          <h1 className="text-xl font-bold text-[#1a1a2e] mt-0.5">Stock</h1>
          {pendingCount > 0 && (
            <p className="text-sm text-[#b45309] mt-1">
              {pendingCount} nouvelle{pendingCount > 1 ? 's' : ''} saisie{pendingCount > 1 ? 's' : ''} à examiner
            </p>
          )}
        </div>

        {loading ? (
          <div className="space-y-3">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="bg-white rounded-[16px] h-20 animate-pulse" />
            ))}
          </div>
        ) : reconciliations.length === 0 ? (
          <div className="bg-white rounded-[16px] shadow-[0_2px_12px_rgba(0,0,0,0.06)] p-10 text-center">
            <p className="text-sm text-[#9b9b93]">Aucune réconciliation soumise pour le moment.</p>
          </div>
        ) : (
          <div className="space-y-3">
            {reconciliations.map((r) => (
              <button
                key={r.id}
                onClick={() => loadDetail(r)}
                className="w-full bg-white rounded-[16px] shadow-[0_2px_12px_rgba(0,0,0,0.06)] px-5 py-4 flex items-center justify-between hover:shadow-[0_4px_20px_rgba(0,0,0,0.10)] transition-shadow text-left"
              >
                <div>
                  <div className="flex items-center gap-2.5">
                    <p className="text-sm font-semibold text-[#1a1a2e]">Stock arrêté au {fmtDate(r.cutoff_date)}</p>
                    {r.status === 'pending' ? (
                      <span className="flex items-center gap-1 px-2 py-0.5 bg-[#fef3c7] text-[#b45309] text-[10px] font-semibold rounded-full">
                        <Clock size={10} /> Nouveau
                      </span>
                    ) : (
                      <span className="flex items-center gap-1 px-2 py-0.5 bg-[#f0f0ee] text-[#6b6b63] text-[10px] font-semibold rounded-full">
                        <CheckCheck size={10} /> Examiné
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-[#9b9b93] mt-0.5">
                    Soumis le {new Date(r.submitted_at).toLocaleDateString('fr-FR')} par {r.submitted_by}
                  </p>
                </div>
                <ChevronLeft size={16} className="text-[#9b9b93] rotate-180 shrink-0" />
              </button>
            ))}
          </div>
        )}

      </div>
    </div>
  )
}
