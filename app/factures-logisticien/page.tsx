'use client'

import { useState, useEffect, useRef } from 'react'
import { read, utils } from 'xlsx'
import { Upload, TrendingUp, Sparkles, AlertTriangle, RotateCcw, CheckCircle, GitFork, Clock } from 'lucide-react'

interface InvoiceRow {
  order_name: string
  date: string
  service_price: number
  shipping_price: number
  total_price: number
  isFW: boolean
  sku: string
}

interface Anomaly {
  type: 'double_billing' | 'high_shipping' | 'suspicious'
  order_name: string
  detail: string
  amount: number
  logistician_shipping?: number  // high_shipping only
}

interface SplitShipment {
  order_name: string
  amount: number
}

interface ShippingDetail {
  country:       string
  country_code:  string
  customer_paid: number
  ecart:         number
  verdict:       'Justifié' | 'À contester'
}

interface ShippingContext {
  order_item_count:     number
  similar_orders_count: number
  similar_avg_shipping: number
  pct_above:            number
}

interface MonthlySummary {
  month:                string
  fw_count:             number
  fw_total:             number
  normal_total:         number
  double_billing_count: number
  anomaly_count?:       number
}

function countryFlag(code: string): string {
  if (!code || code.length !== 2) return '🌍'
  return [...code.toUpperCase()].map(c => String.fromCodePoint(c.charCodeAt(0) + 127397)).join('')
}

function excelDate(v: unknown): string {
  if (typeof v === 'number') return new Date((v - 25569) * 86400 * 1000).toISOString().slice(0, 10)
  return String(v ?? '')
}

function toNum(v: unknown): number {
  const n = parseFloat(String(v ?? '').replace(',', '.'))
  return isNaN(n) ? 0 : n
}

function isFW(r: Record<string, unknown>): boolean {
  return String(r['order_id'] ?? '').startsWith('FR_') || r['attributes'] === 'FW'
}

function detectAnomalies(
  rows: InvoiceRow[],
  orderWarehouse: Record<string, string | null>
): { anomalies: Anomaly[]; splitShipments: SplitShipment[] } {
  const anomalies: Anomaly[]            = []
  const splitShipments: SplitShipment[] = []
  const normal = rows.filter(r => !r.isFW)
  const fw     = rows.filter(r => r.isFW)

  // 1. Double billing vs split shipment
  const normalNames = new Set(normal.map(r => r.order_name))
  for (const r of fw) {
    if (!normalNames.has(r.order_name)) continue
    const warehouse = orderWarehouse[r.order_name]
    if (warehouse === 'Les deux') {
      splitShipments.push({ order_name: r.order_name, amount: r.total_price })
    } else {
      anomalies.push({
        type: 'double_billing',
        order_name: r.order_name,
        detail: 'Commande facturée en normal et en renvoi FW',
        amount: r.total_price,
      })
    }
  }

  // 2. Abnormally high shipping: > mean + 2.5 * std dev
  const shippingValues = normal.map(r => r.shipping_price).filter(v => v > 0)
  if (shippingValues.length > 5) {
    const mean = shippingValues.reduce((s, v) => s + v, 0) / shippingValues.length
    const std  = Math.sqrt(shippingValues.reduce((s, v) => s + (v - mean) ** 2, 0) / shippingValues.length)
    const threshold = mean + 2.5 * std
    for (const r of normal) {
      if (r.shipping_price > threshold && r.shipping_price > mean * 3) {
        anomalies.push({
          type: 'high_shipping',
          order_name: r.order_name,
          detail: `Shipping $${r.shipping_price.toFixed(2)} vs moyenne $${mean.toFixed(2)}`,
          amount: r.shipping_price - mean,
          logistician_shipping: r.shipping_price,
        })
      }
    }
  }

  // 3. Suspicious: total_price > 99th percentile
  const totals = rows.map(r => r.total_price).sort((a, b) => a - b)
  const p99    = totals[Math.floor(totals.length * 0.99)] ?? Infinity
  for (const r of rows) {
    if (r.total_price > p99 && r.total_price > 100) {
      anomalies.push({
        type: 'suspicious',
        order_name: r.order_name,
        detail: `Montant total $${r.total_price.toFixed(2)} (top 1%)`,
        amount: r.total_price,
      })
    }
  }

  return { anomalies, splitShipments }
}

