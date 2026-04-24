// GET /api/sav-krom/attachment?message_id=X&attachment_id=Y&mime_type=Z
// Proxy Gmail attachment data through the server

import { NextRequest, NextResponse } from 'next/server'
import { getAttachmentData } from '@/lib/sav-krom/gmail'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const messageId    = req.nextUrl.searchParams.get('message_id')
  const attachmentId = req.nextUrl.searchParams.get('attachment_id')
  const mimeType     = req.nextUrl.searchParams.get('mime_type') ?? 'application/octet-stream'

  if (!messageId || !attachmentId) {
    return NextResponse.json({ error: 'message_id and attachment_id required' }, { status: 400 })
  }

  try {
    const { data } = await getAttachmentData(messageId, attachmentId)
    const buffer   = Buffer.from(data, 'base64')

    return new NextResponse(buffer, {
      headers: {
        'Content-Type':  mimeType,
        'Cache-Control': 'private, max-age=3600',
      },
    })
  } catch (err) {
    console.error('[SAV-Krom] attachment error:', err)
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Unknown error' },
      { status: 500 }
    )
  }
}
