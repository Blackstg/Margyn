'use client'

import { useId, useState } from 'react'
import { Card } from './Card'

// Le minimum d'un mois Pilote (/api/pilot) dont la vue a besoin
export type ProductLine = {
  key: string; label: string; qty: number
  ttc: number; ht: number; shippingHT: number; cogs: number; missingQty: number
  fees: number; delivery: number; deliveryEstimated: number; ads: number; fixed: number
  contribution: number; result: number
}
export type PanelMonth = {
  month: string; result: number
  revenue: { netHT: number }
  costs: { products: number; delivery: number; transport: number; ads: number; fees: number; team: number; apps: number; infra: number }
  panels: { sold: number; avgPriceTTC: number | null; avgCost: number | null }
  products?: ProductLine[]
}

const monthLabel = (m: string) => new Date(`${m}-15T12:00:00Z`).toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' })
const e2 = (v: number) => new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR', minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(v)
const eur0 = (v: number) => new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }).format(v)

// ─── Un panneau, couche par couche ───────────────────────────────────────────
// Ce qu'encaisse un panneau (TTC) découpé en couches qui s'additionnent exactement :
// TVA + coûts + bénéfice (ou perte, dessinée sous le panneau).
type Layer = { key: string; label: string; color: string; hint: string; v: number }
const COLORS = {
  vat: '#a8a29e', products: '#b07a45', delivery: '#3b78b8', ads: '#8b5cf6',
  fees: '#64748b', team: '#0f8a7e', overhead: '#c08a1e', profit: '#1f9d6b',
}

