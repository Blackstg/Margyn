'use client'

import { useState, useEffect, useMemo, useRef } from 'react'
import { createBrowserClient } from '@supabase/auth-helpers-nextjs'
import { Download, Search, Package, ChevronDown, ClipboardList, X, GripVertical, Plus, Check } from 'lucide-react'
import AiInsights from '@/components/dashboard/AiInsights'

const supabase = createBrowserClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
)

// ─── Types ────────────────────────────────────────────────────────────────────

interface VariantRow {
  shopify_variant_id: string
  shopify_product_id: string
  product_title: string
  variant_title: string | null
  sku: string | null
  stock_quantity: number
  image_url: string | null
}

type DataSource = 'ref' | '90d' | 'none'

interface ReplenishmentRow {
  shopify_variant_id: string
  product_title: string
  variant_title: string | null
  sku: string | null
  image_url: string | null
  stock_quantity: number
  ref_qty: number
  daily_sales: number
  coverage_days: number | null
  stock_needed: number
  qty_to_order: number
  order_deadline: Date
  status: 'order' | 'low' | 'ok'
  data_source: DataSource
  velocity_days: number
  velocity_from: string
  velocity_to: string
}

interface CartItem {
  shopify_variant_id: string
  qty: number
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function periodDays(from: string, to: string): number {
  const a = new Date(from + 'T00:00:00')
  const b = new Date(to   + 'T00:00:00')
  return Math.max(1, Math.round((b.getTime() - a.getTime()) / 86_400_000) + 1)
}

function subtractDays(dateStr: string, n: number): Date {
  const d = new Date(dateStr + 'T00:00:00')
  d.setDate(d.getDate() - n)
  return d
}

function fmtDate(d: Date): string {
  return d.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' })
}

// ─── Source badge ─────────────────────────────────────────────────────────────

function fmtShortPeriod(from: string, to: string): string {
  const f = from.slice(5).split('-').reverse().join('/')  // MM-DD → DD/MM
  const t = to.slice(5).split('-').reverse().join('/')
  return `${f} → ${t}`
}

function SourceBadge({ source, days, from, to }: { source: DataSource; days: number; from: string; to: string }) {
  if (source === 'none') return null
  const tooltip = source === 'ref'
    ? `Vélocité calculée sur ${days} jours — ${fmtShortPeriod(from, to)}`
    : `Vélocité calculée sur ${days} jours — ${fmtShortPeriod(from, to)} (nouveau produit, pas d'historique N-1)`
  const bg   = source === 'ref' ? 'bg-[#eef0f8]' : 'bg-[#fff3dc]'
  const text = source === 'ref' ? 'text-[#6b6e9a]' : 'text-[#a16207]'
  const dot  = source === 'ref' ? 'bg-[#6b6e9a]'  : 'bg-[#d97706]'
  return (
    <span
      title={tooltip}
      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold cursor-default whitespace-nowrap ${bg} ${text}`}
    >
      <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${dot}`} />
      {source === 'ref' ? 'N-1' : '90 jours'}
    </span>
  )
}

// ─── Coverage badge ───────────────────────────────────────────────────────────

function CoverageBadge({ days }: { days: number | null }) {
  if (days === null) return <span className="text-sm text-[#9b9b93]">—</span>
  const bg   = days < 30 ? 'bg-[#fce8ea]' : days < 60 ? 'bg-[#fff3dc]' : 'bg-[#dcf5e7]'
  const text = days < 30 ? 'text-[#c7293a]' : days < 60 ? 'text-[#a16207]' : 'text-[#1a7f4b]'
  const dot  = days < 30 ? 'bg-[#c7293a]'  : days < 60 ? 'bg-[#d97706]'  : 'bg-[#1a7f4b]'
  return (
    <span className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold whitespace-nowrap ${bg} ${text}`}>
      <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${dot}`} />
      {days.toLocaleString('fr-FR')} jours
    </span>
  )
}

// ─── Print PO ─────────────────────────────────────────────────────────────────

