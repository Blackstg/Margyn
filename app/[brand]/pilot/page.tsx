'use client'

export const dynamic = 'force-dynamic'

// Pilote — rentabilité mensuelle « par commandes du mois » et leviers d'optimisation.
// Données : /api/pilot (Shopify direct + Terence réel/estimé + pub + charges).
import { useEffect, useMemo, useState } from 'react'
import { Compass, Loader2, AlertCircle, AlertTriangle, Info } from 'lucide-react'
import { useBrand } from '@/context/BrandContext'

type Row = { label: string; amount: number }
type Bucket = { key: string; label: string; orders: number; revenueHT: number; shippingHT: number; cogs: number; delivery: number; estimated: number; fees: number; contribution: number }
type Month = {
  month: string; partial: boolean; elapsedRatio: number
  counts: { orders: number; paid: number; truck: number; samples: number; postal: number; gifts: number; cancelled: number; refunded: number; undelivered: number; internal: number }
  revenue: { productsHT: number; shippingHT: number; refundsHT: number; suppHT: number; netHT: number }
  costs: { products: number; delivery: number; deliveryEstimated: number; transport: number; ads: number; fees: number; team: number; apps: number; infra: number }
  detail: { ads: Record<string, number>; team: Row[]; apps: Row[]; infra: Row[]; transport: Row[]; giftCogs: number }
  result: number; contributionBeforeAds: number; terenceInvoice: number; missingCost: number
  kpis: { avgBasketHT: number | null; cac: number | null; mer: number | null; deliveryPerOrder: number | null }
  buckets: Bucket[]
}
type Data = { today: string; subcontractStart: string; avgTerenceByBucket: (number | null)[]; missingCostProducts: { title: string; qty: number }[]; months: Month[] }

// Repères (% du CA HT net) — ordres de grandeur pour un e-commerce rentable de produits
// encombrants livrés. À ajuster selon vos objectifs.
const TARGETS = { products: 30, delivery: 15, ads: 20, fees: 2 }

const eur = (n: number | null | undefined) => n == null ? '—' : new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }).format(n)
const pct = (n: number, d: number) => d > 0 ? Math.round((n / d) * 1000) / 10 : 0
const monthLabel = (m: string) => new Date(`${m}-15T12:00:00Z`).toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' })
const monthShort = (m: string) => new Date(`${m}-15T12:00:00Z`).toLocaleDateString('fr-FR', { month: 'short' })
const PLATFORM: Record<string, string> = { meta: 'Meta', google: 'Google', pinterest: 'Pinterest', tiktok: 'TikTok' }

