// GET    /api/sav/rules           — list active rules
// POST   /api/sav/rules           — add a rule   { rule: string }
// DELETE /api/sav/rules           — remove a rule { id: number }
//
// Rules are stored in the `sav_rules` Supabase table (persisted across deploys).
// On first call, if the table is empty, seeds from lib/sav/rules.json defaults.

import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase'
import fs from 'fs'
import path from 'path'

export const dynamic = 'force-dynamic'

interface SavRule {
  id: number
  content: string
  active: boolean
  created_at: string
}

// ─── Seed from rules.json if table is empty ───────────────────────────────────

async function seedIfEmpty(supabase: ReturnType<typeof createAdminClient>) {
  const { count } = await supabase
    .from('sav_rules')
    .select('id', { count: 'exact', head: true })

  if (count !== 0) return

  const defaultPath = path.join(process.cwd(), 'lib/sav/rules.json')
  let defaults: string[] = []
  try {
    const raw = JSON.parse(fs.readFileSync(defaultPath, 'utf-8')) as { rules: string[] }
    defaults = raw.rules ?? []
  } catch { /* no defaults file — skip */ }

  if (defaults.length === 0) return

  const rows = defaults.map((content) => ({ content, active: true }))
  const { error } = await supabase.from('sav_rules').insert(rows)
  if (error) console.error('[SAV] seed rules error:', error.message)
  else console.log(`[SAV] seeded ${rows.length} default rules into sav_rules`)
}

// ─── GET — list active rules ──────────────────────────────────────────────────

export async function GET() {
  try {
    const supabase = createAdminClient()
    await seedIfEmpty(supabase).catch((e) =>
      console.warn('[SAV] seedIfEmpty skipped:', e?.message)
    )

    const { data, error } = await supabase
      .from('sav_rules')
      .select('id, content, active, created_at')
      .eq('active', true)
      .order('created_at', { ascending: true })

    if (error) throw error

    const rules = (data as SavRule[]).map((r) => r.content)
    const rows  = data as SavRule[]
    return NextResponse.json({ rules, rows })
  } catch (err) {
    // Table may not exist yet — fall back to the committed rules.json
    console.warn('[SAV] GET rules DB error, falling back to file:', (err as Error).message)
    const defaultPath = path.join(process.cwd(), 'lib/sav/rules.json')
    try {
      const raw = JSON.parse(fs.readFileSync(defaultPath, 'utf-8')) as { rules: string[] }
      const rules = raw.rules ?? []
      return NextResponse.json({ rules, rows: [] })
    } catch {
      return NextResponse.json({ rules: [], rows: [] })
    }
  }
}

// ─── POST — add a rule ────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  let body: { rule?: string }
  try { body = await req.json() }
  catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }

  const content = body.rule?.trim()
  if (!content) return NextResponse.json({ error: '`rule` is required' }, { status: 400 })

  const supabase = createAdminClient()
  const { error } = await supabase.from('sav_rules').insert({ content, active: true })

  if (error) {
    console.error('[SAV] POST rules error:', error.message)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  // Return updated list
  return GET()
}

// ─── DELETE — soft-delete (active = false) ────────────────────────────────────
// Accepts { id: number } to target by DB id, or { index: number } for legacy UI compat.

export async function DELETE(req: NextRequest) {
  let body: { id?: number; index?: number }
  try { body = await req.json() }
  catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }

  const supabase = createAdminClient()

  // Resolve id — either direct or by position in active list
  let ruleId = body.id
  if (ruleId === undefined && typeof body.index === 'number') {
    const { data } = await supabase
      .from('sav_rules')
      .select('id')
      .eq('active', true)
      .order('created_at', { ascending: true })
    const rows = data as { id: number }[] | null
    if (!rows || body.index < 0 || body.index >= rows.length) {
      return NextResponse.json({ error: 'Index out of range' }, { status: 400 })
    }
    ruleId = rows[body.index].id
  }

  if (ruleId === undefined) {
    return NextResponse.json({ error: '`id` or `index` is required' }, { status: 400 })
  }

  const { error } = await supabase
    .from('sav_rules')
    .update({ active: false })
    .eq('id', ruleId)

  if (error) {
    console.error('[SAV] DELETE rules error:', error.message)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return GET()
}
