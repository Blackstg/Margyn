// Page publique pour l'usine : lien secret /factory/<marque>-<jeton>, sans connexion.
// Unités uniquement (ventes, prévisions, batchs) — ni prix, ni CA, ni clients.
import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { createClient } from '@supabase/supabase-js'
import FactoryView from '@/components/supplier/FactoryView'
import { computeForecast, loadConfig, tokenMatches, type Lang } from '@/lib/supplierForecast'
import { BRANDS, BRAND_LABELS, type Brand } from '@/lib/access'

export const dynamic = 'force-dynamic'
export const fetchCache = 'force-no-store'
export const metadata: Metadata = { title: 'Production plan', robots: { index: false, follow: false } }

const LANGS: { key: Lang; label: string }[] = [{ key: 'en', label: 'English' }, { key: 'zh', label: '中文' }, { key: 'fr', label: 'Français' }]

export default async function FactoryPage({ params, searchParams }: { params: { token: string }; searchParams: { lang?: string } }) {
  const token = decodeURIComponent(params.token ?? '')
  const brand = token.split('-')[0] as Brand
  if (!(BRANDS as string[]).includes(brand)) notFound()

  const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { autoRefreshToken: false, persistSession: false } })
  const config = await loadConfig(db, brand)
  if (!config || !tokenMatches(config.token, token)) notFound()

  const forecast = await computeForecast(db, brand, config)
  const lang: Lang = searchParams.lang === 'en' || searchParams.lang === 'zh' || searchParams.lang === 'fr' ? searchParams.lang : config.lang

  return (
    <main className="min-h-screen bg-[#f7f7f5] px-4 py-6 sm:px-8">
      <div className="mx-auto max-w-5xl">
        <nav className="mb-4 flex justify-end gap-1">
          {LANGS.map(l => (
            <a key={l.key} href={`?lang=${l.key}`}
              className={`rounded-full px-3 py-1 text-xs font-semibold ${l.key === lang ? 'bg-[#1a1a2e] text-white' : 'bg-white text-[#6b6b63] border border-[#e8e8e4]'}`}>
              {l.label}
            </a>
          ))}
        </nav>
        <FactoryView forecast={forecast} lang={lang} brandLabel={BRAND_LABELS[brand]} token={token} />
      </div>
    </main>
  )
}
