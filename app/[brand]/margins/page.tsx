'use client'

export const dynamic = 'force-dynamic'

import { useState, useEffect, useCallback, useMemo, Fragment } from 'react'
import { createBrowserClient } from '@supabase/auth-helpers-nextjs'
import { ChevronRight, Percent, AlertTriangle } from 'lucide-react'

const supabase = createBrowserClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
)

type Period = '7j' | '30j' | 'mois'

function fmt(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

// Fenêtre glissante finissant HIER (aujourd'hui incomplet), comme le dashboard.
function getRange(period: Period): { from: string; to: string; days: number } {
  const today = new Date(); today.setHours(0, 0, 0, 0)
  const to = new Date(today); to.setDate(to.getDate() - 1)
  let from: Date
  if (period === '7j')       { from = new Date(to); from.setDate(from.getDate() - 6) }
  else if (period === '30j') { from = new Date(to); from.setDate(from.getDate() - 29) }
  else                       { from = new Date(today.getFullYear(), today.getMonth(), 1) }
  const days = Math.round((to.getTime() - from.getTime()) / 86_400_000) + 1
  return { from: fmt(from), to: fmt(to), days }
}

const eur = (n: number) => new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }).format(n)
const pct = (m: number, rev: number) => (rev > 0 ? (m / rev) * 100 : 0)

interface Sale { product_title: string; shopify_product_id: string | null; variant_id: string | null; variant_title: string | null; quantity: number; revenue: number }
interface VariantRow { key: string; variant_title: string; quantity: number; revenue: number; cost: number; missing: boolean }
interface ProductRow { key: string; title: string; quantity: number; revenue: number; cost: number; margin: number; missing: boolean; variants: VariantRow[] }

type SortKey = 'margin' | 'pct' | 'revenue'

