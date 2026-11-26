// Formats partagés par les composants Réappro.
export const eur0 = (n: number) => new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }).format(n)
export const int = (n: number) => Math.round(n).toLocaleString('fr-FR')
export const dec = (n: number, d = 1) => n.toLocaleString('fr-FR', { minimumFractionDigits: d, maximumFractionDigits: d })

// 'YYYY-MM-DD' → '26/11' (court) ou '26/11/2026'
export function fmtDay(day: string | null | undefined, long = false): string {
  if (!day) return '—'
  const [y, m, d] = day.split('-')
  return long ? `${d}/${m}/${y}` : `${d}/${m}`
}

export const plural = (n: number, one: string, many: string) => (Math.abs(n) > 1 ? many : one)

export const CARD = 'bg-white rounded-[16px] shadow-[0_2px_16px_rgba(0,0,0,0.06)]'
export const GREEN = '#1a7f4b', ORANGE = '#b45309', RED = '#c7293a'