function printPO(cartItems: CartItem[], rowMap: Map<string, ReplenishmentRow>, deadline: Date, brandLabel: string) {
  const included = cartItems.filter((c) => c.qty > 0)
  const totalQty = included.reduce((s, c) => s + c.qty, 0)
  const dateStr  = new Date().toLocaleDateString('fr-FR', { day: '2-digit', month: 'long', year: 'numeric' })

  const tableRows = included.map((c) => {
    const row = rowMap.get(c.shopify_variant_id)
    if (!row) return ''
    const imgTag = row.image_url
      ? `<img src="${row.image_url}" alt="" style="width:36px;height:36px;object-fit:cover;border-radius:6px;display:block;" />`
      : `<div style="width:36px;height:36px;border-radius:6px;background:#f0ece9;"></div>`
    return `
      <tr>
        <td style="width:52px">${imgTag}</td>
        <td>${row.product_title.replace(/</g, '&lt;')}</td>
        <td>${row.variant_title ? row.variant_title.replace(/</g, '&lt;') : '—'}</td>
        <td style="font-family:monospace;font-size:11px;color:#666">${row.sku ?? '—'}</td>
        <td class="qty">${c.qty}</td>
      </tr>`
  }).join('')

  const html = `<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="UTF-8" />
  <title>Bon de commande — ${brandLabel}</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: 'Helvetica Neue', Arial, sans-serif; font-size: 12px; color: #1a1a2e; background: white; padding: 40px; }
    .header { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 32px; padding-bottom: 20px; border-bottom: 2px solid #1a1a2e; }
    .logo { font-size: 20px; font-weight: 800; letter-spacing: -0.5px; }
    .subtitle { font-size: 13px; color: #666; margin-top: 3px; }
    .meta { text-align: right; font-size: 11px; color: #666; line-height: 1.9; }
    .meta strong { color: #1a1a2e; }
    table { width: 100%; border-collapse: collapse; margin-top: 4px; }
    thead tr { background: #f5f0f2; }
    th { padding: 9px 10px; text-align: left; font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.08em; color: #888; border-bottom: 1px solid #e0dbd8; }
    td { padding: 10px 10px; border-bottom: 1px solid #f0ece9; vertical-align: middle; }
    td.qty { font-weight: 700; font-size: 14px; text-align: right; }
    th:last-child { text-align: right; }
    tr:last-child td { border-bottom: none; }
    tr:nth-child(even) td { background: #faf9f8; }
    .footer { margin-top: 24px; padding-top: 16px; border-top: 1px solid #e0dbd8; display: flex; justify-content: space-between; align-items: center; }
    .footer .refs { font-size: 11px; color: #666; }
    .footer .total { font-size: 15px; font-weight: 700; }
    .footer .total span { font-size: 11px; font-weight: 400; color: #666; margin-left: 4px; }
    @media print { body { padding: 20px; } @page { size: A4; margin: 15mm 20mm; } }
  </style>
</head>
<body>
  <div class="header">
    <div>
      <div class="logo">${brandLabel}</div>
      <div class="subtitle">Bon de commande fournisseur</div>
    </div>
    <div class="meta">
      <div>Date : <strong>${dateStr}</strong></div>
      <div>À passer avant : <strong>${fmtDate(deadline)}</strong></div>
    </div>
  </div>
  <table>
    <thead>
      <tr>
        <th></th>
        <th>Produit</th>
        <th>Variant</th>
        <th>Référence SKU</th>
        <th style="text-align:right">Quantité</th>
      </tr>
    </thead>
    <tbody>${tableRows}</tbody>
  </table>
  <div class="footer">
    <div class="refs">${included.length} référence${included.length > 1 ? 's' : ''}</div>
    <div class="total">${totalQty.toLocaleString('fr-FR')} unités <span>à commander</span></div>
  </div>
</body>
</html>`

  const w = window.open('', '_blank', 'width=900,height=700')
  if (!w) return
  w.document.write(html)
  w.document.close()
  w.focus()
  setTimeout(() => { w.print() }, 500)
}

// ─── Page ─────────────────────────────────────────────────────────────────────

const BRAND_LABELS: Record<string, string> = { bowa: 'Bowa', moom: 'Mōom Paris', krom: 'Krom' }

