'use client'

import { useEffect, useMemo, useState } from 'react'
import { Download, Save, Info } from 'lucide-react'

type Settings = {
  name: string
  depot: { label: string; lat: number; lng: number }
  zoneLimitsKm: [number, number]
  grid: number[][]
  drivers: string[]
  countStones: boolean
  startDate: string
  vatRate: number
}
type Line = {
  order: string; customer: string; city: string; zip: string; driver: string; date: string
  km: number | null; kmEstimated: boolean; zone: number | null
  panels: number; stones: number; billedQty: number; bucket: number; price: number | null
  attempts: number; note?: string
}
type Unbilled = { order: string; customer: string; city: string; driver: string; date: string | null; reason: string }
type Data = {
  month: string; settings: Settings; allDrivers: string[]; buckets: string[]
  lines: Line[]; unbilled: Unbilled[]
  summary: {
    orders: number; panels: number; totalHT: number; vat: number; totalTTC: number
    perPanel: number | null; perOrder: number | null; toQuote: number; estimatedKm: number; failedNotBilled: number
  }
  matrix: { count: number; amount: number }[][]
}

const ZONE_STYLE = ['bg-[#e3f4ee] text-[#1f7a5a]', 'bg-[#fbf0d9] text-[#8a5a00]', 'bg-[#e6eef6] text-[#2f5577]']
const eur = (n: number | null | undefined, d = 0) =>
  n == null ? '—' : n.toLocaleString('fr-FR', { minimumFractionDigits: d, maximumFractionDigits: d }) + ' €'
const dateFr = (iso: string | null) => iso ? new Date(iso).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' }) : '—'
const monthLong = (ym: string) => {
  const [y, m] = ym.split('-').map(Number)
  return new Date(y, m - 1, 1).toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' })
}

// Mois depuis le début de la collaboration jusqu'au mois courant (le plus récent en premier)
// (construit en chaînes YYYY-MM : toISOString() décalerait au mois précédent hors UTC)
const ym = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
function monthsSince(start: string): string[] {
  const out: string[] = []
  let [y, m] = start.slice(0, 7).split('-').map(Number)
  const end = ym(new Date())
  for (let s = `${y}-${String(m).padStart(2, '0')}`; s <= end; s = `${y}-${String(m).padStart(2, '0')}`) {
    out.unshift(s)
    if (++m > 12) { m = 1; y++ }
  }
  return out
}