function computeShippingContext(
  rows: InvoiceRow[],
  highShippingOrders: Record<string, number>
): Record<string, ShippingContext> {
  const normal = rows.filter(r => !r.isFW)

  // Count rows per order (proxy for item count)
  const itemCount: Record<string, number> = {}
  for (const r of normal) {
    itemCount[r.order_name] = (itemCount[r.order_name] ?? 0) + 1
  }

  // One shipping value per order (first row seen)
  const shippingPerOrder: Record<string, number> = {}
  const seen = new Set<string>()
  for (const r of normal) {
    if (!seen.has(r.order_name)) {
      shippingPerOrder[r.order_name] = r.shipping_price
      seen.add(r.order_name)
    }
  }

  const result: Record<string, ShippingContext> = {}

  for (const orderName of Object.keys(highShippingOrders)) {
    const n               = itemCount[orderName] ?? 1
    const flaggedShipping = highShippingOrders[orderName]

    // Similar orders: ±1 item count, positive shipping, excluding the flagged order itself
    const similarShippings = Object.entries(itemCount)
      .filter(([name, count]) => name !== orderName && Math.abs(count - n) <= 1)
      .map(([name]) => shippingPerOrder[name] ?? 0)
      .filter(v => v > 0)

    const avgShipping = similarShippings.length > 0
      ? similarShippings.reduce((s, v) => s + v, 0) / similarShippings.length
      : 0

    const pctAbove = avgShipping > 0
      ? ((flaggedShipping - avgShipping) / avgShipping) * 100
      : 0

    result[orderName] = {
      order_item_count:     n,
      similar_orders_count: similarShippings.length,
      similar_avg_shipping: avgShipping,
      pct_above:            pctAbove,
    }
  }

  return result
}

