// « Ce produit a-t-il sa place dans le pack ? » : ce qu'il reste quand le produit est
// ajouté à une commande, sans remise puis aux remises du pack. Détail au survol.
import { PACK_RULES, type AddOutcome, type ProductEconomics } from '@/lib/margins/packRules'
import { VERDICT_STYLE } from './VerdictBadge'

const eur = (n: number) => `${n >= 0 ? '+' : '−'}${Math.abs(n).toLocaleString('fr-FR', { maximumFractionDigits: 0 })} €`
const eur2 = (n: number) => n.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €'

export default function PackGrid({ rows }: { rows: { p: ProductEconomics; add: AddOutcome[] }[] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs border-separate" style={{ borderSpacing: '0 4px' }}>
        <thead>
          <tr className="text-[#9b9b93]">
            <th className="text-left font-medium pl-5 pb-1">Produit ajouté</th>
            {PACK_RULES.discounts.map(d => <th key={d.label} className="font-medium pb-1 px-1 text-center whitespace-nowrap">{d.label}</th>)}
            <th className="w-4" />
          </tr>
        </thead>
        <tbody>
          {rows.map(({ p, add }) => (
            <tr key={p.key}>
              <td className="pl-5 pr-2 text-[#1a1a2e] font-medium whitespace-nowrap">{p.title}</td>
              {add.map(a => {
                const s = VERDICT_STYLE[a.verdict]
                const tip = `${p.title} ajouté${a.pct ? ` à ${a.label}` : ' sans remise'}\nPrix : ${eur2(a.price)}\nAchat : −${eur2(p.purchase)}\nCoût d'ajout dans le colis : −${eur2(p.addCost)}\nCe qu'il reste : ${eur2(a.left)}`
                return (
                  <td key={a.label} className="px-1">
                    <div title={tip} className="rounded-lg py-1.5 text-center font-semibold tabular-nums cursor-help min-w-[64px]" style={{ color: s.fg, background: s.bg }}>
                      {eur(a.left)}
                    </div>
                  </td>
                )
              })}
              <td className="w-4" />
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
