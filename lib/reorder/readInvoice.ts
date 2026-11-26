// Lecture d'une facture fournisseur (PDF) par Claude, en JSON contraint, et taux
// de change vers l'euro à la date de la facture. Utilisé par /api/reorder/invoice.
import Anthropic from '@anthropic-ai/sdk'
import type { ParsedInvoice } from './invoice'

const SYSTEM = `Tu lis des factures de fournisseurs (usines) d'une marque d'accessoires de puériculture et tu en extrais les lignes.
- Une ligne qui regroupe plusieurs couleurs (sous-lignes « couleur quantité », ou « produit -Couleur quantité ») devient une ligne par couleur, avec le nom du produit et le prix unitaire de la ligne parente. La somme des quantités par couleur doit égaler la quantité de la ligne parente.
- product : le nom du produit tel qu'il est écrit, sans la couleur ni la quantité. color : la couleur telle qu'elle est écrite, chaîne vide s'il n'y en a pas.
- kind : "other" pour ce qui n'est pas un produit vendu (étiquettes, tags, emballages, boîtes, sacs d'emballage, frais, transport), sinon "product".
- subtotal : total des lignes avant remise. deposit : ce qui est payé ou à payer maintenant. Quand la facture parle d'un acompte (ex. « 30% deposit ») et affiche une « remise » égale au reste, le total affiché est l'acompte : deposit = ce total, balance = subtotal − deposit. Sans acompte : deposit = 0 et balance = le total dû.
- date : date de la facture au format AAAA-MM-JJ. number : numéro de facture. supplier : nom de l'émetteur (pas le client). currency : code ISO (USD, EUR, CNY…).
- N'invente rien : recopie les nombres de la facture.`

const SCHEMA = {
  type: 'object', additionalProperties: false,
  required: ['supplier', 'number', 'date', 'currency', 'subtotal', 'deposit', 'balance', 'lines'],
  properties: {
    supplier: { type: 'string' }, number: { type: 'string' }, date: { type: 'string' }, currency: { type: 'string' },
    subtotal: { type: 'number' }, deposit: { type: 'number' }, balance: { type: 'number' },
    lines: {
      type: 'array',
      items: {
        type: 'object', additionalProperties: false,
        required: ['product', 'color', 'qty', 'unitPrice', 'kind'],
        properties: {
          product: { type: 'string' }, color: { type: 'string' }, qty: { type: 'integer' }, unitPrice: { type: 'number' },
          kind: { type: 'string', enum: ['product', 'other'] },
        },
      },
    },
  },
}

export async function readInvoice(pdfBase64: string): Promise<ParsedInvoice> {
  const client = new Anthropic()
  const res = await client.messages.create({
    model: 'claude-opus-5-5',
    max_tokens: 16000,
    system: SYSTEM,
    output_config: { effort: 'low', format: { type: 'json_schema', schema: SCHEMA } },
    messages: [{
      role: 'user',
      content: [
        { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: pdfBase64 } },
        { type: 'text', text: 'Extrais cette facture.' },
      ],
    }],
  })
  if (res.stop_reason === 'refusal') throw new Error('La lecture de la facture a été refusée. Saisis la commande avec « Déjà commandé ».')
  if (res.stop_reason === 'max_tokens') throw new Error('Facture trop longue pour être lue en une fois.')
  const text = res.content.find((b) => b.type === 'text')
  if (!text || text.type !== 'text') throw new Error('Aucune ligne lue sur la facture.')
  return JSON.parse(text.text) as ParsedInvoice
}

// Taux de change à la date de la facture (1 unité de la devise en €).
export async function rateToEur(currency: string, date: string): Promise<number> {
  if (currency.toUpperCase() === 'EUR') return 1
  const day = /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : 'latest'
  try {
    const r = await fetch(`https://api.frankfurter.dev/v1/${day}?from=${encodeURIComponent(currency.toUpperCase())}&to=EUR`, { cache: 'no-store' })
    const j = await r.json() as { rates?: { EUR?: number } }
    if (j.rates?.EUR) return j.rates.EUR
  } catch { /* taux par défaut ci-dessous, modifiable à la relecture */ }
  return currency.toUpperCase() === 'USD' ? 0.92 : 1
}
