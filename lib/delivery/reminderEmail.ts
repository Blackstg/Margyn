// Mail de RELANCE livraison Bowa — envoyé aux clients qui n'ont pas encore répondu
// au 1er mail. Partagé entre la route /emails (relance manuelle) et le cron (auto).

export const DELIVERY_APP_URL = 'https://www.steero.io'

export function firstNameOf(fullName: string): string {
  return fullName?.split(' ')[0] ?? fullName ?? ''
}

function addWorkingDays(dateStr: string, days: number): Date {
  const result = new Date(dateStr + 'T00:00:00')
  result.setDate(result.getDate() + days)
  return result
}

function fmtDateLong(d: Date): string {
  return d.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
}

export function buildReminderEmailHtml(firstName: string, startDateStr: string, stopId: string): string {
  const start   = new Date(startDateStr + 'T00:00:00')
  const end     = addWorkingDays(startDateStr, 4)
  const startFr = fmtDateLong(start)
  const endFr   = fmtDateLong(end)
  const confirmUrl     = `${DELIVERY_APP_URL}/api/delivery/confirm?stop=${stopId}&action=confirmed`
  const unavailableUrl = `${DELIVERY_APP_URL}/api/delivery/confirm?stop=${stopId}&action=unavailable`
  return `<!DOCTYPE html><html lang="fr"><head><meta charset="UTF-8"/><meta name="viewport" content="width=device-width, initial-scale=1.0"/></head>
<body style="margin:0;padding:0;background:#f1ebe7;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f1ebe7;padding:32px 16px;"><tr><td align="center">
    <table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;">
      <tr><td align="center" style="padding-bottom:24px;"><img src="https://bowa-concept.com/cdn/shop/files/logo.png?v=1693451719" alt="Bowa Concept" width="140" style="display:block;height:auto;"/></td></tr>
      <tr><td style="background:#ffffff;border-radius:20px;padding:36px 40px 28px;box-shadow:0 4px 24px rgba(0,0,0,0.06);">
        <p style="font-size:34px;margin:0 0 8px;text-align:center;">⏰</p>
        <h1 style="margin:0 0 20px;font-size:21px;font-weight:700;color:#1a1a2e;text-align:center;line-height:1.3;">Petit rappel pour votre livraison</h1>
        <p style="margin:0 0 16px;font-size:15px;color:#3a3a3a;line-height:1.6;">Bonjour <strong>${firstName}</strong>,</p>
        <p style="margin:0 0 16px;font-size:15px;color:#3a3a3a;line-height:1.6;">Nous n'avons pas encore eu votre réponse concernant votre livraison prévue entre le <strong>${startFr}</strong> et le <strong>${endFr}</strong>. Pouvez-vous nous confirmer votre présence&nbsp;? Cela nous évite un déplacement pour rien 🙏.</p>
        <table width="100%" cellpadding="0" cellspacing="0" style="background:#f8f4f1;border-radius:14px;padding:24px;margin-bottom:24px;"><tr><td align="center">
          <p style="margin:0 0 20px;font-size:15px;color:#3a3a3a;line-height:1.6;font-weight:600;">Serez-vous disponible pour réceptionner votre commande&nbsp;?</p>
          <table cellpadding="0" cellspacing="0"><tr>
            <td style="padding-right:10px;"><a href="${confirmUrl}" target="_blank" style="display:inline-block;background:#1a7f4b;color:#ffffff;font-size:14px;font-weight:700;text-decoration:none;padding:13px 24px;border-radius:50px;">✅ Oui, je serai présent(e)</a></td>
            <td><a href="${unavailableUrl}" target="_blank" style="display:inline-block;background:#ffffff;color:#c2410c;font-size:14px;font-weight:700;text-decoration:none;padding:12px 24px;border-radius:50px;border:2px solid #fed7aa;">❌ Je ne serai pas disponible</a></td>
          </tr></table>
        </td></tr></table>
        <p style="margin:0 0 4px;font-size:14px;color:#3a3a3a;line-height:1.6;">Merci d'avance ☀️</p>
        <p style="margin:0 0 16px;font-size:14px;color:#3a3a3a;line-height:1.6;">Cordialement,<br/><strong>Léa</strong><br/><span style="color:#6b6b63;">Service client</span></p>
        <p style="margin:0;font-size:12px;color:#9ca3af;line-height:1.6;">Pour toute question, écrivez-nous à <a href="mailto:lea@bowa-concept.com" style="color:#6b6b63;text-decoration:none;">lea@bowa-concept.com</a></p>
      </td></tr>
    </table>
  </td></tr></table>
</body></html>`
}
