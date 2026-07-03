// Génère le HTML du rapport SAV/Défauts Mōom — partagé par l'export PDF (onglet
// about:blank + impression) et la page publique partageable au fournisseur.

export interface DefectClaim {
  claim_type: string
  reported_at: string
  sku: string | null
  product_name: string | null
  shopify_order_id: string | null
  received_sku: string | null
  received_product_name: string | null
  quantity: number
  defect_description: string | null
  photo_url: string | null
  product_image_url: string | null
  milestones: Record<string, string> | null
  production_batch: string | null
  validated_by: string | null
  reship_tracking_ref: string | null
  return_tracking_ref: string | null
}

const TYPE_LABEL: Record<string, string> = { defaut_fournisseur: 'Defect', erreur_envoi: 'Shipping error' }
const STEP_LABELS: Record<string, string> = {
  reclamation_envoyee: 'Claim sent', repro_confirmee: 'Defect confirmed',
  etiquette_envoyee: 'Return label', retour_recu: 'Return received',
  reexpedie: 'Reshipped', recu: 'Received', clos: 'Closed', litige: 'Dispute',
}

const esc = (s: unknown) => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!))
const fmtDate = (s: string | null) =>
  !s ? '—' : new Date(s + 'T00:00:00').toLocaleDateString('en-GB', { day: '2-digit', month: 'short' })
function milestonesSummary(m: Record<string, string> | null): string {
  if (!m) return '—'
  const keys = Object.keys(m)
  if (!keys.length) return 'Reported'
  return keys.map(k => `${STEP_LABELS[k] ?? k} (${fmtDate(m[k])})`).join(', ')
}

// Regroupe par lot de production ("Sans lot" en dernier, lots les plus récents en tête)
function groupByBatch(claims: DefectClaim[]): [string, DefectClaim[]][] {
  const map = new Map<string, DefectClaim[]>()
  for (const c of claims) {
    const k = c.production_batch?.trim() || '—'
    if (!map.has(k)) map.set(k, [])
    map.get(k)!.push(c)
  }
  return [...map.entries()].sort((a, b) => {
    if (a[0] === '—') return 1
    if (b[0] === '—') return -1
    return b[0].localeCompare(a[0])
  })
}

