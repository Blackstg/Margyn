// GET /api/facture/pdf?brand=bowa&order=<num>
// Génère un VRAI PDF téléchargeable de la facture (1 clic, pas d'impression navigateur).
// Réutilise /api/facture/data pour des montants strictement identiques à l'écran.
// NB : page publique = toujours une FACTURE (jamais un avoir) → formules simples,
// reprises du composant components/billing/Invoice.tsx (chemin mode='facture').
import { NextRequest, NextResponse } from 'next/server'
import { PDFDocument, StandardFonts, rgb, type PDFFont, type RGB } from 'pdf-lib'

export const dynamic = 'force-dynamic'

interface LineItem { title: string; variant_title?: string | null; sku?: string | null; quantity: number; price: string; total_discount: string }
interface Order {
  name: string; created_at: string; total_price: string; subtotal_price: string; total_tax: string
  financial_status: string; gateway?: string; payment_gateway_names?: string[]
  customer: { first_name?: string; last_name?: string } | null
  billing_address: { name?: string; company?: string; address1?: string; address2?: string; city?: string; zip?: string; country?: string } | null
  line_items: LineItem[]
}
interface Settings {
  company_name?: string; address_line1?: string; address_line2?: string; city?: string; zip?: string; country?: string
  vat_number?: string; siret?: string; email?: string; phone?: string; tva_rate?: number; tva_enabled?: boolean
  footer_notes?: string; color_primary?: string; bank_iban?: string; bank_bic?: string
}

