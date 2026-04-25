// GET    /api/sav-krom/rules — liste les règles actives
// POST   /api/sav-krom/rules — ajoute une règle { rule: string }
// DELETE /api/sav-krom/rules — supprime une règle { index: number }

import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase'

export const dynamic = 'force-dynamic'

interface KromRule {
  id:         number
  content:    string
  active:     boolean
  created_at: string
}

export async function GET() {
  try {
    const supabase = createAdminClient()
    const { data, error } = await supabase
      .from('sav_krom_rules')
      .select('id, content, active, created_at')
      .eq('active', true)
      .order('created_at', { ascending: true })
    if (error) throw error
    const rules = (data as KromRule[]).map(r => r.content)
    return NextResponse.json({ rules, rows: data })
  } catch (err) {
    console.error('[SAV-Krom] GET rules error:', err)
    return NextResponse.json({ rules: [], rows: [] })
  }
}

export async function POST(req: NextRequest) {
  let body: { rule?: string }
  try { body = await req.json() }
  catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }

  const content = body.rule?.trim()
  if (!content) return NextResponse.json({ error: '`rule` is required' }, { status: 400 })

  const supabase = createAdminClient()
  const { error } = await supabase.from('sav_krom_rules').insert({ content, active: true })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return GET()
}

export async function DELETE(req: NextRequest) {
  let body: { index?: number }
  try { body = await req.json() }
  catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }

  const supabase = createAdminClient()
  const { data } = await supabase
    .from('sav_krom_rules')
    .select('id')
    .eq('active', true)
    .order('created_at', { ascending: true })

  const rows = data as { id: number }[] | null
  if (!rows || body.index === undefined || body.index < 0 || body.index >= rows.length) {
    return NextResponse.json({ error: 'Index out of range' }, { status: 400 })
  }

  const { error } = await supabase
    .from('sav_krom_rules')
    .update({ active: false })
    .eq('id', rows[body.index].id)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return GET()
}
