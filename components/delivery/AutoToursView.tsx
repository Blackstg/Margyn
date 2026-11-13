'use client'

// Onglet « Tournées auto » (test) : une tournée par zone se remplit toute seule avec
// les commandes à planifier ; il ne reste qu'à choisir le chauffeur et créer.
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Loader2, RefreshCw, AlertTriangle } from 'lucide-react'
import { planZoneTours, tourName, CAPACITY, type ZoneKey, type PlanOrder } from '@/lib/delivery/autoplan'

type Order = PlanOrder & {
  is_preorder: boolean
  preorder_ready?: boolean
  is_accessory_only?: boolean
  [k: string]: unknown
}

const ZONE_LABEL: Record<ZoneKey, string> = { 'nord-est': 'Nord-Est', 'nord-ouest': 'Nord-Ouest', 'sud-est': 'Sud-Est', 'sud-ouest': 'Sud-Ouest' }
const ZONE_COLOR: Record<ZoneKey, { bg: string; text: string }> = {
  'nord-est':   { bg: '#dbeafe', text: '#1d4ed8' },
  'nord-ouest': { bg: '#dcfce7', text: '#15803d' },
  'sud-est':    { bg: '#fff7ed', text: '#c2680a' },
  'sud-ouest':  { bg: '#f3e8ff', text: '#7c3aed' },
}
const WAIT_KEY = 'steero.autoTours.maxWait'

const fmtDay = (iso: string) => new Date(iso + 'T12:00:00').toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' })
const ageDays = (iso: string | null) => (iso ? Math.max(0, Math.floor((Date.now() - Date.parse(iso)) / 864e5)) : 0)

