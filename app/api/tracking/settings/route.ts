import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

function getAdmin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}

export async function GET(req: NextRequest) {
  const brand = req.nextUrl.searchParams.get('brand') ?? 'moom'
  const admin = getAdmin()

  // Fetch both tables in parallel — invoice_settings is the source of truth for branding
  const [{ data: tracking }, { data: invoice }] = await Promise.all([
    admin.from('tracking_settings').select('*').eq('brand', brand).single(),
    admin.from('invoice_settings').select('company_name,logo_url,color_primary,email').eq('brand', brand).single(),
  ])

  const merged = {
    // Branding from invoice_settings
    brand_name:    invoice?.company_name  ?? '',
    brand_logo_url: invoice?.logo_url     ?? '',
    brand_color:   invoice?.color_primary ?? '#111111',
    contact_email: invoice?.email         ?? '',
    // Tracking-specific settings
    brand_website:        tracking?.brand_website        ?? '',
    show_products:        tracking?.show_products        ?? true,
    show_address:         tracking?.show_address         ?? true,
    show_tracking_number: tracking?.show_tracking_number ?? true,
    show_tracking_link:   tracking?.show_tracking_link   ?? true,
    estimated_days_min:   tracking?.estimated_days_min   ?? 7,
    estimated_days_max:   tracking?.estimated_days_max   ?? 14,
  }

  return NextResponse.json({ settings: merged })
}

export async function PUT(req: NextRequest) {
  const brand = req.nextUrl.searchParams.get('brand') ?? 'moom'
  const body  = await req.json()
  const admin = getAdmin()

  // Only save tracking-specific fields — branding lives in invoice_settings
  const { error } = await admin.from('tracking_settings').upsert({
    brand,
    brand_website:        body.brand_website,
    show_products:        body.show_products,
    show_address:         body.show_address,
    show_tracking_number: body.show_tracking_number,
    show_tracking_link:   body.show_tracking_link,
    estimated_days_min:   body.estimated_days_min,
    estimated_days_max:   body.estimated_days_max,
    updated_at:           new Date().toISOString(),
  })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
