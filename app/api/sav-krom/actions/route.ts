// ─── /api/sav-krom/actions — log agent actions + fetch quality metrics ─────────
// POST { thread_id, action, was_modified, category, confidence, time_to_action_ms }
// GET  ?days=7  →  { metrics }

import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase'

export async function POST(req: NextRequest) {
  const body = await req.json() as {
    thread_id:          string
    action:             'sent' | 'escalated' | 'archived'
    was_modified?:      boolean | null
    category?:          string | null
    confidence?:        number | null
    time_to_action_ms?: number | null
  }

  const sb = createAdminClient()
  const { error } = await sb.from('sav_krom_actions').insert({
    thread_id:          body.thread_id,
    action:             body.action,
    was_modified:       body.was_modified ?? null,
    category:           body.category ?? null,
    confidence:         body.confidence ?? null,
    time_to_action_ms:  body.time_to_action_ms ?? null,
  })

  if (error) {
    console.error('[SAV-Krom actions] insert error:', error.message)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ ok: true })
}

export async function GET(req: NextRequest) {
  const days = parseInt(req.nextUrl.searchParams.get('days') ?? '7', 10)

  const sb = createAdminClient()
  const since = new Date()
  since.setDate(since.getDate() - days)

  const { data, error } = await sb
    .from('sav_krom_actions')
    .select('*')
    .gte('created_at', since.toISOString())

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  const rows = (data ?? []) as {
    action: string
    was_modified: boolean | null
    category: string | null
    confidence: number | null
    time_to_action_ms: number | null
  }[]

  if (rows.length === 0) {
    return NextResponse.json({
      metrics: {
        total: 0, sent: 0, escalated: 0, archived: 0,
        pct_sent: 0, pct_escalated: 0, pct_archived: 0,
        pct_unmodified: null, avg_time_ms: null, full_auto_score: null,
        by_category: {},
      }
    })
  }

  const sent      = rows.filter(r => r.action === 'sent')
  const escalated = rows.filter(r => r.action === 'escalated')
  const archived  = rows.filter(r => r.action === 'archived')

  const withModified   = sent.filter(r => r.was_modified !== null)
  const unmodified     = withModified.filter(r => r.was_modified === false)
  const pct_unmodified = withModified.length > 0
    ? Math.round((unmodified.length / withModified.length) * 100)
    : null

  const timed      = rows.filter(r => r.time_to_action_ms !== null)
  const avg_time_ms = timed.length > 0
    ? Math.round(timed.reduce((s, r) => s + (r.time_to_action_ms ?? 0), 0) / timed.length)
    : null

  const highConf       = sent.filter(r => (r.confidence ?? 0) >= 0.85 && r.was_modified === false)
  const full_auto_score = sent.length > 0
    ? Math.round((highConf.length / rows.length) * 100)
    : null

  const by_category: Record<string, { total: number; sent: number; escalated: number }> = {}
  for (const r of rows) {
    const cat = r.category ?? 'autre'
    if (!by_category[cat]) by_category[cat] = { total: 0, sent: 0, escalated: 0 }
    by_category[cat].total++
    if (r.action === 'sent')      by_category[cat].sent++
    if (r.action === 'escalated') by_category[cat].escalated++
  }

  return NextResponse.json({
    metrics: {
      total:         rows.length,
      sent:          sent.length,
      escalated:     escalated.length,
      archived:      archived.length,
      pct_sent:      Math.round((sent.length / rows.length) * 100),
      pct_escalated: Math.round((escalated.length / rows.length) * 100),
      pct_archived:  Math.round((archived.length / rows.length) * 100),
      pct_unmodified, avg_time_ms, full_auto_score, by_category,
    }
  })
}
