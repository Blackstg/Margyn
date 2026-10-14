import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

export const dynamic = 'force-dynamic'

function getAdmin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  )
}

// ── Parsing CSV minimal (gère guillemets + échappement "") ──────────────────
function parseCSV(text: string): string[][] {
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

// Nombre au format FR : "5 074" → 5074 ; "130 607,09" → 130607.09 ; "-" / "" → null ; "-112" → -112
function parseNum(s: string | undefined): number | null {
  if (s == null) return null
  let t = String(s).trim()
  if (t === '' || t === '-') return null
  const neg = /^-/.test(t)
  t = t.replace(/[^0-9,.]/g, '')          // retire espaces (milliers), symboles
  if (t === '') return null
  t = t.replace(/\./g, '').replace(',', '.')  // point = millier (FR), virgule = décimale
  let v = parseFloat(t)
  if (isNaN(v)) return null
  if (neg) v = -v
  return v
}

// Convertit n'importe quel lien publié (/pubhtml, /pub, …) en export CSV.
function toCsvUrl(url: string): string {
  const u = url.trim()
  if (/output=csv/.test(u)) return u
  if (/\/pubhtml/.test(u)) return u.replace(/\/pubhtml.*$/, '/pub?output=csv')
  if (/\/pub(\?|$)/.test(u)) return u.includes('?') ? `${u}&output=csv` : `${u}?output=csv`
  return u
}

// GET ?brand=bowa&month=YYYY-MM
// → { rows: [{label, amount}], month, year, found }  (ne persiste rien : l'UI valide puis enregistre)
export async function GET(req: NextRequest) {
  try {
    const brand = req.nextUrl.searchParams.get('brand') ?? 'bowa'
    const month = req.nextUrl.searchParams.get('month') ?? ''      // 'YYYY-MM'
    const m = /^(\d{4})-(\d{2})$/.exec(month)
    if (!m) return NextResponse.json({ error: 'Paramètre month invalide (attendu YYYY-MM)' }, { status: 400 })
    const wantYear  = parseInt(m[1], 10)
    const wantMonth = parseInt(m[2], 10)

    const admin = getAdmin()
    const { data: settings } = await admin
      .from('brand_settings').select('fulfillment_sheet_url').eq('brand', brand).single()
    const sheetUrl = settings?.fulfillment_sheet_url as string | null | undefined
    if (!sheetUrl) {
      return NextResponse.json({ error: 'Aucune URL Google Sheets configurée pour cette marque.' }, { status: 400 })
    }

    const csvUrl = toCsvUrl(sheetUrl)
    const res = await fetch(csvUrl, { redirect: 'follow', cache: 'no-store' })
    if (!res.ok) {
      return NextResponse.json({ error: `Lecture de la feuille échouée (HTTP ${res.status}). Vérifie que la feuille est bien « publiée sur le web » en CSV.` }, { status: 502 })
    }
    const csv = await res.text()
    if (/<html/i.test(csv.slice(0, 200))) {
      return NextResponse.json({ error: 'La feuille renvoie du HTML (pas publiée en CSV). Refais Fichier → Publier sur le web → CSV.' }, { status: 502 })
    }

    const rows = parseCSV(csv)

    // Année : extraite du titre (« … au 30/09/2026 »), sinon on fait confiance au mois demandé.
    let sheetYear: number | null = null
    for (const r of rows.slice(0, 4)) {
      const mm = /(\d{2})\/(\d{2})\/(\d{4})/g
      let match: RegExpExecArray | null
      while ((match = mm.exec(r.join(' '))) !== null) sheetYear = parseInt(match[3], 10)
    }

    // Ligne d'en-tête : celle dont la 1re cellule commence par « poste ».
    const hi = rows.findIndex(r => norm(r[0] ?? '').startsWith('poste'))
    if (hi < 0) return NextResponse.json({ error: 'En-tête « Poste » introuvable dans la feuille.' }, { status: 422 })
    const header = rows[hi]

    // Colonne du mois demandé.
    let targetCol = -1
    header.forEach((h, i) => {
      const n = norm(h)
      for (const key in MONTHS) {
        if (n === key && MONTHS[key] === wantMonth) targetCol = i
      }
    })
    if (targetCol < 0) {
      return NextResponse.json({ rows: [], month, year: sheetYear, found: false,
        error: `Le mois demandé n'est pas (encore) dans la feuille.` })
    }

    // Avertit si l'année de la feuille ≠ année demandée (données d'une autre année).
    const yearMismatch = sheetYear != null && sheetYear !== wantYear

    const out: { label: string; amount: number }[] = []
    for (let i = hi + 1; i < rows.length; i++) {
      const r = rows[i]
      const label = (r[0] ?? '').trim()
      if (!label) continue
      const ln = label.toLowerCase()
      if (ln.startsWith('total') || ln.startsWith('moyenne')) continue   // lignes de synthèse
      const v = parseNum(r[targetCol])
      if (v === null || v === 0) continue
      out.push({ label, amount: Math.round(v * 100) / 100 })
    }

    return NextResponse.json({
      rows: out,
      month,
      year: sheetYear,
      yearMismatch,
      found: true,
      total: Math.round(out.reduce((s, o) => s + o.amount, 0) * 100) / 100,
    })
  } catch (err) {
    console.error('[margins/fulfillment-import]', err)
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 })
  }
}
