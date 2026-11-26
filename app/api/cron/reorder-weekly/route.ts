// Récap Réappro du lundi (8 h, heure de Paris) : variantes à commander, arrivées de
// la semaine, ruptures en cours, réceptions à confirmer. Envoyé aux destinataires
// des réglages Réappro de chaque marque (aucun destinataire → rien n'est envoyé).
//   GET (cron Vercel)     ?brand=moom pour une seule marque, &dry=1 pour voir le mail sans l'envoyer
import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase'
import { loadReorderInputs } from '@/lib/reorder/data'
import { computeReorder, type ReorderInputs } from '@/lib/reorder/compute'
import { addDays } from '@/lib/reorder/plan'

export const dynamic = 'force-dynamic'
export const maxDuration = 120

const BRANDS = ['moom', 'bowa', 'krom', 'yone']
const LABELS: Record<string, string> = { bowa: 'Bowa', moom: 'Mōom Paris', krom: 'Krom', yone: 'Yone' }
const BASE = (process.env.NEXT_PUBLIC_APP_URL || 'https://www.steero.io').replace(/\/$/, '')

function isAuthorized(req: NextRequest): boolean {
  const h = req.headers.get('authorization') ?? ''
  const t = h.startsWith('Bearer ') ? h.slice(7) : h
  return (!!process.env.CRON_SECRET && t === process.env.CRON_SECRET) || req.headers.get('x-vercel-cron') === '1'
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;')
const day = (d: string | null) => (d ? d.split('-').reverse().join('/') : '—')
const name = (t: string, v: string | null) => esc(`${t.replace(/™/g, '')}${v ? ` — ${v}` : ''}`)

function table(head: string[], rows: string[][]): string {
  if (!rows.length) return '<p style="color:#9b9b93;font-size:13px;margin:4px 0 0">Rien cette semaine.</p>'
  const th = head.map((h, i) => `<th style="text-align:${i ? 'right' : 'left'};font-size:11px;color:#9b9b93;font-weight:600;padding:6px 8px;border-bottom:1px solid #eee">${h}</th>`).join('')
  const tr = rows.map((r) => `<tr>${r.map((c, i) => `<td style="text-align:${i ? 'right' : 'left'};font-size:13px;padding:6px 8px;border-bottom:1px solid #f5f5f3">${c}</td>`).join('')}</tr>`).join('')
  return `<table style="width:100%;border-collapse:collapse;margin-top:6px"><thead><tr>${th}</tr></thead><tbody>${tr}</tbody></table>`
}

function buildRecap(brand: string, inp: ReorderInputs) {
  const { rows, proposals, kpis } = computeReorder(inp)
  const today = inp.today
  const toOrder = rows.filter((r) => r.plan.status === 'order').sort((a, b) => b.plan.lateBy - a.plan.lateBy)
  const ruptures = rows.filter((r) => r.stock <= 0 && r.velocity.daily > 0)
  const weekEnd = addDays(today, 7)
  const arrivals = inp.orders.filter((o) => o.status === 'open' && o.arrivalOn <= weekEnd)
    .sort((a, b) => a.arrivalOn.localeCompare(b.arrivalOn))
  const link = (view: string) => `${BASE}/${brand}/reorder${view}`
  const button = (label: string, href: string) =>
    `<a href="${href}" style="display:inline-block;background:#1a1a2e;color:#fff;text-decoration:none;font-size:13px;font-weight:600;padding:10px 16px;border-radius:10px">${label}</a>`
  const h2 = (t: string) => `<h2 style="font-size:15px;color:#1a1a2e;margin:24px 0 0">${t}</h2>`

  const subject = `Réappro ${LABELS[brand] ?? brand} : ${toOrder.length} à commander, ${ruptures.length} en rupture`
  const html = `<div style="font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;max-width:620px;color:#1a1a2e">
  <h1 style="font-size:18px;margin:0">Réappro ${esc(LABELS[brand] ?? brand)}, semaine du ${day(today)}</h1>
  <p style="font-size:13px;color:#6b6b63;margin:6px 0 0">
    ${kpis.daysWithoutRupture ?? '—'} jours sans rupture, ${Math.round(kpis.lostThisMonth).toLocaleString('fr-FR')} € de CA perdu en rupture ce mois,
    ${Math.round(kpis.engaged).toLocaleString('fr-FR')} € engagés dans les commandes en cours.
  </p>
  ${proposals.length ? `<p style="font-size:13px;margin:12px 0 0;color:#1a7f4b"><b>${proposals.length} réception${proposals.length > 1 ? 's' : ''} à confirmer</b> (hausse de stock constatée).</p>` : ''}
  ${h2(`À commander (${toOrder.length})`)}
  ${table(['Variante', 'Stock', 'Rupture le', 'Qté conseillée'], toOrder.slice(0, 25).map((r) => [
    `${name(r.title, r.variantTitle)}${r.plan.lateBy > 0 ? ' <b style="color:#c7293a">urgent</b>' : ''}`, String(r.stock), r.plan.ruptureOn && r.plan.ruptureOn <= today ? 'en rupture' : day(r.plan.ruptureOn), `<b>${r.plan.suggested}</b>`]))}
  ${toOrder.length > 25 ? `<p style="font-size:12px;color:#9b9b93">… et ${toOrder.length - 25} autres.</p>` : ''}
  <p style="margin:12px 0 0">${button('Préparer le bon de commande', link(''))}</p>
  ${h2(`Arrivées de la semaine (${arrivals.length})`)}
  ${table(['Commande', 'Unités', 'Arrivée'], arrivals.map((o) => [
    `Commande du ${day(o.orderedOn)}`, String(o.lines.reduce((a, l) => a + l.qty - l.receivedQty, 0)), o.arrivalOn < today ? `<span style="color:#c7293a">prévue le ${day(o.arrivalOn)}</span>` : day(o.arrivalOn)]))}
  ${h2(`Ruptures en cours (${ruptures.length})`)}
  ${table(['Variante', 'Ventes / jour', 'En commande'], ruptures.map((r) => [
    name(r.title, r.variantTitle), r.velocity.daily.toLocaleString('fr-FR', { maximumFractionDigits: 1 }), String(r.plan.inProduction + r.plan.inTransit + r.plan.manual || '—')]))}
  <p style="margin:24px 0 0">${button('Ouvrir Réappro', link(''))}</p>
</div>`
  return { subject, html, counts: { toOrder: toOrder.length, ruptures: ruptures.length, arrivals: arrivals.length, proposals: proposals.length } }
}

export async function GET(req: NextRequest) {
  if (!isAuthorized(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const only = req.nextUrl.searchParams.get('brand')
  const dry = req.nextUrl.searchParams.get('dry') === '1'
  const db = createAdminClient()
  const key = process.env.RESEND_API_KEY
  const out: Record<string, unknown> = {}
  for (const brand of only ? [only] : BRANDS) {
    try {
      const inp = await loadReorderInputs(db, brand)
      const to = inp.settings.recipients
      if (!to.length && !dry) { out[brand] = 'aucun destinataire'; continue }
      const recap = buildRecap(brand, inp)
      if (dry) { out[brand] = { subject: recap.subject, counts: recap.counts, html: recap.html }; continue }
      if (!key) { out[brand] = 'RESEND_API_KEY manquante'; continue }
      const r = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ from: 'Steero <notifications@notifications.bowa-concept.com>', to, subject: recap.subject, html: recap.html }),
      })
      out[brand] = { sent: r.ok, status: r.status, counts: recap.counts }
    } catch (e) {
      out[brand] = { error: (e as Error).message }
    }
  }
  return NextResponse.json(out)
}
