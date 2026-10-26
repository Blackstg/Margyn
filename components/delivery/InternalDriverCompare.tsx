'use client'

import { useEffect, useMemo, useState } from 'react'
import { Save, Info } from 'lucide-react'

// Onglet « Moha » : garder un chauffeur indépendant payé à la journée (sur
// notre camion, avec notre CB) ou confier ses tournées à Terence (grille).
// Le coût Terence est calculé par l'API subcontract sur les livraisons réelles
// de ces tournées (?drivers=…), avec les mêmes règles que sa facture.

type Internal = {
  dayRate: number; askedRate: number; fuelPerKm: number; tollPerKm: number; hotelNight: number; mealsPerDay: number
  travelDays: number; truckMonthly: number; depotMonthly: number; adminHours: number; hourlyRate: number; toursPerMonth: number
  daysByTour: Record<string, number>; nightsByTour: Record<string, number>
}
type Tour = {
  id: string; name: string; driver: string; plannedDate: string; totalKm: number
  costs: Record<string, number | null>
  deliveryDays: string[]; delivered: number; failed: number; billed: number; panels: number
  terenceHT: number; toQuote: number; revenueHT: number
}
type Data = { allDrivers: string[]; tours: Tour[]; settings: { name: string; internal: Internal } }

const FROM = '2026-08-01'
const eur = (n: number | null | undefined) =>
  n == null || !isFinite(n) ? '—' : Math.round(n).toLocaleString('fr-FR') + ' €'
const signed = (n: number) => `${n > 0 ? '+' : n < 0 ? '−' : ''}${eur(Math.abs(n))}`
const dayFr = (d: string) => new Date(d + 'T12:00:00').toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' })
const todayParis = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Paris' })

const FIELDS: { key: keyof Internal; label: string; unit: string; step?: number }[] = [
  { key: 'dayRate', label: 'Tarif actuel', unit: '€/jour' },
  { key: 'askedRate', label: 'Tarif demandé', unit: '€/jour' },
  { key: 'fuelPerKm', label: 'Carburant', unit: '€/km', step: 0.01 },
  { key: 'tollPerKm', label: 'Péages', unit: '€/km', step: 0.01 },
  { key: 'hotelNight', label: 'Hôtel', unit: '€/nuit' },
  { key: 'mealsPerDay', label: 'Repas midi + soir', unit: '€/jour' },
  { key: 'travelDays', label: 'Jours aller/retour (en plus des jours de livraison)', unit: 'jours' },
  { key: 'truckMonthly', label: 'Camion (leasing, assurance, entretien)', unit: '€/mois' },
  { key: 'depotMonthly', label: 'Loyer dépôt Bourges', unit: '€/mois' },
  { key: 'adminHours', label: 'Temps de gestion (tickets, notes de frais…)', unit: 'h/mois' },
  { key: 'hourlyRate', label: 'Coût de ce temps', unit: '€/h' },
  { key: 'toursPerMonth', label: 'Tournées par mois', unit: 'tournées' },
]

