// ─── Équipe d'une marque ──────────────────────────────────────────────────────
// Une marque ne voit QUE ses membres : jamais les comptes, ni les noms des autres
// marques. Invitations par lien personnel (7 jours) rangées dans Storage
// app-config/invites/<jeton>.json — pas d'e-mail Supabase (limité à l'équipe Supabase).
// Droits : rôle + fonctionnalités sont globaux à un compte ; un admin de marque ne
// peut donc modifier que les membres dont toutes les marques sont aussi les siennes.
// SERVER-ONLY.
import crypto from 'crypto'
import { createClient } from '@supabase/supabase-js'
import { BRANDS, FEATURES, effectiveBrands, isOwner, type Brand, type FeatureKey } from '@/lib/access'

const db = () => createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { autoRefreshToken: false, persistSession: false } })
const INVITE_DAYS = 7

export type Caller = { id: string; role?: string; brands?: string[] | null }

export interface Member {
  id: string
  email: string
  role: string
  features: string[] | null
  otherBrands: boolean   // a aussi accès à d'autres marques (sans les nommer)
  editable: boolean
  you: boolean
}

export interface Invite { token: string; email: string; role: string; features: string[]; expiresAt: string }

export function brandFeatures(brand: string) {
  return FEATURES.filter(f => f.brandLock == null || (Array.isArray(f.brandLock) ? f.brandLock : [f.brandLock]).includes(brand as Brand))
}

export function rolesFor(brand: string) {
  return ['admin', 'sav', ...(brand === 'bowa' ? ['delivery', 'logistician'] : [])]
}

function canEdit(caller: Caller, memberBrands: string[]) {
  if (isOwner(caller.role, caller.brands)) return true
  const mine = effectiveBrands(caller.role, caller.brands) as string[]
  return memberBrands.every(b => mine.includes(b))
}

export async function listMembers(brand: string, caller: Caller): Promise<Member[]> {
  const { data } = await db().auth.admin.listUsers({ perPage: 1000 })
  return (data?.users ?? [])
    .filter(u => Array.isArray(u.user_metadata?.brands) && (u.user_metadata!.brands as string[]).includes(brand))
    .map(u => {
      const m = u.user_metadata ?? {}
      const brands = (m.brands as string[]).filter(b => (BRANDS as string[]).includes(b))
      return {
        id: u.id,
        email: u.email ?? (u.phone ? `+${u.phone}` : ''),
        role: (m.role as string) ?? 'admin',
        features: Array.isArray(m.features) ? (m.features as string[]) : null,
        otherBrands: brands.some(b => b !== brand),
        editable: u.id !== caller.id && canEdit(caller, brands),
        you: u.id === caller.id,
      }
    })
    .sort((a, b) => a.email.localeCompare(b.email))
}

function cleanFeatures(brand: string, features: unknown): FeatureKey[] {
  const allowed = new Set(brandFeatures(brand).map(f => f.key))
  return (Array.isArray(features) ? features : []).filter((f): f is FeatureKey => allowed.has(f as FeatureKey))
}

export async function updateMember(brand: string, caller: Caller, id: string, role: string, features: unknown): Promise<string | null> {
  if (!rolesFor(brand).includes(role)) return 'Rôle invalide'
  const sb = db()
  const { data } = await sb.auth.admin.getUserById(id)
  const m = data?.user?.user_metadata ?? {}
  const brands = Array.isArray(m.brands) ? (m.brands as string[]) : null
  if (!data?.user || !brands?.includes(brand)) return 'Membre introuvable'
  if (id === caller.id || !canEdit(caller, brands)) return 'Ce compte est géré par le propriétaire'
  // Les fonctionnalités d'autres marques déjà accordées sont conservées.
  const keepOther = (Array.isArray(m.features) ? (m.features as string[]) : []).filter(f => !brandFeatures(brand).some(x => x.key === f))
  const { error } = await sb.auth.admin.updateUserById(id, {
    user_metadata: { ...m, role, features: role === 'sav' ? [...keepOther, ...cleanFeatures(brand, features)] : m.features ?? null },
  })
  return error?.message ?? null
}

export async function removeMember(brand: string, caller: Caller, id: string): Promise<string | null> {
  const sb = db()
  const { data } = await sb.auth.admin.getUserById(id)
  const m = data?.user?.user_metadata ?? {}
  const brands = Array.isArray(m.brands) ? (m.brands as string[]) : null
  if (!data?.user || !brands?.includes(brand)) return 'Membre introuvable'
  if (id === caller.id) return 'Tu ne peux pas te retirer toi-même'
  // Retirer d'UNE marque est permis à tout admin de la marque ; le compte reste pour ses autres marques.
  const { error } = await sb.auth.admin.updateUserById(id, { user_metadata: { ...m, brands: brands.filter(b => b !== brand) } })
  return error?.message ?? null
}

