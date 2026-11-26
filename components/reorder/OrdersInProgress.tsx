'use client'

// Commandes en cours : une frise production → transport → arrivée par commande,
// jours restants, décalage d'une date en cas de retard, réception (partielle ou non).
import { useState } from 'react'
import { Factory, Ship, PackageCheck, CalendarClock, ChevronDown } from 'lucide-react'
import type { ReorderOrder } from '@/lib/reorder/compute'
import { daysBetween } from '@/lib/reorder/plan'
import { CARD, GREEN, ORANGE, RED, eur0, fmtDay, int, plural } from './format'

type Act = (body: Record<string, unknown>) => Promise<boolean>

const money = (n: number, cur: string) => n.toLocaleString('fr-FR', { style: 'currency', currency: cur || 'USD', maximumFractionDigits: 2 })

function stage(o: ReorderOrder, today: string) {
  if (today < o.prodDoneOn) return { label: 'En production', icon: Factory, color: '#6f739f', left: daysBetween(today, o.prodDoneOn), next: 'fin de production' }
  if (today < o.arrivalOn) return { label: 'En transport', icon: Ship, color: ORANGE, left: daysBetween(today, o.arrivalOn), next: 'arrivée' }
  return { label: 'Arrivée prévue dépassée', icon: PackageCheck, color: RED, left: -daysBetween(o.arrivalOn, today), next: 'arrivée' }
}

function Timeline({ o, today }: { o: ReorderOrder; today: string }) {
  const total = Math.max(1, daysBetween(o.orderedOn, o.arrivalOn))
  const fab = Math.max(0, Math.min(100, (daysBetween(o.orderedOn, o.prodDoneOn) / total) * 100))
  const now = Math.max(0, Math.min(100, (daysBetween(o.orderedOn, today) / total) * 100))
  return (
    <div className="pt-1">
      <div className="relative h-2.5 rounded-full overflow-hidden flex gap-[2px]">
        <div className="h-full bg-[#c9cbe0] rounded-l-full" style={{ width: `${fab}%` }} />
        <div className="h-full bg-[#f3d9b8] rounded-r-full flex-1" />
        <div className="absolute inset-y-0 left-0 bg-[#1a1a2e]/25" style={{ width: `${now}%` }} />
      </div>
      <div className="relative h-4">
        <span className="absolute -top-[13px] w-[3px] h-[14px] rounded-full bg-[#1a1a2e]" style={{ left: `calc(${now}% - 1px)` }} title={`Aujourd'hui (${fmtDay(today)})`} />
      </div>
      <div className="flex justify-between text-[10px] text-[#6b6b63] -mt-2 gap-2">
        <span>Validée le {fmtDay(o.orderedOn)}</span>
        <span>Fin de production {fmtDay(o.prodDoneOn)}</span>
        <span className="font-semibold text-[#1a1a2e]">Arrivée {fmtDay(o.arrivalOn)}</span>
      </div>
    </div>
  )
}