export default function InternalDriverCompare({ brand }: { brand: string }) {
  const [drivers, setDrivers] = useState<string[]>(['moha'])
  const [data, setData] = useState<Data | null>(null)
  const [p, setP] = useState<Internal | null>(null)
  const [dirty, setDirty] = useState(false)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    setLoading(true); setError(null)
    fetch(`/api/delivery/subcontract?brand=${brand}&from=${FROM}&to=${todayParis()}&drivers=${encodeURIComponent(drivers.join(','))}`)
      .then(r => r.json())
      .then(d => { if (d.error) throw new Error(d.error); setData(d); setP(prev => prev ?? d.settings.internal) })
      .catch(e => setError(e instanceof Error ? e.message : 'Erreur'))
      .finally(() => setLoading(false))
  }, [brand, drivers])

  const set = (patch: Partial<Internal>) => { setP(prev => prev ? { ...prev, ...patch } : prev); setDirty(true) }

  async function save() {
    if (!p) return
    setSaving(true)
    try {
      const r = await fetch('/api/delivery/subcontract', {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ brand, internal: p }),
      })
      const j = await r.json()
      if (!r.ok || j.error) throw new Error(j.error ?? 'Erreur')
      setDirty(false)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erreur')
    } finally {
      setSaving(false)
    }
  }

  const internalDrivers = useMemo(() => (data?.allDrivers ?? []).filter(d => !/^terence/i.test(d)), [data])

  // Coût d'une tournée faite par le chauffeur interne, à un tarif journalier donné.
  // Frais réels saisis sur la tournée si présents, sinon estimation au km / à la nuit.
  const rows = useMemo(() => {
    if (!data || !p) return []
    return data.tours.map(t => {
      const days = p.daysByTour[t.id] ?? Math.max(1, t.deliveryDays.length) + p.travelDays
      const nights = p.nightsByTour[t.id] ?? Math.max(0, days - 1)
      const fuel = t.costs.fuel ?? t.totalKm * p.fuelPerKm
      const toll = t.costs.toll ?? t.totalKm * p.tollPerKm
      const stay = t.costs.hotel != null || t.costs.meal != null
        ? (t.costs.hotel ?? 0) + (t.costs.meal ?? 0)
        : nights * p.hotelNight + days * p.mealsPerDay
      const expenses = fuel + toll + stay
      return { t, days, nights, expenses, at: (rate: number) => days * rate + expenses }
    })
  }, [data, p])

  const agg = useMemo(() => {
    if (!p || rows.length === 0) return null
    const n = rows.length
    const avgDays = rows.reduce((a, r) => a + r.days, 0) / n
    const avgExpenses = rows.reduce((a, r) => a + r.expenses, 0) / n
    const avgTerence = rows.reduce((a, r) => a + r.t.terenceHT, 0) / n
    const avgDeliveries = rows.reduce((a, r) => a + r.t.billed, 0) / n
    // Coûts qui n'existent que si on garde une activité interne (supprimés en full Terence)
    const fixed = p.truckMonthly + p.depotMonthly + p.adminHours * p.hourlyRate
    const internalMonth = (rate: number, tours = p.toursPerMonth) => tours * (avgDays * rate + avgExpenses) + fixed
    const terenceMonth = (tours = p.toursPerMonth) => tours * avgTerence
    // Nombre de tournées/mois à partir duquel l'interne devient moins cher
    const breakEvenTours = (rate: number) => {
      const gain = avgTerence - (avgDays * rate + avgExpenses)
      return gain > 0 ? fixed / gain : null
    }
    return { n, avgDays, avgExpenses, avgTerence, avgDeliveries, fixed, internalMonth, terenceMonth, breakEvenTours }
  }, [rows, p])

  const name = data?.settings.name ?? 'Terence'
  const who = drivers.length === 1 ? drivers[0].charAt(0).toUpperCase() + drivers[0].slice(1) : 'le chauffeur interne'

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-3">
        <p className="text-xs text-[#6b6b63] flex-1 min-w-[220px]">
          Garder <b>{who}</b> (payé à la journée, sur notre camion avec notre CB) ou tout confier à <b>{name}</b> ?
          Le coût {name} est calculé avec sa grille sur les <b>mêmes livraisons</b> que ces tournées.
        </p>
        <div className="flex flex-wrap gap-1.5">
          {internalDrivers.map(d => {
            const on = drivers.includes(d.toLowerCase())
            return (
              <button key={d} disabled={loading}
                onClick={() => setDrivers(cur => on ? (cur.length > 1 ? cur.filter(x => x !== d.toLowerCase()) : cur) : [...cur, d.toLowerCase()])}
                className={`text-xs px-2.5 py-1 rounded-full border ${on ? 'bg-[#1a1a2e] text-white border-[#1a1a2e]' : 'bg-white text-[#6b6b63] border-[#e0e0e0] hover:border-[#1a1a2e]'}`}>
                {on ? '✓ ' : ''}{d}
              </button>
            )
          })}
        </div>
      </div>

      {error && <div className="rounded-xl bg-[#fce8ea] border border-[#fecaca] px-4 py-3 text-xs text-[#c7293a]">{error}</div>}
      {loading && !data && <div className="space-y-3">{[1, 2].map(i => <div key={i} className="h-28 bg-[#f3f3f1] rounded-2xl animate-pulse" />)}</div>}
      {data && p && rows.length === 0 && !loading && (
        <p className="rounded-2xl bg-white border border-[#e8e8e4] px-5 py-8 text-center text-sm text-[#9b9b93]">Aucune tournée de ce chauffeur depuis août.</p>
      )}

      {data && p && agg && (
        <div className={`space-y-5 ${loading ? 'opacity-60 pointer-events-none' : ''}`}>
          {/* Verdict mensuel */}
          {(() => {
            const cur = agg.internalMonth(p.dayRate), ask = agg.internalMonth(p.askedRate), ter = agg.terenceMonth()
            const card = (label: string, value: number, sub: string, diff?: number) => (
              <div className="rounded-2xl px-5 py-4 bg-white border border-[#e8e8e4]">
                <p className="text-[10px] font-semibold uppercase tracking-[0.1em] text-[#9b9b93]">{label}</p>
                <p className="text-3xl font-bold mt-1 tabular-nums text-[#1a1a2e]">{eur(value)}<span className="text-sm font-medium text-[#9b9b93]"> /mois</span></p>
                <p className="text-[11px] mt-0.5 text-[#9b9b93]">{sub}</p>
                {diff != null && (
                  <p className={`text-xs font-semibold mt-1 ${diff > 0 ? 'text-[#c7293a]' : 'text-[#1f7a5a]'}`}>
                    {diff > 0 ? `${eur(diff)} de plus que ${name}` : `${eur(-diff)} d'économie vs ${name}`}
                  </p>
                )}
              </div>
            )
            const verdictAsk = ask - ter
            return (
              <>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  {card(`${who} à ${p.dayRate} €/j`, cur, `${p.toursPerMonth} tournées + camion + dépôt + gestion`, cur - ter)}
                  {card(`${who} à ${p.askedRate} €/j`, ask, 'au tarif qu’il demande', ask - ter)}
                  {card(`Tout chez ${name}`, ter, `${eur(agg.avgTerence)} par tournée · ni camion, ni dépôt, ni gestion`)}
                </div>
                {(() => {
                  const be = agg.breakEvenTours(p.askedRate), beNow = agg.breakEvenTours(p.dayRate)
                  const fmt = (n: number) => n.toLocaleString('fr-FR', { maximumFractionDigits: 1 })
                  return (
                    <div className={`rounded-2xl px-5 py-4 border ${verdictAsk > 0 ? 'bg-[#fdf3f4] border-[#f5c9cf]' : 'bg-[#eef8f3] border-[#c5e6d6]'}`}>
                      <p className="text-sm text-[#1a1a2e]">
                        {be == null
                          ? <>Au tarif demandé, une tournée de {who} coûte déjà plus cher qu&apos;avec {name} : <b>full {name}</b>.</>
                          : <>Au tarif demandé ({p.askedRate} €/j), garder {who} n&apos;est rentable qu&apos;<b>à partir de {fmt(be)} tournées par mois</b>
                            {beNow != null && <> ({fmt(beNow)} à {p.dayRate} €/j)</>}. En dessous, camion + dépôt + gestion ({eur(agg.fixed)}/mois) mangent l&apos;économie faite sur chaque tournée.</>}
                      </p>
                      <p className="text-xs text-[#1a1a2e] mt-1.5">
                        À {p.toursPerMonth} tournée{p.toursPerMonth > 1 ? 's' : ''}/mois :{' '}
                        {verdictAsk > 0
                          ? <><b>{name} moins cher de {eur(verdictAsk)}/mois</b></>
                          : <><b>{who} moins cher de {eur(-verdictAsk)}/mois</b> — soit {eur(-verdictAsk / Math.max(1, p.toursPerMonth))} par tournée pour gérer le gars, ses tickets et le camion.</>}
                      </p>
                      <p className="text-[11px] text-[#6b6b63] mt-1">
                        Une tournée interne coûte en moyenne {eur(agg.avgDays * p.askedRate + agg.avgExpenses)} ({fmt(agg.avgDays)} jours) contre {eur(agg.avgTerence)} chez {name} sur les mêmes livraisons.
                      </p>
                    </div>
                  )
                })()}
              </>
            )
          })()}

          {/* Sensibilité au nombre de tournées */}
          <div className="rounded-2xl bg-white border border-[#e8e8e4] overflow-hidden">
            <p className="px-5 py-3 text-[11px] font-semibold uppercase tracking-[0.1em] text-[#6b6b63] border-b border-[#efefec]">Selon le nombre de tournées par mois</p>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-[11px] text-[#9b9b93]">
                    <th className="text-left font-semibold px-5 py-2">Tournées / mois</th>
                    <th className="text-right font-semibold px-3 py-2">{who} {p.dayRate} €/j</th>
                    <th className="text-right font-semibold px-3 py-2">{who} {p.askedRate} €/j</th>
                    <th className="text-right font-semibold px-3 py-2">{name}</th>
                    <th className="text-right font-semibold px-5 py-2">Écart au tarif demandé</th>
                  </tr>
                </thead>
                <tbody>
                  {[1, 2, 3, 4, 5, 6].map(n => {
                    const ask = agg.internalMonth(p.askedRate, n), ter = agg.terenceMonth(n)
                    return (
                      <tr key={n} className={`border-t border-[#f3f3f1] ${n === p.toursPerMonth ? 'bg-[#f7f7f5] font-semibold' : ''}`}>
                        <td className="px-5 py-2 tabular-nums">{n}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{eur(agg.internalMonth(p.dayRate, n))}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{eur(ask)}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{eur(ter)}</td>
                        <td className={`px-5 py-2 text-right tabular-nums ${ask > ter ? 'text-[#c7293a]' : 'text-[#1f7a5a]'}`}>
                          {ask > ter ? `${name} moins cher de ${eur(ask - ter)}` : `${who} moins cher de ${eur(ter - ask)}`}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </div>

          {/* Détail par tournée */}
          <div className="rounded-2xl bg-white border border-[#e8e8e4] overflow-hidden">
            <p className="px-5 py-3 text-[11px] font-semibold uppercase tracking-[0.1em] text-[#6b6b63] border-b border-[#efefec]">Tournées réelles · coût interne vs {name}</p>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-[11px] text-[#9b9b93] text-left">
                    <th className="font-semibold px-5 py-2">Tournée</th>
                    <th className="font-semibold px-3 py-2 text-right">Km</th>
                    <th className="font-semibold px-3 py-2 text-right">Livraisons</th>
                    <th className="font-semibold px-3 py-2 text-right" title="Jours payés au chauffeur">Jours</th>
                    <th className="font-semibold px-3 py-2 text-right" title="Nuits dehors (hôtel + repas)">Nuits</th>
                    <th className="font-semibold px-3 py-2 text-right" title="Carburant + péages + hôtel/repas payés avec notre CB">Frais CB</th>
                    <th className="font-semibold px-3 py-2 text-right">Interne {p.askedRate} €/j</th>
                    <th className="font-semibold px-3 py-2 text-right">{name}</th>
                    <th className="font-semibold px-5 py-2 text-right">Écart</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map(r => {
                    const cost = r.at(p.askedRate), diff = cost - r.t.terenceHT
                    const per = r.t.billed > 0 ? r.t.terenceHT / r.t.billed : null
                    return (
                      <tr key={r.t.id} className="border-t border-[#f3f3f1] align-top">
                        <td className="px-5 py-2">
                          <span className="font-medium text-[#1a1a2e]">{r.t.driver}</span>
                          <span className="block text-[11px] text-[#9b9b93]">
                            {r.t.deliveryDays.length ? r.t.deliveryDays.map(dayFr).join(', ') : dayFr(r.t.plannedDate)}
                          </span>
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums text-[#6b6b63]">{r.t.totalKm.toLocaleString('fr-FR')}</td>
                        <td className="px-3 py-2 text-right tabular-nums">
                          {r.t.billed}
                          <span className="block text-[11px] text-[#9b9b93]">{r.t.panels} pann.{r.t.failed > 0 ? ` · ${r.t.failed} échec` : ''}</span>
                        </td>
                        <td className="px-3 py-2 text-right">
                          <input type="number" min={0} value={r.days}
                            onChange={e => set({ daysByTour: { ...p.daysByTour, [r.t.id]: Math.max(0, Number(e.target.value) || 0) } })}
                            className="w-14 text-right border border-[#e0e0e0] rounded-[6px] px-1.5 py-0.5 text-sm" />
                        </td>
                        <td className="px-3 py-2 text-right">
                          <input type="number" min={0} value={r.nights}
                            onChange={e => set({ nightsByTour: { ...p.nightsByTour, [r.t.id]: Math.max(0, Number(e.target.value) || 0) } })}
                            className="w-14 text-right border border-[#e0e0e0] rounded-[6px] px-1.5 py-0.5 text-sm" />
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums text-[#6b6b63]">{eur(r.expenses)}</td>
                        <td className="px-3 py-2 text-right tabular-nums font-semibold text-[#1a1a2e]">
                          {eur(cost)}
                          {r.t.billed > 0 && <span className="block text-[11px] font-normal text-[#9b9b93]">{eur(cost / r.t.billed)} / livr.</span>}
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums font-semibold text-[#1a1a2e]">
                          {eur(r.t.terenceHT)}
                          {per != null && <span className="block text-[11px] font-normal text-[#9b9b93]">{eur(per)} / livr.</span>}
                          {r.t.toQuote > 0 && <span className="block text-[11px] font-normal text-[#8a5a00]">+ {r.t.toQuote} sur devis</span>}
                        </td>
                        <td className={`px-5 py-2 text-right tabular-nums font-semibold ${diff > 0 ? 'text-[#c7293a]' : 'text-[#1f7a5a]'}`}>{signed(diff)}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
            <p className="px-5 py-2.5 text-[11px] text-[#9b9b93] border-t border-[#f3f3f1] flex items-start gap-1.5">
              <Info size={12} className="mt-0.5 shrink-0" />
              Hors camion et temps de gestion (comptés dans le mensuel). Écart positif = la tournée interne coûte plus cher que {name}. Jours et nuits modifiables par tournée.
            </p>
          </div>

          {/* Hypothèses */}
          <div className="rounded-2xl bg-white border border-[#e8e8e4] px-5 py-4 space-y-3">
            <div className="flex items-center gap-2">
              <p className="text-[11px] font-semibold uppercase tracking-[0.1em] text-[#6b6b63] flex-1">Hypothèses</p>
              {dirty && (
                <button onClick={save} disabled={saving}
                  className="inline-flex items-center gap-1 text-xs px-3 py-1.5 rounded-[8px] bg-[#1a1a2e] text-white disabled:opacity-40">
                  <Save size={12} /> Enregistrer
                </button>
              )}
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-x-6 gap-y-2">
              {FIELDS.map(f => (
                <label key={f.key} className="flex items-center gap-2 text-xs text-[#1a1a2e]">
                  <span className="flex-1">{f.label}</span>
                  <input type="number" min={0} step={f.step ?? 1} value={p[f.key] as number}
                    onChange={e => set({ [f.key]: Math.max(0, Number(e.target.value) || 0) } as Partial<Internal>)}
                    className="w-20 text-right border border-[#e0e0e0] rounded-[6px] px-2 py-1 text-sm tabular-nums" />
                  <span className="w-16 text-[11px] text-[#9b9b93]">{f.unit}</span>
                </label>
              ))}
            </div>
            <p className="text-[11px] text-[#9b9b93] leading-relaxed">
              Carburant et péages au km : moyenne de la feuille transport mai–sept. 2026. Camion : leasing VW (1 268 €) + assurance (82 €) + entretien.
              Jours par défaut = jours de livraison + aller/retour ; nuits = jours − 1. Non chiffré : avec {name}, les représentations après absence ne sont pas refacturées ; le stock doit être au dépôt de Bordeaux.
            </p>
          </div>
        </div>
      )}
    </div>
  )
}
