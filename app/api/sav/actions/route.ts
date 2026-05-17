// ─── /api/sav/actions — log agent actions + fetch quality metrics ─────────────
// POST { ticket_id, action, was_modified, category, confidence, time_to_action_ms }
//   action can also be 'session_start' | 'session_end' | 'heartbeat' with ticket_id: 0
// GET  ?days=7  →  { metrics }

import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase'

// ── POST — log one action ─────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  const body = await req.json() as {
    ticket_id:          number
    action:             string
    was_modified?:      boolean | null
    category?:          string | null
    confidence?:        number | null
    time_to_action_ms?: number | null
  }

  const sb = createAdminClient()
  const { error } = await sb.from('sav_actions').insert({
    ticket_id:          body.ticket_id,
    action:             body.action,
    was_modified:       body.was_modified ?? null,
    category:           body.category ?? null,
    confidence:         body.confidence ?? null,
    time_to_action_ms:  body.time_to_action_ms ?? null,
  })

  if (error) {
    console.error('[SAV actions] insert error:', error.message)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ ok: true })
}

// ── GET — compute quality metrics ─────────────────────────────────────────────

function getParisHour(iso: string): number {
  // Convert UTC timestamp to Europe/Paris local hour (handles DST automatically)
  const d = new Date(iso)
  const parisStr = d.toLocaleString('en-US', { timeZone: 'Europe/Paris' })
  return new Date(parisStr).getHours()
}

export async function GET(req: NextRequest) {
  const days = parseInt(req.nextUrl.searchParams.get('days') ?? '7', 10)

  const sb = createAdminClient()
  const since = new Date()
  since.setDate(since.getDate() - days)

  const { data, error } = await sb
    .from('sav_actions')
    .select('*')
    .gte('created_at', since.toISOString())

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  const allRows = (data ?? []) as {
    action: string
    was_modified: boolean | null
    category: string | null
    confidence: number | null
    time_to_action_ms: number | null
    created_at: string
  }[]

  // Split session events from ticket events
  const sessionStarts = allRows.filter(r => r.action === 'session_start')
  const sessionEnds   = allRows.filter(r => r.action === 'session_end')
  const rows = allRows.filter(
    r => r.action !== 'session_start' && r.action !== 'session_end' && r.action !== 'heartbeat'
  )

  // ── Session metrics ───────────────────────────────────────────────────────
  const sessions_count = sessionStarts.length
  const visits_per_day = days > 0 ? Math.round((sessions_count / days) * 10) / 10 : 0

  // Valid session durations: > 5s (ignore accidental loads), < 8h (ignore forgotten tabs)
  const sessionDurations = sessionEnds
    .map(r => r.time_to_action_ms)
    .filter((v): v is number => v !== null && v > 5_000 && v < 8 * 3_600_000)

  const avg_session_ms = sessionDurations.length > 0
    ? Math.round(sessionDurations.reduce((a, b) => a + b, 0) / sessionDurations.length)
    : null

  const total_session_ms = sessionDurations.length > 0
    ? sessionDurations.reduce((a, b) => a + b, 0)
    : null

  // Active hours: count session_starts by Paris local hour
  const active_hours: Record<number, number> = {}
  for (const s of sessionStarts) {
    const h = getParisHour(s.created_at)
    active_hours[h] = (active_hours[h] ?? 0) + 1
  }

  // ── Ticket metrics ────────────────────────────────────────────────────────

  if (rows.length === 0) {
    return NextResponse.json({
      metrics: {
        total: 0, sent: 0, escalated: 0, archived: 0,
        pct_sent: 0, pct_escalated: 0, pct_archived: 0,
        avg_time_ms: null,
        modification_rate: null,
        sessions_count, visits_per_day, avg_session_ms, total_session_ms, active_hours,
        by_category: {},
      }
    })
  }

  const sent      = rows.filter(r => r.action === 'sent')
  const escalated = rows.filter(r => r.action === 'escalated')
  const archived  = rows.filter(r => r.action === 'archived')

  // Average time to action per ticket (all ticket actions with timing)
  const timed = rows.filter(r => r.time_to_action_ms !== null)
  const avg_time_ms = timed.length > 0
    ? Math.round(timed.reduce((s, r) => s + (r.time_to_action_ms ?? 0), 0) / timed.length)
    : null

  // Modification rate: % of sent tickets where the agent modified Claude's draft
  const modification_rate = sent.length > 0
    ? Math.round((sent.filter(r => r.was_modified === true).length / sent.length) * 100)
    : null

  // Breakdown by category
  const by_category: Record<string, { total: number; sent: number; escalated: number }> = {}
  for (const r of rows) {
    const cat = r.category ?? 'autre'
    if (!by_category[cat]) by_category[cat] = { total: 0, sent: 0, escalated: 0 }
    by_category[cat].total++
    if (r.action === 'sent') by_category[cat].sent++
    if (r.action === 'escalated') by_category[cat].escalated++
  }

  return NextResponse.json({
    metrics: {
      total:          rows.length,
      sent:           sent.length,
      escalated:      escalated.length,
      archived:       archived.length,
      pct_sent:       Math.round((sent.length / rows.length) * 100),
      pct_escalated:  Math.round((escalated.length / rows.length) * 100),
      pct_archived:   Math.round((archived.length / rows.length) * 100),
      avg_time_ms,
      modification_rate,
      sessions_count,
      visits_per_day,
      avg_session_ms,
      total_session_ms,
      active_hours,
      by_category,
    }
  })
}
