// ─── Bon de retour Mōom ───────────────────────────────────────────────────────
// Télécharge "bon-retour-moom.pdf" depuis Supabase Storage, l'uploade une fois
// vers Zendesk, et met le token en cache en mémoire (durée de vie du process).
//
// Supabase Storage : bucket "sav-assets", fichier "bon-retour-moom.pdf"
// Le bucket doit être public (ou utiliser une signed URL).

import { createAdminClient } from '@/lib/supabase'

const BUCKET   = 'sav-assets'
const FILENAME = 'bon-retour-moom.pdf'

// Cache en mémoire — valide pour toute la durée du process Vercel (warm instance)
let cachedToken: string | null = null

function zendeskAuth(): string {
  const email = process.env.ZENDESK_EMAIL!
  const token = process.env.ZENDESK_API_TOKEN!
  return `Basic ${Buffer.from(`${email}/token:${token}`).toString('base64')}`
}

async function uploadToZendesk(pdfBytes: ArrayBuffer): Promise<string> {
  const subdomain = process.env.ZENDESK_SUBDOMAIN!
  const res = await fetch(
    `https://${subdomain}.zendesk.com/api/v2/uploads.json?filename=${encodeURIComponent(FILENAME)}`,
    {
      method:  'POST',
      headers: {
        Authorization:  zendeskAuth(),
        'Content-Type': 'application/pdf',
      },
      body: pdfBytes,
    }
  )
  if (!res.ok) {
    const err = await res.text().catch(() => '(unreadable)')
    throw new Error(`Zendesk upload bon-retour échoué (${res.status}): ${err}`)
  }
  const data = await res.json() as { upload: { token: string } }
  return data.upload.token
}

/**
 * Retourne le token Zendesk du bon de retour Mōom.
 * Premier appel : télécharge depuis Supabase + uploade vers Zendesk.
 * Appels suivants : retourne le token en cache.
 */
export async function getBonRetourToken(): Promise<string> {
  if (cachedToken) return cachedToken

  const supabase = createAdminClient()

  // Télécharger le PDF depuis Supabase Storage
  const { data, error } = await supabase.storage
    .from(BUCKET)
    .download(FILENAME)

  if (error || !data) {
    throw new Error(`[BonRetour] Impossible de télécharger depuis Storage: ${error?.message ?? 'unknown'}`)
  }

  const pdfBytes = await data.arrayBuffer()
  console.log(`[BonRetour] PDF téléchargé (${Math.round(pdfBytes.byteLength / 1024)} Ko) — upload Zendesk…`)

  const token = await uploadToZendesk(pdfBytes)
  cachedToken = token
  console.log(`[BonRetour] Token Zendesk mis en cache: ${token.slice(0, 12)}…`)
  return token
}

/** Invalide le cache (utile si le PDF a été mis à jour dans Storage) */
export function invalidateBonRetourCache(): void {
  cachedToken = null
}
