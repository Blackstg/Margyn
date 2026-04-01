/**
 * Historical Shopify sync — runs locally against the Next.js dev server.
 * Chunks 2025-01-01 → today by month to avoid timeouts.
 *
 * Usage: node scripts/historical-shopify-sync.mjs
 * (Next.js dev server must be running on localhost:3000)
 */

import { readFileSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

// ─── Load .env.local ──────────────────────────────────────────────────────────

const __dirname = dirname(fileURLToPath(import.meta.url))
const envPath   = join(__dirname, '..', '.env.local')
const envVars   = {}

for (const line of readFileSync(envPath, 'utf8').split('\n')) {
  const trimmed = line.trim()
  if (!trimmed || trimmed.startsWith('#')) continue
  const eqIdx = trimmed.indexOf('=')
  if (eqIdx === -1) continue
  envVars[trimmed.slice(0, eqIdx).trim()] = trimmed.slice(eqIdx + 1).trim()
}

const SECRET = envVars['CRON_SECRET'] ?? ''
const BASE   = 'http://localhost:3000'

// ─── Config ───────────────────────────────────────────────────────────────────

const BRANDS     = ['bowa', 'moom']
const START_YEAR = 2025
const START_MONTH = 1 // January

// ─── Helpers ─────────────────────────────────────────────────────────────────

function pad(n) { return String(n).padStart(2, '0') }

function monthChunks(startYear, startMonth) {
  const chunks = []
  const today  = new Date()
  let y = startYear, m = startMonth

  while (y < today.getFullYear() || (y === today.getFullYear() && m <= today.getMonth() + 1)) {
    const from = `${y}-${pad(m)}-01`
    const lastDay = new Date(y, m, 0).getDate()
    const toDate  = new Date(y, m - 1, lastDay)
    if (toDate > today) toDate.setTime(today.getTime())
    const to = `${toDate.getFullYear()}-${pad(toDate.getMonth() + 1)}-${pad(toDate.getDate())}`
    chunks.push({ from, to })
    m++
    if (m > 12) { m = 1; y++ }
  }

  return chunks
}

// ─── Main ─────────────────────────────────────────────────────────────────────

const chunks = monthChunks(START_YEAR, START_MONTH)
console.log(`\n📅 ${chunks.length} monthly chunks from ${chunks[0].from} to ${chunks[chunks.length - 1].to}\n`)

let totalErrors = 0

for (const brand of BRANDS) {
  console.log(`\n${'─'.repeat(60)}`)
  console.log(`🏪 Brand: ${brand.toUpperCase()}`)
  console.log(`${'─'.repeat(60)}`)

  for (const { from, to } of chunks) {
    const url = `${BASE}/api/shopify/sync?brand=${brand}&from=${from}&to=${to}`
    process.stdout.write(`  ${from} → ${to} … `)

    try {
      const res  = await fetch(url, {
        method: 'POST',
        headers: { Authorization: `Bearer ${SECRET}` },
      })
      const body = await res.json()

      if (!res.ok || body.results?.[brand]?.error) {
        const err = body.results?.[brand]?.error ?? `HTTP ${res.status}`
        console.log(`❌ ${err}`)
        totalErrors++
      } else {
        const r = body.results?.[brand] ?? {}
        console.log(`✅ ${r.snapshots ?? 0} snapshots, ${r.product_sales ?? 0} product_sales rows`)
      }
    } catch (err) {
      console.log(`❌ fetch error: ${err.message}`)
      totalErrors++
    }
  }
}

console.log(`\n${'─'.repeat(60)}`)
if (totalErrors === 0) {
  console.log('✅ Sync terminé sans erreur.')
} else {
  console.log(`⚠️  Sync terminé avec ${totalErrors} erreur(s).`)
}
console.log()
