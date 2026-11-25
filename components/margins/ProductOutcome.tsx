'use client'

// Carte d'un produit vendu seul : où part le prix de vente (achat, envoi, pub, frais,
// ce qu'il reste), en barre empilée recharts. Le reste négatif dépasse à gauche.
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, ReferenceLine } from 'recharts'
import { Package } from 'lucide-react'
import type { AloneOutcome, ProductEconomics } from '@/lib/margins/packRules'
import VerdictBadge from './VerdictBadge'

const eur2 = (n: number) => new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR', minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n)

export const SEGMENTS = [
  { key: 'purchase', label: 'Achat',      color: '#c9cbe0' },
  { key: 'shipping', label: 'Envoi',      color: '#9fa3c7' },
  { key: 'pub',      label: 'Pub',        color: '#6f739f' },
  { key: 'fees',     label: 'Frais',      color: '#d9d6cf' },
] as const

function BarTip({ active, payload }: { active?: boolean; payload?: { name: string; value: number; color: string }[] }) {
  if (!active || !payload?.length) return null
  return (
    <div className="bg-white rounded-xl shadow-[0_4px_24px_rgba(0,0,0,0.1)] p-3 text-xs min-w-[150px]">
      {payload.map(p => (
        <div key={p.name} className="flex items-center justify-between gap-4">
          <span className="flex items-center gap-1.5 text-[#6b6b63]"><span className="w-2 h-2 rounded-full" style={{ background: p.color }} />{p.name}</span>
          <span className="font-semibold text-[#1a1a18] tabular-nums">{eur2(p.value)}</span>
        </div>
      ))}
    </div>
  )
}

export default function ProductOutcome({ p, o, estimateTip }: { p: ProductEconomics; o: AloneOutcome; estimateTip?: string }) {
  const leftColor = o.left >= 0 ? '#1a7f4b' : '#c7293a'
  const row = [{ name: p.title, purchase: o.purchase, shipping: o.shipping, pub: o.pub, fees: o.fees, left: o.left }]
  const costs = o.purchase + o.shipping + o.pub + o.fees
  const domain: [number, number] = [Math.min(0, o.left) * 1.05, Math.max(costs + Math.max(0, o.left), o.price) * 1.02]
  return (
    <div className="bg-white rounded-[16px] shadow-[0_2px_16px_rgba(0,0,0,0.06)] p-4 flex flex-col gap-2">
      <div className="flex items-center gap-3">
        {p.image
          ? <img src={p.image} alt="" className="w-10 h-10 rounded-lg object-cover bg-[#f5f5f3] shrink-0" />
          : <div className="w-10 h-10 rounded-lg bg-[#f5f5f3] shrink-0 flex items-center justify-center"><Package size={15} className="text-[#c0c0b8]" /></div>}
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-[#1a1a2e] truncate">{p.title}</p>
          <p className="text-[11px] text-[#9b9b93]">Vendu {eur2(p.price)} · {p.sold} vendus sur la période</p>
        </div>
        <div className="text-right shrink-0">
          <p className="text-xl font-bold tabular-nums leading-none" style={{ color: leftColor }}>{o.left >= 0 ? '+' : ''}{eur2(o.left)}</p>
          <div className="mt-1"><VerdictBadge verdict={o.verdict} /></div>
        </div>
      </div>
      <div className="h-7" title={estimateTip}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={row} layout="vertical" stackOffset="sign" margin={{ top: 0, right: 0, bottom: 0, left: 0 }} barCategoryGap={0}>
            <XAxis type="number" hide domain={domain} />
            <YAxis type="category" dataKey="name" hide />
            <Tooltip content={<BarTip />} cursor={false} />
            <ReferenceLine x={0} stroke="#1a1a2e" strokeWidth={1} />
            {SEGMENTS.map(s => <Bar key={s.key} dataKey={s.key} name={s.label} stackId="a" fill={s.color} isAnimationActive={false} />)}
            <Bar dataKey="left" name="Ce qu’il reste" stackId="a" fill={leftColor} radius={o.left >= 0 ? [0, 6, 6, 0] : [6, 0, 0, 6]} isAnimationActive={false} />
          </BarChart>
        </ResponsiveContainer>
      </div>
      <p className="text-[11px] text-[#6b6b63]">
        Avec le port payé par la cliente : <span className="font-semibold tabular-nums" style={{ color: o.leftWithPort >= 0 ? '#1a7f4b' : '#c7293a' }}>{o.leftWithPort >= 0 ? '+' : ''}{eur2(o.leftWithPort)}</span>
      </p>
    </div>
  )
}
