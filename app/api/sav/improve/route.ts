// POST /api/sav/improve
// Body: { current_draft: string }
// Asks Claude to improve the formulation of the current draft while keeping the same content.

import { NextRequest, NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'

export const dynamic = 'force-dynamic'

const client = new Anthropic()

export async function POST(req: NextRequest) {
  let body: { current_draft: string }

  try { body = await req.json() }
  catch { return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 }) }

  const { current_draft } = body
  if (!current_draft?.trim()) {
    return NextResponse.json({ error: 'current_draft is required' }, { status: 400 })
  }

  const prompt = `Voici une réponse rédigée par un agent SAV Mōom (cosmétiques naturels français).

Améliore la formulation : corrige les fautes d'orthographe et de grammaire, rends le texte plus chaleureux et professionnel, améliore la fluidité des phrases — tout en conservant EXACTEMENT le même sens, les mêmes informations et la même structure générale.

Ne pas ajouter d'informations que tu ne connais pas. Ne pas supprimer d'informations existantes. Ne pas changer le ton général (rester professionnel et humain).

Réponse originale :
${current_draft}

Réponds UNIQUEMENT avec la réponse améliorée, sans explication, sans markdown, sans backticks.`

  try {
    const msg = await client.messages.create({
      model:      'claude-sonnet-4-6',
      max_tokens: 1500,
      messages:   [{ role: 'user', content: prompt }],
    })

    const improved = (msg.content[0] as { type: string; text: string }).text.trim()
    return NextResponse.json({ body: improved })
  } catch (err) {
    console.error('[SAV] improve error:', err)
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Unknown error' },
      { status: 500 },
    )
  }
}
