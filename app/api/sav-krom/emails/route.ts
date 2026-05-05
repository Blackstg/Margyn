// GET /api/sav-krom/emails — liste les threads Gmail non traités (pas d'IA)

import { NextResponse } from 'next/server'
import { getRawThreadList } from '@/lib/sav-krom/orchestrator'
import { createAdminClient } from '@/lib/supabase'

export const dynamic = 'force-dynamic'

async function handle() {
  try {
    // Check env vars first
    if (!process.env.KROM_GMAIL_CLIENT_ID || !process.env.KROM_GMAIL_CLIENT_SECRET || !process.env.KROM_GMAIL_REFRESH_TOKEN) {
      return NextResponse.json(
        { error: 'Variables d\'environnement Gmail manquantes (KROM_GMAIL_CLIENT_ID / KROM_GMAIL_CLIENT_SECRET / KROM_GMAIL_REFRESH_TOKEN)', threads: [] },
        { status: 500 }
      )
    }

    // Fetch Gmail threads + processed count in parallel for debug info
    const [threads, sbResult] = await Promise.allSettled([
      getRawThreadList(),
      createAdminClient().from('sav_krom_processed').select('thread_id', { count: 'exact', head: true }),
    ])

    if (threads.status === 'rejected') {
      throw threads.reason
    }

    const processedCount = sbResult.status === 'fulfilled' ? (sbResult.value.count ?? 0) : 0

    return NextResponse.json({
      threads: threads.value,
      count: threads.value.length,
      debug: { processed_in_db: processedCount },
    })
  } catch (err) {
    console.error('[SAV-Krom] getRawThreadList error:', err)
    const msg = err instanceof Error ? err.message : String(err)
    return NextResponse.json(
      { error: msg, threads: [] },
      { status: 500 }
    )
  }
}

export const GET  = handle
export const POST = handle
