// POST /api/delivery/stops/:id/upload
// Accepts multipart/form-data with optional 'signature' (PNG blob) and 'photo' (image file).
// Uploads to Supabase Storage bucket 'delivery-proof' and returns public URLs.

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

const BUCKET = 'delivery-proof'

function getAdmin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}

async function ensureBucket(admin: ReturnType<typeof getAdmin>) {
  const { data: buckets } = await admin.storage.listBuckets()
  if (!buckets?.find((b) => b.name === BUCKET)) {
    await admin.storage.createBucket(BUCKET, { public: true })
  }
}

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const admin = getAdmin()
    await ensureBucket(admin)

    const form = await req.formData()
    const signatureBlob = form.get('signature') as Blob | null
    const photoBlob     = form.get('photo')     as File | null

    const baseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
    const result: { signature_url?: string; photo_url?: string } = {}

    if (signatureBlob && signatureBlob.size > 0) {
      const path = `${params.id}/signature.png`
      const buf  = Buffer.from(await signatureBlob.arrayBuffer())
      const { error } = await admin.storage.from(BUCKET).upload(path, buf, {
        contentType: 'image/png',
        upsert: true,
      })
      if (error) throw error
      result.signature_url = `${baseUrl}/storage/v1/object/public/${BUCKET}/${path}`
    }

    if (photoBlob && photoBlob.size > 0) {
      const ext  = (photoBlob.name ?? 'photo.jpg').split('.').pop() ?? 'jpg'
      const path = `${params.id}/photo.${ext}`
      const buf  = Buffer.from(await photoBlob.arrayBuffer())
      const { error } = await admin.storage.from(BUCKET).upload(path, buf, {
        contentType: photoBlob.type || 'image/jpeg',
        upsert: true,
      })
      if (error) throw error
      result.photo_url = `${baseUrl}/storage/v1/object/public/${BUCKET}/${path}`
    }

    return NextResponse.json(result)
  } catch (err) {
    console.error('[delivery/stops/:id/upload POST]', err)
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
