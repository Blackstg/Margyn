'use client'

// Réceptions détectées : le stock Shopify d'une variante a nettement augmenté d'un
// jour à l'autre. Avec une commande en cours → « Commande du JJ/MM reçue ? » ;
// sans commande → proposer de la créer après coup.
import { useState } from 'react'
import { PackageCheck, PackagePlus } from 'lucide-react'
import type { ReceiptProposal } from '@/lib/reorder/plan'
import { addDays } from '@/lib/reorder/plan'
import type { ReorderRow } from '@/lib/reorder/compute'
import { CARD, GREEN, fmtDay, int } from './format'

type Act = (body: Record<string, unknown>) => Promise<boolean>

function Prompt({ p, row, lead, act }: { p: ReceiptProposal; row?: ReorderRow; lead: number; act: Act }) {
  const [qty, setQty] = useState(p.qty)
  const [orderedOn, setOrderedOn] = useState(addDays(p.day, -lead))
  const jump = `${p.variantId}|${p.day}`
  const name = row ? `${row.title}${row.variantTitle ? ` — ${row.variantTitle}` : ''}` : p.variantId
  const order = p.kind === 'order'
  const Icon = order ? PackageCheck : PackagePlus
  return (
    <div className={`${CARD} p-4 border-l-4 space-y-2`} style={{ borderLeftColor: GREEN }}>
      <p className="text-sm font-semibold text-[#1a1a2e] flex items-center gap-1.5">
        <Icon size={14} style={{ color: GREEN }} />
        {order ? `Commande du ${fmtDay(p.orderedOn)} reçue ?` : 'Stock en hausse sans commande en cours'}
      </p>
      <p className="text-xs text-[#6b6b63]">
        {name} : +{int(p.qty)} unités constatées le {fmtDay(p.day)}
        {order && <> (attendu : {int(p.remaining)})</>}.
      </p>
      <div className="flex items-center gap-2 flex-wrap">
        <label className="text-[11px] text-[#6b6b63] flex items-center gap-1.5">Quantité reçue
          <input type="number" min={1} value={qty} onChange={(e) => setQty(Math.max(0, parseInt(e.target.value) || 0))}
            className="w-16 text-center border border-[#e8e4e0] rounded-lg px-1.5 py-1 bg-white tabular-nums text-xs" />
        </label>
        {!order && (
          <label className="text-[11px] text-[#6b6b63] flex items-center gap-1.5">commandée le
            <input type="date" value={orderedOn} onChange={(e) => setOrderedOn(e.target.value)} className="border border-[#e8e4e0] rounded-lg px-1.5 py-1 bg-white text-xs" />
          </label>
        )}
        <button className="px-3 py-1.5 rounded-lg text-xs font-medium text-white" style={{ background: GREEN }} disabled={qty <= 0}
          onClick={() => order
            ? act({ action: 'receive', orderId: p.orderId, items: [{ variantId: p.variantId, qty }], jump })
            : act({ action: 'create_order', source: 'after_the_fact', orderedOn, lines: [{ variantId: p.variantId, qty, receivedQty: qty }] })
                .then((ok) => ok && act({ action: 'dismiss_jump', jump }))}>
          {order ? (qty >= p.remaining ? 'Oui, reçue' : 'Oui, réception partielle') : 'Créer la commande après coup'}
        </button>
        <button className="text-[11px] text-[#9b9b93] hover:text-[#1a1a2e]" onClick={() => act({ action: 'dismiss_jump', jump })}>
          {order ? 'Non, autre chose' : 'Ignorer'}
        </button>
      </div>
    </div>
  )
}

export default function ReceiptPrompts({ proposals, rows, lead, act }: { proposals: ReceiptProposal[]; rows: Map<string, ReorderRow>; lead: number; act: Act }) {
  if (!proposals.length) return null
  return (
    <div className="grid gap-3 grid-cols-1 lg:grid-cols-2">
      {proposals.map((p) => <Prompt key={`${p.variantId}|${p.day}`} p={p} row={rows.get(p.variantId)} lead={lead} act={act} />)}
    </div>
  )
}
