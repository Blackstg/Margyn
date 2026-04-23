// ─── Claude classifier + reply generator — Mōom SAV ─────────────────────────
// Env vars: ANTHROPIC_API_KEY

import Anthropic from '@anthropic-ai/sdk'
import fs from 'fs'
import path from 'path'
import { searchCatalog } from './shopify'
import type { MoomOrder, CatalogProduct } from './shopify'
import type { CommentItem } from './zendesk'
import { findSimilarExamples } from './history'
import { createAdminClient } from '@/lib/supabase'

const client = new Anthropic()

// ─── Rules loader ─────────────────────────────────────────────────────────────
// Reads from Supabase (persistent). Falls back to the committed rules.json
// if the DB is unreachable (e.g. during local dev without Supabase vars).

async function loadRules(): Promise<string[]> {
  try {
    const supabase = createAdminClient()
    const { data, error } = await supabase
      .from('sav_rules')
      .select('content')
      .eq('active', true)
      .order('created_at', { ascending: true })
    if (!error && data) return (data as { content: string }[]).map((r) => r.content)
  } catch { /* fall through to file fallback */ }

  // Fallback: committed rules.json (works offline / before table is created)
  try {
    const raw = JSON.parse(
      fs.readFileSync(path.join(process.cwd(), 'lib/sav/rules.json'), 'utf-8')
    ) as { rules: string[] }
    if (Array.isArray(raw.rules)) return raw.rules
  } catch { /* no file */ }

  return []
}

export type TicketCategory =
  | 'suivi_livraison'
  | 'retour_remboursement'
  | 'produit_defectueux'
  | 'modification_commande'
  | 'question_produit'
  | 'partenariat'
  | 'autre'

export type ReplyAction = 'auto_reply' | 'escalate'

export interface ClassificationResult {
  category:    TicketCategory
  action:      ReplyAction
  confidence:  number   // 0–1
  reason:      string
}

export interface ReplyResult {
  body:   string
  solved: boolean  // true if the reply closes the ticket
}

// ─── Phishing detection ───────────────────────────────────────────────────────
// Runs before Claude — if any signal matches, returns the list of matched reasons
// so the orchestrator can short-circuit and tag the ticket immediately.

const TRUSTED_DOMAINS = ['moom-paris.co', 'zendesk.com']

function isTrustedUrl(url: string): boolean {
  try {
    const host = new URL(url).hostname.toLowerCase()
    return TRUSTED_DOMAINS.some((d) => host === d || host.endsWith('.' + d))
  } catch {
    return false
  }
}

const PHISHING_SENDER_PATTERNS = [/^donotreply@/i, /^noreply@/i]
const PHISHING_BRAND_KEYWORDS  = [
  'meta support', 'facebook team', 'google support', 'instagram team',
]
const PHISHING_SHORTENER_HOSTS = ['forms.gle', 'bit.ly']
const PHISHING_KEYWORDS = [
  'verification portal', 'final activation',
  'account suspended', 'unusual activity detected',
]

