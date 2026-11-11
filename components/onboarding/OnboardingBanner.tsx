'use client'

// Bandeau « Configuration X/6 » en haut des pages d'une marque tant que le
// démarrage n'est pas terminé (admins seulement : l'API répond 403 aux autres).
import { useEffect, useState } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'

export default function OnboardingBanner({ brand }: { brand: string }) {
  const pathname = usePathname()
  const [s, setS] = useState<{ doneCount: number; total: number; name: string } | null>(null)
  const [hidden, setHidden] = useState(false)

  useEffect(() => {
    try { if (sessionStorage.getItem(`onb-hide-${brand}`)) { setHidden(true); return } } catch {}
    fetch(`/api/onboarding?brand=${brand}`).then(r => (r.ok ? r.json() : null)).then(setS).catch(() => {})
  }, [brand])

  if (hidden || !s || s.doneCount >= s.total || pathname.endsWith('/onboarding') || pathname.endsWith('/delivery')) return null
  return (
    <div className="flex flex-wrap items-center gap-3 border-b border-[#e8e8e4] bg-white px-6 py-2.5 text-sm">
      <span className="font-semibold text-[#1a1a18]">Configuration de {s.name}</span>
      <span className="h-1.5 w-28 overflow-hidden rounded-full bg-[#ecebe7]">
        <span className="block h-full rounded-full bg-[#1a7f4b]" style={{ width: `${(s.doneCount / s.total) * 100}%` }} />
      </span>
      <span className="text-[#6b6b63]">{s.doneCount}/{s.total}</span>
      <Link href={`/${brand}/onboarding`} className="rounded-lg bg-[#1a1a2e] px-3 py-1 text-xs font-semibold text-white">Continuer</Link>
      <button onClick={() => { setHidden(true); try { sessionStorage.setItem(`onb-hide-${brand}`, '1') } catch {} }}
        className="ml-auto text-xs text-[#6b6b63] underline underline-offset-2">Masquer</button>
    </div>
  )
}
