'use client'

import { useState, useEffect, useRef } from 'react'
import { read, utils } from 'xlsx'
import { Upload, TrendingUp, Sparkles, AlertTriangle, CheckCircle, Clock, Loader2, Scale, Gavel } from 'lucide-react'

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
  type: 'double_billing' | 'high_shipping' | 'high_service' | 'suspicious'
  order_name: string
  detail: string
  amount: number
  logistician_shipping?: number  // high_shipping only
  logistician_service?:  number  // high_service only
}

interface SplitShipment {
  order_name: string
  amount: number
}

interface ShippingDetail {
  country:       string
  country_code:  string
  customer_paid: number
}

// Pays membres UE + DOM-TOM : livraisons chères sont suspectes
// CH, NO, GB, IS, LI… sont hors UE → tarif international normal, non contestable
const EU_MEMBER_STATES = new Set([
  'FR','BE','DE','NL','ES','IT','PT','AT','LU','IE','DK',
  'SE','FI','PL','CZ','HU','RO','BG','HR','SK','SI','EE','LV',
  'LT','GR','CY','MT',
  'RE','GP','MQ','GF',  // DOM-TOM
])

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

  // 2bis. Service fee (frais de prépa) anormalement élevé — ex. bug logisticien qui
  // DOUBLE le service fee sur les commandes multi-produits expédiées de France.
  // Le shipping peut être correct mais le service fee gonflé → on le détecte à part.
  const serviceValues = normal.map(r => r.service_price).filter(v => v > 0)
  if (serviceValues.length > 5) {
    const mean = serviceValues.reduce((s, v) => s + v, 0) / serviceValues.length
    const std  = Math.sqrt(serviceValues.reduce((s, v) => s + (v - mean) ** 2, 0) / serviceValues.length)
    const threshold = mean + 2.5 * std
    for (const r of normal) {
      if (r.service_price > threshold && r.service_price > mean * 3) {
        anomalies.push({
          type: 'high_service',
          order_name: r.order_name,
          detail: `Service fee $${r.service_price.toFixed(2)} vs moyenne $${mean.toFixed(2)}`,
          amount: r.service_price - mean,
          logistician_service: r.service_price,
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
  highShippingOrders: Record<string, number>,
  itemCounts: Record<string, number>  // sum of line_item quantities from Shopify
): Record<string, ShippingContext> {
  const normal = rows.filter(r => !r.isFW)

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
    const n = itemCounts[orderName]
    // Skip if item count unknown — avoids showing misleading "1 article" when API didn't return data
    if (n === undefined || n === 0) continue

    const flaggedShipping = highShippingOrders[orderName]

    // Similar orders: exact same item count, positive shipping, excluding the flagged order
    // Only include orders whose item count was actually fetched from Shopify
    const similarShippings = Object.keys(shippingPerOrder)
      .filter(name => {
        const count = itemCounts[name]
        return name !== orderName && count !== undefined && count > 0 && count === n
      })
      .map(name => shippingPerOrder[name])
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
  const [saving, setSaving]                 = useState(false)
  const [saved, setSaved]                   = useState(false)
  const [parseError, setParseError]         = useState('')
  const [usdEurRate, setUsdEurRate]         = useState(0.92)
  const [view, setView]                     = useState<'facture' | 'contestation'>('facture')

  // Taux USD→EUR live (frankfurter.app, gratuit sans clé)
  useEffect(() => {
    fetch('https://api.frankfurter.app/latest?from=USD&to=EUR')
      .then(r => r.json())
      .then(d => { if (d.rates?.EUR) setUsdEurRate(d.rates.EUR) })
      .catch(() => {})
  }, [])

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
        setSaved(true)
      }
    } catch { /* ignore */ }
    setLoadingHistory(false)
  }

  function handleFileInput(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    if (fileRef.current) fileRef.current.value = ''
    setFileName(file.name)
    processFile(file)
  }

  async function processFile(file: File) {
    setLoading(true)
    setSaved(false)
    setAiText('')
    setRows([])

    let parsed: InvoiceRow[] = []
    try {
      const buf = await file.arrayBuffer()
      const wb  = read(buf)
      const ws  = wb.Sheets[wb.SheetNames[0]]
      const raw: Record<string, unknown>[] = utils.sheet_to_json(ws, { defval: '' })

      // Log columns for debugging
      if (raw.length > 0) console.log('[invoice] colonnes détectées:', Object.keys(raw[0]))

      // Flexible column lookup: case-insensitive, ignores spaces/underscores
      function col(row: Record<string, unknown>, ...candidates: string[]): unknown {
        const keys = Object.keys(row)
        for (const c of candidates) {
          const norm = c.toLowerCase().replace(/[\s_-]/g, '')
          const found = keys.find(k => k.toLowerCase().replace(/[\s_-]/g, '') === norm)
          if (found !== undefined && row[found] !== '' && row[found] !== undefined && row[found] !== null) return row[found]
        }
        return ''
      }

      parsed = raw.map(r => ({
        order_name:     String(col(r, 'order_name', 'order name', 'order', 'reference', 'ref', 'commande', 'numero commande', 'numéro commande')).trim(),
        date:           excelDate(col(r, 'date', 'created', 'created_at', 'created at', 'order_date', 'order date', 'Date')),
        service_price:  toNum(col(r, 'service_price', 'service fee', 'service price', 'serviceprice', 'preparation', 'prep', 'picking', 'service')),
        shipping_price: toNum(col(r, 'shipping_price', 'shipping fee', 'shipping price', 'shippingprice', 'shipping', 'livraison', 'transport', 'frais livraison', 'frais de port')),
        total_price:    toNum(col(r, 'total_price', 'total price', 'total fee', 'totalprice', 'total', 'montant', 'amount', 'prix total')),
        isFW:           isFW(r),
        sku:            String(col(r, 'sku', 'SKU', 'product_sku', 'variant_sku', 'article', 'reference produit', 'réf')).trim(),
      })).filter(r => r.order_name !== '')
    } catch (err) {
      console.error('[invoice] erreur parsing:', err)
      setLoading(false)
      return
    }

    setLoading(false)

    if (parsed.length === 0) {
      setParseError('Aucune ligne reconnue dans ce fichier. Vérifie que les colonnes s\'appellent bien order_name, total_price, etc.')
      return
    }
    setParseError('')

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

    // Parallel Shopify lookups
    let orderWarehouse:     Record<string, string | null>  = {}
    let newShippingDetails: Record<string, ShippingDetail> = {}
    let itemCounts:         Record<string, number>         = {}

    const hasHighShipping  = Object.keys(highShippingOrders).length > 0
    // Always include high-shipping orders in the item-count batch even if the list is otherwise empty
    const normalOrderNames = hasHighShipping
      ? [...new Set([
          ...Object.keys(highShippingOrders),
          ...parsedNormal.map(r => r.order_name),
        ])]
      : []

    if (dbCandidates.length > 0 || hasHighShipping) {
      setLookingUp(true)
      try {
        const [warehouseRes, shippingRes, itemCountRes] = await Promise.all([
          dbCandidates.length > 0
            ? fetch('/api/shopify/order-warehouse', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ order_names: dbCandidates }),
              }).then(r => r.json()).catch(() => ({ results: {} }))
            : Promise.resolve({ results: {} }),
          hasHighShipping
            ? fetch('/api/shopify/order-shipping', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  order_names: Object.keys(highShippingOrders),
                }),
              }).then(r => r.json()).catch(() => ({ results: {} }))
            : Promise.resolve({ results: {} }),
          normalOrderNames.length > 0
            ? fetch('/api/shopify/order-item-count', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ order_names: normalOrderNames, month }),
              }).then(r => r.json()).catch(() => ({ results: {} }))
            : Promise.resolve({ results: {} }),
        ])
        orderWarehouse     = warehouseRes.results  ?? {}
        newShippingDetails = shippingRes.results   ?? {}
        itemCounts         = itemCountRes.results  ?? {}
      } catch { /* fallback: conservative classification */ }
      setLookingUp(false)
    }

    const newShippingContext = computeShippingContext(parsed, highShippingOrders, itemCounts)
    const { anomalies: detected, splitShipments: splits } = detectAnomalies(parsed, orderWarehouse)
    setRows(parsed)
    setAnomalies(detected)
    setSplitShipments(splits)
    setShippingDetails(newShippingDetails)
    setShippingContext(newShippingContext)
    setSaved(false)
  }

  async function handleSave() {
    if (!month || !rows.length) return
    setSaving(true)
    const normalRows = rows.filter(r => !r.isFW)
    const fwRows     = rows.filter(r => r.isFW)
    const doubles    = anomalies.filter(a => a.type === 'double_billing').length
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
        anomaly_count:         anomalies.length,
        invoice_rows:          rows,
        anomalies_data:        anomalies,
        split_shipments_data:  splitShipments,
        shipping_details_data: shippingDetails,
        shipping_context_data: shippingContext,
      }),
    })
    const updated = await fetch('/api/factures-logisticien/history').then(r => r.json())
    setHistory(updated.summaries ?? [])
    setSaving(false)
    setSaved(true)
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
  const total     = rows.reduce((s, r) => s + r.total_price, 0)
  const atRisk    = anomalies.reduce((s, a) => s + a.amount, 0)

  // KPI de coût (aide à voir CE qui coûte et POURQUOI)
  const shippingTotal = normal.reduce((s, r) => s + r.shipping_price, 0)
  const serviceTotal  = normal.reduce((s, r) => s + r.service_price, 0)
  const avgPerOrder   = normal.length ? total / normal.length : 0
  const shipAvg       = normal.length ? shippingTotal / normal.length : 0
  const servAvg       = normal.length ? serviceTotal / normal.length : 0
  const serviceAnoms  = anomalies.filter(a => a.type === 'high_service').length
  const shippingAnoms = anomalies.filter(a => a.type === 'high_shipping').length

  const chartData = [...history].sort((a, b) => a.month.localeCompare(b.month)).slice(-6)
  const maxTotal  = Math.max(...chartData.map(d => d.normal_total || 0), 1)

  const sortedHistory = [...history].sort((a, b) => b.month.localeCompare(a.month))

  return (
    <div className="min-h-screen bg-[#f8f7f5] pl-[72px]">
      <div className="max-w-6xl mx-auto px-6 py-8 space-y-6">

        {/* Header */}
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-[0.1em] text-[#aeb0c9] mb-1">Mōom</p>
          <h1 className="text-xl font-bold text-[#1a1a2e]">Factures</h1>
        </div>

        {/* Onglets */}
        <div className="flex items-center gap-1 border-b border-[#e8e4e0]">
          {([['facture', 'Facturation'], ['contestation', 'Contestation']] as const).map(([v, l]) => (
            <button
              key={v}
              onClick={() => setView(v)}
              className={`flex items-center gap-1.5 px-4 py-2 text-sm font-medium -mb-px border-b-2 transition-colors ${
                view === v ? 'border-[#1a1a2e] text-[#1a1a2e]' : 'border-transparent text-[#9b9b93] hover:text-[#6b6b63]'
              }`}
            >
              {v === 'contestation' && <Gavel size={13} strokeWidth={2} />}
              {l}
            </button>
          ))}
        </div>

        {view === 'contestation' ? (
          <ContestationView
            rate={usdEurRate}
            months={sortedHistory.map(h => h.month)}
            onPickMonth={setMonth}
          />
        ) : (
        <>

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
          <div className="bg-white rounded-[16px] shadow-[0_2px_12px_rgba(0,0,0,0.06)] p-5 flex flex-col items-center justify-center gap-4">
            <label className="block text-[10px] font-semibold uppercase tracking-[0.1em] text-[#6b6b63] w-full">
              Step 2 — Charger la facture *
            </label>
            <Upload size={24} className="text-[#aeb0c9]" />
            {fileName ? (
              <p className="text-sm font-medium text-[#1a7f4b] text-center break-all">{fileName}</p>
            ) : (
              <p className="text-[11px] text-[#9b9b93]">.xlsx ou .xls</p>
            )}
            <label
              className={`w-full flex items-center justify-center gap-2 py-2.5 rounded-xl text-sm font-semibold transition-colors ${
                month
                  ? 'bg-[#1a1a2e] text-white cursor-pointer hover:bg-[#2d2d4a]'
                  : 'bg-[#f0f0ee] text-[#9b9b93] cursor-not-allowed'
              }`}
            >
              <Upload size={14} />
              {fileName ? 'Changer le fichier' : 'Charger'}
              <input
                ref={fileRef}
                type="file"
                accept=".xlsx,.xls"
                className="hidden"
                onChange={handleFileInput}
                disabled={!month}
              />
            </label>
          </div>
        </div>

        {loading        && <p className="text-sm text-[#9b9b93] text-center">Lecture du fichier…</p>}
        {lookingUp      && <p className="text-sm text-[#9b9b93] text-center">Vérification auprès de Shopify…</p>}
        {loadingHistory && <p className="text-sm text-[#9b9b93] text-center">Chargement de l&apos;historique…</p>}
        {parseError && (
          <div className="rounded-[14px] bg-[#fef2f2] border border-[#fecaca] px-5 py-4">
            <p className="text-sm font-semibold text-[#c7293a] mb-1">Fichier non reconnu</p>
            <p className="text-xs text-[#6b6b63]">{parseError}</p>
          </div>
        )}

        {rows.length > 0 && (
          <div className={`rounded-[16px] px-5 py-4 flex items-center justify-between gap-4 shadow-[0_2px_12px_rgba(0,0,0,0.08)] ${saved ? 'bg-[#f0fdf4] border border-[#bbf7d0]' : 'bg-[#1a1a2e]'}`}>
            <div>
              {saved ? (
                <p className="text-sm font-semibold text-[#15803d]">✓ Facture enregistrée dans le système</p>
              ) : (
                <>
                  <p className="text-sm font-semibold text-white">{rows.length} lignes chargées · {anomalies.length} anomalie{anomalies.length !== 1 ? 's' : ''}</p>
                  <p className="text-xs text-white/50 mt-0.5">Clique sur Valider pour enregistrer cette facture</p>
                </>
              )}
            </div>
            {!saved && (
              <button
                onClick={handleSave}
                disabled={saving}
                className="shrink-0 flex items-center gap-2 px-5 py-2.5 rounded-xl bg-white text-[#1a1a2e] text-sm font-bold hover:bg-[#f5f5f3] transition-colors disabled:opacity-50"
              >
                {saving ? (
                  <><svg className="animate-spin" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg>Enregistrement…</>
                ) : (
                  <><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>Valider</>
                )}
              </button>
            )}
          </div>
        )}

        {rows.length > 0 && (
          <>
            {/* KPI — voir facilement CE qui coûte et POURQUOI */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              {/* Total facturé + moyenne / commande */}
              <div className="bg-white rounded-[14px] shadow-[0_2px_10px_rgba(0,0,0,0.05)] p-4">
                <p className="text-[10px] font-semibold uppercase tracking-wide text-[#6b6b63] mb-2">Total facturé</p>
                <p className="text-2xl font-bold text-[#1a1a2e]">${total.toFixed(0)}</p>
                <p className="text-xs text-[#9b9b93] mt-0.5">{normal.length} commandes · ${avgPerOrder.toFixed(2)}/cmd</p>
              </div>
              {/* Livraison */}
              <div className="bg-white rounded-[14px] shadow-[0_2px_10px_rgba(0,0,0,0.05)] p-4">
                <p className="text-[10px] font-semibold uppercase tracking-wide text-[#6b6b63] mb-2">Livraison</p>
                <p className="text-2xl font-bold text-[#1a1a2e]">${shippingTotal.toFixed(0)}</p>
                <p className={`text-xs mt-0.5 ${shippingAnoms > 0 ? 'text-[#c7293a] font-semibold' : 'text-[#9b9b93]'}`}>
                  ${shipAvg.toFixed(2)}/cmd{shippingAnoms > 0 ? ` · ${shippingAnoms} anormale${shippingAnoms > 1 ? 's' : ''}` : ''}
                </p>
              </div>
              {/* Frais de prépa (service fee) — là où le bug logisticien gonfle */}
              <div className={`rounded-[14px] shadow-[0_2px_10px_rgba(0,0,0,0.05)] p-4 ${serviceAnoms > 0 ? 'bg-[#fff8ed]' : 'bg-white'}`}>
                <p className="text-[10px] font-semibold uppercase tracking-wide text-[#6b6b63] mb-2">Frais de prépa</p>
                <p className="text-2xl font-bold text-[#1a1a2e]">${serviceTotal.toFixed(0)}</p>
                <p className={`text-xs mt-0.5 ${serviceAnoms > 0 ? 'text-[#b45309] font-semibold' : 'text-[#9b9b93]'}`}>
                  ${servAvg.toFixed(2)}/cmd{serviceAnoms > 0 ? ` · ${serviceAnoms} anormal${serviceAnoms > 1 ? 'es' : ''}` : ''}
                </p>
              </div>
              {/* À contester */}
              <div className={`rounded-[14px] shadow-[0_2px_10px_rgba(0,0,0,0.05)] p-4 ${anomalies.length > 0 ? 'bg-[#fef2f2]' : 'bg-white'}`}>
                <div className="flex items-center gap-1.5 mb-2">
                  {anomalies.length > 0
                    ? <AlertTriangle size={12} className="text-[#c7293a]" />
                    : <CheckCircle size={12} className="text-[#1a7f4b]" />}
                  <p className="text-[10px] font-semibold uppercase tracking-wide text-[#6b6b63]">À contester</p>
                </div>
                <p className={`text-2xl font-bold ${anomalies.length > 0 ? 'text-[#c7293a]' : 'text-[#1a7f4b]'}`}>
                  {anomalies.length > 0 ? `$${atRisk.toFixed(0)}` : '0'}
                </p>
                <p className="text-xs text-[#9b9b93] mt-0.5">
                  {anomalies.length > 0 ? `${anomalies.length} anomalie${anomalies.length > 1 ? 's' : ''} à récupérer` : 'Aucune anomalie'}
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

                      if (a.type === 'high_shipping') {
                        const row        = rows.find(r => r.order_name === a.order_name)
                        const totalUsd   = row ? (row.service_price + row.shipping_price) : (a.logistician_shipping ?? 0)
                        const totalEur      = totalUsd * usdEurRate
                        const clientPaidEur = sd?.customer_paid ?? 0
                        const clientPaidUsd = usdEurRate > 0 ? clientPaidEur / usdEurRate : 0
                        const netCost       = totalUsd - clientPaidUsd   // en $
                        const isIntl        = sd && !EU_MEMBER_STATES.has(sd.country_code)
                        const isCovered     = clientPaidUsd > 0 && clientPaidUsd >= totalUsd
                        const verdict    =
                          isCovered ? { label: 'Couvert', color: 'green' } :
                          isIntl    ? { label: 'International', color: 'gray' } :
                          sd        ? { label: 'À contester', color: 'red' } : null

                        return (
                          <div key={i} className="px-5 py-4 space-y-3">
                            {/* Header */}
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-md bg-[#fff3cd] text-[#b45309]">
                                Shipping élevé
                              </span>
                              <span className="font-mono text-xs font-semibold text-[#1a1a2e]">{a.order_name}</span>
                              {sd && (
                                <span className="text-xs text-[#6b6b63]">
                                  {countryFlag(sd.country_code)} {sd.country}
                                </span>
                              )}
                              {verdict && (
                                <span className={`ml-auto text-[10px] font-semibold px-1.5 py-0.5 rounded-md ${
                                  verdict.color === 'red'   ? 'bg-[#fce8ea] text-[#c7293a]' :
                                  verdict.color === 'green' ? 'bg-[#e6f4ec] text-[#1a7f4b]' :
                                  'bg-[#f0f0ee] text-[#6b6b63]'
                                }`}>
                                  {verdict.label}
                                </span>
                              )}
                            </div>

                            {/* 3 chiffres clés */}
                            <div className="grid grid-cols-3 gap-2">
                              <div className="bg-[#f8f8f7] rounded-xl p-3 text-center">
                                <p className="text-[10px] text-[#9b9b93] mb-1">Bowa facture</p>
                                <p className="text-base font-bold text-[#1a1a2e]">${totalUsd.toFixed(2)}</p>
                                <p className="text-[10px] text-[#c0bfba] mt-0.5">{totalEur.toFixed(2)}€</p>
                              </div>
                              <div className="bg-[#f0fdf4] rounded-xl p-3 text-center">
                                <p className="text-[10px] text-[#9b9b93] mb-1">Client a payé</p>
                                <p className="text-base font-bold text-[#1a7f4b]">
                                  {clientPaidUsd > 0 ? `$${clientPaidUsd.toFixed(2)}` : '—'}
                                </p>
                                {clientPaidEur > 0 && <p className="text-[10px] text-[#c0bfba] mt-0.5">{clientPaidEur.toFixed(2)}€</p>}
                              </div>
                              <div className={`rounded-xl p-3 text-center ${isCovered ? 'bg-[#f0fdf4]' : netCost > 30 ? 'bg-[#fff8ec]' : 'bg-[#f8f8f7]'}`}>
                                <p className="text-[10px] text-[#9b9b93] mb-1">Coût net Mōom</p>
                                <p className={`text-base font-bold ${isCovered ? 'text-[#1a7f4b]' : netCost > 30 ? 'text-[#b45309]' : 'text-[#1a1a2e]'}`}>
                                  {isCovered ? '$0.00' : `$${netCost.toFixed(2)}`}
                                </p>
                              </div>
                            </div>

                            {/* Taux + contexte France */}
                            <div className="flex items-center justify-between gap-2">
                              <p className="text-[11px] text-[#9b9b93]">
                                {ctx && ctx.similar_orders_count > 0
                                  ? `En France (~${ctx.order_item_count} art.) : ~$${ctx.similar_avg_shipping.toFixed(0)} de shipping`
                                  : ''}
                              </p>
                              <p className="text-[10px] text-[#c0bfba] shrink-0">1$ = {usdEurRate.toFixed(4)}€</p>
                            </div>
                          </div>
                        )
                      }

                      // double_billing / suspicious — carte simple
                      return (
                        <div key={i} className="flex items-start justify-between px-5 py-3.5 gap-4">
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 mb-0.5">
                              <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-md ${
                                a.type === 'double_billing' ? 'bg-[#fce8ea] text-[#c7293a]'
                                  : a.type === 'high_service' ? 'bg-[#fff3cd] text-[#b45309]'
                                  : 'bg-[#f0f0ee] text-[#6b6b63]'
                              }`}>
                                {a.type === 'double_billing' ? 'Double billing'
                                  : a.type === 'high_service' ? 'Service fee élevé'
                                  : 'Suspect'}
                              </span>
                              <span className="font-mono text-xs text-[#1a1a2e]">{a.order_name}</span>
                            </div>
                            <p className="text-xs text-[#9b9b93]">{a.detail}</p>
                          </div>
                          <p className="text-sm font-semibold text-[#c7293a] tabular-nums shrink-0">${a.amount.toFixed(2)}</p>
                        </div>
                      )
                    })}
                  </div>
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
                      <p className="text-[10px] font-semibold uppercase tracking-[0.1em] text-[#6b6b63]">Total facturé / mois</p>
                    </div>
                    <div className="flex items-end gap-3 h-28">
                      {chartData.map((d) => {
                        const h   = Math.max(4, Math.round(((d.normal_total||0) / maxTotal) * 96))
                        const lbl = new Date(d.month + '-02').toLocaleDateString('fr-FR', { month: 'short' })
                        return (
                          <div key={d.month} className="flex-1 flex flex-col items-center gap-1">
                            <p className="text-[10px] font-semibold text-[#1a1a2e]">${Math.round((d.normal_total||0))}</p>
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
              <p className="text-[10px] font-semibold uppercase tracking-[0.1em] text-[#6b6b63]">Total facturé / mois</p>
            </div>
            <div className="flex items-end gap-3 h-28">
              {chartData.map((d) => {
                const h   = Math.max(4, Math.round(((d.normal_total||0) / maxTotal) * 96))
                const lbl = new Date(d.month + '-02').toLocaleDateString('fr-FR', { month: 'short' })
                return (
                  <div key={d.month} className="flex-1 flex flex-col items-center gap-1">
                    <p className="text-[10px] font-semibold text-[#1a1a2e]">${Math.round((d.normal_total||0))}</p>
                    <div className="w-full rounded-t-lg bg-[#aeb0c9]/60" style={{ height: h }} />
                    <p className="text-[10px] text-[#9b9b93]">{lbl}</p>
                  </div>
                )
              })}
            </div>
          </div>
        )}

        </>
        )}

      </div>


    </div>
  )
}

// ─── Onglet Contestation (audit live poids/pays/coût juste) ───────────────────

interface ContestItem { order: string; zone: string; cc: string; type: 'shipping' | 'service'; items: number; kg: number; billed: number; fair: number; delta: number }
interface Segment { zone: string; size: string; n: number; ship: number; serv: number; total: number; client: number; loss: number; weight: number }
interface ContestData {
  month: string
  usdEur: number
  counts: { orders: number; noMatch: number; noWeight: number; weightCoverage: number }
  regression: { n: number; intercept: number; slope: number; r2: number; perKgMedian: number; perKgMin: number; perKgMax: number }
  serviceCorr: { r2Weight: number | null }
  segments: Segment[]
  contest: { strong: ContestItem[]; ch: ContestItem[]; strongTotal: number; chTotal: number }
  margin: { zone: string; n: number; clientMed: number; costMed: number; absorbed: number }[]
  frFree: number
  frTot: number
}

const ZONE_LABEL: Record<string, string> = { FR: 'France', UE: 'UE hors FR', CH: 'Suisse', DOM: 'DOM-TOM', X: 'Autre' }

function ContestationView({ rate, months, onPickMonth }: { rate: number; months: string[]; onPickMonth: (m: string) => void }) {
  const [data, setData]       = useState<ContestData | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError]     = useState('')
  const [loadedMonth, setLoadedMonth] = useState('')

  async function run(m: string) {
    if (!m) return
    setLoading(true); setError(''); setData(null)
    try {
      const d = await fetch(`/api/factures-logisticien/contestation?month=${m}&rate=${rate}`).then(r => r.json())
      if (d.error) { setError(d.error); return }
      setData(d); setLoadedMonth(m)
    } catch (e) { setError(String(e)) } finally { setLoading(false) }
  }

  const fmt = (n: number) => `$${n.toFixed(2)}`
  const sortedMonths = [...months].sort().reverse()

  function Table({ title, items, total, muted }: { title: string; items: ContestItem[]; total: number; muted?: boolean }) {
    return (
      <div className={`rounded-[16px] border p-4 ${muted ? 'bg-[#faf9f7] border-[#e8e4e0]' : 'bg-white border-[#f3d6d9] shadow-[0_2px_12px_rgba(0,0,0,0.05)]'}`}>
        <div className="flex items-center justify-between mb-3">
          <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[#6b6b63]">{title}</p>
          <p className={`text-sm font-bold ${muted ? 'text-[#9b7d1f]' : 'text-[#c7293a]'}`}>{fmt(total)}</p>
        </div>
        {items.length === 0 ? (
          <p className="text-xs text-[#9b9b93] py-2">Aucune commande dans cette catégorie ce mois-ci.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-[#9b9b93] text-left">
                  <th className="py-1.5 pr-2 font-medium">Commande</th>
                  <th className="py-1.5 px-2 font-medium">Zone</th>
                  <th className="py-1.5 px-2 font-medium">Type</th>
                  <th className="py-1.5 px-2 font-medium text-right">Art.</th>
                  <th className="py-1.5 px-2 font-medium text-right">Poids</th>
                  <th className="py-1.5 px-2 font-medium text-right">Facturé</th>
                  <th className="py-1.5 px-2 font-medium text-right">Juste</th>
                  <th className="py-1.5 pl-2 font-medium text-right">Δ récup.</th>
                </tr>
              </thead>
              <tbody>
                {items.map((c, i) => (
                  <tr key={c.order + c.type + i} className="border-t border-[#f0ede9]">
                    <td className="py-1.5 pr-2 font-semibold text-[#1a1a2e]">{c.order}</td>
                    <td className="py-1.5 px-2 text-[#6b6b63]">{ZONE_LABEL[c.zone] ?? c.zone}</td>
                    <td className="py-1.5 px-2">
                      <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${c.type === 'service' ? 'bg-[#fff3cd] text-[#b45309]' : 'bg-[#e8eefc] text-[#3457a8]'}`}>
                        {c.type === 'service' ? 'service' : 'shipping'}
                      </span>
                    </td>
                    <td className="py-1.5 px-2 text-right text-[#6b6b63]">{c.items}</td>
                    <td className="py-1.5 px-2 text-right text-[#6b6b63]">{c.kg > 0 ? `${c.kg.toFixed(1)}kg` : '—'}</td>
                    <td className="py-1.5 px-2 text-right font-medium text-[#1a1a2e]">{fmt(c.billed)}</td>
                    <td className="py-1.5 px-2 text-right text-[#9b9b93]">{fmt(c.fair)}</td>
                    <td className="py-1.5 pl-2 text-right font-bold text-[#c7293a]">+{c.delta.toFixed(2)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    )
  }

  return (
    <div className="space-y-5">
      {/* Sélecteur de mois + lancement */}
      <div className="bg-white rounded-[16px] shadow-[0_2px_12px_rgba(0,0,0,0.06)] p-5">
        <div className="flex items-center gap-2 mb-3">
          <Scale size={14} className="text-[#aeb0c9]" />
          <p className="text-[10px] font-semibold uppercase tracking-[0.1em] text-[#6b6b63]">Audit contestation — poids & coût juste (live Shopify)</p>
        </div>
        <p className="text-xs text-[#6b6b63] mb-3">
          Recalcule le coût « juste » de chaque commande à partir du <strong>poids réel</strong>, du <strong>pays</strong> et du <strong>nombre d&apos;articles</strong> (Shopify),
          puis liste ce qui est <strong>sur-facturé</strong> par rapport aux commandes similaires. Choisis un mois :
        </p>
        <div className="flex items-center gap-2 flex-wrap">
          {sortedMonths.map(m => (
            <button
              key={m}
              onClick={() => { onPickMonth(m); run(m) }}
              disabled={loading}
              className={`px-3 py-1.5 rounded-xl text-xs font-medium transition-colors ${
                loadedMonth === m ? 'bg-[#1a1a2e] text-white' : 'bg-white border border-[#e8e4e0] text-[#6b6b63] hover:border-[#aeb0c9]'
              }`}
            >
              {new Date(m + '-02').toLocaleDateString('fr-FR', { month: 'short', year: '2-digit' })}
            </button>
          ))}
        </div>
      </div>

      {loading && (
        <div className="flex items-center justify-center gap-3 py-16 text-[#6b6b63] text-sm">
          <Loader2 size={18} className="animate-spin" /> Enrichissement Shopify (poids, pays, articles)…
        </div>
      )}
      {error && (
        <div className="flex items-center gap-2 px-4 py-3 bg-red-50 border border-red-100 rounded-xl text-sm text-red-700">
          <AlertTriangle size={15} /> {error}
        </div>
      )}

      {data && !loading && (
        <>
          {/* Verdict argument logisticien */}
          <div className="grid grid-cols-2 gap-4">
            <div className="bg-white rounded-[16px] shadow-[0_2px_12px_rgba(0,0,0,0.06)] p-5">
              <p className="text-[10px] font-semibold uppercase tracking-[0.1em] text-[#6b6b63] mb-2">« Shipping calculé au poids »</p>
              <p className="text-2xl font-bold text-[#1a1a2e]">R² = {data.regression.r2.toFixed(2)}</p>
              <p className="text-xs text-[#6b6b63] mt-1">
                shipping ≈ {fmt(data.regression.intercept)} + {fmt(data.regression.slope)}/kg · $/kg de {data.regression.perKgMin.toFixed(1)} à {data.regression.perKgMax.toFixed(1)}
              </p>
              <p className={`text-xs font-semibold mt-2 ${data.regression.r2 < 0.5 ? 'text-[#c7293a]' : 'text-[#2f9e44]'}`}>
                {data.regression.r2 < 0.5 ? `Le poids n'explique que ${Math.round(data.regression.r2 * 100)}% — pas un vrai barème au poids` : 'Corrélation forte au poids'}
              </p>
            </div>
            <div className="bg-white rounded-[16px] shadow-[0_2px_12px_rgba(0,0,0,0.06)] p-5">
              <p className="text-[10px] font-semibold uppercase tracking-[0.1em] text-[#6b6b63] mb-2">« Service fee tiré par le carton »</p>
              <p className="text-2xl font-bold text-[#1a1a2e]">R² = {data.serviceCorr.r2Weight != null ? data.serviceCorr.r2Weight.toFixed(2) : '—'}</p>
              <p className="text-xs text-[#6b6b63] mt-1">corrélation service fee ↔ poids du colis</p>
              <p className={`text-xs font-semibold mt-2 ${(data.serviceCorr.r2Weight ?? 0) < 0.3 ? 'text-[#c7293a]' : 'text-[#2f9e44]'}`}>
                {(data.serviceCorr.r2Weight ?? 0) < 0.3 ? 'Quasi aucun lien — argument carton non prouvé' : 'Lien mesurable'}
              </p>
            </div>
          </div>

          {/* Tables de contestation */}
          <Table title="À contester sans réserve (FR / UE / DOM — sans douane)" items={data.contest.strong} total={data.contest.strongTotal} />
          <Table title="Suisse — à faire justifier (douane légitime)" items={data.contest.ch} total={data.contest.chTotal} muted />

          {/* Coût réel par segment */}
          <div className="bg-white rounded-[16px] shadow-[0_2px_12px_rgba(0,0,0,0.06)] p-5">
            <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[#6b6b63] mb-3">Coût réel par destination × taille (médianes facturées)</p>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-[#9b9b93] text-left">
                    <th className="py-1.5 pr-2 font-medium">Destination</th>
                    <th className="py-1.5 px-2 font-medium">Taille</th>
                    <th className="py-1.5 px-2 font-medium text-right">n</th>
                    <th className="py-1.5 px-2 font-medium text-right">Shipping</th>
                    <th className="py-1.5 px-2 font-medium text-right">Service</th>
                    <th className="py-1.5 px-2 font-medium text-right">Coût total</th>
                    <th className="py-1.5 px-2 font-medium text-right">Port client</th>
                    <th className="py-1.5 pl-2 font-medium text-right">Absorbé Mōom</th>
                  </tr>
                </thead>
                <tbody>
                  {data.segments.map((s, i) => (
                    <tr key={i} className="border-t border-[#f0ede9]">
                      <td className="py-1.5 pr-2 text-[#1a1a2e]">{ZONE_LABEL[s.zone] ?? s.zone}</td>
                      <td className="py-1.5 px-2 text-[#6b6b63]">{s.size}</td>
                      <td className="py-1.5 px-2 text-right text-[#9b9b93]">{s.n}</td>
                      <td className="py-1.5 px-2 text-right text-[#6b6b63]">{fmt(s.ship)}</td>
                      <td className="py-1.5 px-2 text-right text-[#6b6b63]">{fmt(s.serv)}</td>
                      <td className="py-1.5 px-2 text-right font-semibold text-[#1a1a2e]">{fmt(s.total)}</td>
                      <td className="py-1.5 px-2 text-right text-[#6b6b63]">{fmt(s.client)}</td>
                      <td className={`py-1.5 pl-2 text-right font-semibold ${s.loss > 0 ? 'text-[#c7293a]' : 'text-[#2f9e44]'}`}>{fmt(s.loss)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="text-[11px] text-[#6b6b63] mt-3 flex items-start gap-1.5">
              <TrendingUp size={12} className="mt-0.5 shrink-0 text-[#aeb0c9]" />
              France : {data.frFree}/{data.frTot} commandes ({data.frTot ? Math.round(100 * data.frFree / data.frTot) : 0}%) en <strong>&nbsp;port offert</strong>&nbsp; alors qu&apos;elles coûtent 13–32 $ — trou de marge à corriger côté prix client (distinct de la sur-facturation).
            </p>
          </div>

          {/* Limites de données */}
          <div className="bg-[#fff8ed] border border-[#f5e6c8] rounded-[16px] p-4">
            <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[#9b7d1f] mb-2 flex items-center gap-1.5">
              <AlertTriangle size={13} /> Données manquantes à réclamer à Forrest
            </p>
            <ul className="text-xs text-[#6b6b63] space-y-1 list-disc pl-4">
              <li>Poids <strong>pesé</strong> réel par commande (ici : poids <em>produit</em> Shopify, dispo sur {Math.round(data.counts.weightCoverage * 100)}% des commandes).</li>
              <li><strong>Dimensions + poids volumétrique + coût carton</strong> — sans ça l&apos;argument « service = carton » est invérifiable.</li>
              <li>Grille tarifaire poids→prix par zone · décomposition du service fee · détail douane Suisse.</li>
              <li>Taux de change appliqué (ici supposé 1&nbsp;$&nbsp;=&nbsp;{data.usdEur.toFixed(3)}&nbsp;€, non confirmé par commande).</li>
            </ul>
          </div>

          <p className="text-[10px] text-[#c0bfba]">
            {data.counts.orders} commandes analysées · {data.counts.noMatch} sans correspondance Shopify · mois {loadedMonth}
          </p>
        </>
      )}

      {!data && !loading && !error && (
        <div className="text-center py-16 text-[#9b9b93] text-sm">Choisis un mois ci-dessus pour lancer l&apos;audit.</div>
      )}
    </div>
  )
}