export function buildDefectReportHtml(
  claims: DefectClaim[],
  opts: { monthLabel?: string; autoPrint?: boolean } = {},
): string {
  const groups = groupByBatch(claims)
  const all = groups.flatMap(([, list]) => list)

  type Agg = { label: string; qty: number }
  function aggregate(cs: DefectClaim[], keyOf: (c: DefectClaim) => string, labelOf: (c: DefectClaim) => string): Agg[] {
    const m = new Map<string, Agg>()
    for (const c of cs) {
      const k = keyOf(c) || '—'
      const cur = m.get(k) ?? { label: labelOf(c), qty: 0 }
      cur.qty += c.quantity || 0
      m.set(k, cur)
    }
    return [...m.values()].sort((a, b) => b.qty - a.qty)
  }
  const itemLabel = (sku: string | null, name: string | null) =>
    `${sku ? `<b>${esc(sku)}</b>` : ''}${sku && name ? ' · ' : ''}${name ? esc(name) : ''}` || '—'

  const toRepro = aggregate(
    all.filter(c => c.claim_type === 'defaut_fournisseur'),
    c => c.sku ?? c.product_name ?? '',
    c => itemLabel(c.sku, c.product_name),
  )
  const noBill = aggregate(
    all.filter(c => c.claim_type === 'erreur_envoi'),
    c => c.received_sku ?? c.received_product_name ?? '',
    c => itemLabel(c.received_sku, c.received_product_name),
  )
  const sumTable = (items: Agg[], emptyMsg: string) => items.length
    ? items.map(it => `<tr><td>${it.label}</td><td class="qty">×${it.qty}</td></tr>`).join('')
      + `<tr class="tot"><td>Total</td><td class="qty">×${items.reduce((s, i) => s + i.qty, 0)}</td></tr>`
    : `<tr><td colspan="2" class="muted">${emptyMsg}</td></tr>`

  const rows = groups.map(([batch, list]) => {
    const head = `<tr><td colspan="8" class="lot">Batch: ${esc(batch)} — ${list.length} case(s)</td></tr>`
    const body = list.map(c => `<tr>
      <td>${esc(TYPE_LABEL[c.claim_type] ?? c.claim_type)}</td>
      <td>${esc(c.shopify_order_id ?? '—')}<br><span class="muted">${esc(fmtDate(c.reported_at))}</span></td>
      <td>${c.product_image_url ? `<img class="zoom" src="${esc(c.product_image_url)}">` : ''}</td>
      <td><b>${esc(c.sku ?? '—')}</b> <span class="qtytag">×${c.quantity}</span><br>${esc(c.product_name ?? '')}${c.claim_type === 'erreur_envoi' ? `<br><span class="red">received in error: ${esc(c.received_product_name ?? c.received_sku ?? '—')} ×${c.quantity}</span>` : ''}${c.defect_description ? `<br><span class="muted">${esc(c.defect_description)}</span>` : ''}</td>
      <td>${esc(milestonesSummary(c.milestones))}</td>
      <td>${esc(c.reship_tracking_ref ?? '—')}${c.return_tracking_ref ? `<br>return ${esc(c.return_tracking_ref)}` : ''}</td>
      <td>${c.validated_by ? esc(c.validated_by) : '<span class="muted">—</span>'}</td>
      <td>${c.photo_url ? `<img class="zoom" src="${esc(c.photo_url)}">` : ''}</td>
    </tr>`).join('')
    return head + body
  }).join('')

  const periodNote = opts.monthLabel ? ` · period ${esc(opts.monthLabel)}` : ''
  const printBtn = opts.autoPrint
    ? '<script>window.onload=function(){setTimeout(function(){window.print()},300)}</script>'
    : '<button class="printbtn no-print" onclick="window.print()">🖨 Print / Save as PDF</button>'

  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
  <title>After-sales Mōom${opts.monthLabel ? ` — ${esc(opts.monthLabel)}` : ''}</title>
  <style>
    *{font-family:-apple-system,Segoe UI,Roboto,sans-serif;box-sizing:border-box}
    body{margin:24px;color:#1a1a18}
    h1{font-size:18px;margin:0 0 2px} .sub{color:#6b6b63;font-size:12px;margin:0 0 16px}
    table{width:100%;border-collapse:collapse;font-size:11px}
    th{text-align:left;background:#f5f5f3;padding:6px 8px;font-size:9px;text-transform:uppercase;letter-spacing:.05em;color:#6b6b63}
    td{padding:6px 8px;border-bottom:1px solid #eee;vertical-align:top}
    td.lot{background:#eef2ff;font-weight:700;color:#1a1a2e;font-size:11px}
    img{width:38px;height:38px;object-fit:cover;border-radius:6px;border:1px solid #e8e8e4}
    img.zoom{cursor:zoom-in} img.zoom:hover{border-color:#1a1a2e}
    .lightbox{display:none;position:fixed;inset:0;background:rgba(0,0,0,.88);z-index:9999;align-items:center;justify-content:center;cursor:zoom-out}
    .lightbox img{width:auto;height:auto;max-width:94vw;max-height:94vh;border-radius:10px;border:none;box-shadow:0 8px 40px rgba(0,0,0,.5)}
    .muted{color:#9b9b93} .red{color:#c7293a} .muted,.red{font-size:10px}
    .qtytag{display:inline-block;background:#1a1a2e;color:#fff;border-radius:5px;padding:0 5px;font-size:10px;font-weight:700}
    .summary{display:flex;gap:14px;margin:4px 0 20px;page-break-inside:avoid}
    .sumbox{flex:1;border:1px solid #e8e8e4;border-radius:8px;overflow:hidden}
    .sumbox h2{margin:0;padding:8px 10px;font-size:11px;color:#fff;font-weight:700}
    .sumbox.repro h2{background:#1a7f4b} .sumbox.nobill h2{background:#c7293a}
    .sumbox table{font-size:11px} .sumbox td{padding:5px 10px;border-bottom:1px solid #f0f0ee;vertical-align:top}
    .sumbox td.qty{text-align:right;font-weight:700;white-space:nowrap}
    .sumbox tr.tot td{border-top:2px solid #e8e8e4;font-weight:800;background:#fafafa}
    .printbtn{position:fixed;top:16px;right:16px;background:#1a1a2e;color:#fff;border:none;border-radius:10px;padding:8px 14px;font-size:13px;font-weight:600;cursor:pointer;box-shadow:0 4px 16px rgba(0,0,0,.15)}
    @media print{body{margin:12mm} .no-print{display:none}}
  </style></head><body>
  ${printBtn.startsWith('<button') ? printBtn : ''}
  <h1>After-sales / Defects &amp; shipping errors — Mōom</h1>
  <p class="sub">Generated on ${esc(fmtDate(new Date().toISOString().slice(0, 10)))}${periodNote}</p>

  <div class="summary">
    <div class="sumbox repro">
      <h2>🔁 To reproduce &amp; reship — defective units</h2>
      <table><tbody>${sumTable(toRepro, 'No defective items.')}</tbody></table>
    </div>
    <div class="sumbox nobill">
      <h2>🚫 Returned in error — do NOT bill us</h2>
      <table><tbody>${sumTable(noBill, 'No shipping errors.')}</tbody></table>
    </div>
  </div>

  <table><thead><tr>
    <th>Type</th><th>Order</th><th>Img</th><th>Item</th><th>Milestones</th><th>Tracking</th><th>Validated by</th><th>Photo</th>
  </tr></thead><tbody>${rows}</tbody></table>
  ${printBtn.startsWith('<script') ? printBtn : ''}
  <div id="lb" class="lightbox no-print"><img alt=""></div>
  <script>document.addEventListener('click',function(e){var lb=document.getElementById('lb');if(e.target.classList&&e.target.classList.contains('zoom')){lb.firstElementChild.src=e.target.src;lb.style.display='flex';}else if(e.target===lb||e.target===lb.firstElementChild){lb.style.display='none';}});document.addEventListener('keydown',function(e){if(e.key==='Escape')document.getElementById('lb').style.display='none';});</script>
  </body></html>`
}
