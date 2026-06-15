// POST /api/sav-defects/:id/upload
// Accepts multipart/form-data with a 'photo' image file.
// Uploads to Supabase Storage bucket 'defect-photos', patches photo_url, returns it.

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

const BUCKET = 'defect-photos'

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
    const photoBlob = form.get('photo') as File | null
    if (!photoBlob || photoBlob.size === 0) {
      return NextResponse.json({ error: 'photo manquante' }, { status: 400 })
    }

    const ext  = (photoBlob.name ?? 'photo.jpg').split('.').pop() ?? 'jpg'
    const path = `${params.id}/photo.${ext}`
    const buf  = Buffer.from(await photoBlob.arrayBuffer())
    const { error } = await admin.storage.from(BUCKET).upload(path, buf, {
      contentType: photoBlob.type || 'image/jpeg',
      upsert: true,
    })
    if (error) throw error

    const photo_url = `${process.env.NEXT_PUBLIC_SUPABASE_URL!}/storage/v1/object/public/${BUCKET}/${path}`
    await admin.from('defect_claims').update({ photo_url, updated_at: new Date().toISOString() }).eq('id', params.id)

    return NextResponse.json({ photo_url })
  } catch (err) {
    console.error('[sav-defects/:id/upload POST]', err)
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