export default function AutoToursView({ optimizeTour }: { optimizeTour: (tourId: string) => Promise<void> }) {
  const [orders, setOrders] = useState<Order[] | null>(null)
  const [deferred, setDeferred] = useState<Map<string, string | null>>(new Map())
  const [drivers, setDrivers] = useState<string[]>([])
  const [rates, setRates] = useState<Partial<Record<ZoneKey, number>>>({})
  const [maxWait, setMaxWait] = useState(10)
  const [choice, setChoice] = useState<Record<string, { driver: string; date: string }>>({})
  const [creating, setCreating] = useState<string | null>(null)
  const [done, setDone] = useState<string[]>([])
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    try { const v = Number(localStorage.getItem(WAIT_KEY)); if (v > 0) setMaxWait(v) } catch { /* stockage indisponible */ }
  }, [])

  const load = useCallback(async () => {
    setOrders(null)
    setError(null)
    try {
      const [o, d, dr, r] = await Promise.all([
        fetch('/api/delivery/orders', { cache: 'no-store' }).then((x) => x.json()),
        fetch('/api/delivery/deferred-orders', { cache: 'no-store' }).then((x) => x.json()),
        fetch('/api/delivery/drivers', { cache: 'no-store' }).then((x) => x.json()),
        fetch('/api/delivery/autoplan', { cache: 'no-store' }).then((x) => x.json()),
      ])
      setDeferred(new Map((d.deferred ?? []).map((x: { order_name: string; deferred_until: string | null }) => [x.order_name, x.deferred_until])))
      setDrivers(dr.drivers ?? [])
      setRates(r.panelsPerDay ?? {})
      setOrders(o.orders ?? [])
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      setOrders([])
    }
  }, [])
  useEffect(() => { load() }, [load])

  const today = new Date().toISOString().slice(0, 10)
  const truck = useMemo(() => (orders ?? []).filter((o) => {
    if (o.is_accessory_only || (o.is_preorder && !o.preorder_ready)) return false
    if (!deferred.has(o.order_name)) return true
    const until = deferred.get(o.order_name)
    return !!until && until <= today
  }), [orders, deferred, today])
  const tours = useMemo(() => planZoneTours({ orders: truck, panelsPerDay: rates, maxWaitDays: maxWait }), [truck, rates, maxWait])
  const byName = useMemo(() => new Map(truck.map((o) => [o.order_name, o])), [truck])

  async function create(key: string, zone: ZoneKey, names: string[], driver: string, date: string) {
    setCreating(key)
    setError(null)
    try {
      const r = await fetch('/api/delivery/tours', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: tourName(date, driver), zone, driver_name: driver, planned_date: date }),
      })
      const data = await r.json()
      if (!r.ok) throw new Error(data.error ?? 'création impossible')
      const id = data.tour.id as string
      await fetch(`/api/delivery/tours/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'planned' }),
      })
      const stops = names.map((n) => byName.get(n)).filter(Boolean)
      const r2 = await fetch(`/api/delivery/tours/${id}/stops`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ stops }),
      })
      if (!r2.ok) throw new Error('tournée créée mais commandes non ajoutées, à vérifier dans le Planificateur')
      await optimizeTour(id).catch((e) => console.error('Route optimization failed', e))
      setDone((prev) => [...prev, `${tourName(date, driver)} : ${names.length} commande${names.length > 1 ? 's' : ''}`])
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setCreating(null)
    }
  }

  return (
    <div className="space-y-4">
      <div className="rounded-[20px] shadow-[0_2px_16px_rgba(0,0,0,0.06)] bg-white p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="max-w-2xl">
            <h2 className="text-base font-semibold text-[#1a1a2e]">Tournées auto <span className="ml-1 text-xs font-medium text-[#b45309] bg-[#fef3c7] rounded-full px-2 py-0.5">test</span></h2>
            <p className="text-xs text-[#6b6b63] mt-1 leading-relaxed">
              Chaque commande à planifier rejoint la tournée de sa zone, par ordre d&apos;arrivée (les commandes à replanifier passent devant).
              Une zone qui dépasse {CAPACITY} panneaux ouvre une deuxième tournée. Il reste à choisir le chauffeur : la tournée est alors créée
              (statut « Planifiée », ordre de passage optimisé) et apparaît dans le Planificateur.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <label className="text-xs text-[#6b6b63] flex items-center gap-1.5">
              Attente max
              <input type="number" min={1} max={30} value={maxWait}
                onChange={(e) => { const v = Math.max(1, Math.min(30, Number(e.target.value) || 1)); setMaxWait(v); try { localStorage.setItem(WAIT_KEY, String(v)) } catch { /* ignoré */ } }}
                className="w-14 text-xs border border-[#e0e0e0] rounded-[8px] px-2 py-1" />
              jours
            </label>
            <button onClick={load} disabled={!orders} className="flex items-center gap-1.5 px-3 py-1.5 rounded-[10px] bg-[#f5f5f3] text-[#6b6b63] text-xs font-medium hover:bg-[#e8e8e4] disabled:opacity-40">
              <RefreshCw size={12} /> Actualiser
            </button>
          </div>
        </div>
        {done.length > 0 && (
          <div className="mt-3 rounded-[12px] bg-[#dcf5e7] px-3 py-2 text-xs text-[#1a7f4b]">
            Créée{done.length > 1 ? 's' : ''} : {done.join(' · ')}
          </div>
        )}
        {error && (
          <div className="mt-3 rounded-[12px] bg-[#fce8ea] px-3 py-2 text-xs text-[#c7293a] flex items-center gap-1.5"><AlertTriangle size={12} /> {error}</div>
        )}
      </div>

      {!orders ? (
        <div className="flex items-center gap-2 text-sm text-[#6b6b63] p-5"><Loader2 size={14} className="animate-spin" /> Chargement des commandes…</div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {(['nord-est', 'nord-ouest', 'sud-est', 'sud-ouest'] as ZoneKey[]).map((zone) => {
            const zt = tours.filter((t) => t.zone === zone)
            const color = ZONE_COLOR[zone]
            return (
              <section key={zone} className="rounded-[20px] shadow-[0_2px_16px_rgba(0,0,0,0.06)] bg-white p-5">
                <div className="flex items-center justify-between mb-3">
                  <h3 className="text-sm font-bold" style={{ color: color.text }}>{ZONE_LABEL[zone]}</h3>
                  <span className="text-[11px] text-[#9b9b93]">~{Math.round((rates[zone] ?? 0) * 7)} panneaux / semaine</span>
                </div>
                {zt.length === 0 && <p className="text-xs text-[#9b9b93]">Aucune commande en attente dans cette zone.</p>}
                <div className="space-y-4">
                  {zt.map((t, i) => {
                    const key = `${zone}-${i}-${t.orders[0]}`
                    const c = choice[key] ?? { driver: '', date: t.depart }
                    const set = (patch: Partial<typeof c>) => setChoice((prev) => ({ ...prev, [key]: { ...c, ...patch } }))
                    const pct = Math.min(100, Math.round((t.panels / CAPACITY) * 100))
                    return (
                      <div key={key} className={zt.length > 1 ? 'rounded-[14px] border border-[#ececec] p-3' : ''}>
                        {zt.length > 1 && <p className="text-xs font-semibold text-[#1a1a2e] mb-2">Tournée {i + 1}</p>}
                        <div className="flex items-baseline justify-between text-xs">
                          <span className="font-semibold text-[#1a1a2e]">{t.orders.length} commande{t.orders.length > 1 ? 's' : ''} · {t.panels} / {CAPACITY} panneaux</span>
                          <span className={t.oldest_days >= maxWait ? 'text-[#c2410c] font-medium' : 'text-[#6b6b63]'}>plus ancienne : {t.oldest_days} j</span>
                        </div>
                        <div className="h-1.5 rounded-full bg-[#f0f0ec] mt-1.5 overflow-hidden">
                          <div className="h-full rounded-full" style={{ width: `${pct}%`, background: color.text }} />
                        </div>
                        <p className="text-xs text-[#1a1a2e] mt-2.5">
                          Départ conseillé <span className="font-semibold">{fmtDay(t.depart)}</span>
                          <span className="text-[#6b6b63]"> : {t.reason}</span>
                        </p>
                        <ul className="mt-2 divide-y divide-[#f2f2ee] text-xs">
                          {t.orders.map((n) => {
                            const o = byName.get(n)
                            return (
                              <li key={n} className="flex items-center gap-2 py-1">
                                <span className="font-medium text-[#1a1a2e] w-14 shrink-0">{n}</span>
                                <span className="text-[#6b6b63] truncate flex-1">{o?.city} ({o?.zip?.slice(0, 2)})</span>
                                {o?.needs_replan && <span className="text-[10px] font-medium text-[#c2410c] bg-[#ffedd5] rounded-full px-1.5">à replanifier</span>}
                                <span className="text-[#6b6b63] w-16 text-right">{o?.panel_count ?? 0} pann.</span>
                                <span className={`w-10 text-right ${ageDays(o?.created_at ?? null) >= maxWait ? 'text-[#c2410c]' : 'text-[#9b9b93]'}`}>{ageDays(o?.created_at ?? null)} j</span>
                              </li>
                            )
                          })}
                        </ul>
                        <div className="flex flex-wrap items-center gap-2 mt-3">
                          <select value={c.driver} onChange={(e) => set({ driver: e.target.value })}
                            className="text-xs border border-[#e0e0e0] rounded-[8px] px-2 py-1.5 bg-white">
                            <option value="">Choisir le chauffeur…</option>
                            {drivers.map((d) => <option key={d} value={d}>{d}</option>)}
                          </select>
                          <input type="date" value={c.date} onChange={(e) => set({ date: e.target.value })}
                            className="text-xs border border-[#e0e0e0] rounded-[8px] px-2 py-1.5 bg-white" />
                          <button
                            onClick={() => create(key, zone, t.orders, c.driver, c.date)}
                            disabled={!c.driver || !c.date || creating !== null}
                            className="px-3 py-1.5 rounded-[10px] bg-[#1a1a2e] text-white text-xs font-medium disabled:opacity-40"
                          >
                            {creating === key ? 'Création…' : 'Créer la tournée'}
                          </button>
                        </div>
                      </div>
                    )
                  })}
                </div>
              </section>
            )
          })}
        </div>
      )}
    </div>
  )
}
