import { notFound } from 'next/navigation'
import { BrandProvider, type Brand } from '@/context/BrandContext'
import OnboardingBanner from '@/components/onboarding/OnboardingBanner'

const VALID_BRANDS: Brand[] = ['bowa', 'moom', 'krom', 'yone']

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
      <OnboardingBanner brand={params.brand} />
      {children}
    </BrandProvider>
  )
}
