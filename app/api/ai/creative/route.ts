// POST /api/ai/creative
// Analyse une créative Meta et suggère des variantes de copy + angles
// Utilise claude-sonnet-4-6 (plus de profondeur que haiku pour le copywriting)

import { NextRequest, NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'

export const dynamic = 'force-dynamic'

const MODEL = 'claude-sonnet-4-6'

interface CreativeAnalysisRequest {
  format: string
  headline: string
  primary_text: string
  description?: string
  brand: string
  spend: number
  impressions: number
  ctr: number | null
  roas: number | null
  hook_rate: number | null
  cpa: number | null
}

export async function POST(req: NextRequest) {
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) return NextResponse.json({ error: 'ANTHROPIC_API_KEY not configured' }, { status: 503 })

  let body: CreativeAnalysisRequest
  try { body = await req.json() }
  catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }

  const { format, headline, primary_text, brand, spend, impressions, ctr, roas, hook_rate, cpa } = body

  const fmtNum = (n: number | null, suffix = '') =>
    n != null ? `${n.toLocaleString('fr-FR')}${suffix}` : 'N/A'

  const prompt = `Tu es expert en copywriting publicitaire e-commerce. Analyse cette créative Meta qui performe à ${fmtNum(roas, 'x')} ROAS avec un CTR de ${fmtNum(ctr ? ctr * 100 : null, '%')}.

Créative actuelle :
- Format : ${format}
- Headline : ${headline || '(non renseigné)'}
- Primary text : ${primary_text || '(non renseigné)'}
- Marque : ${brand}
- KPIs : Dépense ${fmtNum(spend, '€')}, Impressions ${fmtNum(impressions)}, CTR ${fmtNum(ctr ? ctr * 100 : null, '%')}, ROAS ${fmtNum(roas, 'x')}, CPA ${fmtNum(cpa, '€')}${hook_rate != null ? `, Hook rate ${fmtNum(hook_rate, '%')}` : ''}

Analyse en 1-2 phrases pourquoi cette créa fonctionne (angle, émotion, structure).

Puis propose au format JSON strict :
{
  "analysis": "1-2 phrases d'analyse",
  "angles": ["angle 1", "angle 2", "angle 3"],
  "hooks": ["hook 1", "hook 2", "hook 3"],
  "primary_texts": ["texte 1 (max 80 car)", "texte 2", "texte 3"],
  "headlines": ["headline 1 (max 40 car)", "headline 2", "headline 3"]
}

Reste en français, conserve le ton de la marque ${brand}, pas de superlatifs vides.`

  try {
    const client = new Anthropic({ apiKey })
    const message = await client.messages.create({
      model: MODEL,
      max_tokens: 1024,
      messages: [{ role: 'user', content: prompt }],
    })

    const raw = (message.content[0] as { text: string }).text.trim()
    const jsonMatch = raw.match(/```(?:json)?\s*([\s\S]*?)```/) || raw.match(/(\{[\s\S]*\})/)
    const jsonStr = jsonMatch ? jsonMatch[1].trim() : raw
    const parsed = JSON.parse(jsonStr)

    return NextResponse.json(parsed)
  } catch (err) {
    console.error('[ai/creative]', err)
    return NextResponse.json({ error: 'AI request failed' }, { status: 500 })
  }
}
