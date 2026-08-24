// Embeddings pour la recherche sémantique des réponses SAV passées (RAG).
// Compatible OpenAI (text-embedding-3-small) OU Voyage AI (voyage-3-lite).
// La 1re clé présente est utilisée. Le modèle est stocké avec chaque vecteur pour
// éviter de mélanger des embeddings de dimensions différentes.

export interface EmbedResult { vector: number[]; model: string }

export function embeddingProvider(): 'openai' | 'voyage' | null {
  if (process.env.OPENAI_API_KEY) return 'openai'
  if (process.env.VOYAGE_API_KEY) return 'voyage'
  return null
}

const OPENAI_MODEL = 'text-embedding-3-small'
const VOYAGE_MODEL = 'voyage-3-lite'

// Embed un lot de textes (max ~100/appel). Renvoie null si aucune clé configurée.
export async function embedBatch(texts: string[]): Promise<{ vectors: number[][]; model: string } | null> {
  const provider = embeddingProvider()
  if (!provider || texts.length === 0) return null
  const input = texts.map(t => (t || '').slice(0, 8000)) // borne de sécurité

  if (provider === 'openai') {
    const res = await fetch('https://api.openai.com/v1/embeddings', {
      method: 'POST',
      headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: OPENAI_MODEL, input }),
    })
    if (!res.ok) throw new Error(`OpenAI embeddings ${res.status}: ${await res.text()}`)
    const data = await res.json() as { data: { embedding: number[] }[] }
    return { vectors: data.data.map(d => d.embedding), model: OPENAI_MODEL }
  }

  // Voyage
  const res = await fetch('https://api.voyageai.com/v1/embeddings', {
    method: 'POST',
    headers: { Authorization: `Bearer ${process.env.VOYAGE_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: VOYAGE_MODEL, input }),
  })
  if (!res.ok) throw new Error(`Voyage embeddings ${res.status}: ${await res.text()}`)
  const data = await res.json() as { data: { embedding: number[] }[] }
  return { vectors: data.data.map(d => d.embedding), model: VOYAGE_MODEL }
}

export async function embedOne(text: string): Promise<EmbedResult | null> {
  const r = await embedBatch([text])
  return r ? { vector: r.vectors[0], model: r.model } : null
}

// Similarité cosinus entre deux vecteurs de même dimension.
export function cosine(a: number[], b: number[]): number {
  if (!a || !b || a.length !== b.length) return 0
  let dot = 0, na = 0, nb = 0
  for (let i = 0; i < a.length; i++) { dot += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i] }
  return na && nb ? dot / (Math.sqrt(na) * Math.sqrt(nb)) : 0
}
