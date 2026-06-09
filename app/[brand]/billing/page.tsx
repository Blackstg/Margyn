'use client'

export const dynamic = 'force-dynamic'

import { useState, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { Search, FileText, Loader2, ChevronRight, AlertCircle } from 'lucide-react'
import { useBrand } from '@/context/BrandContext'

interface ShopifyOrder {
  id:               number
  name:             string
  created_at:       string
  total_price:      string
  currency:         string
  financial_status: string
  customer: {
    first_name?: string
    last_name?:  string
    email?:      string
  } | null
  billing_address: {
    name?:    string
    company?: string
    city?:    string
    country?: string
  } | null
}

const STATUS_LABELS: Record<string, { label: string; cls: string }> = {
  paid:             { label: 'Payée',      cls: 'bg-emerald-50 text-emerald-700' },
  partially_paid:   { label: 'Part. payée', cls: 'bg-yellow-50 text-yellow-700' },
  pending:          { label: 'En attente', cls: 'bg-orange-50 text-orange-700' },
  refunded:         { label: 'Remboursée', cls: 'bg-gray-50 text-gray-500' },
  partially_refunded: { label: 'Part. remb.', cls: 'bg-gray-50 text-gray-500' },
  voided:           { label: 'Annulée',    cls: 'bg-red-50 text-red-500' },
}

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' })
}

function fmtPrice(amount: string, currency: string) {
  return new Intl.NumberFormat('fr-FR', { style: 'currency', currency }).format(parseFloat(amount))
}

function customerName(order: ShopifyOrder) {
  if (order.billing_address?.name) return order.billing_address.name
  if (order.customer) return [order.customer.first_name, order.customer.last_name].filter(Boolean).join(' ')
  return '—'
}

