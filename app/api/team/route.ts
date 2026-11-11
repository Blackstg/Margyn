// Équipe d'une marque (page /[brand]/users) — admins de la marque uniquement.
// GET ?brand= → membres de CETTE marque + invitations en cours
// POST {brand, action: invite | update | remove | cancel, …}
import { NextRequest, NextResponse } from 'next/server'
import { BRANDS } from '@/lib/access'
import { adminSession, withCookies } from '@/lib/shopify/app'
import { brandFeatures, cancelInvite, createInvite, listInvites, listMembers, removeMember, rolesFor, updateMember } from '@/lib/team'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const brand = req.nextUrl.searchParams.get('brand') ?? ''
  if (!(BRANDS as string[]).includes(brand)) return NextResponse.json({ error: 'Marque inconnue' }, { status: 400 })
  const auth = await adminSession(req, brand)
  if (!auth.admin || !auth.caller) return withCookies(NextResponse.json({ error: 'Réservé aux admins de la marque' }, { status: 403 }), auth.refreshed)
  const [members, invites] = await Promise.all([listMembers(brand, auth.caller), listInvites(brand)])
  return withCookies(NextResponse.json({
    members, invites, roles: rolesFor(brand),
    features: brandFeatures(brand).map(f => ({ key: f.key, label: f.label, section: f.section })),
  }), auth.refreshed)
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({})) as Record<string, unknown>
  const brand = String(body.brand ?? '')
  if (!(BRANDS as string[]).includes(brand)) return NextResponse.json({ error: 'Marque inconnue' }, { status: 400 })
  const auth = await adminSession(req, brand)
  if (!auth.admin || !auth.caller) return withCookies(NextResponse.json({ error: 'Réservé aux admins de la marque' }, { status: 403 }), auth.refreshed)
  const reply = (r: Record<string, unknown>) => withCookies(NextResponse.json(r, { status: r.error ? 400 : 200 }), auth.refreshed)

  switch (body.action) {
    case 'invite': {
      const r = await createInvite(brand, auth.caller, String(body.email ?? ''), String(body.role ?? 'admin'), body.features)
      return reply(r.token ? { url: `${req.nextUrl.origin}/join/${r.token}` } : { error: r.error })
    }
    case 'update': return reply({ error: await updateMember(brand, auth.caller, String(body.id), String(body.role), body.features) })
    case 'remove': return reply({ error: await removeMember(brand, auth.caller, String(body.id)) })
    case 'cancel': return reply({ error: await cancelInvite(brand, String(body.token)) })
  }
  return reply({ error: 'Action inconnue' })
}
