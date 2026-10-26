'use client'

export const dynamic = 'force-dynamic'

import { useEffect, useMemo, useState } from 'react'
import { usePathname, useSearchParams, useRouter } from 'next/navigation'
import { Coins, TrendingDown, TrendingUp, Info } from 'lucide-react'
import SubcontractBilling from '@/components/delivery/SubcontractBilling'

type Post = { label: string; amount: number; kind: 'fixe' | 'variable' }
type MonthRow = {
  month: string; cost: number; breakdown: Post[]; fixed: number; variable: number
  orders: number; panels: number; stones: number; costPerOrder: number | null; costPerPanel: number | null
  tours: number; km: number; costPerKm: number | null; costPerTour: number | null
  panelsPerTour: number | null; fillRate: number | null
  shopifyOrders: number; sampleOrders: number; billableOrders: number; costPerShopifyOrder: number | null
}
type Summary = {
  monthsCount: number; totalCost: number; totalOrders: number; totalPanels: number; totalStones: number
  avgCostPerOrder: number | null; avgCostPerPanel: number | null; avgCostPerMonth: number | null
  avgPanelsPerOrder: number | null; fixedPct: number | null; variablePct: number | null; variableCostPerPanel: number | null
  totalKm: number; totalTours: number; avgCostPerKm: number | null; avgCostPerTour: number | null
  avgPanelsPerTour: number | null; avgFillRate: number | null
  totalShopifyOrders: number; totalSampleOrders: number; totalBillableOrders: number; avgCostPerShopifyOrder: number | null
}
type ZoneRow = {
  zone: string; panels: number; stops: number; avgDistKm: number
  fixedPerPanel: number; variablePerPanel: number; costPerPanel: number; allocatedCost: number
}
type GridStop = { km: number; panels: number; month: string }
type Data = { brand: string; months: MonthRow[]; summary: Summary; costStructure: (Post & { pct: number })[]; zones: ZoneRow[]; gridStops: GridStop[] }

// Grille 3PL par défaut (ChatGPT + une tranche 13+ estimée). Zones × tranches de panneaux.
const GRID_ZONES = ['≤ 100 km', '100–300 km', '> 300 km']
const GRID_BUCKETS = ['1–3', '4–7', '8–12', '13+']
const DEFAULT_GRID = [
  [100, 150, 220, 300],
  [140, 190, 260, 360],
  [200, 250, 320, 440],
]

const ZONE_LABELS: Record<string, string> = {
  'nord-ouest': 'Nord-Ouest', 'nord-est': 'Nord-Est', 'sud-ouest': 'Sud-Ouest', 'sud-est': 'Sud-Est', 'inconnue': 'Inconnue',
}

const eur = (n: number | null | undefined) =>
  n == null ? '—' : n.toLocaleString('fr-FR', { maximumFractionDigits: 0 }) + ' €'
const monthLabel = (ym: string) => {
  const [y, m] = ym.split('-').map(Number)
  return new Date(y, m - 1, 1).toLocaleDateString('fr-FR', { month: 'short', year: '2-digit' })
}

function Kpi({ label, value, sub, accent }: { label: string; value: string; sub?: string; accent?: boolean }) {
  return (
    <div className={`rounded-2xl px-5 py-4 border ${accent ? 'bg-[#1a1a2e] border-[#1a1a2e]' : 'bg-white border-[#e8e8e4]'}`}>
      <p className={`text-[10px] font-semibold uppercase tracking-[0.1em] ${accent ? 'text-white/50' : 'text-[#9b9b93]'}`}>{label}</p>
      <p className={`text-3xl font-bold mt-1 tabular-nums ${accent ? 'text-white' : 'text-[#1a1a2e]'}`}>{value}</p>
      {sub && <p className={`text-[11px] mt-0.5 ${accent ? 'text-white/40' : 'text-[#9b9b93]'}`}>{sub}</p>}
    </div>
  )
}

