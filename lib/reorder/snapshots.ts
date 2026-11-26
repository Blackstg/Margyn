// Relevé du stock du jour par variante et par entrepôt (location Shopify), écrit à
// chaque synchro : la ligne du jour est écrasée, il reste donc le dernier relevé.
// Sert à Réappro pour repérer les jours de rupture et les réceptions.
import { fetchInventoryLevels, fetchLocations, type ShopifyConfig, type ShopifyProduct } from '@/lib/shopify'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = { from: (t: string) => any }

export const parisDay = (d = new Date()) => d.toLocaleDateString('sv-SE', { timeZone: 'Europe/Paris' })

export async function recordStockSnapshots(db: Db, config: ShopifyConfig, products: ShopifyProduct[]): Promise<number> {
  const variantByItem = new Map<number, string>()
  for (const p of products) for (const v of p.variants) variantByItem.set(v.inventory_item_id, String(v.id))
  if (!variantByItem.size) return 0

  const [locations, levels] = await Promise.all([
    fetchLocations(config).catch(() => new Map<number, string>()),
    fetchInventoryLevels(config, Array.from(variantByItem.keys())),
  ])
  const day = parisDay()
  const now = new Date().toISOString()
  const rows = levels
    .filter((l) => variantByItem.has(l.inventory_item_id))
    .map((l) => ({
      brand: config.brand,
      shopify_variant_id: variantByItem.get(l.inventory_item_id)!,
      location_id: String(l.location_id),
      location_name: locations.get(l.location_id) ?? null,
      day,
      stock: l.available ?? 0,
      updated_at: now,
    }))
  for (let i = 0; i < rows.length; i += 500) {
    const { error } = await db.from('stock_snapshots').upsert(rows.slice(i, i + 500), { onConflict: 'brand,shopify_variant_id,location_id,day' })
    if (error) throw new Error(`stock_snapshots upsert: ${error.message}`)
  }
  return rows.length
}
