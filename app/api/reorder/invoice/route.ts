// Import d'une facture fournisseur (PDF) dans Réappro.
//   POST ?brand=moom  (multipart, champ « file ») →
//     { invoice: ParsedInvoice, lines: [{ …ligne, variantId }], rate }   rate = 1 devise de la facture en €
// La facture est lue par Claude (sortie JSON contrainte), puis chaque ligne est
// rapprochée d'une variante (synonymes de couleurs et rapprochements déjà validés).
// Rien n'est enregistré ici : la commande est créée après relecture (action create_order).
import { NextRequest, NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import { createServerClient } from '@supabase/auth-helpers-nextjs'
import { effectiveBrands } from '@/lib/access'
import { createAdminClient } from '@/lib/supabase'
import { loadSettings } from '@/lib/reorder/data'
import { matchVariant } from '@/lib/reorder/invoice'
import { rateToEur, readInvoice } from '@/lib/reorder/readInvoice'

export const dynamic = 'force-dynamic'
export const maxDuration = 120

async function allowed(req: NextRequest, brand: string): Promise<boolean> {
  try {
    const sb = createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      { cookies: { getAll() { return req.cookies.getAll() }, setAll() {} } })
    const { data: { user } } = await sb.auth.getUser()
    return !!user && (effectiveBrands(user.user_metadata?.role, user.user_metadata?.brands) as string[]).includes(brand)
  } catch { return false }
}

export async function POST(req: NextRequest) {
  const brand = req.nextUrl.searchParams.get('brand') ?? ''
  if (!(await allowed(req, brand))) return NextResponse.json({ error: 'Non autorisé' }, { status: 403 })
  const form = await req.formData().catch(() => null)
  const file = form?.get('file')
  if (!(file instanceof File)) return NextResponse.json({ error: 'Ajoute un fichier PDF' }, { status: 400 })
  if (file.type && file.type !== 'application/pdf') return NextResponse.json({ error: 'Le fichier doit être un PDF' }, { status: 400 })
  if (file.size > 4_000_000) return NextResponse.json({ error: 'PDF trop lourd (4 Mo maximum)' }, { status: 400 })

  try {
    const invoice = await readInvoice(Buffer.from(await file.arrayBuffer()).toString('base64'))
    const db = createAdminClient()
    const [settings, { data: vs }] = await Promise.all([
      loadSettings(db, brand),
      db.from('product_variants').select('shopify_variant_id, product_title, variant_title').eq('brand', brand),
    ])
    const variants = ((vs ?? []) as { shopify_variant_id: string; product_title: string; variant_title: string | null }[])
      .map((v) => ({ id: v.shopify_variant_id, title: v.product_title, variantTitle: v.variant_title }))
    const lines = invoice.lines.map((l) => ({ ...l, variantId: matchVariant(l, variants, settings) }))
    return NextResponse.json({ invoice, lines, rate: await rateToEur(invoice.currency, invoice.date) })
  } catch (e) {
    const msg = e instanceof Anthropic.APIError ? `Lecture impossible (${e.status}). Réessaie dans un instant.` : (e as Error).message
    return NextResponse.json({ error: msg }, { status: 502 })
  }
}