// ─── Invitations ──────────────────────────────────────────────────────────────

const invitePath = (token: string) => `invites/${token}.json`
type StoredInvite = Invite & { brand: string; invitedBy: string; createdAt: string }

export async function createInvite(brand: string, caller: Caller, email: string, role: string, features: unknown): Promise<{ token?: string; error?: string }> {
  const e = email.trim().toLowerCase()
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) return { error: 'Adresse e-mail invalide' }
  if (!rolesFor(brand).includes(role)) return { error: 'Rôle invalide' }
  const token = crypto.randomBytes(24).toString('base64url')
  const inv: StoredInvite = {
    token, brand, email: e, role, features: role === 'sav' ? cleanFeatures(brand, features) : [],
    invitedBy: caller.id, createdAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + INVITE_DAYS * 864e5).toISOString(),
  }
  const { error } = await db().storage.from('app-config').upload(invitePath(token), JSON.stringify(inv), { contentType: 'application/json' })
  return error ? { error: error.message } : { token }
}

async function readInvite(token: string): Promise<StoredInvite | null> {
  if (!/^[A-Za-z0-9_-]{20,64}$/.test(token)) return null
  const { data } = await db().storage.from('app-config').download(invitePath(token))
  if (!data) return null
  const inv = JSON.parse(await data.text()) as StoredInvite
  return new Date(inv.expiresAt) > new Date() ? inv : null
}

export async function listInvites(brand: string): Promise<Invite[]> {
  const sb = db()
  const { data } = await sb.storage.from('app-config').list('invites', { limit: 1000 })
  const out: Invite[] = []
  for (const f of data ?? []) {
    const inv = await readInvite(f.name.replace(/\.json$/, ''))
    if (inv?.brand === brand) out.push({ token: inv.token, email: inv.email, role: inv.role, features: inv.features, expiresAt: inv.expiresAt })
  }
  return out
}

export async function cancelInvite(brand: string, token: string) {
  const inv = await readInvite(token)
  if (!inv || inv.brand !== brand) return 'Invitation introuvable'
  await db().storage.from('app-config').remove([invitePath(token)])
  return null
}

// Page publique /join/<jeton> : ce qu'on montre avant d'accepter.
export async function invitePreview(token: string) {
  const inv = await readInvite(token)
  if (!inv) return null
  const { data } = await db().from('tenants').select('name, logo_url').eq('slug', inv.brand).maybeSingle()
  return { email: inv.email, brand: inv.brand, brandName: data?.name ?? inv.brand, logoUrl: data?.logo_url ?? null }
}

// Acceptation : crée le compte (mot de passe choisi), ou ajoute la marque à un
// compte existant si la personne est connectée avec cette adresse.
export async function acceptInvite(token: string, password: string | null, sessionEmail: string | null): Promise<{ brand?: string; email?: string; error?: string; needLogin?: boolean }> {
  const inv = await readInvite(token)
  if (!inv) return { error: 'Invitation expirée ou déjà utilisée' }
  const sb = db()
  const { data } = await sb.auth.admin.listUsers({ perPage: 1000 })
  const existing = data?.users.find(u => u.email?.toLowerCase() === inv.email)
  const meta = (cur: Record<string, unknown>) => {
    const brands = Array.isArray(cur.brands) ? (cur.brands as string[]) : []
    const feats = Array.isArray(cur.features) ? (cur.features as string[]) : []
    return {
      ...cur,
      role: cur.role ?? inv.role,
      brands: Array.from(new Set([...brands, inv.brand])),
      features: Array.from(new Set([...feats, ...inv.features])),
    }
  }

  if (existing) {
    if (sessionEmail?.toLowerCase() !== inv.email) return { needLogin: true, email: inv.email }
    if (existing.user_metadata?.brands == null) return { brand: inv.brand }   // propriétaire : voit déjà tout
    const { error } = await sb.auth.admin.updateUserById(existing.id, { user_metadata: meta(existing.user_metadata ?? {}) })
    if (error) return { error: error.message }
  } else {
    if (!password || password.length < 8) return { error: 'Choisis un mot de passe de 8 caractères minimum' }
    const { error } = await sb.auth.admin.createUser({
      email: inv.email, password, email_confirm: true,
      user_metadata: { role: inv.role, brands: [inv.brand], features: inv.features },
    })
    if (error) return { error: error.message }
  }
  await sb.storage.from('app-config').remove([invitePath(token)])
  return { brand: inv.brand, email: inv.email }
}
