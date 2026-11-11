// Textes de la facture / de l'avoir en français ou en anglais (écran + PDF).
// Les noms de produits restent ceux de Shopify. PUR.

export type InvoiceLang = 'fr' | 'en'

export const parseLang = (v: string | null | undefined): InvoiceLang => (v === 'en' ? 'en' : 'fr')

const FR = {
  invoice: 'FACTURE', creditNote: "FACTURE D'AVOIR", no: 'N°',
  creditFor: (n: string) => `Avoir sur facture n° ${n}`, refundOf: 'Remboursement du',
  noRefund: 'Aucun remboursement Shopify — avoir sur la totalité',
  issueDate: "DATE D'ÉMISSION", supplier: 'Fournisseur', client: 'Client', vatNo: 'N° de TVA',
  paymentMethod: 'Mode de paiement', orderNumber: 'Numéro de commande', thanks: ['MERCI POUR', 'VOTRE ACHAT.'],
  item: 'Article', description: 'Description', quantity: 'Quantité',
  unitTTC: 'Prix unitaire TTC', unitHT: 'Prix unitaire HT', unitTTCShort: 'PU TTC', unitHTShort: 'PU HT', vat: 'TVA', total: 'Total',
  refundedItem: 'Article remboursé', refundOrder: (n: string) => `Remboursement commande ${n}`,
  itemsSubtotal: 'Sous-total articles', refundedSubtotal: 'Sous-total remboursé', subtotal: 'Sous-total',
  totalHT: 'Total HT', vatLine: (r: number) => `TVA (FR TVA) ${r}%`, vatShort: (r: number) => `TVA ${r}%`, totalTTC: 'Total TTC',
  vatNA: 'TVA — Non applicable', paidOn: 'Payé le', totalPaid: 'Total payé', amountPaid: 'Montant payé',
  creditTotal: 'TOTAL AVOIR TTC', amountDue: 'MONTANT DÛ', email: 'E-mail', phone: 'Tél',
  discount: 'Remise', free: 'Offerte', shipping: null as string | null,
  card: 'Carte de crédit', transfer: 'Virement bancaire', cash: 'Espèces', giftCard: 'Carte cadeau',
  locale: 'fr-FR', filePrefix: 'facture-', creditFilePrefix: 'Avoir-',
}

const EN: typeof FR = {
  invoice: 'INVOICE', creditNote: 'CREDIT NOTE', no: 'No.',
  creditFor: (n: string) => `Credit note for invoice no. ${n}`, refundOf: 'Refund of',
  noRefund: 'No Shopify refund — credit for the full amount',
  issueDate: 'ISSUE DATE', supplier: 'From', client: 'Bill to', vatNo: 'VAT no.',
  paymentMethod: 'Payment method', orderNumber: 'Order number', thanks: ['THANK YOU FOR', 'YOUR PURCHASE.'],
  item: 'Item', description: 'Description', quantity: 'Quantity',
  unitTTC: 'Unit price incl. VAT', unitHT: 'Unit price excl. VAT', unitTTCShort: 'UNIT INCL. VAT', unitHTShort: 'UNIT PRICE', vat: 'VAT', total: 'Total',
  refundedItem: 'Refunded item', refundOrder: (n: string) => `Refund for order ${n}`,
  itemsSubtotal: 'Items subtotal', refundedSubtotal: 'Refunded subtotal', subtotal: 'Subtotal',
  totalHT: 'Total excl. VAT', vatLine: (r: number) => `VAT ${r}%`, vatShort: (r: number) => `VAT ${r}%`, totalTTC: 'Total incl. VAT',
  vatNA: 'VAT — Not applicable', paidOn: 'Paid on', totalPaid: 'Total paid', amountPaid: 'Amount paid',
  creditTotal: 'TOTAL CREDIT INCL. VAT', amountDue: 'AMOUNT DUE', email: 'Email', phone: 'Phone',
  discount: 'Discount', free: 'Free', shipping: 'Shipping',
  card: 'Credit card', transfer: 'Bank transfer', cash: 'Cash', giftCard: 'Gift card',
  locale: 'en-GB', filePrefix: 'invoice_', creditFilePrefix: 'credit_note_',
}

export const invoiceText = (lang: InvoiceLang) => (lang === 'en' ? EN : FR)
export type InvoiceText = typeof FR
