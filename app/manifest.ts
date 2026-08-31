import type { MetadataRoute } from 'next'

// Manifest PWA — permet l'installation « vraie app » (plein écran, sans barre
// d'URL) sur Android/Samsung. Sur iOS, « Ajouter à l'écran d'accueil » suffisait
// déjà ; Android exige ce manifest + icônes pour proposer « Installer l'appli ».
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Steero',
    short_name: 'Steero',
    description: 'Livraison & opérations Steero',
    start_url: '/bowa/delivery',
    scope: '/',
    display: 'standalone',
    orientation: 'portrait',
    background_color: '#faf9f8',
    theme_color: '#1a1a2e',
    icons: [
      { src: '/api/icon?size=192', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/api/icon?size=512', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/api/icon?size=512', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  }
}
