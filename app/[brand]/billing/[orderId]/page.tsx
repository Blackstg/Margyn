'use client'

export const dynamic = 'force-dynamic'

import { useState, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { ArrowLeft, Download, Loader2, AlertCircle } from 'lucide-react'
import { useBrand } from '@/context/BrandContext'

// ─── Types ────────────────────────────────────────────────────────────────────

interface LineItem {
  id:         number
  title:      string
  variant_title?: string | null
  quantity:   number
  price:      string
  total_discount: string
}

interface ShopifyOrder {
  id:               number
  name:             string
  created_at:       string
  total_price:      string
  subtotal_price:   string
  total_tax:        string
  total_discounts:  string
  currency:         string
  financial_status: string
  customer: {
    first_name?: string
    last_name?:  string
    email?:      string
  } | null
  billing_address: {
    name?:     string
    company?:  string
    address1?: string
    address2?: string
    city?:     string
    zip?:      string
    province?: string
    country?:  string
    phone?:    string
  } | null
  line_items: LineItem[]
}

interface InvoiceSettings {
  company_name:  string
  address_line1: string
  address_line2: string
  city:          string
  zip:           string
  country:       string
  vat_number:    string
  siret:         string
  email:         string
  phone:         string
  logo_url:      string
  tva_rate:      number
  tva_enabled:   boolean
  payment_terms: string
  footer_notes:  string
  color_primary: string
  bank_iban:     string
  bank_bic:      string
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' })
}

function fmtPrice(amount: string | number, currency: string) {
  return new Intl.NumberFormat('fr-FR', { style: 'currency', currency }).format(
    typeof amount === 'string' ? parseFloat(amount) : amount
  )
}

function fmtPriceEur(amount: string | number) {
  return new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' }).format(
    typeof amount === 'string' ? parseFloat(amount) : amount
  )
}

// ─── Invoice Component ────────────────────────────────────────────────────────