export default function SubcontractBilling({ brand, internalCostPerPanel }: { brand: string; internalCostPerPanel: number | null }) {
  const [month, setMonth] = useState(() => ym(new Date()))
  const [data, setData] = useState<Data | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [reload, setReload] = useState(0)
  // Édition des réglages (grille, chauffeurs, feuilles de pierre)
  const [editGrid, setEditGrid] = useState<number[][] | null>(null)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    setLoading(true); setError(null)
    fetch(`/api/delivery/subcontract?brand=${brand}&month=${month}`)
      .then(r => r.json())
      .then(d => { if (d.error) throw new Error(d.error); setData(d) })
      .catch(e => setError(e instanceof Error ? e.message : 'Erreur'))
      .finally(() => setLoading(false))
  }, [brand, month, reload])

  async function saveSettings(patch: Partial<Pick<Settings, 'grid' | 'drivers' | 'countStones'>>) {
    setSaving(true)
    try {
      const r = await fetch('/api/delivery/subcontract', {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ brand, ...patch }),
      })
      const j = await r.json()
      if (!r.ok || j.error) throw new Error(j.error ?? 'Erreur')
      setEditGrid(null)
      setReload(n => n + 1)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erreur')
    } finally {
      setSaving(false)
    }
  }

  function toggleDriver(name: string) {
    if (!data) return
    const cur = new Set(data.settings.drivers)
    const key = name.toLowerCase()
    if (cur.has(key)) cur.delete(key); else cur.add(key)
    saveSettings({ drivers: [...cur] })
  }

  function exportCsv() {
    if (!data) return
    const zl = (z: number | null) => z == null ? 'Devis' : `Zone ${z + 1}`
    const rows = [
      ['Date', 'Commande', 'Client', 'Ville', 'CP', 'Chauffeur', 'Km route', 'Zone', 'Panneaux', 'Feuilles de pierre', 'Tranche', 'Prix HT', 'Remarque'],
      ...data.lines.map(l => [
        dateFr(l.date), l.order, l.customer, l.city, l.zip, l.driver,
        l.km == null ? '' : `${l.km}${l.kmEstimated ? ' (estimé)' : ''}`, zl(l.zone),
        l.panels, l.stones, data.buckets[l.bucket], l.price ?? '', l.note ?? '',
      ]),
      [],
      ['', '', '', '', '', '', '', '', '', '', 'Total HT', data.summary.totalHT],
      ['', '', '', '', '', '', '', '', '', '', `TVA ${data.settings.vatRate} %`, data.summary.vat],
      ['', '', '', '', '', '', '', '', '', '', 'Total TTC', data.summary.totalTTC],
    ]
    const csv = rows.map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(';')).join('\n')
    const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `livraisons-${(data.settings.name || 'sous-traitant').toLowerCase()}-${month}.csv`
    a.click()
    URL.revokeObjectURL(a.href)
  }

  const months = useMemo(() => monthsSince(data?.settings.startDate ?? '2026-10-01'), [data?.settings.startDate])
  const grid = editGrid ?? data?.settings.grid ?? []
  const s = data?.summary
  const [lim1, lim2] = data?.settings.zoneLimitsKm ?? [100, 300]
  const zoneLabels = [`Zone 1 · ≤ ${lim1} km`, `Zone 2 · ${lim1}–${lim2} km`, `Zone 3 · > ${lim2} km`]
  // Écart vs coût interne (au panneau) : >0 = Terence coûte moins cher
  const deltaPerPanel = s?.perPanel != null && internalCostPerPanel != null ? internalCostPerPanel - s.perPanel : null

  return (
    <div className="space-y-5">
      {/* Barre : mois + export */}
      <div className="flex flex-wrap items-center gap-3">
        <select value={month} onChange={e => setMonth(e.target.value)}
          className="text-sm border border-[#e0e0e0] rounded-[10px] px-3 py-2 bg-white font-medium text-[#1a1a2e] capitalize">
          {months.map(m => <option key={m} value={m} className="capitalize">{monthLong(m)}</option>)}
        </select>
        <p className="text-xs text-[#6b6b63] flex-1 min-w-[200px]">
          Ce qu&apos;on doit à <b>{data?.settings.name ?? 'Terence'}</b> pour les livraisons du mois, d&apos;après sa grille (départ Bordeaux, prix HT par commande).
        </p>
        <button onClick={exportCsv} disabled={!data || data.lines.length === 0}
          className="inline-flex items-center gap-1.5 text-sm px-3 py-2 rounded-[10px] bg-white border border-[#e0e0e0] text-[#1a1a2e] hover:bg-[#f5f5f3] disabled:opacity-40">
          <Download size={14} /> Export CSV
        </button>
      </div>

      {error && <div className="rounded-xl bg-[#fce8ea] border border-[#fecaca] px-4 py-3 text-xs text-[#c7293a]">{error}</div>}
      {loading && !data && <div className="space-y-3">{[1, 2].map(i => <div key={i} className="h-28 bg-[#f3f3f1] rounded-2xl animate-pulse" />)}</div>}

      {data && s && (
        <div className={`space-y-5 ${loading ? 'opacity-60 pointer-events-none' : ''}`}>
          {/* KPI */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <div className="rounded-2xl px-5 py-4 bg-[#1a1a2e] border border-[#1a1a2e]">
              <p className="text-[10px] font-semibold uppercase tracking-[0.1em] text-white/50">À payer · {monthLong(month)}</p>
              <p className="text-3xl font-bold mt-1 tabular-nums text-white">{eur(s.totalHT)} <span className="text-sm font-medium text-white/50">HT</span></p>
              <p className="text-[11px] mt-0.5 text-white/40">{eur(s.totalTTC, 2)} TTC (TVA {data.settings.vatRate} %)</p>
            </div>
            <div className="rounded-2xl px-5 py-4 bg-white border border-[#e8e8e4]">
              <p className="text-[10px] font-semibold uppercase tracking-[0.1em] text-[#9b9b93]">Commandes facturées</p>
              <p className="text-3xl font-bold mt-1 tabular-nums text-[#1a1a2e]">{s.orders}</p>
              <p className="text-[11px] mt-0.5 text-[#9b9b93]">{eur(s.perOrder)} en moyenne</p>
            </div>
            <div className="rounded-2xl px-5 py-4 bg-white border border-[#e8e8e4]">
              <p className="text-[10px] font-semibold uppercase tracking-[0.1em] text-[#9b9b93]">Panneaux livrés</p>
              <p className="text-3xl font-bold mt-1 tabular-nums text-[#1a1a2e]">{s.panels}</p>
              <p className="text-[11px] mt-0.5 text-[#9b9b93]">{s.perPanel != null ? `${eur(s.perPanel, 1)} / panneau` : '—'}</p>
            </div>
            <div className="rounded-2xl px-5 py-4 bg-white border border-[#e8e8e4]">
              <p className="text-[10px] font-semibold uppercase tracking-[0.1em] text-[#9b9b93]">vs coût interne</p>
              <p className={`text-3xl font-bold mt-1 tabular-nums ${deltaPerPanel == null ? 'text-[#1a1a2e]' : deltaPerPanel >= 0 ? 'text-[#1f7a5a]' : 'text-[#c7293a]'}`}>
                {deltaPerPanel == null ? '—' : `${deltaPerPanel >= 0 ? '−' : '+'}${eur(Math.abs(deltaPerPanel), 1)}`}
              </p>
              <p className="text-[11px] mt-0.5 text-[#9b9b93]">par panneau (interne : {eur(internalCostPerPanel)})</p>
            </div>
          </div>

          {/* Alertes */}
          {(s.toQuote > 0 || s.estimatedKm > 0 || s.failedNotBilled > 0) && (
            <div className="rounded-xl bg-white border border-[#e8e8e4] px-4 py-3 text-xs text-[#6b6b63] space-y-1">
              {s.failedNotBilled > 0 && <p>✓ <b>{s.failedNotBilled}</b> passage(s) en échec (absence, représentation) <b>non refacturé(s)</b>.</p>}
              {s.toQuote > 0 && <p className="text-[#8a5a00]">⚠ <b>{s.toQuote}</b> commande(s) hors grille (Corse / adresse non géolocalisée) : montant à fixer sur devis, non inclus dans le total.</p>}
              {s.estimatedKm > 0 && <p className="text-[#8a5a00]">⚠ <b>{s.estimatedKm}</b> distance(s) estimée(s) à vol d&apos;oiseau × 1,3 (routage indisponible) : vérifier la zone si proche d&apos;une limite.</p>}
            </div>
          )}

          {/* Grille × volume du mois */}
          <div className="rounded-2xl bg-white border border-[#e8e8e4] overflow-hidden">
            <div className="flex flex-wrap items-center gap-2 px-5 py-3 border-b border-[#efefec]">
              <p className="text-[11px] font-semibold uppercase tracking-[0.1em] text-[#6b6b63] flex-1">Grille tarifaire · prix HT par commande</p>
              {editGrid ? (
                <>
                  <button onClick={() => setEditGrid(null)} className="text-xs px-3 py-1.5 rounded-[8px] text-[#6b6b63] hover:text-[#1a1a2e]">Annuler</button>
                  <button onClick={() => saveSettings({ grid: editGrid })} disabled={saving}
                    className="inline-flex items-center gap-1 text-xs px-3 py-1.5 rounded-[8px] bg-[#1a1a2e] text-white disabled:opacity-40">
                    <Save size={12} /> Enregistrer la grille
                  </button>
                </>
              ) : (
                <button onClick={() => setEditGrid(data.settings.grid.map(r => r.slice()))}
                  className="text-xs px-3 py-1.5 rounded-[8px] border border-[#e0e0e0] text-[#1a1a2e] hover:bg-[#f5f5f3]">Modifier les prix</button>
              )}
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-[11px] text-[#9b9b93]">
                    <th className="text-left font-semibold px-5 py-2">Distance routière aller</th>
                    {data.buckets.map(b => <th key={b} className="text-right font-semibold px-4 py-2">{b} pann.</th>)}
                    <th className="text-right font-semibold px-5 py-2">Total zone</th>
                  </tr>
                </thead>
                <tbody>
                  {grid.map((row, z) => {
                    const zoneTotal = data.matrix[z]?.reduce((acc, c) => acc + c.amount, 0) ?? 0
                    const zoneCount = data.matrix[z]?.reduce((acc, c) => acc + c.count, 0) ?? 0
                    return (
                      <tr key={z} className="border-t border-[#f3f3f1]">
                        <td className="px-5 py-2.5"><span className={`text-xs font-semibold px-2 py-0.5 rounded-md ${ZONE_STYLE[z]}`}>{zoneLabels[z]}</span></td>
                        {row.map((price, b) => {
                          const cell = data.matrix[z]?.[b]
                          return (
                            <td key={b} className="px-4 py-2.5 text-right tabular-nums">
                              {editGrid ? (
                                <input type="number" min={0} value={price}
                                  onChange={e => setEditGrid(prev => { const n = prev!.map(r => r.slice()); n[z][b] = Math.max(0, Number(e.target.value) || 0); return n })}
                                  className="w-20 text-right border border-[#e0e0e0] rounded-[6px] px-2 py-1 text-sm" />
                              ) : (
                                <>
                                  <span className="font-semibold text-[#1a1a2e]">{eur(price)}</span>
                                  <span className={`block text-[11px] ${cell?.count ? 'text-[#4338ca]' : 'text-[#c4c4bc]'}`}>
                                    {cell?.count ? `× ${cell.count} = ${eur(cell.amount)}` : '—'}
                                  </span>
                                </>
                              )}
                            </td>
                          )
                        })}
                        <td className="px-5 py-2.5 text-right tabular-nums">
                          <span className="font-semibold text-[#1a1a2e]">{eur(zoneTotal)}</span>
                          <span className="block text-[11px] text-[#9b9b93]">{zoneCount} cmd</span>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
            <p className="px-5 py-2.5 text-[11px] text-[#9b9b93] border-t border-[#f3f3f1] flex items-start gap-1.5">
              <Info size={12} className="mt-0.5 shrink-0" />
              Zone = distance routière aller depuis le dépôt ({data.settings.depot.label}). Un seul forfait par commande, même si plusieurs passages ou chauffeurs. Accessoires et envois La Poste inclus dans le prix panneau (non refacturés).
            </p>
          </div>

          {/* Réglages : chauffeurs + feuilles de pierre */}
          <div className="rounded-2xl bg-white border border-[#e8e8e4] px-5 py-4 space-y-3">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.1em] text-[#6b6b63] mb-2">Tournées comptées chez {data.settings.name}</p>
              <div className="flex flex-wrap gap-1.5">
                {data.allDrivers.map(d => {
                  const on = data.settings.drivers.includes(d.toLowerCase())
                  return (
                    <button key={d} onClick={() => toggleDriver(d)} disabled={saving}
                      className={`text-xs px-2.5 py-1 rounded-full border ${on ? 'bg-[#1a1a2e] text-white border-[#1a1a2e]' : 'bg-white text-[#6b6b63] border-[#e0e0e0] hover:border-[#1a1a2e]'}`}>
                      {on ? '✓ ' : ''}{d}
                    </button>
                  )
                })}
              </div>
              <p className="text-[11px] text-[#9b9b93] mt-1.5">Coche les chauffeurs qui roulent pour {data.settings.name} (relais compris). Les autres tournées restent en coût interne.</p>
            </div>
            <label className="flex items-center gap-2 text-xs text-[#1a1a2e] cursor-pointer">
              <input type="checkbox" checked={data.settings.countStones} disabled={saving}
                onChange={e => saveSettings({ countStones: e.target.checked })} />
              Compter les feuilles de pierre comme des panneaux (sinon une commande « pierre seule » n&apos;est pas facturée)
            </label>
          </div>

          {/* Détail des commandes */}
          <div className="rounded-2xl bg-white border border-[#e8e8e4] overflow-hidden">
            <p className="px-5 py-3 text-[11px] font-semibold uppercase tracking-[0.1em] text-[#6b6b63] border-b border-[#efefec]">
              Détail · {data.lines.length} commande{data.lines.length > 1 ? 's' : ''} facturée{data.lines.length > 1 ? 's' : ''}
            </p>
            {data.lines.length === 0 ? (
              <p className="px-5 py-8 text-center text-sm text-[#9b9b93]">Aucune livraison de {data.settings.name} pointée sur ce mois.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-[11px] text-[#9b9b93] text-left">
                      <th className="font-semibold px-5 py-2">Livrée</th>
                      <th className="font-semibold px-3 py-2">Commande</th>
                      <th className="font-semibold px-3 py-2">Client · ville</th>
                      <th className="font-semibold px-3 py-2">Chauffeur</th>
                      <th className="font-semibold px-3 py-2 text-right">Km</th>
                      <th className="font-semibold px-3 py-2">Zone</th>
                      <th className="font-semibold px-3 py-2 text-right">Panneaux</th>
                      <th className="font-semibold px-5 py-2 text-right">Prix HT</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.lines.map(l => (
                      <tr key={l.order} className="border-t border-[#f3f3f1] align-top">
                        <td className="px-5 py-2 tabular-nums text-[#6b6b63]">{dateFr(l.date)}</td>
                        <td className="px-3 py-2 font-medium text-[#1a1a2e]">{l.order}</td>
                        <td className="px-3 py-2">
                          <span className="text-[#1a1a2e]">{l.customer}</span>
                          <span className="block text-[11px] text-[#9b9b93]">{l.city} {l.zip}</span>
                          {l.note && <span className="block text-[11px] text-[#8a5a00]">{l.note}</span>}
                        </td>
                        <td className="px-3 py-2 text-[#6b6b63]">{l.driver}</td>
                        <td className="px-3 py-2 text-right tabular-nums text-[#6b6b63]" title={l.kmEstimated ? 'Estimation vol d’oiseau × 1,3' : 'Distance routière'}>
                          {l.km == null ? '—' : `${l.kmEstimated ? '~' : ''}${l.km}`}
                        </td>
                        <td className="px-3 py-2">
                          {l.zone == null
                            ? <span className="text-xs font-semibold px-2 py-0.5 rounded-md bg-[#fce8ea] text-[#c7293a]">Devis</span>
                            : <span className={`text-xs font-semibold px-2 py-0.5 rounded-md ${ZONE_STYLE[l.zone]}`}>Z{l.zone + 1}</span>}
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums">
                          {l.billedQty}
                          {l.stones > 0 && <span className="block text-[11px] text-[#9b9b93]">{l.panels} pann. + {l.stones} pierre</span>}
                        </td>
                        <td className="px-5 py-2 text-right tabular-nums font-semibold text-[#1a1a2e]">{eur(l.price)}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr className="border-t-2 border-[#e8e8e4]">
                      <td colSpan={6} className="px-5 py-2.5 text-right text-xs font-semibold text-[#6b6b63]">Total HT</td>
                      <td className="px-3 py-2.5 text-right tabular-nums font-semibold">{s.panels}</td>
                      <td className="px-5 py-2.5 text-right tabular-nums font-bold text-[#1a1a2e]">{eur(s.totalHT)}</td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            )}
          </div>

          {/* Non facturés */}
          {data.unbilled.length > 0 && (
            <div className="rounded-2xl bg-white border border-[#e8e8e4] overflow-hidden">
              <p className="px-5 py-3 text-[11px] font-semibold uppercase tracking-[0.1em] text-[#6b6b63] border-b border-[#efefec]">
                Non facturé · {data.unbilled.length}
              </p>
              <table className="w-full text-sm">
                <tbody>
                  {data.unbilled.map(u => (
                    <tr key={u.order} className="border-t border-[#f3f3f1] first:border-t-0">
                      <td className="px-5 py-2 tabular-nums text-[#6b6b63] w-16">{dateFr(u.date)}</td>
                      <td className="px-3 py-2 font-medium text-[#1a1a2e] w-20">{u.order}</td>
                      <td className="px-3 py-2 text-[#1a1a2e]">{u.customer} <span className="text-[11px] text-[#9b9b93]">{u.city}</span></td>
                      <td className="px-3 py-2 text-[#6b6b63]">{u.driver}</td>
                      <td className="px-5 py-2 text-right text-xs text-[#6b6b63]">{u.reason}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
