// Bandeau « À retenir » : une phrase courte et un gros chiffre par carte.
import type { Takeaway } from '@/lib/margins/packRules'
import { VERDICT_STYLE } from './VerdictBadge'

export default function TakeawayCards({ items }: { items: Takeaway[] }) {
  if (!items.length) return null
  return (
    <div className="grid gap-3 grid-cols-1 sm:grid-cols-2 xl:grid-cols-4">
      {items.map(t => {
        const s = VERDICT_STYLE[t.tone]
        return (
          <div key={t.title} className="bg-white rounded-[16px] shadow-[0_2px_16px_rgba(0,0,0,0.06)] p-4 border-l-4" style={{ borderLeftColor: s.fg }}>
            <p className="text-2xl font-bold tabular-nums leading-none" style={{ color: s.fg }}>{t.big}</p>
            <p className="text-sm font-semibold text-[#1a1a2e] mt-2 leading-snug">{t.title}</p>
            <p className="text-[11px] text-[#6b6b63] mt-1 leading-snug">{t.text}</p>
          </div>
        )
      })}
    </div>
  )
}
