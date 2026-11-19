// Audit du suivi client : compare ce que la page /tracking/[brand] affiche au suivi
// YunExpress réel (17Track, la référence), et vérifie les règles d'affichage qui sont
// déjà retombées plusieurs fois (statut en retard / en avance, estimation, Chine /
// YunExpress visibles, libellés anglais). Pur : utilisé par /api/cron/tracking-audit.
import {
  type TrackingResult, RT_PHASES, PHASE_IDX, buildRealTimeline, estimatedDeliveryRange,
  localEvents, localCarrier, frLabel, looksEnglish, prettyPlace, phaseOf, handoverTime, countryOf,
} from '@/lib/tracking/display'
import type { Track17Result } from '@/lib/track17'

export type AuditIssue = { kind: string; detail: string }

const LEAK_RE = /yunexpress|\bchin(a|e)\b|shenzhen|guangzhou|dongguan|yiwu|hong ?kong|mainland/i
const HOUR = 3600_000

const parisDay = (d: Date) => d.toLocaleDateString('fr-CA', { timeZone: 'Europe/Paris' })
const fmt = (iso?: string | null) => iso ? new Date(iso).toLocaleString('fr-FR', { timeZone: 'Europe/Paris', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—'

// Phase atteinte d'après une liste de scans (même règles que la page).
function phaseFromEvents(events: TrackingResult['tracking_events'], delivered: boolean): number {
  if (delivered) return PHASE_IDX.delivered
  const ho = handoverTime(events)
  const latest = events[0]
  const p = latest ? phaseOf(latest, ho) : null
  return p ?? 0
}

export function auditTracking(page: TrackingResult, truth: Track17Result | null, now = new Date()): AuditIssue[] {
  const issues: AuditIssue[] = []
  const push = (kind: string, detail: string) => issues.push({ kind, detail })
  const events = page.tracking_events ?? []
  if (!page.has_carrier_data || !events.length) return issues

  // ── Statut affiché vs suivi réel ──────────────────────────────────────────
  const timeline = buildRealTimeline(page, null)
  const shownIdx = timeline.reduce((acc, t, i) => (t.status !== 'upcoming' ? i : acc), 0)
  const pageDelivered = page.step === 5
  if (truth && truth.events.length) {
    const tLatest = truth.events[0], pLatest = events[0]
    const truthIdx = phaseFromEvents(truth.events, truth.delivered)
    if (new Date(tLatest.date).getTime() > new Date(pLatest.date).getTime() + HOUR)
      push('retard', `dernier scan affiché ${fmt(pLatest.date)} « ${frLabel(pLatest.label)} », 17Track a ${fmt(tLatest.date)} « ${frLabel(tLatest.label)} »`)
    if (truth.delivered && !pageDelivered) push('livré non affiché', `17Track : livré le ${fmt(tLatest.date)}`)
    else if (shownIdx < truthIdx && truthIdx !== PHASE_IDX.delivered && !(shownIdx === PHASE_IDX.sorting && truthIdx === PHASE_IDX.domestic))
      push('étape en retard', `page « ${RT_PHASES[shownIdx].title} », 17Track « ${RT_PHASES[truthIdx].title} » (${frLabel(tLatest.label)})`)
    else if (shownIdx > truthIdx + 1 && new Date(pLatest.date).getTime() <= new Date(tLatest.date).getTime())
      push('étape en avance', `page « ${RT_PHASES[shownIdx].title} », 17Track seulement « ${RT_PHASES[truthIdx].title} » (${frLabel(tLatest.label)})`)
  }

  // ── Estimation de livraison ───────────────────────────────────────────────
  if (!pageDelivered) {
    const est = estimatedDeliveryRange(page, null)
    if (est) {
      if (parisDay(est.to) < parisDay(now)) push('estimation passée', `livraison estimée ${parisDay(est.to)}`)
      if ((est.to.getTime() - now.getTime()) > 25 * 24 * HOUR) push('estimation lointaine', `livraison estimée ${parisDay(est.to)}`)
      const latest = events[0]
      const outToday = phaseOf(latest, handoverTime(events)) === PHASE_IDX.delivery && parisDay(new Date(latest.date)) === parisDay(now)
      if (outToday && parisDay(est.to) !== parisDay(now)) push('estimation incohérente', `en tournée aujourd'hui mais estimée ${parisDay(est.from)} – ${parisDay(est.to)}`)
    }
  }

  // ── Ce que le client lit : pas de Chine / YunExpress, pas d'anglais ────────
  const carrier = localCarrier(page.carrier_name)
  if (carrier && (LEAK_RE.test(carrier) || /[()]/.test(carrier))) push('transporteur', `nom affiché « ${carrier} »`)
  for (const t of timeline) {
    const txt = [t.title, t.desc, t.place, t.nextup].filter(Boolean).join(' ')
    if (LEAK_RE.test(txt)) { push('fuite Chine', `étape « ${t.title} » : ${txt.slice(0, 120)}`); break }
  }
  for (const e of localEvents(events)) {
    const label = frLabel(e.label)
    const txt = [label, e.message, prettyPlace(e.location)].filter(Boolean).join(' ')
    if (countryOf(e.location) === 'CN' || LEAK_RE.test(txt)) { push('fuite Chine', `détail : ${txt.slice(0, 120)}`); break }
  }
  const english = Array.from(new Set(localEvents(events).map(e => frLabel(e.label)).filter(looksEnglish)))
  if (english.length) push('libellé anglais', english.slice(0, 4).join(' | '))

  return issues
}
