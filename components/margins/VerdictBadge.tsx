// Badge de verdict : couleur + icône + libellé (Rentable / Limite / À perte).
import { CheckCircle2, AlertTriangle, XCircle } from 'lucide-react'
import { VERDICT_LABEL, type Verdict } from '@/lib/margins/packRules'

export const VERDICT_STYLE: Record<Verdict, { fg: string; bg: string }> = {
  rentable: { fg: '#1a7f4b', bg: '#e6f4ec' },
  limite:   { fg: '#b45309', bg: '#fff3cd' },
  perte:    { fg: '#c7293a', bg: '#fde8ea' },
}
const ICON: Record<Verdict, typeof CheckCircle2> = { rentable: CheckCircle2, limite: AlertTriangle, perte: XCircle }

export default function VerdictBadge({ verdict }: { verdict: Verdict }) {
  const s = VERDICT_STYLE[verdict], Icon = ICON[verdict]
  return (
    <span className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold" style={{ color: s.fg, background: s.bg }}>
      <Icon size={11} strokeWidth={2.4} /> {VERDICT_LABEL[verdict]}
    </span>
  )
}
