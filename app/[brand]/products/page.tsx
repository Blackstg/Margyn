'use client'

import { useState, useEffect, useRef } from 'react'
import { Upload, Check, Package } from 'lucide-react'

interface Variant {
  shopify_variant_id: string
  product_title: string
  variant_title: string | null
  image_url: string | null
  sku_fr: string | null
  sku_cn: string | null
  warehouse: string | null
  product_status: string
}

interface EditState {
  sku_fr: string
  sku_cn: string
  warehouse: string
}

function parseCSV(text: string): string[][] {
  const rows: string[][] = []
  for (const line of text.split('\n')) {
    if (!line.trim()) continue
    const cols: string[] = []
    let cur = ''
    let inQuote = false
    for (let i = 0; i < line.length; i++) {
      if (line[i] === '"') { inQuote = !inQuote; continue }
      if (line[i] === ',' && !inQuote) { cols.push(cur.trim()); cur = ''; continue }
      cur += line[i]
    }
    cols.push(cur.trim())
    rows.push(cols)
  }
  return rows
}

const WAREHOUSE_STYLE: Record<string, string> = {
  'France':   'bg-[#eef0fb] text-[#4a4e8a] border-transparent',
  'Chine':    'bg-[#fff3cd] text-[#b45309] border-transparent',
  'Les deux': 'bg-[#e6f4ec] text-[#1a7f4b] border-transparent',
}

