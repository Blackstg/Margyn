'use client'

// Simulateur de grille sous-traitant : on rejoue les vraies livraisons (km, panneaux,
// CA) avec une contre-proposition (zones, tranches, forfait + prix au panneau) pour
// voir ce qu'elles auraient coûté. Rien n'est enregistré côté serveur : les scénarios
// restent dans le navigateur, la vraie grille se change dans « Modifier les prix ».
import { useEffect, useMemo, useState } from 'react'
import { Plus, Minus, Copy, Check, RotateCcw } from 'lucide-react'

export type SimLine = {
  order: string; km: number | null; zone: number | null; billedQty: number; units?: number; price: number | null
  revenueHT: number | null; shippingHT: number | null; cogs: number | null
}
type Scenario = {
  zoneLimitsKm: number[]   // bornes hautes des zones sauf la dernière (km route aller)
  tranches: number[]       // bornes hautes des tranches sauf la dernière (panneaux)
  grid: number[][]         // [zone][tranche] forfait HT
  perPanel: number[]       // [zone] € HT en plus par panneau
}

const STORE = 'steero:subcontract-sim'
const eur = (n: number, d = 0) => n.toLocaleString('fr-FR', { minimumFractionDigits: d, maximumFractionDigits: d }) + ' €'
const signed = (n: number) => `${n > 0 ? '+' : n < 0 ? '−' : ''}${eur(Math.abs(n))}`

const bucketOf = (bounds: number[], v: number) => { const i = bounds.findIndex(b => v <= b); return i < 0 ? bounds.length : i }
const trancheLabels = (t: number[]) => t.map((b, i) => { const lo = i ? t[i - 1] + 1 : 1; return lo === b ? `${b}` : `${lo} à ${b}` }).concat(`${(t.at(-1) ?? 0) + 1}+`)
const zoneLabels = (z: number[]) => z.map((b, i) => i ? `${z[i - 1]}–${b} km` : `≤ ${b} km`).concat(`> ${z.at(-1) ?? 0} km`)

// Prix d'une grille existante lu sur de nouvelles tranches : on prend la tranche
// d'origine qui contient la borne basse de la nouvelle
function regrid(old: Scenario, next: Omit<Scenario, 'grid' | 'perPanel'>): Scenario {
  const zl = zoneLabels(next.zoneLimitsKm).length, tl = trancheLabels(next.tranches).length
  const grid = Array.from({ length: zl }, (_, z) => {
    const kmLo = z ? next.zoneLimitsKm[z - 1] + 1 : 0
    const oz = bucketOf(old.zoneLimitsKm, kmLo)
    return Array.from({ length: tl }, (_, b) => old.grid[oz]?.[bucketOf(old.tranches, b ? next.tranches[b - 1] + 1 : 1)] ?? 0)
  })
  const perPanel = Array.from({ length: zl }, (_, z) => old.perPanel[bucketOf(old.zoneLimitsKm, z ? next.zoneLimitsKm[z - 1] + 1 : 0)] ?? 0)
  return { ...next, grid, perPanel }
}

function priceOf(sc: Scenario, km: number, qty: number) {
  const z = bucketOf(sc.zoneLimitsKm, km)
  return (sc.grid[z]?.[bucketOf(sc.tranches, qty)] ?? 0) + (sc.perPanel[z] ?? 0) * qty
}

