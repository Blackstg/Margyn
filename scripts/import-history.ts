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
  const limit = parseInt(process.env.IMPORT_LIMIT ?? '500', 10)

  console.log(`Récupération des tickets résolus depuis Zendesk (max ${limit})…`)
  const { count, oldest, newest } = await importHistory(limit)
  console.log(`✓ ${count} exemples importés → lib/sav/history.json`)
  console.log(`  Période : ${oldest?.slice(0,10)} → ${newest?.slice(0,10)}`)
}

main().catch((err) => {
  console.error('Erreur :', err)
  process.exit(1)
})
