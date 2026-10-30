'use client'

// Onglet « Traitement Shopify » : toutes les commandes récentes et leur état « traitée »
// dans Shopify, pour voir d'un coup d'œil ce qui reste à pointer à la main.
import { useEffect, useMemo, useState } from 'react'
import { Loader2, AlertCircle, ExternalLink, RefreshCw } from 'lucide-react'

type State = 'manual' | 'waiting' | 'auto' | 'done'
type Row = {
  id: number; name: string; created_at: string; customer: string; city: string | null; state: State
  remaining: { title: string; variant: string | null; qty: number; truck: boolean; sample: boolean }[]
  fulfillments: { at: string; by: 'steero' | 'manual'; tracking: string | null; qty: number }[]
  delivery: { kind: 'planned' | 'delivered'; date: string; driver: string | null } | null
}
type Data = { days: number; counts: Record<State, number>; rows: Row[] }

const STATES: { key: State; label: string; hint: string; cls: string }[] = [
  { key: 'manual',  label: 'À traiter à la main',      hint: 'La Poste, échantillons, accessoires hors tournée', cls: 'bg-[#fce8ea] text-[#c7293a]' },
  { key: 'waiting', label: 'En attente de livraison',  hint: 'traitée automatiquement au « livré »',              cls: 'bg-[#fef3c7] text-[#b45309]' },
  { key: 'auto',    label: 'Traitée par Steero',       hint: 'au moment de la livraison',                         cls: 'bg-[#dcf5e7] text-[#1a7f4b]' },
  { key: 'done',    label: 'Traitée à la main',        hint: 'au moins en partie',                                cls: 'bg-[#eeede9] text-[#6b6b63]' },
]
const SHOP_ADMIN = 'https://admin.shopify.com/store/booa-france/orders'

const fmtDay = (iso: string) => new Date(iso).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', timeZone: 'Europe/Paris' })
const fmtDateTime = (iso: string) => new Date(iso).toLocaleString('fr-FR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Paris' })

