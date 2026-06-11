// GET  /api/tracking/carrier-logos          → { logos: { colissimo, colis-prive, gofo } }
// POST /api/tracking/carrier-logos?id=colissimo  (multipart) → { url }

import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase'

export const dynamic = 'force-dynamic'

const BUCKET   = 'carrier-logos'
const CARRIERS = ['colissimo', 'colis-prive', 'gofo'] as const
type CarrierId = typeof CARRIERS[number]

async function ensureBucket(supabase: ReturnType<typeof createAdminClient>) {
  const { data: buckets } = await supabase.storage.listBuckets()
  const exists = buckets?.some((b) => b.name === BUCKET)
  if (!exists) {
    await supabase.storage.createBucket(BUCKET, { public: true, allowedMimeTypes: ['image/*'] })
  }
}

async function getPublicUrl(supabase: ReturnType<typeof createAdminClient>, carrier: CarrierId): Promise<string | null> {
  // Try common extensions
  for (const ext of ['png', 'jpg', 'jpeg', 'svg', 'webp']) {
    const path = `${carrier}.${ext}`
    const { data } = supabase.storage.from(BUCKET).getPublicUrl(path)
    // Verify the file actually exists
    const { error } = await supabase.storage.from(BUCKET).download(path)
    if (!error) return data.publicUrl
  }
  return null
}

export async function GET() {
  const supabase = createAdminClient()
  await ensureBucket(supabase)
  const logos: Partial<Record<CarrierId, string>> = {}

  await Promise.all(
    CARRIERS.map(async (id) => {
      const url = await getPublicUrl(supabase, id)
      if (url) logos[id] = url
    })
  )

  return NextResponse.json({ logos })
}

export async function POST(req: NextRequest) {
  const carrierId = req.nextUrl.searchParams.get('id') as CarrierId | null
  if (!carrierId || !CARRIERS.includes(carrierId)) {
    return NextResponse.json({ error: 'Carrier id invalide' }, { status: 400 })
  }

  const formData = await req.formData().catch(() => null)
  if (!formData) return NextResponse.json({ error: 'Multipart invalide' }, { status: 400 })

  const file = formData.get('file')
  if (!file || typeof file === 'string') {
    return NextResponse.json({ error: 'Champ "file" manquant' }, { status: 400 })
  }

  const ext      = file.name.split('.').pop()?.toLowerCase() ?? 'png'
  const path     = `${carrierId}.${ext}`
  const buffer   = await file.arrayBuffer()
  const supabase = createAdminClient()
  await ensureBucket(supabase)

  // Remove old versions with other extensions first
  for (const oldExt of ['png', 'jpg', 'jpeg', 'svg', 'webp']) {
    if (oldExt !== ext) {
      await supabase.storage.from(BUCKET).remove([`${carrierId}.${oldExt}`])
    }
  }

  const { error } = await supabase.storage
    .from(BUCKET)
    .upload(path, buffer, {
      contentType: file.type || 'image/png',
      upsert: true,
    })

  if (error) {
    console.error('[carrier-logos] upload error:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  const { data } = supabase.storage.from(BUCKET).getPublicUrl(path)
  return NextResponse.json({ url: data.publicUrl })
}
