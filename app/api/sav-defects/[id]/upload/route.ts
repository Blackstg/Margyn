// POST /api/sav-defects/:id/upload
// Accepts multipart/form-data with a 'photo' (image) OR 'return_label' (image/PDF) file.
// Uploads to Supabase Storage bucket 'defect-photos', patches the matching column, returns the URL.

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
    const isLabel = form.get('return_label') instanceof Blob
    const blob = (form.get('return_label') ?? form.get('photo')) as File | null
    if (!blob || blob.size === 0) {
      return NextResponse.json({ error: 'fichier manquant' }, { status: 400 })
    }

    const kind = isLabel ? 'return-label' : 'photo'
    const ext  = (blob.name ?? 'file').split('.').pop() ?? (isLabel ? 'pdf' : 'jpg')
    const path = `${params.id}/${kind}.${ext}`
    const buf  = Buffer.from(await blob.arrayBuffer())
    const { error } = await admin.storage.from(BUCKET).upload(path, buf, {
      contentType: blob.type || (isLabel ? 'application/pdf' : 'image/jpeg'),
      upsert: true,
    })
    if (error) throw error

    const url = `${process.env.NEXT_PUBLIC_SUPABASE_URL!}/storage/v1/object/public/${BUCKET}/${path}`
    const column = isLabel ? 'return_label_url' : 'photo_url'
    await admin.from('defect_claims').update({ [column]: url, updated_at: new Date().toISOString() }).eq('id', params.id)

    return NextResponse.json({ [column]: url })
  } catch (err) {
    console.error('[sav-defects/:id/upload POST]', err)
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
