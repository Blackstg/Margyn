'use client'

// Réglages Réappro : délais, calcul glissant ou période de référence, périodes
// promo exclues, minimum de commande et colisage par produit, récap du lundi.
// Les changements s'appliquent tout de suite au calcul ; « Enregistrer » les garde.
import { Plus, X } from 'lucide-react'
import { leadDays, targetDays, triggerDays, type ReorderSettings } from '@/lib/reorder/plan'
import { CARD } from './format'

const input = 'border border-[#e8e4e0] rounded-lg px-2 py-1 text-xs bg-white tabular-nums focus:outline-none focus:border-[#aeb0c9]'

function Num({ label, value, onChange }: { label: string; value: number; onChange: (n: number) => void }) {
  return (
    <label className="text-[11px] text-[#6b6b63]">{label}
      <span className="flex items-center gap-1 mt-1">
        <input type="number" min={0} value={value} onChange={(e) => onChange(Math.max(0, parseInt(e.target.value) || 0))} className={`${input} w-16 text-center`} /> j
      </span>
    </label>
  )
}

export default function ReorderSettingsPanel({ s, set, products, dirty, saving, onSave }: {
  s: ReorderSettings
  set: (patch: Partial<ReorderSettings>) => void
  products: { id: string; title: string }[]
  dirty: boolean; saving: boolean
  onSave: () => void
}) {
  const rule = (id: string, key: 'moq' | 'pack', v: string) => {
    const n = parseInt(v) || 0
    const cur = { ...(s.products[id] ?? {}), [key]: n > 0 ? n : null }
    const next = { ...s.products }
    if (!cur.moq && !cur.pack) delete next[id]
    else next[id] = cur
    set({ products: next })
  }
  return (
    <div className={`${CARD} p-5 space-y-5`}>
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-sm font-bold text-[#1a1a2e]">Réglages</h2>
        <button onClick={onSave} disabled={!dirty || saving}
          className="px-3 py-1.5 rounded-lg text-xs font-medium bg-[#1a1a2e] text-white disabled:opacity-40">
          {saving ? 'Enregistrement…' : dirty ? 'Enregistrer les réglages' : 'Réglages enregistrés'}
        </button>
      </div>

      <div className="flex items-end gap-4 flex-wrap">
        <Num label="Fabrication" value={s.fabDays} onChange={(n) => set({ fabDays: n })} />
        <Num label="Transport" value={s.transitDays} onChange={(n) => set({ transitDays: n })} />
        <Num label="Sécurité" value={s.safetyDays} onChange={(n) => set({ safetyDays: n })} />
        <Num label="Une commande couvre" value={s.orderCoverDays} onChange={(n) => set({ orderCoverDays: n })} />
        <p className="text-[11px] text-[#6b6b63] leading-relaxed">
          Délai total {leadDays(s)} j. À commander sous <b className="text-[#1a1a2e]">{triggerDays(s)} jours</b> de ventes,
          pour remonter à <b className="text-[#1a1a2e]">{targetDays(s)} jours</b>.
        </p>
      </div>

      <div className="space-y-2">
        <p className="text-xs font-semibold text-[#1a1a2e]">Ventes par jour</p>
        <div className="flex items-center gap-4 flex-wrap text-xs text-[#6b6b63]">
          <label className="flex items-center gap-1.5">
            <input type="radio" checked={!s.refPeriod} onChange={() => set({ refPeriod: null })} />
            {s.windowDays} derniers jours (hors ruptures et promos)
          </label>
          <label className="flex items-center gap-1.5">
            <input type="radio" checked={!!s.refPeriod} onChange={() => set({ refPeriod: s.refPeriod ?? { from: '2025-12-01', to: '2026-01-31' } })} />
            Période de référence (saisonnalité)
          </label>
          {s.refPeriod && (
            <span className="flex items-center gap-1.5">
              <input type="date" value={s.refPeriod.from} onChange={(e) => set({ refPeriod: { ...s.refPeriod!, from: e.target.value } })} className={input} />
              au
              <input type="date" value={s.refPeriod.to} onChange={(e) => set({ refPeriod: { ...s.refPeriod!, to: e.target.value } })} className={input} />
            </span>
          )}
        </div>
      </div>

      <div className="space-y-2">
        <p className="text-xs font-semibold text-[#1a1a2e]">Périodes promo exclues du calcul</p>
        <p className="text-[11px] text-[#9b9b93]">
          Comme les jours de rupture. S’il reste moins de {s.minUsefulDays} jours utiles, le calcul remonte en arrière jusqu’à en avoir {s.windowDays}.
        </p>
        {s.promos.map((p, i) => (
          <div key={i} className="flex items-center gap-2 flex-wrap">
            <input value={p.label} placeholder="Nom" onChange={(e) => set({ promos: s.promos.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)) })} className={`${input} w-40`} />
            <input type="date" value={p.from} onChange={(e) => set({ promos: s.promos.map((x, j) => (j === i ? { ...x, from: e.target.value } : x)) })} className={input} />
            <span className="text-[11px] text-[#9b9b93]">au</span>
            <input type="date" value={p.to} onChange={(e) => set({ promos: s.promos.map((x, j) => (j === i ? { ...x, to: e.target.value } : x)) })} className={input} />
            <button onClick={() => set({ promos: s.promos.filter((_, j) => j !== i) })} className="p-1 rounded hover:bg-[#fce8ea] text-[#9b9b93] hover:text-[#c7293a]" aria-label={`Retirer ${p.label}`}><X size={12} /></button>
          </div>
        ))}
        <button onClick={() => set({ promos: [...s.promos, { label: 'Promo', from: new Date().toISOString().slice(0, 10), to: new Date().toISOString().slice(0, 10) }] })}
          className="inline-flex items-center gap-1 text-[11px] font-medium text-[#6b6b63] hover:text-[#1a1a2e]"><Plus size={12} />Ajouter une période</button>
      </div>

      <div className="space-y-2">
        <p className="text-xs font-semibold text-[#1a1a2e]">Minimum de commande et colisage</p>
        <p className="text-[11px] text-[#9b9b93]">Facultatif. La quantité conseillée est arrondie au multiple supérieur et jamais sous le minimum.</p>
        <div className="max-h-56 overflow-y-auto border border-[#f0f0ee] rounded-xl">
          <table className="w-full text-xs">
            <thead className="bg-[#faf9f8] text-[10px] text-[#9b9b93] sticky top-0">
              <tr><th className="text-left font-semibold px-3 py-1.5">Produit</th><th className="font-semibold px-2">Minimum</th><th className="font-semibold px-2">Multiple</th></tr>
            </thead>
            <tbody>
              {products.map((p) => (
                <tr key={p.id} className="border-t border-[#f5f5f3]">
                  <td className="px-3 py-1 text-[#1a1a2e]">{p.title}</td>
                  <td className="px-2 py-1 text-center"><input type="number" min={0} value={s.products[p.id]?.moq ?? ''} onChange={(e) => rule(p.id, 'moq', e.target.value)} className={`${input} w-16 text-center`} aria-label={`Minimum ${p.title}`} /></td>
                  <td className="px-2 py-1 text-center"><input type="number" min={0} value={s.products[p.id]?.pack ?? ''} onChange={(e) => rule(p.id, 'pack', e.target.value)} className={`${input} w-16 text-center`} aria-label={`Multiple ${p.title}`} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="space-y-1">
        <p className="text-xs font-semibold text-[#1a1a2e]">Récap du lundi par e-mail</p>
        <input value={s.recipients.join(', ')} placeholder="adresse@exemple.com"
          onChange={(e) => set({ recipients: e.target.value.split(/[,;\s]+/).map((x) => x.trim()).filter(Boolean) })}
          className={`${input} w-full max-w-md`} aria-label="Destinataires du récap" />
        <p className="text-[11px] text-[#9b9b93]">Chaque lundi à 8 h : variantes à commander, arrivées de la semaine, ruptures en cours.</p>
      </div>
    </div>
  )
}
