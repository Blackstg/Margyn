import type { Metadata, Viewport } from 'next'
import { Bricolage_Grotesque } from 'next/font/google'
import ConditionalLayout from '@/components/layout/ConditionalLayout'
import './globals.css'

const bricolage = Bricolage_Grotesque({
  subsets: ['latin'],
  variable: '--font-bricolage',
  display: 'swap',
})

export const metadata: Metadata = {
  title: 'Steero',
  description: 'Dashboard analytique e-commerce',
  manifest: '/manifest.webmanifest',
  applicationName: 'Steero',
  appleWebApp: {
    capable: true,
    statusBarStyle: 'default',
    title: 'Steero',
  },
  // Pas de `icons` explicite : Next reprend automatiquement app/icon.png (le vrai
  // logo Steero) comme favicon. (Un bloc icons manuel l'écrasait par l'icône PWA générée.)
}

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: 'cover',
  themeColor: '#1a1a2e',
  // Force le thème clair : empêche le mode sombre forcé de Samsung Internet /
  // Chrome Android d'inverser la page (canvas de signature devenait illisible).
  colorScheme: 'light',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="fr">
      <body className={`${bricolage.variable} antialiased`}>
        <ConditionalLayout>{children}</ConditionalLayout>
      </body>
    </html>
  )
}
