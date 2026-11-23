// Propriétaire du groupe : seul compte autorisé sur la vue « Groupe » (CA consolidé
// de toutes les marques). Vérifié par le middleware, l'API et la barre latérale.
export const OWNER_EMAILS = ['g.yaker@blackstg.com']

export function isOwner(email?: string | null): boolean {
  return !!email && OWNER_EMAILS.includes(email.trim().toLowerCase())
}
