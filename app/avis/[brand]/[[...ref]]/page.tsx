// Page publique d'avis : /avis/<brand> (lien générique, ex. Omnisend) ou
// /avis/<brand>/<id>-<token> (lien personnel : Klaviyo, mail de livraison Bowa).
// ?note=1..5 pré-remplit la note (étoiles cliquables dans le mail), ?s=<source>.
import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { isReviewBrand, reviewBranding, verifyReviewRef } from '@/lib/reviews'
import { createAdminClient } from '@/lib/supabase'
import ReviewFlow from '@/components/reviews/ReviewFlow'

export const dynamic = 'force-dynamic'

type Props = { params: { brand: string; ref?: string[] }; searchParams: { note?: string; s?: string } }

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  if (!isReviewBrand(params.brand)) return {}
  const b = await reviewBranding(params.brand)
  return { title: `Votre avis — ${b.name}`, robots: { index: false, follow: false } }
}

export default async function AvisPage({ params, searchParams }: Props) {
  const { brand } = params
  if (!isReviewBrand(brand)) notFound()
  const ref = params.ref?.[0] ?? null
  const [branding, order] = await Promise.all([reviewBranding(brand), ref ? verifyReviewRef(brand, ref) : Promise.resolve(null)])

  // Déjà répondu pour cette commande ? (on affiche un merci, avec possibilité de changer)
  let previous: { rating: number; completed: boolean } | null = null
  if (order) {
    const { data } = await createAdminClient().from('review_responses').select('rating, completed').eq('brand', brand).eq('order_id', order.orderId).maybeSingle()
    previous = data ?? null
  }
  const note = Number(searchParams.note)

  return (
    <ReviewFlow
      brand={brand}
      branding={branding}
      refCode={order ? ref : null}
      firstName={order?.firstName || null}
      hasOrderEmail={!!order?.email}
      source={searchParams.s ?? null}
      initialRating={Number.isInteger(note) && note >= 1 && note <= 5 ? note : null}
      alreadyDone={previous?.completed ? previous.rating : null}
    />
  )
}
