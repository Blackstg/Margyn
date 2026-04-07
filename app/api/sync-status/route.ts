import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

export const maxDuration = 30

function getSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}

async function getLastSyncPerPlatform(
  supabase: ReturnType<typeof getSupabase>,
  platforms: string[]
): Promise<Record<string, string | null>> {
  const results = await Promise.all(
    platforms.map(async (platform) => {
      const { data } = await supabase
        .from('ad_spends')
        .select('created_at')
        .eq('platform', platform)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle()
      return { platform, ts: (data as { created_at: string } | null)?.created_at ?? null }
    })
  )
  return Object.fromEntries(results.map(({ platform, ts }) => [platform, ts]))
}

async function getLastShopifySync(supabase: ReturnType<typeof getSupabase>): Promise<string | null> {
  const { data } = await supabase
    .from('daily_snapshots')
    .select('created_at')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  return (data as { created_at: string } | null)?.created_at ?? null
}

async function getLastShopifyOrder(): Promise<{ name: string; created_at: string } | null> {
  const shops = [
    { shop: process.env.SHOPIFY_BOWA_SHOP,  token: process.env.SHOPIFY_BOWA_ACCESS_TOKEN  },
    { shop: process.env.SHOPIFY_MOOM_SHOP,  token: process.env.SHOPIFY_MOOM_ACCESS_TOKEN  },
  ]

  let latest: { name: string; created_at: string } | null = null

  await Promise.all(shops.map(async ({ shop, token }) => {
    if (!shop || !token) return
    try {
      const res = await fetch(
        `https://${shop}/admin/api/2024-01/orders.json?limit=1&status=any&fields=name,created_at`,
        { headers: { 'X-Shopify-Access-Token': token } }
      )
      if (!res.ok) return
      const { orders } = await res.json() as { orders?: { name: string; created_at: string }[] }
      const order = orders?.[0]
      if (!order) return
      if (!latest || order.created_at > latest.created_at) {
        latest = { name: order.name, created_at: order.created_at }
      }
    } catch { /* ignore */ }
  }))

  return latest
}

export async function GET() {
  const supabase = getSupabase()

  const [adSyncs, shopifySync, lastOrder] = await Promise.all([
    getLastSyncPerPlatform(supabase, ['meta', 'google', 'pinterest']),
    getLastShopifySync(supabase),
    getLastShopifyOrder(),
  ])

  return NextResponse.json({
    marketing: {
      meta:      adSyncs['meta']      ?? null,
      google:    adSyncs['google']    ?? null,
      pinterest: adSyncs['pinterest'] ?? null,
    },
    shopify: {
      orders_sync: shopifySync,
      last_order:  lastOrder,
    },
  })
}