function PanelLayers({ ttc, layers, result, unit }: { ttc: number; layers: Layer[]; result: number; unit: string }) {
  const uid = useId().replace(/:/g, '')   // ids SVG uniques (clip / motif)
  const shown = layers.filter(l => l.v > 0.005)
  const all = result >= 0 ? [...shown, { key: 'profit', label: 'Bénéfice', color: COLORS.profit, hint: 'ce qui reste', v: result }] : shown

  // Géométrie : le cadre du panneau = prix TTC ; une perte dépasse sous le cadre
  const H = 380, W = 150, X = 16, Y = 10, GAP = 2
  const total = ttc + Math.max(0, -result)
  const scale = total > 0 ? H / total : 0
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
    if (key === 'loss') return { title: 'Perte', amount: e2(result), pct: pctOf(result), hint: `il manque, par ${unit}`, color: '#c7293a' }
    const l = all.find(x => x.key === key)!
    return { title: l.label, amount: e2(l.v), pct: pctOf(l.v), hint: l.hint, color: '#1a1a2e' }
  }

  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
      <div className="overflow-x-auto">
        <svg viewBox={`0 0 500 ${svgH}`} className="w-full max-w-[520px]" role="img" aria-label={`Répartition de ${e2(ttc)} TTC par ${unit}`}>
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
            <rect x={X} y={Y + frameH + 3} width={W} height={Math.max(0, lossH - 3)} rx="4" fill={`url(#hatch${uid})`} stroke="#c7293a" strokeDasharray="4 3" />
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
        <table className="w-full text-sm">
          <tbody>
            {all.map(l => (
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
      </div>
    </div>
  )
}

// Couches d'un produit (famille + taille), ramenées à une unité vendue
function productLayers(p: ProductLine) {
  const per = (v: number) => v / p.qty
  const ttc = per(p.ttc + p.shippingHT * 1.2)
  const layers: Layer[] = [
    { key: 'vat',      label: 'TVA',               color: COLORS.vat,      hint: "reversée à l'État", v: per(p.ttc + p.shippingHT * 1.2 - p.ht - p.shippingHT) },
    { key: 'products', label: 'Achat',             color: COLORS.products, hint: p.missingQty ? "coût d'achat (incomplet dans Shopify)" : "coût d'achat", v: per(p.cogs) },
    { key: 'delivery', label: 'Livraison',         color: COLORS.delivery, hint: 'sa part des livraisons de ses commandes', v: per(p.delivery) },
    { key: 'ads',      label: 'Pub',               color: COLORS.ads,      hint: 'au prorata du CA', v: per(p.ads) },
    { key: 'fees',     label: 'Frais de paiement', color: COLORS.fees,     hint: 'Shopify Payments, PayPal', v: per(p.fees) },
    { key: 'fixed',    label: 'Salaires et charges', color: COLORS.team,   hint: 'au prorata du CA', v: per(p.fixed) },
  ]
  return { ttc, layers, result: per(p.result) }
}

export default function PanelBreakdown({ m, defaultTab = 'avg' }: { m: PanelMonth; defaultTab?: string }) {
  const [tab, setTab] = useState<string>(defaultTab)
  const n = m.panels?.sold ?? 0
  const products = (m.products ?? []).filter(p => p.qty > 0)
    .sort((a, b) => (a.key === 'accessoires' ? 1 : 0) - (b.key === 'accessoires' ? 1 : 0) || b.qty - a.qty)
  if (n === 0 && products.length === 0) return null
  const current = products.find(p => p.key === tab) ?? null
  const isAcc = current?.key === 'accessoires'

  let body: React.ReactNode
  if (!current) {
    // Moyenne : tout le mois ÷ panneaux vendus
    const c = m.costs
    const per = (v: number) => v / n
    const ttc = per(m.revenue.netHT * 1.2)
    const layers: Layer[] = [
      { key: 'vat',      label: 'TVA',                     color: COLORS.vat,      hint: "reversée à l'État", v: per(m.revenue.netHT * 0.2) },
      { key: 'products', label: 'Produits',                color: COLORS.products, hint: "coût d'achat (panneau, colle, accessoires)", v: per(c.products) },
      { key: 'delivery', label: 'Livraison',               color: COLORS.delivery, hint: 'Terence + transport interne', v: per(c.delivery + c.transport) },
      { key: 'ads',      label: 'Pub',                     color: COLORS.ads,      hint: 'Meta, Google, Pinterest…', v: per(c.ads) },
      { key: 'fees',     label: 'Frais de paiement',       color: COLORS.fees,     hint: 'Shopify Payments, PayPal', v: per(c.fees) },
      { key: 'team',     label: 'Salaires',                color: COLORS.team,     hint: 'équipe', v: per(c.team) },
      { key: 'overhead', label: 'Crédits, compta, applis', color: COLORS.overhead, hint: 'charges fixes', v: per(c.infra + c.apps) },
    ]
    const extra = m.panels.avgPriceTTC != null ? ttc - m.panels.avgPriceTTC : null
    body = (
      <>
        <Headline label="Encaissé en moyenne par panneau vendu" ttc={ttc}
          sub={extra != null && m.panels.avgPriceTTC != null ? `dont le panneau lui-même ${e2(m.panels.avgPriceTTC)} et ${e2(extra)} de colle, accessoires, port et autres ventes ramenés au panneau` : undefined} />
        <PanelLayers ttc={ttc} layers={layers} result={per(m.result)} unit="panneau" />
        <p className="mt-3 text-[11px] leading-relaxed text-[#9b9b93]">
          Tout l&apos;argent du mois ramené à un panneau : CA et coûts de {monthLabel(m.month)} ÷ {n.toLocaleString('fr-FR')} panneaux vendus
          (commandes passées ce mois, hors remboursés). Les % sont des parts du prix TTC (le reste de la page raisonne en % du CA HT).
        </p>
      </>
    )
  } else {
    const { ttc, layers, result } = productLayers(current)
    const unitPrice = current.ttc / current.qty
    const ship = current.shippingHT * 1.2 / current.qty
    body = (
      <>
        <Headline label={`${current.label} · prix moyen vendu (remises déduites)`} ttc={unitPrice}
          sub={`${current.qty.toLocaleString('fr-FR')} vendu${current.qty > 1 ? 's' : ''} en ${monthLabel(m.month)}${ship > 0.005 ? ` · + ${e2(ship)} de port payé par le client, par unité` : ''}`} />
        {current.missingQty > 0 && (
          <p className="mb-3 rounded-lg bg-[#fff6e5] px-3 py-2 text-xs text-[#8a5a00]">
            ⚠ {current.missingQty} unité{current.missingQty > 1 ? 's' : ''} sans coût d&apos;achat dans Shopify : l&apos;achat est sous-estimé et la marge surestimée.
          </p>
        )}
        <PanelLayers ttc={ttc} layers={layers} result={result} unit={isAcc ? 'article' : 'unité'} />
        <p className="mt-3 text-[11px] leading-relaxed text-[#9b9b93]">
          {isAcc
            ? 'Accessoires livrés avec les panneaux : aucune livraison ne leur est imputée (elle est portée par les panneaux de la commande).'
            : 'Livraison : le coût réel de chaque commande (Terence, ou estimé si pas encore livrée) est réparti sur ses panneaux selon la place dans le camion (Extpanel : 4 par place, Akupanel 60 : 2 par place, feuille de pierre : 1), plus une part du transport interne du mois.'}
          {' '}Pub et salaires / charges : au prorata du CA de ce produit. Les % sont des parts du TTC encaissé par unité (prix + port).
        </p>
      </>
    )
  }

  return (
    <Card title={`Un panneau, couche par couche · ${monthLabel(m.month)}`}>
      <div className="mb-4 flex flex-wrap gap-1 rounded-xl border border-[#e8e8e4] bg-[#f7f7f5] p-1">
        {[{ key: 'avg', label: 'Moyenne' }, ...products.map(p => ({ key: p.key, label: p.key === 'accessoires' ? 'Accessoires' : p.label }))].map(t => (
          <button key={t.key} onClick={() => setTab(t.key)}
            className={`rounded-lg px-3 py-1.5 text-sm ${(current?.key ?? 'avg') === t.key ? 'bg-[#1a1a2e] text-white' : 'text-[#6b6b63] hover:bg-white'}`}>
            {t.label}
          </button>
        ))}
      </div>

      {body}

      {products.length > 0 && (
        <div className="mt-6">
          <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.1em] text-[#6b6b63]">Marge par produit · {monthLabel(m.month)}</p>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-right text-[11px] text-[#9b9b93]">
                  <th className="py-2 pr-3 text-left font-semibold">Produit</th>
                  <th className="px-2 py-2 font-semibold">Vendus</th>
                  <th className="px-2 py-2 font-semibold">Prix moyen TTC</th>
                  <th className="px-2 py-2 font-semibold">Achat</th>
                  <th className="px-2 py-2 font-semibold">Livraison</th>
                  <th className="px-2 py-2 font-semibold" title="Prix HT + port − achat − livraison − frais de paiement">Marge avant pub</th>
                  <th className="px-2 py-2 font-semibold">Pub + charges</th>
                  <th className="px-2 py-2 font-semibold">Marge nette / u</th>
                  <th className="px-2 py-2 font-semibold">Marge nette du mois</th>
                </tr>
              </thead>
              <tbody>
                {products.map(p => {
                  const u = (v: number) => v / p.qty
                  return (
                    <tr key={p.key} onClick={() => setTab(p.key)}
                      className={`cursor-pointer border-t border-[#f3f3f1] text-right tabular-nums hover:bg-[#f7f7f5] ${tab === p.key ? 'bg-[#f7f7f5]' : ''}`}>
                      <td className="py-1.5 pr-3 text-left text-[#1a1a2e]">{p.label}{p.missingQty > 0 && <span className="ml-1 text-[#b45309]" title="Coût d'achat manquant dans Shopify">⚠</span>}</td>
                      <td className="px-2 py-1.5">{p.qty.toLocaleString('fr-FR')}</td>
                      <td className="px-2 py-1.5">{e2(u(p.ttc))}</td>
                      <td className="px-2 py-1.5 text-[#6b6b63]">{e2(u(p.cogs))}</td>
                      <td className="px-2 py-1.5 text-[#6b6b63]">{e2(u(p.delivery))}</td>
                      <td className={`px-2 py-1.5 ${p.contribution < 0 ? 'text-[#c7293a]' : 'text-[#1a1a2e]'}`}>{e2(u(p.contribution))}</td>
                      <td className="px-2 py-1.5 text-[#6b6b63]">{e2(u(p.ads + p.fixed))}</td>
                      <td className={`px-2 py-1.5 font-semibold ${p.result < 0 ? 'text-[#c7293a]' : 'text-[#1f7a5a]'}`}>{e2(u(p.result))}</td>
                      <td className={`px-2 py-1.5 font-semibold ${p.result < 0 ? 'text-[#c7293a]' : 'text-[#1f7a5a]'}`}>{eur0(p.result)}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          <p className="mt-2 text-[11px] text-[#9b9b93]">
            Montants HT par unité, sauf le prix TTC. « Marge avant pub » = ce que le produit rapporte une fois payé et livré. Clique une ligne pour voir son panneau.
            Le total peut différer du résultat du mois : échantillons, cadeaux et ventes privées ne sont rattachés à aucun produit.
          </p>
        </div>
      )}
    </Card>
  )
}

function Headline({ label, ttc, sub }: { label: string; ttc: number; sub?: string }) {
  return (
    <div className="mb-4 rounded-xl bg-[#f7f7f5] px-4 py-3">
      <p className="text-[11px] text-[#9b9b93]">{label}</p>
      <p className="text-2xl font-bold tabular-nums text-[#1a1a2e]">{e2(ttc)} <span className="text-sm font-medium text-[#6b6b63]">TTC</span></p>
      {sub && <p className="mt-0.5 text-xs text-[#6b6b63]">{sub}</p>}
    </div>
  )
}
