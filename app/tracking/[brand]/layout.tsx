import { Metadata } from 'next'
import { createAdminClient } from '@/lib/supabase'

export async function generateMetadata(
  { params }: { params: { brand: string } }
): Promise<Metadata> {
  const { brand } = params
  const supabase = createAdminClient()

  const { data: invoice } = await supabase
    .from('invoice_settings')
    .select('company_name, logo_url')
    .eq('brand', brand)
    .single()

  const { data: tracking } = await supabase
    .from('tracking_settings')
    .select('brand_website')
    .eq('brand', brand)
    .maybeSingle()

  const brandName = invoice?.company_name || (brand.charAt(0).toUpperCase() + brand.slice(1))
  const logoUrl   = invoice?.logo_url ?? null
  const siteUrl   = tracking?.brand_website ?? null

  return {
    title:       `Suivi de commande — ${brandName}`,
    description: `Suivez votre commande ${brandName} en temps réel.`,
    openGraph: {
      title:       `Suivi de commande — ${brandName}`,
      description: `Suivez votre commande ${brandName} en temps réel.`,
      ...(siteUrl ? { url: siteUrl } : {}),
      siteName: brandName,
      ...(logoUrl ? { images: [{ url: logoUrl, width: 400, height: 400, alt: brandName }] } : {}),
    },
    twitter: {
      card:        'summary',
      title:       `Suivi de commande — ${brandName}`,
      description: `Suivez votre commande ${brandName} en temps réel.`,
      ...(logoUrl ? { images: [logoUrl] } : {}),
    },
  }
}

export default function TrackingBrandLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>
}
