import { ImageResponse } from 'next/og'
import { NextRequest } from 'next/server'

// Icônes PWA générées à la volée (aucune image dans /public).
// Utilisées par app/manifest.ts (192 / 512 / maskable) et le favicon.
// Fond navy plein (marque Steero) → convient aussi en maskable (zone de
// sécurité largement respectée, le « S » occupe ~50 % centré).
export async function GET(req: NextRequest) {
  const raw  = Number(req.nextUrl.searchParams.get('size') ?? '512')
  const size = [192, 512].includes(raw) ? raw : 512
  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: '#1a1a2e',
          color: '#faf9f8',
          fontSize: size * 0.5,
          fontWeight: 800,
          fontFamily: 'sans-serif',
          letterSpacing: -2,
        }}
      >
        S
      </div>
    ),
    { width: size, height: size },
  )
}