function OrderCard({ o, today, act }: { o: ReorderOrder; today: string; act: Act }) {
  const [mode, setMode] = useState<null | 'shift' | 'receive' | 'cancel'>(null)
  const [open, setOpen] = useState(false)
  const [prod, setProd] = useState(o.prodDoneOn)
  const [arrival, setArrival] = useState(o.arrivalOn)
  const [qty, setQty] = useState<Record<string, number>>(() => Object.fromEntries(o.lines.map((l) => [l.variantId, l.qty - l.receivedQty])))
  const [closeAll, setCloseAll] = useState(false)
  const st = stage(o, today)
  const units = o.lines.reduce((a, l) => a + l.qty, 0)
  const received = o.lines.reduce((a, l) => a + l.receivedQty, 0)
  const Icon = st.icon
  const btn = 'px-3 py-1.5 rounded-lg text-xs font-medium border border-[#e8e4e0] text-[#6b6b63] hover:border-[#aeb0c9] hover:text-[#1a1a2e] transition-colors'

  return (
    <div className={`${CARD} p-4 space-y-3`}>
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <p className="text-sm font-semibold text-[#1a1a2e]">Commande du {fmtDay(o.orderedOn, true)}</p>
          <p className="text-[11px] text-[#9b9b93]">
            {o.lines.length} {plural(o.lines.length, 'référence', 'références')}, {int(units)} unités, {eur0(o.totalCost)}
            {received > 0 && <>, {int(received)} déjà reçues</>}
            {o.source === 'declared' && ', déclarée après coup'}
          </p>
          {o.invoice && (
            <p className="text-[11px] text-[#6b6b63]">
              Facture {o.invoice.supplier} n° {o.invoice.number} : {money(o.invoice.total, o.invoice.currency)}, acompte {money(o.invoice.deposit, o.invoice.currency)} payé,{' '}
              <span className="font-semibold text-[#1a1a2e]">solde {money(o.invoice.balance, o.invoice.currency)}</span>
            </p>
          )}
        </div>
        <div className="text-right">
          <p className="inline-flex items-center gap-1.5 text-xs font-semibold" style={{ color: st.color }}><Icon size={13} />{st.label}</p>
          <p className="text-[11px] text-[#6b6b63] tabular-nums">
            {st.left >= 0 ? `${st.next} dans ${int(st.left)} ${plural(st.left, 'jour', 'jours')}` : `en retard de ${int(-st.left)} ${plural(-st.left, 'jour', 'jours')}`}
          </p>
        </div>
      </div>

      <Timeline o={o} today={today} />

      <div className="flex items-center gap-2 flex-wrap">
        <button className={btn} onClick={() => setMode(mode === 'receive' ? null : 'receive')}><PackageCheck size={12} className="inline mr-1" />Réception</button>
        <button className={btn} onClick={() => setMode(mode === 'shift' ? null : 'shift')}><CalendarClock size={12} className="inline mr-1" />Décaler une date</button>
        <button className={btn} onClick={() => setOpen((v) => !v)}><ChevronDown size={12} className={`inline mr-1 transition-transform ${open ? 'rotate-180' : ''}`} />Lignes</button>
        <button className="ml-auto text-[11px] text-[#9b9b93] hover:text-[#c7293a]" onClick={() => setMode(mode === 'cancel' ? null : 'cancel')}>Annuler la commande</button>
      </div>

      {mode === 'shift' && (
        <div className="flex items-end gap-3 flex-wrap bg-[#faf9f8] rounded-xl p-3">
          <label className="text-[11px] text-[#6b6b63]">Fin de production
            <input type="date" value={prod} onChange={(e) => setProd(e.target.value)} className="block mt-1 border border-[#e8e4e0] rounded-lg px-2 py-1 text-xs bg-white" />
          </label>
          <label className="text-[11px] text-[#6b6b63]">Arrivée
            <input type="date" value={arrival} onChange={(e) => setArrival(e.target.value)} className="block mt-1 border border-[#e8e4e0] rounded-lg px-2 py-1 text-xs bg-white" />
          </label>
          <button className="px-3 py-1.5 rounded-lg text-xs font-medium bg-[#1a1a2e] text-white" onClick={async () => { if (await act({ action: 'update_order', orderId: o.id, prodDoneOn: prod, arrivalOn: arrival })) setMode(null) }}>Enregistrer</button>
        </div>
      )}

      {mode === 'cancel' && (
        <div className="flex items-center gap-3 flex-wrap bg-[#fce8ea] rounded-xl p-3 text-xs text-[#c7293a]">
          Annuler cette commande ? Ses quantités ne compteront plus dans « En prod. ».
          <button className="px-3 py-1.5 rounded-lg font-medium bg-[#c7293a] text-white" onClick={() => act({ action: 'cancel_order', orderId: o.id })}>Oui, annuler</button>
          <button className="text-[#6b6b63]" onClick={() => setMode(null)}>Non</button>
        </div>
      )}

      {(open || mode === 'receive') && (
        <div className="bg-[#faf9f8] rounded-xl p-3 space-y-1.5">
          {o.lines.map((l) => {
            const rest = l.qty - l.receivedQty
            return (
              <div key={l.id} className="flex items-center gap-3 text-xs">
                <span className="flex-1 min-w-0 truncate text-[#1a1a2e]">{l.title}{l.variantTitle ? <span className="text-[#6b6b63]"> — {l.variantTitle}</span> : null}</span>
                <span className="tabular-nums text-[#6b6b63] shrink-0">{int(l.receivedQty)} / {int(l.qty)} reçues</span>
                {mode === 'receive' && rest > 0 && (
                  <input type="number" min={0} max={rest} value={qty[l.variantId] ?? 0}
                    onChange={(e) => setQty((q) => ({ ...q, [l.variantId]: Math.max(0, Math.min(rest, parseInt(e.target.value) || 0)) }))}
                    className="w-16 text-center border border-[#e8e4e0] rounded-lg px-1.5 py-1 bg-white tabular-nums" aria-label={`Reçues ${l.title}`} />
                )}
              </div>
            )
          })}
          {mode === 'receive' && (
            <div className="flex items-center gap-3 pt-2 flex-wrap">
              <label className="flex items-center gap-1.5 text-[11px] text-[#6b6b63]">
                <input type="checkbox" checked={closeAll} onChange={(e) => setCloseAll(e.target.checked)} /> Clôturer même s’il manque des unités
              </label>
              <button className="ml-auto px-3 py-1.5 rounded-lg text-xs font-medium text-white" style={{ background: GREEN }}
                onClick={async () => { if (await act({ action: 'receive', orderId: o.id, items: Object.entries(qty).map(([variantId, q]) => ({ variantId, qty: q })), close: closeAll })) setMode(null) }}>
                Enregistrer la réception
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

export default function OrdersInProgress({ orders, today, act, action }: { orders: ReorderOrder[]; today: string; act: Act; action?: React.ReactNode }) {
  const open = orders.filter((o) => o.status === 'open').sort((a, b) => a.arrivalOn.localeCompare(b.arrivalOn))
  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-sm font-bold text-[#1a1a2e]">Commandes en cours</h2>
        {action}
      </div>
      {open.length === 0
        ? <p className={`${CARD} p-4 text-xs text-[#9b9b93]`}>Aucune commande en cours. Valide un bon de commande ou importe la facture d’une commande passée hors de Steero : elle apparaît ici avec ses dates de production et d’arrivée.</p>
        : <div className="grid gap-3 grid-cols-1 lg:grid-cols-2">{open.map((o) => <OrderCard key={o.id} o={o} today={today} act={act} />)}</div>}
    </section>
  )
}
