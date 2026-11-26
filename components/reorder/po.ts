// Bon de commande : PDF (fenêtre d'impression), CSV et message pour le fournisseur.
import { fmtDay } from './format'

export type PoLine = { title: string; variantTitle: string | null; sku: string | null; image: string | null; qty: number }

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;')

function poHtml(lines: PoLine[], brandLabel: string, orderedOn: string, arrivalOn: string | null): string {
  const total = lines.reduce((s, l) => s + l.qty, 0)
  const rows = lines.map((l) => `
      <tr>
        <td style="width:52px">${l.image ? `<img src="${esc(l.image)}" alt="" style="width:36px;height:36px;object-fit:cover;border-radius:6px;display:block;" />` : '<div style="width:36px;height:36px;border-radius:6px;background:#f0ece9;"></div>'}</td>
        <td>${esc(l.title)}</td>
        <td>${l.variantTitle ? esc(l.variantTitle) : '—'}</td>
        <td style="font-family:monospace;font-size:11px;color:#666">${l.sku ? esc(l.sku) : '—'}</td>
        <td class="qty">${l.qty}</td>
      </tr>`).join('')
  return `<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="UTF-8" />
  <title>Bon de commande — ${esc(brandLabel)}</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: 'Helvetica Neue', Arial, sans-serif; font-size: 12px; color: #1a1a2e; background: white; padding: 40px; }
    .header { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 32px; padding-bottom: 20px; border-bottom: 2px solid #1a1a2e; }
    .logo { font-size: 20px; font-weight: 800; letter-spacing: -0.5px; }
    .subtitle { font-size: 13px; color: #666; margin-top: 3px; }
    .meta { text-align: right; font-size: 11px; color: #666; line-height: 1.9; }
    .meta strong { color: #1a1a2e; }
    table { width: 100%; border-collapse: collapse; margin-top: 4px; }
    thead tr { background: #f5f0f2; }
    th { padding: 9px 10px; text-align: left; font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.08em; color: #888; border-bottom: 1px solid #e0dbd8; }
    td { padding: 10px 10px; border-bottom: 1px solid #f0ece9; vertical-align: middle; }
    td.qty { font-weight: 700; font-size: 14px; text-align: right; }
    th:last-child { text-align: right; }
    tr:last-child td { border-bottom: none; }
    tr:nth-child(even) td { background: #faf9f8; }
    .footer { margin-top: 24px; padding-top: 16px; border-top: 1px solid #e0dbd8; display: flex; justify-content: space-between; align-items: center; }
    .footer .refs { font-size: 11px; color: #666; }
    .footer .total { font-size: 15px; font-weight: 700; }
    .footer .total span { font-size: 11px; font-weight: 400; color: #666; margin-left: 4px; }
    @media print { body { padding: 20px; } @page { size: A4; margin: 15mm 20mm; } }
  </style>
</head>
<body>
  <div class="header">
    <div>
      <div class="logo">${esc(brandLabel)}</div>
      <div class="subtitle">Bon de commande fournisseur</div>
    </div>
    <div class="meta">
      <div>Date : <strong>${fmtDay(orderedOn, true)}</strong></div>
      ${arrivalOn ? `<div>Arrivée souhaitée : <strong>${fmtDay(arrivalOn, true)}</strong></div>` : ''}
    </div>
  </div>
  <table>
    <thead><tr><th></th><th>Produit</th><th>Variant</th><th>Référence SKU</th><th style="text-align:right">Quantité</th></tr></thead>
    <tbody>${rows}</tbody>
  </table>
  <div class="footer">
    <div class="refs">${lines.length} référence${lines.length > 1 ? 's' : ''}</div>
    <div class="total">${total.toLocaleString('fr-FR')} unités <span>à commander</span></div>
  </div>
</body>
</html>`
}

// `win` : fenêtre ouverte au clic (avant tout appel réseau), sinon le navigateur la bloque.
export function printPO(lines: PoLine[], brandLabel: string, orderedOn: string, arrivalOn: string | null, win?: Window | null) {
  const w = win ?? window.open('', '_blank', 'width=900,height=700')
  if (!w) return
  w.document.open()
  w.document.write(poHtml(lines, brandLabel, orderedOn, arrivalOn))
  w.document.close()
  w.focus()
  setTimeout(() => { w.print() }, 500)
}

const cell = (v: string | number) => (typeof v === 'number' ? String(v) : `"${v.replace(/"/g, '""')}"`)

export function downloadCSV(filename: string, headers: string[], rows: (string | number)[][]) {
  const csv = [headers.join(';'), ...rows.map((r) => r.map(cell).join(';'))].join('\r\n')
  const url = URL.createObjectURL(new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' }))
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

export function poCSV(lines: PoLine[], brand: string, day: string) {
  downloadCSV(`bon-commande-${brand}-${day}.csv`, ['Produit', 'Variant', 'Référence SKU', 'Quantité commandée'],
    lines.map((l) => [l.title, l.variantTitle ?? '', l.sku ?? '', l.qty]))
}

export function supplierMessage(lines: PoLine[], brandLabel: string, orderedOn: string, prodDoneOn: string): string {
  const total = lines.reduce((s, l) => s + l.qty, 0)
  return [
    'Bonjour,',
    '',
    `Voici notre nouvelle commande ${brandLabel} du ${fmtDay(orderedOn, true)} :`,
    '',
    ...lines.map((l) => `- ${l.title}${l.variantTitle ? ` — ${l.variantTitle}` : ''}${l.sku ? ` (SKU ${l.sku})` : ''} : ${l.qty} pièces`),
    '',
    `Total : ${total.toLocaleString('fr-FR')} pièces.`,
    '',
    `Merci de nous confirmer la commande et la date de fin de production (nous comptons sur le ${fmtDay(prodDoneOn, true)}).`,
    '',
    'Bonne journée,',
  ].join('\n')
}
