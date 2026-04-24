// GET /api/admin/debug-krom-gmail?secret=XXX — teste la connexion Gmail Krom

import { NextRequest, NextResponse } from 'next/server'
import { google } from 'googleapis'

export const dynamic = 'force-dynamic'

function getOAuth2Client() {
  const oauth2 = new google.auth.OAuth2(
    process.env.KROM_GMAIL_CLIENT_ID,
    process.env.KROM_GMAIL_CLIENT_SECRET,
  )
  oauth2.setCredentials({ refresh_token: process.env.KROM_GMAIL_REFRESH_TOKEN })
  return oauth2
}

export async function GET(_req: NextRequest) {
  const envCheck = {
    KROM_GMAIL_CLIENT_ID:     !!process.env.KROM_GMAIL_CLIENT_ID,
    KROM_GMAIL_CLIENT_SECRET: !!process.env.KROM_GMAIL_CLIENT_SECRET,
    KROM_GMAIL_REFRESH_TOKEN: !!process.env.KROM_GMAIL_REFRESH_TOKEN,
  }

  try {
    const gmail = google.gmail({ version: 'v1', auth: getOAuth2Client() })

    // Test 1: liste threads inbox
    const inboxRes = await gmail.users.threads.list({
      userId: 'me',
      q: 'in:inbox',
      maxResults: 10,
    })

    const threads = inboxRes.data.threads ?? []

    // Test 2: pour chaque thread, récupérer le dernier message
    const details = await Promise.all(
      threads.slice(0, 5).map(async t => {
        const r = await gmail.users.threads.get({ userId: 'me', id: t.id!, format: 'metadata', metadataHeaders: ['Subject', 'From', 'Date'] })
        const msgs = r.data.messages ?? []
        const last = msgs[msgs.length - 1]
        const headers = last?.payload?.headers ?? []
        const h = (name: string) => headers.find(h => h.name?.toLowerCase() === name)?.value ?? ''
        return {
          thread_id: t.id,
          subject:   h('subject'),
          from:      h('from'),
          date:      h('date'),
          labelIds:  last?.labelIds,
          msg_count: msgs.length,
        }
      })
    )

    return NextResponse.json({ envCheck, inbox_count: threads.length, threads: details })
  } catch (err) {
    return NextResponse.json({
      envCheck,
      error: err instanceof Error ? err.message : String(err),
    }, { status: 500 })
  }
}
