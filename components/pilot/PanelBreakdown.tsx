'use client'

import { useId } from 'react'
import { Card } from './Card'

// Le minimum d'un mois Pilote (/api/pilot) dont la vue a besoin
export type PanelMonth = {
  month: string; result: number
  revenue: { netHT: number }
  costs: { products: number; delivery: number; transport: number; ads: number; fees: number; team: number; apps: number; infra: number }
  panels: { sold: number; avgPriceTTC: number | null; avgCost: number | null }
}

const monthLabel = (m: string) => new Date(`${m}-15T12:00:00Z`).toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' })

// ─── Un panneau, couche par couche ───────────────────────────────────────────
// Tout l'argent du mois ramené à UN panneau vendu : CA TTC ÷ panneaux, puis chaque
// coût ÷ panneaux. Les couches s'additionnent exactement au prix TTC moyen encaissé.
const LAYERS: { key: string; label: string; color: string; hint: string }[] = [
  { key: 'vat',      label: 'TVA',                     color: '#a8a29e', hint: "reversée à l'État" },
  { key: 'products', label: 'Produits',                color: '#b07a45', hint: "coût d'achat (panneau, colle, accessoires)" },
  { key: 'delivery', label: 'Livraison',               color: '#3b78b8', hint: 'Terence + transport interne' },
  { key: 'ads',      label: 'Pub',                     color: '#8b5cf6', hint: 'Meta, Google, Pinterest…' },
  { key: 'fees',     label: 'Frais de paiement',       color: '#64748b', hint: 'Shopify Payments, PayPal' },
  { key: 'team',     label: 'Salaires',                color: '#0f8a7e', hint: 'équipe' },
  { key: 'overhead', label: 'Crédits, compta, applis', color: '#c08a1e', hint: 'charges fixes' },
]

