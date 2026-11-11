// Composant Facture partagé (page interne /[brand]/billing + page publique /facture).
import React from 'react'
import { gatewayLabel, invoiceBreakdown, type InvoicePayment } from '@/lib/billing/invoiceMath'
import { invoiceText, type InvoiceLang, type InvoiceText } from '@/lib/billing/invoiceI18n'

// ─── Types ────────────────────────────────────────────────────────────────────

export interface LineItem {
  id:             number
  title:          string
  variant_title?: string | null
  sku?:           string | null
  quantity:       number
  price:          string
  total_discount: string
  discount_allocations?: { amount: string }[]
}

export interface ShopifyOrder {
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
    vat_number?: string
  } | null
  line_items: LineItem[]
  refunds?:   Refund[]
  discount_applications?: { type?: string; code?: string; title?: string; value?: string; value_type?: string }[]
  shipping_lines?: { title?: string; price?: string; discounted_price?: string }[]
  payments?: InvoicePayment[]
}

export interface RefundLineItem {
  quantity:   number
  subtotal:   number   // montant remboursé HT/TTC selon le mode taxes du store
  total_tax:  number
  line_item?: { title?: string; variant_title?: string | null; sku?: string | null; price?: string } | null
}
export interface Refund {
  id:                number
  created_at:        string
  refund_line_items: RefundLineItem[]
  transactions?:     { kind: string; amount: string }[]
}

