'use client'

// Carte d'un produit vendu seul : où part le prix de vente (achat, envoi, pub, frais,
// ce qu'il reste), en barre empilée recharts. Le reste négatif dépasse à gauche.
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, ReferenceLine, LabelList } from 'recharts'
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

// Montant écrit dans le segment quand il y a la place (sinon : au survol).
function SegLabel(props: { x?: number | string; y?: number | string; width?: number | string; height?: number | string; value?: number | string; fill?: string }) {
  const x = Number(props.x ?? 0), y = Number(props.y ?? 0), w = Number(props.width ?? 0), h = Number(props.height ?? 0), v = Number(props.value ?? 0)
  if (Math.abs(w) < 38 || !v) return null
  return (
    <text x={x + w / 2} y={y + h / 2} textAnchor="middle" dominantBaseline="central" fontSize={10} fontWeight={600} fill={props.fill ?? '#1a1a2e'}>
      {Math.round(v).toLocaleString('fr-FR')} €
    </text>
  )
}

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
  // Rarement vendu seul : en gris, sans verdict (pas assez de commandes pour conclure).
  const leftColor = o.rare ? '#9b9b93' : o.left >= 0 ? '#1a7f4b' : '#c7293a'
  const signed = (n: number) => `${n >= 0 ? '+' : ''}${eur2(n)}`
  const row = [{ name: p.title, purchase: o.purchase, shipping: o.shipping, pub: o.pub, fees: o.fees, left: o.left }]
  const costs = o.purchase + o.shipping + o.pub + o.fees
  const domain: [number, number] = [Math.min(0, o.left) * 1.05, Math.max(costs + Math.max(0, o.left), o.price) * 1.02]
  return (
    <div className={`bg-white rounded-[16px] shadow-[0_2px_16px_rgba(0,0,0,0.06)] p-4 flex flex-col gap-2 ${o.rare ? 'opacity-60' : ''}`}>
      <div className="flex items-center gap-3">
        {p.image
          ? <img src={p.image} alt="" className="w-10 h-10 rounded-lg object-cover bg-[#f5f5f3] shrink-0" />
          : <div className="w-10 h-10 rounded-lg bg-[#f5f5f3] shrink-0 flex items-center justify-center"><Package size={15} className="text-[#c0c0b8]" /></div>}
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-[#1a1a2e] truncate">{p.title}</p>
          <p className="text-[11px] text-[#9b9b93]">Vendu {eur2(p.price)} · {p.soloOrders} commande{p.soloOrders > 1 ? 's' : ''} où il est seul</p>
        </div>
        <div className="text-right shrink-0">
          <p className="text-xl font-bold tabular-nums leading-none" style={{ color: leftColor }}>{signed(o.left)}</p>
          <p className="text-[10px] text-[#9b9b93] mt-0.5">par commande</p>
          {!o.rare && <div className="mt-1"><VerdictBadge verdict={o.verdict} /></div>}
        </div>
      </div>
      <div className="h-8" title={estimateTip}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={row} layout="vertical" stackOffset="sign" margin={{ top: 0, right: 0, bottom: 0, left: 0 }} barCategoryGap={0}>
            <XAxis type="number" hide domain={domain} />
            <YAxis type="category" dataKey="name" hide />
            <Tooltip content={<BarTip />} cursor={false} />
            <ReferenceLine x={0} stroke="#1a1a2e" strokeWidth={1} />
            {SEGMENTS.map(s => (
              <Bar key={s.key} dataKey={s.key} name={s.label} stackId="a" fill={s.color} isAnimationActive={false}>
                <LabelList dataKey={s.key} content={<SegLabel fill={s.key === 'pub' ? '#ffffff' : '#1a1a2e'} />} />
              </Bar>
            ))}
            <Bar dataKey="left" name="Ce qu’il reste" stackId="a" fill={leftColor} radius={o.left >= 0 ? [0, 6, 6, 0] : [6, 0, 0, 6]} isAnimationActive={false}>
              <LabelList dataKey="left" content={<SegLabel fill="#ffffff" />} />
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
      <div className="flex items-center justify-between gap-2 flex-wrap text-[11px] text-[#6b6b63]">
        <span>
          Avec le port payé par la cliente : <span className="font-semibold tabular-nums" style={{ color: o.rare ? undefined : o.leftWithPort >= 0 ? '#1a7f4b' : '#c7293a' }}>{signed(o.leftWithPort)}</span>
        </span>
        <span title={`${p.soloOrders} commandes où il est seul × ${eur2(o.left)}`}>
          Impact sur la période : <span className="font-semibold tabular-nums" style={{ color: leftColor }}>{signed(o.impact)}</span>
        </span>
      </div>
    </div>
  )
}
