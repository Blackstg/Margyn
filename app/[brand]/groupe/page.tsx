'use client'

// Vue « Groupe » : CA et marge consolidés de toutes les marques, au mois ou à
// l'année, comparés à l'an dernier. Réservée au propriétaire (lib/owner.ts).
import { useEffect, useMemo, useRef, useState } from 'react'
import { ChevronLeft, ChevronRight, Crown, Loader2 } from 'lucide-react'
import type { GroupeData, GroupeMonth } from '@/app/api/groupe/route'
import type { Brand } from '@/lib/access'

// Ordre et teintes fixes (palette validée daltonisme) — la couleur suit la marque.
const BRAND_META: Record<Brand, { label: string; color: string }> = {
  moom: { label: 'Mōom Paris', color: '#D0487A' },
  krom: { label: 'Krom Water', color: '#2F6FDB' },
  bowa: { label: 'Bowa',       color: '#1F8A70' },
  yone: { label: 'Yone',       color: '#D9A23B' },
}
const ORDER: Brand[] = ['moom', 'krom', 'bowa', 'yone']
const MONTHS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre']
const MONTHS_SHORT = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.']

const eur = (n: number) => new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }).format(n)
const kEur = (n: number) => n >= 1e6 ? `${(n / 1e6).toLocaleString('fr-FR', { maximumFractionDigits: 1 })} M€` : n >= 1e3 ? `${Math.round(n / 1e3)} k€` : `${Math.round(n)} €`
const pct = (n: number) => `${n.toLocaleString('fr-FR', { maximumFractionDigits: 0 })} %`
const sum = (ms: GroupeMonth[]): GroupeMonth => ms.reduce((a, m) => ({ ca: a.ca + m.ca, gross: a.gross + m.gross, ads: a.ads + m.ads, orders: a.orders + m.orders }), { ca: 0, gross: 0, ads: 0, orders: 0 })

