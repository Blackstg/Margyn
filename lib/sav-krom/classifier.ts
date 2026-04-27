// ─── Claude classifier + reply generator — Krom Water SAV ────────────────────

import Anthropic from '@anthropic-ai/sdk'
import { createAdminClient } from '@/lib/supabase'
import type { GmailMessage } from './gmail'

const client = new Anthropic()

// ─── Rules loader ─────────────────────────────────────────────────────────────

async function loadRules(): Promise<string[]> {
  try {
    const supabase = createAdminClient()
    const { data, error } = await supabase
      .from('sav_krom_rules')
      .select('content')
      .eq('active', true)
      .order('created_at', { ascending: true })
    if (!error && data) return (data as { content: string }[]).map(r => r.content)
  } catch { /* fall through */ }
  return []
}

// ─── Types ────────────────────────────────────────────────────────────────────

export type KromCategory =
  | 'suivi_livraison'
  | 'retour_remboursement'
  | 'produit_defectueux'
  | 'modification_commande'
  | 'question_produit'
  | 'partenariat'
  | 'question_technique'   // Krom-specific: questions sur la filtration, installation, entretien
  | 'autre'

export type ReplyAction = 'auto_reply' | 'escalate'

export interface KromDecisionOption {
  key:   string
  emoji: string
  label: string
}

export interface KromClassification {
  category:         KromCategory
  action:           ReplyAction
  confidence:       number
  reason:           string
  needs_decision?:  boolean
  decision_options?: KromDecisionOption[]
}

export interface KromReplyResult {
  situation_detectee: string
  body:               string
  solved:             boolean
}

// ─── Category descriptions ────────────────────────────────────────────────────

const CAT_DESCRIPTIONS: Record<KromCategory, string> = {
  suivi_livraison:      'Question sur le statut ou le délai de livraison',
  retour_remboursement: 'Demande de retour, échange ou remboursement',
  produit_defectueux:   'Produit reçu endommagé ou ne fonctionnant pas',
  modification_commande:'Demande de modification ou annulation de commande',
  question_produit:     'Question sur les produits Krom (carafe, cartouche, accessoires)',
  partenariat:          'Demande de collaboration, partenariat ou affiliation',
  question_technique:   'Question sur l\'installation, l\'entretien, la filtration ou la durée de vie des cartouches',
  autre:                'Tout autre sujet',
}

// ─── Classifier ───────────────────────────────────────────────────────────────

export async function classifyEmail(
  subject:     string,
  body:        string,
): Promise<KromClassification> {
  const categoriesList = Object.entries(CAT_DESCRIPTIONS)
    .map(([k, v]) => `- ${k}: ${v}`)
    .join('\n')

  const prompt = `Tu es un assistant de classification SAV pour Krom Water, une marque française de carafes filtrantes et de purification d'eau.

Catégories disponibles :
${categoriesList}

Email SAV :
Sujet : ${subject}
Message : ${body.slice(0, 1000)}

Réponds UNIQUEMENT avec un objet JSON valide (sans markdown, sans backticks) :
{
  "category": "<une des catégories>",
  "action": "auto_reply" | "escalate",
  "confidence": <nombre entre 0 et 1>,
  "reason": "<courte justification en français>",
  "needs_decision": <true | false>,
  "decision_options": [
    { "key": "<clé courte>", "emoji": "<emoji>", "label": "<libellé court>" },
    ...
  ]
}

Règles pour "action" :
- "escalate" si client très mécontent, situation complexe ou litige
- "escalate" si confidence < 0.6
- "auto_reply" pour les demandes standard

Règles pour "needs_decision" :
- true si le ticket nécessite une décision humaine avant de répondre : remboursement exceptionnel, geste commercial, litige ambigu, demande de retour où la politique n'est pas claire, produit défectueux sans décision évidente
- false pour les demandes standard (suivi livraison, question technique, question produit, partenariat)

Règles pour "decision_options" (seulement si needs_decision=true, 2 à 4 options max) :
- Pour retour/remboursement : ["💸 On rembourse", "🔄 On propose un échange", "🎁 On propose un avoir", "📎 On demande un justificatif"]
- Pour produit défectueux : ["🎁 Geste commercial", "🔄 On renvoie le produit", "💸 On rembourse", "📎 On demande des photos"]
- Pour litige/situation complexe : ["✅ On accepte", "❌ On refuse", "🤔 On demande plus d'infos"]
- Toujours inclure "✍️ Rédiger moi une réponse" comme dernière option (key: "libre")
- Si needs_decision=false, mettre decision_options: []`

  const msg = await client.messages.create({
    model:      'claude-sonnet-4-6',
    max_tokens: 512,
    messages:   [{ role: 'user', content: prompt }],
  })

  const text = (msg.content[0] as { type: string; text: string }).text.trim()
  const result = JSON.parse(text) as KromClassification
  if (!result.decision_options) result.decision_options = []
  return result
}

