// ─── /api/sav/actions — log agent actions + fetch quality metrics ─────────────
// POST { ticket_id, action, was_modified, category, confidence, time_to_action_ms }
//   action can also be 'session_start' | 'session_end' | 'heartbeat' with ticket_id: 0
// GET  ?days=7  →  { metrics }

import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase'
import { savBrandFromRequest } from '@/lib/sav/brand'

// ── POST — log one action ─────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  const body = await req.json() as {
    ticket_id:          number
    action:             string
    was_modified?:      boolean | null
    category?:          string | null
    confidence?:        number | null
    time_to_action_ms?: number | null
    user_email?:        string | null
  }

  const sb = createAdminClient()
  const { error } = await sb.from('sav_actions').insert({
    brand:              savBrandFromRequest(req),
    ticket_id:          body.ticket_id,
    action:             body.action,
    was_modified:       body.was_modified ?? null,
    category:           body.category ?? null,
    confidence:         body.confidence ?? null,
    time_to_action_ms:  body.time_to_action_ms ?? null,
    // Agent qui a fait l'action (envoi/escalade/archive + session). Permet
    // d'attribuer les tickets par agent (avant : seul le temps de session
    // l'était, via category sur session_start).
    user_email:         body.user_email ?? null,
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

// Minuit Paris (00:00 heure de Paris) d'un jour donné, exprimé en instant UTC.
// dayStr = 'YYYY-MM-DD' ; sans argument → aujourd'hui (date Paris).
function parisMidnightUTC(dayStr?: string): Date {
  const day = dayStr ?? new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/Paris' })
  const utcMidnight = new Date(day + 'T00:00:00Z')
  // Heure murale Paris correspondant à cet instant UTC → donne le décalage TZ
  const parisWall = new Date(utcMidnight.toLocaleString('en-US', { timeZone: 'Europe/Paris' }))
  const offsetMs  = parisWall.getTime() - utcMidnight.getTime()
  return new Date(utcMidnight.getTime() - offsetMs)
}
// Jour suivant (YYYY-MM-DD) — pour la borne haute d'une journée précise.
function nextDayStr(dayStr: string): string {
  const x = new Date(dayStr + 'T12:00:00Z')
  x.setUTCDate(x.getUTCDate() + 1)
  return x.toISOString().slice(0, 10)
}

export async function GET(req: NextRequest) {
  const range     = req.nextUrl.searchParams.get('range') ?? ''   // 'today' | ''
  const dayParam  = req.nextUrl.searchParams.get('day') ?? ''      // 'YYYY-MM-DD' | ''
  const days      = parseInt(req.nextUrl.searchParams.get('days') ?? '7', 10)
  const userEmail = req.nextUrl.searchParams.get('user_email') ?? ''
  const isDay     = /^\d{4}-\d{2}-\d{2}$/.test(dayParam)

  const sb = createAdminClient()
  // Fenêtre : journée précise [minuit; minuit+1] · aujourd'hui [minuit; ∞] · sinon N derniers jours
  const since = isDay ? parisMidnightUTC(dayParam)
              : range === 'today' ? parisMidnightUTC()
              : (() => { const d = new Date(); d.setDate(d.getDate() - days); return d })()
  const until = isDay ? parisMidnightUTC(nextDayStr(dayParam)) : null

  // PostgREST plafonne à 1000 lignes/requête. Avec les battements (1 / 2 min /
  // agent), 7j ou 30j dépassent largement 1000 → on pagine pour tout récupérer.
  const brand = savBrandFromRequest(req)
  const COLS  = 'action,was_modified,category,confidence,time_to_action_ms,created_at,user_email'
  const PAGE  = 1000
  const MAX   = 100_000  // garde-fou
  const acc: Record<string, unknown>[] = []
  for (let from = 0; from < MAX; from += PAGE) {
    let q = sb
      .from('sav_actions')
      .select(COLS)
      .eq('brand', brand)
      .gte('created_at', since.toISOString())
    if (until) q = q.lt('created_at', until.toISOString())
    const { data, error } = await q
      .order('created_at', { ascending: true })
      .range(from, from + PAGE - 1)
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }
    acc.push(...(data ?? []))
    if (!data || data.length < PAGE) break
  }

  const allRows = acc as {
    action: string
    was_modified: boolean | null
    category: string | null
    confidence: number | null
    time_to_action_ms: number | null
    created_at: string
    user_email: string | null
  }[]

  // Email de l'agent pour une ligne : user_email (nouveau). Pour les vieilles
  // lignes de session (start ET end), l'email était stocké dans `category`.
  // NB : pour une action ticket, `category` = catégorie du ticket (jamais un
  // email) → le test `includes('@')` ne matche pas par erreur.
  function rowEmail(r: typeof allRows[0]): string | null {
    if (r.user_email && r.user_email.includes('@')) return r.user_email
    if (r.category && r.category.includes('@')) return r.category
    return null
  }

  // Liste des agents (emails) vus sur la période
  const distinct_users = [...new Set(
    allRows.map(rowEmail).filter((e): e is string => !!e)
  )].sort()

  // Prénoms des agents (email → full_name) pour l'affichage côté UI
  const user_names: Record<string, string> = {}
  try {
    const { data: ud } = await sb.auth.admin.listUsers({ perPage: 1000 })
    for (const u of ud?.users ?? []) {
      const m = u.user_metadata as { full_name?: string; name?: string } | undefined
      if (u.email && (m?.full_name || m?.name)) user_names[u.email] = (m.full_name || m.name)!
    }
  } catch { /* si l'admin API échoue, on retombera sur le préfixe d'email */ }

  // Filtre agent — s'applique maintenant AUSSI aux tickets (avant : sessions seules)
  function matchesUser(r: typeof allRows[0]) {
    if (!userEmail) return true
    return rowEmail(r) === userEmail
  }

  // Split session events from ticket events
  const sessionStarts = allRows.filter(r => r.action === 'session_start' && matchesUser(r))
  const sessionEnds   = allRows.filter(r => r.action === 'session_end'   && matchesUser(r))
  const heartbeats    = allRows.filter(r => r.action === 'heartbeat'     && matchesUser(r))
  const rows = allRows.filter(
    r => r.action !== 'session_start' && r.action !== 'session_end' && r.action !== 'heartbeat' && matchesUser(r)
  )

  // ── Temps de travail « réel » reconstitué depuis les battements ────────────
  // Un battement est envoyé toutes les 60 s tant que l'agent est actif. On
  // additionne, PAR agent, les écarts entre battements consécutifs ≤ 3 min
  // (au-delà = pause/onglet fermé, exclu), + 1 min par grappe pour la dernière
  // minute. Robuste à un onglet laissé ouvert en permanence.
  const HB_MS = 120_000, MAX_GAP = 5 * 60_000  // battement /2 min ; tolère 1 raté
  function activeMsFromBeats(timestamps: number[]): number {
    if (timestamps.length === 0) return 0
    const t = timestamps.slice().sort((a, b) => a - b)
    let total = HB_MS  // 1er intervalle (grappe initiale)
    for (let i = 1; i < t.length; i++) {
      const gap = t[i] - t[i - 1]
      if (gap <= MAX_GAP) total += gap
      else total += HB_MS  // nouvelle grappe → son 1er intervalle
    }
    return total
  }
  // Regroupe les battements par agent (pour ne pas mélanger deux personnes
  // quand aucun filtre agent n'est appliqué)
  const beatsByUser: Record<string, number[]> = {}
  for (const h of heartbeats) {
    const e = rowEmail(h) ?? '?'
    ;(beatsByUser[e] ??= []).push(new Date(h.created_at).getTime())
  }
  const active_ms = Object.values(beatsByUser).reduce((s, ts) => s + activeMsFromBeats(ts), 0)

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

  // Day-of-week breakdown: 1=Lun … 7=Dim (ISO, Paris timezone)
  // Also build a daily timeline: { date: 'YYYY-MM-DD', sessions, tickets }[]
  const active_weekdays: Record<number, number> = {}  // 1–7
  const dailyMap: Record<string, { sessions: number; tickets: number }> = {}

  function getParisDayISO(iso: string): { weekday: number; date: string } {
    const d = new Date(iso)
    const parisStr = d.toLocaleString('en-US', { timeZone: 'Europe/Paris' })
    const p = new Date(parisStr)
    // JS getDay() = 0 (Sun)–6 (Sat) → convert to ISO 1 (Mon)–7 (Sun)
    const weekday = p.getDay() === 0 ? 7 : p.getDay()
    const date = [
      p.getFullYear(),
      String(p.getMonth() + 1).padStart(2, '0'),
      String(p.getDate()).padStart(2, '0'),
    ].join('-')
    return { weekday, date }
  }

  for (const s of sessionStarts) {
    const { weekday, date } = getParisDayISO(s.created_at)
    active_weekdays[weekday] = (active_weekdays[weekday] ?? 0) + 1
    if (!dailyMap[date]) dailyMap[date] = { sessions: 0, tickets: 0 }
    dailyMap[date].sessions++
  }

  // ── Ticket metrics ────────────────────────────────────────────────────────

  if (rows.length === 0) {
    return NextResponse.json({
      metrics: {
        total: 0, sent: 0, escalated: 0, archived: 0,
        pct_sent: 0, pct_escalated: 0, pct_archived: 0,
        tickets_morning: 0, tickets_afternoon: 0,
        avg_time_ms: null,
        modification_rate: null,
        sessions_count, visits_per_day, avg_session_ms, total_session_ms, active_ms,
        active_hours, active_weekdays, daily_timeline: [],
        distinct_users,
        user_names,
        by_category: {},
      }
    })
  }

  // Matin (< 13h Paris) vs après-midi — utile pour « combien ce matin »
  const tickets_morning   = rows.filter(r => getParisHour(r.created_at) < 13).length
  const tickets_afternoon = rows.length - tickets_morning

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

  // Count tickets per day
  for (const r of rows) {
    const { date } = getParisDayISO(r.created_at)
    if (!dailyMap[date]) dailyMap[date] = { sessions: 0, tickets: 0 }
    dailyMap[date].tickets++
  }

  // Build sorted daily timeline array
  const daily_timeline = Object.entries(dailyMap)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, v]) => ({ date, ...v }))

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
      tickets_morning,
      tickets_afternoon,
      avg_time_ms,
      modification_rate,
      sessions_count,
      visits_per_day,
      avg_session_ms,
      total_session_ms,
      active_hours,
      active_weekdays,
      daily_timeline,
      distinct_users,
      user_names,
      by_category,
    }
  })
}
