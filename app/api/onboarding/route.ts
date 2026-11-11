// Onboarding d'une marque (page /[brand]/onboarding + bandeau) — admins de la marque.
// GET ?brand=  → état de la checklist
// POST {brand, action, …} → importBranding | identity | logo (multipart) | meta | google | costs | history | skip
import { NextRequest, NextResponse } from 'next/server'
import { BRANDS } from '@/lib/access'
import { adminSession, withCookies } from '@/lib/shopify/app'
import {
  backfillHistory, connectGoogle, connectMeta, importShopifyBranding, onboardingStatus,
  refreshCostsFromShopify, saveCosts, saveIdentity, setSkipped, uploadLogo, type StepKey,
} from '@/lib/onboarding'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

const STEPS: StepKey[] = ['shopify', 'identity', 'meta', 'google', 'products', 'shipping', 'team']

export async function GET(req: NextRequest) {
  const brand = req.nextUrl.searchParams.get('brand') ?? ''
  if (!(BRANDS as string[]).includes(brand)) return NextResponse.json({ error: 'Marque inconnue' }, { status: 400 })
  const auth = await adminSession(req, brand)
  if (!auth.admin) return withCookies(NextResponse.json({ error: 'Réservé aux admins' }, { status: 403 }), auth.refreshed)
  return withCookies(NextResponse.json(await onboardingStatus(brand)), auth.refreshed)
}

export async function POST(req: NextRequest) {
  const isForm = (req.headers.get('content-type') ?? '').startsWith('multipart/')
  const form = isForm ? await req.formData() : null
  const body = form ? Object.fromEntries(form.entries()) : await req.json().catch(() => ({}))
  const brand = String(body.brand ?? '')
  if (!(BRANDS as string[]).includes(brand)) return NextResponse.json({ error: 'Marque inconnue' }, { status: 400 })
  const auth = await adminSession(req, brand)
  if (!auth.admin) return withCookies(NextResponse.json({ error: 'Réservé aux admins' }, { status: 403 }), auth.refreshed)

  const reply = (r: { error?: string | null } & Record<string, unknown>) =>
    withCookies(NextResponse.json(r, { status: r.error ? 400 : 200 }), auth.refreshed)

  switch (body.action) {
    case 'importBranding': return reply(await importShopifyBranding(brand))
    case 'identity': {
      const name = String(body.name ?? '').trim()
      if (!name) return reply({ error: 'Nom requis' })
      return reply({ error: await saveIdentity(brand, name, String(body.logoUrl ?? '') || null) })
    }
    case 'logo': {
      const file = form?.get('file')
      if (!(file instanceof File)) return reply({ error: 'Fichier manquant' })
      return reply(await uploadLogo(brand, file))
    }
    case 'meta':   return reply(await connectMeta(req.nextUrl.origin, brand, String(body.adAccount ?? '')))
    case 'google': return reply(await connectGoogle(req.nextUrl.origin, brand, String(body.customerId ?? '')))
    case 'refreshCosts': {
      const r = await refreshCostsFromShopify(req.nextUrl.origin, brand)
      return reply(r.error ? { error: r.error } : { added: r.after - r.before, total: r.after })
    }
    case 'costs': {
      const shipping = Number(String(body.shipping ?? '').replace(',', '.'))
      const fee = body.feeRate === '' || body.feeRate == null ? null : Number(String(body.feeRate).replace(',', '.'))
      if (!(shipping > 0) || (fee != null && !(fee >= 0 && fee < 20))) return reply({ error: 'Valeurs invalides' })
      return reply({ error: await saveCosts(brand, shipping, fee) })
    }
    case 'history': {
      const from = String(body.from ?? '')
      if (!/^\d{4}-\d{2}-\d{2}$/.test(from)) return reply({ error: 'Date invalide' })
      return reply(await backfillHistory(req.nextUrl.origin, brand, from))
    }
    case 'skip': {
      const step = String(body.step) as StepKey
      if (!STEPS.includes(step)) return reply({ error: 'Étape inconnue' })
      return reply({ error: await setSkipped(brand, step, body.skip !== false) })
    }
  }
  return reply({ error: 'Action inconnue' })
}