export default function FulfillmentStatusView() {
  const [days, setDays] = useState(30)
  const [data, setData] = useState<Data | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [filter, setFilter] = useState<State | 'all'>('manual')
  const [q, setQ] = useState('')
  const [reload, setReload] = useState(0)

  useEffect(() => {
    setData(null); setError(null)
    fetch(`/api/delivery/fulfillment-status?days=${days}`, { cache: 'no-store' })
      .then(r => r.json())
      .then((d: Data & { error?: string }) => { if (d.error) setError(d.error); else setData(d) })
      .catch(e => setError(String(e)))
  }, [days, reload])

  const rows = useMemo(() => {
    if (!data) return []
    const needle = q.trim().toLowerCase()
    return data.rows.filter(r => (filter === 'all' || r.state === filter) &&
      (!needle || r.name.toLowerCase().includes(needle) || r.customer.toLowerCase().includes(needle) || (r.city ?? '').toLowerCase().includes(needle)))
  }, [data, filter, q])

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="max-w-2xl text-sm text-[#6b6b63]">
          Les commandes livrées en tournée sont marquées « traitées » dans Shopify automatiquement au « livré ».
          Ici : ce qui reste à pointer à la main, et l&apos;état de toutes les commandes des {days} derniers jours.
        </p>
        <div className="flex items-center gap-2">
          <select value={days} onChange={e => setDays(Number(e.target.value))} className="rounded-[10px] border border-[#e8e8e4] bg-white px-2.5 py-1.5 text-sm">
            <option value={14}>14 jours</option>
            <option value={30}>30 jours</option>
            <option value={60}>60 jours</option>
            <option value={90}>90 jours</option>
          </select>
          <button onClick={() => setReload(n => n + 1)} className="rounded-[10px] border border-[#e8e8e4] bg-white p-2 text-[#6b6b63] hover:text-[#1a1a2e]" title="Actualiser"><RefreshCw size={14} /></button>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
        {STATES.map(s => (
          <button key={s.key} onClick={() => setFilter(f => f === s.key ? 'all' : s.key)}
            className={`rounded-[14px] border bg-white px-4 py-3 text-left transition-all ${filter === s.key ? 'border-[#1a1a2e] shadow-[0_2px_10px_rgba(0,0,0,0.08)]' : 'border-[#e8e8e4] hover:border-[#c9c9c2]'}`}>
            <span className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-semibold ${s.cls}`}>{s.label}</span>
            <p className="mt-1 text-2xl font-bold tabular-nums text-[#1a1a2e]">{data ? data.counts[s.key] : '…'}</p>
            <p className="text-[11px] text-[#9b9b93]">{s.hint}</p>
          </button>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <input value={q} onChange={e => setQ(e.target.value)} placeholder="N° de commande, client, ville…"
          className="w-full max-w-xs rounded-[10px] border border-[#e8e8e4] bg-white px-3 py-1.5 text-sm" />
        {filter !== 'all' && <button onClick={() => setFilter('all')} className="text-xs text-[#6b6b63] underline">Voir tous les statuts</button>}
      </div>

      {error && <div className="flex items-center gap-2 rounded-xl border border-red-100 bg-red-50 px-4 py-3 text-sm text-red-700"><AlertCircle size={15} />{error}</div>}
      {!data && !error && <div className="flex justify-center py-16"><Loader2 size={22} className="animate-spin text-[#9b9b93]" /></div>}

      {data && (
        <div className="overflow-x-auto rounded-[16px] border border-[#e8e8e4] bg-white">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-[11px] text-[#9b9b93]">
                <th className="px-4 py-2.5 font-semibold">Commande</th>
                <th className="px-3 py-2.5 font-semibold">Client</th>
                <th className="px-3 py-2.5 font-semibold">Statut</th>
                <th className="px-3 py-2.5 font-semibold">Reste à traiter</th>
                <th className="px-3 py-2.5 font-semibold">Livraison</th>
                <th className="px-3 py-2.5 font-semibold">Traitée</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 && <tr><td colSpan={6} className="px-4 py-8 text-center text-sm text-[#9b9b93]">Aucune commande.</td></tr>}
              {rows.map(r => {
                const st = STATES.find(s => s.key === r.state)!
                return (
                  <tr key={r.id} className="border-t border-[#f3f3f1] align-top">
                    <td className="px-4 py-2.5">
                      <a href={`${SHOP_ADMIN}/${r.id}`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 font-mono text-xs font-semibold text-[#1a1a2e] hover:text-[#1d4ed8]">
                        {r.name} <ExternalLink size={10} />
                      </a>
                      <p className="text-[11px] text-[#9b9b93]">{fmtDay(r.created_at)}</p>
                    </td>
                    <td className="px-3 py-2.5 text-xs text-[#1a1a2e]">{r.customer || '—'}{r.city && <p className="text-[11px] text-[#9b9b93]">{r.city}</p>}</td>
                    <td className="px-3 py-2.5"><span className={`inline-flex whitespace-nowrap rounded-full px-2 py-0.5 text-[10px] font-semibold ${st.cls}`}>{st.label}</span></td>
                    <td className="px-3 py-2.5 text-xs text-[#1a1a2e]">
                      {r.remaining.length === 0 ? <span className="text-[#9b9b93]">—</span> : r.remaining.map((it, i) => (
                        <p key={i}>
                          {it.qty}× {it.title}{it.variant ? <span className="text-[#9b9b93]"> · {it.variant}</span> : null}
                          {!it.truck && <span className="ml-1 text-[10px] font-semibold text-[#c7293a]">{it.sample ? 'échantillon' : 'hors camion'}</span>}
                        </p>
                      ))}
                    </td>
                    <td className="px-3 py-2.5 text-xs text-[#6b6b63]">
                      {r.delivery?.kind === 'planned' && <>Tournée du {fmtDay(r.delivery.date)}{r.delivery.driver && <p className="text-[11px]">{r.delivery.driver}</p>}</>}
                      {r.delivery?.kind === 'delivered' && <>Livrée le {fmtDateTime(r.delivery.date)}</>}
                      {!r.delivery && <span className="text-[#9b9b93]">{r.remaining.some(x => x.truck) ? 'À planifier' : '—'}</span>}
                    </td>
                    <td className="px-3 py-2.5 text-xs text-[#6b6b63]">
                      {r.fulfillments.length === 0 ? <span className="text-[#9b9b93]">—</span> : r.fulfillments.map((f, i) => (
                        <p key={i} title={f.tracking ?? ''}>
                          {fmtDateTime(f.at)} · <span className={f.by === 'steero' ? 'font-semibold text-[#1a7f4b]' : ''}>{f.by === 'steero' ? 'Steero' : 'à la main'}</span>
                          {f.by === 'manual' && f.tracking && <span className="block text-[10px] text-[#9b9b93]">{f.tracking}</span>}
                        </p>
                      ))}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
