// Lecture de la feuille Google Sheets « Coût du transport » (publiée en CSV).
// Mois en colonnes, postes en lignes, format FR. Partagé entre l'import manuel
// (/api/margins/fulfillment-import) et la synchro auto (/api/margins/fulfillment-sync).

export type SheetPost = { label: string; amount: number }
export type SheetMonth = { year: number; month: number; posts: SheetPost[]; total: number }

// ── CSV minimal (guillemets + échappement "") ──────────────────────────────
export function parseCSV(text: string): string[][] {
  const rows: string[][] = []
  let row: string[] = [], cur = '', q = false
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (q) {
      if (c === '"') { if (text[i + 1] === '"') { cur += '"'; i++ } else q = false }
      else cur += c
    } else {
      if (c === '"') q = true
      else if (c === ',') { row.push(cur); cur = '' }
      else if (c === '\n') { row.push(cur); rows.push(row); row = []; cur = '' }
      else if (c === '\r') { /* ignore */ }
      else cur += c
    }
  }
  if (cur !== '' || row.length) { row.push(cur); rows.push(row) }
  return rows
}

const MONTHS: Record<string, number> = {
  janv: 1, fevr: 2, mars: 3, avr: 4, mai: 5, juin: 6,
  juil: 7, aout: 8, sept: 9, oct: 10, nov: 11, dec: 12,
}
const norm = (s: string) =>
  (s ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\./g, '').trim()

// Nombre FR : "5 074" → 5074 ; "130 607,09" → 130607.09 ; "-" / "" → null ; "-112" → -112
export function parseNum(s: string | undefined): number | null {
  if (s == null) return null
  let t = String(s).trim()
  if (t === '' || t === '-') return null
  const neg = /^-/.test(t)
  t = t.replace(/[^0-9,.]/g, '')
  if (t === '') return null
  t = t.replace(/\./g, '').replace(',', '.')
  let v = parseFloat(t)
  if (isNaN(v)) return null
  if (neg) v = -v
  return v
}

// Convertit tout lien publié (/pubhtml, /pub, …) en export CSV.
export function toCsvUrl(url: string): string {
  const u = url.trim()
  if (/output=csv/.test(u)) return u
  if (/\/pubhtml/.test(u)) return u.replace(/\/pubhtml.*$/, '/pub?output=csv')
  if (/\/pub(\?|$)/.test(u)) return u.includes('?') ? `${u}&output=csv` : `${u}?output=csv`
  return u
}

export async function fetchSheetCsv(sheetUrl: string): Promise<string> {
  const res = await fetch(toCsvUrl(sheetUrl), { redirect: 'follow', cache: 'no-store' })
  if (!res.ok) throw new Error(`Lecture de la feuille échouée (HTTP ${res.status}).`)
  const csv = await res.text()
  if (/<html/i.test(csv.slice(0, 200))) {
    throw new Error('La feuille renvoie du HTML (pas publiée en CSV).')
  }
  return csv
}

// Postes = lignes entre l'en-tête « Poste » et les lignes de synthèse (Total/Moyenne),
// dont le montant du mois demandé n'est ni vide ni nul.
function postsForColumn(rows: string[][], headerIdx: number, col: number): SheetPost[] {
  const out: SheetPost[] = []
  for (let i = headerIdx + 1; i < rows.length; i++) {
    const r = rows[i]
    const label = (r[0] ?? '').trim()
    if (!label) continue
    const ln = label.toLowerCase()
    if (ln.startsWith('total') || ln.startsWith('moyenne')) continue
    const v = parseNum(r[col])
    if (v === null || v === 0) continue
    out.push({ label, amount: Math.round(v * 100) / 100 })
  }
  return out
}

// Année extraite du titre (« … au 30/09/2026 »), sinon null.
function yearFromRows(rows: string[][]): number | null {
  let year: number | null = null
  for (const r of rows.slice(0, 4)) {
    const re = /(\d{2})\/(\d{2})\/(\d{4})/g
    let m: RegExpExecArray | null
    while ((m = re.exec(r.join(' '))) !== null) year = parseInt(m[3], 10)
  }
  return year
}

function headerIndex(rows: string[][]): number {
  return rows.findIndex(r => norm(r[0] ?? '').startsWith('poste'))
}

// Tous les mois présents dans la feuille (une entrée par colonne-mois).
export function parseAllMonths(csv: string): { year: number | null; months: SheetMonth[] } {
  const rows = parseCSV(csv)
  const year = yearFromRows(rows)
  const hi = headerIndex(rows)
  if (hi < 0) return { year, months: [] }
  const header = rows[hi]
  const months: SheetMonth[] = []
  header.forEach((h, col) => {
    const n = norm(h)
    const month = MONTHS[n]
    if (!month) return
    const posts = postsForColumn(rows, hi, col)
    if (posts.length === 0) return
    months.push({ year: year ?? 0, month, posts, total: Math.round(posts.reduce((s, p) => s + p.amount, 0) * 100) / 100 })
  })
  return { year, months }
}

// Un seul mois (pour l'import manuel). wantMonth = 1..12
export function parseOneMonth(csv: string, wantMonth: number): { year: number | null; found: boolean; posts: SheetPost[]; total: number } {
  const { year, months } = parseAllMonths(csv)
  const hit = months.find(m => m.month === wantMonth)
  return { year, found: !!hit, posts: hit?.posts ?? [], total: hit?.total ?? 0 }
}
