'use client'

export const dynamic = 'force-dynamic'

import { useState, useEffect, useCallback } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { ArrowLeft, Download, Loader2, AlertCircle } from 'lucide-react'
import { useBrand } from '@/context/BrandContext'

import { Invoice, type ShopifyOrder, type InvoiceSettings } from '@/components/billing/Invoice'


// ─── Page ─────────────────────────────────────────────────────────────────────

export default function InvoicePage({ params }: { params: { orderId: string } }) {
  const brand  = useBrand()
  const router = useRouter()
  const searchParams = useSearchParams()
  const mode: 'facture' | 'avoir' = searchParams.get('type') === 'avoir' ? 'avoir' : 'facture'
  const isAvoir = mode === 'avoir'

  const [order, setOrder]       = useState<ShopifyOrder | null>(null)
  const [settings, setSettings] = useState<InvoiceSettings | null>(null)
  const [loading, setLoading]   = useState(true)
  const [error, setError]       = useState<string | null>(null)

  // La commande a-t-elle un remboursement Shopify ? (pastille sur l'onglet Avoir)
  const orderHasRefund = !!order?.refunds?.some(r =>
    (r.refund_line_items?.length ?? 0) > 0 ||
    (r.transactions ?? []).some(t => t.kind === 'refund'))

  function handlePrint() {
    const el = document.getElementById('invoice-content')
    if (!el) return
    const win = window.open('', '_blank', 'width=900,height=1200')
    if (!win) return
    const prefix   = isAvoir ? 'Avoir' : 'Facture'
    const filename = order ? `${prefix}-${order.name.replace('#', '')}` : `${prefix}-${params.orderId}`
    win.document.write(`<!DOCTYPE html><html><head>
      <meta charset="utf-8"/>
      <title>${filename}</title>
      <style>
        * { margin: 0; padding: 0; box-sizing: border-box; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
        body { background: white; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
        @page { margin: 0; size: A4; }
      </style>
    </head><body>${el.outerHTML}</body></html>`)
    win.document.close()
    setTimeout(() => {
      win.focus()
      win.print()
      win.addEventListener('afterprint', () => win.close())
    }, 500)
  }

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
      if (orderData.error) { setError(orderData.error); return }
      setOrder(orderData.order)
      setSettings(settingsData.settings ?? null)
    } catch (e) {
      setError(String(e))
    } finally {
      setLoading(false)
    }
  }, [brand, params.orderId])

  useEffect(() => { load() }, [load])

  return (
    <>
      <div className="min-h-screen bg-[#f0f0ee]">
        {/* Toolbar */}
        <div className="sticky top-0 z-10 bg-white border-b border-[#f0f0ee] px-6 py-3 flex items-center justify-between shadow-sm">
          <button
            onClick={() => router.push(`/${brand}/billing`)}
            className="flex items-center gap-2 text-sm text-[#6b6b63] hover:text-[#1a1a2e] transition-colors"
          >
            <ArrowLeft size={15} strokeWidth={2} />
            Retour
          </button>
          {order && (
            <div className="flex items-center gap-3">
              <span className="text-sm font-semibold text-[#1a1a2e]">{order.name}</span>

              {/* Sélecteur segmenté Facture / Avoir — les deux vues restent accessibles */}
              <div className="flex items-center rounded-xl border border-[#e8e8e4] bg-[#f3f3f1] p-0.5">
                <button
                  onClick={() => router.push(`/${brand}/billing/${params.orderId}`)}
                  className={`px-3.5 py-1.5 rounded-[9px] text-sm font-medium transition-colors ${!isAvoir ? 'bg-white text-[#1a1a2e] shadow-sm' : 'text-[#6b6b63] hover:text-[#1a1a2e]'}`}
                >
                  Facture
                </button>
                <button
                  onClick={() => router.push(`/${brand}/billing/${params.orderId}?type=avoir`)}
                  className={`flex items-center gap-1.5 px-3.5 py-1.5 rounded-[9px] text-sm font-medium transition-colors ${isAvoir ? 'bg-[#c7293a] text-white shadow-sm' : 'text-[#6b6b63] hover:text-[#c7293a]'}`}
                >
                  Avoir
                  {orderHasRefund && !isAvoir && <span className="w-1.5 h-1.5 rounded-full bg-[#c7293a]" />}
                </button>
              </div>

              <button
                onClick={handlePrint}
                className="flex items-center gap-2 px-4 py-2 rounded-xl bg-[#1a1a2e] text-white text-sm font-medium hover:bg-[#2d2d4a] transition-colors shadow-sm"
              >
                <Download size={14} strokeWidth={2} />
                Télécharger {isAvoir ? "l'avoir" : 'la facture'}
              </button>
            </div>
          )}
        </div>

        {/* Content */}
        <div className="print-wrapper py-10 px-6">
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
            <div className="max-w-[210mm] mx-auto shadow-[0_8px_40px_rgba(0,0,0,0.14)] rounded-sm overflow-hidden bg-white">
              <Invoice order={order} settings={settings} mode={mode} />
            </div>
          ) : null}
        </div>
      </div>
    </>
  )
}
