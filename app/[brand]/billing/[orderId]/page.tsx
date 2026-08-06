'use client'

export const dynamic = 'force-dynamic'

import { useState, useEffect, useCallback } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { ArrowLeft, Download, Loader2, AlertCircle } from 'lucide-react'
import { useBrand } from '@/context/BrandContext'

// ─── Types ────────────────────────────────────────────────────────────────────

interface LineItem {
  id:             number
  title:          string
  variant_title?: string | null
  sku?:           string | null
  quantity:       number
  price:          string
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
  gateway?:         string
  payment_gateway_names?: string[]
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
    country?:  string
    phone?:    string
  } | null
  line_items: LineItem[]
  refunds?:   Refund[]
}

interface RefundLineItem {
  quantity:   number
  subtotal:   number   // montant remboursé HT/TTC selon le mode taxes du store
  total_tax:  number
  line_item?: { title?: string; variant_title?: string | null; sku?: string | null; price?: string } | null
}
interface Refund {
  id:                number
  created_at:        string
  refund_line_items: RefundLineItem[]
  transactions?:     { kind: string; amount: string }[]
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
  logo_size?:    number
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmtDateLong(iso: string) {
  return new Date(iso).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' }).toUpperCase()
}

function fmtEur(amount: number) {
  return new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' }).format(amount)
}

function paymentLabel(order: ShopifyOrder): string {
  const gw = (order.payment_gateway_names?.[0] || order.gateway || '').toLowerCase()
  if (gw.includes('card') || gw.includes('credit') || gw.includes('shopify_payments') || gw.includes('stripe')) return 'Carte de crédit'
  if (gw.includes('paypal')) return 'PayPal'
  if (gw.includes('virement') || gw.includes('bank') || gw.includes('wire')) return 'Virement bancaire'
  if (gw.includes('cash') || gw.includes('espece')) return 'Espèces'
  return 'Carte de crédit'
}

// ─── Invoice Component ────────────────────────────────────────────────────────

function Invoice({ order, settings, mode }: { order: ShopifyOrder; settings: InvoiceSettings | null; mode: 'facture' | 'avoir' }) {
  const isAvoir    = mode === 'avoir'
  const primary    = settings?.color_primary || '#1a1a2e'
  const tvaEnabled = settings?.tva_enabled ?? true
  const tvaRate    = settings?.tva_rate ?? 20

  const totalPrice = parseFloat(order.total_price)
  const totalTax   = parseFloat(order.total_tax)
  const htAmount   = tvaEnabled ? totalPrice - totalTax : totalPrice
  const tvaAmount  = tvaEnabled ? totalTax : 0
  const subtotal   = parseFloat(order.subtotal_price)
  const isPaid     = order.financial_status === 'paid' || order.financial_status === 'partially_paid'
  const amountDue  = isPaid ? 0 : totalPrice

  // ── Avoir basé sur les remboursements Shopify ──────────────────────────────
  // L'avoir ne porte QUE sur les articles réellement remboursés (refund_line_items),
  // pas sur le total de la commande. Ex. #10033 Bowa : 13× Akupanel remboursés = 572 €.
  const refunds   = order.refunds ?? []
  const refItems  = refunds.flatMap(r => r.refund_line_items ?? [])
  // Montant réellement remboursé (TTC) = somme des transactions kind=refund.
  const refundTx  = refunds.flatMap(r => r.transactions ?? [])
    .filter(t => t.kind === 'refund')
    .reduce((s, t) => s + parseFloat(t.amount || '0'), 0)
  const refItemsTax = refItems.reduce((s, li) => s + (li.total_tax || 0), 0)
  const refItemsSub = refItems.reduce((s, li) => s + (li.subtotal || 0), 0)
  // Un avoir est possible dès qu'il y a un remboursement (articles détaillés OU simple montant).
  const hasRefund = isAvoir && (refItems.length > 0 || refundTx > 0)

  // TTC remboursé : transactions réelles en priorité, sinon somme des lignes.
  const refundTTC = refundTx > 0 ? refundTx : (tvaEnabled ? refItemsSub : refItemsSub + refItemsTax)
  // TVA : depuis les lignes si détaillées, sinon extraite proportionnellement du TTC.
  const refundTVA = !tvaEnabled ? 0
                    : refItemsTax > 0 ? refItemsTax
                    : refundTTC - refundTTC / (1 + tvaRate / 100)
  const refundHT  = refundTTC - refundTVA

  // Lignes à afficher : articles remboursés si détaillés ; sinon une ligne
  // « Remboursement » du montant ; sinon (facture) toutes les lignes.
  const displayItems = !hasRefund
    ? order.line_items.map(it => ({
        id:            it.id,
        title:         it.title,
        variant_title: it.variant_title ?? null,
        sku:           it.sku ?? null,
        quantity:      it.quantity,
        unitPrice:     parseFloat(it.price),
        lineTotal:     parseFloat(it.price) * it.quantity - parseFloat(it.total_discount || '0'),
      }))
    : refItems.length > 0
      ? refItems.map((li, i) => ({
          id:            i,
          title:         li.line_item?.title ?? 'Article remboursé',
          variant_title: li.line_item?.variant_title ?? null,
          sku:           li.line_item?.sku ?? null,
          quantity:      li.quantity,
          unitPrice:     li.line_item?.price ? parseFloat(li.line_item.price)
                         : (li.quantity ? li.subtotal / li.quantity : li.subtotal),
          lineTotal:     li.subtotal,
        }))
      : [{
          id:            0,
          title:         `Remboursement commande ${order.name}`,
          variant_title: null,
          sku:           null,
          quantity:      1,
          unitPrice:     refundTTC,
          lineTotal:     refundTTC,
        }]

  // Montants affichés dans le bloc totaux.
  const dispHt  = hasRefund ? refundHT  : htAmount
  const dispTva = hasRefund ? refundTVA : tvaAmount
  const dispTtc = hasRefund ? refundTTC : totalPrice

  const billingAddr = order.billing_address
  const clientName  = billingAddr?.name
    || (order.customer ? [order.customer.first_name, order.customer.last_name].filter(Boolean).join(' ') : '')
    || '—'

  const invoiceNumber = order.name.replace('#', '')
  const docNumber     = isAvoir ? `AV-${invoiceNumber}` : invoiceNumber

  const S: Record<string, React.CSSProperties> = {
    page:       { fontFamily: "'Helvetica Neue', Helvetica, Arial, sans-serif", color: '#1a1a18', backgroundColor: '#fff', width: '210mm', minHeight: '297mm', position: 'relative', display: 'flex', flexDirection: 'column' },
    body:       { flex: 1, padding: '32px 40px 0' },
    footer:     { padding: '24px 40px', borderTop: '1px solid #e0e0dc', marginTop: 'auto' },

    // Header
    headerRow:  { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 36 },
    logo:       { height: settings?.logo_size ?? 36, objectFit: 'contain' as const },
    logoText:   { fontSize: settings?.logo_size ?? 28, fontWeight: 900, letterSpacing: '-1px', color: '#1a1a18', lineHeight: 1 },
    headerRight:{ display: 'flex', flexDirection: 'column' as const, alignItems: 'flex-end', gap: 6 },
    invoiceLabel:{ fontSize: 11, color: '#888', letterSpacing: '0.5px' },
    invoiceNum: { fontSize: 13, fontWeight: 700, letterSpacing: '0.5px' },
    dateBadge:  { backgroundColor: primary, color: '#fff', padding: '6px 14px', fontSize: 11, fontWeight: 700, letterSpacing: '0.5px', textAlign: 'center' as const },
    dateLabel:  { fontSize: 9, opacity: 0.75, marginBottom: 2, letterSpacing: '0.5px' },
    dateVal:    { fontSize: 12, fontWeight: 800, letterSpacing: '0.5px' },

    // Addresses
    addrRow:    { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 32, marginBottom: 28, paddingBottom: 24, borderBottom: '1px solid #e0e0dc' },
    addrLabel:  { fontSize: 9, fontWeight: 700, color: '#888', letterSpacing: '1.5px', textTransform: 'uppercase' as const, marginBottom: 6 },
    addrName:   { fontSize: 13, fontWeight: 700, marginBottom: 3, color: '#1a1a18' },
    addrLine:   { fontSize: 12, color: '#555', lineHeight: 1.5, margin: 0 },

    // Meta row
    metaRow:    { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 32, marginBottom: 28, paddingBottom: 24, borderBottom: '1px dashed #d8d8d4' },
    metaBlock:  { display: 'flex', flexDirection: 'column' as const, gap: 8 },
    metaItem:   { display: 'flex', gap: 16, alignItems: 'baseline' },
    metaKey:    { fontSize: 9, fontWeight: 700, color: '#888', letterSpacing: '1px', textTransform: 'uppercase' as const, minWidth: 100 },
    metaVal:    { fontSize: 11, fontWeight: 700, color: '#1a1a18' },
    thankyou:   { fontSize: 17, fontWeight: 900, color: '#1a1a18', letterSpacing: '-0.3px', lineHeight: 1.2, alignSelf: 'center' as const },

    // Table
    table:      { width: '100%', borderCollapse: 'collapse' as const, marginBottom: 28 },
    th:         { fontSize: 9, fontWeight: 700, color: '#888', textTransform: 'uppercase' as const, letterSpacing: '1px', padding: '10px 8px', borderBottom: '2px solid #1a1a18', textAlign: 'left' as const },
    thR:        { fontSize: 9, fontWeight: 700, color: '#888', textTransform: 'uppercase' as const, letterSpacing: '1px', padding: '10px 8px', borderBottom: '2px solid #1a1a18', textAlign: 'right' as const },
    td:         { fontSize: 12, padding: '12px 8px', borderBottom: '1px solid #ebebea', verticalAlign: 'top' as const },
    tdR:        { fontSize: 12, padding: '12px 8px', borderBottom: '1px solid #ebebea', textAlign: 'right' as const, verticalAlign: 'top' as const },
    tdBold:     { fontSize: 12, fontWeight: 700, padding: '12px 8px', borderBottom: '1px solid #ebebea', verticalAlign: 'top' as const },
    sku:        { fontSize: 10, color: '#888', marginTop: 2 },

    // Totals
    totalsWrap: { display: 'flex', justifyContent: 'flex-end', marginBottom: 32 },
    totalsBox:  { width: 280 },
    totalRow:   { display: 'flex', justifyContent: 'space-between', padding: '7px 12px', fontSize: 12, color: '#444', borderBottom: '1px solid #ebebea' },
    totalRowBig:{ display: 'flex', justifyContent: 'space-between', padding: '10px 12px', fontSize: 13, fontWeight: 700, backgroundColor: primary, color: '#fff' },
    totalLabel: { },
    totalVal:   { fontWeight: 600, color: '#1a1a18' },
  }

  return (
    <div id="invoice-content" style={S.page}>
      <div style={S.body}>

        {/* ── Header ─────────────────────────────────────────────────────────── */}
        <div style={S.headerRow}>
          {/* Logo */}
          <div>
            {settings?.logo_url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={settings.logo_url} alt="logo" style={S.logo} />
            ) : (
              <span style={S.logoText}>{settings?.company_name || 'Steero'}</span>
            )}
          </div>

          {/* Invoice ref + date */}
          <div style={S.headerRight}>
            <div>
              <div style={{ ...S.invoiceLabel, ...(isAvoir ? { color: '#c7293a', fontWeight: 700 } : {}) }}>{isAvoir ? "FACTURE D'AVOIR" : 'FACTURE'}</div>
              <div style={S.invoiceNum} data-invoice-number>{docNumber}</div>
              {isAvoir && (
                <div style={{ fontSize: 10, color: '#c7293a', marginTop: 2, textAlign: 'right' }}>
                  Avoir sur facture n° {invoiceNumber}
                  {hasRefund && refunds[0]?.created_at && (
                    <div style={{ color: '#888' }}>Remboursement du {fmtDateLong(refunds[0].created_at)}</div>
                  )}
                  {!hasRefund && <div style={{ color: '#b45309' }}>Aucun remboursement Shopify — avoir sur la totalité</div>}
                </div>
              )}
            </div>
            <div style={S.dateBadge}>
              <div style={S.dateLabel}>DATE D&apos;ÉMISSION</div>
              <div style={S.dateVal}>{fmtDateLong(order.created_at)}</div>
            </div>
          </div>
        </div>

        {/* ── Addresses ──────────────────────────────────────────────────────── */}
        <div style={S.addrRow}>
          <div>
            <div style={S.addrLabel}>Fournisseur</div>
            <div style={S.addrName}>{settings?.company_name || '—'}</div>
            {settings?.address_line1 && <p style={S.addrLine}>{settings.address_line1}</p>}
            {settings?.address_line2 && <p style={S.addrLine}>{settings.address_line2}</p>}
            {(settings?.zip || settings?.city) && (
              <p style={S.addrLine}>{[settings.zip, settings.city].filter(Boolean).join(' ')}</p>
            )}
            {settings?.country && <p style={S.addrLine}>{settings.country}</p>}
            {settings?.vat_number && <p style={{ ...S.addrLine, marginTop: 6 }}>N° de TVA : {settings.vat_number}</p>}
          </div>
          <div>
            <div style={S.addrLabel}>Client</div>
            {billingAddr?.company && <div style={S.addrName}>{billingAddr.company}</div>}
            <div style={{ ...S.addrName, fontWeight: billingAddr?.company ? 400 : 700 }}>{clientName}</div>
            {billingAddr?.address1 && <p style={S.addrLine}>{billingAddr.address1}</p>}
            {billingAddr?.address2 && <p style={S.addrLine}>{billingAddr.address2}</p>}
            {(billingAddr?.zip || billingAddr?.city) && (
              <p style={S.addrLine}>{[billingAddr.zip, billingAddr.city].filter(Boolean).join(' ')}</p>
            )}
            {billingAddr?.country && <p style={S.addrLine}>{billingAddr.country}</p>}
          </div>
        </div>

        {/* ── Meta + Thank you ───────────────────────────────────────────────── */}
        <div style={S.metaRow}>
          <div style={S.metaBlock}>
            <div style={S.metaItem}>
              <span style={S.metaKey}>Mode de paiement</span>
              <span style={S.metaVal}>{paymentLabel(order).toUpperCase()}</span>
            </div>
            <div style={S.metaItem}>
              <span style={S.metaKey}>Numéro de commande</span>
              <span style={S.metaVal}>{order.name}</span>
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center' }}>
            <div style={S.thankyou}>MERCI POUR<br />VOTRE ACHAT.</div>
          </div>
        </div>

        {/* ── Line items ─────────────────────────────────────────────────────── */}
        <table style={S.table}>
          <thead>
            <tr>
              <th style={S.th}>Article</th>
              <th style={S.th}>Description</th>
              <th style={{ ...S.thR }}>Quantité</th>
              <th style={{ ...S.thR }}>{tvaEnabled ? 'Prix unitaire TTC' : 'Prix unitaire HT'}</th>
              <th style={{ ...S.thR }}>TVA</th>
              <th style={{ ...S.thR }}>Total</th>
            </tr>
          </thead>
          <tbody>
            {displayItems.map((item) => (
                <tr key={item.id}>
                  <td style={S.tdBold}>{item.title}</td>
                  <td style={S.td}>
                    {item.variant_title && item.variant_title !== 'Default Title' && (
                      <span>{item.variant_title}</span>
                    )}
                    {item.sku && <div style={S.sku}>SKU : {item.sku}</div>}
                  </td>
                  <td style={S.tdR}>{item.quantity}</td>
                  <td style={S.tdR}>{fmtEur(item.unitPrice)}</td>
                  <td style={S.tdR}>{tvaEnabled ? `${tvaRate}%` : 'N/A'}</td>
                  <td style={{ ...S.tdR, fontWeight: 700 }}>{fmtEur(item.lineTotal)}</td>
                </tr>
            ))}
          </tbody>
        </table>

        {/* ── Totals ─────────────────────────────────────────────────────────── */}
        <div style={S.totalsWrap}>
          <div style={S.totalsBox}>
            <div style={S.totalRow}>
              <span>{hasRefund ? 'Sous-total remboursé' : 'Sous-total'}</span>
              <span style={{ fontWeight: 600 }}>{fmtEur(hasRefund ? dispHt : subtotal)}</span>
            </div>
            {tvaEnabled ? (
              <>
                <div style={S.totalRow}>
                  <span>Total HT</span>
                  <span style={{ fontWeight: 600 }}>{fmtEur(dispHt)}</span>
                </div>
                <div style={S.totalRow}>
                  <span>TVA (FR TVA) {tvaRate}%</span>
                  <span style={{ fontWeight: 600 }}>{fmtEur(dispTva)}</span>
                </div>
                <div style={S.totalRow}>
                  <span>Total TTC</span>
                  <span style={{ fontWeight: 700, color: '#1a1a18' }}>{fmtEur(dispTtc)}</span>
                </div>
              </>
            ) : (
              <>
                <div style={S.totalRow}>
                  <span style={{ color: '#888', fontSize: 11 }}>TVA — Non applicable</span>
                  <span style={{ color: '#888', fontSize: 11 }}>—</span>
                </div>
                <div style={S.totalRow}>
                  <span>Total HT</span>
                  <span style={{ fontWeight: 700, color: '#1a1a18' }}>{fmtEur(dispTtc)}</span>
                </div>
              </>
            )}
            {!isAvoir && isPaid && (
              <div style={S.totalRow}>
                <span>Montant payé</span>
                <span style={{ fontWeight: 600 }}>{fmtEur(totalPrice)}</span>
              </div>
            )}
            <div style={{ ...S.totalRowBig, ...(isAvoir ? { backgroundColor: '#c7293a' } : {}) }}>
              <span>{isAvoir ? 'TOTAL AVOIR TTC' : 'MONTANT DÛ'}</span>
              <span>{isAvoir ? `− ${fmtEur(dispTtc)}` : fmtEur(amountDue)}</span>
            </div>
          </div>
        </div>

      </div>

      {/* ── Footer ───────────────────────────────────────────────────────────── */}
      <div style={S.footer}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', gap: 24 }}>
          <div style={{ fontSize: 10, color: '#888', lineHeight: 1.7 }}>
            {settings?.company_name && <div style={{ fontWeight: 600, color: '#444' }}>{settings.company_name}</div>}
            {settings?.email && <span>E-mail : {settings.email}</span>}
            {settings?.email && settings?.phone && <span>  ·  </span>}
            {settings?.phone && <span>Tél : {settings.phone}</span>}
          </div>
          <div style={{ fontSize: 10, color: '#888', textAlign: 'right' as const, lineHeight: 1.7 }}>
            {settings?.bank_iban && <div>IBAN : {settings.bank_iban}{settings.bank_bic ? ` · BIC : ${settings.bank_bic}` : ''}</div>}
            {settings?.footer_notes && <div style={{ maxWidth: 300 }}>{settings.footer_notes}</div>}
          </div>
        </div>
      </div>
    </div>
  )
}

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
