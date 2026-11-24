// POST /api/avis/[brand] — enregistre une réponse à l'enquête de satisfaction.
// 1er appel : { ref?, source?, rating } → crée (ou reprend, si lien personnel) la
//   réponse et renvoie { id, key } ; appels suivants : { id, key, ...détails }.
// Note ≤ 3 terminée → alerte mail (REVIEW_ALERT_EMAIL, sinon TRACKING_AUDIT_EMAIL).
import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase'
import { isReviewBrand, verifyReviewRef, REVIEW_CONFIG } from '@/lib/reviews'
import { REVIEW_CATEGORY_LABEL } from '@/lib/reviews-shared'
import { BRAND_LABELS, type Brand } from '@/lib/access'

export const dynamic = 'force-dynamic'

const SOURCES = ['klaviyo', 'omnisend', 'livraison', 'direct']
const UUID_RE = /^[0-9a-f-]{36}$/i
const clip = (v: unknown, n: number) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, n) : null)
const esc = (s: string) => s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!))

type Body = {
  ref?: string; source?: string; id?: string; key?: string
  rating?: number; categories?: string[]; comment?: string
  contact_requested?: boolean; contact_phone?: string; contact_email?: string
  trustpilot_clicked?: boolean; completed?: boolean
}

export async function POST(req: NextRequest, { params }: { params: { brand: string } }) {
  const brand = params.brand
  if (!isReviewBrand(brand)) return NextResponse.json({ error: 'Marque inconnue' }, { status: 404 })
  let body: Body
  try { body = await req.json() } catch { return NextResponse.json({ error: 'JSON invalide' }, { status: 400 }) }
  const admin = createAdminClient()
  const now = new Date().toISOString()

  const patch: Record<string, unknown> = { updated_at: now }
  if (body.rating !== undefined) {
    const r = Number(body.rating)
    if (!Number.isInteger(r) || r < 1 || r > 5) return NextResponse.json({ error: 'Note invalide' }, { status: 400 })
    patch.rating = r
  }
  if (Array.isArray(body.categories)) patch.categories = body.categories.filter(c => c in REVIEW_CATEGORY_LABEL).slice(0, 5)
  if (body.comment !== undefined) patch.comment = clip(body.comment, 2000)
  if (body.contact_requested !== undefined) patch.contact_requested = !!body.contact_requested
  if (body.contact_phone !== undefined) patch.contact_phone = clip(body.contact_phone, 30)
  if (body.contact_email !== undefined) patch.contact_email = clip(body.contact_email, 200)
  if (body.trustpilot_clicked) patch.trustpilot_clicked = true
  if (body.completed) patch.completed = true

  // ── Mise à jour d'une réponse existante ────────────────────────────────────
  if (body.id) {
    if (!UUID_RE.test(body.id) || !body.key || !UUID_RE.test(body.key)) return NextResponse.json({ error: 'Réponse introuvable' }, { status: 404 })
    const { data: prev } = await admin.from('review_responses').select('id, completed, contact_requested').eq('id', body.id).eq('edit_key', body.key).eq('brand', brand).maybeSingle()
    if (!prev) return NextResponse.json({ error: 'Réponse introuvable' }, { status: 404 })
    const { data: row, error } = await admin.from('review_responses').update(patch).eq('id', prev.id).select('*').single()
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    if (row.completed && !prev.completed && row.rating <= 3) await alertLowRating(brand, row).catch(() => null)
    return NextResponse.json({ id: row.id, key: row.edit_key })
  }

  // ── Première note ──────────────────────────────────────────────────────────
  if (patch.rating === undefined) return NextResponse.json({ error: 'Note manquante' }, { status: 400 })
  const order = body.ref ? await verifyReviewRef(brand, body.ref) : null
  const base = {
    brand,
    source: SOURCES.includes(body.source ?? '') ? body.source : (order ? 'klaviyo' : 'direct'),
    ...(order ? { order_id: order.orderId, order_name: order.orderName, customer_name: `${order.firstName} ${order.lastName}`.trim() || null, customer_email: order.email } : {}),
  }
  if (order) {
    // Une réponse par commande : on reprend celle qui existe (le client change d'avis).
    const { data: prev } = await admin.from('review_responses').select('id').eq('brand', brand).eq('order_id', order.orderId).maybeSingle()
    if (prev) {
      const { data: row, error } = await admin.from('review_responses').update({ ...patch, completed: false, trustpilot_clicked: false }).eq('id', prev.id).select('id, edit_key').single()
      if (error) return NextResponse.json({ error: error.message }, { status: 500 })
      return NextResponse.json({ id: row.id, key: row.edit_key })
    }
  }
  const { data: row, error } = await admin.from('review_responses').insert({ ...base, ...patch }).select('id, edit_key').single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ id: row.id, key: row.edit_key })
}

type Row = { id: string; rating: number; order_name: string | null; customer_name: string | null; customer_email: string | null; categories: string[]; comment: string | null; contact_requested: boolean; contact_phone: string | null; contact_email: string | null }

async function alertLowRating(brand: keyof typeof REVIEW_CONFIG, r: Row) {
  const to = process.env.REVIEW_ALERT_EMAIL || process.env.TRACKING_AUDIT_EMAIL
  if (!to || !process.env.RESEND_API_KEY) return
  const label = BRAND_LABELS[brand as Brand]
  const lines = [
    `<b>Note :</b> ${r.rating}/5`,
    r.order_name ? `<b>Commande :</b> ${esc(r.order_name)}` : '<b>Commande :</b> inconnue (lien générique)',
    r.customer_name || r.customer_email ? `<b>Client :</b> ${esc([r.customer_name, r.customer_email].filter(Boolean).join(' · '))}` : '',
    r.categories.length ? `<b>Problème :</b> ${r.categories.map(c => REVIEW_CATEGORY_LABEL[c] ?? c).join(', ')}` : '',
    r.comment ? `<b>Commentaire :</b><br>${esc(r.comment).replace(/\n/g, '<br>')}` : '',
    r.contact_requested ? `<b>Souhaite être recontacté(e)</b>${r.contact_phone ? ` au ${esc(r.contact_phone)}` : ''}${r.contact_email ? ` · ${esc(r.contact_email)}` : ''}` : 'Ne demande pas de rappel',
  ].filter(Boolean)
  await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: 'Steero <notifications@notifications.bowa-concept.com>',
      to: to.split(',').map(s => s.trim()),
      ...(r.contact_email || r.customer_email ? { reply_to: r.contact_email || r.customer_email } : {}),
      subject: `[Avis ${label}] ${r.rating}/5${r.order_name ? ` — ${r.order_name}` : ''}${r.contact_requested ? ' · rappel demandé' : ''}`,
      html: `<div style="font:14px/1.6 sans-serif;color:#1a1a2e">${lines.map(l => `<p style="margin:0 0 8px">${l}</p>`).join('')}<p style="color:#9b9b93;font-size:12px">Retour laissé sur la page d’avis ${label} · à traiter dans Steero › Avis clients</p></div>`,
    }),
  })
}
