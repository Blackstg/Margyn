import { createHmac } from 'crypto'

// Token stable et non devinable pour la page publique du rapport fournisseur.
// HMAC(brand) avec un secret serveur (jamais exposé au client) → le lien est
// permanent (le fournisseur peut le rouvrir), mais impossible à deviner sans le secret.
const SECRET = process.env.CRON_SECRET ?? 'dev-secret'

export function reportToken(brand: string): string {
  return createHmac('sha256', SECRET).update(`sav-report:${brand}`).digest('hex').slice(0, 32)
}

export function verifyReportToken(brand: string, token: string | null): boolean {
  return !!token && token === reportToken(brand)
}
