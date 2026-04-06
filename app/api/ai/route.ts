import { NextRequest, NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'

const MODEL = 'claude-haiku-4-5-20251001'

const SYSTEM_PROMPT = `Tu es Steero AI, un assistant analytique e-commerce expert. Tu analyses les données de performance de la marque [brand] et fournis des recommandations courtes, précises et actionnables en français.

Règles de réponse :
- Toujours répondre en JSON avec un tableau "recommendations" (max 3 éléments)
- Chaque recommandation : { "icon": "emoji", "text": "phrase courte et actionnable", "link": "/page-optionnelle-ou-null" }
- Sois direct, concis, factuel — pas de généralités
- Prioritise les actions à fort impact immédiat`

export async function POST(req: NextRequest) {
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey || apiKey === 'your_anthropic_api_key_here') {
    return NextResponse.json({ error: 'ANTHROPIC_API_KEY not configured' }, { status: 503 })
  }

  let body: { context?: string; type?: string; brand?: string }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const { context, type = 'general', brand = 'moom' } = body
  if (!context) {
    return NextResponse.json({ error: 'Missing context' }, { status: 400 })
  }

  const systemPrompt = SYSTEM_PROMPT.replace('[brand]', brand)

  const userPrompt = buildUserPrompt(type, context)

  try {
    const client = new Anthropic({ apiKey })

    const message = await client.messages.create({
      model: MODEL,
      max_tokens: 512,
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }],
    })

    const raw = (message.content[0] as { text: string }).text.trim()

    // Extract JSON from potential markdown code blocks
    const jsonMatch = raw.match(/```(?:json)?\s*([\s\S]*?)```/) || raw.match(/(\{[\s\S]*\})/)
    const jsonStr = jsonMatch ? jsonMatch[1].trim() : raw

    const parsed = JSON.parse(jsonStr) as { recommendations: Array<{ icon: string; text: string; link: string | null }> }

    return NextResponse.json(parsed)
  } catch (err) {
    console.error('[AI route] error:', err)
    return NextResponse.json({ error: 'AI request failed' }, { status: 500 })
  }
}

export async function GET() {
  return NextResponse.json({ ok: true, model: MODEL })
}

function buildUserPrompt(type: string, context: string): string {
  switch (type) {
    case 'dashboard':
      return `Voici les données de performance du dashboard e-commerce :\n\n${context}\n\nDonne 3 recommandations stratégiques prioritaires (pub, stock, marge) basées sur ces métriques. Format JSON.`

    case 'campaigns':
      return `Voici les performances des campagnes publicitaires :\n\n${context}\n\nIdentifie les 3 actions les plus urgentes : campagnes à couper, optimiser ou scaler. Format JSON.`

    case 'reapprovisionnement':
      return `Voici l'état des stocks et besoins en réapprovisionnement :\n\n${context}\n\nDonne 3 recommandations de réapprovisionnement urgentes : ruptures imminentes, produits à commander en priorité. Format JSON avec link="/reapprovisionnement" si pertinent.`

    default:
      return `${context}\n\nDonne 3 recommandations actionnables. Format JSON.`
  }
}