export default function DeliveryCostsPage() {
  const pathname = usePathname()
  const brand = pathname.split('/').filter(Boolean)[0] ?? 'bowa'
  // Onglets : analyse du coût interne / chiffrage du sous-traitant (Terence). Deep link ?tab=
  const searchParams = useSearchParams()
  const router = useRouter()
  const tab = searchParams.get('tab') === 'terence' ? 'terence' : 'analyse'
  const setTab = (t: 'analyse' | 'terence') => router.replace(t === 'analyse' ? pathname : `${pathname}?tab=${t}`)

  const [data, setData] = useState<Data | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  // Simulateur sous-traitance : tarif 3PL par panneau
  const [quote, setQuote] = useState<string>('')
  // Objectif cible €/panneau (persisté localStorage, par marque) → alerte si dépassé
  const [target, setTarget] = useState<string>('')
  useEffect(() => {
    const t = localStorage.getItem(`steero_delivery_target_${brand}`)
    if (t) setTarget(t)
  }, [brand])
  function saveTarget(v: string) {
    setTarget(v)
    localStorage.setItem(`steero_delivery_target_${brand}`, v)
  }
  const targetNum = parseFloat(target.replace(',', '.')) || null
  // Paramètres du modèle à capacité (éditables, persistés par marque) : un
  // camion+chauffeur a une CAPACITÉ (panneaux/mois) et un COÛT de bloc ; au-delà
  // de la capacité il faut un 2ᵉ bloc → le fixe monte par paliers (pas à l'infini).
  const [capInput, setCapInput] = useState('')
  const [blockInput, setBlockInput] = useState('')
  const [varInput, setVarInput] = useState('')
  useEffect(() => {
    setCapInput(localStorage.getItem(`steero_dc_cap_${brand}`) ?? '')
    setBlockInput(localStorage.getItem(`steero_dc_block_${brand}`) ?? '')
    setVarInput(localStorage.getItem(`steero_dc_var_${brand}`) ?? '')
  }, [brand])
  const saveLS = (k: string, setter: (v: string) => void) => (v: string) => {
    setter(v); localStorage.setItem(`steero_dc_${k}_${brand}`, v)
  }
  // Grille 3PL éditable (prix par zone × tranche de panneaux), persistée.
  const [grid, setGrid] = useState<number[][]>(DEFAULT_GRID)
  useEffect(() => {
    const raw = localStorage.getItem(`steero_dc_grid_${brand}`)
    if (raw) { try { const g = JSON.parse(raw); if (Array.isArray(g) && g.length === 3) setGrid(g) } catch { /* ignore */ } }
    else setGrid(DEFAULT_GRID)
  }, [brand])
  function setGridCell(zi: number, bi: number, v: string) {
    const n = Math.max(0, Math.round(Number(v) || 0))
    setGrid(prev => {
      const next = prev.map(r => r.slice())
      next[zi][bi] = n
      localStorage.setItem(`steero_dc_grid_${brand}`, JSON.stringify(next))
      return next
    })
  }
  // Contrôles du testeur : mois simulé, prix HT ou TTC, taux de TVA, TVA récupérable interne
  const [gridMonth, setGridMonth] = useState<string>('')       // '' = toute la période
  const [gridHT, setGridHT] = useState(true)                   // les prix saisis sont HT
  const [vatRate, setVatRate] = useState('20')
  const [intVat, setIntVat] = useState('0')                    // % de TVA récupérable sur le coût interne

  useEffect(() => {
    setLoading(true); setError(null)
    fetch(`/api/delivery/cost-analysis?brand=${brand}`)
      .then(r => r.json())
      .then(d => { if (d.error) throw new Error(d.error); setData(d) })
      .catch(e => setError(e instanceof Error ? e.message : 'Erreur'))
      .finally(() => setLoading(false))
  }, [brand])

  const sim = useMemo(() => {
    if (!data) return null
    const q = parseFloat(quote.replace(',', '.'))
    if (!q || q <= 0) return null
    const s = data.summary
    const extMonthly = Math.round((q * s.totalPanels) / Math.max(1, s.monthsCount))
    const curMonthly = s.avgCostPerMonth ?? 0
    const deltaMonthly = curMonthly - extMonthly   // >0 = sous-traiter fait économiser
    return { q, extMonthly, curMonthly, deltaMonthly }
  }, [data, quote])

  if (brand !== 'bowa') {
    return <div className="max-w-5xl mx-auto px-6 py-10 text-sm text-[#6b6b63]">Analyse des coûts de livraison disponible uniquement pour Bowa.</div>
  }

  return (
    <div className="min-h-screen bg-[#faf9f8]">
      <main className="max-w-5xl mx-auto px-6 py-8 space-y-6">
        <div className="flex items-center gap-2">
          <Coins size={20} className="text-[#1a1a2e]" />
          <div>
            <h1 className="text-xl font-bold text-[#1a1a18] tracking-tight">Coûts de livraison — Bowa</h1>
            <p className="text-sm text-[#6b6b63] mt-0.5">Coût réel du transport (feuille synchronisée) croisé avec les volumes livrés</p>
          </div>
        </div>

        <div className="flex gap-1 border-b border-[#e8e8e4]">
          {([['analyse', 'Analyse des coûts'], ['terence', 'Facture Terence']] as const).map(([k, label]) => (
            <button key={k} onClick={() => setTab(k)}
              className={`px-4 py-2 text-sm font-medium -mb-px border-b-2 ${tab === k ? 'border-[#1a1a2e] text-[#1a1a2e]' : 'border-transparent text-[#9b9b93] hover:text-[#1a1a2e]'}`}>
              {label}
            </button>
          ))}
        </div>

        {tab === 'terence' && <SubcontractBilling brand={brand} internalCostPerPanel={data?.summary.avgCostPerPanel ?? null} />}

        {tab === 'analyse' && loading && <div className="space-y-3">{[1,2,3].map(i => <div key={i} className="h-28 bg-[#f3f3f1] rounded-2xl animate-pulse" />)}</div>}
        {tab === 'analyse' && error && <div className="rounded-xl bg-[#fce8ea] border border-[#fecaca] px-4 py-3 text-xs text-[#c7293a]">{error}</div>}

        {tab === 'analyse' && !loading && !error && data && data.summary.monthsCount === 0 && (
          <div className="rounded-2xl bg-white border border-[#e8e8e4] px-5 py-8 text-center text-sm text-[#6b6b63]">
            Pas encore de mois avec coût ET volume livré. (Le coût vient de la feuille transport, les volumes du module livraison.)
          </div>
        )}

        {tab === 'analyse' && !loading && !error && data && data.summary.monthsCount > 0 && (() => {
          const s = data.summary
          return (
            <>
              {/* KPI principaux */}
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                <Kpi accent label="Coût / commande livrée" value={eur(s.avgCostPerOrder)} sub={`livraisons camion · ${s.monthsCount} mois`} />
                <Kpi accent label="Coût moyen / panneau" value={eur(s.avgCostPerPanel)} sub={`${s.avgPanelsPerOrder ?? '—'} panneaux / livraison`} />
                <Kpi label="Coût transport / mois" value={eur(s.avgCostPerMonth)} sub="moyenne période" />
                <Kpi label="Fixe / Variable" value={`${s.fixedPct ?? '—'}% / ${s.variablePct ?? '—'}%`} sub="part des coûts" />
              </div>

              {/* Deux façons de lire le coût par commande */}
              <div className="rounded-2xl bg-white border border-[#e8e8e4] overflow-hidden">
                <div className="px-5 py-3 border-b border-[#f0efec]">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.1em] text-[#6b6b63]">Coût par commande — deux lectures</p>
                </div>
                <div className="grid sm:grid-cols-2 divide-y sm:divide-y-0 sm:divide-x divide-[#f0efec]">
                  <div className="px-5 py-4">
                    <p className="text-2xl font-bold text-[#1a1a2e] tabular-nums">{eur(s.avgCostPerOrder)}</p>
                    <p className="text-xs font-semibold text-[#1a1a2e] mt-0.5">par livraison camion</p>
                    <p className="text-[11px] text-[#9b9b93] mt-1 leading-snug">Coût transport ÷ {s.totalOrders} livraisons réellement pointées. Le vrai coût d&apos;une livraison de panneaux.</p>
                  </div>
                  <div className="px-5 py-4">
                    <p className="text-2xl font-bold text-[#4338ca] tabular-nums">{eur(s.avgCostPerShopifyOrder)}</p>
                    <p className="text-xs font-semibold text-[#1a1a2e] mt-0.5">réparti sur les commandes réelles (hors échantillons)</p>
                    <p className="text-[11px] text-[#9b9b93] mt-1 leading-snug">Coût transport ÷ {s.totalBillableOrders} commandes hors échantillons. Les {s.totalSampleOrders} commandes 100 % échantillons (livrées par La Poste) sont exclues. Vue « part transport dans la marge ».</p>
                  </div>
                </div>
              </div>

              {/* KPI secondaires : km, tournée, remplissage */}
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                <Kpi label="Coût / km" value={s.avgCostPerKm != null ? s.avgCostPerKm.toLocaleString('fr-FR') + ' €' : '—'} sub={`${s.totalKm.toLocaleString('fr-FR')} km total`} />
                <Kpi label="Coût / tournée" value={eur(s.avgCostPerTour)} sub={`${s.totalTours} tournées`} />
                <Kpi
                  label="Remplissage camion"
                  value={s.avgFillRate != null ? `${s.avgFillRate}%` : '—'}
                  sub={`${s.avgPanelsPerTour ?? '—'} / 100 panneaux par tournée`}
                />
                <Kpi label="Panneaux / livraison" value={s.avgPanelsPerOrder != null ? String(s.avgPanelsPerOrder) : '—'} sub="taille moyenne livraison" />
              </div>

              {/* Pilotage vers l'objectif — modèle à CAPACITÉ (paliers camion) */}
              {(() => {
                const variablePP = s.variableCostPerPanel ?? 0
                const avgPP = s.avgCostPerPanel ?? 0
                const fixedPP = Math.max(0, avgPP - variablePP)
                const panelsPerMonth = s.monthsCount > 0 ? Math.round(s.totalPanels / s.monthsCount) : 0
                const fixedPerMonth = Math.round(fixedPP * panelsPerMonth)
                const kmPerPanel = s.totalPanels > 0 ? Math.round((s.totalKm / s.totalPanels) * 10) / 10 : null
                const T = targetNum ?? 20
                const fixedW = avgPP > 0 ? Math.round((fixedPP / avgPP) * 100) : 0

                // Paramètres effectifs (saisie utilisateur sinon défaut issu des données)
                const defCap = Math.max(panelsPerMonth, 100)
                const cap = Math.max(1, parseFloat(capInput) || defCap)
                const block = Math.max(0, parseFloat(blockInput) || fixedPerMonth)
                const vv = parseFloat(varInput) || variablePP

                // Modèle : trucks(V)=ceil(V/cap) ; coût/panneau = trucks*block/V + variable
                const trucks = (V: number) => Math.max(1, Math.ceil(V / cap))
                const cpp = (V: number) => V > 0 ? Math.round((trucks(V) * block) / V + vv) : 0
                const floorCPP = Math.round(block / cap + vv)   // coût/panneau quand chaque camion est PLEIN
                const currentTrucks = trucks(panelsPerMonth)
                const reachable = floorCPP <= T
                // Leviers pour abaisser le PLANCHER à T (les 2 autres constants)
                const capNeed = T > vv ? Math.ceil(block / (T - vv)) : null
                const blockNeed = Math.round((T - vv) * cap)
                const varNeed = Math.round(T - block / cap)

                const field = (label: string, val: string, ph: number, on: (v: string) => void, unit: string) => (
                  <label className="flex flex-col gap-1">
                    <span className="text-[10px] font-semibold text-[#6b6b63]">{label}</span>
                    <div className="flex items-center gap-1">
                      <input type="number" min={0} value={val} onChange={e => on(e.target.value)} placeholder={String(ph)}
                        className="w-24 text-sm font-semibold rounded-lg px-2 py-1.5 border border-[#e8e8e4] outline-none focus:ring-2 focus:ring-[#1a1a2e]/20" />
                      <span className="text-[10px] text-[#9b9b93]">{unit}</span>
                    </div>
                  </label>
                )

                return (
                  <div className="rounded-2xl bg-white border border-[#e8e8e4] overflow-hidden">
                    <div className="px-5 py-3 border-b border-[#f0efec]">
                      <p className="text-[11px] font-semibold uppercase tracking-[0.1em] text-[#6b6b63]">🎯 Pilotage vers l&apos;objectif</p>
                    </div>
                    <div className="px-5 py-4 space-y-4">
                      {/* Décomposition fixe/variable par panneau */}
                      <div>
                        <p className="text-xs text-[#6b6b63] mb-1.5">Ton coût actuel = <b className="text-[#1a1a2e]">{eur(avgPP)}/panneau</b> · {panelsPerMonth} panneaux/mois · {kmPerPanel ?? '—'} km/panneau</p>
                        <div className="flex h-7 rounded-lg overflow-hidden text-[10px] font-semibold text-white">
                          <div className="bg-[#4338ca] flex items-center justify-center" style={{ width: `${fixedW}%` }}>{eur(fixedPP)} fixe</div>
                          <div className="bg-[#9a3412] flex items-center justify-center" style={{ width: `${100 - fixedW}%` }}>{eur(variablePP)} variable</div>
                        </div>
                      </div>

                      {/* Paramètres du modèle à capacité */}
                      <div className="rounded-xl bg-[#faf9f8] border border-[#eceae6] px-4 py-3">
                        <p className="text-[11px] font-semibold text-[#6b6b63] mb-2">Hypothèses camion (ajuste selon ta réalité terrain)</p>
                        <div className="flex gap-4 flex-wrap items-end">
                          {field('Objectif', target, 20, saveTarget, '€/pann.')}
                          {field('Capacité 1 camion', capInput, defCap, saveLS('cap', setCapInput), 'pann./mois')}
                          {field('Coût 1 camion+chauffeur', blockInput, fixedPerMonth, saveLS('block', setBlockInput), '€/mois')}
                          {field('Variable', varInput, variablePP, saveLS('var', setVarInput), '€/pann.')}
                        </div>
                        <p className="text-[10px] text-[#9b9b93] mt-2 leading-snug">« Capacité » = ce qu&apos;UN camion+chauffeur peut livrer par mois à plein régime. Au-delà → 2ᵉ camion+chauffeur (le fixe double). Défauts calculés sur tes données ({currentTrucks} camion{currentTrucks > 1 ? 's' : ''} aujourd&apos;hui).</p>
                      </div>

                      {/* Le vrai plancher + atteignabilité */}
                      <div className={`rounded-xl px-4 py-3 border ${reachable ? 'bg-[#f0fdf4] border-[#bbf7d0]' : 'bg-[#fef2f2] border-[#fecaca]'}`}>
                        <p className="text-sm font-bold text-[#1a1a2e]">
                          Plancher réaliste (camions pleins) : <span className={reachable ? 'text-[#1a7f4b]' : 'text-[#c7293a]'}>{eur(floorCPP)}/panneau</span>
                        </p>
                        <p className="text-[11px] text-[#6b6b63] mt-1 leading-snug">
                          = coût d&apos;un camion ({eur(block)}) ÷ sa capacité ({cap} pann.) + variable ({eur(vv)}). <b>Ajouter des camions ne baisse PAS ce chiffre</b> s&apos;ils sont pleins — c&apos;est pour ça que « livrer 1200 panneaux » ne suffit pas : il faut remplir CHAQUE camion.
                        </p>
                        <p className="text-[12px] mt-2 leading-snug">
                          {reachable
                            ? <>✅ <b>{eur(T)} est atteignable</b> : il suffit de remplir tes camions à ~{cap} pann./mois chacun. Aujourd&apos;hui tu es à {panelsPerMonth} ({currentTrucks} camion{currentTrucks > 1 ? 's' : ''}) → {panelsPerMonth < cap ? 'remplis-le davantage' : 'déjà bien rempli, joue sur le variable/les km'}.</>
                            : <>⚠ <b>{eur(T)} est hors de portée</b> avec ces hypothèses (plancher {eur(floorCPP)}). Pour y arriver il faut l&apos;UN de ces leviers structurels :
                                <span className="block mt-1">• capacité d&apos;un camion ≥ <b>{capNeed} pann./mois</b> (plus de tournées/charge par camion)</span>
                                <span className="block">• coût d&apos;un camion ≤ <b>{eur(blockNeed)}/mois</b> (leasing/salaire/dépôt moins chers)</span>
                                <span className="block">• variable ≤ <b>{eur(varNeed)}/panneau</b> (carburant/péages/sous-traitance)</span>
                              </>}
                        </p>
                      </div>

                      {/* Effet de palier : coût/panneau selon le volume */}
                      <div>
                        <p className="text-[11px] font-semibold text-[#6b6b63] mb-1.5">Effet de palier (coût/panneau selon le volume)</p>
                        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-center">
                          {[
                            { lbl: 'Aujourd’hui', V: panelsPerMonth },
                            { lbl: '1 camion plein', V: cap },
                            { lbl: 'Juste après (2ᵉ camion ½ vide)', V: cap + Math.round(cap * 0.2) },
                            { lbl: '2 camions pleins', V: cap * 2 },
                          ].map((r, i) => (
                            <div key={i} className="rounded-lg bg-[#f8f7f5] border border-[#eceae6] px-2 py-2">
                              <p className="text-[10px] text-[#9b9b93] leading-tight h-7 flex items-center justify-center">{r.lbl}</p>
                              <p className="text-lg font-bold text-[#1a1a2e] tabular-nums">{eur(cpp(r.V))}</p>
                              <p className="text-[9px] text-[#9b9b93]">{r.V} pann. · {trucks(r.V)} cam.</p>
                            </div>
                          ))}
                        </div>
                        <p className="text-[10px] text-[#9b9b93] mt-1.5">On voit le « dent de scie » : le coût/panneau est au plus bas camion plein, puis <b>remonte</b> dès qu&apos;on ajoute un camion mal rempli, avant de redescendre. L&apos;optimum = remplir avant d&apos;ajouter.</p>
                      </div>

                      {targetNum != null && (() => {
                        const over = data.months.filter(m => m.costPerPanel != null && m.costPerPanel > targetNum)
                        return (
                          <div className={`text-xs font-semibold px-3 py-2 rounded-lg ${over.length === 0 ? 'bg-[#f0fdf4] text-[#1a7f4b]' : 'bg-[#fef2f2] text-[#c7293a]'}`}>
                            {over.length === 0
                              ? '✅ Tous les mois sont sous l’objectif'
                              : `⚠ ${over.length} mois au-dessus de ${eur(targetNum)} : ${over.map(m => monthLabel(m.month)).join(', ')} (en rouge dans le tableau)`}
                          </div>
                        )
                      })()}
                    </div>
                  </div>
                )
              })()}

              {/* Détail mensuel */}
              <div className="rounded-2xl bg-white border border-[#e8e8e4] overflow-hidden">
                <div className="px-5 py-3 border-b border-[#f0efec]">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.1em] text-[#6b6b63]">Détail mensuel</p>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-[10px] uppercase tracking-wider text-[#9b9b93] border-b border-[#f0efec]">
                        <th className="text-left font-semibold px-5 py-2">Mois</th>
                        <th className="text-right font-semibold px-3 py-2">Coût transport</th>
                        <th className="text-right font-semibold px-3 py-2">Livraisons</th>
                        <th className="text-right font-semibold px-3 py-2">Panneaux</th>
                        <th className="text-right font-semibold px-3 py-2">Remplissage</th>
                        <th className="text-right font-semibold px-3 py-2">€ / livraison</th>
                        <th className="text-right font-semibold px-3 py-2">€ / panneau</th>
                        <th className="text-right font-semibold px-3 py-2">Cmd hors éch.</th>
                        <th className="text-right font-semibold px-5 py-2">€ / cmd réelle</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.months.map(m => {
                        const comparable = m.cost > 0 && m.orders > 0
                        return (
                          <tr key={m.month} className={`border-b border-[#f5f5f3] ${comparable ? '' : 'opacity-50'}`}>
                            <td className="px-5 py-2.5 font-medium text-[#1a1a2e]">{monthLabel(m.month)}</td>
                            <td className="px-3 py-2.5 text-right tabular-nums">{eur(m.cost)}</td>
                            <td className="px-3 py-2.5 text-right tabular-nums">{m.orders || '—'}</td>
                            <td className="px-3 py-2.5 text-right tabular-nums">{m.panels || '—'}{m.stones > 0 && <span className="text-[#9b9b93] text-[11px]"> +{m.stones}🪨</span>}</td>
                            <td className="px-3 py-2.5 text-right tabular-nums">{m.fillRate != null ? `${m.fillRate}%` : '—'}</td>
                            <td className="px-3 py-2.5 text-right tabular-nums font-semibold">{eur(m.costPerOrder)}</td>
                            <td className={`px-3 py-2.5 text-right tabular-nums font-semibold ${targetNum != null && m.costPerPanel != null && m.costPerPanel > targetNum ? 'text-[#c7293a]' : ''}`}>{eur(m.costPerPanel)}</td>
                            <td className="px-3 py-2.5 text-right tabular-nums text-[#6b6b63]">{m.billableOrders || '—'}{m.sampleOrders > 0 && <span className="text-[#c7b3f0] text-[11px]"> (+{m.sampleOrders} éch.)</span>}</td>
                            <td className="px-5 py-2.5 text-right tabular-nums font-semibold text-[#4338ca]">{eur(m.costPerShopifyOrder)}</td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
                <p className="px-5 py-2 bg-[#faf9f8] text-[10px] text-[#9b9b93]">Les mois sans volume (module livraison démarré en avril 2026) sont grisés. 🪨 = feuilles de pierre (comptées à part). « Livraisons » = arrêts camion pointés livrés (≠ total des commandes Shopify du dashboard, qui inclut les envois accessoires par transporteur).</p>
              </div>

              {/* Structure de coût */}
              <div className="rounded-2xl bg-white border border-[#e8e8e4] overflow-hidden">
                <div className="px-5 py-3 border-b border-[#f0efec]">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.1em] text-[#6b6b63]">Structure de coût — où part l&apos;argent</p>
                </div>
                <div className="px-5 py-4 space-y-2">
                  {data.costStructure.map(p => (
                    <div key={p.label} className="flex items-center gap-3">
                      <span className="w-48 shrink-0 text-xs text-[#1a1a2e] truncate" title={p.label}>{p.label}</span>
                      <span className={`text-[9px] font-semibold px-1.5 py-0.5 rounded ${p.kind === 'fixe' ? 'bg-[#eef2ff] text-[#4338ca]' : 'bg-[#fff7ed] text-[#9a3412]'}`}>{p.kind}</span>
                      <div className="flex-1 h-2.5 bg-[#f0efec] rounded-full overflow-hidden">
                        <div className="h-full rounded-full bg-[#1a1a2e]" style={{ width: `${Math.min(100, p.pct)}%` }} />
                      </div>
                      <span className="w-12 text-right text-xs tabular-nums text-[#6b6b63]">{p.pct}%</span>
                      <span className="w-20 text-right text-xs tabular-nums font-semibold text-[#1a1a2e]">{eur(p.amount)}</span>
                    </div>
                  ))}
                </div>
              </div>

              {/* Coût par zone géographique */}
              {data.zones.length > 0 && (() => {
                const maxCPP = Math.max(...data.zones.map(z => z.costPerPanel), 1)
                return (
                  <div className="rounded-2xl bg-white border border-[#e8e8e4] overflow-hidden">
                    <div className="px-5 py-3 border-b border-[#f0efec]">
                      <p className="text-[11px] font-semibold uppercase tracking-[0.1em] text-[#6b6b63]">Coût par zone géographique</p>
                    </div>
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="text-[10px] uppercase tracking-wider text-[#9b9b93] border-b border-[#f0efec]">
                            <th className="text-left font-semibold px-5 py-2">Zone</th>
                            <th className="text-right font-semibold px-3 py-2">Arrêts</th>
                            <th className="text-right font-semibold px-3 py-2">Panneaux</th>
                            <th className="text-right font-semibold px-3 py-2">Dist. moy.</th>
                            <th className="text-left font-semibold px-3 py-2 w-40">€ / panneau (fixe+var.)</th>
                            <th className="text-right font-semibold px-5 py-2">€ / panneau</th>
                          </tr>
                        </thead>
                        <tbody>
                          {data.zones.map(z => (
                            <tr key={z.zone} className="border-b border-[#f5f5f3]">
                              <td className="px-5 py-2.5 font-medium text-[#1a1a2e]">{ZONE_LABELS[z.zone] ?? z.zone}</td>
                              <td className="px-3 py-2.5 text-right tabular-nums">{z.stops}</td>
                              <td className="px-3 py-2.5 text-right tabular-nums">{z.panels}</td>
                              <td className="px-3 py-2.5 text-right tabular-nums">{z.avgDistKm} km</td>
                              <td className="px-3 py-2.5">
                                <div className="flex h-4 rounded overflow-hidden" style={{ width: `${Math.round((z.costPerPanel / maxCPP) * 100)}%`, minWidth: '40px' }} title={`${z.fixedPerPanel}€ fixe + ${z.variablePerPanel}€ variable`}>
                                  <div className="bg-[#4338ca]" style={{ width: `${Math.round((z.fixedPerPanel / z.costPerPanel) * 100)}%` }} />
                                  <div className="bg-[#9a3412] flex-1" />
                                </div>
                              </td>
                              <td className="px-5 py-2.5 text-right tabular-nums font-bold text-[#1a1a2e]">{eur(z.costPerPanel)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    <p className="px-5 py-2 bg-[#faf9f8] text-[10px] text-[#9b9b93] leading-snug">
                      Coût <b>estimé</b> (la feuille ne ventile pas par zone) : le fixe (<span className="text-[#4338ca]">■</span> salaire/leasing/dépôt) est réparti à plat par panneau ; le variable (<span className="text-[#9a3412]">■</span> carburant/péages) au prorata de la distance depuis Bourges. Les zones les plus chères/panneau et les plus lointaines sont les meilleures candidates à la <b>sous-traitance 3PL</b> (vs faire rouler ton camion).
                    </p>
                  </div>
                )
              })()}

              {/* Testeur de grille 3PL — sur les vraies commandes */}
              {data.gridStops.length > 0 && (() => {
                const zoneOf = (km: number) => km <= 100 ? 0 : km <= 300 ? 1 : 2
                const bucketOf = (p: number) => p <= 3 ? 0 : p <= 7 ? 1 : p <= 12 ? 2 : 3
                const vat = Math.max(0, Number(vatRate) || 0) / 100
                const intVatPct = Math.max(0, Math.min(100, Number(intVat) || 0)) / 100

                // Filtre mois
                const stops = gridMonth ? data.gridStops.filter(st => st.month === gridMonth) : data.gridStops

                let entered = 0, panels = 0
                const zoneTot = [0, 0, 0], zoneN = [0, 0, 0]
                for (const st of stops) {
                  const zi = zoneOf(st.km), bi = bucketOf(st.panels)
                  const price = grid[zi]?.[bi] ?? 0
                  entered += price; panels += st.panels
                  zoneTot[zi] += price; zoneN[zi] += 1
                }
                // HT / TTC : prix saisis HT → coût réel = HT (TVA récupérée) ; sinon on dé-TVA.
                const gridHTtotal = gridHT ? entered : entered / (1 + vat)
                const gridTTCtotal = gridHT ? entered * (1 + vat) : entered

                // Coût interne de référence (mois choisi sinon période), feuille = TTC.
                const monthRow = gridMonth ? data.months.find(m => m.month === gridMonth) : null
                const internalTTC = gridMonth ? (monthRow?.cost ?? 0) : s.totalCost
                const internalPanels = gridMonth ? (monthRow?.panels ?? 0) : s.totalPanels
                const internalReal = Math.round(internalTTC * (1 - intVatPct)) // net de TVA récupérable

                // Comparaison sur la base « coût réel » (3PL HT vs interne net de TVA récup.)
                const gridReal = Math.round(gridHTtotal)
                const delta = internalReal - gridReal   // >0 = grille moins chère
                const gridPerPanel = panels > 0 ? Math.round(gridHTtotal / panels) : 0
                const intPerPanel = internalPanels > 0 ? Math.round(internalReal / internalPanels) : 0
                const periodLabel = gridMonth ? monthLabel(gridMonth) : `${s.monthsCount} mois`

                return (
                  <div className="rounded-2xl bg-white border border-[#e8e8e4] overflow-hidden">
                    <div className="px-5 py-3 border-b border-[#f0efec]">
                      <p className="text-[11px] font-semibold uppercase tracking-[0.1em] text-[#6b6b63]">🧮 Testeur de grille 3PL — sur tes vraies commandes</p>
                    </div>
                    <div className="px-5 py-4 space-y-4">
                      {/* Contrôles */}
                      <div className="flex flex-wrap items-end gap-4">
                        <label className="flex flex-col gap-1">
                          <span className="text-[10px] font-semibold text-[#6b6b63]">Période simulée</span>
                          <select value={gridMonth} onChange={e => setGridMonth(e.target.value)}
                            className="text-sm font-semibold rounded-lg px-2 py-1.5 border border-[#e8e8e4] bg-white outline-none">
                            <option value="">Toute la période ({s.monthsCount} mois)</option>
                            {data.months.filter(m => m.cost > 0 && m.orders > 0).map(m => (
                              <option key={m.month} value={m.month}>{monthLabel(m.month)}</option>
                            ))}
                          </select>
                        </label>
                        <label className="flex flex-col gap-1">
                          <span className="text-[10px] font-semibold text-[#6b6b63]">Prix de la grille</span>
                          <select value={gridHT ? 'ht' : 'ttc'} onChange={e => setGridHT(e.target.value === 'ht')}
                            className="text-sm font-semibold rounded-lg px-2 py-1.5 border border-[#e8e8e4] bg-white outline-none">
                            <option value="ht">HT (TVA récupérée)</option>
                            <option value="ttc">TTC</option>
                          </select>
                        </label>
                        <label className="flex flex-col gap-1">
                          <span className="text-[10px] font-semibold text-[#6b6b63]">TVA</span>
                          <div className="flex items-center gap-1"><input type="number" min={0} value={vatRate} onChange={e => setVatRate(e.target.value)} className="w-16 text-sm font-semibold rounded-lg px-2 py-1.5 border border-[#e8e8e4] outline-none" /><span className="text-[10px] text-[#9b9b93]">%</span></div>
                        </label>
                        <label className="flex flex-col gap-1">
                          <span className="text-[10px] font-semibold text-[#6b6b63]" title="Part de TVA récupérable dans ton coût interne (carburant, péages, leasing…). Les salaires n'ont pas de TVA.">TVA récup. interne</span>
                          <div className="flex items-center gap-1"><input type="number" min={0} max={100} value={intVat} onChange={e => setIntVat(e.target.value)} className="w-16 text-sm font-semibold rounded-lg px-2 py-1.5 border border-[#e8e8e4] outline-none" /><span className="text-[10px] text-[#9b9b93]">%</span></div>
                        </label>
                      </div>

                      {/* Grille éditable */}
                      <div className={`inline-flex items-center gap-2 text-xs font-semibold px-3 py-1.5 rounded-lg ${gridHT ? 'bg-[#eef2ff] text-[#4338ca]' : 'bg-[#fff7ed] text-[#9a3412]'}`}>
                        ✏️ Tu saisis des prix en <span className="text-sm font-bold">€ {gridHT ? 'HT' : 'TTC'}</span> par adresse livrée
                        <span className="text-[10px] font-normal opacity-70">(change avec « Prix de la grille » ci-dessus)</span>
                      </div>
                      <div className="overflow-x-auto">
                        <table className="text-sm border-collapse">
                          <thead>
                            <tr>
                              <th className="text-left text-[10px] uppercase tracking-wider text-[#9b9b93] font-semibold px-2 py-1">Zone \ Panneaux → <span className="text-[#1a1a2e]">€ {gridHT ? 'HT' : 'TTC'}</span></th>
                              {GRID_BUCKETS.map(b => <th key={b} className="text-center text-[10px] uppercase tracking-wider text-[#9b9b93] font-semibold px-2 py-1">{b}</th>)}
                            </tr>
                          </thead>
                          <tbody>
                            {GRID_ZONES.map((z, zi) => (
                              <tr key={z}>
                                <td className="text-xs font-semibold text-[#1a1a2e] px-2 py-1 whitespace-nowrap">{z}</td>
                                {GRID_BUCKETS.map((_, bi) => (
                                  <td key={bi} className="px-1 py-1">
                                    <input type="number" min={0} value={grid[zi][bi]} onChange={e => setGridCell(zi, bi, e.target.value)}
                                      className="w-20 text-sm text-center font-semibold rounded-lg px-2 py-1.5 border border-[#e8e8e4] outline-none focus:ring-2 focus:ring-[#1a1a2e]/20" />
                                  </td>
                                ))}
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>

                      {/* Résultats */}
                      <div className="grid sm:grid-cols-3 gap-3">
                        <div className="rounded-xl bg-[#f8f7f5] border border-[#e8e8e4] px-4 py-3">
                          <p className="text-[10px] font-semibold uppercase tracking-wider text-[#9b9b93]">Grille — coût réel ({periodLabel})</p>
                          <p className="text-2xl font-bold text-[#1a1a2e] tabular-nums">{eur(gridReal)}</p>
                          <p className="text-[10px] text-[#9b9b93]">{eur(gridPerPanel)}/panneau · {eur(Math.round(gridTTCtotal))} TTC décaissé</p>
                        </div>
                        <div className="rounded-xl bg-[#f8f7f5] border border-[#e8e8e4] px-4 py-3">
                          <p className="text-[10px] font-semibold uppercase tracking-wider text-[#9b9b93]">Interne ({periodLabel})</p>
                          <p className="text-2xl font-bold text-[#1a1a2e] tabular-nums">{eur(internalReal)}</p>
                          <p className="text-[10px] text-[#9b9b93]">{eur(intPerPanel)}/panneau {intVatPct > 0 ? '(net TVA)' : '(TTC feuille)'}</p>
                        </div>
                        <div className={`rounded-xl px-4 py-3 border ${delta >= 0 ? 'bg-[#f0fdf4] border-[#bbf7d0]' : 'bg-[#fef2f2] border-[#fecaca]'}`}>
                          <p className="text-[10px] font-semibold uppercase tracking-wider text-[#9b9b93]">Verdict {periodLabel}</p>
                          <p className={`text-2xl font-bold tabular-nums ${delta >= 0 ? 'text-[#1a7f4b]' : 'text-[#c7293a]'}`}>{delta >= 0 ? '−' : '+'}{eur(Math.abs(delta))}</p>
                          <p className="text-[10px] text-[#9b9b93]">{delta >= 0 ? 'moins cher que l’interne ✅' : 'plus cher que l’interne ⚠'}</p>
                        </div>
                      </div>

                      {/* Répartition par zone */}
                      <div className="text-[11px] text-[#6b6b63] flex flex-wrap gap-x-4 gap-y-1">
                        <span className="font-semibold">{stops.length} livraisons :</span>
                        {GRID_ZONES.map((z, zi) => (
                          <span key={z}>{z} : <b className="text-[#1a1a2e]">{zoneN[zi]}</b></span>
                        ))}
                      </div>
                      <p className="text-[10px] text-[#9b9b93] leading-snug">
                        Comparaison en <b>coût réel</b> : grille en HT (tu récupères la TVA), interne ajusté de la « TVA récup. interne »
                        (mets ~10 % si tu veux tenir compte de la TVA sur carburant/péages/leasing ; les salaires, ~27 % du coût, n&apos;ont pas de TVA). Distance depuis Bordeaux.
                      </p>
                    </div>
                  </div>
                )
              })()}

              {/* Simulateur sous-traitance */}
              <div className="rounded-2xl bg-white border border-[#e8e8e4] overflow-hidden">
                <div className="px-5 py-3 border-b border-[#f0efec] flex items-center gap-2">
                  <TrendingDown size={14} className="text-[#1a7f4b]" />
                  <p className="text-[11px] font-semibold uppercase tracking-[0.1em] text-[#6b6b63]">Sous-traiter à un 3PL ? — simulateur</p>
                </div>
                <div className="px-5 py-4 space-y-4">
                  <div className="flex items-end gap-3 flex-wrap">
                    <label className="flex flex-col gap-1">
                      <span className="text-[11px] font-semibold text-[#6b6b63]">Devis 3PL (€ / panneau livré)</span>
                      <input
                        type="number" min={0} value={quote}
                        onChange={e => setQuote(e.target.value)}
                        placeholder="ex. 18"
                        className="w-40 text-sm font-semibold rounded-lg px-3 py-2 border border-[#e8e8e4] outline-none focus:ring-2 focus:ring-[#1a1a2e]/20"
                      />
                    </label>
                    <div className="text-[11px] text-[#6b6b63] max-w-md leading-snug">
                      Ton coût interne actuel est de <b className="text-[#1a1a2e]">{eur(s.avgCostPerPanel)}/panneau</b> (coût complet).
                      Si un transporteur facture moins, la sous-traitance fait économiser — <b>mais</b> seule la part variable
                      (<b className="text-[#9a3412]">{eur(s.variableCostPerPanel)}/panneau</b>) disparaît vraiment à court terme : le fixe
                      (leasing, dépôts, salaire) reste tant que tu n&apos;as pas résilié/revendu.
                    </div>
                  </div>

                  {sim && (
                    <div className={`rounded-xl px-4 py-3 border ${sim.deltaMonthly >= 0 ? 'bg-[#f0fdf4] border-[#bbf7d0]' : 'bg-[#fef2f2] border-[#fecaca]'}`}>
                      <div className="flex items-center gap-2 mb-1">
                        {sim.deltaMonthly >= 0 ? <TrendingDown size={15} className="text-[#1a7f4b]" /> : <TrendingUp size={15} className="text-[#c7293a]" />}
                        <p className={`text-sm font-bold ${sim.deltaMonthly >= 0 ? 'text-[#1a7f4b]' : 'text-[#c7293a]'}`}>
                          {sim.deltaMonthly >= 0
                            ? `Sous-traiter ferait économiser ~${eur(sim.deltaMonthly)}/mois`
                            : `Sous-traiter coûterait ~${eur(-sim.deltaMonthly)}/mois de plus`}
                        </p>
                      </div>
                      <p className="text-[11px] text-[#6b6b63]">
                        3PL estimé : <b>{eur(sim.extMonthly)}/mois</b> ({sim.q}€ × {Math.round(s.totalPanels / Math.max(1, s.monthsCount))} panneaux/mois) ·
                        interne actuel : <b>{eur(sim.curMonthly)}/mois</b> (coût complet).
                      </p>
                      <p className="text-[11px] text-[#9b9b93] mt-1 flex items-start gap-1">
                        <Info size={12} className="mt-0.5 shrink-0" />
                        Comparaison en coût complet. Tant que le fixe n&apos;est pas supprimé, le vrai seuil de bascule immédiat est le coût variable ({eur(s.variableCostPerPanel)}/panneau).
                      </p>
                    </div>
                  )}
                </div>
              </div>

              <p className="text-[11px] text-[#9b9b93] px-1">
                Base de coût : feuille « Coût du transport » (synchro auto). Volumes : livraisons pointées dans le module Delivery.
                Période comparable : {s.monthsCount} mois · {s.totalOrders} commandes · {s.totalPanels} panneaux · {eur(s.totalCost)} de transport.
              </p>
            </>
          )
        })()}
      </main>
    </div>
  )
}
