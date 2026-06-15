// GET /api/sav-defects/stats?brand=moom&month=YYYY-MM
// Calcule les 3 cartes de la section SAV / Défauts :
//   1. En attente de réception   (dossiers non recu/clos : nombre + plus ancien en jours)
//   2. Envois SAV facturés à tort (croisement facture transport → montant à contester)
//   3. Taux de défaut par SKU     (top 5 sur le mois)

import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase'

export const dynamic = 'force-dynamic'

interface InvoiceRow {
  order_name: string
  total_price: number
  shipping_price: number
  isFW: boolean
  sku: string
}

// Normalise une référence pour comparer dossier ↔ ligne facture
function normRef(v: unknown): string {
  return String(v ?? '').toLowerCase().replace(/[\s#_-]/g, '')
}

function daysBetween(from: string, to: Date): number {
  const d = new Date(from + 'T00:00:00')
  return Math.max(0, Math.floor((to.getTime() - d.getTime()) / 86400000))
}

export async function GET(req: NextRequest) {
  const brand = req.nextUrl.searchParams.get('brand') ?? 'moom'
  let month   = req.nextUrl.searchParams.get('month') ?? ''
  const admin = createAdminClient()
  const now   = new Date()

  // ── Mois par défaut = dernier import facture disponible ────────────────────
  if (!month) {
    const { data: months } = await admin
      .from('logistician_invoice_summaries')
      .select('month')
      .eq('brand', brand)
      .order('month', { ascending: false })
      .limit(1)
    month = months?.[0]?.month ?? now.toISOString().slice(0, 7)
  }

  const { data: claims } = await admin
    .from('defect_claims')
    .select('id, sku, product_name, quantity, milestones, reported_at, claim_sent_at, reship_tracking_ref, return_tracking_ref, shopify_order_id')
    .eq('brand', brand)

  const rows = claims ?? []

  // ── Carte 1 : En attente de réception ──────────────────────────────────────
  const open = rows.filter(r => { const m = r.milestones ?? {}; return !m.recu && !m.clos })
  let oldestDays = 0
  for (const r of open) {
    const ref = r.claim_sent_at || r.reported_at
    if (ref) oldestDays = Math.max(oldestDays, daysBetween(ref, now))
  }
  const awaiting = { count: open.length, oldest_days: oldestDays }

  // ── Carte 2 : Envois SAV facturés à tort (croisement facture) ──────────────
  const { data: summary } = await admin
    .from('logistician_invoice_summaries')
    .select('invoice_rows')
    .eq('brand', brand)
    .eq('month', month)
    .maybeSingle()

  const invoiceRows: InvoiceRow[] = (summary?.invoice_rows as InvoiceRow[]) ?? []
  const byOrderName = new Map<string, InvoiceRow>()
  for (const row of invoiceRows) {
    const key = normRef(row.order_name)
    if (!key) continue
    // privilégie une ligne facturée > 0 (et plutôt isFW) si plusieurs collisions
    const existing = byOrderName.get(key)
    if (!existing || (row.total_price > 0 && (existing.total_price <= 0 || (row.isFW && !existing.isFW)))) {
      byOrderName.set(key, row)
    }
  }

  const billedLines: { claim_id: string; order_name: string; amount: number; isFW: boolean }[] = []
  for (const r of rows) {
    const candidates = [r.reship_tracking_ref, r.return_tracking_ref, r.shopify_order_id].filter(Boolean)
    for (const c of candidates) {
      const match = byOrderName.get(normRef(c))
      if (match && match.total_price > 0) {
        billedLines.push({ claim_id: r.id, order_name: match.order_name, amount: match.total_price, isFW: match.isFW })
        break
      }
    }
  }
  const wronglyBilled = {
    total_amount: billedLines.reduce((s, l) => s + l.amount, 0),
    lines: billedLines,
  }

  // ── Carte 3 : Taux de défaut par SKU (top 5 sur le mois) ───────────────────
  const inMonth = rows.filter(r => (r.reported_at ?? '').slice(0, 7) === month)
  const skuMap = new Map<string, { sku: string; product_name: string | null; total_qty: number }>()
  for (const r of inMonth) {
    if (!r.sku) continue
    const e = skuMap.get(r.sku) ?? { sku: r.sku, product_name: r.product_name, total_qty: 0 }
    e.total_qty += Number(r.quantity) || 0
    if (!e.product_name && r.product_name) e.product_name = r.product_name
    skuMap.set(r.sku, e)
  }
  const topSkus = Array.from(skuMap.values())
    .sort((a, b) => b.total_qty - a.total_qty)
    .slice(0, 5)

  return NextResponse.json({ month, awaiting, wronglyBilled, topSkus })
}
