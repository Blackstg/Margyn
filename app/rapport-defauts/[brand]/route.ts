import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { buildDefectReportHtml, type DefectClaim } from '@/lib/sav/defect-report'
import { verifyReportToken } from '@/lib/sav/report-token'

export const dynamic = 'force-dynamic'

// Page publique partageable au fournisseur : /rapport-defauts/moom?t=<token>
// Protégée par un token signé (non devinable). Sert le même rapport que l'export PDF.
export async function GET(req: NextRequest, { params }: { params: { brand: string } }) {
  const { brand } = params
  const token = req.nextUrl.searchParams.get('t')

  if (!verifyReportToken(brand, token)) {
    return new NextResponse('Lien invalide ou expiré.', { status: 403 })
  }

  const admin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  )

  const { data, error } = await admin
    .from('defect_claims')
    .select('claim_type, reported_at, sku, product_name, shopify_order_id, received_sku, received_product_name, quantity, defect_description, photo_url, product_image_url, milestones, production_batch, validated_by, reship_tracking_ref, return_tracking_ref')
    .eq('brand', brand)
    .order('reported_at', { ascending: false })

  if (error) return new NextResponse('Erreur de chargement du rapport.', { status: 500 })

  const html = buildDefectReportHtml((data ?? []) as DefectClaim[], { autoPrint: false })
  return new NextResponse(html, {
    status: 200,
    headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' },
  })
}