export default function PilotPage() {
  const brand = useBrand()
  const [data, setData] = useState<Data | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [sel, setSel] = useState<string | null>(null)

  useEffect(() => {
    setData(null); setError(null)
    fetch(`/api/pilot?brand=${brand}&months=6`)
      .then(r => r.json())
      .then((d: Data & { error?: string }) => {
        if (d.error) { setError(d.error); return }
        setData(d)
        setSel(d.months[d.months.length - 1]?.month ?? null)
      })
      .catch(e => setError(String(e)))
  }, [brand])

  const m = useMemo(() => data?.months.find(x => x.month === sel) ?? null, [data, sel])

  if (error) return (
    <div className="p-8"><div className="flex items-center gap-2 rounded-xl border border-red-100 bg-red-50 px-4 py-3 text-sm text-red-700"><AlertCircle size={15} />{error}</div></div>
  )
  if (!data || !m) return <div className="flex items-center justify-center py-32"><Loader2 size={24} className="animate-spin text-[#9b9b93]" /></div>

  const ca = m.revenue.netHT
  const c = m.costs
  const deliveryAll = c.delivery + c.transport
  const fixedAll = c.team + c.apps + c.infra
  // Taux de marge variable (avant pub et charges fixes) → CA nécessaire pour couvrir pub + fixes
  const variableRate = ca > 0 ? (c.products + deliveryAll + c.fees) / ca : 0
  const breakEvenCA = variableRate < 1 ? (c.ads + fixedAll) / (1 - variableRate) : null

  // Leviers : écart au repère, en € par mois
  const levers = [
    { key: 'delivery', label: 'Livraison (Terence + transport interne)', value: deliveryAll, target: TARGETS.delivery,
      hint: 'Faire payer la livraison des petites commandes, arrêter les coûts fixes du transport interne (dépôt, leasing) si tout passe chez Terence, regrouper les livraisons.' },
    { key: 'ads', label: 'Publicité', value: c.ads, target: TARGETS.ads,
      hint: `Chaque commande panneaux coûte ${eur(m.kpis.cac)} de pub. Couper les campagnes qui ramènent surtout des échantillons ou des petites commandes.` },
    { key: 'products', label: "Coût d'achat produits", value: c.products, target: TARGETS.products,
      hint: 'Renégocier les achats, ou augmenter les prix de vente.' },
    { key: 'fees', label: 'Frais de paiement', value: c.fees, target: TARGETS.fees, hint: 'Commission Shopify Payments / PayPal.' },
  ].map(l => ({ ...l, share: pct(l.value, ca), gap: Math.max(0, Math.round(l.value - ca * l.target / 100)) }))
    .sort((a, b) => b.gap - a.gap)

  const small = m.buckets.find(b => b.key === '1-3')
  const smallLoss = small ? Math.max(0, small.delivery - small.shippingHT) : 0

  // Répartition de 100 € de CA
  const split = [
    { label: 'Produits', v: c.products, target: TARGETS.products },
    { label: 'Livraison Terence', v: c.delivery, target: c.transport > 0 ? undefined : TARGETS.delivery },
    { label: 'Transport interne', v: c.transport, target: c.delivery > 0 ? undefined : TARGETS.delivery },
    { label: 'Pub', v: c.ads, target: TARGETS.ads },
    { label: 'Salaires', v: c.team },
    { label: 'Crédits, compta, applis', v: c.infra + c.apps },
    { label: 'Frais de paiement', v: c.fees, target: TARGETS.fees },
  ]
  const maxShare = Math.max(40, ...split.map(s => pct(s.v, ca)))

  const alerts: { tone: 'warn' | 'info'; text: string }[] = []
  if (m.partial) alerts.push({ tone: 'info', text: `Mois en cours : commandes jusqu'au ${new Date(data.today).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long' })}, salaires et charges comptés au prorata (${Math.round(m.elapsedRatio * 100)} % du mois).` })
  if (m.month >= data.subcontractStart.slice(0, 7) && c.transport === 0)
    alerts.push({ tone: 'warn', text: `Transport interne de ${monthLabel(m.month)} non saisi (dépôt, leasing, carburant, tournées Moha/Noah…) : le résultat est trop optimiste. ${m.counts.internal} commande(s) de ce mois ont été livrées en interne.` })
  if (c.deliveryEstimated > 0)
    alerts.push({ tone: 'info', text: `${m.counts.undelivered} commande(s) pas encore livrées : leur livraison est estimée à ${eur(c.deliveryEstimated)} (prix moyen Terence pour la même taille de commande).` })
  if (m.missingCost > 0)
    alerts.push({ tone: 'warn', text: `${m.missingCost} commande(s) contiennent des produits sans coût d'achat dans Shopify : le coût produits est sous-estimé (liste en bas de page).` })
  if (m.month === data.subcontractStart.slice(0, 7) || m.month === prevMonth(data.subcontractStart))
    alerts.push({ tone: 'info', text: 'Mois de transition vers Terence : certaines commandes ont été livrées en interne, d’autres par Terence. Les chiffres se stabilisent à partir du mois suivant.' })

  return (
    <div className="min-h-screen bg-[#f7f7f5] px-4 py-6 md:px-8">
      <div className="mx-auto max-w-6xl space-y-5">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="flex items-center gap-2 text-xl font-semibold text-[#1a1a2e]"><Compass size={20} /> Pilote</h1>
            <p className="mt-1 max-w-2xl text-sm text-[#6b6b63]">
              Chaque mois = les commandes <b>passées</b> ce mois-là, avec tous leurs coûts (remboursements et livraisons inclus, même s&apos;ils arrivent plus tard).
              Pub, salaires et charges : le mois où ils sont dépensés. Montants HT.
            </p>
          </div>
          <div className="flex flex-wrap gap-1 rounded-xl border border-[#e8e8e4] bg-white p-1">
            {data.months.map(x => (
              <button key={x.month} onClick={() => setSel(x.month)}
                className={`rounded-lg px-3 py-1.5 text-sm capitalize ${x.month === sel ? 'bg-[#1a1a2e] text-white' : 'text-[#6b6b63] hover:bg-[#f3f3f1]'}`}>
                {monthShort(x.month)}{x.partial ? ' •' : ''}
              </button>
            ))}
          </div>
        </div>

        {/* Verdict du mois */}
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Tile label="CA HT net" value={eur(ca)} sub={`${m.counts.paid} commandes payées dont ${m.counts.truck} panneaux`} />
          <Tile label="Marge avant pub et charges" value={eur(m.contributionBeforeAds)} sub={`${pct(m.contributionBeforeAds, ca)} % du CA · après produits, livraison, frais`} />
          <Tile label="Résultat du mois" value={eur(m.result)} tone={m.result < 0 ? 'bad' : 'good'} sub={`${pct(m.result, ca)} % du CA · tout déduit`} />
          <Tile label="CA pour être à l'équilibre" value={eur(breakEvenCA)} sub={breakEvenCA != null && ca > 0 ? (breakEvenCA > ca ? `il manque ${eur(breakEvenCA - ca)} de CA` : `atteint (+${eur(ca - breakEvenCA)})`) : ''} tone={breakEvenCA != null && breakEvenCA > ca ? 'bad' : undefined} />
        </div>

        {alerts.length > 0 && (
          <div className="space-y-2">
            {alerts.map((a, i) => (
              <div key={i} className={`flex items-start gap-2 rounded-xl px-4 py-2.5 text-xs ${a.tone === 'warn' ? 'bg-[#fff6e5] text-[#8a5a00]' : 'bg-white text-[#6b6b63] border border-[#e8e8e4]'}`}>
                {a.tone === 'warn' ? <AlertTriangle size={14} className="mt-0.5 shrink-0" /> : <Info size={14} className="mt-0.5 shrink-0" />}
                <span>{a.text}</span>
              </div>
            ))}
          </div>
        )}

        <div className="grid gap-5 lg:grid-cols-2">
          {/* Où part chaque 100 € */}
          <Card title={`Où part 100 € de CA · ${monthLabel(m.month)}`}>
            <div className="space-y-2.5">
              {split.map(s => {
                const share = pct(s.v, ca)
                const over = s.target != null && share > s.target
                return (
                  <div key={s.label} title={`${s.label} : ${eur(s.v)} = ${share} % du CA${s.target != null ? ` (repère ${s.target} %)` : ''}`}>
                    <div className="mb-1 flex justify-between text-xs">
                      <span className="text-[#1a1a2e]">{s.label}</span>
                      <span className="tabular-nums text-[#6b6b63]">{eur(s.v)} · <b className="text-[#1a1a2e]">{share.toLocaleString('fr-FR')} €</b></span>
                    </div>
                    <div className="relative h-2.5 rounded-full bg-[#f0f0ee]">
                      <div className="h-2.5 rounded-full" style={{ width: `${Math.min(100, share / maxShare * 100)}%`, background: over ? '#c7293a' : '#1a1a2e' }} />
                      {s.target != null && <div className="absolute top-[-3px] h-4 w-0.5 bg-[#1f7a5a]" style={{ left: `${s.target / maxShare * 100}%` }} title={`Repère ${s.target} %`} />}
                    </div>
                  </div>
                )
              })}
              <div className="flex justify-between border-t border-[#f0f0ee] pt-2 text-sm">
                <span className="font-semibold text-[#1a1a2e]">Il reste</span>
                <span className={`font-bold tabular-nums ${m.result < 0 ? 'text-[#c7293a]' : 'text-[#1f7a5a]'}`}>{pct(m.result, ca).toLocaleString('fr-FR')} €</span>
              </div>
              <p className="text-[11px] text-[#9b9b93]">Trait vert = repère. Barre rouge = au-dessus du repère.</p>
            </div>
          </Card>

          {/* Leviers */}
          <Card title="Où optimiser en priorité">
            <div className="space-y-3">
              {levers.map((l, i) => (
                <div key={l.key} className="rounded-xl border border-[#efefec] px-3.5 py-3">
                  <div className="flex items-baseline justify-between gap-3">
                    <p className="text-sm font-semibold text-[#1a1a2e]">{i + 1}. {l.label}</p>
                    <p className="shrink-0 text-xs tabular-nums text-[#6b6b63]">{l.share.toLocaleString('fr-FR')} % <span className="text-[#9b9b93]">/ repère {l.target} %</span></p>
                  </div>
                  <p className={`mt-0.5 text-xs font-medium ${l.gap > 0 ? 'text-[#c7293a]' : 'text-[#1f7a5a]'}`}>
                    {l.gap > 0 ? `${eur(l.gap)} de trop ce mois-ci par rapport au repère` : 'Dans le repère'}
                  </p>
                  {l.gap > 0 && <p className="mt-1 text-[11px] leading-relaxed text-[#6b6b63]">{l.hint}</p>}
                </div>
              ))}
              {small && smallLoss > 0 && (
                <div className="rounded-xl bg-[#fdf3f4] px-3.5 py-3 text-xs text-[#1a1a2e]">
                  <b>Petites commandes (1 à 3 panneaux)</b> : {small.orders} commandes, livraison {eur(small.delivery)}, port payé par les clients {eur(small.shippingHT)} → <b className="text-[#c7293a]">{eur(smallLoss)} de livraison à notre charge</b>, soit {eur(Math.round(smallLoss / Math.max(1, small.orders)))} par commande.
                </div>
              )}
              <p className="text-[11px] text-[#9b9b93]">Salaires et charges fixes ({eur(fixedAll)}/mois) ne baissent pas avec le volume : ils se couvrent par le CA (voir « CA pour être à l&apos;équilibre »).</p>
            </div>
          </Card>
        </div>

        {/* Compte de résultat sur 6 mois */}
        <Card title="Compte de résultat mensuel (HT)">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-[11px] text-[#9b9b93]">
                  <th className="py-2 pr-4 text-left font-semibold"></th>
                  {data.months.map(x => (
                    <th key={x.month} className={`px-3 py-2 text-right font-semibold ${x.month === sel ? 'text-[#1a1a2e]' : ''}`}><span className="capitalize">{monthShort(x.month)}</span>{x.partial ? ' (en cours)' : ''}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                <PL months={data.months} sel={sel} label="CA produits" get={x => x.revenue.productsHT} />
                <PL months={data.months} sel={sel} label="+ Port payé par les clients" get={x => x.revenue.shippingHT} />
                <PL months={data.months} sel={sel} label="− Remboursements" get={x => -x.revenue.refundsHT} />
                <PL months={data.months} sel={sel} label="CA net" get={x => x.revenue.netHT} strong />
                <PL months={data.months} sel={sel} label="− Produits (coût d'achat)" get={x => -x.costs.products} share />
                <PL months={data.months} sel={sel} label="− Livraison Terence" get={x => -x.costs.delivery} share note={x => x.costs.deliveryEstimated > 0 ? `dont ${eur(x.costs.deliveryEstimated)} estimé` : undefined} />
                <PL months={data.months} sel={sel} label="− Transport interne" get={x => -x.costs.transport} share note={x => x.costs.transport === 0 ? 'non saisi' : undefined} />
                <PL months={data.months} sel={sel} label="− Frais de paiement" get={x => -x.costs.fees} share />
                <PL months={data.months} sel={sel} label="Marge avant pub et charges" get={x => x.contributionBeforeAds} strong share />
                <PL months={data.months} sel={sel} label="− Pub" get={x => -x.costs.ads} share note={x => Object.entries(x.detail.ads).map(([k, v]) => `${PLATFORM[k] ?? k} ${eur(v)}`).join(' · ')} />
                <PL months={data.months} sel={sel} label="− Salaires" get={x => -x.costs.team} share />
                <PL months={data.months} sel={sel} label="− Crédits, compta, applis" get={x => -(x.costs.infra + x.costs.apps)} share />
                <PL months={data.months} sel={sel} label="Résultat" get={x => x.result} strong share color />
                <tr><td colSpan={data.months.length + 1} className="pt-4 text-[11px] font-semibold uppercase tracking-[0.1em] text-[#9b9b93]">Indicateurs</td></tr>
                <PL months={data.months} sel={sel} label="Panier moyen HT (commandes panneaux)" get={x => x.kpis.avgBasketHT} plain />
                <PL months={data.months} sel={sel} label="Pub par commande panneaux" get={x => x.kpis.cac} plain />
                <PL months={data.months} sel={sel} label="CA HT pour 1 € de pub" get={x => x.kpis.mer} plain raw />
                <PL months={data.months} sel={sel} label="Livraison Terence par commande panneaux" get={x => x.kpis.deliveryPerOrder} plain />
                <PL months={data.months} sel={sel} label="Facture Terence du mois (trésorerie)" get={x => x.terenceInvoice || null} plain />
              </tbody>
            </table>
          </div>
          <p className="mt-3 text-[11px] text-[#9b9b93]">
            « Facture Terence du mois » = ce que Terence facture pour les livraisons faites ce mois-là (ce qui sort du compte), différent de la livraison des commandes du mois.
          </p>
        </Card>

        {/* Par taille de commande */}
        <Card title={`Rentabilité par taille de commande · ${monthLabel(m.month)}`}>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-[11px] text-[#9b9b93]">
                  <th className="py-2 pr-3 font-semibold">Commande</th>
                  <th className="px-3 py-2 text-right font-semibold">Nb</th>
                  <th className="px-3 py-2 text-right font-semibold">CA HT net</th>
                  <th className="px-3 py-2 text-right font-semibold">dont port payé</th>
                  <th className="px-3 py-2 text-right font-semibold">Produits</th>
                  <th className="px-3 py-2 text-right font-semibold">Livraison</th>
                  <th className="px-3 py-2 text-right font-semibold">Marge avant pub</th>
                  <th className="px-3 py-2 text-right font-semibold">par commande</th>
                </tr>
              </thead>
              <tbody>
                {m.buckets.filter(b => b.orders > 0).map(b => (
                  <tr key={b.key} className="border-t border-[#f3f3f1]">
                    <td className="py-2 pr-3 text-[#1a1a2e]">{b.label}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{b.orders}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{eur(b.revenueHT)}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-[#6b6b63]">{eur(b.shippingHT)}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-[#6b6b63]">{eur(b.cogs)} <span className="text-[11px]">({pct(b.cogs, b.revenueHT)} %)</span></td>
                    <td className="px-3 py-2 text-right tabular-nums text-[#6b6b63]" title={b.estimated ? `dont ${eur(b.estimated)} estimé` : ''}>{eur(b.delivery)} <span className="text-[11px]">({pct(b.delivery, b.revenueHT)} %)</span></td>
                    <td className={`px-3 py-2 text-right tabular-nums font-semibold ${b.contribution < 0 ? 'text-[#c7293a]' : 'text-[#1a1a2e]'}`}>{eur(b.contribution)}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-[#6b6b63]">{eur(Math.round(b.contribution / b.orders))}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-3 text-[11px] text-[#9b9b93]">
            Marge avant pub = CA HT net − produits − livraison − frais de paiement. Pour comparer : la pub coûte {eur(m.kpis.cac)} par commande panneaux ce mois-ci.
            {m.month < data.subcontractStart.slice(0, 7) && ' Avant Terence, la livraison est dans « Transport interne » (non répartie par commande).'}
          </p>
        </Card>

        {data.missingCostProducts.length > 0 && (
          <Card title="Produits sans coût d'achat dans Shopify (6 derniers mois)">
            <p className="mb-2 text-xs text-[#6b6b63]">À renseigner dans Shopify (fiche produit → variante → « Coût par article ») pour que la marge soit juste.</p>
            <ul className="grid gap-1 text-xs sm:grid-cols-2">
              {data.missingCostProducts.map(p => (
                <li key={p.title} className="flex justify-between gap-3 border-b border-[#f3f3f1] py-1"><span className="text-[#1a1a2e]">{p.title}</span><span className="shrink-0 tabular-nums text-[#9b9b93]">{p.qty} vendus</span></li>
              ))}
            </ul>
          </Card>
        )}
      </div>
    </div>
  )
}

function prevMonth(start: string) {
  const d = new Date(`${start.slice(0, 7)}-15T12:00:00Z`)
  d.setUTCMonth(d.getUTCMonth() - 1)
  return d.toISOString().slice(0, 7)
}

function Tile({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: 'good' | 'bad' }) {
  return (
    <div className="rounded-2xl border border-[#e8e8e4] bg-white px-4 py-3.5">
      <p className="text-[11px] text-[#9b9b93]">{label}</p>
      <p className={`text-xl font-bold tabular-nums ${tone === 'bad' ? 'text-[#c7293a]' : tone === 'good' ? 'text-[#1f7a5a]' : 'text-[#1a1a2e]'}`}>{value}</p>
      {sub && <p className="mt-0.5 text-[11px] text-[#6b6b63]">{sub}</p>}
    </div>
  )
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-[#e8e8e4] bg-white px-5 py-4">
      <p className="mb-3 text-[11px] font-semibold uppercase tracking-[0.1em] text-[#6b6b63]">{title}</p>
      {children}
    </div>
  )
}

function PL({ months, sel, label, get, strong, share, color, note, plain, raw }: {
  months: Month[]; sel: string | null; label: string; get: (m: Month) => number | null
  strong?: boolean; share?: boolean; color?: boolean; note?: (m: Month) => string | undefined; plain?: boolean; raw?: boolean
}) {
  return (
    <tr className={strong ? 'border-t border-[#e8e8e4]' : ''}>
      <td className={`py-1.5 pr-4 ${strong ? 'font-semibold text-[#1a1a2e]' : plain ? 'text-[#6b6b63]' : 'text-[#1a1a2e]'}`}>{label}</td>
      {months.map(x => {
        const v = get(x)
        const n = note?.(x)
        return (
          <td key={x.month} className={`px-3 py-1.5 text-right tabular-nums ${x.month === sel ? 'bg-[#f7f7f5]' : ''}`} title={n}>
            <span className={`${strong ? 'font-semibold' : ''} ${color && v != null ? (v < 0 ? 'text-[#c7293a]' : 'text-[#1f7a5a]') : v != null && v < 0 ? 'text-[#6b6b63]' : 'text-[#1a1a2e]'}`}>
              {v == null || (v === 0 && !strong) ? '—' : raw ? v.toLocaleString('fr-FR') : eur(v + 0)}
            </span>
            {share && v != null && x.revenue.netHT > 0 && <span className="block text-[10px] text-[#9b9b93]">{Math.abs(pct(v, x.revenue.netHT)).toLocaleString('fr-FR')} %</span>}
            {n && <span className="block text-[10px] text-[#8a5a00]">{n.length > 28 ? '' : n}</span>}
          </td>
        )
      })}
    </tr>
  )
}
