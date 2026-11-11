// Décomposition d'une facture Shopify, partagée par l'écran (components/billing/Invoice)
// et le PDF (api/facture/pdf) pour des montants identiques. PUR (aucun import serveur).
// Les remises sont lues dans discount_allocations (line_items.total_discount vaut 0
// depuis les remises « nouvelle génération » : la facture affichait 233,50 € de lignes
// pour 198,49 € payés, cf. Krom #1430).

export interface InvoicePayment { amount: number; gateway: string; date: string }

interface Alloc { amount: string }
interface Line { title: string; variant_title?: string | null; sku?: string | null; quantity: number; price: string; total_discount?: string; discount_allocations?: Alloc[] }
interface DiscountApp { type?: string; code?: string; title?: string; value?: string; value_type?: string }
interface ShippingLine { title?: string; price?: string; discounted_price?: string }
export interface InvoiceOrderLike {
  line_items: Line[]
  total_discounts?: string
  discount_applications?: DiscountApp[]
  shipping_lines?: ShippingLine[]
  payments?: InvoicePayment[]
}

const n = (v: unknown) => { const x = parseFloat(String(v ?? '0')); return Number.isFinite(x) ? x : 0 }
const r2 = (x: number) => Math.round(x * 100) / 100

export function discountLabel(order: InvoiceOrderLike, word = 'Remise'): string {
  const parts = (order.discount_applications ?? []).map(a => {
    const name = a.code || a.title || word
    return a.value_type === 'percentage' && a.value ? `${name} (-${n(a.value)} %)` : name
  })
  return parts.length ? `${word} ${Array.from(new Set(parts)).join(', ')}` : word
}

export function invoiceBreakdown(order: InvoiceOrderLike, t: { discount: string; shipping: string | null } = { discount: 'Remise', shipping: null }) {
  const lines = order.line_items.map(it => {
    const gross = n(it.price) * it.quantity
    const alloc = (it.discount_allocations ?? []).reduce((s, d) => s + n(d.amount), 0)
    const discount = r2(alloc > 0 ? alloc : n(it.total_discount))
    return { ...it, unit: n(it.price), gross: r2(gross), discount, net: r2(gross - discount) }
  })
  const itemsGross = r2(lines.reduce((s, l) => s + l.gross, 0))
  const lineDiscounts = r2(lines.reduce((s, l) => s + l.discount, 0))
  const shippingLines = order.shipping_lines ?? []
  const shipping = r2(shippingLines.reduce((s, l) => s + n(l.discounted_price ?? l.price), 0))
  const payments = (order.payments ?? []).slice().sort((a, b) => a.date.localeCompare(b.date))
  return {
    lines, itemsGross, lineDiscounts, discountLabel: discountLabel(order, t.discount),
    hasShipping: shippingLines.length > 0, shipping, shippingTitle: t.shipping ?? shippingLines[0]?.title ?? 'Livraison',
    payments, paidTotal: r2(payments.reduce((s, p) => s + p.amount, 0)),
  }
}

type GwText = { card: string; transfer: string; cash: string; giftCard: string }
const GW_FR: GwText = { card: 'Carte bancaire', transfer: 'Virement bancaire', cash: 'Espèces', giftCard: 'Carte cadeau' }

export function gatewayLabel(gw: string, t: GwText = GW_FR): string {
  const g = gw.toLowerCase()
  if (g.includes('paypal')) return 'PayPal'
  if (g.includes('virement') || g.includes('bank') || g.includes('wire')) return t.transfer
  if (g.includes('cash') || g.includes('espece')) return t.cash
  if (g.includes('gift')) return t.giftCard
  return t.card
}