export default function ReapproPage() {
  // ── Brand ─────────────────────────────────────────────────────────────────
  const [brand, setBrand] = useState<'bowa' | 'moom' | 'krom'>('moom')
  const [allowedBrands, setAllowedBrands] = useState<('bowa' | 'moom' | 'krom')[]>(['bowa', 'moom', 'krom'])

  useEffect(() => {
    supabase.from('user_brands').select('brand').then(({ data }) => {
      if (data && data.length > 0) {
        const brands = data.map((r: { brand: string }) => r.brand) as ('bowa' | 'moom' | 'krom')[]
        setAllowedBrands(brands)
        if (!brands.includes(brand)) setBrand(brands[0])
      }
    })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ── Settings ──────────────────────────────────────────────────────────────
  const [refFrom,    setRefFrom]    = useState('2025-04-01')
  const [refTo,      setRefTo]      = useState('2025-07-31')
  const [targetFrom, setTargetFrom] = useState('2026-05-01')
  const [targetTo,   setTargetTo]   = useState('2026-08-31')
  const [leadTime,   setLeadTime]   = useState(30)
  const [buffer,     setBuffer]     = useState(20)
  const [search,     setSearch]     = useState('')
  const [showAll,    setShowAll]    = useState(false)

  // Reset cart when brand changes
  useEffect(() => { setCartItems([]) }, [brand])

  // ── Cart / sidebar ─────────────────────────────────────────────────────────
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [cartItems,   setCartItems]   = useState<CartItem[]>([])
  const cartSet = useMemo(() => new Set(cartItems.map((c) => c.shopify_variant_id)), [cartItems])

  // ── Drag & drop ───────────────────────────────────────────────────────────
  const dragIndex    = useRef<number | null>(null)
  const [dragOver,   setDragOver]   = useState<number | null>(null)

  function handleDragStart(i: number) { dragIndex.current = i }
  function handleDragOver(e: React.DragEvent, i: number) {
    e.preventDefault()
    setDragOver(i)
  }
  function handleDrop(i: number) {
    const from = dragIndex.current
    if (from === null || from === i) { setDragOver(null); return }
    setCartItems((prev) => {
      const next = [...prev]
      const [item] = next.splice(from, 1)
      next.splice(i, 0, item)
      return next
    })
    dragIndex.current = null
    setDragOver(null)
  }
  function handleDragEnd() { dragIndex.current = null; setDragOver(null) }

  // ── Raw data ──────────────────────────────────────────────────────────────
  const [loading,          setLoading]          = useState(true)
  const [variants,         setVariants]         = useState<VariantRow[]>([])
  const [salesByVariant,   setSalesByVariant]   = useState<Map<string, number>>(new Map())
  const [salesByVariant90, setSalesByVariant90] = useState<Map<string, number>>(new Map())
  const [exclusions,       setExclusions]       = useState<Set<string>>(new Set())

  // 90-day window — computed once, stable across re-renders
  const today90 = useMemo(() => new Date().toISOString().slice(0, 10), [])
  const from90  = useMemo(() => {
    const d = new Date(); d.setDate(d.getDate() - 90); return d.toISOString().slice(0, 10)
  }, [])

  useEffect(() => {
    let cancelled = false
    async function load() {
      setLoading(true)
      const [salesRes, sales90Res, variantsRes, exclRes] = await Promise.all([
        supabase
          .from('product_sales')
          .select('variant_id, quantity')
          .eq('brand', brand)
          .gte('date', refFrom)
          .lte('date', refTo)
          .not('variant_id', 'is', null)
          .neq('variant_id', ''),
        supabase
          .from('product_sales')
          .select('variant_id, quantity')
          .eq('brand', brand)
          .gte('date', from90)
          .lte('date', today90)
          .not('variant_id', 'is', null)
          .neq('variant_id', ''),
        supabase
          .from('product_variants')
          .select('shopify_variant_id, shopify_product_id, product_title, variant_title, sku, stock_quantity, image_url')
          .eq('brand', brand)
          .order('product_title'),
        supabase
          .from('product_exclusions')
          .select('product_title')
          .eq('brand', brand),
      ])
      if (cancelled) return

      const byVariant = new Map<string, number>()
      for (const r of salesRes.data ?? []) {
        if (!r.variant_id) continue
        byVariant.set(r.variant_id, (byVariant.get(r.variant_id) ?? 0) + (r.quantity ?? 0))
      }

      const byVariant90 = new Map<string, number>()
      for (const r of sales90Res.data ?? []) {
        if (!r.variant_id) continue
        byVariant90.set(r.variant_id, (byVariant90.get(r.variant_id) ?? 0) + (r.quantity ?? 0))
      }

      setSalesByVariant(byVariant)
      setSalesByVariant90(byVariant90)
      setVariants(variantsRes.data ?? [])
      setExclusions(new Set((exclRes.data ?? []).map((r) => r.product_title)))
      setLoading(false)
    }
    load()
    return () => { cancelled = true }
  }, [brand, refFrom, refTo, from90, today90])

  // ── Computed rows ──────────────────────────────────────────────────────────
  const rows: ReplenishmentRow[] = useMemo(() => {
    const refDays    = periodDays(refFrom, refTo)
    const targetDays = periodDays(targetFrom, targetTo)
    const deadline   = subtractDays(targetFrom, leadTime)

    return variants
      .filter((v) => !exclusions.has(v.product_title) && !v.product_title.includes(' + '))
      .map((v): ReplenishmentRow => {
        const ref_qty  = salesByVariant.get(v.shopify_variant_id) ?? 0
        const qty_90   = salesByVariant90.get(v.shopify_variant_id) ?? 0

        // ── Hybrid velocity logic ──────────────────────────────────────────
        let data_source:   DataSource
        let velocity_qty:  number
        let velocity_days: number
        let velocity_from: string
        let velocity_to:   string

        if (ref_qty > 0) {
          data_source   = 'ref';  velocity_qty = ref_qty;  velocity_days = refDays
          velocity_from = refFrom; velocity_to = refTo
        } else if (qty_90 > 0) {
          data_source   = '90d';  velocity_qty = qty_90;   velocity_days = 90
          velocity_from = from90; velocity_to  = today90
        } else {
          data_source   = 'none'; velocity_qty = 0;        velocity_days = refDays
          velocity_from = refFrom; velocity_to = refTo
        }

        const daily_sales   = velocity_qty / velocity_days
        const stock_needed  = Math.round(daily_sales * targetDays)
        const qty_to_order  = Math.round(Math.max(0, stock_needed - v.stock_quantity) * (1 + buffer / 100))
        const coverage_days = daily_sales > 0 ? Math.round(v.stock_quantity / daily_sales) : null

        const status: ReplenishmentRow['status'] =
          qty_to_order > 0                               ? 'order'
          : coverage_days !== null && coverage_days < 60 ? 'low'
          : 'ok'

        return {
          shopify_variant_id: v.shopify_variant_id,
          product_title:      v.product_title,
          variant_title:      v.variant_title,
          sku:                v.sku,
          image_url:          v.image_url,
          stock_quantity:     v.stock_quantity,
          ref_qty,
          daily_sales,
          coverage_days,
          stock_needed,
          qty_to_order,
          order_deadline: deadline,
          status,
          data_source,
          velocity_days,
          velocity_from,
          velocity_to,
        }
      })
      .filter((r) => r.data_source !== 'none' || r.stock_quantity !== 0)
      .sort((a, b) => {
        const aToOrder = a.qty_to_order > 0
        const bToOrder = b.qty_to_order > 0
        if (aToOrder !== bToOrder) return aToOrder ? -1 : 1
        if (aToOrder && bToOrder) return b.qty_to_order - a.qty_to_order
        const aNeg = a.stock_quantity < 0
        const bNeg = b.stock_quantity < 0
        if (aNeg !== bNeg) return aNeg ? -1 : 1
        if (a.product_title !== b.product_title) return a.product_title.localeCompare(b.product_title)
        return (a.variant_title ?? '').localeCompare(b.variant_title ?? '')
      })
  }, [variants, salesByVariant, salesByVariant90, exclusions, refFrom, refTo, targetFrom, targetTo, leadTime, buffer, from90, today90])

  const rowMap = useMemo(() => new Map(rows.map((r) => [r.shopify_variant_id, r])), [rows])

  // ── Filtered rows ─────────────────────────────────────────────────────────
  const actionRows  = useMemo(() => rows.filter((r) => r.status !== 'ok'), [rows])
  const okRows      = useMemo(() => rows.filter((r) => r.status === 'ok'),  [rows])
  const visibleRows = useMemo(() => {
    const base = showAll ? rows : actionRows
    if (!search.trim()) return base
    const q = search.toLowerCase()
    return base.filter((r) =>
      r.product_title.toLowerCase().includes(q) ||
      (r.variant_title ?? '').toLowerCase().includes(q)
    )
  }, [rows, actionRows, showAll, search])

  // ── AI context ────────────────────────────────────────────────────────────
  const aiContext = useMemo(() => {
    if (loading || rows.length === 0) return null
    const urgentRows = rows.filter((r) => r.status === 'order').slice(0, 10)
    const lowRows    = rows.filter((r) => r.status === 'low').slice(0, 5)
    const urgentLines = urgentRows.map((r) =>
      `${r.product_title}${r.variant_title ? ` — ${r.variant_title}` : ''}: stock ${r.stock_quantity}, commander ${r.qty_to_order} unités, couverture ${r.coverage_days ?? '?'} j, vélocité ${r.daily_sales.toFixed(2)}/j`
    ).join('\n')
    const lowLines = lowRows.map((r) =>
      `${r.product_title}${r.variant_title ? ` — ${r.variant_title}` : ''}: stock ${r.stock_quantity}, couverture ${r.coverage_days ?? '?'} j`
    ).join('\n')
    const totalUnits = urgentRows.reduce((s, r) => s + r.qty_to_order, 0)
    return `Marque: ${BRAND_LABELS[brand]} | Réapprovisionnement
${urgentRows.length} variants à commander en urgence (${totalUnits} unités au total)
${lowRows.length} variants en stock faible

Urgents:\n${urgentLines || 'Aucun'}

Stock faible:\n${lowLines || 'Aucun'}`
  }, [brand, loading, rows])

  // ── Cart helpers ───────────────────────────────────────────────────────────
  function addToCart(row: ReplenishmentRow) {
    if (cartSet.has(row.shopify_variant_id)) return
    setCartItems((prev) => [...prev, {
      shopify_variant_id: row.shopify_variant_id,
      qty: row.qty_to_order > 0 ? row.qty_to_order : 1,
    }])
    setSidebarOpen(true)
  }

  function removeFromCart(id: string) {
    setCartItems((prev) => prev.filter((c) => c.shopify_variant_id !== id))
  }

  function setCartQty(id: string, qty: number) {
    setCartItems((prev) => prev.map((c) =>
      c.shopify_variant_id === id ? { ...c, qty: Math.max(0, qty) } : c
    ))
  }

  // ── Summary ───────────────────────────────────────────────────────────────
  const deadline        = subtractDays(targetFrom, leadTime)
  const daysToDeadline  = Math.round((deadline.getTime() - new Date().getTime()) / 86_400_000)
  const totalToOrder    = rows.reduce((s, r) => s + r.qty_to_order, 0)
  const variantsToOrder = rows.filter((r) => r.qty_to_order > 0).length
  const cartTotal       = cartItems.reduce((s, c) => s + c.qty, 0)

  // Per-product subtotals (only products with ≥ 2 cart lines)
  const cartByProduct = useMemo(() => {
    const map = new Map<string, number>()
    for (const item of cartItems) {
      const row = rowMap.get(item.shopify_variant_id)
      if (!row) continue
      map.set(row.product_title, (map.get(row.product_title) ?? 0) + item.qty)
    }
    // Keep only products appearing more than once
    const countByProduct = new Map<string, number>()
    for (const item of cartItems) {
      const row = rowMap.get(item.shopify_variant_id)
      if (!row) continue
      countByProduct.set(row.product_title, (countByProduct.get(row.product_title) ?? 0) + 1)
    }
    return Array.from(map.entries())
      .filter(([title]) => (countByProduct.get(title) ?? 0) > 1)
      .sort((a, b) => b[1] - a[1])
  }, [cartItems, rowMap])

  // ── CSV export ─────────────────────────────────────────────────────────────
  function exportCSV(all = false) {
    const exportRows = all ? rows : rows.filter((r) => r.status !== 'ok')
    const headers = ['Produit', 'Variant', 'Stock actuel', 'Couverture (j)', 'Ventes/jour', 'Stock nécessaire', 'Qté à commander', 'Statut']
    const csv = [
      headers.join(';'),
      ...exportRows.map((r) => [
        `"${r.product_title.replace(/"/g, '""')}"`,
        `"${(r.variant_title ?? '').replace(/"/g, '""')}"`,
        r.stock_quantity,
        r.coverage_days ?? '—',
        r.daily_sales.toFixed(2).replace('.', ','),
        r.stock_needed,
        r.qty_to_order || '—',
        r.status === 'order' ? 'Commander maintenant' : r.status === 'low' ? 'Stock faible' : 'Stock OK',
      ].join(';')),
    ].join('\r\n')
    const blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8' })
    const url  = URL.createObjectURL(blob)
    const a    = document.createElement('a')
    a.href = url
    a.download = `reappro-${brand}-${all ? 'complet-' : ''}${new Date().toISOString().slice(0, 10)}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  function exportCartCSV() {
    const headers = ['Produit', 'Variant', 'Référence SKU', 'Quantité commandée']
    const csv = [
      headers.join(';'),
      ...cartItems.filter((c) => c.qty > 0).map((c) => {
        const r = rowMap.get(c.shopify_variant_id)
        if (!r) return ''
        return [
          `"${r.product_title.replace(/"/g, '""')}"`,
          `"${(r.variant_title ?? '').replace(/"/g, '""')}"`,
          r.sku ?? '',
          c.qty,
        ].join(';')
      }).filter(Boolean),
    ].join('\r\n')
    const blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8' })
    const url  = URL.createObjectURL(blob)
    const a    = document.createElement('a')
    a.href = url
    a.download = `bon-commande-${brand}-${new Date().toISOString().slice(0, 10)}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-[#faf9f8]">
      <main className="max-w-7xl mx-auto px-4 sm:px-6 py-5 sm:py-8 space-y-5">

        {/* ── Page header ────────────────────────────────────────────────── */}
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-xl font-bold text-[#1a1a2e]">Réapprovisionnement</h1>
            <p className="text-sm text-[#6b6b63] mt-0.5">{BRAND_LABELS[brand]} — Calcul des commandes par variant</p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {/* Brand selector */}
            {(['bowa', 'moom', 'krom'] as const).filter(b => allowedBrands.includes(b)).map((b) => (
              <button
                key={b}
                onClick={() => setBrand(b)}
                className={`px-3 py-1.5 rounded-xl text-xs font-semibold transition-colors ${
                  brand === b
                    ? 'bg-[#1a1a2e] text-white'
                    : 'bg-white border border-[#e8e4e0] text-[#6b6b63] hover:border-[#aeb0c9]'
                }`}
              >
                {BRAND_LABELS[b]}
              </button>
            ))}
            {/* Bon de commande button with badge */}
            <button
              onClick={() => setSidebarOpen(true)}
              className="relative flex items-center gap-2 px-4 py-2 bg-[#1a1a2e] text-white text-sm font-medium rounded-xl hover:bg-[#2d2d4e] transition-colors"
            >
              <ClipboardList size={14} />
              Bon de commande
              {cartItems.length > 0 && (
                <span className="absolute -top-1.5 -right-1.5 min-w-[18px] h-[18px] px-1 bg-[#c7293a] text-white text-[10px] font-bold rounded-full flex items-center justify-center tabular-nums">
                  {cartItems.length}
                </span>
              )}
            </button>
            <button
              onClick={() => exportCSV(false)}
              className="flex items-center gap-2 px-4 py-2 border border-[#e8e4e0] bg-white text-[#6b6b63] text-sm font-medium rounded-xl hover:border-[#aeb0c9] hover:text-[#1a1a2e] transition-colors"
            >
              <Download size={14} />
              CSV
            </button>
          </div>
        </div>

        {/* ── Settings panel ─────────────────────────────────────────────── */}
        <div className="bg-white rounded-[20px] shadow-[0_2px_16px_rgba(0,0,0,0.06)] p-5">
          <p className="text-[10px] font-semibold uppercase tracking-[0.1em] text-[#aeb0c9] mb-4">Paramètres de calcul</p>

          <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-4">
            <div>
              <p className="text-xs font-semibold text-[#6b6b63] mb-2">Période de référence</p>
              <div className="space-y-1.5">
                <input type="date" value={refFrom} onChange={(e) => setRefFrom(e.target.value)}
                  className="w-full text-xs border border-[#e8e4e0] rounded-lg px-3 py-2 text-[#1a1a2e] focus:outline-none focus:border-[#aeb0c9] bg-white" />
                <input type="date" value={refTo} onChange={(e) => setRefTo(e.target.value)}
                  className="w-full text-xs border border-[#e8e4e0] rounded-lg px-3 py-2 text-[#1a1a2e] focus:outline-none focus:border-[#aeb0c9] bg-white" />
              </div>
              <p className="text-[10px] text-[#9b9b93] mt-1">{periodDays(refFrom, refTo)} jours</p>
            </div>

            <div>
              <p className="text-xs font-semibold text-[#6b6b63] mb-2">Période cible</p>
              <div className="space-y-1.5">
                <input type="date" value={targetFrom} onChange={(e) => setTargetFrom(e.target.value)}
                  className="w-full text-xs border border-[#e8e4e0] rounded-lg px-3 py-2 text-[#1a1a2e] focus:outline-none focus:border-[#aeb0c9] bg-white" />
                <input type="date" value={targetTo} onChange={(e) => setTargetTo(e.target.value)}
                  className="w-full text-xs border border-[#e8e4e0] rounded-lg px-3 py-2 text-[#1a1a2e] focus:outline-none focus:border-[#aeb0c9] bg-white" />
              </div>
              <p className="text-[10px] text-[#9b9b93] mt-1">{periodDays(targetFrom, targetTo)} jours</p>
            </div>

            <div>
              <p className="text-xs font-semibold text-[#6b6b63] mb-2">Délai fabrication</p>
              <div className="flex items-center gap-2">
                <input type="number" value={leadTime} min={1} max={365}
                  onChange={(e) => setLeadTime(Math.max(1, parseInt(e.target.value) || 30))}
                  className="w-full text-xs border border-[#e8e4e0] rounded-lg px-3 py-2 text-[#1a1a2e] focus:outline-none focus:border-[#aeb0c9] bg-white" />
                <span className="text-xs text-[#6b6b63] shrink-0">jours</span>
              </div>
            </div>

            <div>
              <p className="text-xs font-semibold text-[#6b6b63] mb-2">Buffer de sécurité</p>
              <div className="flex items-center gap-2">
                <input type="number" value={buffer} min={0} max={200}
                  onChange={(e) => setBuffer(Math.max(0, parseInt(e.target.value) || 0))}
                  className="w-full text-xs border border-[#e8e4e0] rounded-lg px-3 py-2 text-[#1a1a2e] focus:outline-none focus:border-[#aeb0c9] bg-white" />
                <span className="text-xs text-[#6b6b63] shrink-0">%</span>
              </div>
            </div>
          </div>

          {/* Summary banner */}
          {!loading && (
            <div className="mt-5 pt-4 border-t border-[#f0f0ee]">
              {daysToDeadline < 0 ? (
                <div className="flex items-center gap-2.5 px-4 py-3 bg-[#fce8ea] rounded-xl">
                  <span className="text-base">🚨</span>
                  <span className="text-sm font-bold text-[#c7293a]">
                    URGENT — Date limite dépassée de {Math.abs(daysToDeadline)} jour{Math.abs(daysToDeadline) > 1 ? 's' : ''}
                  </span>
                  <span className="text-sm text-[#c7293a] opacity-80">—</span>
                  <span className="text-sm text-[#c7293a]">
                    <strong>{totalToOrder.toLocaleString('fr-FR')} unités</strong>
                    <span className="font-normal"> sur {variantsToOrder} variant{variantsToOrder > 1 ? 's' : ''}</span>
                  </span>
                </div>
              ) : (
                <div className="flex flex-wrap items-center gap-3">
                  <span className="text-base">{daysToDeadline < 15 ? '⚠️' : '📦'}</span>
                  <span className={`text-sm font-semibold ${daysToDeadline < 15 ? 'text-amber-600' : 'text-[#1a1a2e]'}`}>
                    Commande à passer avant le {fmtDate(deadline)}
                  </span>
                  <span className="text-sm text-[#6b6b63]">—</span>
                  <span className="text-sm text-[#1a1a2e]">
                    <strong>{totalToOrder.toLocaleString('fr-FR')} unités</strong>
                    <span className="text-[#6b6b63] font-normal"> sur {variantsToOrder} variant{variantsToOrder > 1 ? 's' : ''}</span>
                  </span>
                  {daysToDeadline > 0 && (
                    <span className={`text-xs font-medium ${daysToDeadline < 15 ? 'text-amber-600' : 'text-[#9b9b93]'}`}>
                      (dans {daysToDeadline} j)
                    </span>
                  )}
                </div>
              )}
            </div>
          )}
        </div>

        {/* ── AI Insights ────────────────────────────────────────────────── */}
        <AiInsights type="reapprovisionnement" brand="moom" context={aiContext} />

        {/* ── Table ──────────────────────────────────────────────────────── */}
        <div className="bg-white rounded-[20px] shadow-[0_2px_16px_rgba(0,0,0,0.06)] overflow-hidden">

          <div className="px-5 py-4 border-b border-[#f0f0ee] flex items-center justify-between gap-4">
            <div className="flex items-center gap-2 flex-1 max-w-xs">
              <Search size={13} className="text-[#9b9b93] shrink-0" />
              <input
                type="text"
                placeholder="Filtrer par produit ou variant…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="flex-1 text-sm text-[#1a1a2e] placeholder:text-[#9b9b93] focus:outline-none bg-transparent"
              />
            </div>
            {!loading && (
              <span className="text-xs text-[#9b9b93] shrink-0">
                {visibleRows.length} variant{visibleRows.length > 1 ? 's' : ''}
              </span>
            )}
          </div>

          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px]">
              <thead>
                <tr className="border-b border-[#f0f0ee]">
                  {[
                    { label: 'Produit / Variant', w: '' },
                    { label: 'Stock actuel',       w: 'w-28' },
                    { label: 'Couverture',          w: 'w-32' },
                    { label: 'Ventes / jour',       w: 'w-24' },
                    { label: 'Stock nécessaire',    w: 'w-32' },
                    { label: 'Qté suggérée',        w: 'w-28' },
                    { label: 'Statut',              w: 'w-36' },
                    { label: '',                    w: 'w-28' },
                  ].map(({ label, w }) => (
                    <th key={label} className={`px-4 py-3 text-left text-[10px] font-semibold uppercase tracking-[0.08em] text-[#9b9b93] ${w}`}>
                      {label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-[#f5f0f2]">
                {loading ? (
                  Array.from({ length: 10 }).map((_, i) => (
                    <tr key={i}>
                      {Array.from({ length: 8 }).map((_, j) => (
                        <td key={j} className="px-4 py-3.5">
                          <div className="h-3 bg-[#f0f0ee] rounded animate-pulse" style={{ width: j === 0 ? 180 : 56 }} />
                        </td>
                      ))}
                    </tr>
                  ))
                ) : visibleRows.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="px-4 py-14 text-center text-sm text-[#9b9b93]">
                      {search ? 'Aucun variant correspondant' : 'Aucune donnée — relancez un sync Shopify'}
                    </td>
                  </tr>
                ) : (
                  visibleRows.map((row) => {
                    const inCart = cartSet.has(row.shopify_variant_id)
                    const badge =
                      row.status === 'order'
                        ? { cls: 'bg-[#fce8ea] text-[#c7293a]', dot: 'bg-[#c7293a]', label: '⚠\uFE0F Commander' }
                        : row.status === 'low'
                        ? { cls: 'bg-amber-50 text-amber-700',   dot: 'bg-amber-500', label: 'Stock faible' }
                        : { cls: 'bg-[#dcf5e7] text-[#1a7f4b]', dot: 'bg-[#1a7f4b]', label: 'Stock OK' }

                    return (
                      <tr key={row.shopify_variant_id} className="hover:bg-[#faf9f8] transition-colors">
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-3 min-w-0">
                            {row.image_url ? (
                              // eslint-disable-next-line @next/next/no-img-element
                              <img src={row.image_url} alt={row.product_title}
                                className="w-9 h-9 rounded-lg object-cover bg-[#f5f0f2] shrink-0" />
                            ) : (
                              <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-[#e5c8d2] to-[#c4b4d4] flex items-center justify-center shrink-0">
                                <Package size={14} className="text-white/70" />
                              </div>
                            )}
                            <div className="min-w-0">
                              <p className="text-xs font-semibold text-[#1a1a2e] truncate">{row.product_title}</p>
                              {row.variant_title && (
                                <p className="text-[10px] text-[#9b9b93] truncate mt-0.5">{row.variant_title}</p>
                              )}
                            </div>
                          </div>
                        </td>

                        <td className="px-4 py-3">
                          <span className={`text-sm font-bold tabular-nums ${
                            row.stock_quantity <= 0  ? 'text-[#c7293a]'
                            : row.stock_quantity < 10 ? 'text-amber-600'
                            : 'text-[#1a1a2e]'
                          }`}>
                            {row.stock_quantity.toLocaleString('fr-FR')}
                          </span>
                        </td>

                        <td className="px-4 py-3">
                          <CoverageBadge days={row.coverage_days} />
                        </td>

                        <td className="px-4 py-3">
                          <span className="text-sm tabular-nums text-[#6b6b63]">{row.daily_sales.toFixed(2)}</span>
                          <div className="mt-1">
                            <SourceBadge source={row.data_source} days={row.velocity_days} from={row.velocity_from} to={row.velocity_to} />
                          </div>
                        </td>

                        <td className="px-4 py-3">
                          <span className="text-sm tabular-nums text-[#1a1a2e]">{row.stock_needed.toLocaleString('fr-FR')}</span>
                        </td>

                        <td className="px-4 py-3">
                          {row.qty_to_order > 0 ? (
                            <span className="text-sm font-bold tabular-nums text-[#1a1a2e]">{row.qty_to_order.toLocaleString('fr-FR')}</span>
                          ) : (
                            <span className="text-sm tabular-nums text-[#9b9b93]">—</span>
                          )}
                        </td>

                        <td className="px-4 py-3">
                          <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold whitespace-nowrap ${badge.cls}`}>
                            <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${badge.dot}`} />
                            {badge.label}
                          </span>
                        </td>

                        <td className="px-4 py-3">
                          <button
                            onClick={() => inCart ? setSidebarOpen(true) : addToCart(row)}
                            className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                              inCart
                                ? 'bg-[#dcf5e7] text-[#1a7f4b]'
                                : 'bg-[#f5f0f2] text-[#6b6b63] hover:bg-[#1a1a2e] hover:text-white'
                            }`}
                          >
                            {inCart
                              ? <><Check size={11} /> Ajouté</>
                              : <><Plus size={11} /> Ajouter</>
                            }
                          </button>
                        </td>
                      </tr>
                    )
                  })
                )}
              </tbody>
            </table>
          </div>

          {!loading && okRows.length > 0 && !search && (
            <div className="px-5 py-3.5 border-t border-[#f0f0ee] flex items-center justify-center">
              <button
                onClick={() => setShowAll((v) => !v)}
                className="flex items-center gap-1.5 text-xs text-[#6b6b63] hover:text-[#1a1a2e] transition-colors"
              >
                <ChevronDown size={14} className={`transition-transform ${showAll ? 'rotate-180' : ''}`} />
                {showAll
                  ? `Masquer les ${okRows.length} variants en stock OK`
                  : `Afficher les ${okRows.length} variants en stock OK`}
              </button>
            </div>
          )}
        </div>

      </main>

      {/* ── Cart sidebar ─────────────────────────────────────────────────────── */}
      <div className={`fixed inset-0 z-50 ${sidebarOpen ? 'pointer-events-auto' : 'pointer-events-none'}`}>
        {/* Backdrop */}
        <div
          className={`absolute inset-0 bg-black/30 backdrop-blur-[2px] transition-opacity duration-300 ${sidebarOpen ? 'opacity-100' : 'opacity-0'}`}
          onClick={() => setSidebarOpen(false)}
        />

        {/* Panel */}
        <div className={`absolute right-0 top-0 h-full w-full max-w-[460px] bg-[#faf9f8] shadow-2xl flex flex-col transition-transform duration-300 ease-out ${sidebarOpen ? 'translate-x-0' : 'translate-x-full'}`}>

          {/* Header */}
          <div className="flex items-center justify-between px-6 py-5 border-b border-[#f0f0ee] shrink-0">
            <div>
              <h2 className="text-sm font-bold text-[#1a1a2e]">Bon de commande</h2>
              <p className="text-[11px] text-[#6b6b63] mt-0.5">
                Mōom Paris — avant le {fmtDate(deadline)}
              </p>
            </div>
            <button onClick={() => setSidebarOpen(false)} className="p-2 rounded-lg hover:bg-[#f5f0f2] transition-colors">
              <X size={16} className="text-[#6b6b63]" />
            </button>
          </div>

          {/* Items */}
          <div className="flex-1 overflow-y-auto py-2">
            {cartItems.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-full gap-3 text-center px-8">
                <div className="w-12 h-12 rounded-2xl bg-[#f5f0f2] flex items-center justify-center">
                  <ClipboardList size={22} className="text-[#aeb0c9]" />
                </div>
                <p className="text-sm font-medium text-[#1a1a2e]">Aucun article</p>
                <p className="text-xs text-[#9b9b93]">Cliquez sur &ldquo;+ Ajouter&rdquo; sur chaque ligne pour composer votre commande.</p>
              </div>
            ) : (
              <ul className="divide-y divide-[#f5f0f2]">
                {cartItems.map((item, i) => {
                  const row = rowMap.get(item.shopify_variant_id)
                  if (!row) return null
                  const isDragTarget = dragOver === i
                  return (
                    <li
                      key={item.shopify_variant_id}
                      draggable
                      onDragStart={() => handleDragStart(i)}
                      onDragOver={(e) => handleDragOver(e, i)}
                      onDrop={() => handleDrop(i)}
                      onDragEnd={handleDragEnd}
                      className={`flex items-center gap-3 px-5 py-3.5 transition-colors cursor-default ${
                        isDragTarget ? 'bg-[#f0eef8] border-t-2 border-[#aeb0c9]' : 'hover:bg-[#faf9f8]'
                      }`}
                    >
                      {/* Drag handle */}
                      <GripVertical size={14} className="text-[#d0ccc8] shrink-0 cursor-grab active:cursor-grabbing" />

                      {/* Image */}
                      {row.image_url ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={row.image_url} alt={row.product_title}
                          className="w-10 h-10 rounded-lg object-cover bg-[#f5f0f2] shrink-0" />
                      ) : (
                        <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-[#e5c8d2] to-[#c4b4d4] flex items-center justify-center shrink-0">
                          <Package size={13} className="text-white/70" />
                        </div>
                      )}

                      {/* Info */}
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-semibold text-[#1a1a2e] truncate">{row.product_title}</p>
                        {row.variant_title && (
                          <p className="text-[10px] text-[#6b6b63] truncate mt-0.5">{row.variant_title}</p>
                        )}
                        {row.sku && (
                          <p className="text-[10px] text-[#aeb0c9] truncate mt-0.5 font-mono">{row.sku}</p>
                        )}
                      </div>

                      {/* Qty input */}
                      <input
                        type="number"
                        min={0}
                        value={item.qty}
                        onChange={(e) => setCartQty(item.shopify_variant_id, parseInt(e.target.value) || 0)}
                        className="w-16 text-sm font-bold text-center border border-[#e8e4e0] rounded-lg px-2 py-1.5 text-[#1a1a2e] focus:outline-none focus:border-[#aeb0c9] bg-white tabular-nums shrink-0"
                      />

                      {/* Remove */}
                      <button
                        onClick={() => removeFromCart(item.shopify_variant_id)}
                        className="p-1.5 rounded-lg hover:bg-[#fce8ea] text-[#9b9b93] hover:text-[#c7293a] transition-colors shrink-0"
                      >
                        <X size={13} />
                      </button>
                    </li>
                  )
                })}
              </ul>
            )}
          </div>

          {/* Footer */}
          <div className="border-t border-[#f0f0ee] px-6 py-5 space-y-4 shrink-0 bg-white">
            {/* Per-product subtotals */}
            {cartByProduct.length > 0 && (
              <div className="space-y-1.5">
                <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-[#9b9b93]">Par produit</p>
                {cartByProduct.map(([title, qty]) => {
                  // Shorten long product names to fit
                  const short = title.length > 28 ? title.slice(0, 26) + '…' : title
                  return (
                    <div key={title} className="flex items-center justify-between">
                      <span className="text-xs text-[#6b6b63] truncate">{short}</span>
                      <span className="text-xs font-semibold text-[#1a1a2e] tabular-nums shrink-0 ml-2">
                        {qty.toLocaleString('fr-FR')} u.
                      </span>
                    </div>
                  )
                })}
                <div className="h-px bg-[#f0f0ee] mt-2" />
              </div>
            )}
            <div className="flex items-center justify-between text-sm">
              <span className="text-[#6b6b63]">
                {cartItems.length} référence{cartItems.length > 1 ? 's' : ''}
              </span>
              <span className="font-bold text-[#1a1a2e]">
                {cartTotal.toLocaleString('fr-FR')} unités
              </span>
            </div>
            <div className="flex gap-2">
              <button
                onClick={exportCartCSV}
                disabled={cartItems.length === 0}
                className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 border border-[#e8e4e0] rounded-xl text-sm font-medium text-[#6b6b63] hover:border-[#aeb0c9] hover:text-[#1a1a2e] transition-colors disabled:opacity-40"
              >
                <Download size={13} />
                CSV
              </button>
              <button
                onClick={() => printPO(cartItems, rowMap, deadline, BRAND_LABELS[brand] ?? brand)}
                disabled={cartItems.length === 0}
                className="flex-2 flex-1 flex items-center justify-center gap-2 px-4 py-2.5 bg-[#1a1a2e] text-white rounded-xl text-sm font-medium hover:bg-[#2d2d4e] transition-colors disabled:opacity-40"
              >
                <Download size={13} />
                Exporter PDF
              </button>
            </div>
          </div>
        </div>
      </div>

    </div>
  )
}
