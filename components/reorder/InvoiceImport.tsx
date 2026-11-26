'use client'

// Import d'une facture fournisseur : lecture du PDF, relecture des lignes et de leur
// variante (corrigeable), puis création de la commande à la date de la facture avec
// l'acompte payé et le solde restant. Les rapprochements validés sont retenus.
import { useRef, useState } from 'react'
import { FileUp, X, AlertTriangle } from 'lucide-react'
import { aliasKey, type InvoiceLine, type ParsedInvoice } from '@/lib/reorder/invoice'
import { CARD, ORANGE, fmtDay, int } from './format'

type Act = (body: Record<string, unknown>) => Promise<boolean>
type Line = InvoiceLine & { variantId: string | null }
type Variant = { id: string; title: string; variantTitle: string | null }

const money = (n: number, cur: string) => n.toLocaleString('fr-FR', { style: 'currency', currency: cur || 'USD', maximumFractionDigits: 2 })
const input = 'border border-[#e8e4e0] rounded-lg px-2 py-1 text-xs bg-white tabular-nums focus:outline-none focus:border-[#aeb0c9]'

export default function InvoiceImport({ brand, variants, act, onDone, className }: {
  brand: string; variants: Variant[]; act: Act; onDone: (msg: string) => void; className?: string
}) {
  const fileRef = useRef<HTMLInputElement>(null)
  const [reading, setReading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [inv, setInv] = useState<ParsedInvoice | null>(null)
  const [lines, setLines] = useState<Line[]>([])
  const [rate, setRate] = useState(1)
  const [saving, setSaving] = useState(false)

  async function upload(file: File) {
    setReading(true)
    setError(null)
    const fd = new FormData()
    fd.append('file', file)
    try {
      const r = await fetch(`/api/reorder/invoice?brand=${brand}`, { method: 'POST', body: fd })
      const j = await r.json()
      if (!r.ok) throw new Error(j.error ?? 'Lecture impossible')
      setInv(j.invoice)
      setLines(j.lines)
      setRate(j.rate)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setReading(false)
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  const kept = lines.filter((l) => l.variantId && l.qty > 0)
  const missing = lines.filter((l) => l.kind === 'product' && !l.variantId).length
  const cur = inv?.currency ?? 'USD'
  const sorted = [...variants].sort((a, b) => a.title.localeCompare(b.title) || (a.variantTitle ?? '').localeCompare(b.variantTitle ?? ''))

  async function create() {
    if (!inv || !kept.length) return
    setSaving(true)
    const ok = await act({
      action: 'create_order', source: 'invoice', orderedOn: inv.date,
      invoice: { supplier: inv.supplier, number: inv.number, currency: cur, total: inv.subtotal, deposit: inv.deposit, balance: inv.balance },
      lines: kept.map((l) => ({ variantId: l.variantId, qty: l.qty, unitPrice: l.unitPrice, unitCost: l.unitPrice * rate })),
      aliases: Object.fromEntries(kept.map((l) => [aliasKey(l), l.variantId])),
    })
    setSaving(false)
    if (ok) {
      onDone(`Commande du ${fmtDay(inv.date)} enregistrée (${int(kept.reduce((a, l) => a + l.qty, 0))} unités)`)
      setInv(null)
    }
  }

  return (
    <>
      <input ref={fileRef} type="file" accept="application/pdf" className="hidden" aria-label="Facture PDF"
        onChange={(e) => { const f = e.target.files?.[0]; if (f) upload(f) }} />
      <button onClick={() => fileRef.current?.click()} disabled={reading}
        className={className ?? 'w-full flex items-center justify-center gap-2 px-4 py-2.5 border border-[#e8e4e0] rounded-xl text-sm font-medium text-[#1a1a2e] hover:border-[#aeb0c9] disabled:opacity-50'}>
        <FileUp size={14} />{reading ? 'Lecture de la facture…' : 'Importer une facture'}
      </button>
      {error && <p className="text-[11px] text-[#c7293a] mt-1">{error}</p>}

      {inv && (
        <div className="fixed inset-0 z-[55] flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/30" onClick={() => setInv(null)} />
          <div className={`${CARD} relative w-full max-w-3xl max-h-[90vh] flex flex-col`}>
            <div className="flex items-start justify-between gap-3 px-5 pt-5">
              <div>
                <h2 className="text-sm font-bold text-[#1a1a2e]">Facture {inv.supplier} n° {inv.number}</h2>
                <p className="text-[11px] text-[#6b6b63] mt-0.5">Vérifie la variante de chaque ligne. Les correspondances validées serviront aux prochains imports.</p>
              </div>
              <button onClick={() => setInv(null)} className="p-1.5 rounded-lg hover:bg-[#f5f0f2]" aria-label="Fermer"><X size={14} /></button>
            </div>

            <div className="flex items-end gap-3 flex-wrap px-5 pt-4 text-[11px] text-[#6b6b63]">
              <label>Date de commande<input type="date" value={inv.date} onChange={(e) => setInv({ ...inv, date: e.target.value })} className={`${input} block mt-1`} /></label>
              <label>Montant ({cur})<input type="number" step="0.01" value={inv.subtotal} onChange={(e) => setInv({ ...inv, subtotal: Number(e.target.value) || 0 })} className={`${input} block mt-1 w-28`} /></label>
              <label>Acompte payé<input type="number" step="0.01" value={inv.deposit} onChange={(e) => setInv({ ...inv, deposit: Number(e.target.value) || 0, balance: Math.round((inv.subtotal - (Number(e.target.value) || 0)) * 100) / 100 })} className={`${input} block mt-1 w-28`} /></label>
              <label>Solde restant<input type="number" step="0.01" value={inv.balance} onChange={(e) => setInv({ ...inv, balance: Number(e.target.value) || 0 })} className={`${input} block mt-1 w-28`} /></label>
              {cur !== 'EUR' && <label>1 {cur} =<span className="flex items-center gap-1 mt-1"><input type="number" step="0.0001" value={rate} onChange={(e) => setRate(Number(e.target.value) || 0)} className={`${input} w-20`} /> €</span></label>}
            </div>

            <div className="overflow-auto px-5 py-4 flex-1">
              <table className="w-full text-xs min-w-[620px]">
                <thead>
                  <tr className="text-[10px] text-[#9b9b93] text-left">
                    <th className="font-semibold py-1.5">Ligne de la facture</th>
                    <th className="font-semibold py-1.5 w-20">Quantité</th>
                    <th className="font-semibold py-1.5 w-20">Prix ({cur})</th>
                    <th className="font-semibold py-1.5">Variante</th>
                  </tr>
                </thead>
                <tbody>
                  {lines.map((l, i) => {
                    const todo = l.kind === 'product' && !l.variantId
                    return (
                      <tr key={i} className="border-t border-[#f5f5f3]">
                        <td className="py-1.5 pr-2 text-[#1a1a2e]">
                          {l.product}{l.color ? <span className="text-[#6b6b63]"> — {l.color}</span> : null}
                          {l.kind === 'other' && <span className="ml-1.5 text-[10px] text-[#9b9b93]">emballage / divers</span>}
                        </td>
                        <td className="py-1.5"><input type="number" min={0} value={l.qty} onChange={(e) => setLines(lines.map((x, j) => (j === i ? { ...x, qty: Math.max(0, parseInt(e.target.value) || 0) } : x)))} className={`${input} w-16 text-center`} aria-label={`Quantité ${l.product} ${l.color}`} /></td>
                        <td className="py-1.5 tabular-nums text-[#6b6b63]">{l.unitPrice.toLocaleString('fr-FR', { maximumFractionDigits: 2 })}</td>
                        <td className="py-1.5">
                          <select value={l.variantId ?? ''} onChange={(e) => setLines(lines.map((x, j) => (j === i ? { ...x, variantId: e.target.value || null } : x)))}
                            className={`${input} w-full max-w-[280px]`} style={todo ? { borderColor: ORANGE } : undefined} aria-label={`Variante pour ${l.product} ${l.color}`}>
                            <option value="">{todo ? 'À choisir…' : 'Ne pas suivre cette ligne'}</option>
                            {sorted.map((v) => <option key={v.id} value={v.id}>{v.title.replace(/™/g, '')} — {v.variantTitle ?? 'unique'}</option>)}
                          </select>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>

            <div className="border-t border-[#f0f0ee] px-5 py-4 flex items-center gap-3 flex-wrap">
              <p className="text-xs text-[#6b6b63] flex-1">
                {kept.length} {kept.length > 1 ? 'lignes suivies' : 'ligne suivie'}, {int(kept.reduce((a, l) => a + l.qty, 0))} unités,{' '}
                {money(kept.reduce((a, l) => a + l.qty * l.unitPrice, 0), cur)}
                {missing > 0 && <span className="inline-flex items-center gap-1 ml-2 font-semibold" style={{ color: ORANGE }}><AlertTriangle size={12} />{missing} à choisir</span>}
              </p>
              <button onClick={create} disabled={!kept.length || saving || !inv.date}
                className="px-4 py-2 rounded-xl text-sm font-semibold bg-[#1a1a2e] text-white disabled:opacity-40">
                {saving ? 'Enregistrement…' : `Créer la commande du ${fmtDay(inv.date)}`}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
