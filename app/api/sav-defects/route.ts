// SAV / Défauts fournisseur — dossiers de réclamation (table defect_claims)
// GET    ?brand=moom               → liste triée reported_at desc
// POST   { ...champs }             → crée un dossier, retourne la row (avec id)
// PATCH  { id, ...champs }         → édition inline (status / reship_tracking_ref / received_at …)
// DELETE ?id=<uuid>                → supprime un dossier (+ ses fichiers Storage)

import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase'

const BUCKET = 'defect-photos'

export const dynamic = 'force-dynamic'

const STATUSES = [
  'signale', 'reclamation_envoyee', 'repro_confirmee',
  'etiquette_envoyee', 'retour_recu',
  'reexpedie', 'recu', 'clos', 'litige',
] as const

const CLAIM_TYPES = ['defaut_fournisseur', 'erreur_envoi'] as const

export async function GET(req: NextRequest) {
  const brand = req.nextUrl.searchParams.get('brand') ?? 'moom'
  const admin = createAdminClient()
  const { data, error } = await admin
    .from('defect_claims')
    .select('*')
    .eq('brand', brand)
    .order('reported_at', { ascending: false })
    .order('created_at', { ascending: false })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ claims: data ?? [] })
}

export async function POST(req: NextRequest) {
  const body = await req.json()
  const claim_type = CLAIM_TYPES.includes(body.claim_type) ? body.claim_type : 'defaut_fournisseur'
  const sku = (body.sku ?? '').toString().trim()
  const defect_description = (body.defect_description ?? '').toString().trim()
  const shopify_order_id = body.shopify_order_id?.toString().trim() || null
  const received_sku = body.received_sku?.toString().trim() || null

  if (claim_type === 'erreur_envoi') {
    if (!shopify_order_id || !received_sku) {
      return NextResponse.json({ error: 'commande + article reçu à tort requis' }, { status: 400 })
    }
  } else if (!sku && !defect_description) {
    return NextResponse.json({ error: 'sku ou description requis' }, { status: 400 })
  }

  const admin = createAdminClient()
  const { data, error } = await admin
    .from('defect_claims')
    .insert({
      brand:                 body.brand ?? 'moom',
      claim_type,
      reported_at:           body.reported_at || new Date().toISOString().slice(0, 10),
      sku:                   sku || null,
      product_name:          body.product_name?.toString().trim() || null,
      shopify_order_id,
      shopify_variant_id:    body.shopify_variant_id?.toString().trim() || null,
      received_sku,
      received_product_name: body.received_product_name?.toString().trim() || null,
      quantity:              Number(body.quantity) > 0 ? Number(body.quantity) : 1,
      defect_description:    defect_description || null,
      status:                STATUSES.includes(body.status) ? body.status : 'signale',
      supplier_claim_ref:    body.supplier_claim_ref?.toString().trim() || null,
      reship_tracking_ref:   body.reship_tracking_ref?.toString().trim() || null,
      return_tracking_ref:   body.return_tracking_ref?.toString().trim() || null,
      charged_amount:        Number(body.charged_amount) || 0,
      notes:                 body.notes?.toString().trim() || null,
    })
    .select('*')
    .single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ claim: data })
}

export async function DELETE(req: NextRequest) {
  const id = req.nextUrl.searchParams.get('id')
  if (!id) return NextResponse.json({ error: 'id manquant' }, { status: 400 })

  const admin = createAdminClient()

  // Supprime les fichiers Storage du dossier (best-effort)
  const { data: files } = await admin.storage.from(BUCKET).list(id)
  if (files?.length) {
    await admin.storage.from(BUCKET).remove(files.map(f => `${id}/${f.name}`))
  }

  const { error } = await admin.from('defect_claims').delete().eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}

export async function PATCH(req: NextRequest) {
  const body = await req.json()
  const id = body.id
  if (!id) return NextResponse.json({ error: 'id manquant' }, { status: 400 })

  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() }
  if (body.status !== undefined) {
    if (!STATUSES.includes(body.status)) {
      return NextResponse.json({ error: 'statut invalide' }, { status: 400 })
    }
    patch.status = body.status
    // Auto-renseigne la date d'envoi au 1er jalon "envoyé" (réclamation ou étiquette)
    if (body.status === 'reclamation_envoyee' || body.status === 'etiquette_envoyee') {
      patch.claim_sent_at = body.claim_sent_at || new Date().toISOString().slice(0, 10)
    }
  }
  for (const f of ['reship_tracking_ref', 'received_at', 'claim_sent_at', 'supplier_claim_ref', 'notes', 'return_tracking_ref', 'return_received_at'] as const) {
    if (body[f] !== undefined) patch[f] = body[f] || null
  }
  if (body.charged_amount !== undefined) patch.charged_amount = Number(body.charged_amount) || 0
  if (body.quantity !== undefined) patch.quantity = Number(body.quantity) > 0 ? Number(body.quantity) : 1

  const admin = createAdminClient()
  const { data, error } = await admin
    .from('defect_claims')
    .update(patch)
    .eq('id', id)
    .select('*')
    .single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ claim: data })
}
