// GET    /api/sav/rules?brand=   — list active rules (par marque)
// POST   /api/sav/rules?brand=    — add a rule   { rule: string }
// DELETE /api/sav/rules?brand=    — remove a rule { id | index }
//
// Règles PROPRES À CHAQUE MARQUE (table `sav_rules` scopée par `brand`). Moom et
// Bowa ont des règles DIFFÉRENTES. Seed initial depuis lib/sav/rules-<brand>.json
// (rules.json = Moom historique) si la marque n'a aucune règle.

import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase'
import { savBrandFromRequest } from '@/lib/sav/brand'
import type { SavBrand } from '@/lib/sav/zendesk'
import fs from 'fs'
import path from 'path'

export const dynamic = 'force-dynamic'

interface SavRule { id: number; content: string; active: boolean; created_at: string }

// Filtre marque : Moom inclut les lignes historiques sans `brand`.
const brandFilter = (brand: SavBrand) => brand === 'moom' ? 'brand.eq.moom,brand.is.null' : `brand.eq.${brand}`

function fileRules(brand: SavBrand): string[] {
  for (const file of [`rules-${brand}.json`, ...(brand === 'moom' ? ['rules.json'] : [])]) {
    try {
      const raw = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'lib/sav', file), 'utf-8')) as { rules: string[] }
      if (Array.isArray(raw.rules)) return raw.rules
    } catch { /* next */ }
  }
  return []
}

async function seedIfEmpty(supabase: ReturnType<typeof createAdminClient>, brand: SavBrand) {
  const { count } = await supabase
    .from('sav_rules').select('id', { count: 'exact', head: true }).or(brandFilter(brand))
  if (count !== 0) return
  const defaults = fileRules(brand)
  if (defaults.length === 0) return
  const rows = defaults.map((content) => ({ content, active: true, brand }))
  const { error } = await supabase.from('sav_rules').insert(rows)
  if (error) console.error('[SAV] seed rules error:', error.message)
}

async function listRules(brand: SavBrand) {
  try {
    const supabase = createAdminClient()
    await seedIfEmpty(supabase, brand).catch((e) => console.warn('[SAV] seedIfEmpty skipped:', e?.message))
    const { data, error } = await supabase
      .from('sav_rules')
      .select('id, content, active, created_at')
      .eq('active', true)
      .or(brandFilter(brand))
      .order('created_at', { ascending: true })
    if (error) throw error
    const rows = data as SavRule[]
    return NextResponse.json({ rules: rows.map((r) => r.content), rows })
  } catch (err) {
    console.warn('[SAV] GET rules DB error, falling back to file:', (err as Error).message)
    return NextResponse.json({ rules: fileRules(brand), rows: [] })
  }
}

export async function GET(req: NextRequest) {
  return listRules(savBrandFromRequest(req))
}

export async function POST(req: NextRequest) {
  const brand = savBrandFromRequest(req)
  let body: { rule?: string }
  try { body = await req.json() } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }
  const content = body.rule?.trim()
  if (!content) return NextResponse.json({ error: '`rule` is required' }, { status: 400 })

  const supabase = createAdminClient()
  const { error } = await supabase.from('sav_rules').insert({ content, active: true, brand })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return listRules(brand)
}

export async function DELETE(req: NextRequest) {
  const brand = savBrandFromRequest(req)
  let body: { id?: number; index?: number }
  try { body = await req.json() } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }

  const supabase = createAdminClient()
  let ruleId = body.id
  if (ruleId === undefined && typeof body.index === 'number') {
    const { data } = await supabase
      .from('sav_rules').select('id').eq('active', true).or(brandFilter(brand)).order('created_at', { ascending: true })
    const rows = data as { id: number }[] | null
    if (!rows || body.index < 0 || body.index >= rows.length) {
      return NextResponse.json({ error: 'Index out of range' }, { status: 400 })
    }
    ruleId = rows[body.index].id
  }
  if (ruleId === undefined) return NextResponse.json({ error: '`id` or `index` is required' }, { status: 400 })

  // Scope marque en sécurité : on ne désactive que si la règle appartient à la marque.
  const { error } = await supabase.from('sav_rules').update({ active: false }).eq('id', ruleId).or(brandFilter(brand))
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return listRules(brand)
}
