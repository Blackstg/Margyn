// Jauge des jours de stock : stock physique (plein) et position avec les commandes
// en cours (clair), repère au seuil de commande.
import { GREEN, ORANGE, RED, int } from './format'

export default function StockGauge({ stockDays, positionDays, lead, trigger, target }: {
  stockDays: number | null; positionDays: number | null; lead: number; trigger: number; target: number
}) {
  if (stockDays == null || positionDays == null) return <span className="text-xs text-[#9b9b93]">pas de ventes</span>
  const max = target * 1.25
  const pct = (d: number) => `${Math.max(0, Math.min(100, (d / max) * 100))}%`
  const color = stockDays < lead ? RED : positionDays < trigger ? ORANGE : GREEN
  return (
    <div className="w-32" title={`Stock : ${int(stockDays)} j. Avec les commandes en cours : ${int(positionDays)} j. Seuil de commande : ${trigger} j.`}>
      <div className="relative h-2 rounded-full bg-[#f0f0ee] overflow-hidden">
        <div className="absolute inset-y-0 left-0 rounded-full opacity-30" style={{ width: pct(positionDays), background: color }} />
        <div className="absolute inset-y-0 left-0 rounded-full" style={{ width: pct(stockDays), background: color }} />
        <div className="absolute inset-y-[-2px] w-px bg-[#1a1a2e]/40" style={{ left: pct(trigger) }} />
      </div>
      <p className="text-[11px] font-semibold tabular-nums mt-1" style={{ color }}>
        {stockDays >= 999 ? '999+' : int(stockDays)} j
        {positionDays - stockDays >= 1 && <span className="font-normal text-[#9b9b93]"> · {positionDays >= 999 ? '999+' : int(positionDays)} j avec commandes</span>}
      </p>
    </div>
  )
}