// Compteur animé une fois par changement de période (désactivé si mouvement réduit).
function useCountUp(target: number, key: string) {
  const [v, setV] = useState(target)
  const from = useRef(0)
  useEffect(() => {
    if (typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches) { setV(target); return }
    const start = performance.now(), a = from.current, dur = 900
    let raf = 0
    const tick = (t: number) => {
      const k = Math.min(1, (t - start) / dur), e = 1 - Math.pow(1 - k, 3)
      setV(a + (target - a) * e)
      if (k < 1) raf = requestAnimationFrame(tick); else from.current = target
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target, key])
  return v
}

function Delta({ cur, prev, label }: { cur: number; prev: number; label: string }) {
  if (prev <= 0) return <span className="text-white/50 text-sm">{label} : pas d’historique</span>
  const d = (cur - prev) / prev * 100
  const up = d >= 0
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-sm font-semibold ${up ? 'bg-[#2fd39a]/15 text-[#6ff0c0]' : 'bg-[#ff6b6b]/15 text-[#ff9b9b]'}`}>
      {up ? '▲' : '▼'} {up ? '+' : ''}{d.toLocaleString('fr-FR', { maximumFractionDigits: 0 })} %
      <span className="font-normal text-white/55">{label} ({eur(prev)})</span>
    </span>
  )
}

export default function GroupePage() {
  const [mode, setMode]   = useState<'month' | 'year'>('month')
  const [year, setYear]   = useState<number | null>(null)
  const [month, setMonth] = useState<number>(0)            // 0–11
  const [cache, setCache] = useState<Record<number, GroupeData>>({})
  const [error, setError] = useState<string | null>(null)
  const [hover, setHover] = useState<number | null>(null)

  const load = (y?: number) => fetch(`/api/groupe${y ? `?year=${y}` : ''}`)
    .then(async r => { if (!r.ok) throw new Error(r.status === 403 ? 'Page réservée au propriétaire du groupe.' : 'Chargement impossible.'); return r.json() as Promise<GroupeData> })
    .then(d => { setCache(c => ({ ...c, [d.year]: d })); return d })

  useEffect(() => {
    load().then(d => { setYear(d.year); setMonth(Number(d.today.slice(5, 7)) - 1) }).catch(e => setError(e.message))
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  useEffect(() => { if (year && !cache[year]) load(year).catch(e => setError(e.message)) // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [year])

  const data = year ? cache[year] : undefined
  const today = data?.today ?? cache[Object.keys(cache).map(Number)[0]]?.today ?? ''
  const curY = Number(today.slice(0, 4)), curM = Number(today.slice(5, 7)) - 1
  const isCurrentMonth = year === curY && month === curM

  const view = useMemo(() => {
    if (!data) return null
    const brands = ORDER.filter(b => data.brands.includes(b))
    const per = brands.map(b => {
      const cur  = mode === 'month' ? data.months[b][month] : sum(data.months[b])
      const prev = mode === 'month'
        ? (isCurrentMonth ? data.prevMtd[b] : data.prev[b][month])
        : (year === curY ? sum([...data.prev[b].slice(0, curM), data.prevMtd[b]]) : sum(data.prev[b]))
      return { b, cur, prev }
    })
    return { brands, per, total: sum(per.map(p => p.cur)), totalPrev: sum(per.map(p => p.prev)) }
  }, [data, mode, month, year, isCurrentMonth, curY, curM])

  const heroKey = `${mode}-${year}-${month}`
  const shown = useCountUp(view?.total.ca ?? 0, heroKey)

  const go = (dir: -1 | 1) => {
    if (!year) return
    if (mode === 'year') { setYear(year + dir); return }
    const m = month + dir
    if (m < 0) { setYear(year - 1); setMonth(11) } else if (m > 11) { setYear(year + 1); setMonth(0) } else setMonth(m)
  }
  const atEnd = mode === 'year' ? year === curY : (year === curY && month === curM)

  if (error) return <div className="min-h-screen bg-[#f7f7f5] p-8 text-sm text-[#6b6b63]">{error}</div>
  if (!data || !view || !year) return <div className="flex min-h-screen items-center justify-center bg-[#f7f7f5]"><Loader2 size={24} className="animate-spin text-[#9b9b93]" /></div>

  const { total, totalPrev, per, brands } = view
  const margin = total.ca > 0 ? total.gross / total.ca * 100 : 0
  const afterAds = total.gross - total.ads
  const periodLabel = mode === 'month' ? `${MONTHS[month]} ${year}` : `${year}`
  const deltaLabel = mode === 'month'
    ? (isCurrentMonth ? `vs ${MONTHS_SHORT[month]} ${year - 1} à date` : `vs ${MONTHS_SHORT[month]} ${year - 1}`)
    : (year === curY ? `vs ${year - 1} à date` : `vs ${year - 1}`)

  // Graphique : 12 mois empilés par marque + repère de l'an dernier
  const monthTotals = Array.from({ length: 12 }, (_, i) => ({
    i, parts: brands.map(b => ({ b, v: data.months[b][i].ca })),
    total: brands.reduce((s, b) => s + data.months[b][i].ca, 0),
    prev: brands.reduce((s, b) => s + data.prev[b][i].ca, 0),
  }))
  const max = Math.max(1, ...monthTotals.map(m => Math.max(m.total, m.prev)))
  const step = Math.pow(10, Math.floor(Math.log10(max))) * (max / Math.pow(10, Math.floor(Math.log10(max))) > 5 ? 2 : 1)
  const top = Math.ceil(max / step) * step
  const ticks = Array.from({ length: Math.round(top / step) + 1 }, (_, k) => k * step)

  return (
    <div className="min-h-screen bg-[#f7f7f5] px-4 py-6 md:px-8">
      <div className="mx-auto max-w-6xl space-y-5">

        {/* Barre de période */}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h1 className="flex items-center gap-2 text-xl font-semibold text-[#1a1a2e]"><Crown size={20} /> Groupe</h1>
          <div className="flex items-center gap-2">
            <div className="flex rounded-xl border border-[#e8e8e4] bg-white p-0.5 text-sm">
              {(['month', 'year'] as const).map(m => (
                <button key={m} onClick={() => setMode(m)}
                  className={`rounded-[10px] px-3.5 py-1.5 font-medium transition-colors ${mode === m ? 'bg-[#1a1a2e] text-white' : 'text-[#6b6b63] hover:text-[#1a1a2e]'}`}>
                  {m === 'month' ? 'Mois' : 'Année'}
                </button>
              ))}
            </div>
            <div className="flex items-center rounded-xl border border-[#e8e8e4] bg-white text-sm">
              <button onClick={() => go(-1)} aria-label="Période précédente" className="px-2 py-1.5 text-[#6b6b63] hover:text-[#1a1a2e]"><ChevronLeft size={16} /></button>
              <span className="min-w-[124px] text-center font-medium capitalize text-[#1a1a2e]">{periodLabel}</span>
              <button onClick={() => go(1)} disabled={atEnd} aria-label="Période suivante" className="px-2 py-1.5 text-[#6b6b63] hover:text-[#1a1a2e] disabled:opacity-30"><ChevronRight size={16} /></button>
            </div>
          </div>
        </div>

        {/* Héros */}
        <section className="relative overflow-hidden rounded-3xl bg-[#1a1a2e] px-6 py-8 text-white md:px-10 md:py-10">
          <div aria-hidden className="pointer-events-none absolute -right-24 -top-24 h-72 w-72 rounded-full opacity-25 blur-3xl"
            style={{ background: `conic-gradient(${ORDER.map(b => BRAND_META[b].color).join(',')},${BRAND_META.moom.color})` }} />
          <p className="relative text-sm text-white/60">Chiffre d’affaires du groupe · <span className="capitalize">{periodLabel}</span>{mode === 'year' && year === curY ? ' à date' : ''}</p>
          <p className="relative mt-2 font-bold leading-none tracking-[-0.04em] tabular-nums" style={{ fontSize: 'clamp(3rem, 9vw, 6.5rem)' }}>
            {eur(shown)}
          </p>
          <div className="relative mt-4"><Delta cur={total.ca} prev={totalPrev.ca} label={deltaLabel} /></div>

          <dl className="relative mt-8 grid grid-cols-2 gap-x-8 gap-y-4 md:grid-cols-4">
            <div><dt className="text-xs text-white/50">Marge brute</dt><dd className="mt-1 text-2xl font-semibold tabular-nums">{eur(total.gross)} <span className="text-base font-normal text-white/50">{pct(margin)}</span></dd></div>
            <div><dt className="text-xs text-white/50">Après pub</dt><dd className="mt-1 text-2xl font-semibold tabular-nums">{eur(afterAds)}</dd></div>
            <div><dt className="text-xs text-white/50">Pub dépensée</dt><dd className="mt-1 text-2xl font-semibold tabular-nums">{eur(total.ads)}</dd></div>
            <div><dt className="text-xs text-white/50">Commandes</dt><dd className="mt-1 text-2xl font-semibold tabular-nums">{total.orders.toLocaleString('fr-FR')}</dd></div>
          </dl>

          {/* Répartition par marque */}
          {total.ca > 0 && (
            <div className="relative mt-8">
              <div className="flex h-3 gap-[2px] overflow-hidden rounded-full">
                {per.filter(p => p.cur.ca > 0).map(p => (
                  <div key={p.b} style={{ width: `${p.cur.ca / total.ca * 100}%`, background: BRAND_META[p.b].color }} title={`${BRAND_META[p.b].label} : ${eur(p.cur.ca)}`} />
                ))}
              </div>
              <div className="mt-3 flex flex-wrap gap-x-6 gap-y-1 text-sm">
                {per.filter(p => p.cur.ca > 0).map(p => (
                  <span key={p.b} className="flex items-center gap-2 text-white/80">
                    <span className="h-2.5 w-2.5 rounded-full" style={{ background: BRAND_META[p.b].color }} />
                    {BRAND_META[p.b].label} <span className="tabular-nums text-white/50">{pct(p.cur.ca / total.ca * 100)}</span>
                  </span>
                ))}
              </div>
            </div>
          )}
        </section>

        {/* Détail par marque */}
        <section className="overflow-x-auto rounded-2xl border border-[#e8e8e4] bg-white">
          <table className="w-full min-w-[640px] text-sm">
            <thead>
              <tr className="border-b border-[#efefec] text-left text-xs text-[#9b9b93]">
                <th className="px-5 py-3 font-medium">Marque</th>
                <th className="px-3 py-3 text-right font-medium">CA</th>
                <th className="px-3 py-3 text-right font-medium">Part</th>
                <th className="px-3 py-3 text-right font-medium">Marge brute</th>
                <th className="px-3 py-3 text-right font-medium">Après pub</th>
                <th className="px-5 py-3 text-right font-medium">{deltaLabel}</th>
              </tr>
            </thead>
            <tbody>
              {per.map(p => {
                const d = p.prev.ca > 0 ? (p.cur.ca - p.prev.ca) / p.prev.ca * 100 : null
                return (
                  <tr key={p.b} className="border-b border-[#f3f3f1] last:border-0">
                    <td className="px-5 py-3.5"><span className="flex items-center gap-2.5 font-medium text-[#1a1a2e]"><span className="h-2.5 w-2.5 rounded-full" style={{ background: BRAND_META[p.b].color }} />{BRAND_META[p.b].label}</span></td>
                    <td className="px-3 py-3.5 text-right font-semibold tabular-nums text-[#1a1a2e]">{eur(p.cur.ca)}</td>
                    <td className="px-3 py-3.5 text-right tabular-nums text-[#6b6b63]">{total.ca > 0 ? pct(p.cur.ca / total.ca * 100) : '—'}</td>
                    <td className="px-3 py-3.5 text-right tabular-nums text-[#1a1a2e]">{eur(p.cur.gross)} <span className="text-[#9b9b93]">{p.cur.ca > 0 ? pct(p.cur.gross / p.cur.ca * 100) : ''}</span></td>
                    <td className="px-3 py-3.5 text-right tabular-nums text-[#1a1a2e]">{eur(p.cur.gross - p.cur.ads)}</td>
                    <td className={`px-5 py-3.5 text-right font-medium tabular-nums ${d == null ? 'text-[#9b9b93]' : d >= 0 ? 'text-[#1f8a5c]' : 'text-[#c2413b]'}`}>
                      {d == null ? 'nouveau' : `${d >= 0 ? '+' : ''}${d.toLocaleString('fr-FR', { maximumFractionDigits: 0 })} %`}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </section>

        {/* Mois par mois */}
        <section className="rounded-2xl border border-[#e8e8e4] bg-white p-5 md:p-6">
          <div className="mb-5 flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="text-base font-semibold text-[#1a1a2e]">{year} mois par mois</h2>
            <span className="flex items-center gap-2 text-xs text-[#9b9b93]"><span className="inline-block h-0.5 w-4 bg-[#1a1a2e]/40" /> {year - 1}</span>
          </div>
          <div className="overflow-x-auto">
            <div className="relative min-w-[560px] pl-12 pt-3">
              <div className="relative h-[240px]">
                {ticks.map(t => (
                  <div key={t} className="absolute left-0 right-0 border-t border-[#f0f0ed]" style={{ bottom: `${t / top * 100}%` }}>
                    <span className="absolute -left-12 -translate-y-1/2 text-[11px] tabular-nums text-[#9b9b93]">{kEur(t)}</span>
                  </div>
                ))}
                <div className="absolute inset-0 flex items-end gap-2">
                  {monthTotals.map(m => {
                    const future = year > curY || (year === curY && m.i > curM)
                    const selected = mode === 'month' && m.i === month
                    return (
                      <button key={m.i} type="button"
                        onClick={() => { if (!future) { setMode('month'); setMonth(m.i) } }}
                        onMouseEnter={() => setHover(m.i)} onMouseLeave={() => setHover(null)} onFocus={() => setHover(m.i)} onBlur={() => setHover(null)}
                        aria-label={`${MONTHS[m.i]} ${year} : ${eur(m.total)}`}
                        className={`relative flex h-full flex-1 flex-col justify-end rounded-t-md outline-none focus-visible:ring-2 focus-visible:ring-[#1a1a2e] ${selected ? 'bg-[#1a1a2e]/[0.04]' : ''}`}>
                        {m.prev > 0 && <span aria-hidden className="absolute left-1 right-1 h-0.5 rounded bg-[#1a1a2e]/40" style={{ bottom: `${m.prev / top * 100}%` }} />}
                        <span className="flex flex-col-reverse gap-[2px] overflow-hidden rounded-t-[4px]" style={{ height: `${m.total / top * 100}%`, opacity: hover == null || hover === m.i ? 1 : 0.55 }}>
                          {m.parts.filter(p => p.v > 0).map(p => <span key={p.b} style={{ flexGrow: p.v, background: BRAND_META[p.b].color }} />)}
                        </span>
                      </button>
                    )
                  })}
                </div>
                {hover != null && monthTotals[hover].total + monthTotals[hover].prev > 0 && (
                  <div className="pointer-events-none absolute z-10 w-52 rounded-xl border border-[#e8e8e4] bg-white p-3 text-xs shadow-lg"
                    style={{ left: `min(${(hover + 0.5) / 12 * 100}%, calc(100% - 13rem))`, top: 0 }}>
                    <p className="mb-1.5 font-semibold capitalize text-[#1a1a2e]">{MONTHS[hover]} {year}</p>
                    {monthTotals[hover].parts.filter(p => p.v > 0).map(p => (
                      <p key={p.b} className="flex justify-between gap-2 text-[#6b6b63]"><span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full" style={{ background: BRAND_META[p.b].color }} />{BRAND_META[p.b].label}</span><span className="tabular-nums text-[#1a1a2e]">{eur(p.v)}</span></p>
                    ))}
                    <p className="mt-1.5 flex justify-between border-t border-[#f0f0ed] pt-1.5 font-semibold text-[#1a1a2e]"><span>Total</span><span className="tabular-nums">{eur(monthTotals[hover].total)}</span></p>
                    {monthTotals[hover].prev > 0 && <p className="flex justify-between text-[#9b9b93]"><span>{year - 1}</span><span className="tabular-nums">{eur(monthTotals[hover].prev)}</span></p>}
                  </div>
                )}
              </div>
              <div className="mt-2 flex gap-2">
                {monthTotals.map(m => <span key={m.i} className={`flex-1 text-center text-[11px] ${mode === 'month' && m.i === month ? 'font-semibold text-[#1a1a2e]' : 'text-[#9b9b93]'}`}>{MONTHS_SHORT[m.i]}</span>)}
              </div>
            </div>
          </div>
          <div className="mt-4 flex flex-wrap gap-x-5 gap-y-1 text-xs text-[#6b6b63]">
            {brands.map(b => <span key={b} className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full" style={{ background: BRAND_META[b].color }} />{BRAND_META[b].label}</span>)}
          </div>
        </section>

        <p className="px-1 text-xs text-[#9b9b93]">
          CA = ventes Shopify (comme « Ventes totales ») + ventes privées. Marge brute = CA − coût des produits (Bowa calculée hors TVA). Après pub = marge brute − dépenses publicitaires.
        </p>
      </div>
    </div>
  )
}
