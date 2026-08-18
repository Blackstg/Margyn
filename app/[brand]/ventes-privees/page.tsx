'use client'

export const dynamic = 'force-dynamic'

import { useState, useEffect, useCallback, useRef } from 'react'
import { createBrowserClient } from '@supabase/auth-helpers-nextjs'
import { useBrand } from '@/context/BrandContext'
import { FileText, Loader2, Check, Trash2, Ticket } from 'lucide-react'

const supabase = createBrowserClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
)

interface ImpMonth {
  month: string; ca: number; reverse: number; commission: number
  cogs: number; cogs_matched: number; cogs_total: number
  orders: number; products: number; unmatched: { product: string; qty: number }[]
}
interface SavedRow { id: string | number; month: string; source: string; amount: number; fees: number }

const fmtMonth = (m: string) => new Date(m).toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' })
const eur = (n: number) => `${Math.round(n).toLocaleString('fr-FR')} €`

export default function VentesPriveesPage() {
  const brand = useBrand()
  const [saved, setSaved] = useState<SavedRow[]>([])
  const [loading, setLoading] = useState(true)

  const [importing, setImporting] = useState(false)
  const [impMonths, setImpMonths] = useState<ImpMonth[] | null>(null)
  const [impCogs, setImpCogs] = useState<Record<string, string>>({})
  const [impSaving, setImpSaving] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')
  const fileRef = useRef<HTMLInputElement>(null)

  const load = useCallback(async () => {
    setLoading(true)
    const { data } = await supabase.from('supplementary_revenue')
      .select('id, month, source, amount, fees').eq('brand', brand).order('month', { ascending: false })
    setSaved((data ?? []) as SavedRow[])
    setLoading(false)
  }, [brand])
  useEffect(() => { load() }, [load])

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (fileRef.current) fileRef.current.value = ''
    if (!file) return
    setImporting(true); setImpMonths(null)
    try {
      const csv = await file.text()
      const res = await fetch('/api/ventes-privees/import', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ csv }),
      })
      const d = await res.json()
      if (d.months) {
        setImpMonths(d.months)
        setImpCogs(Object.fromEntries((d.months as ImpMonth[]).map(m => [m.month, String(Math.round(m.cogs))])))
      } else { alert(d.error ?? 'Import impossible') }
    } catch { alert('Import impossible') } finally { setImporting(false) }
  }

  async function saveImport() {
    if (!impMonths) return
    setImpSaving('saving')
    try {
      for (const m of impMonths) {
        const cogs = parseFloat(impCogs[m.month]) || 0
        await supabase.from('supplementary_revenue').delete().eq('brand', brand).eq('month', m.month).eq('source', 'Choose')
        await supabase.from('supplementary_revenue').insert({ brand, month: m.month, source: 'Choose', amount: Math.round(m.reverse), fees: Math.round(cogs) })
      }
      setImpSaving('saved'); setTimeout(() => { setImpSaving('idle'); setImpMonths(null) }, 1800)
      load()
    } catch { setImpSaving('error'); setTimeout(() => setImpSaving('idle'), 3000) }
  }

  async function delRow(id: string | number) {
    await supabase.from('supplementary_revenue').delete().eq('id', id)
    load()
  }

  return (
    <div className="min-h-screen bg-[#faf9f8]">
      <main className="max-w-4xl mx-auto px-6 py-8 space-y-6">
        <div>
          <div className="flex items-center gap-2">
            <Ticket size={18} className="text-[#1a1a2e]" />
            <h1 className="text-xl font-bold text-[#1a1a18] tracking-tight">Ventes privées</h1>
          </div>
          <p className="text-sm text-[#6b6b63] mt-1">Choose, Veepee… — importe l&apos;export CSV pour que ces ventes comptent dans le dashboard.</p>
        </div>

        {/* Import */}
        <div className="bg-white rounded-[20px] shadow-[0_2px_16px_rgba(0,0,0,0.06)] overflow-hidden">
          <div className="px-6 py-4 border-b border-[#f0f0ee] flex items-center justify-between gap-3 flex-wrap">
            <div>
              <h2 className="text-sm font-semibold text-[#1a1a2e]">Importer un CSV Choose</h2>
              <p className="text-xs text-[#6b6b63] mt-0.5">Calcule le CA, la commission Choose, le reversé et le COGS (Shopify) par mois</p>
            </div>
            <input ref={fileRef} type="file" accept=".csv" onChange={handleFile} className="hidden" />
            <button onClick={() => fileRef.current?.click()} disabled={importing}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-[#1a1a2e] text-white text-sm font-semibold disabled:opacity-50">
              {importing ? <Loader2 size={15} className="animate-spin" /> : <FileText size={15} />}
              {importing ? 'Analyse…' : 'Importer CSV Choose'}
            </button>
          </div>

          {impMonths && (
            <div className="px-6 py-4 space-y-3">
              {impMonths.map(m => {
                const cogs = parseFloat(impCogs[m.month]) || 0
                const profit = Math.round(m.reverse - cogs)
                return (
                  <div key={m.month} className="rounded-xl border border-[#e8e8e4] p-4">
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-sm font-bold text-[#1a1a2e] capitalize">{fmtMonth(m.month)}</span>
                      <span className="text-[11px] text-[#9b9b93]">{m.orders} commandes · {m.products} produits</span>
                    </div>
                    <div className="grid grid-cols-2 gap-x-6 gap-y-1.5 text-sm">
                      <span className="text-[#6b6b63]">CA (retail)</span><span className="text-right font-medium">{eur(m.ca)}</span>
                      <span className="text-[#6b6b63]">Commission Choose</span><span className="text-right text-[#c7293a]">− {eur(m.commission)}</span>
                      <span className="text-[#6b6b63]">Reversé (encaissé)</span><span className="text-right font-medium">{eur(m.reverse)}</span>
                      <span className="text-[#6b6b63] flex items-center gap-1">COGS <span className="text-[10px] text-[#9b9b93]">({m.cogs_matched}/{m.cogs_total} matchés)</span></span>
                      <span className="text-right flex items-center justify-end gap-1">
                        <span className="text-[#c7293a]">−</span>
                        <input type="number" value={impCogs[m.month] ?? ''} onChange={e => setImpCogs(p => ({ ...p, [m.month]: e.target.value }))}
                          className="w-24 px-2 py-1 rounded border border-[#e8e8e4] text-sm text-right tabular-nums" /> €
                      </span>
                    </div>
                    <div className="flex items-center justify-between mt-3 pt-3 border-t border-[#f0f0ee]">
                      <span className="text-sm font-bold text-[#1a1a2e]">Profit vente privée</span>
                      <span className={`text-base font-bold ${profit >= 0 ? 'text-[#1a7f4b]' : 'text-[#c7293a]'}`}>{eur(profit)}</span>
                    </div>
                    {m.unmatched.length > 0 && (
                      <p className="text-[11px] text-[#b45309] mt-2 leading-snug">⚠️ COGS non trouvé dans Shopify pour : {m.unmatched.map(u => `${u.product} (×${u.qty})`).join(', ')} → ajuste le COGS ci-dessus.</p>
                    )}
                  </div>
                )
              })}
              <div className="flex items-center justify-end gap-2">
                <button onClick={() => setImpMonths(null)} className="px-4 py-2 rounded-lg text-sm text-[#6b6b63] hover:bg-[#f0efec]">Annuler</button>
                <button onClick={saveImport} disabled={impSaving === 'saving'}
                  className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-[#1a7f4b] text-white text-sm font-semibold disabled:opacity-50">
                  {impSaving === 'saving' ? <Loader2 size={15} className="animate-spin" /> : impSaving === 'saved' ? <Check size={15} /> : null}
                  {impSaving === 'saving' ? 'Enregistrement…' : impSaving === 'saved' ? 'Enregistré' : 'Enregistrer dans le dashboard'}
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Historique */}
        <div className="bg-white rounded-[20px] shadow-[0_2px_16px_rgba(0,0,0,0.06)] overflow-hidden">
          <div className="px-6 py-4 border-b border-[#f0f0ee]">
            <h2 className="text-sm font-semibold text-[#1a1a2e]">Ventes privées enregistrées</h2>
            <p className="text-xs text-[#6b6b63] mt-0.5">Reversé encaissé (compté au CA) · COGS (déduit du net)</p>
          </div>
          {loading ? (
            <div className="px-6 py-6 text-sm text-[#9b9b93]">Chargement…</div>
          ) : saved.length === 0 ? (
            <div className="px-6 py-10 text-center text-sm text-[#9b9b93]">Aucune vente privée enregistrée. Importe un CSV Choose ci-dessus.</div>
          ) : (
            <div className="px-6 py-3">
              <div className="grid grid-cols-[1fr_auto_auto_auto_32px] gap-3 px-1 py-2 text-[10px] font-semibold uppercase tracking-wide text-[#9b9b93]">
                <span>Mois · source</span><span className="text-right">Reversé</span><span className="text-right">COGS</span><span className="text-right">Profit</span><span />
              </div>
              {saved.map(r => (
                <div key={r.id} className="grid grid-cols-[1fr_auto_auto_auto_32px] gap-3 px-1 py-2.5 border-t border-[#f5f5f3] items-center text-sm">
                  <span className="text-[#1a1a2e]"><span className="font-medium capitalize">{fmtMonth(r.month)}</span> · <span className="text-[#6b6b63]">{r.source}</span></span>
                  <span className="text-right tabular-nums">{eur(r.amount)}</span>
                  <span className="text-right tabular-nums text-[#c7293a]">− {eur(r.fees)}</span>
                  <span className="text-right tabular-nums font-semibold text-[#1a7f4b]">{eur(r.amount - r.fees)}</span>
                  <button onClick={() => delRow(r.id)} className="w-6 h-6 flex items-center justify-center text-[#c7293a] hover:bg-[#fdecec] rounded"><Trash2 size={14} /></button>
                </div>
              ))}
            </div>
          )}
        </div>
      </main>
    </div>
  )
}