// Matches http(s):// URLs in a string
const URL_REGEX = /https?:\/\/[^\s"'<>)]+/gi

export interface PhishingDetectionResult {
  is_phishing: true
  signals: string[]
}

export function detectPhishing(
  senderEmail: string,
  subject: string,
  description: string,
): PhishingDetectionResult | null {
  const signals: string[] = []
  const text = `${subject} ${description}`.toLowerCase()

  // Extract all URLs from the content
  const urls = [...description.matchAll(URL_REGEX)].map((m) => m[0])
  const hasExternalLink = urls.some((url) => !isTrustedUrl(url))

  // 1. noreply/donotreply sender + external link
  if (hasExternalLink && PHISHING_SENDER_PATTERNS.some((p) => p.test(senderEmail))) {
    signals.push(`Expéditeur ${senderEmail} combiné à un lien externe non approuvé`)
  }

  // 2. Phishing brand mentions
  for (const kw of PHISHING_BRAND_KEYWORDS) {
    if (text.includes(kw)) signals.push(`Mention suspecte : "${kw}"`)
  }

  // 3. Known shortener / suspicious domains
  for (const url of urls) {
    try {
      const host = new URL(url).hostname.toLowerCase()
      if (PHISHING_SHORTENER_HOSTS.includes(host)) {
        signals.push(`Lien vers domaine suspect : ${host}`)
      } else if (!isTrustedUrl(url)) {
        // Generic external domain — only flag if combined with other signals or shortener
        // (avoid false positives for innocent client links)
      }
    } catch { /* ignore malformed URLs */ }
  }

  // 4. Phishing keywords
  for (const kw of PHISHING_KEYWORDS) {
    if (text.includes(kw)) signals.push(`Mot-clé phishing : "${kw}"`)
  }

  if (signals.length === 0) return null
  return { is_phishing: true, signals }
}

// ─── Classifier ───────────────────────────────────────────────────────────────

const CATEGORY_DESCRIPTIONS: Record<TicketCategory, string> = {
  suivi_livraison:         'Question sur le statut ou le délai de livraison d\'une commande',
  retour_remboursement:    'Demande de retour, échange ou remboursement',
  produit_defectueux:      'Produit reçu endommagé, incomplet ou non conforme',
  modification_commande:   'Demande de modification ou d\'annulation d\'une commande',
  question_produit:        'Question sur un produit (composition, taille, disponibilité)',
  partenariat:             'Demande de collaboration, partenariat, affiliation, UGC ou influenceur',
  autre:                   'Tout autre sujet ne rentrant pas dans les catégories ci-dessus',
}

export async function classifyTicket(
  subject: string,
  description: string,
): Promise<ClassificationResult> {
  const categoriesList = Object.entries(CATEGORY_DESCRIPTIONS)
    .map(([k, v]) => `- ${k}: ${v}`)
    .join('\n')

  const prompt = `Tu es un assistant de classification SAV pour la marque Mōom (cosmétiques français).

Voici les catégories disponibles :
${categoriesList}

Ticket SAV :
Sujet : ${subject}
Message : ${description}

Réponds UNIQUEMENT avec un objet JSON valide (sans markdown, sans backticks) avec ces champs :
{
  "category": "<une des catégories>",
  "action": "auto_reply" | "escalate",
  "confidence": <nombre entre 0 et 1>,
  "reason": "<courte justification en français>"
}

Règles pour "action" :
- "auto_reply" si la réponse est standard et ne nécessite pas d'intervention humaine
- "escalate" si le client semble très mécontent, si la situation est complexe/litige, si le ticket concerne un produit défectueux grave, ou si la confiance est < 0.6`

  const msg = await client.messages.create({
    model:      'claude-sonnet-4-6',
    max_tokens: 256,
    messages:   [{ role: 'user', content: prompt }],
  })

  const text = (msg.content[0] as { type: string; text: string }).text.trim()
  const result = JSON.parse(text) as ClassificationResult
  return result
}

// ─── Reply generator ──────────────────────────────────────────────────────────

export async function generateReply(
  subject:        string,
  description:    string,
  category:       TicketCategory,
  order:          MoomOrder | null,
  customerEmail:  string,
  comments?:      CommentItem[],
): Promise<ReplyResult> {
  const rules = await loadRules()
  console.log(`[SAV] generateReply — ${rules.length} règle(s) chargée(s) :`, rules)
  const rulesBlock = rules.length > 0
    ? `\nRègles obligatoires à respecter impérativement :\n${rules.map((r, i) => `IMPORTANT: ${i + 1}. ${r}`).join('\n')}\n`
    : ''

  const similarExamples = findSimilarExamples(subject, description, 5)
  const examplesBlock = similarExamples.length > 0
    ? `\nExemples de réponses SAV Mōom similaires — utilise-les comme référence de style, de ton et de structure :\n\n${
        similarExamples.map((ex, i) =>
          `[Exemple ${i + 1}]\nMessage client : ${ex.customer_message.slice(0, 400)}\nRéponse agent  : ${ex.agent_reply.slice(0, 600)}`
        ).join('\n\n')
      }\n`
    : ''
  const orderContext = order
    ? `Commande la plus récente du client :
- Numéro : ${order.order_number}
- Statut livraison : ${order.status_fr}
- Statut paiement : ${order.financial_status_fr}
- Transporteur : ${order.carrier ?? 'Non renseigné'}
- Numéro de suivi : ${order.tracking_number ?? 'Non disponible'}
- URL de suivi : ${order.tracking_url ?? 'Non disponible'}
- Livraison estimée : ${order.estimated_delivery ?? 'Non renseignée'}
- Produits : ${order.products.map((p) => `${p.quantity}× ${p.name} (${p.price}€)`).join(', ')}
- Date de commande : ${new Date(order.created_at).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' })}`
    : 'Aucune commande trouvée pour cet email.'

  // ── Catalog lookup for modification_commande ──────────────────────────────
  // Search Shopify for the product the client wants to switch to, so Claude
  // can compare real prices instead of guessing.
  let catalogBlock = ''
  if (category === 'modification_commande') {
    // Use the subject + last client message as search queries.
    // Shopify title search does partial matching — try the subject first,
    // then fall back to the raw description if no results.
    const lastMsg = (() => {
      if (comments && comments.length > 0) {
        const clientComments = comments.filter(c => c.author_type === 'client')
        return clientComments[clientComments.length - 1]?.body ?? description
      }
      return description
    })()

    let catalogProducts: CatalogProduct[] = []
    try {
      catalogProducts = await searchCatalog(subject)
      if (catalogProducts.length === 0) {
        // Retry with the client message (first 80 chars) as search query
        catalogProducts = await searchCatalog(lastMsg.slice(0, 80))
      }
      console.log(`[SAV] modification_commande — catalogue Shopify: ${catalogProducts.length} produit(s) trouvé(s) pour "${subject}"`)
    } catch (err) {
      console.warn('[SAV] searchCatalog failed:', err)
    }

    if (catalogProducts.length > 0) {
      const lines = catalogProducts.map(p => {
        const variants = p.variants.filter(v => v.title !== 'Default Title')
        if (variants.length === 0) {
          return `- "${p.title}" : ${p.variants[0]?.price ?? '?'}€`
        }
        return `- "${p.title}" — variantes : ${variants.map(v => `${v.title} → ${v.price}€`).join(', ')}`
      })
      catalogBlock = `\nProduits trouvés dans le catalogue Mōom pouvant correspondre à la demande du client :\n${lines.join('\n')}\n`
    } else {
      catalogBlock = '\nAucun produit trouvé dans le catalogue Mōom pour cette demande — ne pas inventer de prix.\n'
    }
  }

  // ── Build the conversation context block ──────────────────────────────────
  // If we have the full thread, surface the last client message prominently
  // so Claude answers the right question, then show prior exchanges as context.
  let conversationBlock: string
  if (comments && comments.length > 0) {
    const clientComments = comments.filter(c => c.author_type === 'client')
    const lastClientMsg  = clientComments[clientComments.length - 1]?.body ?? description

    // Prior exchanges = everything except the last client message (oldest first for readability)
    const priorComments = [...comments]
      .filter(c => !(c.author_type === 'client' && c.body === lastClientMsg))
      .sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime())

    const historyBlock = priorComments.length > 0
      ? `\nHistorique de la conversation pour contexte (du plus ancien au plus récent) :\n${
          priorComments.map(c =>
            `[${c.author_type === 'client' ? 'Client' : 'Agent'}] ${c.body.slice(0, 600)}`
          ).join('\n\n')
        }`
      : ''

    conversationBlock = `Sujet : ${subject}

Dernier message du client (celui auquel tu dois répondre) :
${lastClientMsg}
${historyBlock}`
  } else {
    // Fallback: no thread available, use the ticket description
    conversationBlock = `Sujet : ${subject}
Message : ${description}`
  }

  const prompt = `Tu es un agent SAV pour la marque Mōom, une marque française de cosmétiques naturels haut de gamme.
Tu dois répondre au ticket suivant de manière professionnelle, chaleureuse et efficace, en français.
${rulesBlock}${examplesBlock}
Catégorie identifiée : ${category}
Email du client : ${customerEmail}

Ticket SAV :
${conversationBlock}

${orderContext}
${catalogBlock}
Instructions :
- Rédige une réponse complète, naturelle et empathique, comme si tu étais une vraie conseillère SAV Mōom
- Commence par remercier le client pour son message ou te présenter brièvement
- Réponds directement à sa demande en utilisant les informations de commande disponibles
- Si le suivi est disponible, donne le lien directement dans la réponse
- Termine toujours par une formule de politesse chaleureuse et une invitation à revenir si besoin
- N'utilise pas de placeholders comme [NOM] — si tu ne connais pas le prénom, n'en mets pas
- Longueur : 3 à 6 paragraphes, ton professionnel mais humain
${category === 'modification_commande' ? `- PRIX : utilise UNIQUEMENT les prix fournis ci-dessus (commande + catalogue). Ne jamais deviner ou inventer un montant. Si les deux produits ont le même prix → "sans supplément". Si différence → "différence de X€". Si produit non trouvé dans le catalogue → dire qu'on va vérifier et revenir vers le client.` : ''}

Réponds UNIQUEMENT avec un objet JSON valide (sans markdown, sans backticks) :
{
  "body": "<le texte complet de la réponse>",
  "solved": <true si la réponse résout le problème sans action supplémentaire attendue, false sinon>
}`

  const msg = await client.messages.create({
    model:      'claude-sonnet-4-6',
    max_tokens: 1024,
    messages:   [{ role: 'user', content: prompt }],
  })

  const text = (msg.content[0] as { type: string; text: string }).text.trim()
  const result = JSON.parse(text) as ReplyResult
  return result
}