// Latin-1 (WinAnsi) uniquement : on remplace/retire ce que Helvetica ne peut pas encoder.
function sanitize(s: string): string {
  return (s ?? '')
    .replace(/ | /g, ' ')           // espaces fines/insécables → espace normal
    .replace(/[’‘]/g, "'").replace(/[“”]/g, '"')
    .replace(/[–—]/g, '-').replace(/™/g, '(TM)').replace(/[→➜]/g, '->').replace(/€/g, 'EUR ')
    .split('').filter(c => c.charCodeAt(0) <= 255).join('')
}
function money(n: number): string {
  const [int, dec] = Math.abs(n).toFixed(2).split('.')
  const grouped = int.replace(/\B(?=(\d{3})+(?!\d))/g, ' ')
  return `${n < 0 ? '-' : ''}${grouped},${dec} EUR`
}
function hexToRgb(hex?: string): RGB {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex ?? '')
  if (!m) return rgb(0.1, 0.1, 0.18)
  const v = parseInt(m[1], 16)
  return rgb(((v >> 16) & 255) / 255, ((v >> 8) & 255) / 255, (v & 255) / 255)
}
function fmtDate(iso: string): string {
  return sanitize(new Date(iso).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' }).toUpperCase())
}
function paymentLabel(o: Order): string {
  const gw = (o.payment_gateway_names?.[0] || o.gateway || '').toLowerCase()
  if (gw.includes('paypal')) return 'PAYPAL'
  if (gw.includes('virement') || gw.includes('bank') || gw.includes('wire')) return 'VIREMENT BANCAIRE'
  if (gw.includes('cash') || gw.includes('espece')) return 'ESPECES'
  return 'CARTE DE CREDIT'
}

export async function GET(req: NextRequest) {
  const brand = (req.nextUrl.searchParams.get('brand') ?? 'bowa').toLowerCase()
  const orderParam = (req.nextUrl.searchParams.get('order') ?? '').trim()
  if (!orderParam) return NextResponse.json({ error: 'Commande manquante' }, { status: 400 })

  // Réutilise le loader public (mêmes données que l'écran)
  const dataRes = await fetch(`${req.nextUrl.origin}/api/facture/data?brand=${encodeURIComponent(brand)}&order=${encodeURIComponent(orderParam)}`, { cache: 'no-store' })
  const data = await dataRes.json() as { order?: Order; settings?: Settings; error?: string }
  if (!dataRes.ok || data.error || !data.order) {
    return NextResponse.json({ error: data.error ?? 'Facture indisponible' }, { status: dataRes.status || 500 })
  }
  const order = data.order
  const settings = data.settings ?? {}

  // ── Calculs (identiques au composant, chemin facture) ──────────────────────
  const tvaEnabled = settings.tva_enabled ?? true
  const tvaRate    = settings.tva_rate ?? 20
  const totalPrice = parseFloat(order.total_price)
  const totalTax   = parseFloat(order.total_tax)
  const htAmount   = tvaEnabled ? totalPrice - totalTax : totalPrice
  const tvaAmount  = tvaEnabled ? totalTax : 0
  const subtotal   = parseFloat(order.subtotal_price)
  const isPaid     = order.financial_status === 'paid' || order.financial_status === 'partially_paid'
  const amountDue  = isPaid ? 0 : totalPrice
  const items = order.line_items.map(it => ({
    title: it.title, variant: it.variant_title, sku: it.sku, qty: it.quantity,
    unit: parseFloat(it.price),
    total: parseFloat(it.price) * it.quantity - parseFloat(it.total_discount || '0'),
  }))
  const invoiceNumber = order.name.replace('#', '')
  const billing = order.billing_address
  const clientName = billing?.name || (order.customer ? [order.customer.first_name, order.customer.last_name].filter(Boolean).join(' ') : '') || '-'

  // ── PDF ─────────────────────────────────────────────────────────────────────
  const pdf = await PDFDocument.create()
  const page = pdf.addPage([595.28, 841.89]) // A4 portrait
  const font  = await pdf.embedFont(StandardFonts.Helvetica)
  const bold  = await pdf.embedFont(StandardFonts.HelveticaBold)
  const primary = hexToRgb(settings.color_primary)
  const grey  = rgb(0.53, 0.53, 0.5)
  const dark  = rgb(0.1, 0.1, 0.09)
  const L = 40, R = 555
  let y = 800

  const text = (s: string, x: number, yy: number, opt: { size?: number; font?: PDFFont; color?: RGB; align?: 'left' | 'right' } = {}) => {
    const f = opt.font ?? font, size = opt.size ?? 10, str = sanitize(s)
    const w = f.widthOfTextAtSize(str, size)
    page.drawText(str, { x: opt.align === 'right' ? x - w : x, y: yy, size, font: f, color: opt.color ?? dark })
  }
  const line = (yy: number, color: RGB = rgb(0.88, 0.88, 0.86), th = 0.7) => page.drawLine({ start: { x: L, y: yy }, end: { x: R, y: yy }, thickness: th, color })

  // Header
  text(settings.company_name || 'Steero', L, y, { size: 22, font: bold })
  text('FACTURE', R, y + 4, { size: 11, font: bold, color: grey, align: 'right' })
  text(`No ${invoiceNumber}`, R, y - 10, { size: 12, font: bold, align: 'right' })
  // Badge date
  const badgeW = 150, badgeH = 34, bx = R - badgeW, by = y - 52
  page.drawRectangle({ x: bx, y: by, width: badgeW, height: badgeH, color: primary })
  text("DATE D'EMISSION", bx + badgeW / 2 - font.widthOfTextAtSize("DATE D'EMISSION", 7) / 2, by + 20, { size: 7, color: rgb(1, 1, 1) })
  const dstr = fmtDate(order.created_at)
  text(dstr, bx + badgeW / 2 - bold.widthOfTextAtSize(dstr, 10) / 2, by + 7, { size: 10, font: bold, color: rgb(1, 1, 1) })

  y = by - 26
  line(y); y -= 18

  // Adresses (2 colonnes)
  const colR = 310
  const label = (s: string, x: number, yy: number) => text(s, x, yy, { size: 8, font: bold, color: grey })
  const yStart = y
  label('FOURNISSEUR', L, y); label('CLIENT', colR, y)
  y -= 15
  text(settings.company_name || '-', L, y, { size: 11, font: bold })
  if (billing?.company) text(billing.company, colR, y, { size: 11, font: bold })
  text(clientName, colR, billing?.company ? y - 13 : y, { size: 11, font: billing?.company ? font : bold })
  y -= 14
  const sellerLines = [settings.address_line1, settings.address_line2, [settings.zip, settings.city].filter(Boolean).join(' '), settings.country, settings.vat_number ? `No de TVA : ${settings.vat_number}` : ''].filter(Boolean) as string[]
  const buyerLines = [billing?.address1, billing?.address2, [billing?.zip, billing?.city].filter(Boolean).join(' '), billing?.country].filter(Boolean) as string[]
  let ys = y, yb = billing?.company ? y - 13 : y
  for (const l of sellerLines) { text(l, L, ys, { size: 10, color: rgb(0.33, 0.33, 0.33) }); ys -= 13 }
  for (const l of buyerLines)  { text(l, colR, yb, { size: 10, color: rgb(0.33, 0.33, 0.33) }); yb -= 13 }
  y = Math.min(ys, yb) - 6
  void yStart
  line(y); y -= 18

  // Meta
  text('MODE DE PAIEMENT', L, y, { size: 8, font: bold, color: grey })
  text(paymentLabel(order), L + 130, y, { size: 10, font: bold })
  text('NUMERO DE COMMANDE', L, y - 15, { size: 8, font: bold, color: grey })
  text(order.name, L + 130, y - 15, { size: 10, font: bold })
  text('MERCI POUR VOTRE ACHAT.', R, y - 4, { size: 14, font: bold, align: 'right' })
  y -= 34
  line(y); y -= 20

  // Tableau — en-têtes
  const cQty = 380, cPU = 450, cTVA = 500, cTot = R
  text('ARTICLE', L, y, { size: 8, font: bold, color: grey })
  text('QUANTITE', cQty, y, { size: 8, font: bold, color: grey, align: 'right' })
  text(tvaEnabled ? 'PU TTC' : 'PU HT', cPU, y, { size: 8, font: bold, color: grey, align: 'right' })
  text('TVA', cTVA, y, { size: 8, font: bold, color: grey, align: 'right' })
  text('TOTAL', cTot, y, { size: 8, font: bold, color: grey, align: 'right' })
  y -= 6
  page.drawLine({ start: { x: L, y }, end: { x: R, y }, thickness: 1.5, color: dark })
  y -= 16

  for (const it of items) {
    text(it.title, L, y, { size: 10, font: bold })
    text(String(it.qty), cQty, y, { size: 10, align: 'right' })
    text(money(it.unit), cPU, y, { size: 10, align: 'right' })
    text(tvaEnabled ? `${tvaRate}%` : 'N/A', cTVA, y, { size: 10, align: 'right' })
    text(money(it.total), cTot, y, { size: 10, font: bold, align: 'right' })
    y -= 13
    const desc = [it.variant && it.variant !== 'Default Title' ? it.variant : '', it.sku ? `SKU : ${it.sku}` : ''].filter(Boolean).join('   ')
    if (desc) { text(desc, L, y, { size: 8, color: grey }); y -= 13 }
    y -= 6
    line(y)          // séparateur SOUS la ligne (ne barre plus le texte)
    y -= 15
  }

  // Totaux (bloc droite)
  y -= 6
  const tbL = 350
  const totRow = (k: string, v: string, opt: { bold?: boolean } = {}) => {
    text(k, tbL, y, { size: 10, color: rgb(0.27, 0.27, 0.27), font: opt.bold ? bold : font })
    text(v, R, y, { size: 10, font: opt.bold ? bold : font, align: 'right' })   // aligné à droite → plus de valeur coupée
    y -= 16
  }
  totRow('Sous-total', money(subtotal))
  if (tvaEnabled) {
    totRow('Total HT', money(htAmount))
    totRow(`TVA ${tvaRate}%`, money(tvaAmount))
    totRow('Total TTC', money(totalPrice), { bold: true })
  } else {
    totRow('TVA - Non applicable', '-')
    totRow('Total HT', money(totalPrice), { bold: true })
  }
  if (isPaid) totRow('Montant paye', money(totalPrice))
  // Bande montant dû (gap suffisant pour ne pas recouvrir la ligne précédente)
  y -= 6
  page.drawRectangle({ x: tbL - 10, y: y - 6, width: R - tbL + 14, height: 24, color: primary })
  text('MONTANT DU', tbL, y + 2, { size: 11, font: bold, color: rgb(1, 1, 1) })
  text(money(amountDue), R, y + 2, { size: 11, font: bold, color: rgb(1, 1, 1), align: 'right' })

  // Footer
  const fy = 70
  page.drawLine({ start: { x: L, y: fy + 14 }, end: { x: R, y: fy + 14 }, thickness: 0.7, color: rgb(0.88, 0.88, 0.86) })
  const footL = [settings.company_name, [settings.email ? `E-mail : ${settings.email}` : '', settings.phone ? `Tel : ${settings.phone}` : ''].filter(Boolean).join('  -  ')].filter(Boolean) as string[]
  let fyy = fy
  for (const l of footL) { text(l, L, fyy, { size: 8, color: grey }); fyy -= 11 }
  if (settings.bank_iban) text(`IBAN : ${settings.bank_iban}${settings.bank_bic ? `  -  BIC : ${settings.bank_bic}` : ''}`, R, fy, { size: 8, color: grey, align: 'right' })
  if (settings.footer_notes) text(settings.footer_notes, R, fy - 11, { size: 8, color: grey, align: 'right' })

  const bytes = await pdf.save()
  return new NextResponse(Buffer.from(bytes), {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="facture-${invoiceNumber}.pdf"`,
      'Cache-Control': 'no-store',
    },
  })
}
