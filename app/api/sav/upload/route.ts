// POST /api/sav/upload
// Reçoit un fichier (multipart/form-data), le transfère à Zendesk Uploads API,
// retourne le token d'upload à inclure dans le prochain postReply.
//
// Zendesk docs:
//   POST /api/v2/uploads.json?filename={name}
//   Content-Type: application/octet-stream (ou le mime du fichier)
//   → { upload: { token: string, attachment: { file_name, content_url, ... } } }

import { NextRequest, NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

// Taille max : 20 Mo (limite Zendesk pour les pièces jointes)
const MAX_BYTES = 20 * 1024 * 1024

export async function POST(req: NextRequest) {
  const formData = await req.formData().catch(() => null)
  if (!formData) {
    return NextResponse.json({ error: 'Requête multipart invalide' }, { status: 400 })
  }

  const file = formData.get('file')
  if (!file || typeof file === 'string') {
    return NextResponse.json({ error: 'Champ "file" manquant' }, { status: 400 })
  }

  const arrayBuffer = await file.arrayBuffer()
  if (arrayBuffer.byteLength > MAX_BYTES) {
    return NextResponse.json({ error: 'Fichier trop grand (max 20 Mo)' }, { status: 413 })
  }

  const filename = encodeURIComponent(file.name)
  const subdomain = process.env.ZENDESK_SUBDOMAIN
  const email     = process.env.ZENDESK_EMAIL
  const token     = process.env.ZENDESK_API_TOKEN

  if (!subdomain || !email || !token) {
    return NextResponse.json({ error: 'Variables Zendesk non configurées' }, { status: 500 })
  }

  const auth = Buffer.from(`${email}/token:${token}`).toString('base64')

  const zdRes = await fetch(
    `https://${subdomain}.zendesk.com/api/v2/uploads.json?filename=${filename}`,
    {
      method:  'POST',
      headers: {
        Authorization:  `Basic ${auth}`,
        'Content-Type': file.type || 'application/octet-stream',
      },
      body: arrayBuffer,
    }
  )

  if (!zdRes.ok) {
    const errText = await zdRes.text().catch(() => '(unreadable)')
    console.error(`[SAV upload] Zendesk ${zdRes.status}: ${errText}`)
    return NextResponse.json(
      { error: `Zendesk upload échoué (${zdRes.status})` },
      { status: 502 }
    )
  }

  const data = await zdRes.json() as { upload: { token: string } }
  return NextResponse.json({ token: data.upload.token, filename: file.name })
}
