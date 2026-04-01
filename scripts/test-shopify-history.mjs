/**
 * Quick test — directly query Shopify REST API for 2025 orders count.
 */

import { readFileSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

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

const STORES = [
  { brand: 'bowa', shop: envVars['SHOPIFY_BOWA_SHOP'], token: envVars['SHOPIFY_BOWA_ACCESS_TOKEN'] },
  { brand: 'moom', shop: envVars['SHOPIFY_MOOM_SHOP'], token: envVars['SHOPIFY_MOOM_ACCESS_TOKEN'] },
]

for (const { brand, shop, token } of STORES) {
  console.log(`\n── ${brand.toUpperCase()} (${shop}) ──`)

  // Count orders in 2025
  const url = `https://${shop}/admin/api/2024-01/orders/count.json?status=any&created_at_min=2025-01-01T00:00:00Z&created_at_max=2025-12-31T23:59:59Z`
  const res = await fetch(url, { headers: { 'X-Shopify-Access-Token': token } })
  const body = await res.json()

  if (!res.ok) {
    console.log(`  ❌ HTTP ${res.status}:`, body)
    continue
  }
  console.log(`  Orders in 2025: ${body.count}`)

  // Also count total orders (no date filter) to confirm token works
  const totalRes  = await fetch(
    `https://${shop}/admin/api/2024-01/orders/count.json?status=any`,
    { headers: { 'X-Shopify-Access-Token': token } }
  )
  const totalBody = await totalRes.json()
  console.log(`  Total orders (all time): ${totalBody.count}`)

  // Check scopes
  const scopeRes  = await fetch(
    `https://${shop}/admin/api/2024-01/access_scopes.json`,
    { headers: { 'X-Shopify-Access-Token': token } }
  )
  const scopeBody = await scopeRes.json()
  const scopes = (scopeBody.access_scopes ?? []).map(s => s.handle).join(', ')
  console.log(`  Scopes: ${scopes || '(none returned)'}`)
}
