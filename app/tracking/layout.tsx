import { Poppins } from 'next/font/google'
import type { Metadata } from 'next'

const poppins = Poppins({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
  display: 'swap',
})

export const metadata: Metadata = {
  title: 'Suivi de commande — Bowa Concept',
}

export default function TrackingLayout({ children }: { children: React.ReactNode }) {
  return <div className={poppins.className}>{children}</div>
}