export default function MarginsPage({ params }: { params: { brand: string } }) {
  const { brand } = params
  const [period, setPeriod]   = useState<Period>('mois')
  const [rows, setRows]       = useState<ProductRow[]>([])
  const [loading, setLoading] = useState(true)
  const [sort, setSort]       = useState<SortKey>('margin')
  const [expanded, setExpanded] = useState<Set<string>>(new Set())

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const { from, to } = getRange(period)
      const [salesRes, variantsRes, productsRes] = await Promise.all([
        supabase.from('product_sales')
          .select('product_title, shopify_product_id, variant_id, variant_title, quantity, revenue')
          .eq('brand', brand).gte('date', from).lte('date', to).limit(50000),
        supabase.from('product_variants')
          .select('shopify_variant_id, shopify_product_id, cost_price').eq('brand', brand),
        supabase.from('products')
          .select('shopify_id, cost_price').eq('brand', brand),
      ])

      // Coût : variante → produit → moyenne variantes du produit
      const costByVariant = new Map<string, number>()
      const costByProduct = new Map<string, number>()
      const prodVarCosts  = new Map<string, number[]>()
      for (const v of variantsRes.data ?? []) {
        if (v.cost_price != null) {
          costByVariant.set(String(v.shopify_variant_id), v.cost_price)
          if (v.shopify_product_id) {
            const a = prodVarCosts.get(String(v.shopify_product_id)) ?? []
            a.push(v.cost_price); prodVarCosts.set(String(v.shopify_product_id), a)
          }
        }
      }
      for (const p of productsRes.data ?? []) if (p.cost_price != null) costByProduct.set(String(p.shopify_id), p.cost_price)
      const costByProductAvg = new Map<string, number>()
      for (const [k, a] of prodVarCosts) costByProductAvg.set(k, a.reduce((s, x) => s + x, 0) / a.length)

      const unitCost = (s: Sale): number | null => {
        const byV = s.variant_id ? costByVariant.get(String(s.variant_id)) : undefined
        if (byV != null) return byV
        const pid = s.shopify_product_id ? String(s.shopify_product_id) : ''
        return costByProduct.get(pid) ?? costByProductAvg.get(pid) ?? null
      }

      // Agrégation produit → variante
      const prodMap = new Map<string, ProductRow & { varMap: Map<string, VariantRow> }>()
      for (const s of (salesRes.data ?? []) as Sale[]) {
        if (!s.product_title) continue
        const pKey = s.shopify_product_id ? `p${s.shopify_product_id}` : `t${s.product_title}`
        let p = prodMap.get(pKey)
        if (!p) { p = { key: pKey, title: s.product_title, quantity: 0, revenue: 0, cost: 0, margin: 0, missing: false, variants: [], varMap: new Map() }; prodMap.set(pKey, p) }
        const c = unitCost(s)
        const q = s.quantity || 0, rev = s.revenue || 0
        p.quantity += q; p.revenue += rev
        if (c != null) p.cost += q * c; else p.missing = true

        const vKey = s.variant_id ? `v${s.variant_id}` : `vt${s.variant_title ?? ''}`
        let v = p.varMap.get(vKey)
        if (!v) { v = { key: vKey, variant_title: s.variant_title || '—', quantity: 0, revenue: 0, cost: 0, missing: false }; p.varMap.set(vKey, v) }
        v.quantity += q; v.revenue += rev
        if (c != null) v.cost += q * c; else v.missing = true
      }

      const out: ProductRow[] = [...prodMap.values()].map(p => ({
        key: p.key, title: p.title, quantity: p.quantity, revenue: p.revenue, cost: p.cost,
        margin: p.revenue - p.cost, missing: p.missing,
        variants: [...p.varMap.values()].sort((a, b) => (b.revenue - b.cost) - (a.revenue - a.cost)),
      }))
      setRows(out)
    } finally { setLoading(false) }
  }, [brand, period])

  useEffect(() => { load() }, [load])

  const sorted = useMemo(() => {
    const arr = [...rows]
    if (sort === 'margin')  arr.sort((a, b) => b.margin - a.margin)
    if (sort === 'pct')     arr.sort((a, b) => pct(b.margin, b.revenue) - pct(a.margin, a.revenue))
    if (sort === 'revenue') arr.sort((a, b) => b.revenue - a.revenue)
    return arr
  }, [rows, sort])

  const totals = useMemo(() => {
    const revenue = rows.reduce((s, r) => s + r.revenue, 0)
    const cost    = rows.reduce((s, r) => s + r.cost, 0)
    const missing = rows.filter(r => r.missing).length
    return { revenue, cost, margin: revenue - cost, missing }
  }, [rows])

  function toggle(k: string) {
    setExpanded(prev => { const n = new Set(prev); if (n.has(k)) n.delete(k); else n.add(k); return n })
  }

  return (
    <div className="min-h-screen bg-[#f8f7f5] pl-[72px]">
      <div className="max-w-5xl mx-auto px-6 py-8 space-y-6">

        {/* Header */}
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div className="flex items-center gap-2">
            <Percent size={18} className="text-[#aeb0c9]" />
            <h1 className="text-xl font-bold text-[#1a1a2e]">Marges par produit</h1>
          </div>
          <div className="inline-flex items-center bg-white rounded-xl p-0.5 gap-0.5 border border-[#e8e8e4]">
            {(['7j', '30j', 'mois'] as Period[]).map(p => (
              <button key={p} onClick={() => setPeriod(p)}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${period === p ? 'bg-[#1a1a2e] text-white' : 'text-[#6b6b63] hover:text-[#1a1a2e]'}`}>
                {p === '7j' ? '7 jours' : p === '30j' ? '30 jours' : 'Ce mois'}
              </button>
            ))}
          </div>
        </div>

        {/* Totaux */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {[
            { label: 'Chiffre d\'affaires', value: eur(totals.revenue), color: '#1a1a2e' },
            { label: 'Coût produits (COGS)', value: eur(totals.cost), color: '#6b6b63' },
            { label: 'Marge brute', value: eur(totals.margin), color: '#1a7f4b' },
            { label: 'Taux de marge', value: `${pct(totals.margin, totals.revenue).toFixed(0)} %`, color: '#1a7f4b' },
          ].map(c => (
            <div key={c.label} className="bg-white rounded-[16px] shadow-[0_2px_16px_rgba(0,0,0,0.06)] p-4">
              <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-[#9b9b93]">{c.label}</p>
              <p className="text-xl font-bold tabular-nums mt-1" style={{ color: c.color }}>{c.value}</p>
            </div>
          ))}
        </div>

        {totals.missing > 0 && (
          <div className="flex items-center gap-2 rounded-xl bg-[#fffbeb] border border-[#fcd34d] px-3 py-2 text-[11px] text-[#92400e]">
            <AlertTriangle size={13} /> {totals.missing} produit(s) sans prix d&apos;achat complet — leur marge est surestimée. Complète les coûts dans Réappro/Produits pour fiabiliser.
          </div>
        )}

        {/* Tableau */}
        <div className="bg-white rounded-[20px] shadow-[0_2px_16px_rgba(0,0,0,0.06)] overflow-hidden">
          <div className="flex items-center justify-between px-5 py-3 border-b border-[#f0f0ee]">
            <p className="text-[10px] font-semibold text-[#6b6b63] uppercase tracking-[0.1em]">Produits ({rows.length})</p>
            <div className="inline-flex items-center gap-1 text-[10px]">
              <span className="text-[#9b9b93] mr-1">Trier :</span>
              {([['margin', 'Marge €'], ['pct', 'Marge %'], ['revenue', 'CA']] as [SortKey, string][]).map(([k, lbl]) => (
                <button key={k} onClick={() => setSort(k)}
                  className={`px-2 py-0.5 rounded-md font-semibold ${sort === k ? 'bg-[#1a1a2e] text-white' : 'text-[#6b6b63] hover:bg-[#f0f0ee]'}`}>{lbl}</button>
              ))}
            </div>
          </div>

          {loading ? (
            <div className="p-10 text-center text-sm text-[#9b9b93]">Chargement…</div>
          ) : rows.length === 0 ? (
            <div className="p-10 text-center text-sm text-[#9b9b93]">Aucune vente sur la période.</div>
          ) : (
            <table className="w-full text-xs">
              <thead>
                <tr className="text-[#9b9b93] border-b border-[#f0f0ee]">
                  <th className="text-left font-medium py-2 pl-4">Produit</th>
                  <th className="text-right font-medium py-2">Qté</th>
                  <th className="text-right font-medium py-2">CA</th>
                  <th className="text-right font-medium py-2">Coût</th>
                  <th className="text-right font-medium py-2">Marge</th>
                  <th className="text-right font-medium py-2 pr-4">%</th>
                </tr>
              </thead>
              <tbody>
                {sorted.map(p => {
                  const open = expanded.has(p.key)
                  const p_pct = pct(p.margin, p.revenue)
                  return (
                    <Fragment key={p.key}>
                      <tr onClick={() => p.variants.length > 1 && toggle(p.key)}
                        className={`border-b border-[#f6f6f4] ${p.variants.length > 1 ? 'cursor-pointer hover:bg-[#fafafa]' : ''}`}>
                        <td className="py-2.5 pl-4">
                          <div className="flex items-center gap-1.5">
                            {p.variants.length > 1
                              ? <ChevronRight size={13} className={`text-[#aeb0c9] transition-transform ${open ? 'rotate-90' : ''}`} />
                              : <span className="w-[13px]" />}
                            <span className="font-medium text-[#1a1a2e] truncate max-w-[240px]">{p.title}</span>
                            {p.missing && <AlertTriangle size={11} className="text-[#b45309] shrink-0" />}
                          </div>
                        </td>
                        <td className="text-right tabular-nums text-[#6b6b63]">{p.quantity.toLocaleString('fr-FR')}</td>
                        <td className="text-right tabular-nums text-[#1a1a2e]">{eur(p.revenue)}</td>
                        <td className="text-right tabular-nums text-[#9b9b93]">{eur(p.cost)}</td>
                        <td className="text-right tabular-nums font-semibold text-[#1a7f4b]">{eur(p.margin)}</td>
                        <td className="text-right tabular-nums font-semibold pr-4" style={{ color: p_pct >= 50 ? '#1a7f4b' : p_pct >= 25 ? '#b45309' : '#c7293a' }}>{p_pct.toFixed(0)}%</td>
                      </tr>
                      {open && p.variants.map(v => {
                        const v_pct = pct(v.revenue - v.cost, v.revenue)
                        return (
                          <tr key={p.key + v.key} className="border-b border-[#f6f6f4] bg-[#fbfbfa]">
                            <td className="py-1.5 pl-11 text-[#6b6b63] truncate max-w-[240px]">{v.variant_title}{v.missing && <AlertTriangle size={10} className="inline ml-1 text-[#b45309]" />}</td>
                            <td className="text-right tabular-nums text-[#9b9b93]">{v.quantity.toLocaleString('fr-FR')}</td>
                            <td className="text-right tabular-nums text-[#6b6b63]">{eur(v.revenue)}</td>
                            <td className="text-right tabular-nums text-[#b0b0a8]">{eur(v.cost)}</td>
                            <td className="text-right tabular-nums text-[#1a7f4b]">{eur(v.revenue - v.cost)}</td>
                            <td className="text-right tabular-nums pr-4 text-[#9b9b93]">{v_pct.toFixed(0)}%</td>
                          </tr>
                        )
                      })}
                    </Fragment>
                  )
                })}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  )
}