export default function PanelBreakdown({ m }: { m: PanelMonth }) {
  const uid = useId().replace(/:/g, '')   // ids SVG uniques (clip / motif)
  const n = m.panels?.sold ?? 0
  if (n === 0) return null
  const c = m.costs
  const per = (v: number) => v / n
  const ttc = per(m.revenue.netHT * 1.2)
  const values: Record<string, number> = {
    vat: per(m.revenue.netHT * 0.2),
    products: per(c.products),
    delivery: per(c.delivery + c.transport),
    ads: per(c.ads),
    fees: per(c.fees),
    team: per(c.team),
    overhead: per(c.infra + c.apps),
  }
  const result = per(m.result)
  const layers = LAYERS.map(l => ({ ...l, v: values[l.key] })).filter(l => l.v > 0.005)
  const all = result >= 0 ? [...layers, { key: 'profit', label: 'Bénéfice', color: '#1f9d6b', hint: 'ce qui reste', v: result }] : layers
  const extra = m.panels.avgPriceTTC != null ? ttc - m.panels.avgPriceTTC : null
  const e2 = (v: number) => new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR', minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(v)

  // Géométrie : le cadre du panneau = prix TTC ; une perte dépasse sous le cadre
  const H = 380, W = 150, X = 16, Y = 10, GAP = 2
  const total = ttc + Math.max(0, -result)
  const scale = H / total
  const frameH = ttc * scale
  let y = Y
  const bands = all.map(l => { const h = l.v * scale; const b = { ...l, y, h }; y += h; return b })
  const lossH = result < 0 ? -result * scale : 0
  // Étiquettes : au milieu de chaque couche, poussées vers le bas si elles se chevauchent
  const LH = 29
  const labels: { key: string; y: number; mid: number }[] = []
  for (const b of [...bands, ...(lossH ? [{ key: 'loss', y: Y + frameH, h: lossH }] : [])]) {
    const mid = b.y + b.h / 2
    const prev = labels[labels.length - 1]
    labels.push({ key: b.key, mid, y: Math.max(mid, prev ? prev.y + LH : mid) })
  }
  const svgH = Math.max(Y + frameH + lossH + 10, (labels[labels.length - 1]?.y ?? 0) + 22)
  const slats = 9, slatW = (W - 8) / slats
  const pctOf = (v: number) => `${(Math.round(v / ttc * 1000) / 10).toLocaleString('fr-FR')} %`
  const labelFor = (key: string) => {
    if (key === 'loss') return { title: 'Perte', amount: e2(result), pct: pctOf(result), hint: 'il manque, par panneau', color: '#c7293a' }
    const l = all.find(x => x.key === key)!
    return { title: l.label, amount: e2(l.v), pct: pctOf(l.v), hint: l.hint, color: '#1a1a2e' }
  }

  return (
    <Card title={`Un panneau, couche par couche · ${monthLabel(m.month)}`}>
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <div className="overflow-x-auto">
          <svg viewBox={`0 0 500 ${svgH}`} className="w-full max-w-[520px]" role="img" aria-label={`Répartition de ${e2(ttc)} TTC par panneau`}>
            <defs>
              <pattern id={`hatch${uid}`} width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
                <rect width="6" height="6" fill="#fdecee" /><line x1="0" y1="0" x2="0" y2="6" stroke="#c7293a" strokeWidth="2" />
              </pattern>
              <clipPath id={`slats${uid}`}>
                {Array.from({ length: slats }).map((_, i) => (
                  <rect key={i} x={X + 4 + i * slatW + 1.5} y={Y} width={slatW - 3} height={frameH} rx="1.5" />
                ))}
              </clipPath>
            </defs>
            {/* Feutre de fond + cadre */}
            <rect x={X} y={Y} width={W} height={frameH} rx="6" fill="#2b2b2b" />
            {/* Couches, visibles sur les lattes */}
            <g clipPath={`url(#slats${uid})`}>
              {bands.map(b => <rect key={b.key} x={X} y={b.y} width={W} height={Math.max(0, b.h - (b.h > 4 ? GAP : 0))} fill={b.color} />)}
            </g>
            {/* Veinage léger */}
            {Array.from({ length: slats }).map((_, i) => (
              <line key={i} x1={X + 4 + i * slatW + slatW / 2} y1={Y + 4} x2={X + 4 + i * slatW + slatW / 2} y2={Y + frameH - 4} stroke="rgba(255,255,255,0.12)" strokeWidth="1" />
            ))}
            {lossH > 0 && (
              <rect x={X} y={Y + frameH + 3} width={W} height={lossH - 3} rx="4" fill={`url(#hatch${uid})`} stroke="#c7293a" strokeDasharray="4 3" />
            )}
            {/* Étiquettes directes */}
            {labels.map(l => {
              const t = labelFor(l.key)
              return (
                <g key={l.key}>
                  <polyline points={`${X + W + 4},${l.mid} ${X + W + 18},${l.mid} ${X + W + 30},${l.y}`} fill="none" stroke="#c9c9c2" strokeWidth="1" />
                  <text x={X + W + 36} y={l.y - 2} fontSize="12.5" fontWeight="600" fill={t.color}>{t.title} <tspan fontWeight="700">{t.amount}</tspan> <tspan fill="#6b6b63" fontWeight="500">· {t.pct}</tspan></text>
                  <text x={X + W + 36} y={l.y + 12} fontSize="10.5" fill="#9b9b93">{t.hint}</text>
                </g>
              )
            })}
          </svg>
        </div>
        <div className="space-y-3 text-sm">
          <div className="rounded-xl bg-[#f7f7f5] px-4 py-3">
            <p className="text-[11px] text-[#9b9b93]">Encaissé en moyenne par panneau vendu</p>
            <p className="text-2xl font-bold tabular-nums text-[#1a1a2e]">{e2(ttc)} <span className="text-sm font-medium text-[#6b6b63]">TTC</span></p>
            {extra != null && m.panels.avgPriceTTC != null && (
              <p className="mt-0.5 text-xs text-[#6b6b63]">
                dont le panneau lui-même {e2(m.panels.avgPriceTTC)} et {e2(extra)} de colle, accessoires, port et autres ventes ramenés au panneau
              </p>
            )}
            {extra != null && (
              <p className="mt-1 text-[11px] text-[#9b9b93]">Les % ci-dessous sont des parts de ce prix TTC (le reste de la page raisonne en % du CA HT).</p>
            )}
          </div>
          <table className="w-full text-sm">
            <tbody>
              {[...all.filter(l => l.key !== 'profit'), ...(result >= 0 ? [all.find(l => l.key === 'profit')!] : [])].map(l => (
                <tr key={l.key} className="border-t border-[#f3f3f1]">
                  <td className="py-1.5 pr-2"><span className="mr-2 inline-block h-2.5 w-2.5 rounded-sm align-middle" style={{ background: l.color }} />{l.label}</td>
                  <td className="py-1.5 text-right font-semibold tabular-nums">{e2(l.v)}</td>
                  <td className="w-16 py-1.5 text-right tabular-nums text-[#6b6b63]">{pctOf(l.v)}</td>
                </tr>
              ))}
              {result < 0 && (
                <tr className="border-t border-[#f3f3f1]">
                  <td className="py-1.5 pr-2 font-semibold text-[#c7293a]"><span className="mr-2 inline-block h-2.5 w-2.5 rounded-sm border border-[#c7293a] align-middle" style={{ background: 'repeating-linear-gradient(45deg,#c7293a 0 2px,#fdecee 2px 5px)' }} />Perte</td>
                  <td className="py-1.5 text-right font-bold tabular-nums text-[#c7293a]">{e2(result)}</td>
                  <td className="w-16 py-1.5 text-right tabular-nums text-[#c7293a]">{pctOf(result)}</td>
                </tr>
              )}
            </tbody>
          </table>
          <p className="text-[11px] leading-relaxed text-[#9b9b93]">
            Tout l&apos;argent du mois ramené à un panneau : CA et coûts de {monthLabel(m.month)} ÷ {n.toLocaleString('fr-FR')} panneaux vendus
            (commandes passées ce mois, hors remboursés). Les accessoires, feuilles de pierre et le port sont inclus, comme s&apos;ils accompagnaient les panneaux.
            {m.panels.avgCost != null && ` Coût d'achat moyen d'un panneau seul : ${e2(m.panels.avgCost)}.`}
          </p>
        </div>
      </div>
    </Card>
  )
}