export default function GridSimulator({ brand, current, monthLines, monthLabel, startDate }: {
  brand: string
  current: { zoneLimitsKm: number[]; grid: number[][] }
  monthLines: SimLine[]
  monthLabel: string
  startDate: string
}) {
  const base: Scenario = useMemo(() => ({ zoneLimitsKm: current.zoneLimitsKm, tranches: [3, 7, 12], grid: current.grid, perPanel: current.grid.map(() => 0) }), [current])
  const presets: { label: string; make: () => Scenario }[] = useMemo(() => [
    { label: 'Grille actuelle', make: () => base },
    { label: '1 panneau à part', make: () => {
      const s = regrid(base, { zoneLimitsKm: base.zoneLimitsKm, tranches: [1, 3, 7, 12] })
      s.grid = s.grid.map(r => [Math.round(r[0] * 0.65), ...r.slice(1)])
      return s
    } },
    { label: 'Forfait + au panneau', make: () => ({ zoneLimitsKm: base.zoneLimitsKm, tranches: [], grid: [[40], [50], [60]], perPanel: [8, 12, 22] }) },
  ], [base])

  const [sc, setSc] = useState<Scenario>(base)
  const [period, setPeriod] = useState<'month' | 'all'>('month')
  const [allLines, setAllLines] = useState<SimLine[] | null>(null)
  const [copied, setCopied] = useState(false)

  // Brouillon gardé dans ce navigateur
  useEffect(() => {
    try { const raw = localStorage.getItem(`${STORE}:${brand}`); if (raw) setSc(JSON.parse(raw)) } catch {}
  }, [brand])
  useEffect(() => { try { localStorage.setItem(`${STORE}:${brand}`, JSON.stringify(sc)) } catch {} }, [brand, sc])

  useEffect(() => {
    if (period !== 'all' || allLines) return
    const to = new Date().toISOString().slice(0, 10)
    fetch(`/api/delivery/subcontract?brand=${brand}&from=${startDate}&to=${to}`)
      .then(r => r.json()).then(d => setAllLines(d.lines ?? [])).catch(() => setAllLines([]))
  }, [period, allLines, brand, startDate])

  const lines = (period === 'all' ? allLines ?? [] : monthLines).filter(l => l.km != null && l.price != null)
  const zl = zoneLabels(sc.zoneLimitsKm), tl = trancheLabels(sc.tranches)

  const r = useMemo(() => {
    const cells = zl.map(() => tl.map(() => ({ n: 0, now: 0, sim: 0 })))
    let now = 0, sim = 0, panels = 0, rev = 0, ship = 0, lossNow = 0, lossSim = 0
    for (const l of lines) {
      const p = priceOf(sc, l.km!, l.billedQty)
      const c = cells[bucketOf(sc.zoneLimitsKm, l.km!)][bucketOf(sc.tranches, l.billedQty)]
      c.n++; c.now += l.price!; c.sim += p
      now += l.price!; sim += p; panels += l.units ?? l.billedQty
      if (l.revenueHT != null) {
        rev += l.revenueHT; ship += l.shippingHT ?? 0
        const m = l.revenueHT + (l.shippingHT ?? 0) - (l.cogs ?? 0)
        if (m - l.price! < 0) lossNow++
        if (m - p < 0) lossSim++
      }
    }
    return { cells, now, sim, panels, rev, ship, lossNow, lossSim, n: lines.length }
  }, [lines, sc, zl.length, tl.length])

  const pct = (cost: number) => r.rev > 0 ? Math.round((cost - r.ship) / r.rev * 1000) / 10 : null

  function setLimits(kind: 'zoneLimitsKm' | 'tranches', next: number[]) {
    const clean = [...new Set(next.map(v => Math.max(1, Math.round(v))))].sort((a, b) => a - b)
    setSc(prev => regrid(prev, { zoneLimitsKm: prev.zoneLimitsKm, tranches: prev.tranches, [kind]: clean }))
  }

  async function copyProposal() {
    const head = ['Distance routière aller', ...tl.map(t => `${t} pann.`)]
    const rows = zl.map((z, i) => [z, ...sc.grid[i].map(v => `${v} €${sc.perPanel[i] ? ` + ${sc.perPanel[i]} €/pann.` : ''}`)])
    const txt = [head, ...rows].map(x => x.join('\t')).join('\n') +
      `\n\nPrix HT par commande et par adresse, départ Bordeaux.${sc.perPanel.some(Boolean) ? ' Forfait + prix par panneau livré.' : ''}`
    try { await navigator.clipboard.writeText(txt); setCopied(true); setTimeout(() => setCopied(false), 1500) } catch {}
  }

  const diff = r.sim - r.now
  const input = 'w-16 text-right border border-[#e0e0e0] rounded-[6px] px-1.5 py-1 text-sm tabular-nums bg-white'

  return (
    <div className="rounded-2xl bg-white border border-[#e8e8e4] overflow-hidden">
      <div className="flex flex-wrap items-center gap-2 px-5 py-3 border-b border-[#efefec]">
        <p className="text-[11px] font-semibold uppercase tracking-[0.1em] text-[#6b6b63] flex-1">Simulateur de grille · contre-proposition</p>
        <div className="flex rounded-[8px] border border-[#e0e0e0] overflow-hidden text-xs">
          {(['month', 'all'] as const).map(p => (
            <button key={p} onClick={() => setPeriod(p)} className={`px-2.5 py-1.5 ${period === p ? 'bg-[#1a1a2e] text-white' : 'bg-white text-[#6b6b63]'}`}>
              {p === 'month' ? monthLabel : 'Depuis le début'}
            </button>
          ))}
        </div>
      </div>

      <div className="px-5 py-3 space-y-3 border-b border-[#f3f3f1]">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-[11px] text-[#9b9b93] mr-1">Partir de :</span>
          {presets.map(p => (
            <button key={p.label} onClick={() => setSc(p.make())} className="text-xs px-2.5 py-1 rounded-full border border-[#e0e0e0] text-[#1a1a2e] hover:bg-[#f5f5f3]">{p.label}</button>
          ))}
        </div>
        <div className="flex flex-wrap gap-x-6 gap-y-2 text-xs text-[#6b6b63]">
          <LimitsEditor label="Zones (km, bornes)" values={sc.zoneLimitsKm} onChange={v => setLimits('zoneLimitsKm', v)} step={50} addDefault={(sc.zoneLimitsKm.at(-1) ?? 0) + 200} />
          <LimitsEditor label="Tranches (panneaux, bornes)" values={sc.tranches} onChange={v => setLimits('tranches', v)} step={1} addDefault={(sc.tranches.at(-1) ?? 0) + 4} />
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-[11px] text-[#9b9b93]">
              <th className="text-left font-semibold px-5 py-2">Zone</th>
              {tl.map(t => <th key={t} className="text-right font-semibold px-3 py-2">{t} pann.</th>)}
              <th className="text-right font-semibold px-3 py-2" title="Ajouté au forfait pour chaque panneau livré">+ € / pann.</th>
              <th className="text-right font-semibold px-5 py-2">Total zone</th>
            </tr>
          </thead>
          <tbody>
            {zl.map((z, zi) => {
              const zc = r.cells[zi].reduce((a, c) => ({ n: a.n + c.n, now: a.now + c.now, sim: a.sim + c.sim }), { n: 0, now: 0, sim: 0 })
              return (
                <tr key={z} className="border-t border-[#f3f3f1] align-top">
                  <td className="px-5 py-2.5 text-xs font-semibold text-[#1a1a2e] whitespace-nowrap">Zone {zi + 1}<span className="block font-normal text-[#9b9b93]">{z}</span></td>
                  {tl.map((_, bi) => {
                    const c = r.cells[zi][bi]
                    return (
                      <td key={bi} className="px-3 py-2.5 text-right">
                        <input type="number" min={0} value={sc.grid[zi]?.[bi] ?? 0} className={input}
                          onChange={e => setSc(prev => { const g = prev.grid.map(x => x.slice()); g[zi][bi] = Math.max(0, Number(e.target.value) || 0); return { ...prev, grid: g } })} />
                        <span className={`block text-[11px] mt-0.5 tabular-nums ${c.n ? 'text-[#4338ca]' : 'text-[#c4c4bc]'}`}>
                          {c.n ? `${c.n} cmd · ${eur(c.sim)}` : '—'}
                        </span>
                        {c.n > 0 && Math.round(c.sim - c.now) !== 0 && (
                          <span className={`block text-[10px] tabular-nums ${c.sim < c.now ? 'text-[#1f7a5a]' : 'text-[#c7293a]'}`}>{signed(c.sim - c.now)}</span>
                        )}
                      </td>
                    )
                  })}
                  <td className="px-3 py-2.5 text-right">
                    <input type="number" min={0} value={sc.perPanel[zi] ?? 0} className={input}
                      onChange={e => setSc(prev => { const p = prev.perPanel.slice(); p[zi] = Math.max(0, Number(e.target.value) || 0); return { ...prev, perPanel: p } })} />
                  </td>
                  <td className="px-5 py-2.5 text-right tabular-nums">
                    <span className="font-semibold text-[#1a1a2e]">{eur(zc.sim)}</span>
                    <span className="block text-[11px] text-[#9b9b93]">{zc.n} cmd · actuel {eur(zc.now)}</span>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {/* Résultat */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 px-5 py-4 border-t border-[#efefec] bg-[#fafaf8]">
        <div>
          <p className="text-[11px] text-[#9b9b93]">Coût simulé · {r.n} forfaits</p>
          <p className="text-xl font-bold tabular-nums text-[#1a1a2e]">{eur(r.sim)}</p>
          <p className={`text-[11px] font-semibold tabular-nums ${diff < 0 ? 'text-[#1f7a5a]' : diff > 0 ? 'text-[#c7293a]' : 'text-[#9b9b93]'}`}>
            {signed(diff)} vs actuel ({eur(r.now)}){r.now > 0 && diff !== 0 ? ` · ${diff > 0 ? '+' : '−'}${Math.abs(Math.round(diff / r.now * 100))} %` : ''}
          </p>
        </div>
        <div>
          <p className="text-[11px] text-[#9b9b93]">Par panneau</p>
          <p className="text-xl font-bold tabular-nums text-[#1a1a2e]">{r.panels ? eur(r.sim / r.panels, 1) : '—'}</p>
          <p className="text-[11px] text-[#9b9b93] tabular-nums">actuel {r.panels ? eur(r.now / r.panels, 1) : '—'} · {r.panels} panneaux</p>
        </div>
        <div>
          <p className="text-[11px] text-[#9b9b93]" title="(livraison − port payé par les clients) ÷ CA HT produits des commandes livrées">Livraison nette / CA</p>
          <p className="text-xl font-bold tabular-nums text-[#1a1a2e]">{pct(r.sim)?.toLocaleString("fr-FR") ?? "—"} %</p>
          <p className="text-[11px] text-[#9b9b93] tabular-nums">actuel {pct(r.now)?.toLocaleString("fr-FR") ?? "—"} %</p>
        </div>
        <div>
          <p className="text-[11px] text-[#9b9b93]">Commandes à perte</p>
          <p className={`text-xl font-bold tabular-nums ${r.lossSim ? 'text-[#c7293a]' : 'text-[#1f7a5a]'}`}>{r.lossSim}</p>
          <p className="text-[11px] text-[#9b9b93] tabular-nums">actuel {r.lossNow} (avant pub et frais fixes)</p>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2 px-5 py-2.5 border-t border-[#f3f3f1]">
        <p className="text-[11px] text-[#9b9b93] flex-1 min-w-[220px]">
          Mêmes livraisons, mêmes distances, mêmes regroupements : seul le tarif change. Brouillon gardé dans ce navigateur, la grille facturée n&apos;est pas modifiée.
          {period === 'all' && !allLines && ' Chargement…'}
        </p>
        <button onClick={() => setSc(base)} className="inline-flex items-center gap-1 text-xs px-3 py-1.5 rounded-[8px] text-[#6b6b63] hover:text-[#1a1a2e]"><RotateCcw size={12} /> Réinitialiser</button>
        <button onClick={copyProposal} className="inline-flex items-center gap-1 text-xs px-3 py-1.5 rounded-[8px] bg-[#1a1a2e] text-white">
          {copied ? <Check size={12} /> : <Copy size={12} />} {copied ? 'Copiée' : 'Copier la grille proposée'}
        </button>
      </div>
    </div>
  )
}

function LimitsEditor({ label, values, onChange, step, addDefault }: {
  label: string; values: number[]; onChange: (v: number[]) => void; step: number; addDefault: number
}) {
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <span>{label} :</span>
      {values.map((v, i) => (
        <span key={i} className="inline-flex items-center gap-0.5">
          <input type="number" min={1} step={step} defaultValue={v} key={`${i}-${v}`}
            onBlur={e => { const n = values.slice(); n[i] = Number(e.target.value) || v; onChange(n) }}
            onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }}
            className="w-14 text-right border border-[#e0e0e0] rounded-[6px] px-1.5 py-0.5 text-xs tabular-nums" />
          <button onClick={() => onChange(values.filter((_, j) => j !== i))} className="text-[#9b9b93] hover:text-[#c7293a]" title="Retirer cette borne"><Minus size={12} /></button>
        </span>
      ))}
      <button onClick={() => onChange([...values, addDefault])} className="inline-flex items-center text-[#4338ca] hover:underline" title="Ajouter une borne"><Plus size={12} /> borne</button>
    </div>
  )
}
