import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { buildReminderEmailHtml } from '@/lib/delivery/reminderEmail'
import { resendFrom } from '@/lib/tenant/integrations'

function getAdmin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}

function firstNameOf(fullName: string): string {
  return fullName?.split(' ')[0] ?? fullName ?? ''
}

// Téléphone du chauffeur assigné à la tournée : on le lit sur SON compte
// (user_metadata.phone), en matchant full_name == driver_name. Null si inconnu
// → le mail n'affiche alors AUCUN numéro (plutôt qu'un ancien numéro erroné).
const normName = (s: string) => (s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim()
async function resolveDriverPhone(admin: ReturnType<typeof getAdmin>, driverName?: string | null): Promise<string | null> {
  const target = normName(driverName ?? '')
  if (!target) return null
  try {
    const { data } = await admin.auth.admin.listUsers({ perPage: 1000 })
    for (const u of data?.users ?? []) {
      const m = (u.user_metadata ?? {}) as { full_name?: string; name?: string; phone?: string; phone_number?: string }
      if (normName(m.full_name || m.name || '') === target) {
        const phone = String(m.phone || m.phone_number || '').trim()
        return phone || null
      }
    }
  } catch { /* liste indisponible → pas de numéro */ }
  return null
}

// Ajoute N jours OUVRÉS (on ne livre pas le samedi/dimanche) : chaque week-end
// est sauté dans le décompte, et le résultat tombe toujours un jour de semaine.
function addWorkingDays(dateStr: string, days: number): Date {
  const result = new Date(dateStr + 'T00:00:00')
  let added = 0
  while (added < days) {
    result.setDate(result.getDate() + 1)
    const dow = result.getDay()
    if (dow !== 0 && dow !== 6) added++
  }
  return result
}

function fmtDateLong(d: Date): string {
  return d.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
}

const APP_URL = 'https://www.steero.io'

// windowDays : 0 = pas de date client → fenêtre large "cette semaine" (X..X+4).
//              1 = jour exact "le X". >=2 = fenêtre "entre le X et le X+(w-1)".
// Ligne « le livreur vous appellera » : avec le numéro du chauffeur assigné si on
// le connaît, sinon sans numéro (JAMAIS un ancien numéro codé en dur).
function callLine(phone: string | null): string {
  return phone
    ? `Notre livreur vous appellera avant de passer, depuis le numéro suivant&nbsp;: <strong>${phone}</strong>.`
    : `Notre livreur vous appellera avant de passer.`
}

function buildEmailHtml(firstName: string, startDateStr: string, stopId: string, windowDays = 0, phone: string | null = null): string {
  const start   = new Date(startDateStr + 'T00:00:00')
  const startFr = fmtDateLong(start)

  let dateLine: string
  if (windowDays >= 1) {
    if (windowDays === 1) {
      dateLine = `Notre livreur passera chez vous le <strong>${startFr}</strong>.`
    } else {
      const endFr = fmtDateLong(addWorkingDays(startDateStr, windowDays - 1))
      dateLine = `Notre livreur passera chez vous entre le <strong>${startFr}</strong> et le <strong>${endFr}</strong>.`
    }
  } else {
    const endFr = fmtDateLong(addWorkingDays(startDateStr, 4))
    dateLine = `Notre livreur commencera sa tournée le <strong>${startFr}</strong> et passera chez vous dans les prochains jours (entre le ${startFr} et le ${endFr}).`
  }

  const confirmUrl     = `${APP_URL}/api/delivery/confirm?stop=${stopId}&action=confirmed`
  const unavailableUrl = `${APP_URL}/api/delivery/confirm?stop=${stopId}&action=unavailable`

  return `<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Votre livraison Bowa arrive cette semaine !</title>
</head>
<body style="margin:0;padding:0;background:#f1ebe7;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f1ebe7;padding:32px 16px;">
    <tr>
      <td align="center">
        <table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;">

          <!-- Logo -->
          <tr>
            <td align="center" style="padding-bottom:28px;">
              <img src="https://bowa-concept.com/cdn/shop/files/logo.png?v=1693451719"
                alt="Bowa Concept" width="140" style="display:block;height:auto;" />
            </td>
          </tr>

          <!-- Card -->
          <tr>
            <td style="background:#ffffff;border-radius:20px;padding:40px 40px 32px;box-shadow:0 4px 24px rgba(0,0,0,0.06);">

              <p style="font-size:36px;margin:0 0 8px;text-align:center;">🚛</p>
              <h1 style="margin:0 0 24px;font-size:22px;font-weight:700;color:#1a1a2e;text-align:center;line-height:1.3;">
                Votre livraison Bowa<br/>arrive cette semaine !
              </h1>

              <p style="margin:0 0 16px;font-size:15px;color:#3a3a3a;line-height:1.6;">
                Bonjour <strong>${firstName}</strong>,
              </p>
              <p style="margin:0 0 16px;font-size:15px;color:#3a3a3a;line-height:1.6;">
                Bonne nouvelle&nbsp;! 🎉 Votre commande sera livrée prochainement.<br/>
                ${dateLine}
              </p>
              <p style="margin:0 0 24px;font-size:15px;color:#3a3a3a;line-height:1.6;">
                La livraison s'effectuera au pied du camion 🚛. Nous vous demandons donc de faire le nécessaire pour être accompagné(e) d'une autre personne afin de récupérer les panneaux en toute sécurité 🔧.
              </p>
              <p style="margin:0 0 28px;font-size:15px;color:#3a3a3a;line-height:1.6;">
                ${callLine(phone)}
              </p>

              <!-- Availability CTA -->
              <table width="100%" cellpadding="0" cellspacing="0" style="background:#f8f4f1;border-radius:14px;padding:24px;margin-bottom:28px;">
                <tr>
                  <td align="center">
                    <p style="margin:0 0 20px;font-size:15px;color:#3a3a3a;line-height:1.6;font-weight:600;">
                      Serez-vous disponible pour réceptionner votre commande cette semaine ?
                    </p>
                    <table cellpadding="0" cellspacing="0">
                      <tr>
                        <td style="padding-right:10px;">
                          <a href="${confirmUrl}" target="_blank"
                            style="display:inline-block;background:#1a7f4b;color:#ffffff;font-size:14px;font-weight:700;text-decoration:none;padding:13px 24px;border-radius:50px;letter-spacing:0.2px;">
                            ✅ Oui, je serai présent(e)
                          </a>
                        </td>
                        <td>
                          <a href="${unavailableUrl}" target="_blank"
                            style="display:inline-block;background:#ffffff;color:#c2410c;font-size:14px;font-weight:700;text-decoration:none;padding:12px 24px;border-radius:50px;letter-spacing:0.2px;border:2px solid #fed7aa;">
                            ❌ Je ne serai pas disponible
                          </a>
                        </td>
                      </tr>
                    </table>
                    <p style="margin:16px 0 0;font-size:12px;color:#9ca3af;line-height:1.5;">
                      Sans réponse de votre part, nous considérons que vous serez disponible.
                    </p>
                  </td>
                </tr>
              </table>

              <hr style="border:none;border-top:1px solid #ece8e4;margin:0 0 20px;" />

              <p style="margin:0 0 4px;font-size:14px;color:#3a3a3a;line-height:1.6;">
                Nous nous réjouissons de finaliser votre livraison très prochainement ☀️
              </p>
              <p style="margin:0 0 16px;font-size:14px;color:#3a3a3a;line-height:1.6;">
                Cordialement,<br/>
                <strong>Léa</strong><br/>
                <span style="color:#6b6b63;">Service client</span>
              </p>
              <p style="margin:0;font-size:12px;color:#9ca3af;line-height:1.6;">
                Pour toute question, écrivez-nous à
                <a href="mailto:lea@bowa-concept.com" style="color:#6b6b63;text-decoration:none;">lea@bowa-concept.com</a>
              </p>

            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td align="center" style="padding-top:20px;">
              <img src="https://bowa-concept.com/cdn/shop/files/logo.png?v=1693451719"
                alt="Bowa Concept" width="80" style="display:block;height:auto;opacity:0.4;margin-bottom:8px;" />
              <p style="margin:0;font-size:11px;color:#a0998f;line-height:1.5;">
                Bowa Concept — livraison de panneaux solaires en France<br/>
                <a href="https://bowa-concept.com" style="color:#a0998f;">bowa-concept.com</a>
              </p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>`
}

// Mail de RETARD. Deux modes :
//  - mode « jours » (fromMode=false) : « votre livraison est décalée de N jours »,
//    et on annonce une fenêtre [start ; start+marge].
//  - mode « à partir de » (fromMode=true) : on reprend les livraisons à partir d'une
//    date, sans promettre LE jour exact (le livreur appelle avant de passer).
function buildDelayEmailHtml(firstName: string, newStartStr: string, stopId: string, windowDays: number, delayDays: number, fromMode = false, phone: string | null = null): string {
  const startFr = fmtDateLong(new Date(newStartStr + 'T00:00:00'))
  const endFr   = windowDays >= 2 ? fmtDateLong(addWorkingDays(newStartStr, windowDays - 1)) : ''
  const introLine = fromMode
    ? `Suite à un contretemps sur notre tournée, nous reprenons les livraisons <strong>à partir du ${startFr}</strong>. Toutes nos excuses pour la gêne occasionnée 🙏.`
    : `En raison d'un léger retard sur notre tournée, votre livraison est décalée de <strong>${delayDays} jour${delayDays > 1 ? 's' : ''}</strong>. Toutes nos excuses pour la gêne occasionnée 🙏.`
  const windowLine = fromMode
    ? (endFr
        ? `Notre livreur passera chez vous <strong>à partir du ${startFr}</strong> (au plus tard vers le ${endFr}) — il vous appellera pour convenir du moment.`
        : `Notre livreur passera chez vous <strong>à partir du ${startFr}</strong> — il vous appellera pour convenir du moment.`)
    : (endFr
        ? `Notre livreur passera désormais chez vous <strong>entre le ${startFr} et le ${endFr}</strong>.`
        : `Notre livreur passera désormais chez vous <strong>le ${startFr}</strong>.`)
  return `<!DOCTYPE html><html lang="fr"><head><meta charset="UTF-8"/><meta name="viewport" content="width=device-width, initial-scale=1.0"/></head>
<body style="margin:0;padding:0;background:#f1ebe7;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f1ebe7;padding:32px 16px;"><tr><td align="center">
    <table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;">
      <tr><td align="center" style="padding-bottom:24px;"><img src="https://bowa-concept.com/cdn/shop/files/logo.png?v=1693451719" alt="Bowa Concept" width="140" style="display:block;height:auto;"/></td></tr>
      <tr><td style="background:#ffffff;border-radius:20px;padding:36px 40px 28px;box-shadow:0 4px 24px rgba(0,0,0,0.06);">
        <p style="font-size:34px;margin:0 0 8px;text-align:center;">🚚</p>
        <h1 style="margin:0 0 20px;font-size:21px;font-weight:700;color:#1a1a2e;text-align:center;line-height:1.3;">Petit décalage sur votre livraison</h1>
        <p style="margin:0 0 16px;font-size:15px;color:#3a3a3a;line-height:1.6;">Bonjour <strong>${firstName}</strong>,</p>
        <p style="margin:0 0 16px;font-size:15px;color:#3a3a3a;line-height:1.6;">${introLine}</p>
        <p style="margin:0 0 16px;font-size:15px;color:#3a3a3a;line-height:1.6;">${windowLine}</p>
        <p style="margin:0 0 24px;font-size:15px;color:#3a3a3a;line-height:1.6;">La livraison s'effectue au pied du camion 🚛 — merci de prévoir une personne pour vous aider à réceptionner les panneaux 🔧. ${callLine(phone)}</p>
        <p style="margin:0 0 4px;font-size:14px;color:#3a3a3a;line-height:1.6;">Merci de votre compréhension ☀️</p>
        <p style="margin:0 0 16px;font-size:14px;color:#3a3a3a;line-height:1.6;">Cordialement,<br/><strong>Léa</strong><br/><span style="color:#6b6b63;">Service client</span></p>
        <p style="margin:0;font-size:12px;color:#9ca3af;line-height:1.6;">Pour toute question, écrivez-nous à <a href="mailto:lea@bowa-concept.com" style="color:#6b6b63;text-decoration:none;">lea@bowa-concept.com</a></p>
      </td></tr>
    </table>
  </td></tr></table>
</body></html>`
}

// Mail de RELANCE ABSENCE : le client a répondu « absent ». On accuse réception,
// on insiste gentiment (prochain passage dans ~3 semaines) et on rouvre 3 options.
function buildAbsenceFollowupEmailHtml(firstName: string, stopId: string): string {
  const url = (a: string) => `${APP_URL}/api/delivery/confirm?stop=${stopId}&action=${a}`
  const btn = (href: string, bg: string, color: string, border: string, label: string) =>
    `<a href="${href}" target="_blank" style="display:block;background:${bg};color:${color};font-size:15px;font-weight:700;text-decoration:none;padding:14px 20px;border-radius:12px;border:${border};text-align:center;margin-bottom:10px;">${label}</a>`
  return `<!DOCTYPE html><html lang="fr"><head><meta charset="UTF-8"/><meta name="viewport" content="width=device-width, initial-scale=1.0"/></head>
<body style="margin:0;padding:0;background:#f1ebe7;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f1ebe7;padding:32px 16px;"><tr><td align="center">
    <table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;">
      <tr><td align="center" style="padding-bottom:24px;"><img src="https://bowa-concept.com/cdn/shop/files/logo.png?v=1693451719" alt="Bowa Concept" width="140" style="display:block;height:auto;"/></td></tr>
      <tr><td style="background:#ffffff;border-radius:20px;padding:36px 40px 28px;box-shadow:0 4px 24px rgba(0,0,0,0.06);">
        <p style="font-size:34px;margin:0 0 8px;text-align:center;">📦</p>
        <h1 style="margin:0 0 20px;font-size:21px;font-weight:700;color:#1a1a2e;text-align:center;line-height:1.3;">On aimerait éviter de vous faire attendre</h1>
        <p style="margin:0 0 16px;font-size:15px;color:#3a3a3a;line-height:1.6;">Bonjour <strong>${firstName}</strong>,</p>
        <p style="margin:0 0 16px;font-size:15px;color:#3a3a3a;line-height:1.6;">Nous avons bien noté votre <strong>indisponibilité</strong> pour cette tournée — merci de nous avoir prévenus. 🙏</p>
        <p style="margin:0 0 20px;font-size:15px;color:#3a3a3a;line-height:1.6;">Petit souci : notre prochain passage dans votre région n'aura lieu que <strong>dans environ 3 semaines</strong>. Pour vous livrer plus vite, on se permet d'insister 😊 — <strong>y aurait-il une autre option ?</strong> (le déposer dans votre jardin, chez un voisin, un proche, sur votre lieu de travail…). On est preneur de toute option permettant de vous livrer 🙂</p>
        <table width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 8px;"><tr><td>
          ${btn(url('confirmed'), '#1a7f4b', '#ffffff', 'none', '✅ Finalement, je serai présent(e)')}
          ${btn(url('alternative'), '#1a1a2e', '#ffffff', 'none', '📦 Livrez-moi ailleurs (je vous précise où)')}
          ${btn(url('postponed'), '#ffffff', '#6b6b63', '2px solid #e8e8e4', '📅 Aucune option — livrez au prochain passage')}
        </td></tr></table>
        <p style="margin:16px 0 0;font-size:13px;color:#9ca3af;line-height:1.6;">Si vous choisissez « Livrez-moi ailleurs », répondez à ce mail avec l'adresse/l'option exacte. Une question ? <a href="mailto:lea@bowa-concept.com" style="color:#6b6b63;">lea@bowa-concept.com</a></p>
      </td></tr>
    </table>
  </td></tr></table>
</body></html>`
}

// GET — returns list of stops (with/without email) for preview in modal
export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const admin = getAdmin()

    const baseCols = 'id, customer_name, email, email_sent_at, client_availability, status'
    const getStops = (cols: string) => admin
      .from('delivery_stops')
      .select(cols)
      .eq('tour_id', params.id)
      .order('sequence', { ascending: true })

    let stops: unknown[] | null = null
    let error: { message?: string } | null = null
    {
      const res = await getStops(`${baseCols}, passage_date`)
      stops = res.data as unknown[] | null
      error = res.error
    }
    // Repli si la colonne passage_date n'est pas encore déployée.
    if (error && /passage_date/.test(error.message ?? '')) {
      const res = await getStops(baseCols)
      stops = res.data as unknown[] | null
      error = res.error
    }
    if (error) throw error

    // Aperçu du mail de RETARD : renvoie le HTML réel (même fonction que l'envoi)
    // pour qu'on soit sûr de ce qu'on envoie. ?preview=delay&delayDays=N&windowDays=M
    const preview = _req.nextUrl.searchParams.get('preview')
    if (preview === 'delay') {
      const delayDays  = Math.min(30, Math.max(1, Number(_req.nextUrl.searchParams.get('delayDays'))  || 1))
      const windowDays = Math.min(5,  Math.max(1, Number(_req.nextUrl.searchParams.get('windowDays')) || 4))
      const fromParam  = _req.nextUrl.searchParams.get('fromDate') ?? ''   // mode « à partir de »
      const fromMode   = /^\d{4}-\d{2}-\d{2}$/.test(fromParam)
      type St = { id: string; customer_name: string | null; email: string | null; status: string | null; passage_date?: string | null }
      const list = (stops ?? []) as St[]
      // Client représentatif : 1er « à livrer » avec email, sinon le 1er arrêt.
      const sample = list.find((s) => s.email && s.status === 'pending') ?? list[0]
      const { data: tour } = await admin
        .from('delivery_tours').select('planned_date, driver_name').eq('id', params.id).single()
      const baseDate   = sample?.passage_date || (tour as { planned_date?: string } | null)?.planned_date
                         || new Date().toISOString().slice(0, 10)
      const newStartStr = fromMode ? fromParam : addWorkingDays(baseDate, delayDays).toISOString().slice(0, 10)
      const driverPhone = await resolveDriverPhone(admin, (tour as { driver_name?: string } | null)?.driver_name)
      const html = buildDelayEmailHtml(
        firstNameOf(sample?.customer_name ?? 'Prénom'),
        newStartStr, sample?.id ?? '', windowDays, delayDays, fromMode, driverPhone,
      )
      return NextResponse.json({ html, newStartDate: newStartStr })
    }

    // Aperçu du mail de RELANCE ABSENCE.
    if (preview === 'absence') {
      type St = { id: string; customer_name: string | null; email: string | null; status: string | null; client_availability?: string | null }
      const list = (stops ?? []) as St[]
      const sample = list.find((s) => s.email && s.client_availability === 'unavailable')
                   ?? list.find((s) => s.email && s.status === 'pending') ?? list[0]
      const html = buildAbsenceFollowupEmailHtml(firstNameOf(sample?.customer_name ?? 'Prénom'), sample?.id ?? '')
      return NextResponse.json({ html })
    }

    // Téléphone du chauffeur assigné (pour que l'aperçu du mail affiche le bon numéro).
    const { data: tourRow } = await admin
      .from('delivery_tours').select('driver_name').eq('id', params.id).single()
    const driverPhone = await resolveDriverPhone(admin, (tourRow as { driver_name?: string } | null)?.driver_name)

    return NextResponse.json({ stops: stops ?? [], driverPhone })
  } catch (err) {
    console.error('[delivery/tours/:id/emails GET]', err)
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}

