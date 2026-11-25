// Colis types en cartes : coût d'envoi estimé, réel constaté sur les commandes
// identiques déjà facturées, et indicateur d'écart (ok sous 1 €).
import { CheckCircle2, Eye } from 'lucide-react'

export type TypicalBasket = { label: string; predicted: number; real: number | null; realOrders: number; frequent?: number }

const eur2 = (n: number) => new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR', minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n)

export default function TypicalBasketCards({ items }: { items: TypicalBasket[] }) {
  return (
    <div className="grid gap-3 grid-cols-1 sm:grid-cols-2 xl:grid-cols-4">
      {items.map(t => {
        const gap = t.real != null ? t.predicted - t.real : null
        const ok = gap != null && Math.abs(gap) < 1
        return (
          <div key={t.label} className="bg-white rounded-[16px] shadow-[0_2px_16px_rgba(0,0,0,0.06)] p-4">
            <p className="text-xs font-semibold text-[#1a1a2e] leading-snug min-h-[2.5em]">{t.label}</p>
            {t.frequent != null && <p className="text-[10px] text-[#9b9b93] -mt-1">{t.frequent} commandes sur la période</p>}
            <p className="text-xl font-bold tabular-nums text-[#1a1a2e] mt-2">{eur2(t.predicted)}</p>
            <p className="text-[11px] text-[#9b9b93]">coût d&apos;envoi estimé</p>
            <div className="mt-2 pt-2 border-t border-[#f0f0ee] text-[11px] flex items-center justify-between gap-2">
              {t.real != null ? (
                <>
                  <span className="text-[#6b6b63]">Réel : <b className="tabular-nums">{eur2(t.real)}</b> <span className="text-[#9b9b93]">({t.realOrders} cmd)</span></span>
                  {ok
                    ? <span className="inline-flex items-center gap-1 text-[#1a7f4b] font-semibold"><CheckCircle2 size={11} /> ok</span>
                    : <span className="inline-flex items-center gap-1 text-[#b45309] font-semibold" title={`Écart de ${eur2(Math.abs(gap!))}`}><Eye size={11} /> à surveiller</span>}
                </>
              ) : <span className="text-[#9b9b93]">Pas encore de commande identique facturée</span>}
            </div>
          </div>
        )
      })}
    </div>
  )
}
