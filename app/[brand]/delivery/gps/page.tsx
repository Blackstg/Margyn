'use client'

import { useEffect, useState } from 'react'

type State = 'idle' | 'requesting' | 'granted' | 'denied'

export default function GpsActivationPage() {
  const [state, setState] = useState<State>('idle')
  const [checked, setChecked] = useState(false)

  // Check if permission is already granted
  useEffect(() => {
    if (!navigator?.permissions) { setChecked(true); return }
    navigator.permissions.query({ name: 'geolocation' }).then((result: PermissionStatus) => {
      if (result.state === 'granted') setState('granted')
      setChecked(true)
    }).catch(() => setChecked(true))
  }, [])

  async function activate() {
    setState('requesting')
    try {
      await new Promise<GeolocationPosition>((ok, err) =>
        navigator.geolocation.getCurrentPosition(ok, err, {
          enableHighAccuracy: true,
          timeout: 15_000,
        })
      )
      setState('granted')
    } catch {
      setState('denied')
    }
  }

  if (!checked) return null

  return (
    <div className="min-h-screen bg-[#f8f7f5] flex flex-col items-center justify-center p-6">
      <div className="w-full max-w-xs space-y-6 text-center">

        {state === 'granted' ? (
          <>
            <div className="w-20 h-20 rounded-full bg-[#dcfce7] flex items-center justify-center mx-auto">
              <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="#15803d" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="20 6 9 17 4 12"/>
              </svg>
            </div>
            <div>
              <h1 className="text-xl font-bold text-[#1a1a2e] mb-2">C&apos;est activé !</h1>
              <p className="text-sm text-[#6b6b63] leading-relaxed">
                L&apos;optimisation de tournée est maintenant active. Tu peux fermer cette page et continuer à utiliser l&apos;app normalement.
              </p>
            </div>
            <p className="text-xs text-[#9b9b93]">Tu peux fermer cette page</p>
          </>
        ) : state === 'denied' ? (
          <>
            <div className="w-20 h-20 rounded-full bg-[#fef2f2] flex items-center justify-center mx-auto">
              <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="#dc2626" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
              </svg>
            </div>
            <div>
              <h1 className="text-xl font-bold text-[#1a1a2e] mb-2">Accès refusé</h1>
              <p className="text-sm text-[#6b6b63] leading-relaxed">
                Pour activer l&apos;optimisation, va dans les <strong>Réglages</strong> de ton téléphone → <strong>Safari / Chrome</strong> → <strong>Localisation</strong> et autorise l&apos;accès.
              </p>
            </div>
            <button
              onClick={activate}
              className="w-full py-4 rounded-[16px] bg-[#1a1a2e] text-white font-semibold text-base active:bg-[#2d2d4e]"
            >
              Réessayer
            </button>
          </>
        ) : (
          <>
            <div className="w-20 h-20 rounded-full bg-[#eff6ff] flex items-center justify-center mx-auto">
              <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="#2563eb" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7z"/>
                <circle cx="12" cy="9" r="2.5"/>
              </svg>
            </div>

            <div>
              <h1 className="text-xl font-bold text-[#1a1a2e] mb-2">Optimisation GPS</h1>
              <p className="text-sm text-[#6b6b63] leading-relaxed">
                Active l&apos;accès GPS pour que Steero calcule automatiquement le meilleur ordre de livraison selon l&apos;endroit où tu te trouves.
              </p>
            </div>

            <button
              onClick={activate}
              disabled={state === 'requesting'}
              className="w-full py-4 rounded-[16px] bg-[#1a7f4b] text-white font-bold text-base active:bg-[#15653c] disabled:opacity-60 transition-colors"
            >
              {state === 'requesting' ? (
                <span className="flex items-center justify-center gap-2">
                  <svg className="animate-spin" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                    <path d="M21 12a9 9 0 1 1-6.219-8.56"/>
                  </svg>
                  Vérification…
                </span>
              ) : 'Activer'}
            </button>

            <p className="text-[11px] text-[#c0bfba] leading-relaxed px-2">
              Utilisé uniquement pour optimiser l&apos;ordre des livraisons.
            </p>
          </>
        )}
      </div>
    </div>
  )
}