// POST — send notification emails (only to stops without email_sent_at)
export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const body = await req.json().catch(() => ({}))
    const force    = body?.force === true      // force re-send even if already notified
    const reminder = body?.reminder === true   // relance : uniquement les sans-réponse
    const absence  = body?.absence === true    // relance ABSENTS : ont répondu « indisponible »
    const delay    = body?.delay === true      // retard : décale la date et prévient TOUS les clients
    const delayDays = Math.min(30, Math.max(1, Number(body?.delayDays) || 1))
    // Mode « à partir de » : une date précise de reprise (sinon mode « +N jours »).
    const fromDateRaw = typeof body?.fromDate === 'string' ? body.fromDate : ''
    const fromMode = delay && /^\d{4}-\d{2}-\d{2}$/.test(fromDateRaw)
    const minAgeHours = Number(body?.minAgeHours) || 0   // relance : mail envoyé il y a AU MOINS X h
    const maxAgeHours = Number(body?.maxAgeHours) || 0   // relance : … et au PLUS X h (fenêtre cron)
    // Dates de passage par client { stopId: 'YYYY-MM-DD' } — pour les tournées de
    // plusieurs jours : chaque client reçoit LA date où le livreur passe chez lui.
    const dates: Record<string, string> = (body?.dates && typeof body.dates === 'object') ? body.dates : {}
    // Marge de la fenêtre annoncée (1 = jour exact, 2 = "X à X+1", etc.). Défaut 2.
    const windowDays = Math.min(5, Math.max(1, Number(body?.windowDays) || 2))

    const admin = getAdmin()

    // Fetch tour info for the date
    const { data: tour, error: tourError } = await admin
      .from('delivery_tours')
      .select('planned_date, name, driver_name')
      .eq('id', params.id)
      .single()

    if (tourError) throw tourError

    // Téléphone du chauffeur assigné (pour le mettre dans les mails clients).
    const driverPhone = await resolveDriverPhone(admin, (tour as { driver_name?: string } | null)?.driver_name)
    // Expéditeur des mails livraison : config tenant (resend.delivery_from) sinon défaut.
    const deliveryFrom = (await resendFrom('bowa', 'delivery_from')) ?? 'Léa – Bowa Concept <notifications@notifications.bowa-concept.com>'

    // Persist per-client passage dates first (so they stick even outside sending).
    for (const [stopId, d] of Object.entries(dates)) {
      if (typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d)) {
        await admin.from('delivery_stops').update({ passage_date: d }).eq('id', stopId).eq('tour_id', params.id)
      } else if (d === null || d === '') {
        await admin.from('delivery_stops').update({ passage_date: null }).eq('id', stopId).eq('tour_id', params.id)
      }
    }

    // Fetch target stops (repli si la colonne passage_date n'est pas encore déployée).
    const baseCols = 'id, customer_name, email, email_sent_at, client_availability, status'
    const buildQuery = (cols: string) => {
      let q = admin.from('delivery_stops').select(cols).eq('tour_id', params.id)
      if (delay) {
        // Retard : on prévient TOUS les clients encore à livrer (quel que soit l'état de notif).
        q = q.eq('status', 'pending')
      } else if (absence) {
        // Relance absents : ceux qui ont répondu « indisponible », encore à livrer,
        // pas déjà relancés.
        q = q.eq('status', 'pending').eq('client_availability', 'unavailable').is('absence_followup_at', null)
      } else if (reminder) {
        q = q.not('email_sent_at', 'is', null).is('client_availability', null).eq('status', 'pending')
        if (minAgeHours > 0) q = q.lte('email_sent_at', new Date(Date.now() - minAgeHours * 3600_000).toISOString())
        if (maxAgeHours > 0) q = q.gte('email_sent_at', new Date(Date.now() - maxAgeHours * 3600_000).toISOString())
      } else if (!force) {
        q = q.is('email_sent_at', null)
      }
      return q
    }

    type TargetStop = { id: string; customer_name: string | null; email: string | null; email_sent_at: string | null; client_availability: string | null; status: string | null; passage_date?: string | null }
    let stops: TargetStop[] | null = null
    let stopsError: { message?: string } | null = null
    {
      const res = await buildQuery(`${baseCols}, passage_date`)
      stops = res.data as unknown as TargetStop[] | null
      stopsError = res.error
    }
    if (stopsError && /passage_date/.test(stopsError.message ?? '')) {
      const res = await buildQuery(baseCols)
      stops = res.data as unknown as TargetStop[] | null
      stopsError = res.error
    }
    if (stopsError) throw stopsError

    const pendingStops = (stops ?? []).filter((s) => s.email)
    const tourDateStr = tour.planned_date ?? ''
    let sent = 0
    let errors = 0

    for (const stop of pendingStops) {
      try {
        // Date à annoncer : celle du client si définie (tournée multi-jours),
        // sinon la date de la tournée. La marge (windowDays) pilote TOUJOURS la
        // largeur de la fenêtre annoncée → le mail correspond à l'aperçu.
        const stopDate = stop.passage_date || null
        const startDateStr = stopDate || tourDateStr
        const wd = startDateStr ? windowDays : 0
        // Retard : soit une date de reprise précise (mode « à partir de »), soit
        // date prévue + delayDays jours ouvrés (mode « +N jours »).
        const newStartStr = delay
          ? (fromMode ? fromDateRaw : (startDateStr ? addWorkingDays(startDateStr, delayDays).toISOString().slice(0, 10) : startDateStr))
          : startDateStr
        if (process.env.RESEND_API_KEY) {
          const html = delay
            ? buildDelayEmailHtml(firstNameOf(stop.customer_name ?? ''), newStartStr, stop.id, windowDays, delayDays, fromMode, driverPhone)
            : absence
              ? buildAbsenceFollowupEmailHtml(firstNameOf(stop.customer_name ?? ''), stop.id)
            : reminder
              ? buildReminderEmailHtml(firstNameOf(stop.customer_name ?? ''), startDateStr, stop.id, wd)
              : buildEmailHtml(firstNameOf(stop.customer_name ?? ''), startDateStr, stop.id, wd, driverPhone)

          const emailRes = await fetch('https://api.resend.com/emails', {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              from: deliveryFrom,
              to: stop.email,
              reply_to: 'lea@bowa-concept.com',
              subject: delay ? 'BOWA CONCEPT : LIVRAISON DÉCALÉE' : absence ? 'BOWA CONCEPT : une solution pour votre livraison ?' : reminder ? 'BOWA CONCEPT : RAPPEL LIVRAISON — confirmez votre présence' : 'BOWA CONCEPT : LIVRAISON',
              html,
            }),
          })

          if (!emailRes.ok) {
            const errText = await emailRes.text()
            throw new Error(`Resend ${emailRes.status}: ${errText}`)
          }
        }

        if (delay) {
          // Décale la date de passage du client (best-effort si la colonne existe).
          if (newStartStr && newStartStr !== startDateStr) {
            await admin.from('delivery_stops').update({ passage_date: newStartStr }).eq('id', stop.id)
          }
        } else if (absence) {
          // Marque la relance envoyée (évite de re-relancer).
          await admin.from('delivery_stops').update({ absence_followup_at: new Date().toISOString() }).eq('id', stop.id)
        } else if (!reminder) {
          // En relance, on garde le email_sent_at d'origine (1re notification).
          await admin
            .from('delivery_stops')
            .update({ email_sent_at: new Date().toISOString() })
            .eq('id', stop.id)
        }

        sent++
      } catch (e) {
        console.error(`Failed to send email for stop ${stop.id}:`, e)
        errors++
      }
    }

    return NextResponse.json({ sent, errors })
  } catch (err) {
    console.error('[delivery/tours/:id/emails POST]', err)
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
