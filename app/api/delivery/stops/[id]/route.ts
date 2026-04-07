import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

function getAdmin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const body = await req.json()
    const { status, sequence, email_sent_at } = body as {
      status?: string
      sequence?: number
      email_sent_at?: string
    }

    const updates: Record<string, unknown> = {}
    if (status !== undefined) {
      updates.status = status
      if (status === 'delivered') {
        updates.delivered_at = new Date().toISOString()
      }
    }
    if (sequence !== undefined) updates.sequence = sequence
    if (email_sent_at !== undefined) updates.email_sent_at = email_sent_at

    const admin = getAdmin()
    const { data, error } = await admin
      .from('delivery_stops')
      .update(updates)
      .eq('id', params.id)
      .select()
      .single()

    if (error) throw error

    return NextResponse.json({ stop: data })
  } catch (err) {
    console.error('[delivery/stops/:id PATCH]', err)
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const admin = getAdmin()
    const { error } = await admin
      .from('delivery_stops')
      .delete()
      .eq('id', params.id)

    if (error) throw error

    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error('[delivery/stops/:id DELETE]', err)
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