export default function FacturesLogisticienPage() {
  const fileRef = useRef<HTMLInputElement>(null)

  const [month, setMonth]                   = useState('')
  const [fileName, setFileName]             = useState('')
  const [loading, setLoading]               = useState(false)
  const [lookingUp, setLookingUp]           = useState(false)
  const [loadingHistory, setLoadingHistory] = useState(false)
  const [rows, setRows]                     = useState<InvoiceRow[]>([])
  const [anomalies, setAnomalies]           = useState<Anomaly[]>([])
  const [splitShipments, setSplitShipments] = useState<SplitShipment[]>([])
  const [shippingDetails, setShippingDetails]   = useState<Record<string, ShippingDetail>>({})
  const [shippingContext, setShippingContext]    = useState<Record<string, ShippingContext>>({})
  const [history, setHistory]               = useState<MonthlySummary[]>([])
  const [aiText, setAiText]                 = useState('')
  const [aiLoading, setAiLoading]           = useState(false)
  const [confirmFile, setConfirmFile]       = useState<File | null>(null)

  useEffect(() => {
    fetch('/api/factures-logisticien/history')
      .then(r => r.json())
      .then(d => setHistory(d.summaries ?? []))
      .catch(() => {})
  }, [])

  async function loadHistoricalMonth(m: string) {
    setLoadingHistory(true)
    setMonth(m)
    setAiText('')
    try {
      const d = await fetch(`/api/factures-logisticien/history?month=${m}`).then(r => r.json())
      const s = d.summary
      if (s) {
        setRows(s.invoice_rows ?? [])
        setAnomalies(s.anomalies_data ?? [])
        setSplitShipments(s.split_shipments_data ?? [])
        setShippingDetails(s.shipping_details_data ?? {})
        setShippingContext(s.shipping_context_data ?? {})
        setFileName(`${m} (historique)`)
      }
    } catch { /* ignore */ }
    setLoadingHistory(false)
  }

  function handleFileInput(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    // Reset so the same file can be re-selected after cancelling
    if (fileRef.current) fileRef.current.value = ''
    setFileName(file.name)

    const monthExists = history.some(h => h.month === month)
    if (monthExists) {
      setConfirmFile(file)
    } else {
      processFile(file)
    }
  }

  async function processFile(file: File) {
    setLoading(true)
    setAiText('')

    const buf  = await file.arrayBuffer()
    const wb   = read(buf)
    const ws   = wb.Sheets[wb.SheetNames[0]]
    const raw: Record<string, unknown>[] = utils.sheet_to_json(ws, { defval: '' })

    const parsed: InvoiceRow[] = raw.map(r => ({
      order_name:     String(r['order_name'] ?? '').trim(),
      date:           excelDate(r['date']),
      service_price:  toNum(r['service_price']),
      shipping_price: toNum(r['shipping_price']),
      total_price:    toNum(r['total_price']),
      isFW:           isFW(r),
      sku:            String(r['sku'] ?? r['SKU'] ?? r['product_sku'] ?? r['variant_sku'] ?? '').trim(),
    })).filter(r => r.order_name !== '')

    setLoading(false)

    // Pre-identify double billing candidates
    const parsedNormal  = parsed.filter(r => !r.isFW)
    const parsedFW      = parsed.filter(r => r.isFW)
    const normalNameSet = new Set(parsedNormal.map(r => r.order_name))
    const dbCandidates  = parsedFW.filter(r => normalNameSet.has(r.order_name)).map(r => r.order_name)

    // Pre-identify high shipping candidates (statistical detection)
    const shipVals = parsedNormal.map(r => r.shipping_price).filter(v => v > 0)
    const highShippingOrders: Record<string, number> = {}
    if (shipVals.length > 5) {
      const mean = shipVals.reduce((s, v) => s + v, 0) / shipVals.length
      const std  = Math.sqrt(shipVals.reduce((s, v) => s + (v - mean) ** 2, 0) / shipVals.length)
      const thr  = mean + 2.5 * std
      for (const r of parsedNormal) {
        if (r.shipping_price > thr && r.shipping_price > mean * 3) {
          highShippingOrders[r.order_name] = r.shipping_price
        }
      }
    }

    // Compute contextual shipping analysis (purely from invoice data)
    const newShippingContext = computeShippingContext(parsed, highShippingOrders)

    // Parallel Shopify lookups
    let orderWarehouse:     Record<string, string | null>  = {}
    let newShippingDetails: Record<string, ShippingDetail> = {}

    if (dbCandidates.length > 0 || Object.keys(highShippingOrders).length > 0) {
      setLookingUp(true)
      try {
        const [warehouseRes, shippingRes] = await Promise.all([
          dbCandidates.length > 0
            ? fetch('/api/shopify/order-warehouse', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ order_names: dbCandidates }),
              }).then(r => r.json()).catch(() => ({ results: {} }))
            : Promise.resolve({ results: {} }),
          Object.keys(highShippingOrders).length > 0
            ? fetch('/api/shopify/order-shipping', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  order_names:             Object.keys(highShippingOrders),
                  logistician_shippings:   highShippingOrders,
                }),
              }).then(r => r.json()).catch(() => ({ results: {} }))
            : Promise.resolve({ results: {} }),
        ])
        orderWarehouse     = warehouseRes.results ?? {}
        newShippingDetails = shippingRes.results  ?? {}
      } catch { /* fallback: conservative classification */ }
      setLookingUp(false)
    }

    const { anomalies: detected, splitShipments: splits } = detectAnomalies(parsed, orderWarehouse)
    setRows(parsed)
    setAnomalies(detected)
    setSplitShipments(splits)
    setShippingDetails(newShippingDetails)
    setShippingContext(newShippingContext)

    // Save full data to history
    if (month) {
      const normalRows = parsed.filter(r => !r.isFW)
      const fwRows     = parsed.filter(r => r.isFW)
      const doubles    = detected.filter(a => a.type === 'double_billing').length
      await fetch('/api/factures-logisticien/history', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          month,
          normal_count:          normalRows.length,
          fw_count:              fwRows.length,
          normal_total:          normalRows.reduce((s, r) => s + r.total_price, 0),
          fw_total:              fwRows.reduce((s, r) => s + r.total_price, 0),
          double_billing_count:  doubles,
          anomaly_count:         detected.length,
          invoice_rows:          parsed,
          anomalies_data:        detected,
          split_shipments_data:  splits,
          shipping_details_data: newShippingDetails,
          shipping_context_data: newShippingContext,
        }),
      })
      const updated = await fetch('/api/factures-logisticien/history').then(r => r.json())
      setHistory(updated.summaries ?? [])
    }
  }

  async function handleAI() {
    if (!rows.length) return
    setAiLoading(true)
    setAiText('')

    const normal = rows.filter(r => !r.isFW)
    const fw     = rows.filter(r => r.isFW)
    const total  = rows.reduce((s, r) => s + r.total_price, 0)
    const atRisk = anomalies.reduce((s, a) => s + a.amount, 0)

    const context = `
Analyse facture logisticien Mōom — ${month}
Total facturé : $${total.toFixed(2)} (${rows.length} lignes)
Lignes normales : ${normal.length}, total $${normal.reduce((s,r)=>s+r.total_price,0).toFixed(2)}
Lignes FW (renvois) : ${fw.length}, total $${fw.reduce((s,r)=>s+r.total_price,0).toFixed(2)}
Anomalies détectées : ${anomalies.length}
${anomalies.map(a => `- [${a.type}] ${a.order_name}: ${a.detail} ($${a.amount.toFixed(2)})`).join('\n')}
Montant total à risque : $${atRisk.toFixed(2)}
Historique FW : ${history.map(h => `${h.month}: ${h.fw_count} FW ($${h.fw_total?.toFixed(0)})`).join(' | ')}
    `.trim()

    try {
      const res  = await fetch('/api/ai', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ context, type: 'invoice', brand: 'moom' }),
      })
      const data = await res.json()
      const recs = data.recommendations ?? []
      setAiText(recs.map((r: { icon: string; text: string }) => `${r.icon} ${r.text}`).join('\n\n'))
    } catch {
      setAiText('Analyse indisponible.')
    }
    setAiLoading(false)
  }

  const normal    = rows.filter(r => !r.isFW)
  const fw        = rows.filter(r => r.isFW)
  const total     = rows.reduce((s, r) => s + r.total_price, 0)
  const fwTotal   = fw.reduce((s, r) => s + r.total_price, 0)
  const atRisk    = anomalies.reduce((s, a) => s + a.amount, 0)

  const chartData = [...history].sort((a, b) => a.month.localeCompare(b.month)).slice(-6)
  const maxFW     = Math.max(...chartData.map(d => d.fw_count), 1)

  const sortedHistory = [...history].sort((a, b) => b.month.localeCompare(a.month))

  return (
    <div className="min-h-screen bg-[#f8f7f5] pl-[72px]">
      <div className="max-w-6xl mx-auto px-6 py-8 space-y-6">

        {/* Header */}
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-[0.1em] text-[#aeb0c9] mb-1">Mōom</p>
          <h1 className="text-xl font-bold text-[#1a1a2e]">Logistician Invoice Analysis</h1>
        </div>

        {/* History chips */}
        {sortedHistory.length > 0 && (
          <div className="flex items-center gap-2 flex-wrap">
            <div className="flex items-center gap-1.5 mr-1">
              <Clock size={11} className="text-[#9b9b93]" />
              <p className="text-[10px] font-semibold uppercase tracking-[0.1em] text-[#9b9b93]">Historique</p>
            </div>
            {sortedHistory.map(h => (
              <button
                key={h.month}
                onClick={() => loadHistoricalMonth(h.month)}
                className={`px-3 py-1.5 rounded-xl text-xs font-medium transition-colors flex items-center gap-1.5 ${
                  month === h.month && rows.length > 0
                    ? 'bg-[#1a1a2e] text-white'
                    : 'bg-white border border-[#e8e4e0] text-[#6b6b63] hover:border-[#aeb0c9] shadow-[0_1px_4px_rgba(0,0,0,0.04)]'
                }`}
              >
                {new Date(h.month + '-02').toLocaleDateString('fr-FR', { month: 'short', year: '2-digit' })}
                {(h.anomaly_count ?? 0) > 0 && (
                  <span className={`font-semibold ${month === h.month && rows.length > 0 ? 'text-[#f8a0a8]' : 'text-[#c7293a]'}`}>
                    {h.anomaly_count}
                  </span>
                )}
              </button>
            ))}
          </div>
        )}

        {/* Step 1 + Step 2 — side by side */}
        <div className="grid grid-cols-2 gap-4">
          {/* Step 1 — Month */}
          <div className="bg-white rounded-[16px] shadow-[0_2px_12px_rgba(0,0,0,0.06)] p-5">
            <label className="block text-[10px] font-semibold uppercase tracking-[0.1em] text-[#6b6b63] mb-3">
              Step 1 — Select month *
            </label>
            <input
              type="month"
              value={month}
              onChange={e => {
                setMonth(e.target.value)
                setRows([])
                setAnomalies([])
                setSplitShipments([])
                setShippingDetails({})
                setShippingContext({})
                setFileName('')
                setAiText('')
              }}
              className="rounded-xl border border-[#e8e4e0] px-4 py-2.5 text-sm text-[#1a1a2e] focus:outline-none focus:ring-2 focus:ring-[#aeb0c9]/40"
            />
            {month && (
              <p className="mt-2 text-[11px] text-[#1a7f4b] font-medium">
                {new Date(month + '-02').toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })}
              </p>
            )}
          </div>

          {/* Step 2 — Upload */}
          <div
            onClick={() => { if (month) fileRef.current?.click() }}
            className={`bg-white rounded-[16px] shadow-[0_2px_12px_rgba(0,0,0,0.06)] p-8 flex flex-col items-center justify-center gap-3 border-2 border-dashed transition-colors ${
              month ? 'cursor-pointer border-[#e8e4e0] hover:border-[#aeb0c9]' : 'cursor-not-allowed border-[#f0f0ee] opacity-40'
            }`}
          >
            <Upload size={28} className="text-[#aeb0c9]" />
            <p className="text-sm font-medium text-[#1a1a2e]">
              {fileName ? fileName : month ? 'Step 2 — Upload Excel invoice' : 'Select a month first'}
            </p>
            <p className="text-[11px] text-[#9b9b93]">.xlsx or .xls</p>
            <input ref={fileRef} type="file" accept=".xlsx,.xls" className="hidden" onChange={handleFileInput} disabled={!month} />
          </div>
        </div>

        {loading        && <p className="text-sm text-[#9b9b93] text-center">Parsing file…</p>}
        {lookingUp      && <p className="text-sm text-[#9b9b93] text-center">Vérification auprès de Shopify…</p>}
        {loadingHistory && <p className="text-sm text-[#9b9b93] text-center">Chargement de l&apos;historique…</p>}

        {rows.length > 0 && (
          <>
            {/* Summary cards — full width */}
            <div className="grid grid-cols-3 gap-3">
              <div className="bg-white rounded-[14px] shadow-[0_2px_10px_rgba(0,0,0,0.05)] p-4">
                <p className="text-[10px] font-semibold uppercase tracking-wide text-[#6b6b63] mb-2">Total facturé</p>
                <p className="text-2xl font-bold text-[#1a1a2e]">${total.toFixed(2)}</p>
                <p className="text-xs text-[#9b9b93] mt-0.5">{rows.length} lignes · {normal.length} normales</p>
              </div>
              <div className="bg-white rounded-[14px] shadow-[0_2px_10px_rgba(0,0,0,0.05)] p-4">
                <div className="flex items-center gap-1.5 mb-2">
                  <RotateCcw size={12} className="text-[#aeb0c9]" />
                  <p className="text-[10px] font-semibold uppercase tracking-wide text-[#6b6b63]">Renvois FW</p>
                </div>
                <p className="text-2xl font-bold text-[#1a1a2e]">{fw.length}</p>
                <p className="text-xs text-[#9b9b93] mt-0.5">${fwTotal.toFixed(2)} au total</p>
              </div>
              <div className={`rounded-[14px] shadow-[0_2px_10px_rgba(0,0,0,0.05)] p-4 ${anomalies.length > 0 ? 'bg-[#fef2f2]' : 'bg-white'}`}>
                <div className="flex items-center gap-1.5 mb-2">
                  {anomalies.length > 0
                    ? <AlertTriangle size={12} className="text-[#c7293a]" />
                    : <CheckCircle size={12} className="text-[#1a7f4b]" />
                  }
                  <p className="text-[10px] font-semibold uppercase tracking-wide text-[#6b6b63]">Anomalies</p>
                </div>
                <p className={`text-2xl font-bold ${anomalies.length > 0 ? 'text-[#c7293a]' : 'text-[#1a7f4b]'}`}>
                  {anomalies.length}
                </p>
                <p className="text-xs text-[#9b9b93] mt-0.5">
                  {anomalies.length > 0 ? `$${atRisk.toFixed(2)} à risque` : 'Aucune détectée'}
                </p>
              </div>
            </div>

            {/* Two-column layout */}
            <div className="grid grid-cols-2 gap-4 items-start">

              {/* Left — Anomalies + Split shipments */}
              <div className="bg-white rounded-[16px] shadow-[0_2px_12px_rgba(0,0,0,0.06)] overflow-hidden">
                <div className="px-5 py-4 border-b border-[#f0f0ee] flex items-center gap-2">
                  <AlertTriangle size={13} className={anomalies.length > 0 ? 'text-[#c7293a]' : 'text-[#1a7f4b]'} />
                  <p className="text-[10px] font-semibold uppercase tracking-[0.1em] text-[#6b6b63]">Anomalies détectées</p>
                </div>
                {anomalies.length === 0 ? (
                  <div className="px-5 py-8 flex flex-col items-center gap-2 text-center">
                    <CheckCircle size={24} className="text-[#1a7f4b]" />
                    <p className="text-sm font-medium text-[#1a7f4b]">Aucune anomalie</p>
                    <p className="text-xs text-[#9b9b93]">La facture semble correcte.</p>
                  </div>
                ) : (
                  <div className="divide-y divide-[#f8f8f7]">
                    {anomalies.map((a, i) => {
                      const sd  = a.type === 'high_shipping' ? shippingDetails[a.order_name] : undefined
                      const ctx = a.type === 'high_shipping' ? shippingContext[a.order_name]  : undefined
                      return (
                        <div key={i} className="flex items-start justify-between px-5 py-3.5 gap-4">
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 mb-0.5">
                              <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-md ${
                                a.type === 'double_billing' ? 'bg-[#fce8ea] text-[#c7293a]' :
                                a.type === 'high_shipping'  ? 'bg-[#fff3cd] text-[#b45309]' :
                                'bg-[#f0f0ee] text-[#6b6b63]'
                              }`}>
                                {a.type === 'double_billing' ? 'Double billing' : a.type === 'high_shipping' ? 'Shipping élevé' : 'Suspect'}
                              </span>
                              <span className="font-mono text-xs text-[#1a1a2e]">{a.order_name}</span>
                            </div>
                            <p className="text-xs text-[#9b9b93]">{a.detail}</p>

                            {/* Shopify shipping details */}
                            {sd && (
                              <div className="flex items-center gap-2 mt-1.5 flex-wrap">
                                <span className="text-xs text-[#1a1a2e]">
                                  {countryFlag(sd.country_code)} {sd.country}
                                </span>
                                <span className="text-[#d0cec8]">·</span>
                                <span className="text-xs text-[#6b6b63]">
                                  Client: <span className="font-medium text-[#1a1a2e]">${sd.customer_paid.toFixed(2)}</span>
                                </span>
                                <span className="text-[#d0cec8]">·</span>
                                <span className="text-xs text-[#6b6b63]">
                                  Écart: <span className="font-semibold text-[#c7293a]">${sd.ecart.toFixed(2)}</span>
                                </span>
                                <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-md ${
                                  sd.verdict === 'À contester'
                                    ? 'bg-[#fce8ea] text-[#c7293a]'
                                    : 'bg-[#e6f4ec] text-[#1a7f4b]'
                                }`}>
                                  {sd.verdict}
                                </span>
                              </div>
                            )}

                            {/* Contextual shipping analysis */}
                            {ctx && ctx.similar_orders_count > 0 && (
                              <p className="text-[11px] text-[#9b9b93] mt-1.5 leading-relaxed">
                                Les commandes à {ctx.order_item_count} article{ctx.order_item_count !== 1 ? 's' : ''} coûtent en moyenne{' '}
                                <span className="font-medium text-[#1a1a2e]">${ctx.similar_avg_shipping.toFixed(2)}</span> de shipping ce mois —{' '}
                                celle-ci est à{' '}
                                <span className="font-medium text-[#1a1a2e]">${(a.logistician_shipping ?? 0).toFixed(2)}</span>{' '}
                                soit{' '}
                                <span className="font-semibold text-[#c7293a]">+{ctx.pct_above.toFixed(0)}% au-dessus</span>
                              </p>
                            )}
                          </div>
                          <p className="text-sm font-semibold text-[#c7293a] tabular-nums shrink-0">${a.amount.toFixed(2)}</p>
                        </div>
                      )
                    })}
                  </div>
                )}

                {/* Split shipments légitimes */}
                {splitShipments.length > 0 && (
                  <>
                    <div className="px-5 py-3 border-t border-[#f0f0ee] flex items-center gap-2 bg-[#f6faf8]">
                      <GitFork size={12} className="text-[#1a7f4b]" />
                      <p className="text-[10px] font-semibold uppercase tracking-[0.1em] text-[#1a7f4b]">
                        Split shipments légitimes ({splitShipments.length})
                      </p>
                    </div>
                    <div className="divide-y divide-[#f0f8f4]">
                      {splitShipments.map((s, i) => (
                        <div key={i} className="flex items-center justify-between px-5 py-3 gap-4 bg-[#f6faf8]/60">
                          <div className="flex items-center gap-2">
                            <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-md bg-[#e6f4ec] text-[#1a7f4b]">
                              Les deux entrepôts
                            </span>
                            <span className="font-mono text-xs text-[#1a1a2e]">{s.order_name}</span>
                          </div>
                          <p className="text-sm font-medium text-[#1a7f4b] tabular-nums shrink-0">${s.amount.toFixed(2)}</p>
                        </div>
                      ))}
                    </div>
                  </>
                )}
              </div>

              {/* Right — AI Analysis + FW chart */}
              <div className="space-y-4">

                {/* AI Analysis */}
                <div className="bg-white rounded-[16px] shadow-[0_2px_12px_rgba(0,0,0,0.06)] p-5">
                  <div className="flex items-center justify-between mb-4">
                    <div className="flex items-center gap-2">
                      <Sparkles size={14} className="text-[#aeb0c9]" />
                      <p className="text-[10px] font-semibold uppercase tracking-[0.1em] text-[#6b6b63]">Analyse IA</p>
                    </div>
                    <button
                      onClick={handleAI}
                      disabled={aiLoading}
                      className="px-4 py-1.5 rounded-xl bg-[#1a1a2e] text-white text-xs font-semibold disabled:opacity-40 hover:bg-[#2a2a3e] transition-colors"
                    >
                      {aiLoading ? 'Analyse en cours…' : "Analyser avec l'IA"}
                    </button>
                  </div>
                  {aiText ? (
                    <div className="space-y-3">
                      {aiText.split('\n\n').map((line, i) => (
                        <p key={i} className="text-sm text-[#1a1a2e] leading-relaxed">{line}</p>
                      ))}
                    </div>
                  ) : (
                    <p className="text-xs text-[#9b9b93]">Cliquez sur Analyser pour obtenir un verdict en français sur cette facture.</p>
                  )}
                </div>

                {/* Monthly FW chart */}
                {chartData.length > 0 && (
                  <div className="bg-white rounded-[16px] shadow-[0_2px_12px_rgba(0,0,0,0.06)] p-5">
                    <div className="flex items-center gap-2 mb-5">
                      <TrendingUp size={14} className="text-[#aeb0c9]" />
                      <p className="text-[10px] font-semibold uppercase tracking-[0.1em] text-[#6b6b63]">Évolution mensuelle des FW</p>
                    </div>
                    <div className="flex items-end gap-3 h-28">
                      {chartData.map((d) => {
                        const h   = Math.max(4, Math.round((d.fw_count / maxFW) * 96))
                        const lbl = new Date(d.month + '-02').toLocaleDateString('fr-FR', { month: 'short' })
                        return (
                          <div key={d.month} className="flex-1 flex flex-col items-center gap-1">
                            <p className="text-[10px] font-semibold text-[#1a1a2e]">{d.fw_count}</p>
                            <div className="w-full rounded-t-lg bg-[#aeb0c9]/60" style={{ height: h }} />
                            <p className="text-[10px] text-[#9b9b93]">{lbl}</p>
                          </div>
                        )
                      })}
                    </div>
                  </div>
                )}

              </div>
            </div>
          </>
        )}

        {/* Monthly FW chart when no file loaded yet */}
        {rows.length === 0 && chartData.length > 0 && (
          <div className="bg-white rounded-[16px] shadow-[0_2px_12px_rgba(0,0,0,0.06)] p-5">
            <div className="flex items-center gap-2 mb-5">
              <TrendingUp size={14} className="text-[#aeb0c9]" />
              <p className="text-[10px] font-semibold uppercase tracking-[0.1em] text-[#6b6b63]">Évolution mensuelle des FW</p>
            </div>
            <div className="flex items-end gap-3 h-28">
              {chartData.map((d) => {
                const h   = Math.max(4, Math.round((d.fw_count / maxFW) * 96))
                const lbl = new Date(d.month + '-02').toLocaleDateString('fr-FR', { month: 'short' })
                return (
                  <div key={d.month} className="flex-1 flex flex-col items-center gap-1">
                    <p className="text-[10px] font-semibold text-[#1a1a2e]">{d.fw_count}</p>
                    <div className="w-full rounded-t-lg bg-[#aeb0c9]/60" style={{ height: h }} />
                    <p className="text-[10px] text-[#9b9b93]">{lbl}</p>
                  </div>
                )
              })}
            </div>
          </div>
        )}

      </div>

      {/* Confirmation dialog — re-upload existing month */}
      {confirmFile && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-[2px]">
          <div className="bg-white rounded-[20px] shadow-2xl p-6 max-w-sm w-full mx-4">
            <h3 className="font-semibold text-[#1a1a2e] mb-2">Remplacer les données ?</h3>
            <p className="text-sm text-[#9b9b93] mb-5 leading-relaxed">
              Un fichier pour{' '}
              <span className="font-medium text-[#1a1a2e]">
                {new Date(month + '-02').toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' })}
              </span>{' '}
              existe déjà. Voulez-vous écraser les données existantes ?
            </p>
            <div className="flex gap-3 justify-end">
              <button
                onClick={() => setConfirmFile(null)}
                className="px-4 py-2 rounded-xl text-sm font-medium text-[#6b6b63] hover:bg-[#f5f5f3] transition-colors"
              >
                Annuler
              </button>
              <button
                onClick={() => {
                  const f = confirmFile
                  setConfirmFile(null)
                  processFile(f)
                }}
                className="px-4 py-2 rounded-xl bg-[#c7293a] text-white text-sm font-semibold hover:bg-[#b02234] transition-colors"
              >
                Remplacer
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  )
}
