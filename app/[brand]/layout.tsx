import { notFound } from 'next/navigation'
import { BrandProvider, type Brand } from '@/context/BrandContext'

const VALID_BRANDS: Brand[] = ['bowa', 'moom', 'krom']

export default function BrandLayout({
  children,
  params,
}: {
  children: React.ReactNode
  params: { brand: string }
}) {
  if (!VALID_BRANDS.includes(params.brand as Brand)) notFound()

  return (
    <BrandProvider brand={params.brand as Brand}>
      {children}
    </BrandProvider>
  )
}
