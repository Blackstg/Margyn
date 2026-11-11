// Commande Shopify enrichie pour une facture : champs remises/livraison + paiements
// reçus (transactions réussies de type sale/capture : montant, moyen, date — rien d'autre).
// SERVER-ONLY.
import type { InvoicePayment } from '@/lib/billing/invoiceMath'

export const INVOICE_FIELDS = 'id,name,created_at,customer,total_price,subtotal_price,total_tax,total_discounts,financial_status,billing_address,currency,line_items,gateway,payment_gateway_names,refunds,discount_codes,discount_applications,shipping_lines'

export async function attachPayments<T extends { id?: number | string }>(shop: string, token: string, order: T): Promise<T & { payments: InvoicePayment[] }> {
  let payments: InvoicePayment[] = []
  if (order.id) {
    const r = await fetch(`https://${shop}/admin/api/2024-01/orders/${order.id}/transactions.json`, { headers: { 'X-Shopify-Access-Token': token }, cache: 'no-store' })
    if (r.ok) {
      const { transactions } = await r.json() as { transactions?: { kind: string; status: string; amount: string; gateway: string; processed_at?: string; created_at?: string }[] }
      payments = (transactions ?? [])
        .filter(t => (t.kind === 'sale' || t.kind === 'capture') && t.status === 'success')
        .map(t => ({ amount: parseFloat(t.amount), gateway: t.gateway, date: t.processed_at ?? t.created_at ?? '' }))
    }
  }
  return { ...order, payments }
}