export default function ProduitsPage() {
  const fileRef = useRef<HTMLInputElement>(null)
  const [variants, setVariants]     = useState<Variant[]>([])
  const [loading, setLoading]       = useState(true)
  const [edits, setEdits]           = useState<Record<string, EditState>>({})
  const [saved, setSaved]           = useState<Record<string, boolean>>({})
  const [importing, setImporting]   = useState(false)
  const [importResult, setImportResult] = useState<{ matched: number; unmatched: string[] } | null>(null)
  const [search, setSearch]         = useState('')

  async function loadVariants() {
    const d = await fetch('/api/produits').then(r => r.json())
    const list: Variant[] = d.variants ?? []
    setVariants(list)
    const initEdits: Record<string, EditState> = {}
    for (const v of list) {
      initEdits[v.shopify_variant_id] = {
        sku_fr:    v.sku_fr    ?? '',
        sku_cn:    v.sku_cn    ?? '',
        warehouse: v.warehouse ?? '',
      }
    }
    setEdits(initEdits)
    setLoading(false)
  }

  useEffect(() => { loadVariants() }, [])

  async function saveVariant(id: string, override?: Partial<EditState>) {
    const base = edits[id] ?? { sku_fr: '', sku_cn: '', warehouse: '' }
    const e = { ...base, ...override }
    await fetch('/api/produits', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        shopify_variant_id: id,
        sku_fr:    e.sku_fr    || null,
        sku_cn:    e.sku_cn    || null,
        warehouse: e.warehouse || null,
      }),
    })
    setSaved(s => ({ ...s, [id]: true }))
    setTimeout(() => setSaved(s => ({ ...s, [id]: false })), 2000)
  }

  function setField(id: string, field: keyof EditState, value: string) {
    setEdits(prev => ({ ...prev, [id]: { ...prev[id], [field]: value } }))
  }

  async function handleCSV(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setImporting(true)
    setImportResult(null)

    const text = await file.text()
    const csvRows = parseCSV(text)

    const SKIP = ['stock moom', 'produits', 'old product']
    const importRows = csvRows
      .map(row => ({ row, name: (row[0] ?? '').trim() }))
      .filter(({ name }) => {
        if (!name) return false
        const nl = name.toLowerCase()
        return !SKIP.some(s => nl.startsWith(s))
      })
      .map(({ row, name }) => {
        const skuFr = row[1]?.trim() ?? ''
        const skuCn = row[4]?.trim() ?? ''
        const warehouse = skuFr && skuCn ? 'Les deux' : skuFr ? 'France' : skuCn ? 'Chine' : ''
        return { name, sku_fr: skuFr, sku_cn: skuCn, warehouse }
      })
      .filter(r => r.name)

    const res  = await fetch('/api/produits/import', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ rows: importRows }),
    })
    const data = await res.json()
    setImportResult(data)
    setImporting(false)
    await loadVariants()

    if (fileRef.current) fileRef.current.value = ''
  }

  const filtered = variants.filter(v => {
    if (!search) return true
    const q = search.toLowerCase()
    const e = edits[v.shopify_variant_id]
    return (
      v.product_title.toLowerCase().includes(q) ||
      (v.variant_title ?? '').toLowerCase().includes(q) ||
      (e?.sku_fr ?? '').toLowerCase().includes(q) ||
      (e?.sku_cn ?? '').toLowerCase().includes(q)
    )
  })

  return (
    <div className="min-h-screen bg-[#f8f7f5] pl-[72px]">
      <div className="max-w-5xl mx-auto px-6 py-8 space-y-6">

        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-[0.1em] text-[#aeb0c9] mb-1">Mōom</p>
            <h1 className="text-xl font-bold text-[#1a1a2e]">Produits</h1>
          </div>
          <button
            onClick={() => fileRef.current?.click()}
            disabled={importing}
            className="flex items-center gap-2 px-4 py-2 rounded-xl bg-[#1a1a2e] text-white text-xs font-semibold hover:bg-[#2a2a3e] transition-colors disabled:opacity-40"
          >
            <Upload size={13} />
            {importing ? 'Import en cours…' : 'Importer CSV'}
          </button>
          <input ref={fileRef} type="file" accept=".csv" className="hidden" onChange={handleCSV} />
        </div>

        {/* Import result */}
        {importResult && (
          <div className="bg-white rounded-[14px] shadow-[0_2px_10px_rgba(0,0,0,0.05)] p-4 flex items-start gap-3">
            <Check size={16} className="text-[#1a7f4b] mt-0.5 shrink-0" />
            <div>
              <p className="text-sm font-medium text-[#1a1a2e]">{importResult.matched} produit{importResult.matched > 1 ? 's' : ''} importés</p>
              {importResult.unmatched.length > 0 && (
                <p className="text-xs text-[#9b9b93] mt-1">
                  Non reconnus ({importResult.unmatched.length}) : {importResult.unmatched.join(' · ')}
                </p>
              )}
            </div>
          </div>
        )}

        {/* Search */}
        <input
          type="text"
          placeholder="Rechercher un produit ou SKU…"
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="w-full rounded-xl border border-[#e8e4e0] bg-white px-4 py-2.5 text-sm text-[#1a1a2e] focus:outline-none focus:ring-2 focus:ring-[#aeb0c9]/40 shadow-[0_1px_4px_rgba(0,0,0,0.04)]"
        />

        {/* Table */}
        <div className="bg-white rounded-[16px] shadow-[0_2px_12px_rgba(0,0,0,0.06)] overflow-hidden">

          {/* Column headers */}
          <div
            className="grid gap-3 px-5 py-3 border-b border-[#f0f0ee] bg-[#fafaf9]"
            style={{ gridTemplateColumns: '36px 1fr 180px 180px 130px 24px' }}
          >
            <div />
            <p className="text-[10px] font-semibold uppercase tracking-[0.1em] text-[#6b6b63]">Produit</p>
            <p className="text-[10px] font-semibold uppercase tracking-[0.1em] text-[#6b6b63]">SKU France</p>
            <p className="text-[10px] font-semibold uppercase tracking-[0.1em] text-[#6b6b63]">SKU Chine</p>
            <p className="text-[10px] font-semibold uppercase tracking-[0.1em] text-[#6b6b63]">Entrepôt</p>
            <div />
          </div>

          {loading ? (
            <div className="p-6 space-y-3">
              {Array.from({ length: 8 }).map((_, i) => (
                <div key={i} className="h-10 bg-[#f5f5f3] rounded-xl animate-pulse" />
              ))}
            </div>
          ) : (
            <div className="divide-y divide-[#f8f8f7]">
              {filtered.map(v => {
                const e       = edits[v.shopify_variant_id] ?? { sku_fr: '', sku_cn: '', warehouse: '' }
                const isSaved = saved[v.shopify_variant_id]
                return (
                  <div
                    key={v.shopify_variant_id}
                    className={`grid gap-3 items-center px-5 py-2 ${v.product_status !== 'active' ? 'opacity-40' : ''}`}
                    style={{ gridTemplateColumns: '36px 1fr 180px 180px 130px 24px' }}
                  >
                    {/* Image */}
                    {v.image_url ? (
                      <img src={v.image_url} alt="" className="w-9 h-9 rounded-lg object-cover bg-[#f5f5f3] shrink-0" />
                    ) : (
                      <div className="w-9 h-9 rounded-lg bg-[#f5f5f3] shrink-0 flex items-center justify-center">
                        <Package size={14} className="text-[#c0c0b8]" />
                      </div>
                    )}

                    {/* Product name */}
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-[#1a1a2e] truncate">{v.product_title}</p>
                      {v.variant_title && v.variant_title !== 'Default Title' && (
                        <p className="text-xs text-[#9b9b93] truncate">{v.variant_title}</p>
                      )}
                    </div>

                    {/* SKU France */}
                    <input
                      type="text"
                      value={e.sku_fr}
                      onChange={ev => setField(v.shopify_variant_id, 'sku_fr', ev.target.value)}
                      onBlur={() => saveVariant(v.shopify_variant_id)}
                      placeholder="—"
                      className="w-full rounded-lg border border-[#e8e4e0] px-2.5 py-1.5 text-xs text-[#1a1a2e] font-mono focus:outline-none focus:ring-2 focus:ring-[#aeb0c9]/40 placeholder:text-[#c0c0b8]"
                    />

                    {/* SKU Chine */}
                    <input
                      type="text"
                      value={e.sku_cn}
                      onChange={ev => setField(v.shopify_variant_id, 'sku_cn', ev.target.value)}
                      onBlur={() => saveVariant(v.shopify_variant_id)}
                      placeholder="—"
                      className="w-full rounded-lg border border-[#e8e4e0] px-2.5 py-1.5 text-xs text-[#1a1a2e] font-mono focus:outline-none focus:ring-2 focus:ring-[#aeb0c9]/40 placeholder:text-[#c0c0b8]"
                    />

                    {/* Warehouse */}
                    <select
                      value={e.warehouse}
                      onChange={ev => {
                        const val = ev.target.value
                        setField(v.shopify_variant_id, 'warehouse', val)
                        saveVariant(v.shopify_variant_id, { warehouse: val })
                      }}
                      className={`w-full rounded-lg border px-2.5 py-1.5 text-xs font-semibold focus:outline-none focus:ring-2 focus:ring-[#aeb0c9]/40 ${
                        e.warehouse ? WAREHOUSE_STYLE[e.warehouse] : 'border-[#e8e4e0] text-[#9b9b93]'
                      }`}
                    >
                      <option value="">—</option>
                      <option value="France">France</option>
                      <option value="Chine">Chine</option>
                      <option value="Les deux">Les deux</option>
                    </select>

                    {/* Save indicator */}
                    <div className="flex items-center justify-center">
                      {isSaved && <Check size={13} className="text-[#1a7f4b]" />}
                    </div>
                  </div>
                )
              })}

              {filtered.length === 0 && (
                <div className="px-5 py-10 text-center text-sm text-[#9b9b93]">
                  Aucun résultat pour &ldquo;{search}&rdquo;
                </div>
              )}
            </div>
          )}
        </div>

        {!loading && (
          <p className="text-xs text-[#9b9b93] text-right">{filtered.length} variant{filtered.length !== 1 ? 's' : ''}</p>
        )}

      </div>
    </div>
  )
}
