// En haut de l'onglet : jours sans rupture, CA perdu en rupture ce mois,
// argent engagé dans les commandes en cours.
import { CARD, GREEN, ORANGE, RED, eur0, int, plural } from './format'

type Kpis = { daysWithoutRupture: number | null; lostThisMonth: number; ruptureNow: number; engaged: number }

export default function ReorderKpis({ kpis, openOrders }: { kpis: Kpis; openOrders: number }) {
  const d = kpis.daysWithoutRupture
  const cards = [
    {
      color: kpis.ruptureNow ? RED : GREEN,
      big: d == null ? '—' : `${int(d)} ${plural(d, 'jour', 'jours')}`,
      title: 'sans rupture',
      text: kpis.ruptureNow
        ? `${kpis.ruptureNow} ${plural(kpis.ruptureNow, 'variante est', 'variantes sont')} à zéro aujourd'hui.`
        : 'Aucune variante qui se vend n’est à zéro aujourd’hui.',
    },
    {
      color: kpis.lostThisMonth > 0 ? ORANGE : GREEN,
      big: eur0(kpis.lostThisMonth),
      title: 'de CA perdu en rupture ce mois',
      text: 'Ventes par jour × jours à zéro × prix de vente.',
    },
    {
      color: '#6f739f',
      big: eur0(kpis.engaged),
      title: 'engagés dans les commandes en cours',
      text: openOrders
        ? `${openOrders} ${plural(openOrders, 'commande', 'commandes')} pas encore ${plural(openOrders, 'reçue', 'reçues')}, au coût d’achat.`
        : 'Aucune commande en cours.',
    },
  ]
  return (
    <div className="grid gap-3 grid-cols-1 sm:grid-cols-3">
      {cards.map((c) => (
        <div key={c.title} className={`${CARD} p-4 border-l-4`} style={{ borderLeftColor: c.color }}>
          <p className="text-2xl font-bold tabular-nums leading-none" style={{ color: c.color }}>{c.big}</p>
          <p className="text-sm font-semibold text-[#1a1a2e] mt-2 leading-snug">{c.title}</p>
          <p className="text-[11px] text-[#6b6b63] mt-1 leading-snug">{c.text}</p>
        </div>
      ))}
    </div>
  )
}