function Invoice({ order, settings }: { order: ShopifyOrder; settings: InvoiceSettings | null }) {
  const primary = settings?.color_primary || '#1a1a2e'
  const tvaEnabled = settings?.tva_enabled ?? true
  const tvaRate    = settings?.tva_rate ?? 20

  const totalPrice  = parseFloat(order.total_price)
  const discounts   = parseFloat(order.total_discounts || '0')

  // If tva_enabled is false, show the total as HT
  const htAmount    = tvaEnabled ? (totalPrice / (1 + tvaRate / 100)) : totalPrice
  const tvaAmount   = tvaEnabled ? totalPrice - htAmount : 0

  const billingAddr = order.billing_address

  return (
    <div
      id="invoice-content"
      className="bg-white mx-auto"
      style={{ width: '210mm', minHeight: '297mm', fontFamily: 'system-ui, -apple-system, sans-serif', color: '#1a1a2e' }}
    >
      {/* Header band */}
      <div style={{ backgroundColor: primary, padding: '28px 36px 24px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          {/* Logo / Company */}
          <div>
            {settings?.logo_url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={settings.logo_url} alt="Logo" style={{ height: 48, objectFit: 'contain', filter: 'brightness(0) invert(1)' }} />
            ) : (
              <p style={{ color: 'white', fontSize: 24, fontWeight: 800, margin: 0, letterSpacing: '-0.5px' }}>
                {settings?.company_name || 'Votre société'}
              </p>
            )}
          </div>
          {/* Invoice label */}
          <div style={{ textAlign: 'right' }}>
            <p style={{ color: 'rgba(255,255,255,0.7)', fontSize: 12, margin: '0 0 4px', textTransform: 'uppercase', letterSpacing: '1px' }}>
              Facture
            </p>
            <p style={{ color: 'white', fontSize: 22, fontWeight: 800, margin: 0 }}>{order.name}</p>
            <p style={{ color: 'rgba(255,255,255,0.75)', fontSize: 13, margin: '4px 0 0' }}>
              {fmtDate(order.created_at)}
            </p>
          </div>
        </div>
      </div>

      {/* Addresses row */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 24, padding: '28px 36px' }}>
        {/* Issuer */}
        <div>
          <p style={{ fontSize: 10, fontWeight: 700, color: '#9b9b93', textTransform: 'uppercase', letterSpacing: '1px', margin: '0 0 8px' }}>
            Émetteur
          </p>
          {settings?.logo_url && (
            <p style={{ fontSize: 14, fontWeight: 700, margin: '0 0 4px' }}>{settings.company_name}</p>
          )}
          {settings?.address_line1 && (
            <p style={{ fontSize: 12, color: '#6b6b63', margin: '0 0 2px' }}>{settings.address_line1}</p>
          )}
          {settings?.address_line2 && (
            <p style={{ fontSize: 12, color: '#6b6b63', margin: '0 0 2px' }}>{settings.address_line2}</p>
          )}
          {(settings?.zip || settings?.city) && (
            <p style={{ fontSize: 12, color: '#6b6b63', margin: '0 0 2px' }}>
              {[settings?.zip, settings?.city].filter(Boolean).join(' ')}
            </p>
          )}
          {settings?.country && settings.country !== 'France' && (
            <p style={{ fontSize: 12, color: '#6b6b63', margin: '0 0 2px' }}>{settings.country}</p>
          )}
          {settings?.siret && (
            <p style={{ fontSize: 11, color: '#9b9b93', margin: '6px 0 2px' }}>SIRET : {settings.siret}</p>
          )}
          {settings?.vat_number && (
            <p style={{ fontSize: 11, color: '#9b9b93', margin: '0 0 2px' }}>TVA : {settings.vat_number}</p>
          )}
          {settings?.email && (
            <p style={{ fontSize: 11, color: '#9b9b93', margin: '0 0 2px' }}>{settings.email}</p>
          )}
          {settings?.phone && (
            <p style={{ fontSize: 11, color: '#9b9b93', margin: 0 }}>{settings.phone}</p>
          )}
        </div>

        {/* Client */}
        <div>
          <p style={{ fontSize: 10, fontWeight: 700, color: '#9b9b93', textTransform: 'uppercase', letterSpacing: '1px', margin: '0 0 8px' }}>
            Client
          </p>
          {billingAddr?.company && (
            <p style={{ fontSize: 14, fontWeight: 700, margin: '0 0 4px' }}>{billingAddr.company}</p>
          )}
          {billingAddr?.name && (
            <p style={{ fontSize: 13, margin: '0 0 4px', fontWeight: billingAddr.company ? 400 : 600 }}>{billingAddr.name}</p>
          )}
          {!billingAddr?.name && order.customer && (
            <p style={{ fontSize: 13, fontWeight: 600, margin: '0 0 4px' }}>
              {[order.customer.first_name, order.customer.last_name].filter(Boolean).join(' ') || '—'}
            </p>
          )}
          {billingAddr?.address1 && (
            <p style={{ fontSize: 12, color: '#6b6b63', margin: '0 0 2px' }}>{billingAddr.address1}</p>
          )}
          {billingAddr?.address2 && (
            <p style={{ fontSize: 12, color: '#6b6b63', margin: '0 0 2px' }}>{billingAddr.address2}</p>
          )}
          {(billingAddr?.zip || billingAddr?.city) && (
            <p style={{ fontSize: 12, color: '#6b6b63', margin: '0 0 2px' }}>
              {[billingAddr?.zip, billingAddr?.city].filter(Boolean).join(' ')}
            </p>
          )}
          {billingAddr?.country && billingAddr.country !== 'France' && (
            <p style={{ fontSize: 12, color: '#6b6b63', margin: '0 0 2px' }}>{billingAddr.country}</p>
          )}
          {order.customer?.email && (
            <p style={{ fontSize: 11, color: '#9b9b93', margin: '6px 0 0' }}>{order.customer.email}</p>
          )}
          {billingAddr?.phone && (
            <p style={{ fontSize: 11, color: '#9b9b93', margin: '2px 0 0' }}>{billingAddr.phone}</p>
          )}
        </div>
      </div>

      {/* Line items table */}
      <div style={{ padding: '0 36px', marginBottom: 24 }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ backgroundColor: '#f5f5f3' }}>
              <th style={{ padding: '10px 12px', textAlign: 'left', fontSize: 10, fontWeight: 700, color: '#9b9b93', textTransform: 'uppercase', letterSpacing: '0.8px', borderRadius: '6px 0 0 6px' }}>
                Désignation
              </th>
              <th style={{ padding: '10px 12px', textAlign: 'center', fontSize: 10, fontWeight: 700, color: '#9b9b93', textTransform: 'uppercase', letterSpacing: '0.8px' }}>
                Qté
              </th>
              <th style={{ padding: '10px 12px', textAlign: 'right', fontSize: 10, fontWeight: 700, color: '#9b9b93', textTransform: 'uppercase', letterSpacing: '0.8px' }}>
                Prix unit.
              </th>
              <th style={{ padding: '10px 12px', textAlign: 'right', fontSize: 10, fontWeight: 700, color: '#9b9b93', textTransform: 'uppercase', letterSpacing: '0.8px', borderRadius: '0 6px 6px 0' }}>
                Total
              </th>
            </tr>
          </thead>
          <tbody>
            {order.line_items.map((item) => {
              const lineTotal = parseFloat(item.price) * item.quantity - parseFloat(item.total_discount || '0')
              return (
                <tr key={item.id} style={{ borderBottom: '1px solid #f0f0ee' }}>
                  <td style={{ padding: '12px', fontSize: 13 }}>
                    <span style={{ fontWeight: 500 }}>{item.title}</span>
                    {item.variant_title && item.variant_title !== 'Default Title' && (
                      <span style={{ fontSize: 11, color: '#9b9b93', display: 'block', marginTop: 2 }}>{item.variant_title}</span>
                    )}
                  </td>
                  <td style={{ padding: '12px', textAlign: 'center', fontSize: 13, color: '#6b6b63' }}>
                    {item.quantity}
                  </td>
                  <td style={{ padding: '12px', textAlign: 'right', fontSize: 13, color: '#6b6b63' }}>
                    {fmtPrice(item.price, order.currency)}
                  </td>
                  <td style={{ padding: '12px', textAlign: 'right', fontSize: 13, fontWeight: 500 }}>
                    {fmtPrice(lineTotal, order.currency)}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {/* Totals */}
      <div style={{ padding: '0 36px', marginBottom: 32 }}>
        <div style={{ marginLeft: 'auto', width: 260 }}>
          {discounts > 0 && (
            <div style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', borderBottom: '1px solid #f0f0ee', fontSize: 13 }}>
              <span style={{ color: '#6b6b63' }}>Remise</span>
              <span style={{ color: '#16a34a' }}>− {fmtPrice(discounts, order.currency)}</span>
            </div>
          )}
          {tvaEnabled ? (
            <>
              <div style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', borderBottom: '1px solid #f0f0ee', fontSize: 13 }}>
                <span style={{ color: '#6b6b63' }}>Sous-total HT</span>
                <span>{fmtPriceEur(htAmount)}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', borderBottom: '1px solid #f0f0ee', fontSize: 13 }}>
                <span style={{ color: '#6b6b63' }}>TVA ({tvaRate}%)</span>
                <span>{fmtPriceEur(tvaAmount)}</span>
              </div>
            </>
          ) : (
            <div style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', borderBottom: '1px solid #f0f0ee', fontSize: 13 }}>
              <span style={{ color: '#6b6b63' }}>TVA</span>
              <span style={{ color: '#9b9b93' }}>Non applicable</span>
            </div>
          )}
          <div style={{ display: 'flex', justifyContent: 'space-between', padding: '12px 0 0', fontSize: 16, fontWeight: 700 }}>
            <span>Total TTC</span>
            <span style={{ color: primary }}>{fmtPrice(order.total_price, order.currency)}</span>
          </div>
        </div>
      </div>

      {/* Payment + Bank */}
      {(settings?.payment_terms || settings?.bank_iban) && (
        <div style={{ padding: '16px 36px', backgroundColor: '#f8f8f6', marginBottom: 0 }}>
          {settings?.payment_terms && (
            <p style={{ fontSize: 12, color: '#6b6b63', margin: '0 0 4px' }}>
              <span style={{ fontWeight: 600, color: '#1a1a2e' }}>Conditions de paiement :</span>{' '}{settings.payment_terms}
            </p>
          )}
          {settings?.bank_iban && (
            <p style={{ fontSize: 12, color: '#6b6b63', margin: '0 0 2px' }}>
              <span style={{ fontWeight: 600, color: '#1a1a2e' }}>IBAN :</span>{' '}{settings.bank_iban}
              {settings?.bank_bic && <span> · <span style={{ fontWeight: 600, color: '#1a1a2e' }}>BIC :</span>{' '}{settings.bank_bic}</span>}
            </p>
          )}
        </div>
      )}

      {/* Footer */}
      <div style={{ padding: '16px 36px', borderTop: '1px solid #f0f0ee', marginTop: 'auto' }}>
        {settings?.footer_notes ? (
          <p style={{ fontSize: 11, color: '#9b9b93', textAlign: 'center', margin: 0 }}>{settings.footer_notes}</p>
        ) : (
          <p style={{ fontSize: 11, color: '#c8c8c0', textAlign: 'center', margin: 0 }}>
            {settings?.company_name || ''} — {order.name}
          </p>
        )}
      </div>
    </div>
  )
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function InvoicePage({ params }: { params: { orderId: string } }) {
  const brand  = useBrand()
  const router = useRouter()

  const [order, setOrder]       = useState<ShopifyOrder | null>(null)
  const [settings, setSettings] = useState<InvoiceSettings | null>(null)
  const [loading, setLoading]   = useState(true)
  const [error, setError]       = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const [orderRes, settingsRes] = await Promise.all([
        fetch(`/api/billing/orders/${params.orderId}?brand=${brand}`),
        fetch(`/api/billing/settings?brand=${brand}`),
      ])
      const orderData    = await orderRes.json()
      const settingsData = await settingsRes.json()

      if (orderData.error)    { setError(orderData.error); return }
      if (settingsData.error) console.warn('Settings error:', settingsData.error)

      setOrder(orderData.order)
      setSettings(settingsData.settings ?? null)
    } catch (e) {
      setError(String(e))
    } finally {
      setLoading(false)
    }
  }, [brand, params.orderId])

  useEffect(() => { load() }, [load])

  function handlePrint() {
    window.print()
  }

  return (
    <>
      {/* Print styles */}
      <style>{`
        @media print {
          body * { visibility: hidden !important; }
          #invoice-content, #invoice-content * { visibility: visible !important; }
          #invoice-content {
            position: fixed !important;
            top: 0 !important;
            left: 0 !important;
            width: 100% !important;
            margin: 0 !important;
            box-shadow: none !important;
          }
          .no-print { display: none !important; }
          @page { margin: 0; size: A4; }
        }
      `}</style>

      <div className="min-h-screen bg-[#faf9f8]">
        {/* Toolbar */}
        <div className="no-print sticky top-0 z-10 bg-white border-b border-[#f0f0ee] px-6 py-3 flex items-center justify-between">
          <button
            onClick={() => router.push(`/${brand}/billing`)}
            className="flex items-center gap-2 text-sm text-[#6b6b63] hover:text-[#1a1a2e] transition-colors"
          >
            <ArrowLeft size={15} strokeWidth={2} />
            Retour aux commandes
          </button>
          {order && (
            <div className="flex items-center gap-3">
              <span className="text-sm font-semibold text-[#1a1a2e]">
                Facture {order.name}
              </span>
              <button
                onClick={handlePrint}
                className="flex items-center gap-2 px-4 py-2 rounded-xl bg-[#1a1a2e] text-white text-sm font-medium hover:bg-[#2d2d4a] transition-colors shadow-sm"
              >
                <Download size={14} strokeWidth={2} />
                Télécharger PDF
              </button>
            </div>
          )}
        </div>

        {/* Content */}
        <div className="no-print py-8 px-6">
          {loading ? (
            <div className="flex items-center justify-center py-32">
              <Loader2 size={24} className="animate-spin text-[#9b9b93]" />
            </div>
          ) : error ? (
            <div className="max-w-xl mx-auto">
              <div className="flex items-center gap-2.5 px-4 py-3 bg-red-50 border border-red-100 rounded-xl text-sm text-red-700">
                <AlertCircle size={15} className="shrink-0" />
                {error}
              </div>
            </div>
          ) : order ? (
            <div className="max-w-[210mm] mx-auto shadow-[0_4px_32px_rgba(0,0,0,0.12)] rounded-[4px] overflow-hidden">
              <Invoice order={order} settings={settings} />
            </div>
          ) : null}
        </div>
      </div>
    </>
  )
}
