/**
 * Import solved Zendesk tickets into lib/sav/history.json
 *
 * Usage:
 *   npx tsx scripts/import-history.ts
 *
 * Requires ZENDESK_SUBDOMAIN, ZENDESK_EMAIL, ZENDESK_API_TOKEN in .env.local
 */

import * as dotenv from 'dotenv'
import path from 'path'

dotenv.config({ path: path.resolve(__dirname, '../.env.local') })

// Dynamic import after env is loaded
async function main() {
  const { importHistory } = await import('../lib/sav/history')

  console.log('Récupération des tickets résolus depuis Zendesk…')
  const { count } = await importHistory()
  console.log(`✓ ${count} exemples importés → lib/sav/history.json`)
}

main().catch((err) => {
  console.error('Erreur :', err)
  process.exit(1)
})