export interface InvoiceSettings {
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

function fmtDateLong(iso: string, locale = 'fr-FR') {
  return new Date(iso).toLocaleDateString(locale, { day: 'numeric', month: 'long', year: 'numeric' }).toUpperCase()
}

function fmtEurIn(locale: string, amount: number) {
  return new Intl.NumberFormat(locale, { style: 'currency', currency: 'EUR' }).format(amount)
}

function paymentLabel(order: ShopifyOrder, t: InvoiceText): string {
  const gw = (order.payment_gateway_names?.[0] || order.gateway || '').toLowerCase()
  if (gw.includes('card') || gw.includes('credit') || gw.includes('shopify_payments') || gw.includes('stripe')) return t.card
  if (gw.includes('paypal')) return 'PayPal'
  if (gw.includes('virement') || gw.includes('bank') || gw.includes('wire')) return t.transfer
  if (gw.includes('cash') || gw.includes('espece')) return t.cash
  return t.card
}

// ─── Invoice Component ────────────────────────────────────────────────────────

export function Invoice({ order, settings, mode, lang = 'fr' }: { order: ShopifyOrder; settings: InvoiceSettings | null; mode: 'facture' | 'avoir'; lang?: InvoiceLang }) {
  const t = invoiceText(lang)
  const fmtEur = (amount: number) => fmtEurIn(t.locale, amount)
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
  // Remises (discount_allocations), livraison et paiements reçus — cf. lib/billing/invoiceMath
  const bd = invoiceBreakdown(order, t)

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
    ? order.line_items.map((it, i) => ({
        id:            it.id,
        title:         it.title,
        variant_title: it.variant_title ?? null,
        sku:           it.sku ?? null,
        quantity:      it.quantity,
        unitPrice:     parseFloat(it.price),
        lineTotal:     bd.lines[i].net,
        discount:      bd.lines[i].discount,
      }))
    : refItems.length > 0
      ? refItems.map((li, i) => ({
          id:            i,
          title:         li.line_item?.title ?? t.refundedItem,
          variant_title: li.line_item?.variant_title ?? null,
          sku:           li.line_item?.sku ?? null,
          quantity:      li.quantity,
          unitPrice:     li.line_item?.price ? parseFloat(li.line_item.price)
                         : (li.quantity ? li.subtotal / li.quantity : li.subtotal),
          lineTotal:     li.subtotal,
        }))
      : [{
          id:            0,
          title:         t.refundOrder(order.name),
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
    invoiceLabel:{ fontSize: 22, fontWeight: 900, color: '#1a1a18', letterSpacing: '1px', lineHeight: 1.1, textAlign: 'right' as const },
    invoiceNum: { fontSize: 14, fontWeight: 700, letterSpacing: '0.5px', marginTop: 2, textAlign: 'right' as const },
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
              <div style={{ ...S.invoiceLabel, ...(isAvoir ? { color: '#c7293a', fontWeight: 700 } : {}) }}>{isAvoir ? t.creditNote : t.invoice}</div>
              <div style={S.invoiceNum} data-invoice-number>{t.no} {docNumber}</div>
              {isAvoir && (
                <div style={{ fontSize: 10, color: '#c7293a', marginTop: 2, textAlign: 'right' }}>
                  {t.creditFor(invoiceNumber)}
                  {hasRefund && refunds[0]?.created_at && (
                    <div style={{ color: '#888' }}>{t.refundOf} {fmtDateLong(refunds[0].created_at, t.locale)}</div>
                  )}
                  {!hasRefund && <div style={{ color: '#b45309' }}>{t.noRefund}</div>}
                </div>
              )}
            </div>
            <div style={S.dateBadge}>
              <div style={S.dateLabel}>{t.issueDate}</div>
              <div style={S.dateVal}>{fmtDateLong(order.created_at, t.locale)}</div>
            </div>
          </div>
        </div>

        {/* ── Addresses ──────────────────────────────────────────────────────── */}
        <div style={S.addrRow}>
          <div>
            <div style={S.addrLabel}>{t.supplier}</div>
            <div style={S.addrName}>{settings?.company_name || '—'}</div>
            {settings?.address_line1 && <p style={S.addrLine}>{settings.address_line1}</p>}
            {settings?.address_line2 && <p style={S.addrLine}>{settings.address_line2}</p>}
            {(settings?.zip || settings?.city) && (
              <p style={S.addrLine}>{[settings.zip, settings.city].filter(Boolean).join(' ')}</p>
            )}
            {settings?.country && <p style={S.addrLine}>{settings.country}</p>}
            {settings?.vat_number && <p style={{ ...S.addrLine, marginTop: 6 }}>{t.vatNo} : {settings.vat_number}</p>}
          </div>
          <div>
            <div style={S.addrLabel}>{t.client}</div>
            {billingAddr?.company && <div style={S.addrName}>{billingAddr.company}</div>}
            <div style={{ ...S.addrName, fontWeight: billingAddr?.company ? 400 : 700 }}>{clientName}</div>
            {billingAddr?.address1 && <p style={S.addrLine}>{billingAddr.address1}</p>}
            {billingAddr?.address2 && <p style={S.addrLine}>{billingAddr.address2}</p>}
            {(billingAddr?.zip || billingAddr?.city) && (
              <p style={S.addrLine}>{[billingAddr.zip, billingAddr.city].filter(Boolean).join(' ')}</p>
            )}
            {billingAddr?.country && <p style={S.addrLine}>{billingAddr.country}</p>}
            {billingAddr?.vat_number && <p style={{ ...S.addrLine, marginTop: 6 }}>{t.vatNo} : {billingAddr.vat_number}</p>}
          </div>
        </div>

        {/* ── Meta + Thank you ───────────────────────────────────────────────── */}
        <div style={S.metaRow}>
          <div style={S.metaBlock}>
            <div style={S.metaItem}>
              <span style={S.metaKey}>{t.paymentMethod}</span>
              <span style={S.metaVal}>{paymentLabel(order, t).toUpperCase()}</span>
            </div>
            <div style={S.metaItem}>
              <span style={S.metaKey}>{t.orderNumber}</span>
              <span style={S.metaVal}>{order.name}</span>
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center' }}>
            <div style={S.thankyou}>{t.thanks[0]}<br />{t.thanks[1]}</div>
          </div>
        </div>

        {/* ── Line items ─────────────────────────────────────────────────────── */}
        <table style={S.table}>
          <thead>
            <tr>
              <th style={S.th}>{t.item}</th>
              <th style={S.th}>{t.description}</th>
              <th style={{ ...S.thR }}>{t.quantity}</th>
              <th style={{ ...S.thR }}>{tvaEnabled ? t.unitTTC : t.unitHT}</th>
              <th style={{ ...S.thR }}>{t.vat}</th>
              <th style={{ ...S.thR }}>{t.total}</th>
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
                    {'discount' in item && Number(item.discount) > 0 && (
                      <div style={{ ...S.sku, color: '#1a7f4b' }}>{bd.discountLabel} : −{fmtEur(Number(item.discount))}</div>
                    )}
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
            {!hasRefund && bd.lineDiscounts > 0 ? (
              <>
                <div style={S.totalRow}>
                  <span>{t.itemsSubtotal}</span>
                  <span style={{ fontWeight: 600 }}>{fmtEur(bd.itemsGross)}</span>
                </div>
                <div style={{ ...S.totalRow, color: '#1a7f4b' }}>
                  <span>{bd.discountLabel}</span>
                  <span style={{ fontWeight: 600 }}>−{fmtEur(bd.lineDiscounts)}</span>
                </div>
              </>
            ) : (
              <div style={S.totalRow}>
                <span>{hasRefund ? t.refundedSubtotal : t.subtotal}</span>
                <span style={{ fontWeight: 600 }}>{fmtEur(hasRefund ? dispHt : subtotal)}</span>
              </div>
            )}
            {!hasRefund && bd.hasShipping && (
              <div style={S.totalRow}>
                <span>{bd.shippingTitle}</span>
                <span style={{ fontWeight: 600 }}>{bd.shipping > 0 ? fmtEur(bd.shipping) : t.free}</span>
              </div>
            )}
            {tvaEnabled ? (
              <>
                <div style={S.totalRow}>
                  <span>{t.totalHT}</span>
                  <span style={{ fontWeight: 600 }}>{fmtEur(dispHt)}</span>
                </div>
                <div style={S.totalRow}>
                  <span>{t.vatLine(tvaRate)}</span>
                  <span style={{ fontWeight: 600 }}>{fmtEur(dispTva)}</span>
                </div>
                <div style={S.totalRow}>
                  <span>{t.totalTTC}</span>
                  <span style={{ fontWeight: 700, color: '#1a1a18' }}>{fmtEur(dispTtc)}</span>
                </div>
              </>
            ) : (
              <>
                <div style={S.totalRow}>
                  <span style={{ color: '#888', fontSize: 11 }}>{t.vatNA}</span>
                  <span style={{ color: '#888', fontSize: 11 }}>—</span>
                </div>
                <div style={S.totalRow}>
                  <span>{t.totalHT}</span>
                  <span style={{ fontWeight: 700, color: '#1a1a18' }}>{fmtEur(dispTtc)}</span>
                </div>
              </>
            )}
            {!isAvoir && bd.payments.length > 0 ? (
              <>
                {bd.payments.map((p, i) => (
                  <div key={i} style={S.totalRow}>
                    <span>{t.paidOn} {new Date(p.date).toLocaleDateString(t.locale, { day: 'numeric', month: 'short', year: 'numeric' })} ({gatewayLabel(p.gateway, t)})</span>
                    <span style={{ fontWeight: 600 }}>{fmtEur(p.amount)}</span>
                  </div>
                ))}
                {bd.payments.length > 1 && (
                  <div style={S.totalRow}>
                    <span>{t.totalPaid}</span>
                    <span style={{ fontWeight: 700 }}>{fmtEur(bd.paidTotal)}</span>
                  </div>
                )}
              </>
            ) : !isAvoir && isPaid && (
              <div style={S.totalRow}>
                <span>{t.amountPaid}</span>
                <span style={{ fontWeight: 600 }}>{fmtEur(totalPrice)}</span>
              </div>
            )}
            <div style={{ ...S.totalRowBig, ...(isAvoir ? { backgroundColor: '#c7293a' } : {}) }}>
              <span>{isAvoir ? t.creditTotal : t.amountDue}</span>
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
            {settings?.email && <span>{t.email} : {settings.email}</span>}
            {settings?.email && settings?.phone && <span>  ·  </span>}
            {settings?.phone && <span>{t.phone} : {settings.phone}</span>}
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
