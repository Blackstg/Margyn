import type { Metadata } from 'next'
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