// ─── Reply generator ──────────────────────────────────────────────────────────

export async function generateReply(
  subject:       string,
  body:          string,
  category:      KromCategory,
  senderEmail:   string,
  messages?:     GmailMessage[],
  decision?:     string,
): Promise<KromReplyResult> {
  const rules = await loadRules()
  const rulesBlock = rules.length > 0
    ? rules.map((r, i) => `IMPORTANT ${i + 1}. ${r}`).join('\n')
    : '(aucune règle spécifique — appliquer les bonnes pratiques SAV)'

  // ── Isoler le dernier message client ────────────────────────────────────
  let lastClientMsg: string
  let priorHistory: string

  if (messages && messages.length > 0) {
    const clientMessages = messages.filter(m => m.is_client)
    lastClientMsg = clientMessages[clientMessages.length - 1]?.body ?? body

    const priorMsgs = [...messages]
      .filter(m => !(m.is_client && m.body === lastClientMsg))
      .sort((a, b) => new Date(a.received_at).getTime() - new Date(b.received_at).getTime())

    priorHistory = priorMsgs.length > 0
      ? priorMsgs.map(m => {
          const role = m.is_client ? 'Client' : 'Krom Water'
          const date = new Date(m.received_at).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' })
          return `[${role} — ${date}]\n${m.body.slice(0, 600)}`
        }).join('\n\n')
      : '(premier message, pas d\'historique)'
  } else {
    lastClientMsg = body
    priorHistory  = '(pas d\'historique disponible)'
  }

  const prompt = `Tu es un agent SAV pour Krom Water, une marque française de carafes filtrantes et systèmes de purification d'eau haut de gamme.
Ton objectif : rédiger la meilleure réponse possible au dernier message du client.
Langue : français. Ton : professionnel, chaleureux, pédagogue (les questions techniques sont fréquentes).

━━━ SECTION 1 — SITUATION ACTUELLE ━━━
Lis UNIQUEMENT ce dernier message du client :

Sujet : ${subject}
Email du client : ${senderEmail}

DERNIER MESSAGE :
${lastClientMsg}

━━━ SECTION 2 — CONTEXTE (pour comprendre, ne pas répéter) ━━━
Catégorie identifiée : ${category}

Historique de la conversation :
${priorHistory}

━━━ SECTION 3 — RÈGLES OBLIGATOIRES ━━━
${rulesBlock}

━━━ SECTION 4 — INSTRUCTION ━━━
${decision ? `⚡ DÉCISION PRISE PAR L'ÉQUIPE : "${decision}"
Tu DOIS rédiger la réponse en appliquant strictement cette décision. Ne la remet pas en question.

` : ''}Rédige une réponse UNIQUEMENT pour répondre à la SITUATION ACTUELLE.

Contraintes :
- Ne PAS répéter ce qui a déjà été dit dans l'historique
- Ne PAS inventer d'informations (numéros de suivi, délais précis, prix)
- Si une info manque → "je vérifie et reviens vers vous rapidement"
- Pas de placeholders comme [NOM]
- Pour les questions techniques : expliquer clairement et simplement (durée cartouche, installation, entretien)
- Longueur : 2 à 5 paragraphes selon la complexité
${category === 'question_technique'
  ? '- Fournir des explications précises et rassurantes sur le fonctionnement du produit Krom'
  : ''}

Réponds UNIQUEMENT avec un objet JSON valide (sans markdown, sans backticks) :
{
  "situation_detectee": "<une phrase : ce que le client demande dans son dernier message>",
  "body": "<texte complet de la réponse email, sans formule d'objet>",
  "solved": <true si la réponse clôt le problème, false sinon>
}`

  const msg = await client.messages.create({
    model:      'claude-sonnet-4-6',
    max_tokens: 1500,
    messages:   [{ role: 'user', content: prompt }],
  })

  const text = (msg.content[0] as { type: string; text: string }).text.trim()
  const result = JSON.parse(text) as KromReplyResult
  console.log(`[SAV-Krom] generateReply — situation: "${result.situation_detectee}"`)
  return result
}
