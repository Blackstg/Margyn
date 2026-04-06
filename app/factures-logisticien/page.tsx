'use client'

import { useState, useEffect, useRef } from 'react'
import { read, utils } from 'xlsx'
import { Upload, TrendingUp, Sparkles, AlertTriangle, RotateCcw, CheckCircle, GitFork } from 'lucide-react'

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
}

interface SplitShipment {
  order_name: string
  amount: number
}

interface MonthlySummary {
  month: string
  fw_count: number
  fw_total: number
  normal_total: number
  double_billing_count: number
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
  const anomalies: Anomaly[]           = []
  const splitShipments: SplitShipment[] = []
  const normal = rows.filter(r => !r.isFW)
  const fw     = rows.filter(r => r.isFW)

  // 1. Double billing vs split shipment: FW row shares order_name with a normal row
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

export default function FacturesLogisticienPage() {
  const fileRef   = useRef<HTMLInputElement>(null)
  const [month, setMonth]         = useState('')
  const [fileName, setFileName]   = useState('')
  const [loading, setLoading]     = useState(false)
  const [lookingUp, setLookingUp] = useState(false)
  const [rows, setRows]           = useState<InvoiceRow[]>([])
  const [anomalies, setAnomalies] = useState<Anomaly[]>([])
  const [splitShipments, setSplitShipments] = useState<SplitShipment[]>([])
  const [history, setHistory]     = useState<MonthlySummary[]>([])
  const [aiText, setAiText]       = useState('')
  const [aiLoading, setAiLoading] = useState(false)

  useEffect(() => {
    fetch('/api/factures-logisticien/history')
      .then(r => r.json())
      .then(d => setHistory(d.summaries ?? []))
      .catch(() => {})
  }, [])

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setFileName(file.name)
    setLoading(true)
    setAiText('')

    const buf  = await file.arrayBuffer()
    const wb   = read(buf)
    const ws   = wb.Sheets[wb.SheetNames[0]]
    const raw: Record<string, unknown>[] = utils.sheet_to_json(ws, { defval: '' })

    const parsed: InvoiceRow[] = raw.map(r => ({
      order_name:    String(r['order_name'] ?? '').trim(),
      date:          excelDate(r['date']),
      service_price: toNum(r['service_price']),
      shipping_price:toNum(r['shipping_price']),
      total_price:   toNum(r['total_price']),
      isFW:          isFW(r),
      sku:           String(r['sku'] ?? r['SKU'] ?? r['product_sku'] ?? r['variant_sku'] ?? '').trim(),
    })).filter(r => r.order_name !== '')

    setLoading(false)

    // Identify FW+normal pairs (double billing candidates)
    const normalNames = new Set(parsed.filter(r => !r.isFW).map(r => r.order_name))
    const candidates  = parsed.filter(r => r.isFW && normalNames.has(r.order_name)).map(r => r.order_name)

    // Lookup each candidate order in Shopify to get warehouse info
    let orderWarehouse: Record<string, string | null> = {}
    if (candidates.length > 0) {
      setLookingUp(true)
      try {
        const res  = await fetch('/api/shopify/order-warehouse', {
          method:  'POST',
          headers: { 'Content-Type': 'application/json' },
          body:    JSON.stringify({ order_names: candidates }),
        })
        const data = await res.json()
        orderWarehouse = data.results ?? {}
      } catch { /* fallback: treat all as double billing */ }
      setLookingUp(false)
    }

    const { anomalies: detected, splitShipments: splits } = detectAnomalies(parsed, orderWarehouse)
    setRows(parsed)
    setAnomalies(detected)
    setSplitShipments(splits)

    // Auto-save summary to history
    if (month) {
      const normal = parsed.filter(r => !r.isFW)
      const fw     = parsed.filter(r => r.isFW)
      const doubles = detected.filter(a => a.type === 'double_billing').length
      await fetch('/api/factures-logisticien/history', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          month,
          normal_count:         normal.length,
          fw_count:             fw.length,
          normal_total:         normal.reduce((s, r) => s + r.total_price, 0),
          fw_total:             fw.reduce((s, r) => s + r.total_price, 0),
          double_billing_count: doubles,
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

    const normal    = rows.filter(r => !r.isFW)
    const fw        = rows.filter(r => r.isFW)
    const total     = rows.reduce((s, r) => s + r.total_price, 0)
    const atRisk    = anomalies.reduce((s, a) => s + a.amount, 0)

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

  const chartData  = [...history].sort((a, b) => a.month.localeCompare(b.month)).slice(-6)
  const maxFW      = Math.max(...chartData.map(d => d.fw_count), 1)

  return (
    <div className="min-h-screen bg-[#f8f7f5] pl-[72px]">
      <div className="max-w-6xl mx-auto px-6 py-8 space-y-6">

        {/* Header */}
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-[0.1em] text-[#aeb0c9] mb-1">Mōom</p>
          <h1 className="text-xl font-bold text-[#1a1a2e]">Logistician Invoice Analysis</h1>
        </div>

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
              onChange={e => { setMonth(e.target.value); setRows([]); setAnomalies([]); setSplitShipments([]); setFileName(''); setAiText('') }}
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
            <input ref={fileRef} type="file" accept=".xlsx,.xls" className="hidden" onChange={handleFile} disabled={!month} />
          </div>
        </div>

        {loading    && <p className="text-sm text-[#9b9b93] text-center">Parsing file…</p>}
        {lookingUp  && <p className="text-sm text-[#9b9b93] text-center">Vérification auprès de Shopify…</p>}

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
                    {anomalies.map((a, i) => (
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
                        </div>
                        <p className="text-sm font-semibold text-[#c7293a] tabular-nums shrink-0">${a.amount.toFixed(2)}</p>
                      </div>
                    ))}
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
    </div>
  )
}
