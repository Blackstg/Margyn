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
  const { importHistoryBatch } = await import('../lib/sav/history')
  const batchSize = parseInt(process.env.IMPORT_BATCH ?? '25', 10)

  console.log(`Importation par batch de ${batchSize} tickets depuis Zendesk → Supabase…`)
  let done = false
  while (!done) {
    const result = await importHistoryBatch(batchSize)
    done = result.done
    console.log(`  +${result.imported} tickets → total ${result.total} (${result.oldest?.slice(0,10)} → ${result.newest?.slice(0,10)})`)
  }
  console.log(`✓ Import terminé`)
}

main().catch((err) => {
  console.error('Erreur :', err)
  process.exit(1)
})