export default function BillingPage() {
  const brand  = useBrand()
  const router = useRouter()

  const [orders, setOrders]   = useState<ShopifyOrder[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState<string | null>(null)
  const [search, setSearch]   = useState('')
  const [searching, setSearching] = useState(false)

  const load = useCallback(async (q = '') => {
    if (q) { setSearching(true) } else { setLoading(true) }
    setError(null)
    try {
      const url = q
        ? `/api/billing/orders?brand=${brand}&search=${encodeURIComponent(q)}`
        : `/api/billing/orders?brand=${brand}&limit=50`
      const res  = await fetch(url)
      const data = await res.json()
      if (data.error) { setError(data.error); return }
      setOrders(data.orders ?? [])
    } catch (e) {
      setError(String(e))
    } finally {
      setLoading(false)
      setSearching(false)
    }
  }, [brand])

  useEffect(() => { load() }, [load])

  function handleSearch(e: React.FormEvent) {
    e.preventDefault()
    load(search)
  }

  return (
    <div className="min-h-screen bg-[#faf9f8]">
      <main className="max-w-5xl mx-auto px-6 py-8">

        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-xl font-bold text-[#1a1a18] tracking-tight">Facturation</h1>
            <p className="text-sm text-[#6b6b63] mt-0.5">Générez une facture PDF pour chaque commande Shopify</p>
          </div>
          <button
            onClick={() => router.push(`/${brand}/settings`)}
            className="flex items-center gap-2 px-4 py-2 rounded-xl bg-white border border-[#e8e8e4] text-sm font-medium text-[#1a1a2e] hover:bg-[#f5f5f3] transition-colors shadow-sm"
          >
            <FileText size={15} strokeWidth={1.8} />
            Configurer
          </button>
        </div>

        {/* Search */}
        <form onSubmit={handleSearch} className="mb-5">
          <div className="relative">
            <Search size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-[#9b9b93]" strokeWidth={2} />
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Rechercher par numéro de commande (ex: #10174)…"
              className="w-full pl-10 pr-4 py-2.5 rounded-xl border border-[#e8e8e4] bg-white text-sm text-[#1a1a2e] placeholder-[#9b9b93] focus:outline-none focus:ring-2 focus:ring-[#1a1a2e]/20 shadow-sm"
            />
            {searching && (
              <Loader2 size={15} className="absolute right-3.5 top-1/2 -translate-y-1/2 text-[#9b9b93] animate-spin" />
            )}
          </div>
        </form>

        {/* Error */}
        {error && (
          <div className="flex items-center gap-2.5 px-4 py-3 bg-red-50 border border-red-100 rounded-xl text-sm text-red-700 mb-5">
            <AlertCircle size={15} className="shrink-0" />
            {error === 'invoice_settings' ? (
              <span>Table <code>invoice_settings</code> manquante — <a href="#setup" className="underline font-medium">voir les instructions</a></span>
            ) : error}
          </div>
        )}

        {/* Table */}
        {loading ? (
          <div className="space-y-2">
            {Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="h-14 bg-white rounded-xl animate-pulse border border-[#f0f0ee]" />
            ))}
          </div>
        ) : orders.length === 0 ? (
          <div className="text-center py-20 text-[#9b9b93] text-sm">
            Aucune commande trouvée
          </div>
        ) : (
          <div className="bg-white rounded-[20px] shadow-[0_2px_16px_rgba(0,0,0,0.06)] overflow-hidden border border-[#f0f0ee]">
            {/* Header row */}
            <div className="grid grid-cols-[140px_1fr_1fr_120px_100px_44px] gap-3 px-5 py-3 border-b border-[#f0f0ee] bg-[#fafaf8]">
              {['N° commande', 'Client', 'Ville', 'Date', 'Total', ''].map((h) => (
                <span key={h} className="text-[10px] font-semibold uppercase tracking-wider text-[#9b9b93]">{h}</span>
              ))}
            </div>

            {orders.map((order) => {
              const st = STATUS_LABELS[order.financial_status] ?? { label: order.financial_status, cls: 'bg-gray-50 text-gray-500' }
              return (
                <button
                  key={order.id}
                  onClick={() => router.push(`/${brand}/billing/${order.id}`)}
                  className="w-full grid grid-cols-[140px_1fr_1fr_120px_100px_44px] gap-3 px-5 py-3.5 border-b border-[#f5f5f3] last:border-0 hover:bg-[#faf9f8] transition-colors text-left items-center"
                >
                  <span className="text-sm font-bold text-[#1a1a2e]">{order.name}</span>
                  <span className="text-sm text-[#1a1a2e] truncate">{customerName(order)}</span>
                  <span className="text-sm text-[#6b6b63] truncate">
                    {order.billing_address?.city ?? '—'}
                    {order.billing_address?.country && order.billing_address.country !== 'France'
                      ? ` · ${order.billing_address.country}` : ''}
                  </span>
                  <span className="text-sm text-[#6b6b63]">{fmtDate(order.created_at)}</span>
                  <div className="flex flex-col items-start gap-1">
                    <span className="text-sm font-semibold text-[#1a1a2e]">
                      {fmtPrice(order.total_price, order.currency)}
                    </span>
                    <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${st.cls}`}>
                      {st.label}
                    </span>
                  </div>
                  <span className="flex justify-center">
                    <ChevronRight size={16} className="text-[#c8c8c0]" />
                  </span>
                </button>
              )
            })}
          </div>
        )}

        {/* Setup instructions */}
        {error?.includes('invoice_settings') || (!loading && !error) ? null : (
          <div id="setup" className="mt-8 p-5 bg-[#f5f5f3] rounded-[16px] text-sm text-[#6b6b63] space-y-2">
            <p className="font-semibold text-[#1a1a2e]">Setup : créer la table invoice_settings</p>
            <p>Coller ce SQL dans le <strong>SQL Editor</strong> de votre dashboard Supabase :</p>
            <pre className="bg-white p-3 rounded-lg text-xs overflow-x-auto border border-[#e8e8e4] text-[#1a1a2e]">{SQL_MIGRATION}</pre>
          </div>
        )}
      </main>
    </div>
  )
}

const SQL_MIGRATION = `CREATE TABLE IF NOT EXISTS invoice_settings (
  brand            text PRIMARY KEY,
  company_name     text    DEFAULT '',
  address_line1    text    DEFAULT '',
  address_line2    text    DEFAULT '',
  city             text    DEFAULT '',
  zip              text    DEFAULT '',
  country          text    DEFAULT 'France',
  vat_number       text    DEFAULT '',
  siret            text    DEFAULT '',
  email            text    DEFAULT '',
  phone            text    DEFAULT '',
  logo_url         text    DEFAULT '',
  tva_rate         numeric DEFAULT 20,
  tva_enabled      boolean DEFAULT true,
  payment_terms    text    DEFAULT '30 jours nets',
  footer_notes     text    DEFAULT '',
  color_primary    text    DEFAULT '#1a1a2e',
  bank_iban        text    DEFAULT '',
  bank_bic         text    DEFAULT '',
  updated_at       timestamptz DEFAULT now()
);`
