// App Shopify custom d'une marque (en attendant l'app publique) : l'admin saisit
// l'ID client + le secret client dans Paramètres ; le secret est chiffré en base.
import { NextRequest, NextResponse } from 'next/server'
import { BRANDS } from '@/lib/access'
import { saveShopifyApp } from '@/lib/tenant/integrations'
import { adminSession, withCookies } from '@/lib/shopify/app'

export async function POST(req: NextRequest) {
  const { brand, clientId, clientSecret } = await req.json().catch(() => ({}))
  if (typeof brand !== 'string' || !(BRANDS as string[]).includes(brand)) return NextResponse.json({ error: 'Marque inconnue' }, { status: 400 })
  const auth = await adminSession(req, brand)
  if (!auth.admin) return withCookies(NextResponse.json({ error: 'Réservé aux admins' }, { status: 403 }), auth.refreshed)
  const id = String(clientId ?? '').trim(), secret = String(clientSecret ?? '').trim()
  if (!/^[a-f0-9]{32}$/.test(id) || secret.length < 20) {
    return withCookies(NextResponse.json({ error: 'ID client (32 caractères) ou secret invalide' }, { status: 400 }), auth.refreshed)
  }
  const err = await saveShopifyApp(brand, id, secret)
  return withCookies(NextResponse.json(err ? { error: err } : { ok: true }, { status: err ? 500 : 200 }), auth.refreshed)
}
